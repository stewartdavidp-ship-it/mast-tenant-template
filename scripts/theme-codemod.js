#!/usr/bin/env node
/* Light/dark theming codemod for admin modules.
 *
 * Converts the UNAMBIGUOUS dark-assuming color literals in inline styles to
 * theme tokens. Each rule is VALUE-MATCHED: the literal it replaces equals (or
 * closely approximates) the token's *dark-mode* value, so dark mode is
 * preserved by construction while light mode gains correct values.
 *
 * Property-aware: text grays only convert inside `color:`, dark fills only
 * inside `background[-color]:`, etc. Genuinely ambiguous literals (#fff, bare
 * #444, rgba-white used as a fill, rgba(0,0,0) shadows) are FLAGGED, never
 * rewritten — they need human judgment (e.g. white-on-amber button text).
 *
 * Usage:
 *   node scripts/theme-codemod.js --dry [--file=app/modules/channels.js]
 *   node scripts/theme-codemod.js --apply --file=app/modules/channels.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

const APPLY = process.argv.includes('--apply');
const fileArg = (process.argv.find(a => a.startsWith('--file=')) || '').slice(7);

// ---- APPLY rules: [label, regex, replacement] (regex must capture a leading
//      property anchor so we only touch the right CSS property) ----
// (?<![-\w]) ensures we match a real CSS PROPERTY, never a custom-property
// DEFINITION like `--border:` or `--wiz-border:` (the `-` is a word boundary
// for \b, which previously let the border rule corrupt token definitions).
const P = '(?<![-\\w])';
const RULES = [
  // text grays (light-on-dark only; never on colored buttons)
  ['color #e0e0e0 → --text',        new RegExp(`(${P}color:\\s*)#e0e0e0\\b`, 'gi'), '$1var(--text)'],
  ['color #e8e4df → --text',        new RegExp(`(${P}color:\\s*)#e8e4df\\b`, 'gi'), '$1var(--text)'],
  ['color #ccc → --warm-gray-light',new RegExp(`(${P}color:\\s*)#ccc(ccc)?\\b`, 'gi'), '$1var(--warm-gray-light)'],
  ['color #aaa → --warm-gray-light',new RegExp(`(${P}color:\\s*)#aaa(aaa)?\\b`, 'gi'), '$1var(--warm-gray-light)'],
  ['color #999 → --warm-gray',      new RegExp(`(${P}color:\\s*)#999(999)?\\b`, 'gi'), '$1var(--warm-gray)'],
  ['color #888 → --warm-gray',      new RegExp(`(${P}color:\\s*)#888(888)?\\b`, 'gi'), '$1var(--warm-gray)'],
  // dark fills (always dark panels)
  ['bg #1a1a1a → --bg-primary',     new RegExp(`(${P}background(?:-color)?:\\s*)#1a1a1a\\b`, 'gi'), '$1var(--bg-primary)'],
  ['bg #1a1d26 → --bg',             new RegExp(`(${P}background(?:-color)?:\\s*)#1a1d26\\b`, 'gi'), '$1var(--bg)'],
  ['bg #232323 → --bg-secondary',   new RegExp(`(${P}background(?:-color)?:\\s*)#232323\\b`, 'gi'), '$1var(--bg-secondary)'],
  ['bg #252a35 → --surface-card',   new RegExp(`(${P}background(?:-color)?:\\s*)#252a35\\b`, 'gi'), '$1var(--surface-card)'],
  ['bg #2a2a2a → --card-bg',        new RegExp(`(${P}background(?:-color)?:\\s*)#2a2a2a\\b`, 'gi'), '$1var(--card-bg)'],
  ['bg #333 → --bg-tertiary',       new RegExp(`(${P}background(?:-color)?:\\s*)#333(333)?\\b`, 'gi'), '$1var(--bg-tertiary)'],
  // borders (color inside a border shorthand — dark separators)
  ['border #444 → --border',        new RegExp(`(${P}border(?:-(?:top|right|bottom|left))?(?:-color)?:\\s*[^;"'}]*?)#444(444)?\\b`, 'gi'), '$1var(--border)'],
  ['border #3a3a3a → --border',     new RegExp(`(${P}border(?:-(?:top|right|bottom|left))?(?:-color)?:\\s*[^;"'}]*?)#3a3a3a\\b`, 'gi'), '$1var(--border)'],
  ['border #333 → --border',        new RegExp(`(${P}border(?:-(?:top|right|bottom|left))?(?:-color)?:\\s*[^;"'}]*?)#333(333)?\\b`, 'gi'), '$1var(--border)'],
  ['border rgba(255*) → --border',  new RegExp(`(${P}border(?:-(?:top|right|bottom|left))?(?:-color)?:\\s*[^;"'}]*?)rgba\\(\\s*255\\s*,\\s*255\\s*,\\s*255\\s*,\\s*0?\\.\\d+\\s*\\)`, 'gi'), '$1var(--border)'],
];

// ---- FLAG patterns: ambiguous, surfaced for manual review ----
const FLAGS = [
  ['#fff / #ffffff (text-on-color? surface? — review)', /#fff(fff)?\b/gi],
  ['bg/border #444 not caught (review)', /#444(444)?\b/gi],
  ['rgba(255,255,255,*) fill/overlay (review)', /rgba\(\s*255\s*,\s*255\s*,\s*255/gi],
];

function process_file(file) {
  const before = fs.readFileSync(file, 'utf8');
  let src = before;
  const counts = {};
  for (const [label, re, repl] of RULES) {
    const m = src.match(re);
    if (m) { counts[label] = m.length; src = src.replace(re, repl); }
  }
  const flags = {};
  for (const [label, re] of FLAGS) {
    const m = src.match(re);
    if (m) flags[label] = m.length;
  }
  return { file, src, changed: src !== before, counts, flags };
}

const files = fileArg ? [fileArg]
  : fs.readdirSync('app/modules').filter(f => f.endsWith('.js')).map(f => 'app/modules/' + f);

let totalApplied = 0;
for (const f of files) {
  const r = process_file(f);
  const applied = Object.values(r.counts).reduce((a, b) => a + b, 0);
  if (!applied && !Object.keys(r.flags).length) continue;
  totalApplied += applied;
  console.log(`\n${r.file}  —  ${applied} auto-convertible`);
  Object.entries(r.counts).forEach(([k, v]) => console.log(`   ✓ ${String(v).padStart(3)}  ${k}`));
  Object.entries(r.flags).forEach(([k, v]) => console.log(`   ⚠ ${String(v).padStart(3)}  ${k}`));
  if (APPLY && r.changed) { fs.writeFileSync(r.file, r.src); console.log('   → written'); }
}
console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'} total auto-convertible: ${totalApplied}`);
