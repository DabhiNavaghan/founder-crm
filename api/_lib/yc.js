// Parsing and diff logic for the daily refresh. Pure functions (no network) so they can be tested with fixtures.
// Sources: the public yc-oss index (all.json) and each company's public YC page.

const EMAIL_RE = /[^\s<>"'`=:;,()]*@[A-Za-z0-9._-]+\.[A-Za-z]{2,}/g;
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const SEASON = { Winter: 'W', Spring: 'X', Summer: 'S', Fall: 'F' };
const clean = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const httpUrl = v => {
  let s = String(v ?? '').trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:' ? s : ''; } catch { return ''; }
};

// Active or public companies with a US region.
export function usCompanies(all) {
  return (Array.isArray(all) ? all : []).filter(c => c && typeof c.slug === 'string' && SLUG_RE.test(c.slug.toLowerCase())
    && (c.status === 'Active' || c.status === 'Public') && Array.isArray(c.regions) && c.regions.includes('United States of America'));
}

// Which US companies are not in the catalog yet (and were not ruled out before), newest first.
export function diffSlugs(us, catalogSlugs, suppressedSlugs = []) {
  const catalog = new Set(catalogSlugs), suppressed = new Set(suppressedSlugs);
  const missing = us.filter(c => !catalog.has(c.slug.toLowerCase()) && !suppressed.has(c.slug.toLowerCase()))
    .sort((a, b) => (Number(b.launched_at) || 0) - (Number(a.launched_at) || 0));
  const tracked = us.filter(c => catalog.has(c.slug.toLowerCase())).length;
  return { missing, tracked };
}

// "Winter 2012" -> { batch: 'W12', batch_year: 2012 }
export function parseBatch(name) {
  const m = /^(Winter|Spring|Summer|Fall) ((?:19|20)\d{2})$/.exec(clean(name));
  return m ? { batch: SEASON[m[1]] + m[2].slice(2), batch_year: Number(m[2]) } : { batch: null, batch_year: null };
}

const unescapeHtml = s => s.replace(/&(#x[0-9a-f]+|#\d+|quot|apos|lt|gt|amp|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); try { return String.fromCodePoint(n); } catch { return ''; } }
  return { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&', nbsp: ' ' }[k];
});

// The YC company page keeps its data as HTML-escaped JSON in a data-page="..." attribute.
export function parseYcPage(html) {
  const m = /data-page="([^"]+)"/.exec(String(html || ''));
  if (!m) return null;
  let company;
  try { company = JSON.parse(unescapeHtml(m[1]))?.props?.company; } catch { return null; }
  if (!company || typeof company !== 'object') return null;
  return {
    location: clean(company.location), city: clean(company.city), country: clean(company.country), linkedin_url: clean(company.linkedin_url),
    founders: (Array.isArray(company.founders) ? company.founders : []).map(f => ({ full_name: clean(f?.full_name), title: clean(f?.title), linkedin_url: clean(f?.linkedin_url) })).filter(f => f.full_name),
  };
}

// CEO / president -> Primary; CTO, engineering, technical, product -> Secondary; everyone else Primary.
const SECONDARY = /\b(cto|chief technology|chief technical|engineer\w*|technical|head of (product|engineering|technology)|vp\b.*(eng|product)|architect|developer|chief scientist|chief product|cpo|product)\b/i;
export function founderTier(title) {
  const t = String(title || '');
  if (/\b(ceo|chief executive|president)\b/i.test(t)) return 'Primary';
  return SECONDARY.test(t) ? 'Secondary' : 'Primary';
}

// Careers and contact links on a company's homepage (same heuristics as the scraper's site_scan, one page only).
const CAREER_HOSTS = /(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|breezy\.hr|bamboohr\.com|ats\.rippling\.com|wellfound\.com|angel\.co|workatastartup\.com|notion\.site|recruitee\.com|smartrecruiters\.com|gem\.com|dover\.com|teamtailor\.com|pinpointhq\.com|jobvite\.com|myworkdayjobs\.com|icims\.com|polymer\.co|gusto\.com\/boards|careers-page\.com|applytojob\.com)/i;
const CAREER_PATH = /(career|\/jobs?(\/|$|\?|#)|join-?us|join-?the-?team|joinus|work-?with-?us|we-?are-?hiring|open-?(roles|positions)|\/join(\/|$))/i;
const CAREER_TEXT = /^\s*(careers?|jobs?|join( us| the team| our team)?|we'?re hiring|hiring|work with us|open (roles|positions))\b/i;
const CONTACT_PATH = /(\/contact|contact-?us|get-?in-?touch|\/support(\/|$)|\/talk-to|\/demo)/i;
const baseDomain = host => String(host || '').toLowerCase().split(':')[0].replace(/^www\./, '');
export function scanSite(html, finalUrl) {
  const out = { careers_url: '', contact_url: '', linkedin_url: '' };
  let base;
  try { base = new URL(finalUrl); } catch { return out; }
  const host = baseDomain(base.host);
  const careers = [], contacts = [];
  const LINK = /<a\b[^>]*?href\s*=\s*["']?([^"'\s>]+)[^>]*>([\s\S]*?)<\/a>/gi;
  let m, seen = 0;
  while ((m = LINK.exec(String(html || ''))) && seen++ < 3000) {
    const href = unescapeHtml(m[1]);
    if (/^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let u;
    try { u = new URL(href, base); } catch { continue; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    const full = u.href;
    EMAIL_RE.lastIndex = 0;
    if (EMAIL_RE.test(full)) continue;
    const label = unescapeHtml(m[2].replace(/<[^>]+>/g, ' ')).trim().slice(0, 60);
    const h = baseDomain(u.host);
    const same = h === host || h.endsWith('.' + host);
    if (!out.linkedin_url && full.includes('linkedin.com/company/')) out.linkedin_url = full.split('?')[0];
    if (CAREER_HOSTS.test(full) || (same && CAREER_PATH.test(u.pathname)) || (CAREER_TEXT.test(label) && (same || CAREER_HOSTS.test(full) || /^(jobs|careers)\./.test(h)))) careers.push(full);
    else if (same && CONTACT_PATH.test(u.pathname)) contacts.push(full);
  }
  if (careers.length && !/rippling\.com\/(?!.*jobs)|\/blog\//.test(careers[0])) out.careers_url = careers[0];
  if (contacts.length) out.contact_url = contacts.find(c => c.toLowerCase().includes('contact')) || contacts[0];
  return out;
}

// One row for ingest_companies(), from the index entry, the YC page and the homepage scan. No emails are collected.
export function buildRow(c, page, site = {}) {
  const { batch, batch_year } = parseBatch(c.batch);
  const ycUrl = httpUrl(c.url) || 'https://www.ycombinator.com/companies/' + c.slug;
  const notes = [clean('Y Combinator ' + (c.batch || '')), c.team_size ? 'Team size: ' + c.team_size : '', c.stage ? 'Stage: ' + c.stage : '', c.isHiring ? 'Hiring now' : '', ycUrl].filter(Boolean).join(' · ');
  const description = clip([clean(c.one_liner), clean(c.long_description)].filter(Boolean).join(' — ').replace(EMAIL_RE, '').replace(/\s+/g, ' ').trim(), 600);
  const logo = String(c.small_logo_thumb_url || '');
  const sector = clean(String(c.subindustry || '').split(' -> ').pop()) || clean(c.industry);
  const linkedin = [page?.linkedin_url, site.linkedin_url].map(httpUrl).find(u => u.includes('linkedin.com')) || '';
  return {
    slug: c.slug.toLowerCase(), name: clean(c.name), website: httpUrl(c.website),
    location: clean(page?.location) || clean(String(c.all_locations || '').split(';')[0]),
    sector, description,
    logo_url: /^https?:\/\//i.test(logo) && !logo.includes('missing') ? logo : '',
    careers_url: site.careers_url || (c.isHiring ? ycUrl + '/jobs' : ''),
    contact_url: site.contact_url || '', linkedin_url: linkedin,
    batch, batch_year, notes, priority: c.isHiring ? 4 : 3,
    founders: (page?.founders || []).slice(0, 12).map(f => {
      const parts = f.full_name.split(' ');
      const li = httpUrl(f.linkedin_url);
      return { first_name: parts[0], last_name: parts.slice(1).join(' '), role: f.title || 'Founder', role_category: founderTier(f.title), linkedin_url: li.includes('linkedin.com') ? li : '' };
    }),
  };
}
