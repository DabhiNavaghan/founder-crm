// A public directory page sends people here with /?save=slug or /?draft=slug&contact=id.
// The intent is kept for this tab so it survives the sign-in step; the app picks it up once signed in.
const SLUG = /^[a-z0-9][a-z0-9_-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INTENT_KEY = 'foundreach_intent';
const MAX_AGE = 60 * 60 * 1000;

export function parseIntent(search) {
  const p = new URLSearchParams(search || '');
  const draft = (p.get('draft') || '').trim().toLowerCase();
  const save = (p.get('save') || '').trim().toLowerCase();
  if (SLUG.test(draft)) {
    const contact = (p.get('contact') || '').trim().toLowerCase();
    return { type: 'draft', slug: draft, contact: UUID.test(contact) ? contact : '' };
  }
  if (SLUG.test(save)) return { type: 'save', slug: save, contact: '' };
  return null;
}

// The URL without the intent parameters (other parameters are kept).
export function stripIntent(search) {
  const p = new URLSearchParams(search || '');
  for (const k of ['save', 'draft', 'contact']) p.delete(k);
  const s = p.toString();
  return s ? '?' + s : '';
}

export function storeIntent(storage, intent, now = Date.now()) {
  try { storage.setItem(INTENT_KEY, JSON.stringify({ ...intent, at: now })); } catch { /* storage blocked */ }
}

export function peekIntent(storage, now = Date.now()) {
  try {
    const v = JSON.parse(storage.getItem(INTENT_KEY) || 'null');
    if (!v || !SLUG.test(v.slug || '') || !['save', 'draft'].includes(v.type)) return null;
    if (typeof v.at !== 'number' || now - v.at > MAX_AGE || now < v.at - 60000) return null;
    return { type: v.type, slug: v.slug, contact: UUID.test(v.contact || '') ? v.contact : '' };
  } catch { return null; }
}

export function takeIntent(storage, now = Date.now()) {
  const v = peekIntent(storage, now);
  try { storage.removeItem(INTENT_KEY); } catch { /* storage blocked */ }
  return v;
}

// Where a finished claim lands. claim = what claim_company returned.
export function intentTarget(intent, claim) {
  const companyId = claim?.company_id || '';
  if (intent.type === 'save') return { path: companyId ? '/app/pipeline/' + companyId : '/app/pipeline', toast: 'Saved' };
  const map = claim?.contacts || {};
  const contactId = map[intent.contact] || Object.values(map)[0] || '';
  if (contactId) return { path: '/app/studio?contact=' + contactId, toast: claim?.created ? 'Saved. Add one detail and draft your message.' : '' };
  return { path: companyId ? '/app/pipeline/' + companyId : '/app/pipeline', toast: 'Saved. This company has no people listed yet.' };
}
