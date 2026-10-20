import express from 'express';

// API cho widget chat trên website. Khách được nhận diện bằng sessionId ngẫu nhiên lưu ở trình duyệt.
export function webchatRoutes({ hub }) {
  const r = express.Router();
  const hits = new Map(); // giới hạn 20 tin/phút/phiên để chống spam

  const validSession = (s) => /^[a-zA-Z0-9_-]{8,64}$/.test(s || '');
  const publicMsgs = (convId, after) => hub.store
    .find('messages', (m) => m.conversationId === convId && m.role !== 'system' && (!after || m.createdAt > after))
    .map((m) => ({ id: m.id, role: m.role === 'customer' ? 'customer' : 'shop', text: m.text, at: m.createdAt }));

  r.get('/config', (req, res) => {
    const s = hub.store.settings.shop;
    res.json({ shopName: s.name, greeting: s.greeting || `Chào anh/chị 👋 ${s.name} có thể giúp gì ạ?` });
  });

  r.post('/:sessionId/messages', async (req, res) => {
    const { sessionId } = req.params;
    const text = String(req.body?.text || '').trim().slice(0, 2000);
    if (!validSession(sessionId) || !text) return res.status(400).json({ error: 'Thiếu nội dung' });

    const now = Date.now();
    const h = (hits.get(sessionId) || []).filter((t) => now - t < 60_000);
    if (h.length >= 20) return res.status(429).json({ error: 'Bạn gửi nhanh quá, vui lòng đợi chút' });
    h.push(now);
    hits.set(sessionId, h);

    const since = new Date(now - 1).toISOString();
    const result = await hub.receive({ channel: 'web', externalId: sessionId, text, customerName: req.body?.name?.slice(0, 80) });
    const convId = result?.conversation?.id;
    res.json({ messages: convId ? publicMsgs(convId, since) : [] });
  });

  r.get('/:sessionId/messages', (req, res) => {
    const { sessionId } = req.params;
    if (!validSession(sessionId)) return res.status(400).json({ error: 'Phiên không hợp lệ' });
    const conv = hub.store.find('conversations', (c) => c.channel === 'web' && c.externalId === sessionId)[0];
    res.json({ messages: conv ? publicMsgs(conv.id, req.query.after) : [] });
  });

  return r;
}
