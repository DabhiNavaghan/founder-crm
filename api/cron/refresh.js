// Daily refresh (Vercel Cron, see vercel.json). Finds US YC companies that are not in the catalog yet,
// reads each one's public YC page and homepage, and hands the rows to ingest_companies().
// Then adds a "Launch HN <year>" badge to listed companies that launched on Hacker News in the last days (best effort:
// if Hacker News is down or the step runs out of time, the YC refresh above is unaffected).
// Protected by CRON_SECRET: Vercel sends it as "Authorization: Bearer <secret>" on cron runs.
import { timingSafeEqual } from 'node:crypto';
import { rpc } from '../_lib/db.js';
import { usCompanies, diffSlugs, parseYcPage, scanSite, buildRow } from '../_lib/yc.js';
import { launchHnUrl, launchRows } from '../_lib/sources/hn.js';

const INDEX_URL = 'https://yc-oss.github.io/api/companies/all.json';
const UA = 'FoundReachBot/1.0 (+https://foundreach.navaghandabhi.dev)';
const MAX_NEW = 25;       // companies looked at per run
const BUDGET_MS = 40000;  // stop starting new work after this; the function limit is 60s
const EXTRA_BY_MS = 50000; // the optional Launch HN step is skipped if the run is already this old

async function getText(url, { timeout, limit = 1500000 }) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,application/json;q=0.9,*/*;q=0.5', 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(timeout) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  // Read at most `limit` bytes so one huge page cannot stall the run.
  const reader = r.body.getReader(), chunks = [];
  let size = 0;
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); size += value.length;
  }
  reader.cancel().catch(() => {});
  return { url: r.url || url, text: Buffer.concat(chunks).toString('utf8') };
}
const publicHost = u => { try { const h = new URL(u).hostname; return h.includes('.') && !/^(\d+\.){3}\d+$/.test(h) && !h.endsWith('.local') && !h.endsWith('.internal') && !h.includes(':'); } catch { return false; } };

async function lookUp(c) {
  let page;
  try {
    page = parseYcPage((await getText('https://www.ycombinator.com/companies/' + encodeURIComponent(c.slug), { timeout: 9000, limit: 3000000 })).text);
  } catch (e) {
    // A page that no longer exists is not asked for again; anything else is retried tomorrow.
    return e.status === 404 ? { skip: { slug: c.slug.toLowerCase(), skip: true, reason: 'yc-404' } } : { failed: true };
  }
  if (!page) return { failed: true };
  if (page.country && page.country !== 'US') return { skip: { slug: c.slug.toLowerCase(), skip: true, reason: 'not-us' } };
  let site = {};
  const home = /^https?:\/\//i.test(c.website || '') ? c.website : c.website ? 'https://' + c.website : '';
  if (home && publicHost(home)) {
    try { const got = await getText(home, { timeout: 6000, limit: 800000 }); site = scanSite(got.text, got.url); } catch { /* best effort */ }
  }
  return { row: buildRow(c, page, site) };
}

function authorised(req) {
  const secret = process.env.CRON_SECRET || '';
  const given = Buffer.from(String(req.headers?.authorization || ''));
  const want = Buffer.from('Bearer ' + secret);
  return secret.length >= 16 && given.length === want.length && timingSafeEqual(given, want);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!authorised(req)) return res.status(401).json({ error: 'Unauthorized' });
  const started = Date.now(), secret = process.env.CRON_SECRET;
  try {
    // Asked for up front, alongside the index; a failure here is remembered, never thrown.
    const launches = getText(launchHnUrl(), { timeout: 6000, limit: 2000000 }).then(r => JSON.parse(r.text).hits).catch(() => null);
    const [index, known] = await Promise.all([
      getText(INDEX_URL, { timeout: 25000, limit: 80000000 }).then(r => JSON.parse(r.text)),
      rpc('cron_known_slugs', { p_secret: secret }, { timeout: 15000 }),
    ]);
    const us = usCompanies(index);
    if (us.length < 500) throw new Error('The YC index looks incomplete (' + us.length + ' US companies)');
    const { missing, tracked, target } = diffSlugs(us, known?.catalog || [], known?.suppressed || []);
    const batch = missing.slice(0, MAX_NEW);
    const rows = [];
    let failed = 0, next = 0;
    const worker = async () => {
      while (next < batch.length && Date.now() - started < BUDGET_MS) {
        const c = batch[next++];
        const out = await lookUp(c).catch(() => ({ failed: true }));
        if (out.row) rows.push(out.row); else if (out.skip) rows.push(out.skip); else failed++;
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    const result = await rpc('ingest_companies', { p_secret: secret, p_rows: rows, p_yc_total: target - rows.filter(r => r.skip).length, p_tracked: tracked }, { timeout: 15000 });
    let launch_hn = 'unavailable';
    try {
      const hits = await launches;
      if (hits && Date.now() - started < EXTRA_BY_MS) {
        const badgeRows = launchRows(hits, us);
        const out = badgeRows.length ? await rpc('ingest_catalog', { p_secret: secret, p_rows: badgeRows }, { timeout: Math.max(1000, Math.min(6000, 57000 - (Date.now() - started))) }) : { badged: 0 };
        launch_hn = { posts: hits.length, matched: badgeRows.length, badged: out?.badged || 0 };
      } else if (hits) launch_hn = 'skipped (out of time)';
    } catch (e) { console.error('FoundReach Launch HN step failed', e?.status || '', e?.code || '', e?.message); launch_hn = 'failed'; }
    return res.status(200).json({ ok: true, launch_hn, yc_total: us.length, tracked_before: tracked, missing: missing.length, looked_at: next, page_failed: failed, not_us_or_gone: rows.filter(r => r.skip).length, ...result, ms: Date.now() - started });
  } catch (e) {
    console.error('FoundReach refresh error', e?.status || '', e?.code || '', e?.message);
    return res.status(e?.status === 401 || e?.code === '28000' ? 500 : 502).json({ ok: false, error: e?.code === '28000' ? 'The database rejected the cron secret. Check app_secrets.' : 'Refresh failed. See the function log.' });
  }
}
