/**
 * End-to-end proof for the Phase-2 ratchet gates. Run: node test/lint-ratchet.test.js
 *
 * For each gate it asserts two things against the REAL detector + committed
 * baseline:
 *   1. the current tree PASSES (baseline absorbs existing violations), and
 *   2. a freshly-written fixture file containing a NEW violation FAILS (exit 1).
 *
 * The fixture is a brand-new file under app/ — not in the baseline — so it is
 * born at 0 and any violation in it is net-new drift. The fixture is always
 * removed in a finally block so it never pollutes the tree.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

// Run a detector; return its exit code (0 = clean, non-0 = drift/violation).
function runGate(script) {
  try {
    execFileSync('node', [path.join('scripts', script)], { cwd: ROOT, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status || 1;
  }
}

// Write a fixture under app/, run the gate, always clean up.
function withFixture(relPath, content, fn) {
  const full = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  try { return fn(); }
  finally { fs.rmSync(full, { force: true }); }
}

console.log('Phase-2 ratchet gates');

// ---- Gate 1: debug/PII console -------------------------------------------
t('lint-no-debug-pii-console: clean tree passes', () => {
  assert.strictEqual(runGate('lint-no-debug-pii-console.js'), 0);
});
t('lint-no-debug-pii-console: NEW [DEBUG] / PII console fails', () => {
  const code = withFixture('app/__lint_fixture__.js',
    "console.log('[DEBUG] hi');\nconsole.warn('leak', user.email, profile.uid);\n",
    () => runGate('lint-no-debug-pii-console.js'));
  assert.strictEqual(code, 1);
});

// ---- Gate 2: hardcoded ids ------------------------------------------------
t('lint-no-hardcoded-ids: clean tree passes', () => {
  assert.strictEqual(runGate('lint-no-hardcoded-ids.js'), 0);
});
t('lint-no-hardcoded-ids: NEW hardcoded origin/id fails', () => {
  const code = withFixture('app/__lint_fixture__.js',
    "var origin = 'mast-shirglassworks.web.app';\nvar tenantId = 'shirglassworks';\n",
    () => runGate('lint-no-hardcoded-ids.js'));
  assert.strictEqual(code, 1);
});
t('lint-no-hardcoded-ids: allowlisted help/assets host passes', () => {
  const code = withFixture('app/__lint_fixture__.js',
    "var HELP = 'https://help.runmast.com/#x';\nvar A = 'https://assets.runmast.com/y';\n",
    () => runGate('lint-no-hardcoded-ids.js'));
  assert.strictEqual(code, 0);
});

// ---- Gate 3: unbounded reads ---------------------------------------------
t('lint-unbounded-read: clean tree passes', () => {
  assert.strictEqual(runGate('lint-unbounded-read.js'), 0);
});
t('lint-unbounded-read: NEW unbounded list/onSnapshot fails', () => {
  const code = withFixture('app/__lint_fixture__.js',
    "MastDB.list('admin/customers').then(apply);\nq.onSnapshot(cb);\n",
    () => runGate('lint-unbounded-read.js'));
  assert.strictEqual(code, 1);
});
t('lint-unbounded-read: bounded list with { limit } passes', () => {
  const code = withFixture('app/__lint_fixture__.js',
    "MastDB.list('admin/customers', { limit: 50 }).then(apply);\n",
    () => runGate('lint-unbounded-read.js'));
  assert.strictEqual(code, 0);
});

console.log('\n' + pass + ' passed');
