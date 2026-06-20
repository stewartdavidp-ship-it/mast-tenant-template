/**
 * Proof for the module-manifest / route integrity gate (Track 0).
 * Run: node test/lint-manifest-integrity.test.js
 *
 * End-to-end against the real gate (it has no exported internals — it runs on
 * import and process.exit()s, so it's exercised as a subprocess):
 *   1. the current tree PASSES (exit 0), and
 *   2. fixture files carrying a dead module id FAIL (exit 1) — for BOTH the
 *      `loadModule('x')` primitive AND the `_ensureModule('x')` wrapper (the
 *      PR #738 bug class: a retirement left a dead id behind the wrapper that the
 *      literal-`loadModule`-only scan was blind to), while
 *   3. a VALID id behind the wrapper PASSES (no false-positive), and
 *   4. an EXCLUDED idiom whose arg is NOT a module id (withBridge — a *Bridge
 *      method name) PASSES (it must not be scanned against the manifest).
 *
 * Check C reads app/modules/*.js via fs.readdirSync, so an untracked fixture is
 * seen without git plumbing. The fixture is always removed in a finally block so
 * it never pollutes the tree.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BOGUS = 'definitely-not-a-real-module-xyz'; // matches [a-z0-9-]+, not in any manifest row
const VALID = 'production';                        // a real MODULE_MANIFEST id

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓ ' + name); }

// Run the gate; return its exit code (0 = clean, non-0 = integrity violation).
function runGate(script) {
  try {
    execFileSync('node', [path.join('scripts', script)], { cwd: ROOT, stdio: 'pipe' });
    return 0;
  } catch (e) {
    return e.status || 1;
  }
}

// Write a fixture module under app/modules/, run the gate, always clean up.
function withFixture(content, fn) {
  const rel = 'app/modules/__manifest_fixture__.js';
  const full = path.join(ROOT, rel);
  fs.writeFileSync(full, content);
  try { return fn(); }
  finally { fs.rmSync(full, { force: true }); }
}

console.log('manifest integrity gate');

// ---- 1. current tree passes ----------------------------------------------
t('gate: current tree passes', () => {
  assert.strictEqual(runGate('lint-manifest-integrity.js'), 0);
});

// ---- 2a. dead id behind the loadModule primitive fails -------------------
t("gate: NEW loadModule('<dead>') fails", () => {
  const code = withFixture(
    "function f() { return loadModule('" + BOGUS + "'); }\n",
    () => runGate('lint-manifest-integrity.js'));
  assert.strictEqual(code, 1);
});

// ---- 2b. dead id behind the _ensureModule WRAPPER fails (the #738 bug class)
t("gate: NEW _ensureModule('<dead>') is CAUGHT (PR #738 class)", () => {
  const code = withFixture(
    "function f() { return _ensureModule('" + BOGUS + "'); }\n",
    () => runGate('lint-manifest-integrity.js'));
  assert.strictEqual(code, 1);
});

// ---- 3. a VALID id behind the wrapper passes (no false-positive) ----------
t("gate: _ensureModule('<valid manifest id>') passes", () => {
  const code = withFixture(
    "function f() { return _ensureModule('" + VALID + "'); }\n",
    () => runGate('lint-manifest-integrity.js'));
  assert.strictEqual(code, 0);
});

// ---- 4. an EXCLUDED idiom (arg is NOT a module id) passes -----------------
// withBridge('recordSale') etc. pass a *Bridge METHOD name, not a manifest id;
// the gate must not scan it (else it would false-positive against the manifest).
t("gate: excluded withBridge('<not-a-module>') passes", () => {
  const code = withFixture(
    "function f() { return withBridge('" + BOGUS + "'); }\n",
    () => runGate('lint-manifest-integrity.js'));
  assert.strictEqual(code, 0);
});

console.log('\n' + pass + ' passed');
