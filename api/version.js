// /api/version: which release is serving this request. The daily pipeline reads it before and after
// a merge to name the previous and the new production release in its report.
export default function handler(req, res) {
  const host = process.env.VERCEL_URL || '';
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.end(JSON.stringify({
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 40),
    url: host ? 'https://' + host : '',
    environment: process.env.VERCEL_ENV || (host ? '' : 'container'),
  }));
}
