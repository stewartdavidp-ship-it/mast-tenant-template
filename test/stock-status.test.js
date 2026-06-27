/**
 * Regression tests for shared/stock-status.core.js — the CANONICAL low/out-of-
 * stock classifier shared by the Products-page filter pills, the Inventory
 * overview table, the Dashboard "Low Inventory" card and the storefront
 * availability badge (shop.html / product.html).
 *
 * Before this helper, each surface re-derived "is this out / low" inline and
 * drifted (audit findings F16/F17/F17b/F22): the Dashboard counted build-to-
 * order products and a 28-unit in-stock variant product as "Out of stock",
 * while the Products page (correct) showed only the real stock-tracked
 * shortage. These tests pin the one rule everyone now reads.
 *
 * Run: node test/stock-status.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const SS = require('../shared/stock-status.core.js');

function status(opts) { return SS.classify(opts).status; }

test('strict/in-stock/limited: out at <=0, low at <=threshold, else in', () => {
  ['strict', 'in-stock', 'limited'].forEach((t) => {
    assert.strictEqual(status({ stockType: t, available: 0 }), 'out', t + ' @0');
    assert.strictEqual(status({ stockType: t, available: -3 }), 'out', t + ' @neg');
    assert.strictEqual(status({ stockType: t, available: 2 }), 'low', t + ' @threshold(default 2)');
    assert.strictEqual(status({ stockType: t, available: 1 }), 'low', t + ' @1');
    assert.strictEqual(status({ stockType: t, available: 3 }), 'in', t + ' @above');
  });
});

test('lowStockThreshold override is honored', () => {
  assert.strictEqual(status({ stockType: 'strict', available: 5, lowStockThreshold: 5 }), 'low');
  assert.strictEqual(status({ stockType: 'strict', available: 6, lowStockThreshold: 5 }), 'in');
  // 0 / missing threshold falls back to the default of 2 (matches the old `|| 2`).
  assert.strictEqual(status({ stockType: 'strict', available: 2, lowStockThreshold: 0 }), 'low');
  assert.strictEqual(SS.classify({ stockType: 'strict', available: 9 }).threshold, 2);
});

test('F16: build-to-order / made-to-order are NEVER out or low (status na)', () => {
  ['build-to-order', 'made-to-order'].forEach((t) => {
    assert.strictEqual(status({ stockType: t, available: 0 }), 'na', t + ' @0 must not alarm');
    assert.strictEqual(status({ stockType: t, available: 50 }), 'na', t + ' @50');
    assert.strictEqual(SS.isOut({ stockType: t, available: 0 }), false);
    assert.strictEqual(SS.isLow({ stockType: t, available: 1 }), false);
    assert.strictEqual(SS.isAlert({ stockType: t, available: 0 }), false);
  });
});

test('stock-to-build: low while stocked, made-to-order (na) at 0 — never out', () => {
  assert.strictEqual(status({ stockType: 'stock-to-build', available: 0 }), 'na', 'STB @0 falls back to made-to-order');
  assert.strictEqual(status({ stockType: 'stock-to-build', available: -1 }), 'na', 'STB negative');
  assert.strictEqual(status({ stockType: 'stock-to-build', available: 2 }), 'low', 'STB @threshold');
  assert.strictEqual(status({ stockType: 'stock-to-build', available: 9 }), 'in', 'STB stocked');
  assert.strictEqual(SS.isOut({ stockType: 'stock-to-build', available: 0 }), false);
});

test('F17b/F22: a 28-unit in-stock product is NOT out; aggregate>0 means in stock', () => {
  // Artisan Wine Glass Set (test-wine-glass-set): 28 units in stock.
  assert.strictEqual(status({ stockType: 'in-stock', available: 28 }), 'in');
  // One sold-out variant (Oversized=0) alongside Standard(5)+Large(2): the
  // caller rolls up to aggregate available = 7, so the whole product is in
  // stock — NOT "out". (Aggregate<=0 holds iff EVERY variant is 0.)
  assert.strictEqual(status({ stockType: 'strict', available: 5 + 2 + 0 }), 'in');
  // Only when every variant is 0 does aggregate reach 0 → out.
  assert.strictEqual(status({ stockType: 'strict', available: 0 + 0 + 0 }), 'out');
});

test('unknown/missing stockType: backstop — stock-bearing -> strict, else made-to-order', () => {
  // Has stock → treat as strict so a real stock-out is never hidden.
  assert.strictEqual(status({ stockType: undefined, available: 9 }), 'in');
  assert.strictEqual(status({ stockType: 'weird', available: 9 }), 'in');
  assert.strictEqual(status({ stockType: 'weird', available: 1, lowStockThreshold: 5 }), 'low');
  // No stock and unconfigured → made-to-order (no false alarm).
  assert.strictEqual(status({ stockType: undefined, available: 0 }), 'na');
});

test('isOut / isLow / isAlert convenience predicates', () => {
  assert.strictEqual(SS.isOut({ stockType: 'strict', available: 0 }), true);
  assert.strictEqual(SS.isLow({ stockType: 'strict', available: 1 }), true);
  assert.strictEqual(SS.isAlert({ stockType: 'strict', available: 1 }), true);
  assert.strictEqual(SS.isAlert({ stockType: 'strict', available: 9 }), false);
});

test('classify echoes normalized inputs', () => {
  const c = SS.classify({ stockType: 'strict', available: '4', lowStockThreshold: '3' });
  assert.strictEqual(c.available, 4);
  assert.strictEqual(c.threshold, 3);
  assert.strictEqual(c.tracked, true);
  assert.strictEqual(c.status, 'in');
});
