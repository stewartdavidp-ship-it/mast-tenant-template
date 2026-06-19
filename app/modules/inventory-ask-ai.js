/**
 * Inventory Ask-AI surface — the per-page Ask-AI registration + context builder
 * for the Inventory screen.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §1,
 * Track 1 — recipe B, a self-contained zero-caller leaf). It registers the
 * 'inventory' Ask-AI surface (title/placeholder/notes + buildContext aggregator)
 * and paints the "✨ Ask AI" slot button on the Inventory page.
 *
 * Lazy-loaded on demand: the shell keeps eager `mastaskai:ready` /
 * `mastaskai:configchanged` listeners that loadModule('inventoryAskAi') then call
 * the *Impl exports. Those events fire from MastAskAi.init() (once, after the
 * gating config loads), so the eager listeners must stay in the shell to catch
 * them — the module supplies only the impls.
 *
 * Reads eager shell globals only (all defined before a user can reach Inventory
 * and all typeof-guarded): MastAskAi, productsData, inventory, getInventoryTotals,
 * document. Defines no shared state other code reads. All logic moved VERBATIM
 * (behavior-preserving).
 */
(function () {
  'use strict';

function paintInventoryAskAiSlot() {
  var slot = document.getElementById('inventoryAskAiSlot');
  if (!slot) return;
  if (window.MastAskAi && window.MastAskAi.isEnabled()) {
    slot.innerHTML = '<button class="btn btn-secondary" onclick="MastAskAi.open(\'inventory\')" title="Ask Claude about your inventory">✨ Ask AI</button>';
  } else {
    slot.innerHTML = '';
  }
}

function _registerInventoryAskAiSurface() {
  if (!window.MastAskAi || !window.MastAskAi.register) return;
  if (window.MastAskAi._registry && window.MastAskAi._registry.inventory) return;
  window.MastAskAi.register('inventory', _inventoryAskAiConfig);
}

var _inventoryAskAiConfig = {
    title: 'Ask AI about your inventory',
    placeholder: 'e.g. Which products are out of stock or low? What is sitting on the shelf? Which haven\'t been counted in 60+ days?',
    notes: [
      'Money values use cents (priceCents on each product); quantities are whole units.',
      'Stock types: in-stock / strict / limited (true inventory tracked), stock-to-build (kept on hand but built when reordered), build-to-order / made-to-order (BTO — never "out of stock", just lead time).',
      'Health buckets reflect last-counted recency: green = within 30 days, yellow = 31-60, red = 60+ or never. BTO products are excluded from health (stockType=none).',
      'available = onHand - committed; if a product has variants, those values aggregate across all variant SKUs.',
      'topProductsBySpend lists products sorted by available × priceCents (potential revenue sitting on the shelf).',
      'lowOrOut surfaces specifically the products the operator should restock; capped at the worst 20.'
    ],
    buildContext: function() {
      if (typeof productsData === 'undefined' || !productsData || !productsData.length) {
        return { route: '/app#inventory', pageTitle: 'Inventory', aggregates: { rowCount: 0 }, note: 'Inventory data not loaded yet.' };
      }
      var totalProducts = productsData.length;
      var totalOnHand = 0, totalCommitted = 0;
      var byStockType = {};
      var byHealth = { green: 0, yellow: 0, red: 0, never: 0, none: 0 };
      var lowOrOut = [];
      var topByValue = [];

      productsData.forEach(function(p) {
        var inv = (typeof inventory !== 'undefined' && inventory[p.pid]) ? inventory[p.pid] : {};
        var totals = (typeof getInventoryTotals === 'function') ? getInventoryTotals(inv) : { onHand: 0, available: 0, committed: 0 };
        var stockType = inv.stockType || 'made-to-order';
        var threshold = inv.lowStockThreshold || 2;
        var isBTO = (stockType === 'build-to-order' || stockType === 'made-to-order');

        totalOnHand += totals.onHand;
        totalCommitted += totals.committed;
        if (!byStockType[stockType]) byStockType[stockType] = { count: 0, totalOnHand: 0 };
        byStockType[stockType].count++;
        byStockType[stockType].totalOnHand += totals.onHand;

        var stock = (inv && inv.stock) ? inv.stock : {};
        var lastCounted = (stock._default && stock._default.lastCountedAt) ? stock._default.lastCountedAt : null;
        if (isBTO) {
          byHealth.none++;
        } else if (!lastCounted) {
          byHealth.never++;
        } else {
          var days = Math.floor((Date.now() - new Date(lastCounted).getTime()) / 86400000);
          if (days <= 30) byHealth.green++;
          else if (days <= 60) byHealth.yellow++;
          else byHealth.red++;
        }

        if (!isBTO) {
          var status = null;
          if (totals.available <= 0) status = 'out_of_stock';
          else if (totals.available <= threshold) status = 'low';
          if (status) {
            lowOrOut.push({
              product: p.name,
              status: status,
              available: totals.available,
              onHand: totals.onHand,
              committed: totals.committed,
              threshold: threshold,
              stockType: stockType,
              priceUSD: p.priceCents ? +(p.priceCents / 100).toFixed(2) : null
            });
          }
        }

        var valueCents = (p.priceCents || 0) * Math.max(0, totals.available);
        if (valueCents > 0) {
          topByValue.push({
            product: p.name,
            available: totals.available,
            priceUSD: p.priceCents ? +(p.priceCents / 100).toFixed(2) : null,
            potentialRevenueUSD: +(valueCents / 100).toFixed(2),
            stockType: stockType
          });
        }
      });

      lowOrOut.sort(function(a, b) {
        if (a.status !== b.status) return a.status === 'out_of_stock' ? -1 : 1;
        return a.available - b.available;
      });
      topByValue.sort(function(a, b) { return b.potentialRevenueUSD - a.potentialRevenueUSD; });

      return {
        route: '/app#inventory',
        pageTitle: 'Inventory',
        aggregates: {
          rowCount: totalProducts,
          totalOnHand: totalOnHand,
          totalCommitted: totalCommitted,
          totalAvailable: totalOnHand - totalCommitted,
          byStockType: byStockType,
          byHealth: byHealth
        },
        lowOrOut: lowOrOut.slice(0, 20),
        topProductsByPotentialRevenue: topByValue.slice(0, 15)
      };
    }
};

  // Impls for the eager `mastaskai:*` listener shims in index.html (*Impl suffix
  // so the shim name and the export never collide).
  window._registerInventoryAskAiSurfaceImpl = _registerInventoryAskAiSurface;
  window.paintInventoryAskAiSlotImpl = paintInventoryAskAiSlot;
  // The slot button's onclick references MastAskAi (a global already), so no
  // extra HTML-onclick export is needed beyond the two impls above.

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('inventoryAskAi', {});
  }
})();
