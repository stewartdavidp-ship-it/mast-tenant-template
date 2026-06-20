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
 *   C. UNRESOLVED REF — every module-load reference with a string-literal id in
 *                       app/index.html + app/modules/*.js resolves to a live
 *                       manifest id (or a SHELL_RESIDENT allowlist entry). This
 *                       covers the `loadModule('x')` primitive (incl.
 *                       `MastAdmin.loadModule('x')`) AND id-resolving WRAPPERS that
 *                       delegate to it — today `_ensureModule('x')` (composer.js),
 *                       which forwards to `MastAdmin.loadModule(id)`. Scanning the
 *                       wrapper too is the fix for PR #738: a V1 retirement left a
 *                       dead `_ensureModule('newsletter')` id that the
 *                       literal-`loadModule`-only scan was blind to.
 *                       (Delete orders.js but leave a loadModule('orders') → fail;
 *                        retire newsletter.js but leave _ensureModule('newsletter') → fail.)
 *
 * Line `//` comments are stripped before the ref scan so prose that merely mentions
 * a removed loadModule()/_ensureModule() call doesn't trip check C.
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

// ── C. unresolved module-load references ─────────────────────────────────────
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

// Call idioms whose FIRST string-literal arg is a MODULE ID resolved through the
// manifest (MastAdmin.loadModule → MODULE_MANIFEST lookup, "Unknown module"
// rejection if the id is dead). Each is scanned identically — every literal id
// must resolve to a live manifest entry (or SHELL_RESIDENT):
//
//   loadModule       — the primitive; the regex also matches the trailing
//                      `.loadModule(` of `MastAdmin.loadModule('x')`.
//   _ensureModule    — composer.js's load-if-not-loaded wrapper; it delegates to
//                      `MastAdmin.loadModule(id)` (see app/modules/composer.js),
//                      so its arg is a manifest id, not a route. PR #738 fixed a
//                      dead `_ensureModule('newsletter')` left by the #724
//                      retirement that the literal-`loadModule`-only scan could
//                      not see — that bug class is exactly what this list closes.
//
// DELIBERATELY EXCLUDED — their string-literal arg is NOT a module id, so scanning
// them would false-positive against the manifest:
//   withBridge('recordSale')     — consignment.js: a *Bridge METHOD name
//   _requireGalleryEdit('edit')  — consignment.js: a permission ACTION
//   loadModule(APP) / MastAdmin.loadModule(mod) — variable arg (not a literal); not
//                      statically resolvable and not matched by the regex anyway.
// Add a wrapper here ONLY if it resolves a manifest id from a string literal; a
// wrapper whose arg is a ROUTE or any non-id token must NOT be added.
const ID_LOAD_IDIOMS = ['loadModule', '_ensureModule'];
// Longest-first so an idiom that is a prefix of another can't shadow it; the left
// lookbehind rejects a partial-identifier match (e.g. `fooLoadModule(`) while still
// allowing the `.` of `MastAdmin.loadModule(`.
const ID_LOAD_RE = new RegExp(
  '(?<![A-Za-z0-9_$])(' +
    ID_LOAD_IDIOMS.slice().sort((a, b) => b.length - a.length).join('|') +
    ")\\(\\s*'([a-z0-9-]+)'\\s*\\)",
  'g'
);

const refSeen = {};   // id -> { file, idiom } of the first reference
for (const [file, src] of sources) {
  const clean = stripLineComments(src);
  let r;
  while ((r = ID_LOAD_RE.exec(clean))) {
    const idiom = r[1], id = r[2];
    if (!(id in refSeen)) refSeen[id] = { file, idiom };
  }
}
for (const [id, ref] of Object.entries(refSeen)) {
  if (!manifest[id] && !SHELL_RESIDENT.has(id)) {
    errors.push('UNRESOLVED REF ' + ref.idiom + '(\'' + id + '\') in ' + ref.file +
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
  Object.keys(refSeen).length + ' module-load refs resolve (' + ID_LOAD_IDIOMS.join('/') + ').');
process.exit(0);
