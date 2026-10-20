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
  const got = header.replace(/^mac=/, '');
  if (got !== mac) console.warn(`[zalo] chữ ký nhận ${got.slice(0, 12)}… ≠ tính ra ${mac.slice(0, 12)}… (timestamp=${body?.timestamp})`);
  return got === mac;
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

  // Cấp quyền OAuth v4 (PKCE): chủ OA bấm đồng ý, Zalo trả code về callback, đổi lấy token và lưu lại
  const pending = new Map(); // state -> { verifier, exp }
  const redirectUri = () => `${config.publicUrl}/webhooks/zalo/oauth`;

  function authorizeUrl() {
    if (!config.zalo.appId || !config.zalo.secretKey) throw new Error('Cần điền ZALO_APP_ID và ZALO_APP_SECRET trong .env trước');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(12).toString('hex');
    pending.set(state, { verifier, exp: Date.now() + 15 * 60_000 });
    const q = new URLSearchParams({ app_id: config.zalo.appId, redirect_uri: redirectUri(), code_challenge: challenge, state });
    return `https://oauth.zaloapp.com/v4/oa/permission?${q}`;
  }

  async function handleCallback({ code, state, oa_id: oaId }) {
    const p = pending.get(state);
    pending.delete(state);
    if (!p || p.exp < Date.now()) throw new Error('Phiên cấp quyền đã hết hạn hoặc không hợp lệ, hãy bấm "Kết nối Zalo OA" lại.');
    if (!code) throw new Error('Zalo không trả về mã cấp quyền (có thể bạn đã bấm từ chối).');
    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', secret_key: config.zalo.secretKey },
      body: new URLSearchParams({ code, app_id: config.zalo.appId, grant_type: 'authorization_code', code_verifier: p.verifier }),
    });
    const data = await res.json();
    if (!data.access_token) throw new Error(`Đổi mã lấy token thất bại: ${JSON.stringify(data)}`);
    const t = tokens();
    Object.assign(t, { accessToken: data.access_token, refreshToken: data.refresh_token, oaId: oaId || t.oaId, connectedAt: new Date().toISOString() });
    store.save();
    return { oaId };
  }

  async function sendOnce(userId, text) {
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: tokens().accessToken },
      body: JSON.stringify({ recipient: { user_id: userId }, message: { text } }),
    });
    return res.json();
  }

  // Tên hiển thị Zalo của khách (cần quyền "quản lý thông tin người dùng" khi cấp quyền OA)
  async function profileName(userId) {
    const get = () => fetch(`https://openapi.zalo.me/v3.0/oa/user/detail?data=${encodeURIComponent(JSON.stringify({ user_id: String(userId) }))}`, {
      headers: { access_token: tokens().accessToken },
    }).then((r) => r.json());
    try {
      let data = await get();
      if (data.error === -216 || data.error === -124) { await refresh(); data = await get(); }
      return data.error === 0 ? data.data?.display_name || null : null;
    } catch {
      return null;
    }
  }

  return {
    name: 'zalo',
    profileName,
    enabled: () => !!tokens().accessToken,
    // Chủ shop: ID trong .env (ZALO_OWNER_IDS) hoặc được cấp quyền trên dashboard
    ownerIds: () => [...new Set([...config.zalo.ownerIds, ...(store.settings.zaloOwnerIds || [])])],
    isOwner: (userId) => config.zalo.ownerIds.includes(String(userId)) || (store.settings.zaloOwnerIds || []).includes(String(userId)),
    refresh,
    authorizeUrl,
    handleCallback,
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
