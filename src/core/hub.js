import { generateReply, splitBubbles } from '../agent/agent.js';
import { learnFromOwnerAnswer, gradeConversation } from '../agent/learning.js';
import { config } from '../config.js';
import { formatVnd } from '../catalog.js';

const CHANNEL_LABEL = { facebook: 'Facebook', zalo: 'Zalo', web: 'Web', manual: 'Nhập tay' };
export const SEGMENT_LABEL = { school_center: 'Trường học/Trung tâm', business: 'Doanh nghiệp', kids: 'Cá nhân – Trẻ em', adult: 'Cá nhân – Người đi làm', other: 'Khác' };

// Trung tâm xử lý: nhận tin từ mọi kênh, quyết định AI trả lời hay chờ người, gửi thông báo cho chủ shop.
export class Hub {
  constructor({ store, llm, channels = {}, notifier, crm = null }) {
    this.crm = crm;
    this.store = store;
    this.llm = llm;
    this.channels = channels; // { facebook, zalo, web }
    this.notifier = notifier; // { send(text) } — gửi cho chủ shop qua Zalo/Lark
    this.running = new Map(); // conversationId -> Promise (xử lý tuần tự từng hội thoại)
    this.pendingAgain = new Set();
    this.listeners = new Set();
    this.bubbleDelayMs = 1200; // nghỉ giữa các tin khi trợ lý nhắn nhiều tin liên tiếp
  }

  // ---- hội thoại & tin nhắn ----
  getOrCreateConversation(channel, externalId, customerName) {
    let conv = this.store.find('conversations', (c) => c.channel === channel && c.externalId === String(externalId))[0];
    if (!conv) {
      conv = this.store.insert('conversations', {
        channel, externalId: String(externalId), customerName: customerName || null,
        needsHuman: false, handoverUntil: null, botEnabled: true, lastMessageAt: new Date().toISOString(),
      });
    } else if (customerName && !conv.customerName) {
      this.store.update('conversations', conv.id, { customerName });
    }
    return conv;
  }

  addMessage(conv, role, text, extra = {}) {
    const msg = this.store.insert('messages', { conversationId: conv.id, role, text, ...extra });
    const cur = this.store.get('conversations', conv.id);
    this.store.update('conversations', conv.id, {
      lastMessageAt: msg.createdAt, lastMessage: text.slice(0, 200),
      ...(role === 'customer' ? { unread: (cur.unread || 0) + 1 } : {}),
    });
    for (const fn of this.listeners) fn({ type: 'message', conversationId: conv.id, message: msg });
    return msg;
  }

  history(convId) {
    const all = this.store.find('messages', (m) => m.conversationId === convId);
    return all.slice(-config.historyLimit);
  }

  aiActive(conv) {
    if (this.store.settings.botPaused) return false;
    if (conv.botEnabled === false) return false;
    if (this.store.settings.aiChannels?.[conv.channel] === false) return false;
    if (conv.handoverUntil && new Date(conv.handoverUntil) > new Date()) return false;
    return true;
  }

  // ---- tin nhắn đến từ khách ----
  async receive({ channel, externalId, text, customerName, messageId }) {
    if (messageId && this.store.find('messages', (m) => m.externalMessageId === messageId).length) return null; // webhook gửi lặp
    const conv = this.getOrCreateConversation(channel, externalId, customerName);
    this.addMessage(conv, 'customer', text, messageId ? { externalMessageId: messageId } : {});
    if (!this.aiActive(conv)) {
      if (this.store.settings.botPaused && !conv.pausedNoticeSent) {
        this.store.update('conversations', conv.id, { pausedNoticeSent: true });
        await this.notify(`💬 [${conv.id}] ${CHANNEL_LABEL[channel]} – ${conv.customerName || 'Khách'} nhắn khi trợ lý đang TẠM DỪNG:\n"${text.slice(0, 300)}"\n→ Trả lời: /tl ${conv.id} <nội dung>`);
      }
      return { conversation: conv, replied: false };
    }
    return this.schedule(conv.id);
  }

  // Mỗi hội thoại chỉ chạy một lượt AI tại một thời điểm; tin đến trong lúc chạy sẽ được gộp vào lượt sau.
  schedule(convId) {
    if (this.running.has(convId)) {
      this.pendingAgain.add(convId);
      return this.running.get(convId);
    }
    const p = (async () => {
      let result;
      do {
        this.pendingAgain.delete(convId);
        result = await this.respond(convId);
      } while (this.pendingAgain.has(convId));
      return result;
    })().finally(() => this.running.delete(convId));
    this.running.set(convId, p);
    return p;
  }

  async respond(convId) {
    const conv = this.store.get('conversations', convId);
    if (!this.aiActive(conv)) return { conversation: conv, replied: false };
    const channel = this.channels[conv.channel];
    channel?.typing?.(conv.externalId);

    let result;
    try {
      if (!this.llm) throw new Error('Chưa cấu hình ANTHROPIC_API_KEY');
      result = await generateReply({
        llm: this.llm, store: this.store, conversation: conv, history: this.history(conv.id),
        hooks: { onEscalate: (c, info) => this.onEscalate(c, info), onOrder: (o) => this.onOrder(o), onLead: (l) => this.onLead(l), onLeadUpdate: (l) => this.syncLead(l) },
      });
    } catch (err) {
      console.error(`[hub] AI lỗi ở ${conv.id}:`, err.message);
      // Đã báo lỗi cho hội thoại này rồi thì không gửi lặp câu chờ và thông báo
      if (conv.needsHuman && conv.escalation?.reason === 'error') return { conversation: conv, replied: false };
      this.store.update('conversations', conv.id, { needsHuman: true, escalation: { reason: 'error', question: err.message, at: new Date().toISOString() } });
      await this.notify(`⚠️ [${conv.id}] Trợ lý gặp lỗi, cần bạn trả lời khách: ${err.message}\n→ /tl ${conv.id} <nội dung>`);
      result = { text: 'Dạ shop đã nhận tin nhắn, nhân viên sẽ phản hồi anh/chị ngay ạ.', trace: [], escalated: true };
    }
    if (!result?.text) return { conversation: conv, replied: false };

    // Chủ shop có thể đã tiếp quản trong lúc AI đang nghĩ
    if (!this.aiActive(this.store.get('conversations', convId))) return { conversation: conv, replied: false };

    // Nhắn thành nhiều tin ngắn liên tiếp như người thật
    const parts = splitBubbles(result.text);
    let msg;
    for (const [i, part] of parts.entries()) {
      if (i > 0) await new Promise((r) => setTimeout(r, Math.min(this.bubbleDelayMs, 300 + part.length * 15)));
      const m = this.addMessage(conv, 'bot', part, i === 0 ? { trace: result.trace, escalated: !!result.escalated } : {});
      msg ||= m;
      await this.deliver(conv, part);
    }
    return { conversation: conv, replied: true, message: msg, ...result, text: parts.join('\n') };
  }

  async deliver(conv, text) {
    const channel = this.channels[conv.channel];
    if (!channel?.send) return;
    try {
      await channel.send(conv.externalId, text);
    } catch (err) {
      console.error(`[hub] gửi ${conv.channel} lỗi:`, err.message);
      await this.notify(`⚠️ Không gửi được tin cho khách [${conv.id}] qua ${CHANNEL_LABEL[conv.channel]}: ${err.message}`);
    }
  }

  // ---- chủ shop trả lời thay ----
  async humanReply(convId, text, { by = 'owner', learn = true } = {}) {
    const conv = this.store.get('conversations', convId);
    if (!conv) throw new Error(`Không có hội thoại ${convId}`);
    const until = new Date(Date.now() + config.humanTakeoverMinutes * 60_000).toISOString();
    const escalation = conv.needsHuman ? conv.escalation : null;
    this.store.update('conversations', conv.id, { handoverUntil: until, needsHuman: false, unread: 0 });
    const msg = this.addMessage(conv, 'human', text, { by });
    await this.deliver(conv, text);

    // Tự học: câu trả lời cho câu hỏi bị chuyển lên trở thành kiến thức
    if (learn && escalation?.question && escalation.reason !== 'error') {
      learnFromOwnerAnswer({ llm: this.llm, store: this.store, conversationId: conv.id, question: escalation.question, answer: text })
        .catch((err) => console.warn('[hub] tự học lỗi:', err.message));
    }
    return msg;
  }

  setHandover(convId, on) {
    const until = on ? new Date(Date.now() + 365 * 24 * 3600_000).toISOString() : null;
    return this.store.update('conversations', convId, { handoverUntil: until, ...(on ? {} : { needsHuman: false }) });
  }

  // ---- đơn nháp ----
  async approveOrder(orderId, by = 'owner') {
    const order = this.store.get('orders', orderId);
    if (!order) throw new Error(`Không có đơn ${orderId}`);
    if (order.status !== 'pending') throw new Error(`Đơn ${order.id} đang ở trạng thái "${order.status}"`);
    this.store.update('orders', order.id, { status: 'confirmed', confirmedAt: new Date().toISOString(), confirmedBy: by });
    const conv = this.store.get('conversations', order.conversationId);
    if (conv) {
      const text = `Dạ shop đã xác nhận đơn ${order.id} của anh/chị: tổng ${formatVnd(order.total)}. Shop sẽ đóng gói và gửi hàng sớm nhất, cảm ơn anh/chị đã ủng hộ ạ!`;
      this.addMessage(conv, 'bot', text, { system: 'order_confirmed' });
      await this.deliver(conv, text);
    }
    return this.store.get('orders', order.id);
  }

  async rejectOrder(orderId, reason = '', by = 'owner') {
    const order = this.store.get('orders', orderId);
    if (!order) throw new Error(`Không có đơn ${orderId}`);
    if (order.status !== 'pending') throw new Error(`Đơn ${order.id} đang ở trạng thái "${order.status}"`);
    this.store.update('orders', order.id, { status: 'cancelled', cancelReason: reason, cancelledBy: by });
    const conv = this.store.get('conversations', order.conversationId);
    if (conv && reason) {
      const text = `Dạ về đơn ${order.id}: ${reason}`;
      this.addMessage(conv, 'human', text, { by });
      await this.deliver(conv, text);
    }
    return this.store.get('orders', order.id);
  }

  async grade(convId, hooks) {
    return gradeConversation({ llm: this.llm, store: this.store, conversationId: convId, hooks: hooks || this.learningHooks() });
  }

  learningHooks() {
    return {
      onLowScore: (conv, g) => this.notify(`📉 [${conv.id}] điểm ${g.score}/10${g.hallucination ? ' – CÓ DẤU HIỆU BỊA THÔNG TIN' : ''}\n${g.issues.slice(0, 3).map((i) => `• ${i}`).join('\n')}\n→ Dạy trợ lý: /day ${conv.id} <góp ý>`),
    };
  }

  // ---- thông báo cho chủ shop ----
  async notify(text) {
    for (const fn of this.listeners) fn({ type: 'notify', text });
    if (!this.notifier) return;
    try {
      await this.notifier.send(text);
    } catch (err) {
      console.warn('[hub] gửi thông báo lỗi:', err.message);
    }
  }

  async onEscalate(conv, info) {
    if (!this.store.settings.notifyOnEscalation) return;
    await this.notify(`🙋 [${conv.id}] ${CHANNEL_LABEL[conv.channel]} – ${conv.customerName || 'Khách'} cần bạn hỗ trợ (${info.reason}):\n${info.question}\n→ Trả lời: /tl ${conv.id} <nội dung>`);
  }

  async onOrder(order) {
    for (const fn of this.listeners) fn({ type: 'order', order });
    if (!this.store.settings.notifyOnNewOrder) return;
    const items = order.items.map((i) => `• ${i.name}${i.variant ? ` (${i.variant})` : ''} x${i.quantity}: ${formatVnd(i.total)}`).join('\n');
    await this.notify(`🛒 Đơn nháp ${order.id} từ [${order.conversationId}] ${CHANNEL_LABEL[order.channel]}\n${items}\nShip: ${formatVnd(order.shippingFee)} – Tổng: ${formatVnd(order.total)}\n${order.customer.name} – ${order.customer.phone}\n${order.customer.address}${order.note ? `\nGhi chú: ${order.note}` : ''}\n→ /duyet ${order.id} hoặc /huy ${order.id} <lý do>`);
  }

  // Đẩy khách lên CRM chạy nền, không làm chậm câu trả lời cho khách
  syncLead(lead) {
    if (!this.crm?.enabled() || !lead) return;
    this.crm.sync(this.store.get('leads', lead.id) || lead).then((ok) => {
      for (const fn of this.listeners) fn({ type: 'lead', lead: ok || lead });
    });
  }

  async onLead(lead) {
    this.syncLead(lead);
    for (const fn of this.listeners) fn({ type: 'lead', lead });
    if (!this.store.settings.notifyOnNewLead) return;
    await this.notify(`🎯 Khách tiềm năng ${lead.id} từ ${lead.conversationId ? `[${lead.conversationId}] ` : ''}${CHANNEL_LABEL[lead.channel]} – ${SEGMENT_LABEL[lead.segment] || lead.segment}\n${lead.organization ? `${lead.organization} – ` : ''}${lead.contactName || 'Khách'} – ${lead.phone}${lead.email ? ` – ${lead.email}` : ''}${lead.address || lead.area ? `\nĐịa chỉ: ${lead.address || lead.area}` : ''}\nNhu cầu: ${lead.needs}\n→ Đã liên hệ: /lienhe ${lead.id}`);
  }

  // Nhắn nhắc khách một lần khi khách im lặng sau câu trả lời của trợ lý (trong 23 giờ — giới hạn của Facebook)
  async runFollowUps(now = Date.now()) {
    const f = this.store.settings.followUp;
    if (!f?.enabled || !f.text || this.store.settings.botPaused) return 0;
    let sent = 0;
    for (const conv of this.store.all('conversations')) {
      const msgs = this.store.find('messages', (m) => m.conversationId === conv.id);
      const last = msgs[msgs.length - 1];
      if (!last || last.role !== 'bot' || last.followUp) continue;
      if (!msgs.some((m) => m.role === 'customer')) continue;
      const idle = now - new Date(last.createdAt).getTime();
      if (idle < f.afterMinutes * 60_000 || idle > 23 * 3600_000) continue;
      if (!this.aiActive(conv) || conv.needsHuman) continue;
      if (this.store.find('leads', (l) => l.conversationId === conv.id).length) continue;
      this.addMessage(conv, 'bot', f.text, { followUp: true });
      await this.deliver(conv, f.text);
      sent++;
    }
    return sent;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
