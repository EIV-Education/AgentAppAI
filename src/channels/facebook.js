import crypto from 'node:crypto';
import { config } from '../config.js';
import { splitText, postJson } from './util.js';

// Facebook Messenger (Page). Webhook: GET để xác minh, POST nhận tin nhắn.

export function verifySignature(rawBody, header) {
  if (!config.facebook.appSecret) return true; // chưa cấu hình -> bỏ qua (chỉ nên dùng khi dev)
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.facebook.appSecret).update(rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Trả về danh sách tin nhắn văn bản khách gửi
export function parseWebhook(body) {
  const out = [];
  if (body?.object !== 'page') return out;
  for (const entry of body.entry || []) {
    for (const ev of entry.messaging || []) {
      if (ev.message?.is_echo) continue;
      const text = ev.message?.text || ev.postback?.title;
      const attachments = (ev.message?.attachments || []).map((a) => a.type);
      if (!text && !attachments.length) continue;
      out.push({
        externalId: ev.sender.id,
        text: text || `[Khách gửi ${attachments.join(', ')}]`,
        messageId: ev.message?.mid,
      });
    }
  }
  return out;
}

async function graph(path, body) {
  const url = `https://graph.facebook.com/${config.facebook.graphVersion}/${path}?access_token=${encodeURIComponent(config.facebook.pageToken)}`;
  return postJson(url, body);
}

export const facebook = {
  name: 'facebook',
  enabled: () => !!config.facebook.pageToken,
  async send(psid, text) {
    for (const part of splitText(text, 2000)) {
      await graph('me/messages', { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: part } });
    }
  },
  async typing(psid) {
    await graph('me/messages', { recipient: { id: psid }, sender_action: 'typing_on' }).catch(() => {});
  },
  async profileName(psid) {
    try {
      const res = await fetch(`https://graph.facebook.com/${config.facebook.graphVersion}/${psid}?fields=name&access_token=${encodeURIComponent(config.facebook.pageToken)}`);
      return (await res.json()).name || null;
    } catch {
      return null;
    }
  },
};
