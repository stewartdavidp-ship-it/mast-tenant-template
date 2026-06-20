#!/usr/bin/env node
// RBAC coverage guard (E6 module-anchored model). Run from repo root:
//   node scripts/lint-rbac.js
// Exits 0 if clean, 1 if violations found.
//
// Catches the three ways the unified permission model can silently drift as
// features are added (see MEMORY: "RBAC unified into one module-anchored model"):
//
//   CHECK A — no CRUD hasPermission() (BLOCKING)
//     The per-entity CRUD layer was removed in E6. Module access is gated by
//     can(route, axis); hasPermission() now serves ONLY the sensitive actions
//     in FUNCTION_PERMISSIONS (non-CRUD verbs). Any hasPermission('x','create'|
//     'read'|'update'|'delete') is therefore a regression — it would silently
//     no-op (the entity is never granted) and leave an action ungated.
//
//   CHECK B — every sidebar route is in SECTION_ROUTES (BLOCKING)
//     The permission matrix + sidebar filter + route gate are all derived from
//     SECTION_ROUTES. A sidebar item (data-route) that is NOT in SECTION_ROUTES
//     is invisible to the permission model → ungated → visible to every role.
//     New modules MUST be added to SECTION_ROUTES. Intentionally-unpermissioned
//     surfaces are listed in UNGATED_ALLOWLIST below (adding one is a conscious
//     acknowledgement, not an escape hatch).
//
//   CHECK C — routable write-modules must be RBAC action-gated (RATCHET)
//     CHECK A/B gate the permission *matrix* and the *route* surfaces, but
//     neither looks at whether a module's write/delete *handlers* are gated. A
//     module can own a route (be listed in MODULE_MANIFEST with a non-empty
//     routes:[]), perform MastDB write verbs (set|update|remove|push|newKey),
//     and reference can()/hasPermission() ZERO times — i.e. ship DB-mutating
//     actions with no RBAC action gate. That gap let production / students /
//     studio / trips / website / show-light (and ~30 more — far past the 6 the
//     first audit named) ship ungated writes while A and B stayed green. The
//     gated convention lives in shows.js: a render-gate (the Delete button is
//     emitted only inside can('show-prep','delete') ~L450) plus a handler-gate
//     (archiveShow() checks can('show-prep','delete') before MastDB.shows.remove
//     ~L1964). orders.js / sales.js / cart.js gate via hasPermission() instead.
//
//     This signal is COARSE (module-level, not per-handler) and is enforced as
//     a RATCHET, mirroring scripts/lint-ux-standards.js: every module ungated
//     TODAY is frozen in MODULE_GATE_BASELINE and only WARNS, so CI and the
//     PostToolUse hook stay green. A NEW ungated write-module — one NOT in the
//     baseline — is a BLOCKING violation, so the gap cannot reopen. As each
//     baselined module gains real gates the lint prints a "stale baseline"
//     nudge; drop it from the set. When the set is empty the warning becomes a
//     hard failure for everyone (the end-state hard gate).
//
// Scope: app/index.html + app/modules/*.js

const fs = require('fs');
const path = require('path');

const CRUD_ACTIONS = new Set(['create', 'read', 'update', 'delete']);

// Sidebar routes that intentionally have NO per-module permission entry.
// These are app-shell / cross-cutting surfaces, not gateable feature modules.
// Add here ONLY with intent — every entry is a route the permission model does
// not gate (so it is visible to all roles that can reach the admin at all).
const UNGATED_ALLOWLIST = new Set([
  'add-to-mast',  // module marketplace / "Add to Mast" page (not a feature module)
  'ask-ai',       // global AskAI surface
  'audit',        // audit viewer sub-route (the gateable 'auditlog' module is in SECTION_ROUTES)
  'coins',        // token/credits balance surface
  'mapping',      // channel product↔listing mapping re-entry surface (sub-surface of Channels)
  'suppressions', // audit-suppressions admin sub-surface
]);

// CHECK C ratchet baseline. Modules that own a route AND perform MastDB writes
// AND ship ZERO can()/hasPermission() action gates — captured as of origin/main
// so they only WARN. This is acknowledged RBAC debt, NOT a permanent allowlist:
// it shrinks toward empty. When you add real gates to one of these, the lint
// prints a "stale baseline" nudge — delete it from this set then. A new ungated
// write-module that is NOT listed here FAILS the build (see CHECK C above).
const MODULE_GATE_BASELINE = new Set([
  // The canonical 6 the original RBAC-gap audit named:
  'production.js', 'students.js', 'studio.js', 'trips.js', 'website.js', 'show-light.js',
  // website-import.js: AI catalog-import wizard relocated VERBATIM out of website.js
  // (T6 PR2). It inherits website.js's ungated posture (no fix-in-place during a
  // verbatim move); gating the import write/delete handlers is a follow-up.
  'website-import.js',
  // Other legacy feature modules with the same gap (routed, write, 0 gates):
  'audit-feedback.js', 'audit.js', 'blog.js', 'book.js', 'brand.js', 'campaigns.js',
  'channels.js', 'commission-terms.js', 'composer.js', 'contacts.js',
  'customer-service.js', 'engagement-inbox.js', 'events.js', 'fulfillment.js',
  'homepage.js', 'lookbooks.js', 'maker.js', 'mapping.js', 'newsletter.js',
  'procurement.js', 'promotions.js', 'social.js', 'wholesale.js',
  // UI-redesign (?ui=1) proof modules — flag-gated; gate or retire as they graduate:
  // orders-v2.js graduated: native detail actions (triage/cancel/note/email) are
  // can('orders','edit')-gated (PR2; writes delegate to OrdersBridge).
  'customers-v2.js', 'cs-tickets-v2.js', 'duplicates-v2.js',
  // finance-expenses-v2.js graduated: bulk approve/mark-personal are can()-gated.
  'promotions-v2.js', 'wallet-v2.js',
]);

const html = fs.readFileSync('app/index.html', 'utf8');
const moduleFiles = fs.readdirSync('app/modules')
  .filter(f => f.endsWith('.js'))
  .map(f => path.join('app/modules', f));

const violations = [];

// ---- CHECK A: no CRUD hasPermission() across core + modules ----
const HASPERM_RE = /hasPermission\(\s*['"]([A-Za-z]+)['"]\s*,\s*['"]([A-Za-z]+)['"]\s*\)/g;
let crudCalls = 0;
['app/index.html', ...moduleFiles].forEach(file => {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    let m;
    HASPERM_RE.lastIndex = 0;
    while ((m = HASPERM_RE.exec(line)) !== null) {
      if (CRUD_ACTIONS.has(m[2])) {
        crudCalls++;
        violations.push(`CRUD-HASPERM  ${file}:${i + 1}  hasPermission('${m[1]}', '${m[2]}')  → use can('<route>', '${m[2] === 'read' ? 'view' : m[2] === 'delete' ? 'delete' : 'edit'}')`);
      }
    }
  });
});

// ---- CHECK B: every sidebar data-route is in SECTION_ROUTES (or allowlisted) ----
const sidebarRoutes = new Set([...html.matchAll(/data-route="([a-z0-9-]+)"/g)].map(m => m[1]));
const secBlock = html.match(/var SECTION_ROUTES = \{[\s\S]*?\n\};/);
let ungatedCount = 0;
if (!secBlock) {
  violations.push('REGISTRY  app/index.html  could not locate `var SECTION_ROUTES = {...}` block');
} else {
  const registry = new Set([...secBlock[0].matchAll(/'([a-z0-9-]+)'/g)].map(x => x[1]));
  [...sidebarRoutes].sort().forEach(route => {
    if (!registry.has(route) && !UNGATED_ALLOWLIST.has(route)) {
      ungatedCount++;
      violations.push(`UNGATED-ROUTE  data-route="${route}"  not in SECTION_ROUTES → add it (or to UNGATED_ALLOWLIST if intentionally unpermissioned)`);
    }
  });
}

// ---- CHECK C: routable write-modules must be RBAC action-gated (ratchet) ----
// Coarse, module-level: a module that owns a route (non-empty routes:[] in
// MODULE_MANIFEST) AND performs MastDB writes AND references can()/hasPermission()
// ZERO times has shipped ungated write actions. Baselined ones warn; a new one
// (not baselined) is blocking. MODULE_MANIFEST is the route oracle (not
// SECTION_ROUTES) so modules whose routes never made the matrix — e.g. show-light
// — are still covered.
const MODULE_WRITE_RE = /MastDB(?:\.[A-Za-z0-9_]+)*\.(?:set|update|remove|push|newKey)\(/;
const MODULE_GATE_RE = /\b(?:can|hasPermission)\(/;
const manBlock = html.match(/var MODULE_MANIFEST = \{[\s\S]*?\n\};/);
const moduleGateWarnings = [];
const staleBaseline = [];
let moduleGateNew = 0;
if (!manBlock) {
  violations.push('REGISTRY  app/index.html  could not locate `var MODULE_MANIFEST = {...}` block → CHECK C cannot run');
} else {
  const routedModules = new Set();
  // `[^}\n]*?` tolerates an optional `v: '<hash>'` (per-file cache-bust) between src and routes.
  for (const m of manBlock[0].matchAll(/src:\s*'modules\/([^']+)'[^}\n]*?routes:\s*\[([^\]]*)\]/g)) {
    if (/['"]/.test(m[2])) routedModules.add(path.basename(m[1])); // non-empty routes:[]
  }
  moduleFiles.forEach(file => {
    const base = path.basename(file);
    const baselined = MODULE_GATE_BASELINE.has(base);
    // Each early-out also self-heals the baseline: if a listed module no longer
    // fits the ungated-writer profile, flag it stale so the set can shrink.
    if (!routedModules.has(base)) { if (baselined) staleBaseline.push(base + ' — no longer owns a manifest route'); return; }
    const text = fs.readFileSync(file, 'utf8');
    if (!MODULE_WRITE_RE.test(text)) { if (baselined) staleBaseline.push(base + ' — no longer performs MastDB writes'); return; }
    if (MODULE_GATE_RE.test(text)) { if (baselined) staleBaseline.push(base + ' — now references can()/hasPermission()'); return; }
    if (baselined) {
      moduleGateWarnings.push(`MODULE-UNGATED(baseline)  ${file}  routed + MastDB writes, 0 can()/hasPermission() — RBAC retrofit pending`);
    } else {
      moduleGateNew++;
      violations.push(`MODULE-UNGATED  ${file}  is routed + performs MastDB writes (set|update|remove|push|newKey) but has 0 can()/hasPermission() gates → gate write/delete handlers with can('<route>','edit'|'delete') (see shows.js archiveShow ~L1964). If intentionally ungated, add '${base}' to MODULE_GATE_BASELINE.`);
    }
  });
}

// ---- Report ----
const verbose = process.argv.includes('--verbose');
console.log('RBAC coverage guard — ' + (1 + moduleFiles.length) + ' files scanned');
console.log('  CRUD hasPermission() regressions (blocking): ' + crudCalls);
console.log('  Ungated sidebar routes (blocking):           ' + ungatedCount);
console.log('  New ungated write-modules (blocking):        ' + moduleGateNew);
console.log('  Baselined ungated write-modules (warn):      ' + moduleGateWarnings.length);
if (violations.length) {
  console.log('');
  violations.forEach(v => console.log('  ' + v));
}
// Per-module CHECK C warnings are quiet by default (this lint also runs as a
// PostToolUse hook after every edit) — the count above is the always-on signal.
// Pass --verbose to dump the full list.
if (moduleGateWarnings.length && (verbose || violations.length)) {
  console.log('\n  CHECK C warnings (non-blocking RBAC action-gate debt' + (verbose ? '' : ' — re-run with --verbose to list') + '):');
  if (verbose) moduleGateWarnings.forEach(w => console.log('  ' + w));
}
if (staleBaseline.length) {
  console.log('\n  stale MODULE_GATE_BASELINE entries (now gated / unrouted / non-writing — remove from the set):');
  staleBaseline.forEach(s => console.log('  - ' + s));
}
process.exit(violations.length ? 1 : 0);
