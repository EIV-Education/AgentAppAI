// Dashboard quản trị — JS thuần, không cần build.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => (n == null ? '–' : `${Number(n).toLocaleString('vi-VN')}đ`);
const time = (iso) => (iso ? new Date(iso).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');
const CH = { facebook: 'FB', zalo: 'Zalo', web: 'Web' };

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
    [o.pendingOrders, 'Đơn nháp chờ duyệt'],
    [vnd(o.confirmedRevenue), 'Doanh số đã duyệt'],
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
    ${g ? `<div class="gradeBox"><b>Điểm ${g.score}/10</b> · chính xác ${g.accuracy} · hữu ích ${g.helpfulness} · giọng ${g.tone} · bán hàng ${g.sales}${g.hallucination ? ' · <b style="color:var(--bad)">CÓ BỊA</b>' : ''}<br>${esc(g.summary)}${g.issues.length ? `<ul>${g.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}${g.betterReply ? `<div class="muted">Gợi ý: ${esc(g.betterReply)}</div>` : ''}</div>` : ''}
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

// ---------- cài đặt ----------
async function loadSettings() {
  const s = await api('/settings');
  const f = (name, label, value, type = 'text') => `<label>${label}${type === 'textarea' ? `<textarea name="${name}" rows="3">${esc(value)}</textarea>` : type === 'checkbox' ? `<input type="checkbox" name="${name}" ${value ? 'checked' : ''}>` : `<input name="${name}" type="${type}" value="${esc(value)}">`}</label>`;
  $('#settingsForm').innerHTML = `
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
      ${f('learning.autoApproveKnowledge', 'Tự dùng kiến thức rút ra từ câu trả lời của bạn (không cần duyệt)', s.learning.autoApproveKnowledge, 'checkbox')}
      ${f('learning.lowScoreAlert', 'Báo tôi khi điểm dưới', s.learning.lowScoreAlert, 'number')}
      ${f('notifyOnNewOrder', 'Báo đơn nháp mới qua Zalo/Lark', s.notifyOnNewOrder, 'checkbox')}
      ${f('notifyOnEscalation', 'Báo khi trợ lý cần người hỗ trợ', s.notifyOnEscalation, 'checkbox')}</fieldset>
    <div><button class="primary">Lưu cài đặt</button></div>`;
  $('#embedCode').textContent = `<script src="${location.origin}/widget.js" defer></script>`;
  const o = await api('/overview');
  const ok = (on) => (on ? '✅ đã kết nối' : '⚪ chưa cấu hình');
  $('#setupInfo').textContent = [
    `Claude AI: ${ok(o.channels.ai)}`,
    `Facebook: ${ok(o.channels.facebook)}\n  Callback URL: ${location.origin}/webhooks/facebook\n  Verify token: ${o.setup.fbVerifyToken}`,
    `Zalo OA: ${ok(o.channels.zalo)} · ${o.channels.zaloOwners} chủ shop điều khiển\n  Webhook URL: ${location.origin}/webhooks/zalo`,
    `Lark: ${ok(o.channels.lark)}\n  Request URL: ${location.origin}/webhooks/lark`,
    o.setup.publicUrl !== location.origin ? `⚠️ PUBLIC_URL trong .env (${o.setup.publicUrl}) khác địa chỉ đang mở (${location.origin})` : '',
  ].filter(Boolean).join('\n\n');
}
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
const loaders = { inbox: loadConvs, orders: loadOrders, products: loadProducts, knowledge: loadKnowledge, lessons: loadLessons, settings: loadSettings };
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
