/**
 * Inventory stock-operations modals — the admin "Adjust Stock", "Recount", and
 * "Move Items Between Locations" dialogs.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1 — coupled-cluster extraction; sibling of hold-release-stock-modal.js).
 * Lazy-loaded on demand via the eager openAdjustStockModal / openRecountModal /
 * openMoveItemsModal shims in index.html (called from static + generated onclick).
 *
 * Reads eager shell globals (all defined before a user can reach the inventory
 * surface): productsData, inventory, getInventoryTotals, getProductVariantCombos,
 * buildVariantTable, comboKey, firstProductImage, esc, openModal, closeModal,
 * showToast, MastDB, writeAudit, emitTestingEvent, syncStockInfoToPublic,
 * renderProductDetail, renderInventoryOverview, loadProducts, locationsLoaded,
 * loadLocations, getLocationsArray, getLocationBreakdown, moveInventory,
 * locationsData. All logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

var recountProducts = []; // [{pid, name, imgSrc, onHand, physicalCount, comboKey}]

function openRecountModal() {
  // Build product selection for recount
  if (!productsData || !productsData.length) {
    showToast('Loading products...', false);
    loadProducts().then(function() { openRecountModal(); });
    return;
  }

  // Get categories for filter
  var cats = {};
  productsData.forEach(function(p) {
    (p.categories || []).forEach(function(c) { cats[c] = true; });
  });
  var catOptions = '<option value="all">All Products</option>';
  Object.keys(cats).sort().forEach(function(c) {
    catOptions += '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  });

  var html = '<div style="max-width:600px;padding:24px;">' +
    '<h3>Start Inventory Recount</h3>' +
    '<p style="color:var(--warm-gray);font-size:0.85rem;margin:8px 0 16px;">Select which products to count. Only stock-tracked products (strict and stock-to-build) are shown.</p>' +
    '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;">' +
      '<select id="recountCategoryFilter" onchange="filterRecountProducts()" style="font-size:0.85rem;padding:6px 10px;">' + catOptions + '</select>' +
      '<label style="font-size:0.85rem;display:flex;align-items:center;gap:4px;cursor:pointer;">' +
        '<input type="checkbox" id="recountSelectAll" onchange="toggleRecountSelectAll(this.checked)"> Select All' +
      '</label>' +
    '</div>' +
    '<div id="recountProductList" style="max-height:300px;overflow-y:auto;border:1px solid var(--cream-dark);border-radius:8px;padding:4px;"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="startRecountSession()">Start Counting</button>' +
    '</div>' +
  '</div>';
  openModal(html);
  filterRecountProducts();
}

function filterRecountProducts() {
  var cat = document.getElementById('recountCategoryFilter').value;
  var el = document.getElementById('recountProductList');
  if (!el) return;

  var items = productsData.filter(function(p) {
    var inv = inventory[p.pid] || {};
    var st = inv.stockType || 'made-to-order';
    // Only stock-tracked products
    if (st === 'build-to-order' || st === 'made-to-order') return false;
    if (p.status === 'archived') return false;
    if (cat !== 'all') {
      if (!p.categories || p.categories.indexOf(cat) === -1) return false;
    }
    return true;
  });

  if (items.length === 0) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:var(--warm-gray);">No stock-tracked products found.</div>';
    return;
  }

  var html = '';
  items.forEach(function(p) {
    var inv = inventory[p.pid] || {};
    var totals = getInventoryTotals(inv);
    var imgSrc = firstProductImage(p);
    var imgHtml = imgSrc
      ? '<img src="' + esc(imgSrc) + '" style="width:32px;height:32px;object-fit:cover;border-radius:4px;">'
      : '<div style="width:32px;height:32px;border-radius:4px;background:var(--cream-dark);"></div>';
    html += '<label style="display:flex;align-items:center;gap:10px;padding:8px;cursor:pointer;border-bottom:1px solid var(--cream-dark);" data-pid="' + esc(p.pid) + '">' +
      '<input type="checkbox" class="recount-product-cb" data-pid="' + esc(p.pid) + '" data-name="' + esc(p.name || p.pid) + '" data-onhand="' + totals.onHand + '" data-img="' + esc(imgSrc || '') + '">' +
      imgHtml +
      '<div style="flex:1;">' +
        '<div style="font-size:0.85rem;font-weight:500;">' + esc(p.name || p.pid) + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">System: ' + totals.onHand + ' on hand</div>' +
      '</div>' +
    '</label>';
  });
  el.innerHTML = html;
}

function toggleRecountSelectAll(checked) {
  var cbs = document.querySelectorAll('.recount-product-cb');
  cbs.forEach(function(cb) { cb.checked = checked; });
}

function startRecountSession() {
  var cbs = document.querySelectorAll('.recount-product-cb:checked');
  if (cbs.length === 0) {
    showToast('Select at least one product to count.', true);
    return;
  }

  recountProducts = [];
  cbs.forEach(function(cb) {
    recountProducts.push({
      pid: cb.dataset.pid,
      name: cb.dataset.name,
      imgSrc: cb.dataset.img,
      onHand: parseInt(cb.dataset.onhand) || 0,
      physicalCount: null,
      comboKey: '_default'
    });
  });

  renderRecountForm();
}

function renderRecountForm() {
  var counted = recountProducts.filter(function(p) { return p.physicalCount !== null; }).length;
  var total = recountProducts.length;

  var html = '<div style="max-width:700px;padding:24px;">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
      '<h3>Counting Inventory</h3>' +
      '<span style="font-size:0.85rem;color:var(--warm-gray);">' + counted + ' / ' + total + ' counted</span>' +
    '</div>' +
    '<div style="max-height:400px;overflow-y:auto;">' +
    '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">' +
    '<thead><tr style="border-bottom:2px solid var(--cream-dark);">' +
      '<th style="text-align:left;padding:8px;">Product</th>' +
      '<th style="text-align:center;padding:8px;width:80px;">System</th>' +
      '<th style="text-align:center;padding:8px;width:100px;">Actual</th>' +
      '<th style="text-align:center;padding:8px;width:80px;">Variance</th>' +
    '</tr></thead><tbody>';

  recountProducts.forEach(function(p, idx) {
    var imgHtml = p.imgSrc
      ? '<img src="' + esc(p.imgSrc) + '" style="width:28px;height:28px;object-fit:cover;border-radius:4px;margin-right:8px;vertical-align:middle;">'
      : '';
    var variance = '';
    var varianceStyle = '';
    if (p.physicalCount !== null) {
      var diff = p.physicalCount - p.onHand;
      if (diff === 0) {
        variance = '✓';
        varianceStyle = 'color:var(--teal);font-weight:600;';
      } else if (diff > 0) {
        variance = '+' + diff;
        varianceStyle = 'color:#2196F3;font-weight:600;';
      } else {
        variance = '' + diff;
        varianceStyle = 'color:var(--danger);font-weight:600;';
      }
    }
    html += '<tr style="border-bottom:1px solid var(--cream-dark);">' +
      '<td style="padding:8px;">' + imgHtml + esc(p.name) + '</td>' +
      '<td style="text-align:center;padding:8px;color:var(--warm-gray);">' + p.onHand + '</td>' +
      '<td style="text-align:center;padding:8px;"><input type="number" min="0" style="width:70px;text-align:center;padding:4px 6px;font-size:0.85rem;" ' +
        'data-idx="' + idx + '" ' +
        (p.physicalCount !== null ? 'value="' + p.physicalCount + '"' : '') +
        ' onchange="updateRecountEntry(this)" oninput="updateRecountEntry(this)"></td>' +
      '<td style="text-align:center;padding:8px;' + varianceStyle + '">' + variance + '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" id="applyRecountBtn" onclick="applyRecount()" ' +
        (counted === 0 ? 'disabled style="opacity:0.5;"' : '') + '>Apply Recount (' + counted + ')</button>' +
    '</div>' +
  '</div>';
  openModal(html);
}

function updateRecountEntry(input) {
  var idx = parseInt(input.dataset.idx);
  var val = input.value.trim();
  if (val === '') {
    recountProducts[idx].physicalCount = null;
  } else {
    var num = parseInt(val);
    recountProducts[idx].physicalCount = isNaN(num) || num < 0 ? null : num;
  }
  // Update variance display and button without full re-render
  var counted = recountProducts.filter(function(p) { return p.physicalCount !== null; }).length;
  var btn = document.getElementById('applyRecountBtn');
  if (btn) {
    btn.textContent = 'Apply Recount (' + counted + ')';
    btn.disabled = counted === 0;
    btn.style.opacity = counted === 0 ? '0.5' : '1';
  }
  // Update variance cell (next sibling of input's parent td)
  var varianceTd = input.parentElement.nextElementSibling;
  if (varianceTd && recountProducts[idx].physicalCount !== null) {
    var diff = recountProducts[idx].physicalCount - recountProducts[idx].onHand;
    if (diff === 0) {
      varianceTd.innerHTML = '<span style="color:var(--teal);font-weight:600;">✓</span>';
    } else if (diff > 0) {
      varianceTd.innerHTML = '<span style="color:#2196F3;font-weight:600;">+' + diff + '</span>';
    } else {
      varianceTd.innerHTML = '<span style="color:var(--danger);font-weight:600;">' + diff + '</span>';
    }
  } else if (varianceTd) {
    varianceTd.innerHTML = '';
  }
}

async function applyRecount() {
  var toApply = recountProducts.filter(function(p) { return p.physicalCount !== null; });
  if (toApply.length === 0) {
    showToast('No counts entered.', true);
    return;
  }

  var btn = document.getElementById('applyRecountBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }

  var now = new Date().toISOString();
  var varianceCount = 0;
  var totalVariance = 0;

  try {
    for (var i = 0; i < toApply.length; i++) {
      var p = toApply[i];
      var ck = p.comboKey || '_default';
      var stockPath = p.pid + '/stock/' + ck;
      var variance = p.physicalCount - p.onHand;

      // Set onHand to physical count
      await MastDB.inventory.set(stockPath + '/onHand', p.physicalCount);
      await MastDB.inventory.set(stockPath + '/lastCountedAt', now);

      // Write audit
      await MastDB.push('admin/inventory/' + p.pid + '/history', {
        action: 'recount',
        reason: 'recount',
        previousQty: p.onHand,
        newQty: p.physicalCount,
        qty: variance,
        comboKey: ck,
        actor: 'maker',
        actorType: 'maker',
        timestamp: now
      });

      await MastDB.inventory.set(p.pid + '/updatedAt', now);

      // Update local cache
      if (inventory[p.pid] && inventory[p.pid].stock && inventory[p.pid].stock[ck]) {
        inventory[p.pid].stock[ck].onHand = p.physicalCount;
        inventory[p.pid].stock[ck].lastCountedAt = now;
      }

      // Sync to public
      await syncStockInfoToPublic(p.pid);

      if (variance !== 0) {
        varianceCount++;
        totalVariance += Math.abs(variance);
      }
    }

    closeModal();
    recountProducts = [];
    renderInventoryOverview();

    var msg = 'Counted ' + MastFormat.countNoun(toApply.length, 'product') + '. ';
    if (varianceCount === 0) {
      msg += 'All counts matched!';
    } else {
      msg += MastFormat.countNoun(varianceCount, 'variance') + ' found, ' + MastFormat.countNoun(totalVariance, 'unit') + ' adjusted.';
    }
    showToast(msg);
  } catch (err) {
    showToast('Error applying recount: ' + err.message, true);
    if (btn) { btn.disabled = false; btn.textContent = 'Apply Recount'; }
  }
}

function openAdjustStockModal(pid) {
  var product = productsData.find(function(p) { return p.pid === pid; });
  if (!product) return;
  var inv = inventory[pid] || {};
  var variantInfo = getProductVariantCombos(product);
  var stock = (inv && inv.stock) ? inv.stock : {};

  var isSculpture = product.businessLine === 'sculpture';
  var html = '<div style="max-width:560px;padding:24px;">' +
    '<h3 style="margin:0 0 16px 0;">Adjust Stock: ' + esc(product.name) + '</h3>' +
    (isSculpture ? '<div style="background:var(--teal-light,#e0f2ef);border:1px solid var(--teal);border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:0.85rem;color:var(--teal-deep,var(--teal));">Sculpture — max 1 unit in stock</div>' : '') +
    '<div style="display:flex;gap:0;margin-bottom:16px;">' +
      '<button id="adjModeSet" class="btn btn-primary" style="font-size:0.78rem;padding:5px 14px;border-radius:6px 0 0 6px;" onclick="toggleAdjustMode(\'set\')">Set Count</button>' +
      '<button id="adjModeAdd" class="btn btn-secondary" style="font-size:0.78rem;padding:5px 14px;border-radius:0 6px 6px 0;" onclick="toggleAdjustMode(\'add\')">Add Pieces</button>' +
    '</div>' +
    '<input type="hidden" id="adjStockMode" value="set">' +
    '<input type="hidden" id="adjIsSculpture" value="' + (isSculpture ? '1' : '0') + '">';

  if (variantInfo.combos.length > 0) {
    html += buildVariantTable(pid, variantInfo.labels, variantInfo.combos, inv);
  } else {
    var defOnHand = (stock._default) ? (stock._default.onHand || 0) : 0;
    var defCommitted = (stock._default) ? (stock._default.committed || 0) : 0;
    var defHeld = (stock._default) ? (stock._default.held || 0) : 0;
    var defDamaged = (stock._default) ? (stock._default.damaged || 0) : 0;
    var defAvailable = Math.max(0, defOnHand - defCommitted - defHeld - defDamaged);
    html += '<div style="display:flex;gap:16px;align-items:flex-end;">' +
      '<div class="form-group" style="margin:0;">' +
        '<label style="font-size:0.78rem;" id="adjDefaultLabel">On Hand</label>' +
        '<input type="number" id="adjDefaultAvail" min="0" value="' + defOnHand + '" style="width:80px;">' +
      '</div>' +
      '<div class="form-group" style="margin:0;">' +
        '<label style="font-size:0.78rem;">Committed</label>' +
        '<input type="number" value="' + defCommitted + '" readonly style="width:80px;opacity:0.6;">' +
      '</div>' +
      '<div class="form-group" style="margin:0;">' +
        '<label style="font-size:0.78rem;">Available</label>' +
        '<input type="number" value="' + defAvailable + '" readonly style="width:80px;opacity:0.6;">' +
      '</div>' +
    '</div>';
  }

  html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" onclick="saveAdjustStock(\'' + esc(pid) + '\')">Save</button>' +
  '</div></div>';

  openModal(html);
}

async function saveAdjustStock(pid) {
  try {
    var product = productsData.find(function(p) { return p.pid === pid; });
    var variantInfo = getProductVariantCombos(product);

    // Use multi-path update instead of set() to avoid overwriting
    // concurrent reservation changes. Only write 'onHand' fields;
    // 'committed' is managed atomically by reserveInventory/releaseInventory/pullFromStock.
    var adjMode = (document.getElementById('adjStockMode') || {}).value || 'set';
    var inv = inventory[pid] || {};
    var curStock = (inv && inv.stock) ? inv.stock : {};
    var updates = {};
    if (variantInfo.combos.length > 0) {
      var totalOnHand = 0;
      variantInfo.combos.forEach(function(combo) {
        var key = comboKey(combo);
        var availInput = document.querySelector('.pd-variant-avail[data-combo="' + key + '"]');
        var inputVal = availInput ? (parseInt(availInput.value) || 0) : 0;
        var onHand = inputVal;
        if (adjMode === 'add') {
          var curVal = (curStock[key]) ? (curStock[key].onHand || 0) : 0;
          onHand = curVal + inputVal;
        }
        updates['stock.' + key + '.onHand'] = Math.max(0, onHand);
        totalOnHand += Math.max(0, onHand);
      });
      updates['stock._default.onHand'] = totalOnHand;
    } else {
      var inputVal = parseInt(document.getElementById('adjDefaultAvail').value) || 0;
      var onHand = inputVal;
      if (adjMode === 'add') {
        var curVal = (curStock._default) ? (curStock._default.onHand || 0) : 0;
        onHand = curVal + inputVal;
      }
      updates['stock._default.onHand'] = Math.max(0, onHand);
    }
    updates['updatedAt'] = new Date().toISOString();

    // Sculpture qty cap enforcement
    var isSculptureAdj = (document.getElementById('adjIsSculpture') || {}).value === '1';
    if (isSculptureAdj) {
      var newOnHand = updates['stock._default.onHand'] || 0;
      if (newOnHand > 1) {
        showToast('Sculptures are limited to 1 unit in stock', true);
        return;
      }
    }

    // Auto-set stockType to 'strict' when stock is added to a build-to-order product
    if (!inv.stockType || inv.stockType === 'made-to-order' || inv.stockType === 'build-to-order') {
      var totalSet = updates['stock._default.onHand'] || 0;
      if (totalSet > 0) {
        updates['stockType'] = 'strict';
      }
    }

    await MastDB.inventory.update(pid, updates);
    await writeAudit('update', 'inventory', pid);
    // Write inventory audit trail for stock adjustments
    var adjAction = adjMode === 'add' ? 'restocked' : 'recount';
    var adjReason = adjMode === 'add' ? 'stock_received' : 'recount';
    await MastDB.push('admin/inventory/' + pid + '/history', {
      action: adjAction, reason: adjReason, actor: 'maker', actorType: 'maker',
      detail: adjMode === 'add' ? 'Added stock via admin' : 'Stock count adjusted via admin',
      timestamp: new Date().toISOString()
    });
    emitTestingEvent('adjustStock', {});
    // Sync stockInfo to public product for storefront
    await syncStockInfoToPublic(pid);

    // Auto-set sold status when sculpture stock reaches 0
    if (isSculptureAdj) {
      var finalOnHand = updates['stock._default.onHand'] || 0;
      if (finalOnHand <= 0) {
        await MastDB.products.setStatus(pid, 'sold');
        writeAudit('update', 'products', pid);
        var localP = productsData.find(function(x) { return x.pid === pid; });
        if (localP) localP.status = 'sold';
      } else {
        // Clear sold status if restocked
        await MastDB.products.removeStatus(pid);
        writeAudit('update', 'products', pid);
        var localP = productsData.find(function(x) { return x.pid === pid; });
        if (localP) delete localP.status;
      }
    }

    // Refresh local cache from Firebase to pick up current committed values
    if (!inventory[pid]) inventory[pid] = { pid: pid };
    inventory[pid].stock = await MastDB.get('admin/inventory/' + pid + '/stock') || {};
    closeModal();
    showToast('Stock updated');
    renderProductDetail(pid);
  } catch (err) {
    showToast('Error updating stock: ' + err.message, true);
  }
}

function toggleAdjustMode(mode) {
  document.getElementById('adjStockMode').value = mode;
  var setBtn = document.getElementById('adjModeSet');
  var addBtn = document.getElementById('adjModeAdd');
  if (mode === 'add') {
    setBtn.className = 'btn btn-secondary';
    addBtn.className = 'btn btn-primary';
    var defLabel = document.getElementById('adjDefaultLabel');
    if (defLabel) defLabel.textContent = 'Pieces to Add';
    var defInput = document.getElementById('adjDefaultAvail');
    if (defInput) { defInput.value = '0'; defInput.min = '0'; }
    // variant inputs
    document.querySelectorAll('.pd-variant-avail').forEach(function(el) { el.value = '0'; el.min = '0'; });
  } else {
    setBtn.className = 'btn btn-primary';
    addBtn.className = 'btn btn-secondary';
    var defLabel = document.getElementById('adjDefaultLabel');
    if (defLabel) defLabel.textContent = 'Available';
    // Restore current values from inventory
    var pid = document.querySelector('[onclick*="saveAdjustStock"]').getAttribute('onclick').match(/'([^']+)'/)[1];
    var inv = inventory[pid] || {};
    var defInput = document.getElementById('adjDefaultAvail');
    if (defInput) {
      var cur = (inv.stock && inv.stock._default) ? (inv.stock._default.available || 0) : 0;
      defInput.value = cur;
      defInput.min = '0';
    }
  }
}

function openMoveItemsModal(prefillPid, prefillVariant, prefillFrom) {
  if (!locationsLoaded) { loadLocations(); }
  var activeLocs = getLocationsArray('active');

  // Build product picker options — show all products (some may have unassigned stock)
  var productOptions = '<option value="">— Select product —</option>';
  if (productsData && productsData.length) {
    productsData.forEach(function(p) {
      if (p.status === 'discontinued') return;
      var inv = inventory[p.pid] || {};
      var totals = getInventoryTotals(inv);
      var stockLabel = totals.available > 0 ? ' (' + totals.available + ' on hand)' : '';
      productOptions += '<option value="' + esc(p.pid) + '"' + (prefillPid === p.pid ? ' selected' : '') + '>' + esc(p.name) + stockLabel + '</option>';
    });
  }

  var locationOptions = '';
  activeLocs.forEach(function(loc) {
    var typeIcon = loc.type === 'storage' ? '🗄️' : loc.type === 'home' ? '🏠' : loc.type === 'event' ? '🎪' : loc.type === 'container' ? '📦' : '📍';
    locationOptions += '<option value="' + esc(loc.id) + '">' + typeIcon + ' ' + esc(loc.name) + '</option>';
  });

  var html = '<div style="max-width:480px;padding:24px;">' +
    '<h3 style="margin:0 0 16px 0;">Move Items Between Locations</h3>' +
    '<div class="form-group">' +
      '<label>Product</label>' +
      '<select id="movePid" onchange="updateMoveVariants()" style="width:100%;">' + productOptions + '</select>' +
    '</div>' +
    '<div id="moveVariantRow" class="form-group" style="display:none;">' +
      '<label>Variant</label>' +
      '<select id="moveVariant" onchange="updateMoveFromLocations()" style="width:100%;"></select>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>From Location</label>' +
      '<select id="moveFrom" onchange="updateMoveMaxQty()" style="width:100%;">' +
        '<option value="">— Select source —</option>' +
        '<option value="__unassigned__">📋 Unassigned Stock</option>' + locationOptions +
      '</select>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>To Location</label>' +
      '<select id="moveTo" style="width:100%;">' +
        '<option value="">— Select destination —</option>' + locationOptions +
      '</select>' +
    '</div>' +
    '<div class="form-group">' +
      '<label>Quantity <span id="moveMaxLabel" style="font-size:0.78rem;color:var(--warm-gray);"></span></label>' +
      '<input type="number" id="moveQty" min="1" value="1" style="width:100%;max-width:120px;padding:8px 10px;font-size:0.9rem;border:1px solid var(--cream-dark);border-radius:6px;">' +
    '</div>' +
    '<div id="moveStatusMsg" style="display:none;padding:8px 12px;border-radius:6px;margin-top:8px;font-size:0.85rem;"></div>' +
    '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="executeMoveItems()">Move</button>' +
    '</div>' +
  '</div>';

  openModal(html);

  if (prefillPid) {
    updateMoveVariants();
    if (prefillVariant) {
      var varEl = document.getElementById('moveVariant');
      if (varEl) varEl.value = prefillVariant;
    }
    if (prefillFrom) {
      var fromEl = document.getElementById('moveFrom');
      if (fromEl) fromEl.value = prefillFrom;
      updateMoveMaxQty();
    }
  }
}

function updateMoveVariants() {
  var pid = document.getElementById('movePid').value;
  var varRow = document.getElementById('moveVariantRow');
  var varSel = document.getElementById('moveVariant');
  if (!pid) { varRow.style.display = 'none'; return; }

  var product = productsData.find(function(p) { return p.pid === pid; });
  var variantInfo = getProductVariantCombos(product);

  if (variantInfo.combos.length > 0) {
    var options = '';
    variantInfo.combos.forEach(function(combo) {
      var key = comboKey(combo);
      var inv = inventory[pid];
      var stock = inv && inv.stock && inv.stock[key] ? inv.stock[key] : { onHand: 0, committed: 0, held: 0, damaged: 0 };
      var avail = Math.max(0, (stock.onHand || 0) - (stock.committed || 0) - (stock.held || 0) - (stock.damaged || 0));
      options += '<option value="' + esc(key) + '">' + combo.join(' / ') + ' (' + avail + ')</option>';
    });
    varSel.innerHTML = options;
    varRow.style.display = '';
  } else {
    varRow.style.display = 'none';
  }
  updateMoveFromLocations();
}

function updateMoveFromLocations() {
  var pid = document.getElementById('movePid').value;
  if (!pid) return;
  var variantEl = document.getElementById('moveVariant');
  var varKey = (variantEl && variantEl.value && document.getElementById('moveVariantRow').style.display !== 'none') ? variantEl.value : '_default';
  var locations = getLocationBreakdown(pid, varKey);
  var fromEl = document.getElementById('moveFrom');
  // Highlight locations that have stock
  var options = fromEl.options;
  for (var i = 0; i < options.length; i++) {
    var locId = options[i].value;
    if (locId && locations[locId]) {
      options[i].textContent = options[i].textContent.replace(/ \(\d+\)$/, '') + ' (' + locations[locId] + ')';
    }
  }
  updateMoveMaxQty();
}

function updateMoveMaxQty() {
  var pid = document.getElementById('movePid').value;
  var fromLocId = document.getElementById('moveFrom').value;
  var variantEl = document.getElementById('moveVariant');
  var varKey = (variantEl && variantEl.value && document.getElementById('moveVariantRow').style.display !== 'none') ? variantEl.value : '_default';
  var label = document.getElementById('moveMaxLabel');

  if (!pid || !fromLocId) { label.textContent = ''; return; }
  var locations = getLocationBreakdown(pid, varKey);
  var maxQty = locations[fromLocId] || 0;
  label.textContent = '(max: ' + maxQty + ')';
  document.getElementById('moveQty').max = maxQty;
}

async function executeMoveItems() {
  var pid = document.getElementById('movePid').value;
  var fromLocId = document.getElementById('moveFrom').value;
  var toLocId = document.getElementById('moveTo').value;
  var qty = parseInt(document.getElementById('moveQty').value) || 0;
  var variantEl = document.getElementById('moveVariant');
  var varKey = (variantEl && variantEl.value && document.getElementById('moveVariantRow').style.display !== 'none') ? variantEl.value : '_default';

  var msgEl = document.getElementById('moveStatusMsg');
  function showMoveMsg(msg, isError) {
    if (msgEl) {
      msgEl.style.display = '';
      msgEl.style.background = isError ? '#FFEBEE' : '#E8F5E9';
      msgEl.style.color = isError ? '#C62828' : '#2E7D32';
      msgEl.textContent = msg;
    }
  }

  if (!pid) { showMoveMsg('Select a product.', true); return; }
  if (!fromLocId) { showMoveMsg('Select a source location.', true); return; }
  if (!toLocId) { showMoveMsg('Select a destination location.', true); return; }
  if (fromLocId === toLocId) { showMoveMsg('Source and destination must be different.', true); return; }
  if (qty <= 0) { showMoveMsg('Enter a positive quantity.', true); return; }

  var ok = await moveInventory(pid, varKey, fromLocId, toLocId, qty);
  if (ok) {
    var product = productsData.find(function(p) { return p.pid === pid; });
    var fromName = fromLocId === '__unassigned__' ? 'Unassigned Stock' : (locationsData[fromLocId] ? locationsData[fromLocId].name : fromLocId);
    var toName = locationsData[toLocId] ? locationsData[toLocId].name : toLocId;
    showMoveMsg('✓ Moved ' + qty + 'x ' + (product ? product.name : pid) + ': ' + fromName + ' → ' + toName, false);
    setTimeout(function() { closeModal(); }, 1200);
  }
}

  // Impls for the eager shims + the modals' onclick/onchange targets.
  window.openRecountModalImpl = openRecountModal;
  window.openAdjustStockModalImpl = openAdjustStockModal;
  window.openMoveItemsModalImpl = openMoveItemsModal;
  window.filterRecountProducts = filterRecountProducts;
  window.toggleRecountSelectAll = toggleRecountSelectAll;
  window.startRecountSession = startRecountSession;
  window.updateRecountEntry = updateRecountEntry;
  window.applyRecount = applyRecount;
  window.saveAdjustStock = saveAdjustStock;
  window.toggleAdjustMode = toggleAdjustMode;
  window.updateMoveVariants = updateMoveVariants;
  window.updateMoveFromLocations = updateMoveFromLocations;
  window.updateMoveMaxQty = updateMoveMaxQty;
  window.executeMoveItems = executeMoveItems;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('inventoryStockOps', {});
  }
})();
