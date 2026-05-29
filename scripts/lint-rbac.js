#!/usr/bin/env node
// RBAC coverage guard (E6 module-anchored model). Run from repo root:
//   node scripts/lint-rbac.js
// Exits 0 if clean, 1 if violations found.
//
// Catches the two ways the unified permission model can silently drift as
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
  'suppressions', // audit-suppressions admin sub-surface
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

// ---- Report ----
console.log('RBAC coverage guard — ' + (1 + moduleFiles.length) + ' files scanned');
console.log('  CRUD hasPermission() regressions (blocking): ' + crudCalls);
console.log('  Ungated sidebar routes (blocking):           ' + ungatedCount);
if (violations.length) {
  console.log('');
  violations.forEach(v => console.log('  ' + v));
}
process.exit(violations.length ? 1 : 0);
