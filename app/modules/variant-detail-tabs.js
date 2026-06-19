/**
 * Variant / product-detail tab + section renderers — the heavy, lazily-invoked
 * string builders behind the product detail page's variant master-detail layout
 * and the inventory-overview variant drill-down.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14/§15,
 * Track 1 — coupled-cluster extraction). These are synchronous HTML-string
 * builders reached only after a product/variant is opened, so they are loaded
 * on demand and the output is injected asynchronously into placeholder mounts:
 *   - #pdVariantSectionMount  (filled by _fillVariantSectionMount in renderProductDetail)
 *   - the inventory drill-down <td> (filled by _fillVariantDrillMount in renderInventoryOverview)
 * The small dispatcher renderVariantTabContent STAYS EAGER in the shell and reaches
 * the five tab renderers below via window.* (the module is loaded by the time the
 * dispatcher runs, because it is only reached through renderVariantsSection).
 *
 * Reads eager shell globals (all defined before a product can be opened):
 * productsData, inventory, esc, _PD_STYLES, getProductVariantCombos, comboKey,
 * safeElId, editingVariantKey, getProductVariantsForRender, makerListRecipes,
 * variantComboLabel, variantCostAndPrice, variantChannelNames,
 * getProductChannelBindings, _getEffectiveDefaultMarkups, makerGetSpotPricesCurrent,
 * productImageCount, renderVariantDetailPanel (shell), and the eager onclick
 * handlers the generated HTML references (editProduct, saveVariantPricing,
 * excludeVariantFromChannel, saveVariantInventory, bindVariantImage, …). All logic
 * moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

function renderVariantDrillDown(pid) {
  var product = productsData.find(function(p) { return p.pid === pid; });
  if (!product) return '';
  var inv = inventory[pid] || {};
  var rawStock = inv.stock;
  var stock = (typeof rawStock === 'number') ? { _default: { onHand: rawStock, committed: 0 } } : (rawStock || {});
  var stockType = inv.stockType || 'build-to-order';
  var variantInfo = getProductVariantCombos(product);
  if (!variantInfo.combos.length) return '<div style="color:var(--warm-gray-light);font-size:0.78rem;">No variants</div>';

  var html = '<table class="inv-variant-table"><thead><tr>' +
    '<th>Variant</th><th style="text-align:center;">On Hand</th><th style="text-align:center;">Committed</th>' +
    '<th>Effective Mode</th><th></th>' +
  '</tr></thead><tbody>';

  // Iterate product variants (which have stable IDs) rather than building combo keys
  var displayVariants = (product.variants || []).filter(function(v) { return v.id && v.combo; });
  // Fallback: if no variants with IDs, use old combo key approach for pre-migration data
  if (displayVariants.length === 0) {
    variantInfo.combos.forEach(function(c) {
      var obj = {}; variantInfo.labels.forEach(function(l, i) { obj[l] = c[i]; });
      displayVariants.push({ id: comboKey(c), combo: obj });
    });
  }
  displayVariants.forEach(function(variant) {
    var key = variant.id;
    var entry = stock[key] || {};
    var onHand = entry.onHand || 0;
    var committed = entry.committed || 0;
    var held = entry.held || 0;
    var damaged = entry.damaged || 0;
    var avail = Math.max(0, onHand - committed - held - damaged);
    var modeOverride = entry.inventoryModeOverride || null;
    var effectiveMode = modeOverride || stockType;
    var modeLabel = effectiveMode === 'strict' ? 'Strict' : effectiveMode === 'stock-to-build' ? 'Stock to Build' : 'Build to Order';
    var overrideTag = modeOverride ? ' <span style="font-size:0.72rem;color:var(--amber);font-weight:600;">OVERRIDE</span>' : '';
    var comboLabel = variant.combo ? Object.values(variant.combo).join(' / ') : key;

    var availStyle = '';
    if (effectiveMode !== 'build-to-order' && effectiveMode !== 'made-to-order') {
      if (avail <= 0) availStyle = 'color:var(--danger);font-weight:600;';
      else if (avail <= (inv.lowStockThreshold || 2)) availStyle = 'color:#E65100;font-weight:600;';
    }
    var isBTO = effectiveMode === 'build-to-order' || effectiveMode === 'made-to-order';

    if (editingVariantKey === key) {
      var leadOverride = entry.productionLeadTimeDaysOverride || '';
      var fulfillOverride = entry.stockFulfillmentDaysOverride || '';
      var safeKey = safeElId(key);
      html += '<tr><td colspan="5">' +
        '<div style="font-weight:500;font-size:0.85rem;margin-bottom:6px;">' + esc(comboLabel) + '</div>' +
        '<div class="inv-variant-edit">' +
          '<div><label style="font-size:0.72rem;display:block;margin-bottom:2px;">Mode Override</label>' +
            '<select id="varOverrideMode_' + safeKey + '">' +
              '<option value="">Inherit (' + esc(modeLabel) + ')</option>' +
              '<option value="strict"' + (modeOverride === 'strict' ? ' selected' : '') + '>Strict</option>' +
              '<option value="stock-to-build"' + (modeOverride === 'stock-to-build' ? ' selected' : '') + '>Stock to Build</option>' +
              '<option value="build-to-order"' + (modeOverride === 'build-to-order' ? ' selected' : '') + '>Build to Order</option>' +
            '</select></div>' +
          '<div><label style="font-size:0.72rem;display:block;margin-bottom:2px;">Prod Lead (days)</label>' +
            '<input type="number" id="varOverrideLead_' + safeKey + '" min="0" value="' + leadOverride + '" placeholder="' + (typeof inv.productionLeadTimeDays === 'number' ? inv.productionLeadTimeDays : '—') + '" style="width:70px;"></div>' +
          '<div><label style="font-size:0.72rem;display:block;margin-bottom:2px;">Fulfill (days)</label>' +
            '<input type="number" id="varOverrideFulfill_' + safeKey + '" min="0" value="' + fulfillOverride + '" placeholder="' + (typeof inv.stockFulfillmentDays === 'number' ? inv.stockFulfillmentDays : 2) + '" style="width:70px;"></div>' +
          '<button class="btn btn-primary btn-small" data-pid="' + esc(pid) + '" data-key="' + esc(key) + '" onclick="saveVariantOverrides(this.dataset.pid, this.dataset.key)">Save</button>' +
          '<button class="btn btn-secondary btn-small" onclick="editingVariantKey=null;renderInventoryOverview();">Cancel</button>' +
        '</div>' +
      '</td></tr>';
    } else {
      html += '<tr>' +
        '<td style="font-weight:500;">' + esc(comboLabel) + '</td>' +
        '<td style="text-align:center;' + availStyle + '">' + (isBTO ? '—' : onHand) + '</td>' +
        '<td style="text-align:center;color:var(--warm-gray);">' + (committed > 0 ? committed : (isBTO ? '—' : '0')) + '</td>' +
        '<td>' + esc(modeLabel) + overrideTag + '</td>' +
        '<td><button class="btn btn-secondary btn-small" style="font-size:0.72rem;padding:3px 8px;" data-key="' + esc(key) + '" onclick="event.stopPropagation();editingVariantKey=this.dataset.key;renderInventoryOverview();">Edit</button></td>' +
      '</tr>';
    }
  });
  html += '</tbody></table>';
  return html;
}

// Top-of-detail Core Product section. Read-only summary of common fields.
// Edit goes through the existing editProduct() flow (legacy form for now).
function renderCoreProductSection(product) {
  var pid = product.pid || '';
  var inv = inventory[pid] || {};
  var stockType = (inv && inv.stockType) ? inv.stockType : 'made-to-order';
  var production;
  if (stockType === 'build-to-order' || stockType === 'made-to-order') {
    production = 'Build to order';
  } else if (stockType === 'stock-to-build') {
    production = 'Stock to build';
  } else {
    production = 'Strict stock';
  }
  if (product.processingDays && (product.processingDays.min || product.processingDays.max)) {
    var pd = product.processingDays;
    production += ' · ' + (pd.min || 0) + (pd.max && pd.max !== pd.min ? '–' + pd.max : '') + ' day lead';
  }
  var imgCount = (typeof productImageCount === 'function') ? productImageCount(product) : ((product.images || []).length);

  var html = '<div style="' + _PD_STYLES.card + '">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">';
  html += '<h3 style="' + _PD_STYLES.sectionTitle + '">Core Product</h3>';
  html += '<button class="btn btn-secondary btn-small" onclick="editProduct(\'' + esc(pid) + '\')">Edit Info</button>';
  html += '</div>';
  html += '<dl style="display:grid;grid-template-columns:130px 1fr;gap:14px 24px;margin:0;">';
  function row(label, value) {
    return '<dt style="' + _PD_STYLES.label + '">' + label + '</dt>' +
           '<dd style="' + _PD_STYLES.value + ';margin:0;">' + value + '</dd>';
  }
  html += row('Name', '<span style="font-weight:500;">' + esc(product.name || '—') + '</span>');
  html += row('Description', product.description ? esc(product.description) : '<span style="color:var(--warm-gray-light,#aaa);">No description</span>');
  html += row('Category', (product.categories && product.categories.length) ? esc(product.categories.join(', ')) : '<span style="color:var(--warm-gray-light,#aaa);">—</span>');
  html += row('Images',
    '<span style="font-weight:500;">' + imgCount + '</span> ' + (imgCount === 1 ? 'photo' : 'photos') +
    ' <a href="#" onclick="event.preventDefault();switchProductTab(\'images\');" style="color:var(--teal,#2a7c6f);font-size:0.85rem;margin-left:8px;text-decoration:none;font-weight:500;">Manage →</a>');
  html += row('Production', '<span style="font-weight:500;">' + esc(production) + '</span>');
  if (product.businessLine === 'sculpture') {
    html += row('Business Line', '<span style="display:inline-block;background:var(--teal,#2a7c6f);color:white;font-size:0.72rem;padding:3px 10px;border-radius:10px;letter-spacing:0.04em;">Sculpture</span>');
  }
  html += '</dl>';
  html += '</div>';
  return html;
}

// Variants section — master-detail. List of variants on top, detail panel
// with tabs below for the selected variant. Default selects the first.
function renderVariantsSection(product) {
  var pid = product.pid || '';
  var variants = getProductVariantsForRender(product);
  var allRecipes = (typeof window.makerListRecipes === 'function') ? window.makerListRecipes() : {};
  var recipe = (product.recipeId && allRecipes[product.recipeId] && allRecipes[product.recipeId].status !== 'archived')
    ? allRecipes[product.recipeId] : null;

  // Selected variant — defaults to first; user click changes selection.
  var selectedId = null;
  try { selectedId = sessionStorage.getItem('mastSelectedVariant_' + pid); } catch (e) {}
  if (!selectedId || !variants.some(function(v) { return v.id === selectedId; })) {
    selectedId = variants.length ? variants[0].id : null;
  }
  var selectedVariant = variants.find(function(v) { return v.id === selectedId; });

  var realCount = variants.filter(function(v) { return !v._isSynthetic; }).length;
  var html = '<div class="pd-variant-section" style="' + _PD_STYLES.card + '">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">';
  html += '<h3 style="' + _PD_STYLES.sectionTitle + '">Variants ' +
    '<span style="font-family:\'DM Sans\',sans-serif;font-size:0.9rem;color:var(--warm-gray,#888);font-weight:400;margin-left:4px;">' +
      (realCount === 0 ? 'Default only' : realCount + ' + Default') +
    '</span>' +
    '</h3>';
  html += '<button class="btn btn-secondary btn-small" onclick="openAddVariantDialog(\'' + esc(pid) + '\')">+ Add Variant</button>';
  html += '</div>';

  // Variant list — collapsed rows, selected row highlighted
  html += '<div style="border:1px solid var(--cream-dark,#e8e0d4);border-radius:10px;overflow:hidden;background:var(--surface-card,#fff);margin-bottom:18px;">';
  variants.forEach(function(variant, idx) {
    html += renderVariantListRow(product, variant, recipe, idx, variant.id === selectedId, variants.length);
  });
  html += '</div>';

  // Detail panel — tabs for the selected variant
  if (selectedVariant) {
    html += renderVariantDetailPanel(product, selectedVariant, recipe);
  }

  html += '</div>';
  return html;
}

// Compact list row: combo · cost · retail · channels · selected ring.
function renderVariantListRow(product, variant, recipe, idx, isSelected, totalCount) {
  var pid = product.pid || '';
  var label = variantComboLabel(variant);
  var pricing = variantCostAndPrice(product, variant, recipe);
  var channels = variantChannelNames(product, variant);

  var costTxt = pricing.cost != null ? '$' + pricing.cost.toFixed(2) : '—';
  var retailTxt = pricing.retail != null ? '$' + pricing.retail.toFixed(2) : '—';
  var channelsTxt = channels.length
    ? channels.map(function(n) { return '<span style="background:rgba(42,124,111,0.18);color:var(--teal,#2a7c6f);padding:3px 10px;border-radius:10px;font-size:0.9rem;font-weight:500;margin-right:4px;">' + esc(n) + '</span>'; }).join('')
    : '<span class="pd-row-label" style="font-style:italic;">No channels</span>';

  var bg = isSelected ? 'rgba(42,124,111,0.08)' : (idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)');
  var leftBar = isSelected ? '4px solid var(--teal,#2a7c6f)' : '4px solid transparent';
  var rowClass = isSelected ? 'pd-row-selected' : (idx % 2 === 1 ? 'pd-row-zebra' : '');
  var html = '<div style="border-left:' + leftBar + ';' + (idx < totalCount - 1 ? 'border-bottom:1px solid var(--cream-dark,#e8e0d4);' : '') + '">' +
    '<div class="' + rowClass + '" style="display:grid;grid-template-columns:1.5fr 1fr 1fr 1.5fr;gap:16px;align-items:center;padding:14px 16px;cursor:pointer;background:' + bg + ';transition:background 0.15s;" ' +
      'onmouseover="if(!' + (isSelected ? 'true' : 'false') + ')this.style.background=\'rgba(42,124,111,0.04)\'" onmouseout="this.style.background=\'' + bg + '\'" ' +
      'onclick="selectProductVariant(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">';
  html += '<span class="pd-row-value" style="font-weight:' + (isSelected ? '600' : '500') + ';color:var(--text,#2a2a2a);">' + esc(label) + '</span>';
  html += '<span><span class="pd-row-label" style="color:var(--warm-gray,#888);margin-right:6px;">Cost</span> <span class="pd-row-value" style="font-family:monospace;color:var(--text,#2a2a2a);">' + costTxt + '</span></span>';
  html += '<span><span class="pd-row-label" style="color:var(--warm-gray,#888);margin-right:6px;">Retail</span> <span class="pd-row-value" style="font-family:monospace;font-weight:600;color:var(--text,#2a2a2a);">' + retailTxt + '</span></span>';
  html += '<span style="text-align:right;">' + channelsTxt + '</span>';
  html += '</div></div>';
  return html;
}

function renderVariantPricingTab(product, variant, recipe, pricing) {
  var pid = product.pid || '';
  var isEditingPricing = window.__editingVariantPricing &&
    window.__editingVariantPricing.pid === pid &&
    window.__editingVariantPricing.variantId === variant.id;
  var hasMultipleVariants = Array.isArray(product.variants) && product.variants.length > 1;
  var html = '';

  // Cost basis — single dollar number that drives everything below.
  var costNum = (typeof pricing.cost === 'number' && pricing.cost > 0) ? pricing.cost : null;
  var costSource = recipe ? (recipe.name || recipe.recipeId) : null;
  function _markup(price) {
    return (costNum != null && price != null && price > 0) ? (price / costNum) : null;
  }
  function _margin(price) {
    return (price != null && price > 0) ? ((price - (costNum || 0)) / price * 100) : null;
  }

  // Top row — cost basis + Edit button. Shown in both view and edit modes
  // so the user always sees what cost they're pricing against. Edit button
  // hides while editing.
  html += '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:14px;flex-wrap:wrap;">';
  html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);">';
  if (costNum != null) {
    html += '<span style="font-weight:600;">Cost</span> <span style="font-family:monospace;font-weight:600;">$' + costNum.toFixed(2) + '</span>';
    if (costSource) {
      html += ' <span style="opacity:0.7;font-size:0.85rem;">from recipe ' + esc(costSource) + '</span>';
      html += ' <button class="btn btn-secondary btn-small" style="margin-left:8px;font-size:0.78rem;padding:3px 10px;" onclick="window.makerOpenRecipeBuilder && window.makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\',\'' + esc(variant.id) + '\')">Open Recipe →</button>';
    }
  } else if (recipe) {
    html += '<span style="opacity:0.7;">Cost not yet computed — open the recipe to set materials and labor.</span>';
    html += ' <button class="btn btn-secondary btn-small" style="margin-left:8px;font-size:0.78rem;padding:3px 10px;" onclick="window.makerOpenRecipeBuilder && window.makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\',\'' + esc(variant.id) + '\')">Open Recipe →</button>';
  } else {
    html += '<span style="opacity:0.7;">No recipe linked. Markups can\'t be computed without a cost basis.</span>';
  }
  html += '</div>';
  if (!isEditingPricing) {
    html += '<button class="btn btn-secondary btn-small" onclick="startEditVariantPricing(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Edit Pricing</button>';
  }
  html += '</div>';

  // Cost composition — show what's driving the cost number. Mirrors the
  // recipe's Total Cost block so the connection between recipe and pricing
  // is visible without leaving the page. Visible in both modes — read-only
  // context that doesn't conflict with the pricing form.
  if (recipe && costNum != null) {
    var rOverride = recipe.variants && recipe.variants[variant.id];
    var laborMin = (rOverride && typeof rOverride.laborMinutes === 'number')
      ? rOverride.laborMinutes : (recipe.laborMinutes || 0);
    var laborRate = recipe.laborRatePerHour || 0;
    var laborCost = (laborMin > 0 && laborRate > 0) ? (laborMin / 60) * laborRate : 0;
    var otherCost = (rOverride && typeof rOverride.otherCost === 'number')
      ? rOverride.otherCost : (recipe.otherCost || 0);
    var perUnitSetup = (recipe.setupCost || 0) / Math.max(1, recipe.batchSize || 1);
    var overhead = otherCost + perUnitSetup;
    var materialsCost = Math.max(0, costNum - laborCost - overhead);
    var lineItemsObj = (rOverride && rOverride.lineItems) || recipe.lineItems || {};
    var lineCount = Object.keys(lineItemsObj).length;

    function _ccChip(label, value, sub) {
      return '<div style="flex:1;min-width:140px;padding:12px 14px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;background:rgba(255,255,255,0.02);">' +
        '<div class="pd-tier-label" style="color:var(--text,#2a2a2a);text-transform:uppercase;font-weight:600;margin-bottom:6px;">' + label + '</div>' +
        '<div style="font-family:monospace;font-size:1.15rem;font-weight:600;color:var(--text,#2a2a2a);">$' + value.toFixed(2) + '</div>' +
        (sub ? '<div style="font-size:0.85rem;color:var(--text,#2a2a2a);opacity:0.75;margin-top:4px;">' + sub + '</div>' : '') +
      '</div>';
    }
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px;">';
    html += _ccChip('Materials', materialsCost, lineCount + (lineCount === 1 ? ' BOM line' : ' BOM lines'));
    html += _ccChip('Labor', laborCost,
      laborMin > 0 && laborRate > 0
        ? laborMin + ' min @ $' + laborRate.toFixed(2) + '/hr'
        : (laborMin > 0 ? laborMin + ' min · no rate set' : 'no labor logged'));
    var ovSub = [];
    if (otherCost > 0) ovSub.push('other $' + otherCost.toFixed(2));
    if (perUnitSetup > 0) ovSub.push('setup $' + perUnitSetup.toFixed(2));
    html += _ccChip('Overhead', overhead, ovSub.length ? ovSub.join(' · ') : 'none');
    html += '</div>';

    // Variant override indicator — when this real variant deviates from the
    // base recipe (different BOM, labor, or other-cost). Synthetic Default
    // is the base; never shows the badge.
    if (!variant._isSynthetic && rOverride) {
      var diffs = [];
      if (rOverride.lineItems) diffs.push('BOM');
      if (typeof rOverride.laborMinutes === 'number') diffs.push('labor');
      if (typeof rOverride.otherCost === 'number') diffs.push('overhead');
      if (diffs.length > 0) {
        html += '<div style="font-size:0.9rem;color:var(--teal,#2a7c6f);font-weight:600;margin-bottom:14px;">' +
          '&#x21B3; Variant cost override active &mdash; this variant has its own ' +
          diffs.join(' + ') + ' on the recipe.' +
        '</div>';
      }
    } else if (!variant._isSynthetic && !rOverride) {
      html += '<div style="font-size:0.85rem;color:var(--text,#2a2a2a);opacity:0.7;margin-bottom:14px;">' +
        '&#x21B3; Inherits cost from the base recipe (no variant override).' +
      '</div>';
    }

    // Spot drift indicator — surface the same awareness signal the recipe
    // shows. Only when this product's recipe has a snapshot to compare and
    // we have current spot prices in module memory.
    var spotCur = (typeof window.makerGetSpotPricesCurrent === 'function')
      ? window.makerGetSpotPricesCurrent() : null;
    if (recipe.spotSnapshot && spotCur) {
      var spotMoves = [];
      ['gold', 'silver', 'platinum'].forEach(function(metal) {
        var was = recipe.spotSnapshot[metal];
        var now = spotCur[metal];
        if (typeof was !== 'number' || typeof now !== 'number' || was <= 0) return;
        var pct = (now - was) / was * 100;
        if (Math.abs(pct) >= 0.5) spotMoves.push({ metal: metal, pct: pct });
      });
      if (spotMoves.length > 0) {
        html += '<div style="font-size:0.85rem;color:#b45309;margin-bottom:14px;">' +
          '&#x21B3; Spot moved since last recipe save: ' +
          spotMoves.map(function(m) {
            var arrow = m.pct > 0 ? '↑' : '↓';
            return arrow + ' ' + m.metal.charAt(0).toUpperCase() + m.metal.slice(1) +
              ' ' + (m.pct > 0 ? '+' : '') + m.pct.toFixed(1) + '%';
          }).join(' &middot; ') +
        '</div>';
      }
    }
  }

  // Cost-changed notice — fired when the recipe's totalCost has moved away
  // from the cost basis the current prices were computed against. The
  // baseline lives on product.pricingCostBaseline so the user can see
  // "your prices were set when cost was $X, cost is now $Y".
  var baseline = (typeof product.pricingCostBaseline === 'number') ? product.pricingCostBaseline : null;
  if (!isEditingPricing && variant._isSynthetic && costNum != null && baseline != null && Math.abs(costNum - baseline) >= 0.01) {
    var pctDelta = baseline > 0 ? ((costNum - baseline) / baseline * 100) : 0;
    var dirArrow = costNum > baseline ? 'up' : 'down';
    html += '<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);border-radius:8px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">';
    html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);">' +
      '<strong>Cost ' + dirArrow + ' ' + Math.abs(pctDelta).toFixed(1) + '%</strong>' +
      ' since prices were last set ($' + baseline.toFixed(2) + ' &rarr; $' + costNum.toFixed(2) + '). ' +
      'Re-derive prices from the new cost using the current markups, or accept the drift.' +
    '</div>';
    html += '<div style="display:flex;gap:6px;">';
    html += '<button class="btn btn-primary btn-small" onclick="rederivePricesFromCost(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Re-derive prices</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="acceptCostBaseline(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Accept drift</button>';
    html += '</div>';
    html += '</div>';
  }

  if (isEditingPricing) {
    function _val(v) { return (v != null) ? v.toFixed(2) : ''; }
    function _mval(v) { return (v != null && v > 0) ? v.toFixed(2) : ''; }
    function _editTier(key, label, price, fallbackMarkup) {
      var markup = _markup(price);
      var displayMarkup = markup != null ? markup : (fallbackMarkup || null);
      return '<div style="border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:12px 14px;">' +
        '<div class="pd-tier-label" style="color:var(--text,#2a2a2a);text-transform:uppercase;font-weight:600;margin-bottom:10px;">' + label + '</div>' +
        '<label style="display:flex;flex-direction:column;gap:4px;margin-bottom:8px;">' +
          '<span style="font-size:0.78rem;color:var(--text,#2a2a2a);opacity:0.8;">Price ($)</span>' +
          '<input type="text" id="vp_' + key + '_' + esc(variant.id) + '" value="' + _val(price) + '" placeholder="0.00" oninput="syncVariantPriceMarkup(\'' + key + '\',\'' + esc(variant.id) + '\',\'price\')" style="padding:7px 10px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;font-family:monospace;font-size:0.9rem;">' +
        '</label>' +
        '<label style="display:flex;flex-direction:column;gap:4px;">' +
          '<span style="font-size:0.78rem;color:var(--text,#2a2a2a);opacity:0.8;">Markup (× cost)</span>' +
          '<input type="text" id="vpm_' + key + '_' + esc(variant.id) + '" value="' + _mval(displayMarkup) + '" placeholder="2.50" oninput="syncVariantPriceMarkup(\'' + key + '\',\'' + esc(variant.id) + '\',\'markup\')" style="padding:7px 10px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;font-family:monospace;font-size:0.9rem;">' +
        '</label>' +
      '</div>';
    }
    // Stash cost on the form so syncVariantPriceMarkup can find it.
    html += '<input type="hidden" id="vp_cost_' + esc(variant.id) + '" value="' + (costNum != null ? costNum.toFixed(4) : '') + '">';
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px;">';
    var _defMu = _getEffectiveDefaultMarkups(product);
    html += _editTier('wholesale', 'Wholesale', pricing.wholesale, (recipe && recipe.wholesaleMarkup != null) ? recipe.wholesaleMarkup : _defMu.wholesale);
    html += _editTier('direct',    'Direct',    pricing.direct,    (recipe && recipe.directMarkup    != null) ? recipe.directMarkup    : _defMu.direct);
    html += _editTier('retail',    'Retail',    pricing.retail,    (recipe && recipe.retailMarkup    != null) ? recipe.retailMarkup    : _defMu.retail);
    html += '</div>';
    html += '<div style="font-size:0.85rem;color:var(--text,#2a2a2a);opacity:0.75;margin-bottom:12px;">Edit either Price or Markup; the other recomputes from cost.</div>';
    if (hasMultipleVariants) {
      html += '<div style="margin-bottom:12px;font-size:0.85rem;">';
      html += '<span style="color:var(--text,#2a2a2a);opacity:0.8;margin-right:12px;">Apply to:</span>';
      html += '<label style="margin-right:16px;cursor:pointer;"><input type="radio" name="vpScope_' + esc(variant.id) + '" value="this" checked> This variant only</label>';
      html += '<label style="cursor:pointer;"><input type="radio" name="vpScope_' + esc(variant.id) + '" value="all"> All variants</label>';
      html += '</div>';
    }
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-primary btn-small" onclick="saveVariantPricing(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Save</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="cancelEditVariantPricing()">Cancel</button>';
    html += '</div>';
  } else {
    // View mode — three tier cards with price, markup, margin, and a
    // Set Active radio. Active tier is the price the storefront sells at.
    var activeTier = pricing.activeTier || (recipe && recipe.activePriceTier) || null;
    function _viewTier(key, label, price) {
      var isActive = activeTier === key;
      var cls = isActive ? '' : 'pd-tier-card-inactive';
      var bg = isActive ? 'background:rgba(42,124,111,0.10);border:1px solid rgba(42,124,111,0.25);' : 'background:transparent;border:1px solid var(--cream-dark,#e8e0d4);';
      var lc = isActive ? 'var(--teal,#2a7c6f)' : 'var(--text,#2a2a2a)';
      var vc = isActive ? 'var(--teal,#2a7c6f)' : 'var(--text,#2a2a2a)';
      var w = isActive ? '700' : '600';
      var priceTxt = (price != null) ? '$' + price.toFixed(2) : '—';
      var markup = _markup(price);
      var margin = _margin(price);
      var markupTxt = (markup != null) ? markup.toFixed(2) + '× cost' : '—';
      var marginTxt = (margin != null) ? margin.toFixed(1) + '% margin' : '';
      var activeBtn = isActive
        ? '<span style="font-size:0.78rem;color:var(--teal,#2a7c6f);font-weight:600;">Active tier</span>'
        : '<button class="btn btn-secondary btn-small" style="font-size:0.78rem;padding:3px 10px;" onclick="setActivePricingTier(\'' + esc(pid) + '\',\'' + key + '\')">Set active</button>';
      return '<div class="' + cls + '" style="flex:1;min-width:160px;padding:14px 18px;border-radius:8px;' + bg + '">' +
        '<div class="pd-tier-label" style="color:' + lc + ';text-transform:uppercase;font-weight:600;margin-bottom:8px;">' + label + '</div>' +
        '<div style="font-family:monospace;font-size:1.6rem;font-weight:' + w + ';color:' + vc + ';margin-bottom:6px;">' + priceTxt + '</div>' +
        '<div style="font-size:0.85rem;color:var(--text,#2a2a2a);margin-bottom:2px;">' + markupTxt + '</div>' +
        (marginTxt ? '<div style="font-size:0.85rem;color:var(--text,#2a2a2a);opacity:0.75;margin-bottom:10px;">' + marginTxt + '</div>' : '<div style="margin-bottom:10px;"></div>') +
        '<div>' + activeBtn + '</div>' +
      '</div>';
    }
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
    html += _viewTier('wholesale', 'Wholesale', pricing.wholesale);
    html += _viewTier('direct',    'Direct',    pricing.direct);
    html += _viewTier('retail',    'Retail',    pricing.retail);
    html += '</div>';

    // Min margin floor — visible on synthetic Default, applies to whichever
    // tier is active. Warns when the active tier's margin drops below it.
    if (variant._isSynthetic) {
      var minMarginVal = (typeof product.minMarginPercent === 'number') ? product.minMarginPercent : null;
      var activeMargin = null;
      if (activeTier === 'wholesale') activeMargin = _margin(pricing.wholesale);
      else if (activeTier === 'direct') activeMargin = _margin(pricing.direct);
      else if (activeTier === 'retail') activeMargin = _margin(pricing.retail);
      var floorViolated = (minMarginVal != null && activeMargin != null && activeMargin < minMarginVal);
      html += '<div style="margin-top:14px;padding:12px 14px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">';
      html += '<label style="font-size:0.9rem;color:var(--text,#2a2a2a);font-weight:600;">Minimum margin floor</label>';
      html += '<input type="number" min="0" max="100" step="1" value="' + (minMarginVal != null ? minMarginVal : '') + '" placeholder="off" id="vp_minmargin_' + esc(pid) + '" onchange="setMinMarginFloor(\'' + esc(pid) + '\', this.value)" style="width:90px;padding:6px 10px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;font-family:monospace;font-size:0.9rem;">';
      html += '<span style="font-size:0.85rem;color:var(--text,#2a2a2a);opacity:0.75;">% — active tier margin must stay above this; leave blank to disable.</span>';
      if (floorViolated) {
        html += '<div style="flex-basis:100%;font-size:0.9rem;color:#b45309;font-weight:600;margin-top:6px;">Active tier margin (' + activeMargin.toFixed(1) + '%) is below the floor.</div>';
      }
      html += '</div>';
    }
  }
  return html;
}

function renderVariantRecipeTab(product, variant, recipe) {
  var html = '';
  var pid = product.pid || '';
  if (!recipe) {
    html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">';
    html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);">No recipe linked to this product yet. A recipe drives cost and price calculations across all variants.</div>';
    html += '<div style="display:flex;gap:6px;">';
    html += '<button class="btn btn-secondary btn-small" onclick="openLinkRecipeDialog(\'' + esc(pid) + '\')">Link existing recipe…</button>';
    html += '<button class="btn btn-primary btn-small" onclick="addRecipeForProduct(\'' + esc(pid) + '\')">+ Create Recipe</button>';
    html += '</div></div>';
    return html;
  }
  var override = recipe.variants && recipe.variants[variant.id];
  var sourceTxt = variant._isSynthetic
    ? 'Base recipe — values shared with all variants unless overridden'
    : (override ? 'Variant override active' : 'Inherits from base recipe');
  var sourceColor = variant._isSynthetic
    ? 'var(--text,#2a2a2a)'
    : (override ? 'var(--teal,#2a7c6f)' : 'var(--text,#2a2a2a)');

  // Header row: name + status + Open Recipe button.
  html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px;">';
  html += '<div style="flex:1;min-width:200px;">';
  html += '<div style="font-size:1.15rem;font-weight:600;color:var(--text,#2a2a2a);margin-bottom:6px;">' + esc(recipe.name || recipe.recipeId) + '</div>';
  html += '<div style="font-size:0.9rem;color:' + sourceColor + ';">' + esc(sourceTxt) + '</div>';
  if (recipe.costsDirty) {
    html += '<div style="margin-top:10px;color:#b45309;background:rgba(245,158,11,0.16);padding:6px 12px;border-radius:8px;font-size:0.9rem;font-weight:500;display:inline-block;">⚠ Cost recalc needed</div>';
  }
  html += '</div>';
  html += '<button class="btn btn-primary btn-small" onclick="window.makerOpenRecipeBuilder && window.makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\',\'' + esc(variant.id) + '\')">Open Recipe →</button>';
  html += '</div>';

  // Cost breakdown grid — pulls the raw numbers the recipe carries so the
  // user can see WHERE the cost comes from without leaving the panel.
  var lineItemKeys = recipe.lineItems ? Object.keys(recipe.lineItems) : [];
  var lineItemCount = lineItemKeys.length;
  // Materials cost = totalCost - labor - other - setup, when those are known.
  var laborMins = (override && typeof override.laborMinutes === 'number') ? override.laborMinutes
    : (typeof recipe.laborMinutes === 'number' ? recipe.laborMinutes : null);
  var laborRate = (typeof recipe.laborRatePerHour === 'number') ? recipe.laborRatePerHour : null;
  var laborCost = (laborMins != null && laborRate != null) ? (laborMins / 60) * laborRate : null;
  var otherCost = (typeof recipe.otherCost === 'number') ? recipe.otherCost : null;
  var setupCost = (typeof recipe.setupCost === 'number') ? recipe.setupCost : null;
  var batchSize = (typeof recipe.batchSize === 'number' && recipe.batchSize > 0) ? recipe.batchSize : null;
  var totalCost = (typeof recipe.totalCost === 'number') ? recipe.totalCost : null;

  function _stat(label, value, sub) {
    return '<div style="flex:1;min-width:130px;padding:12px 16px;border-radius:8px;border:1px solid var(--cream-dark,#e8e0d4);background:var(--surface-card,#fff);">' +
      '<div class="pd-tier-label" style="color:var(--text,#2a2a2a);text-transform:uppercase;font-weight:600;margin-bottom:6px;">' + label + '</div>' +
      '<div style="font-family:monospace;font-size:1.15rem;font-weight:600;color:var(--text,#2a2a2a);">' + value + '</div>' +
      (sub ? '<div style="font-size:0.85rem;color:var(--text,#2a2a2a);opacity:0.7;margin-top:4px;">' + sub + '</div>' : '') +
    '</div>';
  }
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;">';
  html += _stat('Total Cost', totalCost != null ? '$' + totalCost.toFixed(2) : '—',
    batchSize && batchSize > 1 ? 'per unit · batch of ' + batchSize : null);
  html += _stat('Materials', lineItemCount + (lineItemCount === 1 ? ' item' : ' items'),
    lineItemCount > 0 ? 'BOM lines on recipe' : 'No materials added');
  if (laborMins != null) {
    html += _stat('Labor', laborMins + ' min',
      laborCost != null ? '$' + laborCost.toFixed(2) + (laborRate ? ' @ $' + laborRate.toFixed(2) + '/hr' : '') : null);
  }
  if (otherCost || setupCost) {
    var extraVal = '$' + ((otherCost || 0) + (setupCost || 0)).toFixed(2);
    var extraSub = [];
    if (otherCost) extraSub.push('other $' + otherCost.toFixed(2));
    if (setupCost) extraSub.push('setup $' + setupCost.toFixed(2));
    html += _stat('Other', extraVal, extraSub.join(' · '));
  }
  html += '</div>';

  // Tier markups summary — shows how cost rolls up to each price tier.
  var ws = (typeof recipe.wholesaleMarkup === 'number') ? recipe.wholesaleMarkup : null;
  var dr = (typeof recipe.directMarkup === 'number') ? recipe.directMarkup : null;
  var rt = (typeof recipe.retailMarkup === 'number') ? recipe.retailMarkup : null;
  if (ws != null || dr != null || rt != null) {
    html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);margin-bottom:8px;font-weight:600;">Tier markups</div>';
    html += '<div style="display:flex;gap:14px;flex-wrap:wrap;font-size:0.9rem;color:var(--text,#2a2a2a);">';
    if (ws != null) html += '<span><span style="opacity:0.7;">Wholesale</span> <span style="font-family:monospace;font-weight:600;">' + ws.toFixed(2) + '×</span></span>';
    if (dr != null) html += '<span><span style="opacity:0.7;">Direct</span> <span style="font-family:monospace;font-weight:600;">' + dr.toFixed(2) + '×</span></span>';
    if (rt != null) html += '<span><span style="opacity:0.7;">Retail</span> <span style="font-family:monospace;font-weight:600;">' + rt.toFixed(2) + '×</span></span>';
    if (recipe.activePriceTier) {
      html += '<span style="margin-left:auto;color:var(--teal,#2a7c6f);font-weight:600;">Active tier: ' + esc(recipe.activePriceTier) + '</span>';
    }
    html += '</div>';
  }
  return html;
}

function renderVariantChannelsTab(product, variant, channels) {
  var pid = product.pid || '';
  var bindings = (typeof getProductChannelBindings === 'function')
    ? getProductChannelBindings(product) : [];
  var cache = window.__mastChannelsCache || {};
  var html = '';

  // Top row: header + actions for jumping to product channel bindings or
  // the global channel strategy admin.
  html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:14px;">';
  html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);max-width:520px;line-height:1.5;">' +
    (variant._isSynthetic
      ? 'Channels published from this product. Variants inherit unless explicitly excluded on a channel.'
      : 'Channels this variant is published on. A binding can exclude individual variants.') +
    '</div>';
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">';
  html += '<button class="btn btn-secondary btn-small" onclick="editProduct(\'' + esc(pid) + '\')" title="Open Edit Info to set per-product channel bindings">Manage Bindings</button>';
  html += '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'channels\')" title="Open the Channels admin to configure channel strategy globally">Channel Strategy ↗</button>';
  html += '</div>';
  html += '</div>';

  // Per-channel rows: name + status (Live / Excluded / Not bound) + per-row
  // action (Publish / Exclude / Include this variant).
  if (!bindings.length) {
    html += '<div style="padding:14px 16px;border:1px dashed var(--cream-dark,#e8e0d4);border-radius:10px;font-size:0.9rem;color:var(--text,#2a2a2a);">' +
      '<strong>Not published on any channel.</strong> Open Edit Info to bind this product to a channel, or visit Channel Strategy to add a new channel first.' +
    '</div>';
    return html;
  }

  html += '<div style="border:1px solid var(--cream-dark,#e8e0d4);border-radius:10px;overflow:hidden;">';
  bindings.forEach(function(b, idx) {
    var ch = cache[b.channelId];
    var name = (ch && (ch.name || ch.label)) || b.channelId;
    var excluded = Array.isArray(b.excludedVariantIds) && !variant._isSynthetic
      && b.excludedVariantIds.indexOf(variant.id) !== -1;
    var status, statusColor, statusBg;
    if (variant._isSynthetic) {
      status = 'Live';
      statusColor = 'var(--teal,#2a7c6f)';
      statusBg = 'rgba(42,124,111,0.16)';
    } else if (excluded) {
      status = 'Excluded';
      statusColor = '#b45309';
      statusBg = 'rgba(245,158,11,0.18)';
    } else {
      status = 'Live';
      statusColor = 'var(--teal,#2a7c6f)';
      statusBg = 'rgba(42,124,111,0.16)';
    }
    var rowAction = '';
    if (!variant._isSynthetic) {
      rowAction = excluded
        ? '<button class="btn btn-secondary btn-small" onclick="includeVariantOnChannel(\'' + esc(pid) + '\',\'' + esc(b.channelId) + '\',\'' + esc(variant.id) + '\')">Include this variant</button>'
        : '<button class="btn btn-secondary btn-small" onclick="excludeVariantFromChannel(\'' + esc(pid) + '\',\'' + esc(b.channelId) + '\',\'' + esc(variant.id) + '\')">Exclude this variant</button>';
    }
    html += '<div style="display:grid;grid-template-columns:1.5fr auto auto;gap:14px;align-items:center;padding:14px 16px;' +
      (idx < bindings.length - 1 ? 'border-bottom:1px solid var(--cream-dark,#e8e0d4);' : '') + '">' +
      '<div style="font-size:1rem;font-weight:600;color:var(--text,#2a2a2a);">' + esc(name) + '</div>' +
      '<span style="background:' + statusBg + ';color:' + statusColor + ';padding:4px 12px;border-radius:12px;font-size:0.85rem;font-weight:600;">' + status + '</span>' +
      '<div style="text-align:right;">' + rowAction + '</div>' +
    '</div>';
  });
  html += '</div>';
  return html;
}

function renderVariantInventoryTab(product, variant) {
  var pid = product.pid || '';
  var inv = inventory[pid] || {};
  var stockType = (inv && inv.stockType) ? inv.stockType : 'made-to-order';
  var stockKey = variant._isSynthetic ? '_default' : variant.id;
  var entry = (inv.stock && typeof inv.stock === 'object') ? inv.stock[stockKey] : null;
  if (!entry && variant._isSynthetic && typeof inv.stock === 'number') {
    entry = { onHand: inv.stock, committed: 0, held: 0, damaged: 0 };
  }
  var onH = (entry && entry.onHand) || 0;
  var com = (entry && entry.committed) || 0;
  var hel = (entry && entry.held) || 0;
  var dam = (entry && entry.damaged) || 0;
  var avail = Math.max(0, onH - com - hel - dam);

  var isEditing = window.__editingVariantInventory &&
    window.__editingVariantInventory.pid === pid &&
    window.__editingVariantInventory.variantId === variant.id;
  var html = '';

  if (isEditing) {
    html += '<div class="pd-tier-label" style="color:var(--text,#2a2a2a);text-transform:uppercase;font-weight:600;margin-bottom:12px;">Stock Adjustment</div>';
    html += '<div style="display:flex;gap:24px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px;">';
    // Current count — read-only display.
    html += '<div>' +
      '<div style="font-size:0.85rem;color:var(--text,#2a2a2a);font-weight:600;margin-bottom:6px;">Current</div>' +
      '<div style="font-family:monospace;font-size:1.15rem;font-weight:600;color:var(--text,#2a2a2a);padding:8px 12px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;background:rgba(255,255,255,0.02);min-width:80px;text-align:center;">' + onH + '</div>' +
    '</div>';
    // Arrow → New count input.
    html += '<div style="font-size:1.15rem;color:var(--text,#2a2a2a);opacity:0.6;padding-bottom:10px;">→</div>';
    html += '<label style="display:flex;flex-direction:column;gap:6px;">' +
      '<span style="font-size:0.85rem;color:var(--text,#2a2a2a);font-weight:600;">New count</span>' +
      '<input type="number" id="vi_onhand_' + esc(variant.id) + '" min="0" value="' + onH + '" style="width:120px;padding:8px 10px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;font-family:monospace;font-size:1.15rem;font-weight:600;">' +
    '</label>';
    if (com > 0) {
      html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);padding-bottom:10px;"><span style="font-weight:600;">' + com + '</span> committed</div>';
    }
    html += '</div>';
    // Reason dropdown.
    html += '<label style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-width:300px;">' +
      '<span style="font-size:0.85rem;color:var(--text,#2a2a2a);font-weight:600;">Adjustment reason</span>' +
      '<select id="vi_reason_' + esc(variant.id) + '" style="padding:8px 10px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--surface-card,#fff);color:var(--text,#2a2a2a);">' +
        '<option value="recount">Recount</option>' +
        '<option value="production">Increase from production</option>' +
        '<option value="received">Stock received (purchased)</option>' +
        '<option value="damage">Damage</option>' +
        '<option value="loss">Loss / shrinkage</option>' +
        '<option value="sale">Manual sale</option>' +
        '<option value="other">Other</option>' +
      '</select>' +
    '</label>';
    // Optional notes.
    html += '<label style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px;">' +
      '<span style="font-size:0.85rem;color:var(--text,#2a2a2a);font-weight:600;">Notes <span style="font-weight:400;opacity:0.7;">(optional)</span></span>' +
      '<input type="text" id="vi_notes_' + esc(variant.id) + '" placeholder="Anything worth recording about this adjustment" style="padding:8px 10px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;background:var(--surface-card,#fff);color:var(--text,#2a2a2a);">' +
    '</label>';
    html += '<div style="display:flex;gap:8px;">';
    html += '<button class="btn btn-primary btn-small" onclick="saveVariantInventory(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Save</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="cancelEditVariantInventory()">Cancel</button>';
    html += '</div>';
    return html;
  }

  // View mode — Edit button + stock tiles, matching the Pricing tab layout.
  html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px;">';
  html += '<div></div>';
  html += '<button class="btn btn-secondary btn-small" onclick="startEditVariantInventory(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Edit Stock</button>';
  html += '</div>';
  if (stockType === 'build-to-order' || stockType === 'made-to-order') {
    html += '<div style="font-size:1rem;color:var(--text,#2a2a2a);">Build to order — no stock tracked. Click Edit Stock to start tracking.</div>';
    return html;
  }
  var availColor = avail <= 0 ? 'var(--danger,#dc2626)' : 'var(--text,#2a2a2a)';
  function _stat(label, value, color) {
    return '<div style="flex:1;min-width:110px;padding:14px 18px;border-radius:8px;border:1px solid var(--cream-dark,#e8e0d4);">' +
      '<div class="pd-tier-label" style="color:var(--text,#2a2a2a);text-transform:uppercase;font-weight:600;margin-bottom:8px;">' + label + '</div>' +
      '<div style="font-family:monospace;font-size:1.15rem;font-weight:600;color:' + (color || 'var(--text,#2a2a2a)') + ';">' + value + '</div>' +
    '</div>';
  }
  html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
  html += _stat('On Hand', onH);
  html += _stat('Available', avail, availColor);
  if (com > 0) html += _stat('Committed', com, 'var(--warm-gray,#888)');
  if (hel > 0) html += _stat('Held', hel, '#b45309');
  if (dam > 0) html += _stat('Damaged', dam, 'var(--danger,#dc2626)');
  html += '</div>';
  return html;
}

function renderVariantImageTab(product, variant) {
  var pid = product.pid || '';
  var productImages = Array.isArray(product.images) ? product.images : [];
  var resolveImg = function(img) { return (typeof img === 'string') ? img : (img && img.url) || ''; };

  if (productImages.length === 0) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">' +
      '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);">No product images yet. Upload one via Manage Images above before binding a variant image.</div>' +
      '<button class="btn btn-secondary btn-small" onclick="toggleProductImagesPanel(\'' + esc(pid) + '\')">Manage Images ↑</button>' +
    '</div>';
  }

  // Synthetic Default uses the product hero (images[0]). Binding doesn't
  // apply — to change Default's image, reorder via Manage Images.
  if (variant._isSynthetic) {
    var heroUrl = resolveImg(productImages[0]);
    var html = '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;">';
    html += heroUrl
      ? '<img src="' + esc(heroUrl) + '" alt="" style="width:108px;height:108px;object-fit:cover;border-radius:10px;border:3px solid var(--teal,#2a7c6f);display:block;">'
      : '<div style="width:108px;height:108px;border-radius:10px;border:2px dashed var(--cream-dark,#e8e0d4);"></div>';
    html += '<div style="flex:1;min-width:200px;font-size:0.9rem;color:var(--text,#2a2a2a);line-height:1.5;">' +
      'Default uses the product hero (Image #1). To change it, reorder images via Manage Images.' +
    '</div>';
    html += '<button class="btn btn-secondary btn-small" onclick="toggleProductImagesPanel(\'' + esc(pid) + '\')">Manage Images ↑</button>';
    html += '</div>';
    return html;
  }

  var currentImageIdx = (typeof variant.imageIndex === 'number' && variant.imageIndex >= 0 && variant.imageIndex < productImages.length)
    ? variant.imageIndex : -1;

  // Real variant — picker grid only. Bound thumb gets a thicker teal border.
  // Click bound thumb to clear; click another thumb to switch.
  var html = '<div style="display:flex;gap:12px;flex-wrap:wrap;">';
  productImages.forEach(function(img, i) {
    var url = resolveImg(img);
    if (!url) return;
    var sel = i === currentImageIdx;
    var border = sel ? '4px solid var(--teal,#2a7c6f)' : '2px solid var(--cream-dark,#e8e0d4)';
    var clickIdx = sel ? -1 : i;
    var titleTxt = sel ? 'Click to clear binding' : 'Bind Image #' + (i + 1) + ' to this variant';
    html += '<button onclick="bindVariantImage(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\',' + clickIdx + ')" ' +
      'title="' + titleTxt + '" ' +
      'style="position:relative;width:120px;height:120px;border-radius:10px;overflow:hidden;border:' + border + ';padding:0;cursor:pointer;background:none;transition:transform 0.1s;" ' +
      'onmouseover="this.style.transform=\'scale(1.04)\'" onmouseout="this.style.transform=\'scale(1)\'">' +
      '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">' +
      '</button>';
  });
  html += '</div>';
  return html;
}

function _expandedVariantKey(pid, variantId) { return 'mastVariantExpanded_' + pid + '_' + variantId; }

function renderVariantRow(product, variant, recipe, idx) {
  var pid = product.pid || '';
  var label = variantComboLabel(variant);
  var pricing = variantCostAndPrice(product, variant, recipe);
  var channels = variantChannelNames(product, variant);
  var isExpanded = false;
  try { isExpanded = sessionStorage.getItem(_expandedVariantKey(pid, variant.id)) === '1'; } catch (e) {}

  var costTxt = pricing.cost != null ? '$' + pricing.cost.toFixed(2) : '—';
  var retailTxt = pricing.retail != null ? '$' + pricing.retail.toFixed(2) : '—';
  var channelsTxt = channels.length
    ? channels.map(function(n) { return '<span style="background:rgba(42,124,111,0.12);color:var(--teal,#2a7c6f);padding:3px 10px;border-radius:11px;font-size:0.72rem;font-weight:500;margin-right:4px;">' + esc(n) + '</span>'; }).join('')
    : '<span style="color:var(--warm-gray-light,#aaa);font-size:0.85rem;font-style:italic;">No channels</span>';

  var isLast = idx === ((Array.isArray(product.variants) && product.variants.length) || 1) - 1;
  var html = '';
  html += '<div style="' + (isLast ? '' : 'border-bottom:1px solid var(--cream-dark,#e8e0d4);') + '">';
  html += '<div style="display:grid;grid-template-columns:28px 1.5fr 1fr 1fr 1.5fr;gap:16px;align-items:center;padding:14px 18px;cursor:pointer;transition:background 0.15s;" ' +
    'onmouseover="this.style.background=\'rgba(42,124,111,0.04)\'" onmouseout="this.style.background=\'transparent\'" ' +
    'onclick="toggleVariantExpanded(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">';
  html += '<span style="color:var(--teal,#2a7c6f);user-select:none;font-size:0.85rem;font-weight:600;">' + (isExpanded ? '▾' : '▸') + '</span>';
  html += '<span style="font-size:0.9rem;font-weight:500;color:var(--text,#2a2a2a);">' + esc(label) + '</span>';
  html += '<span style="font-size:0.85rem;"><span style="color:var(--warm-gray,#888);">Cost</span> <span style="font-family:monospace;color:var(--text,#2a2a2a);">' + costTxt + '</span></span>';
  html += '<span style="font-size:0.85rem;"><span style="color:var(--warm-gray,#888);">Retail</span> <span style="font-family:monospace;font-weight:600;color:var(--text,#2a2a2a);">' + retailTxt + '</span></span>';
  html += '<span style="text-align:right;">' + channelsTxt + '</span>';
  html += '</div>';
  if (isExpanded) {
    html += renderVariantExpanded(product, variant, recipe, pricing, channels);
  }
  html += '</div>';
  return html;
}

function renderVariantExpanded(product, variant, recipe, pricing, channels) {
  var pid = product.pid || '';
  var isEditingPricing = window.__editingVariantPricing &&
    window.__editingVariantPricing.pid === pid &&
    window.__editingVariantPricing.variantId === variant.id;
  var hasMultipleVariants = Array.isArray(product.variants) && product.variants.length > 1;

  // Variant sections are filtered by section context. Each row carries a
  // marker — render only when the current view wants it:
  //   develop: Recipe (primary), Pricing, Image
  //   catalog: All sections
  //   sell:    Pricing, Image, Channels (primary), Inventory, Recipe (link only)
  var section = (typeof productSection === 'string') ? productSection : 'catalog';
  var showRecipe    = section === 'develop' || section === 'catalog' || section === 'sell';
  var recipeAsLink  = section === 'sell'; // sell view shows just the open-link, not full recipe metadata
  var showPricing   = true;
  var showImage     = true;
  var showChannels  = section === 'catalog' || section === 'sell';
  var showInventory = section === 'catalog' || section === 'sell';

  function _label(text, action) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">' +
      '<div style="font-size:0.72rem;font-weight:600;color:var(--warm-gray,#888);text-transform:uppercase;letter-spacing:0.06em;">' + text + '</div>' +
      (action || '') +
      '</div>';
  }

  var html = '<div style="padding:18px 24px 22px 56px;background:rgba(42,124,111,0.025);border-top:1px solid var(--cream-dark,#e8e0d4);">';

  // Recipe section
  if (showRecipe) {
    html += '<div style="margin-bottom:18px;">';
    if (recipe) {
      var override = recipe.variants && recipe.variants[variant.id];
      var sourceTxt = override ? 'variant override' : 'inherits base';
      var recipeAction = '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();window.makerOpenRecipeBuilder && window.makerOpenRecipeBuilder(\'' + esc(recipe.recipeId) + '\',\'' + esc(variant.id) + '\')">Open Recipe →</button>';
      html += _label('Recipe', recipeAction);
      if (!recipeAsLink) {
        html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);">' +
          '<span style="font-weight:500;">' + esc(recipe.name || recipe.recipeId) + '</span>' +
          ' <span style="color:var(--warm-gray,#888);font-size:0.85rem;margin-left:6px;">· ' + sourceTxt + '</span>' +
          (recipe.costsDirty ? ' <span style="color:#b45309;background:rgba(245,158,11,0.12);padding:2px 8px;border-radius:8px;font-size:0.72rem;font-weight:500;margin-left:6px;">⚠ recalc needed</span>' : '') +
          '</div>';
      }
    } else {
      html += _label('Recipe', '');
      html += '<div style="font-size:0.9rem;color:var(--warm-gray-light,#aaa);font-style:italic;">No recipe linked to this product.</div>';
    }
    html += '</div>';
  }

  // Pricing — inline edit when this variant is being edited.
  html += '<div style="margin-bottom:18px;">';
  var pricingAction = !isEditingPricing
    ? '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();startEditVariantPricing(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Edit Pricing</button>'
    : '';
  html += _label('Pricing', pricingAction);

  if (isEditingPricing) {
    function _val(v) { return (v != null) ? v.toFixed(2) : ''; }
    html += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:8px;font-family:monospace;">';
    html += '<label style="display:flex;flex-direction:column;gap:4px;">' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);font-family:\'DM Sans\',sans-serif;">Wholesale ($)</span>' +
      '<input type="text" id="vp_wholesale_' + esc(variant.id) + '" value="' + _val(pricing.wholesale) + '" placeholder="0.00" onclick="event.stopPropagation()" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-family:monospace;">' +
      '</label>';
    html += '<label style="display:flex;flex-direction:column;gap:4px;">' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);font-family:\'DM Sans\',sans-serif;">Direct ($)</span>' +
      '<input type="text" id="vp_direct_' + esc(variant.id) + '" value="' + _val(pricing.direct) + '" placeholder="0.00" onclick="event.stopPropagation()" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-family:monospace;">' +
      '</label>';
    html += '<label style="display:flex;flex-direction:column;gap:4px;">' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);font-family:\'DM Sans\',sans-serif;">Retail ($)</span>' +
      '<input type="text" id="vp_retail_' + esc(variant.id) + '" value="' + _val(pricing.retail) + '" placeholder="0.00" onclick="event.stopPropagation()" style="padding:6px 8px;border:1px solid var(--border);border-radius:4px;font-family:monospace;">' +
      '</label>';
    html += '</div>';

    if (hasMultipleVariants) {
      html += '<div style="margin:8px 0;font-size:0.78rem;" onclick="event.stopPropagation()">';
      html += '<span style="color:var(--warm-gray);margin-right:8px;">Apply to:</span>';
      html += '<label style="margin-right:12px;cursor:pointer;"><input type="radio" name="vpScope_' + esc(variant.id) + '" value="this" checked> This variant only</label>';
      html += '<label style="cursor:pointer;"><input type="radio" name="vpScope_' + esc(variant.id) + '" value="all"> All variants</label>';
      html += '</div>';
    }

    html += '<div style="display:flex;gap:8px;" onclick="event.stopPropagation()">';
    html += '<button class="btn btn-primary btn-small" onclick="saveVariantPricing(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\')">Save</button>';
    html += '<button class="btn btn-secondary btn-small" onclick="cancelEditVariantPricing()">Cancel</button>';
    html += '</div>';
  } else {
    function tier(label, value, isActive) {
      var v = (value != null) ? '$' + value.toFixed(2) : '—';
      var bg = isActive ? 'background:rgba(42,124,111,0.10);border:1px solid rgba(42,124,111,0.25);' : 'background:transparent;border:1px solid var(--cream-dark,#e8e0d4);';
      var labelColor = isActive ? 'var(--teal,#2a7c6f)' : 'var(--warm-gray,#888)';
      var valColor = isActive ? 'var(--teal,#2a7c6f)' : 'var(--text,#2a2a2a)';
      var weight = isActive ? '600' : '500';
      return '<div style="flex:1;min-width:140px;padding:10px 14px;border-radius:8px;' + bg + '">' +
        '<div style="font-size:0.72rem;color:' + labelColor + ';text-transform:uppercase;letter-spacing:0.04em;font-weight:600;margin-bottom:4px;">' + label + (isActive ? ' · Active' : '') + '</div>' +
        '<div style="font-family:monospace;font-size:1.15rem;font-weight:' + weight + ';color:' + valColor + ';">' + v + '</div>' +
      '</div>';
    }
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
    html += tier('Wholesale', pricing.wholesale, pricing.activeTier === 'wholesale');
    html += tier('Direct',    pricing.direct,    pricing.activeTier === 'direct');
    html += tier('Retail',    pricing.retail,    pricing.activeTier === 'retail');
    html += '</div>';
  }
  html += '</div>';

  // Channels
  if (showChannels) {
  html += '<div style="margin-bottom:18px;">';
  html += _label('Channels', '');
  if (channels.length) {
    html += '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
      channels.map(function(n) {
        return '<span style="background:rgba(42,124,111,0.12);color:var(--teal,#2a7c6f);padding:4px 12px;border-radius:14px;font-size:0.85rem;font-weight:500;">' + esc(n) + '</span>';
      }).join('') +
      '</div>';
  } else {
    html += '<div style="font-size:0.9rem;color:var(--warm-gray-light,#aaa);font-style:italic;">Not published on any channel</div>';
  }
  html += '</div>';
  } // end showChannels

  // ── Variant Image binding ─────────────────────────────
  var productImages = Array.isArray(product.images) ? product.images : [];
  var resolveImg = function(img) { return (typeof img === 'string') ? img : (img && img.url) || ''; };
  var currentImageIdx = (typeof variant.imageIndex === 'number' && variant.imageIndex >= 0 && variant.imageIndex < productImages.length)
    ? variant.imageIndex : -1;
  html += '<div style="margin-bottom:18px;">';
  html += _label('Image', productImages.length > 0
    ? '<span style="font-size:0.78rem;color:var(--warm-gray);">Pick from product images</span>'
    : '<a href="#" onclick="event.preventDefault();event.stopPropagation();switchProductTab(\'images\');" style="color:var(--teal,#2a7c6f);font-size:0.85rem;text-decoration:none;font-weight:500;">Upload images →</a>');
  if (productImages.length === 0) {
    html += '<div style="font-size:0.9rem;color:var(--warm-gray-light,#aaa);font-style:italic;">No product images yet — upload some first to bind a variant image.</div>';
  } else {
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">';
    // "None" option
    var noneSel = currentImageIdx === -1;
    html += '<button onclick="event.stopPropagation();bindVariantImage(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\',-1)" ' +
      'title="No specific image" ' +
      'style="width:64px;height:64px;border-radius:8px;border:2px solid ' + (noneSel ? 'var(--teal,#2a7c6f)' : 'var(--cream-dark,#e8e0d4)') + ';background:var(--cream-dark,#e8e0d4);display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--warm-gray,#888);font-size:0.72rem;font-weight:500;">none</button>';
    productImages.forEach(function(img, i) {
      var url = resolveImg(img);
      if (!url) return;
      var sel = i === currentImageIdx;
      html += '<button onclick="event.stopPropagation();bindVariantImage(\'' + esc(pid) + '\',\'' + esc(variant.id) + '\',' + i + ')" ' +
        'title="Bind image #' + (i + 1) + '" ' +
        'style="width:64px;height:64px;border-radius:8px;overflow:hidden;border:2px solid ' + (sel ? 'var(--teal,#2a7c6f)' : 'var(--cream-dark,#e8e0d4)') + ';padding:0;cursor:pointer;background:none;">' +
        '<img src="' + esc(url) + '" alt="" style="width:100%;height:100%;object-fit:cover;display:block;">' +
        '</button>';
    });
    html += '</div>';
  }
  html += '</div>';

  // ── Inventory ─────────────────────────────────────────
  // Per-variant. Schema already supports inv.stock[variantId]; _default is
  // the legacy single-variant key.
  if (showInventory) {
  var inv = inventory[pid] || {};
  var stockType = (inv && inv.stockType) ? inv.stockType : 'made-to-order';
  var stockKey = variant._isSynthetic ? '_default' : variant.id;
  var entry = (inv.stock && typeof inv.stock === 'object') ? inv.stock[stockKey] : null;
  if (!entry && variant._isSynthetic && typeof inv.stock === 'number') {
    entry = { onHand: inv.stock, committed: 0, held: 0, damaged: 0 };
  }
  var invAdjust = '<button class="btn btn-secondary btn-small" onclick="event.stopPropagation();openAdjustStockModal(\'' + esc(pid) + '\')">Adjust →</button>';
  html += '<div>';
  html += _label('Inventory', invAdjust);
  if (stockType === 'build-to-order' || stockType === 'made-to-order') {
    html += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);">Build to order</div>';
  } else {
    var onH = (entry && entry.onHand) || 0;
    var com = (entry && entry.committed) || 0;
    var hel = (entry && entry.held) || 0;
    var dam = (entry && entry.damaged) || 0;
    var avail = Math.max(0, onH - com - hel - dam);
    var availColor = avail <= 0 ? 'var(--danger,#dc2626)' : 'var(--text,#2a2a2a)';
    function _stat(label, value, color) {
      return '<div style="flex:1;min-width:100px;padding:10px 14px;border-radius:8px;border:1px solid var(--cream-dark,#e8e0d4);">' +
        '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:4px;">' + label + '</div>' +
        '<div style="font-family:monospace;font-size:1.15rem;font-weight:600;color:' + (color || 'var(--text,#2a2a2a)') + ';">' + value + '</div>' +
      '</div>';
    }
    html += '<div style="display:flex;gap:10px;flex-wrap:wrap;">';
    html += _stat('On Hand', onH);
    html += _stat('Available', avail, availColor);
    if (com > 0) html += _stat('Committed', com, 'var(--warm-gray,#888)');
    if (hel > 0) html += _stat('Held', hel, '#b45309');
    if (dam > 0) html += _stat('Damaged', dam, 'var(--danger,#dc2626)');
    html += '</div>';
  }
  html += '</div>';
  } // end showInventory

  html += '</div>';
  return html;
}


  // Exports — the eager shell dispatcher (renderVariantTabContent) and the
  // async-fill mounts reach these via window.*.
  window.renderVariantsSection = renderVariantsSection;
  window.renderVariantListRow = renderVariantListRow;
  window.renderVariantDrillDown = renderVariantDrillDown;
  window.renderCoreProductSection = renderCoreProductSection;
  window.renderVariantPricingTab = renderVariantPricingTab;
  window.renderVariantRecipeTab = renderVariantRecipeTab;
  window.renderVariantChannelsTab = renderVariantChannelsTab;
  window.renderVariantInventoryTab = renderVariantInventoryTab;
  window.renderVariantImageTab = renderVariantImageTab;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('variantDetailTabs', {});
  }
})();
