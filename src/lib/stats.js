// GET /api/public/stats, read defensively: any field may be missing and the request may fail.
import { safeSlug, safeUrl } from './url.js';

const num = v => { if (v == null || v === '' || typeof v === 'boolean') return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const text = (v, max = 160) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
const slugify = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function links(list, base, max) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const item of list) {
    const label = text(typeof item === 'object' && item ? item.label ?? item.value ?? item.name : item, 60);
    const slug = safeSlug(typeof item === 'object' && item ? item.slug || slugify(label) : slugify(label));
    if (!label || !slug) continue;
    out.push({ label, href: base + slug, count: typeof item === 'object' && item ? num(item.count) : null });
    if (out.length >= max) break;
  }
  return out;
}

export function normalizeStats(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const newest = [];
  for (const item of Array.isArray(s.newest) ? s.newest : []) {
    const slug = safeSlug(item?.slug), name = text(item?.name, 80);
    if (!slug || !name) continue;
    newest.push({ slug, name, href: '/companies/' + slug, logo_url: safeUrl(item.logo_url), description: text(item.description, 200), city: text(item.city ?? item.location, 60), sector: text(item.industry ?? item.sector, 60) });
    if (newest.length >= 6) break;
  }
  return {
    companies: num(s.companies), leaders: num(s.leaders), hiring: num(s.hiring), new_this_week: num(s.new_this_week), sources: num(s.sources),
    sectors: links(s.top_sectors, '/sector/', 8),
    cities: links(s.top_cities, '/city/', 8),
    sourceLinks: links(s.top_sources, '/source/', 8),
    batches: links(s.latest_batches, '/batch/', 6),
    collections: links(s.collections, '/collections/', 8),
    newest,
  };
}

let cached = null;
// One request per page load, shared by the landing page and Today. Resolves to null when unavailable.
export function loadStats() {
  if (!cached) {
    cached = fetch('/api/public/stats', { headers: { Accept: 'application/json' } })
      .then(r => { if (!r.ok || !/json/i.test(r.headers.get('content-type') || '')) throw new Error('stats unavailable'); return r.json(); })
      .then(normalizeStats)
      .catch(() => { cached = null; return null; });
  }
  return cached;
}
