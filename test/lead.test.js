import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHub, text, tool } from './helpers.js';
import { runTool } from '../src/agent/tools.js';
import { handleCommand } from '../src/control/commands.js';
import { applyProfile, loadProfile, listProfiles } from '../src/profiles.js';

function eivHub(script = []) {
  const h = makeHub(script);
  applyProfile(h.store, loadProfile('eiv'));
  return h;
}

test('gói EIV: thay catalog mẫu, bật chế độ khách tiềm năng, giữ kiến thức chủ shop tự dạy', () => {
  const h = makeHub();
  h.store.insert('knowledge', { question: 'Có xuất VAT không?', answer: 'Có', status: 'approved', source: 'owner_reply' });
  assert.ok(listProfiles().some((p) => p.id === 'eiv'));
  const r = applyProfile(h.store, loadProfile('eiv'));
  assert.equal(r.products, 4);
  assert.equal(h.store.settings.salesMode, 'lead');
  assert.equal(h.store.get('products', 'AT01'), null); // áo thun mẫu đã bị thay
  assert.ok(h.store.get('products', 'KIDS-1KEM1'));
  assert.equal(h.store.settings.policies.shipping, ''); // chính sách ship mẫu đã bị xoá
  assert.ok(h.store.find('knowledge', (k) => k.source === 'owner_reply').length === 1);
  assert.equal(h.store.find('knowledge', (k) => k.source === 'seed').length, 0);
});

test('chế độ khách tiềm năng: không có công cụ đơn nháp/phí ship, prompt có kịch bản và cấm báo giá', async () => {
  const { hub, llm } = eivHub([text('Dạ em chào anh(chị) ạ')]);
  await hub.receive({ channel: 'zalo', externalId: 'z1', text: 'chào em' });
  const names = llm.calls[0].tools.map((t) => t.name);
  assert.ok(names.includes('create_lead'));
  assert.ok(!names.includes('create_draft_order'));
  assert.ok(!names.includes('calculate_shipping'));
  const sys = llm.calls[0].system.map((b) => b.text).join('\n');
  assert.match(sys, /KHÔNG báo học phí/);
  assert.match(sys, /Giải pháp giáo viên nước ngoài cho trường học\/trung tâm/);
  assert.match(sys, /không tự đưa số điện thoại/); // chưa có hotline
});

test('create_lead: kiểm tra SĐT/email, báo chủ shop, gọi lại cùng SĐT thì bổ sung', async () => {
  const { hub, store, notes } = eivHub();
  const conv = hub.getOrCreateConversation('facebook', 'p1', 'Chị Lan');
  const ctx = { store, conversation: conv, hooks: { onLead: (l) => hub.onLead(l) } };
  assert.match((await runTool('create_lead', { segment: 'kids', phone: '12345', needs: 'bé 6 tuổi' }, ctx)).error, /điện thoại/);
  assert.match((await runTool('create_lead', { segment: 'kids', phone: '0912345678', email: 'abc', needs: 'x' }, ctx)).error, /Email/);

  const r = await runTool('create_lead', { segment: 'kids', phone: '0912 345 678', needs: 'Bé 6 tuổi, muốn tăng phản xạ, học online', area: 'Hà Nội' }, ctx);
  const lead = store.get('leads', r.lead_id);
  assert.equal(lead.phone, '0912345678');
  assert.equal(lead.contactName, 'Chị Lan');
  assert.match(notes.at(-1), /Khách tiềm năng KH1/);
  assert.match(notes.at(-1), /Cá nhân – Trẻ em/);

  await runTool('create_lead', { segment: 'kids', phone: '0912345678', needs: '', email: 'lan@gmail.com' }, ctx);
  assert.equal(store.all('leads').length, 1);
  assert.equal(store.get('leads', lead.id).email, 'lan@gmail.com');
  assert.match(store.get('leads', lead.id).needs, /6 tuổi/); // không bị ghi đè bằng rỗng
  assert.equal(notes.filter((n) => /Khách tiềm năng/.test(n)).length, 1);
});

test('/lead liệt kê khách mới, /lienhe đánh dấu đã liên hệ', async () => {
  const { hub, store } = eivHub();
  const conv = hub.getOrCreateConversation('web', 'sess1234567');
  await runTool('create_lead', { segment: 'business', phone: '0987654321', needs: 'Công ty logistics, 30 nhân sự', area: 'HCM' }, { store, conversation: conv, hooks: {} });
  assert.match(await handleCommand(hub, '/lead'), /0987654321/);
  assert.match(await handleCommand(hub, '/lienhe kh1'), /đã liên hệ/);
  assert.equal(store.get('leads', 'KH1').status, 'contacted');
  assert.match(await handleCommand(hub, '/lead'), /Không có/);
});

test('nhắn nhắc khách im lặng: đúng 1 lần, sau thời gian cấu hình, bỏ qua khách đã để SĐT', async () => {
  const { hub, store, sent } = eivHub([text('Dạ bé nhà mình mấy tuổi ạ?'), text('Dạ anh/chị cần gì ạ?')]);
  const a = await hub.receive({ channel: 'facebook', externalId: 'p1', text: 'tư vấn cho bé' });
  const b = await hub.receive({ channel: 'zalo', externalId: 'z1', text: 'xin chào' });
  await runTool('create_lead', { segment: 'other', phone: '0911111111', needs: 'x' }, { store, conversation: b.conversation, hooks: {} });

  const now = Date.now();
  assert.equal(await hub.runFollowUps(now + 30 * 60_000), 0); // chưa đủ 60 phút
  assert.equal(await hub.runFollowUps(now + 61 * 60_000), 1);
  assert.match(sent.at(-1).text, /EIV đang đợi phản hồi/);
  assert.equal(sent.at(-1).id, 'p1');
  assert.equal(await hub.runFollowUps(now + 120 * 60_000), 0); // không nhắc lần 2
  assert.equal(await hub.runFollowUps(now + 25 * 3600_000), 0);
  assert.ok(a.conversation);
});

test('chế độ bán hàng vẫn giữ công cụ đơn nháp và có thêm create_lead', async () => {
  const { hub, llm } = makeHub([text('ok')]);
  await hub.receive({ channel: 'web', externalId: 'sessxyz123', text: 'hi' });
  const names = llm.calls[0].tools.map((t) => t.name);
  assert.ok(names.includes('create_draft_order') && names.includes('create_lead'));
});

test('tắt AI riêng kênh Zalo: tin vẫn lưu, AI không trả lời; lệnh chủ shop vẫn chạy', async () => {
  const { hub, llm, store } = makeHub([text('web ok')]);
  store.updateSettings({ aiChannels: { zalo: false } });
  const r = await hub.receive({ channel: 'zalo', externalId: 'z1', text: 'alo' });
  assert.equal(r.replied, false);
  assert.equal(llm.calls.length, 0);
  assert.equal(store.find('messages', (m) => m.conversationId === r.conversation.id).length, 1);
  assert.match(await handleCommand(hub, '/baocao'), /Hôm nay/);
  const w = await hub.receive({ channel: 'web', externalId: 'sessweb12345', text: 'hi' });
  assert.equal(w.replied, true);
});

test('Zalo OAuth: tạo link có PKCE, callback đổi code lấy token và lưu lại', async () => {
  const crypto = await import('node:crypto');
  const { config } = await import('../src/config.js');
  const { createZalo } = await import('../src/channels/zalo.js');
  const { Store } = await import('../src/db.js');
  const old = { ...config.zalo };
  Object.assign(config.zalo, { appId: '111', secretKey: 'sec', accessToken: '' });
  const realFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (url, opts) => {
    assert.match(url, /oauth\.zaloapp\.com\/v4\/oa\/access_token/);
    assert.equal(opts.headers.secret_key, 'sec');
    sentBody = new URLSearchParams(opts.body);
    return { json: async () => ({ access_token: 'AT', refresh_token: 'RT', expires_in: '90000' }) };
  };
  try {
    const store = new Store(':memory:');
    const zalo = createZalo(store);
    assert.equal(zalo.enabled(), false);
    const url = new URL(zalo.authorizeUrl());
    assert.equal(url.searchParams.get('app_id'), '111');
    assert.match(url.searchParams.get('redirect_uri'), /\/webhooks\/zalo\/oauth$/);
    const state = url.searchParams.get('state');
    await assert.rejects(zalo.handleCallback({ code: 'x', state: 'sai' }), /hết hạn|không hợp lệ/);
    await zalo.handleCallback({ code: 'CODE', state, oa_id: '1869' });
    // code_verifier gửi đi phải khớp code_challenge trong link
    const challenge = crypto.createHash('sha256').update(sentBody.get('code_verifier')).digest('base64url');
    assert.equal(challenge, url.searchParams.get('code_challenge'));
    assert.equal(sentBody.get('grant_type'), 'authorization_code');
    assert.equal(zalo.enabled(), true);
    assert.equal(store.data.integrations.zalo.refreshToken, 'RT');
    await assert.rejects(zalo.handleCallback({ code: 'CODE', state }), /hết hạn|không hợp lệ/); // state chỉ dùng 1 lần
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(config.zalo, old);
  }
});

test('/baocao ở chế độ khách tiềm năng không hiện dòng đơn nháp/doanh số', async () => {
  const { hub } = eivHub();
  const r = await handleCommand(hub, '/baocao');
  assert.doesNotMatch(r, /Đơn nháp/);
  assert.match(r, /Khách tiềm năng/);
});
