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
        MastDB.ref('admin/config/makerSettings/repricingThresholdPct').once('value'),
        MastDB.ref('admin/priceLocks').once('value'),
        MastDB.ref('admin/spotPrices/current').once('value')
      ]);
      var t = snaps[0].val();
      if (typeof t === 'number') repricingThresholdPct = t;
      priceLocksData = snaps[1].val() || {};
      spotPricesCurrent = snaps[2].val() || null;
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
      retailMarginPct: pct(retailPrice)
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
    if (materialsListener) return;
    materialsListener = MastDB.materials.listen(500, function(snap) {
      materialsData = snap.val() || {};
      materialsLoaded = true;
      renderMaterials();
    });
    loadVolatilePricingData();
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
    if (recipesListener) return;
    recipesListener = MastDB.recipes.listen(200, function(snap) {
      recipesData = snap.val() || {};
      recipesLoaded = true;
      renderPieces();
    });
    // Phase 2A-2E: warm up volatile pricing state on first load
    loadVolatilePricingData();
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
          retailPrice: vCalc.retailPrice
        });
      });
      updates.variants = variantUpdates;
    }

    await MastDB.recipes.update(recipeId, updates);

    // Propagate price to product if activePriceTier is set
    if (recipe.activePriceTier && recipe.productId) {
      var tierPrice;
      if (recipe.isVariantEnabled && updates.variants) {
        tierPrice = getFirstVariantTierPrice(recipe.activePriceTier, { variants: updates.variants });
      } else {
        tierPrice = getTierPrice(recipe.activePriceTier, updates);
      }
      await propagatePriceToProduct(recipe.productId, tierPrice);
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

    var liId = MastDB._newKey('admin/recipes/' + recipeId + '/lineItems');
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
      var snap = await MastDB.recipes.list(200);
      recipesData = snap.val() || {};
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
      await MastDB._multiUpdate(updates);
      var count = Object.keys(updates).length / 2; // each recipe has 2 update fields
      MastAdmin.showToast(count + ' recipe' + (count === 1 ? '' : 's') + ' flagged for recalculation');
    }
  }

  // ============================================================
  // activePriceTier → product.priceCents Propagation
  // ============================================================

  /**
   * Set the active price tier on a recipe and propagate price to the product.
   */
  async function setActivePriceTier(recipeId, tier) {
    var recipe = recipesData[recipeId];
    if (!recipe) throw new Error('Recipe not found: ' + recipeId);
    if (!['wholesale', 'direct', 'retail'].includes(tier)) {
      throw new Error('Invalid tier: ' + tier + '. Must be wholesale, direct, or retail.');
    }

    var tierPrice;
    if (recipe.isVariantEnabled && recipe.variants) {
      tierPrice = getFirstVariantTierPrice(tier, recipe);
    } else {
      tierPrice = getTierPrice(tier, recipe);
    }
    var now = new Date().toISOString();

    // Atomic multi-path update: recipe tier + product price
    var updates = {};
    updates['admin/recipes/' + recipeId + '/activePriceTier'] = tier;
    updates['admin/recipes/' + recipeId + '/updatedAt'] = now;
    // Phase 2C.1: snapshot drift baseline + reset drift
    updates['admin/recipes/' + recipeId + '/driftBaseline'] = recipe.totalCost || 0;
    updates['admin/recipes/' + recipeId + '/lastPropagatedAt'] = now;
    updates['admin/recipes/' + recipeId + '/currentDriftPct'] = 0;

    var priceCents = null;
    if (recipe.productId) {
      priceCents = Math.round(tierPrice * 100);
      updates['public/products/' + recipe.productId + '/priceCents'] = priceCents;
      updates['public/products/' + recipe.productId + '/price'] = tierPrice;
    }

    await MastDB._multiUpdate(updates);
    MastAdmin.writeAudit('set-price-tier', 'recipe', recipeId);

    // Etsy price sync (fire-and-forget — local update is authoritative)
    if (recipe.productId && priceCents !== null) {
      syncEtsyListingPrice(recipe.productId, priceCents, recipeId);
    }

    return { tier: tier, price: tierPrice };
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
    await MastDB._multiUpdate(updates);
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
  // Variant Helpers
  // ============================================================

  /**
   * Get the active editable data source — either the root recipe or the current variant.
   */
  function getActiveVariantData(bs) {
    if (bs.isVariantEnabled && currentVariantId && bs.variants && bs.variants[currentVariantId]) {
      return bs.variants[currentVariantId];
    }
    return bs;
  }

  /**
   * Calculate all variants and return array of results.
   */
  function calculateAllVariants(recipe) {
    var variants = recipe.variants || {};
    var results = {};
    Object.keys(variants).forEach(function(vid) {
      var v = variants[vid];
      var calc = calculateRecipe({
        lineItems: v.lineItems || {},
        laborRatePerHour: recipe.laborRatePerHour || 0,
        laborMinutes: v.laborMinutes || 0,
        otherCost: v.otherCost || 0,
        setupCost: recipe.setupCost || 0,
        batchSize: recipe.batchSize || 1,
        wholesaleMarkup: recipe.wholesaleMarkup || 1,
        directMarkup: recipe.directMarkup || 1,
        retailMarkup: recipe.retailMarkup || 1
      });
      results[vid] = calc;
    });
    return results;
  }

  /**
   * Get the first variant's price for a given tier (used for product propagation).
   */
  function getFirstVariantTierPrice(tier, recipe) {
    var variants = recipe.variants || {};
    var keys = Object.keys(variants);
    if (keys.length === 0) return 0;
    var first = variants[keys[0]];
    var priceKey = tier + 'Price';
    return first[priceKey] || 0;
  }

  function createVariant(label) {
    var id = MastDB.recipes.newKey();
    return {
      variantId: id,
      label: label || 'Variant',
      lineItems: {},
      laborMinutes: 0,
      otherCost: 0,
      totalMaterialCost: 0,
      totalCost: 0,
      wholesalePrice: 0,
      directPrice: 0,
      retailPrice: 0
    };
  }

  // ============================================================
  // Maker Settings
  // ============================================================

  // ============================================================
  // Channel Fee Profiles — admin/channels/{channelId}
  // ============================================================

  var channelsData = {};
  var channelsLoaded = false;

  function channelsRef(id) {
    return MastDB._ref('admin/channels' + (id ? '/' + id : ''));
  }

  async function loadChannels() {
    var snap = await channelsRef().once('value');
    channelsData = snap.val() || {};
    channelsLoaded = true;
    return channelsData;
  }

  async function createChannel(data) {
    var id = channelsRef().push().key;
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
    await channelsRef(id).set(channel);
    channelsData[id] = channel;
    MastAdmin.writeAudit('create', 'channel', id);
    return channel;
  }

  async function updateChannel(id, updates) {
    updates.updatedAt = new Date().toISOString();
    await channelsRef(id).update(updates);
    if (channelsData[id]) Object.assign(channelsData[id], updates);
    MastAdmin.writeAudit('update', 'channel', id);
  }

  async function deleteChannel(id) {
    await channelsRef(id).remove();
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
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.3rem;font-weight:500;margin:0;">Sales Channels</h3>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerCloseChannelsManager()">Close</button>';
    html += '</div>';
    html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 14px;">Define each channel\'s fee structure once. Order margin reports will subtract fees to show true net profit. Auto-match links a channel to orders coming in from a specific source (etsy, shopify, in-person, etc.).</p>';

    if (ids.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);text-align:center;padding:20px;font-style:italic;">No channels defined yet.</p>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;margin-bottom:14px;">';
      html += '<thead><tr style="border-bottom:1px solid var(--cream-dark);">';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.7rem;text-transform:uppercase;color:var(--warm-gray);">Channel</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.7rem;text-transform:uppercase;color:var(--warm-gray);">% fee</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.7rem;text-transform:uppercase;color:var(--warm-gray);">$/order</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.7rem;text-transform:uppercase;color:var(--warm-gray);">$/month</th>';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.7rem;text-transform:uppercase;color:var(--warm-gray);">Auto-match</th>';
      html += '<th style="width:80px;"></th>';
      html += '</tr></thead><tbody>';
      ids.forEach(function(cid) {
        var ch = channelsData[cid];
        html += '<tr>';
        html += '<td style="padding:8px;font-size:0.85rem;font-weight:500;border-bottom:1px solid var(--cream-dark);">' + esc(ch.name || '') + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.82rem;border-bottom:1px solid var(--cream-dark);">' + (ch.percentFee || 0).toFixed(2) + '%</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.82rem;border-bottom:1px solid var(--cream-dark);">$' + ((ch.fixedFeePerOrderCents || 0) / 100).toFixed(2) + '</td>';
        html += '<td style="text-align:right;padding:8px;font-family:monospace;font-size:0.82rem;border-bottom:1px solid var(--cream-dark);">$' + ((ch.monthlyFixedCents || 0) / 100).toFixed(2) + '</td>';
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
    html += '<input id="newChannelAutoMatch" type="text" placeholder="Auto-match sources (comma sep, e.g. etsy,etsy-mobile)" style="flex:1;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.82rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';">';
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
    var newName = prompt('Channel name:', ch.name || '');
    if (newName == null) return;
    var newPct = prompt('Percent fee (e.g. 6.5):', String(ch.percentFee || 0));
    if (newPct == null) return;
    var newFixed = prompt('Fixed fee per order ($):', String((ch.fixedFeePerOrderCents || 0) / 100));
    if (newFixed == null) return;
    var newMonthly = prompt('Monthly fixed cost ($):', String((ch.monthlyFixedCents || 0) / 100));
    if (newMonthly == null) return;
    var newAuto = prompt('Auto-match sources (comma sep):', (ch.autoMatchSources || []).join(','));
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
    if (!confirm('Delete channel "' + (ch.name || '') + '"? Existing orders that reference it will lose their fee profile.')) return;
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
    var materials = Object.values(materialsData);

    // Filter by status
    if (materialsFilter !== 'all') {
      materials = materials.filter(function(m) { return m.status === materialsFilter; });
    }

    // Filter by category
    if (materialsCategoryFilter !== 'all') {
      materials = materials.filter(function(m) { return m.category === materialsCategoryFilter; });
    }

    // Sort by name
    materials.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var categories = getMaterialCategories();
    var totalCount = Object.keys(materialsData).length;
    var activeCount = Object.values(materialsData).filter(function(m) { return m.status === 'active'; }).length;

    var html = '';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    html += '<div>';
    html += '<h2 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Materials</h2>';
    html += '<span style="font-size:0.82rem;color:var(--warm-gray);">' + activeCount + ' active of ' + totalCount + ' total</span>';
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

    // Filter pills
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">';
    ['active', 'draft', 'archived', 'all'].forEach(function(f) {
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
      html += '<div style="font-size:2rem;margin-bottom:12px;">🧱</div>';
      html += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No materials found</p>';
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
      html += '<tr>';
      var spotChip = m.pricingMode === 'spot-linked' ? ' <span style="display:inline-block;font-size:0.68rem;font-weight:500;padding:1px 6px;background:rgba(42,124,111,0.12);color:var(--teal);border-radius:8px;margin-left:4px;" title="Linked to ' + esc(m.spotMetal || 'metal') + ' spot price">🔗 ' + esc(m.spotMetal || 'spot') + '</span>' : '';
      html += '<td style="font-weight:500;">' + esc(m.name) + spotChip + '</td>';
      html += '<td>' + esc(m.category || '') + '</td>';
      html += '<td>' + esc(getUomShort(m.unitOfMeasure)) + '</td>';
      html += '<td style="text-align:right;font-family:monospace;">$' + (m.unitCost || 0).toFixed(2) + '</td>';
      html += '<td style="text-align:right;">' + (m.onHandQty || 0) + '</td>';
      html += '<td><span class="status-badge" style="' + materialStatusBadgeStyle(m.status) + '">' + esc(m.status || 'draft') + '</span></td>';
      html += '<td style="text-align:right;">';
      html += '<button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="makerEditMaterial(\'' + esc(id) + '\')">Edit</button>';
      if (m.status !== 'archived') {
        html += ' <button style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';margin-left:4px;" onclick="makerArchiveMaterialConfirm(\'' + esc(id) + '\')">Archive</button>';
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
      html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.3rem;font-weight:500;margin:0 0 8px;">🔒 Price Locks</h3>';
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
        html += '<td><span class="status-badge" style="background:' + statusBg + ';color:' + statusColor + ';font-size:0.7rem;padding:2px 7px;">' + l.liveStatus + '</span></td>';
        html += '<td style="text-align:right;">';
        html += '<button data-lid="' + esc(l.lockId) + '" style="background:none;border:none;color:var(--danger);cursor:pointer;font-size:0.8rem;font-family:\'DM Sans\';" onclick="makerDeletePriceLockConfirm(this.dataset.lid)">Delete</button>';
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
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.3rem;font-weight:500;margin:0 0 16px;">' + (isEdit ? 'Edit Material' : 'New Material') + '</h3>';

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
    html += '<div style="flex:1;"><label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:2px;">Metal</label>';
    html += '<select id="matSpotMetal" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;">';
    ['gold','silver','platinum'].forEach(function(mt) {
      var sel = m && m.spotMetal === mt ? ' selected' : '';
      html += '<option value="' + mt + '"' + sel + '>' + mt.charAt(0).toUpperCase() + mt.slice(1) + '</option>';
    });
    html += '</select></div>';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:2px;">Purity</label>';
    html += '<input id="matPurity" type="number" step="0.001" min="0" max="1" placeholder="e.g. 0.585 (14k)" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" value="' + (m && m.purity != null ? m.purity : '') + '"></div>';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:2px;">Markup %</label>';
    html += '<input id="matMarkupSpot" type="number" step="0.1" min="0" placeholder="e.g. 8" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" value="' + (m && m.markupOverSpot != null ? m.markupOverSpot : '') + '"></div>';
    html += '</div>';
    html += '<p style="font-size:0.72rem;color:var(--warm-gray);margin:8px 0 0;">Unit Cost auto-updates daily: spot × purity × (1 + markup%) ÷ unitConversion. Set purity (e.g. 0.999 fine, 0.925 sterling, 0.585 14k) and supplier markup.</p>';
    html += '</div>';

    // Landed cost helper — prorate freight $ across last purchase qty into unitCost
    html += '<details style="margin-bottom:16px;background:rgba(196,133,60,0.05);border:1px solid rgba(196,133,60,0.2);border-radius:6px;">';
    html += '<summary style="cursor:pointer;padding:8px 12px;font-size:0.82rem;font-weight:600;color:var(--amber);">+ Apply landed cost (freight, customs)</summary>';
    html += '<div style="padding:0 12px 12px;">';
    html += '<p style="font-size:0.75rem;color:var(--warm-gray);margin:6px 0 10px;">Add freight, customs, or supplier fees to your unit cost. Enter the extra charge and the qty it covers — we will prorate per unit and update Unit Cost above.</p>';
    html += '<div style="display:flex;gap:8px;align-items:flex-end;">';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:2px;">Extra charge ($)</label><input id="matLandedExtra" type="number" step="0.01" min="0" placeholder="e.g. 25.00" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;"></div>';
    html += '<div style="flex:1;"><label style="display:block;font-size:0.75rem;font-weight:600;margin-bottom:2px;">Qty covered</label><input id="matLandedQty" type="number" step="0.01" min="0" placeholder="e.g. 100" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:5px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;"></div>';
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
      if (!(purity > 0)) {
        MastAdmin.showToast('Purity is required for spot-linked materials (e.g. 0.585 for 14k)', true);
        return;
      }
      data.pricingMode = 'spot-linked';
      data.spotMetal = (document.getElementById('matSpotMetal') || {}).value || 'gold';
      data.purity = purity;
      data.markupOverSpot = isNaN(markupOverSpot) ? 0 : markupOverSpot;
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
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.2rem;font-weight:500;margin:0 0 8px;color:var(--teal-deep);">Welcome to Materials</h3>';
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
  var editingRecipeId = null;
  var builderState = null; // live state for the recipe builder
  var currentVariantId = null; // active variant tab (null = non-variant or default)

  function renderPieces() {
    if (piecesView === 'builder' && editingRecipeId) {
      renderRecipeBuilder();
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
    html += '<span style="font-size:0.82rem;color:var(--warm-gray);">' + products.length + ' products, ' + Object.keys(recipeByProduct).length + ' with recipes</span>';
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

    html += '<button class="btn btn-secondary btn-small" onclick="makerOpenWhatIfSimulator()" title="Simulate metals price shifts across all recipes">📊 What-if</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerOpenChannelsManager()" title="Manage sales channel fee profiles">Channels</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerOpenImport(\'products\')">Import CSV</button>';
    html += '</div>';
    html += '</div>';

    if (products.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      html += '<div style="font-size:2rem;margin-bottom:12px;">📦</div>';
      html += '<p style="font-size:0.95rem;font-weight:500;margin-bottom:4px;">No products yet</p>';
      html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add products first, then create recipes to calculate pricing.</p>';
      html += '</div>';
      tab.innerHTML = html;
      return;
    }

    // Table
    html += '<div class="data-table"><table><thead><tr>';
    html += '<th>Product</th>';
    html += '<th>Category</th>';
    html += '<th>Recipe</th>';
    html += '<th style="text-align:right;">Total Cost</th>';
    html += '<th>Active Tier</th>';
    html += '<th style="text-align:right;">Price</th>';
    html += '<th style="text-align:right;">Actions</th>';
    html += '</tr></thead><tbody>';

    products.forEach(function(p) {
      var pid = p.pid;
      var recipe = recipeByProduct[pid];
      var hasRecipe = !!recipe;

      html += '<tr>';
      html += '<td style="font-weight:500;">' + esc(p.name || '') + '</td>';
      html += '<td>' + esc((p.categories || []).join(', ')) + '</td>';

      if (hasRecipe) {
        var dirtyIcon = recipe.costsDirty ? ' <span title="Costs changed" style="color:#f59e0b;">⚠</span>' : '';
        html += '<td><span class="status-badge" style="' + materialStatusBadgeStyle('active') + '">has recipe</span>' + dirtyIcon + '</td>';
        html += '<td style="text-align:right;font-family:monospace;">$' + (recipe.totalCost || 0).toFixed(2) + '</td>';
        var etsyIcon = p.etsyListingId ? (recipe.lastEtsySyncAt ? ' <span title="Synced to Etsy" style="font-size:0.75rem;">🔗</span>' : ' <span title="Etsy listing linked" style="font-size:0.75rem;opacity:0.5;">🔗</span>') : '';
        var variantBadge = recipe.isVariantEnabled && recipe.variants ? ' <span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.65rem;">' + Object.keys(recipe.variants).length + ' variants</span>' : '';
        html += '<td><span class="status-badge pill" style="background:rgba(42,124,111,0.12);color:var(--teal);border:1px solid rgba(42,124,111,0.25);">' + esc(recipe.activePriceTier || 'none') + '</span>' + variantBadge + etsyIcon + '</td>';
        var activePrice;
        if (recipe.isVariantEnabled && recipe.variants) {
          activePrice = getFirstVariantTierPrice(recipe.activePriceTier, recipe);
        } else {
          activePrice = getTierPrice(recipe.activePriceTier, recipe);
        }
        html += '<td style="text-align:right;font-family:monospace;font-weight:600;">$' + activePrice.toFixed(2) + '</td>';
        html += '<td style="text-align:right;">';
        html += '<button style="background:none;border:none;color:var(--teal);cursor:pointer;font-size:0.85rem;font-family:\'DM Sans\';" onclick="makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\')">Edit Recipe</button>';
        html += '</td>';
      } else {
        html += '<td><span style="color:var(--warm-gray-light);font-size:0.82rem;">no recipe</span></td>';
        html += '<td style="text-align:right;">—</td>';
        html += '<td>—</td>';
        html += '<td style="text-align:right;font-family:monospace;">$' + (p.priceCents ? (p.priceCents / 100).toFixed(2) : (p.price || 0).toFixed(2)) + '</td>';
        html += '<td style="text-align:right;">';
        html += '<button class="btn btn-outline btn-small" data-pid="' + esc(pid) + '" data-name="' + esc(p.name || '') + '" onclick="makerCreateRecipeForProduct(this.dataset.pid, this.dataset.name)">+ Add Recipe</button>';
        html += '</td>';
      }

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    tab.innerHTML = html;
  }

  // ============================================================
  // Recipe Builder — "The Money Screen"
  // ============================================================

  async function openRecipeBuilder(recipeId) {
    var recipe = recipesData[recipeId];
    if (!recipe) {
      MastAdmin.showToast('Recipe not found', true);
      return;
    }

    // Ensure materials are loaded
    if (!materialsLoaded) {
      var snap = await MastDB.materials.list(500);
      materialsData = snap.val() || {};
      materialsLoaded = true;
    }

    // Initialize builder state from recipe
    builderState = JSON.parse(JSON.stringify(recipe));
    editingRecipeId = recipeId;
    piecesView = 'builder';
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

  function renderRecipeBuilder() {
    var tab = document.getElementById('piecesTab');
    if (!tab || !builderState) return;
    var esc = MastAdmin.esc;
    var bs = builderState;

    // Determine active data source (variant or root)
    var isVariant = bs.isVariantEnabled && bs.variants && Object.keys(bs.variants).length > 0;
    var activeData = isVariant ? getActiveVariantData(bs) : bs;

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
      html += '<button class="btn btn-primary btn-small" onclick="makerRepriceNow()" title="Recalculate + propagate to product price + reset baseline">↻ Reprice now</button>';
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
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.4rem;font-weight:500;margin:0;">' + esc(bs.name || 'Untitled Recipe') + '</h3>';
    html += '<span style="font-size:0.82rem;color:var(--warm-gray);">Recipe for product ' + esc(bs.productId || '') + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="makerDuplicateCurrentRecipe()" title="Clone this recipe as a new draft">Duplicate</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="makerSaveRecipeBuilder()">Save</button>';
    html += '<button class="btn btn-primary btn-small" onclick="makerSaveAndRecalcRecipe()">Save & Recalculate</button>';
    html += '</div>';
    html += '</div>';

    // ---- VARIANT TOGGLE ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">';
    html += '<div>';
    html += '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;font-weight:500;">';
    html += '<input type="checkbox" ' + (bs.isVariantEnabled ? 'checked' : '') + ' onchange="makerToggleVariants(this.checked)"> Enable Variants';
    html += '</label>';
    if (bs.isVariantEnabled) {
      html += '<div style="display:flex;gap:12px;margin-top:8px;">';
      html += '<select style="padding:5px 10px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';" onchange="makerUpdateBuilderField(\'variantDimension\', this.value)">';
      var dims = ['size', 'color', 'material', 'custom'];
      dims.forEach(function(d) {
        html += '<option value="' + d + '"' + (bs.variantDimension === d ? ' selected' : '') + '>' + d.charAt(0).toUpperCase() + d.slice(1) + '</option>';
      });
      html += '</select>';
      html += '<input type="text" value="' + esc(bs.variantLabel || '') + '" placeholder="Label (e.g. Size)" style="width:120px;padding:5px 10px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';" onchange="makerUpdateBuilderField(\'variantLabel\', this.value)">';
      html += '</div>';
    }
    html += '</div>';
    html += '</div>';

    // ---- VARIANT TABS ----
    if (isVariant) {
      var variantKeys = Object.keys(bs.variants);
      html += '<div style="display:flex;gap:0;border-bottom:2px solid var(--cream-dark);margin-bottom:16px;">';
      variantKeys.forEach(function(vid) {
        var v = bs.variants[vid];
        var isActive = currentVariantId === vid;
        html += '<button class="view-tab' + (isActive ? ' active' : '') + '" onclick="makerSwitchVariant(\'' + esc(vid) + '\')">' + esc(v.label || 'Variant') + '</button>';
      });
      if (variantKeys.length < 3) {
        html += '<button style="padding:10px 16px;font-size:0.82rem;border:none;background:none;color:var(--teal);cursor:pointer;font-family:\'DM Sans\';" onclick="makerAddVariant()">+ Add</button>';
      }
      html += '</div>';

      // Variant label edit + delete
      if (currentVariantId && bs.variants[currentVariantId]) {
        html += '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;">';
        html += '<input type="text" value="' + esc(bs.variants[currentVariantId].label || '') + '" placeholder="Variant name" style="padding:5px 10px;border:1px solid #ddd;border-radius:4px;font-size:0.82rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';" onchange="makerRenameVariant(\'' + esc(currentVariantId) + '\', this.value)">';
        if (variantKeys.length > 1) {
          html += '<button class="btn btn-danger btn-small" style="font-size:0.72rem;" onclick="makerDeleteVariant(\'' + esc(currentVariantId) + '\')">Delete</button>';
        }
        html += '</div>';
      }
    }

    // ---- PARTS SECTION ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h4 style="font-size:0.95rem;font-weight:600;margin:0;">Parts (Bill of Materials)</h4>';
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
          subBadge = ' <span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.62rem;padding:1px 6px;margin-left:4px;">sub-assembly</span>' + errFlag;
        }
        // Phase 2D: lock chip on materials with active locks
        var lockChip = '';
        if (li.kind !== 'recipe' && li.materialId) {
          var activeLock = getActiveLockForMaterial(li.materialId);
          if (activeLock) {
            var pctUsed = activeLock.qtyLocked > 0 ? Math.round((activeLock.qtyConsumed / activeLock.qtyLocked) * 100) : 0;
            lockChip = ' <span class="status-badge" style="background:rgba(42,124,111,0.15);color:var(--teal);font-size:0.62rem;padding:1px 6px;margin-left:4px;" title="Locked at $' + activeLock.lockedUnitCost.toFixed(2) + ' from ' + esc(activeLock.supplierName || 'supplier') + ', ' + pctUsed + '% consumed">🔒 $' + activeLock.lockedUnitCost.toFixed(2) + '</span>';
          }
        }
        html += '<tr>';
        html += '<td style="padding:8px;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">' + esc(li.materialName || '') + subBadge + lockChip + '</td>';
        html += '<td style="text-align:right;padding:8px;border-bottom:1px solid var(--cream-dark);"><input type="number" step="0.01" min="0" value="' + (li.quantity || 0) + '" style="width:70px;text-align:right;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);" onchange="makerUpdateLineItemQty(\'' + esc(liId) + '\', this.value)">' + (scrapPct > 0 ? '<div style="font-size:0.7rem;color:var(--warm-gray);text-align:right;margin-top:2px;">eff: ' + effQty.toFixed(2) + '</div>' : '') + '</td>';
        html += '<td style="text-align:right;padding:8px;border-bottom:1px solid var(--cream-dark);"><input type="number" step="1" min="0" max="50" value="' + scrapPct + '" style="width:55px;text-align:right;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);" onchange="makerUpdateLineItemScrap(\'' + esc(liId) + '\', this.value)"></td>';
        html += '<td style="text-align:center;padding:8px;font-size:0.82rem;color:var(--warm-gray);border-bottom:1px solid var(--cream-dark);">' + esc(li.unitOfMeasure || '') + '</td>';
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
    html += '<h4 style="font-size:0.95rem;font-weight:600;margin:0 0 12px;">Labor</h4>';
    html += '<div style="display:flex;gap:12px;align-items:flex-end;">';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Rate ($/hr)</label>';
    html += '<input type="number" step="0.01" min="0" value="' + (bs.laborRatePerHour || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'laborRatePerHour\', parseFloat(this.value) || 0)">';
    html += '</div>';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Time (minutes)</label>';
    html += '<input type="number" step="1" min="0" value="' + (activeData.laborMinutes || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'laborMinutes\', parseFloat(this.value) || 0)">';
    html += '</div>';

    html += '<div style="flex:1;text-align:right;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Labor Cost</label>';
    html += '<div style="padding:8px 10px;font-family:monospace;font-size:0.85rem;font-weight:600;">$' + calc.laborCost.toFixed(2) + '</div>';
    html += '</div>';

    html += '</div></div>';

    // ---- OTHER COSTS SECTION ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<h4 style="font-size:0.95rem;font-weight:600;margin:0 0 12px;">Other Costs</h4>';
    html += '<div style="display:flex;gap:12px;">';

    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Amount ($)</label>';
    html += '<input type="number" step="0.01" min="0" value="' + (activeData.otherCost || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'otherCost\', parseFloat(this.value) || 0)">';
    html += '</div>';

    html += '<div style="flex:2;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Note</label>';
    html += '<input type="text" value="' + esc(bs.otherCostNote || '') + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';box-sizing:border-box;" onchange="makerUpdateBuilderField(\'otherCostNote\', this.value)" placeholder="e.g. packaging, shipping supplies">';
    html += '</div>';

    html += '</div>';

    // Setup cost + batch size (amortized fixed cost — kiln firing, casting tree, etc.)
    html += '<div style="display:flex;gap:12px;margin-top:12px;padding-top:12px;border-top:1px dashed var(--cream-dark);">';
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Setup Cost ($) <span style="font-weight:400;color:var(--warm-gray-light);">amortized</span></label>';
    html += '<input type="number" step="0.01" min="0" value="' + (bs.setupCost || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'setupCost\', parseFloat(this.value) || 0)">';
    html += '</div>';
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Batch Size <span style="font-weight:400;color:var(--warm-gray-light);">units per setup</span></label>';
    html += '<input type="number" step="1" min="1" value="' + (bs.batchSize || 1) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'batchSize\', Math.max(1, parseInt(this.value) || 1))">';
    html += '</div>';
    html += '<div style="flex:1;text-align:right;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Per Unit</label>';
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
    html += '<div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;padding-top:8px;border-top:1px solid rgba(255,255,255,0.2);"><span>Total Cost</span><span style="font-family:monospace;">$' + calc.totalCost.toFixed(2) + '</span></div>';
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
        html += '<div style="position:absolute;top:-1px;right:12px;background:var(--teal);color:white;font-size:0.65rem;font-weight:700;padding:2px 8px;border-radius:0 0 4px 4px;text-transform:uppercase;letter-spacing:0.06em;">Active</div>';
      }

      // Tier header
      html += '<div style="text-align:center;font-size:0.82rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--warm-gray);margin-bottom:10px;background:' + headerBg + ';padding:4px;border-radius:4px;">' + tier.label + '</div>';

      // Markup input
      html += '<div style="text-align:center;margin-bottom:8px;">';
      html += '<label style="font-size:0.72rem;color:var(--warm-gray-light);display:block;margin-bottom:2px;">Markup</label>';
      html += '<input type="number" step="0.1" min="1" value="' + (bs[tier.markupField] || 1) + '" style="width:70px;text-align:center;padding:6px 8px;border:1px solid #ddd;border-radius:6px;font-size:0.95rem;font-family:monospace;font-weight:600;background:var(--cream);color:var(--charcoal);" onchange="makerUpdateBuilderField(\'' + tier.markupField + '\', parseFloat(this.value) || 1)">';
      html += '<span style="font-size:0.82rem;color:var(--warm-gray);margin-left:2px;">×</span>';
      html += '</div>';

      // Price
      html += '<div style="text-align:center;font-size:1.3rem;font-family:monospace;font-weight:700;color:var(--charcoal);margin-bottom:4px;">$' + tier.price.toFixed(2) + '</div>';

      // Gross profit + margin %
      var minMargin = bs.minMarginPercent;
      var belowMin = minMargin != null && tier.marginPct < minMargin;
      var profitColor = tier.profit > 0 ? '#16a34a' : 'var(--danger)';
      var marginColor = belowMin ? 'var(--danger)' : profitColor;
      html += '<div style="text-align:center;font-size:0.78rem;color:' + profitColor + ';">Profit: $' + tier.profit.toFixed(2) + '</div>';
      html += '<div style="text-align:center;font-size:0.82rem;font-weight:600;color:' + marginColor + ';margin-top:2px;">Margin: ' + tier.marginPct.toFixed(1) + '%' + (belowMin ? ' ⚠' : '') + '</div>';

      // Etsy sync indicator + Set active button
      if (isActive) {
        var linkedProduct = bs.productId ? (window.productsData || []).find(function(p) { return p.pid === bs.productId; }) : null;
        if (linkedProduct && linkedProduct.etsyListingId) {
          html += '<div style="text-align:center;margin-top:8px;font-size:0.72rem;color:var(--teal);">Etsy listing will sync</div>';
          if (bs.lastEtsySyncAt) {
            html += '<div style="text-align:center;font-size:0.68rem;color:var(--warm-gray-light);">Last sync: ' + new Date(bs.lastEtsySyncAt).toLocaleDateString() + '</div>';
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

    // ---- Phase 2C.2: marginHistory sparkline ----
    var history = Array.isArray(bs.marginHistory) ? bs.marginHistory : [];
    if (history.length >= 2) {
      var activeTierKeyForSpark = bs.activePriceTier || 'direct';
      var spark = makerSparklineSvg(history, activeTierKeyForSpark);
      var oldestDate = history[0].date ? new Date(history[0].date).toLocaleDateString() : '';
      var newestDate = history[history.length - 1].date ? new Date(history[history.length - 1].date).toLocaleDateString() : '';
      html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px 16px;margin-bottom:16px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">';
      html += '<h4 style="font-size:0.95rem;font-weight:600;margin:0;">Margin history</h4>';
      html += '<span style="font-size:0.72rem;color:var(--warm-gray);">' + history.length + ' calc' + (history.length === 1 ? '' : 's') + ' · ' + oldestDate + ' → ' + newestDate + '</span>';
      html += '</div>';
      html += spark;
      html += '</div>';
    }

    // ---- VARIANT PRICING SUMMARY (when variants enabled) ----
    if (isVariant && Object.keys(bs.variants).length > 1) {
      var allCalcs = calculateAllVariants(bs);
      html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
      html += '<h4 style="font-size:0.95rem;font-weight:600;margin:0 0 12px;">Variant Pricing Summary</h4>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
      html += '<thead><tr>';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">' + esc(bs.variantLabel || 'Variant') + '</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Cost</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Wholesale</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Direct</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Retail</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Margin (active)</th>';
      html += '</tr></thead><tbody>';
      var activeTier = bs.activePriceTier || 'direct';
      var marginKey = activeTier + 'MarginPct';
      var minMarginV = bs.minMarginPercent;
      Object.keys(bs.variants).forEach(function(vid) {
        var v = bs.variants[vid];
        var vc = allCalcs[vid] || {};
        var vMargin = vc[marginKey] || 0;
        var vBelow = minMarginV != null && vMargin < minMarginV;
        html += '<tr>';
        html += '<td style="padding:8px;font-weight:500;border-bottom:1px solid var(--cream-dark);">' + esc(v.label || 'Variant') + '</td>';
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

  function updateBuilderField(field, value) {
    if (!builderState) return;
    // Variant-scoped fields: laborMinutes, otherCost go to active variant
    var variantFields = ['laborMinutes', 'otherCost'];
    if (builderState.isVariantEnabled && currentVariantId && builderState.variants && builderState.variants[currentVariantId] && variantFields.indexOf(field) >= 0) {
      builderState.variants[currentVariantId][field] = value;
    } else {
      builderState[field] = value;
    }
    renderRecipeBuilder(); // live reactive re-render
  }

  function updateLineItemQty(liId, value) {
    if (!builderState) return;
    var target = getActiveVariantData(builderState);
    if (!target.lineItems || !target.lineItems[liId]) return;
    target.lineItems[liId].quantity = parseFloat(value) || 0;
    renderRecipeBuilder();
  }

  function updateLineItemScrap(liId, value) {
    if (!builderState) return;
    var target = getActiveVariantData(builderState);
    if (!target.lineItems || !target.lineItems[liId]) return;
    target.lineItems[liId].scrapPercent = Math.min(50, Math.max(0, parseFloat(value) || 0));
    renderRecipeBuilder();
  }

  function removeLineItemUI(liId) {
    if (!builderState) return;
    var target = getActiveVariantData(builderState);
    if (!target.lineItems) return;
    delete target.lineItems[liId];
    renderRecipeBuilder();
  }

  async function saveRecipeBuilder() {
    if (!editingRecipeId || !builderState) return;
    try {
      var updates = {
        laborRatePerHour: builderState.laborRatePerHour || 0,
        wholesaleMarkup: builderState.wholesaleMarkup || 1,
        directMarkup: builderState.directMarkup || 1,
        retailMarkup: builderState.retailMarkup || 1,
        otherCostNote: builderState.otherCostNote || '',
        setupCost: builderState.setupCost || 0,
        batchSize: builderState.batchSize || 1,
        minMarginPercent: builderState.minMarginPercent != null ? builderState.minMarginPercent : null,
        notes: builderState.notes || '',
        isVariantEnabled: builderState.isVariantEnabled || false,
        variantDimension: builderState.variantDimension || '',
        variantLabel: builderState.variantLabel || ''
      };
      if (builderState.isVariantEnabled && builderState.variants) {
        updates.variants = builderState.variants;
        // Keep root lineItems/labor/otherCost for backward compat but don't use them
      } else {
        updates.lineItems = builderState.lineItems || {};
        updates.laborMinutes = builderState.laborMinutes || 0;
        updates.otherCost = builderState.otherCost || 0;
      }
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
      var snap = await MastDB.recipes.get(editingRecipeId);
      var fresh = snap.val();
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
    if (!confirm('Duplicate this recipe as a new draft? The clone will not be linked to a product.')) return;
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
    if (!confirm('Recalculate ' + dirtyIds.length + ' flagged recipe' + (dirtyIds.length === 1 ? '' : 's') + '? This refreshes material costs and updates totals.')) {
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
      var snap = await MastDB.recipes.get(editingRecipeId);
      var fresh = snap.val();
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
      var snap = await MastDB.recipes.get(editingRecipeId);
      var fresh = snap.val();
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
    svg += '<div style="display:flex;justify-content:space-between;font-size:0.7rem;color:var(--warm-gray);margin-top:4px;">';
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
        simulatedMatCost[mid] = roundCents(shiftedSpot * (m.purity || 0) * (1 + (m.markupOverSpot || 0) / 100));
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
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.4rem;font-weight:500;margin:0;">📊 What-If Simulator</h3>';
    html += '<button style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--warm-gray);" onclick="makerCloseWhatIf()">✕</button>';
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
        html += '<div style="font-size:0.7rem;color:var(--warm-gray-light);margin-top:2px;">spot $' + (spotPricesCurrent[metal] || 0).toFixed(2) + '/oz</div>';
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
    html += '<div class="data-table"><table style="width:100%;font-size:0.82rem;"><thead><tr>';
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
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.4rem;font-weight:500;margin:0;">↻ Reprice ' + candidates.length + ' recipe' + (candidates.length === 1 ? '' : 's') + '</h3>';
    html += '<button style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:var(--warm-gray);" onclick="makerCloseRepriceAll()">✕</button>';
    html += '</div>';
    html += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 12px;">Drift threshold: ' + repricingThresholdPct + '%. Each reprice runs calculate_price + propagates the active tier price to the linked product + resets the drift baseline.</p>';
    if (candidates.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray);text-align:center;padding:12px;">No recipes need repricing.</p>';
    } else {
      var esc = MastAdmin.esc;
      html += '<div class="data-table"><table style="width:100%;font-size:0.82rem;"><thead><tr>';
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
      await MastDB.ref('admin/priceLocks/' + lockId).remove();
      MastAdmin.showToast('Lock deleted');
      await loadVolatilePricingData();
      renderMaterials();
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  // Phase 2E: one-click reprice — recalc + set active tier (which propagates)
  async function repriceNow() {
    if (!editingRecipeId || !builderState) return;
    var tier = builderState.activePriceTier || 'direct';
    try {
      await saveRecipeBuilder();
      await recalculateRecipe(editingRecipeId);
      await setActivePriceTier(editingRecipeId, tier);
      var snap = await MastDB.recipes.get(editingRecipeId);
      var fresh = snap.val();
      if (fresh) builderState = JSON.parse(JSON.stringify(fresh));
      await loadVolatilePricingData();
      renderRecipeBuilder();
      MastAdmin.showToast('Repriced — ' + tier + ' tier propagated');
    } catch (err) {
      MastAdmin.showToast('Reprice failed: ' + err.message, true);
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

    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.2rem;font-weight:500;margin:0 0 16px;">Add Part</h3>';

    // Kind toggle (Material vs Sub-assembly)
    html += '<div style="display:flex;gap:0;margin-bottom:14px;border:1px solid var(--cream-dark);border-radius:6px;overflow:hidden;">';
    var matBg = addPartKind === 'material' ? 'var(--teal)' : 'var(--cream)';
    var matFg = addPartKind === 'material' ? 'white' : 'var(--charcoal)';
    var subBg = addPartKind === 'recipe' ? 'var(--teal)' : 'var(--cream)';
    var subFg = addPartKind === 'recipe' ? 'white' : 'var(--charcoal)';
    html += '<button style="flex:1;padding:8px 12px;border:none;background:' + matBg + ';color:' + matFg + ';font-size:0.82rem;font-weight:600;cursor:pointer;font-family:\'DM Sans\';" onclick="makerSetAddPartKind(\'material\')">Material</button>';
    html += '<button style="flex:1;padding:8px 12px;border:none;background:' + subBg + ';color:' + subFg + ';font-size:0.82rem;font-weight:600;cursor:pointer;font-family:\'DM Sans\';" onclick="makerSetAddPartKind(\'recipe\')">Sub-assembly</button>';
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

        html += '<p style="font-size:0.75rem;color:var(--warm-gray-light);margin:0 0 12px;">Sub-assembly cost = sub-recipe total cost (no markup compounding). Max nesting depth ' + SUB_ASSEMBLY_MAX_DEPTH + '.</p>';
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
    var target = getActiveVariantData(builderState);
    if (!target.lineItems) target.lineItems = {};

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
      var snap = await MastDB.ref('admin/spotPrices/current').once('value');
      var current = snap.val();
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
  window.makerCloseRecipeBuilder = closeRecipeBuilder;
  window.makerCreateRecipeForProduct = createRecipeForProduct;
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
  window.makerSetTierFromBuilder = setTierFromBuilder;
  window.makerRepriceNow = repriceNow;
  window.makerOpenWhatIfSimulator = openWhatIfSimulator;
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

  // Variants
  window.makerToggleVariants = function(enabled) {
    if (!builderState) return;
    builderState.isVariantEnabled = enabled;
    if (enabled && (!builderState.variants || Object.keys(builderState.variants).length === 0)) {
      // Create first variant from existing recipe data
      var v = createVariant('Default');
      v.lineItems = JSON.parse(JSON.stringify(builderState.lineItems || {}));
      v.laborMinutes = builderState.laborMinutes || 0;
      v.otherCost = builderState.otherCost || 0;
      builderState.variants = {};
      builderState.variants[v.variantId] = v;
      builderState.variantDimension = 'size';
      builderState.variantLabel = 'Size';
      currentVariantId = v.variantId;
    } else if (enabled) {
      var keys = Object.keys(builderState.variants);
      currentVariantId = keys[0] || null;
    } else {
      currentVariantId = null;
    }
    renderRecipeBuilder();
  };
  window.makerSwitchVariant = function(vid) {
    currentVariantId = vid;
    renderRecipeBuilder();
  };
  window.makerAddVariant = function() {
    if (!builderState || !builderState.variants) return;
    if (Object.keys(builderState.variants).length >= 3) {
      showToast('Maximum 3 variants', 'error');
      return;
    }
    var v = createVariant('Variant ' + (Object.keys(builderState.variants).length + 1));
    builderState.variants[v.variantId] = v;
    currentVariantId = v.variantId;
    renderRecipeBuilder();
  };
  window.makerDeleteVariant = function(vid) {
    if (!builderState || !builderState.variants) return;
    if (Object.keys(builderState.variants).length <= 1) return;
    delete builderState.variants[vid];
    var keys = Object.keys(builderState.variants);
    currentVariantId = keys[0] || null;
    renderRecipeBuilder();
  };
  window.makerRenameVariant = function(vid, name) {
    if (!builderState || !builderState.variants || !builderState.variants[vid]) return;
    builderState.variants[vid].label = name;
    // Don't re-render (focus would be lost on the input)
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
    importState = null;
    if (piecesView === 'list') renderPiecesList();
    else renderMaterials();
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
      html += '<div style="background:rgba(220,53,69,0.08);border:1px solid rgba(220,53,69,0.2);border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:0.82rem;color:var(--danger);">' +
        invalidRows.length + ' rows missing required fields will be skipped.</div>';
    }

    // Preview table (first 10 valid rows)
    var previewFields = fields.filter(function(f) { return importState.mappings[f.key] !== undefined || f.required; });
    html += '<div style="overflow-x:auto;margin-bottom:16px;">';
    html += '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">';
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
          await MastDB.products.ref(pid).set({
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
          '<div style="font-size:2rem;margin-bottom:12px;">✅</div>' +
          '<p style="font-size:1.1rem;font-weight:500;margin-bottom:8px;">Import Complete</p>' +
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
