import { config } from '../config.js';

// Gửi thông báo cho chủ shop qua mọi kênh điều khiển đã cấu hình (Zalo OA, Lark).
export function createNotifier({ zalo, lark }) {
  return {
    async send(text) {
      const jobs = [];
      if (zalo?.enabled()) for (const id of config.zalo.ownerIds) jobs.push(zalo.send(id, text));
      if (lark?.enabled()) for (const chatId of config.lark.ownerChatIds) jobs.push(lark.send(chatId, text));
      const results = await Promise.allSettled(jobs);
      for (const r of results) if (r.status === 'rejected') console.warn('[notify]', r.reason?.message);
    },
  };
}
