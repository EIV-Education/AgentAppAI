import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';

// Lớp mỏng quanh Claude API để dễ thay bằng bản giả lập khi test.
// Bật fallback phía server: nếu bộ lọc an toàn từ chối, API tự chạy lại trên model dự phòng.
export function createLLM() {
  const client = new Anthropic();
  return {
    model: config.anthropic.model,
    async create(params) {
      return client.beta.messages.create({
        model: config.anthropic.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        ...params,
      });
    },
  };
}

export function textOf(response) {
  return response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}
