#!/usr/bin/env node
// Conflict-marker guard — fails any PR whose checked-out tree contains committed
// Git merge-conflict markers in a tracked file.
//
// Why this exists
// ---------------
// On 2026-06-17 an auto-merge (#613) committed UNRESOLVED conflict markers into
// app/index.html. The inline <script> then failed to parse
// (`SyntaxError: Unexpected token` at the first marker), so MAST_MODULES_V, the
// module manifest, MastAdmin, and Firebase init never ran — the entire served dev
// admin went down, not just one screen. The fix was #618; this guard prevents a
// recurrence.
//
// Crucially, the cache-bust guard did NOT catch it: MAST_MODULES_V *was* present
// (it was duplicated inside a conflict block), so the version-bump check passed.
// The module syntax check only parses app/modules/*.js, not index.html's inline
// script. And a botched/auto merge can introduce markers that no single PR commit
// contains, so a line-scoped diff is not enough either. The only reliable check
// is: the prospective merged tree must contain no conflict markers anywhere. On a
// pull_request, actions/checkout checks out the merge commit, so scanning the
// working tree IS scanning the prospective merge result.
//
// Detection
// ---------
// A Git conflict marker is one of these at the START of a line (column 0):
//   start      — `ours`,  optionally with a ` HEAD`/label suffix  (seven `<`)
//   base       — diff3 conflict style                              (seven `|`)
//   separator  — exactly seven `=`, whole line
//   end        — `theirs`                                          (seven `>`)
// The angle/pipe markers are effectively never legitimate source. The bare
// separator CAN collide with a Markdown setext H1 underline, so we only flag a
// file's separator lines when that same file also carries an angle marker — i.e.
// it is a real conflict, not a heading rule.
//
// Exits 0 if clean, 1 if any tracked file contains conflict markers.
// Wired as a step in the required `lint` job in .github/workflows/lint.yml; the
// pure scanContent() helper is exercised by test/lint-conflict-markers.test.js.

'use strict';

const { execSync } = require('child_process');
const fs = require('fs');

// Build the marker literals from char repetition so this file's own source can
// never match the column-0 patterns it scans for (no literal run of 7 appears).
const C_LT = '<'.repeat(7);
const C_GT = '>'.repeat(7);
const C_EQ = '='.repeat(7);

// Start-of-line markers. Angle/pipe forms allow an optional ` label` suffix
// (e.g. a `<<<<<<< HEAD` line); the separator must be exactly seven `=` alone.
const START_RE = new RegExp('^' + C_LT + '(?: .*)?$');
const BASE_RE = /^\|{7}(?: .*)?$/;
const SEP_RE = new RegExp('^' + C_EQ + '$');
const END_RE = new RegExp('^' + C_GT + '(?: .*)?$');

// A file definitely holds a real conflict if it has an angle marker — unambiguous.
const ANGLE_RE = new RegExp('(?:^' + C_LT + ')|(?:^' + C_GT + ')', 'm');

// Pure: given a file's text, return the conflict-marker hits as
// [{ line, text }] (1-based line numbers). No I/O — unit-testable.
function scanContent(content) {
  const hasAngle = ANGLE_RE.test(content);
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isAngleOrBase =
      START_RE.test(line) || END_RE.test(line) || BASE_RE.test(line);
    // Only treat a bare separator as a conflict marker when the file also
    // carries an unambiguous angle marker — otherwise it's a Markdown heading.
    const isSep = hasAngle && SEP_RE.test(line);
    if (isAngleOrBase || isSep) hits.push({ line: i + 1, text: line });
  }
  return hits;
}

function trackedFiles() {
  // -z: NUL-separated, robust to spaces/unicode in paths.
  return execSync('git ls-files -z', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);
}

function main() {
  let files;
  try {
    files = trackedFiles();
  } catch (err) {
    console.error(
      `conflict-marker guard: could not list tracked files (${err.message.split('\n')[0]}).`,
    );
    return 1;
  }

  const hits = [];
  for (const file of files) {
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      // Tracked but absent in the working tree (e.g. deleted); nothing to scan.
      continue;
    }
    // git's own binary heuristic: a NUL byte in the first 8000 bytes.
    if (buf.subarray(0, 8000).includes(0)) continue;
    for (const h of scanContent(buf.toString('utf8'))) {
      hits.push({ file, line: h.line, text: h.text });
    }
  }

  if (hits.length === 0) {
    console.log(
      `✓ conflict-marker guard: no Git conflict markers in ${files.length} tracked files.`,
    );
    return 0;
  }

  console.error('✗ conflict-marker guard: committed merge-conflict markers found.');
  console.error('');
  for (const h of hits) {
    console.error(`  ${h.file}:${h.line}: ${h.text}`);
  }
  console.error('');
  console.error(
    '  These are unresolved conflict markers. A merge left them in the tree; in',
  );
  console.error(
    '  served code (app/index.html, app/modules/*.js) they break parsing and take',
  );
  console.error(
    '  the whole admin down. Resolve the conflict, delete the marker lines, and',
  );
  console.error('  commit the clean file.');
  return 1;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { scanContent };
