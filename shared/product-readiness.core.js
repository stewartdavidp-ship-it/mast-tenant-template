/* MAST product readiness — CANONICAL. Byte-identical in:
 *   mast-tenant-template/app/shared/product-readiness.core.js
 *   mast-tenant-mcp-server/src/shared/product-readiness.core.js
 *
 * Parity is enforced by a SHA-256 check in BOTH repos' CI (see each repo's
 * readiness parity check + the MCP fixture test product-readiness.test.ts).
 * To change the gate logic:
 *   1. edit BOTH copies identically,
 *   2. re-bless the SHA constant in both repos' parity checks,
 *   3. bump MAST_MODULES_V in mast-tenant-template (cache-bust guard).
 * See mast-tenant-template/docs/ux-audit/product-publish-gate-plan.md §7.
 *
 * PURE: no I/O, no DOM, no globals beyond the namespace assignment below, and
 * NO recipesData fallback — the caller resolves the recipe and passes it in.
 *
 * Classic-script-safe ES5 IIFE (no import/export/module syntax) so it loads as
 * a browser <script> in the template AND runs as a Node ESM side-effect import
 * in the MCP. It assigns its API onto the global (window in the browser,
 * globalThis in Node) as `MastProductReadiness`.
 */
(function (root) {
  'use strict';

  /** Port of productMarkupConfig (maker.js ~3286). `recipe` already resolved by caller. */
  function productMarkupConfig(product, recipe) {
    if (!product) return null;
    var atype = product.acquisitionType || 'build';
    if (atype === 'build') {
      var r = recipe;
      if (r && (r.wholesaleMarkup || r.directMarkup || r.retailMarkup)) {
        return {
          wholesaleMarkup: Number(r.wholesaleMarkup) || 0,
          directMarkup: Number(r.directMarkup) || 0,
          retailMarkup: Number(r.retailMarkup) || 0
        };
      }
      return null;
    }
    var m = product.markupConfig;
    if (m && (m.wholesaleMarkup || m.directMarkup || m.retailMarkup)) {
      return {
        wholesaleMarkup: Number(m.wholesaleMarkup) || 0,
        directMarkup: Number(m.directMarkup) || 0,
        retailMarkup: Number(m.retailMarkup) || 0
      };
    }
    return null;
  }

  /** Port of computeReadinessChecklist (maker.js ~3321). Pure. `recipe` resolved by caller. */
  function computeReadinessChecklist(product, recipe) {
    if (!product) {
      return { defined: false, costed: false, channeled: false, capacityPlanned: false, listingReady: false };
    }
    var atype = product.acquisitionType || 'build';
    var r = recipe;

    // defined — mode-specific definition has at least one component/material/supplier
    var defined = false;
    if (atype === 'build') {
      defined = !!(r && r.lineItems && Object.keys(r.lineItems).length > 0);
    } else if (atype === 'var') {
      var spec = (product.defineSpec || {}).var || {};
      defined =
        (Array.isArray(spec.components) && spec.components.length > 0) ||
        (Array.isArray(spec.valueAddSteps) && spec.valueAddSteps.length > 0);
    } else if (atype === 'resell') {
      var rspec = (product.defineSpec || {}).resell || {};
      var supp = rspec.supplier || {};
      defined = !!(supp.supplierName && (Number(supp.unitCost) || 0) > 0);
    }

    // costed — totalCost > 0 AND markup config present
    var totalCents = Number(product.totalCost) || 0;
    var markup = productMarkupConfig(product, r);
    var costed = totalCents > 0 && !!markup;

    // channeled — at least one channel mapping
    var channeled = false;
    if (product.externalRefs) {
      var channels = ['shopify', 'etsy', 'square'];
      for (var i = 0; i < channels.length; i++) {
        var ref = product.externalRefs[channels[i]];
        if (ref && (ref.externalId || ref.syncEnabled)) channeled = true;
      }
    }
    if (!channeled && product.internalStorefrontOnly) channeled = true;
    if (!channeled && product.channelSyncEnabled) channeled = true;

    // capacityPlanned — lead time / batch size set, or explicitly skipped
    var capacityPlanned = false;
    if (product.capacitySkipped) capacityPlanned = true;
    if (!capacityPlanned && (Number(product.leadTimeDays) || 0) > 0) capacityPlanned = true;
    if (!capacityPlanned && atype === 'resell') {
      var rspec2 = (product.defineSpec || {}).resell || {};
      if ((Number(rspec2.leadTimeDays) || 0) > 0) capacityPlanned = true;
    }
    if (!capacityPlanned && r && (Number(r.batchSize) || 0) > 0) capacityPlanned = true;
    if (!capacityPlanned && (Number(product.batchSize) || 0) > 0) capacityPlanned = true;

    // listingReady — name + at least one image + description
    var hasName = !!(product.name && String(product.name).trim());
    var hasImage =
      !!(product.images && product.images.length) || !!(product.imageIds && product.imageIds.length);
    var hasDescription =
      !!(product.description && String(product.description).trim()) ||
      !!(product.shortDescription && String(product.shortDescription).trim());
    var listingReady = hasName && hasImage && hasDescription;

    return {
      defined: !!defined,
      costed: !!costed,
      channeled: !!channeled,
      capacityPlanned: !!capacityPlanned,
      listingReady: !!listingReady
    };
  }

  /** Mirrors the UI readiness panel item defs (maker.js ~3621). Order preserved. */
  var READINESS_GATES = [
    { key: 'defined', label: 'Defined', hint: 'Mode-specific definition (recipe / components / supplier)', required: true },
    { key: 'costed', label: 'Costed', hint: 'Total cost > 0 and markup config present', required: true },
    { key: 'channeled', label: 'Channeled', hint: 'At least one channel mapping (Shopify / Etsy / Square)', required: false },
    { key: 'capacityPlanned', label: 'Capacity planned', hint: 'Lead time, batch size, or explicitly skipped', required: false },
    { key: 'listingReady', label: 'Listing ready', hint: 'Name + image + description', required: true }
  ];

  /** Hard gates that BLOCK a transition (maker.js promoteToReady ~3497). */
  var HARD_GATES = ['defined', 'costed', 'listingReady'];
  var SOFT_GATES = ['channeled', 'capacityPlanned'];

  /** Hard-gate verdict — mirrors the UI `hardPass` (maker.js ~3629). */
  function readinessVerdict(checklist) {
    var failedHard = HARD_GATES.filter(function (k) { return !checklist[k]; });
    var failedSoft = SOFT_GATES.filter(function (k) { return !checklist[k]; });
    return { ready: failedHard.length === 0, failedHard: failedHard, failedSoft: failedSoft, checklist: checklist };
  }

  /** Human-readable "what's missing" line, keyed off the gate labels/hints. */
  function describeFailures(keys) {
    return keys.map(function (k) {
      var g = null;
      for (var i = 0; i < READINESS_GATES.length; i++) {
        if (READINESS_GATES[i].key === k) { g = READINESS_GATES[i]; break; }
      }
      return { key: g.key, label: g.label, hint: g.hint };
    });
  }

  root.MastProductReadiness = {
    productMarkupConfig: productMarkupConfig,
    computeReadinessChecklist: computeReadinessChecklist,
    readinessVerdict: readinessVerdict,
    describeFailures: describeFailures,
    READINESS_GATES: READINESS_GATES,
    HARD_GATES: HARD_GATES,
    SOFT_GATES: SOFT_GATES
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
