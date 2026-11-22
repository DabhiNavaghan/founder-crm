import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { normalizeStats } from './src/lib/stats.js';
import { injectFragments, landingFragments } from './src/landing/staticStats.js';

// The landing page is static HTML. At build time the live directory numbers and browse links are baked into it,
// so it reads correctly before (and without) JavaScript. If the live endpoint cannot be reached within 5 seconds,
// the committed snapshot is used instead: the build never fails over this and never ships placeholders.
// STATS_URL overrides the endpoint; SKIP_STATS_FETCH=1 goes straight to the snapshot.
const STATS_URL = process.env.STATS_URL || 'https://foundreach.navaghandabhi.dev/api/public/stats';
const SNAPSHOT = fileURLToPath(new URL('./src/landing/stats.snapshot.json', import.meta.url));
const usable = s => s && s.companies > 0 && s.sectors.length > 0 && s.cities.length > 0;

async function fetchLive() {
  if (process.env.SKIP_STATS_FETCH === '1') return null;
  try {
    const r = await fetch(STATS_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const stats = normalizeStats(await r.json());
    if (!usable(stats)) throw new Error('incomplete answer');
    return stats;
  } catch (e) {
    console.warn('[landing-stats] live stats unavailable (' + (e?.message || e) + '); using the snapshot');
    return null;
  }
}
function readSnapshot() {
  try {
    const stats = normalizeStats(JSON.parse(readFileSync(SNAPSHOT, 'utf8')));
    return usable(stats) ? stats : null;
  } catch (e) {
    console.warn('[landing-stats] snapshot unreadable (' + (e?.message || e) + '); keeping the values written in index.html');
    return null;
  }
}

function landingStats() {
  let pending = null, live = false;
  return {
    name: 'foundreach-landing-stats',
    configResolved(config) { live = config.command === 'build'; },
    transformIndexHtml: {
      order: 'pre',
      async handler(html) {
        // The dev server uses the snapshot; only a build asks the live site.
        pending ||= (live ? fetchLive() : Promise.resolve(null)).then(s => s || readSnapshot());
        const stats = await pending;
        return stats ? injectFragments(html, landingFragments(stats)) : html;
      },
    },
  };
}

export default defineConfig({ plugins: [landingStats()] });
