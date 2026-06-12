/**
 * Regression tests for MastDB.businessEntity feature-mode writers.
 * Run: node test/business-entity-feature-mode.test.js
 *
 * Guards the onboarding-wizard bug where setFeatureMode/applyFeaturesOnlyConfig
 * declared an extra leading `tenantRef` parameter that NO caller supplied. The
 * single real argument bound to `tenantRef`, leaving the real value undefined —
 * so `setFeatureMode('none')` rejected with "Invalid mode 'undefined'" and a
 * Shopify merchant choosing "Channel hub" / "Back-office only" was permanently
 * trapped in the wizard, never reaching the admin dashboard.
 */
const assert = require('assert');
const MastDB = require('../shared/mastdb.js');

let pass = 0;
const tests = [];
function t(name, fn) { tests.push({ name, fn }); }
console.log('MastDB.businessEntity feature-mode writers');

// Fake tenant store: capture the multiUpdate payload, resolve like Firestore.
function makeFakeStore() {
  const store = { lastUpdate: null, calls: 0 };
  store.multiUpdate = function(updates) {
    store.calls++;
    store.lastUpdate = updates;
    return Promise.resolve();
  };
  return store;
}

const be = MastDB.businessEntity;

// ── setFeatureMode ───────────────────────────────────────────────────────────

t("setFeatureMode('none') resolves (no 'Invalid mode undefined')", async () => {
  const store = makeFakeStore();
  MastDB.__setTenantStoreForTest(store);
  const res = await be.setFeatureMode('none');
  assert.strictEqual(res.featureMode, 'none');
  assert.strictEqual(store.calls, 1);
  assert.strictEqual(store.lastUpdate['admin/businessEntity/presence/featureMode'], 'none');
  // 'none' clears the webPresence feature flags.
  assert.strictEqual(store.lastUpdate['webPresence/config/features'].shop, false);
});

t("setFeatureMode('full-storefront') is a resolved no-op", async () => {
  MastDB.__setTenantStoreForTest(makeFakeStore());
  const res = await be.setFeatureMode('full-storefront');
  assert.strictEqual(res.featureMode, 'full-storefront');
});

t('setFeatureMode rejects a genuinely invalid mode', async () => {
  MastDB.__setTenantStoreForTest(makeFakeStore());
  await assert.rejects(() => be.setFeatureMode('bogus'), /Invalid mode 'bogus'/);
});

t('setFeatureMode rejects undefined (defends the regression directly)', async () => {
  MastDB.__setTenantStoreForTest(makeFakeStore());
  // The OLD bug effectively called this with mode===undefined. The validator
  // must still reject it loudly rather than silently writing garbage.
  await assert.rejects(() => be.setFeatureMode(undefined), /Invalid mode 'undefined'/);
});

// ── applyFeaturesOnlyConfig ──────────────────────────────────────────────────

t('applyFeaturesOnlyConfig(array) resolves + writes features-only', async () => {
  const store = makeFakeStore();
  MastDB.__setTenantStoreForTest(store);
  const res = await be.applyFeaturesOnlyConfig(['surveys', 'gift-cards']);
  assert.strictEqual(res.featureMode, 'features-only');
  assert.deepStrictEqual(res.enabledFeaturePages, ['surveys', 'gift-cards']);
  assert.strictEqual(store.lastUpdate['admin/businessEntity/presence/featureMode'], 'features-only');
  assert.strictEqual(store.lastUpdate['webPresence/config/features'].surveys, true);
  assert.strictEqual(store.lastUpdate['webPresence/config/features'].giftCards, true);
  assert.strictEqual(store.lastUpdate['webPresence/config/features'].blog, false);
});

t('applyFeaturesOnlyConfig(non-array) rejects', async () => {
  MastDB.__setTenantStoreForTest(makeFakeStore());
  // A bare string (the shape the old arity bug produced for the no-features
  // path) must reject — never be misread as a tenant ref.
  await assert.rejects(() => be.applyFeaturesOnlyConfig('surveys'), /enabledPages must be an array/);
});

t('applyFeaturesOnlyConfig([]) resolves (deselect-all is valid)', async () => {
  MastDB.__setTenantStoreForTest(makeFakeStore());
  const res = await be.applyFeaturesOnlyConfig([]);
  assert.strictEqual(res.featureMode, 'features-only');
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
