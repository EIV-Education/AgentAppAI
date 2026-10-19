import crypto from 'node:crypto';
import { config } from '../config.js';
import { splitText } from './util.js';

// Zalo Official Account (API v3). Lưu ý: OA chỉ gửi được tin "tư vấn" (cs) cho người dùng
// đã tương tác với OA trong vòng 7 ngày — áp dụng cả khi gửi thông báo cho chủ shop.

export function verifySignature(rawBody, header, body) {
  if (!config.zalo.oaSecretKey) return true;
  if (!header) return false;
  const mac = crypto.createHash('sha256')
    .update(`${config.zalo.appId}${rawBody}${body?.timestamp ?? ''}${config.zalo.oaSecretKey}`)
    .digest('hex');
  return header.replace(/^mac=/, '') === mac;
}

export function parseWebhook(body) {
  if (!body?.event_name?.startsWith('user_send_')) return [];
  const text = body.message?.text
    || (body.event_name === 'user_send_image' ? '[Khách gửi ảnh]' : `[Khách gửi ${body.event_name.replace('user_send_', '')}]`);
  return [{ externalId: body.sender?.id, text, messageId: body.message?.msg_id }];
}

export function createZalo(store) {
  // Token mới nhất (sau khi tự làm mới) lưu trong db; khi anh dán token khác vào .env thì dùng token .env
  const tokens = () => {
    const t = (store.data.integrations.zalo ||= {});
    if (config.zalo.accessToken && t.seededFrom !== config.zalo.accessToken) {
      Object.assign(t, { accessToken: config.zalo.accessToken, refreshToken: config.zalo.refreshToken, seededFrom: config.zalo.accessToken });
      store.save();
    }
    return t;
  };

  async function refresh() {
    const t = tokens();
    if (!t.refreshToken) throw new Error('Thiếu ZALO_OA_REFRESH_TOKEN');
    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', secret_key: config.zalo.secretKey },
      body: new URLSearchParams({ refresh_token: t.refreshToken, app_id: config.zalo.appId, grant_type: 'refresh_token' }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`Làm mới token Zalo thất bại: ${JSON.stringify(data)}`);
    Object.assign(t, { accessToken: data.access_token, refreshToken: data.refresh_token, refreshedAt: new Date().toISOString() });
    store.save();
  }

  async function sendOnce(userId, text) {
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: tokens().accessToken },
      body: JSON.stringify({ recipient: { user_id: userId }, message: { text } }),
    });
    return res.json();
  }

  return {
    name: 'zalo',
    enabled: () => !!tokens().accessToken,
    isOwner: (userId) => config.zalo.ownerIds.includes(String(userId)),
    refresh,
    async send(userId, text) {
      for (const part of splitText(text, 2000)) {
        let data = await sendOnce(userId, part);
        if (data.error === -216 || data.error === -124) { // token hết hạn/không hợp lệ
          await refresh();
          data = await sendOnce(userId, part);
        }
        if (data.error && data.error !== 0) throw new Error(`Zalo gửi lỗi ${data.error}: ${data.message}`);
      }
    },
  };
}
