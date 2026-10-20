// Dashboard quản trị — JS thuần, không cần build.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => (n == null ? '–' : `${Number(n).toLocaleString('vi-VN')}đ`);
const time = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const CH = { facebook: 'FB', zalo: 'Zalo', web: 'Web', manual: 'Nhập tay' };

let TOKEN = '';
try { TOKEN = localStorage.getItem('adminToken') || ''; } catch { /* trình duyệt chặn lưu trữ */ }
let currentConv = null;
let currentTab = 'inbox';

async function api(path, opts = {}) {
  const res = await fetch(`/api/admin${path}`, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) { showLogin(); throw new Error('Sai mã quản trị'); }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3500);
}
const run = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(`❌ ${e.message}`); } };

// ---------- đăng nhập ----------
function showLogin() { $('#login').classList.remove('hidden'); $('#app').classList.add('hidden'); }
$('#loginForm').onsubmit = run(async (e) => {
  e.preventDefault();
  TOKEN = $('#tokenInput').value.trim();
  await api('/overview');
  try { localStorage.setItem('adminToken', TOKEN); } catch { /* bỏ qua */ }
  start();
});

// ---------- tabs ----------
$('#tabs').onclick = (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  currentTab = b.dataset.tab;
  document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('[data-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.view !== currentTab));
  loaders[currentTab]?.();
};

// ---------- tổng quan ----------
async function loadOverview() {
  const o = await api('/overview');
  const ch = o.channels;
  const dot = (on) => (on ? '🟢' : '⚪');
  $('#stats').innerHTML = [
    [o.conversations, `Hội thoại (FB ${o.byChannel.facebook} · Zalo ${o.byChannel.zalo} · Web ${o.byChannel.web})`],
    [o.needsHuman, 'Đang chờ bạn'],
    ...(o.salesMode === 'lead'
      ? [[o.newLeads, 'Khách tiềm năng chưa liên hệ'], [o.leads, 'Tổng khách tiềm năng']]
      : [[o.pendingOrders, 'Đơn nháp chờ duyệt'], [vnd(o.confirmedRevenue), 'Doanh số đã duyệt']]),
    [o.avgScore ?? '–', `Điểm AI TB (${o.hallucinations} lần bịa)`],
    [`${dot(ch.facebook)} ${dot(ch.zalo)} ${dot(ch.web)} ${dot(ch.lark)}`, 'FB · Zalo · Web · Lark'],
  ].map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('')
    + (ch.ai ? '' : '<div class="stat" style="border-color:var(--bad)"><b>⚠️</b><span>Chưa có ANTHROPIC_API_KEY</span></div>');
  const btn = $('#pauseBtn');
  btn.textContent = o.botPaused ? '⏸ AI đang tạm dừng – Bật lại' : '▶️ AI đang trực – Tạm dừng';
  btn.className = `pause ${o.botPaused ? 'off' : 'on'}`;
  btn.onclick = run(async () => {
    await api('/command', { method: 'POST', body: { text: o.botPaused ? '/tieptuc' : '/tamdung' } });
    loadOverview();
  });
  const badge = (id, n) => { const el = $(id); el.textContent = n; el.classList.toggle('hidden', !n); };
  badge('#badgeHuman', o.needsHuman);
  badge('#badgeOrders', o.pendingOrders);
  badge('#badgeLeads', o.newLeads);
  // Chế độ khách tiềm năng thì ẩn tab Đơn nháp
  document.querySelector('[data-tab=orders]').classList.toggle('hidden', o.salesMode === 'lead' && !o.pendingOrders);
  badge('#badgeKnow', o.knowledgePending);
}

// ---------- hội thoại ----------
const scoreTag = (g) => (g ? `<span class="tag score ${g.score >= 8 ? 'good' : g.score >= 6 ? 'mid' : 'low'}">${g.score}/10</span>` : '');

async function loadConvs() {
  const q = new URLSearchParams({ channel: $('#fChannel').value, filter: $('#fFilter').value });
  const list = await api(`/conversations?${q}`);
  $('#convs').innerHTML = list.map((c) => `
    <li data-id="${c.id}" class="${c.id === currentConv ? 'active' : ''}">
      <div class="top"><span><span class="ch ${c.channel}">${CH[c.channel]}</span> <b>${esc(c.customerName || 'Khách')}</b> <span class="muted small">${c.id}</span></span><span class="muted small">${time(c.lastMessageAt)}</span></div>
      <div class="last">${c.unread ? `<b>(${c.unread})</b> ` : ''}${esc(c.lastMessage || '')}</div>
      <div>${c.needsHuman ? '<span class="tag human">Cần bạn</span>' : ''}${c.handoverUntil && new Date(c.handoverUntil) > new Date() ? '<span class="tag">Bạn đang trả lời</span>' : ''}${scoreTag(c.grade)}${c.ownerRating ? `<span class="tag">⭐${c.ownerRating.rating}</span>` : ''}</div>
    </li>`).join('') || '<li class="muted">Chưa có hội thoại</li>';
}
$('#convs').onclick = (e) => { const li = e.target.closest('li[data-id]'); if (li) openConv(li.dataset.id); };
$('#fChannel').onchange = $('#fFilter').onchange = run(loadConvs);

async function openConv(id) {
  currentConv = id;
  const d = await api(`/conversations/${id}`);
  const c = d.conversation;
  const g = c.grade;
  $('#convDetail').innerHTML = `
    <div class="convHead">
      <span class="title"><span class="ch ${c.channel}">${CH[c.channel]}</span> ${esc(c.customerName || 'Khách')} · ${c.id}</span>
      <span class="muted small">${d.aiActive ? '🤖 AI đang trả lời' : '🧑‍💼 AI đang im'}</span>
      <button id="btnHand">${d.aiActive ? 'Tiếp quản' : 'Trả cho AI'}</button>
      ${c.needsHuman ? '<button id="btnResolve">Đã xử lý</button>' : ''}
      <button id="btnGrade">AI chấm điểm</button>
      <button id="btnRate">⭐ Chấm</button>
      <button id="btnTeach" class="primary">🎓 Dạy</button>
    </div>
    ${c.needsHuman && c.escalation ? `<div class="gradeBox">🙋 <b>Cần bạn:</b> ${esc(c.escalation.question)}</div>` : ''}
    ${g ? `<div class="gradeBox"><b>Điểm ${g.score}/10</b> · chính xác ${g.accuracy} · hữu ích ${g.helpfulness} · giọng ${g.tone} · bán hàng ${g.sales} · tự nhiên ${g.naturalness ?? '–'}${g.hallucination ? ' · <b style="color:var(--bad)">CÓ BỊA</b>' : ''}<br>${esc(g.summary)}${g.issues.length ? `<ul>${g.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}${g.betterReply ? `<div class="muted">Gợi ý: ${esc(g.betterReply)}</div>` : ''}</div>` : ''}
    ${d.orders.map((o) => `<div class="gradeBox">🛒 Đơn ${o.id} – ${vnd(o.total)} – <b>${o.status}</b></div>`).join('')}
    <div class="msgs" id="msgs">${d.messages.map(renderMsg).join('')}</div>
    <form class="composer" id="composer">
      <textarea id="replyText" rows="2" placeholder="Trả lời khách thay AI (AI sẽ im một lúc)…"></textarea>
      <div class="row"><label class="small"><input type="checkbox" id="learnChk" checked> Cho trợ lý học từ câu trả lời này</label><span style="flex:1"></span><button class="primary">Gửi</button></div>
    </form>`;
  $('#msgs').scrollTop = 1e9;
  $('#btnHand').onclick = run(async () => { await api(`/conversations/${id}/handover`, { method: 'POST', body: { on: d.aiActive } }); openConv(id); });
  $('#btnResolve')?.addEventListener('click', run(async () => { await api(`/conversations/${id}/resolve`, { method: 'POST' }); openConv(id); refresh(); }));
  $('#btnGrade').onclick = run(async () => { toast('Đang chấm…'); await api(`/conversations/${id}/grade`, { method: 'POST' }); openConv(id); loadConvs(); });
  $('#btnRate').onclick = () => dialog('Chấm hội thoại', [['rating', 'Số sao (1-5)', 'number'], ['note', 'Ghi chú', 'textarea']], run(async (v) => {
    await api(`/conversations/${id}/rate`, { method: 'POST', body: v }); openConv(id); loadConvs();
  }));
  $('#btnTeach').onclick = () => dialog('Dạy trợ lý', [['feedback', 'Trợ lý nên làm gì khác? (sẽ thành bài học áp dụng cho mọi hội thoại sau)', 'textarea']], run(async (v) => {
    const l = await api(`/conversations/${id}/teach`, { method: 'POST', body: v });
    toast(`🎓 Đã thêm bài học: ${l.text}`);
  }));
  $('#composer').onsubmit = run(async (e) => {
    e.preventDefault();
    const text = $('#replyText').value.trim();
    if (!text) return;
    await api(`/conversations/${id}/reply`, { method: 'POST', body: { text, learn: $('#learnChk').checked } });
    openConv(id);
    refresh();
  });
  loadConvs();
}

function renderMsg(m) {
  const who = { customer: '👤 Khách', bot: '🤖 AI', human: `🧑‍💼 ${m.by || 'Bạn'}` }[m.role] || m.role;
  const trace = (m.trace || []).length
    ? `<details><summary>${m.trace.length} lần tra cứu</summary><pre>${esc(m.trace.map((t) => `${t.tool} ${JSON.stringify(t.input)}\n→ ${JSON.stringify(t.result)}`).join('\n\n'))}</pre></details>` : '';
  return `<div class="msg ${m.role}">${esc(m.text)}${trace}<div class="meta">${who} · ${time(m.createdAt)}${m.escalated ? ' · đã báo bạn' : ''}</div></div>`;
}

// ---------- đơn nháp ----------
async function loadOrders() {
  const list = await api(`/orders?status=${$('#oStatus').value}`);
  $('#orders').innerHTML = list.map((o) => `
    <div class="card">
      <div class="row"><b>${o.id}</b><span class="ch ${o.channel}">${CH[o.channel]}</span><span class="muted small">${time(o.createdAt)} · ${o.conversationId}</span><span class="tag">${o.status}</span></div>
      <div>${o.items.map((i) => `${esc(i.name)}${i.variant ? ` (${esc(i.variant)})` : ''} × ${i.quantity} = ${vnd(i.total)}`).join('<br>')}</div>
      <div class="muted">Ship ${vnd(o.shippingFee)} · <b>Tổng ${vnd(o.total)}</b></div>
      <div>${esc(o.customer.name)} – ${esc(o.customer.phone)}<br>${esc(o.customer.address)}</div>
      ${o.note ? `<div class="muted">Ghi chú: ${esc(o.note)}</div>` : ''}
      ${o.status === 'pending' ? `<div class="row"><button class="primary" data-approve="${o.id}">Duyệt & báo khách</button><button data-ship="${o.id}">Sửa phí ship</button><button class="danger" data-reject="${o.id}">Huỷ</button></div>` : ''}
    </div>`).join('') || '<p class="muted">Không có đơn.</p>';
}
$('#oStatus').onchange = run(loadOrders);
$('#orders').onclick = run(async (e) => {
  const t = e.target;
  if (t.dataset.approve) { await api(`/orders/${t.dataset.approve}/approve`, { method: 'POST' }); toast('✅ Đã duyệt và báo khách'); refresh(); loadOrders(); }
  if (t.dataset.reject) dialog(`Huỷ đơn ${t.dataset.reject}`, [['reason', 'Lý do gửi cho khách (để trống nếu không muốn báo)', 'textarea']], run(async (v) => { await api(`/orders/${t.dataset.reject}/reject`, { method: 'POST', body: v }); refresh(); loadOrders(); }));
  if (t.dataset.ship) dialog('Sửa phí ship', [['shippingFee', 'Phí ship (VND)', 'number']], run(async (v) => { await api(`/orders/${t.dataset.ship}`, { method: 'PUT', body: v }); loadOrders(); }));
});

// ---------- khách tiềm năng ----------
const SEG = { school_center: 'Trường học/Trung tâm', business: 'Doanh nghiệp', kids: 'Cá nhân – Trẻ em', adult: 'Cá nhân – Người đi làm', other: 'Khác' };
const L_STATUS = { new: '🆕 Chưa liên hệ', contacted: '📞 Đã liên hệ', won: '✅ Đã chốt', lost: '✖ Không thành' };
let leads = [];
async function loadLeads() {
  leads = await api(`/leads?status=${$('#lStatus').value}`);
  $('#leads').innerHTML = leads.map((l) => `
    <div class="card">
      <div class="row"><b>${l.id}</b><span class="ch ${l.channel}">${CH[l.channel]}</span><span class="tag">${SEG[l.segment] || esc(l.segment)}</span><span class="muted small">${time(l.createdAt)}${l.conversationId ? ` · ${l.conversationId}` : ''}</span></div>
      <div><b>${esc(l.contactName || 'Khách')}</b> – <a href="tel:${esc(l.phone)}">${esc(l.phone)}</a>${l.email ? ` – ${esc(l.email)}` : ''}</div>
      ${l.address || l.area ? `<div class="muted">Địa chỉ: ${esc([l.address, l.area].filter(Boolean).join(' – '))}</div>` : ''}
      <div>${esc(l.needs)}</div>
      ${l.note ? `<div class="muted">Ghi chú: ${esc(l.note)}</div>` : ''}
      <div class="row"><select data-lead="${l.id}">${Object.entries(L_STATUS).map(([k, v]) => `<option value="${k}" ${k === l.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <button data-edit="${l.id}">Sửa</button><button data-note="${l.id}">Ghi chú</button>${l.conversationId ? `<button data-conv="${l.conversationId}">Xem hội thoại</button>` : ''}</div>
      ${l.crmRecordId ? `<div class="muted small">✅ Đã lên CRM ${time(l.crmSyncedAt)}</div>` : l.crmError ? `<div class="small" style="color:var(--bad)">⚠️ Chưa lên CRM: ${esc(l.crmError)} <button data-crm="${l.id}">Gửi lại</button></div>` : ''}
    </div>`).join('') || '<p class="muted">Không có khách nào.</p>';
}
$('#lStatus').onchange = run(loadLeads);
const LEAD_FIELDS = [['contactName', 'Tên khách hàng', 'text'], ['phone', 'Số điện thoại / Zalo', 'text'], ['needs', 'Nhu cầu / mục đích', 'textarea'], ['address', 'Địa chỉ', 'text'], ['area', 'Khu vực', 'text'], ['email', 'Email', 'text'], ['note', 'Ghi chú', 'textarea']];
$('#newLead').onclick = () => dialog('Thêm khách sau khi tư vấn', LEAD_FIELDS, run(async (v) => {
  const l = await api('/leads', { method: 'POST', body: v });
  toast(`Đã thêm ${l.id}${l.crmError ? '' : ', đang đẩy lên CRM…'}`);
  setTimeout(loadLeads, 1500);
}));
$('#leads').onchange = run(async (e) => {
  if (!e.target.dataset.lead) return;
  await api(`/leads/${e.target.dataset.lead}`, { method: 'PUT', body: { status: e.target.value } });
  loadLeads(); loadOverview();
});
$('#leads').onclick = run(async (e) => {
  const d = e.target.dataset;
  if (d.note) {
    const l = leads.find((x) => x.id === d.note);
    dialog(`Ghi chú ${l.id}`, [['note', 'Ghi chú (kết quả gọi điện, lịch hẹn...)', 'textarea', l.note]], run(async (v) => { await api(`/leads/${l.id}`, { method: 'PUT', body: v }); loadLeads(); }));
  }
  if (d.conv) { document.querySelector('[data-tab=inbox]').click(); openConv(d.conv); }
  if (d.edit) {
    const l = leads.find((x) => x.id === d.edit);
    dialog(`Sửa ${l.id}`, LEAD_FIELDS.map(([k, label, type]) => [k, label, type, l[k]]), run(async (v) => { await api(`/leads/${l.id}`, { method: 'PUT', body: v }); toast('Đã lưu, đang cập nhật CRM…'); loadLeads(); }));
  }
  if (d.crm) { await api(`/leads/${d.crm}/crm`, { method: 'POST' }); toast('Đã gửi lên CRM'); loadLeads(); }
});
$('#exportLeads').onclick = run(async () => {
  const all = await api('/leads');
  const cols = ['id', 'createdAt', 'status', 'segment', 'contactName', 'phone', 'email', 'area', 'needs', 'note', 'channel', 'conversationId'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [cols.join(','), ...all.map((l) => cols.map((c) => cell(c === 'segment' ? SEG[l[c]] || l[c] : c === 'status' ? L_STATUS[l[c]] : l[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `khach-tiem-nang-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
});

// ---------- catalog ----------
let products = [];
async function loadProducts() {
  products = await api('/products');
  $('#products').innerHTML = products.map((p) => `
    <tr${p.active === false ? ' class="muted"' : ''}>
      <td>${esc(p.id)}</td><td><b>${esc(p.name)}</b><div class="muted small">${esc((p.description || '').slice(0, 90))}</div></td><td>${esc(p.category || '')}</td>
      <td>${p.salePrice != null ? `<s class="muted">${vnd(p.price)}</s> ` : ''}${vnd(p.salePrice ?? p.price)}</td>
      <td>${p.variants?.length ? p.variants.reduce((a, v) => a + (v.stock ?? 0), 0) : p.stock ?? '–'}</td>
      <td class="small">${(p.variants || []).map((v) => `${esc(v.name)}:${v.stock ?? '?'}`).join(', ')}</td>
      <td><button data-edit="${esc(p.id)}">Sửa</button> <button class="danger" data-del="${esc(p.id)}">Xoá</button></td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Catalog trống — thêm sản phẩm hoặc nhập CSV.</td></tr>';
}
const variantsToText = (vs = []) => vs.map((v) => [v.name, v.stock ?? '', v.price ?? ''].join(':').replace(/:+$/, '')).join('; ');
const textToVariants = (t) => String(t || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const [name, stock, price] = s.split(':'); return { name: name.trim(), stock: stock || null, price: price || null }; });
const attrsToText = (a = {}) => Object.entries(a).map(([k, v]) => `${k}: ${v}`).join('\n');
const textToAttrs = (t) => Object.fromEntries(String(t || '').split('\n').map((l) => l.split(':')).filter((x) => x.length >= 2).map(([k, ...v]) => [k.trim(), v.join(':').trim()]));

function productDialog(p) {
  dialog(p ? `Sửa ${p.id}` : 'Thêm sản phẩm', [
    ['id', 'Mã (SKU)', 'text', p?.id], ['name', 'Tên', 'text', p?.name], ['category', 'Danh mục', 'text', p?.category],
    ['price', 'Giá gốc', 'number', p?.price], ['salePrice', 'Giá khuyến mãi (để trống nếu không)', 'number', p?.salePrice],
    ['stock', 'Tồn kho (nếu không có biến thể)', 'number', p?.stock], ['description', 'Mô tả', 'textarea', p?.description],
    ['attributes', 'Thuộc tính (mỗi dòng "Tên: giá trị")', 'textarea', attrsToText(p?.attributes)],
    ['variants', 'Biến thể "Tên:tồn[:giá]; ..." vd "Đỏ-M:5; Đỏ-L:3:219000"', 'text', variantsToText(p?.variants)],
    ['tags', 'Từ khoá (cách nhau dấu phẩy)', 'text', (p?.tags || []).join(', ')],
  ], run(async (v) => {
    const body = { ...v, attributes: textToAttrs(v.attributes), variants: textToVariants(v.variants), salePrice: v.salePrice || null };
    if (p) { delete body.id; await api(`/products/${encodeURIComponent(p.id)}`, { method: 'PUT', body }); } else await api('/products', { method: 'POST', body });
    loadProducts();
  }));
}
$('#newProduct').onclick = () => productDialog(null);
$('#products').onclick = run(async (e) => {
  if (e.target.dataset.edit) productDialog(products.find((p) => p.id === e.target.dataset.edit));
  if (e.target.dataset.del && confirm(`Xoá ${e.target.dataset.del}?`)) { await api(`/products/${encodeURIComponent(e.target.dataset.del)}`, { method: 'DELETE' }); loadProducts(); }
});
$('#csvFile').onchange = run(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = await api('/products/import', { method: 'POST', body: { csv: await file.text() } });
  toast(`Đã nhập: ${r.created} mới, ${r.updated} cập nhật`);
  e.target.value = '';
  loadProducts();
});

// ---------- kiến thức ----------
let knowledge = [];
const K_STATUS = { approved: '✅ Đang dùng', pending: '🕓 Chờ duyệt', needs_answer: '❓ Cần câu trả lời' };
async function loadKnowledge() {
  knowledge = await api('/knowledge');
  const f = $('#kStatus').value;
  const list = knowledge.filter((k) => (f === 'todo' ? k.status !== 'approved' : !f || k.status === f)).reverse();
  $('#knowledge').innerHTML = list.map((k) => `
    <div class="card">
      <div class="row" style="margin:0"><b>${esc(k.question)}</b><span class="tag">${K_STATUS[k.status] || k.status}</span>${k.askedCount > 1 ? `<span class="tag">hỏi ${k.askedCount} lần</span>` : ''}<span class="muted small">${k.source || ''} ${k.conversationId || ''}</span></div>
      <div>${k.answer ? esc(k.answer) : '<i class="muted">Chưa có câu trả lời</i>'}</div>
      <div class="row" style="margin:0">${k.status !== 'approved' && k.answer ? `<button class="primary" data-ok="${k.id}">Duyệt</button>` : ''}<button data-edit="${k.id}">${k.answer ? 'Sửa' : 'Trả lời'}</button><button class="danger" data-del="${k.id}">Xoá</button></div>
    </div>`).join('') || '<p class="muted">Không có mục nào.</p>';
}
function knowDialog(k) {
  dialog(k ? 'Sửa kiến thức' : 'Thêm kiến thức', [['question', 'Câu hỏi', 'text', k?.question], ['answer', 'Câu trả lời chuẩn', 'textarea', k?.answer]], run(async (v) => {
    if (k) await api(`/knowledge/${k.id}`, { method: 'PUT', body: { ...v, status: 'approved' } }); else await api('/knowledge', { method: 'POST', body: v });
    loadKnowledge(); loadOverview();
  }));
}
$('#kStatus').onchange = run(loadKnowledge);
$('#newKnow').onclick = () => knowDialog(null);
$('#runLearning').onclick = run(async () => { toast('Đang chấm các hội thoại đã kết thúc…'); const r = await api('/learning/run', { method: 'POST' }); toast(`Đã chấm ${r.graded} hội thoại`); loadKnowledge(); });
$('#knowledge').onclick = run(async (e) => {
  const d = e.target.dataset;
  if (d.ok) { await api(`/knowledge/${d.ok}`, { method: 'PUT', body: { status: 'approved' } }); loadKnowledge(); loadOverview(); }
  if (d.edit) knowDialog(knowledge.find((k) => k.id === d.edit));
  if (d.del && confirm('Xoá mục này?')) { await api(`/knowledge/${d.del}`, { method: 'DELETE' }); loadKnowledge(); loadOverview(); }
});

// ---------- bài học ----------
async function loadLessons() {
  const list = await api('/lessons');
  $('#lessons').innerHTML = list.slice().reverse().map((l) => `
    <div class="card"><div class="row" style="margin:0"><b>${l.id}</b><span class="tag">${l.status === 'active' ? '✅ Đang áp dụng' : '⏸ Tắt'}</span><span class="muted small">${l.conversationId || ''} ${time(l.createdAt)}</span></div>
      <div>${esc(l.text)}</div>${l.original && l.original !== l.text ? `<div class="muted small">Góp ý gốc: ${esc(l.original)}</div>` : ''}
      <div class="row" style="margin:0"><button data-toggle="${l.id}" data-status="${l.status}">${l.status === 'active' ? 'Tắt' : 'Bật'}</button><button class="danger" data-del="${l.id}">Xoá</button></div></div>`).join('') || '<p class="muted">Chưa có bài học.</p>';
}
$('#lessonForm').onsubmit = run(async (e) => { e.preventDefault(); await api('/lessons', { method: 'POST', body: { text: $('#lessonText').value } }); $('#lessonText').value = ''; loadLessons(); });
$('#lessons').onclick = run(async (e) => {
  const d = e.target.dataset;
  if (d.toggle) { await api(`/lessons/${d.toggle}`, { method: 'PUT', body: { status: d.status === 'active' ? 'off' : 'active' } }); loadLessons(); }
  if (d.del && confirm('Xoá bài học?')) { await api(`/lessons/${d.del}`, { method: 'DELETE' }); loadLessons(); }
});

// ---------- hội thoại mẫu ----------
const EX_SRC = { human_chat: 'từ người thật trả lời', ai_chat: 'từ hội thoại AI tốt', transcript: 'từ đoạn chat dán vào', manual: 'tự thêm' };
async function loadExamples() {
  const list = await api('/examples');
  $('#examples').innerHTML = list.slice().reverse().map((e) => `
    <div class="card"><div class="row" style="margin:0"><b>${e.id}</b><span class="tag">${e.status === 'active' ? '✅ Đang học theo' : e.status === 'pending' ? '🕓 Chờ duyệt' : '⏸ Tắt'}</span><span class="muted small">${EX_SRC[e.source] || ''}${e.conversationId ? ` · ${e.conversationId}` : ''}${e.score ? ` · ${e.score}/10` : ''}</span></div>
      <div><b>Khách:</b> ${esc(e.customer)}</div><div><b>Tư vấn viên:</b> ${esc(e.reply)}</div>
      ${e.lesson ? `<div class="muted small">💡 ${esc(e.lesson)}</div>` : ''}
      <div class="row" style="margin:0"><button data-extoggle="${e.id}" data-status="${e.status}">${e.status === 'active' ? 'Tắt' : 'Dùng mẫu này'}</button><button data-exedit="${e.id}">Sửa</button><button class="danger" data-exdel="${e.id}">Xoá</button></div></div>`).join('') || '<p class="muted">Chưa có mẫu. Trợ lý sẽ tự rút mẫu từ hội thoại tốt, hoặc anh dán đoạn chat thật ở trên.</p>';
  $('#examples').dataset.list = JSON.stringify(list);
}
$('#examples').onclick = run(async (e) => {
  const d = e.target.dataset;
  const list = JSON.parse($('#examples').dataset.list || '[]');
  if (d.extoggle) { await api(`/examples/${d.extoggle}`, { method: 'PUT', body: { status: d.status === 'active' ? 'off' : 'active' } }); loadExamples(); }
  if (d.exdel && confirm('Xoá mẫu này?')) { await api(`/examples/${d.exdel}`, { method: 'DELETE' }); loadExamples(); }
  if (d.exedit) {
    const x = list.find((i) => i.id === d.exedit);
    dialog(`Sửa ${x.id}`, [['customer', 'Khách nói', 'textarea', x.customer], ['reply', 'Tư vấn viên trả lời', 'textarea', x.reply]], run(async (v) => { await api(`/examples/${x.id}`, { method: 'PUT', body: v }); loadExamples(); }));
  }
});
$('#newExample').onclick = () => dialog('Thêm hội thoại mẫu', [['customer', 'Khách nói', 'textarea'], ['reply', 'Câu trả lời hay mà anh muốn trợ lý học theo', 'textarea']], run(async (v) => { await api('/examples', { method: 'POST', body: v }); loadExamples(); }));
$('#transcriptForm').onsubmit = run(async (e) => {
  e.preventDefault();
  const text = $('#transcriptText').value.trim();
  if (!text) return;
  toast('Đang phân tích đoạn chat…');
  const r = await api('/learn/transcript', { method: 'POST', body: { text } });
  toast(`Đã học: ${r.examples} hội thoại mẫu, ${r.lessons} nhận xét phong cách, ${r.knowledge} kiến thức (chờ duyệt ở tab Kiến thức)`);
  $('#transcriptText').value = '';
  loadExamples(); loadLessons();
});

// ---------- cài đặt ----------
async function loadSettings() {
  const s = await api('/settings');
  const f = (name, label, value, type = 'text') => `<label>${label}${type === 'textarea' ? `<textarea name="${name}" rows="3">${esc(value)}</textarea>` : type === 'checkbox' ? `<input type="checkbox" name="${name}" ${value ? 'checked' : ''}>` : `<input name="${name}" type="${type}" value="${esc(value)}">`}</label>`;
  $('#settingsForm').innerHTML = `
    <fieldset><legend>Cách trợ lý làm việc</legend>
      <label>Chế độ<select name="salesMode">
        <option value="order" ${s.salesMode !== 'lead' ? 'selected' : ''}>Bán hàng: báo giá, lên đơn nháp, tính phí ship</option>
        <option value="lead" ${s.salesMode === 'lead' ? 'selected' : ''}>Thu thập khách tiềm năng: không báo giá, xin SĐT/Zalo chuyển chuyên viên</option>
      </select></label>
      <label>Cách nói chuyện<select name="replyStyle">
        <option value="natural" ${s.replyStyle !== 'script' ? 'selected' : ''}>Tự nhiên như người thật: kịch bản chỉ để định hướng, tự diễn đạt, có thể nhắn nhiều tin ngắn</option>
        <option value="script" ${s.replyStyle === 'script' ? 'selected' : ''}>Bám sát kịch bản: dùng đúng câu mẫu, hỏi gộp</option>
      </select></label>
      <label>Kịch bản tư vấn (các bước hỏi và mẫu câu trợ lý bám theo)<textarea name="shop.playbook" rows="12">${esc(s.shop.playbook)}</textarea></label>
      <label>AI tự trả lời khách trên kênh:</label>
      <div class="row">${['facebook', 'zalo', 'web'].map((ch) => `<label class="small"><input type="checkbox" name="aiChannels.${ch}" ${s.aiChannels?.[ch] !== false ? 'checked' : ''}> ${CH[ch]}</label>`).join('')}</div>
      <p class="muted small">Bỏ tick một kênh: tin nhắn khách vẫn hiện trong Hội thoại để nhân viên trả lời, AI không tự trả lời. Lệnh điều khiển qua Zalo vẫn dùng được.</p>
      ${f('shop.greeting', 'Lời chào trên chat website', s.shop.greeting, 'textarea')}
      ${f('followUp.enabled', 'Nhắn nhắc khi khách im lặng (1 lần, chỉ khi khách chưa để lại SĐT)', s.followUp.enabled, 'checkbox')}
      ${f('followUp.afterMinutes', 'Nhắc sau (phút)', s.followUp.afterMinutes, 'number')}
      ${f('followUp.text', 'Nội dung tin nhắc', s.followUp.text, 'textarea')}</fieldset>
    <fieldset><legend>Thông tin shop</legend>
      ${f('shop.name', 'Tên shop', s.shop.name)}${f('shop.description', 'Giới thiệu ngắn', s.shop.description, 'textarea')}
      ${f('shop.hotline', 'Hotline', s.shop.hotline)}${f('shop.workingHours', 'Giờ làm việc', s.shop.workingHours)}
      ${f('shop.tone', 'Giọng điệu trợ lý', s.shop.tone, 'textarea')}</fieldset>
    <fieldset><legend>Chính sách (trợ lý chỉ trả lời theo nội dung này)</legend>
      ${f('policies.shipping', 'Giao hàng', s.policies.shipping, 'textarea')}${f('policies.returns', 'Đổi trả', s.policies.returns, 'textarea')}
      ${f('policies.payment', 'Thanh toán', s.policies.payment, 'textarea')}${f('policies.warranty', 'Bảo hành', s.policies.warranty, 'textarea')}</fieldset>
    <fieldset><legend>Phí ship</legend>
      ${f('shippingRules.freeShipThreshold', 'Miễn phí ship cho đơn từ (VND, 0 = không áp dụng)', s.shippingRules.freeShipThreshold, 'number')}
      <label>Khu vực (JSON: name, provinces[], fee, days; khu vực có provinces rỗng = mặc định)<textarea name="shippingRules.zones" rows="6">${esc(JSON.stringify(s.shippingRules.zones, null, 1))}</textarea></label></fieldset>
    <fieldset><legend>Tự học & thông báo</legend>
      ${f('learning.autoGrade', 'Tự động chấm điểm hội thoại đã kết thúc', s.learning.autoGrade, 'checkbox')}
      ${f('learning.autoLearnExamples', 'Tự học cách nói chuyện từ hội thoại tốt (điểm cao, được chấm 4-5 sao, hoặc có người thật trả lời)', s.learning.autoLearnExamples, 'checkbox')}
      ${f('learning.autoApproveExamples', 'Dùng ngay hội thoại mẫu tự học (bỏ tick: chờ duyệt trong tab Bài học)', s.learning.autoApproveExamples, 'checkbox')}
      ${f('learning.exampleMinScore', 'Điểm tối thiểu để học làm mẫu', s.learning.exampleMinScore, 'number')}
      ${f('learning.autoApproveKnowledge', 'Tự dùng kiến thức rút ra từ câu trả lời của bạn (không cần duyệt)', s.learning.autoApproveKnowledge, 'checkbox')}
      ${f('learning.lowScoreAlert', 'Báo tôi khi điểm dưới', s.learning.lowScoreAlert, 'number')}
      ${f('notifyOnNewLead', 'Báo khách tiềm năng mới qua Zalo/Lark', s.notifyOnNewLead, 'checkbox')}
      ${f('notifyOnNewOrder', 'Báo đơn nháp mới qua Zalo/Lark', s.notifyOnNewOrder, 'checkbox')}
      ${f('notifyOnEscalation', 'Báo khi trợ lý cần người hỗ trợ', s.notifyOnEscalation, 'checkbox')}</fieldset>
    <div><button class="primary">Lưu cài đặt</button></div>`;
  const profiles = await api('/profiles');
  $('#profiles').innerHTML = profiles.map((p) => `<div class="row"><b>${esc(p.name)}</b><span class="muted small">${esc(p.description)}</span><button class="primary" data-profile="${esc(p.id)}">Nạp gói này</button></div>`).join('') || '<p class="muted">Chưa có gói nào.</p>';
  $('#crmUrl').value = s.crm?.baseUrl || '';
  if (s.crm?.baseUrl) loadCrmFields(s.crm).catch((e) => { $('#crmMap').innerHTML = `<p class="small" style="color:var(--bad)">⚠️ ${esc(e.message)}</p>`; });
  const zo = await api('/zalo/owners');
  $('#zaloOwners').innerHTML = [
    ...zo.fromEnv.map((id) => `<div class="row"><span>✅ ${esc(id)}</span><span class="muted small">(trong file .env)</span></div>`),
    ...zo.fromDashboard.map((id) => `<div class="row"><span>✅ ${esc(id)}</span><button class="danger" data-zremove="${esc(id)}">Bỏ quyền</button></div>`),
    ...zo.requests.map((q) => `<div class="row"><span>🙋 ${esc(q.id)}</span><span class="muted small">gõ "${esc(q.text)}" lúc ${time(q.at)}</span><button class="primary" data-zadd="${esc(q.id)}">Cấp quyền</button></div>`),
  ].join('') || '<p class="muted small">Chưa có ai. Dùng Zalo cá nhân nhắn /baocao cho OA, rồi tải lại trang này để cấp quyền.</p>';
  $('#zaloConnect').href = `/api/admin/zalo/connect?token=${encodeURIComponent(TOKEN)}`;
  $('#embedCode').textContent = `<script src="${location.origin}/widget.js" defer></script>`;
  const o = await api('/overview');
  const ok = (on) => (on ? '✅ đã kết nối' : '⚪ chưa cấu hình');
  $('#setupInfo').textContent = [
    `Claude AI: ${ok(o.channels.ai)}`,
    `Facebook: ${ok(o.channels.facebook)}\n  Callback URL: ${location.origin}/webhooks/facebook\n  Verify token: ${o.setup.fbVerifyToken}`,
    `Zalo OA: ${ok(o.channels.zalo)} · ${o.channels.zaloOwners} chủ shop điều khiển\n  Webhook URL: ${location.origin}/webhooks/zalo\n  Official Account Callback Url: ${location.origin}/webhooks/zalo/oauth`,
    `Lark: ${ok(o.channels.lark)}\n  Request URL: ${location.origin}/webhooks/lark`,
    o.setup.publicUrl !== location.origin ? `⚠️ PUBLIC_URL trong .env (${o.setup.publicUrl}) khác địa chỉ đang mở (${location.origin})` : '',
  ].filter(Boolean).join('\n\n');
}
async function loadCrmFields(crm) {
  const baseUrl = $('#crmUrl').value.trim();
  const r = await api('/crm/fields', { method: 'POST', body: { baseUrl } });
  const map = Object.keys(crm?.fieldMap || {}).length ? crm.fieldMap : r.guess;
  const opts = (sel) => ['<option value="">— không gửi —</option>', ...r.fields.filter((f) => f.writable).map((f) => `<option ${f.field_name === sel ? 'selected' : ''}>${esc(f.field_name)}</option>`)].join('');
  $('#crmMap').innerHTML = `
    <p class="muted small">Đọc được ${r.fields.length} cột. Chọn cột CRM tương ứng với từng thông tin (em đã đoán sẵn theo tên cột):</p>
    ${Object.entries(r.attrs).map(([k, label]) => `<div class="row" style="margin:4px 0"><span style="min-width:280px">${esc(label)}</span><select data-attr="${k}">${opts(map[k])}</select></div>`).join('')}
    <div class="row"><label class="small"><input type="checkbox" id="crmEnabled" ${crm?.enabled ? 'checked' : ''}> Bật tự động đẩy khách lên CRM</label><button class="primary" id="crmSave">Lưu CRM</button></div>`;
  $('#crmSave').onclick = run(async () => {
    const fieldMap = {};
    document.querySelectorAll('#crmMap select[data-attr]').forEach((s) => { if (s.value) fieldMap[s.dataset.attr] = s.value; });
    await api('/settings', { method: 'PUT', body: { crm: { enabled: $('#crmEnabled').checked, baseUrl, fieldMap } } });
    toast($('#crmEnabled').checked ? '✅ Đã bật đẩy khách lên CRM' : 'Đã lưu (chưa bật)');
  });
}
$('#crmLoad').onclick = run(async () => { $('#crmMap').innerHTML = '<p class="muted small">Đang đọc cột…</p>'; await loadCrmFields((await api('/settings')).crm); });
$('#zaloOwners').onclick = run(async (e) => {
  const d = e.target.dataset;
  if (d.zadd) { await api('/zalo/owners', { method: 'POST', body: { id: d.zadd } }); toast('Đã cấp quyền. Nhắn /help cho OA để thử.'); loadSettings(); }
  if (d.zremove && confirm('Bỏ quyền điều khiển của ID này?')) { await api('/zalo/owners', { method: 'POST', body: { id: d.zremove, remove: true } }); loadSettings(); }
});
$('#profiles').onclick = run(async (e) => {
  const id = e.target.dataset.profile;
  if (!id || !confirm('Nạp gói này sẽ thay toàn bộ Catalog và kiến thức mẫu hiện tại. Tiếp tục?')) return;
  const r = await api(`/profiles/${id}/apply`, { method: 'POST' });
  toast(`Đã nạp: ${r.products} dịch vụ/sản phẩm, ${r.knowledge} kiến thức, ${r.lessons} bài học`);
  loadSettings();
  loadOverview();
});
$('#settingsForm').onsubmit = run(async (e) => {
  e.preventDefault();
  const body = {};
  for (const el of e.target.elements) {
    if (!el.name) continue;
    let v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
    if (el.name === 'shippingRules.zones') v = JSON.parse(el.value);
    const [a, b] = el.name.split('.');
    if (b) (body[a] ||= {})[b] = v; else body[a] = v;
  }
  await api('/settings', { method: 'PUT', body });
  toast('Đã lưu');
});
$('#cmdForm').onsubmit = run(async (e) => {
  e.preventDefault();
  const r = await api('/command', { method: 'POST', body: { text: $('#cmdText').value || '/help' } });
  $('#cmdOut').textContent = r.reply;
  refresh();
});

// ---------- hộp thoại dùng chung ----------
function dialog(title, fields, onOk) {
  const form = $('#dlgForm');
  form.innerHTML = `<h3>${esc(title)}</h3>${fields.map(([name, label, type, value]) => `<label>${esc(label)}${type === 'textarea'
    ? `<textarea name="${name}" rows="3">${esc(value ?? '')}</textarea>`
    : `<input name="${name}" type="${type}" value="${esc(value ?? '')}">`}</label>`).join('')}
    <div class="row"><button value="cancel" formnovalidate>Huỷ</button><button class="primary" value="ok">Lưu</button></div>`;
  const dlg = $('#dlg');
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const v = {};
    for (const [name, , type] of fields) { const el = form.elements[name]; v[name] = type === 'number' ? (el.value === '' ? null : Number(el.value)) : el.value; }
    onOk(v);
  };
  dlg.showModal();
}

// ---------- realtime ----------
const loaders = { inbox: loadConvs, leads: loadLeads, orders: loadOrders, products: loadProducts, knowledge: loadKnowledge, lessons: () => { loadLessons(); loadExamples(); }, settings: loadSettings };
function refresh() { loadOverview().catch(() => {}); if (currentTab === 'inbox') loadConvs().catch(() => {}); }

function listen() {
  const es = new EventSource(`/api/admin/events?token=${encodeURIComponent(TOKEN)}`);
  let t;
  es.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'notify') toast(ev.text);
    clearTimeout(t);
    t = setTimeout(() => {
      refresh();
      if (ev.type === 'message' && ev.conversationId === currentConv && currentTab === 'inbox') openConv(currentConv).catch(() => {});
      if (ev.type === 'order' && currentTab === 'orders') loadOrders();
      if (ev.type === 'lead' && currentTab === 'leads') loadLeads();
    }, 300);
  };
}

function start() {
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  refresh();
  listen();
}

if (TOKEN) api('/overview').then(start).catch(showLogin); else showLogin();
