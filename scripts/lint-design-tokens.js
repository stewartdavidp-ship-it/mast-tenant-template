#!/usr/bin/env node
// Design token lint — checks the admin app for off-scale font-sizes and
// literal hex colors in admin UI. Run from repo root:
//   node scripts/lint-design-tokens.js
// Exits 0 if clean, 1 if violations found.
//
// Scope: app/index.html + app/modules/*.js
// Skipped (documented exceptions):
//   - Email HTML templates (they use px on purpose for email client support)
//     -> detected by matching "font-size:NNpx" which the font-size rule already ignores
//   - .nl-grid-* CSS in index.html (admin newsletter preview, mirrors email client styles)
//
// Rules enforced:
//   1. Font sizes in rem MUST be one of the 7-scale:
//      0.72, 0.78, 0.85, 0.9, 1.0, 1.15, 1.6
//   2. Literal hex colors in module inline styles (warn only — not a hard block yet)

const fs = require('fs');
const path = require('path');

const ALLOWED_REM = new Set(['0.72', '0.78', '0.85', '0.9', '1.0', '1', '1.15', '1.6']);
const REM_RE = /font-size:\s*(\d+\.?\d*)rem/g;
const HEX_RE = /#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?\b/g;

// Files to scan
const targets = [
  'app/index.html',
  ...fs.readdirSync('app/modules')
    .filter(f => f.endsWith('.js'))
    .map(f => path.join('app/modules', f)),
];

// Hex whitelist — palette colors that are OK in any module (e.g. for email
// templates, canvas/SVG rendering, STATUS_DOT maps). Adding a hex here is an
// acknowledgement, not an excuse.
const HEX_WHITELIST = new Set([
  // Semantic colors used in STATUS_DOT and badge maps
  '#16a34a', '#f59e0b',
  // Brand palette (already in tokens but sometimes inlined)
  '#C4853C', '#2A7C6F', '#1A1A1A', '#FAF6F0', '#DC3545',
]);

let fontErrors = 0;
let hexWarnings = 0;
const violations = [];

for (const file of targets) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');

  lines.forEach((line, i) => {
    const lineNo = i + 1;

    // Font-size check
    let m;
    REM_RE.lastIndex = 0;
    while ((m = REM_RE.exec(line)) !== null) {
      const val = m[1];
      if (!ALLOWED_REM.has(val)) {
        fontErrors++;
        violations.push(`FONT  ${file}:${lineNo}  font-size:${val}rem  (not in 7-scale)`);
      }
    }

    // Hex color check — only in modules, and only inline style= blocks
    if (file.startsWith('app/modules/') && line.includes('style="')) {
      HEX_RE.lastIndex = 0;
      while ((m = HEX_RE.exec(line)) !== null) {
        if (!HEX_WHITELIST.has(m[0])) {
          hexWarnings++;
          if (hexWarnings <= 30) {
            violations.push(`HEX   ${file}:${lineNo}  ${m[0]}  (prefer CSS var)`);
          }
        }
      }
    }
  });
}

console.log('Design token lint — ' + targets.length + ' files scanned');
console.log('  Font-size violations (blocking):  ' + fontErrors);
console.log('  Hex color warnings (advisory):    ' + hexWarnings);

if (violations.length) {
  console.log('');
  // Always show ALL font violations; cap hex at 30 (advisory only).
  const fontVios = violations.filter(v => v.startsWith('FONT'));
  const hexVios = violations.filter(v => v.startsWith('HEX'));
  if (fontVios.length) {
    console.log('Font-size violations (' + fontVios.length + '):');
    fontVios.forEach(v => console.log('  ' + v));
  }
  if (hexVios.length) {
    console.log('');
    console.log('Hex color warnings (first 30 of ' + hexVios.length + '):');
    hexVios.slice(0, 30).forEach(v => console.log('  ' + v));
    if (hexVios.length > 30) {
      console.log('  ... (' + (hexVios.length - 30) + ' more hex warnings suppressed)');
    }
  }
}

// Exit non-zero only on font errors — hex is advisory until Phase 13.
process.exit(fontErrors > 0 ? 1 : 0);
