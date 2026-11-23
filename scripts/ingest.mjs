#!/usr/bin/env node
// Loads a file produced by scraper/multi.py into the catalog through the ingest_catalog() database function.
//
//   node scripts/ingest.mjs ../scraper/out/companies_multi.json --dry-run
//   SUPABASE_URL=... SUPABASE_PUBLISHABLE_KEY=... CRON_SECRET=... node scripts/ingest.mjs ../scraper/out/companies_multi.json
//
// Options
//   --dry-run                 validate the file and show what would be sent; nothing leaves this machine
//   --batch N                 rows per call (default 200, max 500)
//   --only a16z,accel         load only rows whose first badge has one of these source slugs
//   --exclude 500-global      leave out rows from these source slugs (badge-add rows lose those badges too)
//   --mark-new                new companies show up on /new (default: a bulk load does not count as "new this week")
//   --limit N                 stop after N rows (for a first small trial)
//
// Connection settings come from the environment only (SUPABASE_URL or VITE_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY or
// VITE_SUPABASE_PUBLISHABLE_KEY, CRON_SECRET). They are never read from a file and never printed.
// Safe to re-run: companies are matched on website domain, so a second run adds nothing.
import { readFileSync } from 'node:fs';
import { COUNTRY_MIGRATION, holdBack, countryLine, readyFrom } from './country-hold.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const opt = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const valued = new Set(['--batch', '--only', '--exclude', '--limit']);
const file = argv.find((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
const fail = msg => { console.error('ingest: ' + msg); process.exit(1); };
if (!file || flag('--help')) fail('usage: node scripts/ingest.mjs <companies_multi.json> [--dry-run] [--batch 200] [--only a,b] [--exclude a,b] [--mark-new] [--limit N]');

const dryRun = flag('--dry-run');
const batchSize = Math.min(500, Math.max(1, Number(opt('--batch')) || 200));
const list = v => new Set(String(v || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const only = list(opt('--only')), exclude = list(opt('--exclude'));
const limit = Number(opt('--limit')) || Infinity;

let parsed;
try { parsed = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { fail('cannot read ' + file + ': ' + e.message); }
const input = Array.isArray(parsed) ? parsed : parsed?.rows;
if (!Array.isArray(input)) fail('the file must be a JSON array of rows or an object with a "rows" array');

// ---- validate and filter locally, so a bad file is caught before anything is sent
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const host = u => { try { return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const problems = [];
const rows = [];
const seenDomain = new Set();
for (const [i, raw] of input.entries()) {
  if (!raw || typeof raw !== 'object') { problems.push(`row ${i}: not an object`); continue; }
  let badges = (Array.isArray(raw.badges) ? raw.badges : []).filter(b => b && typeof b.label === 'string' && b.label.trim() && SLUG.test(String(b.source || '')));
  if (badges.length !== (raw.badges || []).length) problems.push(`row ${i} (${raw.name || raw.slug}): malformed badge dropped`);
  const first = badges[0]?.source;
  if (raw.badge_only) {
    badges = badges.filter(b => !exclude.has(b.source) && (!only.size || only.has(b.source)));
    if (!badges.length) continue;
    if (!raw.slug && !raw.domain) { problems.push(`row ${i}: badge add without slug or domain`); continue; }
    rows.push({ badge_only: true, slug: raw.slug || '', domain: raw.domain || '', badges });
    continue;
  }
  if (exclude.has(first) || (only.size && !only.has(first))) continue;
  badges = badges.filter(b => !exclude.has(b.source));
  const domain = String(raw.domain || host(raw.website || '')).toLowerCase();
  const missing = ['name', 'website', 'description', 'source', 'source_url'].filter(k => !String(raw[k] || '').trim());
  if (missing.length || !domain || !badges.length) { problems.push(`row ${i} (${raw.name || '?'}): missing ${[...missing, !domain && 'domain', !badges.length && 'badge'].filter(Boolean).join(', ')}`); continue; }
  if (domain !== host(raw.website)) { problems.push(`row ${i} (${raw.name}): domain ${domain} does not match website`); continue; }
  if (seenDomain.has(domain)) { problems.push(`row ${i} (${raw.name}): duplicate domain ${domain}`); continue; }
  for (const k of ['contact_email', 'hiring_email']) if (raw[k] && !EMAIL.test(raw[k])) { problems.push(`row ${i} (${raw.name}): bad ${k} dropped`); raw[k] = ''; }
  seenDomain.add(domain);
  rows.push({ ...raw, domain, badges, people: (Array.isArray(raw.people) ? raw.people : []).filter(p => p && String(p.first_name || '').trim()).slice(0, 12) });
}
const send = rows.slice(0, limit);
const fresh = send.filter(r => !r.badge_only), adds = send.filter(r => r.badge_only);
const bySource = {};
for (const r of fresh) bySource[r.badges[0].source] = (bySource[r.badges[0].source] || 0) + 1;

console.log(`file: ${file}`);
console.log(`rows in file: ${input.length}; to send: ${send.length} (${fresh.length} companies, ${adds.length} badge adds) in ${Math.ceil(send.length / batchSize)} batches of ${batchSize}`);
console.log('companies by source: ' + (Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'));
console.log('companies ' + countryLine(fresh));
console.log(`with city ${fresh.filter(r => r.location).length}, leaders ${fresh.filter(r => r.people.length).length}, careers ${fresh.filter(r => r.careers_url).length}, contact page ${fresh.filter(r => r.contact_url).length}, email ${fresh.filter(r => r.contact_email || r.hiring_email).length}`);
if (problems.length) { console.log(`${problems.length} rows left out:`); for (const p of problems.slice(0, 20)) console.log('  ' + p); if (problems.length > 20) console.log(`  ... and ${problems.length - 20} more`); }

if (dryRun) {
  const sample = fresh[0] || adds[0];
  if (sample) console.log('first row: ' + JSON.stringify({ ...sample, contact_email: sample.contact_email ? '<set>' : '', hiring_email: sample.hiring_email ? '<set>' : '' }).slice(0, 700));
  console.log('dry run: nothing was sent.');
  process.exit(0);
}

// ---- send
const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';
const secret = process.env.CRON_SECRET || '';
const unset = [!url && 'SUPABASE_URL', !key && 'SUPABASE_PUBLISHABLE_KEY', !secret && 'CRON_SECRET'].filter(Boolean);
if (unset.length) fail('set ' + unset.join(', ') + ' in the environment (or use --dry-run)');
if (!/^https:\/\/[a-z0-9.-]+$/i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(url)) fail('SUPABASE_URL must look like https://<project>.supabase.co');

// Error text can echo request details; never let a setting through to the terminal.
const scrub = s => [secret, key].reduce((t, v) => (v ? t.split(v).join('***') : t), String(s)).slice(0, 300);
async function call(batch, attempt = 1) {
  let r, body;
  try {
    r = await fetch(`${url}/rest/v1/rpc/ingest_catalog`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ p_secret: secret, p_rows: batch, p_new: flag('--mark-new') }),
      signal: AbortSignal.timeout(60000),
    });
    body = await r.text();
  } catch (e) {
    if (attempt < 3) { await new Promise(res => setTimeout(res, 2000 * attempt)); return call(batch, attempt + 1); }
    throw new Error('network error: ' + scrub(e.message));
  }
  let data = null;
  try { data = body ? JSON.parse(body) : null; } catch { /* not JSON */ }
  if (r.ok) return data || {};
  if (r.status >= 500 && attempt < 3) { await new Promise(res => setTimeout(res, 2000 * attempt)); return call(batch, attempt + 1); }
  const hint = data?.code === '28000' ? ' (the database rejected CRON_SECRET: check app_secrets)'
    : data?.code === 'PGRST202' || r.status === 404 ? ' (ingest_catalog not found: apply supabase/migrations/202611240001_multi_source.sql first)' : '';
  throw new Error(`HTTP ${r.status} ${scrub(data?.message || body)}${hint}`);
}

// Rows from another country wait until ingest_catalog() stores the row's country (migration 202611260001).
let ready = false;
try {
  const r = await fetch(`${url}/rest/v1/rpc/fr_country_ingest_ready`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(20000),
  });
  ready = readyFrom(r.status, await r.text());
} catch { ready = false; }
const { send: toSend, held } = holdBack(send, ready);
if (held.length) console.log(`held until migration ${COUNTRY_MIGRATION} is applied: ${held.length} (${countryLine(held).replace('by country: ', '')})`);

const total = { added: 0, updated: 0, badged: 0, contacts: 0, skipped: 0, suppressed: 0, unmatched: 0 };
let catalog = null, done = 0;
const started = Date.now();
for (let i = 0; i < toSend.length; i += batchSize) {
  const batch = toSend.slice(i, i + batchSize);
  let out;
  try { out = await call(batch); } catch (e) {
    console.error(`batch ${i / batchSize + 1} failed after ${done} rows: ${e.message}`);
    console.error('Earlier batches are saved. Fix the problem and run the same command again; it continues where it stopped.');
    process.exit(1);
  }
  for (const k of Object.keys(total)) total[k] += Number(out[k]) || 0;
  catalog = out.catalog_count ?? catalog;
  done += batch.length;
  console.log(`  ${done}/${toSend.length}  +${out.added || 0} new, ${out.updated || 0} merged, ${out.badged || 0} badged, ${out.contacts || 0} people`);
}
console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
console.log(`new companies ${total.added}; already listed and merged ${total.updated}; rows that gained a badge ${total.badged}; people added ${total.contacts}`);
console.log(`left out by the database: ${total.skipped} incomplete, ${total.suppressed} removed on request, ${total.unmatched} badge adds with no matching company`);
if (catalog != null) console.log(`catalog now has ${catalog} companies`);
