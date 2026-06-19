#!/usr/bin/env node
// Pins the per-file cache-bust contract:
//   1. Every MODULE_MANIFEST entry whose file exists carries `v` = sha256(file)[:12].
//   2. Each lockstep shared <head> tag's ?v= = sha256(file)[:12].
//   3. The loader reads `manifest.v || MAST_MODULES_V` (per-file with global fallback).
//   4. `gen-cache-bust.mjs --check` passes on the committed tree.
// Run by the required `lint` job. Fails loudly if a module changed without restamping.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createHash } = require('crypto');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const APP_DIR = path.join(REPO_ROOT, 'app');
const INDEX = path.join(APP_DIR, 'index.html');
const HASH_LEN = 12;

const LOCKSTEP_SHARED = new Set([
  'mastdb', 'mast-ui', 'mast-io', 'mast-entity', 'mast-intake',
  'customer-filters', 'variant-reconcile', 'product-readiness.core', 'brand-sync',
]);

function hashFile(abs) {
  return createHash('sha256').update(fs.readFileSync(abs)).digest('hex').slice(0, HASH_LEN);
}

const html = fs.readFileSync(INDEX, 'utf8');

// --- 1. loader uses the fallback expression -------------------------------
assert.ok(
  /manifest\.src \+ '\?v=' \+ \(manifest\.v \|\| MAST_MODULES_V\)/.test(html),
  'loader must read `manifest.v || MAST_MODULES_V`',
);

// --- 2. extract MODULE_MANIFEST and verify each present file's hash --------
const start = html.indexOf('var MODULE_MANIFEST = {');
assert.ok(start !== -1, 'MODULE_MANIFEST not found');
const open = html.indexOf('{', start);
let depth = 0, end = -1;
for (let i = open; i < html.length; i++) {
  if (html[i] === '{') depth++;
  else if (html[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
}
const manifest = new Function('return (' + html.slice(open, end + 1) + ')')();

let checkedEntries = 0;
for (const [id, entry] of Object.entries(manifest)) {
  const abs = path.join(APP_DIR, entry.src);
  if (!fs.existsSync(abs)) continue; // dangling stub → global fallback, skip
  assert.ok(entry.v, `manifest entry '${id}' is missing its content hash 'v'`);
  assert.strictEqual(
    entry.v, hashFile(abs),
    `manifest entry '${id}' (${entry.src}) hash is stale — run scripts/gen-cache-bust.mjs`,
  );
  checkedEntries++;
}
assert.ok(checkedEntries > 50, `expected >50 hashed module entries, got ${checkedEntries}`);

// --- 3. lockstep shared tags carry the content hash -----------------------
const tagRe = /\.\.\/shared\/([a-z0-9.\-]+)\.js\?v=([^"']+)/gi;
let m, checkedTags = 0;
while ((m = tagRe.exec(html))) {
  const name = m[1];
  if (!LOCKSTEP_SHARED.has(name)) continue;
  const abs = path.join(REPO_ROOT, 'shared', name + '.js');
  assert.ok(fs.existsSync(abs), `lockstep shared file missing: ${name}.js`);
  assert.strictEqual(
    m[2], hashFile(abs),
    `shared tag '${name}.js' ?v= is stale — run scripts/gen-cache-bust.mjs`,
  );
  checkedTags++;
}
assert.ok(checkedTags >= 5, `expected >=5 hashed shared tags, got ${checkedTags}`);

// --- 4. the generator's own --check agrees --------------------------------
execFileSync('node', [path.join(REPO_ROOT, 'scripts', 'gen-cache-bust.mjs'), '--check'], {
  stdio: 'pipe',
});

console.log(`✓ cache-bust.test: ${checkedEntries} module entries + ${checkedTags} shared tags hashed & current.`);
