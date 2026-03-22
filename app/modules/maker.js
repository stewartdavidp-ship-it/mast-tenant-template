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
    html += '<button class="btn btn-primary" onclick="makerOpenAddMaterial()">+ New Material</button>';
    html += '</div>';

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
        html += '<button class="order-filter-pill"' + active + ' onclick="makerFilterMaterialsCategory(\'' + esc(cat).replace(/'/g, "\\'") + '\')">' + esc(cat) + '</button>';
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
      html += '<td style="font-weight:500;">' + esc(m.name) + '</td>';
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

  async function saveMaterialForm() {
    var name = (document.getElementById('matName').value || '').trim();
    if (!name) {
      MastAdmin.showToast('Material name is required', true);
      return;
    }

    var cost = parseFloat(document.getElementById('matCost').value) || 0;
    var data = {
      name: name,
      category: document.getElementById('matCategory').value || '',
      unitOfMeasure: document.getElementById('matUom').value || 'each',
      unitCost: cost,
      onHandQty: parseFloat(document.getElementById('matOnHand').value) || 0,
      reorderThreshold: parseFloat(document.getElementById('matReorder').value) || 0,
      notes: (document.getElementById('matNotes').value || '').trim()
    };

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

  function archiveMaterialConfirm(id) {
    var m = materialsData[id];
    if (!m) return;
    if (!confirm('Archive "' + m.name + '"? This cannot be undone.')) return;
    archiveMaterial(id).then(function() {
      MastAdmin.showToast('Material archived');
    }).catch(function(err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    });
  }

  // ============================================================
  // Category Management
  // ============================================================

  function addCategoryPrompt() {
    var cat = prompt('Enter new category name:');
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

    var html = '';
    html += '<div style="background:rgba(42,124,111,0.08);border:1px solid var(--teal-light);border-radius:8px;padding:20px 24px;margin-bottom:20px;">';
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
        MastAdmin.showToast('Materials seeded for ' + profile + ' (' + result.materialsCreated + ' samples added)');
        renderMaterials();
      }
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  }

  // ============================================================
  // Pieces List UI
  // ============================================================

  var piecesView = 'list'; // list | builder
  var editingRecipeId = null;
  var builderState = null; // live state for the recipe builder

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
        html += '<td><span class="status-badge pill" style="background:rgba(42,124,111,0.12);color:var(--teal);border:1px solid rgba(42,124,111,0.25);">' + esc(recipe.activePriceTier || 'none') + '</span>' + etsyIcon + '</td>';
        var activePrice = getTierPrice(recipe.activePriceTier, recipe);
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
        html += '<button class="btn btn-outline btn-small" onclick="makerCreateRecipeForProduct(\'' + esc(pid) + '\', \'' + esc(p.name || '').replace(/'/g, "\\'") + '\')">+ Add Recipe</button>';
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

    // Run live calculation
    var calc = calculateRecipe({
      lineItems: bs.lineItems || {},
      laborRatePerHour: bs.laborRatePerHour || 0,
      laborMinutes: bs.laborMinutes || 0,
      otherCost: bs.otherCost || 0,
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

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    html += '<div>';
    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.4rem;font-weight:500;margin:0;">' + esc(bs.name || 'Untitled Recipe') + '</h3>';
    html += '<span style="font-size:0.82rem;color:var(--warm-gray);">Recipe for product ' + esc(bs.productId || '') + '</span>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="makerSaveRecipeBuilder()">Save</button>';
    html += '<button class="btn btn-primary btn-small" onclick="makerSaveAndRecalcRecipe()">Save & Recalculate</button>';
    html += '</div>';
    html += '</div>';

    // ---- PARTS SECTION ----
    html += '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px;margin-bottom:16px;">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">';
    html += '<h4 style="font-size:0.95rem;font-weight:600;margin:0;">Parts (Bill of Materials)</h4>';
    html += '<button class="btn btn-outline btn-small" onclick="makerOpenAddPartModal()">+ Add Part</button>';
    html += '</div>';

    var lineItems = bs.lineItems || {};
    var liKeys = Object.keys(lineItems);

    if (liKeys.length === 0) {
      html += '<p style="font-size:0.85rem;color:var(--warm-gray-light);text-align:center;padding:12px;">No parts added yet. Click "+ Add Part" to select materials.</p>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;">';
      html += '<thead><tr>';
      html += '<th style="text-align:left;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Material</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Qty</th>';
      html += '<th style="text-align:center;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">UOM</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Unit Cost</th>';
      html += '<th style="text-align:right;padding:6px 8px;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--warm-gray-light);border-bottom:1px solid var(--cream-dark);">Extended</th>';
      html += '<th style="width:40px;border-bottom:1px solid var(--cream-dark);"></th>';
      html += '</tr></thead><tbody>';

      liKeys.forEach(function(liId) {
        var li = lineItems[liId];
        var ext = calc.lineItems[liId] ? calc.lineItems[liId].extendedCost : roundCents((li.quantity || 0) * (li.unitCost || 0));
        html += '<tr>';
        html += '<td style="padding:8px;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">' + esc(li.materialName || '') + '</td>';
        html += '<td style="text-align:right;padding:8px;border-bottom:1px solid var(--cream-dark);"><input type="number" step="0.01" min="0" value="' + (li.quantity || 0) + '" style="width:70px;text-align:right;padding:4px 6px;border:1px solid #ddd;border-radius:4px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);" onchange="makerUpdateLineItemQty(\'' + esc(liId) + '\', this.value)"></td>';
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
    html += '<input type="number" step="1" min="0" value="' + (bs.laborMinutes || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'laborMinutes\', parseFloat(this.value) || 0)">';
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
    html += '<input type="number" step="0.01" min="0" value="' + (bs.otherCost || 0) + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;font-family:monospace;background:var(--cream);color:var(--charcoal);box-sizing:border-box;" onchange="makerUpdateBuilderField(\'otherCost\', parseFloat(this.value) || 0)">';
    html += '</div>';

    html += '<div style="flex:2;">';
    html += '<label style="display:block;font-size:0.82rem;font-weight:600;margin-bottom:4px;">Note</label>';
    html += '<input type="text" value="' + esc(bs.otherCostNote || '') + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';box-sizing:border-box;" onchange="makerUpdateBuilderField(\'otherCostNote\', this.value)" placeholder="e.g. packaging, shipping supplies">';
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
      { key: 'wholesale', label: 'Wholesale', markupField: 'wholesaleMarkup', price: calc.wholesalePrice, profit: calc.wholesaleGrossProfit },
      { key: 'direct', label: 'Direct', markupField: 'directMarkup', price: calc.directPrice, profit: calc.directGrossProfit },
      { key: 'retail', label: 'Retail', markupField: 'retailMarkup', price: calc.retailPrice, profit: calc.retailGrossProfit }
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

      // Gross profit
      html += '<div style="text-align:center;font-size:0.78rem;color:' + (tier.profit > 0 ? '#16a34a' : 'var(--danger)') + ';">Profit: $' + tier.profit.toFixed(2) + '</div>';

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
    builderState[field] = value;
    renderRecipeBuilder(); // live reactive re-render
  }

  function updateLineItemQty(liId, value) {
    if (!builderState || !builderState.lineItems || !builderState.lineItems[liId]) return;
    builderState.lineItems[liId].quantity = parseFloat(value) || 0;
    renderRecipeBuilder();
  }

  function removeLineItemUI(liId) {
    if (!builderState || !builderState.lineItems) return;
    delete builderState.lineItems[liId];
    renderRecipeBuilder();
  }

  async function saveRecipeBuilder() {
    if (!editingRecipeId || !builderState) return;
    try {
      var updates = {
        lineItems: builderState.lineItems || {},
        laborRatePerHour: builderState.laborRatePerHour || 0,
        laborMinutes: builderState.laborMinutes || 0,
        otherCost: builderState.otherCost || 0,
        otherCostNote: builderState.otherCostNote || '',
        wholesaleMarkup: builderState.wholesaleMarkup || 1,
        directMarkup: builderState.directMarkup || 1,
        retailMarkup: builderState.retailMarkup || 1,
        notes: builderState.notes || ''
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

  // ============================================================
  // Add Part Modal (material picker)
  // ============================================================

  function openAddPartModal() {
    var esc = MastAdmin.esc;
    var activeMaterials = Object.values(materialsData).filter(function(m) {
      return m.status === 'active';
    }).sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var html = '';
    html += '<div id="addPartOverlay" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;" onclick="makerCloseAddPartModal(event)">';
    html += '<div style="background:var(--cream);border-radius:10px;max-width:480px;width:90%;max-height:70vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.2);padding:20px 24px;" onclick="event.stopPropagation()">';

    html += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.2rem;font-weight:500;margin:0 0 16px;">Add Part</h3>';

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

    html += '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">';
    html += '<button class="btn btn-secondary" onclick="makerCloseAddPartModal()">Cancel</button>';
    if (activeMaterials.length > 0) {
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
    var matId = document.getElementById('addPartMaterialId').value;
    var qty = parseFloat(document.getElementById('addPartQty').value) || 0;

    if (!matId) {
      MastAdmin.showToast('Select a material', true);
      return;
    }
    if (qty <= 0) {
      MastAdmin.showToast('Quantity must be greater than 0', true);
      return;
    }

    var material = materialsData[matId];
    if (!material) return;

    // Add to builder state locally (not saved to Firebase yet)
    var liId = 'li_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
    if (!builderState.lineItems) builderState.lineItems = {};
    builderState.lineItems[liId] = {
      lineItemId: liId,
      materialId: matId,
      materialName: material.name,
      quantity: qty,
      unitOfMeasure: material.unitOfMeasure,
      unitCost: material.unitCost,
      extendedCost: roundCents(qty * material.unitCost)
    };

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
  window.makerSetTierFromBuilder = setTierFromBuilder;
  window.makerUpdateBuilderField = updateBuilderField;
  window.makerUpdateLineItemQty = updateLineItemQty;
  window.makerRemoveLineItemUI = removeLineItemUI;
  window.makerOpenAddPartModal = openAddPartModal;
  window.makerCloseAddPartModal = closeAddPartModal;
  window.makerConfirmAddPart = confirmAddPart;

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
