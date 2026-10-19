// Nhập catalog từ CSV (xuất từ Excel/Google Sheets).
// Cột: id,name,category,price,salePrice,stock,description,tags,images,variants, và attr:<tên thuộc tính>
// variants: "S:10;M:5:259000" = tên:tồn kho[:giá riêng], cách nhau bởi dấu chấm phẩy.

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export function parseProductsCsv(text) {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const cols = header.map((h) => h.trim());
  return rows.map((r) => {
    const p = { attributes: {} };
    cols.forEach((c, i) => {
      const v = (r[i] ?? '').trim();
      if (!v) return;
      if (c.toLowerCase().startsWith('attr:')) p.attributes[c.slice(5).trim()] = v;
      else if (c === 'variants') {
        p.variants = v.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
          const [name, stock, price] = s.split(':').map((x) => x.trim());
          return { name, stock: stock === undefined || stock === '' ? null : stock, price: price || null };
        });
      } else p[c] = v;
    });
    return p;
  });
}
