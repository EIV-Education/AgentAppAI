// Giữ 200 dòng log gần nhất trong bộ nhớ để xem trên dashboard (không cần mở terminal).
const lines = [];
const MAX = 200;

export function captureConsole() {
  for (const level of ['log', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      const text = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      lines.push({ at: new Date().toISOString(), level, text: text.slice(0, 2000) });
      if (lines.length > MAX) lines.shift();
      orig(...args);
    };
  }
}

export const recentLogs = () => lines.slice().reverse();
