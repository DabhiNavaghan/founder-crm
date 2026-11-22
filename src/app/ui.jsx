// Small shared pieces of the signed-in app.
import React, { useEffect, useRef, useState } from 'react';
import { hostOf, safeUrl } from '../lib/url.js';

export function Mark({ size = 24 }) {
  return <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#c9f15a" /><path d="M13 27L27 13" fill="none" stroke="#202a31" strokeWidth="3.6" strokeLinecap="round" /><circle cx="13" cy="27" r="5" fill="#202a31" /><circle cx="27" cy="13" r="4.4" fill="#c9f15a" stroke="#202a31" strokeWidth="3.2" /></svg>;
}

export function Wordmark() {
  return <svg className="brand-logo" viewBox="0 0 247 40" width="173" height="28" role="img" aria-label="FoundReach"><rect x="0" y="0" width="40" height="40" rx="10" fill="#c9f15a" /><path d="M13 27L27 13" fill="none" stroke="#202a31" strokeWidth="3.6" strokeLinecap="round" /><circle cx="13" cy="27" r="5" fill="#202a31" /><circle cx="27" cy="13" r="4.4" fill="#c9f15a" stroke="#202a31" strokeWidth="3.2" /><path d="M52 32L52 8L65 8M52 19.5L62.5 19.5M84.6 24A8 8 0 0 1 68.6 24A8 8 0 0 1 84.6 24M89.8 16L89.8 25A7 7 0 0 0 103.8 25L103.8 16M103.8 16L103.8 32M109.8 16L109.8 32M109.8 23A7 7 0 0 1 123.8 23L123.8 32M145 24A8 8 0 0 1 129 24A8 8 0 0 1 145 24M145 8L145 32M151 32L151 8L159.5 8A6.5 6.5 0 0 1 159.5 21L151 21M158.5 21L166 32M169.6 24L185.6 24A8 8 0 1 0 183.26 29.66M206 24A8 8 0 0 1 190 24A8 8 0 0 1 206 24M206 16L206 32M224.86 18.34A8 8 0 1 0 224.86 29.66M229.6 8L229.6 32M229.6 23A7 7 0 0 1 243.6 23L243.6 32" fill="none" stroke="currentColor" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Company logo: the stored one, else the site's own icon, else the first letter.
export function Logo({ company, small }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(company?.website);
  const src = safeUrl(company?.logo_url) || (host ? 'https://www.google.com/s2/favicons?sz=128&domain=' + encodeURIComponent(host) : '');
  const cls = 'logo' + (small ? ' logo-s' : '');
  const px = small ? 36 : 44;
  if (src && !failed) return <img className={cls} width={px} height={px} alt="" loading="lazy" referrerPolicy="no-referrer" src={src} onError={() => setFailed(true)} />;
  return <span className={cls + ' logo-fb'} aria-hidden="true">{(company?.name || '?').trim().slice(0, 1)}</span>;
}

// External link that is only rendered when the address is http(s).
export function Ext({ href, children, ...rest }) {
  const url = safeUrl(href);
  if (!url) return null;
  return <a href={url} target="_blank" rel="noopener noreferrer" {...rest}>{children}</a>;
}

export function CopyButton({ text, label = 'Copy', what, onCopied, className = 'btn btn-sm' }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDone(false), 2000);
      onCopied?.();
    } catch { onCopied?.(new Error('Copy is blocked in this browser. Select the text and copy it by hand.')); }
  };
  return <button type="button" className={className} onClick={copy} aria-label={what ? label + ' ' + what : undefined}>{done ? 'Copied' : label}</button>;
}

// A native <details> menu (the designer's .pop/.menu) that also closes on outside click, Escape and after a choice.
export function Menu({ label, summaryClass = 'btn btn-icon', summary, className = 'pop', children }) {
  const ref = useRef(null);
  useEffect(() => {
    const close = e => {
      const d = ref.current;
      if (!d || !d.open) return;
      if (e.type === 'keydown') { if (e.key === 'Escape') { d.open = false; d.querySelector('summary')?.focus(); } return; }
      if (!d.contains(e.target)) d.open = false;
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
  }, []);
  const choose = e => { if (e.target.closest('a,button')) ref.current.open = false; };
  return <details className={className} ref={ref}>
    <summary className={summaryClass} aria-label={label}>{summary || <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="4" cy="10" r="1.6" /><circle cx="10" cy="10" r="1.6" /><circle cx="16" cy="10" r="1.6" /></svg>}</summary>
    <div className="menu" onClick={choose}>{children}</div>
  </details>;
}

export function Toasts({ items, dismiss }) {
  return <div className="toasts" role="status" aria-live="polite">
    {items.map(t => <div key={t.id} className={'toast' + (t.kind === 'error' ? ' toast-err' : '')}><span>{t.text}</span><button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)}>&times;</button></div>)}
  </div>;
}

export function SkeletonList({ rows = 3 }) {
  return <ul className="list" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => <li className="task" key={i}><span className="sk sk-logo" /><div className="t-body"><span className="sk sk-line" style={{ width: 40 + (i * 17) % 30 + '%' }} /><span className="sk sk-line" style={{ width: 60 + (i * 11) % 25 + '%' }} /></div></li>)}
  </ul>;
}

export function PageHead({ title, eyebrow, sub, children }) {
  return <div className="page-head">
    <div>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1 tabIndex={-1} data-page-title>{title}</h1>
      {sub && <p className="muted">{sub}</p>}
    </div>
    {children}
  </div>;
}

export function LoadError({ error, retry }) {
  return <div className="state" role="alert">
    <h2>Your desk did not load.</h2>
    <p>{error} Check your connection and try again.</p>
    <div className="actions"><button type="button" className="btn btn-dark" onClick={retry}>Try again</button></div>
  </div>;
}
