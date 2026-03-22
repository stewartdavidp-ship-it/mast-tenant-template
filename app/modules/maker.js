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
  // Pieces Render Stub (Session 3)
  // ============================================================

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
      } }
    },
    detachListeners: function() {
      unloadMaterials();
      unloadRecipes();
    }
  });

})();
