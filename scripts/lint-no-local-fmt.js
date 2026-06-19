#!/usr/bin/env node
/**
 * lint-no-local-fmt.js — local money/date FORMATTING RATCHET (Track 5).
 *
 * Track 5 (decomposition-master-plan.md §7) centralizes money + date formatting
 * onto the small, golden-tested cores loaded eagerly in the head:
 *   window.MastFormat — money({cents})/moneyRaw/moneyVal/lineTotalVal/date/
 *                       dateRaw/coerceDate  (shared/mast-format.js)
 *   window.MastExport — toCsv()/download()                (shared/mast-export.js)
 * The point is to kill two recurring bug classes structurally: the cents-vs-
 * dollars "$1,020 line renders as $102,000" miscount, and the Firestore-Timestamp
 * "createdAt is an object → blank/Invalid Date" silent failure.
 *
 * Mechanism (ratchet — same shape as lint-ux-standards.js): we can't repoint
 * every module overnight, so we BASELINE the current per-file count of hand-rolled
 * formatting patterns and FAIL any change that INCREASES them. New files are born
 * at 0, so new module code MUST use MastFormat. As a module is repointed onto the
 * cores its counts drop and `--update` re-locks the lower baseline — the numbers
 * can only ever go down. Target end state: baseline all-zero, then hard-zero.
 *
 * Scope: app/modules/*.js. The shell index.html and the shared/ cores are excluded
 * — the cores legitimately OWN the cents math + locale formatting, and the shell is
 * tracked by its own size ratchet. This lint is about module code adopting them.
 *
 * Metrics (the constructs the cores replace; high-signal, baseline absorbs the rest):
 *   centsDiv     `/ 100`  — cents→dollars division  → MastFormat.money(x,{cents:true})
 *   moneyToFixed `.toFixed(2)` — money string-building → MastFormat.money/moneyRaw
 *   localeDate   `.toLocaleDateString(`/`.toLocaleString(` — hand-rolled date/time
 *                display (Timestamp-unsafe)         → MastFormat.date / fmtDateTime
 *
 * Usage:
 *   node scripts/lint-no-local-fmt.js            # check (CI/pre-commit) — exit 1 on drift
 *   node scripts/lint-no-local-fmt.js --update   # re-baseline (only lowers; never raises silently)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOD_DIR = path.join(ROOT, 'app', 'modules');
const BASELINE = path.join(__dirname, 'no-local-fmt-baseline.json');

const METRICS = {
  // cents→dollars division: `/ 100`, `/100` (word-boundary after 100 so /1000 etc. don't match)
  centsDiv: /\/\s*100\b/g,
  // money string-building to 2 decimals
  moneyToFixed: /\.toFixed\(2\)/g,
  // hand-rolled, Timestamp-unsafe date/time display
  localeDate: /\.toLocale(?:Date|Time)?String\(/g,
};

function countFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = {};
  for (const [k, re] of Object.entries(METRICS)) {
    const m = src.match(re);
    if (m && m.length) out[k] = m.length;
  }
  return out;
}

function scan() {
  const result = {};
  if (!fs.existsSync(MOD_DIR)) return result;
  for (const f of fs.readdirSync(MOD_DIR)) {
    if (!f.endsWith('.js')) continue;
    if (f.endsWith('.workflow.js') || f === 'workflow-engine.js') continue; // engine code
    const counts = countFile(path.join(MOD_DIR, f));
    if (Object.keys(counts).length) result['app/modules/' + f] = counts;
  }
  return result;
}

const current = scan();
const isUpdate = process.argv.includes('--update');

if (isUpdate || !fs.existsSync(BASELINE)) {
  const existed = fs.existsSync(BASELINE);
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
  console.log((existed ? 'Re-baselined' : 'Baselined') + ' local-fmt: ' +
    Object.keys(current).length + ' files, ' + total + ' tracked patterns.');
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
  console.error('\n✗ local-fmt DRIFT — these add hand-rolled formatting vs the baseline:\n');
  drifts.forEach(d => console.error('  ' + d.file + '  ' + d.metric + ': ' + d.was + ' → ' + d.now +
    '   (' + hint(d.metric) + ')'));
  console.error('\nFix: use the centralized cores — window.MastFormat (money/date) and ' +
    'window.MastExport (CSV). New code must be clean.');
  process.exit(1);
}

console.log('✓ local-fmt: no drift vs baseline (' + Object.keys(baseline).length + ' files tracked).');
process.exit(0);

function hint(m) {
  return {
    centsDiv: 'use MastFormat.money(x,{cents:true}) / moneyVal',
    moneyToFixed: 'use MastFormat.money / moneyRaw',
    localeDate: 'use MastFormat.date / dateRaw (Timestamp-safe)',
  }[m];
}
