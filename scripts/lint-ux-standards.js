#!/usr/bin/env node
/**
 * lint-ux-standards.js — UX-standard conformance RATCHET.
 *
 * Enforces the redesign standards (docs/ux-audit/02–14) going forward so new
 * development cannot reintroduce the divergences the audit removed. This is the
 * "maintained standard" guard — not a one-time migration check.
 *
 * Mechanism (ratchet): we can't make 41 legacy modules clean overnight, so we
 * BASELINE the current per-file violation counts and FAIL any change that
 * INCREASES them. New files are born at 0. As a module is converted, its counts
 * drop and `--update` re-locks the lower baseline — so the numbers can only ever
 * go down. Target end state: baseline all-zero, then flip to hard-zero.
 *
 * Scope: app/modules/*.js (module code is what converts; the shell index.html and
 * shared/ engines legitimately own overlays/tokens and are excluded here).
 *
 * Metrics (high-signal, low-false-positive; see docs/ux-audit/01-signal-matrix.md):
 *   nativeDialogs  window.confirm/alert/prompt   → use mastConfirm/Alert/Prompt (02 §3)
 *   rogueOverlays  position:fixed                → use mastSlideOut/openModal (05/08)
 *   translateX     translateX                    → use the shared slide-out (05)
 *   hardcodedHex   #rgb / #rrggbb                → use var(--…) tokens, both-mode (02 §4/§4b)
 *
 * Usage:
 *   node scripts/lint-ux-standards.js            # check (CI/pre-commit) — exit 1 on drift
 *   node scripts/lint-ux-standards.js --update   # re-baseline (only lowers; never raises silently)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOD_DIR = path.join(ROOT, 'app', 'modules');
const BASELINE = path.join(__dirname, 'ux-standards-baseline.json');

const METRICS = {
  nativeDialogs: /\b(confirm|alert|prompt)\s*\(/g,   // mastConfirm/Alert/Prompt are capitalized → not matched
  rogueOverlays: /position\s*:\s*fixed/gi,
  translateX: /translateX/g,
  hardcodedHex: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g,
  // Hand-rolled engine chrome: a module writing the engine's OWN structural classes
  // as HTML literals (instead of calling MastUI.card/kv/tiles/timeline/relatedTable/
  // paneTabsBar/stickyHead/launchCard). The slide-out / card shape must come from the
  // engine so it can't drift (doc 17 §13/§14b). NOTE: mu-pane/mu-sub/mu-editbar/
  // mu-editpill/mu-arrow/mu-launch have NO primitive (composed by hand by design) — excluded.
  handRolledChrome: /class="[^"]*\bmu-(card|cc|kv|tiles|tile|tl|rel|ptabs|stickyhead)\b/g,
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
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0);
  console.log((fs.existsSync(BASELINE) ? 'Re-baselined' : 'Baselined') + ' UX standards: ' +
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
  console.error('\n✗ UX-standard DRIFT — these increase violations vs the baseline:\n');
  drifts.forEach(d => console.error('  ' + d.file + '  ' + d.metric + ': ' + d.was + ' → ' + d.now +
    '   (' + hint(d.metric) + ')'));
  console.error('\nFix: use the shared engines/helpers (docs/ux-audit/02–14). New code must be clean.');
  process.exit(1);
}

console.log('✓ UX standards: no drift vs baseline (' + Object.keys(baseline).length + ' files tracked).');
process.exit(0);

function hint(m) {
  return {
    nativeDialogs: 'use mastConfirm/Alert/Prompt',
    rogueOverlays: 'use mastSlideOut / openModal',
    translateX: 'use the shared slide-out',
    hardcodedHex: 'use var(--…) tokens',
    handRolledChrome: 'extend/use a MastUI primitive (card/kv/tiles/launchCard/cardGrid) — do not hand-write mu-* chrome',
  }[m];
}
