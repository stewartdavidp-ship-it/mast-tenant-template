/**
 * shared/variant-reconcile.js — the single canonical helper for reconciling a
 * product's `variants` array against an edited `options` (attributes) array.
 *
 * Context: a variant's `combo` is keyed by option label lower-cased, e.g.
 * {size:'small', color:'red'}. When an operator REMOVES or RENAMES an attribute
 * or one of its choices, any variant whose combo references the now-gone
 * key/value is silently orphaned — it no longer matches a Cartesian combination,
 * so `missingCombos()` re-offers it (→ duplicate variant) and its label renders
 * stale. The product editor must never let an option edit silently corrupt the
 * variant set, so `MakerProductBridge.setOptions` calls `findOrphans()` and
 * prunes behind a confirm guard.
 *
 * Matching is keyed STRICTLY by the variant's stable `id` (never array index —
 * the `v.id || 'v'+i` index footgun mis-targets writes after any reorder).
 *
 * NOTE: this flags only REMOVAL/RENAME (a combo key/value the new options no
 * longer offer). It deliberately does NOT flag a variant merely missing a
 * NEWLY-ADDED option key — adding an attribute is additive and must not nuke the
 * existing variants.
 */
(function () {
  'use strict';

  // Stable signature for a combo (order-independent). Mirrors products-v2.js
  // comboSig / maker.js _comboSig so the three stay aligned.
  function comboSig(c) {
    return Object.keys(c || {}).sort().map(function (k) { return k + '=' + c[k]; }).join('|');
  }

  // Map of option label (lower-cased) → its choices array, built from the new
  // (post-edit) options. The lower-casing matches how combos are keyed.
  function optionChoiceMap(options) {
    var m = {};
    (Array.isArray(options) ? options : []).forEach(function (o) {
      if (!o || !o.label) return;
      m[String(o.label).toLowerCase()] = Array.isArray(o.choices) ? o.choices : [];
    });
    return m;
  }

  // A combo is broken under `optMap` if it references an attribute key the new
  // options no longer define, OR a choice value that attribute no longer offers.
  function comboBroken(combo, optMap) {
    if (!combo) return false; // a variant with no combo isn't option-derived — leave it
    var keys = Object.keys(combo);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (!Object.prototype.hasOwnProperty.call(optMap, k)) return true; // attribute removed/renamed
      if (optMap[k].indexOf(combo[k]) < 0) return true;                  // choice removed/renamed
    }
    return false;
  }

  // Human label for an orphaned variant (for the confirm prompt). A custom
  // variant.name wins over the auto option-combo label (mirrors variantLabel).
  function variantLabel(v) {
    if (!v) return 'Variant';
    if (v.name) return v.name;
    if (!v.combo) return 'Variant';
    var parts = Object.keys(v.combo).map(function (k) { return v.combo[k]; }).filter(Boolean);
    return parts.length ? parts.join(' / ') : 'Variant';
  }

  // Given the current variants and the NEW options, return the orphans —
  // variants whose combo no longer matches the new option set. Each carries its
  // stable id + a display label so the caller can name them in a confirm.
  function findOrphans(variants, options) {
    var optMap = optionChoiceMap(options);
    return (Array.isArray(variants) ? variants : [])
      .filter(function (v) { return v && comboBroken(v.combo, optMap); })
      .map(function (v) { return { id: v.id, label: variantLabel(v) }; });
  }

  // The reconciled (pruned) variants array: same array minus the orphans,
  // matched by stable id. Variants missing an id are surfaced loudly elsewhere
  // (products-v2 realVariants) — here a null/absent id can't match an orphan id,
  // so a malformed variant is conservatively KEPT rather than wrongly pruned.
  function pruneOrphans(variants, options) {
    var optMap = optionChoiceMap(options);
    return (Array.isArray(variants) ? variants : [])
      .filter(function (v) { return !(v && comboBroken(v.combo, optMap)); });
  }

  var api = {
    comboSig: comboSig,
    optionChoiceMap: optionChoiceMap,
    comboBroken: comboBroken,
    variantLabel: variantLabel,
    findOrphans: findOrphans,
    pruneOrphans: pruneOrphans
  };

  if (typeof window !== 'undefined') {
    window.MastVariantReconcile = api;
  }
  // CommonJS export for node-based unit tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
