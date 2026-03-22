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
    var wholesaleMarkup = params.wholesaleMarkup || 1;
    var directMarkup = params.directMarkup || 1;
    var retailMarkup = params.retailMarkup || 1;

    // Calculate material costs from line items
    var totalMaterialCost = 0;
    var calculatedLineItems = {};
    Object.keys(lineItems).forEach(function(liId) {
      var li = lineItems[liId];
      var qty = li.quantity || 0;
      var cost = li.unitCost || 0;
      var extendedCost = roundCents(qty * cost);
      totalMaterialCost += extendedCost;
      calculatedLineItems[liId] = Object.assign({}, li, { extendedCost: extendedCost });
    });

    totalMaterialCost = roundCents(totalMaterialCost);

    // Labor cost
    var laborCost = roundCents((laborMinutes / 60) * laborRate);

    // Total cost
    var totalCost = roundCents(totalMaterialCost + laborCost + otherCost);

    // Pricing tiers
    var wholesalePrice = roundCents(totalCost * wholesaleMarkup);
    var directPrice = roundCents(totalCost * directMarkup);
    var retailPrice = roundCents(totalCost * retailMarkup);

    return {
      lineItems: calculatedLineItems,
      totalMaterialCost: totalMaterialCost,
      laborCost: laborCost,
      totalCost: totalCost,
      wholesalePrice: wholesalePrice,
      wholesaleGrossProfit: roundCents(wholesalePrice - totalCost),
      directPrice: directPrice,
      directGrossProfit: roundCents(directPrice - totalCost),
      retailPrice: retailPrice,
      retailGrossProfit: roundCents(retailPrice - totalCost)
    };
  }

  /**
   * Round to nearest cent.
   */
  function roundCents(value) {
    return Math.round(value * 100) / 100;
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
      notes: data.notes || '',
      createdAt: now,
      updatedAt: now
    };
    await MastDB.materials.set(id, material);
    MastAdmin.writeAudit('create', 'material', id);
    return material;
  }

  async function updateMaterial(id, updates) {
    updates.updatedAt = new Date().toISOString();
    var oldMaterial = materialsData[id];
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
    var lineItems = recipe.lineItems || {};
    var refreshedLineItems = {};
    Object.keys(lineItems).forEach(function(liId) {
      var li = lineItems[liId];
      var material = materialsData[li.materialId];
      var currentCost = material ? material.unitCost : li.unitCost;
      refreshedLineItems[liId] = Object.assign({}, li, {
        unitCost: currentCost,
        materialName: material ? material.name : li.materialName
      });
    });

    // Run calculation
    var calc = calculateRecipe({
      lineItems: refreshedLineItems,
      laborRatePerHour: recipe.laborRatePerHour,
      laborMinutes: recipe.laborMinutes,
      otherCost: recipe.otherCost,
      wholesaleMarkup: recipe.wholesaleMarkup,
      directMarkup: recipe.directMarkup,
      retailMarkup: recipe.retailMarkup
    });

    var now = new Date().toISOString();
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
      lastCalculatedAt: now,
      updatedAt: now
    };

    await MastDB.recipes.update(recipeId, updates);

    // Propagate price to product if activePriceTier is set
    if (recipe.activePriceTier && recipe.productId) {
      var tierPrice = getTierPrice(recipe.activePriceTier, updates);
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

    var tierPrice = getTierPrice(tier, recipe);
    var now = new Date().toISOString();

    // Atomic multi-path update: recipe tier + product price
    var updates = {};
    updates['admin/recipes/' + recipeId + '/activePriceTier'] = tier;
    updates['admin/recipes/' + recipeId + '/updatedAt'] = now;

    if (recipe.productId) {
      var priceCents = Math.round(tierPrice * 100);
      updates['public/products/' + recipe.productId + '/priceCents'] = priceCents;
      updates['public/products/' + recipe.productId + '/price'] = tierPrice;
    }

    await MastDB._multiUpdate(updates);
    MastAdmin.writeAudit('set-price-tier', 'recipe', recipeId);
    return { tier: tier, price: tierPrice };
  }

  /**
   * Propagate a price to a product (used after recalculation).
   */
  async function propagatePriceToProduct(productId, price) {
    var priceCents = Math.round(price * 100);
    await MastDB._multiUpdate({
      'public/products/' + productId + '/priceCents': priceCents,
      'public/products/' + productId + '/price': price
    });
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
  // Maker Settings
  // ============================================================

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
  // Render Stubs (Session 2 & 3 will implement)
  // ============================================================

  function renderMaterials() {
    // Session 2 will implement materials list UI
  }

  function renderPieces() {
    // Session 3 will implement pieces list UI
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

  // Recipes CRUD
  window.makerCreateRecipe = createRecipe;
  window.makerUpdateRecipe = updateRecipe;
  window.makerArchiveRecipe = archiveRecipe;
  window.makerRecalculateRecipe = recalculateRecipe;
  window.makerAddLineItem = addLineItem;
  window.makerRemoveLineItem = removeLineItem;

  // Pricing
  window.makerSetActivePriceTier = setActivePriceTier;

  // Settings & Seeding
  window.makerGetSettings = getMakerSettings;
  window.makerSaveSettings = saveMakerSettings;
  window.makerSeedMaterials = seedMaterials;

  // Data access (for console inspection)
  window.makerGetMaterials = function() { return materialsData; };
  window.makerGetRecipes = function() { return recipesData; };
  window.makerGetCraftProfiles = function() { return CRAFT_PROFILES; };
  window.makerGetUomOptions = function() { return UOM_OPTIONS; };

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('maker', {
    routes: {
      'materials': { tab: 'materialsTab', setup: function() {
        loadMaterials();
      } },
      'pieces': { tab: 'piecesTab', setup: function() {
        loadMaterials(); // needed for recipe builder
        loadRecipes();
      } }
    },
    detachListeners: function() {
      unloadMaterials();
      unloadRecipes();
    }
  });

})();
