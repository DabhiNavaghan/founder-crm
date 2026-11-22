// Links come from spreadsheets, scrapers and user input: only http(s) is ever rendered as a link.
export function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : (/^[^\s/@]+\.[^\s/@]+/.test(raw) ? 'https://' + raw : '');
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') ? u.href : null;
  } catch { return null; }
}

export function hostOf(value) {
  const u = safeUrl(value);
  if (!u) return '';
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const EMAIL = /^[^\s@<>"',;:]+@[^\s@<>"',;:]+\.[a-z]{2,}$/i;
export const safeEmail = value => { const v = String(value ?? '').trim(); return EMAIL.test(v) ? v : null; };

// Slug from a public API is used in a path: keep it to the known shape.
export const safeSlug = value => { const v = String(value ?? '').trim().toLowerCase(); return /^[a-z0-9][a-z0-9_-]{0,99}$/.test(v) ? v : null; };
