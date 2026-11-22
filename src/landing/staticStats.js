// HTML for the parts of the landing page that come from /api/public/stats. Used at build time
// (vite.config.js bakes it into index.html) so the page is complete before any script runs.
// Pure: takes the output of normalizeStats() and returns strings, with every value escaped.
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const fmt = n => Number(n).toLocaleString('en-US');

// "By source": every source, then the latest batches.
export const sourceItems = stats => [...stats.sourceLinks, ...stats.batches];
// Footer link columns, the same five the directory pages render on the server.
export const footColumns = stats => [['Sectors', stats.sectors], ['Cities', stats.cities], ['Batches', stats.batches], ['Sources', stats.sourceLinks], ['Collections', stats.collections]].filter(c => c[1].length);

const pills = items => items.map(i => `<li><a class="pill" href="${esc(i.href)}">${esc(i.label)}${i.count != null ? ` <small>${fmt(i.count)}</small>` : ''}</a></li>`).join('\n          ');

// -> { marker name: html }. A marker is left out when there is nothing real to put there.
export function landingFragments(stats) {
  const out = {};
  for (const key of ['companies', 'leaders', 'hiring', 'new_this_week']) if (stats[key] != null) out['stat:' + key] = fmt(stats[key]);
  if (stats.sectors.length) out['list:sectors'] = pills(stats.sectors);
  if (stats.cities.length) out['list:cities'] = pills(stats.cities);
  if (sourceItems(stats).length) out['list:sources'] = pills(sourceItems(stats));
  const cols = footColumns(stats);
  if (cols.length) out.footcols = cols.map(([title, items]) => `<div><p class="foot-h">${esc(title)}</p><ul>${items.map(i => `<li><a href="${esc(i.href)}">${esc(i.label)}</a></li>`).join('')}</ul></div>`).join('');
  return out;
}

// Replaces the content between <!--fr:name--> and <!--/fr:name--> for every fragment given.
export function injectFragments(html, fragments) {
  let out = html;
  for (const [name, value] of Object.entries(fragments)) {
    const open = `<!--fr:${name}-->`, close = `<!--/fr:${name}-->`;
    const a = out.indexOf(open), b = out.indexOf(close);
    if (a === -1 || b < a) continue;
    out = out.slice(0, a + open.length) + value + out.slice(b);
  }
  return out;
}
