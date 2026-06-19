#!/usr/bin/env node
// Per-file cache-bust generator.
//
// Stamps each lazy-loaded admin module and each lockstep shared <head> engine
// script with a content hash of its own bytes, so a deploy only invalidates the
// browser cache for files that actually changed — and two PRs that touch
// different modules edit different lines (no re-conflicting single version var).
//
// What it manages in app/index.html:
//   1. MODULE_MANIFEST entries — injects/updates `v: '<hash>'` next to each
//      `src: 'modules/<file>.js'`. The loader reads `manifest.v || MAST_MODULES_V`.
//   2. The lockstep shared <head> tags (`../shared/<name>.js?v=...`) — rewrites
//      each `?v=` to the file's content hash. (These can't read MAST_MODULES_V at
//      runtime, so they were historically kept in lockstep with the global; now
//      they're content-addressed individually.)
//
// What it does NOT touch:
//   - `var MAST_MODULES_V` — left as a defensive fallback for entries whose file
//     is missing (dangling stubs) or that otherwise lack a `v:`.
//   - Hand-pinned shared tags not in LOCKSTEP_SHARED (business-entity-constants,
//     customer-resolver, channel-connection) — those are versioned by hand.
//
// Modes:
//   (default) write — update app/index.html in place.
//   --check         — verify it's already up to date; exit 1 (and print drift)
//                     if any managed hash is stale. Wired into the required
//                     `lint` job; also the pre-commit hook runs the writer.
//
// Replaces the single-global bump (bump-modules-version.sh) for modules + shared
// engine tags as the cache-bust mechanism.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP_DIR = join(REPO_ROOT, 'app');
const INDEX_HTML = join(APP_DIR, 'index.html');

// Shared engine scripts kept content-addressed (the set the old bumper held in
// lockstep with the global). Keys are the basename without `.js`.
const LOCKSTEP_SHARED = new Set([
  'mastdb',
  'mast-ui',
  'mast-io',
  'mast-entity',
  'mast-intake',
  'mast-format',
  'mast-export',
  'lazy-cdn',
  'customer-filters',
  'variant-reconcile',
  'product-readiness.core',
  'brand-sync',
]);

const HASH_LEN = 12;

function hashFile(absPath) {
  return createHash('sha256')
    .update(readFileSync(absPath))
    .digest('hex')
    .slice(0, HASH_LEN);
}

// Rewrite one line of index.html if it is a managed module entry or shared tag.
// Returns { line, dangling? } — dangling names a manifest src whose file is
// absent (left on the global fallback).
function transformLine(line) {
  // 1. MODULE_MANIFEST entry: `... src: 'modules/<file>.js' ...`
  const srcMatch = line.match(/src:\s*'(modules\/[^']+\.js)'/);
  if (srcMatch) {
    const rel = srcMatch[1];
    const abs = join(APP_DIR, rel);
    if (!existsSync(abs)) {
      return { line, dangling: rel };
    }
    const h = hashFile(abs);
    // Drop any existing `, v: '...'` immediately after src, then re-insert, so
    // the field is idempotent regardless of prior state.
    let out = line.replace(
      /(src:\s*'modules\/[^']+\.js')\s*,\s*v:\s*'[^']*'/,
      '$1',
    );
    out = out.replace(
      /(src:\s*'modules\/[^']+\.js')/,
      `$1, v: '${h}'`,
    );
    return { line: out };
  }

  // 2. Lockstep shared <head> tag: `../shared/<name>.js?v=...`
  const sharedMatch = line.match(/\.\.\/shared\/([a-z0-9.\-]+)\.js\?v=[^"']*/i);
  if (sharedMatch && LOCKSTEP_SHARED.has(sharedMatch[1])) {
    const abs = join(REPO_ROOT, 'shared', sharedMatch[1] + '.js');
    if (!existsSync(abs)) {
      return { line, dangling: 'shared/' + sharedMatch[1] + '.js' };
    }
    const h = hashFile(abs);
    const out = line.replace(
      /(\.\.\/shared\/[a-z0-9.\-]+\.js)\?v=[^"']*/i,
      `$1?v=${h}`,
    );
    return { line: out };
  }

  return { line };
}

function computeUpdated(content) {
  const dangling = [];
  const updated = content
    .split('\n')
    .map((line) => {
      const r = transformLine(line);
      if (r.dangling) dangling.push(r.dangling);
      return r.line;
    })
    .join('\n');
  return { updated, dangling };
}

function main() {
  const check = process.argv.includes('--check');
  const current = readFileSync(INDEX_HTML, 'utf8');
  const { updated, dangling } = computeUpdated(current);

  if (dangling.length) {
    // Informational only — dangling manifest stubs (never-built v2 entries) have
    // no file to hash and fall back to MAST_MODULES_V. Track 6 deletes these.
    console.log(
      `cache-bust: ${dangling.length} manifest entr${dangling.length === 1 ? 'y' : 'ies'} ` +
        `point at a missing file (left on MAST_MODULES_V fallback): ${dangling.slice(0, 6).join(', ')}` +
        (dangling.length > 6 ? ', …' : ''),
    );
  }

  if (updated === current) {
    console.log('✓ cache-bust: all module + shared-engine hashes are current.');
    return 0;
  }

  if (check) {
    console.error('✗ cache-bust: per-file hashes are stale.');
    console.error('');
    // Show the first few drifting lines to make the fix obvious.
    const cur = current.split('\n');
    const upd = updated.split('\n');
    let shown = 0;
    for (let i = 0; i < cur.length && shown < 8; i++) {
      if (cur[i] !== upd[i]) {
        console.error(`  line ${i + 1}:`);
        console.error(`    have: ${cur[i].trim()}`);
        console.error(`    want: ${upd[i].trim()}`);
        shown++;
      }
    }
    console.error('');
    console.error('  Fix: run the generator and commit app/index.html:');
    console.error('      node scripts/gen-cache-bust.mjs');
    console.error('  (Or install the auto hook once: ./scripts/install-hooks.sh)');
    return 1;
  }

  writeFileSync(INDEX_HTML, updated);
  console.log('✓ cache-bust: stamped per-file hashes into app/index.html.');
  return 0;
}

process.exit(main());
