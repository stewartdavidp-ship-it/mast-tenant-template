/**
 * Regression test: the onboarding wizard must NEVER block a fresh tenant from
 * reaching the dashboard.
 * Run: node test/wizard-launch-never-blocks.test.js
 *
 * A real Shopify App Store reviewer provisions a brand-new tenant and may fill
 * in nothing. Before this fix, the final "Launch Dashboard" step called
 * businessEntity.activate(), which rejected with `missingFields` whenever any
 * spec-§3 required field was blank — trapping the reviewer in the wizard in a
 * loop. The fix: activate({ force: true }) activates the tenant regardless and
 * RETURNS the blank fields (so the dashboard can flag them as non-blocking
 * to-dos) instead of throwing. This guards that contract:
 *   1. force-activate with an EMPTY entity → resolves active, reports every gap.
 *   2. the un-forced gate is preserved for strict/non-wizard callers.
 *   3. force-activate with a COMPLETE entity → resolves active, zero gaps.
 */
const assert = require('assert');
const MastDB = require('../shared/mastdb.js');

let pass = 0;
const tests = [];
function t(name, fn) { tests.push({ name, fn }); }
console.log('Wizard launch never blocks (businessEntity.activate force mode)');

// Fake tenant store: `get` returns a preset entity; `multiUpdate` captures writes.
function makeFakeStore(entity) {
  const store = { lastUpdate: null, calls: 0, entity: entity || null };
  store.get = function() { return Promise.resolve(store.entity); };
  store.multiUpdate = function(updates) {
    store.calls++;
    store.lastUpdate = updates;
    return Promise.resolve();
  };
  return store;
}

const be = MastDB.businessEntity;

// A fully-populated entity that satisfies every REQUIRED_AT_ACTIVATE field.
function completeEntity() {
  return {
    identity:    { archetype: 'jeweler', businessName: 'Acme Co' },
    people:      { primaryContact: { name: 'Jo', email: 'jo@acme.test', dpaAcceptedAt: '2026-06-12T00:00:00Z' } },
    engagement:  { mode: 'storefront', surface: 'hybrid' },
    operations:  { localization: { currency: 'USD', timezone: 'America/New_York', language: 'en', fiscalYearStartMonth: 1 } }
  };
}

// 1 — the reviewer's worst case: nothing filled, force-activate.
t('activate({force:true}) on an EMPTY entity resolves active + lists every gap', async () => {
  const store = makeFakeStore({});           // brand-new tenant, no fields
  MastDB.__setTenantStoreForTest(store);
  const res = await be.activate({ force: true });
  assert.strictEqual(res.success, true);
  assert.strictEqual(res.entityStatus, 'active');                         // they GET IN
  assert.strictEqual(store.lastUpdate['admin/businessEntity/entityStatus'], 'active');
  assert.ok(Array.isArray(res.missingFields), 'missingFields is an array');
  // Every required field should be reported back for the dashboard checklist.
  assert.strictEqual(res.missingFields.length, 11);
  assert.ok(res.missingFields.indexOf('identity.businessName') >= 0);
  assert.ok(res.missingFields.indexOf('operations.localization.currency') >= 0);
});

// 2 — the strict gate is preserved for any non-wizard caller (no force).
t('activate() without force still REJECTS on missing fields (gate preserved)', async () => {
  MastDB.__setTenantStoreForTest(makeFakeStore({}));
  await assert.rejects(
    () => be.activate(),
    (err) => { assert.ok(Array.isArray(err.missingFields) && err.missingFields.length === 11); return true; }
  );
});

// 3 — a fully-filled tenant force-activates with zero gaps.
t('activate({force:true}) on a COMPLETE entity resolves active + zero gaps', async () => {
  const store = makeFakeStore(completeEntity());
  MastDB.__setTenantStoreForTest(store);
  const res = await be.activate({ force: true });
  assert.strictEqual(res.entityStatus, 'active');
  assert.deepStrictEqual(res.missingFields, []);
});

// 4 — a complete tenant also passes the UN-forced gate (force changes nothing
//     when there is nothing to skip).
t('activate() (no force) on a COMPLETE entity resolves active', async () => {
  MastDB.__setTenantStoreForTest(makeFakeStore(completeEntity()));
  const res = await be.activate();
  assert.strictEqual(res.entityStatus, 'active');
  assert.deepStrictEqual(res.missingFields, []);
});

// 5 — whitespace-only business name counts as a gap (not a real value).
t('whitespace-only businessName is reported as a gap under force', async () => {
  const ent = completeEntity();
  ent.identity.businessName = '   ';
  MastDB.__setTenantStoreForTest(makeFakeStore(ent));
  const res = await be.activate({ force: true });
  assert.strictEqual(res.entityStatus, 'active');
  assert.ok(res.missingFields.indexOf('identity.businessName') >= 0);
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
