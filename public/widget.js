// Widget chat nhúng website: <script src="https://your-domain/widget.js" defer></script>
(function () {
  if (window.__eivChat) return;
  window.__eivChat = true;
  var script = document.currentScript || document.querySelector('script[src*="widget.js"]');
  var BASE = (script && script.src ? new URL(script.src).origin : location.origin) + '/api/chat';
  var KEY = 'eivChatSession';
  var sid;
  try { sid = localStorage.getItem(KEY); } catch (e) {}
  if (!sid) {
    sid = 'w' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try { localStorage.setItem(KEY, sid); } catch (e) {}
  }
  var seen = {};
  var lastAt = '';
  var sending = false;

  var css = '#eivc-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;background:#2563eb;color:#fff;border:0;font-size:26px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2147483000}'
    + '#eivc-box{position:fixed;right:20px;bottom:86px;width:340px;max-width:calc(100vw - 32px);height:480px;max-height:calc(100vh - 110px);background:#fff;color:#1d2330;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;font:14px/1.45 system-ui,sans-serif;z-index:2147483000}'
    + '#eivc-box.open{display:flex}#eivc-head{background:#2563eb;color:#fff;padding:12px 14px;font-weight:600}'
    + '#eivc-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:6px;background:#f5f6f8}'
    + '.eivc-m{max-width:80%;padding:7px 11px;border-radius:12px;white-space:pre-wrap;word-wrap:break-word}.eivc-m.customer{align-self:flex-end;background:#2563eb;color:#fff}.eivc-m.shop{align-self:flex-start;background:#fff;border:1px solid #e5e7eb}'
    + '#eivc-form{display:flex;border-top:1px solid #e5e7eb}#eivc-in{flex:1;border:0;padding:12px;font:inherit;outline:none;color:#1d2330;background:#fff}#eivc-form button{border:0;background:none;color:#2563eb;font-weight:600;padding:0 14px;cursor:pointer}'
    + '.eivc-typing{align-self:flex-start;color:#6b7280;font-size:12px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var btn = document.createElement('button'); btn.id = 'eivc-btn'; btn.setAttribute('aria-label', 'Chat với shop'); btn.textContent = '💬';
  var box = document.createElement('div'); box.id = 'eivc-box';
  box.innerHTML = '<div id="eivc-head">Chat với shop</div><div id="eivc-msgs"></div><form id="eivc-form"><input id="eivc-in" placeholder="Nhập tin nhắn…" autocomplete="off" maxlength="2000"><button>Gửi</button></form>';
  document.body.appendChild(btn); document.body.appendChild(box);
  var msgs = box.querySelector('#eivc-msgs');
  var input = box.querySelector('#eivc-in');

  function add(m) {
    if (m.id && seen[m.id]) return;
    if (m.id) seen[m.id] = 1;
    if (m.at && m.at > lastAt) lastAt = m.at;
    var d = document.createElement('div'); d.className = 'eivc-m ' + m.role; d.textContent = m.text;
    msgs.appendChild(d); msgs.scrollTop = 1e9;
  }
  function poll() {
    if (sending) return;
    fetch(BASE + '/' + sid + '/messages' + (lastAt ? '?after=' + encodeURIComponent(lastAt) : ''))
      .then(function (r) { return r.json(); }).then(function (d) { (d.messages || []).forEach(add); }).catch(function () {});
  }

  fetch(BASE + '/config').then(function (r) { return r.json(); }).then(function (c) {
    box.querySelector('#eivc-head').textContent = c.shopName;
    add({ role: 'shop', text: c.greeting });
    poll();
  }).catch(function () {});

  btn.onclick = function () { box.classList.toggle('open'); if (box.classList.contains('open')) input.focus(); };
  box.querySelector('#eivc-form').onsubmit = function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    sending = true;
    add({ role: 'customer', text: text });
    var typing = document.createElement('div'); typing.className = 'eivc-typing'; typing.textContent = 'Shop đang trả lời…'; msgs.appendChild(typing);
    fetch(BASE + '/' + sid + '/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { (d.messages || []).forEach(function (m) { if (m.role === 'customer') seen[m.id] = 1; else add(m); if (m.at > lastAt) lastAt = m.at; }); })
      .catch(function () { add({ role: 'shop', text: 'Mạng đang chập chờn, anh/chị gửi lại giúp em nhé.' }); })
      .finally(function () { typing.remove(); sending = false; });
  };
  setInterval(function () { if (box.classList.contains('open')) poll(); }, 4000);
})();
