import { Store } from '../src/db.js';
import { Hub } from '../src/core/hub.js';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.js';

// LLM giả: trả lần lượt các phản hồi đã kịch bản hoá, ghi lại mọi request
export function fakeLLM(script) {
  const calls = [];
  return {
    calls,
    async create(params) {
      calls.push(structuredClone(params));
      const next = script.shift();
      if (!next) throw new Error('Hết kịch bản LLM giả');
      return typeof next === 'function' ? next(params) : next;
    },
  };
}

export const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
export const tool = (name, input, id = `tu_${Math.random().toString(36).slice(2)}`) => ({
  stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }],
});

export function seededStore() {
  const store = new Store(':memory:');
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'seed.json'), 'utf8'));
  for (const p of seed.products) store.insert('products', p);
  for (const k of seed.knowledge) store.insert('knowledge', k);
  store.updateSettings(seed.settings);
  return store;
}

export function makeHub(script = []) {
  const store = seededStore();
  const llm = fakeLLM(script);
  const sent = [];
  const notes = [];
  const channel = (name) => ({ name, enabled: () => true, async send(id, t) { sent.push({ channel: name, id, text: t }); } });
  const hub = new Hub({
    store, llm,
    channels: { facebook: channel('facebook'), zalo: channel('zalo'), web: channel('web') },
    notifier: { async send(t) { notes.push(t); } },
  });
  return { store, llm, hub, sent, notes };
}
