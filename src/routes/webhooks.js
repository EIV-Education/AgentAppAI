import express from 'express';
import { config } from '../config.js';
import * as fb from '../channels/facebook.js';
import * as zl from '../channels/zalo.js';
import { parseEvent as parseLark } from '../channels/lark.js';
import { handleCommand, isCommand } from '../control/commands.js';

// Webhook của Facebook, Zalo OA và Lark. Luôn trả 200 ngay rồi xử lý nền để nền tảng không gửi lại.
export function webhookRoutes({ hub, zalo, lark, facebook }) {
  const r = express.Router();
  const seenLark = new Set();
  const runCmd = (text, by) => handleCommand(hub, text, { by, minutes: config.humanTakeoverMinutes });

  // ---- Facebook ----
  r.get('/facebook', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.facebook.verifyToken) {
      return res.status(200).send(req.query['hub.challenge']);
    }
    res.sendStatus(403);
  });

  r.post('/facebook', (req, res) => {
    if (!fb.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) {
      console.warn('[facebook] sai chữ ký webhook — kiểm tra FB_APP_SECRET');
      return res.sendStatus(401);
    }
    res.sendStatus(200);
    for (const m of fb.parseWebhook(req.body)) {
      (async () => {
        if (facebook.isActive && !facebook.isActive(m.pageId)) return; // Trang chưa bật trợ lý
        const known = hub.store.find('conversations', (c) => c.channel === 'facebook' && c.externalId === m.externalId)[0];
        const name = known?.customerName || (facebook.enabled() ? await facebook.profileName(m.externalId, m.pageId) : null);
        await hub.receive({ channel: 'facebook', ...m, customerName: name, pageName: facebook.pageName?.(m.pageId) || null });
      })().catch((err) => console.error('[facebook]', err));
    }
  });

  // Facebook chuyển về đây sau khi chủ Trang đăng nhập và cho phép (Valid OAuth Redirect URI)
  r.get('/facebook/oauth', async (req, res) => {
    const page = (ok, msg) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Facebook</title><body style="font:16px system-ui;max-width:560px;margin:60px auto;padding:0 16px"><h2>${ok ? '✅ Đã kết nối Facebook' : '❌ Chưa kết nối được'}</h2><p>${msg.replace(/</g, '&lt;')}</p><p><a href="/">Quay lại dashboard</a></p></body>`);
    try {
      const { count } = await facebook.handleCallback(req.query);
      page(true, `Đã đọc ${count} Trang bạn quản lý. Quay lại dashboard → Cài đặt → Trang Facebook để bật trợ lý cho từng Trang.`);
    } catch (err) {
      console.warn('[facebook] kết nối lỗi:', err.message);
      page(false, err.message);
    }
  });

  // ---- Zalo OA ----
  // Zalo có thể gọi thử URL khi khai báo webhook: trả 200 để xác nhận địa chỉ đang hoạt động
  r.get('/zalo', (req, res) => res.sendStatus(200));

  // Zalo chuyển về đây sau khi chủ OA đồng ý cấp quyền (Official Account Callback Url)
  r.get('/zalo/oauth', async (req, res) => {
    const page = (ok, msg) => res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kết nối Zalo OA</title><body style="font:16px system-ui;max-width:560px;margin:60px auto;padding:0 16px"><h2>${ok ? '✅ Đã kết nối Zalo OA' : '❌ Chưa kết nối được'}</h2><p>${msg.replace(/</g, '&lt;')}</p><p><a href="/">Quay lại dashboard</a></p></body>`);
    try {
      const { oaId } = await zalo.handleCallback(req.query);
      page(true, `Trợ lý đã nhận token của OA${oaId ? ` ${oaId}` : ''} và sẽ tự gia hạn. Bước tiếp theo: dùng Zalo cá nhân nhắn /id cho OA.`);
    } catch (err) {
      console.warn('[zalo] cấp quyền lỗi:', err.message);
      page(false, err.message);
    }
  });

  r.post('/zalo', (req, res) => {
    if (!zl.verifySignature(req.rawBody?.toString('utf8'), req.get('x-zevent-signature'), req.body)) {
      console.warn('[zalo] sai chữ ký webhook — kiểm tra ZALO_APP_ID, ZALO_OA_SECRET_KEY');
      return res.sendStatus(401);
    }
    res.sendStatus(200);
    for (const m of zl.parseWebhook(req.body)) {
      (async () => {
        const text = m.text.trim();
        if (text === '/id') return zalo.send(m.externalId, `ID Zalo của bạn với OA: ${m.externalId}`);
        if (zalo.isOwner(m.externalId) && text.startsWith('/')) {
          const reply = await runCmd(text, `zalo:${m.externalId}`);
          return zalo.send(m.externalId, reply);
        }
        // Gõ lệnh nhưng chưa có quyền: không đưa cho AI, ghi lại để chủ shop cấp quyền trên dashboard
        if (isCommand(text)) {
          const reqs = (hub.store.data.integrations.zaloOwnerRequests ||= []);
          if (!reqs.some((r) => r.id === m.externalId)) reqs.push({ id: m.externalId, text, at: new Date().toISOString() });
          hub.store.save();
          return zalo.send(m.externalId, `Tài khoản Zalo này chưa có quyền điều khiển trợ lý (mã ${m.externalId}). Vào dashboard → Cài đặt → "Quyền điều khiển qua Zalo" để cấp quyền.`);
        }
        const known = hub.store.find('conversations', (c) => c.channel === 'zalo' && c.externalId === String(m.externalId))[0];
        const name = known?.customerName || (zalo.enabled() && zalo.profileName ? await zalo.profileName(m.externalId) : null);
        await hub.receive({ channel: 'zalo', ...m, customerName: name });
      })().catch((err) => console.error('[zalo]', err));
    }
  });

  // ---- Lark (kênh điều khiển) ----
  r.post('/lark', (req, res) => {
    const ev = parseLark(req.body);
    if (config.lark.verificationToken && ev.token !== config.lark.verificationToken) {
      console.warn('[lark] sai Verification Token — kiểm tra LARK_VERIFICATION_TOKEN, và tắt Encrypt Key');
      return res.sendStatus(401);
    }
    if (ev.challenge) return res.json({ challenge: ev.challenge });
    res.json({ ok: true });
    if (ev.ignore || !ev.text) return;
    if (ev.eventId) {
      if (seenLark.has(ev.eventId)) return;
      seenLark.add(ev.eventId);
      if (seenLark.size > 1000) seenLark.delete(seenLark.values().next().value);
    }
    (async () => {
      if (!lark.isOwnerChat(ev.chatId)) {
        return lark.send(ev.chatId, `Chat này chưa được cấp quyền điều khiển. Thêm chat ID sau vào LARK_OWNER_CHAT_IDS: ${ev.chatId}`);
      }
      const text = ev.text.startsWith('/') ? ev.text : `/${ev.text}`;
      await lark.send(ev.chatId, await runCmd(text, `lark:${ev.senderId}`));
    })().catch((err) => console.error('[lark]', err));
  });

  return r;
}
