// Server-rendered HTML for the public directory. Pure functions: data in, HTML string out.
// Rules that hold for every page: every interpolated value is escaped, only http(s) links are emitted,
// and nothing shaped like an email address ever reaches the markup.
import { CSS } from './css.js';

export const SITE = (process.env.SITE_URL || 'https://foundreach.navaghandabhi.dev').replace(/\/+$/, '');
export const PER_PAGE = 30;

// Anything@host.tld, whatever characters sit in front of the @.
const EMAIL_RE = /[^\s<>"'`=:;,()]*@[A-Za-z0-9._-]+\.[A-Za-z]{2,}/g;
const SPELLED_EMAIL_RE = /[A-Za-z0-9._%+-]+\s*[\[(]\s*at\s*[\])]\s*[A-Za-z0-9-]+(?:\s*(?:\.|[\[(]\s*dot\s*[\])])\s*[A-Za-z0-9-]+)+/gi;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;

export const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const stripEmails = v => String(v ?? '').replace(EMAIL_RE, '').replace(SPELLED_EMAIL_RE, '');
const text = v => stripEmails(v).replace(/\s+/g, ' ').trim();
export const slugify = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const num = n => Number(n || 0).toLocaleString('en-US');

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
export const batchLabel = b => (/^[WXSF]\d{2}$/.test(String(b || '')) ? 'YC ' + b : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateParts(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  return { machine: d.toISOString().slice(0, 10), human: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}
const timeTag = iso => { const p = dateParts(iso); return p ? `<time datetime="${p.machine}">${p.human}</time>` : ''; };

// ---------------------------------------------------------------- page shell
const GENERIC_FOOT = `<p>Source: Y Combinator's public directory and each company's website.</p><a href="/remove">Remove or correct my information</a><a href="/privacy">Privacy</a>`;

function shell({ title, description = '', canonical = '', robots = '', ogImage = '', jsonLd = null, main, mainClass = 'wrap', foot = GENERIC_FOOT, skip = 'Skip to content', script = '' }) {
  const t = esc(text(title));
  const d = esc(clip(text(description), 300));
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#202a31">
<title>${t}</title>
${d ? `<meta name="description" content="${d}">\n` : ''}${canonical ? `<link rel="canonical" href="${esc(canonical)}">\n` : ''}${robots ? `<meta name="robots" content="${esc(robots)}">\n` : ''}<meta property="og:site_name" content="FoundReach">
<meta property="og:type" content="website">
<meta property="og:title" content="${t}">
${d ? `<meta property="og:description" content="${d}">\n` : ''}${canonical ? `<meta property="og:url" content="${esc(canonical)}">\n` : ''}${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">\n` : ''}<meta name="twitter:card" content="summary">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&amp;display=swap">
<style>${CSS}</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>\n` : ''}</head>
<body>
<a class="skip" href="#main">${esc(skip)}</a>
<header class="top">
  <div class="wrap">
    <a class="brand" href="/companies"><span class="logo-mark" aria-hidden="true">F</span>FoundReach</a>
    <a class="top-link" href="/new">New</a>
    <a class="btn" href="/">Sign in</a>
  </div>
</header>
<main id="main" class="${mainClass}">
${main}
</main>
<footer class="foot">
  <div class="wrap">${foot}</div>
</footer>
${script}</body>
</html>
`;
  // Last line of defence: whatever the data held, no email-shaped string leaves this function.
  return html.replace(EMAIL_RE, '');
}

function logo(url, name, size) {
  const src = safeUrl(url);
  if (src) return `<img class="logo" width="${size}" height="${size}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(src)}">`;
  const letter = (text(name).match(/[A-Za-z0-9]/) || ['·'])[0];
  return `<span class="logo logo-fb" aria-hidden="true">${esc(letter)}</span>`;
}

// ---------------------------------------------------------------- list rows
function row(c) {
  const name = text(c.name) || 'Company';
  const tag = batchLabel(c.batch);
  const desc = clip(text(c.description), 140);
  const leaders = Number(c.leaders) || 0;
  const meta = [
    c.hiring ? '<span class="chip">Hiring</span>' : '',
    text(c.sector) ? `<span class="m m-sector">${esc(text(c.sector))}</span>` : '',
    text(c.city) ? `<span class="m m-city">${esc(text(c.city))}</span>` : '',
    leaders ? `<span class="m m-lead">${leaders} ${leaders === 1 ? 'leader' : 'leaders'}</span>` : '',
  ].join('');
  return `<li><a class="row" href="/companies/${encodeURIComponent(c.slug)}">${logo(c.logo_url, name, 44)}<div class="row-body"><div class="row-head"><h2 class="row-name">${esc(name)}</h2>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}</div>${desc ? `<p class="row-desc">${esc(desc)}</p>` : ''}</div>${meta ? `<div class="row-meta">${meta}</div>` : ''}</a></li>`;
}
const rowsList = rows => `<ul class="list">\n${rows.filter(c => c && SLUG_RE.test(String(c.slug || ''))).map(row).join('\n')}\n</ul>`;

// ---------------------------------------------------------------- list URLs
// filters: { q, sector, city, batch, year, hiring, page } with sector/city already slugified.
const FILTER_KEYS = ['q', 'sector', 'city', 'batch', 'year', 'hiring', 'page'];
export function listUrl(basePath, filters, change = {}) {
  const f = { ...filters, ...change };
  const parts = [];
  for (const k of FILTER_KEYS) {
    let v = f[k];
    if (k === 'hiring') v = v ? '1' : '';
    if (k === 'page') v = Number(v) > 1 ? String(Math.floor(Number(v))) : '';
    if (v === undefined || v === null || v === '') continue;
    parts.push(k + '=' + encodeURIComponent(String(v)).replace(/%20/g, '+'));
  }
  return basePath + (parts.length ? '?' + parts.join('&') : '');
}

function pager(basePath, filters, page, pages) {
  if (pages <= 1) return '';
  const url = p => esc(listUrl(basePath, filters, { page: p }));
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

const SEASONS = { W: 'Winter', X: 'Spring', S: 'Summer', F: 'Fall' };
const FILTER_SCRIPT = `<script>(function(){var f=document.querySelector('form.filters');if(!f)return;function go(){[].forEach.call(f.elements,function(e){if(e.name&&!e.value)e.disabled=true});}f.addEventListener('submit',go);[].forEach.call(f.querySelectorAll('select'),function(s){s.addEventListener('change',function(){go();f.submit();});});window.addEventListener('pageshow',function(){[].forEach.call(f.elements,function(e){e.disabled=false});});})();</script>\n`;

// view: { mode: 'all'|'sector'|'city', basePath, presetLabel, filters, facets, total, rows }
export function renderList({ mode = 'all', basePath = '/companies', presetLabel = '', filters, facets, total, rows }) {
  const f = filters;
  const page = Math.max(1, Number(f.page) || 1);
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / PER_PAGE));
  const all = Number(facets?.total) || 0;
  const find = (list, slug) => (list || []).find(o => slugify(o.value) === slug);
  // The sector filter offers YC's top-level industries; a finer sector slug (older links) still filters and gets its own label.
  const industries = facets?.industries?.length ? facets.industries : facets?.sectors;
  const sectorName = f.sector ? text((find(facets?.industries, f.sector) || find(facets?.sectors, f.sector))?.value || f.sector) : '';
  const cityName = f.city ? text(find(facets?.cities, f.city)?.value || f.city) : '';

  const options = (list, current, label) => (list || []).map(o => {
    const value = slugify(o.value);
    if (!value) return '';
    return `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label ? label(o) : text(o.value))} (${num(o.count)})</option>`;
  }).join('');
  const batchValue = f.batch || (f.year ? String(f.year) : '');
  const batchOptions = [
    ...(facets?.years || []).map(o => ({ value: String(o.value), label: String(o.value), count: o.count, year: Number(o.value), rank: 9 })),
    ...(facets?.batches || []).filter(o => batchLabel(o.value)).map(o => ({ value: o.value, label: `${batchLabel(o.value)} · ${SEASONS[o.value[0]]}`, count: o.count, year: 2000 + Number(o.value.slice(1)) - (Number(o.value.slice(1)) > 80 ? 100 : 0), rank: 'WXSF'.indexOf(o.value[0]) })),
  ].sort((a, b) => (b.year - a.year) || (b.rank - a.rank))
    .map(o => `<option value="${esc(o.value)}"${o.value === batchValue ? ' selected' : ''}>${esc(o.label)} (${num(o.count)})</option>`).join('');

  const select = (id, label, body) => `<div><label class="sr-only" for="${id}">${label}</label><select class="field" id="${id}" name="${id}">${body}</select></div>`;
  const form = `<form class="filters" action="${esc(basePath)}" method="get" role="search" aria-label="Filter companies">
<div class="f-q"><label class="sr-only" for="q">Search companies</label><input class="field" id="q" name="q" type="search" placeholder="Search by name or description" autocomplete="off" maxlength="80" value="${esc(f.q || '')}"></div>
${mode === 'sector' ? '' : select('sector', 'Sector', `<option value="">All sectors</option>${options(industries, f.sector)}`)}
${mode === 'city' ? '' : select('city', 'City', `<option value="">All cities</option>${options(facets?.cities, f.city)}`)}
${select('batch', 'Batch or year', `<option value="">All batches</option>${batchOptions}`)}
${select('hiring', 'Hiring', `<option value="">Hiring or not</option><option value="1"${f.hiring ? ' selected' : ''}>Hiring only</option>`)}
<button class="btn btn-dark" type="submit">Search</button>
</form>`;

  const chips = [];
  const chip = (label, aria, change) => chips.push(`<li><a class="chip-x" href="${esc(listUrl(basePath, f, { page: '', ...change }))}" aria-label="Remove filter: ${esc(aria)}"><span>${esc(label)}</span></a></li>`);
  if (f.q) chip(`“${f.q}”`, 'Search ' + f.q, { q: '' });
  if (f.sector && mode !== 'sector') chip(sectorName, 'Sector ' + sectorName, { sector: '' });
  if (f.city && mode !== 'city') chip(cityName, 'City ' + cityName, { city: '' });
  if (f.batch) chip(batchLabel(f.batch) || f.batch, 'Batch ' + f.batch, { batch: '' });
  if (f.year) chip(String(f.year), 'Year ' + f.year, { year: '' });
  if (f.hiring) chip('Hiring only', 'Hiring only', { hiring: '' });
  const chipsHtml = chips.length ? `<ul class="chips" aria-label="Active filters">${chips.join('')}<li><a class="clear" href="${esc(basePath)}">Clear filters</a></li></ul>` : '';

  const h1 = mode === 'sector' ? `${presetLabel} startups` : mode === 'city' ? `Startups in ${presetLabel}` : 'Startups you can actually reach';
  const sub = mode === 'sector' ? `Founders, careers pages and contact pages for US ${presetLabel} startups.`
    : mode === 'city' ? `Founders, careers pages and contact pages for startups based in ${presetLabel}.`
    : `Founders, careers pages and contact pages for ${num(all)} US startups.`;
  const filtered = chips.length > 0;
  const count = filtered || mode !== 'all'
    ? `<strong>${num(total)}</strong> ${total === 1 ? 'company' : 'companies'}${filtered ? ' match' : ''}${all ? ` (of ${num(all)})` : ''}`
    : `<strong>${num(total)}</strong> ${total === 1 ? 'company' : 'companies'}`;

  const results = rows.length
    ? rowsList(rows) + '\n' + pager(basePath, f, page, pages)
    : `<div class="state"><h2>No companies match these filters.</h2><p>Try removing a filter, or browse the newest additions.</p><div class="actions"><a class="btn btn-dark" href="${esc(basePath)}">Clear filters</a><a class="btn" href="/new">See new companies</a></div></div>`;

  // The title says what the page lists: "Fintech startups in Boston · YC S24, hiring now: founders, careers & contact".
  const tSector = mode === 'sector' ? presetLabel : sectorName, tCity = mode === 'city' ? presetLabel : cityName;
  const tBatch = batchLabel(f.batch) || (f.year ? `YC ${f.year}` : '');
  const lead = tSector || tBatch;
  const subject = `${lead ? lead + ' startups' : 'Startups'}${tCity ? ' in ' + tCity : ''}${f.q ? ` matching “${f.q}”` : ''}`;
  const extras = [tSector ? tBatch : '', f.hiring ? 'hiring now' : ''].filter(Boolean).join(', ');
  const plain = mode === 'all' && !filtered;
  const title = `${plain ? `Startup directory: ${num(all)} US startups you can contact` : `${subject}${extras ? ' · ' + extras : ''}: founders, careers & contact`}${page > 1 ? ' · page ' + page : ''} | FoundReach`;
  const description = plain ? `Browse ${num(all)} US startups by sector, city and YC batch. Each page lists the founders, careers page, contact page and LinkedIn.`
    : `${num(total)} ${total === 1 ? 'company' : 'companies'}: ${subject}${extras ? ' (' + extras + ')' : ''}, with their founders, careers pages, contact pages and LinkedIn.`;

  return shell({
    title, description,
    canonical: SITE + listUrl(basePath, f),
    robots: f.q ? 'noindex,follow' : '',
    skip: 'Skip to results',
    main: `<div class="hero"><h1>${esc(text(h1))}</h1><p class="sub">${esc(text(sub))}</p><p class="count">${count}</p></div>\n${form}\n${chipsHtml}\n${results}`,
    script: FILTER_SCRIPT,
  });
}

// data: { fresh, rows, run }
export function renderNew({ fresh, rows, run }) {
  const checked = run && dateParts(run.ran_at);
  const coverage = run
    ? `<p class="count" style="margin-top:20px">Tracking ${num(run.our_count)} of ${num(run.yc_count)} active US YC companies${checked ? ` · checked ${timeTag(run.ran_at)}` : ''}</p>` : '';
  rows = rows.slice(0, PER_PAGE);
  const h1 = fresh ? 'New this week' : 'Recently added';
  const sub = fresh ? 'Companies added to the directory in the last 7 days.' : 'Nothing new in the last 7 days. These are the most recent additions.';
  const list = rows.length ? rowsList(rows) : `<div class="state"><h2>No companies yet.</h2><p>Check back soon.</p><div class="actions"><a class="btn btn-dark" href="/companies">Browse all companies</a></div></div>`;
  return shell({
    title: `${fresh ? 'New startups this week' : 'Recently added startups'} | FoundReach`,
    description: 'The newest companies in the FoundReach directory, with their founders, careers pages and contact pages.',
    canonical: SITE + '/new',
    skip: 'Skip to results',
    main: `<div class="hero"><h1>${h1}</h1><p class="sub">${sub}</p><p class="count"><strong>${num(rows.length)}</strong> ${rows.length === 1 ? 'company' : 'companies'} · <a href="/companies">Browse all companies</a></p></div>\n${list}\n${coverage}`,
  });
}

// ---------------------------------------------------------------- company page
export function renderCompany(c) {
  const slug = String(c.slug);
  const name = text(c.name) || 'Company';
  const tag = batchLabel(c.batch);
  const city = text(c.city), sector = text(c.sector);
  const description = stripEmails(c.description).trim();
  const flat = description.replace(/\s+/g, ' ').trim();
  const leaders = (Array.isArray(c.leaders) ? c.leaders : []).map(l => ({
    id: UUID_RE.test(String(l.id || '')) ? String(l.id) : '',
    first: text(l.first_name), name: [text(l.first_name), text(l.last_name)].filter(Boolean).join(' '),
    role: text(l.role), tier: l.tier === 'Secondary' ? 'Secondary' : 'Primary', linkedin: safeLinkedin(l.linkedin_url),
  })).filter(l => l.name).sort((a, b) => (a.tier === 'Secondary') - (b.tier === 'Secondary'));
  const lead = leaders[0];
  const draft = `/?draft=${encodeURIComponent(slug)}${lead?.id ? '&contact=' + lead.id : ''}`;
  const careers = safeUrl(c.careers_url), linkedin = safeLinkedin(c.linkedin_url);
  const links = [['Website', safeUrl(c.website)], [isYcUrl(careers) ? 'Jobs on YC' : 'Careers page', careers], ['Contact page', safeContactUrl(c.contact_url)], ['Company LinkedIn', linkedin]].filter(l => l[1]);
  const canonical = `${SITE}/companies/${encodeURIComponent(slug)}`;
  // Two companies can share a name and a batch; the website keeps their titles apart.
  const site = c.name_shared && safeUrl(c.website) ? shortUrl(safeUrl(c.website)).split('/')[0] : '';
  const label = [tag, site].filter(Boolean).join(', ');
  const title = `${name}${label ? ` (${label})` : ''}: founders, careers & contact | FoundReach`;
  const metaDescription = `${name}${tag ? ` (${tag})` : ''}${city ? ', ' + city : ''}${flat ? ': ' + clip(flat, 150) : ''} Founders, careers page and contact links.`;

  const jsonLd = { '@context': 'https://schema.org', '@type': 'Organization', name, url: safeUrl(c.website) || canonical };
  if (safeUrl(c.logo_url)) jsonLd.logo = safeUrl(c.logo_url);
  if (flat) jsonLd.description = clip(flat, 600);
  if (city) jsonLd.address = { '@type': 'PostalAddress', addressLocality: city };
  if (linkedin) jsonLd.sameAs = [linkedin];

  const metaBits = [
    tag ? `<span class="tag">${esc(tag)}</span>` : '',
    city ? `<a href="/city/${esc(slugify(city))}">${esc(city)}</a>` : '',
    city && sector ? '<span aria-hidden="true">&middot;</span>' : '',
    sector ? `<a href="/sector/${esc(slugify(sector))}">${esc(sector)}</a>` : '',
    careers ? '<span class="chip">Hiring</span>' : '',
  ].join('');
  const note = lead ? `${esc(lead.name)}${lead.role ? ` is ${esc(lead.role)}` : ' is listed as a leader'}. Drafting needs a free sign-in.` : 'Drafting needs a free sign-in.';
  const paragraphs = description.split(/(?:\r?\n\s*){2,}/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const about = paragraphs.length ? paragraphs.map(p => `<p>${esc(p)}</p>`).join('') : `<p class="muted">No description yet.</p>`;
  const people = leaders.length
    ? `<ul class="people">${leaders.map(l => `<li><div class="p-body"><div class="p-top"><h3 class="p-name">${esc(l.name)}</h3><span class="tier${l.tier === 'Primary' ? ' tier-1' : ''}">${l.tier}</span></div>${l.role ? `<p class="p-role">${esc(l.role)}</p>` : ''}</div>${l.linkedin ? `<a class="btn" href="${esc(l.linkedin)}" rel="nofollow noopener" aria-label="${esc(l.name)} on LinkedIn">LinkedIn <span aria-hidden="true">&nearr;</span></a>` : ''}</li>`).join('')}</ul>`
    : `<p class="muted">No leaders listed yet.</p>`;
  const updated = timeTag(c.updated_at);
  const source = c.yc === false ? "Source: public startup directories and the company's website." : "Source: Y Combinator's public directory and the company's website.";

  const main = `<a class="crumb" href="/companies">&larr; All companies</a>
<article class="co">
<header class="co-head">
${logo(c.logo_url, name, 64).replace(' loading="lazy"', '')}
<div><h1 class="co-name">${esc(name)}</h1>${metaBits ? `<p class="co-meta">${metaBits}</p>` : ''}</div>
<div class="cta"><a class="btn btn-dark btn-lg" href="${esc(draft)}" rel="nofollow">Draft a message to ${esc(lead ? lead.first || lead.name : name)}</a><a class="btn btn-lg jump" href="#reach">Ways to reach them &darr;</a><p class="cta-note">${note}</p></div>
</header>
<section class="card" aria-labelledby="about-h"><h2 id="about-h">About</h2><div class="prose">${about}</div></section>
<section class="card reach" id="reach" aria-labelledby="reach-h"><h2 id="reach-h">Reach them</h2>
${links.length ? `<ul class="out">${links.map(([label, url]) => `<li><a href="${esc(url)}" rel="nofollow noopener"><b>${label}</b><small>${esc(shortUrl(url))}</small></a></li>`).join('')}</ul>` : ''}
<a class="locked" href="${esc(draft)}" rel="nofollow"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg><span><b>Company, hiring and founder emails</b><span class="locked-go">Sign in free to view</span></span></a>
</section>
<section class="card" aria-labelledby="leaders-h"><h2 id="leaders-h">Leaders${leaders.length ? ` <span class="muted">(${leaders.length})</span>` : ''}</h2>${people}</section>
</article>`;

  return shell({
    title, description: metaDescription, canonical, jsonLd, ogImage: safeUrl(c.logo_url), main,
    foot: `<p>${source}${updated ? ` Updated ${updated}.` : ''}</p><a href="/remove?company=${encodeURIComponent(slug)}">Remove or correct my information</a><a href="/privacy">Privacy</a>`,
  });
}

// ---------------------------------------------------------------- states
export function renderNotFound() {
  return shell({
    title: 'Page not found | FoundReach', robots: 'noindex',
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
export function renderRemoveForm({ company = '', values = {}, error = '' } = {}) {
  const slug = SLUG_RE.test(company) ? company : '';
  const v = k => esc(String(values[k] ?? ''));
  return shell({
    title: 'Remove or correct my information | FoundReach', robots: 'noindex', mainClass: 'wrap narrow',
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
export function renderRemoveDone() {
  return shell({
    title: 'Request received | FoundReach', robots: 'noindex', mainClass: 'wrap narrow',
    main: `<div class="state" role="status"><span class="state-code">Request received</span><h1>Thanks. We have your request.</h1><p>We will review it and update or remove the listing. You do not need to do anything else.</p><div class="actions"><a class="btn" href="/companies">Back to the directory</a></div></div>`,
  });
}

// ---------------------------------------------------------------- sitemap
export function renderSitemap({ slugs = [], sectors = [], cities = [] }) {
  const x = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch]));
  const uniq = list => [...new Set(list.map(o => slugify(o.value)).filter(Boolean))];
  const urls = [
    '/companies', '/new',
    ...uniq(sectors).map(s => '/sector/' + s),
    ...uniq(cities).map(s => '/city/' + s),
    ...slugs.filter(s => SLUG_RE.test(String(s))).map(s => '/companies/' + encodeURIComponent(s)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${x(SITE + u)}</loc></url>`).join('\n')}\n</urlset>\n`;
}
