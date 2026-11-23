// Public directory pages, server-rendered and edge-cached. vercel.json rewrites map the public URLs here:
//   /companies -> list             /companies/:slug -> company (":slug.json" -> quick-view JSON)
//   /new -> new                    /sector/:s -> sector            /city/:c -> city
//   /sector/:s/:c -> sector-city   /batch/:code -> batch           /source/:slug -> source
//   /hiring -> hiring              /hiring/:s -> hiring-sector     /collections -> collections
//   /collections/:slug -> collection   /about-data -> about        /directory.js -> script
//   /sitemap.xml, /sitemap-pages.xml, /sitemap-companies.xml -> sitemap      /api/public/stats -> stats
// No sign-in, no cookies: every visitor gets the same response.
import { rpc } from './_lib/db.js';
import { getNav } from './_lib/nav.js';
import { SCRIPT } from './_lib/script.js';
import {
  SITE, PER_PAGE, SLUG_RE, BATCH_RE, COLLECTIONS, COUNTRIES, FILTER_KEYS, slugify, listUrl, batchLabel, batchName, quickView,
  renderList, renderCompany, renderNew, renderCollections, renderAbout, renderNotFound, renderUnavailable,
  renderSitemapIndex, renderSitemapCompanies, renderSitemapPages,
} from './_lib/render.js';

// Browsers always revalidate; Vercel's edge (and any CDN in front that honours CDN-Cache-Control) keeps the page for an hour.
const CACHE = 'public, s-maxage=3600, stale-while-revalidate=86400';
const STATS_CACHE = 'public, s-maxage=600, stale-while-revalidate=3600';
const BROWSER = 'public, max-age=0, must-revalidate';
// Page-type thresholds: below them the page is a 404 and is left out of the sitemap.
// Sector and city pages always render, but with fewer than `thin` companies they are noindex and not in the sitemap.
const MIN = { thin: 10, batch: 5, source: 10, hiring: 10, 'hiring-sector': 10, 'sector-city': 10, collection: 20 };
const one = v => (Array.isArray(v) ? v[0] : v);
const str = (v, max = 80) => String(one(v) ?? '').trim().slice(0, max);

function send(res, status, body, { type = 'text/html; charset=utf-8', cache = CACHE, browser = BROWSER, noindex = false } = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  const store = cache !== 'no-store';
  res.setHeader('Cache-Control', store ? browser : 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', cache);
  res.setHeader('CDN-Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (noindex) res.setHeader('X-Robots-Tag', 'noindex');
  res.end(body);
}
const notFound = async res => send(res, 404, renderNotFound({ nav: await getNav() }), { cache: 'public, s-maxage=60' });
const json = (res, status, data, cache) => send(res, status, JSON.stringify(data), { type: 'application/json; charset=utf-8', cache, noindex: true });
function redirect(res, location) {
  res.statusCode = 308;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', BROWSER);
  res.setHeader('Vercel-CDN-Cache-Control', CACHE);
  res.setHeader('CDN-Cache-Control', CACHE);
  res.end('');
}

// Filters arrive as plain GET parameters so any filtered view is a shareable URL.
export function readFilters(query) {
  const f = { q: str(query.q).replace(/\s+/g, ' '), sector: slugify(str(query.sector, 120)), city: slugify(str(query.city, 120)), batch: '', year: '', source: '', hiring: str(query.hiring) === '1', page: 1 };
  const batch = str(query.batch, 8).toUpperCase(), year = str(query.year, 8), source = str(query.source, 60).toLowerCase();
  if (BATCH_RE.test(batch)) f.batch = batch;
  // Older links post a year through the batch field.
  if (/^(19|20)\d{2}$/.test(batch)) f.year = batch;
  if (/^(19|20)\d{2}$/.test(year)) f.year = year;
  // The "Source or batch" select posts a YC batch as source=yc-s24.
  const viaSource = /^yc-([wxsf]\d{2})$/.exec(source);
  if (viaSource) f.batch = f.batch || viaSource[1].toUpperCase();
  else if (SLUG_RE.test(source)) f.source = source;
  // Only a known country is kept (?country=india); anything else is ignored and never echoed.
  const country = slugify(str(query.country, 40));
  f.country = Object.hasOwn(COUNTRIES, country) ? country : '';
  const page = Number.parseInt(str(query.page, 6), 10);
  if (page > 1 && page <= 100000) f.page = page;
  return f;
}

// The list for /companies. With a country it calls catalog_list_country (migration 202611260001). Until that is applied
// (404 / PGRST202), the United States falls back to catalog_list, which has only US rows then; any other country is empty.
export async function listRows(f, call = rpc) {
  if (!f.country) return call('catalog_list', listArgs(f));
  try {
    return await call('catalog_list_country', { p_country: f.country, ...listArgs(f) });
  } catch (e) {
    if (!(e && (e.status === 404 || e.code === 'PGRST202'))) throw e;
    return f.country === 'united-states' ? call('catalog_list', listArgs(f)) : { total: 0, rows: [] };
  }
}
const activeFilters = f => FILTER_KEYS.filter(k => f[k]);
const listArgs = (f, extra = {}) => ({
  p_q: f.q || null, p_sector: f.sector || null, p_city: f.city || null, p_batch: f.batch || null,
  p_year: f.year ? Number(f.year) : null, p_hiring: Boolean(f.hiring), p_page: f.page, p_per: PER_PAGE,
  p_source: f.source || null, p_collection: null, p_sort: null, ...extra,
});
const facetHit = (pools, key) => pools.flatMap(p => p || []).find(o => slugify(o.value) === key);
const link = (label, url, count) => ({ label, url, count });

// /companies: any combination of filters.
async function listAll(res, query) {
  const f = readFilters(query);
  const [facets, data, nav] = await Promise.all([rpc('catalog_facets'), listRows(f), getNav()]);
  const total = Number(data?.total) || 0;
  if (f.page > 1 && f.page > Math.ceil(total / PER_PAGE)) return notFound(res);
  // Canonical and robots: one filter that has its own page points there; a search or two or more filters are not indexed.
  const active = activeFilters(f);
  const self = SITE + listUrl('/companies', f);
  let canonical = self, robots = '';
  if (f.q || active.length >= 2) robots = 'noindex,follow';
  else if (active.length === 1) {
    const k = active[0];
    const target = k === 'sector' && total >= MIN.thin && facetHit([facets?.industries, facets?.sectors], f.sector) ? '/sector/' + f.sector
      : k === 'city' && total >= MIN.thin && facetHit([facets?.cities], f.city) ? '/city/' + f.city
      : k === 'batch' && total >= MIN.batch ? '/batch/' + f.batch.toLowerCase()
      : k === 'source' && total >= MIN.source ? '/source/' + f.source
      : k === 'hiring' && total >= MIN.hiring ? '/hiring' : '';
    if (target) canonical = SITE + target + (f.page > 1 ? '?page=' + f.page : '');
    else if (k !== 'year') robots = 'noindex,follow';
  }
  send(res, 200, renderList({ kind: 'all', filters: f, facets: facets || {}, total, rows: data?.rows, nav, canonical, robots }));
}

// A page type: one fixed filter in the path. Extra filters hand over to /companies.
async function listPage(res, query, kind) {
  const a = slugify(str(query.preset, 120)), b = slugify(str(query.preset2, 120));
  const extra = readFilters(query);
  // The fixed filter as /companies would express it.
  const fixed = { sector: {}, city: {}, batch: {}, source: {}, hiring: { hiring: true }, 'hiring-sector': { hiring: true, sector: a }, 'sector-city': { sector: a, city: b }, collection: null }[kind];
  if (kind === 'sector') fixed.sector = a;
  if (kind === 'city') fixed.city = a;
  if (kind === 'batch') { if (!/^[wxsf]\d{2}$/.test(a)) return notFound(res); fixed.batch = a.toUpperCase(); }
  if (kind === 'source') { if (!SLUG_RE.test(a)) return notFound(res); fixed.source = a; }
  if (kind === 'collection' && !COLLECTIONS[a]) return notFound(res);
  if (fixed && activeFilters(extra).length) return redirect(res, listUrl('/companies', { ...extra, ...fixed, page: 1 }));

  const f = { q: '', sector: '', city: '', batch: '', year: '', source: '', hiring: false, ...(fixed || {}), page: extra.page };
  const wantsCross = kind === 'sector' || kind === 'city' || kind === 'sector-city';
  const [facets, data, nav, cross] = await Promise.all([
    rpc('catalog_facets'),
    rpc('catalog_list', listArgs(f, kind === 'collection' ? { p_collection: a, p_sort: 'hiring' } : {})),
    getNav(),
    wantsCross ? rpc('catalog_crosslinks', { p_sector: kind === 'city' ? null : a, p_city: kind === 'city' ? a : null }).catch(() => null) : null,
  ]);
  const total = Number(data?.total) || 0;
  const sectorHit = f.sector ? facetHit([facets?.industries, facets?.sectors], f.sector) : null;
  const cityHit = f.city ? facetHit([facets?.cities], f.city) : null;
  if ((f.sector && !sectorHit) || (f.city && !cityHit)) return notFound(res);
  if (total < (MIN[kind] || 1)) return notFound(res);
  if (f.page > Math.ceil(total / PER_PAGE)) return notFound(res);

  const sector = sectorHit ? String(sectorHit.value) : '', city = cityHit ? String(cityHit.value) : '';
  const hiringSectors = new Map((nav?.hiring_sectors || []).map(s => [s.slug, s]));
  let path, labels = { sector, city }, crumbs = [], related = [];
  if (kind === 'sector') {
    path = '/sector/' + a;
    crumbs = [{ name: sector, url: path }];
    related = [
      Number(cross?.hiring) >= MIN['hiring-sector'] ? link(`${sector}, hiring`, '/hiring/' + a, cross.hiring) : null,
      ...(cross?.cities || []).map(c => link(`${sector} in ${c.label}`, `/sector/${a}/${c.slug}`, c.count)),
    ];
  } else if (kind === 'city') {
    path = '/city/' + a;
    crumbs = [{ name: city, url: path }];
    related = (cross?.sectors || []).map(s => link(`${s.label} in ${city}`, `/sector/${s.slug}/${a}`, s.count));
  } else if (kind === 'sector-city') {
    path = `/sector/${a}/${b}`;
    crumbs = [{ name: sector, url: '/sector/' + a }, { name: city, url: path }];
    related = [
      link(`All ${sector}`, '/sector/' + a, sectorHit.count), link(`All of ${city}`, '/city/' + b, cityHit.count),
      Number(cross?.hiring) >= MIN['hiring-sector'] ? link(`${sector}, hiring`, '/hiring/' + a, cross.hiring) : null,
      ...(cross?.cities || []).filter(c => c.slug !== b).map(c => link(`${sector} in ${c.label}`, `/sector/${a}/${c.slug}`, c.count)),
    ];
  } else if (kind === 'batch') {
    path = '/batch/' + a;
    labels = { batch: f.batch };
    crumbs = [{ name: batchName(f.batch), url: path }];
    // Previous and next batch that have a page.
    const batches = (facets?.batches || []).filter(o => batchLabel(o.value) && Number(o.count) >= MIN.batch);
    const i = batches.findIndex(o => o.value === f.batch);
    const near = (o, word) => (o ? link(`${word}: ${batchName(o.value)}`, '/batch/' + o.value.toLowerCase(), o.count) : null);
    const yc = (nav?.top_sources || []).find(s => s.slug === 'yc');
    related = [i >= 0 ? near(batches[i - 1], 'Next batch') : null, i >= 0 ? near(batches[i + 1], 'Previous batch') : null, yc ? link('All Y Combinator', '/source/yc', yc.count) : null];
  } else if (kind === 'source') {
    path = '/source/' + a;
    const name = String((facets?.sources || []).find(o => o.slug === a)?.value || a);
    labels = { source: name };
    crumbs = [{ name, url: path }];
    related = [
      ...(nav?.top_sources || []).filter(s => s.slug !== a).map(s => link(s.label, s.url, s.count)),
      ...(a === 'yc' ? (nav?.latest_batches || []).map(s => link(s.label, s.url, s.count)) : []),
    ];
  } else if (kind === 'hiring') {
    path = '/hiring';
    crumbs = [{ name: 'Hiring', url: path }];
    related = (nav?.hiring_sectors || []).map(s => link(`${s.label}, hiring`, s.url, s.count));
  } else if (kind === 'hiring-sector') {
    path = '/hiring/' + a;
    crumbs = [{ name: 'Hiring', url: '/hiring' }, { name: sector, url: path }];
    related = [
      link('All hiring', '/hiring', nav?.hiring), link(`All ${sector}`, '/sector/' + a, sectorHit.count),
      ...[...hiringSectors.values()].filter(s => s.slug !== a).map(s => link(`${s.label}, hiring`, s.url, s.count)),
    ];
  } else {
    path = '/collections/' + a;
    labels = { collection: COLLECTIONS[a].name, blurb: COLLECTIONS[a].blurb };
    crumbs = [{ name: 'Collections', url: '/collections' }, { name: COLLECTIONS[a].name, url: path }];
    related = (nav?.collections || []).filter(s => s.slug !== a && COLLECTIONS[s.slug]).map(s => link(COLLECTIONS[s.slug].name, s.url, s.count));
  }
  send(res, 200, renderList({
    kind, path, labels, crumbs, related, filters: f, facets: facets || {}, total, facts: data?.facts || null, rows: data?.rows, nav,
    canonical: SITE + path + (f.page > 1 ? '?page=' + f.page : ''), showForm: kind !== 'collection',
    robots: (kind === 'sector' || kind === 'city') && total < MIN.thin ? 'noindex,follow' : '',
  }));
}

async function company(res, query) {
  const raw = str(query.slug, 130).toLowerCase();
  const asJson = raw.endsWith('.json');
  const slug = asJson ? raw.slice(0, -5) : raw;
  if (!SLUG_RE.test(slug)) return asJson ? json(res, 404, { error: 'not_found' }, 'public, s-maxage=60') : notFound(res);
  if (asJson) {
    const c = await rpc('catalog_company', { p_slug: slug });
    return c && c.slug ? json(res, 200, quickView(c), CACHE) : json(res, 404, { error: 'not_found' }, 'public, s-maxage=60');
  }
  // Similar companies and the site stats are extras: the page still renders without them.
  const [c, similar, nav] = await Promise.all([rpc('catalog_company', { p_slug: slug }), rpc('catalog_similar', { p_slug: slug }).catch(() => []), getNav()]);
  if (!c || !c.slug) return notFound(res);
  return send(res, 200, renderCompany(c, { similar: Array.isArray(similar) ? similar : [], nav }));
}

// The landing page reads this. Only public numbers and link lists.
function publicStats(s) {
  const keys = ['companies', 'leaders', 'hiring', 'new_this_week', 'sources', 'top_sectors', 'top_cities', 'top_sources', 'newest', 'latest_batches', 'collections'];
  return Object.fromEntries(keys.map(k => [k, s?.[k] ?? (/^(top_|newest|latest_|collections)/.test(k) ? [] : 0)]));
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'Method not allowed', { type: 'text/plain; charset=utf-8', cache: 'no-store' });
  }
  const query = req.query || {};
  const view = str(query.view, 20);
  try {
    if (view === 'script') {
      // The URL carries a content hash (?v=), so browsers may keep it for a year.
      return send(res, 200, SCRIPT, { type: 'text/javascript; charset=utf-8', cache: 'public, s-maxage=31536000', browser: 'public, max-age=31536000, immutable' });
    }
    if (view === 'list') return await listAll(res, query);
    if (['sector', 'city', 'sector-city', 'batch', 'source', 'hiring', 'hiring-sector', 'collection'].includes(view)) return await listPage(res, query, view);
    if (view === 'company') return await company(res, query);
    if (view === 'new') {
      const [data, nav] = await Promise.all([rpc('catalog_new'), getNav()]);
      return send(res, 200, renderNew({ fresh: Boolean(data?.fresh), rows: Array.isArray(data?.rows) ? data.rows : [], run: data?.run || null, nav }));
    }
    if (view === 'collections') {
      const nav = await getNav({ strict: true });
      const items = (nav.collections || []).filter(c => COLLECTIONS[c.slug] && Number(c.count) >= MIN.collection);
      if (!items.length) return notFound(res);
      return send(res, 200, renderCollections({ items, nav }));
    }
    if (view === 'about') return send(res, 200, renderAbout({ nav: await getNav() }));
    if (view === 'stats') return json(res, 200, publicStats(await getNav({ strict: true })), STATS_CACHE);
    if (view === 'sitemap') {
      const part = str(query.part, 12);
      const data = (await rpc('catalog_sitemap')) || {};
      const body = part === 'companies' ? renderSitemapCompanies(data) : part === 'pages' ? renderSitemapPages(data) : renderSitemapIndex(data);
      return send(res, 200, body, { type: 'application/xml; charset=utf-8' });
    }
    return await notFound(res);
  } catch (e) {
    // Never show a stack trace; the response is not cached so recovery is immediate.
    console.error('FoundReach directory error', view, e?.status || '', e?.code || '', e?.message);
    if (view === 'sitemap') return send(res, 503, 'Temporarily unavailable', { type: 'text/plain; charset=utf-8', cache: 'no-store' });
    if (view === 'stats' || (view === 'company' && str(query.slug, 130).endsWith('.json'))) return json(res, 503, { error: 'unavailable' }, 'no-store');
    return send(res, 503, renderUnavailable(), { cache: 'no-store' });
  }
}
