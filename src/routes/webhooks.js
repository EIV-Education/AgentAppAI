import express from 'express';
import { config } from '../config.js';
import * as fb from '../channels/facebook.js';
import * as zl from '../channels/zalo.js';
import { parseEvent as parseLark } from '../channels/lark.js';
import { handleCommand } from '../control/commands.js';

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
    if (!fb.verifySignature(req.rawBody, req.get('x-hub-signature-256'))) return res.sendStatus(401);
    res.sendStatus(200);
    for (const m of fb.parseWebhook(req.body)) {
      (async () => {
        const known = hub.store.find('conversations', (c) => c.channel === 'facebook' && c.externalId === m.externalId)[0];
        const name = known?.customerName || (facebook.enabled() ? await facebook.profileName(m.externalId) : null);
        await hub.receive({ channel: 'facebook', ...m, customerName: name });
      })().catch((err) => console.error('[facebook]', err));
    }
  });

  // ---- Zalo OA ----
  r.post('/zalo', (req, res) => {
    if (!zl.verifySignature(req.rawBody?.toString('utf8'), req.get('x-zevent-signature'), req.body)) return res.sendStatus(401);
    res.sendStatus(200);
    for (const m of zl.parseWebhook(req.body)) {
      (async () => {
        const text = m.text.trim();
        if (text === '/id') return zalo.send(m.externalId, `ID Zalo của bạn với OA: ${m.externalId}`);
        if (zalo.isOwner(m.externalId) && text.startsWith('/')) {
          const reply = await runCmd(text, `zalo:${m.externalId}`);
          return zalo.send(m.externalId, reply);
        }
        await hub.receive({ channel: 'zalo', ...m });
      })().catch((err) => console.error('[zalo]', err));
    }
  });

  // ---- Lark (kênh điều khiển) ----
  r.post('/lark', (req, res) => {
    const ev = parseLark(req.body);
    if (config.lark.verificationToken && ev.token !== config.lark.verificationToken) return res.sendStatus(401);
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
