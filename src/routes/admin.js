import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { handleCommand } from '../control/commands.js';
import { addLessonFromFeedback, rateConversation, runLearningCycle } from '../agent/learning.js';
import { parseProductsCsv } from '../importers.js';

// API cho dashboard quản trị. Bảo vệ bằng ADMIN_TOKEN (header Authorization: Bearer ... hoặc ?token=).
export function adminRoutes({ hub }) {
  const r = express.Router();
  const store = hub.store;

  r.use((req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token || '';
    const a = Buffer.from(String(token));
    const b = Buffer.from(config.adminToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Sai mã quản trị' });
    next();
  });

  const wrap = (fn) => async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };
  const must = (x, what = 'Không tìm thấy') => {
    if (!x) throw new Error(what);
    return x;
  };

  // ---- realtime ----
  r.get('/events', (req, res) => {
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.flushHeaders();
    const off = hub.on((ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { off(); clearInterval(ping); });
  });

  r.get('/overview', wrap(() => {
    const convs = store.all('conversations');
    const orders = store.all('orders');
    const graded = convs.filter((c) => c.grade);
    return {
      botPaused: store.settings.botPaused,
      conversations: convs.length,
      byChannel: Object.fromEntries(['facebook', 'zalo', 'web'].map((ch) => [ch, convs.filter((c) => c.channel === ch).length])),
      needsHuman: convs.filter((c) => c.needsHuman).length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length,
      confirmedRevenue: orders.filter((o) => o.status === 'confirmed').reduce((a, o) => a + o.total, 0),
      avgScore: graded.length ? +(graded.reduce((a, c) => a + c.grade.score, 0) / graded.length).toFixed(1) : null,
      hallucinations: graded.filter((c) => c.grade.hallucination).length,
      knowledgePending: store.find('knowledge', (k) => k.status !== 'approved').length,
      products: store.all('products').length,
      channels: {
        facebook: hub.channels.facebook?.enabled?.() || false,
        zalo: hub.channels.zalo?.enabled?.() || false,
        web: true,
        lark: !!(config.lark.appId && config.lark.ownerChatIds.length),
        zaloOwners: config.zalo.ownerIds.length,
        ai: !!hub.llm,
      },
    };
  }));

  // ---- hội thoại ----
  r.get('/conversations', wrap((req) => {
    let list = [...store.all('conversations')];
    if (req.query.channel) list = list.filter((c) => c.channel === req.query.channel);
    if (req.query.filter === 'needsHuman') list = list.filter((c) => c.needsHuman);
    if (req.query.filter === 'lowScore') list = list.filter((c) => c.grade && c.grade.score < store.settings.learning.lowScoreAlert);
    if (req.query.filter === 'ungraded') list = list.filter((c) => !c.grade);
    return list.sort((a, b) => (b.lastMessageAt || '').localeCompare(a.lastMessageAt || '')).slice(0, 300);
  }));

  r.get('/conversations/:id', wrap((req) => {
    const conv = must(store.get('conversations', req.params.id));
    store.update('conversations', conv.id, { unread: 0 });
    return {
      conversation: conv,
      messages: store.find('messages', (m) => m.conversationId === conv.id),
      orders: store.find('orders', (o) => o.conversationId === conv.id),
      aiActive: hub.aiActive(conv),
    };
  }));

  r.post('/conversations/:id/reply', wrap(async (req) => {
    const text = String(req.body.text || '').trim();
    if (!text) throw new Error('Nội dung trống');
    return hub.humanReply(req.params.id, text, { by: 'dashboard', learn: req.body.learn !== false });
  }));
  r.post('/conversations/:id/handover', wrap((req) => must(hub.setHandover(req.params.id, !!req.body.on))));
  r.post('/conversations/:id/resolve', wrap((req) => must(store.update('conversations', req.params.id, { needsHuman: false }))));
  r.post('/conversations/:id/grade', wrap(async (req) => {
    if (!hub.llm) throw new Error('Chưa cấu hình ANTHROPIC_API_KEY');
    return (await hub.grade(req.params.id, {})) || { error: 'Chưa có câu trả lời AI để chấm' };
  }));
  r.post('/conversations/:id/rate', wrap((req) => must(rateConversation(store, req.params.id, req.body))));
  r.post('/conversations/:id/teach', wrap((req) => addLessonFromFeedback({
    llm: hub.llm, store, conversationId: req.params.id, feedback: must(String(req.body.feedback || '').trim(), 'Góp ý trống'),
  })));

  r.post('/command', wrap(async (req) => ({ reply: await handleCommand(hub, String(req.body.text || ''), { by: 'dashboard', minutes: config.humanTakeoverMinutes }) })));

  // ---- đơn nháp ----
  r.get('/orders', wrap((req) => {
    const list = req.query.status ? store.find('orders', (o) => o.status === req.query.status) : [...store.all('orders')];
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }));
  r.post('/orders/:id/approve', wrap((req) => hub.approveOrder(req.params.id, 'dashboard')));
  r.post('/orders/:id/reject', wrap((req) => hub.rejectOrder(req.params.id, req.body.reason || '', 'dashboard')));
  r.put('/orders/:id', wrap((req) => {
    const o = must(store.get('orders', req.params.id));
    if (o.status !== 'pending') throw new Error('Chỉ sửa được đơn đang chờ duyệt');
    const patch = {};
    if (req.body.customer) patch.customer = { ...o.customer, ...req.body.customer };
    if (req.body.note != null) patch.note = req.body.note;
    if (req.body.shippingFee != null) {
      patch.shippingFee = Number(req.body.shippingFee);
      patch.total = o.subtotal + patch.shippingFee;
    }
    return store.update('orders', o.id, patch);
  }));

  // ---- CRUD chung: sản phẩm, kiến thức, bài học ----
  const crud = (name, clean) => {
    r.get(`/${name}`, wrap(() => store.all(name)));
    r.post(`/${name}`, wrap((req) => {
      const doc = clean(req.body);
      if (name === 'products' && doc.id && store.get('products', doc.id)) throw new Error(`Mã ${doc.id} đã tồn tại`);
      return store.insert(name, doc);
    }));
    r.put(`/${name}/:id`, wrap((req) => must(store.update(name, req.params.id, clean(req.body, true)))));
    r.delete(`/${name}/:id`, wrap((req) => ({ ok: must(store.remove(name, req.params.id)) })));
  };

  crud('products', cleanProduct);
  crud('knowledge', (b, partial) => pick(b, ['question', 'answer', 'tags', 'status'], partial, { status: 'approved' }));
  crud('lessons', (b, partial) => pick(b, ['text', 'status'], partial, { status: 'active' }));

  r.post('/products/import', wrap((req) => {
    const items = Array.isArray(req.body.items) ? req.body.items : parseProductsCsv(String(req.body.csv || ''));
    let created = 0;
    let updated = 0;
    for (const raw of items) {
      const p = cleanProduct(raw);
      if (p.id && store.get('products', p.id)) {
        store.update('products', p.id, p);
        updated++;
      } else {
        store.insert('products', p);
        created++;
      }
    }
    return { created, updated };
  }));

  // ---- cài đặt & tự học ----
  r.get('/settings', wrap(() => store.settings));
  r.put('/settings', wrap((req) => store.updateSettings(req.body || {})));
  r.post('/learning/run', wrap(() => runLearningCycle({ llm: hub.llm, store, hooks: hub.learningHooks() })));

  return r;
}

function pick(body, keys, partial, defaults = {}) {
  const out = partial ? {} : { ...defaults };
  for (const k of keys) if (body[k] !== undefined) out[k] = body[k];
  return out;
}

export function cleanProduct(b) {
  const num = (v) => (v === '' || v == null ? undefined : Number(String(v).replace(/[^\d.]/g, '')));
  const p = {};
  if (b.id) p.id = String(b.id).trim().toUpperCase();
  for (const k of ['name', 'category', 'description']) if (b[k] !== undefined) p[k] = String(b[k]).trim();
  if (b.price !== undefined) p.price = num(b.price);
  if (b.salePrice !== undefined) p.salePrice = num(b.salePrice) ?? null;
  if (b.stock !== undefined) p.stock = num(b.stock) ?? null;
  if (b.active !== undefined) p.active = b.active !== false && b.active !== 'false';
  if (b.tags !== undefined) p.tags = Array.isArray(b.tags) ? b.tags : String(b.tags).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (b.images !== undefined) p.images = Array.isArray(b.images) ? b.images : String(b.images).split(/[\s,]+/).filter(Boolean);
  if (b.attributes !== undefined) p.attributes = typeof b.attributes === 'object' ? b.attributes : {};
  if (b.variants !== undefined) {
    p.variants = (Array.isArray(b.variants) ? b.variants : []).map((v) => ({ name: String(v.name), price: num(v.price) ?? null, stock: num(v.stock) ?? null }));
  }
  return p;
}
