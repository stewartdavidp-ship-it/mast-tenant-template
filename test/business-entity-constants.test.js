'use strict';

/**
 * Unit-test gate for shared/business-entity-constants.js — the per-tenant
 * feature/route-visibility engine (mode-set derivation, route dependency map,
 * label overrides, visibility state machine, module-enabled clickstream events,
 * mode-set diffing, reactive banner thresholds). Consumed by setup-wizard.js,
 * business-view.js, settings-panels.js, nav-profiles.js, and many others, but
 * previously had NO dedicated test — its ~120 assertions only ran from a dev
 * console.
 *
 * This file converts the engine's 7 built-in self-test suites into an
 * un-skippable CI gate. The module is a window-global IIFE that also assigns
 * window.BusinessEntityConstants; we give it a bare `window` and require it,
 * then invoke every self-test export and fail the process if any reports a
 * failure (or runs zero assertions — guarding against a refactor silently
 * gutting the suites).
 *
 * Run: node test/business-entity-constants.test.js
 */

global.window = {};
require('../shared/business-entity-constants.js');

const BEC = global.window.BusinessEntityConstants;
if (!BEC) {
  console.error('✗ window.BusinessEntityConstants was not assigned by the module');
  process.exit(1);
}

const SUITES = [
  '_runDerivationSelfTests',
  '_runDependencySelfTests',
  '_runLabelOverrideSelfTests',
  '_runVisibilitySelfTests',
  '_runModuleEnabledEventSelfTests',
  '_runDiffModeSetsSelfTests',
  '_runBannerThresholdSelfTests',
];

let totalPassed = 0;
let hadFailure = false;

for (const name of SUITES) {
  const fn = BEC[name];
  if (typeof fn !== 'function') {
    console.error('✗ ' + name + ' is not exported as a function');
    hadFailure = true;
    continue;
  }

  let result;
  try {
    result = fn();
  } catch (err) {
    console.error('✗ ' + name + ' threw: ' + (err && err.stack ? err.stack : err));
    hadFailure = true;
    continue;
  }

  const passed = (result && typeof result.passed === 'number') ? result.passed : 0;
  const failed = (result && typeof result.failed === 'number') ? result.failed : 0;
  const failures = (result && Array.isArray(result.failures)) ? result.failures : [];

  if (failed > 0) {
    console.error('✗ ' + name + ': ' + failed + ' failed, ' + passed + ' passed');
    for (const f of failures) console.error('    - ' + (typeof f === 'string' ? f : JSON.stringify(f)));
    hadFailure = true;
    continue;
  }

  // Guard against a vacuous pass: a suite that runs zero assertions must fail
  // the gate so a future refactor can't silently delete its self-tests.
  if (passed <= 0) {
    console.error('✗ ' + name + ': reported 0 assertions (expected > 0) — self-tests may have been removed');
    hadFailure = true;
    continue;
  }

  totalPassed += passed;
  console.log('✓ ' + name + ' — ' + passed + ' assertions');
}

if (hadFailure) {
  console.error('\nbusiness-entity-constants: FAILED');
  process.exit(1);
}

console.log('\nbusiness-entity-constants: ' + totalPassed + ' passed (' + SUITES.length + ' suites)');
