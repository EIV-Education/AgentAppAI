import { config } from '../config.js';
import { postJson, splitText } from './util.js';

// Lark/Feishu bot — chỉ dùng làm kênh điều khiển cho chủ shop.

export function parseEvent(body) {
  if (body?.type === 'url_verification') return { challenge: body.challenge, token: body.token };
  const token = body?.header?.token;
  if (body?.header?.event_type !== 'im.message.receive_v1') return { token, ignore: true };
  const msg = body.event?.message;
  if (msg?.message_type !== 'text') return { token, ignore: true };
  let text = '';
  try { text = JSON.parse(msg.content).text || ''; } catch { /* bỏ qua */ }
  return {
    token,
    eventId: body.header.event_id,
    chatId: msg.chat_id,
    senderId: body.event?.sender?.sender_id?.open_id,
    text: text.replace(/@_user_\d+/g, '').trim(),
  };
}

let cached = { token: null, exp: 0 };
async function tenantToken() {
  if (cached.token && Date.now() < cached.exp) return cached.token;
  const data = await postJson(`${config.lark.domain}/open-apis/auth/v3/tenant_access_token/internal`, {
    app_id: config.lark.appId, app_secret: config.lark.appSecret,
  });
  cached = { token: data.tenant_access_token, exp: Date.now() + (data.expire - 120) * 1000 };
  return cached.token;
}

export const lark = {
  name: 'lark',
  enabled: () => !!(config.lark.appId && config.lark.appSecret),
  isOwnerChat: (chatId) => config.lark.ownerChatIds.includes(chatId),
  async send(chatId, text) {
    const token = await tenantToken();
    for (const part of splitText(text, 4000)) {
      await postJson(`${config.lark.domain}/open-apis/im/v1/messages?receive_id_type=chat_id`,
        { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text: part }) },
        { authorization: `Bearer ${token}` });
    }
  },
};
