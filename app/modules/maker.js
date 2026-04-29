/**
 * Maker Module — Materials Library, BOM/Recipe Builder, Pricing Engine
 * Lazy-loaded via MastAdmin module registry.
 *
 * Session 1: Data layer only (CRUD, calculation engine, costsDirty, activePriceTier).
 * Session 2: Materials UI.
 * Session 3: Recipe/Piece Builder UI.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var materialsData = {};
  var materialsLoaded = false;
  var materialsListener = null;

  var recipesData = {};
  var recipesLoaded = false;
  var recipesListener = null;

  // Phase 2A-2E: volatile pricing state
  var repricingThresholdPct = 15; // refreshed from admin/config/makerSettings on render
  var priceLocksData = {}; // refreshed on demand from admin/priceLocks
  var spotPricesCurrent = null; // refreshed on demand from admin/spotPrices/current

  // Lock helpers (mirror of tenant MCP shared/maker.ts)
  function isLockActive(lock) {
    if (!lock || lock.status !== 'active') return false;
    if (lock.expiresAt && new Date(lock.expiresAt).getTime() < Date.now()) return false;
    if ((lock.qtyConsumed || 0) >= (lock.qtyLocked || 0)) return false;
    return true;
  }
  function recomputeLockStatus(lock) {
    if (!lock) return 'expired';
    if ((lock.qtyConsumed || 0) >= (lock.qtyLocked || 0)) return 'exhausted';
    if (lock.expiresAt && new Date(lock.expiresAt).getTime() < Date.now()) return 'expired';
    return 'active';
  }
  function getActiveLockForMaterial(materialId) {
    var best = null;
    Object.keys(priceLocksData).forEach(function(lid) {
      var lock = priceLocksData[lid];
      if (!lock || lock.materialId !== materialId) return;
      if (!isLockActive(lock)) return;
      if (!best || (lock.createdAt && best.createdAt && lock.createdAt > best.createdAt)) {
        best = Object.assign({ lockId: lid }, lock);
      }
    });
    return best;
  }
  async function loadVolatilePricingData() {
    try {
      var snaps = await Promise.all([
        MastDB.get('admin/config/makerSettings/repricingThresholdPct'),
        MastDB.get('admin/priceLocks'),
        MastDB.get('admin/spotPrices/current')
      ]);
      if (typeof snaps[0] === 'number') repricingThresholdPct = snaps[0];
      priceLocksData = snaps[1] || {};
      spotPricesCurrent = snaps[2] || null;
      // Re-render whichever maker tab is currently visible so the lock table
      // and drift badges pick up the freshly-loaded data.
      if (document.getElementById('materialsTab') && materialsLoaded) renderMaterials();
      if (document.getElementById('piecesTab') && recipesLoaded) renderPieces();
    } catch (err) {
      console.warn('loadVolatilePricingData failed', err);
    }
  }

  // ============================================================
  // Unit of Measure Reference
  // ============================================================

  var UOM_OPTIONS = [
    { value: 'dwt', label: 'DWT (pennyweight)' },
    { value: 'carat', label: 'Carat' },
    { value: 'gram', label: 'Gram' },
    { value: 'count', label: 'Count (each)' },
    { value: 'inch', label: 'Inch' },
    { value: 'foot', label: 'Foot' },
    { value: 'oz', label: 'Ounce (oz)' },
    { value: 'sqin', label: 'Square Inch' },
    { value: 'ml', label: 'Milliliter' },
    { value: 'each', label: 'Each' }
  ];

  // ============================================================
  // Craft Profile Pre-seed Data
  // ============================================================

  var CRAFT_PROFILES = {
    jewelry: {
      categories: ['Metals', 'Stones', 'Findings', 'Wire & Chain', 'Other'],
      defaultMarkups: { wholesale: 2.2, direct: 3.0, retail: 4.4 },
      defaultLaborRate: 100,
      sampleMaterials: [
        { name: '14K Gold Wire', category: 'Metals', unitOfMeasure: 'dwt', unitCost: 175.00 },
        { name: 'Sterling Silver Sheet', category: 'Metals', unitOfMeasure: 'dwt', unitCost: 28.00 },
        { name: 'Amethyst Cabochon 8mm', category: 'Stones', unitOfMeasure: 'carat', unitCost: 1.00 },
        { name: 'Lobster Clasp 10mm', category: 'Findings', unitOfMeasure: 'count', unitCost: 0.35 },
        { name: '20ga Copper Wire', category: 'Wire & Chain', unitOfMeasure: 'inch', unitCost: 0.02 }
      ]
    },
    glass: {
      categories: ['Soft Glass', 'Borosilicate', 'Frit & Powder', 'Tools & Consumables'],
      defaultMarkups: { wholesale: 2.0, direct: 2.5, retail: 4.0 },
      defaultLaborRate: 75,
      sampleMaterials: []
    },
    ceramics: {
      categories: ['Clay', 'Glazes', 'Underglazes', 'Tools & Consumables'],
      defaultMarkups: { wholesale: 2.0, direct: 2.5, retail: 3.5 },
      defaultLaborRate: 60,
      sampleMaterials: []
    },
    fiber: {
      categories: ['Yarn', 'Fabric', 'Thread', 'Dyes', 'Notions'],
      defaultMarkups: { wholesale: 2.0, direct: 2.5, retail: 3.5 },
      defaultLaborRate: 50,
      sampleMaterials: []
    },
    other: {
      categories: ['Raw Materials', 'Consumables', 'Packaging'],
      defaultMarkups: { wholesale: 2.0, direct: 2.5, retail: 3.5 },
      defaultLaborRate: 50,
      sampleMaterials: []
    }
  };

  // ============================================================
  // Calculation Engine — Pure Math
  // ============================================================

  /**
   * Calculate all costs and pricing tiers from recipe inputs.
   * @param {Object} params
   * @param {Object} params.lineItems - keyed by lineItemId: { materialId, quantity, unitCost }
   * @param {number} params.laborRatePerHour - $/hr
   * @param {number} params.laborMinutes - minutes
   * @param {number} params.otherCost - flat dollar amount
   * @param {number} params.wholesaleMarkup - multiplier (e.g. 2.2)
   * @param {number} params.directMarkup - multiplier (e.g. 3.0)
   * @param {number} params.retailMarkup - multiplier (e.g. 4.4)
   * @returns {Object} calculated values
   */
  function calculateRecipe(params) {
    var lineItems = params.lineItems || {};
    var laborRate = params.laborRatePerHour || 0;
    var laborMinutes = params.laborMinutes || 0;
    var otherCost = params.otherCost || 0;
    var setupCost = params.setupCost || 0;
    var batchSize = Math.max(1, params.batchSize || 1);
    var wholesaleMarkup = params.wholesaleMarkup || 1;
    var directMarkup = params.directMarkup || 1;
    var retailMarkup = params.retailMarkup || 1;

    // Calculate material costs from line items
    var totalMaterialCost = 0;
    var calculatedLineItems = {};
    Object.keys(lineItems).forEach(function(liId) {
      var li = lineItems[liId];
      var qty = li.quantity || 0;
      var scrapPct = li.scrapPercent || 0;
      var effectiveQty = roundCents(qty * (1 + scrapPct / 100));
      var cost = li.unitCost || 0;
      var extendedCost = roundCents(effectiveQty * cost);
      totalMaterialCost += extendedCost;
      calculatedLineItems[liId] = Object.assign({}, li, { effectiveQty: effectiveQty, extendedCost: extendedCost });
    });

    totalMaterialCost = roundCents(totalMaterialCost);

    // Labor cost
    var laborCost = roundCents((laborMinutes / 60) * laborRate);

    // Per-unit setup cost (amortized over batch)
    var perUnitSetup = roundCents(setupCost / batchSize);

    // Total cost
    var totalCost = roundCents(totalMaterialCost + laborCost + otherCost + perUnitSetup);

    // Pricing tiers
    var wholesalePrice = roundCents(totalCost * wholesaleMarkup);
    var directPrice = roundCents(totalCost * directMarkup);
    var retailPrice = roundCents(totalCost * retailMarkup);

    // Margin % helper (gross profit / sell price)
    function pct(price) {
      return price > 0 ? roundCents(((price - totalCost) / price) * 100) : 0;
    }

    return {
      lineItems: calculatedLineItems,
      totalMaterialCost: totalMaterialCost,
      laborCost: laborCost,
      perUnitSetup: perUnitSetup,
      totalCost: totalCost,
      wholesalePrice: wholesalePrice,
      wholesaleGrossProfit: roundCents(wholesalePrice - totalCost),
      wholesaleMarginPct: pct(wholesalePrice),
      directPrice: directPrice,
      directGrossProfit: roundCents(directPrice - totalCost),
      directMarginPct: pct(directPrice),
      retailPrice: retailPrice,
      retailGrossProfit: roundCents(retailPrice - totalCost),
      retailMarginPct: pct(retailPrice),
      // Channel-First Phase 1c (D33) — suggestedPrice map mirrors the flat fields above.
      // Consumers should prefer this map; flat fields kept for backwards compat.
      suggestedPrice: { wholesale: wholesalePrice, direct: directPrice, retail: retailPrice }
    };
  }

  /**
   * Round to nearest cent.
   */
  function roundCents(value) {
    return Math.round(value * 100) / 100;
  }

  // ============================================================
  // Sub-assembly Resolver — Multi-level BOM
  // ============================================================

  var SUB_ASSEMBLY_MAX_DEPTH = 3;

  /**
   * Walk a recipe's line items and resolve sub-assembly (kind='recipe')
   * unitCosts from current recipesData. Cycle-safe via visited set; depth-limited.
   * Returns refreshed lineItems map. Sub-assembly cost basis = sub-recipe totalCost
   * (no markup compounding).
   */
  function resolveSubAssemblyCosts(lineItems, visited, depth) {
    visited = visited || {};
    depth = depth || 0;
    var refreshed = {};
    Object.keys(lineItems || {}).forEach(function(liId) {
      var li = lineItems[liId];
      if (li && li.kind === 'recipe') {
        var subId = li.materialId; // for kind=recipe, materialId stores recipeId
        var copy = Object.assign({}, li);
        if (depth >= SUB_ASSEMBLY_MAX_DEPTH) {
          copy.unitCost = 0;
          copy.subAssemblyError = 'max depth ' + SUB_ASSEMBLY_MAX_DEPTH + ' exceeded';
        } else if (visited[subId]) {
          copy.unitCost = 0;
          copy.subAssemblyError = 'cycle detected';
        } else {
          var sub = recipesData[subId];
          if (!sub || sub.status === 'archived') {
            copy.unitCost = 0;
            copy.subAssemblyError = 'sub-recipe missing';
          } else {
            // Recursively resolve the sub-recipe's cost from its own line items
            var nextVisited = Object.assign({}, visited);
            nextVisited[subId] = true;
            var subResolved = resolveSubAssemblyCosts(sub.lineItems || {}, nextVisited, depth + 1);
            var subCalc = calculateRecipe({
              lineItems: subResolved,
              laborRatePerHour: sub.laborRatePerHour || 0,
              laborMinutes: sub.laborMinutes || 0,
              otherCost: sub.otherCost || 0,
              setupCost: sub.setupCost || 0,
              batchSize: sub.batchSize || 1,
              wholesaleMarkup: 1, directMarkup: 1, retailMarkup: 1
            });
            copy.unitCost = subCalc.totalCost;
            copy.materialName = sub.name || copy.materialName || 'Sub-recipe';
            copy.unitOfMeasure = 'each';
            delete copy.subAssemblyError;
          }
        }
        refreshed[liId] = copy;
      } else {
        refreshed[liId] = li;
      }
    });
    return refreshed;
  }

  /**
   * Detect whether adding `candidateRecipeId` as a sub-assembly to `parentRecipeId`
   * would create a cycle. Returns true if a cycle would form.
   */
  function wouldCreateCycle(parentRecipeId, candidateRecipeId) {
    if (parentRecipeId === candidateRecipeId) return true;
    var stack = [candidateRecipeId];
    var seen = {};
    while (stack.length > 0) {
      var rid = stack.pop();
      if (seen[rid]) continue;
      seen[rid] = true;
      if (rid === parentRecipeId) return true;
      var r = recipesData[rid];
      if (!r) continue;
      var lis = r.lineItems || {};
      Object.keys(lis).forEach(function(liId) {
        var li = lis[liId];
        if (li && li.kind === 'recipe' && li.materialId) stack.push(li.materialId);
      });
    }
    return false;
  }

  // ============================================================
  // Materials CRUD
  // ============================================================

  function loadMaterials() {
    // Always refresh volatile data so price-lock table reflects current state.
    loadVolatilePricingData();
    if (materialsListener) return;
    materialsListener = MastDB.materials.listen(500, function(snap) {
      materialsData = snap.val() || {};
      materialsLoaded = true;
      renderMaterials();
    });
  }

  function unloadMaterials() {
    if (materialsListener) {
      MastDB.materials.unlisten(materialsListener);
      materialsListener = null;
    }
    materialsData = {};
    materialsLoaded = false;
  }

  async function createMaterial(data) {
    var id = MastDB.materials.newKey();
    var now = new Date().toISOString();
    var material = {
      materialId: id,
      name: data.name || '',
      category: data.category || '',
      craftProfile: data.craftProfile || 'all',
      status: data.status || 'active',
      unitOfMeasure: data.unitOfMeasure || 'each',
      unitCost: data.unitCost || 0,
      lastPurchaseDate: data.lastPurchaseDate || null,
      lastPurchaseQty: data.lastPurchaseQty || null,
      lastPurchaseTotalCost: data.lastPurchaseTotalCost || null,
      onHandQty: data.onHandQty || 0,
      reorderThreshold: data.reorderThreshold || 0,
      reorderQty: data.reorderQty || 0,
      vendorId: data.vendorId || null,
      vendorSku: data.vendorSku || null,
      leadTimeDays: data.leadTimeDays || null,
      craftAttributes: data.craftAttributes || {},
      pricingMode: data.pricingMode === 'spot-linked' ? 'spot-linked' : 'fixed',
      spotMetal: data.spotMetal || null,
      purity: data.purity != null ? Number(data.purity) : null,
      markupOverSpot: data.markupOverSpot != null ? Number(data.markupOverSpot) : null,
      // Phase 2B: dual-basis costing. On manual create, all three converge.
      bookCost: data.unitCost || 0,
      replacementCost: data.unitCost || 0,
      notes: data.notes || '',
      createdAt: now,
      updatedAt: now
    };
    await MastDB.materials.set(id, material);
    MastAdmin.writeAudit('create', 'material', id);
    return material;
  }

  async function updateMaterial(id, updates) {
    var now = new Date().toISOString();
    updates.updatedAt = now;
    var oldMaterial = materialsData[id];

    // Phase 2B: Manual edits record what the maker actually paid.
    // For non-spot materials, sync all three. For spot-linked, only update bookCost
    // (replacementCost is auto-managed by the daily spot fetch).
    if (oldMaterial && updates.unitCost !== undefined && updates.unitCost !== oldMaterial.unitCost) {
      if (updates.bookCost === undefined) updates.bookCost = updates.unitCost;
      if (updates.replacementCost === undefined && oldMaterial.pricingMode !== 'spot-linked') {
        updates.replacementCost = updates.unitCost;
      }
    }

    // If unitCost changed, append prior cost to costHistory[] (rolling, capped at 50 entries)
    if (oldMaterial && updates.unitCost !== undefined && updates.unitCost !== oldMaterial.unitCost) {
      var history = Array.isArray(oldMaterial.costHistory) ? oldMaterial.costHistory.slice() : [];
      // Migrate legacy previousUnitCost into history if present and history is empty
      if (history.length === 0 && oldMaterial.previousUnitCost != null) {
        history.push({
          cost: oldMaterial.previousUnitCost,
          changedAt: oldMaterial.costChangedAt || oldMaterial.updatedAt || now,
          changedBy: 'legacy'
        });
      }
      history.push({
        cost: oldMaterial.unitCost || 0,
        changedAt: now,
        changedBy: (firebase.auth().currentUser && firebase.auth().currentUser.uid) || 'admin'
      });
      // Cap at 50 entries (rolling)
      if (history.length > 50) history = history.slice(history.length - 50);
      updates.costHistory = history;
      updates.previousUnitCost = oldMaterial.unitCost || 0; // keep legacy field for back-compat
      updates.costChangedAt = now;
    }

    await MastDB.materials.update(id, updates);
    MastAdmin.writeAudit('update', 'material', id);

    // If unitCost changed, trigger costsDirty scan
    if (oldMaterial && updates.unitCost !== undefined && updates.unitCost !== oldMaterial.unitCost) {
      await markRecipesDirtyForMaterial(id);
    }
    return updates;
  }

  async function archiveMaterial(id) {
    await MastDB.materials.update(id, {
      status: 'archived',
      updatedAt: new Date().toISOString()
    });
    MastAdmin.writeAudit('archive', 'material', id);
  }

  // ============================================================
  // Recipes CRUD
  // ============================================================

  function loadRecipes() {
    // Phase 2A-2E: always refresh volatile pricing state on nav so drift
    // badges and price-lock chips reflect current reality.
    loadVolatilePricingData();
    if (recipesListener) return;
    recipesListener = MastDB.recipes.listen(200, function(snap) {
      recipesData = snap.val() || {};
      recipesLoaded = true;
      renderPieces();
    });
  }

  function unloadRecipes() {
    if (recipesListener) {
      MastDB.recipes.unlisten(recipesListener);
      recipesListener = null;
    }
    recipesData = {};
    recipesLoaded = false;
  }

  async function createRecipe(data) {
    var id = MastDB.recipes.newKey();
    var now = new Date().toISOString();

    // Get maker settings for defaults
    var settings = await getMakerSettings();

    var recipe = {
      recipeId: id,
      productId: data.productId || '',
      name: data.name || '',
      status: data.status || 'draft',
      version: 1,
      lineItems: data.lineItems || {},
      laborRatePerHour: data.laborRatePerHour || settings.defaultLaborRatePerHour || 0,
      laborMinutes: data.laborMinutes || 0,
      laborCost: 0,
      otherCost: data.otherCost || 0,
      otherCostNote: data.otherCostNote || '',
      setupCost: data.setupCost || 0,
      batchSize: data.batchSize || 1,
      minMarginPercent: data.minMarginPercent != null ? data.minMarginPercent : null,
      costHistorySnapshot: null,
      totalMaterialCost: 0,
      totalCost: 0,
      wholesaleMarkup: data.wholesaleMarkup || settings.defaultWholesaleMarkup || 2.0,
      wholesalePrice: 0,
      wholesaleGrossProfit: 0,
      directMarkup: data.directMarkup || settings.defaultDirectMarkup || 2.5,
      directPrice: 0,
      directGrossProfit: 0,
      retailMarkup: data.retailMarkup || settings.defaultRetailMarkup || 3.5,
      retailPrice: 0,
      retailGrossProfit: 0,
      activePriceTier: data.activePriceTier || 'direct',
      // Channel-First Phase 1c (D33, D41) — per-tier override; null means "use suggested".
      // suggestedPrice mirrors the computed wholesale/direct/retail{Price} fields and is
      // populated by calculateRecipe(). Effective price = overridePrice[tier] ?? suggestedPrice[tier].
      overridePrice: data.overridePrice || { wholesale: null, direct: null, retail: null },
      // Channel-First Phase 1c (D39) — version starts at 1; bumped on each publish.
      // versionHistory[] retains prior published snapshots. Empty until first publish.
      versionHistory: [],
      lastPublishedAt: null,
      lastCalculatedAt: null,
      costsDirty: false,
      notes: data.notes || '',
      createdAt: now,
      updatedAt: now
    };

    // Run initial calculation if line items provided
    if (Object.keys(recipe.lineItems).length > 0) {
      var calc = calculateRecipe(recipe);
      Object.assign(recipe, calc);
      recipe.lastCalculatedAt = now;
    }

    await MastDB.recipes.set(id, recipe);
    MastAdmin.writeAudit('create', 'recipe', id);
    return recipe;
  }

  async function updateRecipe(id, updates) {
    updates.updatedAt = new Date().toISOString();
    await MastDB.recipes.update(id, updates);
    MastAdmin.writeAudit('update', 'recipe', id);
    return updates;
  }

  async function archiveRecipe(id) {
    await MastDB.recipes.update(id, {
      status: 'archived',
      updatedAt: new Date().toISOString()
    });
    MastAdmin.writeAudit('archive', 'recipe', id);
  }

  /**
   * Recalculate a recipe — refreshes unitCost from materials, runs calc engine,
   * clears costsDirty, updates lastCalculatedAt.
   */
  async function recalculateRecipe(recipeId) {
    var recipe = recipesData[recipeId];
    if (!recipe) throw new Error('Recipe not found: ' + recipeId);

    // Refresh unitCost on each line item from current materials data
    // (sub-assembly items are resolved separately below)
    var lineItems = recipe.lineItems || {};
    var refreshedLineItems = {};
    Object.keys(lineItems).forEach(function(liId) {
      var li = lineItems[liId];
      if (li && li.kind === 'recipe') {
        refreshedLineItems[liId] = li; // resolve in next step
        return;
      }
      var material = materialsData[li.materialId];
      // Phase 2B: pricing path uses replacementCost; falls back to unitCost.
      var currentCost = material ? (material.replacementCost != null ? material.replacementCost : material.unitCost) : li.unitCost;
      refreshedLineItems[liId] = Object.assign({}, li, {
        unitCost: currentCost,
        materialName: material ? material.name : li.materialName
      });
    });
    // Resolve sub-assembly costs
    var rootVisited = {};
    rootVisited[recipeId] = true;
    refreshedLineItems = resolveSubAssemblyCosts(refreshedLineItems, rootVisited, 0);

    // Run calculation
    var calc = calculateRecipe({
      lineItems: refreshedLineItems,
      laborRatePerHour: recipe.laborRatePerHour,
      laborMinutes: recipe.laborMinutes,
      otherCost: recipe.otherCost,
      setupCost: recipe.setupCost,
      batchSize: recipe.batchSize,
      wholesaleMarkup: recipe.wholesaleMarkup,
      directMarkup: recipe.directMarkup,
      retailMarkup: recipe.retailMarkup
    });

    var now = new Date().toISOString();

    // Phase 2C.1: drift detection vs baseline
    var baseline = typeof recipe.driftBaseline === 'number' ? recipe.driftBaseline : null;
    var currentDriftPct = 0;
    if (baseline != null && baseline > 0) {
      currentDriftPct = Math.round(((calc.totalCost - baseline) / baseline) * 10000) / 100;
    }

    // Phase 2C.2: marginHistory append (cap 365)
    var activeTier = recipe.activePriceTier || 'direct';
    var activeTierMargin = (function() {
      var price = calc[activeTier + 'Price'] || 0;
      return price > 0 ? Math.round(((price - calc.totalCost) / price) * 10000) / 100 : 0;
    })();
    var marginHistory = Array.isArray(recipe.marginHistory) ? recipe.marginHistory.slice() : [];
    marginHistory.push({
      date: now,
      totalCost: calc.totalCost,
      activeTierPrice: calc[activeTier + 'Price'] || 0,
      marginPct: activeTierMargin,
      triggeredBy: recipe.costsDirty ? 'cost-change' : 'manual'
    });
    if (marginHistory.length > 365) marginHistory = marginHistory.slice(marginHistory.length - 365);

    var updates = {
      lineItems: calc.lineItems,
      totalMaterialCost: calc.totalMaterialCost,
      laborCost: calc.laborCost,
      totalCost: calc.totalCost,
      wholesalePrice: calc.wholesalePrice,
      wholesaleGrossProfit: calc.wholesaleGrossProfit,
      directPrice: calc.directPrice,
      directGrossProfit: calc.directGrossProfit,
      retailPrice: calc.retailPrice,
      retailGrossProfit: calc.retailGrossProfit,
      // Channel-First Phase 1c (D33) — persist computed suggestedPrice map for consumers
      suggestedPrice: calc.suggestedPrice,
      costsDirty: false,
      currentDriftPct: currentDriftPct,
      marginHistory: marginHistory,
      lastCalculatedAt: now,
      updatedAt: now
    };

    // Recalculate variants if enabled
    if (recipe.isVariantEnabled && recipe.variants) {
      var variantUpdates = {};
      Object.keys(recipe.variants).forEach(function(vid) {
        var v = recipe.variants[vid];
        // Refresh variant line items from materials (sub-assemblies resolved next)
        var vLineItems = v.lineItems || {};
        var vRefreshed = {};
        Object.keys(vLineItems).forEach(function(liId) {
          var li = vLineItems[liId];
          if (li && li.kind === 'recipe') { vRefreshed[liId] = li; return; }
          var material = materialsData[li.materialId];
          // Phase 2B: pricing path uses replacementCost
          var currentCost = material ? (material.replacementCost != null ? material.replacementCost : material.unitCost) : li.unitCost;
          vRefreshed[liId] = Object.assign({}, li, {
            unitCost: currentCost,
            materialName: material ? material.name : li.materialName
          });
        });
        var vVisited = {};
        vVisited[recipeId] = true;
        vRefreshed = resolveSubAssemblyCosts(vRefreshed, vVisited, 0);
        var vCalc = calculateRecipe({
          lineItems: vRefreshed,
          laborRatePerHour: recipe.laborRatePerHour,
          laborMinutes: v.laborMinutes || 0,
          otherCost: v.otherCost || 0,
          setupCost: recipe.setupCost,
          batchSize: recipe.batchSize,
          wholesaleMarkup: recipe.wholesaleMarkup,
          directMarkup: recipe.directMarkup,
          retailMarkup: recipe.retailMarkup
        });
        variantUpdates[vid] = Object.assign({}, v, {
          lineItems: vCalc.lineItems,
          totalMaterialCost: vCalc.totalMaterialCost,
          totalCost: vCalc.totalCost,
          wholesalePrice: vCalc.wholesalePrice,
          directPrice: vCalc.directPrice,
          retailPrice: vCalc.retailPrice,
          // Phase 1c (D33) — persist suggestedPrice on each variant
          suggestedPrice: vCalc.suggestedPrice,
          // Initialize overridePrice if missing (preserve prior overrides on re-calc)
          overridePrice: (v.overridePrice && typeof v.overridePrice === 'object')
            ? v.overridePrice
            : { wholesale: null, direct: null, retail: null }
        });
      });
      updates.variants = variantUpdates;
    }

    await MastDB.recipes.update(recipeId, updates);

    // Channel-First Phase 1c (D34) — auto-propagate to product on recalc REMOVED.
    // Use explicit publishRecipe(recipeId) action instead. activePriceTier remains
    // as a display preference but no longer triggers a Product price write.

    // Checkpoint D — keep the linked Product's uniform costShape in sync for Build mode.
    if (recipe.productId) {
      try {
        var freshRecipe = Object.assign({}, recipe, updates);
        var prodRow = (window.productsData || []).find(function(pp) { return pp.pid === recipe.productId; });
        var prodForShape = prodRow || { acquisitionType: 'build' };
        if (!prodForShape.acquisitionType || prodForShape.acquisitionType === 'build') {
          var cs = computeCostShape(prodForShape, freshRecipe);
          await persistCostShape(recipe.productId, cs);
          // Checkpoint E — recompute readiness on cost change
          try { await recomputeAndPersistReadiness(recipe.productId); } catch (e2) {}
        }
      } catch (e) {
        console.warn('costShape sync (build mode) failed', e);
      }
    }

    MastAdmin.writeAudit('recalculate', 'recipe', recipeId);
    return updates;
  }

  /**
   * Add a line item to a recipe.
   */
  async function addLineItem(recipeId, materialId, quantity) {
    var material = materialsData[materialId];
    if (!material) throw new Error('Material not found: ' + materialId);

    var liId = MastDB.newKey('admin/recipes/' + recipeId + '/lineItems');
    var lineItem = {
      lineItemId: liId,
      materialId: materialId,
      materialName: material.name,
      quantity: quantity || 0,
      scrapPercent: 0,
      unitOfMeasure: material.unitOfMeasure,
      unitCost: material.unitCost,
      extendedCost: roundCents((quantity || 0) * material.unitCost)
    };

    await MastDB.recipes.subRef(recipeId, 'lineItems', liId).set(lineItem);
    return lineItem;
  }

  /**
   * Remove a line item from a recipe.
   */
  async function removeLineItem(recipeId, lineItemId) {
    await MastDB.recipes.subRef(recipeId, 'lineItems', lineItemId).remove();
  }

  // ============================================================
  // costsDirty — Scan recipes when material cost changes
  // ============================================================

  /**
   * When a material's unitCost changes, find all recipes containing that
   * material and set costsDirty = true.
   */
  async function markRecipesDirtyForMaterial(materialId) {
    // Ensure recipes are loaded
    if (!recipesLoaded) {
      recipesData = (await MastDB.recipes.list(200)) || {};
    }

    var updates = {};
    Object.keys(recipesData).forEach(function(recipeId) {
      var recipe = recipesData[recipeId];
      if (recipe.status === 'archived') return;
      var lineItems = recipe.lineItems || {};
      var usesMaterial = Object.keys(lineItems).some(function(liId) {
        return lineItems[liId].materialId === materialId;
      });
      if (usesMaterial) {
        updates['admin/recipes/' + recipeId + '/costsDirty'] = true;
        updates['admin/recipes/' + recipeId + '/updatedAt'] = new Date().toISOString();
      }
    });

    if (Object.keys(updates).length > 0) {
      await MastDB.multiUpdate(updates);
      var count = Object.keys(updates).length / 2; // each recipe has 2 update fields
      MastAdmin.showToast(count + ' recipe' + (count === 1 ? '' : 's') + ' flagged for recalculation');
    }
  }

  // ============================================================
  // Channel-First Phase 1c — Tier resolution, Publish action, version history
  // (D33, D34, D35, D36, D39, D41)
  // ============================================================

  /**
   * Resolve the effective price for a tier on a recipe (or recipe variant).
   * effective = overridePrice[tier] (if user-set) ?? suggestedPrice[tier] ?? legacy {tier}Price.
   * Returns dollars.
   */
  function effectiveTierPrice(target, tier) {
    if (!target) return 0;
    var ov = target.overridePrice;
    if (ov && typeof ov[tier] === 'number' && ov[tier] > 0) return ov[tier];
    var sg = target.suggestedPrice;
    if (sg && typeof sg[tier] === 'number' && sg[tier] > 0) return sg[tier];
    var legacy = target[tier + 'Price'];
    return typeof legacy === 'number' ? legacy : 0;
  }

  /**
   * Set the active price tier on a recipe (display preference only — no longer
   * propagates to product per D34). Use publishRecipe() to write to product.
   */
  async function setActivePriceTier(recipeId, tier) {
    var recipe = recipesData[recipeId];
    if (!recipe) throw new Error('Recipe not found: ' + recipeId);
    if (!['wholesale', 'direct', 'retail'].includes(tier)) {
      throw new Error('Invalid tier: ' + tier);
    }
    var now = new Date().toISOString();
    await MastDB.recipes.update(recipeId, { activePriceTier: tier, updatedAt: now });
    MastAdmin.writeAudit('set-price-tier', 'recipe', recipeId);
    return { tier: tier };
  }

  /**
   * Channel-First Phase 2d (D24) — Recipe Publish handshake, Step 1.
   *
   * Publish suggests prices: bumps recipe.version, snapshots prior state
   * into versionHistory[], records publishedPrices + lastPublishedAt + drift
   * baseline. Does **NOT** write to the linked product. Step 2
   * (applyRecipeToProduct) is invoked from the product detail "Recipe vN
   * ready to apply" banner to actually write prices.
   *
   * Per-variant data lives on the recipe; the price-resolution math runs in
   * Step 2 against the live product's variants. We keep that math out of
   * Step 1 because the product variant set may have changed since the last
   * apply, and the diff dialog needs to show the truth as of "now".
   */
  async function publishRecipe(recipeId) {
    var recipe = recipesData[recipeId];
    if (!recipe) throw new Error('Recipe not found: ' + recipeId);
    if (!recipe.productId) throw new Error('Recipe has no linked product to publish to');

    var now = new Date().toISOString();

    // Compute base-product effective tier prices (dollars) from current recipe state.
    var baseEff = {
      wholesale: effectiveTierPrice(recipe, 'wholesale'),
      direct:    effectiveTierPrice(recipe, 'direct'),
      retail:    effectiveTierPrice(recipe, 'retail')
    };

    var newVersion = (typeof recipe.version === 'number' ? recipe.version : 1) + 1;

    // Snapshot the prior version into history. Capture publishedPrices from
    // the prior publish (recipe.publishedPrices) so history shows what the
    // last actual prices were at that version.
    var priorSnapshot = {
      version: recipe.version || 1,
      totalCost: recipe.totalCost || 0,
      publishedPrices: recipe.publishedPrices || baseEff,
      publishedAt: now
    };
    var history = Array.isArray(recipe.versionHistory) ? recipe.versionHistory.slice() : [];
    history.push(priorSnapshot);
    if (history.length > 50) history = history.slice(history.length - 50);

    var recipePath = 'admin/recipes/' + recipeId + '/';
    var updates = {};
    updates[recipePath + 'version']         = newVersion;
    updates[recipePath + 'versionHistory']  = history;
    updates[recipePath + 'lastPublishedAt'] = now;
    updates[recipePath + 'publishedPrices'] = baseEff;
    updates[recipePath + 'driftBaseline']   = recipe.totalCost || 0;
    updates[recipePath + 'currentDriftPct'] = 0;
    updates[recipePath + 'updatedAt']       = now;

    // Channel-First Phase 5 (D45) — estimatedCost snapshot at publish time.
    // Stored as per-tier prices so observedCost (also per-tier) can be
    // compared directly. drift % = (observed.retail - estimated.retail) /
    // estimated.retail. snapshotAt lets the cadence recalc surface
    // currentRecalcDriftPct based on this baseline.
    updates[recipePath + 'estimatedCost'] = baseEff;
    updates[recipePath + 'estimatedCostSnapshotAt'] = now;
    if (recipe.variantsShape === 'cost' && recipe.variants) {
      Object.keys(recipe.variants).forEach(function(vKey) {
        if (vKey === 'default') return;
        var v = recipe.variants[vKey];
        if (!v) return;
        // Variants store overridePrice/suggestedPrice in their own scope;
        // effectiveTierPrice falls back to recipe-level when variant lacks them.
        var vEff = {
          wholesale: effectiveTierPrice(v, 'wholesale') || effectiveTierPrice(recipe, 'wholesale'),
          direct:    effectiveTierPrice(v, 'direct')    || effectiveTierPrice(recipe, 'direct'),
          retail:    effectiveTierPrice(v, 'retail')    || effectiveTierPrice(recipe, 'retail')
        };
        updates[recipePath + 'variants/' + vKey + '/estimatedCost'] = vEff;
        updates[recipePath + 'variants/' + vKey + '/estimatedCostSnapshotAt'] = now;
      });
    }

    await MastDB.multiUpdate(updates);
    MastAdmin.writeAudit('publish', 'recipe', recipeId);

    return { version: newVersion, prices: baseEff, applied: false };
  }

  /**
   * Channel-First Phase 2d (D24) — Recipe Publish handshake, Step 2.
   *
   * Reads recipe.publishedPrices + recipe.version, writes them to the linked
   * product (tier prices, variant tier prices, recipeId, recipeVersion).
   * Invoked from the "Recipe vN ready to apply" banner on product detail.
   *
   * Returns the { version, prices, applied: true } shape so callers can
   * tell ratification has occurred.
   */
  async function applyRecipeToProduct(recipeId) {
    var recipe = recipesData[recipeId];
    if (!recipe) throw new Error('Recipe not found: ' + recipeId);
    if (!recipe.productId) throw new Error('Recipe has no linked product');
    if (!recipe.publishedPrices) throw new Error('Recipe has no published prices to apply (publish first).');

    var product = (window.productsData || []).find(function(p) { return p.pid === recipe.productId; });
    if (!product) throw new Error('Linked product not found: ' + recipe.productId);

    var prodPath = 'public/products/' + recipe.productId + '/';
    var updates = {};
    var baseEff = recipe.publishedPrices; // dollars (set in Step 1)

    // Variant publish if recipe has variant entries AND product has variants.
    var didVariantPublish = false;
    if (recipe.variants && Array.isArray(product.variants) && product.variants.length > 0) {
      var rv = recipe.variants;
      var newVariants = product.variants.map(function(pv) {
        var slot = rv[pv.id] || rv.default || null;
        var eff = slot ? {
          wholesale: effectiveTierPrice(slot, 'wholesale') || baseEff.wholesale,
          direct:    effectiveTierPrice(slot, 'direct')    || baseEff.direct,
          retail:    effectiveTierPrice(slot, 'retail')    || baseEff.retail
        } : baseEff;
        return Object.assign({}, pv, {
          retailPriceCents:    Math.round(eff.retail    * 100),
          directPriceCents:    Math.round(eff.direct    * 100),
          wholesalePriceCents: Math.round(eff.wholesale * 100),
          priceCents:          Math.round(eff.retail    * 100) // legacy mirror
        });
      });
      updates[prodPath + 'variants'] = newVariants;
      var lowestRetail = Math.min.apply(null, newVariants.map(function(v){ return v.retailPriceCents || 0; }).filter(function(c){ return c > 0; }));
      var lowestDirect = Math.min.apply(null, newVariants.map(function(v){ return v.directPriceCents || 0; }).filter(function(c){ return c > 0; }));
      var lowestWs     = Math.min.apply(null, newVariants.map(function(v){ return v.wholesalePriceCents || 0; }).filter(function(c){ return c > 0; }));
      if (isFinite(lowestRetail)) {
        updates[prodPath + 'retailPriceCents'] = lowestRetail;
        updates[prodPath + 'priceCents']       = lowestRetail;
        updates[prodPath + 'price']            = lowestRetail / 100;
        updates[prodPath + 'priceType']        = 'from';
      }
      if (isFinite(lowestDirect)) updates[prodPath + 'directPriceCents']    = lowestDirect;
      if (isFinite(lowestWs))     updates[prodPath + 'wholesalePriceCents'] = lowestWs;
      didVariantPublish = true;
    }
    if (!didVariantPublish) {
      var retailCents    = Math.round(baseEff.retail    * 100);
      var directCents    = Math.round(baseEff.direct    * 100);
      var wholesaleCents = Math.round(baseEff.wholesale * 100);
      updates[prodPath + 'retailPriceCents']    = retailCents;
      updates[prodPath + 'directPriceCents']    = directCents;
      updates[prodPath + 'wholesalePriceCents'] = wholesaleCents;
      updates[prodPath + 'priceCents']          = retailCents;
      updates[prodPath + 'price']               = baseEff.retail;
    }

    // Wholesale flag — set true if any wholesale price > 0
    var anyWholesale = (baseEff.wholesale > 0)
      || (didVariantPublish && updates[prodPath + 'wholesalePriceCents'] > 0);
    if (anyWholesale) updates[prodPath + 'isWholesale'] = true;

    // Link recipe to product (and ack the version)
    updates[prodPath + 'recipeId']      = recipeId;
    updates[prodPath + 'recipeVersion'] = recipe.version;

    await MastDB.multiUpdate(updates);
    MastAdmin.writeAudit('apply-recipe', 'products', recipe.productId);

    // Etsy price sync (best-effort; retail tier is what Etsy shows publicly)
    syncEtsyListingPrice(recipe.productId, Math.round(baseEff.retail * 100), recipeId);

    return { version: recipe.version, prices: baseEff, applied: true };
  }

  /**
   * Sync price to Etsy listing if product has an etsyListingId.
   * Non-blocking — failures show a toast but don't affect local data.
   */
  function syncEtsyListingPrice(productId, priceCents, recipeId) {
    // Look up the product to get etsyListingId
    var products = window.productsData || [];
    var product = products.find(function(p) { return p.pid === productId; });
    if (!product || !product.etsyListingId) return;

    var listingId = product.etsyListingId;
    firebase.functions().httpsCallable('etsyUpdateListingPrice')({
      listingId: listingId,
      priceCents: priceCents
    }).then(function() {
      showToast('Price updated on Etsy');
      // Record sync timestamp on recipe
      MastDB.recipes.fieldRef(recipeId, 'lastEtsySyncAt').set(new Date().toISOString());
    }).catch(function(err) {
      console.error('Etsy price sync failed:', err);
      showToast('Local price updated — Etsy sync failed', 'error');
    });
  }

  /**
   * Propagate a price to a product (used after recalculation).
   */
  async function propagatePriceToProduct(productId, price) {
    var priceCents = Math.round(price * 100);
    var updates = {};
    updates['public/products/' + productId + '/priceCents'] = priceCents;
    updates['public/products/' + productId + '/price'] = price;
    await MastDB.multiUpdate(updates);
  }

  /**
   * Get the price for a given tier from recipe data.
   */
  function getTierPrice(tier, recipe) {
    switch (tier) {
      case 'wholesale': return recipe.wholesalePrice || 0;
      case 'direct': return recipe.directPrice || 0;
      case 'retail': return recipe.retailPrice || 0;
      default: return 0;
    }
  }

  // ============================================================
  // Variant Helpers (cost-shape model — mirrors product variants)
  // ============================================================

  /**
   * Resolve the linked product's variants array.
   * Returns array of {id, combo, ...} or [].
   */
  // Build a stable ID for a product variant. Some products have v.id directly;
  // others (imported from Squarespace) only have {combo, priceCents}. Derive a
  // stable key from the combo so downstream code (tabs, recipe overrides) works.
  function productVariantKey(v) {
    if (!v) return '';
    if (v.id) return v.id;
    if (v.combo && typeof v.combo === 'object') {
      return Object.keys(v.combo).sort().map(function(k){ return k + ':' + v.combo[k]; }).join('|');
    }
    if (typeof v.combo === 'string') return v.combo;
    return '';
  }

  function getProductVariants(bs) {
    if (!bs || !bs.productId) return [];
    var prod = (window.productsData || []).find(function(p){ return p.pid === bs.productId; });
    if (!prod || !Array.isArray(prod.variants)) return [];
    return prod.variants.map(function(v) {
      if (v && v.id) return v;
      var k = productVariantKey(v);
      if (!k) return null;
      // Clone with synthesized id so existing code paths keep working
      var out = Object.assign({}, v, { id: k });
      return out;
    }).filter(function(v){ return v && v.id; });
  }

  /**
   * Build display name for a product variant (e.g. "Small" or "Small, Red").
   */
  function variantDisplayName(pv) {
    if (!pv) return 'Variant';
    var c = pv.combo;
    if (typeof c === 'string' && c) return c;
    if (c && typeof c === 'object') {
      // combo can be {Size:"Small"} or {Size:"Small",Color:"Red"} — join axis values.
      var parts = Object.keys(c).map(function(k){ return c[k]; }).filter(function(v){ return v != null && v !== ''; });
      if (parts.length) return parts.join(', ');
    }
    return pv.name || pv.label || pv.id || 'Variant';
  }

  /**
   * Inheritance-aware read for the cost-shape model.
   * key === 'default' or a productVariantId.
   * Variant override → default → recipe root. Returns { value, inherited, from }.
   */
  function readVariantField(bs, key, field) {
    var variants = bs.variants || {};
    var override = variants[key] || {};
    if (override[field] !== undefined && override[field] !== null) {
      return { value: override[field], inherited: false, from: 'self' };
    }
    if (key !== 'default') {
      var def = variants.default || {};
      if (def[field] !== undefined && def[field] !== null) {
        return { value: def[field], inherited: true, from: 'default' };
      }
    }
    if (bs[field] !== undefined && bs[field] !== null) {
      return { value: bs[field], inherited: key !== 'default', from: 'root' };
    }
    var defaults = { lineItems: {}, laborMinutes: 0, otherCost: 0 };
    return { value: defaults[field], inherited: key !== 'default', from: 'root' };
  }

  /**
   * Materialize a writable slot for the given key.
   */
  function ensureVariantSlot(bs, key) {
    if (!bs.variants) bs.variants = {};
    if (!bs.variants[key]) bs.variants[key] = {};
    return bs.variants[key];
  }

  /**
   * Materialize lineItems for a key by copying from inheritance chain.
   * Called the first time the user edits BOM on an inherited tab.
   */
  function materializeLineItems(bs, key) {
    var slot = ensureVariantSlot(bs, key);
    if (slot.lineItems) return slot.lineItems;
    var src;
    if (key === 'default') {
      src = bs.lineItems || {};
    } else {
      var def = (bs.variants && bs.variants.default) || {};
      src = def.lineItems || bs.lineItems || {};
    }
    slot.lineItems = JSON.parse(JSON.stringify(src));
    return slot.lineItems;
  }

  /**
   * Hydrate variant slots so each product variant is a fully independent copy.
   * Called when a builder opens for a product that has variants. Each variant
   * gets its own lineItems/laborMinutes/otherCost copied from Default (or the
   * recipe root as fallback). The Default slot is then removed since every
   * variant stands alone. Idempotent: variants with existing data are left
   * alone.
   */
  function hydrateVariantsIndependent(bs) {
    if (!bs || !bs.productId) return;
    var pvs = getProductVariants(bs);
    if (pvs.length === 0) return;
    if (!bs.variants) bs.variants = {};
    var def = bs.variants.default || {};
    var srcLineItems = def.lineItems || bs.lineItems || {};
    var srcLaborMinutes = (def.laborMinutes != null) ? def.laborMinutes : (bs.laborMinutes || 0);
    var srcOtherCost = (def.otherCost != null) ? def.otherCost : (bs.otherCost || 0);
    // Skip the clone work entirely when there are no source lineItems to copy —
    // a brand-new piece with variants has an empty source, so there's nothing
    // to deep-copy per variant.
    var hasSrcLineItems = srcLineItems && Object.keys(srcLineItems).length > 0;
    // Use structuredClone when available (3-10× faster than JSON.parse(JSON.stringify),
    // and it handles non-serializable values gracefully). Fall back for older browsers.
    var cloneFn = (typeof structuredClone === 'function')
      ? function(v) { return structuredClone(v); }
      : function(v) { return JSON.parse(JSON.stringify(v)); };
    pvs.forEach(function(pv) {
      var slot = bs.variants[pv.id] || {};
      if (slot.lineItems == null) {
        slot.lineItems = hasSrcLineItems ? cloneFn(srcLineItems) : {};
      }
      if (slot.laborMinutes == null) slot.laborMinutes = srcLaborMinutes;
      if (slot.otherCost == null) slot.otherCost = srcOtherCost;
      bs.variants[pv.id] = slot;
    });
    // Remove Default — each variant is now independent
    delete bs.variants.default;
    bs.isVariantEnabled = true;
  }

  /**
   * Read view of the active tab's data (lineItems, laborMinutes, otherCost)
   * with full inheritance applied. Used by the renderer.
   * Mutating callers MUST use materializeLineItems / ensureVariantSlot instead.
   */
  function getActiveVariantData(bs) {
    var key = currentVariantId || 'default';
    return {
      lineItems: readVariantField(bs, key, 'lineItems').value,
      laborMinutes: readVariantField(bs, key, 'laborMinutes').value,
      otherCost: readVariantField(bs, key, 'otherCost').value
    };
  }

  /**
   * Get the first variant's price for a given tier (used for legacy product propagation).
   */
  function getFirstVariantTierPrice(tier, recipe) {
    var variants = recipe.variants || {};
    var keys = Object.keys(variants);
    if (keys.length === 0) return 0;
    var first = variants[keys[0]];
    var priceKey = tier + 'Price';
    return first[priceKey] || 0;
  }

  // ============================================================
  // Maker Settings
  // ============================================================

  // ============================================================
  // Channel Fee Profiles — admin/channels/{channelId}
  // ============================================================

  var channelsData = {};
  var channelsLoaded = false;

  async function loadChannels() {
    channelsData = await MastDB.get('admin/channels') || {};
    channelsLoaded = true;
    return channelsData;
  }

  async function createChannel(data) {
    var id = MastDB.newKey('admin/channels');
    var now = new Date().toISOString();
    var channel = {
      channelId: id,
      name: data.name || '',
      percentFee: data.percentFee != null ? Number(data.percentFee) : 0,           // e.g. 6.5 for 6.5%
      fixedFeePerOrderCents: data.fixedFeePerOrderCents != null ? Math.round(data.fixedFeePerOrderCents) : 0,
      monthlyFixedCents: data.monthlyFixedCents != null ? Math.round(data.monthlyFixedCents) : 0,
      autoMatchSources: Array.isArray(data.autoMatchSources) ? data.autoMatchSources : [], // e.g. ['etsy','shopify']
      notes: data.notes || '',
      createdAt: now,
      updatedAt: now
    };
    await MastDB.set('admin/channels/' + id, channel);
    channelsData[id] = channel;
    MastAdmin.writeAudit('create', 'channel', id);
    return channel;
  }

  async function updateChannel(id, updates) {
    updates.updatedAt = new Date().toISOString();
    await MastDB.update('admin/channels/' + id, updates);
    if (channelsData[id]) Object.assign(channelsData[id], updates);
    MastAdmin.writeAudit('update', 'channel', id);
  }

  async function deleteChannel(id) {
    await MastDB.remove('admin/channels/' + id);
    delete channelsData[id];
    MastAdmin.writeAudit('delete', 'channel', id);
  }

  /**
   * Compute net-of-fee margin for an order on a given channel.
   * Caller passes order subtotal (cents) and order COGS (cents). Returns:
   *   { feeCents, netRevenueCents, grossProfitCents, marginPct, channelName }
   * Pure function — does not amortize monthlyFixedCents (that requires order count
   * over a period; caller should compute separately if needed).
   */
  function getChannelNetMargin(channelId, subtotalCents, totalCostCents) {
    var ch = channelsData[channelId];
    if (!ch) {
      var net0 = subtotalCents - 0;
      var profit0 = net0 - totalCostCents;
      return {
        feeCents: 0,
        netRevenueCents: net0,
        grossProfitCents: profit0,
        marginPct: net0 > 0 ? (profit0 / net0) * 100 : 0,
        channelName: 'Direct (no channel)'
      };
    }
    var feeCents = Math.round((subtotalCents * (ch.percentFee || 0)) / 100) + (ch.fixedFeePerOrderCents || 0);
    var netRevenueCents = subtotalCents - feeCents;
    var grossProfitCents = netRevenueCents - totalCostCents;
    return {
      feeCents: feeCents,
      netRevenueCents: netRevenueCents,
      grossProfitCents: grossProfitCents,
      marginPct: netRevenueCents > 0 ? (grossProfitCents / netRevenueCents) * 100 : 0,
      channelName: ch.name
    };
  }

  /**
   * Auto-detect channel from an order based on its source field.
   * Returns channelId or null. Order detail UI can call this then fall back
   * to a manual channel selector.
   */
  function detectChannelForOrder(order) {
    if (!order) return null;
    if (order.channelId) return order.channelId; // explicit override wins
    var source = (order.source || order.platform || '').toLowerCase();
    if (!source) return null;
    var ids = Object.keys(channelsData);
    for (var i = 0; i < ids.length; i++) {
      var ch = channelsData[ids[i]];
      if (ch && Array.isArray(ch.autoMatchSources)) {
        for (var j = 0; j < ch.autoMatchSources.length; j++) {
          if ((ch.autoMatchSources[j] || '').toLowerCase() === source) return ids[i];
        }
      }
    }
    return null;
  }

  // ---- Channels Manager Modal ----

  async function openChannelsManager() {
    if (!channelsLoaded) await loadChannels();
    renderChannelsManager();
  }

  function closeChannelsManager(event) {
    if (event && event.target && event.target.id !== 'channelsManagerOverlay') return;
    var c = document.getElementById('channelsManagerContainer');
    if (c) c.remove();
  }

  function renderChannelsManager() {
    var esc = MastAdmin.esc;
    var existing = document.getElementById('channelsManagerContainer');
    if (existing) existing.remove();

    var ids = Object.keys(channelsData).sort(function(a, b) {
      return (channelsData[a].name || '').localeCompare(channelsData[b].name || '');
    });

    var html = '';
    html += '<div id="channelsManagerOverlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;" onclick="makerCloseChannelsManager(event)">';
    html += '<div style="background:var(--cream);border-radius:10px;max-width:680px;width:92%;max-height:80vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.2);padding:20px 24px;" onclick="event.stopPropagation()">';

    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0;">Sales Channels</h3>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerCloseChannelsManager()">Close</button>';
    html += '</div>';
    html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 14px;">Define each channel\'s fee structure once. Order margin reports will subtract fees to show true net profit. Auto-match links a channel to orders coming in from a specific source (etsy, shopify, in-person, etc.).</p>';

    if (ids.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);text-align:center;padding:20px;font-style:italic;">No channels defined yet.</p>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">';
      html += '<thead><tr style="border-bottom:1px solid var(--cream-dark);">';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;color:var(--warm-gray);">Channel</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;color:var(--warm-gray);">% fee</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;color:var(--warm-gray);">$/order</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;color:var(--warm-gray);">$/month</th>';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.72rem;text-transform:uppercase;color:var(--warm-gray);">Auto-match</th>';
      html += '<th style="width:80px;"></th>';
      html += '</tr></thead><tbody>';
      ids.forEach(function(cid) {
        var ch = channelsData[cid];
        html += '<tr>';
        html += '<td style="padding:8px;font-size:0.85rem;font-weight:500;border-bottom:1px solid var(--cream-dark);">' + esc(ch.name || '') + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">' + (ch.percentFee || 0).toFixed(2) + '%</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">$' + ((ch.fixedFeePerOrderCents || 0) / 100).toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">$' + ((ch.monthlyFixedCents || 0) / 100).toFixed(2) + '</td>';
        html += '<td style="padding:8px;font-size:0.78rem;color:var(--warm-gray);border-bottom:1px solid var(--cream-dark);">' + ((ch.autoMatchSources || []).join(', ') || '—') + '</td>';
        html += '<td style="text-align:right;padding:8px;border-bottom:1px solid var(--cream-dark);">';
        html += '<button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.78rem;font-family:\'DM Sans\';" onclick="makerEditChannelPrompt(\'' + esc(cid) + '\')">Edit</button> ';
        html += '<button style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.78rem;font-family:\'DM Sans\';" onclick="makerDeleteChannelConfirm(\'' + esc(cid) + '\')">×</button>';
        html += '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }

    html += '<div style="border-top:1px dashed var(--cream-dark);padding-top:14px;">';
    html += '<h4 style="font-size:0.9rem;font-weight:600;margin:0 0 8px;">Add channel</h4>';
    html += '<div style="display:flex;gap:8px;margin-bottom:8px;flex-wrap:wrap;">';
    html += '<input id="newChannelName" type="text" placeholder="Name (e.g. Etsy)" style="flex:1;min-width:140px;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';">';
    html += '<input id="newChannelPct" type="number" step="0.01" min="0" placeholder="% fee" style="width:80px;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);">';
    html += '<input id="newChannelFixed" type="number" step="0.01" min="0" placeholder="$/order" style="width:90px;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);">';
    html += '<input id="newChannelMonthly" type="number" step="0.01" min="0" placeholder="$/month" style="width:90px;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);">';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    html += '<input id="newChannelAutoMatch" type="text" placeholder="Auto-match sources (comma sep, e.g. etsy,etsy-mobile)" style="flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';">';
    html += '<button class="btn btn-primary btn-small" onclick="makerCreateChannelFromForm()">Add</button>';
    html += '</div>';
    html += '</div>';

    html += '</div></div>';

    var container = document.createElement('div');
    container.id = 'channelsManagerContainer';
    container.innerHTML = html;
    document.body.appendChild(container);
  }

  async function createChannelFromForm() {
    var name = (document.getElementById('newChannelName').value || '').trim();
    if (!name) { MastAdmin.showToast('Channel name required', true); return; }
    var pct = parseFloat(document.getElementById('newChannelPct').value) || 0;
    var fixedDollars = parseFloat(document.getElementById('newChannelFixed').value) || 0;
    var monthlyDollars = parseFloat(document.getElementById('newChannelMonthly').value) || 0;
    var autoMatch = (document.getElementById('newChannelAutoMatch').value || '').split(',').map(function(s) { return s.trim(); }).filter(Boolean);
    try {
      await createChannel({
        name: name,
        percentFee: pct,
        fixedFeePerOrderCents: Math.round(fixedDollars * 100),
        monthlyFixedCents: Math.round(monthlyDollars * 100),
        autoMatchSources: autoMatch
      });
      MastAdmin.showToast('Channel "' + name + '" added');
      renderChannelsManager();
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  async function editChannelPrompt(id) {
    var ch = channelsData[id];
    if (!ch) return;
    var newName = await mastPrompt('Channel name:', { title: 'Edit Channel', defaultValue: ch.name || '' });
    if (newName == null) return;
    var newPct = await mastPrompt('Percent fee (e.g. 6.5):', { title: 'Edit Channel', defaultValue: String(ch.percentFee || 0) });
    if (newPct == null) return;
    var newFixed = await mastPrompt('Fixed fee per order ($):', { title: 'Edit Channel', defaultValue: String((ch.fixedFeePerOrderCents || 0) / 100) });
    if (newFixed == null) return;
    var newMonthly = await mastPrompt('Monthly fixed cost ($):', { title: 'Edit Channel', defaultValue: String((ch.monthlyFixedCents || 0) / 100) });
    if (newMonthly == null) return;
    var newAuto = await mastPrompt('Auto-match sources (comma sep):', { title: 'Edit Channel', defaultValue: (ch.autoMatchSources || []).join(',') });
    if (newAuto == null) return;
    try {
      await updateChannel(id, {
        name: newName.trim() || ch.name,
        percentFee: parseFloat(newPct) || 0,
        fixedFeePerOrderCents: Math.round((parseFloat(newFixed) || 0) * 100),
        monthlyFixedCents: Math.round((parseFloat(newMonthly) || 0) * 100),
        autoMatchSources: newAuto.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
      });
      MastAdmin.showToast('Channel updated');
      renderChannelsManager();
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  async function deleteChannelConfirm(id) {
    var ch = channelsData[id];
    if (!ch) return;
    if (!await mastConfirm('Delete channel "' + (ch.name || '') + '"? Existing orders that reference it will lose their fee profile.', { title: 'Delete Channel', danger: true })) return;
    try {
      await deleteChannel(id);
      MastAdmin.showToast('Channel deleted');
      renderChannelsManager();
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  async function getMakerSettings() {
    var snap = await MastDB.config.makerSettings().once('value');
    return snap.val() || {
      craftProfile: 'other',
      defaultLaborRatePerHour: 50,
      defaultWholesaleMarkup: 2.0,
      defaultDirectMarkup: 2.5,
      defaultRetailMarkup: 3.5,
      materialsSeeded: false
    };
  }

  async function saveMakerSettings(settings) {
    await MastDB.config.makerSettings().update(settings);
    MastAdmin.writeAudit('update', 'makerSettings', 'config');
    return settings;
  }

  /**
   * Seed materials for a craft profile (called once during onboarding).
   */
  async function seedMaterials(craftProfile) {
    var profile = CRAFT_PROFILES[craftProfile];
    if (!profile) throw new Error('Unknown craft profile: ' + craftProfile);

    var settings = await getMakerSettings();
    if (settings.materialsSeeded) {
      return { seeded: false, reason: 'already seeded' };
    }

    // Create sample materials
    var created = 0;
    for (var i = 0; i < profile.sampleMaterials.length; i++) {
      var sample = profile.sampleMaterials[i];
      await createMaterial({
        name: sample.name,
        category: sample.category,
        unitOfMeasure: sample.unitOfMeasure,
        unitCost: sample.unitCost,
        craftProfile: craftProfile,
        status: 'draft' // draft so tenant activates deliberately
      });
      created++;
    }

    // Save maker settings
    await saveMakerSettings({
      craftProfile: craftProfile,
      defaultLaborRatePerHour: profile.defaultLaborRate,
      defaultWholesaleMarkup: profile.defaultMarkups.wholesale,
      defaultDirectMarkup: profile.defaultMarkups.direct,
      defaultRetailMarkup: profile.defaultMarkups.retail,
      materialsSeeded: true
    });

    return { seeded: true, materialsCreated: created };
  }

  // ============================================================
  // Materials UI — List, Filter, Add/Edit Modal
  // ============================================================

  var materialsFilter = 'active'; // active | draft | archived | all
  var materialsCategoryFilter = 'all';
  var editingMaterialId = null;

  var MATERIAL_STATUS_COLORS = {
    active:   { bg: 'rgba(22,163,74,0.15)', color: '#16a34a', border: 'rgba(22,163,74,0.3)' },
    draft:    { bg: 'rgba(196,133,60,0.15)', color: 'var(--amber)', border: 'rgba(196,133,60,0.3)' },
    archived: { bg: 'rgba(156,163,175,0.15)', color: '#9ca3af', border: 'rgba(156,163,175,0.3)' }
  };

  function materialStatusBadgeStyle(status) {
    var c = MATERIAL_STATUS_COLORS[status] || MATERIAL_STATUS_COLORS.draft;
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  function getUomLabel(uom) {
    var match = UOM_OPTIONS.find(function(o) { return o.value === uom; });
    return match ? match.label : uom;
  }

  function getUomShort(uom) {
    return uom || '';
  }

  function getMaterialCategories() {
    var cats = {};
    Object.values(materialsData).forEach(function(m) {
      if (m.category) cats[m.category] = true;
    });
    return Object.keys(cats).sort();
  }

  function renderMaterials() {
    var tab = document.getElementById('materialsTab');
    if (!tab) return;

    var esc = MastAdmin.esc;
    var allMaterials = Object.values(materialsData);

    // Filter by status first — categories chip row is derived from this set
    // so empty categories disappear automatically when their only members are
    // archived (or otherwise filtered out).
    var statusFiltered = materialsFilter === 'all'
      ? allMaterials.slice()
      : allMaterials.filter(function(m) { return m.status === materialsFilter; });

    // Then filter by category to get the actual rows
    var materials = materialsCategoryFilter === 'all'
      ? statusFiltered.slice()
      : statusFiltered.filter(function(m) { return m.category === materialsCategoryFilter; });

    // Sort by name
    materials.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    // Categories shown as chips: only those represented in the post-status set
    var catCounts = {};
    statusFiltered.forEach(function(m) {
      if (m.category) catCounts[m.category] = (catCounts[m.category] || 0) + 1;
    });
    var categories = Object.keys(catCounts).sort();
    var totalCount = Object.keys(materialsData).length;
    var activeCount = Object.values(materialsData).filter(function(m) { return m.status === 'active'; }).length;

    var html = '';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<div>';
    html += '<h2 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Materials</h2>';
    html += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + activeCount + ' active of ' + totalCount + ' total</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="makerResetOnboardingUI()" title="Reset craft profile and re-seed defaults">Reset Defaults</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerOpenImport(\'materials\')">Import CSV</button>';
    html += '<button class="btn btn-secondary btn-small" id="spotRefreshBtn" onclick="makerRefreshSpotPrices()" title="Manually fetch current metals spot prices">↻ Refresh Spot</button>';
    html += '<button class="btn btn-primary" onclick="makerOpenAddMaterial()">+ New Material</button>';
    html += '</div>';
    html += '</div>';

    // Phase 2A gap: spot price status banner
    var hasSpotMaterials = Object.values(materialsData).some(function(m) { return m && m.pricingMode === 'spot-linked'; });
    if (hasSpotMaterials) {
      html += '<div id="spotPriceStatus" style="margin-bottom:12px;padding:8px 12px;background:rgba(42,124,111,0.06);border:1px solid rgba(42,124,111,0.18);border-radius:6px;font-size:0.78rem;color:var(--warm-gray);">';
      html += '<span id="spotPriceStatusText">Loading spot price status…</span>';
      html += '</div>';
    }

    // Filter pills (All first, then status states)
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';
    ['all', 'active', 'draft', 'archived'].forEach(function(f) {
      var active = materialsFilter === f ? ' style="background:var(--charcoal);color:white;border-color:var(--charcoal);"' : '';
      html += '<button class="order-filter-pill"' + active + ' onclick="makerFilterMaterials(\'' + f + '\')">' + f.charAt(0).toUpperCase() + f.slice(1) + '</button>';
    });
    html += '</div>';

    // Category filter
    if (categories.length > 0) {
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">';
      html += '<button class="order-filter-pill"' + (materialsCategoryFilter === 'all' ? ' style="background:var(--charcoal);color:white;border-color:var(--charcoal);"' : '') + ' onclick="makerFilterMaterialsCategory(\'all\')">All Categories</button>';
      categories.forEach(function(cat) {
        var active = materialsCategoryFilter === cat ? ' style="background:var(--charcoal);color:white;border-color:var(--charcoal);"' : '';
        html += '<button class="order-filter-pill"' + active + ' data-cat="' + esc(cat) + '" onclick="makerFilterMaterialsCategory(this.dataset.cat)">' + esc(cat) + '</button>';
      });
      html += '</div>';
    }

    // Empty state
    if (materials.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      html += '<div style="font-size:1.6rem;margin-bottom:12px;">🧱</div>';
      html += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No materials found</p>';
      if (materialsFilter === 'active' && totalCount === 0) {
        html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your raw materials to start building recipes and pricing.</p>';
        html += '<button class="btn btn-primary" style="margin-top:16px;" onclick="makerOpenAddMaterial()">+ New Material</button>';
      } else {
        html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">No materials match the current filters.</p>';
      }
      html += '</div>';
      tab.innerHTML = html;
      return;
    }

    // Table
    html += '<div class="data-table">';
    html += '<table><thead><tr>';
    html += '<th>Name</th>';
    html += '<th>Category</th>';
    html += '<th>UOM</th>';
    html += '<th style="text-align:right;">Unit Cost</th>';
    html += '<th style="text-align:right;">On Hand</th>';
    html += '<th>Status</th>';
    html += '<th style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    materials.forEach(function(m) {
      var id = m.materialId;
      // Whole row is clickable → opens edit modal. Action icons stop propagation.
      html += '<tr data-mid="' + esc(id) + '" style="cursor:pointer;" onclick="makerEditMaterial(this.dataset.mid)">';
      var spotChip = m.pricingMode === 'spot-linked' ? ' <span style="display:inline-block;font-size:0.72rem;font-weight:500;padding:1px 6px;background:rgba(42,124,111,0.12);color:var(--teal);border-radius:8px;margin-left:4px;" title="Linked to ' + esc(m.spotMetal || 'metal') + ' spot price">🔗 ' + esc(m.spotMetal || 'spot') + '</span>' : '';
      html += '<td style="font-weight:500;">' + esc(m.name) + spotChip + '</td>';
      html += '<td>' + esc(m.category || '') + '</td>';
      html += '<td>' + esc(getUomShort(m.unitOfMeasure)) + '</td>';
      html += '<td style="text-align:right;font-family:monospace;">$' + (m.unitCost || 0).toFixed(2) + '</td>';
      html += '<td style="text-align:right;">' + (m.onHandQty || 0) + '</td>';
      html += '<td><span class="status-badge" style="' + materialStatusBadgeStyle(m.status) + '">' + esc(m.status || 'draft') + '</span></td>';
      html += '<td style="text-align:right;white-space:nowrap;" onclick="event.stopPropagation()">';
      html += '<button class="btn-icon" data-mid="' + esc(id) + '" onclick="event.stopPropagation();makerEditMaterial(this.dataset.mid)" title="Edit">\u270E</button>';
      if (m.status !== 'archived') {
        html += ' <button class="btn-icon danger" data-mid="' + esc(id) + '" onclick="event.stopPropagation();makerArchiveMaterialConfirm(this.dataset.mid)" title="Archive">\uD83D\uDCE6</button>';
      }
      html += '</td>';
      html += '</tr>';
    });

    html += '</tbody></table></div>';

    // Phase 2D: price locks section
    var lockEntries = Object.keys(priceLocksData).map(function(lid) {
      return Object.assign({ lockId: lid }, priceLocksData[lid]);
    });
    if (lockEntries.length > 0) {
      // Live status recompute
      lockEntries.forEach(function(l) { l.liveStatus = recomputeLockStatus(l); });
      // Sort: active first, then expired/exhausted, then by createdAt desc
      lockEntries.sort(function(a, b) {
        if (a.liveStatus === 'active' && b.liveStatus !== 'active') return -1;
        if (a.liveStatus !== 'active' && b.liveStatus === 'active') return 1;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
      });
      html += '<div style="margin-top:24px;">';
      html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0 0 8px;">🔒 Price Locks</h3>';
      html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 12px;">Forward purchase agreements with suppliers. Active unexhausted locks override spot pricing in recipes.</p>';
      html += '<div class="data-table"><table><thead><tr>';
      html += '<th>Material</th><th>Locked Price</th><th>Supplier</th><th>Consumed</th><th>Expires</th><th>Status</th><th></th>';
      html += '</tr></thead><tbody>';
      lockEntries.forEach(function(l) {
        var mat = materialsData[l.materialId];
        var matName = mat ? mat.name : '(deleted material)';
        var pctUsed = l.qtyLocked > 0 ? Math.round((l.qtyConsumed / l.qtyLocked) * 100) : 0;
        var daysLeft = l.expiresAt ? Math.ceil((new Date(l.expiresAt).getTime() - Date.now()) / 86400000) : null;
        var statusColor = l.liveStatus === 'active' ? '#16a34a' : (l.liveStatus === 'expired' ? '#dc2626' : '#6b7280');
        var statusBg = l.liveStatus === 'active' ? 'rgba(34,197,94,0.12)' : (l.liveStatus === 'expired' ? 'rgba(220,38,38,0.12)' : 'rgba(107,114,128,0.12)');
        html += '<tr>';
        html += '<td style="font-weight:500;">' + esc(matName) + '</td>';
        html += '<td style="font-family:monospace;">$' + (l.lockedUnitCost || 0).toFixed(2) + '</td>';
        html += '<td>' + esc(l.supplierName || '') + '</td>';
        html += '<td><div style="display:flex;align-items:center;gap:6px;"><div style="background:#e5e7eb;width:80px;height:6px;border-radius:3px;overflow:hidden;"><div style="background:var(--teal);height:100%;width:' + pctUsed + '%;"></div></div><span style="font-size:0.72rem;font-family:monospace;">' + (l.qtyConsumed || 0) + '/' + (l.qtyLocked || 0) + '</span></div></td>';
        html += '<td style="font-size:0.78rem;">' + (l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '—') + (daysLeft != null && daysLeft >= 0 && l.liveStatus === 'active' ? ' <span style="color:var(--warm-gray-light);">(' + daysLeft + 'd)</span>' : '') + '</td>';
        html += '<td><span class="status-badge" style="background:' + statusBg + ';color:' + statusColor + ';font-size:0.72rem;padding:2px 7px;">' + l.liveStatus + '</span></td>';
        html += '<td style="text-align:right;">';
        html += '<button data-lid="' + esc(l.lockId) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.78rem;font-family:\'DM Sans\';" onclick="makerDeletePriceLockConfirm(this.dataset.lid)">Delete</button>';
        html += '</td></tr>';
      });
      html += '</tbody></table></div>';
      html += '</div>';
    }

    tab.innerHTML = html;
  }

  // ============================================================
  // Material Add/Edit Modal
  // ============================================================

  function openMaterialModal(materialId) {
    editingMaterialId = materialId || null;
    var m = materialId ? materialsData[materialId] : null;
    var isEdit = !!m;
    var esc = MastAdmin.esc;
    var categories = getMaterialCategories();

    var html = '';
    html += '<div id="materialModalOverlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;" onclick="makerCloseMaterialModal(event)">';
    html += '<div style="background:var(--cream);border-radius:10px;max-width:560px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.2);padding:20px 24px;" onclick="event.stopPropagation()">';

    // Header
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0 0 16px;">' + (isEdit ? 'Edit Material' : 'New Material') + '</h3>';

    // Name
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Name *</label>';
    html += '<input id="matName" type="text" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;" value="' + esc(m ? m.name : '') + '" placeholder="e.g. 14K Gold Wire">';
    html += '</div>';

    // Category (dropdown + add new)
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Category</label>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<select id="matCategory" style="flex:1;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">';
    html += '<option value="">Select category</option>';
    categories.forEach(function(cat) {
      var sel = m && m.category === cat ? ' selected' : '';
      html += '<option value="' + esc(cat) + '"' + sel + '>' + esc(cat) + '</option>';
    });
    html += '</select>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerAddCategoryPrompt()">+ New</button>';
    html += '</div>';
    html += '</div>';

    // UOM + Unit Cost (side by side)
    html += '<div style="display:flex;gap:12px;margin-bottom:16px;">';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Unit of Measure *</label>';
    html += '<select id="matUom" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">';
    UOM_OPTIONS.forEach(function(opt) {
      var sel = m && m.unitOfMeasure === opt.value ? ' selected' : '';
      html += '<option value="' + opt.value + '"' + sel + '>' + esc(opt.label) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Unit Cost ($) *</label>';
    html += '<input id="matCost" type="number" step="0.01" min="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;" value="' + (m ? m.unitCost || '' : '') + '" placeholder="0.00">';
    html += '</div>';

    html += '</div>';

    // Spot-linked pricing (volatile metals) — toggle shows when mode is spot-linked
    var isSpot = m && m.pricingMode === 'spot-linked';
    html += '<div style="margin-bottom:16px;padding:10px 12px;background:rgba(42,124,111,0.06);border:1px solid rgba(42,124,111,0.18);border-radius:6px;">';
    html += '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;font-weight:600;cursor:pointer;">';
    html += '<input id="matPricingSpot" type="checkbox"' + (isSpot ? ' checked' : '') + ' onchange="makerToggleSpotFields()"> ';
    html += '🔗 Spot-linked pricing (updates daily from metals market)';
    html += '</label>';
    html += '<div id="matSpotFields" style="display:' + (isSpot ? 'flex' : 'none') + ';gap:8px;margin-top:10px;">';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:2px;">Metal</label>';
    html += '<select id="matSpotMetal" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;">';
    ['gold','silver','platinum'].forEach(function(mt) {
      var sel = m && m.spotMetal === mt ? ' selected' : '';
      html += '<option value="' + mt + '"' + sel + '>' + mt.charAt(0).toUpperCase() + mt.slice(1) + '</option>';
    });
    html += '</select></div>';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:2px;">Purity</label>';
    html += '<input id="matPurity" type="number" step="0.001" min="0" max="1" placeholder="e.g. 0.585 (14k)" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" value="' + (m && m.purity != null ? m.purity : '') + '"></div>';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:2px;">Markup %</label>';
    html += '<input id="matMarkupSpot" type="number" step="0.1" min="0" placeholder="e.g. 8" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" value="' + (m && m.markupOverSpot != null ? m.markupOverSpot : '') + '"></div>';
    html += '</div>';
    html += '<p style="font-size:0.72rem;color:var(--warm-gray);margin:8px 0 0;">Unit Cost auto-updates daily: spot × purity × (1 + markup%) ÷ unitConversion. Set purity (e.g. 0.999 fine, 0.925 sterling, 0.585 14k) and supplier markup.</p>';
    html += '</div>';

    // Landed cost helper — prorate freight $ across last purchase qty into unitCost
    html += '<details style="margin-bottom:16px;background:rgba(196,133,60,0.05);border:1px solid rgba(196,133,60,0.2);border-radius:6px;">';
    html += '<summary style="cursor:pointer;padding:8px 12px;font-size:0.85rem;font-weight:600;color:var(--amber);">+ Apply landed cost (freight, customs)</summary>';
    html += '<div style="padding:0 12px 12px;">';
    html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:6px 0 10px;">Add freight, customs, or supplier fees to your unit cost. Enter the extra charge and the qty it covers — we will prorate per unit and update Unit Cost above.</p>';
    html += '<div style="display:flex;gap:8px;align-items:flex-end;">';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:2px;">Extra charge ($)</label><input id="matLandedExtra" type="number" step="0.01" min="0" placeholder="e.g. 25.00" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;"></div>';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:2px;">Qty covered</label><input id="matLandedQty" type="number" step="0.01" min="0" placeholder="e.g. 100" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;"></div>';
    html += '<button type="button" class="btn btn-secondary btn-small" style="font-size:0.78rem;" onclick="makerApplyLandedCost()">Apply</button>';
    html += '</div>';
    html += '</div></details>';

    // Cost history (edit only) — show last 5 entries
    if (isEdit && m) {
      var history = Array.isArray(m.costHistory) ? m.costHistory.slice() : [];
      // Fall back to legacy single snapshot if no history array yet
      if (history.length === 0 && m.previousUnitCost != null) {
        history.push({
          cost: m.previousUnitCost,
          changedAt: m.costChangedAt || m.updatedAt,
          changedBy: 'legacy'
        });
      }
      if (history.length > 0) {
        var recent = history.slice(-5).reverse();
        html += '<div style="background:rgba(42,124,111,0.06);border:1px solid rgba(42,124,111,0.15);border-radius:6px;padding:10px 12px;margin-bottom:16px;font-size:0.78rem;color:var(--warm-gray);">';
        html += '<div style="font-weight:600;margin-bottom:6px;color:var(--charcoal);">Cost History <span style="font-weight:400;color:var(--warm-gray-light);">(most recent ' + recent.length + ' of ' + history.length + ')</span></div>';
        recent.forEach(function(h) {
          var when = h.changedAt ? new Date(h.changedAt).toLocaleDateString() : '—';
          html += '<div style="display:flex;justify-content:space-between;padding:2px 0;"><span>' + when + '</span><span style="font-family:monospace;">$' + (h.cost || 0).toFixed(2) + '</span></div>';
        });
        html += '</div>';
      }
    }

    // Purchase UOM + Conversion Factor (optional — for buy vs use unit)
    html += '<div style="display:flex;gap:12px;margin-bottom:16px;">';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Purchase UOM <span style="font-weight:400;color:var(--warm-gray);">(optional)</span></label>';
    html += '<select id="matPurchaseUOM" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">';
    html += '<option value="">Same as above</option>';
    UOM_OPTIONS.forEach(function(opt) {
      var sel = m && m.purchaseUOM === opt.value ? ' selected' : '';
      html += '<option value="' + opt.value + '"' + sel + '>' + esc(opt.label) + '</option>';
    });
    html += '</select>';
    html += '</div>';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Conversion Factor</label>';
    html += '<input id="matConvFactor" type="number" step="0.0001" min="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;" value="' + (m && m.conversionFactor ? m.conversionFactor : '') + '" placeholder="e.g. 20 (1 oz = 20 dwt)">';
    html += '</div>';

    html += '</div>';

    // On Hand Qty + Reorder Threshold (side by side)
    html += '<div style="display:flex;gap:12px;margin-bottom:16px;">';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">On Hand Qty</label>';
    html += '<input id="matOnHand" type="number" step="0.01" min="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;" value="' + (m ? m.onHandQty || '' : '') + '" placeholder="0">';
    html += '</div>';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Reorder Threshold</label>';
    html += '<input id="matReorder" type="number" step="0.01" min="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;" value="' + (m ? m.reorderThreshold || '' : '') + '" placeholder="0">';
    html += '</div>';

    html += '</div>';

    // Status (for edit only)
    if (isEdit) {
      html += '<div style="margin-bottom:16px;">';
      html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Status</label>';
      html += '<select id="matStatus" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">';
      ['active', 'draft', 'archived'].forEach(function(s) {
        var sel = m.status === s ? ' selected' : '';
        html += '<option value="' + s + '"' + sel + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
      });
      html += '</select>';
      html += '</div>';
    }

    // Notes
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Notes</label>';
    html += '<textarea id="matNotes" rows="2" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;resize:vertical;box-sizing:border-box;">' + esc(m ? m.notes : '') + '</textarea>';
    html += '</div>';

    // Footer
    html += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">';
    html += '<button class="btn btn-secondary" onclick="makerCloseMaterialModal()">Cancel</button>';
    html += '<button class="btn btn-primary" onclick="makerSaveMaterialForm()">' + (isEdit ? 'Save' : 'Create Material') + '</button>';
    html += '</div>';

    html += '</div></div>';

    // Append modal
    var container = document.createElement('div');
    container.id = 'materialModalContainer';
    container.innerHTML = html;
    document.body.appendChild(container);
  }

  function closeMaterialModal(event) {
    if (event && event.target && event.target.id !== 'materialModalOverlay') return;
    var container = document.getElementById('materialModalContainer');
    if (container) container.remove();
    editingMaterialId = null;
  }

  /**
   * Landed-cost helper — adds (extra / qty) to current unitCost in the open form.
   * Does not save until user clicks Save Material; once saved, normal cost-history
   * + costsDirty propagation kicks in.
   */
  function applyLandedCost() {
    var extraEl = document.getElementById('matLandedExtra');
    var qtyEl = document.getElementById('matLandedQty');
    var costEl = document.getElementById('matCost');
    if (!extraEl || !qtyEl || !costEl) return;
    var extra = parseFloat(extraEl.value);
    var qty = parseFloat(qtyEl.value);
    if (isNaN(extra) || extra <= 0) {
      MastAdmin.showToast('Enter a positive extra charge', true);
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      MastAdmin.showToast('Enter a positive qty', true);
      return;
    }
    var current = parseFloat(costEl.value) || 0;
    var addPerUnit = extra / qty;
    var next = Math.round((current + addPerUnit) * 10000) / 10000;
    costEl.value = next;
    extraEl.value = '';
    qtyEl.value = '';
    MastAdmin.showToast('Added $' + addPerUnit.toFixed(4) + '/unit — review and Save to commit');
  }

  async function saveMaterialForm() {
    var name = (document.getElementById('matName').value || '').trim();
    if (!name) {
      MastAdmin.showToast('Material name is required', true);
      return;
    }

    var cost = parseFloat(document.getElementById('matCost').value) || 0;
    var purchaseUOM = (document.getElementById('matPurchaseUOM') || {}).value || '';
    var convFactor = parseFloat((document.getElementById('matConvFactor') || {}).value) || 0;

    var data = {
      name: name,
      category: document.getElementById('matCategory').value || '',
      unitOfMeasure: document.getElementById('matUom').value || 'each',
      unitCost: cost,
      onHandQty: parseFloat(document.getElementById('matOnHand').value) || 0,
      reorderThreshold: parseFloat(document.getElementById('matReorder').value) || 0,
      notes: (document.getElementById('matNotes').value || '').trim()
    };
    if (purchaseUOM) data.purchaseUOM = purchaseUOM;
    if (convFactor > 0) data.conversionFactor = convFactor;

    // Spot-linked pricing fields
    var spotEl = document.getElementById('matPricingSpot');
    if (spotEl && spotEl.checked) {
      var purity = parseFloat((document.getElementById('matPurity') || {}).value);
      var markupOverSpot = parseFloat((document.getElementById('matMarkupSpot') || {}).value);
      // Friendly auto-correct: if the user typed a karat number (e.g. 14, 18, 24)
      // instead of the fraction, convert it. 24k = .999 fine.
      if (purity > 1 && purity <= 24) {
        purity = Math.round((purity / 24) * 1000) / 1000;
      }
      if (!(purity > 0) || purity > 1) {
        MastAdmin.showToast('Purity must be a fraction between 0 and 1 (e.g. 0.585 for 14k, 0.925 for sterling, 0.999 for fine)', true);
        return;
      }
      data.pricingMode = 'spot-linked';
      data.spotMetal = (document.getElementById('matSpotMetal') || {}).value || 'gold';
      data.purity = purity;
      data.markupOverSpot = isNaN(markupOverSpot) ? 0 : markupOverSpot;
      // Auto-fill conversionFactor if blank, based on the UOM. Spot is per troy oz.
      if (!(convFactor > 0)) {
        var uomNow = (document.getElementById('matUnit') || {}).value;
        var auto = ({ oz: 1, dwt: 20, carat: 155.5174, gram: 31.1035, kg: 0.0311035, lb: 0.0685714 })[uomNow];
        if (auto) data.conversionFactor = auto;
      }
    } else {
      data.pricingMode = 'fixed';
      data.spotMetal = null;
      data.purity = null;
      data.markupOverSpot = null;
    }

    var statusEl = document.getElementById('matStatus');
    if (statusEl) data.status = statusEl.value;

    try {
      if (editingMaterialId) {
        await updateMaterial(editingMaterialId, data);
        MastAdmin.showToast('Material updated');
      } else {
        data.status = data.status || 'active';
        await createMaterial(data);
        MastAdmin.showToast('Material created');
      }
      closeMaterialModal();
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  async function archiveMaterialConfirm(id) {
    var m = materialsData[id];
    if (!m) return;
    if (!await mastConfirm('Archive "' + m.name + '"? This cannot be undone.', { title: 'Archive Material', danger: true })) return;
    archiveMaterial(id).then(function() {
      MastAdmin.showToast('Material archived');
    }).catch(function(err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    });
  }

  // ============================================================
  // Category Management
  // ============================================================

  async function addCategoryPrompt() {
    var cat = await mastPrompt('Enter new category name:', { title: 'Add Category' });
    if (!cat || !cat.trim()) return;
    cat = cat.trim();

    // Add to dropdown
    var select = document.getElementById('matCategory');
    if (select) {
      var opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      opt.selected = true;
      select.appendChild(opt);
    }
  }

  // ============================================================
  // Materials Filter Controls
  // ============================================================

  function filterMaterials(status) {
    materialsFilter = status;
    renderMaterials();
  }

  function filterMaterialsCategory(cat) {
    materialsCategoryFilter = cat;
    renderMaterials();
  }

  // ============================================================
  // Craft Profile Onboarding Banner
  // ============================================================

  async function checkMakerOnboarding() {
    var settings = await getMakerSettings();
    if (settings.materialsSeeded) return;

    // Show onboarding banner in materials tab
    var tab = document.getElementById('materialsTab');
    if (!tab) return;

    // Don't add banner if it already exists
    if (tab.querySelector('#makerOnboardingBanner')) return;

    var html = '';
    html += '<div id="makerOnboardingBanner" style="background:rgba(42,124,111,0.08);border:1px solid var(--teal-light);border-radius:8px;padding:20px 24px;margin-bottom:20px;">';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0 0 8px;color:var(--teal-deep);">Welcome to Materials</h3>';
    html += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px;">Select your craft to pre-load categories and sample materials. You can customize everything later.</p>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px;">';

    var profiles = [
      { id: 'jewelry', icon: '💎', label: 'Jewelry' },
      { id: 'glass', icon: '🔥', label: 'Glass' },
      { id: 'ceramics', icon: '🏺', label: 'Ceramics' },
      { id: 'fiber', icon: '🧶', label: 'Fiber' },
      { id: 'other', icon: '🎨', label: 'Other' }
    ];

    profiles.forEach(function(p) {
      html += '<button class="btn btn-secondary" style="font-size:0.9rem;" onclick="makerSelectCraftProfile(\'' + p.id + '\')">' + p.icon + ' ' + p.label + '</button>';
    });

    html += '</div></div>';

    // Prepend to tab
    tab.insertAdjacentHTML('afterbegin', html);
  }

  async function selectCraftProfile(profile) {
    try {
      var result = await seedMaterials(profile);
      if (result.seeded) {
        // Remove onboarding banner
        var banner = document.getElementById('makerOnboardingBanner');
        if (banner) banner.remove();
        // Switch filter to draft so seeded materials are visible
        materialsFilter = 'draft';
        MastAdmin.showToast('Materials seeded for ' + profile + ' (' + result.materialsCreated + ' samples added)');
        renderMaterials();
      } else {
        MastAdmin.showToast('Materials already seeded. Switch filter to Draft or All to see them.', true);
      }
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  /**
   * Reset onboarding — clears materialsSeeded flag so banner reappears.
   * Dev/testing utility. Exposed as window.makerResetOnboarding.
   */
  async function resetOnboarding() {
    await saveMakerSettings({ materialsSeeded: false, craftProfile: null });
    // Remove all seeded materials
    var mats = Object.values(materialsData);
    for (var i = 0; i < mats.length; i++) {
      if (mats[i].status === 'draft' && mats[i].craftProfile) {
        await MastDB.materials.remove(mats[i].materialId);
      }
    }
    MastAdmin.showToast('Onboarding reset — refresh the page');
  }

  // ============================================================
  // Pieces List UI
  // ============================================================

  var piecesView = 'list'; // list | builder
  var piecesCategoryFilter = ''; // '' = all
  var piecesExpandedPids = {}; // pid -> true when variants expanded
  var editingRecipeId = null;
  var builderState = null; // live state for the recipe builder
  var currentVariantId = 'default'; // active variant tab key — 'default' or productVariantId

  function renderPieces() {
    if (piecesView === 'builder' && editingRecipeId) {
      renderRecipeBuilder();
      return;
    }
    if (piecesView === 'define' && defineState && defineMode) {
      renderDefineView();
      return;
    }
    renderPiecesList();
  }

  function renderPiecesList() {
    var tab = document.getElementById('piecesTab');
    if (!tab) return;
    var esc = MastAdmin.esc;

    // Get products from global productsData
    var products = window.productsData || [];
    if (!products.length && !window.productsLoaded) {
      tab.innerHTML = '<div class="loading">Loading products...</div>';
      // Wait for products to load, then re-render
      if (typeof window.loadProducts === 'function') {
        window.loadProducts().then(function() { renderPiecesList(); });
      }
      return;
    }

    // Build recipe lookup: productId → recipe
    var recipeByProduct = {};
    Object.values(recipesData).forEach(function(r) {
      if (r.status !== 'archived' && r.productId) {
        recipeByProduct[r.productId] = r;
      }
    });

    var html = '';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<div>';
    html += '<h2 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Pieces</h2>';
    var filteredProducts = piecesCategoryFilter
      ? products.filter(function(p) { return (p.categories || []).indexOf(piecesCategoryFilter) >= 0; })
      : products;
    var filteredWithRecipes = filteredProducts.filter(function(p){ return !!recipeByProduct[p.pid]; }).length;
    html += '<span style="font-size:0.85rem;color:var(--warm-gray);">' + filteredProducts.length + ' product' + (filteredProducts.length === 1 ? '' : 's') + (piecesCategoryFilter ? ' in ' + esc(piecesCategoryFilter) : '') + ', ' + filteredWithRecipes + ' with recipes</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';

    // Health badges: dirty count + below-floor count + Phase 2C drift count
    var dirtyCount = 0;
    var belowFloorCount = 0;
    var driftFlagged = 0;
    Object.keys(recipesData).forEach(function(rid) {
      var r = recipesData[rid];
      if (!r || r.status === 'archived') return;
      if (r.costsDirty) dirtyCount++;
      if (typeof r.currentDriftPct === 'number' && Math.abs(r.currentDriftPct) >= repricingThresholdPct && r.driftBaseline) driftFlagged++;
      if (r.minMarginPercent != null) {
        var aTier = r.activePriceTier || 'direct';
        var aPrice = (r.isVariantEnabled && r.variants) ? getFirstVariantTierPrice(aTier, r) : (r[aTier + 'Price'] || 0);
        var aPct = aPrice > 0 ? ((aPrice - (r.totalCost || 0)) / aPrice) * 100 : 0;
        if (aPct < r.minMarginPercent) belowFloorCount++;
      }
    });
    if (dirtyCount > 0) {
      html += '<button class="btn btn-secondary btn-small" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.4);color:#b45309;" onclick="makerRecalcAllDirty()" title="Recalculate all flagged recipes">⚠ ' + dirtyCount + ' need recalc</button>';
    }
    if (driftFlagged > 0) {
      html += '<button class="btn btn-secondary btn-small" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.4);color:#991b1b;" onclick="makerOpenRepriceAllModal()" title="Bulk reprice — preview before commit">↻ ' + driftFlagged + ' need repricing</button>';
    }
    if (belowFloorCount > 0) {
      html += '<span class="status-badge" style="background:rgba(220,38,38,0.1);color:#991b1b;border:1px solid rgba(220,38,38,0.3);font-size:0.72rem;padding:5px 9px;">' + belowFloorCount + ' below margin floor</span>';
    }

    // Category filter — collect unique categories from all products
    var categorySet = {};
    products.forEach(function(p) {
      (p.categories || []).forEach(function(c) { if (c) categorySet[c] = true; });
    });
    var categoryList = Object.keys(categorySet).sort();
    if (categoryList.length > 0) {
      html += '<select onchange="makerSetCategoryFilter(this.value)" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';cursor:pointer;" title="Filter by category">';
      html += '<option value=""' + (piecesCategoryFilter === '' ? ' selected' : '') + '>All categories</option>';
      categoryList.forEach(function(c) {
        html += '<option value="' + esc(c) + '"' + (piecesCategoryFilter === c ? ' selected' : '') + '>' + esc(c) + '</option>';
      });
      html += '</select>';
    }

    html += '<button class="btn btn-primary btn-small" onclick="makerCreateNewPiece()">+ New Piece</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerOpenWhatIfSimulator()" title="Simulate metals price shifts across all recipes">📊 What-if</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerOpenChannelsManager()" title="Manage sales channel fee profiles">Channels</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerOpenImport(\'products\')">Import CSV</button>';
    html += '</div>';
    html += '</div>';

    if (products.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      html += '<div style="font-size:1.6rem;margin-bottom:12px;">📦</div>';
      html += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No products yet</p>';
      html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add products first, then create recipes to calculate pricing.</p>';
      html += '</div>';
      tab.innerHTML = html;
      return;
    }

    // Table
    html += '<div class="data-table"><table><thead><tr>';
    html += '<th>Product</th>';
    html += '<th>Status</th>';
    html += '<th>Category</th>';
    html += '<th>Recipe</th>';
    html += '<th style="text-align:right;">Total Cost</th>';
    html += '<th>Active Tier</th>';
    html += '<th style="text-align:right;">Price</th>';
    html += '<th style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    filteredProducts.forEach(function(p) {
      var pid = p.pid;
      var recipe = recipeByProduct[pid];
      var hasRecipe = !!recipe;
      var prodVariants = Array.isArray(p.variants) ? p.variants.map(function(v) {
        if (v && v.id) return v;
        var k = productVariantKey(v);
        return k ? Object.assign({}, v, { id: k }) : null;
      }).filter(Boolean) : [];
      var hasVariants = prodVariants.length > 0;

      // Whole-row click dispatches by acquisitionType:
      // 'build' → recipe builder (legacy); 'var' / 'resell' → Define view.
      var atype = p.acquisitionType || 'build';
      var rowClick;
      if (atype === 'build') {
        rowClick = hasRecipe
          ? 'makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\')'
          : 'makerCreateRecipeForProduct(this.dataset.pid, this.dataset.name)';
      } else {
        rowClick = 'makerOpenDefineForProduct(this.dataset.pid)';
      }
      html += '<tr style="cursor:pointer;" data-pid="' + esc(pid) + '" data-name="' + esc(p.name || '') + '" onclick="' + rowClick + '">';
      var isExpanded = !!piecesExpandedPids[pid];
      var expandToggle = hasVariants
        ? '<span onclick="event.stopPropagation();makerTogglePieceVariants(\'' + esc(pid) + '\')" style="display:inline-block;width:16px;text-align:center;cursor:pointer;color:var(--warm-gray);margin-right:6px;user-select:none;" title="' + (isExpanded ? 'Collapse' : 'Expand') + ' variants">' + (isExpanded ? '▾' : '▸') + '</span>'
        : '<span style="display:inline-block;width:16px;margin-right:6px;"></span>';
      var variantCountBadge = hasVariants ? ' <span style="font-size:0.72rem;color:var(--warm-gray-light);font-weight:400;">(' + prodVariants.length + ' variants)</span>' : '';
      // Checkpoint F — version badge for v2+ or products with a child Draft
      var versionBadge = '';
      var pVer = Number(p.version) || 1;
      var pHasChild = !!findChildVersion(pid);
      if (pVer >= 2) {
        versionBadge = ' <span class="status-badge" style="background:rgba(217,119,6,0.15);color:#b45309;font-size:0.68rem;padding:2px 6px;">v' + pVer + '</span>';
      } else if (pHasChild) {
        versionBadge = ' <span class="status-badge" style="background:rgba(217,119,6,0.10);color:#b45309;font-size:0.68rem;padding:2px 6px;" title="A v2 Draft exists for this product">v1 · v2 in dev</span>';
      }
      var pendingBadge = p.hasPendingRevision
        ? ' <span class="status-badge" style="background:rgba(217,119,6,0.18);color:#b45309;font-size:0.68rem;padding:2px 6px;" title="Pending revision">⚠ pending</span>'
        : '';
      html += '<td style="font-weight:500;">' + expandToggle + esc(p.name || '') + variantCountBadge + versionBadge + pendingBadge + '</td>';
      html += '<td>' + productStatusBadgeHtml(p.status) + '</td>';
      html += '<td>' + esc((p.categories || []).join(', ')) + '</td>';

      // Mode badge for VAR/Resell — render before the recipe column
      var modeBadgeHtml = '';
      if (atype === 'var') {
        modeBadgeHtml = ' <span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.68rem;padding:2px 6px;">VAR</span>';
      } else if (atype === 'resell') {
        modeBadgeHtml = ' <span class="status-badge" style="background:rgba(42,124,111,0.15);color:var(--teal);font-size:0.68rem;padding:2px 6px;">Resell</span>';
      }
      if (hasRecipe) {
        var dirtyIcon = recipe.costsDirty ? ' <span title="Costs changed" style="color:#f59e0b;">⚠</span>' : '';
        html += '<td><span class="status-badge" style="' + materialStatusBadgeStyle('active') + '">has recipe</span>' + dirtyIcon + modeBadgeHtml + '</td>';
        html += '<td style="text-align:right;font-family:monospace;">$' + (recipe.totalCost || 0).toFixed(2) + '</td>';
        var etsyIcon = p.etsyListingId ? (recipe.lastEtsySyncAt ? ' <span title="Synced to Etsy" style="font-size:0.78rem;">🔗</span>' : ' <span title="Etsy listing linked" style="font-size:0.78rem;opacity:0.5;">🔗</span>') : '';
        var variantBadge = recipe.isVariantEnabled && recipe.variants ? ' <span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.72rem;">' + Object.keys(recipe.variants).length + ' variants</span>' : '';
        html += '<td><span class="status-badge pill" style="background:rgba(42,124,111,0.12);color:var(--teal);border:1px solid rgba(42,124,111,0.25);">' + esc(recipe.activePriceTier || 'none') + '</span>' + variantBadge + etsyIcon + '</td>';
        var activePrice;
        if (recipe.isVariantEnabled && recipe.variants) {
          activePrice = getFirstVariantTierPrice(recipe.activePriceTier, recipe);
        } else {
          activePrice = getTierPrice(recipe.activePriceTier, recipe);
        }
        html += '<td style="text-align:right;font-family:monospace;font-weight:600;">$' + activePrice.toFixed(2) + '</td>';
        html += '<td style="text-align:right;">';
        if (atype === 'build') {
          html += '<button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="event.stopPropagation();makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\')">Edit Recipe</button>';
        } else {
          html += '<button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" data-pid="' + esc(pid) + '" onclick="event.stopPropagation();makerOpenDefineForProduct(this.dataset.pid)">Edit Define</button>';
        }
        html += '</td>';
      } else {
        if (atype === 'build') {
          html += '<td><span style="color:var(--warm-gray-light);font-size:0.85rem;">no recipe</span>' + modeBadgeHtml + '</td>';
        } else {
          html += '<td><span style="color:var(--warm-gray-light);font-size:0.85rem;">define ' + atype + '</span>' + modeBadgeHtml + '</td>';
        }
        var totalCostDollars = (p.totalCost || 0) / 100;
        html += '<td style="text-align:right;font-family:monospace;">' + (atype === 'build' ? '—' : ('$' + totalCostDollars.toFixed(2))) + '</td>';
        html += '<td>—</td>';
        html += '<td style="text-align:right;font-family:monospace;">$' + (p.priceCents ? (p.priceCents / 100).toFixed(2) : '0.00') + '</td>';
        html += '<td style="text-align:right;">';
        if (atype === 'build') {
          html += '<button class="btn btn-outline btn-small" data-pid="' + esc(pid) + '" data-name="' + esc(p.name || '') + '" onclick="event.stopPropagation();makerCreateRecipeForProduct(this.dataset.pid, this.dataset.name)">+ Add Recipe</button>';
        } else {
          html += '<button class="btn btn-outline btn-small" data-pid="' + esc(pid) + '" onclick="event.stopPropagation();makerOpenDefineForProduct(this.dataset.pid)">' + (atype === 'var' ? 'Define VAR' : 'Define Resell') + '</button>';
        }
        html += '</td>';
      }

      html += '</tr>';

      // Variant sub-rows — one per product variant, showing recipe override cost/price if present
      if (hasVariants && isExpanded) {
        var activeTier = hasRecipe ? (recipe.activePriceTier || 'direct') : 'direct';
        prodVariants.forEach(function(pv) {
          var vName = variantDisplayName(pv);
          var rvOverride = hasRecipe && recipe.variants && recipe.variants[pv.id] ? recipe.variants[pv.id] : null;
          var vCost = rvOverride && typeof rvOverride.totalCost === 'number' ? rvOverride.totalCost : (hasRecipe ? (recipe.totalCost || 0) : 0);
          var vPrice = 0;
          if (rvOverride && typeof rvOverride[activeTier + 'Price'] === 'number') {
            vPrice = rvOverride[activeTier + 'Price'];
          } else if (typeof pv.priceCents === 'number') {
            vPrice = pv.priceCents / 100;
          }
          var vRowClick = hasRecipe
            ? 'makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\', \'' + esc(pv.id) + '\')'
            : 'makerCreateRecipeForProduct(this.dataset.pid, this.dataset.name)';
          html += '<tr style="cursor:pointer;background:rgba(0,0,0,0.015);" data-pid="' + esc(pid) + '" data-name="' + esc(p.name || '') + '" onclick="' + vRowClick + '">';
          html += '<td style="padding-left:28px;font-size:0.85rem;color:var(--warm-gray);">↳ ' + esc(vName) + '</td>';
          html += '<td></td>'; // status (variant inherits from parent)
          html += '<td></td>';
          if (hasRecipe) {
            var overrideBadge = rvOverride
              ? '<span class="status-badge" style="background:rgba(196,133,60,0.12);color:var(--amber);font-size:0.72rem;">override</span>'
              : '<span style="font-size:0.78rem;color:var(--warm-gray-light);font-style:italic;">inherits default</span>';
            html += '<td>' + overrideBadge + '</td>';
            html += '<td style="text-align:right;font-family:monospace;font-size:0.85rem;color:var(--warm-gray);">$' + vCost.toFixed(2) + '</td>';
            html += '<td></td>';
            html += '<td style="text-align:right;font-family:monospace;font-size:0.85rem;">$' + vPrice.toFixed(2) + '</td>';
            html += '<td></td>';
          } else {
            html += '<td><span style="color:var(--warm-gray-light);font-size:0.78rem;">—</span></td>';
            html += '<td style="text-align:right;">—</td>';
            html += '<td></td>';
            html += '<td style="text-align:right;font-family:monospace;font-size:0.85rem;">$' + vPrice.toFixed(2) + '</td>';
            html += '<td></td>';
          }
          html += '</tr>';
        });
      }
    });

    html += '</tbody></table></div>';
    tab.innerHTML = html;
  }

  // ============================================================
  // Checkpoint D — Acquisition Mode Branching
  // ----------------------------------------------------------------
  // Three Define-tab variants: Build (existing Recipe Builder), VAR
  // (Components + Value-Add Steps), Resell (Supplier + Landed Cost).
  // All three modes write a uniform costShape to the Product record so
  // the downstream Costs / Channels / Capacity tabs are mode-agnostic.
  // ============================================================

  // Per-product define state for VAR/Resell modes (mirrors builderState)
  var defineState = null;       // working copy of the product being defined
  var defineMode = null;        // 'var' | 'resell' | null
  var defineProductId = null;

  /**
   * computeCostShape — uniform downstream interface.
   * Returns { materialCost, laborCost, otherCost, totalCost } in CENTS.
   * Reads from the right slice of defineSpec based on acquisitionType.
   * For Build mode, falls back to the linked recipe's totalCost decomposition.
   */
  function computeCostShape(product, recipe) {
    product = product || {};
    var atype = product.acquisitionType || 'build';
    var laborRate = (window.makerLaborRate ? window.makerLaborRate() : null);
    if (typeof laborRate !== 'number') {
      // Fall back to recipe.laborRatePerHour or 0
      laborRate = (recipe && recipe.laborRatePerHour) || 0;
    }

    if (atype === 'build') {
      // Build: read decomposition from the linked recipe
      if (!recipe) return { materialCost: 0, laborCost: 0, otherCost: 0, totalCost: 0 };
      var totalDollars = recipe.totalCost || 0;
      var matDollars = recipe.totalMaterialCost || 0;
      var labDollars = recipe.laborCost || 0;
      var setupDollars = recipe.perUnitSetup || 0;
      var otherDollars = (totalDollars - matDollars - labDollars - setupDollars);
      if (otherDollars < 0) otherDollars = 0;
      return {
        materialCost: Math.round(matDollars * 100),
        laborCost: Math.round(labDollars * 100),
        otherCost: Math.round((otherDollars + setupDollars) * 100),
        totalCost: Math.round(totalDollars * 100)
      };
    }

    var spec = (product.defineSpec || {})[atype] || {};

    if (atype === 'var') {
      // Components → materialCost. Value-add steps minutes → laborCost; otherCost → otherCost.
      var matCents = 0;
      var components = Array.isArray(spec.components) ? spec.components : [];
      components.forEach(function(c) {
        var qty = Number(c.quantity) || 0;
        var scrap = Number(c.scrapPercent) || 0;
        var unit = Number(c.unitCost) || 0; // dollars
        var effQty = qty * (1 + scrap / 100);
        matCents += Math.round(effQty * unit * 100);
      });
      var labMinutes = 0;
      var otherCents = 0;
      var steps = Array.isArray(spec.valueAddSteps) ? spec.valueAddSteps : [];
      steps.forEach(function(s) {
        labMinutes += Number(s.laborMinutes) || 0;
        otherCents += Math.round((Number(s.otherCost) || 0) * 100);
      });
      var labCents = Math.round((labMinutes / 60) * laborRate * 100);
      return {
        materialCost: matCents,
        laborCost: labCents,
        otherCost: otherCents,
        totalCost: matCents + labCents + otherCents
      };
    }

    if (atype === 'resell') {
      // materialCost = unitCost; laborCost = 0; otherCost = sum of landed cost components
      var supplier = spec.supplier || {};
      var landed = spec.landedCost || {};
      var unitCostCents = Math.round((Number(supplier.unitCost) || 0) * 100);
      var freightCents = Math.round((Number(landed.freight) || 0) * 100);
      var storageCents = Math.round((Number(landed.storage) || 0) * 100);
      var otherCents2 = Math.round((Number(landed.other) || 0) * 100);
      // Duty: percent of unitCost OR per-unit dollars (if dutyMode === 'percent', treat as %)
      var dutyCents = 0;
      if (landed.dutyMode === 'percent') {
        var dutyPct = Number(landed.duty) || 0;
        dutyCents = Math.round(unitCostCents * (dutyPct / 100));
      } else {
        dutyCents = Math.round((Number(landed.duty) || 0) * 100);
      }
      var totalOther = freightCents + dutyCents + storageCents + otherCents2;
      return {
        materialCost: unitCostCents,
        laborCost: 0,
        otherCost: totalOther,
        totalCost: unitCostCents + totalOther
      };
    }

    return { materialCost: 0, laborCost: 0, otherCost: 0, totalCost: 0 };
  }

  // Read the tenant's labor rate from admin config (mirrors what recipe builder uses).
  // Falls back to 0 if unavailable. This is intentionally synchronous-safe; the
  // recipe path passes its own rate, so this only matters for VAR.
  window.makerLaborRate = window.makerLaborRate || function() {
    // Look up the most-recent recipe to infer the labor rate (cheap fallback).
    var rates = [];
    try {
      Object.keys(recipesData).forEach(function(rid) {
        var r = recipesData[rid];
        if (r && typeof r.laborRatePerHour === 'number') rates.push(r.laborRatePerHour);
      });
    } catch (e) {}
    if (rates.length) return rates[0];
    return 0;
  };

  /**
   * Persist the costShape onto the Product record.
   * Writes materialCost / laborCost / otherCost / totalCost (cents) so the
   * Costs tab and pricing logic can read uniformly regardless of mode.
   */
  async function persistCostShape(productId, costShape) {
    if (!productId || !costShape) return;
    var path = 'public/products/' + productId + '/';
    var updates = {};
    updates[path + 'materialCost'] = costShape.materialCost;
    updates[path + 'laborCost'] = costShape.laborCost;
    updates[path + 'otherCost'] = costShape.otherCost;
    updates[path + 'totalCost'] = costShape.totalCost;
    updates[path + 'costShapeUpdatedAt'] = new Date().toISOString();
    if (typeof MastDB.update === 'function') {
      // MastDB.update expects a path + value pair; do per-field writes
      for (var p in updates) {
        if (Object.prototype.hasOwnProperty.call(updates, p)) {
          await MastDB.set(p, updates[p]);
        }
      }
    }
    // Refresh in-memory product
    if (window.productsData) {
      var prod = window.productsData.find(function(p) { return p.pid === productId; });
      if (prod) {
        prod.materialCost = costShape.materialCost;
        prod.laborCost = costShape.laborCost;
        prod.otherCost = costShape.otherCost;
        prod.totalCost = costShape.totalCost;
        prod.costShapeUpdatedAt = updates[path + 'costShapeUpdatedAt'];
      }
    }
  }

  /**
   * Open the Define view for a product, dispatching by acquisitionType.
   * - 'build' → existing recipe builder (creates a recipe if needed)
   * - 'var' / 'resell' → render the alternate Define view
   */
  async function openDefineForProduct(pid) {
    var products = window.productsData || [];
    var product = products.find(function(p) { return p.pid === pid; });
    if (!product) {
      MastAdmin.showToast('Product not found', true);
      return;
    }
    var atype = product.acquisitionType || 'build';

    if (atype === 'build') {
      // Find or create a recipe and open the recipe builder
      var existing = null;
      Object.values(recipesData).forEach(function(r) {
        if (r.status !== 'archived' && r.productId === pid) existing = r;
      });
      if (existing) {
        return openRecipeBuilder(existing.recipeId);
      }
      return createRecipeForProduct(pid, product.name || '');
    }

    // VAR or Resell — open Define view
    defineProductId = pid;
    defineMode = atype;
    // Deep-copy product slice so user can edit without committing
    defineState = JSON.parse(JSON.stringify(product));
    if (!defineState.defineSpec) defineState.defineSpec = {};
    if (!defineState.defineSpec[atype]) {
      if (atype === 'var') {
        defineState.defineSpec.var = { components: [], valueAddSteps: [] };
      } else if (atype === 'resell') {
        defineState.defineSpec.resell = {
          supplier: { supplierName: '', supplierSku: '', unitCost: 0, moq: 1 },
          landedCost: { freight: 0, duty: 0, dutyMode: 'per-unit', storage: 0, other: 0 },
          leadTimeDays: 0
        };
      }
    }
    piecesView = 'define';
    renderDefineView();
  }

  function closeDefineView() {
    defineState = null;
    defineMode = null;
    defineProductId = null;
    piecesView = 'list';
    renderPiecesList();
  }

  function renderDefineView() {
    var tab = document.getElementById('piecesTab');
    if (!tab || !defineState || !defineMode) return;
    if (defineMode === 'var') return renderVarDefineView(tab);
    if (defineMode === 'resell') return renderResellDefineView(tab);
    tab.innerHTML = '<div class="loading">Unknown mode: ' + defineMode + '</div>';
  }

  // ----- VAR Define view ------------------------------------------------------

  function renderVarDefineView(tab) {
    var esc = MastAdmin.esc;
    var p = defineState;
    var spec = p.defineSpec.var || { components: [], valueAddSteps: [] };
    var components = Array.isArray(spec.components) ? spec.components : [];
    var steps = Array.isArray(spec.valueAddSteps) ? spec.valueAddSteps : [];
    var costShape = computeCostShape(p, null);
    var matLabels = Object.keys(materialsData).map(function(mid) {
      var m = materialsData[mid];
      return { id: mid, name: m && m.name ? m.name : mid, unitCost: (m && m.unitCost) || 0 };
    });

    var html = '';
    html += '<button class="detail-back" onclick="makerCloseDefineView()">← Back to Pieces</button>';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    html += '<div><h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">' + esc(p.name || 'Untitled') + ' ' + productStatusBadgeHtml(p.status) + '</h3>';
    html += '<span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.78rem;margin-top:6px;display:inline-block;">VAR (Value-Added Reseller)</span></div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="makerSaveDefineView()">Save & Continue</button>';
    html += '<button class="btn btn-primary btn-small" onclick="makerRecalcCostShape()">Recalculate Cost</button>';
    html += '</div></div>';

    // Readiness checklist (Checkpoint E)
    html += renderReadinessChecklistPanel(p);
    // Checkpoint F — version-link + revision banners
    html += renderVersionLinkBanner(p);
    html += renderRevisionBanner(p);

    // Cost summary (uniform costShape readout)
    html += renderCostShapeSummary(costShape);

    // Markup config (Checkpoint E — resolves D's O-D2)
    html += renderMarkupConfigSection(p);

    // Components section
    html += '<div data-readiness-section="define-section" style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h4 style="margin:0;font-size:1.05rem;">Components</h4>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerVarAddComponent()">+ Add component</button>';
    html += '</div>';
    if (components.length === 0) {
      html += '<p style="color:var(--warm-gray);font-size:0.85rem;margin:0;">No components yet. Add sourced items that go into this product.</p>';
    } else {
      html += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;"><thead><tr style="text-align:left;border-bottom:1px solid var(--cream-dark);">';
      html += '<th style="padding:6px 4px;">Source</th><th>Name</th><th style="text-align:right;">Unit cost ($)</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Scrap %</th><th style="text-align:right;">Subtotal</th><th></th></tr></thead><tbody>';
      components.forEach(function(c, i) {
        var qty = Number(c.quantity) || 0;
        var scrap = Number(c.scrapPercent) || 0;
        var unit = Number(c.unitCost) || 0;
        var sub = qty * (1 + scrap / 100) * unit;
        html += '<tr style="border-bottom:1px solid var(--cream-dark);">';
        html += '<td style="padding:6px 4px;"><select onchange="makerVarSetComponentField(' + i + ',\'sourceType\',this.value)" style="font-size:0.78rem;padding:3px 6px;">';
        html += '<option value="material"' + (c.sourceType === 'material' ? ' selected' : '') + '>Material</option>';
        html += '<option value="free-text"' + (c.sourceType !== 'material' ? ' selected' : '') + '>Free text</option>';
        html += '</select></td>';
        if (c.sourceType === 'material') {
          html += '<td><select onchange="makerVarLinkMaterial(' + i + ',this.value)" style="font-size:0.85rem;padding:4px 6px;width:100%;">';
          html += '<option value="">— pick material —</option>';
          matLabels.forEach(function(m) {
            html += '<option value="' + esc(m.id) + '"' + (c.materialId === m.id ? ' selected' : '') + '>' + esc(m.name) + '</option>';
          });
          html += '</select></td>';
        } else {
          html += '<td><input type="text" value="' + esc(c.name || '') + '" oninput="makerVarSetComponentField(' + i + ',\'name\',this.value)" style="width:100%;padding:4px 6px;font-size:0.85rem;"></td>';
        }
        html += '<td style="text-align:right;"><input type="number" step="0.01" min="0" value="' + unit + '" oninput="makerVarSetComponentField(' + i + ',\'unitCost\',this.value)" style="width:90px;text-align:right;padding:4px 6px;font-size:0.85rem;"></td>';
        html += '<td style="text-align:right;"><input type="number" step="0.01" min="0" value="' + qty + '" oninput="makerVarSetComponentField(' + i + ',\'quantity\',this.value)" style="width:80px;text-align:right;padding:4px 6px;font-size:0.85rem;"></td>';
        html += '<td style="text-align:right;"><input type="number" step="0.1" min="0" value="' + scrap + '" oninput="makerVarSetComponentField(' + i + ',\'scrapPercent\',this.value)" style="width:70px;text-align:right;padding:4px 6px;font-size:0.85rem;"></td>';
        html += '<td style="text-align:right;font-family:monospace;">$' + sub.toFixed(2) + '</td>';
        html += '<td style="text-align:right;"><button class="btn btn-danger btn-small" onclick="makerVarRemoveComponent(' + i + ')" style="font-size:0.72rem;">Remove</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    // Value-Add Steps section
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h4 style="margin:0;font-size:1.05rem;">Value-Add Steps</h4>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerVarAddStep()">+ Add step</button>';
    html += '</div>';
    if (steps.length === 0) {
      html += '<p style="color:var(--warm-gray);font-size:0.85rem;margin:0;">No value-add steps yet. Add assembly, branding, packaging, etc.</p>';
    } else {
      html += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;"><thead><tr style="text-align:left;border-bottom:1px solid var(--cream-dark);">';
      html += '<th style="padding:6px 4px;">Description</th><th style="text-align:right;">Labor min</th><th style="text-align:right;">Other cost ($)</th><th></th></tr></thead><tbody>';
      steps.forEach(function(s, i) {
        html += '<tr style="border-bottom:1px solid var(--cream-dark);">';
        html += '<td style="padding:6px 4px;"><input type="text" value="' + esc(s.description || '') + '" oninput="makerVarSetStepField(' + i + ',\'description\',this.value)" style="width:100%;padding:4px 6px;font-size:0.85rem;"></td>';
        html += '<td style="text-align:right;"><input type="number" step="1" min="0" value="' + (Number(s.laborMinutes) || 0) + '" oninput="makerVarSetStepField(' + i + ',\'laborMinutes\',this.value)" style="width:80px;text-align:right;padding:4px 6px;font-size:0.85rem;"></td>';
        html += '<td style="text-align:right;"><input type="number" step="0.01" min="0" value="' + (Number(s.otherCost) || 0) + '" oninput="makerVarSetStepField(' + i + ',\'otherCost\',this.value)" style="width:90px;text-align:right;padding:4px 6px;font-size:0.85rem;"></td>';
        html += '<td style="text-align:right;"><button class="btn btn-danger btn-small" onclick="makerVarRemoveStep(' + i + ')" style="font-size:0.72rem;">Remove</button></td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    tab.innerHTML = html;
  }

  // ----- Resell Define view ---------------------------------------------------

  function renderResellDefineView(tab) {
    var esc = MastAdmin.esc;
    var p = defineState;
    var spec = p.defineSpec.resell || {};
    var supplier = spec.supplier || {};
    var landed = spec.landedCost || {};
    var leadTimeDays = Number(spec.leadTimeDays) || 0;
    var costShape = computeCostShape(p, null);

    var html = '';
    html += '<button class="detail-back" onclick="makerCloseDefineView()">← Back to Pieces</button>';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    html += '<div><h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">' + esc(p.name || 'Untitled') + ' ' + productStatusBadgeHtml(p.status) + '</h3>';
    html += '<span class="status-badge" style="background:rgba(42,124,111,0.15);color:var(--teal);font-size:0.78rem;margin-top:6px;display:inline-block;">Resell</span></div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="makerSaveDefineView()">Save & Continue</button>';
    html += '<button class="btn btn-primary btn-small" onclick="makerRecalcCostShape()">Recalculate Cost</button>';
    html += '</div></div>';

    // Readiness checklist (Checkpoint E)
    html += renderReadinessChecklistPanel(p);
    // Checkpoint F — version-link + revision banners
    html += renderVersionLinkBanner(p);
    html += renderRevisionBanner(p);

    html += renderCostShapeSummary(costShape);

    // Markup config (Checkpoint E)
    html += renderMarkupConfigSection(p);

    // Supplier
    html += '<div data-readiness-section="define-section" style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<h4 style="margin:0 0 12px;font-size:1.05rem;">Supplier</h4>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    html += resellField('Supplier name', 'text', supplier.supplierName || '', 'supplier.supplierName');
    html += resellField('Supplier SKU', 'text', supplier.supplierSku || '', 'supplier.supplierSku');
    html += resellField('Unit cost ($)', 'number', supplier.unitCost || 0, 'supplier.unitCost', 0.01);
    html += resellField('Minimum order qty (MOQ)', 'number', supplier.moq || 1, 'supplier.moq', 1);
    html += '</div></div>';

    // Landed cost
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<h4 style="margin:0 0 12px;font-size:1.05rem;">Landed cost (per unit)</h4>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    html += resellField('Freight ($)', 'number', landed.freight || 0, 'landedCost.freight', 0.01);
    // Duty with mode picker
    html += '<div><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:4px;">Duty</label>';
    html += '<div style="display:flex;gap:6px;">';
    html += '<input type="number" step="0.01" min="0" value="' + (landed.duty || 0) + '" oninput="makerResellSet(\'landedCost.duty\',this.value)" style="flex:1;padding:6px 8px;font-size:0.85rem;">';
    html += '<select onchange="makerResellSet(\'landedCost.dutyMode\',this.value)" style="padding:6px 8px;font-size:0.85rem;">';
    html += '<option value="per-unit"' + ((landed.dutyMode || 'per-unit') === 'per-unit' ? ' selected' : '') + '>$ / unit</option>';
    html += '<option value="percent"' + (landed.dutyMode === 'percent' ? ' selected' : '') + '>% of unit cost</option>';
    html += '</select></div></div>';
    html += resellField('Storage ($/unit)', 'number', landed.storage || 0, 'landedCost.storage', 0.01);
    html += resellField('Other ($/unit)', 'number', landed.other || 0, 'landedCost.other', 0.01);
    html += '</div></div>';

    // Lead time
    html += '<div data-readiness-section="capacity-section" style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<h4 style="margin:0 0 12px;font-size:1.05rem;">Lead time</h4>';
    html += '<div style="max-width:240px;">';
    html += '<label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:4px;">Lead time (days)</label>';
    html += '<input type="number" step="1" min="0" value="' + leadTimeDays + '" oninput="makerResellSet(\'leadTimeDays\',this.value)" style="width:100%;padding:6px 8px;font-size:0.85rem;">';
    html += '</div></div>';

    tab.innerHTML = html;
  }

  function resellField(label, type, value, path, step) {
    var esc = MastAdmin.esc;
    var s = (typeof step === 'number') ? step : 1;
    var html = '<div><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:4px;">' + esc(label) + '</label>';
    if (type === 'number') {
      html += '<input type="number" step="' + s + '" min="0" value="' + value + '" oninput="makerResellSet(\'' + path + '\',this.value)" style="width:100%;padding:6px 8px;font-size:0.85rem;">';
    } else {
      html += '<input type="text" value="' + esc(value) + '" oninput="makerResellSet(\'' + path + '\',this.value)" style="width:100%;padding:6px 8px;font-size:0.85rem;">';
    }
    html += '</div>';
    return html;
  }

  function renderCostShapeSummary(costShape) {
    function fmt(c) { return '$' + ((c || 0) / 100).toFixed(2); }
    var html = '';
    html += '<div style="background:rgba(42,124,111,0.06);border:1px solid rgba(42,124,111,0.2);border-radius:8px;padding:14px 16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">';
    html += '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;">Cost shape (downstream uniform)</div>';
    html += '<div style="display:flex;gap:18px;font-size:0.85rem;font-family:monospace;">';
    html += '<span>Material: <strong>' + fmt(costShape.materialCost) + '</strong></span>';
    html += '<span>Labor: <strong>' + fmt(costShape.laborCost) + '</strong></span>';
    html += '<span>Other: <strong>' + fmt(costShape.otherCost) + '</strong></span>';
    html += '<span style="color:var(--teal);">Total: <strong>' + fmt(costShape.totalCost) + '</strong></span>';
    html += '</div></div></div>';
    return html;
  }

  // ----- VAR mutation handlers ----------------------------------------------

  function ensureVarSpec() {
    if (!defineState.defineSpec) defineState.defineSpec = {};
    if (!defineState.defineSpec.var) defineState.defineSpec.var = { components: [], valueAddSteps: [] };
    if (!Array.isArray(defineState.defineSpec.var.components)) defineState.defineSpec.var.components = [];
    if (!Array.isArray(defineState.defineSpec.var.valueAddSteps)) defineState.defineSpec.var.valueAddSteps = [];
    return defineState.defineSpec.var;
  }

  function varAddComponent() {
    var spec = ensureVarSpec();
    spec.components.push({ sourceType: 'free-text', name: '', unitCost: 0, quantity: 1, scrapPercent: 0, materialId: null });
    renderDefineView();
  }
  function varRemoveComponent(idx) {
    var spec = ensureVarSpec();
    spec.components.splice(idx, 1);
    renderDefineView();
  }
  function varSetComponentField(idx, field, value) {
    var spec = ensureVarSpec();
    if (!spec.components[idx]) return;
    if (field === 'unitCost' || field === 'quantity' || field === 'scrapPercent') {
      spec.components[idx][field] = Number(value) || 0;
    } else {
      spec.components[idx][field] = value;
    }
    // Don't re-render on every keystroke for text fields — only on numeric
    if (field === 'unitCost' || field === 'quantity' || field === 'scrapPercent' || field === 'sourceType') {
      renderDefineView();
    }
  }
  function varLinkMaterial(idx, materialId) {
    var spec = ensureVarSpec();
    if (!spec.components[idx]) return;
    spec.components[idx].materialId = materialId;
    var m = materialsData[materialId];
    if (m) {
      spec.components[idx].name = m.name || '';
      spec.components[idx].unitCost = m.unitCost || 0;
    }
    renderDefineView();
  }
  function varAddStep() {
    var spec = ensureVarSpec();
    spec.valueAddSteps.push({ description: '', laborMinutes: 0, otherCost: 0 });
    renderDefineView();
  }
  function varRemoveStep(idx) {
    var spec = ensureVarSpec();
    spec.valueAddSteps.splice(idx, 1);
    renderDefineView();
  }
  function varSetStepField(idx, field, value) {
    var spec = ensureVarSpec();
    if (!spec.valueAddSteps[idx]) return;
    if (field === 'laborMinutes' || field === 'otherCost') {
      spec.valueAddSteps[idx][field] = Number(value) || 0;
    } else {
      spec.valueAddSteps[idx][field] = value;
    }
  }

  // ----- Resell mutation handlers --------------------------------------------

  function ensureResellSpec() {
    if (!defineState.defineSpec) defineState.defineSpec = {};
    if (!defineState.defineSpec.resell) {
      defineState.defineSpec.resell = {
        supplier: { supplierName: '', supplierSku: '', unitCost: 0, moq: 1 },
        landedCost: { freight: 0, duty: 0, dutyMode: 'per-unit', storage: 0, other: 0 },
        leadTimeDays: 0
      };
    }
    if (!defineState.defineSpec.resell.supplier) defineState.defineSpec.resell.supplier = {};
    if (!defineState.defineSpec.resell.landedCost) defineState.defineSpec.resell.landedCost = {};
    return defineState.defineSpec.resell;
  }

  function resellSet(path, value) {
    var spec = ensureResellSpec();
    var parts = path.split('.');
    var numericFields = { unitCost: true, moq: true, freight: true, duty: true, storage: true, other: true, leadTimeDays: true };
    var leaf = parts[parts.length - 1];
    var coerced = numericFields[leaf] ? (Number(value) || 0) : value;
    if (parts.length === 1) {
      spec[parts[0]] = coerced;
    } else if (parts.length === 2) {
      if (!spec[parts[0]]) spec[parts[0]] = {};
      spec[parts[0]][parts[1]] = coerced;
    }
    if (leaf === 'dutyMode') {
      // Force re-render to redraw duty input semantics
      renderDefineView();
    }
  }

  // ----- Save / Recalc ---------------------------------------------------------

  async function saveDefineView() {
    if (!defineState || !defineProductId) return;
    try {
      var atype = defineState.acquisitionType || defineMode;
      var path = 'public/products/' + defineProductId + '/';

      // Checkpoint F — if the product is Active and in revision mode,
      // stage defineSpec + markupConfig as pending changes instead of
      // writing live. costShape continues to be recomputed live (it's
      // derived; no need to pend it).
      var liveProduct = findProduct(defineProductId);
      var inRevMode = liveProduct && liveProduct.status === 'active' && liveProduct.hasPendingRevision;
      var costShape = computeCostShape(defineState, null);

      if (inRevMode && typeof stagePendingChanges === 'function') {
        var pending = {};
        if (JSON.stringify(defineState.defineSpec || {}) !== JSON.stringify(liveProduct.defineSpec || {})) {
          pending.defineSpec = defineState.defineSpec || {};
        }
        if (atype === 'var' || atype === 'resell') {
          var defaultsR = await loadTenantDefaultMarkups();
          var mcR = Object.assign({}, defineState.markupConfig || {});
          if (!(Number(mcR.wholesaleMarkup) > 0)) mcR.wholesaleMarkup = defaultsR.wholesaleMarkup;
          if (!(Number(mcR.directMarkup) > 0))    mcR.directMarkup    = defaultsR.directMarkup;
          if (!(Number(mcR.retailMarkup) > 0))    mcR.retailMarkup    = defaultsR.retailMarkup;
          defineState.markupConfig = mcR;
          if (JSON.stringify(mcR) !== JSON.stringify(liveProduct.markupConfig || {})) {
            pending.markupConfig = mcR;
          }
        }
        if (Object.keys(pending).length > 0) {
          await stagePendingChanges(defineProductId, pending);
        }
        // costShape recompute is non-revisionable bookkeeping — write live
        await persistCostShape(defineProductId, costShape);
        try { await recomputeAndPersistReadiness(defineProductId); } catch (e) {}
        MastAdmin.showToast('Staged ' + Object.keys(pending).length + ' change' + (Object.keys(pending).length === 1 ? '' : 's') + ' (Apply to go live)');
        renderDefineView();
        return;
      }

      // Persist defineSpec slice (live, non-revision-mode path)
      await MastDB.set(path + 'defineSpec', defineState.defineSpec || {});

      // Checkpoint E — markupConfig (VAR/Resell). Auto-fill defaults if blank.
      if (atype === 'var' || atype === 'resell') {
        var defaults = await loadTenantDefaultMarkups();
        var mc = Object.assign({}, defineState.markupConfig || {});
        if (!(Number(mc.wholesaleMarkup) > 0)) mc.wholesaleMarkup = defaults.wholesaleMarkup;
        if (!(Number(mc.directMarkup) > 0))    mc.directMarkup    = defaults.directMarkup;
        if (!(Number(mc.retailMarkup) > 0))    mc.retailMarkup    = defaults.retailMarkup;
        defineState.markupConfig = mc;
        await MastDB.set(path + 'markupConfig', mc);
      }

      await MastDB.set(path + 'updatedAt', new Date().toISOString());
      // Recompute and persist costShape too
      var costShape = computeCostShape(defineState, null);
      await persistCostShape(defineProductId, costShape);
      // Update in-memory product
      if (window.productsData) {
        var prod = window.productsData.find(function(p) { return p.pid === defineProductId; });
        if (prod) {
          prod.defineSpec = defineState.defineSpec;
          if (defineState.markupConfig) prod.markupConfig = defineState.markupConfig;
        }
      }
      // Checkpoint E — recompute readiness checklist on every save.
      try { await recomputeAndPersistReadiness(defineProductId); } catch (e) {}
      MastAdmin.showToast('Saved');
      renderDefineView();
    } catch (err) {
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  async function recalcCostShape() {
    if (!defineState || !defineProductId) return;
    var costShape = computeCostShape(defineState, null);
    try {
      await persistCostShape(defineProductId, costShape);
      try { await recomputeAndPersistReadiness(defineProductId); } catch (e) {}
      MastAdmin.showToast('Cost recalculated: $' + (costShape.totalCost / 100).toFixed(2));
      renderDefineView();
    } catch (err) {
      MastAdmin.showToast('Recalc failed: ' + err.message, true);
    }
  }

  // (renderPieces dispatcher updated above to route to renderDefineView)

  // ============================================================
  // Checkpoint E — Readiness Checklist + State Transitions
  // ----------------------------------------------------------------
  // - computeReadinessChecklist(product, recipe?) → derived flags
  // - persistReadinessChecklist(pid, checklist)
  // - productMarkupConfig(product, recipe?) → wholesale/direct/retail
  // - renderReadinessChecklistPanel(product) → sticky checklist HTML
  // - renderMarkupConfigSection(product) → markup inputs for VAR/Resell
  // - promoteToReady(pid) / launchToActive(pid) state transitions
  // - triggerChannelSyncForStatus → best-effort channel hook (opt-in)
  // - productStatusBadgeHtml(status) shared status badge renderer
  // ============================================================

  var DEFAULT_MARKUPS = { wholesaleMarkup: 1.4, directMarkup: 1.6, retailMarkup: 2.0 };
  var tenantDefaultMarkups = null; // populated lazily from admin/config/defaults/markups
  var tenantSettingsCache = null;  // populated lazily from admin/config/settings

  async function loadTenantDefaultMarkups() {
    if (tenantDefaultMarkups) return tenantDefaultMarkups;
    try {
      var cfg = await MastDB.get('admin/config/defaults/markups');
      if (cfg && typeof cfg === 'object') {
        tenantDefaultMarkups = {
          wholesaleMarkup: Number(cfg.wholesaleMarkup) || DEFAULT_MARKUPS.wholesaleMarkup,
          directMarkup: Number(cfg.directMarkup) || DEFAULT_MARKUPS.directMarkup,
          retailMarkup: Number(cfg.retailMarkup) || DEFAULT_MARKUPS.retailMarkup
        };
      } else {
        tenantDefaultMarkups = Object.assign({}, DEFAULT_MARKUPS);
      }
    } catch (e) {
      tenantDefaultMarkups = Object.assign({}, DEFAULT_MARKUPS);
    }
    return tenantDefaultMarkups;
  }

  async function loadTenantSettings() {
    if (tenantSettingsCache) return tenantSettingsCache;
    try {
      tenantSettingsCache = (await MastDB.get('admin/config/settings')) || {};
    } catch (e) {
      tenantSettingsCache = {};
    }
    return tenantSettingsCache;
  }

  /**
   * Resolve the markup config for a product. Build mode reads from the linked
   * recipe (legacy source-of-truth). VAR/Resell read from product.markupConfig
   * (new in Checkpoint E — resolves D's O-D2). Returns null if unknown.
   */
  function productMarkupConfig(product, recipe) {
    if (!product) return null;
    var atype = product.acquisitionType || 'build';
    if (atype === 'build') {
      var r = recipe || (function() {
        var found = null;
        Object.values(recipesData).forEach(function(rr) {
          if (rr && rr.productId === product.pid && rr.status !== 'archived') found = rr;
        });
        return found;
      })();
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

  /**
   * Compute the readiness checklist flags for a product. Pure function.
   * Returns { defined, costed, channeled, capacityPlanned, listingReady }.
   */
  function computeReadinessChecklist(product, recipe) {
    if (!product) {
      return { defined: false, costed: false, channeled: false, capacityPlanned: false, listingReady: false };
    }
    var atype = product.acquisitionType || 'build';
    var r = recipe || (function() {
      var found = null;
      Object.values(recipesData).forEach(function(rr) {
        if (rr && rr.productId === product.pid && rr.status !== 'archived') found = rr;
      });
      return found;
    })();

    // defined — mode-specific definition has at least one component/material/supplier
    var defined = false;
    if (atype === 'build') {
      defined = !!(r && r.lineItems && Object.keys(r.lineItems).length > 0);
    } else if (atype === 'var') {
      var spec = (product.defineSpec || {}).var || {};
      defined = (Array.isArray(spec.components) && spec.components.length > 0) ||
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
      ['shopify', 'etsy', 'square'].forEach(function(ch) {
        var ref = product.externalRefs[ch];
        if (ref && (ref.externalId || ref.syncEnabled)) channeled = true;
      });
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
    var hasImage = !!(product.images && product.images.length) ||
                   !!(product.imageIds && product.imageIds.length);
    var hasDescription = !!(product.description && String(product.description).trim()) ||
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

  /**
   * Persist the derived readinessChecklist onto the product, but only when it
   * changed (avoids redundant writes). Returns the new checklist.
   */
  async function persistReadinessChecklist(productId, checklist) {
    if (!productId || !checklist) return checklist;
    var path = 'public/products/' + productId + '/readinessChecklist';
    try {
      await MastDB.set(path, checklist);
      if (window.productsData) {
        var prod = window.productsData.find(function(p) { return p.pid === productId; });
        if (prod) prod.readinessChecklist = checklist;
      }
    } catch (e) {
      console.warn('persistReadinessChecklist failed', e);
    }
    return checklist;
  }

  /**
   * Recompute + persist if changed. Convenience for save / recalc / transition flows.
   */
  async function recomputeAndPersistReadiness(productId) {
    var products = window.productsData || [];
    var p = products.find(function(pp) { return pp.pid === productId; });
    if (!p) return null;
    var fresh = computeReadinessChecklist(p, null);
    var prior = p.readinessChecklist || {};
    var changed = ['defined','costed','channeled','capacityPlanned','listingReady'].some(function(k) {
      return !!prior[k] !== !!fresh[k];
    });
    if (!changed) return prior;
    return await persistReadinessChecklist(productId, fresh);
  }

  /**
   * Best-effort channel sync hook for status transitions.
   * - * → active: invoke publishProductToShopify if Shopify externalId or syncEnabled
   * - active → archived/anything: best-effort unpublish hook (currently a TODO —
   *   a dedicated `unpublishProductFromShopify` callable does not exist in the
   *   Cloud Functions surface today; we record the intent in __mastChannelSyncIntents
   *   so a follow-up checkpoint can flush it).
   *
   * Gated by tenant settings flag `autoSyncOnStatusChange` (default true).
   * All errors logged, never thrown — status transitions never block on sync.
   */
  async function triggerChannelSyncForStatus(product, oldStatus, newStatus) {
    if (!product) return;
    try {
      var settings = await loadTenantSettings();
      var auto = (settings && typeof settings.autoSyncOnStatusChange === 'boolean')
        ? settings.autoSyncOnStatusChange : true;
      if (!auto) {
        console.log('[checkpoint-E] auto channel sync disabled by tenant settings — skipping');
        return;
      }
    } catch (e) { /* fall through, default true */ }

    var hasShopify = !!(product.externalRefs && product.externalRefs.shopify);
    var shopifySync = hasShopify || !!(product.channelSyncEnabled && product.channelSyncEnabled.shopify);

    if (newStatus === 'active') {
      if (shopifySync && typeof firebase !== 'undefined' && firebase.functions) {
        try {
          var callable = firebase.functions().httpsCallable('publishProductToShopify');
          await callable({ tenantId: MastDB.tenantId(), pid: product.pid, trigger: 'status-transition' });
          console.log('[checkpoint-E] Shopify publish fired for', product.pid);
        } catch (err) {
          console.warn('[checkpoint-E] Shopify publish failed for', product.pid, err && err.message);
        }
      }
      // Etsy / Square: TODO — publishToEtsy / publishToSquare callables
      // aren't standardized yet. Logged so a follow-up can wire them.
      window.__mastChannelSyncIntents = window.__mastChannelSyncIntents || [];
      window.__mastChannelSyncIntents.push({
        pid: product.pid, op: 'publish', at: new Date().toISOString(),
        oldStatus: oldStatus, newStatus: newStatus
      });
    } else if (oldStatus === 'active' && newStatus !== 'active') {
      // active → not-active: record intent. No standardized unpublish callable today.
      // TODO Checkpoint G: wire delist hooks per archive sub-state.
      window.__mastChannelSyncIntents = window.__mastChannelSyncIntents || [];
      window.__mastChannelSyncIntents.push({
        pid: product.pid, op: 'unpublish', at: new Date().toISOString(),
        oldStatus: oldStatus, newStatus: newStatus
      });
      console.log('[checkpoint-E] recorded unpublish intent for', product.pid, '(unpublish hook TODO)');
    }
  }

  /**
   * Promote a Draft → Ready. Recomputes the checklist first; blocks on hard
   * gates (defined, costed, listingReady). Channeled + capacityPlanned warn but do
   * not block. Sets promotedToReadyAt.
   */
  async function promoteToReady(pid) {
    var products = window.productsData || [];
    var p = products.find(function(pp) { return pp.pid === pid; });
    if (!p) { MastAdmin.showToast('Product not found', true); return; }
    if (p.status === 'ready' || p.status === 'active') {
      MastAdmin.showToast('Already ' + p.status, true);
      return;
    }
    var checklist = computeReadinessChecklist(p, null);
    await persistReadinessChecklist(pid, checklist);
    var hardGates = ['defined','costed','listingReady'];
    var failedHard = hardGates.filter(function(k) { return !checklist[k]; });
    if (failedHard.length) {
      MastAdmin.showToast('Cannot promote — missing: ' + failedHard.join(', '), true);
      return;
    }
    var softGates = ['channeled','capacityPlanned'].filter(function(k) { return !checklist[k]; });
    var msg = 'Promote to Ready? This means the product is ready for launch review. You can still edit anything.';
    if (softGates.length) {
      msg += '\n\n(Recommended but not required: ' + softGates.join(', ') + ' — proceed anyway?)';
    }
    var ok = await window.mastConfirm(msg, { title: 'Promote to Ready', confirmLabel: 'Promote' });
    if (!ok) return;

    var now = new Date().toISOString();
    var oldStatus = p.status;
    try {
      await MastDB.set('public/products/' + pid + '/status', 'ready');
      await MastDB.set('public/products/' + pid + '/promotedToReadyAt', now);
      await MastDB.set('public/products/' + pid + '/updatedAt', now);
      p.status = 'ready';
      p.promotedToReadyAt = now;
      p.updatedAt = now;
      MastAdmin.writeAudit('promote_to_ready', 'products', pid);
      MastAdmin.showToast('Promoted to Ready ✓');
      // Re-render whichever surface is visible
      if (piecesView === 'define') renderDefineView();
      else if (piecesView === 'list') renderPiecesList();
      // Channel sync: ready is not yet active — no publish; just record state.
      try { await triggerChannelSyncForStatus(p, oldStatus, 'ready'); } catch (e) {}
    } catch (err) {
      MastAdmin.showToast('Promote failed: ' + (err && err.message), true);
    }
  }

  /**
   * Launch a Ready → Active. Verifies channel mapping or made-to-order flag,
   * then transitions and triggers channel sync.
   */
  async function launchToActive(pid) {
    var products = window.productsData || [];
    var p = products.find(function(pp) { return pp.pid === pid; });
    if (!p) { MastAdmin.showToast('Product not found', true); return; }
    if (p.status !== 'ready') {
      MastAdmin.showToast('Product must be Ready before launching (current: ' + (p.status || 'unset') + ')', true);
      return;
    }
    var checklist = computeReadinessChecklist(p, null);
    if (!checklist.channeled && !p.internalStorefrontOnly) {
      // Nudge but allow (channel sync hook will simply no-op)
      var proceed = await window.mastConfirm(
        'No channel mapping is enabled for this product. Launch anyway? It will be Active in your storefront only.',
        { title: 'No channels enabled', confirmLabel: 'Launch anyway' }
      );
      if (!proceed) return;
    }

    // Inventory or made-to-order check
    var inv = (window.inventory || {})[pid];
    var totals = (typeof window.getInventoryTotals === 'function') ? window.getInventoryTotals(inv) : null;
    var hasInv = totals && (totals.onHand > 0 || (inv && inv.stockType && /order|build/.test(inv.stockType)));
    if (!hasInv && !(inv && /order|build/.test(inv.stockType || '')) && !p.madeToOrder) {
      var proceedInv = await window.mastConfirm(
        'No inventory is set up and product is not flagged made-to-order. Launch anyway?',
        { title: 'Inventory not configured', confirmLabel: 'Launch anyway' }
      );
      if (!proceedInv) return;
    }

    var ok = await window.mastConfirm(
      'Launch this product to Active? It will be eligible for channel sync (Shopify, Etsy, Square) per your tenant settings.',
      { title: 'Launch to Active', confirmLabel: 'Launch' }
    );
    if (!ok) return;

    var now = new Date().toISOString();
    var oldStatus = p.status;
    try {
      await MastDB.set('public/products/' + pid + '/status', 'active');
      await MastDB.set('public/products/' + pid + '/promotedToActiveAt', now);
      await MastDB.set('public/products/' + pid + '/updatedAt', now);
      p.status = 'active';
      p.promotedToActiveAt = now;
      p.updatedAt = now;
      MastAdmin.writeAudit('launch_to_active', 'products', pid);
      MastAdmin.showToast('Launched ✓');
      if (piecesView === 'define') renderDefineView();
      else if (piecesView === 'list') renderPiecesList();
      try { await triggerChannelSyncForStatus(p, oldStatus, 'active'); } catch (e) {}
    } catch (err) {
      MastAdmin.showToast('Launch failed: ' + (err && err.message), true);
    }
  }

  // ----- Status badge -------------------------------------------------------

  function productStatusBadgeHtml(status) {
    var s = (status || 'draft').toLowerCase();
    var styles = {
      draft:    { bg: 'rgba(120,120,120,0.15)', color: '#525252', label: 'Draft' },
      ready:    { bg: 'rgba(217,119,6,0.15)',   color: '#b45309', label: 'Ready' },
      active:   { bg: 'rgba(42,124,111,0.15)',  color: 'var(--teal,#2a7c6f)', label: 'Active' },
      archived: { bg: 'rgba(180,83,9,0.18)',    color: '#9a3412', label: 'Archived' }
    };
    var st = styles[s] || styles.draft;
    return '<span class="status-badge product-status-badge product-status-' + s +
      '" style="background:' + st.bg + ';color:' + st.color +
      ';font-size:0.72rem;padding:3px 8px;border-radius:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">' +
      st.label + '</span>';
  }

  // ----- Readiness Checklist UI panel --------------------------------------

  function readinessIcon(state) {
    // ✅ pass, ⚠ optional-fail, ⏳ pending
    if (state === 'pass') return '<span style="color:#2a7c6f;font-size:1.05rem;">✅</span>';
    if (state === 'warn') return '<span style="color:#b45309;font-size:1.05rem;">⚠️</span>';
    return '<span style="color:#9ca3af;font-size:1.05rem;">⏳</span>';
  }

  function renderReadinessChecklistPanel(product) {
    if (!product) return '';
    var checklist = computeReadinessChecklist(product, null);
    var items = [
      { key: 'defined',         label: 'Defined',         hint: 'Mode-specific definition (recipe / components / supplier)', required: true,  scrollTo: 'define-section' },
      { key: 'costed',          label: 'Costed',          hint: 'Total cost > 0 and markup config present',                  required: true,  scrollTo: 'markup-section' },
      { key: 'channeled',       label: 'Channeled',       hint: 'At least one channel mapping (Shopify / Etsy / Square)',    required: false, scrollTo: 'channels-section' },
      { key: 'capacityPlanned', label: 'Capacity planned',hint: 'Lead time, batch size, or explicitly skipped',              required: false, scrollTo: 'capacity-section' },
      { key: 'listingReady',    label: 'Listing ready',   hint: 'Name + image + description',                                required: true,  scrollTo: 'listing-section' }
    ];
    var pid = product.pid;
    var status = product.status || 'draft';
    var hardPass = items.filter(function(it){ return it.required; }).every(function(it){ return checklist[it.key]; });
    var allPass = items.every(function(it) { return checklist[it.key]; });

    var html = '';
    html += '<div class="mast-readiness-panel" style="position:sticky;top:0;z-index:5;background:var(--surface-card,#fff);border:1px solid var(--cream-dark,#e5e1d8);border-radius:8px;padding:14px 16px;margin-bottom:16px;box-shadow:0 1px 2px rgba(0,0,0,0.04);">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">';
    html += '<div style="display:flex;align-items:center;gap:10px;">';
    html += '<strong style="font-size:0.9rem;">Readiness checklist</strong>';
    html += productStatusBadgeHtml(status);
    if (allPass) html += '<span style="font-size:0.78rem;color:#2a7c6f;">All items complete</span>';
    else if (hardPass) html += '<span style="font-size:0.78rem;color:#b45309;">Required items complete · optional items pending</span>';
    else html += '<span style="font-size:0.78rem;color:#9a3412;">Required items incomplete</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;">';
    if (status === 'draft') {
      var disabled = !hardPass ? ' disabled style="opacity:0.5;cursor:not-allowed;"' : '';
      html += '<button class="btn btn-primary btn-small"' + disabled + ' onclick="makerPromoteToReady(\'' + MastAdmin.esc(pid) + '\')">Promote to Ready →</button>';
    } else if (status === 'ready') {
      html += '<button class="btn btn-primary btn-small" onclick="makerLaunchToActive(\'' + MastAdmin.esc(pid) + '\')">Launch to Active →</button>';
    }
    html += '</div></div>';

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">';
    items.forEach(function(it) {
      var pass = !!checklist[it.key];
      var state = pass ? 'pass' : (it.required ? 'pending' : 'warn');
      html += '<div role="button" tabindex="0" onclick="makerScrollToReadinessSection(\'' + it.scrollTo + '\')" style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid ' + (pass ? 'rgba(42,124,111,0.25)' : 'rgba(0,0,0,0.08)') + ';border-radius:6px;background:' + (pass ? 'rgba(42,124,111,0.04)' : 'rgba(0,0,0,0.02)') + ';cursor:pointer;">';
      html += '<div>' + readinessIcon(state) + '</div>';
      html += '<div style="flex:1;min-width:0;"><div style="font-weight:600;font-size:0.82rem;">' + MastAdmin.esc(it.label) + (it.required ? '' : ' <span style="font-weight:400;color:var(--warm-gray,#777);font-size:0.7rem;">(optional)</span>') + '</div>';
      html += '<div style="font-size:0.72rem;color:var(--warm-gray,#777);">' + MastAdmin.esc(it.hint) + '</div></div>';
      html += '</div>';
    });
    html += '</div>';
    html += '</div>';
    return html;
  }

  function scrollToReadinessSection(anchor) {
    if (!anchor) return;
    var el = document.querySelector('[data-readiness-section="' + anchor + '"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ----- Markup config UI (VAR/Resell) -------------------------------------

  function renderMarkupConfigSection(product) {
    if (!product) return '';
    var atype = product.acquisitionType || 'build';
    if (atype === 'build') return ''; // Build reads markup from recipe
    var mc = product.markupConfig || {};
    var w = (mc.wholesaleMarkup != null ? mc.wholesaleMarkup : '');
    var d = (mc.directMarkup != null ? mc.directMarkup : '');
    var r = (mc.retailMarkup != null ? mc.retailMarkup : '');
    var hint = '';
    if (w === '' && d === '' && r === '') {
      hint = '<span style="font-size:0.72rem;color:var(--warm-gray,#777);">Defaults will be applied on first save (' +
        DEFAULT_MARKUPS.wholesaleMarkup + ' / ' + DEFAULT_MARKUPS.directMarkup + ' / ' + DEFAULT_MARKUPS.retailMarkup + ')</span>';
    }
    var html = '';
    html += '<div data-readiness-section="markup-section" style="background:var(--cream,#faf7f0);border:1px solid var(--cream-dark,#e5e1d8);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h4 style="margin:0;font-size:1.05rem;">Markup config</h4>' + hint + '</div>';
    html += '<div style="display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px;">';
    html += '<div><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:4px;">Wholesale markup ×</label>';
    html += '<input type="number" step="0.05" min="0" value="' + w + '" oninput="makerSetMarkup(\'wholesaleMarkup\',this.value)" style="width:100%;padding:6px 8px;font-size:0.85rem;" placeholder="' + DEFAULT_MARKUPS.wholesaleMarkup + '"></div>';
    html += '<div><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:4px;">Direct markup ×</label>';
    html += '<input type="number" step="0.05" min="0" value="' + d + '" oninput="makerSetMarkup(\'directMarkup\',this.value)" style="width:100%;padding:6px 8px;font-size:0.85rem;" placeholder="' + DEFAULT_MARKUPS.directMarkup + '"></div>';
    html += '<div><label style="display:block;font-size:0.78rem;font-weight:600;margin-bottom:4px;">Retail markup ×</label>';
    html += '<input type="number" step="0.05" min="0" value="' + r + '" oninput="makerSetMarkup(\'retailMarkup\',this.value)" style="width:100%;padding:6px 8px;font-size:0.85rem;" placeholder="' + DEFAULT_MARKUPS.retailMarkup + '"></div>';
    html += '</div></div>';
    return html;
  }

  function setMarkup(field, value) {
    if (!defineState) return;
    if (!defineState.markupConfig) defineState.markupConfig = {};
    var v = Number(value);
    if (!isFinite(v) || v < 0) v = 0;
    defineState.markupConfig[field] = v;
    // No re-render on every keystroke; saved with Save & Continue
  }

  // ============================================================
  // End Checkpoint E
  // ============================================================

  // ============================================================
  // Checkpoint F — Rework Patterns (in-place revisions + clone-to-v2)
  // ----------------------------------------------------------------
  // Pattern 1: Active product edits go to product.pendingChanges blob until
  //   user clicks Apply. Live fields are guarded.
  // Pattern 2: Clone-to-v2 creates a new Draft Product with parentProductId
  //   and version+1. Original stays Active.
  // Both flows preserve continuity of the live SKU.
  // ============================================================

  // Fields that should never be revisioned — even on Active products,
  // these write directly through to live fields. Keep this list narrow.
  var NON_REVISIONABLE_FIELDS = {
    status: true,
    promotedToReadyAt: true,
    promotedToActiveAt: true,
    archivedAt: true,
    archivedSubState: true,
    returnsAcceptedUntil: true,
    retiredAt: true,
    'externalRefs': true,         // sync metadata
    'channelBindings': true,      // sync metadata
    'channelIds': true,           // sync metadata
    'salesCount': true,
    'lastSoldAt': true,
    'recipeVersion': true,        // recipe handshake
    'hasPendingRevision': true,
    'pendingChanges': true,
    'pendingChangesUpdatedAt': true,
    'pendingChangesAppliedAt': true,
    'parentProductId': true,
    'version': true,
    'updatedAt': true             // bookkeeping
  };

  /**
   * Whether a field write must be routed through pendingChanges when the
   * product is Active. Fields under NON_REVISIONABLE_FIELDS still write live.
   */
  function isFieldRevisionable(fieldPath) {
    if (!fieldPath) return false;
    var top = String(fieldPath).split('.')[0];
    return !NON_REVISIONABLE_FIELDS[fieldPath] && !NON_REVISIONABLE_FIELDS[top];
  }

  /**
   * Active products are guarded — direct edits to revisionable fields require
   * entering revision mode (which initializes pendingChanges).
   */
  function isProductGuarded(product) {
    if (!product) return false;
    return product.status === 'active';
  }

  function findProduct(pid) {
    var products = window.productsData || [];
    return products.find(function(p) { return p && p.pid === pid; });
  }

  /**
   * Enter revision mode on an Active product. Initializes pendingChanges blob
   * and sets hasPendingRevision so the form unlocks. No-op for non-Active.
   */
  async function enterRevisionMode(pid) {
    var p = findProduct(pid);
    if (!p) { MastAdmin.showToast('Product not found', true); return false; }
    if (p.status !== 'active') {
      MastAdmin.showToast('Revision mode only applies to Active products', true);
      return false;
    }
    if (p.hasPendingRevision) return true; // already in revision mode
    var now = new Date().toISOString();
    try {
      var path = 'public/products/' + pid + '/';
      await MastDB.set(path + 'hasPendingRevision', true);
      await MastDB.set(path + 'pendingChanges', {});
      await MastDB.set(path + 'pendingChangesUpdatedAt', now);
      p.hasPendingRevision = true;
      p.pendingChanges = {};
      p.pendingChangesUpdatedAt = now;
      MastAdmin.writeAudit('enter_revision_mode', 'products', pid);
      MastAdmin.showToast('Revision mode on — edits stage until you Apply');
      return true;
    } catch (err) {
      MastAdmin.showToast('Could not enter revision mode: ' + (err && err.message), true);
      return false;
    }
  }

  /**
   * Stage a single field's pending value. Works only when product is in
   * revision mode (hasPendingRevision === true). Persists to
   * product.pendingChanges[fieldPath].
   */
  async function setPendingFieldValue(pid, fieldPath, value) {
    var p = findProduct(pid);
    if (!p) return false;
    if (!p.hasPendingRevision) {
      console.warn('[checkpoint-F] setPendingFieldValue called outside revision mode', pid, fieldPath);
      return false;
    }
    if (!isFieldRevisionable(fieldPath)) {
      // Non-revisionable: write live directly.
      try {
        await MastDB.set('public/products/' + pid + '/' + fieldPath, value);
        if (p) {
          // best-effort in-memory mirror
          p[fieldPath.split('.')[0]] = p[fieldPath.split('.')[0]];
        }
      } catch (e) { console.warn('non-revisionable write failed', e); }
      return true;
    }
    p.pendingChanges = p.pendingChanges || {};
    p.pendingChanges[fieldPath] = value;
    p.pendingChangesUpdatedAt = new Date().toISOString();
    try {
      await MastDB.set('public/products/' + pid + '/pendingChanges/' + fieldPath.replace(/\//g, '__'), value);
      await MastDB.set('public/products/' + pid + '/pendingChangesUpdatedAt', p.pendingChangesUpdatedAt);
    } catch (err) {
      console.warn('[checkpoint-F] setPendingFieldValue persist failed', err);
    }
    return true;
  }

  /**
   * Bulk-stage pending changes from an object map { fieldPath: value, ... }.
   * Convenience for save-form flows.
   */
  async function stagePendingChanges(pid, changes) {
    var p = findProduct(pid);
    if (!p) return false;
    if (!p.hasPendingRevision) {
      console.warn('[checkpoint-F] stagePendingChanges: not in revision mode for', pid);
      return false;
    }
    var nextPending = Object.assign({}, p.pendingChanges || {});
    Object.keys(changes || {}).forEach(function(k) {
      if (isFieldRevisionable(k)) nextPending[k] = changes[k];
    });
    p.pendingChanges = nextPending;
    p.pendingChangesUpdatedAt = new Date().toISOString();
    try {
      await MastDB.set('public/products/' + pid + '/pendingChanges', nextPending);
      await MastDB.set('public/products/' + pid + '/pendingChangesUpdatedAt', p.pendingChangesUpdatedAt);
    } catch (err) {
      console.warn('[checkpoint-F] stagePendingChanges persist failed', err);
    }
    return true;
  }

  /**
   * Format a pending-change value for human display in the apply-confirmation list.
   */
  function fmtPendingValue(v) {
    if (v == null) return '—';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '…' : v;
    if (Array.isArray(v)) return '[' + v.length + ' items]';
    if (typeof v === 'object') return '{' + Object.keys(v).length + ' fields}';
    return String(v);
  }

  /**
   * Apply pendingChanges to live fields. Confirmation modal lists the diffs.
   * On confirm: copies each pendingChanges entry to the live path, clears the
   * pendingChanges blob, sets pendingChangesAppliedAt, optionally fires
   * channel re-sync, writes audit log.
   */
  async function applyPendingChanges(pid) {
    var p = findProduct(pid);
    if (!p) { MastAdmin.showToast('Product not found', true); return; }
    var changes = p.pendingChanges || {};
    var keys = Object.keys(changes);
    if (keys.length === 0) {
      MastAdmin.showToast('No pending changes to apply');
      return;
    }
    var diffLines = keys.map(function(k) {
      var live = readNestedField(p, k);
      return k + ': ' + fmtPendingValue(live) + ' → ' + fmtPendingValue(changes[k]);
    });
    var msg = 'Apply ' + keys.length + ' change' + (keys.length === 1 ? '' : 's') + ' to this live product?\n\n' + diffLines.join('\n');
    var ok = await window.mastConfirm(msg, { title: 'Apply Pending Changes', confirmLabel: 'Apply' });
    if (!ok) return;

    var path = 'public/products/' + pid + '/';
    var now = new Date().toISOString();
    try {
      // Write each change to the live path
      for (var i = 0; i < keys.length; i++) {
        var fp = keys[i];
        await MastDB.set(path + fp.replace(/\./g, '/'), changes[fp]);
        // Mirror to in-memory product
        writeNestedField(p, fp, changes[fp]);
      }
      // Clear pending
      await MastDB.set(path + 'pendingChanges', null);
      await MastDB.set(path + 'hasPendingRevision', false);
      await MastDB.set(path + 'pendingChangesAppliedAt', now);
      await MastDB.set(path + 'updatedAt', now);
      p.pendingChanges = null;
      p.hasPendingRevision = false;
      p.pendingChangesAppliedAt = now;
      p.updatedAt = now;
      MastAdmin.writeAudit('apply_pending_changes', 'products', pid);

      // Channel re-sync if applicable
      try {
        var settings = await loadTenantSettings();
        var auto = (settings && typeof settings.autoSyncOnStatusChange === 'boolean')
          ? settings.autoSyncOnStatusChange : true;
        if (auto) {
          var hasShopify = !!(p.externalRefs && p.externalRefs.shopify);
          if (hasShopify && typeof firebase !== 'undefined' && firebase.functions) {
            try {
              var callable = firebase.functions().httpsCallable('publishProductToShopify');
              await callable({ tenantId: MastDB.tenantId(), pid: pid, trigger: 'apply-pending-changes' });
              console.log('[checkpoint-F] Shopify re-sync fired for', pid);
            } catch (err) {
              console.warn('[checkpoint-F] Shopify re-sync failed for', pid, err && err.message);
            }
          }
          window.__mastChannelSyncIntents = window.__mastChannelSyncIntents || [];
          window.__mastChannelSyncIntents.push({
            pid: pid, op: 'republish', at: now, trigger: 'apply-pending-changes',
            fields: keys
          });
        }
      } catch (e) { /* sync errors never block apply */ }

      // Recompute readiness — applied changes may flip listingReady, costed, etc.
      try { await recomputeAndPersistReadiness(pid); } catch (e) {}

      MastAdmin.showToast('Applied ' + keys.length + ' change' + (keys.length === 1 ? '' : 's') + ' ✓');
      // Re-render whichever surface is open
      if (typeof window.renderProductDetail === 'function' && window.selectedProductPid === pid) {
        window.renderProductDetail(pid);
      } else if (piecesView === 'define') {
        renderDefineView();
      } else if (piecesView === 'list') {
        renderPiecesList();
      }
    } catch (err) {
      MastAdmin.showToast('Apply failed: ' + (err && err.message), true);
    }
  }

  /**
   * Discard pendingChanges. Confirmation modal lists what will be discarded.
   */
  async function discardPendingChanges(pid) {
    var p = findProduct(pid);
    if (!p) { MastAdmin.showToast('Product not found', true); return; }
    var changes = p.pendingChanges || {};
    var keys = Object.keys(changes);
    if (keys.length === 0) {
      // Just exit revision mode
      try {
        await MastDB.set('public/products/' + pid + '/hasPendingRevision', false);
        p.hasPendingRevision = false;
        if (typeof window.renderProductDetail === 'function' && window.selectedProductPid === pid) {
          window.renderProductDetail(pid);
        }
      } catch (e) {}
      return;
    }
    var diffLines = keys.map(function(k) { return k + ': → ' + fmtPendingValue(changes[k]); });
    var msg = 'Discard ' + keys.length + ' pending change' + (keys.length === 1 ? '' : 's') + '?\n\n' + diffLines.join('\n');
    var ok = await window.mastConfirm(msg, { title: 'Discard Pending Changes', confirmLabel: 'Discard' });
    if (!ok) return;

    var path = 'public/products/' + pid + '/';
    try {
      await MastDB.set(path + 'pendingChanges', null);
      await MastDB.set(path + 'hasPendingRevision', false);
      p.pendingChanges = null;
      p.hasPendingRevision = false;
      MastAdmin.writeAudit('discard_pending_changes', 'products', pid);
      MastAdmin.showToast('Discarded ' + keys.length + ' change' + (keys.length === 1 ? '' : 's'));
      if (typeof window.renderProductDetail === 'function' && window.selectedProductPid === pid) {
        window.renderProductDetail(pid);
      } else if (piecesView === 'define') {
        renderDefineView();
      } else if (piecesView === 'list') {
        renderPiecesList();
      }
    } catch (err) {
      MastAdmin.showToast('Discard failed: ' + (err && err.message), true);
    }
  }

  // ----- Helpers: read/write nested field paths -----------------------------
  function readNestedField(obj, path) {
    if (!obj || !path) return undefined;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }
  function writeNestedField(obj, path, value) {
    if (!obj || !path) return;
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // ----- Pattern 2: Clone-to-v2 ---------------------------------------------

  /**
   * Find a Draft child of the given product (any product whose parentProductId
   * matches this pid and status is draft|ready). Returns the first match or null.
   */
  function findChildVersion(pid) {
    var products = window.productsData || [];
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      if (p && p.parentProductId === pid && p.status !== 'active' && p.status !== 'archived') return p;
    }
    return null;
  }

  /**
   * Clone an Active product into a fresh Draft v(N+1). Original stays Active.
   * - Generates new pid
   * - Copies scalar fields, categories, acquisitionType, markupConfig, defineSpec
   * - Sets parentProductId, increments version
   * - Status: draft, clears readinessChecklist, no pending revision
   * - Does NOT copy images, variants, listings (channelBindings/externalRefs),
   *   inventory, or sales history. New SKU implies fresh listings.
   * - For Build mode: creates a new recipe via duplicateRecipe and links it.
   */
  async function cloneProductForRedesign(sourcePid) {
    var src = findProduct(sourcePid);
    if (!src) { MastAdmin.showToast('Product not found', true); return; }
    if (src.status !== 'active') {
      MastAdmin.showToast('Clone for redesign is only available on Active products', true);
      return;
    }
    var existingChild = findChildVersion(sourcePid);
    var msg = 'Clone this product for a redesign? A new Draft product will be created. The original stays Active.';
    if (existingChild) {
      msg = 'A v' + (existingChild.version || 2) + ' Draft already exists for this product (' +
        (existingChild.name || existingChild.pid) + '). Create another clone anyway?';
    }
    var ok = await window.mastConfirm(msg, { title: 'Clone for Redesign', confirmLabel: 'Clone to v' + (((src.version || 1) + 1)) });
    if (!ok) return;

    var newPid = 'p' + Date.now().toString(36) + '_v' + (((src.version || 1) + 1));
    var now = new Date().toISOString();
    var nextVersion = (Number(src.version) || 1) + 1;

    // Deep-copy the scalar slice we want carried over.
    var clone = {
      pid: newPid,
      name: (src.name || 'Untitled') + ' (v' + nextVersion + ')',
      description: src.description || '',
      shortDescription: src.shortDescription || '',
      categories: Array.isArray(src.categories) ? src.categories.slice() : [],
      slug: (src.slug ? src.slug + '-v' + nextVersion : ''),
      acquisitionType: src.acquisitionType || 'build',
      defineSpec: src.defineSpec ? JSON.parse(JSON.stringify(src.defineSpec)) : {},
      markupConfig: src.markupConfig ? Object.assign({}, src.markupConfig) : null,
      // Cost shape: copy as starting point — recalc happens on first edit
      materialCost: src.materialCost || 0,
      laborCost: src.laborCost || 0,
      otherCost: src.otherCost || 0,
      totalCost: src.totalCost || 0,
      // Pricing: carry forward as starting point (user can change before launch)
      priceCents: src.priceCents != null ? src.priceCents : null,
      retailPriceCents: src.retailPriceCents != null ? src.retailPriceCents : null,
      directPriceCents: src.directPriceCents != null ? src.directPriceCents : null,
      // Production attributes
      buildTime: src.buildTime != null ? src.buildTime : null,
      processingDays: src.processingDays ? Object.assign({}, src.processingDays) : null,
      sku: null, // new SKU expected
      businessLine: src.businessLine || 'production',
      makerAttributes: src.makerAttributes ? Object.assign({}, src.makerAttributes) : null,
      // Lifecycle
      status: 'draft',
      availability: 'available',
      hasPendingRevision: false,
      pendingChanges: null,
      readinessChecklist: { defined: false, costed: false, channeled: false, capacityPlanned: false, listingReady: false },
      promotedToReadyAt: null,
      promotedToActiveAt: null,
      archivedAt: null,
      // Lineage
      parentProductId: sourcePid,
      version: nextVersion,
      // Bookkeeping
      images: [],
      imageIds: [],
      variants: null,
      options: src.options ? JSON.parse(JSON.stringify(src.options)) : [],
      // Listings + inventory deliberately NOT copied — fresh mappings expected
      externalRefs: null,
      channelBindings: null,
      channelIds: null,
      createdAt: now,
      updatedAt: now,
      priceHistory: [], buildTimeHistory: [], costToBuildHistory: []
    };

    try {
      // Build mode: duplicate the linked recipe and relink
      if (clone.acquisitionType === 'build' && src.recipeId && typeof duplicateRecipe === 'function') {
        try {
          var newRecipe = await duplicateRecipe(src.recipeId);
          if (newRecipe && newRecipe.recipeId) {
            // Relink: point the cloned recipe at the new product
            await MastDB.set('admin/recipes/' + newRecipe.recipeId + '/productId', newPid);
            await MastDB.set('admin/recipes/' + newRecipe.recipeId + '/name', clone.name);
            if (recipesData[newRecipe.recipeId]) {
              recipesData[newRecipe.recipeId].productId = newPid;
              recipesData[newRecipe.recipeId].name = clone.name;
            }
            clone.recipeId = newRecipe.recipeId;
          }
        } catch (recipeErr) {
          console.warn('[checkpoint-F] recipe clone failed for', sourcePid, recipeErr && recipeErr.message);
          // proceed without recipe — user can add one manually
        }
      }

      await MastDB.set('public/products/' + newPid, clone);
      MastAdmin.writeAudit('clone_for_redesign', 'products', newPid);
      MastAdmin.writeAudit('clone_source', 'products', sourcePid);

      if (window.productsData) {
        window.productsData.push(clone);
      }

      MastAdmin.showToast('Cloned to v' + nextVersion + ' (Draft) ✓');

      // Navigate to the new draft. Prefer the maker Define view for VAR/Resell
      // and recipe builder for Build (matching the existing new-product flow).
      try {
        if (clone.acquisitionType === 'build' && clone.recipeId) {
          if (typeof window.makerOpenRecipeBuilder === 'function') {
            window.makerOpenRecipeBuilder(clone.recipeId);
          }
        } else if (clone.acquisitionType === 'var' || clone.acquisitionType === 'resell') {
          await openDefineForProduct(newPid);
        } else {
          // Build with no recipe — re-render pieces list so user can see the new draft
          if (piecesView === 'list') renderPiecesList();
        }
      } catch (navErr) { /* navigation is best-effort */ }
    } catch (err) {
      MastAdmin.showToast('Clone failed: ' + (err && err.message), true);
    }
  }

  // ----- UI: Status indicators + revision/clone banners ---------------------

  /**
   * Build a status-line string for a product detail header. Combines status,
   * pending-revision count, and v2-in-development presence.
   * Returns a plain string (caller wraps as needed).
   */
  function productHeaderStatusLine(product) {
    if (!product) return '';
    var status = product.status || 'draft';
    var parts = [statusLabel(status)];
    if (product.parentProductId) {
      parts.push('Cloned from ' + (parentLinkLabel(product.parentProductId)));
    }
    if (status === 'active') {
      var child = findChildVersion(product.pid);
      if (child) {
        parts.push('v' + (child.version || 2) + ' in development');
      }
      var pendingCount = product.pendingChanges ? Object.keys(product.pendingChanges).length : 0;
      if (product.hasPendingRevision) {
        parts.push(pendingCount > 0
          ? (pendingCount + ' pending change' + (pendingCount === 1 ? '' : 's'))
          : 'revision mode (no edits yet)');
      }
    }
    return parts.join(' · ');
  }

  function statusLabel(s) {
    s = (s || 'draft').toLowerCase();
    if (s === 'active') return 'Active';
    if (s === 'ready') return 'Ready';
    if (s === 'archived') return 'Archived';
    return 'Draft';
  }
  function parentLinkLabel(parentPid) {
    var parent = findProduct(parentPid);
    var label = (parent && parent.name) ? parent.name : parentPid;
    return '<a href="#" onclick="event.preventDefault();makerOpenProductDetail(\'' + MastAdmin.esc(parentPid) + '\')" style="color:inherit;text-decoration:underline;">' + MastAdmin.esc(label) + '</a>';
  }

  /**
   * Render the active-product action bar. Returns HTML for:
   *   - "Edit (creates revision)" button (when not in revision mode)
   *   - "Apply" + "Discard" buttons (when in revision mode)
   *   - "Clone for redesign" button (always for Active)
   * Designed to be injected into the product detail header on Active products.
   */
  function renderActiveProductActionBar(product) {
    if (!product || product.status !== 'active') return '';
    var pid = MastAdmin.esc(product.pid);
    var html = '';
    html += '<div class="mast-active-action-bar" style="display:flex;gap:6px;flex-wrap:wrap;">';
    if (product.hasPendingRevision) {
      var count = product.pendingChanges ? Object.keys(product.pendingChanges).length : 0;
      html += '<button class="btn btn-primary btn-small" onclick="makerApplyPendingChanges(\'' + pid + '\')"' + (count === 0 ? ' disabled style="opacity:0.5;cursor:not-allowed;"' : '') + '>Apply' + (count > 0 ? ' (' + count + ')' : '') + '</button>';
      html += '<button class="btn btn-secondary btn-small" onclick="makerDiscardPendingChanges(\'' + pid + '\')">Discard</button>';
    } else {
      html += '<button class="btn btn-secondary btn-small" onclick="makerEnterRevisionMode(\'' + pid + '\')" title="Edits will be staged and only go live after Apply">Edit (creates revision)</button>';
    }
    html += '<button class="btn btn-secondary btn-small" onclick="makerCloneForRedesign(\'' + pid + '\')" title="Create a v2 Draft for a redesign">Clone for redesign</button>';
    html += '</div>';
    return html;
  }

  /**
   * Render the "you are in revision mode" banner. Lists pending changes.
   */
  function renderRevisionBanner(product) {
    if (!product || !product.hasPendingRevision) return '';
    var pid = MastAdmin.esc(product.pid);
    var changes = product.pendingChanges || {};
    var keys = Object.keys(changes);
    var html = '';
    html += '<div class="mast-revision-banner" style="background:rgba(217,119,6,0.08);border:1px solid rgba(217,119,6,0.3);border-radius:8px;padding:12px 16px;margin:12px 0;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">';
    html += '<div><strong style="color:#b45309;">Editing draft revision</strong>';
    html += '<div style="font-size:0.78rem;color:#b45309;margin-top:2px;">Changes are NOT live until you Apply.</div></div>';
    html += '<div style="display:flex;gap:6px;">';
    html += '<button class="btn btn-primary btn-small" onclick="makerApplyPendingChanges(\'' + pid + '\')"' + (keys.length === 0 ? ' disabled style="opacity:0.5;cursor:not-allowed;"' : '') + '>Apply' + (keys.length > 0 ? ' (' + keys.length + ')' : '') + '</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerDiscardPendingChanges(\'' + pid + '\')">Discard</button>';
    html += '</div></div>';
    if (keys.length > 0) {
      html += '<ul style="margin:8px 0 0;padding-left:20px;font-size:0.82rem;color:#92400e;">';
      keys.forEach(function(k) {
        var live = readNestedField(product, k);
        html += '<li><code>' + MastAdmin.esc(k) + '</code>: <span style="color:#9ca3af;text-decoration:line-through;">' + MastAdmin.esc(fmtPendingValue(live)) + '</span> → <span style="color:#b45309;font-weight:600;">' + MastAdmin.esc(fmtPendingValue(changes[k])) + '</span> <span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#d97706;margin-left:4px;" title="pending"></span></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    return html;
  }

  /**
   * Render cross-link banners — "Cloned from <parent>" on child Drafts and
   * "v2 in development: <child>" on parent Active products.
   */
  function renderVersionLinkBanner(product) {
    if (!product) return '';
    var html = '';
    // Child → parent
    if (product.parentProductId) {
      var parent = findProduct(product.parentProductId);
      var parentName = parent ? (parent.name || product.parentProductId) : product.parentProductId;
      html += '<div class="mast-version-link-banner" style="background:rgba(42,124,111,0.06);border:1px solid rgba(42,124,111,0.25);border-radius:8px;padding:10px 14px;margin:8px 0;font-size:0.85rem;">';
      html += '<span style="color:var(--warm-gray,#777);">Cloned from:</span> ';
      html += '<a href="#" onclick="event.preventDefault();makerOpenProductDetail(\'' + MastAdmin.esc(product.parentProductId) + '\')" style="color:var(--teal,#2a7c6f);font-weight:600;">' + MastAdmin.esc(parentName) + '</a>';
      if (parent) html += ' <span style="color:var(--warm-gray);">(v' + (parent.version || 1) + ' · ' + statusLabel(parent.status) + ')</span>';
      html += '</div>';
    }
    // Parent → child
    if (product.status === 'active') {
      var child = findChildVersion(product.pid);
      if (child) {
        html += '<div class="mast-version-link-banner" style="background:rgba(217,119,6,0.06);border:1px solid rgba(217,119,6,0.25);border-radius:8px;padding:10px 14px;margin:8px 0;font-size:0.85rem;">';
        html += '<strong style="color:#b45309;">v' + (child.version || 2) + ' in development:</strong> ';
        html += '<a href="#" onclick="event.preventDefault();makerOpenProductDetail(\'' + MastAdmin.esc(child.pid) + '\')" style="color:var(--teal,#2a7c6f);font-weight:600;">' + MastAdmin.esc(child.name || child.pid) + '</a>';
        html += ' <span style="color:var(--warm-gray);">(' + statusLabel(child.status) + ')</span>';
        html += '</div>';
      }
      // Parallel-active warning: a v2 sibling with same parentProductId that's also Active
      var products = window.productsData || [];
      var parallel = products.filter(function(pp) {
        return pp && pp.pid !== product.pid && pp.parentProductId === product.pid && pp.status === 'active';
      });
      if (parallel.length > 0) {
        html += '<div class="mast-version-link-banner" style="background:rgba(180,83,9,0.08);border:1px solid rgba(180,83,9,0.3);border-radius:8px;padding:10px 14px;margin:8px 0;font-size:0.85rem;color:#9a3412;">';
        html += '⚠ Both v' + (product.version || 1) + ' and v' + (parallel[0].version || 2) + ' are Active — consider archiving v' + (product.version || 1) + '.';
        html += '</div>';
      }
    }
    return html;
  }

  /**
   * Open the product detail screen for a given pid. Used by cross-link
   * navigation. Routes to the Catalog product detail when available.
   */
  function openProductDetail(pid) {
    if (typeof window.viewProduct === 'function') {
      window.viewProduct(pid);
      return;
    }
    if (typeof window.renderProductDetail === 'function') {
      window.selectedProductPid = pid;
      window.renderProductDetail(pid);
      return;
    }
    // Fallback — open define view
    openDefineForProduct(pid).catch(function() {});
  }

  // ============================================================
  // End Checkpoint F
  // ============================================================

  // ============================================================
  // Recipe Builder — "The Money Screen"
  // ============================================================

  async function openRecipeBuilder(recipeId, variantId) {
    var recipe = recipesData[recipeId];
    if (!recipe) {
      MastAdmin.showToast('Recipe not found', true);
      return;
    }

    // Ensure materials are loaded
    if (!materialsLoaded) {
      materialsData = (await MastDB.materials.list(500)) || {};
      materialsLoaded = true;
    }

    // Initialize builder state from recipe
    builderState = JSON.parse(JSON.stringify(recipe));
    editingRecipeId = recipeId;
    piecesView = 'builder';
    // If product has variants, hydrate so each variant is an independent recipe slot
    hydrateVariantsIndependent(builderState);
    var pvList = getProductVariants(builderState);
    if (pvList.length > 0) {
      // Honor explicit variantId if caller passed one and it exists
      if (variantId && pvList.some(function(pv){ return pv.id === variantId; })) {
        currentVariantId = variantId;
      } else if (currentVariantId === 'default' || !currentVariantId ||
                 !pvList.some(function(pv){ return pv.id === currentVariantId; })) {
        currentVariantId = pvList[0].id;
      }
    }
    renderRecipeBuilder();
  }

  async function createRecipeForProduct(pid, productName) {
    try {
      var recipe = await createRecipe({
        productId: pid,
        name: productName,
        status: 'draft'
      });
      editingRecipeId = recipe.recipeId;
      builderState = JSON.parse(JSON.stringify(recipe));
      piecesView = 'builder';
      renderRecipeBuilder();
      MastAdmin.showToast('Recipe created for ' + productName);
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  function createNewPiece() {
    openNewPieceModal();
  }

  // Inline modal (matches openMaterialModal style) — replaces native prompt()
  // so piece creation is keyboard-friendly, skin-compliant, and testable.
  function openNewPieceModal() {
    var esc = MastAdmin.esc;
    var products = window.productsData || [];
    var cats = {};
    products.forEach(function(p) { (p.categories || []).forEach(function(c) { if (c) cats[c] = true; }); });
    var catList = Object.keys(cats).sort();

    // Clean up any prior instance
    var prior = document.getElementById('newPieceModalContainer');
    if (prior) prior.remove();

    var container = document.createElement('div');
    container.id = 'newPieceModalContainer';
    var html = '';
    html += '<div id="newPieceOverlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;" onclick="makerCloseNewPieceModal(event)">';
    html += '<div style="background:var(--cream);border-radius:10px;max-width:480px;width:90%;max-height:85vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.2);padding:20px 24px;" onclick="event.stopPropagation()">';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0 0 16px;">New Product</h3>';

    // Acquisition mode picker (Checkpoint D)
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:6px;">Acquisition mode *</label>';
    html += '<div style="display:flex;flex-direction:column;gap:6px;">';
    html += '<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:0.85rem;"><input type="radio" name="newPieceAcqType" value="build" checked style="margin-top:3px;"><span><strong>Build</strong> — recipe / BOM with materials and labor</span></label>';
    html += '<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:0.85rem;"><input type="radio" name="newPieceAcqType" value="var" style="margin-top:3px;"><span><strong>VAR</strong> — components + value-add steps</span></label>';
    html += '<label style="display:flex;gap:8px;align-items:flex-start;cursor:pointer;font-size:0.85rem;"><input type="radio" name="newPieceAcqType" value="resell" style="margin-top:3px;"><span><strong>Resell</strong> — sourced supplier + landed cost</span></label>';
    html += '</div></div>';

    // Name
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Name *</label>';
    html += '<input id="newPieceName" type="text" autofocus style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;" placeholder="e.g. Cobalt Pendant">';
    html += '</div>';

    // Category — dropdown of existing + free-text fallback
    html += '<div style="margin-bottom:20px;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Category</label>';
    html += '<select id="newPieceCategorySelect" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;margin-bottom:6px;box-sizing:border-box;" onchange="makerNewPieceCategoryChange()">';
    catList.forEach(function(c) { html += '<option value="' + esc(c) + '">' + esc(c) + '</option>'; });
    html += '<option value="__other__">+ New category…</option>';
    html += '</select>';
    html += '<input id="newPieceCategoryCustom" type="text" style="display:none;width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;" placeholder="New category name">';
    html += '</div>';

    // Buttons
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;">';
    html += '<button class="btn btn-secondary" onclick="makerCloseNewPieceModal()">Cancel</button>';
    html += '<button class="btn btn-primary" onclick="makerSubmitNewPiece()">Create Piece</button>';
    html += '</div>';

    html += '</div></div>';
    container.innerHTML = html;
    document.body.appendChild(container);

    // If no existing categories, show the custom input immediately
    if (catList.length === 0) {
      var sel = document.getElementById('newPieceCategorySelect');
      sel.innerHTML = '<option value="__other__">+ New category…</option>';
      sel.value = '__other__';
      document.getElementById('newPieceCategoryCustom').style.display = 'block';
    }

    // Focus name and submit on Enter
    setTimeout(function() {
      var nameEl = document.getElementById('newPieceName');
      if (nameEl) {
        nameEl.focus();
        nameEl.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); submitNewPiece(); }
        });
      }
    }, 0);
  }

  function closeNewPieceModal(event) {
    if (event && event.target && event.target.id !== 'newPieceOverlay') return;
    var c = document.getElementById('newPieceModalContainer');
    if (c) c.remove();
  }

  function newPieceCategoryChange() {
    var sel = document.getElementById('newPieceCategorySelect');
    var custom = document.getElementById('newPieceCategoryCustom');
    if (!sel || !custom) return;
    if (sel.value === '__other__') {
      custom.style.display = 'block';
      custom.focus();
    } else {
      custom.style.display = 'none';
    }
  }

  async function submitNewPiece() {
    var nameEl = document.getElementById('newPieceName');
    var sel = document.getElementById('newPieceCategorySelect');
    var custom = document.getElementById('newPieceCategoryCustom');
    if (!nameEl || !sel) return;
    var name = (nameEl.value || '').trim();
    if (!name) {
      MastAdmin.showToast('Name is required', true);
      nameEl.focus();
      return;
    }
    var category;
    if (sel.value === '__other__') {
      category = ((custom && custom.value) || '').trim().toLowerCase();
      if (!category) {
        MastAdmin.showToast('Category is required', true);
        if (custom) custom.focus();
        return;
      }
    } else {
      category = sel.value || 'other';
    }

    // Acquisition mode (Checkpoint D)
    var acqRadios = document.querySelectorAll('input[name="newPieceAcqType"]');
    var acqType = 'build';
    for (var ai = 0; ai < acqRadios.length; ai++) {
      if (acqRadios[ai].checked) { acqType = acqRadios[ai].value; break; }
    }
    if (acqType !== 'build' && acqType !== 'var' && acqType !== 'resell') acqType = 'build';

    closeNewPieceModal();

    try {
      var pid = 'p' + Date.now().toString(36);
      var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      var now = new Date().toISOString();
      var defineSpec = {};
      if (acqType === 'var') {
        defineSpec.var = { components: [], valueAddSteps: [] };
      } else if (acqType === 'resell') {
        defineSpec.resell = {
          supplier: { supplierName: '', supplierSku: '', unitCost: 0, moq: 1 },
          landedCost: { freight: 0, duty: 0, dutyMode: 'per-unit', storage: 0, other: 0 },
          leadTimeDays: 0
        };
      }
      var newProduct = {
        pid: pid,
        name: name,
        slug: slug,
        categories: [category],
        status: 'draft',
        availability: 'available',
        businessLine: 'production',
        acquisitionType: acqType,
        defineSpec: defineSpec,
        materialCost: 0,
        laborCost: 0,
        otherCost: 0,
        totalCost: 0,
        priceCents: null,
        images: [],
        imageIds: [],
        createdAt: now,
        updatedAt: now
      };
      await MastDB.set('public/products/' + pid, newProduct);
      MastAdmin.writeAudit('create', 'products', pid);

      if (window.productsData) {
        window.productsData.push(newProduct);
      }

      if (acqType === 'build') {
        await createRecipeForProduct(pid, name);
      } else {
        // VAR or Resell — open the Define view directly
        await openDefineForProduct(pid);
      }
    } catch (err) {
      MastAdmin.showToast('Error creating product: ' + err.message, true);
    }
  }

  function renderRecipeBuilder() {
    var tab = document.getElementById('piecesTab');
    if (!tab || !builderState) return;
    var esc = MastAdmin.esc;
    var bs = builderState;

    // Cost-shape model: variants always exist as a map (default + per-product-variant overrides).
    // currentVariantId is 'default' or a productVariantId. Resolve product variants for tab rendering.
    // Hydrate every render so late productsData updates (e.g. after bulk
    // materialize_variants) are picked up without needing to re-open.
    hydrateVariantsIndependent(bs);
    var productVariants = getProductVariants(bs);
    var hasProductVariants = productVariants.length > 0;
    var existingVariantKeys = bs.variants ? Object.keys(bs.variants).filter(function(k){ return k !== 'default'; }) : [];
    var productVariantIds = productVariants.map(function(pv){ return pv.id; });
    var orphanKeys = existingVariantKeys.filter(function(k){ return productVariantIds.indexOf(k) === -1; });
    // Sanity: keep currentVariantId in sync with what the product/recipe actually has.
    if (hasProductVariants) {
      // Product has variants → never show Default. Land on a real variant id.
      if (productVariantIds.indexOf(currentVariantId) === -1) {
        currentVariantId = productVariantIds[0];
      }
    } else {
      // Legacy single-recipe mode → fall back to Default if currentVariantId is unknown.
      if (currentVariantId !== 'default' && existingVariantKeys.indexOf(currentVariantId) === -1) {
        currentVariantId = 'default';
      }
    }
    var activeData = getActiveVariantData(bs);
    var activeKey = currentVariantId || 'default';
    var fieldMeta = {
      lineItems: readVariantField(bs, activeKey, 'lineItems'),
      laborMinutes: readVariantField(bs, activeKey, 'laborMinutes'),
      otherCost: readVariantField(bs, activeKey, 'otherCost')
    };

    // Resolve sub-assembly costs (multi-level BOM) before calculating
    var resolvedLineItems = resolveSubAssemblyCosts(activeData.lineItems || {}, editingRecipeId ? (function(){var v={};v[editingRecipeId]=true;return v;})() : {}, 0);

    // Run live calculation on active data
    var calc = calculateRecipe({
      lineItems: resolvedLineItems,
      laborRatePerHour: bs.laborRatePerHour || 0,
      laborMinutes: activeData.laborMinutes || 0,
      otherCost: activeData.otherCost || 0,
      setupCost: bs.setupCost || 0,
      batchSize: bs.batchSize || 1,
      wholesaleMarkup: bs.wholesaleMarkup || 1,
      directMarkup: bs.directMarkup || 1,
      retailMarkup: bs.retailMarkup || 1
    });

    var html = '';

    // Back button
    html += '<button class="detail-back" onclick="makerCloseRecipeBuilder()">← Back to Pieces</button>';

    // Checkpoint E — readiness checklist for Build mode (recipe builder is the Define view)
    var __linkedProduct = bs.productId ? (window.productsData || []).find(function(pp){ return pp.pid === bs.productId; }) : null;
    if (__linkedProduct) {
      html += renderReadinessChecklistPanel(__linkedProduct);
      // Checkpoint F — cross-link + revision banners on the Build view too
      html += renderVersionLinkBanner(__linkedProduct);
      html += renderRevisionBanner(__linkedProduct);
    }

    // costsDirty banner
    if (bs.costsDirty) {
      html += '<div style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">';
      html += '<span style="font-size:0.85rem;color:#b45309;">⚠ Material costs have changed since last calculation.</span>';
      html += '<button class="btn btn-primary btn-small" onclick="makerRecalcAndRefresh()">Recalculate</button>';
      html += '</div>';
    }

    // Phase 2C+2E: drift banner + Reprice now button (when drift exceeds threshold)
    var driftPct = typeof bs.currentDriftPct === 'number' ? bs.currentDriftPct : 0;
    if (Math.abs(driftPct) >= repricingThresholdPct && bs.driftBaseline) {
      var dir = driftPct > 0 ? '↑' : '↓';
      var driftColor = driftPct > 0 ? '#b45309' : '#1d4ed8';
      html += '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">';
      html += '<div style="font-size:0.85rem;">';
      html += '<strong style="color:' + driftColor + ';">' + dir + ' ' + Math.abs(driftPct).toFixed(1) + '% cost drift</strong> ';
      html += '<span style="color:var(--warm-gray);">since last propagation ($' + (bs.driftBaseline || 0).toFixed(2) + ' → $' + (bs.totalCost || 0).toFixed(2) + '). Threshold: ' + repricingThresholdPct + '%.</span>';
      html += '</div>';
      html += '<button class="btn btn-primary btn-small" onclick="makerRepriceNow()" title="Recalculate + Stage all 3 tier prices on the recipe (product admin accepts via banner) + reset drift baseline">\u21bb Recalculate &amp; Stage</button>';
      html += '</div>';
    }

    // Margin floor alert (active tier below minMarginPercent)
    if (bs.minMarginPercent != null) {
      var activeTierKey = bs.activePriceTier || 'direct';
      var activeMarginPct = calc[activeTierKey + 'MarginPct'] || 0;
      if (activeMarginPct < bs.minMarginPercent) {
        html += '<div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:0.85rem;color:#991b1b;">';
        html += '⚠ Active <strong>' + activeTierKey + '</strong> tier margin is <strong>' + activeMarginPct.toFixed(1) + '%</strong> — below your floor of <strong>' + bs.minMarginPercent + '%</strong>. Raise the markup or reduce cost.';
        html += '</div>';
      }
    }

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    html += '<div>';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">' + esc(bs.name || 'Untitled Recipe') + '</h3>';
    html += '<span style="font-size:0.85rem;color:var(--warm-gray);">Recipe for product ' + esc(bs.productId || '') + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="makerDuplicateCurrentRecipe()" title="Clone this recipe as a new draft">Duplicate</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerSaveRecipeBuilder()">Save</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerSaveAndRecalcRecipe()">Save & Recalculate</button>';
    // Channel-First Phase 2d (D24) — Publish stages a new version on the recipe.
    // Product admin must accept it from the product detail banner. Two-step.
    if (bs.productId) {
      var pubTitle = bs.lastPublishedAt
        ? 'Stage a new version for the product. Last staged: ' + new Date(bs.lastPublishedAt).toLocaleString() + ' (v' + (bs.version || 1) + '). Product admin will see a banner to accept and apply.'
        : 'Stage prices for the product (writes Wholesale, Direct, and Retail to the recipe; product admin accepts to apply). Recipe has not been staged yet.';
      html += '<button class="btn btn-primary btn-small" onclick="makerPublishFromBuilder()" title="' + esc(pubTitle) + '">\u2191 Stage for product</button>';
    }
    html += '</div>';
    html += '</div>';

    // Channel-First Phase 1c (D20) — channels[] field removed. Publish now always writes
    // all three tier prices (wholesale/direct/retail) atomically per D35.

    // ---- VARIANT TABS (cost-shape model) ----
    // Always show a Default tab. If the linked product has variants, show one tab per
    // recipe-variant override that exists, plus an Add dropdown for missing ones.
    html += '<div style="display:flex;gap:0;border-bottom:2px solid var(--cream-dark);margin-bottom:16px;align-items:center;flex-wrap:wrap;">';
    if (!hasProductVariants) {
      // No product variants — show single Default tab (legacy single-recipe mode)
      html += '<button class="view-tab active" onclick="makerSwitchVariant(\'default\')">Default</button>';
    } else {
      // Product has variants — each variant is its own independent recipe, no Default
      productVariants.forEach(function(pv) {
        var label = variantDisplayName(pv);
        html += '<button class="view-tab' + (activeKey === pv.id ? ' active' : '') + '" onclick="makerSwitchVariant(\'' + esc(pv.id) + '\')">' + esc(label) + '</button>';
      });
      // Orphaned variant tabs (recipe had entries for product variants that were later deleted)
      orphanKeys.forEach(function(vk) {
        html += '<button class="view-tab' + (activeKey === vk ? ' active' : '') + '" onclick="makerSwitchVariant(\'' + esc(vk) + '\')" style="color:#b45309;" title="The product variant this tab was linked to was deleted.">⚠ ' + esc(vk.substring(0, 8)) + '</button>';
      });
    }
    html += '</div>';

    // Push-to-all bar (visible for any normal variant tab when product has >1 variant)
    if (hasProductVariants && orphanKeys.indexOf(activeKey) < 0 && productVariants.length > 1) {
      var activeLabel = variantDisplayName(productVariants.find(function(p){ return p.id === activeKey; }));
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:8px 12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:6px;font-size:0.78rem;">';
      html += '<span style="color:var(--warm-gray);">Editing <strong>' + esc(activeLabel) + '</strong> — changes below affect this variant only.</span>';
      html += '<button class="btn btn-secondary btn-small" onclick="makerPushVariantToAll()" style="font-size:0.72rem;" title="Copy this variant\'s Parts, Labor, and Other Costs to every other variant. Overwrites their current values.">↓ Apply to all variants</button>';
      html += '</div>';
    }

    // Orphan warning bar (if viewing an orphaned variant tab)
    if (hasProductVariants && orphanKeys.indexOf(activeKey) >= 0) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding:8px 12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:6px;font-size:0.78rem;">';
      html += '<span style="color:#b45309;">⚠ Orphaned — the linked product variant was deleted.</span>';
      html += '<button class="btn btn-danger btn-small" onclick="makerRemoveOrphanVariant(\'' + esc(activeKey) + '\')" style="font-size:0.72rem;">Remove</button>';
      html += '</div>';
    }

    // ---- PRODUCT IMAGE SECTION (collapsible, variant-aware) ----
    var linkedProductForImg = bs.productId ? (window.productsData || []).find(function(p){ return p.pid === bs.productId; }) : null;
    if (linkedProductForImg) {
      var rawImgs = Array.isArray(linkedProductForImg.images) ? linkedProductForImg.images : [];
      var imgUrls = rawImgs.map(function(img){ return typeof img === 'string' ? img : (img && img.url ? img.url : ''); }).filter(function(u){ return !!u; });
      if (imgUrls.length > 0) {
        var activeImgIdx = 0;
        if (activeKey !== 'default') {
          var activePv = productVariants.find(function(p){ return p.id === activeKey; });
          if (activePv && typeof activePv.imageIndex === 'number' && activePv.imageIndex >= 0 && activePv.imageIndex < imgUrls.length) {
            activeImgIdx = activePv.imageIndex;
          }
        }
        var imgLabel = activeKey === 'default' ? 'Default' : variantDisplayName(productVariants.find(function(p){ return p.id === activeKey; }));
        html += '<details open style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:16px;">';
        html += '<summary style="cursor:pointer;font-size:0.9rem;font-weight:600;display:flex;justify-content:space-between;align-items:center;list-style:none;">';
        html += '<span>Product Image <span style="font-weight:400;color:var(--warm-gray-light);font-size:0.78rem;">— ' + esc(imgLabel) + '</span></span>';
        html += '<span style="font-size:0.78rem;color:var(--warm-gray);">' + imgUrls.length + ' image' + (imgUrls.length === 1 ? '' : 's') + '</span>';
        html += '</summary>';
        html += '<div style="margin-top:12px;display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap;">';
        html += '<img src="' + esc(imgUrls[activeImgIdx]) + '" alt="' + esc(linkedProductForImg.name || '') + '" style="max-width:240px;max-height:240px;border-radius:6px;border:1px solid var(--cream-dark);object-fit:cover;background:#fff;" />';
        if (imgUrls.length > 1) {
          html += '<div style="display:flex;flex-wrap:wrap;gap:6px;flex:1;min-width:180px;">';
          imgUrls.forEach(function(u, i) {
            var isActive = i === activeImgIdx;
            html += '<img src="' + esc(u) + '" alt="thumb ' + (i+1) + '" title="Image ' + (i+1) + '" style="width:56px;height:56px;border-radius:4px;object-fit:cover;border:2px solid ' + (isActive ? 'var(--teal)' : 'transparent') + ';opacity:' + (isActive ? '1' : '0.7') + ';" />';
          });
          html += '</div>';
        }
        html += '</div></details>';
      }
    }

    // ---- PARTS SECTION ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h4 style="font-size:0.9rem;font-weight:600;margin:0;">Parts (Bill of Materials)</h4>';
    html += '<button class="btn btn-outline btn-small" onclick="makerOpenAddPartModal()">+ Add Part</button>';
    html += '</div>';

    var lineItems = activeData.lineItems || {};
    var liKeys = Object.keys(lineItems);

    if (liKeys.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);text-align:center;padding:12px;">No parts added yet. Click "+ Add Part" to select materials.</p>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;">';
      html += '<thead><tr>';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Material</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Qty</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Waste%</th>';
      html += '<th style="text-align:center;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">UOM</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Unit Cost</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Extended</th>';
      html += '<th style="width:40px;border-bottom:1px solid var(--cream-dark);"></th>';
      html += '</tr></thead><tbody>';

      liKeys.forEach(function(liId) {
        var li = lineItems[liId];
        var calcLi = calc.lineItems[liId] || {};
        var ext = calcLi.extendedCost || roundCents((li.quantity || 0) * (li.unitCost || 0));
        var effQty = calcLi.effectiveQty || li.quantity || 0;
        var scrapPct = li.scrapPercent || 0;
        var subBadge = '';
        if (li.kind === 'recipe') {
          var errFlag = calcLi.subAssemblyError ? ' <span title="' + esc(calcLi.subAssemblyError) + '" style="color:var(--danger);">⚠</span>' : '';
          subBadge = ' <span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.72rem;padding:1px 6px;margin-left:4px;">sub-assembly</span>' + errFlag;
        }
        // Phase 2D: lock chip on materials with active locks
        var lockChip = '';
        if (li.kind !== 'recipe' && li.materialId) {
          var activeLock = getActiveLockForMaterial(li.materialId);
          if (activeLock) {
            var pctUsed = activeLock.qtyLocked > 0 ? Math.round((activeLock.qtyConsumed / activeLock.qtyLocked) * 100) : 0;
            lockChip = ' <span class="status-badge" style="background:rgba(42,124,111,0.15);color:var(--teal);font-size:0.72rem;padding:1px 6px;margin-left:4px;" title="Locked at $' + activeLock.lockedUnitCost.toFixed(2) + ' from ' + esc(activeLock.supplierName || 'supplier') + ', ' + pctUsed + '% consumed">🔒 $' + activeLock.lockedUnitCost.toFixed(2) + '</span>';
          }
        }
        html += '<tr>';
        html += '<td style="padding:8px;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">' + esc(li.materialName || '') + subBadge + lockChip + '</td>';
        html += '<td style="text-align:right;padding:8px;border-bottom:1px solid var(--cream-dark);"><input type="number" step="0.01" min="0" value="' + (li.quantity || 0) + '" style="width:90px;text-align:right;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;font-family:monospace;background:var(--cream);color:var(--charcoal);" onchange="makerUpdateLineItemQty(\'' + esc(liId) + '\', this.value)">' + (scrapPct > 0 ? '<div style="font-size:0.72rem;color:var(--warm-gray);text-align:right;margin-top:2px;">eff: ' + effQty.toFixed(2) + '</div>' : '') + '</td>';
        html += '<td style="text-align:right;padding:8px;border-bottom:1px solid var(--cream-dark);"><input type="number" step="1" min="0" max="200" value="' + scrapPct + '" style="width:80px;text-align:right;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;font-family:monospace;background:var(--cream);color:var(--charcoal);" onchange="makerUpdateLineItemScrap(\'' + esc(liId) + '\', this.value)"></td>';
        html += '<td style="text-align:center;padding:8px;font-size:0.85rem;color:var(--warm-gray);border-bottom:1px solid var(--cream-dark);">' + esc(li.unitOfMeasure || '') + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">$' + (li.unitCost || 0).toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.85rem;font-weight:600;border-bottom:1px solid var(--cream-dark);">$' + ext.toFixed(2) + '</td>';
        html += '<td style="text-align:center;padding:8px;border-bottom:1px solid var(--cream-dark);"><button style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.9rem;" onclick="makerRemoveLineItemUI(\'' + esc(liId) + '\')" title="Remove">✕</button></td>';
        html += '</tr>';
      });

      html += '</tbody></table>';
    }

    // Materials subtotal
    html += '<div style="text-align:right;padding:8px;font-size:0.85rem;font-weight:600;margin-top:4px;">Total Materials: <span style="font-family:monospace;">$' + calc.totalMaterialCost.toFixed(2) + '</span></div>';
    html += '</div>';

    // ---- LABOR SECTION ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<h4 style="font-size:0.9rem;font-weight:600;margin:0 0 12px;">Labor</h4>';
    html += '<div style="display:flex;gap:12px;align-items:flex-end;">';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Rate ($/hr)</label>';
    html += '<input type="number" step="0.01" min="0" value="' + (bs.laborRatePerHour || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'laborRatePerHour\', parseFloat(this.value) || 0)">';
    html += '</div>';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Time (minutes)' + (fieldMeta.laborMinutes.inherited ? ' <span style="font-weight:400;color:var(--warm-gray-light);">(inherited)</span>' : '') + '</label>';
    html += '<input type="number" step="1" min="0" value="' + (activeData.laborMinutes || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;' + (fieldMeta.laborMinutes.inherited ? 'font-style:italic;opacity:0.7;' : '') + '" onchange="makerUpdateBuilderField(\'laborMinutes\', parseFloat(this.value) || 0)">';
    html += '</div>';

    html += '<div style="flex:1;text-align:right;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Labor Cost</label>';
    html += '<div style="padding:8px 10px;font-family:monospace;font-size:0.85rem;font-weight:600;">$' + calc.laborCost.toFixed(2) + '</div>';
    html += '</div>';

    html += '</div></div>';

    // ---- OTHER COSTS SECTION ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<h4 style="font-size:0.9rem;font-weight:600;margin:0 0 12px;">Other Costs</h4>';
    html += '<div style="display:flex;gap:12px;">';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Amount ($)' + (fieldMeta.otherCost.inherited ? ' <span style="font-weight:400;color:var(--warm-gray-light);">(inherited)</span>' : '') + '</label>';
    html += '<input type="number" step="0.01" min="0" value="' + (activeData.otherCost || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;' + (fieldMeta.otherCost.inherited ? 'font-style:italic;opacity:0.7;' : '') + '" onchange="makerUpdateBuilderField(\'otherCost\', parseFloat(this.value) || 0)">';
    html += '</div>';

    html += '<div style="flex:2;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Note</label>';
    html += '<input type="text" value="' + esc(bs.otherCostNote || '') + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';box-sizing:border-box;" onchange="makerUpdateBuilderField(\'otherCostNote\', this.value)" placeholder="e.g. packaging, shipping supplies">';
    html += '</div>';

    html += '</div>';

    // Setup cost + batch size (amortized fixed cost — kiln firing, casting tree, etc.)
    html += '<div style="display:flex;gap:12px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--cream-dark);">';
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Setup Cost ($) <span style="font-weight:400;color:var(--warm-gray-light);">amortized</span></label>';
    html += '<input type="number" step="0.01" min="0" value="' + (bs.setupCost || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'setupCost\', parseFloat(this.value) || 0)">';
    html += '</div>';
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Batch Size <span style="font-weight:400;color:var(--warm-gray-light);">units per setup</span></label>';
    html += '<input type="number" step="1" min="1" value="' + (bs.batchSize || 1) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'batchSize\', Math.max(1, parseInt(this.value) || 1))">';
    html += '</div>';
    html += '<div style="flex:1;text-align:right;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Per Unit</label>';
    html += '<div style="padding:8px 10px;font-family:monospace;font-size:0.85rem;font-weight:600;">$' + (calc.perUnitSetup || 0).toFixed(2) + '</div>';
    html += '</div>';
    html += '</div></div>';

    // ---- COST SUMMARY ----
    html += '<div style="background:var(--charcoal);color:white;border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:6px;"><span>Materials</span><span style="font-family:monospace;">$' + calc.totalMaterialCost.toFixed(2) + '</span></div>';
    html += '<div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:6px;"><span>Labor</span><span style="font-family:monospace;">$' + calc.laborCost.toFixed(2) + '</span></div>';
    if (bs.otherCost > 0) {
      html += '<div style="display:flex;justify-content:space-between;font-size:0.85rem;margin-bottom:6px;"><span>Other</span><span style="font-family:monospace;">$' + (bs.otherCost || 0).toFixed(2) + '</span></div>';
    }
    html += '<div style="display:flex;justify-content:space-between;font-size:1.15rem;font-weight:700;padding-top:8px;border-top:1px solid rgba(255,255,255,0.2);"><span>Total Cost</span><span style="font-family:monospace;">$' + calc.totalCost.toFixed(2) + '</span></div>';
    html += '</div>';

    // ---- PRICING TIERS (3 columns side-by-side) ----
    html += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">';

    var tiers = [
      { key: 'wholesale', label: 'Wholesale', markupField: 'wholesaleMarkup', price: calc.wholesalePrice, profit: calc.wholesaleGrossProfit, marginPct: calc.wholesaleMarginPct },
      { key: 'direct', label: 'Direct', markupField: 'directMarkup', price: calc.directPrice, profit: calc.directGrossProfit, marginPct: calc.directMarginPct },
      { key: 'retail', label: 'Retail', markupField: 'retailMarkup', price: calc.retailPrice, profit: calc.retailGrossProfit, marginPct: calc.retailMarginPct }
    ];

    tiers.forEach(function(tier) {
      var isActive = bs.activePriceTier === tier.key;
      var borderColor = isActive ? 'var(--teal)' : 'var(--cream-dark)';
      var headerBg = isActive ? 'rgba(42,124,111,0.08)' : 'transparent';

      html += '<div style="background:var(--cream);border:2px solid ' + borderColor + ';border-radius:8px;padding:14px;position:relative;">';

      // Active indicator
      if (isActive) {
        html += '<div style="position:absolute;top:-1px;right:12px;background:var(--teal);color:white;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:0 0 4px 4px;text-transform:uppercase;letter-spacing:0.06em;">Active</div>';
      }

      // Tier header
      html += '<div style="text-align:center;font-size:0.85rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);margin-bottom:10px;background:' + headerBg + ';padding:4px;border-radius:4px;">' + tier.label + '</div>';

      // Markup input
      html += '<div style="text-align:center;margin-bottom:8px;">';
      html += '<label style="font-size:0.72rem;color:var(--warm-gray-light);display:block;margin-bottom:2px;">Markup</label>';
      html += '<input type="number" step="0.1" min="1" value="' + (bs[tier.markupField] || 1) + '" style="width:70px;text-align:center;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;font-family:monospace;font-weight:600;background:var(--cream);color:var(--charcoal);" onchange="makerUpdateBuilderField(\'' + tier.markupField + '\', parseFloat(this.value) || 1)">';
      html += '<span style="font-size:0.85rem;color:var(--warm-gray);margin-left:2px;">×</span>';
      html += '</div>';

      // Price — Channel-First Phase 1c (D33, D41): suggested price + optional override
      var ovMap = (bs.overridePrice && typeof bs.overridePrice === 'object') ? bs.overridePrice : {};
      var ovVal = (typeof ovMap[tier.key] === 'number' && ovMap[tier.key] > 0) ? ovMap[tier.key] : null;
      var effPrice = ovVal != null ? ovVal : tier.price;
      html += '<div style="text-align:center;font-size:1.15rem;font-family:monospace;font-weight:700;color:var(--charcoal);margin-bottom:4px;">';
      html += '$' + effPrice.toFixed(2);
      if (ovVal != null) {
        html += ' <span style="font-size:0.72rem;color:var(--warm-gray-light);text-decoration:line-through;font-weight:400;">$' + tier.price.toFixed(2) + '</span>';
      }
      html += '</div>';
      // Override input
      html += '<div style="text-align:center;margin-top:6px;">';
      html += '<label style="font-size:0.72rem;color:var(--warm-gray-light);display:block;margin-bottom:2px;">Override</label>';
      html += '<input type="number" step="0.01" min="0" placeholder="—" value="' + (ovVal != null ? ovVal.toFixed(2) : '') + '" ';
      html += 'style="width:80px;text-align:center;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:0.78rem;font-family:monospace;background:var(--cream);color:var(--charcoal);" ';
      html += 'onchange="makerSetOverrideFromBuilder(\'' + tier.key + '\', this.value)" title="Set a fixed price for this tier (overrides the suggested price). Leave blank to use suggested.">';
      html += '</div>';

      // Gross profit + margin %
      var minMargin = bs.minMarginPercent;
      var belowMin = minMargin != null && tier.marginPct < minMargin;
      var profitColor = tier.profit > 0 ? '#16a34a' : 'var(--danger)';
      var marginColor = belowMin ? 'var(--danger)' : profitColor;
      html += '<div style="text-align:center;font-size:0.78rem;color:' + profitColor + ';">Profit: $' + tier.profit.toFixed(2) + '</div>';
      html += '<div style="text-align:center;font-size:0.85rem;font-weight:600;color:' + marginColor + ';margin-top:2px;">Margin: ' + tier.marginPct.toFixed(1) + '%' + (belowMin ? ' ⚠' : '') + '</div>';

      // Etsy sync indicator + Set active button
      if (isActive) {
        var linkedProduct = bs.productId ? (window.productsData || []).find(function(p) { return p.pid === bs.productId; }) : null;
        if (linkedProduct && linkedProduct.etsyListingId) {
          html += '<div style="text-align:center;margin-top:8px;font-size:0.72rem;color:var(--teal);">Etsy listing will sync</div>';
          if (bs.lastEtsySyncAt) {
            html += '<div style="text-align:center;font-size:0.72rem;color:var(--warm-gray-light);">Last sync: ' + new Date(bs.lastEtsySyncAt).toLocaleDateString() + '</div>';
          }
        } else if (linkedProduct) {
          html += '<div style="text-align:center;margin-top:8px;font-size:0.72rem;color:var(--warm-gray-light);">No Etsy listing</div>';
        }
      } else {
        html += '<button class="btn btn-outline btn-small" style="width:100%;margin-top:10px;font-size:0.78rem;" onclick="makerSetTierFromBuilder(\'' + tier.key + '\')">Set Active</button>';
      }

      html += '</div>';
    });

    html += '</div>';

    // ---- DRIFT SUMMARY (recipe vs product price divergence) ----
    if (bs.productId && editingRecipeId) {
      var driftData = bs.drift || null;
      // Try loading from cache if not on builderState
      if (!driftData && window.__mastRecipeDrift && window.__mastRecipeDrift[editingRecipeId]) {
        driftData = window.__mastRecipeDrift[editingRecipeId];
      }
      if (driftData) {
        html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px 16px;margin-bottom:16px;">';
        html += '<h4 style="font-size:0.9rem;font-weight:600;margin:0 0 8px;">Price Drift (Recipe vs Product)</h4>';
        html += '<div style="display:flex;gap:24px;flex-wrap:wrap;">';
        if (driftData.retail) {
          var rd = driftData.retail;
          var rColor = Math.abs(rd.driftPct || 0) <= 5 ? '#16a34a' : Math.abs(rd.driftPct || 0) <= 15 ? '#b45309' : '#dc2626';
          html += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Retail:</span> <span style="font-size:0.85rem;font-family:monospace;">$' + ((rd.recipeCents || 0) / 100).toFixed(2) + ' → $' + ((rd.productCents || 0) / 100).toFixed(2) + '</span>';
          html += ' <span style="font-size:0.78rem;font-weight:600;color:' + rColor + ';">' + (rd.driftPct > 0 ? '+' : '') + (rd.driftPct || 0).toFixed(1) + '%</span></div>';
        }
        if (driftData.wholesale) {
          var wd = driftData.wholesale;
          var wColor = Math.abs(wd.driftPct || 0) <= 5 ? '#16a34a' : Math.abs(wd.driftPct || 0) <= 15 ? '#b45309' : '#dc2626';
          html += '<div><span style="font-size:0.78rem;color:var(--warm-gray);">Wholesale:</span> <span style="font-size:0.85rem;font-family:monospace;">$' + ((wd.recipeCents || 0) / 100).toFixed(2) + ' → $' + ((wd.productCents || 0) / 100).toFixed(2) + '</span>';
          html += ' <span style="font-size:0.78rem;font-weight:600;color:' + wColor + ';">' + (wd.driftPct > 0 ? '+' : '') + (wd.driftPct || 0).toFixed(1) + '%</span></div>';
        }
        if (driftData.lastCheckedAt) {
          html += '<div style="flex-basis:100%;font-size:0.72rem;color:var(--warm-gray);">Last checked: ' + new Date(driftData.lastCheckedAt).toLocaleString() + '</div>';
        }
        html += '</div></div>';
      } else {
        // Trigger async load
        if (typeof loadRecipeDrift === 'function') {
          loadRecipeDrift(editingRecipeId).then(function(drift) {
            if (drift) renderRecipeBuilder();
          });
        }
      }
    }

    // ---- Phase 2C.2: marginHistory sparkline ----
    var history = Array.isArray(bs.marginHistory) ? bs.marginHistory : [];
    if (history.length >= 2) {
      var activeTierKeyForSpark = bs.activePriceTier || 'direct';
      var spark = makerSparklineSvg(history, activeTierKeyForSpark);
      var oldestDate = history[0].date ? new Date(history[0].date).toLocaleDateString() : '';
      var newestDate = history[history.length - 1].date ? new Date(history[history.length - 1].date).toLocaleDateString() : '';
      html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px 16px;margin-bottom:16px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">';
      html += '<h4 style="font-size:0.9rem;font-weight:600;margin:0;">Margin history</h4>';
      html += '<span style="font-size:0.72rem;color:var(--warm-gray);">' + history.length + ' calc' + (history.length === 1 ? '' : 's') + ' · ' + oldestDate + ' → ' + newestDate + '</span>';
      html += '</div>';
      html += spark;
      html += '</div>';
    }

    // ---- VARIANT PRICING SUMMARY (cost-shape — read computed fields written by calculate_price) ----
    if (hasProductVariants && bs.variants && existingVariantKeys.length > 0 && bs.variantsShape === 'cost') {
      var activeTier = bs.activePriceTier || 'direct';
      var marginKey = activeTier + 'MarginPct';
      var minMarginV = bs.minMarginPercent;
      // Build display list: Default first, then each per-variant override (orphans last).
      var rows = [{ key: 'default', label: 'Default', orphan: false }];
      productVariants.forEach(function(pv) {
        if (existingVariantKeys.indexOf(pv.id) >= 0) {
          rows.push({ key: pv.id, label: variantDisplayName(pv), orphan: false });
        }
      });
      orphanKeys.forEach(function(ok) {
        rows.push({ key: ok, label: '⚠ ' + ok.substring(0, 8), orphan: true });
      });

      html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
      html += '<h4 style="font-size:0.9rem;font-weight:600;margin:0 0 12px;">Variant Pricing Summary</h4>';
      html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 8px;">Computed at last Save & Recalculate. Run again after edits to refresh.</p>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
      html += '<thead><tr>';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Variant</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Cost</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Wholesale</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Direct</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Retail</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Margin (active)</th>';
      html += '</tr></thead><tbody>';
      rows.forEach(function(row) {
        var vc = (bs.variants && bs.variants[row.key]) || {};
        var vMargin = vc[marginKey] || 0;
        var vBelow = minMarginV != null && vMargin < minMarginV;
        html += '<tr>';
        html += '<td style="padding:8px;font-weight:500;border-bottom:1px solid var(--cream-dark);' + (row.orphan ? 'color:#b45309;' : '') + '">' + esc(row.label) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;border-bottom:1px solid var(--cream-dark);">$' + (vc.totalCost || 0).toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;border-bottom:1px solid var(--cream-dark);">$' + (vc.wholesalePrice || 0).toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;border-bottom:1px solid var(--cream-dark);">$' + (vc.directPrice || 0).toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;border-bottom:1px solid var(--cream-dark);">$' + (vc.retailPrice || 0).toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-weight:600;color:' + (vBelow ? 'var(--danger)' : '#16a34a') + ';border-bottom:1px solid var(--cream-dark);">' + vMargin.toFixed(1) + '%' + (vBelow ? ' ⚠' : '') + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
    }

    // ---- MIN MARGIN FLOOR ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;">';
    html += '<label style="font-size:0.85rem;font-weight:600;flex-shrink:0;">Minimum Margin Floor (%)</label>';
    html += '<input type="number" step="1" min="0" max="100" value="' + (bs.minMarginPercent != null ? bs.minMarginPercent : '') + '" style="width:90px;padding:6px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);" placeholder="off" onchange="makerUpdateBuilderField(\'minMarginPercent\', this.value === \'\' ? null : parseFloat(this.value))">';
    html += '<span style="font-size:0.78rem;color:var(--warm-gray);">Active tier margin must stay above this; leave blank to disable.</span>';
    html += '</div>';

    // ---- NOTES ----
    html += '<div style="margin-bottom:16px;">';
    html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Recipe Notes</label>';
    html += '<textarea rows="2" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;resize:vertical;box-sizing:border-box;" onchange="makerUpdateBuilderField(\'notes\', this.value)">' + esc(bs.notes || '') + '</textarea>';
    html += '</div>';

    tab.innerHTML = html;
  }

  // ============================================================
  // Recipe Builder — Interactive Controls
  // ============================================================

  // Phase 6a.3: toggleChannel() removed — zero callers. The UI it served
  // (recipe-builder legacy channel toggles) was replaced by channelBindings[].

  function updateBuilderField(field, value) {
    if (!builderState) return;
    // Variant-scoped fields: laborMinutes, otherCost go to active variant slot
    // (or default slot when on the Default tab). Editing promotes inherited → override.
    var variantFields = ['laborMinutes', 'otherCost'];
    if (variantFields.indexOf(field) >= 0) {
      var slot = ensureVariantSlot(builderState, currentVariantId || 'default');
      slot[field] = value;
    } else {
      builderState[field] = value;
    }
    renderRecipeBuilder();
  }

  function updateLineItemQty(liId, value) {
    if (!builderState) return;
    var lineItems = materializeLineItems(builderState, currentVariantId || 'default');
    if (!lineItems[liId]) return;
    lineItems[liId].quantity = parseFloat(value) || 0;
    renderRecipeBuilder();
  }

  function updateLineItemScrap(liId, value) {
    if (!builderState) return;
    var lineItems = materializeLineItems(builderState, currentVariantId || 'default');
    if (!lineItems[liId]) return;
    lineItems[liId].scrapPercent = Math.min(50, Math.max(0, parseFloat(value) || 0));
    renderRecipeBuilder();
  }

  function removeLineItemUI(liId) {
    if (!builderState) return;
    var lineItems = materializeLineItems(builderState, currentVariantId || 'default');
    delete lineItems[liId];
    renderRecipeBuilder();
  }

  async function saveRecipeBuilder() {
    if (!editingRecipeId || !builderState) return;
    try {
      // Ensure default slot exists so backend always has an inheritance root.
      var defaultSlot = ensureVariantSlot(builderState, 'default');
      // If default slot is empty (legacy recipe being saved for the first time in new UI),
      // seed it from the recipe-root fields so calculate_price has something to work with.
      if (defaultSlot.lineItems === undefined && builderState.lineItems) {
        defaultSlot.lineItems = JSON.parse(JSON.stringify(builderState.lineItems));
      }
      if (defaultSlot.laborMinutes === undefined && builderState.laborMinutes != null) {
        defaultSlot.laborMinutes = builderState.laborMinutes;
      }
      if (defaultSlot.otherCost === undefined && builderState.otherCost != null) {
        defaultSlot.otherCost = builderState.otherCost;
      }

      var updates = {
        laborRatePerHour: builderState.laborRatePerHour || 0,
        wholesaleMarkup: builderState.wholesaleMarkup || 1,
        directMarkup: builderState.directMarkup || 1,
        retailMarkup: builderState.retailMarkup || 1,
        otherCostNote: builderState.otherCostNote || '',
        setupCost: builderState.setupCost || 0,
        batchSize: builderState.batchSize || 1,
        channels: Array.isArray(builderState.channels) ? builderState.channels : ['retail'],
        minMarginPercent: builderState.minMarginPercent != null ? builderState.minMarginPercent : null,
        notes: builderState.notes || '',
        // New cost-shape model
        variantsShape: 'cost',
        variants: builderState.variants || {},
        // Strip legacy fields
        isVariantEnabled: null,
        variantDimension: null,
        variantLabel: null,
        // Mirror default slot to recipe root for backend deepest-fallback compat
        lineItems: defaultSlot.lineItems || builderState.lineItems || {},
        laborMinutes: defaultSlot.laborMinutes != null ? defaultSlot.laborMinutes : (builderState.laborMinutes || 0),
        otherCost: defaultSlot.otherCost != null ? defaultSlot.otherCost : (builderState.otherCost || 0)
      };
      await updateRecipe(editingRecipeId, updates);
      MastAdmin.showToast('Recipe saved');
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  async function saveAndRecalcRecipe() {
    if (!editingRecipeId || !builderState) return;
    try {
      // Save builder state first
      await saveRecipeBuilder();
      // Then recalculate (refreshes material costs, clears dirty, propagates price)
      var result = await recalculateRecipe(editingRecipeId);
      // Update builder state with recalculated values
      var fresh = await MastDB.recipes.get(editingRecipeId);
      if (fresh) {
        builderState = JSON.parse(JSON.stringify(fresh));
      }
      renderRecipeBuilder();
      MastAdmin.showToast('Recipe saved and recalculated');
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  /**
   * Duplicate a recipe — clones line items, labor, other costs, variants, markups.
   * New recipe starts in draft status with name suffixed " (copy)".
   * NOTE: productId is intentionally NOT copied — duplicates are unlinked drafts.
   */
  async function duplicateRecipe(recipeId) {
    var src = recipesData[recipeId];
    if (!src) throw new Error('Recipe not found: ' + recipeId);
    var clone = JSON.parse(JSON.stringify(src));
    // Reassign IDs and reset link fields
    delete clone.recipeId;
    clone.productId = '';
    clone.name = (src.name || 'Untitled') + ' (copy)';
    clone.status = 'draft';
    clone.activePriceTier = 'none';
    clone.lastEtsySyncAt = null;
    clone.lastCalculatedAt = null;
    clone.costsDirty = false;
    // Generate fresh line item ids so sub-assembly cycle checks remain stable
    if (clone.lineItems) {
      var freshLis = {};
      Object.keys(clone.lineItems).forEach(function(oldId) {
        var newId = 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        var li = clone.lineItems[oldId];
        li.lineItemId = newId;
        freshLis[newId] = li;
      });
      clone.lineItems = freshLis;
    }
    if (clone.variants) {
      var freshVariants = {};
      Object.keys(clone.variants).forEach(function(vid) {
        var v = clone.variants[vid];
        var newVid = 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        v.variantId = newVid;
        if (v.lineItems) {
          var fLis = {};
          Object.keys(v.lineItems).forEach(function(oldId) {
            var newId = 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            var li = v.lineItems[oldId];
            li.lineItemId = newId;
            fLis[newId] = li;
          });
          v.lineItems = fLis;
        }
        freshVariants[newVid] = v;
      });
      clone.variants = freshVariants;
    }
    var created = await createRecipe(clone);
    return created;
  }

  async function duplicateCurrentRecipe() {
    if (!editingRecipeId) return;
    if (!await mastConfirm('Duplicate this recipe as a new draft? The clone will not be linked to a product.', { title: 'Duplicate Recipe' })) return;
    try {
      // Save current state first so the clone reflects unsaved edits
      await saveRecipeBuilder();
      var clone = await duplicateRecipe(editingRecipeId);
      MastAdmin.showToast('Duplicated as "' + clone.name + '"');
      // Open the clone for editing
      editingRecipeId = clone.recipeId;
      builderState = JSON.parse(JSON.stringify(clone));
      renderRecipeBuilder();
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  async function recalcAllDirty() {
    var dirtyIds = Object.keys(recipesData).filter(function(rid) {
      var r = recipesData[rid];
      return r && r.status !== 'archived' && r.costsDirty;
    });
    if (dirtyIds.length === 0) {
      MastAdmin.showToast('No recipes need recalculation');
      return;
    }
    if (!await mastConfirm('Recalculate ' + dirtyIds.length + ' flagged recipe' + (dirtyIds.length === 1 ? '' : 's') + '? This refreshes material costs and updates totals.', { title: 'Recalculate Recipes' })) {
      return;
    }
    var ok = 0, fail = 0;
    for (var i = 0; i < dirtyIds.length; i++) {
      try {
        await recalculateRecipe(dirtyIds[i]);
        ok++;
      } catch (err) {
        console.error('Recalc failed for ' + dirtyIds[i], err);
        fail++;
      }
    }
    MastAdmin.showToast('Recalculated ' + ok + (fail > 0 ? ' (' + fail + ' failed)' : ''));
    renderPiecesList();
  }

  async function recalcAndRefresh() {
    if (!editingRecipeId) return;
    try {
      await recalculateRecipe(editingRecipeId);
      var fresh = await MastDB.recipes.get(editingRecipeId);
      if (fresh) {
        builderState = JSON.parse(JSON.stringify(fresh));
      }
      renderRecipeBuilder();
      MastAdmin.showToast('Recipe recalculated');
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  async function setTierFromBuilder(tier) {
    if (!editingRecipeId || !builderState) return;
    try {
      // Save first, then recalc to get fresh prices, then set tier
      await saveRecipeBuilder();
      await recalculateRecipe(editingRecipeId);
      await setActivePriceTier(editingRecipeId, tier);
      // Refresh builder state
      var fresh = await MastDB.recipes.get(editingRecipeId);
      if (fresh) {
        builderState = JSON.parse(JSON.stringify(fresh));
      }
      renderRecipeBuilder();
      MastAdmin.showToast(tier.charAt(0).toUpperCase() + tier.slice(1) + ' tier set as active price');
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  function closeRecipeBuilder() {
    // MastNavStack-aware: pop and return if we came from a cross-module nav.
    if (window.MastNavStack && MastNavStack.size() > 0) {
      piecesView = 'list';
      editingRecipeId = null;
      builderState = null;
      MastNavStack.popAndReturn();
      return;
    }
    piecesView = 'list';
    editingRecipeId = null;
    builderState = null;
    renderPiecesList();
  }

  // Phase 2C.2: inline SVG sparkline of marginPct over time
  function makerSparklineSvg(history, activeTierKey) {
    if (!Array.isArray(history) || history.length < 2) return '';
    var W = 360, H = 60, P = 4;
    var ys = history.map(function(h) { return h.marginPct || 0; });
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);
    if (maxY === minY) { minY -= 1; maxY += 1; }
    var pts = history.map(function(h, i) {
      var x = P + (i / (history.length - 1)) * (W - 2 * P);
      var y = H - P - ((h.marginPct - minY) / (maxY - minY)) * (H - 2 * P);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastPct = history[history.length - 1].marginPct || 0;
    var firstPct = history[0].marginPct || 0;
    var trend = lastPct >= firstPct ? '#16a34a' : '#dc2626';
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:60px;display:block;">';
    svg += '<polyline fill="none" stroke="' + trend + '" stroke-width="1.8" points="' + pts + '" />';
    // last point dot
    var parts = pts.split(' ');
    var last = parts[parts.length - 1].split(',');
    svg += '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="2.5" fill="' + trend + '" />';
    svg += '</svg>';
    svg += '<div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">';
    svg += '<span>min ' + minY.toFixed(1) + '%</span><span>' + activeTierKey + ' tier</span><span>max ' + maxY.toFixed(1) + '%</span>';
    svg += '</div>';
    return svg;
  }

  // Phase 2C.3: cross-BOM what-if simulator (in-memory recalc, zero writes)
  function runMetalShiftSimulation(goldPct, silverPct, platinumPct) {
    var shifts = { gold: goldPct || 0, silver: silverPct || 0, platinum: platinumPct || 0 };
    var spot = spotPricesCurrent || {};
    var simulatedMatCost = {};
    Object.keys(materialsData).forEach(function(mid) {
      var m = materialsData[mid];
      if (m && m.pricingMode === 'spot-linked' && m.spotMetal && typeof spot[m.spotMetal] === 'number') {
        var shiftedSpot = spot[m.spotMetal] * (1 + (shifts[m.spotMetal] || 0) / 100);
        var explicit = Number(m.conversionFactor || 0);
        var auto = ({ oz: 1, dwt: 20, carat: 155.5174, gram: 31.1035, kg: 0.0311035, lb: 0.0685714 })[m.unitOfMeasure];
        var unitsPerOz = explicit > 0 ? explicit : (auto || 1);
        simulatedMatCost[mid] = roundCents(shiftedSpot * (m.purity || 0) * (1 + (m.markupOverSpot || 0) / 100) / unitsPerOz);
      } else if (m) {
        simulatedMatCost[mid] = m.replacementCost != null ? m.replacementCost : (m.unitCost || 0);
      }
    });
    var results = [];
    Object.keys(recipesData).forEach(function(rid) {
      var r = recipesData[rid];
      if (!r || r.status === 'archived') return;
      var lis = r.lineItems || {};
      var simLis = {};
      var usesShifted = false;
      Object.keys(lis).forEach(function(liId) {
        var li = lis[liId];
        if (li.kind === 'recipe') { simLis[liId] = li; return; }
        var newCost = (li.materialId && simulatedMatCost[li.materialId] != null) ? simulatedMatCost[li.materialId] : (li.unitCost || 0);
        var m = li.materialId ? materialsData[li.materialId] : null;
        if (m && m.pricingMode === 'spot-linked' && shifts[m.spotMetal]) usesShifted = true;
        simLis[liId] = Object.assign({}, li, { unitCost: newCost });
      });
      if (!usesShifted) return;
      var sim = calculateRecipe({
        lineItems: simLis,
        laborRatePerHour: r.laborRatePerHour,
        laborMinutes: r.laborMinutes,
        otherCost: r.otherCost,
        setupCost: r.setupCost,
        batchSize: r.batchSize,
        wholesaleMarkup: r.wholesaleMarkup || 2.0,
        directMarkup: r.directMarkup || 2.5,
        retailMarkup: r.retailMarkup || 3.5
      });
      var tier = r.activePriceTier || 'direct';
      results.push({
        recipeId: rid,
        name: r.name,
        tier: tier,
        currentTotalCost: r.totalCost || 0,
        simulatedTotalCost: sim.totalCost,
        costDelta: roundCents(sim.totalCost - (r.totalCost || 0)),
        currentMarginPct: r[tier + 'MarginPct'] || 0,
        simulatedMarginPct: sim[tier + 'MarginPct'] || 0,
        breachesFloor: r.minMarginPercent != null && sim[tier + 'MarginPct'] < r.minMarginPercent
      });
    });
    results.sort(function(a, b) { return Math.abs(b.costDelta) - Math.abs(a.costDelta); });
    return results;
  }

  function openWhatIfSimulator() {
    var html = '';
    html += '<div id="whatIfOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target.id===\'whatIfOverlay\')makerCloseWhatIf()">';
    html += '<div style="background:var(--cream);border-radius:10px;max-width:760px;width:92%;max-height:88vh;overflow-y:auto;padding:20px 24px;box-shadow:0 8px 30px rgba(0,0,0,0.2);">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">📊 What-If Simulator</h3>';
    html += '<button style="background:none;border:none;font-size:1.15rem;cursor:pointer;color:var(--warm-gray);" onclick="makerCloseWhatIf()">✕</button>';
    html += '</div>';
    html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 16px;">Shift metals spot prices and see how every recipe that uses spot-linked materials would change. Zero writes — preview only.</p>';
    if (!spotPricesCurrent) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);">No spot prices available yet. Run refresh first.</p>';
    } else {
      html += '<div style="display:flex;gap:12px;margin-bottom:16px;">';
      ['gold','silver','platinum'].forEach(function(metal) {
        html += '<div style="flex:1;">';
        html += '<label style="display:block;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">' + metal.charAt(0).toUpperCase() + metal.slice(1) + ' shift %</label>';
        html += '<input id="whatIf_' + metal + '" type="number" step="1" value="0" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" oninput="makerRunWhatIf()">';
        html += '<div style="font-size:0.72rem;color:var(--warm-gray-light);margin-top:2px;">spot $' + (spotPricesCurrent[metal] || 0).toFixed(2) + '/oz</div>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div id="whatIfResults" style="margin-top:8px;"></div>';
    }
    html += '</div></div>';
    var c = document.createElement('div');
    c.id = 'whatIfContainer';
    c.innerHTML = html;
    document.body.appendChild(c);
    if (spotPricesCurrent) runWhatIfRender();
  }

  function runWhatIfRender() {
    var g = parseFloat((document.getElementById('whatIf_gold') || {}).value) || 0;
    var s = parseFloat((document.getElementById('whatIf_silver') || {}).value) || 0;
    var p = parseFloat((document.getElementById('whatIf_platinum') || {}).value) || 0;
    var results = runMetalShiftSimulation(g, s, p);
    var box = document.getElementById('whatIfResults');
    if (!box) return;
    var esc = MastAdmin.esc;
    if (results.length === 0) {
      box.innerHTML = '<p style="font-size:0.85rem;color:var(--warm-gray);text-align:center;padding:12px;">No spot-linked recipes affected by this shift.</p>';
      return;
    }
    var html = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">' + results.length + ' recipe(s) affected:</div>';
    html += '<div class="data-table"><table style="width:100%;font-size:0.85rem;"><thead><tr>';
    html += '<th>Recipe</th><th style="text-align:right;">Current $</th><th style="text-align:right;">Simulated $</th><th style="text-align:right;">Δ Cost</th><th style="text-align:right;">Margin → Sim</th>';
    html += '</tr></thead><tbody>';
    results.forEach(function(r) {
      var deltaColor = r.costDelta > 0 ? '#dc2626' : (r.costDelta < 0 ? '#16a34a' : 'var(--warm-gray)');
      var floorWarn = r.breachesFloor ? ' ⚠' : '';
      html += '<tr>';
      html += '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(r.name || '') + '</td>';
      html += '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">$' + r.currentTotalCost.toFixed(2) + '</td>';
      html += '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">$' + r.simulatedTotalCost.toFixed(2) + '</td>';
      html += '<td style="text-align:right;font-family:monospace;color:' + deltaColor + ';padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + (r.costDelta >= 0 ? '+' : '') + '$' + r.costDelta.toFixed(2) + '</td>';
      html += '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + r.currentMarginPct.toFixed(1) + '% → ' + r.simulatedMarginPct.toFixed(1) + '%' + floorWarn + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    box.innerHTML = html;
  }

  function closeWhatIf() {
    var c = document.getElementById('whatIfContainer');
    if (c) c.remove();
  }

  // Phase 2E: bulk reprice modal — preview-then-confirm
  function openRepriceAllModal() {
    var candidates = [];
    Object.keys(recipesData).forEach(function(rid) {
      var r = recipesData[rid];
      if (!r || r.status === 'archived') return;
      var d = typeof r.currentDriftPct === 'number' ? r.currentDriftPct : 0;
      if (Math.abs(d) >= repricingThresholdPct && r.driftBaseline) {
        candidates.push(Object.assign({ recipeId: rid }, r));
      }
    });
    candidates.sort(function(a, b) { return Math.abs(b.currentDriftPct) - Math.abs(a.currentDriftPct); });

    var html = '';
    html += '<div id="repriceOverlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;" onclick="if(event.target.id===\'repriceOverlay\')makerCloseRepriceAll()">';
    html += '<div style="background:var(--cream);border-radius:10px;max-width:680px;width:92%;max-height:88vh;overflow-y:auto;padding:20px 24px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">↻ Reprice ' + candidates.length + ' recipe' + (candidates.length === 1 ? '' : 's') + '</h3>';
    html += '<button style="background:none;border:none;font-size:1.15rem;cursor:pointer;color:var(--warm-gray);" onclick="makerCloseRepriceAll()">✕</button>';
    html += '</div>';
    html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 12px;">Drift threshold: ' + repricingThresholdPct + '%. Each reprice runs calculate_price + propagates the active tier price to the linked product + resets the drift baseline.</p>';
    if (candidates.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);text-align:center;padding:12px;">No recipes need repricing.</p>';
    } else {
      var esc = MastAdmin.esc;
      html += '<div class="data-table"><table style="width:100%;font-size:0.85rem;"><thead><tr>';
      html += '<th>Recipe</th><th>Tier</th><th style="text-align:right;">Drift</th><th style="text-align:right;">Baseline</th><th style="text-align:right;">Now</th>';
      html += '</tr></thead><tbody>';
      candidates.forEach(function(r) {
        html += '<tr>';
        html += '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(r.name || '') + '</td>';
        html += '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(r.activePriceTier || 'direct') + '</td>';
        html += '<td style="text-align:right;font-family:monospace;color:#b45309;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + (r.currentDriftPct > 0 ? '+' : '') + r.currentDriftPct.toFixed(1) + '%</td>';
        html += '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">$' + (r.driftBaseline || 0).toFixed(2) + '</td>';
        html += '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">$' + (r.totalCost || 0).toFixed(2) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table></div>';
      html += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">';
      html += '<button class="btn btn-secondary" onclick="makerCloseRepriceAll()">Cancel</button>';
      html += '<button class="btn btn-primary" onclick="makerExecuteRepriceAll()">Reprice all ' + candidates.length + '</button>';
      html += '</div>';
    }
    html += '</div></div>';
    var c = document.createElement('div');
    c.id = 'repriceContainer';
    c.innerHTML = html;
    document.body.appendChild(c);
  }

  function closeRepriceAllModal() {
    var c = document.getElementById('repriceContainer');
    if (c) c.remove();
  }

  async function executeRepriceAll() {
    var candidates = [];
    Object.keys(recipesData).forEach(function(rid) {
      var r = recipesData[rid];
      if (!r || r.status === 'archived') return;
      var d = typeof r.currentDriftPct === 'number' ? r.currentDriftPct : 0;
      if (Math.abs(d) >= repricingThresholdPct && r.driftBaseline) candidates.push(rid);
    });
    closeRepriceAllModal();
    var ok = 0, fail = 0;
    for (var i = 0; i < candidates.length; i++) {
      var rid = candidates[i];
      try {
        var r = recipesData[rid];
        var tier = r.activePriceTier || 'direct';
        await recalculateRecipe(rid);
        await setActivePriceTier(rid, tier);
        ok++;
      } catch (err) {
        fail++;
        console.error('Reprice failed for', rid, err);
      }
    }
    MastAdmin.showToast('Repriced ' + ok + (fail > 0 ? ' / ' + fail + ' failed' : ''));
    await loadVolatilePricingData();
    renderPiecesList();
  }

  // Phase 2D: lock delete confirm
  async function deletePriceLockConfirm(lockId) {
    var lock = priceLocksData[lockId];
    if (!lock) return;
    if (!await mastConfirm('Delete this price lock from ' + (lock.supplierName || 'supplier') + '?', { title: 'Delete Lock', danger: true })) return;
    try {
      await MastDB.remove('admin/priceLocks/' + lockId);
      MastAdmin.showToast('Lock deleted');
      await loadVolatilePricingData();
      renderMaterials();
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  // Phase 2E: one-click reprice — recalc + stage for product.
  // Channel-First Phase 2d (D24) — repurposed again: now stages the recipe;
  // product admin accepts via the banner. No direct write to product.
  async function repriceNow() {
    if (!editingRecipeId || !builderState) return;
    try {
      await saveRecipeBuilder();
      await recalculateRecipe(editingRecipeId);
      var result = await publishRecipe(editingRecipeId);
      var fresh = await MastDB.recipes.get(editingRecipeId);
      if (fresh) builderState = JSON.parse(JSON.stringify(fresh));
      await loadVolatilePricingData();
      renderRecipeBuilder();
      MastAdmin.showToast('Staged v' + result.version + ' \u2014 open product to apply');
    } catch (err) {
      MastAdmin.showToast('Stage failed: ' + (err.message || err), true);
    }
  }

  // Channel-First Phase 2d (D24) — explicit Stage from the recipe builder header.
  // Skips recalc; user has already done that. Writes recipe-side fields only.
  async function publishFromBuilder() {
    if (!editingRecipeId || !builderState) return;
    if (!builderState.productId) {
      MastAdmin.showToast('Recipe has no linked product', true);
      return;
    }
    var confirmed = await window.mastConfirm(
      'Stage ' + (builderState.name || 'recipe') + ' for the product?\n\n' +
      'This writes a new version snapshot to the recipe with Wholesale, Direct, and Retail prices. ' +
      'The product admin will see a banner on product detail to review the diff and apply (or reject).',
      { title: 'Stage recipe for product', confirmLabel: 'Stage', cancelLabel: 'Cancel' }
    );
    if (!confirmed) return;
    try {
      await saveRecipeBuilder();
      var result = await publishRecipe(editingRecipeId);
      var fresh = await MastDB.recipes.get(editingRecipeId);
      if (fresh) builderState = JSON.parse(JSON.stringify(fresh));
      renderRecipeBuilder();
      MastAdmin.showToast('Staged v' + result.version + ' \u2014 Wholesale $' + result.prices.wholesale.toFixed(2) + ', Direct $' + result.prices.direct.toFixed(2) + ', Retail $' + result.prices.retail.toFixed(2) + '. Open product to apply.');
    } catch (err) {
      MastAdmin.showToast('Stage failed: ' + (err.message || err), true);
    }
  }

  // Channel-First Phase 1c (D41) — set/clear an override for a tier on the active recipe.
  async function setOverrideFromBuilder(tier, raw) {
    if (!editingRecipeId || !builderState) return;
    var ov = (builderState.overridePrice && typeof builderState.overridePrice === 'object')
      ? Object.assign({}, builderState.overridePrice)
      : { wholesale: null, direct: null, retail: null };
    var num = (raw === '' || raw == null) ? null : parseFloat(raw);
    ov[tier] = (num != null && !isNaN(num) && num > 0) ? num : null;
    builderState.overridePrice = ov;
    try {
      await MastDB.recipes.update(editingRecipeId, { overridePrice: ov, updatedAt: new Date().toISOString() });
      MastAdmin.showToast(num ? (tier + ' override set to $' + num.toFixed(2)) : (tier + ' override cleared'));
      renderRecipeBuilder();
    } catch (err) {
      MastAdmin.showToast('Override save failed: ' + (err.message || err), true);
    }
  }

  // ============================================================
  // Add Part Modal (material picker)
  // ============================================================

  var addPartKind = 'material'; // 'material' | 'recipe'

  function openAddPartModal() {
    addPartKind = 'material';
    renderAddPartModal();
  }

  function setAddPartKind(kind) {
    addPartKind = kind;
    var existing = document.getElementById('addPartContainer');
    if (existing) existing.remove();
    renderAddPartModal();
  }

  function renderAddPartModal() {
    var esc = MastAdmin.esc;
    var activeMaterials = Object.values(materialsData).filter(function(m) {
      return m.status === 'active';
    }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    // Eligible sub-assembly recipes: active, not self, no cycle
    var eligibleRecipes = Object.values(recipesData).filter(function(r) {
      if (!r || r.status === 'archived') return false;
      if (r.recipeId === editingRecipeId) return false;
      if (editingRecipeId && wouldCreateCycle(editingRecipeId, r.recipeId)) return false;
      return true;
    }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var html = '';
    html += '<div id="addPartOverlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;" onclick="makerCloseAddPartModal(event)">';
    html += '<div style="background:var(--cream);border-radius:10px;max-width:480px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.2);padding:20px 24px;" onclick="event.stopPropagation()">';

    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:500;margin:0 0 16px;">Add Part</h3>';

    // Kind toggle (Material vs Sub-assembly)
    html += '<div style="display:flex;gap:0;margin-bottom:14px;border:1px solid var(--cream-dark);border-radius:6px;overflow:hidden;">';
    var matBg = addPartKind === 'material' ? 'var(--teal)' : 'var(--cream)';
    var matFg = addPartKind === 'material' ? 'white' : 'var(--charcoal)';
    var subBg = addPartKind === 'recipe' ? 'var(--teal)' : 'var(--cream)';
    var subFg = addPartKind === 'recipe' ? 'white' : 'var(--charcoal)';
    html += '<button style="flex:1;padding:8px 12px;border:none;background:' + matBg + ';color:' + matFg + ';font-size:0.85rem;font-weight:600;cursor:pointer;font-family:\'DM Sans\';" onclick="makerSetAddPartKind(\'material\')">Material</button>';
    html += '<button style="flex:1;padding:8px 12px;border:none;background:' + subBg + ';color:' + subFg + ';font-size:0.85rem;font-weight:600;cursor:pointer;font-family:\'DM Sans\';" onclick="makerSetAddPartKind(\'recipe\')">Sub-assembly</button>';
    html += '</div>';

    if (addPartKind === 'material') {
      if (activeMaterials.length === 0) {
        html += '<p style="font-size:0.85rem;color:var(--warm-gray);text-align:center;padding:20px;">No active materials. Go to Materials to add some first.</p>';
      } else {
        html += '<div style="margin-bottom:12px;">';
        html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Material</label>';
        html += '<select id="addPartMaterialId" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">';
        html += '<option value="">Select material...</option>';
        activeMaterials.forEach(function(m) {
          html += '<option value="' + esc(m.materialId) + '">' + esc(m.name) + ' (' + esc(m.unitOfMeasure) + ' @ $' + (m.unitCost || 0).toFixed(2) + ')</option>';
        });
        html += '</select>';
        html += '</div>';

        html += '<div style="margin-bottom:16px;">';
        html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Quantity</label>';
        html += '<input id="addPartQty" type="number" step="0.01" min="0" value="1" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;">';
        html += '</div>';
      }
    } else {
      if (eligibleRecipes.length === 0) {
        html += '<p style="font-size:0.85rem;color:var(--warm-gray);text-align:center;padding:20px;">No eligible recipes available as sub-assemblies. Recipes that would create a cycle are excluded.</p>';
      } else {
        html += '<div style="margin-bottom:12px;">';
        html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Sub-recipe</label>';
        html += '<select id="addPartRecipeId" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">';
        html += '<option value="">Select recipe...</option>';
        eligibleRecipes.forEach(function(r) {
          html += '<option value="' + esc(r.recipeId) + '">' + esc(r.name || 'Untitled') + ' (cost $' + (r.totalCost || 0).toFixed(2) + ')</option>';
        });
        html += '</select>';
        html += '</div>';

        html += '<div style="margin-bottom:16px;">';
        html += '<label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Quantity</label>';
        html += '<input id="addPartQty" type="number" step="0.01" min="0" value="1" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;box-sizing:border-box;">';
        html += '</div>';

        html += '<p style="font-size:0.78rem;color:var(--warm-gray-light);margin:0 0 12px;">Sub-assembly cost = sub-recipe total cost (no markup compounding). Max nesting depth ' + SUB_ASSEMBLY_MAX_DEPTH + '.</p>';
      }
    }

    html += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">';
    html += '<button class="btn btn-secondary" onclick="makerCloseAddPartModal()">Cancel</button>';
    var canAdd = (addPartKind === 'material' && activeMaterials.length > 0) || (addPartKind === 'recipe' && eligibleRecipes.length > 0);
    if (canAdd) {
      html += '<button class="btn btn-primary" onclick="makerConfirmAddPart()">Add Part</button>';
    }
    html += '</div>';

    html += '</div></div>';

    var container = document.createElement('div');
    container.id = 'addPartContainer';
    container.innerHTML = html;
    document.body.appendChild(container);
  }

  function closeAddPartModal(event) {
    if (event && event.target && event.target.id !== 'addPartOverlay') return;
    var container = document.getElementById('addPartContainer');
    if (container) container.remove();
  }

  function confirmAddPart() {
    var qty = parseFloat(document.getElementById('addPartQty').value) || 0;
    if (qty <= 0) {
      MastAdmin.showToast('Quantity must be greater than 0', true);
      return;
    }

    var liId = 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    var lineItems = materializeLineItems(builderState, currentVariantId || 'default');
    var target = { lineItems: lineItems };

    if (addPartKind === 'recipe') {
      var recipeId = document.getElementById('addPartRecipeId').value;
      if (!recipeId) {
        MastAdmin.showToast('Select a sub-recipe', true);
        return;
      }
      // Final cycle pre-check (defensive — selector already filters)
      if (editingRecipeId && wouldCreateCycle(editingRecipeId, recipeId)) {
        MastAdmin.showToast('Cannot add — would create a cycle', true);
        return;
      }
      var sub = recipesData[recipeId];
      if (!sub) return;
      target.lineItems[liId] = {
        lineItemId: liId,
        kind: 'recipe',
        materialId: recipeId, // stores sub-recipe id
        materialName: sub.name || 'Sub-recipe',
        quantity: qty,
        unitOfMeasure: 'each',
        unitCost: sub.totalCost || 0,
        extendedCost: roundCents(qty * (sub.totalCost || 0))
      };
    } else {
      var matId = document.getElementById('addPartMaterialId').value;
      if (!matId) {
        MastAdmin.showToast('Select a material', true);
        return;
      }
      var material = materialsData[matId];
      if (!material) return;
      target.lineItems[liId] = {
        lineItemId: liId,
        kind: 'material',
        materialId: matId,
        materialName: material.name,
        quantity: qty,
        unitOfMeasure: material.unitOfMeasure,
        unitCost: material.unitCost,
        extendedCost: roundCents(qty * material.unitCost)
      };
    }

    closeAddPartModal();
    renderRecipeBuilder();
  }

  // ============================================================
  // Window Exports — for console testing and onclick handlers
  // ============================================================

  // Calculation engine
  window.makerCalculateRecipe = calculateRecipe;

  // Materials CRUD
  window.makerCreateMaterial = createMaterial;
  window.makerUpdateMaterial = updateMaterial;
  window.makerArchiveMaterial = archiveMaterial;

  // Materials UI
  window.makerOpenAddMaterial = function() { openMaterialModal(null); };
  window.makerEditMaterial = function(id) { openMaterialModal(id); };
  window.makerCloseMaterialModal = closeMaterialModal;
  window.makerSaveMaterialForm = saveMaterialForm;
  window.makerToggleSpotFields = function() {
    var checked = (document.getElementById('matPricingSpot') || {}).checked;
    var fields = document.getElementById('matSpotFields');
    if (fields) fields.style.display = checked ? 'flex' : 'none';
  };

  // Phase 2A gap: refresh spot prices via tenant MCP / Cloud Function flow.
  // Reads admin/spotPrices/current after the fetch completes.
  window.makerRefreshSpotPrices = async function() {
    var btn = document.getElementById('spotRefreshBtn');
    if (btn) { btn.disabled = true; btn.textContent = '⌛ Fetching…'; }
    try {
      // The browser can't call the Cloud Function directly (auth-gated).
      // It calls a Firebase callable wrapper instead, which is a separate
      // hardening pass. For now, the daily cron + tenant MCP refresh tool
      // are the only paths. Surface the current snapshot from RTDB.
      var current = await MastDB.get('admin/spotPrices/current');
      var statusEl = document.getElementById('spotPriceStatusText');
      if (statusEl) {
        if (current && current.fetchedAt) {
          var when = new Date(current.fetchedAt).toLocaleString();
          statusEl.innerHTML = '🔗 Last spot fetch: <strong>' + when + '</strong> · '
            + 'Au $' + current.gold.toFixed(2) + '/oz · '
            + 'Ag $' + current.silver.toFixed(2) + '/oz · '
            + 'Pt $' + current.platinum.toFixed(2) + '/oz '
            + '<span style="opacity:0.6;">(' + (current.source || 'unknown') + ')</span>';
        } else {
          statusEl.textContent = 'No spot prices yet. Daily cron runs at 13:00 UTC. Use the tenant MCP refresh_spot_prices tool to trigger a manual fetch.';
        }
      }
      MastAdmin.showToast(current ? 'Spot prices loaded' : 'No spot prices yet');
    } catch (err) {
      MastAdmin.showToast('Spot fetch error: ' + err.message, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '↻ Refresh Spot'; }
    }
  };

  // Auto-load spot status when materials tab renders (and spot materials exist)
  var _origRenderMaterials = renderMaterials;
  renderMaterials = function() {
    _origRenderMaterials();
    setTimeout(function() {
      if (document.getElementById('spotPriceStatusText')) {
        window.makerRefreshSpotPrices();
      }
    }, 0);
  };
  window.makerArchiveMaterialConfirm = archiveMaterialConfirm;
  window.makerFilterMaterials = filterMaterials;
  window.makerFilterMaterialsCategory = filterMaterialsCategory;
  window.makerAddCategoryPrompt = addCategoryPrompt;
  window.makerSelectCraftProfile = selectCraftProfile;

  // Recipes CRUD
  window.makerCreateRecipe = createRecipe;
  window.makerUpdateRecipe = updateRecipe;
  window.makerArchiveRecipe = archiveRecipe;
  window.makerRecalculateRecipe = recalculateRecipe;
  window.makerAddLineItem = addLineItem;
  window.makerRemoveLineItem = removeLineItem;

  // Pricing
  window.makerSetActivePriceTier = setActivePriceTier;

  // Pieces list & Recipe Builder UI
  window.makerOpenRecipeBuilder = openRecipeBuilder;
  // Checkpoint D — Define mode dispatch + VAR/Resell handlers
  window.makerOpenDefineForProduct = openDefineForProduct;
  window.makerCloseDefineView = closeDefineView;
  window.makerSaveDefineView = saveDefineView;
  window.makerRecalcCostShape = recalcCostShape;
  window.makerComputeCostShape = computeCostShape;
  window.makerVarAddComponent = varAddComponent;
  window.makerVarRemoveComponent = varRemoveComponent;
  window.makerVarSetComponentField = varSetComponentField;
  window.makerVarLinkMaterial = varLinkMaterial;
  window.makerVarAddStep = varAddStep;
  window.makerVarRemoveStep = varRemoveStep;
  window.makerVarSetStepField = varSetStepField;
  window.makerResellSet = resellSet;
  // Checkpoint E — Readiness checklist + state transitions
  window.makerComputeReadinessChecklist = computeReadinessChecklist;
  window.makerProductMarkupConfig = productMarkupConfig;
  window.makerPromoteToReady = promoteToReady;
  window.makerLaunchToActive = launchToActive;
  window.makerSetMarkup = setMarkup;
  window.makerScrollToReadinessSection = scrollToReadinessSection;
  window.productStatusBadgeHtml = productStatusBadgeHtml;
  window.makerRecomputeReadiness = recomputeAndPersistReadiness;
  // Checkpoint F — Rework patterns
  window.makerEnterRevisionMode = enterRevisionMode;
  window.makerSetPendingFieldValue = setPendingFieldValue;
  window.makerStagePendingChanges = stagePendingChanges;
  window.makerApplyPendingChanges = applyPendingChanges;
  window.makerDiscardPendingChanges = discardPendingChanges;
  window.makerCloneForRedesign = cloneProductForRedesign;
  window.makerFindChildVersion = findChildVersion;
  window.makerIsProductGuarded = isProductGuarded;
  window.makerIsFieldRevisionable = isFieldRevisionable;
  window.makerProductHeaderStatusLine = productHeaderStatusLine;
  window.makerRenderActiveProductActionBar = renderActiveProductActionBar;
  window.makerRenderRevisionBanner = renderRevisionBanner;
  window.makerRenderVersionLinkBanner = renderVersionLinkBanner;
  window.makerOpenProductDetail = openProductDetail;
  window.makerCloseRecipeBuilder = closeRecipeBuilder;
  window.makerCreateRecipeForProduct = createRecipeForProduct;
  window.makerCreateNewPiece = createNewPiece;
  window.makerCloseNewPieceModal = closeNewPieceModal;
  window.makerNewPieceCategoryChange = newPieceCategoryChange;
  window.makerSubmitNewPiece = submitNewPiece;
  window.makerSaveRecipeBuilder = saveRecipeBuilder;
  window.makerSaveAndRecalcRecipe = saveAndRecalcRecipe;
  window.makerRecalcAndRefresh = recalcAndRefresh;
  window.makerRecalcAllDirty = recalcAllDirty;
  window.makerDuplicateCurrentRecipe = duplicateCurrentRecipe;
  window.makerSetAddPartKind = setAddPartKind;
  window.makerApplyLandedCost = applyLandedCost;

  // Channels (1D)
  window.makerOpenChannelsManager = openChannelsManager;
  window.makerCloseChannelsManager = closeChannelsManager;
  window.makerCreateChannelFromForm = createChannelFromForm;
  window.makerEditChannelPrompt = editChannelPrompt;
  window.makerDeleteChannelConfirm = deleteChannelConfirm;
  window.makerGetChannelNetMargin = getChannelNetMargin;
  window.makerDetectChannelForOrder = detectChannelForOrder;
  window.makerLoadChannels = loadChannels;
  // Phase 6a.3: window.makerToggleChannel removed — see toggleChannel removal above.
  window.makerSetTierFromBuilder = setTierFromBuilder;
  window.makerRepriceNow = repriceNow;
  // Channel-First Phase 1c
  window.makerPublishRecipe = publishRecipe;
  // Phase 2d (D24) — Step 2 of the handshake; called from product detail banner.
  window.makerApplyRecipeToProduct = applyRecipeToProduct;
  window.makerPublishFromBuilder = publishFromBuilder;
  window.makerSetOverrideFromBuilder = setOverrideFromBuilder;
  window.makerEffectiveTierPrice = effectiveTierPrice;
  window.makerOpenWhatIfSimulator = openWhatIfSimulator;
  window.makerSetCategoryFilter = function(v) { piecesCategoryFilter = v || ''; renderPiecesList(); };
  window.makerPushVariantToAll = function() {
    if (!builderState || !currentVariantId || currentVariantId === 'default') return;
    var pvs = getProductVariants(builderState);
    if (pvs.length < 2) return;
    var src = builderState.variants && builderState.variants[currentVariantId];
    if (!src) return;
    var srcLabel = variantDisplayName(pvs.find(function(p){ return p.id === currentVariantId; }));
    var otherCount = pvs.length - 1;
    var msg = 'Copy Parts, Labor minutes, and Other Costs from "' + srcLabel + '" to the other ' + otherCount + ' variant' + (otherCount === 1 ? '' : 's') + '? Their current values will be overwritten.';
    window.mastConfirm(msg, { title: 'Apply to all variants', confirmLabel: 'Apply', cancelLabel: 'Cancel' }).then(function(ok) {
      if (!ok) return;
      pvs.forEach(function(pv) {
        if (pv.id === currentVariantId) return;
        if (!builderState.variants[pv.id]) builderState.variants[pv.id] = {};
        var dst = builderState.variants[pv.id];
        dst.lineItems = JSON.parse(JSON.stringify(src.lineItems || {}));
        dst.laborMinutes = src.laborMinutes || 0;
        dst.otherCost = src.otherCost || 0;
      });
      MastAdmin.showToast('Applied to ' + otherCount + ' variant' + (otherCount === 1 ? '' : 's') + '. Save and recalculate to propagate pricing.');
      renderRecipeBuilder();
    });
  };
  window.makerTogglePieceVariants = function(pid) {
    if (!pid) return;
    if (piecesExpandedPids[pid]) delete piecesExpandedPids[pid];
    else piecesExpandedPids[pid] = true;
    renderPiecesList();
  };
  window.makerCloseWhatIf = closeWhatIf;
  window.makerRunWhatIf = runWhatIfRender;
  window.makerOpenRepriceAllModal = openRepriceAllModal;
  window.makerCloseRepriceAll = closeRepriceAllModal;
  window.makerExecuteRepriceAll = executeRepriceAll;
  window.makerDeletePriceLockConfirm = deletePriceLockConfirm;
  window.makerUpdateBuilderField = updateBuilderField;
  window.makerUpdateLineItemQty = updateLineItemQty;
  window.makerUpdateLineItemScrap = updateLineItemScrap;
  window.makerRemoveLineItemUI = removeLineItemUI;
  window.makerOpenAddPartModal = openAddPartModal;
  window.makerCloseAddPartModal = closeAddPartModal;
  window.makerConfirmAddPart = confirmAddPart;

  // Variants (cost-shape model — keyed by productVariantId, with 'default' inheritance template)
  window.makerSwitchVariant = function(key) {
    currentVariantId = key || 'default';
    renderRecipeBuilder();
  };
  window.makerAddVariantTab = function(productVariantId) {
    if (!builderState || !productVariantId) return;
    ensureVariantSlot(builderState, productVariantId); // empty override = inherits from default
    currentVariantId = productVariantId;
    renderRecipeBuilder();
  };
  window.makerResetVariantToDefault = function(key) {
    if (!builderState || !key || key === 'default') return;
    if (!builderState.variants || !builderState.variants[key]) return;
    builderState.variants[key] = {}; // wipe overrides; tab stays, fully inherited
    renderRecipeBuilder();
  };
  window.makerRemoveOrphanVariant = function(key) {
    if (!builderState || !key || key === 'default') return;
    if (!builderState.variants) return;
    delete builderState.variants[key];
    currentVariantId = 'default';
    renderRecipeBuilder();
  };

  // Settings & Seeding
  window.makerGetSettings = getMakerSettings;
  window.makerSaveSettings = saveMakerSettings;
  window.makerSeedMaterials = seedMaterials;
  window.makerResetOnboarding = resetOnboarding;
  window.makerResetOnboardingUI = async function() {
    if (!await mastConfirm('This will clear your craft profile and remove all seeded draft materials. Continue?', { title: 'Reset Onboarding', danger: true })) return;
    try {
      await resetOnboarding();
      renderMaterials();
      checkMakerOnboarding();
    } catch (err) {
      MastAdmin.showToast('Error resetting: ' + err.message, true);
    }
  };

  // Data access (for console inspection)
  window.makerGetMaterials = function() { return materialsData; };
  window.makerGetRecipes = function() { return recipesData; };
  window.makerGetCraftProfiles = function() { return CRAFT_PROFILES; };
  window.makerGetUomOptions = function() { return UOM_OPTIONS; };

  // ============================================================
  // CSV Import Wizard
  // ============================================================

  var importState = null; // { type, step, parsedData, headers, mappings, filename }

  var MATERIALS_FIELDS = [
    { key: 'name', label: 'Name', required: true, autoMatch: ['name', 'material', 'item', 'description'] },
    { key: 'unitCost', label: 'Unit Cost', required: true, type: 'number', autoMatch: ['cost', 'unit cost', 'price', 'unit price'] },
    { key: 'unitOfMeasure', label: 'Unit of Measure', required: true, autoMatch: ['uom', 'unit', 'unit of measure', 'measure'] },
    { key: 'category', label: 'Category', required: false, autoMatch: ['category', 'type', 'group'] },
    { key: 'onHandQty', label: 'On Hand Qty', required: false, type: 'number', autoMatch: ['qty', 'quantity', 'on hand', 'stock', 'inventory'] },
    { key: 'reorderThreshold', label: 'Reorder Threshold', required: false, type: 'number', autoMatch: ['reorder', 'threshold', 'min qty'] },
    { key: 'notes', label: 'Notes', required: false, autoMatch: ['notes', 'note', 'comments'] }
  ];

  var PRODUCTS_FIELDS = [
    { key: 'name', label: 'Name', required: true, autoMatch: ['name', 'product', 'title', 'item'] },
    { key: 'price', label: 'Price ($)', required: true, type: 'number', autoMatch: ['price', 'retail', 'retail price', 'cost'] },
    { key: 'category', label: 'Category', required: false, autoMatch: ['category', 'type', 'collection'] },
    { key: 'description', label: 'Description', required: false, autoMatch: ['description', 'desc', 'details'] },
    { key: 'pid', label: 'SKU / Piece ID', required: false, autoMatch: ['sku', 'id', 'pid', 'piece id', 'item id'] },
    { key: 'status', label: 'Status', required: false, autoMatch: ['status', 'state'] }
  ];

  function openImport(type) {
    importState = {
      type: type,
      step: 1,
      parsedData: null,
      headers: [],
      mappings: {},
      filename: '',
      defaultUom: '',
      defaultCategory: ''
    };
    renderImportWizard();
  }

  function closeImport() {
    var type = importState && importState.type;
    importState = null;
    // Route back to whichever tab opened the wizard, not whichever happens
    // to be the default piecesView state.
    if (type === 'materials') {
      renderMaterials();
    } else if (type === 'products') {
      if (piecesView === 'builder') renderRecipeBuilder();
      else renderPiecesList();
    } else {
      renderMaterials();
    }
  }

  function autoDetectMappings(headers, fields) {
    var mappings = {};
    fields.forEach(function(field) {
      for (var i = 0; i < headers.length; i++) {
        var h = (headers[i] || '').toLowerCase().trim();
        if (field.autoMatch.indexOf(h) >= 0) {
          mappings[field.key] = i;
          break;
        }
      }
    });
    return mappings;
  }

  function sanitizeString(s) {
    if (!s) return '';
    return String(s).replace(/<[^>]*>/g, '').trim();
  }

  function parseFileInput(fileInput) {
    var file = fileInput.files[0];
    if (!file) return;

    // Validate size
    if (file.size > 5 * 1024 * 1024) {
      showToast('File must be under 5MB', 'error');
      return;
    }

    importState.filename = file.name;

    var ext = file.name.split('.').pop().toLowerCase();
    if (['xlsx', 'xls'].indexOf(ext) >= 0) {
      // SheetJS for Excel
      var reader = new FileReader();
      reader.onload = function(e) {
        try {
          var wb = XLSX.read(e.target.result, { type: 'array' });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          if (data.length < 2) { showToast('File has no data rows', 'error'); return; }
          importState.headers = data[0].map(function(h) { return String(h); });
          importState.parsedData = data.slice(1).filter(function(row) {
            return row.some(function(cell) { return cell !== ''; });
          });
          if (importState.parsedData.length > 1000) {
            showToast('Max 1,000 rows allowed. File has ' + importState.parsedData.length, 'error');
            return;
          }
          var fields = importState.type === 'materials' ? MATERIALS_FIELDS : PRODUCTS_FIELDS;
          importState.mappings = autoDetectMappings(importState.headers, fields);
          renderImportWizard();
        } catch (err) {
          showToast('Failed to parse file: ' + err.message, 'error');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      // PapaParse for CSV
      Papa.parse(file, {
        complete: function(results) {
          if (!results.data || results.data.length < 2) { showToast('File has no data rows', 'error'); return; }
          importState.headers = results.data[0].map(function(h) { return String(h); });
          importState.parsedData = results.data.slice(1).filter(function(row) {
            return row.some(function(cell) { return cell !== ''; });
          });
          if (importState.parsedData.length > 1000) {
            showToast('Max 1,000 rows allowed. File has ' + importState.parsedData.length, 'error');
            return;
          }
          var fields = importState.type === 'materials' ? MATERIALS_FIELDS : PRODUCTS_FIELDS;
          importState.mappings = autoDetectMappings(importState.headers, fields);
          renderImportWizard();
        },
        error: function(err) { showToast('Failed to parse CSV: ' + err.message, 'error'); }
      });
    }
  }

  function renderImportWizard() {
    var tab = importState.type === 'materials' ? document.getElementById('materialsTab') : document.getElementById('piecesTab');
    if (!tab || !importState) return;
    var esc = MastAdmin.esc;
    var step = importState.step;
    var typeLabel = importState.type === 'materials' ? 'Materials' : 'Products';

    var html = '<button class="detail-back" onclick="makerCloseImport()">← Back to ' + typeLabel + '</button>';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0 0 8px;">Import ' + typeLabel + '</h3>';

    // Step indicator
    html += '<div style="display:flex;gap:4px;margin-bottom:20px;">';
    for (var s = 1; s <= 3; s++) {
      var bg = s === step ? 'var(--amber)' : (s < step ? 'var(--teal)' : 'var(--cream-dark)');
      html += '<div style="flex:1;height:4px;border-radius:2px;background:' + bg + ';"></div>';
    }
    html += '</div>';

    if (step === 1) html += renderImportStep1(esc);
    else if (step === 2) html += renderImportStep2(esc);
    else if (step === 3) html += renderImportStep3(esc);

    tab.innerHTML = html;
  }

  function renderImportStep1(esc) {
    var html = '<div style="max-width:640px;">';
    html += '<div style="font-size:1rem;font-weight:500;margin-bottom:12px;">Step 1: Upload File</div>';
    html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Upload a .csv or .xlsx file. Max 5MB, 1,000 rows.</div>';
    html += '<div style="border:2px dashed var(--cream-dark);border-radius:8px;padding:30px;text-align:center;">';
    html += '<input type="file" accept=".csv,.xlsx,.xls" onchange="makerParseFile(this)" style="font-family:\'DM Sans\';font-size:0.9rem;">';
    html += '</div>';

    if (importState.parsedData) {
      html += '<div style="margin-top:16px;font-size:0.85rem;color:var(--teal);font-weight:500;">' +
        esc(importState.filename) + ' — ' + importState.parsedData.length + ' rows, ' + importState.headers.length + ' columns</div>';

      // Preview first 5 rows
      html += '<div style="overflow-x:auto;margin-top:12px;">';
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;">';
      html += '<thead><tr>';
      importState.headers.forEach(function(h) {
        html += '<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--cream-dark);font-weight:600;white-space:nowrap;">' + esc(h) + '</th>';
      });
      html += '</tr></thead><tbody>';
      importState.parsedData.slice(0, 5).forEach(function(row) {
        html += '<tr>';
        importState.headers.forEach(function(h, i) {
          html += '<td style="padding:4px 8px;border-bottom:1px solid var(--cream-dark);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;">' + esc(String(row[i] || '')) + '</td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table></div>';

      html += '<div style="text-align:right;margin-top:16px;">';
      html += '<button class="btn btn-primary" onclick="makerImportNextStep()">Continue</button>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  function renderImportStep2(esc) {
    var fields = importState.type === 'materials' ? MATERIALS_FIELDS : PRODUCTS_FIELDS;
    var html = '<div style="max-width:640px;">';
    html += '<div style="font-size:1rem;font-weight:500;margin-bottom:12px;">Step 2: Map Columns</div>';
    html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">Match your file columns to Mast fields. Auto-detected matches are highlighted.</div>';

    fields.forEach(function(field) {
      var mapped = importState.mappings[field.key];
      var isAutoMapped = mapped !== undefined;
      html += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;padding:8px 12px;border-radius:6px;background:' + (isAutoMapped ? 'rgba(42,124,111,0.06)' : 'transparent') + ';">';
      html += '<div style="min-width:140px;font-size:0.85rem;font-weight:500;">' + field.label + (field.required ? ' *' : '') + '</div>';
      html += '<select data-field="' + field.key + '" onchange="makerUpdateMapping(\'' + field.key + '\', this.value)" style="flex:1;padding:7px 10px;border:1px solid ' + (isAutoMapped ? 'var(--teal)' : '#ddd') + ';border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;">';
      html += '<option value="">— Don\'t import —</option>';
      importState.headers.forEach(function(h, i) {
        html += '<option value="' + i + '"' + (mapped === i ? ' selected' : '') + '>' + esc(h) + '</option>';
      });
      html += '</select>';
      html += '</div>';
    });

    // UOM default (materials only)
    if (importState.type === 'materials') {
      html += '<div style="margin-top:16px;padding:12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;">';
      html += '<div style="font-size:0.85rem;font-weight:500;margin-bottom:8px;">Default Unit of Measure (if not mapped)</div>';
      html += '<select onchange="makerSetImportDefault(\'defaultUom\', this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;">';
      html += '<option value="">—</option>';
      UOM_OPTIONS.forEach(function(u) {
        html += '<option value="' + u.value + '"' + (importState.defaultUom === u.value ? ' selected' : '') + '>' + esc(u.label) + '</option>';
      });
      html += '</select></div>';
    }

    // Default category
    html += '<div style="margin-top:12px;padding:12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;">';
    html += '<div style="font-size:0.85rem;font-weight:500;margin-bottom:8px;">Default Category (if not mapped)</div>';
    html += '<input type="text" value="' + esc(importState.defaultCategory || '') + '" placeholder="e.g. Imported" onchange="makerSetImportDefault(\'defaultCategory\', this.value)" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;">';
    html += '</div>';

    html += '<div style="display:flex;justify-content:space-between;margin-top:20px;">';
    html += '<button class="btn btn-secondary" onclick="makerImportPrevStep()">← Back</button>';
    html += '<button class="btn btn-primary" onclick="makerImportNextStep()">Continue</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function renderImportStep3(esc) {
    var fields = importState.type === 'materials' ? MATERIALS_FIELDS : PRODUCTS_FIELDS;
    var rows = importState.parsedData || [];
    var validRows = [];
    var invalidRows = [];

    rows.forEach(function(row, idx) {
      var record = mapRow(row, fields);
      if (record._valid) validRows.push({ row: row, record: record, idx: idx });
      else invalidRows.push({ row: row, record: record, idx: idx });
    });

    var html = '<div style="max-width:800px;">';
    html += '<div style="font-size:1rem;font-weight:500;margin-bottom:12px;">Step 3: Preview & Confirm</div>';
    html += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">' +
      validRows.length + ' valid rows ready, ' + invalidRows.length + ' will be skipped.</div>';

    if (invalidRows.length > 0) {
      html += '<div style="background:rgba(220,53,69,0.08);border:1px solid rgba(220,53,69,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:0.85rem;color:var(--danger);">' +
        invalidRows.length + ' rows missing required fields will be skipped.</div>';
    }

    // Preview table (first 10 valid rows)
    var previewFields = fields.filter(function(f) { return importState.mappings[f.key] !== undefined || f.required; });
    html += '<div style="overflow-x:auto;margin-bottom:16px;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
    html += '<thead><tr>';
    previewFields.forEach(function(f) {
      html += '<th style="padding:6px 8px;text-align:left;border-bottom:2px solid var(--cream-dark);font-weight:600;font-size:0.72rem;text-transform:uppercase;">' + f.label + '</th>';
    });
    html += '</tr></thead><tbody>';
    validRows.slice(0, 10).forEach(function(item) {
      html += '<tr>';
      previewFields.forEach(function(f) {
        html += '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(String(item.record[f.key] || '')) + '</td>';
      });
      html += '</tr>';
    });
    if (validRows.length > 10) {
      html += '<tr><td colspan="' + previewFields.length + '" style="padding:8px;text-align:center;color:var(--warm-gray-light);font-style:italic;">... and ' + (validRows.length - 10) + ' more rows</td></tr>';
    }
    html += '</tbody></table></div>';

    html += '<div id="importProgress" style="display:none;text-align:center;padding:20px;">';
    html += '<div class="loading">Importing...</div>';
    html += '</div>';

    html += '<div id="importActions" style="display:flex;justify-content:space-between;margin-top:20px;">';
    html += '<button class="btn btn-secondary" onclick="makerImportPrevStep()">← Back</button>';
    html += '<button class="btn btn-primary" id="importBtn" onclick="makerRunImport()">Import ' + validRows.length + ' ' + (importState.type === 'materials' ? 'materials' : 'products') + '</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }

  function mapRow(row, fields) {
    var record = { _valid: true };
    fields.forEach(function(field) {
      var colIdx = importState.mappings[field.key];
      var val = colIdx !== undefined ? row[colIdx] : undefined;

      if (val !== undefined && val !== null && val !== '') {
        val = sanitizeString(String(val));
        if (field.type === 'number') {
          val = parseFloat(String(val).replace(/[^0-9.\-]/g, ''));
          if (isNaN(val) || val < 0) val = undefined;
          if (field.key === 'unitCost' && val > 99999) val = undefined;
        }
      } else {
        val = undefined;
      }

      // Apply defaults
      if (val === undefined && field.key === 'unitOfMeasure' && importState.defaultUom) {
        val = importState.defaultUom;
      }
      if (val === undefined && field.key === 'category' && importState.defaultCategory) {
        val = importState.defaultCategory;
      }

      if (val === undefined && field.required) {
        record._valid = false;
      }
      record[field.key] = val;
    });
    return record;
  }

  async function runImport() {
    var fields = importState.type === 'materials' ? MATERIALS_FIELDS : PRODUCTS_FIELDS;
    var rows = importState.parsedData || [];
    var imported = 0;
    var skipped = 0;
    var now = new Date().toISOString();

    // Show progress
    var progress = document.getElementById('importProgress');
    var actions = document.getElementById('importActions');
    if (progress) progress.style.display = '';
    if (actions) actions.style.display = 'none';

    for (var i = 0; i < rows.length; i++) {
      var record = mapRow(rows[i], fields);
      if (!record._valid) { skipped++; continue; }

      try {
        if (importState.type === 'materials') {
          var matId = MastDB.materials.newKey();
          await MastDB.materials.set(matId, {
            materialId: matId,
            name: record.name,
            category: record.category || 'Imported',
            unitOfMeasure: record.unitOfMeasure || 'each',
            unitCost: record.unitCost || 0,
            onHandQty: record.onHandQty || 0,
            reorderThreshold: record.reorderThreshold || 0,
            notes: record.notes || '',
            status: 'draft',
            importedFrom: 'csv',
            createdAt: now,
            updatedAt: now
          });
        } else {
          var pid = record.pid ? sanitizeString(record.pid) : ('p' + Date.now().toString(36) + i);
          var priceCents = record.price ? Math.round(record.price * 100) : 0;
          await MastDB.products.set(pid, {
            pid: pid,
            name: record.name,
            description: record.description || '',
            categories: record.category ? [record.category] : [],
            priceCents: priceCents,
            price: priceCents > 0 ? '$' + (priceCents / 100).toFixed(2) : '',
            status: record.status || 'draft',
            availability: 'available',
            images: [],
            imageIds: [],
            url: '',
            options: [],
            importedFrom: 'csv',
            createdAt: now,
            updatedAt: now
          });
          writeAudit('create', 'products', pid);
        }
        imported++;
      } catch (err) {
        console.error('Import row ' + i + ' failed:', err);
        skipped++;
      }
    }

    // Log the import
    var logId = MastDB.importLog.newKey();
    await MastDB.importLog.set(logId, {
      importId: logId,
      type: importState.type,
      filename: importState.filename,
      rowsAttempted: rows.length,
      rowsImported: imported,
      rowsSkipped: skipped,
      importedAt: now,
      importedBy: auth.currentUser ? auth.currentUser.uid : 'unknown'
    });

    // Show completion
    var tab = importState.type === 'materials' ? document.getElementById('materialsTab') : document.getElementById('piecesTab');
    if (tab) {
      tab.innerHTML =
        '<div style="text-align:center;padding:40px 20px;">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">✅</div>' +
          '<p style="font-size:1.15rem;font-weight:500;margin-bottom:8px;">Import Complete</p>' +
          '<p style="font-size:0.9rem;color:var(--warm-gray);">' + imported + ' ' + importState.type + ' imported, ' + skipped + ' skipped.</p>' +
          '<button class="btn btn-primary" style="margin-top:20px;" onclick="makerCloseImport()">View ' + (importState.type === 'materials' ? 'Materials' : 'Pieces') + '</button>' +
        '</div>';
    }

    // Reload data
    if (importState.type === 'materials') {
      materialsLoaded = false;
    } else {
      window.productsLoaded = false;
    }
  }

  // Import wizard window functions
  window.makerOpenImport = openImport;
  window.makerCloseImport = closeImport;
  window.makerParseFile = parseFileInput;
  window.makerImportNextStep = function() {
    if (!importState) return;
    if (importState.step === 1 && !importState.parsedData) {
      showToast('Upload a file first', 'error');
      return;
    }
    if (importState.step === 2) {
      // Validate required mappings
      var fields = importState.type === 'materials' ? MATERIALS_FIELDS : PRODUCTS_FIELDS;
      var missing = fields.filter(function(f) {
        if (!f.required) return false;
        if (importState.mappings[f.key] !== undefined) return false;
        // UOM can use default
        if (f.key === 'unitOfMeasure' && importState.defaultUom) return false;
        return true;
      });
      if (missing.length > 0) {
        showToast('Map required fields: ' + missing.map(function(f) { return f.label; }).join(', '), 'error');
        return;
      }
    }
    importState.step = Math.min(3, importState.step + 1);
    renderImportWizard();
  };
  window.makerImportPrevStep = function() {
    if (!importState) return;
    importState.step = Math.max(1, importState.step - 1);
    renderImportWizard();
  };
  window.makerUpdateMapping = function(fieldKey, colIdx) {
    if (!importState) return;
    if (colIdx === '') delete importState.mappings[fieldKey];
    else importState.mappings[fieldKey] = parseInt(colIdx);
  };
  window.makerSetImportDefault = function(key, value) {
    if (!importState) return;
    importState[key] = value;
  };
  window.makerRunImport = runImport;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  // MastNavStack restorer for the pieces (recipes) route — re-opens
  // a recipe builder when popping back from a cross-module navigation.
  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('pieces', function(view, state) {
      if (view !== 'detail' || !state || !state.recipeId) return;
      var openIt = function() {
        if (recipesData[state.recipeId]) openRecipeBuilder(state.recipeId);
      };
      if (!recipesLoaded) {
        var tries = 0;
        var iv = setInterval(function() {
          if (recipesLoaded || tries++ > 25) { clearInterval(iv); openIt(); }
        }, 100);
      } else openIt();
    });
  }

  MastAdmin.registerModule('maker', {
    routes: {
      'materials': { tab: 'materialsTab', setup: function() {
        loadMaterials();
        checkMakerOnboarding();
      } },
      'pieces': { tab: 'piecesTab', setup: function() {
        loadMaterials(); // needed for recipe builder
        loadRecipes();
        // Ensure products are loaded (global from core)
        if (!window.productsLoaded && typeof window.loadProducts === 'function') {
          window.loadProducts();
        }
      } }
    },
    detachListeners: function() {
      unloadMaterials();
      unloadRecipes();
    }
  });

})();
