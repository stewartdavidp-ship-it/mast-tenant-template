#!/usr/bin/env node
/**
 * lint-syntax.js — parse-check every admin module JS file.
 *
 * The other lint scripts check specific patterns (cache-bust, tokens, RBAC, …)
 * but NONE of them actually parse the module JS. A plain syntax error in an
 * `app/modules/*.js` file therefore sailed through every gate and only blew up
 * at runtime in the browser (the module fails to load and its route dead-ends).
 * That happened once (a dropped `)` in products-v2.js inventoryPane) and broke
 * the whole Products surface on dev. This guard makes that un-shippable.
 *
 * It runs Node's built-in syntax check (`vm.compileFunction`, same as
 * `node --check`) over every file in app/modules/ (recursively). The modules are
 * plain browser IIFEs — valid script syntax — so Node parses them fine; we only
 * check syntax, never execute. Fails the build (exit 1) on the first parse error.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'app', 'modules');

function walk(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full));
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

if (!fs.existsSync(MODULES_DIR)) {
  console.error('[lint-syntax] app/modules not found at ' + MODULES_DIR);
  process.exit(1);
}

const files = walk(MODULES_DIR);
let failures = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  try {
    // Parse-only: compileFunction throws on a syntax error without running code.
    vm.compileFunction(src, [], { filename: file });
  } catch (err) {
    failures++;
    console.error('[lint-syntax] SYNTAX ERROR in ' + path.relative(ROOT, file));
    console.error('  ' + (err && err.message ? err.message : String(err)));
  }
}

if (failures > 0) {
  console.error('\n[lint-syntax] ' + failures + ' module(s) failed to parse.');
  process.exit(1);
}
console.log('[lint-syntax] OK — ' + files.length + ' module files parse cleanly.');
