// Launch HN posts (Hacker News) for the daily refresh. Pure functions, no network, so they can be tested with fixtures.
// Source: the public HN Search API, https://hn.algolia.com/api (no key, no login).
// Every Launch HN post is a Y Combinator company, so a post only ever adds a "Launch HN <year>" badge
// to a company that is already in the catalog; it never creates a row.

const SEASON = { W: 'Winter', S: 'Summer', F: 'Fall', X: 'Spring' };
const TITLE = /^Launch HN:\s*(.+?)\s*\((?:YC\s+)?([WSFX])\s?(\d{2})\)/i;
const key = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// One request: Launch HN stories from the last `days` days, newest first.
export function launchHnUrl(days = 10, now = Date.now()) {
  const since = Math.floor(now / 1000) - days * 86400;
  return 'https://hn.algolia.com/api/v1/search_by_date?' + new URLSearchParams({
    query: '"Launch HN"', tags: 'story', restrictSearchableAttributes: 'title', numericFilters: 'created_at_i>' + since, hitsPerPage: '100',
  });
}

// "Launch HN: Acme (YC S24) – ..." -> { name, batch: 'Summer 2024', year, id }
export function parseLaunch(hit) {
  const m = TITLE.exec(String(hit?.title || '').replace(/\s+/g, ' ').trim());
  const year = Number(String(hit?.created_at || '').slice(0, 4));
  if (!m || !/^\d+$/.test(String(hit?.objectID || '')) || !(year > 2000)) return null;
  return { name: m[1].trim(), batch: `${SEASON[m[2].toUpperCase()]} 20${m[3]}`, year, id: String(hit.objectID) };
}

// Badge-add rows for ingest_catalog(), matched to the YC index by company name (and batch when the name is not unique).
export function launchRows(hits, ycCompanies) {
  const byName = new Map();
  for (const c of Array.isArray(ycCompanies) ? ycCompanies : []) {
    const k = key(c?.name);
    if (k) byName.set(k, [...(byName.get(k) || []), c]);
  }
  const rows = new Map();
  for (const hit of Array.isArray(hits) ? hits : []) {
    const p = parseLaunch(hit);
    if (!p) continue;
    const found = byName.get(key(p.name)) || [];
    const c = found.find(x => x.batch === p.batch) || (found.length === 1 ? found[0] : null);
    if (!c || typeof c.slug !== 'string') continue;
    const slug = c.slug.toLowerCase();
    if (!rows.has(slug)) rows.set(slug, { badge_only: true, slug, domain: '', badges: [{ label: 'Launch HN ' + p.year, source: 'hacker-news' }] });
  }
  return [...rows.values()];
}
