// The landing page is static HTML in index.html. This fills in live numbers and links from
// /api/public/stats. Every step is optional: if the request fails the static page stays as it is.
import { loadStats } from '../lib/stats.js';
import { fmt, footColumns, sourceItems } from './staticStats.js';

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function pills(list, items, tail) {
  if (!list || !items.length) return;
  const nodes = items.map(item => {
    const li = el('li'), a = el('a', 'pill', item.label + ' ');
    a.href = item.href;
    if (item.count != null) a.append(el('small', '', fmt(item.count)));
    li.append(a);
    return li;
  });
  if (tail) { const li = el('li'), a = el('a', 'pill', tail.label); a.href = tail.href; li.append(a); nodes.push(li); }
  list.replaceChildren(...nodes);
}

function newest(root, items) {
  const box = root.querySelector('[data-newest]'), list = root.querySelector('[data-newest-list]');
  if (!box || !list || items.length < 2) return;
  list.replaceChildren(...items.slice(0, 4).map(c => {
    const li = el('li'), a = el('a');
    a.href = c.href;
    let logo;
    if (c.logo_url) {
      logo = el('img', 'logo logo-s');
      logo.width = 36; logo.height = 36; logo.alt = ''; logo.loading = 'lazy'; logo.referrerPolicy = 'no-referrer';
      logo.addEventListener('error', () => { const fb = el('span', 'logo logo-fb logo-s', c.name.slice(0, 1)); fb.setAttribute('aria-hidden', 'true'); logo.replaceWith(fb); }, { once: true });
      logo.src = c.logo_url;
    } else {
      logo = el('span', 'logo logo-fb logo-s', c.name.slice(0, 1));
      logo.setAttribute('aria-hidden', 'true');
    }
    const body = el('span');
    body.append(el('b', '', c.name), el('small', '', c.description || [c.sector, c.city].filter(Boolean).join(' · ')));
    a.append(logo, body);
    li.append(a);
    return li;
  }));
  box.hidden = false;
}

// The footer link blocks the public pages render on the server: same markup, built from the same numbers.
function footer(root, stats) {
  const nav = root.querySelector('[data-foot-cols]');
  const blocks = footColumns(stats).map(([title, items]) => {
    const div = el('div'), ul = el('ul');
    for (const item of items) { const li = el('li'), a = el('a', '', item.label); a.href = item.href; li.append(a); ul.append(li); }
    div.append(el('p', 'foot-h', title), ul);
    return div;
  });
  if (!nav || !blocks.length) return;
  nav.replaceChildren(...blocks);
  nav.hidden = false;
}

export async function enhanceLanding() {
  const root = document.getElementById('landing');
  if (!root || root.dataset.enhanced) return;
  root.dataset.enhanced = '1';
  const stats = await loadStats();
  if (!stats) { delete root.dataset.enhanced; return; }
  for (const key of ['companies', 'leaders', 'hiring', 'new_this_week']) {
    const node = root.querySelector('[data-stat="' + key + '"]');
    if (node && stats[key] != null) node.textContent = fmt(stats[key]);
  }
  pills(root.querySelector('[data-browse="sectors"]'), stats.sectors);
  pills(root.querySelector('[data-browse="cities"]'), stats.cities);
  pills(root.querySelector('[data-browse="sources"]'), sourceItems(stats));
  newest(root, stats.newest);
  footer(root, stats);
}
