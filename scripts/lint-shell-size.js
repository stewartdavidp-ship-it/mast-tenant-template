#!/usr/bin/env node
// Shell-size ratchet — fails a PR that GROWS the inline JavaScript in the admin
// shell (app/index.html).
//
// Why: ~80% of app/index.html is one giant inline <script> block (~49K lines).
// It is the universal merge-conflict point and parses on every admin boot. The
// decomposition program (docs/ux-audit/decomposition-master-plan.md) moves
// feature surfaces out into lazy app/modules/*.js. This ratchet locks the
// direction in: the inline-JS line count can only ever go DOWN. New feature code
// must live in a module (which barely touches index.html — just a manifest line),
// not be appended to the shell.
//
// Metric: total lines inside inline <script> blocks (those WITHOUT a src=). CSS,
// markup, and <script src> tags don't count, so legitimate style/HTML/nav edits
// are unaffected — only inline-JS accretion trips it.
//
//   node scripts/lint-shell-size.js            # check (CI) — exit 1 if it grew
//   node scripts/lint-shell-size.js --update   # re-baseline after an extraction
//                                              # (lowers the lock; never raises in CI)
//
// Wired as a step in the required `lint` job.

'use strict';

const fs = require('fs');
const path = require('path');

const INDEX = path.join(__dirname, '..', 'app', 'index.html');
const BASELINE = path.join(__dirname, 'shell-size-baseline.json');

function inlineJsLines() {
  const lines = fs.readFileSync(INDEX, 'utf8').split('\n');
  // Open an inline-script region on a <script ...> tag that has no src=, close
  // it on </script>. The opening tag line and closing line are not counted —
  // only the JS body in between.
  const openInline = /<script(?![^>]*\bsrc=)[^>]*>/;
  let inScript = false;
  let count = 0;
  for (const line of lines) {
    if (!inScript) {
      if (openInline.test(line)) inScript = true;
      continue;
    }
    if (line.indexOf('</script>') !== -1) { inScript = false; continue; }
    count++;
  }
  return count;
}

function main() {
  const current = inlineJsLines();
  const isUpdate = process.argv.includes('--update');

  if (isUpdate) {
    fs.writeFileSync(BASELINE, JSON.stringify({ inlineJsLines: current }, null, 2) + '\n');
    console.log(`Re-baselined shell size: inlineJsLines = ${current}.`);
    return 0;
  }

  if (!fs.existsSync(BASELINE)) {
    console.error('✗ shell-size: missing scripts/shell-size-baseline.json — run --update once.');
    return 1;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8')).inlineJsLines;

  if (current > baseline) {
    console.error('✗ shell-size: inline JS in app/index.html GREW ' +
      `(${baseline} → ${current}, +${current - baseline}).`);
    console.error('');
    console.error('  The admin shell may not accrete new inline JavaScript. Put new feature');
    console.error('  code in an app/modules/*.js module (lazy-loaded via MODULE_MANIFEST), not');
    console.error('  the index.html inline block. See docs/ux-audit/decomposition-master-plan.md §14.');
    console.error('  If this is an extraction that legitimately lowered it, run:');
    console.error('      node scripts/lint-shell-size.js --update   (and commit the baseline)');
    return 1;
  }

  if (current < baseline) {
    console.log(`✓ shell-size: inline JS shrank (${baseline} → ${current}, −${baseline - current}). ` +
      'Run --update to lock in the lower baseline.');
    return 0;
  }

  console.log(`✓ shell-size: inline JS unchanged (${current} lines, at baseline).`);
  return 0;
}

process.exit(main());
