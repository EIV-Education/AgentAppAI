import { larkApi } from './channels/lark.js';
import { normalize } from './catalog.js';

// Đẩy khách tiềm năng lên CRM Lark Base (Bitable): mỗi khách là một dòng, cập nhật lại khi có thêm thông tin.

export const LEAD_ATTRS = {
  contactName: 'Tên khách hàng',
  phone: 'Số điện thoại / Zalo',
  needs: 'Nhu cầu / mục đích',
  address: 'Địa chỉ (hoặc khu vực nếu khách chưa cho địa chỉ)',
  area: 'Khu vực',
  email: 'Email',
  segment: 'Nhóm khách',
  channel: 'Kênh liên hệ',
  source: 'Nguồn (Trợ lý AI – kênh)',
  status: 'Trạng thái',
  note: 'Ghi chú',
  createdAt: 'Ngày tạo',
  leadId: 'Mã khách trong trợ lý (KH…)',
};

const SEGMENT = { school_center: 'Trường học/Trung tâm', business: 'Doanh nghiệp', kids: 'Cá nhân – Trẻ em', adult: 'Cá nhân – Người đi làm', other: 'Khác' };
const STATUS = { new: 'Mới', contacted: 'Đã liên hệ', won: 'Đã chốt', lost: 'Không thành' };
const CHANNEL = { facebook: 'Facebook', zalo: 'Zalo', web: 'Website', manual: 'Nhập tay' };

// Loại cột Lark Base ghi được: 1 văn bản, 2 số, 3 chọn một, 4 chọn nhiều, 5 ngày, 7 checkbox, 13 điện thoại, 15 liên kết
const WRITABLE = new Set([1, 2, 3, 4, 5, 7, 13, 15]);

export function parseBaseUrl(url = '') {
  const appToken = String(url).match(/\/base\/([A-Za-z0-9]+)/)?.[1];
  const tableId = String(url).match(/[?&]table=(tbl[A-Za-z0-9]+)/)?.[1];
  if (!appToken || !tableId) throw new Error('Link Base chưa đúng: cần dạng https://…larksuite.com/base/<mã>?table=tbl…');
  return { appToken, tableId };
}

export function leadValue(lead, attr) {
  switch (attr) {
    case 'address': return lead.address || lead.area || '';
    case 'segment': return SEGMENT[lead.segment] || lead.segment || '';
    case 'channel': return CHANNEL[lead.channel] || lead.channel || '';
    case 'source': return `Trợ lý AI – ${CHANNEL[lead.channel] || lead.channel || ''}`;
    case 'status': return STATUS[lead.status] || lead.status || '';
    case 'createdAt': return lead.createdAt;
    case 'leadId': return lead.id;
    default: return lead[attr] ?? '';
  }
}

function convert(value, type) {
  if (value === '' || value == null) return undefined;
  switch (type) {
    case 2: { const n = Number(String(value).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : undefined; }
    case 4: return [String(value)];
    case 5: { const t = new Date(value).getTime(); return Number.isFinite(t) ? t : undefined; }
    case 7: return !!value;
    case 15: return { text: String(value), link: String(value) };
    default: return String(value);
  }
}

export function buildFields(lead, fieldMap, larkFields) {
  const byName = new Map(larkFields.map((f) => [f.field_name, f]));
  const out = {};
  for (const [attr, fieldName] of Object.entries(fieldMap || {})) {
    const f = byName.get(fieldName);
    if (!f || !WRITABLE.has(f.type)) continue;
    const v = convert(leadValue(lead, attr), f.type);
    if (v !== undefined) out[fieldName] = v;
  }
  return out;
}

// Đoán cột tương ứng theo tên (không dấu)
const GUESS = [
  ['phone', /(sdt|so dien thoai|dien thoai|phone|zalo|so dt)/],
  ['email', /(email|mail)/],
  ['needs', /(nhu cau|muc dich|need|yeu cau)/],
  ['address', /(dia chi|address)/],
  ['area', /(khu vuc|tinh|thanh pho|area|city)/],
  ['segment', /(nhom|phan loai|loai khach|doi tuong|segment)/],
  ['channel', /(kenh|channel)/],
  ['source', /(nguon|source)/],
  ['status', /(trang thai|status|tinh trang)/],
  ['note', /(ghi chu|note)/],
  ['createdAt', /(ngay|date|thoi gian)/],
  ['contactName', /(ten|name|khach hang|ho ten)/],
];
export function guessMap(larkFields) {
  const used = new Set();
  const map = {};
  for (const [attr, re] of GUESS) {
    const f = larkFields.find((x) => WRITABLE.has(x.type) && !used.has(x.field_name) && re.test(normalize(x.field_name)));
    if (f) { map[attr] = f.field_name; used.add(f.field_name); }
  }
  return map;
}

export function createCrm({ store, api = larkApi }) {
  let fieldsCache = { key: '', at: 0, items: [] };
  const conf = () => store.settings.crm || {};

  async function listFields(baseUrl = conf().baseUrl) {
    const { appToken, tableId } = parseBaseUrl(baseUrl);
    const key = `${appToken}/${tableId}`;
    if (fieldsCache.key === key && Date.now() - fieldsCache.at < 10 * 60_000) return fieldsCache.items;
    const data = await api('GET', `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`);
    const items = (data.items || []).map((f) => ({ field_name: f.field_name, type: f.type, writable: WRITABLE.has(f.type) }));
    fieldsCache = { key, at: Date.now(), items };
    return items;
  }

  async function sync(lead) {
    const c = conf();
    if (!c.enabled || !c.baseUrl) return null;
    try {
      const { appToken, tableId } = parseBaseUrl(c.baseUrl);
      const fields = buildFields(lead, c.fieldMap, await listFields(c.baseUrl));
      if (!Object.keys(fields).length) throw new Error('Chưa ghép cột nào với CRM (Cài đặt → CRM Lark Base)');
      const base = `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`;
      let recordId = lead.crmRecordId;
      if (recordId) await api('PUT', `${base}/${recordId}`, { fields });
      else recordId = (await api('POST', base, { fields })).record?.record_id;
      return store.update('leads', lead.id, { crmRecordId: recordId, crmSyncedAt: new Date().toISOString(), crmError: null });
    } catch (err) {
      console.warn(`[crm] ${lead.id}:`, err.message);
      store.update('leads', lead.id, { crmError: err.message });
      return null;
    }
  }

  // Gửi lại các khách chưa lên CRM (lỗi mạng, chưa cấp quyền...)
  async function retryPending() {
    if (!conf().enabled) return 0;
    let n = 0;
    for (const l of store.find('leads', (x) => !x.crmRecordId && x.crmError)) if (await sync(l)) n++;
    return n;
  }

  return { listFields, sync, retryPending, enabled: () => !!(conf().enabled && conf().baseUrl) };
}
