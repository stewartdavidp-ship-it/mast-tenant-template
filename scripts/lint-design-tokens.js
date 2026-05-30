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
// Rules tracked:
//   1. Font sizes in rem MUST be one of the 7-scale (BLOCKING — backlog
//      cleared by PR #30, 2026-05-06; regressions fail CI):
//      0.72, 0.78, 0.85, 0.9, 1.0, 1.15, 1.6
//   2. Literal hex colors in module inline styles (advisory — pending
//      separate cleanup pass).

const fs = require('fs');
const path = require('path');

// Resolve paths from the repo root regardless of the caller's cwd, so the
// PostToolUse hook (which may run from a different directory) and manual/CI
// invocations all behave identically.
process.chdir(path.resolve(__dirname, '..'));

// --report: print a per-file worklist of color-literal density (advisory; for
// the light/dark theming migration) instead of the normal pass/fail summary.
const REPORT = process.argv.includes('--report');

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

// Per-file census for the migration worklist (report mode).
const perFile = {};
const tally = (file) => (perFile[file] = perFile[file] ||
  { hex: 0, whiteOverlay: 0, whiteText: 0, darkFill: 0 });

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
          tally(file).hex++;
          if (hexWarnings <= 30) {
            violations.push(`HEX   ${file}:${lineNo}  ${m[0]}  (prefer CSS var)`);
          }
        }
      }
    }

    // Dark-assuming pattern census (report mode only) — these are what break
    // in light mode: white text/overlays and dark fills hardcoded into modules.
    if (REPORT) {
      const wo = (line.match(/rgba\(\s*255\s*,\s*255\s*,\s*255/g) || []).length;
      const wt = (line.match(/#fff\b|#ffffff\b|#e0e0e0\b|#e8e4df\b/gi) || []).length;
      const df = (line.match(/#1a1a1a\b|#2a2a2a\b|#252a35\b|#232323\b|#333\b|#444\b/gi) || []).length;
      if (wo || wt || df) {
        const t = tally(file);
        t.whiteOverlay += wo; t.whiteText += wt; t.darkFill += df;
      }
    }
  });
}

if (REPORT) {
  const rows = Object.entries(perFile)
    .map(([f, t]) => ({ f, ...t, darkAssuming: t.whiteOverlay + t.whiteText + t.darkFill }))
    .sort((a, b) => b.darkAssuming - a.darkAssuming);
  const pad = (s, n) => String(s).padEnd(n);
  const num = (s, n) => String(s).padStart(n);
  console.log('Light/dark migration worklist — modules ranked by dark-assuming literals');
  console.log('(whiteOverlay = rgba(255,255,255,*); whiteText = #fff/#e0e0e0; darkFill = #1a1a1a/#2a2a2a/#333/#444)');
  console.log('');
  console.log('  ' + pad('module', 34) + num('hex', 6) + num('wOvl', 6) + num('wTxt', 6) + num('dFill', 6) + num('DARK', 6));
  console.log('  ' + '-'.repeat(64));
  let tot = { hex: 0, whiteOverlay: 0, whiteText: 0, darkFill: 0, darkAssuming: 0 };
  rows.forEach(r => {
    if (!r.darkAssuming && !r.hex) return;
    console.log('  ' + pad(r.f.replace('app/modules/', ''), 34) +
      num(r.hex, 6) + num(r.whiteOverlay, 6) + num(r.whiteText, 6) + num(r.darkFill, 6) + num(r.darkAssuming, 6));
    Object.keys(tot).forEach(k => tot[k] += r[k]);
  });
  console.log('  ' + '-'.repeat(64));
  console.log('  ' + pad('TOTAL', 34) + num(tot.hex, 6) + num(tot.whiteOverlay, 6) +
    num(tot.whiteText, 6) + num(tot.darkFill, 6) + num(tot.darkAssuming, 6));
  process.exit(0);
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

// Font-size: blocking. Hex: advisory only.
process.exit(fontErrors > 0 ? 1 : 0);
