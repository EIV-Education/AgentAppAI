import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

// Kho dữ liệu JSON đơn giản: đọc toàn bộ vào bộ nhớ, ghi xuống đĩa theo lô.
// Đủ cho một shop vài nghìn hội thoại/tháng; khi lớn hơn hãy chuyển sang Postgres/SQLite.

const COLLECTIONS = ['products', 'conversations', 'messages', 'orders', 'leads', 'knowledge', 'lessons', 'examples'];
const PREFIX = { conversations: 'C', messages: 'M', orders: 'D', leads: 'KH', knowledge: 'K', lessons: 'L', examples: 'VD', products: 'SP' };

export function defaultSettings() {
  return {
    botPaused: false,
    // 'order': shop bán hàng (báo giá, đơn nháp, phí ship) · 'lead': thu thập nhu cầu + liên hệ, chuyển chuyên viên tư vấn
    salesMode: 'order',
    // 'natural': nói chuyện tự nhiên, kịch bản chỉ để định hướng · 'script': bám sát câu mẫu
    replyStyle: 'natural',
    // Bật/tắt AI tự trả lời theo từng kênh (tắt: tin vẫn lưu vào dashboard để người trả lời)
    aiChannels: { facebook: true, zalo: true, web: true },
    shop: {
      name: 'Shop của bạn',
      description: '',
      hotline: '',
      workingHours: '8:00 - 21:00 hằng ngày',
      tone: 'Thân thiện, xưng "em", gọi khách là "anh/chị", ngắn gọn, dùng tiếng Việt có dấu.',
      greeting: '', // lời chào đầu tiên trên widget web
      playbook: '', // kịch bản tư vấn: các bước hỏi, mẫu câu trả lời
    },
    // Nhắn nhắc khách một lần khi khách im lặng sau câu trả lời của trợ lý
    followUp: { enabled: false, afterMinutes: 60, text: '' },
    policies: {
      shipping: '',
      returns: '',
      payment: '',
      warranty: '',
    },
    // Phí ship: theo khu vực, miễn phí khi đơn đạt ngưỡng
    shippingRules: {
      freeShipThreshold: 0,
      zones: [{ name: 'Toàn quốc', provinces: [], fee: 30000, days: '2-4 ngày' }],
    },
    learning: {
      autoApproveKnowledge: false, // true: kiến thức tự học được dùng ngay, không cần duyệt
      autoGrade: true,
      lowScoreAlert: 6, // điểm AI chấm < ngưỡng này sẽ báo chủ shop
      autoLearnExamples: true, // rút hội thoại mẫu từ các cuộc trò chuyện tốt
      exampleMinScore: 8,
      autoApproveExamples: true, // false: mẫu mới chờ duyệt trong tab Bài học
    },
    // Đẩy khách tiềm năng lên CRM Lark Base
    crm: { enabled: false, baseUrl: '', fieldMap: {} },
    zaloOwnerIds: [], // ID Zalo được điều khiển trợ lý (ngoài ZALO_OWNER_IDS trong .env)
    notifyOnNewOrder: true,
    notifyOnNewLead: true,
    notifyOnEscalation: true,
  };
}

export class Store {
  constructor(file = path.join(ROOT, 'data', 'db.json')) {
    this.file = file;
    this.data = null;
    this.timer = null;
    this.load();
  }

  load() {
    let raw = {};
    if (this.file !== ':memory:' && fs.existsSync(this.file)) {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    }
    const base = { counters: {}, settings: defaultSettings(), integrations: {} };
    for (const c of COLLECTIONS) base[c] = [];
    this.data = { ...base, ...raw, settings: mergeDeep(defaultSettings(), raw.settings || {}) };
  }

  save() {
    if (this.file === ':memory:') return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 200);
  }

  flush() {
    if (this.file === ':memory:') return;
    clearTimeout(this.timer);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }

  nextId(collection) {
    const n = (this.data.counters[collection] || 0) + 1;
    this.data.counters[collection] = n;
    return `${PREFIX[collection] || 'X'}${n}`;
  }

  all(collection) {
    return this.data[collection];
  }

  get(collection, id) {
    if (!id) return null;
    const key = String(id).toUpperCase();
    return this.data[collection].find((x) => String(x.id).toUpperCase() === key) || null;
  }

  find(collection, pred) {
    return this.data[collection].filter(pred);
  }

  insert(collection, doc) {
    const now = new Date().toISOString();
    const item = { id: doc.id || this.nextId(collection), createdAt: now, updatedAt: now, ...doc };
    this.data[collection].push(item);
    this.save();
    return item;
  }

  update(collection, id, patch) {
    const item = this.get(collection, id);
    if (!item) return null;
    Object.assign(item, patch, { updatedAt: new Date().toISOString() });
    this.save();
    return item;
  }

  remove(collection, id) {
    const item = this.get(collection, id);
    if (!item) return false;
    this.data[collection] = this.data[collection].filter((x) => x !== item);
    this.save();
    return true;
  }

  get settings() {
    return this.data.settings;
  }

  updateSettings(patch) {
    this.data.settings = mergeDeep(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }
}

function mergeDeep(target, src) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target?.[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      out[k] = mergeDeep(target[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
