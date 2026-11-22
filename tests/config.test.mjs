// Checks that the routing configuration points at files that exist. No network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));

// "/api/a/b?x=1" -> "api/a/b.js" (or api/a/b/index.js)
const apiFile = destination => {
  const route = destination.split('?')[0].replace(/^\//, '');
  return [route + '.js', route + '/index.js'].find(f => existsSync(path.join(root, f)));
};

test('every rewrite to /api points at a function file', () => {
  for (const { source, destination } of config.rewrites || []) {
    if (!destination.startsWith('/api/')) continue;
    assert.ok(apiFile(destination), `${source} -> ${destination} has no file under api/`);
  }
});

test('rewrite sources are unique and start with a slash', () => {
  const seen = new Set();
  for (const { source } of config.rewrites || []) {
    assert.ok(source.startsWith('/'), `${source} must start with /`);
    assert.ok(!seen.has(source), `${source} is listed twice`);
    seen.add(source);
  }
});

test('every cron path and every functions entry exists', () => {
  for (const { path: cronPath, schedule } of config.crons || []) {
    assert.ok(apiFile(cronPath), `cron ${cronPath} has no file under api/`);
    assert.equal(String(schedule).trim().split(/\s+/).length, 5, `cron ${cronPath} needs a five-field schedule`);
  }
  for (const file of Object.keys(config.functions || {})) {
    if (!/[*?]/.test(file)) assert.ok(existsSync(path.join(root, file)), `functions entry ${file} does not exist`);
  }
});

test('library files under api/ are not routes', () => {
  for (const { destination } of config.rewrites || []) {
    assert.ok(!/\/_/.test(destination.split('?')[0]), `${destination} points into a private folder`);
  }
});
