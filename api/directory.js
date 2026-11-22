// Public directory pages, server-rendered and edge-cached. vercel.json rewrites map the public URLs here:
//   /companies -> view=list        /companies/:slug -> view=company    /new -> view=new
//   /sector/:sector -> view=sector /city/:city -> view=city            /sitemap.xml -> view=sitemap
// No sign-in, no cookies: every visitor gets the same HTML.
import { rpc } from './_lib/db.js';
import { PER_PAGE, SLUG_RE, slugify, renderList, renderCompany, renderNew, renderNotFound, renderUnavailable, renderSitemap } from './_lib/render.js';

const CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';
const one = v => (Array.isArray(v) ? v[0] : v);
const str = (v, max = 80) => String(one(v) ?? '').trim().slice(0, max);

function send(res, status, body, { type = 'text/html; charset=utf-8', cache = CACHE } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(body);
}
const notFound = res => send(res, 404, renderNotFound(), { cache: 'public, s-maxage=60' });

// Filters arrive as plain GET parameters so any filtered view is a shareable URL.
export function readFilters(query) {
  const f = { q: str(query.q).replace(/\s+/g, ' '), sector: slugify(str(query.sector, 120)), city: slugify(str(query.city, 120)), batch: '', year: '', hiring: str(query.hiring) === '1', page: 1 };
  const batch = str(query.batch, 8).toUpperCase(), year = str(query.year, 8);
  if (/^[WXSF]\d{2}$/.test(batch)) f.batch = batch;
  // The "Batch or year" select posts a year through the same field.
  if (/^(19|20)\d{2}$/.test(batch)) f.year = batch;
  if (/^(19|20)\d{2}$/.test(year)) f.year = year;
  const page = Number.parseInt(str(query.page, 6), 10);
  if (page > 1 && page <= 100000) f.page = page;
  return f;
}

async function list(res, query, mode) {
  const facets = (await rpc('catalog_facets')) || {};
  const f = readFilters(query);
  const want = { sector: f.sector, city: f.city };
  let basePath = '/companies', presetLabel = '';
  if (mode !== 'all') {
    // /sector/:sector and /city/:city carry one filter in the path; it must name a real sector or city.
    const key = slugify(str(query.preset, 120));
    const hit = ((mode === 'sector' ? facets.sectors : facets.cities) || []).find(o => slugify(o.value) === key);
    if (!key || !hit) return notFound(res);
    presetLabel = String(hit.value);
    basePath = '/' + mode + '/' + key;
    want[mode] = key;
    f[mode] = '';
  }
  const data = (await rpc('catalog_list', {
    p_q: f.q || null, p_sector: want.sector || null, p_city: want.city || null, p_batch: f.batch || null,
    p_year: f.year ? Number(f.year) : null, p_hiring: f.hiring, p_page: f.page, p_per: PER_PAGE,
  })) || {};
  send(res, 200, renderList({ mode, basePath, presetLabel, filters: f, facets, total: Number(data.total) || 0, rows: Array.isArray(data.rows) ? data.rows : [] }));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'Method not allowed', { type: 'text/plain; charset=utf-8', cache: 'no-store' });
  }
  const query = req.query || {};
  const view = str(query.view, 20);
  try {
    if (view === 'list') return await list(res, query, 'all');
    if (view === 'sector' || view === 'city') return await list(res, query, view);
    if (view === 'company') {
      const slug = str(query.slug, 120).toLowerCase();
      if (!SLUG_RE.test(slug)) return notFound(res);
      const company = await rpc('catalog_company', { p_slug: slug });
      if (!company || !company.slug) return notFound(res);
      return send(res, 200, renderCompany(company));
    }
    if (view === 'new') {
      const data = (await rpc('catalog_new')) || {};
      return send(res, 200, renderNew({ fresh: Boolean(data.fresh), rows: Array.isArray(data.rows) ? data.rows : [], run: data.run || null }));
    }
    if (view === 'sitemap') {
      const [slugs, facets] = await Promise.all([rpc('catalog_slugs'), rpc('catalog_facets')]);
      return send(res, 200, renderSitemap({ slugs: Array.isArray(slugs) ? slugs : [], sectors: facets?.sectors || [], cities: facets?.cities || [] }), { type: 'application/xml; charset=utf-8' });
    }
    return notFound(res);
  } catch (e) {
    // Never show a stack trace; the page is not cached so recovery is immediate.
    console.error('FoundReach directory error', view, e?.status || '', e?.code || '', e?.message);
    if (view === 'sitemap') return send(res, 503, 'Temporarily unavailable', { type: 'text/plain; charset=utf-8', cache: 'no-store' });
    return send(res, 503, renderUnavailable(), { cache: 'no-store' });
  }
}
