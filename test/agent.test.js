import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHub, text, tool } from './helpers.js';
import { runTool } from '../src/agent/tools.js';
import { toApiMessages } from '../src/agent/agent.js';
import { searchProducts } from '../src/catalog.js';

test('tìm sản phẩm không dấu vẫn ra đúng', () => {
  const { store } = makeHub();
  const r = searchProducts(store.all('products'), { query: 'ao thun nam' });
  assert.equal(r[0].id, 'AT01');
  assert.equal(searchProducts(store.all('products'), { query: 'giày' }).length, 0);
});

test('AI tra catalog rồi trả lời, tin nhắn được lưu và gửi về kênh', async () => {
  const { hub, llm, sent, store } = makeHub([tool('search_products', { query: 'polo' }), text('Dạ áo polo Pique đang giảm còn 249.000đ ạ.')]);
  const r = await hub.receive({ channel: 'facebook', externalId: 'psid1', text: 'shop có áo polo ko' });
  assert.equal(r.replied, true);
  assert.equal(sent.at(-1).text, 'Dạ áo polo Pique đang giảm còn 249.000đ ạ.');
  // Lượt 2 nhận được kết quả công cụ có giá lấy từ catalog
  const toolResult = JSON.parse(llm.calls[1].messages.at(-1).content[0].content);
  assert.equal(toolResult.products[0].price, 249000);
  const msgs = store.find('messages', (m) => m.conversationId === r.conversation.id);
  assert.deepEqual(msgs.map((m) => m.role), ['customer', 'bot']);
  assert.equal(msgs[1].trace[0].tool, 'search_products');
});

test('đơn nháp: giá do code tính, kiểm tra SĐT, biến thể, tồn kho', async () => {
  const { store, hub } = makeHub();
  const conv = hub.getOrCreateConversation('zalo', 'u1');
  const ctx = { store, conversation: conv, hooks: { onOrder: (o) => hub.onOrder(o) } };
  const base = { customer_name: 'Lan', phone: '0912345678', address: '12 Lê Lợi, Q1', province: 'Hồ Chí Minh' };

  assert.match((await runTool('create_draft_order', { ...base, phone: '123', items: [{ product_id: 'AT01', variant: 'Trắng-M', quantity: 1 }] }, ctx)).error, /điện thoại/);
  assert.match((await runTool('create_draft_order', { ...base, items: [{ product_id: 'AT01', quantity: 1 }] }, ctx)).error, /lựa chọn/);
  assert.match((await runTool('create_draft_order', { ...base, items: [{ product_id: 'AT01', variant: 'Đen-M', quantity: 1 }] }, ctx)).error, /chỉ còn 0/);

  const ok = await runTool('create_draft_order', { ...base, items: [{ product_id: 'AT02', variant: 'Navy-M', quantity: 2 }] }, ctx);
  const order = store.get('orders', ok.order_id);
  assert.equal(order.subtotal, 498000);
  assert.equal(order.shippingFee, 20000);
  assert.equal(order.total, 518000);
  assert.equal(order.status, 'pending');

  const free = await runTool('create_draft_order', { ...base, province: 'Đà Nẵng', items: [{ product_id: 'QJ01', variant: '30', quantity: 2 }] }, ctx);
  assert.equal(store.get('orders', free.order_id).shippingFee, 0); // >= 500k miễn ship
});

test('chuyển người thật: đánh dấu hội thoại và báo chủ shop', async () => {
  const { hub, notes, store } = makeHub([tool('escalate_to_human', { reason: 'missing_info', question: 'Khách hỏi có xuất hoá đơn VAT không' }), text('Dạ em đã chuyển quản lý ạ.')]);
  const r = await hub.receive({ channel: 'web', externalId: 'sess12345', text: 'shop xuất VAT được không' });
  const conv = store.get('conversations', r.conversation.id);
  assert.equal(conv.needsHuman, true);
  assert.match(notes.at(-1), /VAT/);
  assert.match(notes.at(-1), new RegExp(`/tl ${conv.id}`));
});

test('model bị từ chối (refusal) -> chuyển người, không gửi nội dung rỗng', async () => {
  const { hub, store } = makeHub([{ stop_reason: 'refusal', content: [] }]);
  const r = await hub.receive({ channel: 'facebook', externalId: 'p9', text: 'xin chào' });
  assert.equal(store.get('conversations', r.conversation.id).needsHuman, true);
  assert.ok(r.text.length > 0);
});

test('không có LLM -> báo chủ shop, gửi câu chờ cho khách', async () => {
  const { hub, notes, sent } = makeHub();
  hub.llm = null;
  await hub.receive({ channel: 'zalo', externalId: 'z1', text: 'alo' });
  assert.match(notes.at(-1), /lỗi/);
  assert.equal(sent.at(-1).channel, 'zalo');
});

test('lịch sử chuyển sang messages API: gộp lượt, bắt đầu bằng user', () => {
  const out = toApiMessages([
    { role: 'bot', text: 'Chào' }, { role: 'customer', text: 'a' }, { role: 'customer', text: 'b' },
    { role: 'human', text: 'trả lời' }, { role: 'bot', text: 'thêm' }, { role: 'customer', text: 'c' },
  ]);
  assert.deepEqual(out.map((m) => m.role), ['user', 'assistant', 'user']);
  assert.equal(out[0].content, 'a\nb');
  assert.match(out[1].content, /Chủ shop/);
});

test('bài học đang áp dụng được đưa vào system prompt', async () => {
  const { hub, llm, store } = makeHub([text('ok')]);
  store.insert('lessons', { text: 'Luôn hỏi chiều cao cân nặng trước khi tư vấn size', status: 'active' });
  store.insert('lessons', { text: 'Bài học đã tắt', status: 'off' });
  await hub.receive({ channel: 'web', externalId: 'sessabcdef', text: 'tư vấn size' });
  const sys = llm.calls[0].system.map((b) => b.text).join('\n');
  assert.match(sys, /chiều cao cân nặng/);
  assert.doesNotMatch(sys, /đã tắt/);
});
