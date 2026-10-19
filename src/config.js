import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

// Nạp .env đơn giản (không cần thư viện dotenv)
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k, d = '') => process.env[k] || d; // biến để trống trong .env = dùng mặc định
const list = (k) => env(k).split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(env('PORT', '3000')),
  host: env('HOST', '0.0.0.0'), // trên VPS sau nginx: 127.0.0.1
  publicUrl: env('PUBLIC_URL', 'http://localhost:3000'),
  adminToken: env('ADMIN_TOKEN', 'doi-mat-khau-nay'),
  dataFile: env('DATA_FILE', path.join(ROOT, 'data', 'db.json')),

  anthropic: {
    model: env('CLAUDE_MODEL', 'claude-opus-5-5'),
    chatEffort: env('CHAT_EFFORT', 'medium'),
    gradeEffort: env('GRADE_EFFORT', 'medium'),
  },

  facebook: {
    pageToken: env('FB_PAGE_ACCESS_TOKEN'),
    appSecret: env('FB_APP_SECRET'),
    verifyToken: env('FB_VERIFY_TOKEN', 'eiv-verify'),
    graphVersion: env('FB_GRAPH_VERSION', 'v21.0'),
  },

  zalo: {
    appId: env('ZALO_APP_ID'),
    secretKey: env('ZALO_APP_SECRET'),
    oaSecretKey: env('ZALO_OA_SECRET_KEY'),
    accessToken: env('ZALO_OA_ACCESS_TOKEN'),
    refreshToken: env('ZALO_OA_REFRESH_TOKEN'),
    ownerIds: list('ZALO_OWNER_IDS'),
    // Mã xác thực domain (thẻ meta zalo-platform-site-verification) khi khai báo webhook
    siteVerification: env('ZALO_SITE_VERIFICATION'),
  },

  lark: {
    appId: env('LARK_APP_ID'),
    appSecret: env('LARK_APP_SECRET'),
    verificationToken: env('LARK_VERIFICATION_TOKEN'),
    ownerChatIds: list('LARK_OWNER_CHAT_IDS'),
    domain: env('LARK_DOMAIN', 'https://open.larksuite.com'),
  },

  // Số phút AI im lặng sau khi chủ shop trả lời thay
  humanTakeoverMinutes: Number(env('HUMAN_TAKEOVER_MINUTES', '30')),
  // Chu kỳ tự học (chấm điểm hội thoại đã kết thúc + rút kiến thức)
  learningIntervalMinutes: Number(env('LEARNING_INTERVAL_MINUTES', '30')),
  // Hội thoại im lặng bao lâu thì coi như kết thúc để chấm điểm
  conversationIdleMinutes: Number(env('CONVERSATION_IDLE_MINUTES', '30')),
  historyLimit: Number(env('HISTORY_LIMIT', '30')),
};
