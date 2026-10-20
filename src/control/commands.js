import { formatVnd } from '../catalog.js';
import { addLessonFromFeedback, rateConversation, learnExamplesFromConversation } from '../agent/learning.js';

// Lệnh điều khiển nhanh cho chủ shop, dùng chung cho Zalo và Lark.
export const HELP = `Lệnh điều khiển trợ lý:
/tamdung – tạm dừng AI toàn bộ (tin mới sẽ báo về đây)
/tieptuc – bật lại AI
/tamdung C12 – dừng AI riêng hội thoại C12
/tieptuc C12 – trả hội thoại C12 lại cho AI
/tl C12 <nội dung> – trả lời khách thay AI (AI im {phút} phút)
/cho – hội thoại đang chờ bạn
/don – đơn nháp chờ duyệt
/lead – khách tiềm năng mới (chưa liên hệ)
/lienhe KH3 – đánh dấu đã liên hệ khách KH3
/duyet D5 – duyệt đơn D5 (báo khách)
/huy D5 <lý do> – huỷ đơn D5
/xem C12 – xem 6 tin gần nhất
/cham C12 – AI chấm điểm hội thoại
/diem C12 4 <ghi chú> – bạn chấm 1-5 sao
/day C12 <góp ý> – dạy trợ lý một bài học mới
/day <góp ý> – dạy bài học chung
/baocao – thống kê hôm nay`;

const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

export async function handleCommand(hub, rawText, { by = 'owner', minutes = 30 } = {}) {
  const text = rawText.trim();
  if (!text.startsWith('/')) return null;
  const [cmdRaw, ...rest] = text.split(/\s+/);
  const cmd = cmdRaw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace('đ', 'd');
  const arg = rest[0];
  const tail = (n) => rest.slice(n).join(' ').trim();
  const store = hub.store;
  const isConvId = (s) => /^c\d+$/i.test(s || '');

  try {
    switch (cmd) {
      case '/help': case '/huongdan': case '/hd':
        return HELP.replace('{phút}', String(minutes));

      case '/tamdung': case '/pause':
        if (isConvId(arg)) {
          if (!hub.setHandover(arg, true)) return `Không có hội thoại ${arg}`;
          return `⏸ Đã dừng AI ở ${arg.toUpperCase()}. Bạn trả lời bằng /tl ${arg.toUpperCase()} <nội dung>.`;
        }
        store.updateSettings({ botPaused: true });
        return '⏸ Đã TẠM DỪNG trợ lý trên mọi kênh. Tin nhắn mới sẽ được báo về đây. Gõ /tieptuc để bật lại.';

      case '/tieptuc': case '/resume':
        if (isConvId(arg)) {
          if (!hub.setHandover(arg, false)) return `Không có hội thoại ${arg}`;
          return `▶️ AI đã tiếp quản lại ${arg.toUpperCase()}.`;
        }
        store.updateSettings({ botPaused: false });
        for (const c of store.all('conversations')) if (c.pausedNoticeSent) c.pausedNoticeSent = false;
        return '▶️ Trợ lý đã hoạt động trở lại.';

      case '/tl': case '/reply': {
        if (!isConvId(arg) || !tail(1)) return 'Cú pháp: /tl C12 <nội dung trả lời>';
        await hub.humanReply(arg, tail(1), { by });
        return `✅ Đã gửi cho khách ${arg.toUpperCase()}. AI tạm im ${minutes} phút ở hội thoại này.`;
      }

      case '/cho': case '/pending': {
        const list = store.find('conversations', (c) => c.needsHuman);
        if (!list.length) return '👍 Không có hội thoại nào đang chờ bạn.';
        return `🙋 ${list.length} hội thoại chờ bạn:\n${list.slice(-15).map((c) => `[${c.id}] ${c.channel} – ${c.customerName || 'Khách'}: ${c.escalation?.question || c.lastMessage || ''}`.slice(0, 200)).join('\n')}`;
      }

      case '/don': case '/orders': {
        const list = store.find('orders', (o) => o.status === 'pending');
        if (!list.length) return '📦 Không có đơn nháp chờ duyệt.';
        return `📦 ${list.length} đơn chờ duyệt:\n${list.map((o) => `${o.id}: ${o.customer.name} – ${formatVnd(o.total)} – ${o.items.map((i) => `${i.name} x${i.quantity}`).join(', ')}`).join('\n')}\n→ /duyet <mã> hoặc /huy <mã> <lý do>`;
      }

      case '/lead': case '/leads': case '/khach': {
        const list = store.find('leads', (l) => l.status === 'new');
        if (!list.length) return '🎯 Không có khách tiềm năng mới.';
        return `🎯 ${list.length} khách tiềm năng chưa liên hệ:\n${list.slice(-20).map((l) => `${l.id}: ${l.contactName || 'Khách'} – ${l.phone}${l.area ? ` – ${l.area}` : ''} – ${(l.needs || '').slice(0, 80)}`).join('\n')}\n→ /lienhe <mã> khi đã gọi`;
      }

      case '/lienhe': case '/contacted': {
        const l = store.get('leads', arg);
        if (!l) return 'Cú pháp: /lienhe KH3';
        store.update('leads', l.id, { status: 'contacted', contactedAt: new Date().toISOString(), contactedBy: by });
        return `📞 Đã đánh dấu ${l.id} (${l.contactName || l.phone}) là đã liên hệ.`;
      }

      case '/duyet': case '/approve': {
        if (!arg) return 'Cú pháp: /duyet D5';
        const o = await hub.approveOrder(arg, by);
        return `✅ Đã duyệt đơn ${o.id} (${formatVnd(o.total)}) và báo khách.`;
      }

      case '/huy': case '/reject': {
        if (!arg) return 'Cú pháp: /huy D5 <lý do gửi khách>';
        const o = await hub.rejectOrder(arg, tail(1), by);
        return `🗑 Đã huỷ đơn ${o.id}.${tail(1) ? ' Đã gửi lý do cho khách.' : ''}`;
      }

      case '/xem': case '/view': {
        const c = store.get('conversations', arg);
        if (!c) return 'Cú pháp: /xem C12';
        const msgs = store.find('messages', (m) => m.conversationId === c.id).slice(-6);
        const who = { customer: '👤', bot: '🤖', human: '🧑‍💼' };
        return `[${c.id}] ${c.channel} – ${c.customerName || 'Khách'}\n${msgs.map((m) => `${who[m.role] || '•'} ${m.text}`.slice(0, 300)).join('\n')}`;
      }

      case '/cham': case '/grade': {
        if (!isConvId(arg)) return 'Cú pháp: /cham C12';
        const g = await hub.grade(arg, {});
        if (!g) return 'Hội thoại chưa có câu trả lời của AI để chấm.';
        return `📊 ${arg.toUpperCase()}: ${g.score}/10 (chính xác ${g.accuracy}, hữu ích ${g.helpfulness}, giọng ${g.tone}, bán hàng ${g.sales}, tự nhiên ${g.naturalness ?? '–'})${g.hallucination ? '\n⚠️ Có dấu hiệu bịa thông tin' : ''}\n${g.issues.map((i) => `• ${i}`).join('\n')}${g.betterReply ? `\nGợi ý: ${g.betterReply}` : ''}`;
      }

      case '/diem': case '/rate': {
        const stars = Number(rest[1]);
        if (!isConvId(arg) || !(stars >= 1 && stars <= 5)) return 'Cú pháp: /diem C12 4 <ghi chú>';
        if (!rateConversation(store, arg, { rating: stars, note: tail(2) })) return `Không có hội thoại ${arg}`;
        if (stars >= 4 && store.settings.learning.autoLearnExamples) {
          learnExamplesFromConversation({ llm: hub.llm, store, conversationId: arg.toUpperCase() }).catch(() => {});
        }
        return `⭐ Đã lưu ${stars}/5 cho ${arg.toUpperCase()}.${tail(2) ? '' : ' Muốn trợ lý sửa gì, gõ /day ' + arg.toUpperCase() + ' <góp ý>.'}`;
      }

      case '/day': case '/teach': {
        const convId = isConvId(arg) ? arg.toUpperCase() : null;
        const feedback = convId ? tail(1) : tail(0);
        if (!feedback) return 'Cú pháp: /day C12 <góp ý> hoặc /day <bài học chung>';
        const lesson = await addLessonFromFeedback({ llm: hub.llm, store, conversationId: convId, feedback });
        return `🎓 Đã thêm bài học ${lesson.id}: "${lesson.text}"`;
      }

      case '/baocao': case '/report': {
        const convs = store.find('conversations', (c) => isToday(c.lastMessageAt));
        const msgs = store.find('messages', (m) => isToday(m.createdAt));
        const orders = store.find('orders', (o) => isToday(o.createdAt));
        const graded = store.find('conversations', (c) => c.grade && isToday(c.grade.gradedAt));
        const leads = store.find('leads', (l) => isToday(l.createdAt));
        const avg = graded.length ? (graded.reduce((a, c) => a + c.grade.score, 0) / graded.length).toFixed(1) : '–';
        const byCh = ['facebook', 'zalo', 'web'].map((ch) => `${ch}: ${convs.filter((c) => c.channel === ch).length}`).join(', ');
        return `📈 Hôm nay: ${convs.length} hội thoại (${byCh}), ${msgs.filter((m) => m.role === 'customer').length} tin khách, ${msgs.filter((m) => m.role === 'bot').length} tin AI.${store.settings.salesMode === 'lead' && !orders.length ? '' : `\nĐơn nháp: ${orders.length} (chờ duyệt ${orders.filter((o) => o.status === 'pending').length}), doanh số đã duyệt ${formatVnd(orders.filter((o) => o.status === 'confirmed').reduce((a, o) => a + o.total, 0))}.`}\nKhách tiềm năng: ${leads.length} (chưa liên hệ ${store.find('leads', (l) => l.status === 'new').length}).\nĐang chờ bạn: ${store.find('conversations', (c) => c.needsHuman).length}. Điểm AI trung bình: ${avg}.\nTrợ lý: ${store.settings.botPaused ? '⏸ đang tạm dừng' : '▶️ đang chạy'}.`;
      }

      default:
        return `Không hiểu lệnh ${cmdRaw}. Gõ /help để xem danh sách.`;
    }
  } catch (err) {
    return `❌ ${err.message}`;
  }
}
