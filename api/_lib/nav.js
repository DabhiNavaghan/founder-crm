// Site-wide numbers and link lists (catalog_stats) for the footer, /about-data and /api/public/stats.
// Held in memory for ten minutes per serverless instance so a page render does not pay for it every time.
import { rpc } from './db.js';

const TTL = 10 * 60 * 1000;
let cached = null, at = 0, pending = null;

// Returns the stats, or null when they cannot be loaded (pages then render without the link blocks).
// strict: throw instead of returning null.
export async function getNav({ strict = false } = {}) {
  if (cached && Date.now() - at < TTL) return cached;
  if (!pending) {
    pending = rpc('catalog_stats')
      .then(data => { if (data && typeof data === 'object') { cached = data; at = Date.now(); } return data; })
      .finally(() => { pending = null; });
  }
  try {
    const data = await pending;
    if (data && typeof data === 'object') return data;
    if (strict) throw new Error('catalog_stats returned nothing');
    return cached;
  } catch (e) {
    if (strict) throw e;
    console.error('FoundReach stats error', e?.status || '', e?.code || '', e?.message);
    return cached; // a stale copy beats none
  }
}
export function resetNav() { cached = null; at = 0; pending = null; }
