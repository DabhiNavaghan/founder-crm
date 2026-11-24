// Server-rendered pages: country display, US-neutral copy, and no contact data. No network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { COUNTRY_SOURCES, countryName, joinNames, quickView, renderAbout, renderCompany, renderList, renderNew } from '../api/_lib/render.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOT = '<span aria-hidden="true">&middot;</span>';
const company = (extra = {}) => ({ slug: 'acme', name: 'Acme', city: 'Austin', industry: 'Fintech', description: 'Payments for small shops.', ...extra });
const list = (rows, extra = {}) => renderList({ filters: { page: 1 }, facets: { total: 3625 }, total: rows.length, rows, ...extra });
const coMeta = html => (html.match(/<p class="co-meta">(.*?)<\/p>/) || [])[1];
const cityCell = html => (html.match(/<span class="m m-city">(.*?)<\/span>/) || [])[1];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

test('countryName normalises US spellings to the full name', () => {
  for (const v of ['US', 'us', 'USA', 'U.S.', 'U.S.A.', 'United States', ' united  states of america ']) {
    assert.equal(countryName(v), 'United States', v);
  }
});

test('countryName keeps other countries, cleaned and clipped', () => {
  assert.equal(countryName('  India '), 'India');
  assert.equal(countryName('United\n Kingdom'), 'United Kingdom');
  assert.ok(countryName('x'.repeat(200)).length <= 60);
});

test('countryName is empty for missing or unknown values', () => {
  for (const v of ['unknown', 'Unknown', 'UNKNOWN', '', '   ', null, undefined]) assert.equal(countryName(v), '', String(v));
});

test('countryName strips email-shaped input', () => {
  assert.equal(countryName('jane@example.com'), '');
  assert.equal(countryName('India jane@example.com'), 'India');
});

test('company page shows the country after the city and in JSON-LD', () => {
  const html = renderCompany(company({ country: 'US' }));
  assert.equal(coMeta(html), `<a href="/city/austin">Austin</a>${DOT}<span>United States</span>${DOT}<a href="/sector/fintech">Fintech</a>`);
  assert.ok(html.includes('"addressLocality":"Austin","addressCountry":"United States"'));
});

test('company page without a country looks as before', () => {
  for (const extra of [{}, { country: '' }, { country: 'unknown' }, { country: null }]) {
    const html = renderCompany(company(extra));
    assert.equal(coMeta(html), `<a href="/city/austin">Austin</a>${DOT}<a href="/sector/fintech">Fintech</a>`);
    assert.ok(!html.includes('addressCountry'));
    assert.ok(!html.includes('United States'));
  }
});

test('company meta never has a leading, trailing or double dot', () => {
  const cases = [
    company({ country: 'India', city: '', industry: '' }),
    company({ country: 'India', city: '' }),
    company({ country: 'India', industry: '' }),
    company({ country: 'India', careers_url: 'https://acme.example/careers' }),
    company({ city: '', careers_url: 'https://acme.example/careers' }),
  ];
  for (const c of cases) {
    const meta = coMeta(renderCompany(c));
    assert.ok(meta, 'meta is rendered');
    assert.ok(!meta.startsWith(DOT) && !meta.endsWith(DOT) && !meta.includes(DOT + DOT) && !meta.includes(DOT + '<span class="chip">'), meta);
  }
  assert.equal(coMeta(renderCompany(company({ country: 'India', city: '', industry: '' }))), '<span>India</span>');
  assert.ok(renderCompany(company({ country: 'India', city: '' })).includes('"address":{"@type":"PostalAddress","addressCountry":"India"}'));
});

test('the country is not repeated when the city text already ends with it', () => {
  const html = renderCompany(company({ city: 'San Francisco, CA, USA', country: 'United States' }));
  assert.ok(!coMeta(html).includes('<span>United States</span>'));
  assert.ok(html.includes('"addressCountry":"United States"'));
  assert.equal(cityCell(list([company({ city: 'San Francisco, CA, USA', country: 'US' })])), 'San Francisco, CA, USA');
});

test('list rows show the country in the city slot when it is present', () => {
  assert.equal(cityCell(list([company({ country: 'USA' })])), 'Austin, United States');
  assert.equal(cityCell(list([company({ country: 'India', city: '' })])), 'India');
  assert.equal(cityCell(list([company()])), 'Austin');
  assert.equal(cityCell(list([company({ city: '', country: 'unknown' })])), undefined);
});

test('quick view carries the country and the combined place', () => {
  const withCountry = quickView(company({ country: 'US' }));
  assert.equal(withCountry.country, 'United States');
  assert.equal(withCountry.place, 'Austin, United States');
  const without = quickView(company());
  assert.equal(without.country, null);
  assert.equal(without.place, 'Austin');
});

test('an email in description, country or city never reaches the output', () => {
  const dirty = company({ description: 'Write to jane@example.com today.', country: 'India jane@example.com', city: 'Austin bob@example.org' });
  for (const html of [renderCompany(dirty), list([dirty]), renderNew({ fresh: true, rows: [dirty], run: null }), JSON.stringify(quickView(dirty))]) {
    assert.ok(!EMAIL.test(html), 'no email-shaped text');
    assert.ok(!html.includes('example.com') && !html.includes('example.org'));
  }
  assert.equal(cityCell(list([dirty])), 'Austin, India');
});

test('country text is escaped', () => {
  const html = renderCompany(company({ country: '<b>"X"</b>' }));
  assert.ok(coMeta(html).includes('<span>&lt;b&gt;&quot;X&quot;&lt;/b&gt;</span>'));
});

test('copy does not assume the US', () => {
  const all = list([company()]);
  const title = all.match(/<title>(.*?)<\/title>/)[1];
  assert.equal(title, 'Startup directory: 3,625 startups you can contact | FoundReach');
  assert.ok(all.includes('content="Browse 3,625 startups by sector, city, source and batch.'));
  const sector = list([company()], { kind: 'sector', path: '/sector/fintech', labels: { sector: 'Fintech' } });
  assert.ok(sector.includes('1 Fintech startups: founders, careers pages and contact links.'));
  assert.ok(sector.includes('1 Fintech startups, with the people who run them'));
  const about = renderAbout({ nav: { companies: 3625 } });
  assert.ok(about.includes('a free directory of startups (3,625 companies today). Most are based in the United States today. More countries are coming.'));
  assert.ok(about.includes('its sector and location'));
  for (const html of [all, sector, about]) assert.ok(!/\bUS\b/.test(html.replace(/<style>[\s\S]*?<\/style>/, '')), 'no "US" in the page');
});

test('no "US startups" left in the home page, the README or the render code', () => {
  for (const file of ['index.html', 'README.md', 'api/_lib/render.js']) {
    assert.ok(!readFileSync(path.join(root, file), 'utf8').includes('US startups'), file);
  }
});

test('the footer links to the India list right after Directory', () => {
  const html = list([company()]);
  const nav = html.slice(html.indexOf('<nav class="foot-nav"'), html.indexOf('</nav>', html.indexOf('<nav class="foot-nav"')));
  assert.ok(nav.includes('<a href="/companies">Directory</a>\n      <a href="/companies?country=india">Startups in India</a>'));
  assert.equal(nav.split('href="/companies?country=india"').length - 1, 1);
});

test('the hiring filter says "Any hiring status"', () => {
  const html = list([company()]);
  assert.ok(html.includes('<option value="">Any hiring status</option>'));
  assert.ok(!html.includes('Hiring or not'));
});

test('/new uses the site-wide company count when it is loaded', () => {
  const run = { our_count: 3254, ran_at: '2026-11-22T06:00:00Z' };
  const withNav = renderNew({ fresh: true, rows: [company()], run, nav: { companies: 3625 } });
  assert.ok(withNav.includes('Tracking 3,625 companies'));
  assert.ok(!withNav.includes('3,254'));
  assert.ok(renderNew({ fresh: true, rows: [company()], run }).includes('Tracking 3,254 companies'));
  assert.ok(!renderNew({ fresh: true, rows: [company()], run: null, nav: { companies: 3625 } }).includes('Tracking'));
});

test('the home eyebrow no longer repeats the footer slogan', () => {
  const home = readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.ok(home.includes('<p class="eyebrow">Free company directory</p>'));
  assert.equal(home.split('one step from its founders').length - 1, 2, 'footer and JSON-LD slogan only');
});

const EMPTY_FILTERS = { q: '', sector: '', city: '', country: '', source: '', batch: '', year: '', hiring: false, page: 1 };
const countryList = (filters, rows = []) => renderList({ kind: 'all', filters: { ...EMPTY_FILTERS, ...filters }, facets: { total: 3635 }, total: rows.length, rows });
const stateOf = html => (html.match(/<div class="state">[\s\S]*?<\/div><\/div>/) || [''])[0];
const GENERIC_STATE = '<div class="state"><h2>No companies match these filters.</h2><p>Try removing a filter, or browse the newest additions.</p><div class="actions"><a class="btn btn-dark" href="/companies">Clear filters</a><a class="btn" href="/new">See new companies</a></div></div>';

test('India with no rows says companies are being added and names the sources', () => {
  const html = countryList({ country: 'india' });
  const state = stateOf(html);
  assert.ok(state.includes('<h2>Companies in India are being added.</h2>'));
  for (const name of COUNTRY_SOURCES.india) assert.ok(state.includes(name), name);
  assert.ok(state.includes('Elevation Capital, Stellaris Venture Partners, Prime Venture Partners and Antler India.'));
  assert.ok(state.includes('<a class="btn btn-dark" href="/companies">Browse all companies</a>'));
  assert.ok(state.includes('<a class="btn" href="/about-data">How we collect data</a>'));
  assert.ok(!html.includes('No companies match these filters'));
  assert.equal(html.split('<h1').length - 1, 1, 'one h1');
  assert.ok(!/<script(?![^>]*application\/ld\+json)/.test(state), 'no script');
  assert.ok(html.includes('content="Indian startups are being added to FoundReach from Elevation Capital, Stellaris Venture Partners, Prime Venture Partners and Antler India."'));
  assert.equal(html.match(/<title>(.*?)<\/title>/)[1], 'Startups in India: founders, careers &amp; contact | FoundReach');
  assert.ok(!EMAIL.test(state));
});

test('India with another filter and no rows keeps the generic state and links to all of India', () => {
  const html = countryList({ country: 'india', sector: 'fintech' });
  const state = stateOf(html);
  assert.ok(state.includes('No companies match these filters'));
  assert.ok(state.includes('<a class="btn btn-dark" href="/companies">Clear filters</a><a class="btn" href="/companies?country=india">All companies in India</a><a class="btn" href="/new">See new companies</a>'));
  assert.ok(!html.includes('are being added'));
  for (const extra of [{ q: 'pay' }, { city: 'bengaluru' }, { source: 'antler' }, { hiring: true }, { year: '2024' }]) {
    assert.ok(countryList({ country: 'india', ...extra }).includes('href="/companies?country=india">All companies in India'), JSON.stringify(extra));
  }
});

test('no country and no rows keeps today\'s generic state', () => {
  assert.equal(stateOf(countryList({})), GENERIC_STATE);
  assert.equal(stateOf(countryList({ sector: 'fintech' })), GENERIC_STATE);
  // A country without collected sources, or an unknown slug, gets the generic state too.
  assert.equal(stateOf(countryList({ country: 'united-states' })), GENERIC_STATE);
  assert.equal(stateOf(countryList({ country: 'atlantis' })), GENERIC_STATE);
  assert.ok(!countryList({ country: 'atlantis' }).includes('atlantis'));
});

test('India with rows shows the rows and no empty state', () => {
  const html = countryList({ country: 'india' }, [company({ country: 'India', city: 'Bengaluru' })]);
  assert.ok(html.includes('href="/companies/acme"'));
  assert.ok(!html.includes('are being added'));
  assert.ok(!html.includes('class="state"'));
});

test('/about-data names the India sources', () => {
  const about = renderAbout({ nav: { companies: 3625 } });
  assert.ok(about.includes('More countries are coming. Companies in India are being added now, from the public lists of Elevation Capital, Stellaris Venture Partners, Prime Venture Partners and Antler India.'));
});

test('joinNames joins with commas and a final "and"', () => {
  assert.equal(joinNames([]), '');
  assert.equal(joinNames(['A']), 'A');
  assert.equal(joinNames(['A', 'B']), 'A and B');
  assert.equal(joinNames(['A', 'B', 'C']), 'A, B and C');
});

test('the country migration only replaces the two functions and keeps their keys', () => {
  const dir = path.join(root, 'supabase/migrations');
  const file = path.join(dir, '202611250001_catalog_country.sql');
  assert.ok(existsSync(file));
  const sql = readFileSync(file, 'utf8');
  const code = sql.replace(/--.*$/gm, '');
  assert.ok(!/\b(drop|alter|delete|update|insert|truncate|grant|revoke|create\s+table)\b/i.test(code));
  assert.equal((code.match(/create or replace function/g) || []).length, 2);
  const body = (text, name) => { const at = text.lastIndexOf('create or replace function public.' + name + '('); return at < 0 ? '' : text.slice(at, text.indexOf('$$;', at)); };
  const keys = b => new Set([...b.matchAll(/'([a-z_]+)',/g)].map(m => m[1]));
  const earlier = { fr_catalog_row: '202611240003_directory_v2.sql', catalog_company: '202611240004_directory_polish.sql' };
  for (const [name, from] of Object.entries(earlier)) {
    const before = keys(body(readFileSync(path.join(dir, from), 'utf8'), name));
    const after = keys(body(sql, name));
    assert.ok(before.size > 5, name + ' was found in ' + from);
    for (const k of before) assert.ok(after.has(k), `${name} keeps '${k}'`);
    assert.ok(after.has('country') && !before.has('country'), name + ' gains country');
  }
});
