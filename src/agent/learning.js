import { textOf } from './llm.js';
import { config } from '../config.js';
import { normalize } from '../catalog.js';
import { cleanReply } from './agent.js';

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
    naturalness: { type: 'integer', description: '1-10: tự nhiên như người thật nhắn tin, không máy móc, không lặp văn mẫu' },
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
  required: ['score', 'accuracy', 'helpfulness', 'tone', 'sales', 'naturalness', 'hallucination', 'summary', 'issues', 'better_reply', 'knowledge_gaps'],
};

export function transcriptOf(store, conversationId) {
  return store.find('messages', (m) => m.conversationId === conversationId)
    .map((m) => {
      const who = { customer: 'KHÁCH', bot: 'TRỢ LÝ', human: 'CHỦ SHOP', system: 'HỆ THỐNG' }[m.role] || m.role;
      const tools = (m.trace || []).map((t) => `   [công cụ ${t.tool}] vào=${JSON.stringify(t.input)} ra=${JSON.stringify(t.result).slice(0, 1500)}`).join('\n');
      return `${who}: ${m.role === 'bot' ? cleanReply(m.text) : m.text}${tools ? `\n${tools}` : ''}`;
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
    score: clamp(g.score), accuracy: clamp(g.accuracy), helpfulness: clamp(g.helpfulness), tone: clamp(g.tone), sales: clamp(g.sales), naturalness: clamp(g.naturalness),
    hallucination: !!g.hallucination, summary: g.summary, issues: g.issues || [], betterReply: g.better_reply || '',
    gradedAt: new Date().toISOString(), messageCount: store.find('messages', (m) => m.conversationId === conv.id).length,
  };
  store.update('conversations', conv.id, { grade });

  for (const q of g.knowledge_gaps || []) addKnowledgeGap(store, q, conv.id);

  // Hội thoại tốt (hoặc có người thật trả lời) -> rút thành hội thoại mẫu để học cách nói chuyện
  const L = store.settings.learning;
  const hasHuman = store.find('messages', (m) => m.conversationId === conv.id && m.role === 'human').length > 0;
  if (L.autoLearnExamples && !grade.hallucination && (grade.score >= L.exampleMinScore || hasHuman)) {
    await learnExamplesFromConversation({ llm, store, conversationId: conv.id, score: grade.score })
      .catch((err) => console.warn('[learning] rút hội thoại mẫu lỗi:', err.message));
  }

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

// ---------- Học cách nói chuyện từ hội thoại ----------

// Xoá thông tin cá nhân còn sót: số điện thoại, email
export function scrub(text = '') {
  return String(text)
    .replace(/(\+?84|0)[\s.-]?\d{2,3}[\s.-]?\d{3}[\s.-]?\d{3,4}/g, '[SĐT]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]');
}

const EXAMPLES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    examples: {
      type: 'array',
      description: '0-2 lượt trao đổi đáng học nhất',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          customer: { type: 'string', description: 'Tin của khách (có thể gộp 1-2 tin liên tiếp)' },
          reply: { type: 'string', description: 'Câu trả lời của tư vấn viên, giữ nguyên cách nói' },
          lesson: { type: 'string', description: 'Một câu: vì sao câu trả lời này hay' },
        },
        required: ['customer', 'reply', 'lesson'],
      },
    },
  },
  required: ['examples'],
};

const EXAMPLE_RULES = 'Chọn những lượt trao đổi thể hiện cách tư vấn tự nhiên, khéo léo, đúng mực (đồng cảm, dẫn dắt hay, xử lý câu hỏi khó như hỏi giá). Bỏ qua lượt chào hỏi đơn giản hay câu trả lời máy móc. Xoá hết tên, SĐT, email, địa chỉ cụ thể của khách (thay bằng [tên], [SĐT]...). Giữ nguyên giọng văn của tư vấn viên. Nếu không có lượt nào đáng học thì trả về mảng rỗng.';

function addExample(store, e, extra) {
  const customer = scrub(e.customer).trim();
  const reply = scrub(e.reply).trim();
  if (!customer || !reply) return null;
  const dup = store.find('examples', (x) => x.reply === reply)[0];
  if (dup) return null;
  const status = store.settings.learning.autoApproveExamples ? 'active' : 'pending';
  return store.insert('examples', { customer, reply, lesson: e.lesson || '', status, ...extra });
}

export async function learnExamplesFromConversation({ llm, store, conversationId, score }) {
  if (!llm) return [];
  const msgs = store.find('messages', (m) => m.conversationId === conversationId);
  const hasHuman = msgs.some((m) => m.role === 'human');
  const transcript = msgs.filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'customer' ? 'KHÁCH' : m.role === 'human' ? 'TƯ VẤN VIÊN (người thật)' : 'TƯ VẤN VIÊN (AI)'}: ${m.text}`)
    .join('\n');
  const response = await llm.create({
    max_tokens: 3000,
    system: `Bạn chọn hội thoại mẫu để dạy trợ lý tư vấn nói chuyện tự nhiên như người thật. ${EXAMPLE_RULES}${hasHuman ? ' Ưu tiên câu trả lời của TƯ VẤN VIÊN (người thật).' : ''}`,
    messages: [{ role: 'user', content: transcript.slice(-12000) }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: EXAMPLES_SCHEMA } },
  });
  if (response.stop_reason === 'refusal') return [];
  const { examples = [] } = JSON.parse(textOf(response));
  return examples.slice(0, 2)
    .map((e) => addExample(store, e, { source: hasHuman ? 'human_chat' : 'ai_chat', fromHuman: hasHuman, conversationId, score: score ?? null }))
    .filter(Boolean);
}

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    examples: EXAMPLES_SCHEMA.properties.examples,
    style_notes: { type: 'array', description: 'Tối đa 5 nhận xét về phong cách nói chuyện đáng học, dạng mệnh lệnh ngắn', items: { type: 'string' } },
    knowledge: {
      type: 'array',
      description: 'Thông tin về dịch vụ/chính sách mà tư vấn viên nói ra, dạng hỏi-đáp tổng quát',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
        required: ['question', 'answer'],
      },
    },
  },
  required: ['examples', 'style_notes', 'knowledge'],
};

// Chủ shop dán đoạn chat thật giữa tư vấn viên và khách -> hội thoại mẫu + phong cách + kiến thức (chờ duyệt)
export async function learnFromTranscript({ llm, store, text }) {
  if (!llm) throw new Error('Chưa cấu hình ANTHROPIC_API_KEY');
  if (String(text).trim().length < 40) throw new Error('Đoạn hội thoại quá ngắn');
  const response = await llm.create({
    max_tokens: 6000,
    system: `Bạn phân tích đoạn chat thật giữa tư vấn viên và khách để dạy trợ lý AI. Chọn tối đa 4 lượt trao đổi mẫu. ${EXAMPLE_RULES} Rút thêm nhận xét phong cách và các thông tin dịch vụ mà tư vấn viên đã nói (không rút thông tin riêng của khách).`,
    messages: [{ role: 'user', content: String(text).slice(0, 30000) }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: TRANSCRIPT_SCHEMA } },
  });
  if (response.stop_reason === 'refusal') throw new Error('AI không xử lý được đoạn hội thoại này');
  const out = JSON.parse(textOf(response));
  const examples = (out.examples || []).slice(0, 4)
    .map((e) => addExample(store, e, { source: 'transcript', fromHuman: true, score: null })).filter(Boolean);
  const lessons = (out.style_notes || []).slice(0, 5)
    .map((t) => store.insert('lessons', { text: scrub(t), status: 'active', source: 'transcript' }));
  const knowledge = (out.knowledge || [])
    .map((k) => store.insert('knowledge', { question: scrub(k.question), answer: scrub(k.answer), status: 'pending', source: 'transcript' }));
  return { examples: examples.length, lessons: lessons.length, knowledge: knowledge.length };
}

const LEAD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    found: { type: 'boolean', description: 'true nếu khách đã cho số điện thoại/Zalo của chính họ trong hội thoại' },
    reason: { type: 'string', description: 'Nếu found=false: thiếu gì (tiếng Việt, ngắn)' },
    segment: { type: 'string', enum: ['school_center', 'business', 'kids', 'adult', 'other'] },
    contact_name: { type: 'string', description: 'Tên khách tự giới thiệu, rỗng nếu không có' },
    organization: { type: 'string', description: 'Tên trường/trung tâm/doanh nghiệp, rỗng nếu không có' },
    phone: { type: 'string', description: 'SĐT/Zalo của khách. Khách ở nước ngoài mà số chưa có mã quốc gia thì thêm mã của nước đó (VD Đài Loan +886, bỏ số 0 đầu)' },
    email: { type: 'string' },
    area: { type: 'string', description: 'Tỉnh/thành, khu vực' },
    address: { type: 'string', description: 'Địa chỉ cụ thể nếu khách cho' },
    needs: { type: 'string', description: 'Tóm tắt nhu cầu đúng như khách nói' },
  },
  required: ['found', 'reason', 'segment', 'contact_name', 'organization', 'phone', 'email', 'area', 'address', 'needs'],
};

// Đọc lại hội thoại và rút thông tin khách tiềm năng (dùng khi trợ lý lỡ chưa lưu khách)
export async function extractLead({ llm, store, conversationId }) {
  const transcript = transcriptOf(store, conversationId);
  if (!transcript.includes('KHÁCH:')) return { found: false, reason: 'Hội thoại chưa có tin nhắn của khách' };
  const response = await llm.create({
    max_tokens: 2000,
    system: 'Bạn rút thông tin khách tiềm năng từ hội thoại tư vấn. Chỉ lấy thông tin KHÁCH tự nói ra; không lấy số hotline/email của shop, không suy đoán. Trường nào không có thì để chuỗi rỗng. Viết tiếng Việt.',
    messages: [{ role: 'user', content: `Hội thoại:\n\n${transcript}` }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: LEAD_SCHEMA } },
  });
  if (response.stop_reason === 'refusal') return { found: false, reason: 'AI từ chối xử lý hội thoại này' };
  return JSON.parse(textOf(response));
}
