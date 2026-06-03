#!/usr/bin/env node
/**
 * lint-unbounded-read.js — unbounded-read RATCHET (Phase 2 guardrail).
 *
 * Closes the D1.1 finding class. CLAUDE.md RULE: "No unbounded Firebase
 * listeners. All reads must use limitToLast(N) or .once('value')." An unbounded
 * MastDB.list(path) pulls an entire collection; an .onSnapshot() without a
 * bounded query streams every doc and every change. Both scale with tenant data
 * and cause billing/latency spikes — the bigger the tenant, the worse it gets.
 *
 * MastDB.list(path, opts) accepts opts.limit (see shared/mastdb.js) — a list
 * call carrying a `limit` is bounded; a single-arg list is not. .onSnapshot is
 * bounded only if the query it is attached to carries a limit.
 *
 * Mechanism (ratchet — mirrors scripts/lint-ux-standards.js): we BASELINE the
 * current per-file violation counts and FAIL any change that INCREASES them.
 * New files are born at 0. `--update` re-locks a lower baseline; numbers can
 * only go down. Target end state (Phase 4): baseline all-zero, then hard-zero.
 *
 * Scope: every .js / .html under app/.
 *
 * Metrics (heuristic, line-scoped):
 *   unboundedList  MastDB.list(...) with no `limit`     → pass { limit: N } / paginate
 *   onSnapshot     .onSnapshot(...) with no `limit`     → bound the query first
 *
 * NOTE: the heuristic is line-scoped, so a list call whose opts object spills
 * onto the next line will read as unbounded. Keep the `{ limit: N }` on the same
 * line as MastDB.list( to satisfy the gate (and for readability).
 *
 * Usage:
 *   node scripts/lint-unbounded-read.js           # check (CI/hook) — exit 1 on drift
 *   node scripts/lint-unbounded-read.js --update  # re-baseline (only lowers)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const BASELINE = path.join(__dirname, 'unbounded-read-baseline.json');

const METRICS = {
  // MastDB.list(...) on a line that does not also mention a limit.
  unboundedList: line => /MastDB\s*\.\s*list\s*\(/.test(line) && !/\blimit\b/.test(line),
  // A realtime listener whose line carries no limit (the query it hangs off
  // should be bounded). limitToLast/limit on the same line counts as bounded.
  onSnapshot: line => /\.\s*onSnapshot\s*\(/.test(line) && !/\blimit\b/i.test(line),
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
  console.log((existed ? 'Re-baselined' : 'Baselined') + ' unbounded-read: ' +
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
  console.error('\n✗ unbounded-read DRIFT — these increase violations vs the baseline:\n');
  drifts.forEach(d => console.error('  ' + d.file + '  ' + d.metric + ': ' + d.was + ' → ' + d.now +
    '   (' + hint(d.metric) + ')'));
  console.error('\nFix: bound the read — MastDB.list(path, { limit: N }) / paginate, or limit the onSnapshot query.');
  process.exit(1);
}

console.log('✓ unbounded-read: no drift vs baseline (' + Object.keys(baseline).length + ' files tracked).');
process.exit(0);

function hint(m) {
  return {
    unboundedList: 'pass { limit: N } or paginate',
    onSnapshot: 'bound the query (limit) before subscribing',
  }[m];
}
