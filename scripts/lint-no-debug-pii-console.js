#!/usr/bin/env node
/**
 * lint-no-debug-pii-console.js — debug/PII console RATCHET (Phase 2 guardrail).
 *
 * Closes the D2-002 finding class: `[DEBUG]`-prefixed console statements and
 * console statements that log user PII (`.email` / `.uid`) shipped to the admin
 * bundle. Debug spew is noise; PII in the browser console is a data-exposure
 * leak (anyone with devtools open, or a screen-share, sees customer emails/uids).
 *
 * Mechanism (ratchet — mirrors scripts/lint-ux-standards.js): we BASELINE the
 * current per-file violation counts and FAIL any change that INCREASES them.
 * New files are born at 0. As a file is cleaned up, its counts drop and
 * `--update` re-locks the lower baseline — numbers can only go down. Target end
 * state (Phase 4): baseline all-zero, then flip to hard-zero.
 *
 * Scope: every .js / .html under app/.
 *
 * Metrics:
 *   debugConsole  console.<m>(... '[DEBUG]' ...)   → remove before merge
 *   piiConsole    console.<m>(... x.email|x.uid)   → never log PII to the console
 *
 * Usage:
 *   node scripts/lint-no-debug-pii-console.js           # check (CI/hook) — exit 1 on drift
 *   node scripts/lint-no-debug-pii-console.js --update  # re-baseline (only lowers; never raises silently)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const BASELINE = path.join(__dirname, 'no-debug-pii-console-baseline.json');

// console.<method>( ... ) opening — used as the anchor for both metrics.
const CONSOLE_CALL = /console\s*\.\s*(?:log|warn|error|info|debug|trace|dir|table|group|groupCollapsed)\s*\(/;
const METRICS = {
  // A console call whose arguments include a literal [DEBUG] marker.
  debugConsole: line => CONSOLE_CALL.test(line) && /\[DEBUG\]/.test(line),
  // A console call whose arguments reference a .email or .uid property.
  piiConsole: line => CONSOLE_CALL.test(line) && /\.(email|uid)\b/.test(line),
};

function listAppFiles() {
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (/\.(js|html)$/.test(entry.name)) out.push(full);
    }
  })(APP_DIR);
  return out.sort();
}

function countFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const out = {};
  for (const line of lines) {
    for (const [metric, test] of Object.entries(METRICS)) {
      if (test(line)) out[metric] = (out[metric] || 0) + 1;
    }
  }
  return out;
}

function scan() {
  const result = {};
  if (!fs.existsSync(APP_DIR)) return result;
  for (const file of listAppFiles()) {
    const counts = countFile(file);
    if (Object.keys(counts).length) result[path.relative(ROOT, file)] = counts;
  }
  return result;
}

const current = scan();

if (process.argv.includes('--update') || !fs.existsSync(BASELINE)) {
  const existed = fs.existsSync(BASELINE);
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
  console.log((existed ? 'Re-baselined' : 'Baselined') + ' debug/PII console: ' +
    Object.keys(current).length + ' files, ' + total + ' tracked violations.');
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const drifts = [];
const improvements = [];

for (const [file, counts] of Object.entries(current)) {
  const base = baseline[file] || {};            // unknown file ⇒ must be 0
  for (const metric of Object.keys(METRICS)) {
    const now = counts[metric] || 0;
    const was = base[metric] || 0;
    if (now > was) drifts.push({ file, metric, was, now });
    else if (now < was) improvements.push({ file, metric, was, now });
  }
}

if (improvements.length) {
  console.log('✓ improvements (run --update to lock in the lower baseline):');
  improvements.forEach(i => console.log('  ' + i.file + '  ' + i.metric + ': ' + i.was + ' → ' + i.now));
}

if (drifts.length) {
  console.error('\n✗ debug/PII console DRIFT — these increase violations vs the baseline:\n');
  drifts.forEach(d => console.error('  ' + d.file + '  ' + d.metric + ': ' + d.was + ' → ' + d.now +
    '   (' + hint(d.metric) + ')'));
  console.error('\nFix: remove [DEBUG] console statements before merge; never log .email/.uid to the console.');
  process.exit(1);
}

console.log('✓ debug/PII console: no drift vs baseline (' + Object.keys(baseline).length + ' files tracked).');
process.exit(0);

function hint(m) {
  return {
    debugConsole: 'remove the [DEBUG] console statement',
    piiConsole: 'do not log .email/.uid to the console',
  }[m];
}
