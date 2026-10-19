import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHub, text, tool } from './helpers.js';
import { handleCommand } from '../src/control/commands.js';
import { runTool } from '../src/agent/tools.js';
import { parseProductsCsv } from '../src/importers.js';

test('/tamdung: AI ngừng trả lời, tin mới báo chủ shop; /tieptuc bật lại', async () => {
  const { hub, llm, notes } = makeHub([text('Dạ em chào anh')]);
  assert.match(await handleCommand(hub, '/tamdung'), /TẠM DỪNG/);
  const r = await hub.receive({ channel: 'facebook', externalId: 'p1', text: 'còn hàng không' });
  assert.equal(r.replied, false);
  assert.equal(llm.calls.length, 0);
  assert.match(notes.at(-1), /TẠM DỪNG/);
  await handleCommand(hub, '/tieptuc');
  const r2 = await hub.receive({ channel: 'facebook', externalId: 'p1', text: 'alo' });
  assert.equal(r2.replied, true);
});

test('/tl trả lời thay: gửi khách, AI im, câu trả lời được học thành kiến thức', async () => {
  const { hub, sent, store, llm } = makeHub([
    tool('escalate_to_human', { reason: 'missing_info', question: 'Có xuất hoá đơn VAT không?' }),
    text('Dạ em chuyển quản lý ạ'),
    text(JSON.stringify({ reusable: true, question: 'Shop có xuất hoá đơn VAT không?', answer: 'Có, shop xuất VAT cho đơn từ 1 triệu.', tags: ['vat'] })),
  ]);
  const { conversation } = await hub.receive({ channel: 'zalo', externalId: 'z9', text: 'có VAT ko' });
  const reply = await handleCommand(hub, `/tl ${conversation.id} Dạ có ạ, shop xuất VAT cho đơn từ 1 triệu`);
  assert.match(reply, /Đã gửi/);
  assert.equal(sent.at(-1).text, 'Dạ có ạ, shop xuất VAT cho đơn từ 1 triệu');
  assert.equal(hub.aiActive(store.get('conversations', conversation.id)), false);
  await new Promise((r) => setTimeout(r, 10));
  const k = store.find('knowledge', (x) => /VAT/.test(x.question))[0];
  assert.ok(k);
  assert.equal(k.status, 'pending'); // mặc định cần duyệt
  // Tin khách tiếp theo không gọi AI vì chủ shop đang tiếp quản
  const before = llm.calls.length;
  await hub.receive({ channel: 'zalo', externalId: 'z9', text: 'cảm ơn' });
  assert.equal(llm.calls.length, before);
});

test('/don, /duyet báo khách; /huy gửi lý do', async () => {
  const { hub, store, sent } = makeHub();
  const conv = hub.getOrCreateConversation('facebook', 'p5', 'Minh');
  const base = { customer_name: 'Minh', phone: '0987654321', address: '1 Trần Phú', province: 'Hà Nội' };
  const ctx = { store, conversation: conv, hooks: {} };
  const a = await runTool('create_draft_order', { ...base, items: [{ product_id: 'PK01', quantity: 1 }] }, ctx);
  const b = await runTool('create_draft_order', { ...base, items: [{ product_id: 'PK01', quantity: 2 }] }, ctx);
  assert.match(await handleCommand(hub, '/don'), new RegExp(a.order_id));
  assert.match(await handleCommand(hub, `/duyet ${a.order_id.toLowerCase()}`), /Đã duyệt/);
  assert.equal(store.get('orders', a.order_id).status, 'confirmed');
  assert.match(sent.at(-1).text, /đã xác nhận đơn/);
  assert.match(await handleCommand(hub, `/duyet ${a.order_id}`), /❌/);
  await handleCommand(hub, `/huy ${b.order_id} hết hàng tạm thời`);
  assert.equal(store.get('orders', b.order_id).status, 'cancelled');
  assert.match(sent.at(-1).text, /hết hàng/);
});

test('/day tạo bài học, /diem lưu đánh giá, lệnh sai cú pháp có hướng dẫn', async () => {
  const { hub, store } = makeHub([text('Luôn báo phí ship trước khi chốt đơn.')]);
  const conv = hub.getOrCreateConversation('web', 'sess000001');
  assert.match(await handleCommand(hub, `/day ${conv.id} lần sau nhớ báo ship`), /Luôn báo phí ship/);
  assert.equal(store.find('lessons', (l) => l.status === 'active').length, 1);
  assert.match(await handleCommand(hub, `/diem ${conv.id} 4 khá ổn`), /4\/5/);
  assert.equal(store.get('conversations', conv.id).ownerRating.rating, 4);
  assert.match(await handleCommand(hub, '/diem'), /Cú pháp/);
  assert.match(await handleCommand(hub, '/abc'), /help/);
  assert.equal(await handleCommand(hub, 'không phải lệnh'), null);
});

test('chấm điểm hội thoại: lưu điểm, gom câu hỏi chưa có đáp án, báo khi điểm thấp', async () => {
  const grade = { score: 4, accuracy: 3, helpfulness: 5, tone: 8, sales: 4, hallucination: true, summary: 'Khách hỏi giày', issues: ['Bịa giá giày'], better_reply: 'Shop chưa bán giày ạ', knowledge_gaps: ['Shop có bán giày không?'] };
  const { hub, store, notes } = makeHub([text('Dạ giày 300k ạ'), text(JSON.stringify(grade)), text(JSON.stringify(grade))]);
  const { conversation } = await hub.receive({ channel: 'web', externalId: 'sess999999', text: 'có giày không' });
  assert.match(await handleCommand(hub, `/cham ${conversation.id}`), /4\/10/);
  const conv = store.get('conversations', conversation.id);
  assert.equal(conv.grade.hallucination, true);
  assert.equal(store.find('knowledge', (k) => k.status === 'needs_answer').length, 1);
  // Chấm tự động (chu kỳ tự học) có báo chủ shop khi điểm thấp; câu hỏi lặp lại được đếm thêm
  await hub.grade(conversation.id);
  assert.match(notes.at(-1), /BỊA/);
  assert.equal(store.find('knowledge', (k) => k.status === 'needs_answer')[0].askedCount, 2);
});

test('nhập CSV catalog có biến thể và thuộc tính', () => {
  const rows = parseProductsCsv('id,name,price,variants,attr:Chất liệu\nX1,"Áo, đẹp",100000,"S:3;M:2:120000",Cotton\n');
  assert.equal(rows[0].name, 'Áo, đẹp');
  assert.deepEqual(rows[0].variants[1], { name: 'M', stock: '2', price: '120000' });
  assert.equal(rows[0].attributes['Chất liệu'], 'Cotton');
});

test('Zalo: token trong .env được dùng kể cả khi db đã lưu token cũ', async () => {
  const { config } = await import('../src/config.js');
  const { createZalo } = await import('../src/channels/zalo.js');
  const { Store } = await import('../src/db.js');
  const store = new Store(':memory:');
  store.data.integrations.zalo = { accessToken: '', refreshToken: '' };
  const old = config.zalo.accessToken;
  config.zalo.accessToken = 'tok-env';
  try {
    assert.equal(createZalo(store).enabled(), true);
    store.data.integrations.zalo.accessToken = 'tok-refreshed'; // sau khi tự làm mới
    assert.equal(createZalo(store).enabled(), true);
    assert.equal(store.data.integrations.zalo.accessToken, 'tok-refreshed');
  } finally { config.zalo.accessToken = old; }
});
