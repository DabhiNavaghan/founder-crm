// Route table and matching for the signed-in app. Pure: no window access, so it can be unit-tested.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const NAV = [
  { name: 'today', label: 'Today', path: '/app/today' },
  { name: 'pipeline', label: 'Pipeline', path: '/app/pipeline' },
  { name: 'studio', label: 'Message studio', short: 'Studio', path: '/app/studio' },
  // The directory is a public, server-rendered page: a plain link, not an app route.
  { name: 'directory', label: 'Directory', path: '/companies', external: true },
];

export const TITLES = { today: 'Today', pipeline: 'Pipeline', studio: 'Message studio', profile: 'Profile', notfound: 'Page not found' };

// -> { name, params, query, redirect? }. name is 'landing' for "/", 'notfound' for anything unknown under /app.
export function matchRoute(pathname, search = '') {
  const path = ('/' + String(pathname || '/').replace(/^\/+/, '')).replace(/\/+$/, '') || '/';
  const q = new URLSearchParams(search || '');
  const query = Object.fromEntries(q.entries());
  if (path === '/' || path === '/index.html') return { name: 'landing', params: {}, query };
  const parts = path.split('/').slice(1);
  if (parts[0] !== 'app') return { name: 'landing', params: {}, query, redirect: '/' };
  if (parts.length === 1) return { name: 'today', params: {}, query, redirect: '/app/today' };
  const [, section, id, ...rest] = parts;
  if (rest.length) return { name: 'notfound', params: {}, query };
  if (section === 'pipeline') {
    if (id === undefined) return { name: 'pipeline', params: {}, query };
    return ID.test(id) ? { name: 'pipeline', params: { companyId: id.toLowerCase() }, query } : { name: 'notfound', params: {}, query };
  }
  if (id !== undefined) return { name: 'notfound', params: {}, query };
  if (section === 'today' || section === 'profile') return { name: section, params: {}, query };
  if (section === 'studio') {
    const contact = ID.test(query.contact || '') ? query.contact.toLowerCase() : '';
    return { name: 'studio', params: contact ? { contactId: contact } : {}, query };
  }
  return { name: 'notfound', params: {}, query };
}

export const paths = {
  today: () => '/app/today',
  pipeline: id => (id ? '/app/pipeline/' + id : '/app/pipeline'),
  studio: contactId => (contactId ? '/app/studio?contact=' + contactId : '/app/studio'),
  profile: () => '/app/profile',
};

// Same-origin URL or path -> path the router can push; anything else -> null (needs a full navigation).
export function internalPath(to, origin) {
  if (typeof to !== 'string' || !to) return null;
  if (to.startsWith('/') && !to.startsWith('//')) return to;
  try {
    const u = new URL(to);
    return origin && u.origin === origin ? u.pathname + u.search + u.hash : null;
  } catch { return null; }
}
