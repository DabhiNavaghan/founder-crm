// The one client script for the public pages, served at /directory.js (see api/directory.js, view=script).
// Everything it does is optional: without it the filter form is a plain GET, chips and pager are links,
// "Quick view" is a link to the company page, and the header keeps "Sign in".
// Kept as a string so the serverless bundle needs no file reads.
import { createHash } from 'node:crypto';

const SOURCE = String.raw`(function () {
  var d = document, $ = function (s, r) { return (r || d).querySelector(s); };

  // Header: a signed-in visitor (Clerk's __client_uat cookie holds a timestamp) gets "Open desk".
  try {
    var uat = d.cookie.match(/(?:^|; )__client_uat=(\d+)/), auth = $('[data-auth]');
    if (auth && uat && +uat[1] > 0) { auth.textContent = 'Open desk'; auth.href = '/app/pipeline'; }
  } catch (e) {}

  // Company page: copy link.
  var cp = $('[data-copy]');
  if (cp && navigator.clipboard) {
    cp.hidden = false;
    cp.addEventListener('click', function () {
      navigator.clipboard.writeText(cp.getAttribute('data-copy')).then(function () {
        cp.textContent = 'Link copied';
        setTimeout(function () { cp.textContent = 'Copy link'; }, 2000);
      });
    });
  }

  // Lists: fetch the same URL, swap #results, keep the address bar and the back button right.
  var form = $('form.filters'), res = $('#results'), live = $('#live');
  if (res && window.fetch && window.DOMParser && history.pushState) {
    var timer, ctl;
    var load = function (url, mode) {
      if (ctl) ctl.abort();
      ctl = new AbortController();
      res.setAttribute('aria-busy', 'true');
      fetch(url, { signal: ctl.signal }).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html'), next = doc.getElementById('results');
        if (!next) throw 0;
        res.innerHTML = next.innerHTML;
        res.removeAttribute('aria-busy');
        var hero = $('#hero'), nh = doc.getElementById('hero');
        if (hero && nh) hero.innerHTML = nh.innerHTML;
        d.title = doc.title;
        if (form) [].forEach.call(form.elements, function (el) {
          var o = el.id && doc.getElementById(el.id);
          if (o && el !== d.activeElement) el.value = o.value;
        });
        if (mode === 'push') history.pushState({ fr: 1 }, '', url);
        else if (mode === 'replace') history.replaceState({ fr: 1 }, '', url);
        var c = $('.count', res);
        if (live) live.textContent = c ? c.textContent : '';
      }).catch(function (e) { if (!e || e.name !== 'AbortError') location.href = url; });
    };
    if (form) {
      var action = form.getAttribute('action');
      var formUrl = function () {
        var p = new URLSearchParams(new FormData(form));
        Array.from(new Set(p.keys())).forEach(function (k) { if (!p.get(k)) p.delete(k); });
        var q = p.toString();
        return action + (q ? '?' + q : '');
      };
      // Instant only on the page the form posts to; a page type (batch, city, ...) hands over to /companies.
      var go = function (mode) { if (location.pathname === action) load(formUrl(), mode); else location.href = formUrl(); };
      form.addEventListener('submit', function (e) { e.preventDefault(); clearTimeout(timer); go('push'); });
      form.addEventListener('change', function (e) { if (e.target.type !== 'search') go('push'); });
      form.addEventListener('input', function (e) {
        if (e.target.type !== 'search' || location.pathname !== action) return;
        clearTimeout(timer);
        timer = setTimeout(function () { go('replace'); }, 250);
      });
    }
    res.addEventListener('click', function (e) {
      var a = e.target.closest('a.chip-x,a.clear,a.pg');
      if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      load(a.getAttribute('href'), 'push');
      if (a.classList.contains('pg')) res.scrollIntoView();
    });
    window.addEventListener('popstate', function () { load(location.pathname + location.search); });
  }

  // Quick view (900px and up): a native dialog filled from /companies/:slug.json. Text is set with textContent only.
  var dlg = $('#qv'), wide = window.matchMedia && matchMedia('(min-width:900px)');
  if (dlg && dlg.showModal && wide && window.fetch) {
    var body = $('#qv-body'), opener;
    var el = function (tag, cls, txt, attrs) {
      var n = d.createElement(tag);
      if (cls) n.className = cls;
      if (txt != null) n.textContent = txt;
      for (var k in attrs || {}) n.setAttribute(k, attrs[k]);
      return n;
    };
    var web = function (u) { return /^https?:\/\//i.test(u || '') ? u : ''; };
    var short = function (u) { try { var p = new URL(u); return (p.hostname.replace(/^www\./, '') + p.pathname).replace(/\/+$/, ''); } catch (e) { return ''; } };
    var section = function (title) { var s = el('section'); s.appendChild(el('h3', 'qv-h', title)); return s; };
    var fill = function (c) {
      body.textContent = '';
      var head = el('header', 'qv-head'), box = el('div'), meta = el('p', 'co-meta');
      head.appendChild(web(c.logo_url)
        ? el('img', 'logo', null, { width: 44, height: 44, alt: '', referrerpolicy: 'no-referrer', src: c.logo_url })
        : el('span', 'logo logo-fb', (c.name || '?').charAt(0), { 'aria-hidden': 'true' }));
      box.appendChild(el('h2', 'qv-name', c.name, { id: 'qv-name' }));
      [c.place || c.city, c.industry || c.sector].forEach(function (t) { if (t) meta.appendChild(el('span', '', t)); });
      if (c.hiring) meta.appendChild(el('span', 'chip', 'Hiring'));
      box.appendChild(meta); head.appendChild(box); body.appendChild(head);
      if (c.badges && c.badges.length) {
        var tags = el('span', 'tags');
        c.badges.forEach(function (b) { tags.appendChild(el('span', 'tag', b)); });
        body.appendChild(tags);
      }
      if (c.description) body.appendChild(el('p', 'row-desc', c.description));
      var reach = section('Reach them'), out = el('ul', 'out');
      [['Website', c.website], ['Careers page', c.careers_url], ['Contact page', c.contact_url], ['Company LinkedIn', c.linkedin_url]].forEach(function (l) {
        if (!web(l[1])) return;
        var li = el('li'), a = el('a', '', null, { href: l[1], rel: 'nofollow noopener' });
        a.appendChild(el('b', '', l[0])); a.appendChild(el('small', '', short(l[1])));
        li.appendChild(a); out.appendChild(li);
      });
      if (out.children.length) reach.appendChild(out);
      if (c.verified_at) reach.appendChild(el('p', 'verified', 'Links last checked ' + c.verified_at));
      body.appendChild(reach);
      if (c.leaders && c.leaders.length) {
        var lead = section('Leaders'), ul = el('ul', 'people');
        c.leaders.forEach(function (p) {
          var li = el('li'), pb = el('div', 'p-body');
          pb.appendChild(el('h4', 'p-name', p.name));
          if (p.role) pb.appendChild(el('p', 'p-role', p.role));
          li.appendChild(pb);
          if (web(p.linkedin_url)) li.appendChild(el('a', 'btn', 'LinkedIn', { href: p.linkedin_url, rel: 'nofollow noopener', 'aria-label': p.name + ' on LinkedIn' }));
          ul.appendChild(li);
        });
        lead.appendChild(ul);
        if (c.leaders_count > c.leaders.length) lead.appendChild(el('p', 'hint', (c.leaders_count - c.leaders.length) + ' more on the full page.'));
        body.appendChild(lead);
      }
    };
    d.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('a[data-qv]');
      if (!b || !wide.matches || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      opener = b;
      var slug = encodeURIComponent(b.getAttribute('data-qv'));
      body.textContent = '';
      body.appendChild(el('h2', 'qv-name', 'Loading…', { id: 'qv-name', role: 'status' }));
      $('#qv-open').href = '/companies/' + slug;
      $('#qv-save').href = '/?save=' + slug;
      dlg.showModal();
      fetch('/companies/' + slug + '.json').then(function (r) { if (!r.ok) throw 0; return r.json(); }).then(fill)
        .catch(function () { location.href = '/companies/' + slug; });
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { if (opener && d.contains(opener)) opener.focus(); });
  }
})();
`;

// Light minification: drop comment lines and indentation. The source above stays readable.
export const SCRIPT = SOURCE.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('//')).join('\n') + '\n';
export const SCRIPT_VERSION = createHash('sha256').update(SCRIPT).digest('hex').slice(0, 10);
