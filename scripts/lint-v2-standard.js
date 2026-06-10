#!/usr/bin/env node
/**
 * lint-v2-standard.js — born-0 ratchet for the V2 surface standard
 * (v2-conversion-playbook.md §6; the drift this catches was fixed by hand in
 * PR #378 and will re-accumulate without a gate).
 *
 * Rules, per app/modules/*-v2.js (workflow specs in modules/workflows are exempt):
 *   handRolledHeader  — '<h1 ' markup in a module ⇒ use MastUI.pageHeader
 *   missingFlagGate   — no 'mastUiRedesign' reference ⇒ surface isn't flag-gated
 *   notInManifest     — module file not referenced in index.html MODULE_MANIFEST
 *
 * Ratchet semantics mirror lint-ux-standards.js: existing violations are frozen
 * in v2-standard-baseline.json (counts can only go DOWN); files absent from the
 * baseline must be clean (new modules are born compliant).
 *
 *   node scripts/lint-v2-standard.js            # check
 *   node scripts/lint-v2-standard.js --update   # re-lock a LOWER baseline
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MODULES_DIR = path.join(ROOT, 'app', 'modules');
const INDEX = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const BASELINE = path.join(__dirname, 'v2-standard-baseline.json');

function violationsFor(file, src) {
  const v = {};
  const h1 = (src.match(/<h1[\s>]/g) || []).length;
  if (h1) v.handRolledHeader = h1;
  if (!/mastUiRedesign/.test(src)) v.missingFlagGate = 1;
  if (INDEX.indexOf('modules/' + file) === -1) v.notInManifest = 1;
  return v;
}

const files = fs.readdirSync(MODULES_DIR)
  .filter((f) => f.endsWith('-v2.js'))
  .sort();

const current = {};
for (const f of files) {
  const src = fs.readFileSync(path.join(MODULES_DIR, f), 'utf8');
  const v = violationsFor(f, src);
  if (Object.keys(v).length) current[f] = v;
}

if (process.argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  console.log('Baselined v2-standard: ' + Object.keys(current).length + ' file(s) with frozen violations.');
  process.exit(0);
}

const baseline = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
const problems = [];
const improvements = [];
for (const [f, v] of Object.entries(current)) {
  const base = baseline[f] || {};   // unknown file ⇒ must be 0
  for (const [rule, n] of Object.entries(v)) {
    const allowed = base[rule] || 0;
    if (n > allowed) {
      problems.push(`${f}: ${rule} ${n} > baseline ${allowed}` +
        (rule === 'handRolledHeader' ? ' — use MastUI.pageHeader'
          : rule === 'missingFlagGate' ? ' — gate on mastUiRedesign / ?ui=1'
          : ' — register in MODULE_MANIFEST (scripts/scaffold-v2-module.mjs wires this)'));
    } else if (n < allowed) {
      improvements.push(`${f}: ${rule} ${n} < baseline ${allowed}`);
    }
  }
}
// Baselined files that are now fully clean
for (const f of Object.keys(baseline)) {
  if (!current[f]) improvements.push(`${f}: now clean (run --update to lock in)`);
}

if (problems.length) {
  console.error('v2-standard lint: ' + problems.length + ' violation(s):');
  problems.forEach((p) => console.error('  ' + p));
  process.exit(1);
}
if (improvements.length) {
  console.log('✓ v2-standard: no drift (' + files.length + ' modules). Improvements available:');
  improvements.forEach((p) => console.log('  ' + p));
} else {
  console.log('✓ v2-standard: no drift (' + files.length + ' modules tracked).');
}
