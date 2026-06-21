/**
 * Engine-hardening tests for shared/product-readiness.core.js — the CANONICAL,
 * SHA-locked (cross-repo) product publish-gate. It decides whether a product can be
 * promoted to "ready": HARD gates (defined / costed / listingReady) BLOCK the
 * transition; SOFT gates (channeled / capacityPlanned) inform but don't block. A
 * regression here either blocks shippable products or lets unshippable ones publish.
 *
 * Pure module (no I/O/DOM) — loaded into a vm sandbox; it assigns
 * `MastProductReadiness` onto the context global.
 *
 * Run: node test/product-readiness.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../shared/product-readiness.core.js'), 'utf8');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const PR = sandbox.MastProductReadiness;

// vm-sandbox objects live in a different realm → deepStrictEqual fails the
// prototype reference-equality check even when structurally identical. Normalize
// to this realm via a JSON round-trip before comparing.
function rt(x) { return JSON.parse(JSON.stringify(x)); }

test('checklist (build): every gate passes for a complete build product', () => {
  const product = { acquisitionType: 'build', totalCost: 1500, name: 'Vase', description: 'A nice vase', images: ['img1'], internalStorefrontOnly: true, capacitySkipped: true };
  const recipe = { lineItems: { a: { qty: 1 } }, wholesaleMarkup: 2, directMarkup: 2.5, retailMarkup: 3 };
  assert.deepStrictEqual(rt(PR.computeReadinessChecklist(product, recipe)), { defined: true, costed: true, channeled: true, capacityPlanned: true, listingReady: true });
});

test("'defined' is mode-specific: build=recipe lineItems / var=components|valueAddSteps / resell=supplier+unitCost", () => {
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'build' }, { lineItems: {} }).defined, false);
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'build' }, { lineItems: { a: 1 } }).defined, true);
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'var', defineSpec: { var: { components: ['c'] } } }, null).defined, true);
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'var', defineSpec: { var: { valueAddSteps: ['s'] } } }, null).defined, true);
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'var', defineSpec: { var: {} } }, null).defined, false);
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'resell', defineSpec: { resell: { supplier: { supplierName: 'S', unitCost: 5 } } } }, null).defined, true);
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'resell', defineSpec: { resell: { supplier: { supplierName: 'S', unitCost: 0 } } } }, null).defined, false);
});

test("'costed' requires totalCost>0 AND a markup config", () => {
  const r = { lineItems: { a: 1 }, wholesaleMarkup: 2 };
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'build', totalCost: 0 }, r).costed, false);
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'build', totalCost: 100 }, { lineItems: { a: 1 } }).costed, false); // no markup
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'build', totalCost: 100 }, r).costed, true);
});

test("'channeled' true via external ref OR internalStorefrontOnly OR channelSyncEnabled", () => {
  const base = { acquisitionType: 'build' };
  assert.strictEqual(PR.computeReadinessChecklist(base, null).channeled, false);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({ externalRefs: { shopify: { externalId: 'x' } } }, base), null).channeled, true);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({ externalRefs: { etsy: { syncEnabled: true } } }, base), null).channeled, true);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({ internalStorefrontOnly: true }, base), null).channeled, true);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({ channelSyncEnabled: true }, base), null).channeled, true);
});

test("'capacityPlanned' true via skipped OR leadTime OR batchSize (product or recipe)", () => {
  const base = { acquisitionType: 'build' };
  assert.strictEqual(PR.computeReadinessChecklist(base, null).capacityPlanned, false);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({ capacitySkipped: true }, base), null).capacityPlanned, true);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({ leadTimeDays: 3 }, base), null).capacityPlanned, true);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({ batchSize: 10 }, base), null).capacityPlanned, true);
  assert.strictEqual(PR.computeReadinessChecklist(base, { batchSize: 10 }).capacityPlanned, true);
});

test("'listingReady' requires name AND image AND description (all three)", () => {
  const ok = { acquisitionType: 'build', name: 'V', images: ['i'], description: 'd' };
  assert.strictEqual(PR.computeReadinessChecklist(ok, null).listingReady, true);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({}, ok, { name: '   ' }), null).listingReady, false);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({}, ok, { images: [] }), null).listingReady, false);
  assert.strictEqual(PR.computeReadinessChecklist(Object.assign({}, ok, { description: '' }), null).listingReady, false);
  // imageIds counts as an image; shortDescription counts as a description
  assert.strictEqual(PR.computeReadinessChecklist({ acquisitionType: 'build', name: 'V', imageIds: ['id'], shortDescription: 's' }, null).listingReady, true);
});

test('verdict: ready iff all HARD gates pass; SOFT-gate failures never block', () => {
  const v = PR.readinessVerdict({ defined: true, costed: true, listingReady: true, channeled: false, capacityPlanned: false });
  assert.strictEqual(v.ready, true, 'soft-gate failures must NOT block a transition');
  assert.deepStrictEqual(rt(v.failedHard), []);
  assert.deepStrictEqual(rt(v.failedSoft).sort(), ['capacityPlanned', 'channeled']);

  const v2 = PR.readinessVerdict({ defined: true, costed: false, listingReady: true, channeled: true, capacityPlanned: true });
  assert.strictEqual(v2.ready, false, 'a hard-gate failure blocks');
  assert.deepStrictEqual(rt(v2.failedHard), ['costed']);
});

test('HARD_GATES / SOFT_GATES partition the 5 gates exactly (the publish-blocking contract)', () => {
  assert.deepStrictEqual(rt(PR.HARD_GATES), ['defined', 'costed', 'listingReady']);
  assert.deepStrictEqual(rt(PR.SOFT_GATES), ['channeled', 'capacityPlanned']);
  const allGateKeys = rt(PR.READINESS_GATES.map(function (g) { return g.key; })).sort();
  assert.deepStrictEqual(rt(PR.HARD_GATES.concat(PR.SOFT_GATES)).sort(), allGateKeys, 'every gate is classified exactly once');
});

test('describeFailures maps gate keys → {key,label,hint}', () => {
  const d = PR.describeFailures(['costed', 'listingReady']);
  assert.strictEqual(d.length, 2);
  assert.strictEqual(d[0].key, 'costed');
  assert.ok(d[0].label && d[0].hint, 'each failure carries a human label + hint');
});

test('productMarkupConfig: build reads recipe markup; non-build reads product.markupConfig', () => {
  assert.deepStrictEqual(rt(PR.productMarkupConfig({ acquisitionType: 'build' }, { wholesaleMarkup: 2 })), { wholesaleMarkup: 2, directMarkup: 0, retailMarkup: 0 });
  assert.strictEqual(PR.productMarkupConfig({ acquisitionType: 'build' }, {}), null);
  assert.deepStrictEqual(rt(PR.productMarkupConfig({ acquisitionType: 'resell', markupConfig: { retailMarkup: 3 } }, null)), { wholesaleMarkup: 0, directMarkup: 0, retailMarkup: 3 });
  assert.strictEqual(PR.productMarkupConfig(null, null), null);
});
