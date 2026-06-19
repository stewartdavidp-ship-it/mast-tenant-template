#!/usr/bin/env node
/**
 * lint-manifest-integrity.js — module-manifest / route integrity gate (Track 0).
 *
 * A cheap, deterministic safety net for the decomposition work (decomposition-
 * master-plan.md Track 0 / §3 / §8). The extraction (Track 1) and V1-retirement
 * (Track 6) tracks add and DELETE modules + manifest rows; the failure mode is a
 * broken edge that only shows up at runtime as an "Unknown module" rejection or a
 * route that renders nothing. This lint catches those statically, on every PR,
 * with no browser and no network — so a module can't be deleted while something
 * still points at it, and a manifest row can't dangle.
 *
 * Checks (all hard-fail; the tree is clean today, so new breakage fails the gate):
 *   A. DANGLING SRC   — every MODULE_MANIFEST `src: 'modules/x.js'` file exists on
 *                       disk. (Delete a module file but leave its row → fail.)
 *   B. DUPLICATE ROUTE— no two manifest entries declare the same route string.
 *                       (Two surfaces fighting for one route → fail.)
 *   C. UNRESOLVED REF — every `loadModule('x')` / `MastAdmin.loadModule('x')` string
 *                       literal in app/index.html + app/modules/*.js resolves to a
 *                       live manifest id (or a SHELL_RESIDENT allowlist entry).
 *                       (Delete orders.js but leave a loadModule('orders') → fail.)
 *
 * Line `//` comments are stripped before the ref scan so prose that merely mentions
 * a removed loadModule() call doesn't trip check C.
 *
 * Informational (does NOT fail): module files on disk that no manifest row
 * references (possible orphans) — printed as a heads-up for the retirement track.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');
const INDEX = path.join(APP, 'index.html');
const MOD_DIR = path.join(APP, 'modules');

// Pseudo-modules whose code is resident in the eager shell (a ROUTE_MAP route, not
// a lazy MODULE_MANIFEST entry), so a bare loadModule('id') for them is intentionally
// invalid and avoided in-tree. Empty today; add an id here (with a why) only if the
// shell ever legitimately exposes one through loadModule.
const SHELL_RESIDENT = new Set([]);

function fail(msgs) {
  console.error('\n✗ manifest integrity:\n');
  msgs.forEach(m => console.error('  ' + m));
  console.error('\nFix the manifest / loadModule reference before merging.');
  process.exit(1);
}

const idx = fs.readFileSync(INDEX, 'utf8');

// ── Parse MODULE_MANIFEST: `id: { src: 'modules/x.js', v: '…', routes: [ … ] }` ──
// Tolerant to quoting on the id and to the v: field being present or absent.
const ENTRY_RE = /(?:^|[\s,{])([A-Za-z0-9_'"-]+)\s*:\s*\{\s*src:\s*'(modules\/[^']+\.js)'[^}]*?routes:\s*\[([^\]]*)\]/g;
const manifest = {};      // id -> { src, routes[] }
let m;
while ((m = ENTRY_RE.exec(idx))) {
  const id = m[1].replace(/['"]/g, '');
  const routes = (m[3].match(/'[^']+'/g) || []).map(s => s.replace(/'/g, ''));
  manifest[id] = { src: m[2], routes };
}

const errors = [];

// ── A. dangling src ──────────────────────────────────────────────────────────
for (const [id, e] of Object.entries(manifest)) {
  if (!fs.existsSync(path.join(APP, e.src))) {
    errors.push('DANGLING SRC   manifest "' + id + '" → ' + e.src + ' (file missing on disk)');
  }
}

// ── B. duplicate routes ──────────────────────────────────────────────────────
const routeOwner = {};
for (const [id, e] of Object.entries(manifest)) {
  for (const r of e.routes) {
    if (routeOwner[r]) {
      errors.push('DUPLICATE ROUTE "' + r + '" claimed by both "' + routeOwner[r] + '" and "' + id + '"');
    } else {
      routeOwner[r] = id;
    }
  }
}

// ── C. unresolved loadModule references ──────────────────────────────────────
function stripLineComments(src) {
  return src.split('\n').map(line => {
    const i = line.indexOf('//');
    return i === -1 ? line : line.slice(0, i);
  }).join('\n');
}
const sources = [['app/index.html', idx]];
for (const f of fs.readdirSync(MOD_DIR)) {
  if (f.endsWith('.js')) sources.push(['app/modules/' + f, fs.readFileSync(path.join(MOD_DIR, f), 'utf8')]);
}
const LM_RE = /loadModule\(\s*'([a-z0-9-]+)'\s*\)/g;
const refSeen = {};   // id -> first "file" that references it
for (const [file, src] of sources) {
  const clean = stripLineComments(src);
  let r;
  while ((r = LM_RE.exec(clean))) {
    if (!(r[1] in refSeen)) refSeen[r[1]] = file;
  }
}
for (const [id, file] of Object.entries(refSeen)) {
  if (!manifest[id] && !SHELL_RESIDENT.has(id)) {
    errors.push('UNRESOLVED REF loadModule(\'' + id + '\') in ' + file +
      ' — no MODULE_MANIFEST entry (delete a module but leave a ref? add to SHELL_RESIDENT if intentional)');
  }
}

if (errors.length) fail(errors);

// ── informational: orphan module files (never failing) ───────────────────────
const referenced = new Set(Object.values(manifest).map(e => e.src.replace(/^modules\//, '')));
const orphans = fs.readdirSync(MOD_DIR)
  .filter(f => f.endsWith('.js') && !f.endsWith('.workflow.js') && f !== 'workflow-engine.js')
  .filter(f => !referenced.has(f));
if (orphans.length) {
  console.log('ℹ manifest integrity: ' + orphans.length + ' module file(s) not referenced by any manifest row (possible orphans):');
  orphans.forEach(f => console.log('    app/modules/' + f));
}

console.log('✓ manifest integrity: ' + Object.keys(manifest).length + ' entries, ' +
  Object.keys(routeOwner).length + ' routes, all src present, no dup routes, all ' +
  Object.keys(refSeen).length + ' loadModule refs resolve.');
process.exit(0);
