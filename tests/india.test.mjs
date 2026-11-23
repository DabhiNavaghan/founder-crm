// Founder task #2 (India): the country filter on /companies, the loader's hold-back, and the migration's shape.
// No network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFilters, listRows } from '../api/directory.js';
import { listUrl, renderList, COUNTRIES } from '../api/_lib/render.js';
import { holdBack, countryLine, countryOf, readyFrom, COUNTRY_MIGRATION } from '../scripts/country-hold.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(path.join(root, p), 'utf8');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const list = (filters, extra = {}) => renderList({ kind: 'all', filters: { page: 1, ...filters }, facets: { total: 3625 }, total: 0, rows: [], ...extra });
const h1 = html => (html.match(/<h1>(.*?)<\/h1>/) || [])[1];
const title = html => (html.match(/<title>(.*?)<\/title>/) || [])[1];

// ---------------------------------------------------------------- filters and URLs
test('readFilters keeps only a known country', () => {
  assert.equal(readFilters({ country: 'india' }).country, 'india');
  assert.equal(readFilters({ country: 'India' }).country, 'india');
  assert.equal(readFilters({ country: 'United States' }).country, 'united-states');
  for (const v of ['Mars', 'IN', 'in', 'us', '', 'india@example.com', '<script>']) assert.equal(readFilters({ country: v }).country, '', v);
  assert.equal(readFilters({}).country, '');
});

test('listUrl carries the country and keeps the old order for everything else', () => {
  assert.equal(listUrl('/companies', { country: 'india' }), '/companies?country=india');
  assert.equal(listUrl('/companies', { city: 'bengaluru', country: 'india', page: 2 }), '/companies?city=bengaluru&country=india&page=2');
  assert.equal(listUrl('/companies', { q: 'pay', sector: 'fintech', hiring: true }), '/companies?q=pay&sector=fintech&hiring=1');
  assert.equal(listUrl('/companies', { country: 'india' }, { country: '' }), '/companies');
});

// ---------------------------------------------------------------- the list page
test('/companies?country=india selects India, shows the chip and names India in the heading', () => {
  const html = list({ country: 'india' });
  assert.match(html, /<label class="sr-only" for="country">Country<\/label><select class="field" id="country" name="country"><option value="">All countries<\/option><option value="united-states">United States<\/option><option value="india" selected>India<\/option><\/select>/);
  assert.match(html, /<a class="chip-x" href="\/companies" aria-label="Remove filter: Country India"><span>India<\/span><\/a>/);
  assert.equal(h1(html), 'Startups in India');
  assert.equal(title(html), 'Startups in India: founders, careers &amp; contact | FoundReach');
  assert.match(html, /0 results for Startups in India: founders, careers pages and contact links\./);
  assert.ok(!html.includes('Browse India'), 'no pill once a country is chosen');
  assert.match(html, /No companies match these filters\./);
});

test('the United States reads "in the United States"; a city wins over the country', () => {
  assert.equal(h1(list({ country: 'united-states' })), 'Startups in the United States');
  const html = list({ country: 'india', city: 'bengaluru' }, { facets: { total: 10, cities: [{ value: 'Bengaluru', count: 4 }] } });
  assert.equal(h1(html), 'Startups in Bengaluru');
  assert.match(html, /aria-label="Remove filter: City Bengaluru"/);
  assert.match(html, /aria-label="Remove filter: Country India"/);
});

test('/companies without a country shows the Browse India pill after the count and no country chip', () => {
  const html = list({});
  assert.match(html, /<\/p>\n<ul class="chips" aria-label="Browse by country"><li><a class="pill" href="\/companies\?country=india">Browse India<\/a><\/li><\/ul>\n/);
  assert.match(html, /<option value="">All countries<\/option><option value="united-states">United States<\/option><option value="india">India<\/option>/);
  assert.ok(!/Remove filter: Country/.test(html));
  assert.equal(h1(html), 'Startups you can actually reach');
});

test('an unknown country is never echoed and the page is unfiltered', () => {
  const f = readFilters({ country: 'Mars<b>' });
  const html = list(f);
  assert.ok(!/Mars/.test(html));
  assert.ok(html.includes('Browse India'));
  assert.equal(h1(html), 'Startups you can actually reach');
});

test('page types (kind other than all) get no Browse India pill', () => {
  const html = renderList({ kind: 'hiring', path: '/hiring', filters: { page: 1, hiring: true }, facets: { total: 10 }, total: 0, rows: [] });
  assert.ok(!html.includes('Browse India'));
});

test('a country filter adds no contact data: rows with email-shaped fields render none', () => {
  const rows = [{ slug: 'razorpay', name: 'Razorpay', city: 'Bengaluru', country: 'India jane@example.com', description: 'Payments. Write to jane@example.com', industry: 'Fintech' }];
  const html = renderList({ kind: 'all', filters: { page: 1, country: 'india' }, facets: { total: 1 }, total: 1, rows });
  assert.ok(!EMAIL.test(html.replace(/https?:\/\/[^\s"']+/g, '')), 'no email on the page');
  assert.match(html, /Bengaluru, India/);
});

test('COUNTRIES has exactly the two browseable countries', () => {
  assert.deepEqual(Object.keys(COUNTRIES), ['united-states', 'india']);
});

// ---------------------------------------------------------------- which database function the list calls
const recorder = (fail = null) => {
  const calls = [];
  const call = async (name, args) => {
    calls.push([name, args]);
    if (fail && name === 'catalog_list_country') throw fail;
    return { total: 0, rows: [] };
  };
  return { calls, call };
};

test('no country: catalog_list with exactly the old arguments', async () => {
  const { calls, call } = recorder();
  await listRows(readFilters({ q: 'pay', sector: 'fintech', page: '2' }), call);
  assert.deepEqual(calls, [['catalog_list', { p_q: 'pay', p_sector: 'fintech', p_city: null, p_batch: null, p_year: null, p_hiring: false, p_page: 2, p_per: 30, p_source: null, p_collection: null, p_sort: null }]]);
});

test('with a country: catalog_list_country gets p_country plus the same arguments', async () => {
  const { calls, call } = recorder();
  await listRows(readFilters({ country: 'india' }), call);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'catalog_list_country');
  assert.equal(calls[0][1].p_country, 'india');
  assert.equal(calls[0][1].p_per, 30);
});

test('before the migration: the US falls back to catalog_list, India is empty', async () => {
  const missing = Object.assign(new Error('not found'), { status: 404, code: 'PGRST202' });
  let r = recorder(missing);
  await listRows(readFilters({ country: 'united-states' }), r.call);
  assert.deepEqual(r.calls.map(c => c[0]), ['catalog_list_country', 'catalog_list']);
  assert.equal('p_country' in r.calls[1][1], false);
  r = recorder(missing);
  assert.deepEqual(await listRows(readFilters({ country: 'india' }), r.call), { total: 0, rows: [] });
  assert.deepEqual(r.calls.map(c => c[0]), ['catalog_list_country']);
});

test('other database errors are not hidden', async () => {
  const { call } = recorder(Object.assign(new Error('boom'), { status: 500, code: 'XX000' }));
  await assert.rejects(listRows(readFilters({ country: 'india' }), call), /boom/);
});

// ---------------------------------------------------------------- the loader's hold-back
const rows = [
  { name: 'Acme', country: 'United States' },
  { name: 'Old', },
  { name: 'Razorpay', country: 'India' },
  { name: 'Lumio', country: 'in' },
  { badge_only: true, slug: 'acme', badges: [] },
];

test('holdBack: before the migration only US (or empty) rows and badge adds are sent', () => {
  const { send, held } = holdBack(rows, false);
  assert.deepEqual(send.map(r => r.name || r.slug), ['Acme', 'Old', 'acme']);
  assert.deepEqual(held.map(r => r.name), ['Razorpay', 'Lumio']);
});

test('holdBack: after the migration everything is sent', () => {
  const { send, held } = holdBack(rows, true);
  assert.equal(send.length, rows.length);
  assert.equal(held.length, 0);
});

test('country counts and the readiness answer', () => {
  assert.equal(countryLine(rows), 'by country: United States 2, India 2');
  assert.equal(countryOf({ country: 'Singapore' }), 'Singapore');
  assert.equal(countryLine([]), 'by country: none');
  assert.equal(countryOf({ country: ' USA ' }), 'United States');
  assert.equal(readyFrom(200, 'true'), true);
  for (const [s, b] of [[404, '{"code":"PGRST202"}'], [200, 'false'], [500, 'true'], [200, '']]) assert.equal(readyFrom(s, b), false, `${s} ${b}`);
  assert.equal(COUNTRY_MIGRATION, '202611260001');
});

test('ingest.mjs prints the hold-back line and the country counts', () => {
  const src = read('scripts/ingest.mjs');
  assert.match(src, /held until migration \$\{COUNTRY_MIGRATION\} is applied: \$\{held\.length\}/);
  assert.match(src, /countryLine\(fresh\)/);
  // the hold-back happens before any batch is sent
  assert.ok(src.indexOf('holdBack(send, ready)') < src.indexOf('for (let i = 0; i < toSend.length'));
  assert.ok(src.indexOf("countryLine(fresh)") < src.indexOf('if (dryRun)'), 'the dry run prints the counts too');
});

// ---------------------------------------------------------------- the migration
const MIG = 'supabase/migrations/202611260001_country_ingest.sql';
const fnBody = (sql, name) => {
  const i = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(i >= 0, name);
  return sql.slice(i, sql.indexOf('end $$;', i) + 'end $$;'.length);
};

test('the migration only adds or replaces functions and grants', () => {
  const sql = read(MIG).replace(/--[^\n]*/g, '');
  assert.ok(!/\b(drop|truncate|delete\s+from|alter\s+table|disable\s+row|row\s+level|revoke)\b/i.test(sql));
  assert.ok(!/app_secrets|applied_migrations/i.test(sql));
  // Outside the function bodies there is nothing but the three functions and their grants.
  const outside = sql.split('$$').filter((_, k) => k % 2 === 0).join('\n').split(';').map(s => s.trim()).filter(Boolean);
  for (const s of outside) assert.ok(/^(create or replace function public\.\w+\(|end|grant execute on function public\.\w+\()/i.test(s), s.slice(0, 80));
  const creates = [...sql.matchAll(/create or replace function public\.(\w+)\(/g)].map(m => m[1]);
  assert.deepEqual(creates, ['ingest_catalog', 'catalog_list_country', 'fr_country_ingest_ready']);
  assert.match(sql, /grant execute on function public\.ingest_catalog\(text, jsonb, boolean\) to anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.catalog_list_country\(text, text, text, text, text, integer, boolean, integer, integer, text, text, text\) to anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.fr_country_ingest_ready\(\) to anon, authenticated;/);
});

test('ingest_catalog is the 202611240001 body with only the country lines changed', () => {
  const oldLines = fnBody(read('supabase/migrations/202611240001_multi_source.sql'), 'ingest_catalog').split('\n');
  const newLines = fnBody(read(MIG), 'ingest_catalog').split('\n');
  const removed = oldLines.filter(l => !newLines.includes(l));
  const added = newLines.filter(l => !oldLines.includes(l));
  assert.deepEqual(removed.map(l => l.trim()), [
    "if v_name = '' or v_domain is null or v_site is null or v_source is null",
    "v_owner, v_name, v_site, 'United States',",
  ]);
  assert.deepEqual(added.map(l => l.trim()), [
    'v_country text;',
    "-- The country the row states. Empty keeps today's behaviour; an unknown value is never stored.",
    'v_country := case',
    "when nullif(btrim(coalesce(r->>'country', '')), '') is null then 'United States'",
    "when lower(btrim(r->>'country')) in ('us', 'usa', 'united states', 'united states of america') then 'United States'",
    "when lower(btrim(r->>'country')) in ('india', 'in') then 'India'",
    'end;',
    "if v_name = '' or v_domain is null or v_site is null or v_source is null or v_country is null",
    'v_owner, v_name, v_site, v_country,',
  ]);
  // every key the function returned before is still returned
  for (const k of ['added', 'updated', 'badged', 'contacts', 'skipped', 'suppressed', 'unmatched', 'catalog_count']) assert.ok(newLines.join('\n').includes(`'${k}', v_`), k);
});

test('catalog_list_country is catalog_list (202611240004) plus p_country and its one filter', () => {
  const src = read('supabase/migrations/202611240004_directory_polish.sql');
  const i = src.indexOf('create or replace function public.catalog_list(');
  const oldLines = src.slice(i, src.indexOf('$$;', src.indexOf('$$', i) + 2) + 3).split('\n');
  const sql = read(MIG);
  const j = sql.indexOf('create or replace function public.catalog_list_country(');
  const newLines = sql.slice(j, sql.indexOf('$$;', sql.indexOf('$$', j) + 2) + 3).split('\n');
  assert.deepEqual(oldLines.filter(l => !newLines.includes(l)).map(l => l.trim()), ['create or replace function public.catalog_list(']);
  assert.deepEqual(newLines.filter(l => !oldLines.includes(l)).map(l => l.trim()), [
    'create or replace function public.catalog_list_country(',
    'p_country text default null,',
    "and (nullif(public.fr_slugify(p_country), '') is null or public.fr_slugify(c.country) = public.fr_slugify(p_country))",
  ]);
});
