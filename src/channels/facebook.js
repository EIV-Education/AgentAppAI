import crypto from 'node:crypto';
import { config } from '../config.js';
import { splitText } from './util.js';

// Facebook Messenger, nhiều Trang. Chủ trang bấm "Kết nối Facebook" (Facebook Login) -> lấy token từng Trang,
// chọn Trang nào bật trợ lý -> đăng ký nhận tin nhắn (subscribed_apps) cho Trang đó.

export function verifySignature(rawBody, header) {
  if (!config.facebook.appSecret) return true; // chưa cấu hình -> bỏ qua (chỉ nên dùng khi dev)
  if (!header?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', config.facebook.appSecret).update(rawBody).digest('hex');
  const got = header.slice(7);
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

// Trả về danh sách tin nhắn khách gửi, kèm Trang nhận tin (entry.id)
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
        pageId: String(ev.recipient?.id || entry.id),
        text: text || `[Khách gửi ${attachments.join(', ')}]`,
        messageId: ev.message?.mid,
      });
    }
  }
  return out;
}

const SCOPES = ['pages_show_list', 'pages_messaging', 'pages_manage_metadata', 'pages_read_engagement'];
const SUB_FIELDS = 'messages,messaging_postbacks';

export function createFacebook(store) {
  const G = () => `https://graph.facebook.com/${config.facebook.graphVersion}`;
  const state = () => (store.data.integrations.facebook ||= { pages: {} });
  const pages = () => state().pages;
  const pending = new Map(); // state -> hết hạn
  const redirectUri = () => `${config.publicUrl}/webhooks/facebook/oauth`;

  async function call(method, path, params = {}, body) {
    const q = new URLSearchParams(params);
    const res = await fetch(`${G()}/${path}${q.toString() ? `?${q}` : ''}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(`Facebook lỗi ${data.error?.code ?? res.status}: ${data.error?.message || res.statusText}`);
    return data;
  }

  // Token gửi tin cho một Trang: Trang đã kết nối, hoặc token cũ trong .env (một Trang)
  const tokenFor = (pageId) => pages()[pageId]?.token || config.facebook.pageToken;
  const isActive = (pageId) => {
    const ps = pages();
    if (!Object.keys(ps).length) return !!config.facebook.pageToken; // cách cũ: một Trang qua .env
    return !!ps[pageId]?.enabled;
  };

  function authorizeUrl() {
    if (!config.facebook.appId || !config.facebook.appSecret) throw new Error('Cần điền FB_APP_ID và FB_APP_SECRET trong .env trước');
    const st = crypto.randomBytes(12).toString('hex');
    pending.set(st, Date.now() + 15 * 60_000);
    const q = new URLSearchParams({ client_id: config.facebook.appId, redirect_uri: redirectUri(), state: st, scope: SCOPES.join(','), response_type: 'code' });
    return `https://www.facebook.com/${config.facebook.graphVersion}/dialog/oauth?${q}`;
  }

  async function handleCallback({ code, state: st, error_description: errDesc }) {
    const exp = pending.get(st);
    pending.delete(st);
    if (!exp || exp < Date.now()) throw new Error('Phiên kết nối đã hết hạn hoặc không hợp lệ, hãy bấm "Kết nối Facebook" lại.');
    if (!code) throw new Error(errDesc || 'Facebook không trả về mã cấp quyền (có thể bạn đã bấm huỷ).');
    const app = { client_id: config.facebook.appId, client_secret: config.facebook.appSecret };
    const short = await call('GET', 'oauth/access_token', { ...app, redirect_uri: redirectUri(), code });
    // Đổi sang token dài hạn để token Trang không hết hạn
    const long = await call('GET', 'oauth/access_token', { ...app, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token });
    const list = await call('GET', 'me/accounts', { fields: 'id,name,access_token,tasks', limit: '100', access_token: long.access_token });
    const ps = pages();
    for (const p of list.data || []) {
      ps[p.id] = { ...(ps[p.id] || { enabled: false }), id: p.id, name: p.name, token: p.access_token, canMessage: (p.tasks || []).includes('MESSAGING') || !p.tasks };
    }
    state().connectedAt = new Date().toISOString();
    store.save();
    // Trang đang bật thì đăng ký lại bằng token mới
    for (const p of Object.values(ps)) if (p.enabled) await subscribe(p.id, true).catch(() => {});
    return { count: (list.data || []).length };
  }

  async function subscribe(pageId, on) {
    const p = pages()[pageId];
    if (!p) throw new Error('Trang chưa được kết nối');
    if (on) await call('POST', `${pageId}/subscribed_apps`, { subscribed_fields: SUB_FIELDS, access_token: p.token });
    else await call('DELETE', `${pageId}/subscribed_apps`, { access_token: p.token });
  }

  async function setPageEnabled(pageId, on) {
    await subscribe(pageId, on);
    pages()[pageId].enabled = !!on;
    store.save();
    return pages()[pageId];
  }

  const send = async (psid, text, conv) => {
    const token = tokenFor(conv?.pageId);
    if (!token) throw new Error(`Chưa có token cho Trang ${conv?.pageId || ''}`);
    for (const part of splitText(text, 2000)) {
      await call('POST', 'me/messages', { access_token: token }, { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: part } });
    }
  };

  return {
    name: 'facebook',
    enabled: () => !!config.facebook.pageToken || Object.values(pages()).some((p) => p.enabled),
    isActive,
    pageName: (pageId) => pages()[pageId]?.name || null,
    listPages: () => Object.values(pages()).map(({ token, ...p }) => p),
    authorizeUrl,
    handleCallback,
    setPageEnabled,
    send,
    async typing(psid, conv) {
      const token = tokenFor(conv?.pageId);
      if (token) await call('POST', 'me/messages', { access_token: token }, { recipient: { id: psid }, sender_action: 'typing_on' }).catch(() => {});
    },
    async profileName(psid, pageId) {
      try {
        const data = await call('GET', psid, { fields: 'name', access_token: tokenFor(pageId) });
        return data.name || null;
      } catch (err) {
        console.warn(`[facebook] không lấy được tên ${psid}:`, err.message);
        return null;
      }
    },
  };
}
