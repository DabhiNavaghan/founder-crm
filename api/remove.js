// /remove: the public "Remove or correct my information" form. GET shows it, POST stores the request
// through the request_removal() database function and shows a confirmation.
import { rpc } from './_lib/db.js';
import { getNav } from './_lib/nav.js';
import { SLUG_RE, renderRemoveForm, renderRemoveDone } from './_lib/render.js';

const one = v => (Array.isArray(v) ? v[0] : v);
const str = (v, max) => String(one(v) ?? '').trim().slice(0, max);
function send(res, status, html) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(html);
}
function formBody(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const raw = Buffer.isBuffer(b) ? b.toString('utf8') : typeof b === 'string' ? b : '';
  return Object.fromEntries(new URLSearchParams(raw));
}

export default async function handler(req, res) {
  const nav = await getNav(); // footer links; null when unavailable
  const slugOf = v => { const s = str(v, 120).toLowerCase(); return SLUG_RE.test(s) ? s : ''; };
  if (req.method === 'GET' || req.method === 'HEAD') return send(res, 200, renderRemoveForm({ company: slugOf(req.query?.company), nav }));
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return send(res, 405, renderRemoveForm({ error: 'Please use the form below.', nav })); }
  let body = {};
  try { body = formBody(req); } catch { body = {}; }
  const company = slugOf(body.company);
  const values = { name: str(body.name, 120), relation: str(body.relation, 120), request: str(body.request, 4000) };
  // Hidden field that people never see; anything filling it is a bot. Answer as if it worked.
  if (str(body.website, 200)) return send(res, 200, renderRemoveDone({ nav }));
  if (values.name.length < 2 || values.request.length < 5) return send(res, 400, renderRemoveForm({ company, values, nav, error: 'Please add your name and what should be removed or corrected.' }));
  try {
    await rpc('request_removal', { p_slug: company || null, p_name: values.name, p_relation: values.relation || null, p_request: values.request });
    return send(res, 200, renderRemoveDone({ nav }));
  } catch (e) {
    console.error('FoundReach removal request error', e?.status || '', e?.code || '', e?.message);
    const busy = e?.code === '53400';
    return send(res, busy ? 429 : 503, renderRemoveForm({ company, values, nav, error: busy ? 'Too many requests right now. Please try again in an hour.' : 'We could not save your request just now. Please try again in a minute.' }));
  }
}
