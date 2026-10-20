import test from 'node:test';
import assert from 'node:assert/strict';
import { makeHub } from './helpers.js';
import { createCrm, parseBaseUrl, buildFields, guessMap } from '../src/crm.js';
import { runTool } from '../src/agent/tools.js';

const FIELDS = [
  { field_name: 'Tên khách hàng', type: 1 }, { field_name: 'Số điện thoại', type: 13 }, { field_name: 'Nhu cầu', type: 1 },
  { field_name: 'Địa chỉ', type: 1 }, { field_name: 'Nguồn', type: 3 }, { field_name: 'Ngày nhận', type: 5 }, { field_name: 'Người tạo', type: 1003 },
];

function fakeApi() {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path.includes('/fields')) return { items: FIELDS };
    if (method === 'POST') return { record: { record_id: 'rec123' } };
    return { record: { record_id: 'rec123' } };
  };
  return { api, calls };
}

test('đọc link Base của EIV đúng app_token và table_id', () => {
  assert.deepEqual(parseBaseUrl('https://eiveducation.sg.larksuite.com/base/FfIXb8Tf2aEyX3seWEllZof9gtc?table=tblckO9AXEQ4pLvP&view=vewhN2B2MS'),
    { appToken: 'FfIXb8Tf2aEyX3seWEllZof9gtc', tableId: 'tblckO9AXEQ4pLvP' });
  assert.throws(() => parseBaseUrl('https://example.com'), /Link Base/);
});

test('đoán cột theo tên và chuyển giá trị theo loại cột', () => {
  const map = guessMap(FIELDS);
  assert.equal(map.contactName, 'Tên khách hàng');
  assert.equal(map.phone, 'Số điện thoại');
  assert.equal(map.needs, 'Nhu cầu');
  assert.equal(map.address, 'Địa chỉ');
  assert.equal(map.source, 'Nguồn');
  assert.equal(map.createdAt, 'Ngày nhận');
  const f = buildFields({ id: 'KH1', contactName: 'Lan', phone: '0912345678', needs: 'bé 6 tuổi', area: 'Hà Nội', channel: 'zalo', createdAt: '2026-10-20T03:00:00Z' }, map, FIELDS);
  assert.equal(f['Địa chỉ'], 'Hà Nội'); // chưa có địa chỉ cụ thể -> dùng khu vực
  assert.equal(f['Nguồn'], 'Zalo');
  assert.equal(f['Ngày nhận'], Date.parse('2026-10-20T03:00:00Z'));
  assert.ok(!('Người tạo' in f));
});

test('khách mới do trợ lý thu thập tự lên CRM; bổ sung thông tin thì cập nhật đúng dòng đó', async () => {
  const h = makeHub();
  const { api, calls } = fakeApi();
  h.store.updateSettings({ crm: { enabled: true, baseUrl: 'https://x.larksuite.com/base/APP1?table=tblT1', fieldMap: guessMap(FIELDS) } });
  h.hub.crm = createCrm({ store: h.store, api });
  const conv = h.hub.getOrCreateConversation('zalo', 'z1', 'Chị Lan');
  const ctx = { store: h.store, conversation: conv, hooks: { onLead: (l) => h.hub.onLead(l), onLeadUpdate: (l) => h.hub.syncLead(l) } };
  const r = await runTool('create_lead', { segment: 'kids', phone: '0912345678', needs: 'Bé 6 tuổi học giao tiếp', area: 'Hà Nội' }, ctx);
  await new Promise((res) => setTimeout(res, 10));
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.path, '/open-apis/bitable/v1/apps/APP1/tables/tblT1/records');
  assert.equal(post.body.fields['Tên khách hàng'], 'Chị Lan');
  assert.equal(post.body.fields['Số điện thoại'], '0912345678');
  assert.equal(h.store.get('leads', r.lead_id).crmRecordId, 'rec123');

  await runTool('create_lead', { segment: 'kids', phone: '0912345678', needs: '', address: '12 Láng Hạ, Đống Đa' }, ctx);
  await new Promise((res) => setTimeout(res, 10));
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.path, '/open-apis/bitable/v1/apps/APP1/tables/tblT1/records/rec123');
  assert.equal(put.body.fields['Địa chỉ'], '12 Láng Hạ, Đống Đa');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
});

test('CRM lỗi (chưa cấp quyền) thì ghi lỗi, gửi lại được khi đã sửa', async () => {
  const h = makeHub();
  let fail = true;
  const api = async (method, path) => {
    if (path.includes('/fields')) return { items: FIELDS };
    if (fail) throw new Error('Lark lỗi 91403: Forbidden');
    return { record: { record_id: 'recOK' } };
  };
  h.store.updateSettings({ crm: { enabled: true, baseUrl: 'https://x.larksuite.com/base/APP1?table=tblT1', fieldMap: guessMap(FIELDS) } });
  const crm = createCrm({ store: h.store, api });
  const lead = h.store.insert('leads', { status: 'new', channel: 'manual', contactName: 'Minh', phone: '0987654321', needs: 'IELTS' });
  assert.equal(await crm.sync(lead), null);
  assert.match(h.store.get('leads', lead.id).crmError, /91403/);
  fail = false;
  assert.equal(await crm.retryPending(), 1);
  assert.equal(h.store.get('leads', lead.id).crmRecordId, 'recOK');
  assert.equal(h.store.get('leads', lead.id).crmError, null);
});

test('CRM chưa bật thì không gọi Lark', async () => {
  const h = makeHub();
  const { api, calls } = fakeApi();
  const crm = createCrm({ store: h.store, api });
  assert.equal(await crm.sync({ id: 'KH1' }), null);
  assert.equal(calls.length, 0);
});

test('tên khách: cá nhân dùng tên Zalo/Facebook; trường/trung tâm dùng tên trường, người liên hệ là tên Zalo', async () => {
  const fields = [
    { field_name: 'Tên khách hàng', type: 1 }, { field_name: 'Người liên hệ', type: 1 }, { field_name: 'Trạng thái liên hệ', type: 3 },
    { field_name: 'Số điện thoại', type: 13 }, { field_name: 'Nguồn', type: 3 },
  ];
  const map = guessMap(fields);
  assert.equal(map.contactPerson, 'Người liên hệ');
  assert.equal(map.status, 'Trạng thái liên hệ');
  assert.equal(map.contactName, 'Tên khách hàng');

  const h = makeHub();
  const fbConv = h.hub.getOrCreateConversation('facebook', 'p1', 'Trần Thu Hà');
  const zConv = h.hub.getOrCreateConversation('zalo', 'z1', 'Cô Mai Anh');
  const r1 = await runTool('create_lead', { segment: 'kids', phone: '0912345678', needs: 'bé 6 tuổi', contact_name: 'Hà' }, { store: h.store, conversation: fbConv, hooks: {} });
  const r2 = await runTool('create_lead', { segment: 'school_center', phone: '0987654321', needs: 'cần 2 GV cho tiểu học', organization: 'Trường Tiểu học Ánh Dương' }, { store: h.store, conversation: zConv, hooks: {} });
  const personal = buildFields(h.store.get('leads', r1.lead_id), map, fields);
  assert.equal(personal['Tên khách hàng'], 'Trần Thu Hà'); // ưu tiên tên Facebook
  assert.equal(personal['Nguồn'], 'Facebook');
  const school = buildFields(h.store.get('leads', r2.lead_id), map, fields);
  assert.equal(school['Tên khách hàng'], 'Trường Tiểu học Ánh Dương');
  assert.equal(school['Người liên hệ'], 'Cô Mai Anh');
  assert.equal(school['Nguồn'], 'Zalo');
});

test('lấy được tên Zalo sau khi đã có khách tiềm năng: điền tên thật thay "chưa rõ tên" và cập nhật CRM', async () => {
  const h = makeHub();
  const { api, calls } = fakeApi();
  h.store.updateSettings({ crm: { enabled: true, baseUrl: 'https://x.larksuite.com/base/APP1?table=tblT1', fieldMap: guessMap(FIELDS) } });
  h.hub.crm = createCrm({ store: h.store, api });
  const conv = h.hub.getOrCreateConversation('zalo', 'z9');
  const ctx = { store: h.store, conversation: conv, hooks: { onLead: (l) => h.hub.onLead(l) } };
  const r = await runTool('create_lead', { segment: 'school_center', phone: '0905458372', needs: 'GV mầm non', contact_name: 'Anh (chưa rõ tên)', organization: 'Trường ABC' }, ctx);
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(h.store.get('leads', r.lead_id).contactName, '');
  h.hub.getOrCreateConversation('zalo', 'z9', 'Lê Văn Bình'); // tin nhắn sau lấy được tên
  await new Promise((res) => setTimeout(res, 10));
  assert.equal(h.store.get('leads', r.lead_id).contactName, 'Lê Văn Bình');
  const put = calls.find((c) => c.method === 'PUT');
  assert.equal(put.body.fields['Tên khách hàng'], 'Trường ABC');
});
