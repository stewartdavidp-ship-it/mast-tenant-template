/**
 * Proof for the conflict-marker guard. Run: node test/lint-conflict-markers.test.js
 *
 * Two layers:
 *   1. scanContent() unit cases — the pure per-file detector, incl. the Markdown
 *      setext-underline false-positive case it must NOT flag.
 *   2. End-to-end against the real gate: the current tree PASSES, and a fixture
 *      file carrying real markers FAILS (exit 1). The fixture is written at
 *      runtime and removed in a finally block, so it never pollutes the tree.
 *
 * Marker literals are built via String.repeat() so this test file's own source
 * contains no column-0 conflict marker (the gate scans test/*.js too).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scanContent } = require('../scripts/lint-conflict-markers.js');

const ROOT = path.resolve(__dirname, '..');
const LT = '<'.repeat(7);
const EQ = '='.repeat(7);
const GT = '>'.repeat(7);
const PIPE = '|'.repeat(7);

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

function runGate(script) {
  try {
    execFileSync('node', [path.join('scripts', script)], { cwd: ROOT, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status || 1;
  }
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, stdio: 'pipe' });
}

// The gate enumerates via `git ls-files`, so a fixture must be index-tracked to
// be seen. Intent-to-add (`git add -N`) lists it without committing; cleanup
// unstages and deletes it, even if fn throws.
function withTrackedFixture(relPath, content, fn) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  try {
    git(['add', '-N', '--', relPath]);
    return fn();
  } finally {
    try { git(['reset', '-q', '--', relPath]); } catch { /* best effort */ }
    fs.rmSync(full, { force: true });
  }
}

console.log('conflict-marker guard');

// ---- scanContent() pure unit cases ---------------------------------------
t('scanContent: clean content has no hits', () => {
  assert.deepStrictEqual(scanContent('var a = 1;\nvar b = 2;\n'), []);
});

t('scanContent: a full conflict (start/sep/end) is flagged', () => {
  const src = `${LT} HEAD\nvar x = 1;\n${EQ}\nvar x = 2;\n${GT} feature\n`;
  const hits = scanContent(src);
  assert.strictEqual(hits.length, 3, 'start, separator, end');
  assert.deepStrictEqual(hits.map((h) => h.line), [1, 3, 5]);
});

t('scanContent: diff3 base marker (seven pipes) is flagged', () => {
  const src = `${LT} HEAD\na\n${PIPE} base\nb\n${EQ}\nc\n${GT} other\n`;
  // start + base + separator + end = 4
  assert.strictEqual(scanContent(src).length, 4);
});

t('scanContent: Markdown setext underline (bare separator, no angle marker) is NOT flagged', () => {
  assert.deepStrictEqual(scanContent(`A Heading\n${EQ}\n\nbody\n`), []);
});

t('scanContent: a stray start marker alone is flagged', () => {
  assert.strictEqual(scanContent(`${LT} HEAD\ncode\n`).length, 1);
});

t('scanContent: marker not at column 0 is ignored (e.g. quoted in source)', () => {
  assert.deepStrictEqual(scanContent(`  const x = '${LT}';\n`), []);
});

// ---- End-to-end against the real gate ------------------------------------
t('gate: current tree passes', () => {
  assert.strictEqual(runGate('lint-conflict-markers.js'), 0);
});

t('gate: a tracked file with real markers fails', () => {
  const code = withTrackedFixture(
    'app/modules/__conflict_fixture__.js',
    `${LT} HEAD\nvar a = 1;\n${EQ}\nvar a = 2;\n${GT} other\n`,
    () => runGate('lint-conflict-markers.js'),
  );
  assert.strictEqual(code, 1);
});

console.log('\n' + pass + ' passed');
