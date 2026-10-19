// Tìm kiếm catalog & tri thức bằng so khớp từ khoá không dấu (đủ tốt cho vài nghìn sản phẩm).

export function normalize(s = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = new Set(['co', 'khong', 'cho', 'em', 'anh', 'chi', 'shop', 'minh', 'la', 'cai', 'nao', 'gi', 'bao', 'nhieu', 'a', 'oi', 'voi', 'the', 'ko', 'k', 'ban', 'mua', 'can', 'muon', 'hoi', 'xin']);

export function tokens(s) {
  return normalize(s).split(' ').filter((t) => t && !STOP.has(t));
}

function score(queryTokens, text) {
  const hay = ` ${normalize(text)} `;
  let s = 0;
  for (const t of queryTokens) {
    if (hay.includes(` ${t} `)) s += 2;
    else if (t.length >= 3 && hay.includes(t)) s += 1;
  }
  return s;
}

export function productText(p) {
  return [p.id, p.name, p.category, p.description, (p.tags || []).join(' '),
    Object.entries(p.attributes || {}).map(([k, v]) => `${k} ${v}`).join(' '),
    (p.variants || []).map((v) => v.name).join(' ')].join(' ');
}

export function effectivePrice(p, variantName) {
  const v = variantName ? (p.variants || []).find((x) => normalize(x.name) === normalize(variantName)) : null;
  if (v && v.price != null) return v.price;
  return p.salePrice ?? p.price;
}

export function stockOf(p, variantName) {
  if (variantName) {
    const v = (p.variants || []).find((x) => normalize(x.name) === normalize(variantName));
    return v ? v.stock ?? null : null;
  }
  if (p.variants?.length) return p.variants.reduce((a, v) => a + (v.stock ?? 0), 0);
  return p.stock ?? null;
}

export function searchProducts(products, { query = '', category, maxPrice, minPrice, limit = 6 } = {}) {
  const qt = tokens(query);
  return products
    .filter((p) => p.active !== false)
    .filter((p) => !category || normalize(p.category).includes(normalize(category)))
    .filter((p) => maxPrice == null || effectivePrice(p) <= maxPrice)
    .filter((p) => minPrice == null || effectivePrice(p) >= minPrice)
    .map((p) => ({ p, s: qt.length ? score(qt, productText(p)) : 1 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

export function searchKnowledge(entries, query, limit = 5) {
  const qt = tokens(query);
  if (!qt.length) return [];
  return entries
    .filter((k) => k.status === 'approved')
    .map((k) => ({ k, s: score(qt, `${k.question} ${k.answer} ${(k.tags || []).join(' ')}`) }))
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.k);
}

export const formatVnd = (n) => (n == null ? 'liên hệ' : `${Number(n).toLocaleString('vi-VN')}đ`);
