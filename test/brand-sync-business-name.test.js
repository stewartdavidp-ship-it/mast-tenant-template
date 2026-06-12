/**
 * Regression test: MastBrandSync.setName must persist the business name to the
 * canonical businessEntity identity field, not just config/brand.
 * Run: node test/brand-sync-business-name.test.js
 *
 * The onboarding wizard's activation validator (shared/mastdb.js
 * REQUIRED_AT_ACTIVATE → identity.businessName) and the dashboard "Finish your
 * business profile" checklist both read admin/businessEntity/identity.businessName.
 * A "Phase 4" brand-sync cleanup dropped the businessEntity mirror from setName
 * on the assumption that readers had migrated to config/brand.name — but those
 * two readers never did. Result: a name typed in the wizard saved to config/brand
 * but NEVER reached the BE record, so launch validation + the dashboard reported
 * "Business name still needed" even though the user entered it. This guards that
 * setName re-writes identity.businessName (and skips it for an empty name).
 */
const assert = require('assert');

// Fake MastDB the IIFE resolves via global.window at call time.
function makeFakeMastDB() {
  const calls = { update: [], beIdentity: [], platform: [] };
  return {
    calls,
    tenantId: () => 'test-tenant',
    update: (path, data) => { calls.update.push({ path, data }); return Promise.resolve(); },
    businessEntity: {
      update: (section, data) => { calls.beIdentity.push({ section, data }); return Promise.resolve(); }
    },
    platform: {
      update: (path, data) => { calls.platform.push({ path, data }); return Promise.resolve(); }
    }
  };
}

const fakeDB = makeFakeMastDB();
global.window = { MastDB: fakeDB };
const MastBrandSync = require('../shared/brand-sync.js');

let pass = 0;
const tests = [];
function t(name, fn) { tests.push({ name, fn }); }
console.log('MastBrandSync.setName business-name persistence');

t('setName writes config/brand.name AND businessEntity identity.businessName', async () => {
  fakeDB.calls.update.length = 0; fakeDB.calls.beIdentity.length = 0;
  await MastBrandSync.setName('  Meadow Pottery  ');
  // canonical brand config (trimmed)
  const brand = fakeDB.calls.update.find(c => c.path === 'config/brand');
  assert.ok(brand, 'config/brand was written');
  assert.strictEqual(brand.data.name, 'Meadow Pottery');
  // canonical businessEntity identity — the field the activation validator reads
  assert.strictEqual(fakeDB.calls.beIdentity.length, 1, 'businessEntity.update called once');
  assert.strictEqual(fakeDB.calls.beIdentity[0].section, 'identity');
  assert.strictEqual(fakeDB.calls.beIdentity[0].data.businessName, 'Meadow Pottery');
});

t('setName does NOT write an empty businessName to the BE record', async () => {
  fakeDB.calls.beIdentity.length = 0;
  await MastBrandSync.setName('   ');
  assert.strictEqual(fakeDB.calls.beIdentity.length, 0, 'no BE identity write for a blank name');
});

t('setName still rejects a non-string', async () => {
  await assert.rejects(() => MastBrandSync.setName(123), /name must be string/);
});

(async function run() {
  for (const { name, fn } of tests) {
    try {
      await fn();
      pass++;
      console.log('  ✓ ' + name);
    } catch (err) {
      console.error('  ✗ ' + name + '\n    ' + (err && err.message || err));
      process.exit(1);
    }
  }
  console.log('\n' + pass + ' tests passed.');
})();
