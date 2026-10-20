import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHub, text } from './helpers.js';
import { splitBubbles } from '../src/agent/agent.js';
import { learnFromTranscript, scrub } from '../src/agent/learning.js';
import { handleCommand } from '../src/control/commands.js';

test('mặc định nói chuyện tự nhiên; chọn "bám kịch bản" thì đổi hướng dẫn', async () => {
  const { hub, llm, store } = makeHub([text('a'), text('b')]);
  await hub.receive({ channel: 'web', externalId: 'sessnat0001', text: 'hi' });
  const sys1 = llm.calls[0].system.map((b) => b.text).join('\n');
  assert.match(sys1, /như một tư vấn viên thật/);
  assert.match(sys1, /KHÔNG đọc lại nguyên văn/);
  store.updateSettings({ replyStyle: 'script' });
  await hub.receive({ channel: 'web', externalId: 'sessnat0002', text: 'hi' });
  const sys2 = llm.calls[1].system.map((b) => b.text).join('\n');
  assert.match(sys2, /bám sát kịch bản/);
  assert.doesNotMatch(sys2, /như một tư vấn viên thật/);
});

test('tách câu trả lời thành nhiều tin nhắn ngắn, gửi lần lượt', async () => {
  assert.deepEqual(splitBubbles('Dạ có chị ơi 😊\n---\nBé nhà mình mấy tuổi rồi ạ?'), ['Dạ có chị ơi 😊', 'Bé nhà mình mấy tuổi rồi ạ?']);
  assert.deepEqual(splitBubbles('Một tin\nvẫn một tin'), ['Một tin\nvẫn một tin']);
  const { hub, sent, store } = makeHub([text('Dạ có chị ơi\n---\nBé mấy tuổi rồi ạ?')]);
  hub.bubbleDelayMs = 0;
  const r = await hub.receive({ channel: 'facebook', externalId: 'p77', text: 'có lớp cho bé không' });
  assert.deepEqual(sent.map((s) => s.text), ['Dạ có chị ơi', 'Bé mấy tuổi rồi ạ?']);
  const bots = store.find('messages', (m) => m.conversationId === r.conversation.id && m.role === 'bot');
  assert.equal(bots.length, 2);
  assert.ok(bots[0].trace);
});

test('hội thoại điểm cao được rút thành mẫu, xoá SĐT, và đưa vào prompt lần sau', async () => {
  const grade = { score: 9, accuracy: 9, helpfulness: 9, tone: 9, sales: 8, naturalness: 9, hallucination: false, summary: 'ok', issues: [], better_reply: '', knowledge_gaps: [] };
  const ex = { examples: [{ customer: 'Học phí bao nhiêu vậy em, số mình 0912345678', reply: 'Dạ học phí tuỳ lộ trình của bé nên em chưa báo con số được, chị cho em hỏi bé mấy tuổi rồi ạ?', lesson: 'Không báo giá nhưng vẫn dẫn dắt' }] };
  const { hub, store, llm } = makeHub([text('Dạ học phí tuỳ lộ trình…'), text(JSON.stringify(grade)), text(JSON.stringify(ex)), text('ok')]);
  const { conversation } = await hub.receive({ channel: 'web', externalId: 'sessex00001', text: 'học phí?' });
  await hub.grade(conversation.id);
  const e = store.all('examples')[0];
  assert.equal(e.status, 'active');
  assert.match(e.customer, /\[SĐT\]/);
  assert.equal(store.get('conversations', conversation.id).grade.naturalness, 9);
  await hub.receive({ channel: 'web', externalId: 'sessex00002', text: 'chào' });
  assert.match(llm.calls.at(-1).system.map((b) => b.text).join('\n'), /em chưa báo con số được/);
});

test('hội thoại bịa thông tin hoặc điểm thấp thì không học làm mẫu', async () => {
  const bad = { score: 9, accuracy: 2, helpfulness: 9, tone: 9, sales: 9, naturalness: 9, hallucination: true, summary: '', issues: [], better_reply: '', knowledge_gaps: [] };
  const { hub, store, llm } = makeHub([text('x'), text(JSON.stringify(bad))]);
  const { conversation } = await hub.receive({ channel: 'web', externalId: 'sessbad0001', text: 'a' });
  await hub.grade(conversation.id);
  assert.equal(store.all('examples').length, 0);
  assert.equal(llm.calls.length, 2); // không gọi thêm bước rút mẫu
});

test('dạy bằng đoạn chat thật: mẫu + phong cách + kiến thức chờ duyệt', async () => {
  const out = {
    examples: [{ customer: 'Bé nhà chị 5 tuổi học được không em?', reply: 'Được chị ơi, 5 tuổi là tuổi đẹp để bé làm quen tiếng Anh đó ạ. Bé đã học ở đâu chưa chị?', lesson: 'Khen + hỏi mở' }],
    style_notes: ['Khen một điểm tích cực của khách trước khi hỏi tiếp'],
    knowledge: [{ question: 'Bé mấy tuổi thì học được?', answer: 'Từ 4 tuổi, gọi 0909123456' }],
  };
  const { store, llm } = makeHub([text(JSON.stringify(out))]);
  const r = await learnFromTranscript({ llm, store, text: 'Khách: Bé nhà chị 5 tuổi học được không em?\nTư vấn viên: Được chị ơi, 5 tuổi là tuổi đẹp…' });
  assert.deepEqual(r, { examples: 1, lessons: 1, knowledge: 1 });
  assert.equal(store.all('knowledge').at(-1).status, 'pending');
  assert.match(store.all('knowledge').at(-1).answer, /\[SĐT\]/);
  await assert.rejects(learnFromTranscript({ llm, store, text: 'ngắn' }), /quá ngắn/);
});

test('/diem 4-5 sao kích hoạt học mẫu từ hội thoại', async () => {
  const ex = { examples: [{ customer: 'cho mình hỏi', reply: 'Dạ anh cứ hỏi thoải mái nha', lesson: '' }] };
  const { hub, store } = makeHub([text('Dạ em nghe ạ'), text(JSON.stringify(ex))]);
  const { conversation } = await hub.receive({ channel: 'web', externalId: 'sessrate001', text: 'cho mình hỏi' });
  await handleCommand(hub, `/diem ${conversation.id} 5 hay`);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(store.all('examples').length, 1);
});

test('scrub xoá SĐT và email', () => {
  assert.equal(scrub('gọi 0912.345.678 hoặc mail a@b.vn'), 'gọi [SĐT] hoặc mail [email]');
});
