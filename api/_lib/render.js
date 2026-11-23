// Server-rendered HTML for the public directory. Pure functions: data in, HTML string out.
// Rules that hold for every page: every interpolated value is escaped, only http(s) links are emitted,
// and nothing shaped like an email address ever reaches the markup.
// Markup and class names follow the designer's v2 files (shell.html, directory-v2.html, company-v2.html).
import { CSS } from './css.js';
import { SCRIPT_VERSION } from './script.js';

export const SITE = (process.env.SITE_URL || 'https://foundreach.navaghandabhi.dev').replace(/\/+$/, '');
export const PER_PAGE = 30;
const OG_IMAGE = SITE + '/brand/og-default.png';

// Anything@host.tld, whatever characters sit in front of the @.
const EMAIL_RE = /[^\s<>"'`=:;,()]*@[A-Za-z0-9._-]+\.[A-Za-z]{2,}/g;
const SPELLED_EMAIL_RE = /[A-Za-z0-9._%+-]+\s*[\[(]\s*at\s*[\])]\s*[A-Za-z0-9-]+(?:\s*(?:\.|[\[(]\s*dot\s*[\])])\s*[A-Za-z0-9-]+)+/gi;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
export const BATCH_RE = /^[WXSF]\d{2}$/;

export const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const stripEmails = v => String(v ?? '').replace(EMAIL_RE, '').replace(SPELLED_EMAIL_RE, '');
const text = v => stripEmails(v).replace(/\s+/g, ' ').trim();
export const slugify = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
// Cuts at a word boundary so the result is at most n characters.
export function trimWords(v, n) {
  const t = String(v ?? '');
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  const at = cut.lastIndexOf(' ');
  return (at > n * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:·(—-]+$/, '') + '…';
}
// A country as it is shown: the full name, never a code. Known US spellings become "United States";
// empty values and "unknown" give ''. The country is only ever read from its own field, never derived from the city.
const US_NAMES = new Set(['us', 'usa', 'united states', 'united states of america']);
export function countryName(v) {
  const t = text(v);
  const key = t.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!key || key === 'unknown') return '';
  return US_NAMES.has(key) ? 'United States' : clip(t, 60);
}
// "Austin, United States". The country is left out when the city text already ends with it ("San Francisco, CA, USA").
const cityHasCountry = (city, country) => countryName(city.split(',').pop()).toLowerCase() === country.toLowerCase();
function placeOf(c) {
  const city = text(c.city), country = countryName(c.country);
  if (!city || !country) return city || country;
  return cityHasCountry(city, country) ? city : `${city}, ${country}`;
}
const num = n => Number(n || 0).toLocaleString('en-US');
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

// Returns the URL only if it is a plain http(s) link with nothing email-like in it.
export function safeUrl(u) {
  const raw = String(u ?? '').trim();
  if (!raw || raw.length > 600 || /[\s<>"'`]/.test(raw)) return '';
  let parsed;
  try { parsed = new URL(raw); } catch { return ''; }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
  if (parsed.username || parsed.password) return '';
  EMAIL_RE.lastIndex = 0;
  if (EMAIL_RE.test(raw)) return '';
  return raw;
}
// LinkedIn: only company, person, school and showcase pages. Search links and legacy profile/view links are never shown.
export function safeLinkedin(u) {
  const url = safeUrl(u);
  if (!url) return '';
  const p = new URL(url);
  const host = p.hostname.toLowerCase();
  return (host === 'linkedin.com' || host.endsWith('.linkedin.com')) && /^\/(company|in|school|showcase)\/[^/]+/i.test(p.pathname) ? url : '';
}
// A contact page has a path segment that is exactly one of these (so /solutions/contact-centers is not one).
const CONTACT_SEGMENTS = new Set(['contact', 'contact-us', 'contactus', 'get-in-touch', 'support', 'help']);
export function safeContactUrl(u) {
  const url = safeUrl(u);
  if (!url) return '';
  return new URL(url).pathname.toLowerCase().split('/').some(seg => CONTACT_SEGMENTS.has(seg)) ? url : '';
}
const isYcUrl = u => { try { const h = new URL(u).hostname.toLowerCase(); return h === 'ycombinator.com' || h.endsWith('.ycombinator.com'); } catch { return false; } };
function shortUrl(u) {
  try {
    const p = new URL(u);
    return (p.hostname.replace(/^www\./, '') + p.pathname).replace(/\/+$/, '');
  } catch { return ''; }
}
const SEASONS = { W: 'Winter', X: 'Spring', S: 'Summer', F: 'Fall' };
export const batchLabel = b => (BATCH_RE.test(String(b || '')) ? 'YC ' + b : '');
// "S24" -> "YC Summer 2024"
export const batchName = b => (BATCH_RE.test(String(b || '')) ? `YC ${SEASONS[b[0]]} ${2000 + Number(b.slice(1))}` : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateParts(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  return { machine: d.toISOString().slice(0, 10), human: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}
const timeTag = iso => { const p = dateParts(iso); return p ? `<time datetime="${p.machine}">${p.human}</time>` : ''; };

// Rule-based collections (the rules live in the database; names and blurbs are repeated here for the pages).
export const COLLECTIONS = {
  ai: { name: 'AI startups', blurb: 'Companies that describe themselves as AI, LLM, machine learning, generative or agent products.' },
  fintech: { name: 'Fintech startups', blurb: 'Payments, banking, lending, insurance and other financial technology companies.' },
  'developer-tools': { name: 'Developer tools startups', blurb: 'APIs, SDKs, infrastructure and tools built for developers.' },
  healthcare: { name: 'Healthcare startups', blurb: 'Care delivery, biotech, diagnostics and health software companies.' },
  'climate-energy': { name: 'Climate and energy startups', blurb: 'Companies working on climate, carbon, energy, solar and batteries.' },
  'open-source': { name: 'Open source startups', blurb: 'Companies whose product is open source.' },
  'robotics-hardware': { name: 'Robotics and hardware startups', blurb: 'Robots, drones and other hardware companies.' },
  'newly-launched': { name: 'Newly launched startups', blurb: 'Companies from the two most recent batches.' },
};

// ---------------------------------------------------------------- page shell (designer: shell.html)
const ICON = {
  mark: '<rect width="40" height="40" rx="10" fill="#c9f15a"/><path d="M13 27L27 13" fill="none" stroke="#202a31" stroke-width="3.6" stroke-linecap="round"/><circle cx="13" cy="27" r="5" fill="#202a31"/><circle cx="27" cy="13" r="4.4" fill="#c9f15a" stroke="#202a31" stroke-width="3.2"/>',
  word: '<path d="M52 32L52 8L65 8M52 19.5L62.5 19.5M84.6 24A8 8 0 0 1 68.6 24A8 8 0 0 1 84.6 24M89.8 16L89.8 25A7 7 0 0 0 103.8 25L103.8 16M103.8 16L103.8 32M109.8 16L109.8 32M109.8 23A7 7 0 0 1 123.8 23L123.8 32M145 24A8 8 0 0 1 129 24A8 8 0 0 1 145 24M145 8L145 32M151 32L151 8L159.5 8A6.5 6.5 0 0 1 159.5 21L151 21M158.5 21L166 32M169.6 24L185.6 24A8 8 0 1 0 183.26 29.66M206 24A8 8 0 0 1 190 24A8 8 0 0 1 206 24M206 16L206 32M224.86 18.34A8 8 0 1 0 224.86 29.66M229.6 8L229.6 32M229.6 23A7 7 0 0 1 243.6 23L243.6 32" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>',
  save: '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 3h9v14L10 13.5 5.5 17z"/></svg>',
  lock: '<svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10.5l4 4 8-9"/></svg>',
};

// Header links. Under 600px the designer hides the links marked "w"; they are all repeated in the footer.
const NAV = [['directory', '/companies', 'Directory', true], ['new', '/new', 'New', false], ['hiring', '/hiring', 'Hiring', true], ['collections', '/collections', 'Collections', true]];
export function siteHeader(active = '') {
  return `<header class="top">
  <div class="wrap">
    <a class="brand" href="/"><svg class="brand-logo" viewBox="0 0 247 40" width="173" height="28" role="img" aria-label="FoundReach">${ICON.mark}${ICON.word}</svg></a>
    <nav class="nav" aria-label="Main">
      ${NAV.map(([key, href, label, wide]) => `<a${wide ? ' class="w"' : ''} href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('\n      ')}
    </nav>
    <a class="btn" href="/app/pipeline" data-auth>Sign in</a>
  </div>
</header>`;
}

// nav: the catalog_stats() payload, or null when it could not be loaded (the link blocks are then left out).
export function siteFooter(nav) {
  const block = (title, items, more) => {
    const links = (items || []).filter(o => o && o.url && text(o.label)).map(o => `<li><a href="${esc(o.url)}">${esc(text(o.label))}</a></li>`);
    if (!links.length) return '';
    if (more) links.push(`<li><a href="${more[0]}">${more[1]}</a></li>`);
    return `<div><p class="foot-h">${title}</p><ul>${links.join('')}</ul></div>`;
  };
  const cols = nav ? [
    block('Sectors', nav.top_sectors),
    block('Cities', nav.top_cities),
    block('Batches', nav.latest_batches),
    block('Sources', nav.top_sources),
    block('Collections', nav.collections),
  ].join('') : '';
  return `<footer class="foot">
  <div class="wrap">
    <p class="foot-brand"><svg width="24" height="24" viewBox="0 0 40 40" aria-hidden="true">${ICON.mark}</svg>Every startup, one step from its founders.</p>
${cols ? `    <nav class="foot-cols" aria-label="Browse the directory">${cols}</nav>\n` : ''}    <nav class="foot-nav" aria-label="Footer">
      <a href="/companies">Directory</a>
      <a href="/new">New this week</a>
      <a href="/hiring">Hiring</a>
      <a href="/collections">Collections</a>
      <a href="/about-data">About the data</a>
      <a href="/privacy">Privacy</a>
      <a href="/remove">Remove or correct my information</a>
    </nav>
    <p>Sources: public startup directories and each company's own website.</p>
  </div>
</footer>`;
}

const ldGraph = nodes => ({ '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) });
const ldCrumbs = crumbs => (crumbs && crumbs.length ? {
  '@type': 'BreadcrumbList',
  itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: text(c.name), item: SITE + c.url })),
} : null);
const crumbsNav = crumbs => (crumbs && crumbs.length > 1
  ? `<nav aria-label="Breadcrumb"><ol class="crumbs">${crumbs.map((c, i) => (i === crumbs.length - 1 ? `<li aria-current="page">${esc(text(c.name))}</li>` : `<li><a href="${esc(c.url)}">${esc(text(c.name))}</a></li>`)).join('')}</ol></nav>` : '');

function shell({ title, description = '', canonical = '', robots = '', jsonLd = null, main, mainClass = 'wrap', nav = null, active = '', skip = 'Skip to content', bodyClass = '', after = '' }) {
  const t = esc(text(title));
  const d = esc(trimWords(text(description), 155));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f6f7f3" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#11171b" media="(prefers-color-scheme: dark)">
<title>${t}</title>
${d ? `<meta name="description" content="${d}">\n` : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ''}${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ''}<meta property="og:site_name" content="FoundReach">
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
${d ? `<meta property="og:description" content="${d}">\n` : ''}${canonical ? `<meta property="og:url" content="${esc(canonical)}">\n` : ''}<meta property="og:image" content="${esc(OG_IMAGE)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
${d ? `<meta name="twitter:description" content="${d}">\n` : ''}<meta name="twitter:image" content="${esc(OG_IMAGE)}">
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/brand/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&amp;display=swap">
<script>document.documentElement.className='js'</script>
<style>${CSS}</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body${bodyClass ? ` class="${bodyClass}"` : ''}>
<a class="skip" href="#main">${esc(skip)}</a>
${siteHeader(active)}
<main id="main" class="${mainClass}">
${main}
</main>
${after}${siteFooter(nav)}
<script src="/directory.js?v=${SCRIPT_VERSION}" defer></script>
</body>
</html>
`;
  // Last line of defence: whatever the data held, no email-shaped string leaves this function.
  return html.replace(EMAIL_RE, '');
}

function logo(url, name, size, extra = '') {
  const src = safeUrl(url);
  if (src) return `<img class="logo${extra}" width="${size}" height="${size}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(src)}">`;
  const letter = (text(name).match(/[A-Za-z0-9]/) || ['·'])[0];
  return `<span class="logo logo-fb${extra}" aria-hidden="true">${esc(letter)}</span>`;
}

// Badges as the database returns them: [{label, source, batch?, batch_page?}], with a fallback to the YC batch.
function badgesOf(c) {
  const list = (Array.isArray(c.badges) ? c.badges : []).map(b => ({
    label: clip(text(b?.label), 40), source: SLUG_RE.test(String(b?.source || '')) ? String(b.source) : '',
    batch: BATCH_RE.test(String(b?.batch || '')) ? String(b.batch) : '', batchPage: b?.batch_page === true,
  })).filter(b => b.label);
  if (!list.length && batchLabel(c.batch)) list.push({ label: batchLabel(c.batch), source: 'yc', batch: c.batch, batchPage: false });
  return list;
}

// ---------------------------------------------------------------- list rows (designer: li > a.row + a.qv-btn)
function row(c) {
  const name = text(c.name) || 'Company';
  const slug = encodeURIComponent(c.slug);
  const badges = badgesOf(c);
  const tags = badges.slice(0, 2).map(b => `<span class="tag">${esc(b.label)}</span>`).join('') + (badges.length > 2 ? `<span class="tag">+${badges.length - 2}</span>` : '');
  const desc = clip(text(c.description), 140);
  const leaders = Number(c.leaders) || 0;
  const sector = text(c.sector) || text(c.industry);
  const place = placeOf(c);
  const meta = [
    c.hiring ? '<span class="chip">Hiring</span>' : '',
    sector ? `<span class="m m-sector">${esc(sector)}</span>` : '',
    place ? `<span class="m m-city">${esc(place)}</span>` : '',
    leaders ? `<span class="m m-lead">${leaders} ${plural(leaders, 'leader', 'leaders')}</span>` : '',
  ].join('');
  return `<li><a class="row" href="/companies/${slug}">${logo(c.logo_url, name, 44)}<div class="row-body"><div class="row-head"><h2 class="row-name">${esc(name)}</h2>${tags ? `<span class="tags">${tags}</span>` : ''}</div>${desc ? `<p class="row-desc">${esc(desc)}</p>` : ''}</div><div class="row-meta">${meta}</div></a><a class="qv-btn" href="/companies/${slug}#reach" data-qv="${esc(c.slug)}" aria-label="Quick view: ${esc(name)}">${useIcon('i-q')}<span>Quick view</span></a><a class="qv-btn sv-btn" href="/?save=${slug}" rel="nofollow" aria-label="Save ${esc(name)}">${useIcon('i-s')}<span class="sr-only">Save</span></a></li>`;
}
const validRows = rows => (Array.isArray(rows) ? rows : []).filter(c => c && SLUG_RE.test(String(c.slug || '')));
const rowsList = rows => `<ul class="list">\n${validRows(rows).map(row).join('\n')}\n</ul>`;

// Row icons are drawn once per page and referenced from each row.
const ROW_ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><symbol id="i-q" viewBox="0 0 20 20"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5"/><path d="M12 3.5v13"/></symbol><symbol id="i-s" viewBox="0 0 20 20"><path d="M5.5 3h9v14L10 13.5 5.5 17z"/></symbol></svg>
`;
const useIcon = id => `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><use href="#${id}"/></svg>`;
// The quick-view drawer: a native dialog (focus trap, Esc and backdrop come with it). Filled by /directory.js.
const QUICK_VIEW = `<dialog class="qv" id="qv" aria-modal="true" aria-labelledby="qv-name">
  <form class="qv-bar" method="dialog"><span>Quick view</span><button class="btn" type="submit">Close</button></form>
  <div class="qv-body" id="qv-body"></div>
  <div class="qv-foot"><a class="btn btn-dark" id="qv-open" href="/companies">Open full page</a><a class="btn" id="qv-save" href="/" rel="nofollow">${ICON.save}Save</a></div>
</dialog>
`;

// ---------------------------------------------------------------- list URLs
// filters: { q, sector, city, country, batch, year, source, hiring, page } with sector/city/source already slugified.
export const FILTER_KEYS = ['q', 'sector', 'city', 'country', 'batch', 'year', 'source', 'hiring'];
// Countries the directory can be browsed by: slug -> name. `place` is how a heading says "in ...".
export const COUNTRIES = {
  'united-states': { name: 'United States', place: 'the United States' },
  india: { name: 'India', place: 'India' },
};
export function listUrl(basePath, filters, change = {}) {
  const f = { ...filters, ...change };
  const parts = [];
  for (const k of [...FILTER_KEYS, 'page']) {
    let v = f[k];
    if (k === 'hiring') v = v ? '1' : '';
    if (k === 'page') v = Number(v) > 1 ? String(Math.floor(Number(v))) : '';
    if (v === undefined || v === null || v === '') continue;
    parts.push(k + '=' + encodeURIComponent(String(v)).replace(/%20/g, '+'));
  }
  return basePath + (parts.length ? '?' + parts.join('&') : '');
}

function pager(urlOf, page, pages) {
  if (pages <= 1) return '';
  const url = p => esc(urlOf(p));
  const wanted = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter(p => p >= 1 && p <= pages));
  const nums = [];
  let last = 0;
  for (const p of [...wanted].sort((a, b) => a - b)) {
    if (p - last > 1) nums.push('<li><span class="pg" aria-hidden="true">…</span></li>');
    nums.push(p === page ? `<li><a class="pg" href="${url(p)}" aria-current="page" aria-label="Page ${p}">${p}</a></li>` : `<li><a class="pg" href="${url(p)}" aria-label="Page ${p}">${p}</a></li>`);
    last = p;
  }
  const prev = page > 1 ? `<a class="pg pg-step" href="${url(page - 1)}" rel="prev">&larr; Prev</a>` : '<span class="pg pg-step" aria-disabled="true">&larr; Prev</span>';
  const next = page < pages ? `<a class="pg pg-step" href="${url(page + 1)}" rel="next">Next &rarr;</a>` : '<span class="pg pg-step" aria-disabled="true">Next &rarr;</span>';
  return `<nav class="pager" aria-label="Pagination">${prev}<ol class="pg-nums">${nums.join('')}</ol><span class="pg-status">Page ${page} of ${num(pages)}</span>${next}</nav>`;
}

const pills = links => `<ul class="pills">${links.filter(l => l && l.url && text(l.label)).map(l => `<li><a class="pill" href="${esc(l.url)}">${esc(text(l.label))}${l.count ? ` <small>${num(l.count)}</small>` : ''}</a></li>`).join('')}</ul>`;
const relatedSection = (links, title = 'Related', id = 'rel-h') => {
  const body = (links || []).filter(l => l && l.url && text(l.label));
  return body.length ? `<section class="sec" aria-labelledby="${id}"><h2 class="sec-h" id="${id}">${title}</h2>${pills(body)}</section>` : '';
};

// Titles aim for about 60 characters: the long suffix is dropped when it would not fit.
const fitTitle = (stem, pageBit = '') => {
  const full = `${stem}: founders, careers & contact${pageBit} | FoundReach`;
  return full.length <= 60 ? full : `${stem}${pageBit} | FoundReach`;
};
// What each page type says about itself. labels: { sector, city, batch, source, collection }.
const PAGE_TYPES = {
  sector: { eyebrow: 'Sector', desc: (l, n) => `${n} ${l.sector} startups: founders, careers pages and contact links.`, h1: l => `${l.sector} startups`, sub: (l, n) => `${n} ${l.sector} startups, with the people who run them and how to reach each one.` },
  city: { eyebrow: 'City', desc: (l, n) => `${n} startups in ${l.city}: founders, careers pages and contact links.`, h1: l => `Startups in ${l.city}`, sub: (l, n) => `${n} startups based in ${l.city}, with the people who run them and how to reach each one.` },
  batch: { eyebrow: 'YC batch', desc: (l, n) => `${n} startups from the ${batchName(l.batch)} batch: founders, careers pages and contact links.`, h1: l => `${batchName(l.batch)} startups`, sub: (l, n) => `${n} companies from Y Combinator's ${batchName(l.batch).slice(3)} batch, with the people who run them and how to reach each one.` },
  source: { eyebrow: 'Source', desc: (l, n) => `${n} startups listed by ${l.source}: founders, careers pages and contact links.`, h1: l => `${l.source} startups`, sub: (l, n) => `${n} startups listed by ${l.source}, with the people who run them and how to reach each one.` },
  hiring: { eyebrow: 'Hiring', desc: (l, n) => `${n} startups hiring now: careers pages, founders and contact links.`, h1: () => 'Startups hiring now', sub: (l, n) => `${n} startups with an open careers page, with the people who run them and how to reach each one.` },
  'hiring-sector': { eyebrow: 'Hiring', desc: (l, n) => `${n} ${l.sector} startups hiring now: careers pages, founders and contact links.`, h1: l => `${l.sector} startups hiring now`, sub: (l, n) => `${n} ${l.sector} startups with an open careers page, with the people who run them and how to reach each one.` },
  'sector-city': { eyebrow: 'Sector in a city', desc: (l, n) => `${n} ${l.sector} startups in ${l.city}: founders, careers pages and contact links.`, h1: l => `${l.sector} startups in ${l.city}`, sub: (l, n) => `${n} ${l.sector} companies based in ${l.city}, with the people who run them and how to reach each one.` },
  collection: { eyebrow: 'Collection', desc: (l, n) => `${n} ${l.collection}: founders, careers pages and contact links. ${l.blurb || ''}`.trim(), h1: l => l.collection, sub: (l, n) => `${l.blurb || ''} ${n} companies, hiring first, then newest.`.trim() },
};

// view: { kind, path, labels, crumbs, related, filters, facets, total, facts, rows, nav, canonical, robots, showForm }
//   kind 'all' is /companies (filters in the query string); every other kind is a page type with its own path.
export function renderList({ kind = 'all', path = '/companies', labels = {}, crumbs = [], related = [], filters, facets, total, facts = null, rows, nav = null, canonical = '', robots = '', showForm = true }) {
  const f = filters;
  const page = Math.max(1, Number(f.page) || 1);
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / PER_PAGE));
  const all = Number(facets?.total) || 0;
  const find = (list, slug) => (list || []).find(o => slugify(o.value) === slug);
  // The sector filter offers the top-level industries; a finer sector slug (older links) still filters and gets its own label.
  const industries = facets?.industries?.length ? facets.industries : facets?.sectors;
  const sectorName = f.sector ? text((find(facets?.industries, f.sector) || find(facets?.sectors, f.sector))?.value || f.sector) : '';
  const cityName = f.city ? text(find(facets?.cities, f.city)?.value || f.city) : '';
  const sourceName = f.source ? text((facets?.sources || []).find(o => o.slug === f.source)?.value || f.source) : '';
  const country = Object.hasOwn(COUNTRIES, f.country || '') ? COUNTRIES[f.country] : null;

  const options = (list, current) => (list || []).map(o => {
    const value = slugify(o.value);
    if (!value) return '';
    return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(text(o.value))} (${num(o.count)})</option>`;
  }).join('');
  // One select for "Source or batch": sources first, then YC batches as yc-s24. The server reads both from `source`.
  const sourceValue = f.batch ? 'yc-' + f.batch.toLowerCase() : f.source || '';
  const sourceOptions = [
    ...(facets?.sources || []).filter(o => SLUG_RE.test(String(o.slug || ''))).map(o => ({ value: o.slug, label: text(o.value), count: o.count })),
    ...(facets?.batches || []).filter(o => batchLabel(o.value)).map(o => ({ value: 'yc-' + o.value.toLowerCase(), label: batchLabel(o.value), count: o.count })),
  ].map(o => `<option value="${esc(o.value)}"${o.value === sourceValue ? ' selected' : ''}>${esc(o.label)} (${num(o.count)})</option>`).join('');

  const select = (id, label, body) => `<div><label class="sr-only" for="${id}">${label}</label><select class="field" id="${id}" name="${id}">${body}</select></div>`;
  const form = showForm ? `<form class="filters" action="/companies" method="get" role="search" aria-label="Filter companies">
<div class="f-q"><label class="sr-only" for="q">Search companies</label><input class="field" id="q" name="q" type="search" placeholder="Search by name or description" autocomplete="off" maxlength="80" value="${esc(f.q || '')}"></div>
${select('sector', 'Sector', `<option value="">All sectors</option>${options(industries, f.sector)}`)}
${select('city', 'City', `<option value="">All cities</option>${options(facets?.cities, f.city)}`)}
${select('country', 'Country', `<option value="">All countries</option>${Object.entries(COUNTRIES).map(([slug, c]) => `<option value="${slug}"${country && slug === f.country ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}`)}
${select('source', 'Source or batch', `<option value="">All sources</option>${sourceOptions}`)}
${select('hiring', 'Hiring', `<option value="">Any hiring status</option><option value="1"${f.hiring ? ' selected' : ''}>Hiring only</option>`)}
${f.year ? `<input type="hidden" name="year" value="${esc(f.year)}">` : ''}<button class="btn btn-dark" type="submit">Search</button>
</form>` : '';

  // Chips only on /companies: a page type's own filter is its heading, not a chip.
  const chips = [];
  if (kind === 'all') {
    const chip = (label, aria, change) => chips.push(`<li><a class="chip-x" href="${esc(listUrl('/companies', f, { page: '', ...change }))}" aria-label="Remove filter: ${esc(aria)}"><span>${esc(label)}</span></a></li>`);
    if (f.q) chip(`“${f.q}”`, 'Search ' + f.q, { q: '' });
    if (f.sector) chip(sectorName, 'Sector ' + sectorName, { sector: '' });
    if (f.city) chip(cityName, 'City ' + cityName, { city: '' });
    if (country) chip(country.name, 'Country ' + country.name, { country: '' });
    if (f.source) chip(sourceName, 'Source ' + sourceName, { source: '' });
    if (f.batch) chip(batchLabel(f.batch) || f.batch, 'Batch ' + f.batch, { batch: '' });
    if (f.year) chip(String(f.year), 'Year ' + f.year, { year: '' });
    if (f.hiring) chip('Hiring only', 'Hiring only', { hiring: '' });
  }
  const filtered = chips.length > 0;
  const chipsHtml = filtered ? `<ul class="chips" aria-label="Active filters">${chips.join('')}<li><a class="clear" href="/companies">Clear filters</a></li></ul>` : '';
  const count = `<p class="count" role="status"><strong>${num(total)}</strong> ${all && (filtered || kind !== 'all') ? `of ${num(all)} companies` : plural(total, 'company', 'companies')}${page > 1 ? ` · page ${page} of ${num(pages)}` : ''}</p>`;
  const urlOf = p => (kind === 'all' ? listUrl('/companies', f, { page: p }) : path + (p > 1 ? '?page=' + p : ''));
  const list = validRows(rows).length
    ? rowsList(rows) + '\n' + pager(urlOf, page, pages)
    : `<div class="state"><h2>No companies match these filters.</h2><p>Try removing a filter, or browse the newest additions.</p><div class="actions"><a class="btn btn-dark" href="/companies">Clear filters</a><a class="btn" href="/new">See new companies</a></div></div>`;
  // A plain link into the India view, only on /companies and only when no country is chosen yet.
  const browse = kind === 'all' && !country ? '<ul class="chips" aria-label="Browse by country"><li><a class="pill" href="/companies?country=india">Browse India</a></li></ul>\n' : '';
  const results = `<section class="results" id="results" aria-label="Results">\n${count}\n${browse}${chipsHtml}\n${list}\n</section>\n<p class="sr-only" id="live" aria-live="polite"></p>`;

  // Headings and titles.
  const type = PAGE_TYPES[kind];
  const L = Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, text(v)]));
  let h1, hero, title, description;
  const pageBit = page > 1 ? ' · page ' + page : '';
  if (type) {
    h1 = type.h1(L);
    hero = `<div class="hero" id="hero"><p class="eyebrow">${type.eyebrow}</p><h1>${esc(h1)}</h1><p class="sub">${esc(type.sub(L, num(total)))}</p></div>`;
    title = fitTitle(h1, pageBit);
    description = `${type.desc(L, num(total))}${page > 1 ? ` Page ${page} of ${num(pages)}.` : ''}`;
  } else {
    // "Fintech startups in Boston · YC S24, hiring now: founders, careers & contact"
    const tBatch = batchLabel(f.batch) || (f.year ? `YC ${f.year}` : '') || sourceName;
    const lead = sectorName || tBatch;
    // A city already says where; the country is named only without one.
    const place = cityName || (country ? country.place : '');
    const subject = `${lead ? lead + ' startups' : 'Startups'}${place ? ' in ' + place : ''}${f.q ? ` matching “${f.q}”` : ''}`;
    const extras = [sectorName ? tBatch : '', f.hiring ? 'hiring now' : ''].filter(Boolean).join(', ');
    // The heading says what the list is filtered to, like the title does.
    h1 = filtered ? `${subject}${extras ? ' · ' + extras : ''}` : 'Startups you can actually reach';
    hero = `<div class="hero" id="hero"><h1>${esc(h1)}</h1><p class="sub">Every company page shows who runs it and the fastest ways to get in touch.</p></div>`;
    title = filtered ? fitTitle(h1, pageBit) : `Startup directory: ${num(all)} startups you can contact${pageBit} | FoundReach`;
    description = filtered
      ? `${num(total)} ${plural(total, 'result', 'results')} for ${subject}${extras ? ' (' + extras + ')' : ''}: founders, careers pages and contact links.`
      : `Browse ${num(all)} startups by sector, city, source and batch. Each page lists the founders, careers page, contact page and LinkedIn.${page > 1 ? ` Page ${page} of ${num(pages)}.` : ''}`;
  }
  const factsHtml = type && facts ? `<div class="facts"><div><b>${num(total)}</b><span>${plural(total, 'company', 'companies')}</span></div><div><b>${num(facts.hiring)}</b><span>hiring now</span></div><div><b>${num(facts.leaders)}</b><span>leaders listed</span></div><div><b>${num(facts.new)}</b><span>new this week</span></div></div>` : '';

  const trail = [{ name: 'Directory', url: '/companies' }, ...crumbs];
  const jsonLd = ldGraph([
    kind === 'all' ? { '@type': 'WebSite', name: 'FoundReach', url: SITE + '/', potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: SITE + '/companies?q={search_term_string}' }, 'query-input': 'required name=search_term_string' } } : null,
    ldCrumbs(trail),
    validRows(rows).length ? {
      '@type': 'ItemList', name: text(h1), numberOfItems: Number(total) || 0,
      itemListElement: validRows(rows).map((c, i) => ({ '@type': 'ListItem', position: (page - 1) * PER_PAGE + i + 1, name: text(c.name) || 'Company', url: `${SITE}/companies/${encodeURIComponent(c.slug)}` })),
    } : null,
  ]);

  return shell({
    title, description, canonical, robots, jsonLd, nav, skip: 'Skip to results',
    active: kind === 'hiring' || kind === 'hiring-sector' ? 'hiring' : kind === 'collection' ? 'collections' : 'directory',
    main: `${crumbsNav(trail)}\n${hero}\n${factsHtml}\n${form}\n${results}\n${relatedSection(related)}`,
    after: ROW_ICONS + QUICK_VIEW,
  });
}

// data: { fresh, rows, run }
export function renderNew({ fresh, rows, run, nav = null }) {
  const checked = run && dateParts(run.ran_at);
  // The same total as the rest of the site (catalog_stats) when it is loaded; the last run's own count otherwise.
  const tracked = Number(nav?.companies) || Number(run?.our_count) || 0;
  const coverage = run && tracked ? `<p class="note">Tracking ${num(tracked)} companies${checked ? ` · checked ${timeTag(run.ran_at)}` : ''}. <a href="/about-data">About the data</a></p>` : '';
  rows = validRows(rows).slice(0, PER_PAGE);
  const h1 = fresh ? 'New this week' : 'Recently added';
  const sub = fresh ? 'Companies added to the directory in the last 7 days.' : 'Nothing new in the last 7 days. These are the most recent additions.';
  const list = rows.length ? rowsList(rows) : `<div class="state"><h2>No companies yet.</h2><p>Check back soon.</p><div class="actions"><a class="btn btn-dark" href="/companies">Browse all companies</a></div></div>`;
  const trail = [{ name: 'Directory', url: '/companies' }, { name: h1, url: '/new' }];
  return shell({
    title: `${fresh ? 'New startups this week' : 'Recently added startups'}: founders, careers & contact | FoundReach`,
    description: 'The newest companies in the FoundReach directory, with their founders, careers pages and contact pages.',
    canonical: SITE + '/new', nav, active: 'new', skip: 'Skip to results',
    jsonLd: ldGraph([ldCrumbs(trail), rows.length ? { '@type': 'ItemList', name: h1, numberOfItems: rows.length, itemListElement: rows.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: text(c.name) || 'Company', url: `${SITE}/companies/${encodeURIComponent(c.slug)}` })) } : null]),
    main: `${crumbsNav(trail)}\n<div class="hero" id="hero"><p class="eyebrow">New</p><h1>${h1}</h1><p class="sub">${sub}</p></div>\n<section class="results" id="results" aria-label="Results">\n<p class="count" role="status"><strong>${num(rows.length)}</strong> ${plural(rows.length, 'company', 'companies')} · <a href="/companies">Browse all companies</a></p>\n${list}\n</section>\n${coverage}`,
    after: ROW_ICONS + QUICK_VIEW,
  });
}

// ---------------------------------------------------------------- company page (designer: company-v2.html)
function leadersOf(c) {
  return (Array.isArray(c.leaders) ? c.leaders : []).map(l => ({
    id: UUID_RE.test(String(l.id || '')) ? String(l.id) : '',
    first: text(l.first_name), name: [text(l.first_name), text(l.last_name)].filter(Boolean).join(' '),
    role: text(l.role), tier: l.tier === 'Secondary' ? 'Secondary' : 'Primary', linkedin: safeLinkedin(l.linkedin_url),
  })).filter(l => l.name).sort((a, b) => (a.tier === 'Secondary') - (b.tier === 'Secondary'));
}

// The only fields /companies/:slug.json may carry. No emails, notes or owner fields exist in the input, and none are added.
export function quickView(c) {
  const leaders = leadersOf(c);
  const iso = dateParts(c.verified_at);
  const out = {
    slug: String(c.slug),
    name: text(c.name) || 'Company',
    logo_url: safeUrl(c.logo_url) || null,
    badges: badgesOf(c).map(b => b.label),
    city: text(c.city) || null,
    country: countryName(c.country) || null,
    place: placeOf(c) || null,
    industry: text(c.industry) || null,
    sector: text(c.sector) || null,
    description: clip(text(c.description), 280),
    website: safeUrl(c.website) || null,
    careers_url: safeUrl(c.careers_url) || null,
    contact_url: safeContactUrl(c.contact_url) || null,
    linkedin_url: safeLinkedin(c.linkedin_url) || null,
    hiring: Boolean(safeUrl(c.careers_url)),
    verified_at: iso ? iso.machine : null,
    leaders: leaders.slice(0, 5).map(l => ({ name: l.name, role: l.role || null, linkedin_url: l.linkedin || null })),
    leaders_count: Math.max(leaders.length, Number(c.leaders_count) || 0),
    primary_contact_id: leaders[0]?.id || null,
  };
  // Same last line of defence as the HTML pages.
  return JSON.parse(JSON.stringify(out).replace(EMAIL_RE, ''));
}

// c: catalog_company() payload. similar: catalog_similar() rows. nav: catalog_stats() or null.
export function renderCompany(c, { similar = [], nav = null } = {}) {
  const slug = String(c.slug);
  const enc = encodeURIComponent(slug);
  const name = text(c.name) || 'Company';
  const tag = batchLabel(c.batch);
  const city = text(c.city), sector = text(c.sector), industry = text(c.industry);
  const country = countryName(c.country);
  const topic = industry || sector;
  const description = stripEmails(c.description).trim();
  const flat = description.replace(/\s+/g, ' ').trim();
  const leaders = leadersOf(c);
  const lead = leaders[0];
  const draft = `/?draft=${enc}${lead?.id ? '&contact=' + lead.id : ''}`;
  const save = `/?save=${enc}`;
  const careers = safeUrl(c.careers_url), linkedin = safeLinkedin(c.linkedin_url);
  const links = [['Website', safeUrl(c.website)], [isYcUrl(careers) ? 'Jobs on YC' : 'Careers page', careers], ['Contact page', safeContactUrl(c.contact_url)], ['Company LinkedIn', linkedin]].filter(l => l[1]);
  const canonical = `${SITE}/companies/${enc}`;
  // Two companies can share a name and a batch; the website keeps their titles apart.
  const site = c.name_shared && safeUrl(c.website) ? shortUrl(safeUrl(c.website)).split('/')[0] : '';
  const badges = badgesOf(c);
  const label = [tag || badges[0]?.label, site].filter(Boolean).join(', ');
  const title = `${name}${label ? ` (${label})` : ''}: founders, careers & contact | FoundReach`;
  const metaDescription = `${name}${label ? ` (${label})` : ''}${city ? ', ' + city : ''}${flat ? ': ' + clip(flat, 150) : ''} Founders, careers page and contact links.`;

  // Pages that exist, from the cached site stats. Without them the badge and collection links are left out.
  const sourcePages = new Set((nav?.top_sources || []).map(s => s.slug));
  const collectionPages = new Map((nav?.collections || []).map(s => [s.slug, Number(s.count) || 0]));
  const badgeHref = b => (b.source === 'yc' && b.batch && b.batchPage ? '/batch/' + b.batch.toLowerCase() : b.source && sourcePages.has(b.source) ? '/source/' + b.source : '');
  const tags = badges.map(b => { const href = badgeHref(b); return `<li>${href ? `<a class="tag" href="${esc(href)}">${esc(b.label)}</a>` : `<span class="tag">${esc(b.label)}</span>`}</li>`; }).join('');
  // "Also in": at most two collections, the most specific first.
  const also = (Array.isArray(c.collections) ? c.collections : [])
    .filter(k => k && collectionPages.has(k.slug) && COLLECTIONS[k.slug])
    .sort((a, b) => collectionPages.get(a.slug) - collectionPages.get(b.slug)).slice(0, 2)
    .map(k => ({ label: COLLECTIONS[k.slug].name, url: '/collections/' + k.slug, count: collectionPages.get(k.slug) }));
  const sc = c.sector_city && SLUG_RE.test(String(c.sector_city.sector_slug || '')) && SLUG_RE.test(String(c.sector_city.city_slug || '')) ? c.sector_city : null;
  const browse = [
    sc ? { label: `${text(sc.sector)} startups in ${text(sc.city)}`, url: `/sector/${sc.sector_slug}/${sc.city_slug}`, count: sc.count } : null,
    ...also,
  ].filter(Boolean);

  const trail = [{ name: 'Directory', url: '/companies' }, topic && slugify(topic) ? { name: topic, url: '/sector/' + slugify(topic) } : null, { name, url: '/companies/' + enc }].filter(Boolean);
  const org = { '@type': 'Organization', name, url: safeUrl(c.website) || canonical };
  if (safeUrl(c.logo_url)) org.logo = safeUrl(c.logo_url);
  if (flat) org.description = clip(flat, 600);
  if (city || country) org.address = { '@type': 'PostalAddress', ...(city ? { addressLocality: city } : {}), ...(country ? { addressCountry: country } : {}) };
  if (linkedin) org.sameAs = [linkedin];

  // City, country, sector: only the parts that exist, with a dot between them. The chip follows without a dot.
  const metaBits = [
    city && slugify(city) ? `<a href="/city/${esc(slugify(city))}">${esc(city)}</a>` : '',
    country && !(city && cityHasCountry(city, country)) ? `<span>${esc(country)}</span>` : '',
    topic && slugify(topic) ? `<a href="/sector/${esc(slugify(topic))}">${esc(topic)}</a>` : '',
  ].filter(Boolean).join('<span aria-hidden="true">&middot;</span>') + (careers ? '<span class="chip">Hiring</span>' : '');
  const note = `${lead ? `${esc(lead.name)}${lead.role ? ` is ${esc(lead.role)}` : ' is listed as a leader'}. ` : ''}Drafting and saving need a free sign-in.`;
  const paragraphs = description.split(/(?:\r?\n\s*){2,}/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const about = paragraphs.length ? paragraphs.map(p => `<p>${esc(p)}</p>`).join('') : `<p class="muted">No description yet.</p>`;
  const people = leaders.length
    ? `<ul class="people">${leaders.map(l => `<li><div class="p-body"><div class="p-top"><h3 class="p-name">${esc(l.name)}</h3></div>${l.role ? `<p class="p-role">${esc(l.role)}</p>` : ''}</div>${l.linkedin ? `<a class="btn" href="${esc(l.linkedin)}" rel="nofollow noopener" aria-label="${esc(l.name)} on LinkedIn">LinkedIn <span aria-hidden="true">&nearr;</span></a>` : ''}</li>`).join('')}</ul>`
    : `<p class="muted">No leaders listed yet.</p>`;
  const verified = timeTag(c.verified_at);
  // "Source: Y Combinator and Techstars, plus the company's own website."
  const srcNames = [...new Set((Array.isArray(c.source_labels) ? c.source_labels : []).map(v => clip(text(v), 40)).filter(Boolean))].slice(0, 4);
  const srcList = srcNames.length > 1 ? srcNames.slice(0, -1).join(', ') + ' and ' + srcNames.at(-1) : srcNames[0] || '';
  const sourceLine = srcList ? `Source: ${esc(srcList)}, plus the company's own website.` : `Source: public startup directories and the company's own website.`;
  const updated = timeTag(c.updated_at);
  const draftLabel = `Draft a message to ${esc(lead ? lead.first || lead.name : name)}`;
  // Similar companies: six at most, and only when there are at least three.
  const sim = validRows(similar).filter(s => s.slug !== slug).slice(0, 6);
  const simHtml = sim.length >= 3 ? `<section class="card" aria-labelledby="sim-h"><h2 id="sim-h">Similar companies</h2>
<ul class="sim">${sim.map(s => { const n = text(s.name) || 'Company'; const d = clip(text(s.description), 110); return `<li><a href="/companies/${encodeURIComponent(s.slug)}">${logo(s.logo_url, n, 36, ' logo-s')}<span><b>${esc(n)}</b>${d ? `<small>${esc(d)}</small>` : ''}</span></a></li>`; }).join('')}</ul>
</section>` : '';
  const browseHtml = browse.length ? `<section class="card" aria-labelledby="also-h"><h2 id="also-h">Also in</h2>${pills(browse)}</section>` : '';

  const main = `${crumbsNav(trail)}
<article class="co">
<header class="co-head">
${logo(c.logo_url, name, 64).replace(' loading="lazy"', '')}
<div><h1 class="co-name">${esc(name)}</h1>${metaBits ? `<p class="co-meta">${metaBits}</p>` : ''}</div>
${tags ? `<ul class="tags co-tags" aria-label="Where this company comes from">${tags}</ul>` : ''}
<div class="cta"><a class="btn btn-dark btn-lg cta-d" href="${esc(draft)}" rel="nofollow">${draftLabel}</a><a class="btn btn-lg cta-d" href="${esc(save)}" rel="nofollow">${ICON.save}Save</a><a class="btn btn-lg jump" href="#reach">Reach them &darr;</a><p class="cta-note">${note}</p></div>
</header>
<section class="card" aria-labelledby="about-h"><h2 id="about-h">About</h2><div class="prose">${about}</div></section>
<section class="card reach" id="reach" aria-labelledby="reach-h"><h2 id="reach-h">Reach them</h2>
${links.length ? `<ul class="out">${links.map(([l, url]) => `<li><a href="${esc(url)}" rel="nofollow noopener"><b>${l}</b><small>${esc(shortUrl(url))}</small></a></li>`).join('')}</ul>` : ''}
<a class="locked" href="${esc(draft)}" rel="nofollow">${ICON.lock}<span><b>Company, hiring and founder emails</b><span class="locked-go">Sign in free to view</span></span></a>
${verified ? `<p class="verified">${ICON.check}<span>Links last checked ${verified}</span></p>` : ''}
<p class="verified src">${sourceLine}</p>
<div class="reach-cta"><a class="btn btn-dark" href="${esc(draft)}" rel="nofollow">Draft a message</a><a class="btn" href="${esc(save)}" rel="nofollow">${ICON.save}Save</a></div>
</section>
<section class="card" aria-labelledby="leaders-h"><h2 id="leaders-h">Leaders${leaders.length ? ` <span class="muted">(${leaders.length})</span>` : ''}</h2>${people}</section>
${simHtml}
${browseHtml}
</article>
<div class="co-tools"><button class="btn" type="button" data-copy="${esc(canonical)}" hidden>Copy link</button></div>
<p class="note">${updated ? `Updated ${updated}. ` : ''}Is this your company? <a href="/remove?company=${enc}" rel="nofollow">Remove or correct my information</a>. <a href="/about-data">About the data</a></p>`;

  return shell({ title, description: metaDescription, canonical, jsonLd: ldGraph([org, ldCrumbs(trail)]), main, nav, active: 'directory', bodyClass: 'has-bar' });
}

// ---------------------------------------------------------------- collections index, about the data
// items: [{slug, label, count}] for collections that have a page.
export function renderCollections({ items = [], nav = null }) {
  const cards = items.filter(i => COLLECTIONS[i.slug]).map(i => `<a class="card" href="/collections/${esc(i.slug)}"><h3>${esc(COLLECTIONS[i.slug].name)}</h3><p>${esc(COLLECTIONS[i.slug].blurb)}</p><small>${num(i.count)} ${plural(i.count, 'company', 'companies')}</small></a>`).join('\n');
  const trail = [{ name: 'Directory', url: '/companies' }, { name: 'Collections', url: '/collections' }];
  return shell({
    title: 'Startup collections: founders, careers & contact | FoundReach',
    description: 'Startups grouped by theme: AI, fintech, developer tools, healthcare, climate and energy, open source, robotics and newly launched companies.',
    canonical: SITE + '/collections', nav, active: 'collections',
    jsonLd: ldGraph([ldCrumbs(trail), { '@type': 'ItemList', name: 'Collections', numberOfItems: items.length, itemListElement: items.filter(i => COLLECTIONS[i.slug]).map((i, n) => ({ '@type': 'ListItem', position: n + 1, name: COLLECTIONS[i.slug].name, url: `${SITE}/collections/${i.slug}` })) }]),
    main: `${crumbsNav(trail)}\n<div class="hero" id="hero"><p class="eyebrow">Collections</p><h1>Collections</h1><p class="sub">Startups grouped by theme. Each list is built by a simple rule, sorted with hiring companies first, then newest.</p></div>\n<div class="cards">\n${cards}\n</div>`,
  });
}

// nav: catalog_stats() (for the live numbers), or null.
export function renderAbout({ nav = null }) {
  const cov = nav?.coverage || null;
  const total = Number(nav?.companies) || 0;
  const pct = n => (total ? Math.round((Number(n) || 0) * 100 / total) + '%' : '');
  const line = (label, n) => `<tr><td>${label}</td><td>${num(n)}${total ? ` (${pct(n)})` : ''}</td></tr>`;
  const lastRun = cov?.last_run ? timeTag(cov.last_run.ran_at) : '';
  const lastVerified = cov ? timeTag(cov.last_verified_at) : '';
  const sources = (nav?.top_sources || []).filter(s => s && s.url && text(s.label));
  const trail = [{ name: 'Directory', url: '/companies' }, { name: 'Our data', url: '/about-data' }];
  const main = `${crumbsNav(trail)}
<div class="hero" id="hero"><p class="eyebrow">About the data</p><h1>Our data</h1><p class="sub">What FoundReach lists, where it comes from, how often it is refreshed and what we never publish.</p></div>
<div class="prose">
<h2 id="what">What we list</h2>
<p>FoundReach is a free directory of startups${total ? ` (${num(total)} companies today)` : ''}. Most are based in the United States today. More countries are coming. Each company page shows a short description, its sector and location, the links that help you get in touch (website, careers page, contact page and company LinkedIn) and the founders and leaders with their public LinkedIn profiles.</p>
<h2 id="sources">Sources and what badges mean</h2>
<p>Companies come from public startup directories and from each company's own website. A badge on a company, such as "YC S24", says which public list it appears on and, where known, which batch or year. A company can carry more than one badge.</p>
${sources.length ? `<ul>${sources.map(s => `<li><a href="${esc(s.url)}">${esc(text(s.label))}</a>: ${num(s.count)} ${plural(s.count, 'company', 'companies')}</li>`).join('')}</ul>` : ''}
<h2 id="refresh">Refresh cadence and coverage</h2>
<p>We look for newly listed companies once a day and add them to <a href="/new">New</a>.${lastRun ? ` The last run was on ${lastRun}.` : ''}${nav ? ` ${num(nav.new_this_week)} ${plural(nav.new_this_week, 'company was', 'companies were')} added in the last 7 days.` : ''}</p>
${cov && total ? `<table><thead><tr><th scope="col">Of ${num(total)} companies</th><th scope="col">Have it</th></tr></thead><tbody>${line('Website', cov.website)}${line('Careers page', cov.careers)}${line('Contact page', cov.contact)}${line('Company LinkedIn', cov.linkedin)}${line('At least one leader', cov.leaders)}${line('Links checked', cov.verified)}</tbody></table>` : ''}
<h2 id="checked">What "last checked" means</h2>
<p>"Links last checked" on a company page is the most recent date we confirmed that company's links against its public sources. It is not a promise that every link still works today. Pages without that line have not been re-checked since they were added.${lastVerified ? ` The most recent check anywhere in the directory was on ${lastVerified}.` : ''}</p>
<h2 id="never">What we never publish</h2>
<ul><li>Email addresses. Public pages never show them, for companies or for people.</li><li>Guessed emails. We do not generate or infer addresses.</li><li>Person pages. People appear only on their company's page, with their role and public LinkedIn link.</li></ul>
<h2 id="remove">How to remove or correct something</h2>
<p>If a page lists you or your company and something is wrong, or you want it gone, use the <a href="/remove">remove or correct form</a>. You do not need to sign in, and we act on every request.</p>
</div>`;
  return shell({
    title: 'Our data: sources, refresh cadence and removal | FoundReach',
    description: 'What FoundReach lists, where the data comes from, how often it is refreshed, what "last checked" means, what we never publish and how to remove or correct a listing.',
    canonical: SITE + '/about-data', nav, mainClass: 'wrap narrow', jsonLd: ldGraph([ldCrumbs(trail)]), main,
  });
}

// ---------------------------------------------------------------- states
export function renderNotFound({ nav = null } = {}) {
  return shell({
    title: 'Page not found | FoundReach', robots: 'noindex', nav,
    main: `<div class="state"><span class="state-code">404</span><h1>We can't find that page.</h1><p>The company may have been removed, or the link is out of date.</p><div class="actions"><a class="btn btn-dark" href="/companies">Browse all companies</a><a class="btn" href="/new">See new companies</a></div></div>`,
  });
}
export function renderUnavailable() {
  return shell({
    title: 'Temporarily unavailable | FoundReach', robots: 'noindex',
    main: `<div class="state"><span class="state-code">Temporarily unavailable</span><h1>The directory is taking a short break.</h1><p>Something went wrong on our side. Please try again in a minute.</p><div class="actions"><a class="btn btn-dark" href="/companies">Try again</a></div></div>`,
  });
}

const RELATIONS = ['I am the person listed', 'I work at the company', 'I am acting on their behalf', 'Other'];
export function renderRemoveForm({ company = '', values = {}, error = '', nav = null } = {}) {
  const slug = SLUG_RE.test(company) ? company : '';
  const v = k => esc(String(values[k] ?? ''));
  return shell({
    title: 'Remove or correct my information | FoundReach', robots: 'noindex', mainClass: 'wrap narrow', nav,
    main: `<div class="hero"><h1>Remove or correct my information</h1><p class="sub">Tell us what to change. We act on every request and never ask you to sign in.</p></div>
${error ? `<p class="state-code" role="alert">${esc(error)}</p>` : ''}
<form class="card form" action="/remove" method="post">
<input type="hidden" name="company" value="${esc(slug)}">
<div hidden><label>Leave this field empty <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
<div><label class="label" for="name">Your name</label><input class="field" id="name" name="name" type="text" autocomplete="name" required minlength="2" maxlength="120" value="${v('name')}"></div>
<div><label class="label" for="relation">Your relation to the company or person</label><select class="field" id="relation" name="relation" required><option value="">Choose one</option>${RELATIONS.map(r => `<option${values.relation === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
<div><label class="label" for="request">What should we remove or correct?</label><textarea class="field" id="request" name="request" rows="5" required minlength="5" maxlength="4000" aria-describedby="request-hint">${v('request')}</textarea><p class="hint" id="request-hint">${slug ? `This request is about <a href="/companies/${esc(slug)}">/companies/${esc(slug)}</a>.` : 'Include the company name or the page link so we can find it.'}</p></div>
<button class="btn btn-dark btn-lg" type="submit">Send request</button>
</form>`,
  });
}
export function renderRemoveDone({ nav = null } = {}) {
  return shell({
    title: 'Request received | FoundReach', robots: 'noindex', mainClass: 'wrap narrow', nav,
    main: `<div class="state" role="status"><span class="state-code">Request received</span><h1>Thanks. We have your request.</h1><p>We will review it and update or remove the listing. You do not need to do anything else.</p><div class="actions"><a class="btn" href="/companies">Back to the directory</a></div></div>`,
  });
}

// ---------------------------------------------------------------- sitemaps (index + two children)
const xml = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
const day = v => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : '');
const urlset = entries => `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(([u, lastmod]) => `<url><loc>${xml(SITE + u)}</loc>${day(lastmod) ? `<lastmod>${day(lastmod)}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;

export function renderSitemapIndex({ lastmod = '' } = {}) {
  const mod = day(lastmod) ? `<lastmod>${day(lastmod)}</lastmod>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<sitemap><loc>${xml(SITE)}/sitemap-pages.xml</loc>${mod}</sitemap>\n<sitemap><loc>${xml(SITE)}/sitemap-companies.xml</loc>${mod}</sitemap>\n</sitemapindex>\n`;
}
// data: catalog_sitemap()
export function renderSitemapCompanies(data) {
  return urlset((data?.companies || []).filter(c => c && SLUG_RE.test(String(c.slug || ''))).map(c => ['/companies/' + encodeURIComponent(c.slug), c.lastmod]));
}
export function renderSitemapPages(data) {
  const slugs = list => [...new Set((list || []).map(s => String(s || '')).filter(s => SLUG_RE.test(s)))];
  const mod = data?.lastmod;
  const urls = [
    '/', '/companies', '/new', '/about-data',
    ...(Number(data?.hiring) >= 10 ? ['/hiring'] : []),
    ...slugs(data?.hiring_sectors).map(s => '/hiring/' + s),
    ...(slugs(data?.collections).length ? ['/collections'] : []),
    ...slugs(data?.collections).filter(s => COLLECTIONS[s]).map(s => '/collections/' + s),
    ...slugs(data?.sources).map(s => '/source/' + s),
    ...slugs(data?.batches).filter(s => /^[wxsf]\d{2}$/.test(s)).map(s => '/batch/' + s),
    ...slugs(data?.sectors).map(s => '/sector/' + s),
    ...slugs(data?.cities).map(s => '/city/' + s),
    ...(data?.sector_cities || []).filter(o => o && SLUG_RE.test(String(o.sector || '')) && SLUG_RE.test(String(o.city || ''))).map(o => `/sector/${o.sector}/${o.city}`),
  ];
  return urlset(urls.map(u => [u, mod]));
}
