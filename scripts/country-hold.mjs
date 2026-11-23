// Country handling for scripts/ingest.mjs, kept pure so tests can run it without a database.
// Before migration 202611260001 is applied, ingest_catalog() stores every new company as 'United States',
// so rows that state another country must not be sent until then.

export const COUNTRY_MIGRATION = '202611260001';

const US = new Set(['', 'us', 'usa', 'united states', 'united states of america']);

// The country a row will be stored under, for counts: 'United States' (also for an empty value) or the row's own text.
export function countryOf(row) {
  const c = String(row?.country ?? '').trim();
  return US.has(c.toLowerCase()) ? 'United States' : ['india', 'in'].includes(c.toLowerCase()) ? 'India' : c;
}

// rows -> { send, held }. Badge-add rows never create a company, so they are always sent.
export function holdBack(rows, ready) {
  if (ready) return { send: rows, held: [] };
  const send = [], held = [];
  for (const r of rows) (r.badge_only || countryOf(r) === 'United States' ? send : held).push(r);
  return { send, held };
}

// "by country: United States 12, India 3" for the new companies in a batch of rows.
export function countryLine(rows) {
  const n = {};
  for (const r of rows) if (!r.badge_only) n[countryOf(r)] = (n[countryOf(r)] || 0) + 1;
  return 'by country: ' + (Object.entries(n).map(([k, v]) => `${k} ${v}`).join(', ') || 'none');
}

// The answer of the fr_country_ingest_ready() probe: ready only on a 2xx whose body is true.
// 404 / PGRST202 (function missing: migration not applied) and every other failure mean "not ready".
export function readyFrom(status, body) {
  return status >= 200 && status < 300 && String(body).trim() === 'true';
}
