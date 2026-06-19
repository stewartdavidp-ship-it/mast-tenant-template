#!/usr/bin/env node
/**
 * lint-no-unsanitized-sink.js — unsanitized tenant-content innerHTML RATCHET (Track 7).
 *
 * Track 7 (decomposition-master-plan.md §9) routes the handful of surfaces where
 * TENANT-AUTHORED rich text reaches the raw-injecting storefront/email through the
 * canonical sanitizer (window.MastSanitize.sanitizeHtml — shared/mast-sanitize.js,
 * a superset of MastUI.sanitizeHtml that also allows safe-src <img>). The provenance
 * surfaces are blog bodies, waiver text, and product copy.
 *
 * This is NOT a campaign over the ~888 admin-trusted innerHTML sinks (admin input is
 * trusted). It is a TARGETED, LOW-false-positive ratchet over exactly the high-risk
 * class: an `.innerHTML` (or `+=`) assignment whose RIGHT-HAND SIDE references a
 * tenant rich-text field — `.body` / `.bodyHtml` / `.description` / a `waiver*`
 * identifier — WITHOUT a sanitize/escape call in the same statement. Those are the
 * sinks that turn stored tenant HTML into live DOM, so they MUST pass through a
 * sanitizer (`sanitiz…` / `MastSanitize` / `DOMPurify` / `esc(`).
 *
 * Mechanism (ratchet — same shape as lint-no-local-fmt.js / lint-ux-standards.js):
 * we BASELINE the current per-file count of flagged sinks and FAIL any change that
 * INCREASES them. New files are born at 0, so new module code MUST sanitize. As a
 * sink is routed through the sanitizer its count drops and `--update` re-locks the
 * lower baseline — the numbers can only ever go down. Target end state: all-zero.
 *
 * Scope: app/modules/*.js (mirrors lint-no-local-fmt). The shell index.html and the
 * shared/ cores are excluded; the storefront root *.js render the same fields via
 * textContent (escaped), not raw innerHTML.
 *
 * Usage:
 *   node scripts/lint-no-unsanitized-sink.js            # check (CI/pre-commit) — exit 1 on drift
 *   node scripts/lint-no-unsanitized-sink.js --update   # re-baseline (only lowers; never raises silently)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOD_DIR = path.join(ROOT, 'app', 'modules');
const BASELINE = path.join(__dirname, 'no-unsanitized-sink-baseline.json');

// A `.innerHTML =` / `.innerHTML +=` ASSIGNMENT (not `==` / `===` comparison).
const SINK_RE = /\.innerHTML\s*\+?=\s*/g;
// RHS reads a TENANT rich-text field as a PROPERTY ACCESS → must be sanitized.
// `.body` covers post.body/p.body/pv.body; `document.body` is stripped first so it
// never matches. Property-access only (leading `.`): static UI labels that merely
// CONTAIN "waiver"/"description", and admin-constructed `bodyHtml` variables (the
// trusted-admin class the plan excludes), are NOT tenant content and don't match.
const RISKY_RE = /\.(?:bodyHtml|body|description|waiver[A-Za-z0-9_$]*)\b/i;
// Any sanitize/escape marker in the same statement clears the sink.
const SANITIZE_RE = /sanitiz|MastSanitize|DOMPurify|escapeHtml|\b_esc\b|\besc\s*\(|escAttr/i;
// Blank out string + template literals (replace their bodies with spaces, keeping
// length) so a risky token inside a static label/markup string is not mistaken for
// a property read. Only genuine code-level `.body`/`.description` accesses survive.
function stripStrings(s) {
  let out = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\') { out += '  '; i++; continue; }
      if (c === q) { q = null; out += c; continue; }
      out += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { q = c; out += c; continue; }
    out += c;
  }
  return out;
}

// Walk forward from `start` to the end of the assignment statement: stop at the
// first `;` at bracket-depth 0 that is not inside a string / template literal.
// Caps at 8000 chars so a missing terminator can't run away. Returns the RHS text.
function readRhs(src, start) {
  let depth = 0, i = start;
  let quote = null; // "'" | '"' | '`'
  const end = Math.min(src.length, start + 8000);
  for (; i < end; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; continue; }
    if (c === ')' || c === ']' || c === '}') { if (depth === 0) break; depth--; continue; }
    if (c === ';' && depth === 0) break;
  }
  return src.slice(start, i);
}

function countFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  let n = 0;
  SINK_RE.lastIndex = 0;
  let m;
  while ((m = SINK_RE.exec(src))) {
    const after = m.index + m[0].length;
    if (src[after] === '=') continue; // `.innerHTML ==` / `===` — a comparison, not a sink
    const rhs = readRhs(src, after);
    const rhsCode = stripStrings(rhs).replace(/document\.body\b/g, '');
    if (RISKY_RE.test(rhsCode) && !SANITIZE_RE.test(rhs)) n++;
  }
  return n;
}

function scan() {
  const result = {};
  if (!fs.existsSync(MOD_DIR)) return result;
  for (const f of fs.readdirSync(MOD_DIR)) {
    if (!f.endsWith('.js')) continue;
    const n = countFile(path.join(MOD_DIR, f));
    if (n > 0) result['app/modules/' + f] = n;
  }
  return result;
}

const current = scan();
const isUpdate = process.argv.includes('--update');

if (isUpdate || !fs.existsSync(BASELINE)) {
  const existed = fs.existsSync(BASELINE);
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 2) + '\n');
  const total = Object.values(current).reduce((s, n) => s + n, 0);
  console.log((existed ? 'Re-baselined' : 'Baselined') + ' unsanitized-sink: ' +
    Object.keys(current).length + ' files, ' + total + ' flagged sinks.');
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const drifts = [];
const improvements = [];

for (const [file, now] of Object.entries(current)) {
  const was = baseline[file] || 0;            // unknown file ⇒ must be 0
  if (now > was) drifts.push({ file, was, now });
  else if (now < was) improvements.push({ file, was, now });
}

if (improvements.length) {
  console.log('✓ improvements (run --update to lock in the lower baseline):');
  improvements.forEach(i => console.log('  ' + i.file + ': ' + i.was + ' → ' + i.now));
}

if (drifts.length) {
  console.error('\n✗ unsanitized-sink DRIFT — these add raw tenant-content innerHTML vs the baseline:\n');
  drifts.forEach(d => console.error('  ' + d.file + ': ' + d.was + ' → ' + d.now));
  console.error('\nFix: route tenant rich text (body/bodyHtml/description/waiver) through ' +
    'window.MastSanitize.sanitizeHtml before assigning to innerHTML. New code must be clean.');
  process.exit(1);
}

console.log('✓ unsanitized-sink: no drift vs baseline (' + Object.keys(baseline).length + ' files tracked).');
process.exit(0);
