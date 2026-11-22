// A hint that this browser was signed in last time, so the next visit shows the app shell
// instead of flashing the landing page while the session loads. index.html reads the same key.
const KEY = 'foundreach_signed_in';
export function hadSession() {
  try { if (localStorage.getItem(KEY) === '1') return true; } catch { /* storage blocked */ }
  return /(?:^|; )__client_uat[^=]*=[1-9]/.test(document.cookie);
}
export function rememberSession(on) {
  try { on ? localStorage.setItem(KEY, '1') : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
export function setView(view) {
  const d = document.documentElement;
  if (d.getAttribute('data-view') !== view) d.setAttribute('data-view', view);
}
