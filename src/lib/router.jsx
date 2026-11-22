// A tiny history router: "/" and "/app/*" are handled here, every other path is a server page.
import React, { useMemo, useSyncExternalStore } from 'react';
import { internalPath, matchRoute } from './routes.js';

const listeners = new Set();
const emit = () => listeners.forEach(fn => fn());
const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const current = () => window.location.pathname + window.location.search;
window.addEventListener('popstate', emit);

const inApp = path => path === '/' || path.startsWith('/?') || path === '/app' || path.startsWith('/app/') || path.startsWith('/app?');

export function navigate(to, { replace = false } = {}) {
  const path = internalPath(to, window.location.origin);
  if (path === null) return; // not same-origin: never follow
  if (!inApp(path)) { window.location.assign(path); return; }
  if (path !== current() + window.location.hash) window.history[replace ? 'replaceState' : 'pushState'](null, '', path);
  emit();
}

export function useRoute() {
  const loc = useSyncExternalStore(subscribe, current);
  return useMemo(() => {
    const i = loc.indexOf('?');
    return { ...matchRoute(i === -1 ? loc : loc.slice(0, i), i === -1 ? '' : loc.slice(i)), key: loc };
  }, [loc]);
}

// In-app link: a real <a href> (opens in a new tab, copies, works with the keyboard) that navigates without a reload.
export function Link({ to, replace, onClick, children, ...rest }) {
  const click = e => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return <a href={to} onClick={click} {...rest}>{children}</a>;
}
