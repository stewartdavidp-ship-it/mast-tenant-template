#!/usr/bin/env node
// Lint app/data/mode-module-info.js — validates every entry against the schema
// and cross-checks against BusinessEntityConstants.MODE_ROUTE_VISIBILITY.
//
// Exits 0 if clean, 1 if violations found.
// Wired as:
//   - PostToolUse hook on Edit/Write (see .claude/settings.json)
//   - CI step in .github/workflows/lint.yml
//
// Idea -OtEQoFvlPAu90ghkDXu (Enriched module cards).

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const DATA_FILE   = path.join(ROOT, 'app/data/mode-module-info.js');
const SCHEMA_FILE = path.join(ROOT, 'app/data/mode-module-info.schema.js');
const BEC_FILE    = path.join(ROOT, 'shared/business-entity-constants.js');

function readOrFail(file) {
  if (!fs.existsSync(file)) {
    console.error('lint-module-info: missing ' + file);
    process.exit(1);
  }
  return fs.readFileSync(file, 'utf8');
}

// Load schema (it ships as a UMD-style IIFE — `module.exports` is honored).
const schemaSrc = readOrFail(SCHEMA_FILE);
const schemaSandbox = { module: { exports: {} }, self: {}, window: undefined };
vm.createContext(schemaSandbox);
vm.runInContext(schemaSrc, schemaSandbox, { filename: 'mode-module-info.schema.js' });
const schema = schemaSandbox.module.exports;
if (!schema || typeof schema.validateModuleEntry !== 'function') {
  console.error('lint-module-info: schema did not export validateModuleEntry');
  process.exit(1);
}

// Load data file in a sandbox that mimics the browser globals it expects.
const dataSrc = readOrFail(DATA_FILE);
const dataSandbox = {
  console: console,
  window: {},
  module: { exports: {} },
  self: {}
};
vm.createContext(dataSandbox);
try {
  vm.runInContext(dataSrc, dataSandbox, { filename: 'mode-module-info.js' });
} catch (err) {
  console.error('lint-module-info: data file threw on load: ' + err.message);
  process.exit(1);
}

const MODE_MODULE_INFO   = dataSandbox.window.MODE_MODULE_INFO;
const MODE_SECTION_LABELS = dataSandbox.window.MODE_SECTION_LABELS;

if (!MODE_MODULE_INFO || typeof MODE_MODULE_INFO !== 'object') {
  console.error('lint-module-info: data file did not export window.MODE_MODULE_INFO');
  process.exit(1);
}
if (!MODE_SECTION_LABELS || typeof MODE_SECTION_LABELS !== 'object') {
  console.error('lint-module-info: data file did not export window.MODE_SECTION_LABELS');
  process.exit(1);
}

// Load BusinessEntityConstants for routeId cross-check.
const becSrc = readOrFail(BEC_FILE);
const becSandbox = { window: {}, self: {}, module: { exports: {} }, console: console };
vm.createContext(becSandbox);
try {
  vm.runInContext(becSrc, becSandbox, { filename: 'business-entity-constants.js' });
} catch (err) {
  console.error('lint-module-info: BEC failed to load (will skip pairsWith cross-check): ' + err.message);
}
const BEC = becSandbox.window.BusinessEntityConstants || becSandbox.BusinessEntityConstants;
const routeRegistry = BEC && BEC.MODE_ROUTE_VISIBILITY ? BEC.MODE_ROUTE_VISIBILITY : null;
if (!routeRegistry) {
  console.warn('lint-module-info: MODE_ROUTE_VISIBILITY not found — skipping route-existence checks');
}

// System-managed routes that intentionally have no MODE_MODULE_INFO entry.
// Must match the renderAddToMast skip-list in app/index.html.
const ALLOWED_MISSING = new Set([
  'add-to-mast',
  'migration', 'migration-confirm', 'migration-plan', 'migration-import',
  'historical-orders'
]);

let violations = [];
let enrichedCount = 0;
let stubCount = 0;

// 1. Validate each entry against schema.
for (const routeId of Object.keys(MODE_MODULE_INFO)) {
  const entry = MODE_MODULE_INFO[routeId];
  const result = schema.validateModuleEntry(routeId, entry, { routeRegistry: routeRegistry });
  if (!result.ok) {
    for (const err of result.errors) {
      violations.push(routeId + ': ' + err);
    }
  }
  if (result.enriched) enrichedCount++;
  else stubCount++;
}

// 2. Section keys in entries must exist in MODE_SECTION_LABELS.
for (const routeId of Object.keys(MODE_MODULE_INFO)) {
  const section = MODE_MODULE_INFO[routeId].section;
  if (section && !MODE_SECTION_LABELS[section]) {
    violations.push(routeId + ': section "' + section + '" not in MODE_SECTION_LABELS');
  }
}

// 3. Every routeId in MODE_ROUTE_VISIBILITY (minus system-managed allowlist)
//    must have an entry in MODE_MODULE_INFO.
if (routeRegistry) {
  for (const routeId of Object.keys(routeRegistry)) {
    const rule = routeRegistry[routeId] || {};
    if (rule.systemManaged) continue;
    if (ALLOWED_MISSING.has(routeId)) continue;
    if (!Object.prototype.hasOwnProperty.call(MODE_MODULE_INFO, routeId)) {
      violations.push('MISSING: route "' + routeId + '" is in MODE_ROUTE_VISIBILITY but has no MODE_MODULE_INFO entry');
    }
  }
}

// 4. No routeId in MODE_MODULE_INFO that doesn't exist in MODE_ROUTE_VISIBILITY.
if (routeRegistry) {
  for (const routeId of Object.keys(MODE_MODULE_INFO)) {
    if (!Object.prototype.hasOwnProperty.call(routeRegistry, routeId)) {
      violations.push('ORPHAN: "' + routeId + '" has a MODE_MODULE_INFO entry but is not in MODE_ROUTE_VISIBILITY');
    }
  }
}

// Report
const total = enrichedCount + stubCount;
if (violations.length === 0) {
  console.log('mode-module-info lint: OK (' + total + ' entries — ' + enrichedCount + ' enriched, ' + stubCount + ' stubs, schema v' + schema.SCHEMA_VERSION + ')');
  process.exit(0);
}

console.error('mode-module-info lint: ' + violations.length + ' violation(s):');
for (const v of violations) console.error('  ' + v);
console.error('  (' + total + ' entries — ' + enrichedCount + ' enriched, ' + stubCount + ' stubs)');
process.exit(1);
