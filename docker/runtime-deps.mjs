#!/usr/bin/env node
// Copies only the packages the server needs at runtime into a fresh node_modules.
//
// package.json lists the frontend build tools (vite, react, lucide, xlsx) as normal dependencies, so
// "npm ci --omit=dev" still installs all of them. This script reads the imports of server.mjs and every
// file under api/, follows each package's own dependencies, and copies just that set. A new import in
// api/ is picked up on the next build; nothing here names a package.
//
// Usage: node docker/runtime-deps.mjs <output node_modules dir>      (run from the project root)
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';

const root = process.cwd();
const outDir = path.resolve(process.argv[2] || 'runtime_node_modules');
const modulesDir = path.join(root, 'node_modules');
const builtins = new Set(builtinModules);

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(file, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(file);
  }
  return out;
}
const files = [path.join(root, 'server.mjs'), ...(fs.existsSync(path.join(root, 'api')) ? sourceFiles(path.join(root, 'api')) : [])].filter(f => fs.existsSync(f));

// Bare specifiers in "import ... from 'x'", "import 'x'", "import('x')", "export ... from 'x'" and "require('x')".
const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
const wanted = new Map();
for (const file of files) {
  for (const m of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
    const spec = m[2];
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('node:') || spec.startsWith('#') || /^[a-z]+:/i.test(spec)) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!builtins.has(name)) wanted.set(name, path.relative(root, file));
  }
}

// Node's lookup: the nearest node_modules/<name> walking up from the importing package.
function resolvePackage(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (dir === root || dir === path.dirname(dir)) return null;
  }
}

const keep = new Set();
const queue = [];
let missing = 0;
for (const [name, file] of wanted) {
  const dir = resolvePackage(name, root);
  if (!dir) { console.error(`runtime-deps: "${name}" (imported by ${file}) is not installed`); missing++; continue; }
  queue.push(dir);
}
while (queue.length) {
  const dir = queue.pop();
  if (keep.has(dir)) continue;
  keep.add(dir);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const optionalPeers = pkg.peerDependenciesMeta || {};
  const deps = [
    ...Object.keys(pkg.dependencies || {}).map(n => [n, true]),
    ...Object.keys(pkg.optionalDependencies || {}).map(n => [n, false]),
    ...Object.keys(pkg.peerDependencies || {}).filter(n => !optionalPeers[n]?.optional).map(n => [n, false]),
  ];
  for (const [name, required] of deps) {
    const dep = resolvePackage(name, dir);
    if (dep) queue.push(dep);
    else if (required) console.warn(`runtime-deps: ${pkg.name} depends on "${name}", which is not installed`);
  }
}
if (missing) process.exit(1);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
// Outermost first, and a package nested inside one that is already copied comes along with its parent.
const dirs = [...keep].sort();
const copied = [];
for (const dir of dirs) {
  if (copied.some(parent => dir.startsWith(parent + path.sep))) continue;
  fs.cpSync(dir, path.join(outDir, path.relative(modulesDir, dir)), { recursive: true, verbatimSymlinks: true });
  copied.push(dir);
}
console.log(`runtime-deps: ${[...wanted.keys()].sort().join(', ') || 'no packages'} -> ${keep.size} packages copied to ${outDir}`);
