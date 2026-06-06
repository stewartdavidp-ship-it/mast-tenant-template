/**
 * Regression tests for shared/variant-reconcile.js — the canonical helper that
 * keeps a product's `variants` array consistent when its `options` (attributes)
 * are edited.
 *
 * Context: `MakerProductBridge.setOptions` used to write the new options array
 * without ever reconciling existing variants. Removing or renaming an attribute
 * or one of its choices silently orphaned any variant whose combo referenced the
 * gone key/value: `missingCombos()` then re-offered that combination (operator
 * re-adds → duplicate variant) and `comboSig` no longer aligned so the variant
 * rendered with a stale label. The bridge now calls findOrphans/pruneOrphans and
 * prunes behind a confirm guard.
 *
 * These tests pin: (1) removing an attribute orphans its variants; (2) removing a
 * choice orphans only the variants using it; (3) renaming (= remove + add) is
 * treated as a removal; (4) ADDING an attribute/choice is additive and orphans
 * nothing; (5) orphans/pruning are keyed by stable id, never array index.
 *
 * Run: node test/variant-reconcile.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const VR = require('../shared/variant-reconcile.js');

// size × color, all four combos materialized as variants with stable ids.
const OPTS_2D = [
  { label: 'Size', choices: ['small', 'large'] },
  { label: 'Color', choices: ['red', 'blue'] }
];
const VARIANTS_2D = [
  { id: 'v_a', combo: { size: 'small', color: 'red' }, priceCents: 1000 },
  { id: 'v_b', combo: { size: 'small', color: 'blue' } },
  { id: 'v_c', combo: { size: 'large', color: 'red' } },
  { id: 'v_d', combo: { size: 'large', color: 'blue' } }
];

test('no change → no orphans', () => {
  assert.deepStrictEqual(VR.findOrphans(VARIANTS_2D, OPTS_2D), []);
  assert.strictEqual(VR.pruneOrphans(VARIANTS_2D, OPTS_2D).length, 4);
});

test('removing an attribute orphans every variant that used it', () => {
  const next = [{ label: 'Size', choices: ['small', 'large'] }]; // Color removed
  const orphans = VR.findOrphans(VARIANTS_2D, next);
  // All four reference `color`, which no longer exists → all four orphaned.
  assert.strictEqual(orphans.length, 4);
  assert.deepStrictEqual(orphans.map(o => o.id).sort(), ['v_a', 'v_b', 'v_c', 'v_d']);
  assert.strictEqual(VR.pruneOrphans(VARIANTS_2D, next).length, 0);
});

test('removing a choice orphans only the variants using that choice', () => {
  const next = [
    { label: 'Size', choices: ['small', 'large'] },
    { label: 'Color', choices: ['red'] } // 'blue' removed
  ];
  const orphans = VR.findOrphans(VARIANTS_2D, next);
  assert.deepStrictEqual(orphans.map(o => o.id).sort(), ['v_b', 'v_d']);
  const kept = VR.pruneOrphans(VARIANTS_2D, next);
  assert.deepStrictEqual(kept.map(v => v.id).sort(), ['v_a', 'v_c']);
});

test('renaming an attribute is treated as removal (combo key no longer matches)', () => {
  const next = [
    { label: 'Dimension', choices: ['small', 'large'] }, // Size → Dimension
    { label: 'Color', choices: ['red', 'blue'] }
  ];
  // combos still key by `size`, which the renamed options don't define → all orphaned.
  assert.strictEqual(VR.findOrphans(VARIANTS_2D, next).length, 4);
});

test('renaming a choice is treated as removal of that choice', () => {
  const next = [
    { label: 'Size', choices: ['small', 'large'] },
    { label: 'Color', choices: ['crimson', 'blue'] } // red → crimson
  ];
  assert.deepStrictEqual(VR.findOrphans(VARIANTS_2D, next).map(o => o.id).sort(), ['v_a', 'v_c']);
});

test('ADDING a choice is additive — orphans nothing', () => {
  const next = [
    { label: 'Size', choices: ['small', 'large', 'medium'] }, // +medium
    { label: 'Color', choices: ['red', 'blue'] }
  ];
  assert.deepStrictEqual(VR.findOrphans(VARIANTS_2D, next), []);
});

test('ADDING a new attribute is additive — existing variants are NOT nuked', () => {
  // Regression guard: a variant merely missing a newly-added option key must not
  // be flagged. (Strict equal-to-Cartesian-product matching would wrongly nuke
  // all existing variants here.)
  const next = OPTS_2D.concat([{ label: 'Finish', choices: ['matte', 'gloss'] }]);
  assert.deepStrictEqual(VR.findOrphans(VARIANTS_2D, next), []);
  assert.strictEqual(VR.pruneOrphans(VARIANTS_2D, next).length, 4);
});

test('orphan labels prefer variant.name, else combo values', () => {
  const variants = [
    { id: 'v1', combo: { color: 'blue' }, name: 'Midnight Edition' },
    { id: 'v2', combo: { color: 'blue' } }
  ];
  const next = [{ label: 'Color', choices: ['red'] }]; // blue removed → both orphaned
  const byId = Object.fromEntries(VR.findOrphans(variants, next).map(o => [o.id, o.label]));
  assert.strictEqual(byId.v1, 'Midnight Edition');
  assert.strictEqual(byId.v2, 'blue');
});

test('matching is keyed by id, not array index — reordered variants prune correctly', () => {
  // Same variants, shuffled order. The orphan set must follow the data (combo),
  // not positions — the `v.id || "v"+i` index footgun would mis-target here.
  const shuffled = [VARIANTS_2D[3], VARIANTS_2D[1], VARIANTS_2D[2], VARIANTS_2D[0]];
  const next = [
    { label: 'Size', choices: ['small', 'large'] },
    { label: 'Color', choices: ['red'] } // blue removed → v_b, v_d
  ];
  assert.deepStrictEqual(VR.findOrphans(shuffled, next).map(o => o.id).sort(), ['v_b', 'v_d']);
  assert.deepStrictEqual(VR.pruneOrphans(shuffled, next).map(v => v.id).sort(), ['v_a', 'v_c']);
});

test('a variant with no combo is never orphaned', () => {
  const variants = [{ id: 'v_default' }, { id: 'v_c', combo: { color: 'red' } }];
  const next = []; // all options removed
  assert.deepStrictEqual(VR.findOrphans(variants, next).map(o => o.id), ['v_c']);
});

test('comboSig is order-independent and aligns with the stored shape', () => {
  assert.strictEqual(
    VR.comboSig({ size: 'small', color: 'red' }),
    VR.comboSig({ color: 'red', size: 'small' })
  );
});
