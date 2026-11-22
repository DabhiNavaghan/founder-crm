#!/usr/bin/env node
// Production server for running this Vercel project as one plain Node process (Docker).
//
// It reproduces the parts of Vercel this project relies on, and nothing is hard-coded:
//   - static files from dist/ (directory indexes, long cache for hashed /assets/*, no SPA catch-all: unknown paths are 404)
//   - vercel.json "rewrites" and "redirects" (:param, :param*, (regex) groups), original query string preserved
//   - api/**/*.js discovered at startup and served as /api/* with the Vercel Node helpers
//     (req.query, req.body, req.cookies, res.status(), res.json(), res.send(), res.redirect())
//   - vercel.json "functions[file].maxDuration" as the per-request time limit
//   - vercel.json "crons", run by a built-in scheduler (UTC, like Vercel) when CRON_SECRET is set
//   - a small in-memory stand-in for Vercel's edge cache, for responses that send CDN-Cache-Control: s-maxage
//   - /healthz, one log line per request, graceful shutdown on SIGTERM
//
// No dependencies: node:http only. Environment: PORT (3000), HOST (0.0.0.0), ENABLE_CRON ("0" turns the
// scheduler off), EDGE_CACHE ("0" turns the page cache off), BODY_LIMIT_BYTES (1048576),
// FUNCTION_TIMEOUT_SECONDS (30, used when vercel.json sets no maxDuration), LOG_HEALTH ("1" logs /healthz).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(ROOT, 'dist');
const API_DIR = path.join(ROOT, 'api');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const BODY_LIMIT = Number(process.env.BODY_LIMIT_BYTES) || 1024 * 1024;
const DEFAULT_TIMEOUT_S = Number(process.env.FUNCTION_TIMEOUT_SECONDS) || 30;
const EDGE_CACHE_ON = process.env.EDGE_CACHE !== '0';
const EDGE_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const EDGE_CACHE_MAX_ENTRY = 512 * 1024;
const LOG_HEALTH = process.env.LOG_HEALTH === '1';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const logError = (...a) => console.error(new Date().toISOString(), ...a);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ---------------------------------------------------------------------------------------------
// vercel.json
// ---------------------------------------------------------------------------------------------
function readVercelConfig() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8')); } catch (e) {
    if (e.code !== 'ENOENT') logError('vercel.json could not be read:', e.message);
    return {};
  }
}
const config = readVercelConfig();

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
function closingParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '(') depth++;
    else if (s[i] === ')' && --depth === 0) return i;
  }
  throw new Error('Unbalanced parenthesis in "' + s + '"');
}

// Turns a vercel.json "source" (path-to-regexp syntax) into a RegExp and the list of its parameter names.
// Supported: ":name", ":name(regex)", "(regex)" (numbered from 0), each with an optional "*", "+" or "?".
function compileSource(source) {
  const keys = [];
  let re = '', i = 0, unnamed = 0;
  const group = (pattern, mod) => {
    const p = pattern.replace(/(?<!\\)\((?!\?)/g, '(?:');
    const many = `${p}(?:/${p})*`;
    if (mod === '+') return `(${many})`;
    if (mod === '*' || mod === '?') {
      const body = mod === '*' ? many : p;
      // "/:path*" also matches when the whole "/segment" is absent.
      if (re.endsWith('\\/')) { re = re.slice(0, -2); return `(?:/(${body}))?`; }
      return `(${body})?`;
    }
    return `(${p})`;
  };
  while (i < source.length) {
    const ch = source[i];
    if (ch === ':' && /[A-Za-z_]/.test(source[i + 1] || '')) {
      let j = i + 1;
      while (j < source.length && /\w/.test(source[j])) j++;
      const name = source.slice(i + 1, j);
      let pattern = '[^/]+';
      if (source[j] === '(') { const end = closingParen(source, j); pattern = source.slice(j + 1, end); j = end + 1; }
      const mod = source[j] && '*+?'.includes(source[j]) ? source[j++] : '';
      const part = group(pattern, mod); // group() may trim `re`, so it has to run before the append
      re += part; keys.push(name); i = j;
    } else if (ch === '(') {
      const end = closingParen(source, i);
      let j = end + 1;
      const mod = source[j] && '*+?'.includes(source[j]) ? source[j++] : '';
      const part = group(source.slice(i + 1, end), mod);
      re += part; keys.push(String(unnamed++)); i = j;
    } else { re += escapeRe(ch); i++; }
  }
  // path-to-regexp is not strict about one trailing slash, and neither is Vercel.
  return { regex: new RegExp('^' + re.replace(/\\\/$/, '') + '/?$'), keys };
}

function compileRules(list, kind) {
  const out = [];
  for (const rule of Array.isArray(list) ? list : []) {
    try {
      if (!rule || typeof rule.source !== 'string' || typeof rule.destination !== 'string') throw new Error('needs "source" and "destination"');
      if (rule.has || rule.missing) throw new Error('"has"/"missing" conditions are not supported by server.mjs');
      if (kind === 'rewrite' && !rule.destination.startsWith('/')) throw new Error('external rewrite destinations are not supported by server.mjs');
      out.push({ ...compileSource(rule.source), source: rule.source, destination: rule.destination, permanent: rule.permanent, statusCode: rule.statusCode });
    } catch (e) { logError(`vercel.json ${kind} ignored (${rule?.source}): ${e.message}`); }
  }
  return out;
}
const rewrites = compileRules(config.rewrites, 'rewrite');
const redirects = compileRules(config.redirects, 'redirect');

function matchRule(rules, pathname) {
  for (const rule of rules) {
    const m = rule.regex.exec(pathname);
    if (!m) continue;
    const params = {};
    rule.keys.forEach((k, idx) => { params[k] = m[idx + 1] ?? ''; });
    return { rule, params };
  }
  return null;
}
const safeDecode = v => { try { return decodeURIComponent(v); } catch { return v; } };
// Replaces ":name", ":name*" and "$1" in a destination. `map` decides how a captured value is written.
function substitute(template, params, map, used) {
  return template.replace(/:([A-Za-z_]\w*)\*?|\$(\d+)/g, (whole, name, num) => {
    const key = name ?? String(Number(num) - 1);
    if (!(key in params)) return whole;
    used?.add(key);
    return map(params[key]);
  });
}

// Applies a matched rewrite. Values captured from the path can never add or override query parameters:
// they are written into the destination's query as single encoded values, and the destination's own
// parameters win over same-named parameters of the incoming request.
function applyRewrite({ rule, params }, search) {
  const q = rule.destination.indexOf('?');
  const used = new Set();
  const pathname = substitute(q < 0 ? rule.destination : rule.destination.slice(0, q), params, v => v, used);
  const query = new URLSearchParams();
  if (q >= 0) for (const [k, v] of new URLSearchParams(rule.destination.slice(q + 1))) query.append(k, substitute(v, params, safeDecode, used));
  // Like Vercel, named parameters the destination does not mention are passed along in the query.
  for (const k of rule.keys) if (!used.has(k) && !/^\d+$/.test(k) && !query.has(k)) query.append(k, safeDecode(params[k]));
  const fixed = new Set(query.keys());
  for (const [k, v] of new URLSearchParams(search)) if (!fixed.has(k)) query.append(k, v);
  const qs = query.toString();
  return { pathname, search: qs ? '?' + qs : '' };
}

// ---------------------------------------------------------------------------------------------
// Static files: dist/ is indexed once at startup, so a request path is only ever looked up in a map
// and never turned into a filesystem path. Nothing outside dist/ can be reached.
// ---------------------------------------------------------------------------------------------
const TYPES = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', map: 'application/json; charset=utf-8', txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8', svg: 'image/svg+xml', webmanifest: 'application/manifest+json', csv: 'text/csv; charset=utf-8',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', pdf: 'application/pdf', wasm: 'application/wasm',
  mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|manifest\+json|wasm)|image\/svg\+xml)/;
const ASSET_CACHE = 'public, max-age=31536000, immutable';
const PAGE_CACHE = 'public, max-age=0, must-revalidate';

const staticFiles = new Map();
function indexStatic(dir, urlDir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.well-known') continue;
    const file = path.join(dir, entry.name), url = urlDir + entry.name;
    if (entry.isDirectory()) { indexStatic(file, url + '/'); continue; }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(file);
    const type = TYPES[path.extname(entry.name).slice(1).toLowerCase()] || 'application/octet-stream';
    const tag = stat.size <= 20 * 1024 * 1024 ? createHash('sha1').update(fs.readFileSync(file)).digest('base64url').slice(0, 20) : `${stat.size.toString(36)}-${Math.floor(stat.mtimeMs).toString(36)}`;
    const item = { file, size: stat.size, type, etag: `W/"${tag}"`, cache: url.startsWith('/assets/') ? ASSET_CACHE : PAGE_CACHE, compressible: COMPRESSIBLE.test(type) && stat.size >= 1024 && stat.size <= 8 * 1024 * 1024, encoded: {} };
    staticFiles.set(url, item);
    if (entry.name === 'index.html') {
      staticFiles.set(urlDir, item);
      if (urlDir.length > 1) staticFiles.set(urlDir.slice(0, -1), item);
    }
  }
}
indexStatic(DIST_DIR, '/');

function findStatic(rawPath) {
  let decoded;
  try { decoded = decodeURIComponent(rawPath); } catch { throw new HttpError(400, 'Bad Request'); }
  if (decoded.includes('\0')) throw new HttpError(400, 'Bad Request');
  return staticFiles.get(decoded) || null;
}

function pickEncoding(req) {
  const accept = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b(?!\s*;\s*q=0(\.0+)?\s*(,|$))/.test(accept)) return 'br';
  if (/\bgzip\b(?!\s*;\s*q=0(\.0+)?\s*(,|$))/.test(accept)) return 'gzip';
  return '';
}
const compress = (buf, enc, quality) => new Promise((resolve, reject) => {
  const done = (err, out) => (err ? reject(err) : resolve(out));
  if (enc === 'br') zlib.brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } }, done);
  else zlib.gzip(buf, { level: 9 }, done);
});
function addVary(res, value) {
  const current = String(res.getHeader('Vary') || '');
  if (!current.toLowerCase().split(/\s*,\s*/).includes(value.toLowerCase())) res.setHeader('Vary', current ? current + ', ' + value : value);
}

async function serveStatic(req, res, item) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendPlain(res, 405, 'Method Not Allowed');
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', item.type);
  res.setHeader('Cache-Control', item.cache);
  res.setHeader('ETag', item.etag);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (item.compressible) addVary(res, 'Accept-Encoding');
  if (String(req.headers['if-none-match'] || '').split(/\s*,\s*/).includes(item.etag)) { res.statusCode = 304; return res.end(); }
  const enc = item.compressible ? pickEncoding(req) : '';
  if (enc) {
    // Compressed once per file and encoding, then kept: dist/ never changes while the server runs.
    item.encoded[enc] ??= fs.promises.readFile(item.file).then(buf => compress(buf, enc, 9));
    let body;
    try { body = await item.encoded[enc]; } catch (e) { delete item.encoded[enc]; throw e; }
    res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', body.length);
    return res.end(body);
  }
  res.setHeader('Content-Length', item.size);
  if (req.method === 'HEAD') return res.end();
  pipeline(fs.createReadStream(item.file), res, err => { if (err && !res.destroyed) res.destroy(); });
}

// ---------------------------------------------------------------------------------------------
// API functions: every api/**/*.js file whose path has no segment starting with "_" or "." is a route.
// api/a/b.js -> /api/a/b, api/a/index.js -> /api/a, api/[id].js -> /api/:id, api/[...rest].js -> catch-all.
// ---------------------------------------------------------------------------------------------
const globToRegex = glob => new RegExp('^' + glob.split(/(\*\*\/|\*\*|\*|\?)/).map(part => (
  part === '**/' ? '(?:.*/)?' : part === '**' ? '.*' : part === '*' ? '[^/]*' : part === '?' ? '[^/]' : escapeRe(part)
)).join('') + '$');
function maxDurationFor(rel) {
  const fns = config.functions && typeof config.functions === 'object' ? config.functions : {};
  const hit = fns[rel] ?? Object.entries(fns).find(([glob]) => globToRegex(glob).test(rel))?.[1];
  const seconds = Number(hit?.maxDuration);
  return seconds > 0 ? seconds : DEFAULT_TIMEOUT_S;
}

const staticRoutes = new Map();
const dynamicRoutes = [];
function discoverFunctions(dir, relDir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = relDir + entry.name;
    if (entry.isDirectory()) { discoverFunctions(path.join(dir, entry.name), rel + '/'); continue; }
    const ext = /\.(js|mjs|cjs)$/.exec(entry.name)?.[0];
    if (!entry.isFile() || !ext || /\.(test|spec)\.[cm]?js$/.test(entry.name)) continue;
    const parts = rel.slice(0, -ext.length).split('/');
    if (parts.length > 1 && parts.at(-1) === 'index') parts.pop();
    const segments = parts.map(p => {
      const all = /^\[\.\.\.(\w+)\]$/.exec(p), one = /^\[(\w+)\]$/.exec(p);
      return all ? { catchAll: all[1] } : one ? { param: one[1] } : { text: p };
    });
    const fn = { file: path.join(dir, entry.name), rel, route: '/' + parts.join('/'), segments, maxDuration: maxDurationFor(rel), module: null };
    if (segments.every(s => s.text !== undefined)) staticRoutes.set(fn.route, fn);
    else dynamicRoutes.push(fn);
  }
}
discoverFunctions(API_DIR, 'api/');
dynamicRoutes.sort((a, b) => a.segments.filter(s => s.text === undefined).length - b.segments.filter(s => s.text === undefined).length || b.segments.length - a.segments.length);

function findFunction(rawPath) {
  const clean = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
  const exact = staticRoutes.get(clean);
  if (exact) return { fn: exact, params: {} };
  const parts = clean.split('/').slice(1);
  next: for (const fn of dynamicRoutes) {
    const params = {};
    for (let i = 0; i < fn.segments.length; i++) {
      const seg = fn.segments[i];
      if (seg.catchAll) { if (i >= parts.length) continue next; params[seg.catchAll] = parts.slice(i).map(safeDecode).join('/'); return { fn, params }; }
      if (i >= parts.length || parts[i] === '') continue next;
      if (seg.param) params[seg.param] = safeDecode(parts[i]);
      else if (seg.text !== parts[i]) continue next;
    }
    if (parts.length === fn.segments.length) return { fn, params };
  }
  return null;
}

function loadHandler(fn) {
  // Imported on first use and kept. A failed import is retried on the next request.
  fn.module ??= import(pathToFileURL(fn.file).href).catch(e => { fn.module = null; throw e; });
  return fn.module;
}

function parseQuery(search) {
  const out = {};
  for (const [k, v] of new URLSearchParams(search)) {
    if (!Object.hasOwn(out, k)) out[k] = v;
    else if (Array.isArray(out[k])) out[k].push(v);
    else out[k] = [out[k], v];
  }
  return out;
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const key = part.slice(0, eq).trim();
    if (key && !Object.hasOwn(out, key)) out[key] = safeDecode(part.slice(eq + 1).trim().replace(/^"(.*)"$/, '$1'));
  }
  return out;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > BODY_LIMIT) return reject(new HttpError(413, 'Payload Too Large'));
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) { req.removeAllListeners('data'); req.resume(); return reject(new HttpError(413, 'Payload Too Large')); }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('aborted', () => reject(new HttpError(400, 'Request aborted')));
    req.on('error', reject);
  });
}
// Same rules as Vercel's Node helpers: JSON and urlencoded bodies become objects, text stays a string,
// application/octet-stream stays a Buffer, anything else is left undefined.
function parseBody(raw, contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) {
    if (!raw.length) return {};
    try { return JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON'); }
  }
  if (type === 'application/x-www-form-urlencoded') return parseQuery(raw.toString('utf8'));
  if (type === 'text/plain') return raw.toString('utf8');
  if (type === 'application/octet-stream') return raw;
  return undefined;
}

function addHelpers(res) {
  res.status = code => { res.statusCode = code; return res; };
  res.json = data => {
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(data));
    return res;
  };
  res.send = data => {
    if (data === undefined || data === null) { res.end(); return res; }
    if (Buffer.isBuffer(data) || data instanceof Uint8Array) {
      if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/octet-stream');
      res.end(data);
      return res;
    }
    if (typeof data === 'object' || typeof data === 'number' || typeof data === 'boolean') return res.json(data);
    if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(String(data));
    return res;
  };
  res.redirect = (statusOrUrl, url) => {
    const status = typeof statusOrUrl === 'number' ? statusOrUrl : 307;
    const location = String(typeof statusOrUrl === 'number' ? url : statusOrUrl);
    res.statusCode = status;
    res.setHeader('Location', location);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Redirecting to ${location} (${status})`);
    return res;
  };
}

// --- Edge cache stand-in -----------------------------------------------------------------------
// On Vercel the directory pages are cached at the edge because the handler sends
// "CDN-Cache-Control: s-maxage=N". Here the same header keeps the finished response in memory for N
// seconds, so a crawler does not turn every hit into database calls. Only GET, only complete bodies.
const edgeCache = new Map();
let edgeCacheBytes = 0;
function edgeTtl(res) {
  const header = res.getHeader('Vercel-CDN-Cache-Control') ?? res.getHeader('CDN-Cache-Control');
  if (header === undefined || /no-store|private/i.test(String(header))) return 0;
  return Number(/s-maxage=(\d+)/i.exec(String(header))?.[1]) || 0;
}
function edgeGet(key) {
  const hit = edgeCache.get(key);
  if (!hit) return null;
  if (hit.expires > Date.now()) return hit;
  edgeCache.delete(key); edgeCacheBytes -= hit.body.length;
  return null;
}
function edgePut(key, res, body) {
  const ttl = edgeTtl(res);
  if (!ttl || body.length > EDGE_CACHE_MAX_ENTRY || res.hasHeader('Set-Cookie')) return;
  const headers = {};
  for (const [k, v] of Object.entries(res.getHeaders())) if (!['content-length', 'content-encoding', 'connection', 'date', 'vary'].includes(k)) headers[k] = v;
  const old = edgeCache.get(key);
  if (old) { edgeCache.delete(key); edgeCacheBytes -= old.body.length; }
  edgeCache.set(key, { status: res.statusCode, headers, body, stored: Date.now(), expires: Date.now() + ttl * 1000 });
  edgeCacheBytes += body.length;
  for (const [k, v] of edgeCache) {
    if (edgeCacheBytes <= EDGE_CACHE_MAX_BYTES) break;
    edgeCache.delete(k); edgeCacheBytes -= v.body.length;
  }
}

function compressDynamic(req, res, body) {
  if (req.method === 'HEAD' || body.length < 1024 || body.length > 4 * 1024 * 1024 || res.hasHeader('Content-Encoding')) return body;
  if ([204, 304].includes(res.statusCode) || !COMPRESSIBLE.test(String(res.getHeader('Content-Type') || ''))) return body;
  const enc = pickEncoding(req);
  if (!enc) { addVary(res, 'Accept-Encoding'); return body; }
  // Synchronous on purpose (res.end must stay synchronous); these bodies are small HTML/JSON documents.
  const out = enc === 'br'
    ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
    : zlib.gzipSync(body, { level: 6 });
  res.setHeader('Content-Encoding', enc);
  res.removeHeader('Content-Length');
  addVary(res, 'Accept-Encoding');
  return out;
}

// Wraps res.end for a function response: a body sent in one piece is offered to the edge cache and compressed.
function finishWith(req, res, cacheKey) {
  const end = res.end, write = res.write;
  let streamed = false;
  res.write = function (...args) { streamed = true; return write.apply(this, args); };
  res.end = function (chunk, encoding, cb) {
    res.end = end; res.write = write;
    if (typeof chunk === 'function') { cb = chunk; chunk = undefined; } else if (typeof encoding === 'function') { cb = encoding; encoding = undefined; }
    if (streamed || res.headersSent || chunk === undefined || chunk === null) return end.call(this, chunk, encoding, cb);
    let body = Buffer.isBuffer(chunk) ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength) : Buffer.from(String(chunk), encoding || 'utf8');
    try {
      if (cacheKey) edgePut(cacheKey, res, body);
      body = compressDynamic(req, res, body);
    } catch (e) { logError('response post-processing failed:', e.message); }
    return end.call(this, body, cb);
  };
}

async function runFunction(req, res, fn, params, search, ctx) {
  ctx.target = fn.route;
  const cacheKey = EDGE_CACHE_ON && req.method === 'GET' && !req.headers.authorization ? fn.route + search : '';
  const cached = cacheKey || (EDGE_CACHE_ON && req.method === 'HEAD') ? edgeGet(fn.route + search) : null;
  if (cached) {
    ctx.target += ' (cached)';
    res.statusCode = cached.status;
    for (const [k, v] of Object.entries(cached.headers)) res.setHeader(k, v);
    res.setHeader('Age', Math.floor((Date.now() - cached.stored) / 1000));
    res.setHeader('X-Cache', 'HIT');
    return res.end(compressDynamic(req, res, cached.body));
  }

  const mod = await loadHandler(fn);
  const handler = typeof mod.default === 'function' ? mod.default : typeof mod.default?.default === 'function' ? mod.default.default : null;
  if (!handler) throw new Error(`${fn.rel} has no default export function`);

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const raw = await readBody(req);
    body = (mod.config ?? mod.default?.config)?.api?.bodyParser === false ? raw : parseBody(raw, req.headers['content-type']);
  }
  const query = { ...parseQuery(search), ...params };
  req.originalUrl = req.url;
  req.url = ctx.rewritten || req.url;
  Object.defineProperty(req, 'query', { value: query, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(req, 'body', { value: body, writable: true, configurable: true, enumerable: true });
  Object.defineProperty(req, 'cookies', { value: parseCookies(req.headers.cookie), writable: true, configurable: true, enumerable: true });
  addHelpers(res);
  finishWith(req, res, cacheKey);

  let timer;
  const timedOut = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), fn.maxDuration * 1000); });
  try {
    // A handler is finished when the response is, like on Vercel; returning early does not end the request.
    const finished = new Promise(resolve => res.once('close', resolve));
    const work = Promise.resolve().then(() => handler(req, res)).then(() => finished);
    work.catch(() => {});
    if (await Promise.race([work, timedOut]) === 'timeout') {
      ctx.note = `timed out after ${fn.maxDuration}s`;
      work.catch(e => logError(`${fn.rel} failed after its time limit:`, e?.message));
      if (!res.headersSent) { res.end = Object.getPrototypeOf(res).end; res.write = Object.getPrototypeOf(res).write; sendPlain(res, 504, 'Function timed out'); }
      else res.destroy();
    }
  } finally { clearTimeout(timer); }
}

// ---------------------------------------------------------------------------------------------
// Request handling. Order, as on Vercel: redirects, then real files and functions, then rewrites, then 404.
// ---------------------------------------------------------------------------------------------
function sendPlain(res, status, text, headers = {}) {
  if (res.headersSent) { res.destroy(); return; }
  for (const name of res.getHeaderNames()) if (!['allow', 'connection'].includes(name)) res.removeHeader(name);
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(text + '\n');
}

let shuttingDown = false;
const startedAt = Date.now();

async function route(req, res, ctx) {
  let target = req.url || '/';
  if (!target.startsWith('/')) {
    // Absolute-form request target ("GET http://host/path"); anything else is malformed.
    try { const u = new URL(target); target = u.pathname + u.search; } catch { throw new HttpError(400, 'Bad Request'); }
  }
  const q = target.indexOf('?');
  const pathname = q < 0 ? target : target.slice(0, q);
  const search = q < 0 ? '' : target.slice(q);

  if (pathname === '/healthz') {
    ctx.quiet = !LOG_HEALTH;
    res.statusCode = shuttingDown ? 503 : 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ status: shuttingDown ? 'shutting_down' : 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) }));
  }

  const redirect = matchRule(redirects, pathname);
  if (redirect) {
    let location = substitute(redirect.rule.destination, redirect.params, v => v);
    if (search && !location.includes('?')) location += search;
    res.statusCode = Number(redirect.rule.statusCode) || (redirect.rule.permanent === false ? 307 : 308);
    res.setHeader('Location', location);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(`Redirecting to ${location}\n`);
  }

  if (pathname === '/api' || pathname.startsWith('/api/')) {
    const found = findFunction(pathname);
    if (found) return runFunction(req, res, found.fn, found.params, search, ctx);
  } else {
    const file = findStatic(pathname);
    if (file) return serveStatic(req, res, file);
  }

  const rewrite = matchRule(rewrites, pathname);
  if (rewrite) {
    const dest = applyRewrite(rewrite, search);
    ctx.rewritten = dest.pathname + dest.search;
    if (dest.pathname === '/api' || dest.pathname.startsWith('/api/')) {
      const found = findFunction(dest.pathname);
      if (found) return runFunction(req, res, found.fn, found.params, dest.search, ctx);
    } else {
      const file = findStatic(dest.pathname);
      if (file) return serveStatic(req, res, file);
    }
  }
  return sendPlain(res, 404, 'Not Found');
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || req.socket.remoteAddress || '-').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 45) || '-';
}

const server = http.createServer((req, res) => {
  const ctx = { quiet: false, target: '', note: '', rewritten: '' };
  const started = process.hrtime.bigint();
  const url = req.url;
  const sentBefore = req.socket.bytesWritten;
  res.once('close', () => {
    if (ctx.quiet) return;
    const ms = Number((process.hrtime.bigint() - started) / 1000000n);
    const status = res.writableFinished ? res.statusCode : 499; // 499: the client went away first
    const line = [req.method, JSON.stringify(String(url).slice(0, 500)), status, ms + 'ms', (req.socket.bytesWritten - sentBefore) + 'b', clientIp(req)];
    if (ctx.target) line.push('-> ' + ctx.target);
    if (ctx.note) line.push('(' + ctx.note + ')');
    log(...line);
  });
  if (shuttingDown) res.setHeader('Connection', 'close');
  route(req, res, ctx).catch(err => {
    // The cause goes to the log; the client only ever sees a status line.
    if (err instanceof HttpError) {
      ctx.note = err.message;
      return sendPlain(res, err.status, err.message, err.status === 413 ? { Connection: 'close' } : {});
    }
    logError(`${req.method} ${String(url).slice(0, 500)} failed:`, err?.stack || err);
    res.end = Object.getPrototypeOf(res).end; res.write = Object.getPrototypeOf(res).write;
    sendPlain(res, 500, 'Internal Server Error');
  });
});
server.requestTimeout = 30000;    // time allowed to receive a whole request
server.headersTimeout = 15000;
server.keepAliveTimeout = 65000;  // longer than the usual 60s of a reverse proxy in front
server.timeout = 120000;          // idle socket
server.on('clientError', (err, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy(); });

// ---------------------------------------------------------------------------------------------
// Cron: vercel.json "crons" run here. Schedules are five-field cron expressions evaluated in UTC,
// as on Vercel. Each run is a normal request to this server with "Authorization: Bearer $CRON_SECRET".
// ---------------------------------------------------------------------------------------------
function parseCronField(field, min, max) {
  const values = new Set();
  for (const part of field.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error('unsupported field "' + field + '"');
    const step = m[2] ? Number(m[2]) : 1;
    let from = min, to = max;
    if (m[1] !== '*') { const [a, b] = m[1].split('-').map(Number); from = a; to = b ?? (m[2] ? max : a); }
    if (!(step > 0) || from < min || to > max || from > to) throw new Error('out of range "' + field + '"');
    for (let v = from; v <= to; v += step) values.add(v);
  }
  return { values, any: field === '*' };
}
function parseCron(expr) {
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) throw new Error('expected five fields');
  const dow = parseCronField(f[4], 0, 7);
  if (dow.values.delete(7)) dow.values.add(0);
  return { minute: parseCronField(f[0], 0, 59), hour: parseCronField(f[1], 0, 23), dom: parseCronField(f[2], 1, 31), month: parseCronField(f[3], 1, 12), dow };
}
function cronMatches(c, d) {
  if (!c.minute.values.has(d.getUTCMinutes()) || !c.hour.values.has(d.getUTCHours()) || !c.month.values.has(d.getUTCMonth() + 1)) return false;
  const dom = c.dom.values.has(d.getUTCDate()), dow = c.dow.values.has(d.getUTCDay());
  return c.dom.any || c.dow.any ? dom && dow : dom || dow;
}

const cronJobs = [];
let cronTimer = null;
async function runCron(job) {
  if (job.running) { log(`cron ${job.path} skipped: the previous run is still going`); return; }
  job.running = true;
  const started = Date.now();
  try {
    const fn = findFunction(job.path.split('?')[0])?.fn;
    const r = await fetch(`http://127.0.0.1:${PORT}${job.path}`, {
      headers: { Authorization: 'Bearer ' + process.env.CRON_SECRET, 'User-Agent': 'vercel-cron/1.0' },
      signal: AbortSignal.timeout(((fn?.maxDuration || DEFAULT_TIMEOUT_S) + 15) * 1000),
    });
    const text = (await r.text()).replace(/\s+/g, ' ').slice(0, 400);
    (r.ok ? log : logError)(`cron ${job.path} -> ${r.status} in ${Date.now() - started}ms ${text}`);
  } catch (e) {
    logError(`cron ${job.path} failed after ${Date.now() - started}ms: ${e?.message}`);
  } finally { job.running = false; }
}
function startCron() {
  const list = Array.isArray(config.crons) ? config.crons : [];
  if (!list.length) return;
  if (!process.env.CRON_SECRET) return log('cron: off (CRON_SECRET is not set)');
  if (process.env.ENABLE_CRON === '0') return log('cron: off (ENABLE_CRON=0)');
  for (const c of list) {
    try {
      if (typeof c?.path !== 'string' || !c.path.startsWith('/')) throw new Error('needs a "path"');
      cronJobs.push({ path: c.path, schedule: c.schedule, spec: parseCron(c.schedule), running: false });
      log(`cron: ${c.path} at "${c.schedule}" (UTC)`);
    } catch (e) { logError(`cron: ${c?.path} "${c?.schedule}" ignored: ${e.message}`); }
  }
  if (!cronJobs.length) return;
  let lastMinute = Math.floor(Date.now() / 60000);
  const tick = () => {
    const minute = Math.floor(Date.now() / 60000);
    // Every minute since the last tick is checked, so a late timer cannot skip a run.
    for (let m = Math.max(lastMinute + 1, minute - 5); m <= minute; m++) {
      const at = new Date(m * 60000);
      for (const job of cronJobs) if (cronMatches(job.spec, at)) runCron(job);
    }
    lastMinute = minute;
    cronTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 250);
  };
  cronTimer = setTimeout(tick, 60000 - (Date.now() % 60000) + 250);
}

// ---------------------------------------------------------------------------------------------
// Start and stop
// ---------------------------------------------------------------------------------------------
function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, finishing open requests`);
  clearTimeout(cronTimer);
  server.close(() => { log('stopped'); process.exit(code); });
  server.closeIdleConnections();
  setTimeout(() => { logError('open requests did not finish in 10s, exiting'); process.exit(code || 1); }, 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', reason => logError('unhandled rejection:', reason?.stack || reason));
process.on('uncaughtException', err => { logError('uncaught exception:', err?.stack || err); shutdown('uncaughtException', 1); });

server.on('error', err => { logError('server error:', err.message); process.exit(1); });
server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`);
  log(`static: ${staticFiles.size ? new Set([...staticFiles.values()]).size + ' files from dist/' : 'dist/ is missing or empty, run "npm run build"'}`);
  log(`functions: ${[...staticRoutes.values(), ...dynamicRoutes].map(f => `${f.route} (${f.maxDuration}s)`).join(', ') || 'none'}`);
  log(`rewrites: ${rewrites.map(r => r.source).join(', ') || 'none'}${redirects.length ? `; redirects: ${redirects.map(r => r.source).join(', ')}` : ''}`);
  startCron();
});
