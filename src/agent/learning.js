import { textOf } from './llm.js';
import { config } from '../config.js';
import { normalize } from '../catalog.js';

// Chấm điểm hội thoại + tự học: rút kiến thức từ câu trả lời của chủ shop,
// biến góp ý thành bài học, gom các câu hỏi trợ lý chưa trả lời được.

const GRADE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    score: { type: 'integer', description: 'Điểm tổng 1-10' },
    accuracy: { type: 'integer', description: '1-10: thông tin khớp dữ liệu công cụ, không bịa' },
    helpfulness: { type: 'integer', description: '1-10: trả lời đúng trọng tâm, nhanh' },
    tone: { type: 'integer', description: '1-10: lịch sự, đúng giọng shop' },
    sales: { type: 'integer', description: '1-10: kỹ năng tư vấn, gợi ý, chốt đơn' },
    hallucination: { type: 'boolean', description: 'true nếu trợ lý nói thông tin không có trong kết quả công cụ' },
    summary: { type: 'string', description: 'Tóm tắt 1 câu khách cần gì và kết quả' },
    issues: { type: 'array', items: { type: 'string' } },
    better_reply: { type: 'string', description: 'Câu trả lời tốt hơn cho lượt yếu nhất; rỗng nếu không cần' },
    knowledge_gaps: {
      type: 'array',
      description: 'Câu hỏi của khách mà dữ liệu shop chưa có câu trả lời',
      items: { type: 'string' },
    },
  },
  required: ['score', 'accuracy', 'helpfulness', 'tone', 'sales', 'hallucination', 'summary', 'issues', 'better_reply', 'knowledge_gaps'],
};

export function transcriptOf(store, conversationId) {
  return store.find('messages', (m) => m.conversationId === conversationId)
    .map((m) => {
      const who = { customer: 'KHÁCH', bot: 'TRỢ LÝ', human: 'CHỦ SHOP', system: 'HỆ THỐNG' }[m.role] || m.role;
      const tools = (m.trace || []).map((t) => `   [công cụ ${t.tool}] vào=${JSON.stringify(t.input)} ra=${JSON.stringify(t.result).slice(0, 1500)}`).join('\n');
      return `${who}: ${m.text}${tools ? `\n${tools}` : ''}`;
    })
    .join('\n');
}

const clamp = (n) => Math.max(1, Math.min(10, Math.round(Number(n) || 1)));

export async function gradeConversation({ llm, store, conversationId, hooks }) {
  const conv = store.get('conversations', conversationId);
  if (!conv) throw new Error('Không tìm thấy hội thoại');
  const transcript = transcriptOf(store, conv.id);
  if (!transcript.includes('TRỢ LÝ:')) return null;

  const response = await llm.create({
    max_tokens: 4000,
    system: 'Bạn là trưởng nhóm CSKH, chấm điểm hội thoại của trợ lý bán hàng AI. Kết quả công cụ là nguồn sự thật duy nhất: mọi giá, tồn kho, chính sách trợ lý nói ra phải khớp kết quả công cụ, nếu không là bịa (hallucination=true, accuracy ≤ 3). Chuyển cho chủ shop đúng lúc là hành vi tốt, không trừ điểm. Viết nhận xét bằng tiếng Việt, cụ thể, có thể hành động được.',
    messages: [{ role: 'user', content: `Hội thoại kênh ${conv.channel}:\n\n${transcript}` }],
    output_config: { effort: config.anthropic.gradeEffort, format: { type: 'json_schema', schema: GRADE_SCHEMA } },
  });
  if (response.stop_reason === 'refusal') return null;

  const g = JSON.parse(textOf(response));
  const grade = {
    score: clamp(g.score), accuracy: clamp(g.accuracy), helpfulness: clamp(g.helpfulness), tone: clamp(g.tone), sales: clamp(g.sales),
    hallucination: !!g.hallucination, summary: g.summary, issues: g.issues || [], betterReply: g.better_reply || '',
    gradedAt: new Date().toISOString(), messageCount: store.find('messages', (m) => m.conversationId === conv.id).length,
  };
  store.update('conversations', conv.id, { grade });

  for (const q of g.knowledge_gaps || []) addKnowledgeGap(store, q, conv.id);

  const threshold = store.settings.learning.lowScoreAlert;
  if (grade.score < threshold || grade.hallucination) await hooks?.onLowScore?.(conv, grade);
  return grade;
}

// Câu hỏi chưa có đáp án -> mục kiến thức chờ chủ shop điền
export function addKnowledgeGap(store, question, conversationId) {
  const key = normalize(question);
  if (!key) return null;
  const dup = store.find('knowledge', (k) => normalize(k.question) === key)[0];
  if (dup) {
    store.update('knowledge', dup.id, { askedCount: (dup.askedCount || 1) + 1 });
    return dup;
  }
  return store.insert('knowledge', { question, answer: '', status: 'needs_answer', source: 'gap', conversationId, askedCount: 1 });
}

const QA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    reusable: { type: 'boolean', description: 'true nếu câu trả lời áp dụng được cho khách khác' },
    question: { type: 'string', description: 'Câu hỏi khái quát, không chứa thông tin cá nhân' },
    answer: { type: 'string', description: 'Câu trả lời chuẩn, không chứa tên/SĐT/địa chỉ khách' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['reusable', 'question', 'answer', 'tags'],
};

// Chủ shop trả lời một câu hỏi bị chuyển lên -> rút thành kiến thức dùng lại
export async function learnFromOwnerAnswer({ llm, store, conversationId, question, answer }) {
  let entry = { reusable: true, question, answer, tags: [] };
  if (llm) {
    try {
      const response = await llm.create({
        max_tokens: 2000,
        system: 'Bạn biên tập kho kiến thức cho trợ lý bán hàng. Từ câu hỏi của khách và câu trả lời của chủ shop, viết lại thành một mục hỏi-đáp tổng quát, xoá thông tin cá nhân. Nếu câu trả lời chỉ đúng cho riêng khách này (vd tình trạng đơn của họ) thì reusable=false.',
        messages: [{ role: 'user', content: `Câu hỏi: ${question}\nChủ shop trả lời: ${answer}` }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: QA_SCHEMA } },
      });
      if (response.stop_reason !== 'refusal') entry = JSON.parse(textOf(response));
    } catch (err) {
      console.warn('[learning] không chuẩn hoá được kiến thức:', err.message);
    }
  }
  if (!entry.reusable) return null;

  const status = store.settings.learning.autoApproveKnowledge ? 'approved' : 'pending';
  const gap = store.find('knowledge', (k) => k.status === 'needs_answer' && normalize(k.question) === normalize(question))[0];
  if (gap) return store.update('knowledge', gap.id, { question: entry.question, answer: entry.answer, tags: entry.tags, status, source: 'owner_reply' });
  return store.insert('knowledge', { question: entry.question, answer: entry.answer, tags: entry.tags, status, source: 'owner_reply', conversationId });
}

// Góp ý của chủ shop -> bài học ngắn gọn đưa vào system prompt
export async function addLessonFromFeedback({ llm, store, conversationId, feedback }) {
  let text = feedback.trim();
  if (llm) {
    try {
      const transcript = conversationId ? transcriptOf(store, conversationId).slice(-6000) : '';
      const response = await llm.create({
        max_tokens: 1000,
        system: 'Viết lại góp ý của chủ shop thành MỘT quy tắc ngắn (tối đa 2 câu), dạng mệnh lệnh, áp dụng được cho mọi hội thoại sau. Chỉ trả về quy tắc, không giải thích.',
        messages: [{ role: 'user', content: `${transcript ? `Hội thoại liên quan:\n${transcript}\n\n` : ''}Góp ý của chủ shop: ${feedback}` }],
        output_config: { effort: 'low' },
      });
      const t = textOf(response);
      if (response.stop_reason !== 'refusal' && t) text = t;
    } catch (err) {
      console.warn('[learning] không chuẩn hoá được bài học:', err.message);
    }
  }
  return store.insert('lessons', { text, original: feedback, conversationId: conversationId || null, status: 'active' });
}

export function rateConversation(store, conversationId, { rating, note }) {
  const conv = store.get('conversations', conversationId);
  if (!conv) return null;
  return store.update('conversations', conv.id, { ownerRating: { rating: Number(rating), note: note || '', at: new Date().toISOString() } });
}

// Chu kỳ tự học: chấm các hội thoại đã im lặng đủ lâu và có tin nhắn mới kể từ lần chấm trước
export async function runLearningCycle({ llm, store, hooks }) {
  if (!llm || !store.settings.learning.autoGrade) return { graded: 0 };
  const idleMs = config.conversationIdleMinutes * 60_000;
  const now = Date.now();
  let graded = 0;
  for (const c of store.all('conversations')) {
    if (now - new Date(c.lastMessageAt || c.createdAt).getTime() < idleMs) continue;
    const count = store.find('messages', (m) => m.conversationId === c.id).length;
    if (c.grade && c.grade.messageCount >= count) continue;
    try {
      if (await gradeConversation({ llm, store, conversationId: c.id, hooks })) graded++;
    } catch (err) {
      console.warn(`[learning] chấm ${c.id} lỗi:`, err.message);
    }
  }
  return { graded };
}
