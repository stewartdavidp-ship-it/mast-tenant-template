/* MAST stock-status — CANONICAL low/out-of-stock classifier.
 *
 * ONE definition of "is this product out of stock / low on stock", shared by
 * every surface that used to re-derive it inline and drift:
 *   - app/modules/products-engine.js  — the Products-page filter pills
 *     (Low stock / Out of stock counts) AND the Inventory overview table
 *     (stat cards, status badge, quantity-cell color).
 *   - app/index.html                  — the Dashboard "Low Inventory" card.
 *   - shop.html / product.html        — the storefront availability badge
 *     (Sold Out / Only {n} Left / Made to Order).
 *
 * THE RULE (storefront resolveBadge + products-engine _stockBucket, unified):
 *   - Low / out-of-stock applies ONLY to physically stock-tracked modes
 *     (strict / in-stock / limited) at or below their low-stock threshold.
 *   - build-to-order / made-to-order NEVER count as out of stock — they ship
 *     on a lead time, not from a shelf.
 *   - stock-to-build draws down real stock while it has it (so it can be LOW),
 *     but at zero it falls back to made-on-demand — it is NEVER "out".
 *   - A product is "out" only when its AGGREGATE available is <= 0. Because
 *     per-variant available is non-negative, aggregate<=0 holds iff EVERY
 *     variant is 0 — i.e. one sold-out variant alongside in-stock siblings is
 *     NOT a whole-product stock-out. Callers pass the rolled-up available
 *     (getInventoryTotals(inv).available in admin, stockInfo.totalAvailable on
 *     the storefront), so this rule is enforced for free.
 *
 * `available` is the caller's rolled-up available quantity. Pass the SAME
 * aggregate both surfaces already compute — do NOT pass a per-variant figure.
 *
 * PURE: no I/O, no DOM, no globals beyond the namespace assignment below.
 * Classic-script-safe ES5 IIFE (no import/export) so it loads as a browser
 * <script> in the admin shell AND the storefront pages, and runs as a Node
 * require()/side-effect import in tests. Assigns its API onto the global
 * (window in the browser, globalThis in Node) as `MastStockStatus`.
 */
(function (root) {
  'use strict';

  // Physically stock-tracked modes that draw down on a sale. Kept in sync with
  // functions/lib/stock-tracking.js (TRACKED_STOCK_TYPES) and the storefront
  // resolveBadge / admin products-engine vocabularies.
  var TRACKED_STOCK_TYPES = ['strict', 'in-stock', 'limited', 'stock-to-build'];
  var UNTRACKED_STOCK_TYPES = ['made-to-order', 'build-to-order'];
  var DEFAULT_LOW_STOCK_THRESHOLD = 2;

  function inList(list, v) { return list.indexOf(v) !== -1; }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  /**
   * classify({ stockType, available, lowStockThreshold }) -> {
   *   stockType, tracked, available, threshold, status
   * }
   *
   * status:
   *   'out' — stock-tracked (strict/in-stock/limited), aggregate available <= 0
   *   'low' — stock-tracked at or under the low-stock threshold (but > 0)
   *   'in'  — stock-tracked and above threshold
   *   'na'  — no shortage alarm applies: build/made-to-order, or stock-to-build
   *           with no stock left (made on demand). Never "out", never "low".
   *
   * Unknown / missing stockType is resolved with the same safety backstop as
   * stock-tracking.js: if it carries on-hand stock treat it as 'strict' (so we
   * never silently hide a real stock-out); otherwise treat it as made-to-order
   * (so an unconfigured product never raises a false alarm).
   */
  function classify(opts) {
    opts = opts || {};
    var available = num(opts.available);
    var threshold = num(opts.lowStockThreshold);
    if (!(threshold > 0)) threshold = DEFAULT_LOW_STOCK_THRESHOLD;

    var stockType = opts.stockType;
    if (!inList(TRACKED_STOCK_TYPES, stockType) && !inList(UNTRACKED_STOCK_TYPES, stockType)) {
      // Unknown/missing — backstop (mirrors resolveStockTracking).
      stockType = available > 0 ? 'strict' : 'made-to-order';
    }

    var base = { stockType: stockType, available: available, threshold: threshold };

    // Untracked: ship on lead time, never a stock alarm.
    if (inList(UNTRACKED_STOCK_TYPES, stockType)) {
      base.tracked = false;
      base.status = 'na';
      return base;
    }

    base.tracked = true;

    // stock-to-build: low while it has stock, made-to-order once depleted —
    // never "out".
    if (stockType === 'stock-to-build') {
      if (available <= 0) base.status = 'na';
      else if (available <= threshold) base.status = 'low';
      else base.status = 'in';
      return base;
    }

    // strict / in-stock / limited.
    if (available <= 0) base.status = 'out';
    else if (available <= threshold) base.status = 'low';
    else base.status = 'in';
    return base;
  }

  function isOut(x) { return classify(x).status === 'out'; }
  function isLow(x) { return classify(x).status === 'low'; }
  function isAlert(x) { var s = classify(x).status; return s === 'out' || s === 'low'; }

  root.MastStockStatus = {
    classify: classify,
    isOut: isOut,
    isLow: isLow,
    isAlert: isAlert,
    TRACKED_STOCK_TYPES: TRACKED_STOCK_TYPES,
    UNTRACKED_STOCK_TYPES: UNTRACKED_STOCK_TYPES,
    DEFAULT_LOW_STOCK_THRESHOLD: DEFAULT_LOW_STOCK_THRESHOLD
  };

  // CommonJS export for Node tests (browser ignores this).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = root.MastStockStatus;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
