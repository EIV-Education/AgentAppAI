import express from 'express';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { handleCommand } from '../control/commands.js';
import { addLessonFromFeedback, rateConversation, runLearningCycle, learnExamplesFromConversation, learnFromTranscript } from '../agent/learning.js';
import { parseProductsCsv } from '../importers.js';
import { listProfiles, loadProfile, applyProfile } from '../profiles.js';
import { LEAD_ATTRS, guessMap } from '../crm.js';

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
    // x-accel-buffering: nginx phía trước (aaPanel, reverse proxy) không đệm luồng này
    res.set({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
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
      salesMode: store.settings.salesMode,
      leads: store.all('leads').length,
      newLeads: store.find('leads', (l) => l.status === 'new').length,
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
        zaloOwners: hub.channels.zalo?.ownerIds ? hub.channels.zalo.ownerIds().length : config.zalo.ownerIds.length,
        ai: !!hub.llm,
      },
      setup: {
        publicUrl: config.publicUrl,
        fbVerifyToken: config.facebook.verifyToken,
        larkChats: config.lark.ownerChatIds.length,
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
      aiOffReason: hub.aiOffReason(conv),
    };
  }));

  r.post('/conversations/:id/reply', wrap(async (req) => {
    const text = String(req.body.text || '').trim();
    if (!text) throw new Error('Nội dung trống');
    return hub.humanReply(req.params.id, text, { by: 'dashboard', learn: req.body.learn !== false });
  }));
  r.post('/conversations/:id/handover', wrap((req) => must(hub.setHandover(req.params.id, !!req.body.on))));
  r.post('/conversations/:id/refresh-name', wrap(async (req) => {
    const conv = must(store.get('conversations', req.params.id));
    const ch = hub.channels[conv.channel];
    if (!ch?.profileName) throw new Error('Kênh này không có tên hiển thị (web chat)');
    const name = await ch.profileName(conv.externalId);
    if (!name) throw new Error(ch.lastProfileError?.() || 'Không lấy được tên từ nền tảng');
    return hub.setCustomerName(conv.id, name);
  }));
  // Cho AI trả lời ngay tin khách đang chờ (sau khi bật lại AI)
  r.post('/conversations/:id/ai-reply', wrap(async (req) => {
    const conv = must(store.get('conversations', req.params.id));
    const reason = hub.aiOffReason(conv);
    if (reason) throw new Error(reason);
    const r = await hub.schedule(conv.id);
    return { replied: !!r?.replied };
  }));
  r.post('/conversations/:id/resolve', wrap((req) => must(store.update('conversations', req.params.id, { needsHuman: false }))));
  r.post('/conversations/:id/grade', wrap(async (req) => {
    if (!hub.llm) throw new Error('Chưa cấu hình ANTHROPIC_API_KEY');
    return (await hub.grade(req.params.id, {})) || { error: 'Chưa có câu trả lời AI để chấm' };
  }));
  r.post('/conversations/:id/rate', wrap((req) => {
    const conv = must(rateConversation(store, req.params.id, req.body));
    // Chủ shop chấm 4-5 sao -> học cách nói chuyện từ hội thoại này
    if (Number(req.body.rating) >= 4 && store.settings.learning.autoLearnExamples) {
      learnExamplesFromConversation({ llm: hub.llm, store, conversationId: conv.id, score: conv.grade?.score })
        .catch((err) => console.warn('[learning]', err.message));
    }
    return conv;
  }));
  r.post('/conversations/:id/teach', wrap((req) => addLessonFromFeedback({
    llm: hub.llm, store, conversationId: req.params.id, feedback: must(String(req.body.feedback || '').trim(), 'Góp ý trống'),
  })));

  r.post('/command', wrap(async (req) => ({ reply: await handleCommand(hub, String(req.body.text || ''), { by: 'dashboard', minutes: config.humanTakeoverMinutes }) })));

  // ---- khách tiềm năng ----
  r.get('/leads', wrap((req) => {
    const list = req.query.status ? store.find('leads', (l) => l.status === req.query.status) : [...store.all('leads')];
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }));
  r.put('/leads/:id', wrap((req) => {
    const patch = {};
    if (['new', 'contacted', 'won', 'lost'].includes(req.body.status)) patch.status = req.body.status;
    if (req.body.note != null) patch.note = String(req.body.note);
    for (const k of ['contactName', 'organization', 'segment', 'phone', 'email', 'area', 'address', 'needs']) if (req.body[k] != null) patch[k] = String(req.body[k]).trim();
    if (patch.status === 'contacted') Object.assign(patch, { contactedAt: new Date().toISOString(), contactedBy: 'dashboard' });
    const lead = must(store.update('leads', req.params.id, patch));
    hub.syncLead(lead);
    return lead;
  }));
  // Nhân viên tự nhập khách sau khi tư vấn (gọi điện, gặp trực tiếp...)
  r.post('/leads', wrap((req) => {
    const b = req.body || {};
    const phone = String(b.phone || '').replace(/[\s.()-]/g, '');
    if (!/^(0|\+84)\d{9,10}$/.test(phone)) throw new Error('Số điện thoại chưa hợp lệ');
    if (!String(b.contactName || '').trim()) throw new Error('Thiếu tên khách hàng');
    const lead = store.insert('leads', {
      status: 'new', channel: 'manual', conversationId: null, segment: b.segment || 'other',
      contactName: String(b.contactName).trim(), organization: b.organization || '', phone, email: b.email || '', address: b.address || '', area: b.area || '', needs: b.needs || '', note: b.note || '',
    });
    hub.onLead(lead);
    return lead;
  }));
  r.post('/leads/:id/crm', wrap(async (req) => {
    if (!hub.crm?.enabled()) throw new Error('Chưa bật CRM: Cài đặt → CRM Lark Base → tick "Bật tự động đẩy khách lên CRM" → Lưu CRM');
    const lead = must(store.get('leads', req.params.id));
    return (await hub.crm.sync(lead)) || must(null, store.get('leads', lead.id).crmError || 'Gửi CRM thất bại');
  }));

  r.post('/crm/push-all', wrap(async () => {
    if (!hub.crm?.enabled()) throw new Error('Chưa bật CRM (Cài đặt → CRM Lark Base)');
    let ok = 0;
    let fail = 0;
    for (const l of store.find('leads', (x) => !x.crmRecordId)) ((await hub.crm.sync(l)) ? ok++ : fail++);
    return { ok, fail };
  }));

  // ---- CRM Lark Base ----
  r.post('/crm/fields', wrap(async (req) => {
    if (!hub.crm) throw new Error('CRM chưa sẵn sàng');
    const fields = await hub.crm.listFields(req.body.baseUrl);
    return { fields, attrs: LEAD_ATTRS, guess: guessMap(fields) };
  }));
  r.delete('/leads/:id', wrap((req) => ({ ok: must(store.remove('leads', req.params.id)) })));

  // ---- quyền điều khiển qua Zalo ----
  r.get('/zalo/owners', wrap(() => ({
    fromEnv: config.zalo.ownerIds,
    fromDashboard: store.settings.zaloOwnerIds || [],
    requests: (store.data.integrations.zaloOwnerRequests || []).filter((q) => !hub.channels.zalo?.isOwner?.(q.id)),
  })));
  r.post('/zalo/owners', wrap((req) => {
    const id = String(req.body.id || '').trim();
    if (!/^\d{5,30}$/.test(id)) throw new Error('ID Zalo không hợp lệ');
    const cur = new Set(store.settings.zaloOwnerIds || []);
    if (req.body.remove) cur.delete(id); else cur.add(id);
    store.updateSettings({ zaloOwnerIds: [...cur] });
    store.data.integrations.zaloOwnerRequests = (store.data.integrations.zaloOwnerRequests || []).filter((q) => q.id !== id);
    store.save();
    return { ok: true, zaloOwnerIds: [...cur] };
  }));

  // ---- Trang Facebook ----
  r.get('/facebook/connect', wrap((req, res) => res.redirect(hub.channels.facebook.authorizeUrl())));
  r.get('/facebook/pages', wrap(() => (hub.channels.facebook.listPages ? hub.channels.facebook.listPages() : [])));
  r.post('/facebook/pages/:id', wrap((req) => hub.channels.facebook.setPageEnabled(req.params.id, !!req.body.enabled)));

  // ---- kết nối Zalo OA (OAuth) ----
  r.get('/zalo/connect', wrap((req, res) => res.redirect(hub.channels.zalo.authorizeUrl())));

  // ---- gói dữ liệu dựng sẵn ----
  r.get('/profiles', wrap(() => listProfiles()));
  r.post('/profiles/:id/apply', wrap((req) => applyProfile(store, loadProfile(req.params.id))));

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
  crud('examples', (b, partial) => pick(b, ['customer', 'reply', 'lesson', 'status'], partial, { status: 'active', source: 'manual', fromHuman: true }));
  r.post('/learn/transcript', wrap((req) => learnFromTranscript({ llm: hub.llm, store, text: req.body.text || '' })));

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
  r.put('/settings', wrap((req) => {
    store.updateSettings(req.body || {});
    // Bảng ghép cột CRM thay thế toàn bộ (để bỏ được cột đã chọn trước đó)
    if (req.body?.crm?.fieldMap) { store.data.settings.crm.fieldMap = req.body.crm.fieldMap; store.save(); }
    return store.settings;
  }));
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
