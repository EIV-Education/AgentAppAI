import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

// Gói dữ liệu dựng sẵn (data/profiles/*.json): cài đặt, kịch bản, catalog, kiến thức, bài học.
const DIR = path.join(ROOT, 'data', 'profiles');

export function listProfiles() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => {
    const p = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    return { id: f.replace(/\.json$/, ''), name: p.name || f, description: p.description || '' };
  });
}

export function loadProfile(id) {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('Tên gói không hợp lệ');
  const file = path.join(DIR, `${id}.json`);
  if (!fs.existsSync(file)) throw new Error(`Không có gói ${id}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Thay catalog và kiến thức dựng sẵn bằng gói mới; giữ nguyên hội thoại, đơn, khách tiềm năng
// và kiến thức/bài học chủ shop tự dạy.
export function applyProfile(store, profile) {
  if (profile.settings) store.updateSettings(profile.settings);

  for (const p of [...store.all('products')]) store.remove('products', p.id);
  for (const p of profile.products || []) store.insert('products', p);

  for (const k of store.find('knowledge', (x) => x.source === 'seed' || x.source === 'profile')) store.remove('knowledge', k.id);
  for (const k of profile.knowledge || []) store.insert('knowledge', { status: 'approved', ...k, source: 'profile' });

  const have = new Set(store.all('lessons').map((l) => l.text));
  let lessons = 0;
  for (const text of profile.lessons || []) {
    if (have.has(text)) continue;
    store.insert('lessons', { text, status: 'active', source: 'profile' });
    lessons++;
  }
  store.flush();
  return { products: (profile.products || []).length, knowledge: (profile.knowledge || []).length, lessons };
}
