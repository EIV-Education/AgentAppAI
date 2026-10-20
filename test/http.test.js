import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { seededStore, fakeLLM, text } from './helpers.js';
import { config } from '../src/config.js';

async function boot(script = []) {
  const sent = [];
  const zalo = { name: 'zalo', enabled: () => true, isOwner: (id) => id === 'owner1', async send(id, t) { sent.push({ id, text: t }); } };
  const { app, hub, store } = createApp({ store: seededStore(), llm: fakeLLM(script), channels: { zalo }, notifier: null });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, hub, store, sent, close: () => server.close() };
}
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('Facebook webhook: xác minh, chỉ nhận tin của Trang đã bật, trả lời đúng Trang', async () => {
  const { createFacebook } = await import('../src/channels/facebook.js');
  const store = seededStore();
  store.data.integrations.facebook = { pages: {
    P1: { id: 'P1', name: 'EIV for Kids', token: 'tokP1', enabled: true },
    P2: { id: 'P2', name: 'Bếp Ăn Thiện Nguyện', token: 'tokP2', enabled: false },
  } };
  const facebook = createFacebook(store);
  const sent = [];
  facebook.send = async (psid, t, conv) => { sent.push({ psid, t, pageId: conv.pageId }); };
  facebook.profileName = async () => 'Trần Thu Hà';
  const llm = fakeLLM([text('Dạ chào chị')]);
  const { app } = createApp({ store, llm, channels: { facebook }, notifier: null });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const v = await fetch(`${base}/webhooks/facebook?hub.mode=subscribe&hub.verify_token=${config.facebook.verifyToken}&hub.challenge=123`);
    assert.equal(await v.text(), '123');
    assert.equal((await fetch(`${base}/webhooks/facebook?hub.mode=subscribe&hub.verify_token=sai&hub.challenge=1`)).status, 403);
    // Trang chưa bật -> bỏ qua
    await post(`${base}/webhooks/facebook`, { object: 'page', entry: [{ id: 'P2', messaging: [{ sender: { id: 'u9' }, recipient: { id: 'P2' }, message: { mid: 'm0', text: 'alo' } }] }] });
    // Trang đã bật -> AI trả lời bằng token của Trang đó
    const r = await post(`${base}/webhooks/facebook`, { object: 'page', entry: [{ id: 'P1', messaging: [{ sender: { id: 'psid7' }, recipient: { id: 'P1' }, message: { mid: 'm1', text: 'hello' } }] }] });
    assert.equal(r.status, 200);
    await wait();
    assert.equal(llm.calls.length, 1);
    const conv = store.find('conversations', (c) => c.externalId === 'psid7')[0];
    assert.equal(conv.pageName, 'EIV for Kids');
    assert.equal(conv.customerName, 'Trần Thu Hà');
    assert.deepEqual(sent, [{ psid: 'psid7', t: 'Dạ chào chị', pageId: 'P1' }]);
    assert.match(llm.calls[0].system.map((b) => b.text).join('\n'), /Trang "EIV for Kids"/);
    assert.equal(store.find('conversations', (c) => c.externalId === 'u9').length, 0);
  } finally { server.close(); }
});

test('Zalo webhook: khách nhắn -> AI; chủ shop gõ lệnh -> điều khiển', async () => {
  const t = await boot([text('Dạ shop chào chị')]);
  try {
    await post(`${t.base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: 'cus1' }, message: { text: 'chào shop', msg_id: 'z1' } });
    await wait();
    assert.equal(t.sent.at(-1).text, 'Dạ shop chào chị');
    await post(`${t.base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: 'owner1' }, message: { text: '/tamdung', msg_id: 'z2' } });
    await wait();
    assert.equal(t.store.settings.botPaused, true);
    assert.match(t.sent.at(-1).text, /TẠM DỪNG/);
    // Webhook gửi lặp không tạo tin trùng
    await post(`${t.base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: 'cus1' }, message: { text: 'chào shop', msg_id: 'z1' } });
    await wait();
    assert.equal(t.store.find('messages', (m) => m.externalMessageId === 'z1').length, 1);
  } finally { t.close(); }
});

test('Lark: trả challenge khi xác minh URL', async () => {
  const t = await boot();
  try {
    const r = await post(`${t.base}/webhooks/lark`, { type: 'url_verification', challenge: 'abc' });
    assert.deepEqual(await r.json(), { challenge: 'abc' });
  } finally { t.close(); }
});

test('Web chat + dashboard API', async () => {
  const t = await boot([text('Dạ áo thun 199.000đ ạ')]);
  try {
    const r = await post(`${t.base}/api/chat/sessiontest1/messages`, { text: 'giá áo thun?' });
    const d = await r.json();
    assert.equal(d.messages.at(-1).text, 'Dạ áo thun 199.000đ ạ');
    assert.equal(d.messages.at(-1).role, 'shop');

    assert.equal((await fetch(`${t.base}/api/admin/overview`)).status, 401);
    const auth = { authorization: `Bearer ${config.adminToken}` };
    const ov = await (await fetch(`${t.base}/api/admin/overview`, { headers: auth })).json();
    assert.equal(ov.byChannel.web, 1);
    const convs = await (await fetch(`${t.base}/api/admin/conversations`, { headers: auth })).json();
    const rep = await post(`${t.base}/api/admin/conversations/${convs[0].id}/reply`, { text: 'Chủ shop đây ạ', learn: false }, auth);
    assert.equal(rep.status, 200);
    const poll = await (await fetch(`${t.base}/api/chat/sessiontest1/messages`)).json();
    assert.equal(poll.messages.at(-1).text, 'Chủ shop đây ạ');

    const imp = await post(`${t.base}/api/admin/products/import`, { csv: 'id,name,price,stock\nNEW1,Mũ lưỡi trai,99000,10\nAT01,Áo thun nam cổ tròn Basic,209000,\n' }, auth);
    assert.deepEqual(await imp.json(), { created: 1, updated: 1 });
    assert.equal(t.store.get('products', 'AT01').price, 209000);
  } finally { t.close(); }
});

test('Zalo: người chưa có quyền gõ lệnh -> không đưa cho AI, chờ cấp quyền; cấp xong thì điều khiển được', async () => {
  const { createZalo } = await import('../src/channels/zalo.js');
  const store = seededStore();
  const sent = [];
  const zalo = createZalo(store);
  zalo.send = async (id, t) => { sent.push({ id, text: t }); };
  const llm = fakeLLM([text('Dạ em chào anh')]);
  const { app } = createApp({ store, llm, channels: { zalo }, notifier: null });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = { authorization: `Bearer ${config.adminToken}` };
  try {
    await post(`${base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: '999888777' }, message: { text: '/baocao', msg_id: 'a1' } });
    await wait();
    assert.match(sent.at(-1).text, /chưa có quyền/);
    assert.equal(llm.calls.length, 0);
    assert.equal(store.all('messages').length, 0);

    const owners = await (await fetch(`${base}/api/admin/zalo/owners`, { headers: auth })).json();
    assert.equal(owners.requests[0].id, '999888777');
    await post(`${base}/api/admin/zalo/owners`, { id: '999888777' }, auth);

    await post(`${base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: '999888777' }, message: { text: '/baocao', msg_id: 'a2' } });
    await wait();
    assert.match(sent.at(-1).text, /Hôm nay/);
    assert.equal((await (await fetch(`${base}/api/admin/zalo/owners`, { headers: auth })).json()).requests.length, 0);

    // Mã cảm xúc của Zalo (/-strong) từ khách vẫn là tin nhắn bình thường
    await post(`${base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: '111' }, message: { text: '/-strong', msg_id: 'a3' } });
    await wait();
    assert.equal(llm.calls.length, 1);
  } finally { server.close(); }
});

test('Zalo: lấy tên hiển thị của khách khi nhắn lần đầu', async () => {
  const { createZalo } = await import('../src/channels/zalo.js');
  const store = seededStore();
  const zalo = createZalo(store);
  zalo.enabled = () => true;
  zalo.send = async () => {};
  let calls = 0;
  zalo.profileName = async (id) => { calls++; return id === 'u55' ? 'Nguyễn Thị Lan' : null; };
  const { app } = createApp({ store, llm: fakeLLM([text('Dạ chào chị Lan'), text('Dạ')]), channels: { zalo }, notifier: null });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await post(`${base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: 'u55' }, message: { text: 'chào em', msg_id: 'n1' } });
    await wait();
    await post(`${base}/webhooks/zalo`, { event_name: 'user_send_text', sender: { id: 'u55' }, message: { text: 'cho chị hỏi', msg_id: 'n2' } });
    await wait();
    assert.equal(store.find('conversations', (c) => c.externalId === 'u55')[0].customerName, 'Nguyễn Thị Lan');
    assert.equal(calls, 1); // đã có tên thì không gọi lại
  } finally { server.close(); }
});
