import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { config, ROOT } from './config.js';
import { Store } from './db.js';
import { createLLM } from './agent/llm.js';
import { Hub } from './core/hub.js';
import { facebook } from './channels/facebook.js';
import { createZalo } from './channels/zalo.js';
import { lark } from './channels/lark.js';
import { createNotifier } from './control/notifier.js';
import { webhookRoutes } from './routes/webhooks.js';
import { webchatRoutes } from './routes/webchat.js';
import { adminRoutes } from './routes/admin.js';
import { runLearningCycle } from './agent/learning.js';

export function createApp({ store, llm, channels, notifier } = {}) {
  store ||= new Store(config.dataFile);
  const zalo = channels?.zalo || createZalo(store);
  const web = { name: 'web', enabled: () => true, async send() {} }; // widget tự lấy tin qua API
  const hub = new Hub({
    store,
    llm: llm === undefined ? createLLM() : llm,
    channels: { facebook, zalo, web, ...channels },
    notifier: notifier === undefined ? createNotifier({ zalo, lark }) : notifier,
  });

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  app.use('/webhooks', webhookRoutes({ hub, zalo, lark, facebook }));
  app.use('/api/chat', (req, res, next) => {
    res.set('access-control-allow-origin', '*');
    res.set('access-control-allow-headers', 'content-type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  }, webchatRoutes({ hub }));
  app.use('/api/admin', adminRoutes({ hub }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(express.static(path.join(ROOT, 'public')));

  return { app, hub, store };
}

// Chạy trực tiếp: node src/server.js
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'src', 'server.js')) {
  const store = new Store(config.dataFile);
  if (!store.all('products').length && fs.existsSync(path.join(ROOT, 'data', 'seed.json'))) {
    const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed.json'), 'utf8'));
    for (const p of seed.products || []) store.insert('products', p);
    for (const k of seed.knowledge || []) store.insert('knowledge', k);
    if (seed.settings) store.updateSettings(seed.settings);
    store.flush();
    console.log(`Đã nạp dữ liệu mẫu: ${seed.products?.length || 0} sản phẩm`);
  }

  let llm = null;
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN || process.env.ANTHROPIC_PROFILE) llm = createLLM();
  else console.warn('⚠️  Chưa có ANTHROPIC_API_KEY — trợ lý sẽ chuyển mọi tin nhắn cho chủ shop.');

  if (config.adminToken === 'doi-mat-khau-nay') console.warn('⚠️  Đang dùng ADMIN_TOKEN mặc định — hãy đổi trong .env trước khi đưa lên mạng.');

  const { app, hub } = createApp({ store, llm });
  app.listen(config.port, () => {
    console.log(`Trợ lý bán hàng chạy tại ${config.publicUrl} (cổng ${config.port})`);
    console.log(`Dashboard: ${config.publicUrl}/  •  Demo web chat: ${config.publicUrl}/demo.html`);
  });

  const cycle = () => runLearningCycle({ llm, store, hooks: hub.learningHooks() })
    .then((r) => r.graded && console.log(`[tự học] đã chấm ${r.graded} hội thoại`))
    .catch((err) => console.warn('[tự học]', err.message));
  setInterval(cycle, config.learningIntervalMinutes * 60_000).unref();

  const shutdown = () => { store.flush(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
