/**
 * Consignment Module — Track pieces placed at galleries, boutiques, and shops.
 * Lazy-loaded via MastAdmin module registry.
 *
 * Data model: admin/consignments/{placementId}
 * Route: galleries (in Sell section)
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var placementsData = {};
  var placementsLoaded = false;
  var placementsListener = null;
  var currentView = 'list'; // 'list' | 'detail' | 'new'
  var currentPlacementId = null;

  // ============================================================
  // Data Layer — CRUD + Calculations
  // ============================================================

  function loadPlacements() {
    if (placementsLoaded) { renderCurrentView(); return; }
    placementsListener = MastDB.consignments.listen(200, function(snap) {
      placementsData = snap.val() || {};
      placementsLoaded = true;
      renderCurrentView();
    }, function(err) {
      console.error('Consignment listen error:', err);
      showToast('Failed to load consignments', 'error');
    });
  }

  function unloadPlacements() {
    if (placementsListener) {
      MastDB.consignments.unlisten(placementsListener);
      placementsListener = null;
    }
    placementsLoaded = false;
    placementsData = {};
  }

  function calculatePlacementTotals(placement) {
    var lineItems = placement.lineItems || {};
    var totalRetailValue = 0;
    var totalSold = 0;
    var totalItemsPlaced = 0;

    Object.keys(lineItems).forEach(function(key) {
      var li = lineItems[key];
      var qty = li.qty || 0;
      var qtySold = li.qtySold || 0;
      var retailPrice = li.retailPrice || 0;
      totalRetailValue += qty * retailPrice;
      totalSold += qtySold * retailPrice;
      totalItemsPlaced += qty;
    });

    var rate = placement.commissionRate || 0;
    return {
      totalRetailValue: totalRetailValue,
      totalSold: totalSold,
      totalItemsPlaced: totalItemsPlaced,
      makerEarnings: totalSold * (1 - rate),
      commissionOwed: totalSold * rate
    };
  }

  function savePlacementTotals(placementId) {
    var p = placementsData[placementId];
    if (!p) return;
    var totals = calculatePlacementTotals(p);
    MastDB.consignments.update(placementId, {
      totalRetailValue: totals.totalRetailValue,
      totalSold: totals.totalSold,
      makerEarnings: totals.makerEarnings,
      commissionOwed: totals.commissionOwed,
      updatedAt: new Date().toISOString()
    });
  }

  function createPlacement(data) {
    var id = MastDB.consignments.newKey();
    var now = new Date().toISOString();
    var placement = {
      placementId: id,
      locationName: data.locationName || '',
      locationContact: data.locationContact || '',
      locationEmail: data.locationEmail || '',
      commissionRate: parseFloat(data.commissionRate) || 0,
      status: 'active',
      lineItems: data.lineItems || {},
      notes: data.notes || '',
      totalRetailValue: 0,
      totalSold: 0,
      makerEarnings: 0,
      commissionOwed: 0,
      createdAt: now,
      updatedAt: now
    };

    // Calculate totals from initial line items
    var totals = calculatePlacementTotals(placement);
    placement.totalRetailValue = totals.totalRetailValue;
    placement.totalSold = totals.totalSold;
    placement.makerEarnings = totals.makerEarnings;
    placement.commissionOwed = totals.commissionOwed;

    return MastDB.consignments.set(id, placement).then(function() {
      showToast('Placement created');
      return id;
    });
  }

  function updatePlacement(id, updates) {
    updates.updatedAt = new Date().toISOString();
    return MastDB.consignments.update(id, updates).then(function() {
      showToast('Placement updated');
    });
  }

  function recordSale(placementId, lineItemId, qtySold) {
    var p = placementsData[placementId];
    if (!p || !p.lineItems || !p.lineItems[lineItemId]) return Promise.reject('Not found');
    var li = p.lineItems[lineItemId];
    var currentSold = li.qtySold || 0;
    var currentReturned = li.qtyReturned || 0;
    var maxSellable = (li.qty || 0) - currentSold - currentReturned;
    if (qtySold > maxSellable) {
      showToast('Cannot sell more than ' + maxSellable + ' on hand', 'error');
      return Promise.reject('Exceeds on-hand');
    }
    var newQtySold = currentSold + qtySold;
    return MastDB.consignments.fieldRef(placementId, 'lineItems/' + lineItemId + '/qtySold')
      .set(newQtySold)
      .then(function() {
        savePlacementTotals(placementId);
        showToast(qtySold + ' sale(s) recorded');
      });
  }

  function recordReturn(placementId, lineItemId, qtyReturned) {
    var p = placementsData[placementId];
    if (!p || !p.lineItems || !p.lineItems[lineItemId]) return Promise.reject('Not found');
    var li = p.lineItems[lineItemId];
    var currentSold = li.qtySold || 0;
    var currentReturned = li.qtyReturned || 0;
    var onHand = (li.qty || 0) - currentSold - currentReturned;
    if (qtyReturned > onHand) {
      showToast('Cannot return more than ' + onHand + ' on hand', 'error');
      return Promise.reject('Exceeds on-hand');
    }
    var newQtyReturned = currentReturned + qtyReturned;
    return MastDB.consignments.fieldRef(placementId, 'lineItems/' + lineItemId + '/qtyReturned')
      .set(newQtyReturned)
      .then(function() {
        savePlacementTotals(placementId);
        showToast(qtyReturned + ' return(s) recorded');
      });
  }

  function closePlacement(placementId) {
    return updatePlacement(placementId, { status: 'closed' }).then(function() {
      showToast('Placement closed');
    });
  }

  function reopenPlacement(placementId) {
    return updatePlacement(placementId, { status: 'active' }).then(function() {
      showToast('Placement reopened');
    });
  }

  // ============================================================
  // View Router
  // ============================================================

  function renderCurrentView() {
    var tab = document.getElementById('galleriesTab');
    if (!tab) return;
    if (currentView === 'detail' && currentPlacementId) {
      renderPlacementDetail(currentPlacementId);
    } else if (currentView === 'new') {
      renderNewPlacementForm();
    } else {
      renderPlacementList();
    }
  }

  function showView(view, placementId) {
    currentView = view;
    currentPlacementId = placementId || null;
    renderCurrentView();
  }

  // ============================================================
  // Consignment List View
  // ============================================================

  function renderPlacementList() {
    var tab = document.getElementById('galleriesTab');
    if (!tab) return;

    var placements = Object.values(placementsData).sort(function(a, b) {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    if (!placements.length) {
      tab.innerHTML =
        '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">🏛️</div>' +
          '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No consignment placements yet</p>' +
          '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Track pieces placed at galleries, boutiques, and shops.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px;" onclick="consignmentShowNew()">+ New Placement</button>' +
        '</div>';
      return;
    }

    var html =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Galleries & Consignment</h3>' +
        '<button class="btn btn-primary" onclick="consignmentShowNew()">+ New Placement</button>' +
      '</div>';

    html += '<div class="consignment-list">';
    placements.forEach(function(p) {
      var totals = calculatePlacementTotals(p);
      var isClosed = p.status === 'closed';
      var statusBadge = isClosed
        ? '<span class="status-badge" style="background:#9ca3af;color:white;">CLOSED</span>'
        : '<span class="status-badge" style="background:#16a34a;color:white;">ACTIVE</span>';

      html +=
        '<div class="consignment-card' + (isClosed ? ' closed' : '') + '" onclick="consignmentShowDetail(\'' + esc(p.placementId) + '\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div>' +
              '<div style="font-weight:500;font-size:0.9rem;">' + esc(p.locationName) + '</div>' +
              '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' +
                totals.totalItemsPlaced + ' item' + (totals.totalItemsPlaced !== 1 ? 's' : '') + ' placed · ' +
                Math.round((p.commissionRate || 0) * 100) + '% commission' +
              '</div>' +
            '</div>' +
            '<div style="text-align:right;">' +
              statusBadge +
            '</div>' +
          '</div>' +
          '<div class="consignment-card-stats">' +
            '<div>' +
              '<div class="consignment-stat-label">Retail Value</div>' +
              '<div class="consignment-stat-value">' + formatCurrency(totals.totalRetailValue) + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="consignment-stat-label">Sold</div>' +
              '<div class="consignment-stat-value">' + formatCurrency(totals.totalSold) + '</div>' +
            '</div>' +
            '<div>' +
              '<div class="consignment-stat-label">Your Earnings</div>' +
              '<div class="consignment-stat-value" style="color:#16a34a;font-weight:600;">' + formatCurrency(totals.makerEarnings) + '</div>' +
            '</div>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';

    tab.innerHTML = html;
  }

  // ============================================================
  // Placement Detail View
  // ============================================================

  function renderPlacementDetail(placementId) {
    var tab = document.getElementById('galleriesTab');
    if (!tab) return;
    var p = placementsData[placementId];
    if (!p) { showView('list'); return; }

    var totals = calculatePlacementTotals(p);
    var isClosed = p.status === 'closed';
    var lineItems = p.lineItems || {};
    var lineItemKeys = Object.keys(lineItems);

    var html = '<button class="detail-back" onclick="consignmentShowList()">← Back to Placements</button>';

    // Header
    html +=
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">' +
        '<div>' +
          '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">' + esc(p.locationName) + '</h3>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' +
            (p.locationContact ? esc(p.locationContact) : '') +
            (p.locationContact && p.locationEmail ? ' · ' : '') +
            (p.locationEmail ? esc(p.locationEmail) : '') +
            ' · ' + Math.round((p.commissionRate || 0) * 100) + '% commission' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-secondary btn-small" onclick="consignmentEditLocation(\'' + esc(placementId) + '\')">Edit</button>' +
          (isClosed
            ? '<button class="btn btn-outline btn-small" onclick="consignmentReopen(\'' + esc(placementId) + '\')">Reopen</button>'
            : '<button class="btn btn-secondary btn-small" onclick="consignmentClose(\'' + esc(placementId) + '\')">Close</button>') +
        '</div>' +
      '</div>';

    // Earnings summary panel — the emotional core
    html +=
      '<div class="consignment-earnings-panel">' +
        '<div class="consignment-earnings-grid">' +
          '<div class="consignment-earnings-item">' +
            '<div class="consignment-stat-label">Total Placed Value</div>' +
            '<div style="font-size:1.15rem;font-weight:600;">' + formatCurrency(totals.totalRetailValue) + '</div>' +
          '</div>' +
          '<div class="consignment-earnings-item">' +
            '<div class="consignment-stat-label">Total Sold</div>' +
            '<div style="font-size:1.15rem;font-weight:600;">' + formatCurrency(totals.totalSold) + '</div>' +
          '</div>' +
          '<div class="consignment-earnings-item">' +
            '<div class="consignment-stat-label">Your Earnings</div>' +
            '<div style="font-size:1.6rem;font-weight:700;color:#16a34a;">' + formatCurrency(totals.makerEarnings) + '</div>' +
          '</div>' +
          '<div class="consignment-earnings-item">' +
            '<div class="consignment-stat-label">Commission Owed</div>' +
            '<div style="font-size:1.15rem;font-weight:600;color:var(--warm-gray);">' + formatCurrency(totals.commissionOwed) + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    // Line items table
    html +=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin:24px 0 12px;">' +
        '<div style="font-size:1.15rem;font-weight:500;">Line Items</div>' +
        (!isClosed ? '<button class="btn btn-outline btn-small" onclick="consignmentAddLineItem(\'' + esc(placementId) + '\')">+ Add Item</button>' : '') +
      '</div>';

    if (!lineItemKeys.length) {
      html += '<div style="text-align:center;padding:20px;color:var(--warm-gray-light);font-size:0.85rem;">No items placed yet.</div>';
    } else {
      html +=
        '<div class="consignment-table-wrap">' +
        '<table class="consignment-table">' +
          '<thead><tr>' +
            '<th>Product</th>' +
            '<th style="text-align:center;">Placed</th>' +
            '<th style="text-align:right;">Retail Price</th>' +
            '<th style="text-align:center;">Sold</th>' +
            '<th style="text-align:center;">Returned</th>' +
            '<th style="text-align:center;">On Hand</th>' +
            '<th style="text-align:right;">Earnings</th>' +
            (!isClosed ? '<th style="text-align:center;">Actions</th>' : '') +
          '</tr></thead>' +
          '<tbody>';

      lineItemKeys.forEach(function(key) {
        var li = lineItems[key];
        var qty = li.qty || 0;
        var qtySold = li.qtySold || 0;
        var qtyReturned = li.qtyReturned || 0;
        var onHand = qty - qtySold - qtyReturned;
        var retailPrice = li.retailPrice || 0;
        var lineEarnings = qtySold * retailPrice * (1 - (p.commissionRate || 0));

        html +=
          '<tr>' +
            '<td>' + esc(li.productName || 'Unknown') + '</td>' +
            '<td style="text-align:center;">' + qty + '</td>' +
            '<td style="text-align:right;">' + formatCurrency(retailPrice) + '</td>' +
            '<td style="text-align:center;">' + qtySold + '</td>' +
            '<td style="text-align:center;">' + qtyReturned + '</td>' +
            '<td style="text-align:center;font-weight:600;">' + onHand + '</td>' +
            '<td style="text-align:right;color:#16a34a;font-weight:500;">' + formatCurrency(lineEarnings) + '</td>' +
            (!isClosed
              ? '<td style="text-align:center;white-space:nowrap;">' +
                  '<button class="btn btn-small" style="font-size:0.72rem;padding:3px 8px;margin-right:4px;" ' +
                    'onclick="event.stopPropagation();consignmentRecordSale(\'' + esc(placementId) + '\',\'' + esc(key) + '\',' + onHand + ')">Sale</button>' +
                  '<button class="btn btn-secondary btn-small" style="font-size:0.72rem;padding:3px 8px;" ' +
                    'onclick="event.stopPropagation();consignmentRecordReturn(\'' + esc(placementId) + '\',\'' + esc(key) + '\',' + onHand + ')">Return</button>' +
                '</td>'
              : '') +
          '</tr>';
      });

      html += '</tbody></table></div>';
    }

    // Notes
    if (p.notes) {
      html +=
        '<div style="margin-top:20px;">' +
          '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray);margin-bottom:4px;">Notes</div>' +
          '<div style="font-size:0.85rem;color:var(--warm-gray-light);">' + esc(p.notes) + '</div>' +
        '</div>';
    }

    tab.innerHTML = html;
  }

  // ============================================================
  // New Placement Form
  // ============================================================

  function renderNewPlacementForm() {
    var tab = document.getElementById('galleriesTab');
    if (!tab) return;

    var html = '<button class="detail-back" onclick="consignmentShowList()">← Back to Placements</button>';

    html +=
      '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0 0 20px;">New Consignment Placement</h3>' +
      '<div style="max-width:640px;">' +
        '<div class="form-group" style="margin-bottom:16px;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Location Name *</label>' +
          '<input type="text" id="cpLocationName" placeholder="e.g. Blue Door Gallery" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">' +
          '<div class="form-group">' +
            '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Contact Name</label>' +
            '<input type="text" id="cpLocationContact" placeholder="Gallery manager" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
          '</div>' +
          '<div class="form-group">' +
            '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Contact Email</label>' +
            '<input type="email" id="cpLocationEmail" placeholder="gallery@example.com" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
          '</div>' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:16px;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Commission Rate (%) *</label>' +
          '<input type="number" id="cpCommissionRate" placeholder="40" min="0" max="100" step="1" style="width:120px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
          '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:8px;">% goes to the gallery</span>' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:16px;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="cpNotes" rows="2" placeholder="Agreement details, terms, etc." style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;"></textarea>' +
        '</div>' +

        // Product picker
        '<div style="margin-top:24px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<div style="font-size:1.15rem;font-weight:500;">Products to Consign</div>' +
            '<button class="btn btn-outline btn-small" onclick="consignmentAddProductRow()">+ Add Product</button>' +
          '</div>' +
          '<div id="cpProductRows"></div>' +
        '</div>' +

        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:24px;">' +
          '<button class="btn btn-secondary" onclick="consignmentShowList()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="consignmentSaveNew()">Create Placement</button>' +
        '</div>' +
      '</div>';

    tab.innerHTML = html;
  }

  var productRowCounter = 0;

  function addProductRow() {
    var container = document.getElementById('cpProductRows');
    if (!container) return;

    var rowId = 'cpRow_' + (++productRowCounter);

    // Build product options from global productsData
    var products = window.productsData || [];
    var options = '<option value="">Select a product...</option>';
    products.forEach(function(prod) {
      if (prod.status === 'archived') return;
      var price = '';
      if (prod.retailPrice) price = ' ($' + parseFloat(prod.retailPrice).toFixed(2) + ')';
      else if (typeof prod.priceCents === 'number' && prod.priceCents > 0) price = ' (' + (window.formatCents ? window.formatCents(prod.priceCents) : ('$' + (prod.priceCents / 100).toFixed(2))) + ')';
      var dataPrice = prod.retailPrice || (typeof prod.priceCents === 'number' ? (prod.priceCents / 100) : 0);
      options += '<option value="' + esc(prod.pid) + '" data-name="' + esc(prod.name) + '" data-price="' + dataPrice + '">' + esc(prod.name) + price + '</option>';
    });

    var rowHtml =
      '<div id="' + rowId + '" class="consignment-product-row">' +
        '<select onchange="consignmentProductSelected(this,\'' + rowId + '\')" style="flex:2;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;">' +
          options +
        '</select>' +
        '<input type="number" id="' + rowId + '_qty" placeholder="Qty" min="1" value="1" style="width:70px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;text-align:center;">' +
        '<input type="number" id="' + rowId + '_price" placeholder="Retail $" step="0.01" min="0" style="width:100px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;text-align:right;">' +
        '<button class="btn btn-icon" onclick="consignmentRemoveProductRow(\'' + rowId + '\')" title="Remove" style="flex-shrink:0;">✕</button>' +
      '</div>';

    container.insertAdjacentHTML('beforeend', rowHtml);
  }

  function productSelected(selectEl, rowId) {
    var opt = selectEl.options[selectEl.selectedIndex];
    var price = opt ? opt.getAttribute('data-price') : '';
    var priceInput = document.getElementById(rowId + '_price');
    if (priceInput && price) {
      priceInput.value = parseFloat(price).toFixed(2);
    }
  }

  function removeProductRow(rowId) {
    var row = document.getElementById(rowId);
    if (row) row.remove();
  }

  function saveNewPlacement() {
    var nameEl = document.getElementById('cpLocationName');
    var contactEl = document.getElementById('cpLocationContact');
    var emailEl = document.getElementById('cpLocationEmail');
    var rateEl = document.getElementById('cpCommissionRate');
    var notesEl = document.getElementById('cpNotes');

    var locationName = nameEl ? nameEl.value.trim() : '';
    if (!locationName) { showToast('Location name is required', 'error'); return; }

    var rateStr = rateEl ? rateEl.value.trim() : '';
    if (!rateStr) { showToast('Commission rate is required', 'error'); return; }
    var rate = parseFloat(rateStr) / 100;
    if (isNaN(rate) || rate < 0 || rate > 1) { showToast('Commission rate must be 0-100%', 'error'); return; }

    // Gather product rows
    var container = document.getElementById('cpProductRows');
    var rows = container ? container.querySelectorAll('.consignment-product-row') : [];
    var lineItems = {};
    var hasItems = false;
    var products = window.productsData || [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var select = row.querySelector('select');
      var pid = select ? select.value : '';
      if (!pid) continue;

      var opt = select.options[select.selectedIndex];
      var productName = opt ? opt.getAttribute('data-name') : '';
      var qtyInput = row.querySelector('input[type="number"][id$="_qty"]');
      var priceInput = row.querySelector('input[type="number"][id$="_price"]');
      var qty = qtyInput ? parseInt(qtyInput.value) || 0 : 0;
      var retailPrice = priceInput ? parseFloat(priceInput.value) || 0 : 0;

      if (qty <= 0) continue;

      var liKey = MastDB.consignments.newKey();
      lineItems[liKey] = {
        lineItemId: liKey,
        productId: pid,
        productName: productName,
        qty: qty,
        retailPrice: retailPrice,
        datePlaced: new Date().toISOString(),
        qtySold: 0,
        qtyReturned: 0
      };
      hasItems = true;
    }

    if (!hasItems) { showToast('Add at least one product', 'error'); return; }

    createPlacement({
      locationName: locationName,
      locationContact: contactEl ? contactEl.value.trim() : '',
      locationEmail: emailEl ? emailEl.value.trim() : '',
      commissionRate: rate,
      notes: notesEl ? notesEl.value.trim() : '',
      lineItems: lineItems
    }).then(function(id) {
      showView('detail', id);
    });
  }

  // ============================================================
  // Modals — Edit Location, Record Sale, Record Return, Add Line Item
  // ============================================================

  function editLocationModal(placementId) {
    var p = placementsData[placementId];
    if (!p) return;

    var html =
      '<h3 style="font-size:1.15rem;font-weight:500;margin:0 0 16px;">Edit Location</h3>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Location Name</label>' +
        '<input type="text" id="editLocName" value="' + esc(p.locationName) + '" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Contact Name</label>' +
        '<input type="text" id="editLocContact" value="' + esc(p.locationContact || '') + '" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Contact Email</label>' +
        '<input type="email" id="editLocEmail" value="' + esc(p.locationEmail || '') + '" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Commission Rate (%)</label>' +
        '<input type="number" id="editLocRate" value="' + Math.round((p.commissionRate || 0) * 100) + '" min="0" max="100" step="1" style="width:120px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>' +
        '<textarea id="editLocNotes" rows="2" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' + esc(p.notes || '') + '</textarea>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="consignmentSaveLocation(\'' + esc(placementId) + '\')">Save</button>' +
      '</div>';

    openModal(html);
  }

  function saveLocation(placementId) {
    var nameEl = document.getElementById('editLocName');
    var contactEl = document.getElementById('editLocContact');
    var emailEl = document.getElementById('editLocEmail');
    var rateEl = document.getElementById('editLocRate');
    var notesEl = document.getElementById('editLocNotes');

    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) { showToast('Location name is required', 'error'); return; }

    var rate = rateEl ? parseFloat(rateEl.value) / 100 : 0;
    if (isNaN(rate) || rate < 0 || rate > 1) { showToast('Commission rate must be 0-100%', 'error'); return; }

    updatePlacement(placementId, {
      locationName: name,
      locationContact: contactEl ? contactEl.value.trim() : '',
      locationEmail: emailEl ? emailEl.value.trim() : '',
      commissionRate: rate,
      notes: notesEl ? notesEl.value.trim() : ''
    }).then(function() {
      closeModal();
      // Recalculate totals since commission rate may have changed
      savePlacementTotals(placementId);
    });
  }

  function recordSaleModal(placementId, lineItemId, maxQty) {
    if (maxQty <= 0) { showToast('No items on hand to sell', 'error'); return; }
    var html =
      '<h3 style="font-size:1.15rem;font-weight:500;margin:0 0 16px;">Record Sale</h3>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Quantity Sold</label>' +
        '<input type="number" id="saleQty" min="1" max="' + maxQty + '" value="1" style="width:100px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;text-align:center;">' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:8px;">' + maxQty + ' on hand</span>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="consignmentConfirmSale(\'' + esc(placementId) + '\',\'' + esc(lineItemId) + '\')">Record Sale</button>' +
      '</div>';
    openModal(html);
  }

  function confirmSale(placementId, lineItemId) {
    var qtyEl = document.getElementById('saleQty');
    var qty = qtyEl ? parseInt(qtyEl.value) || 0 : 0;
    if (qty <= 0) { showToast('Enter a quantity', 'error'); return; }
    recordSale(placementId, lineItemId, qty).then(function() {
      closeModal();
    });
  }

  function recordReturnModal(placementId, lineItemId, maxQty) {
    if (maxQty <= 0) { showToast('No items on hand to return', 'error'); return; }
    var html =
      '<h3 style="font-size:1.15rem;font-weight:500;margin:0 0 16px;">Record Return</h3>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Quantity Returned</label>' +
        '<input type="number" id="returnQty" min="1" max="' + maxQty + '" value="1" style="width:100px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;text-align:center;">' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:8px;">' + maxQty + ' on hand</span>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="consignmentConfirmReturn(\'' + esc(placementId) + '\',\'' + esc(lineItemId) + '\')">Record Return</button>' +
      '</div>';
    openModal(html);
  }

  function confirmReturn(placementId, lineItemId) {
    var qtyEl = document.getElementById('returnQty');
    var qty = qtyEl ? parseInt(qtyEl.value) || 0 : 0;
    if (qty <= 0) { showToast('Enter a quantity', 'error'); return; }
    recordReturn(placementId, lineItemId, qty).then(function() {
      closeModal();
    });
  }

  function addLineItemModal(placementId) {
    var products = window.productsData || [];
    var options = '<option value="">Select a product...</option>';
    products.forEach(function(prod) {
      if (prod.status === 'archived') return;
      var price = '';
      if (prod.retailPrice) price = ' ($' + parseFloat(prod.retailPrice).toFixed(2) + ')';
      else if (typeof prod.priceCents === 'number' && prod.priceCents > 0) price = ' (' + (window.formatCents ? window.formatCents(prod.priceCents) : ('$' + (prod.priceCents / 100).toFixed(2))) + ')';
      var dataPrice = prod.retailPrice || (typeof prod.priceCents === 'number' ? (prod.priceCents / 100) : 0);
      options += '<option value="' + esc(prod.pid) + '" data-name="' + esc(prod.name) + '" data-price="' + dataPrice + '">' + esc(prod.name) + price + '</option>';
    });

    var html =
      '<h3 style="font-size:1.15rem;font-weight:500;margin:0 0 16px;">Add Item to Placement</h3>' +
      '<div class="form-group" style="margin-bottom:16px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Product</label>' +
        '<select id="addLiProduct" onchange="consignmentAddLiProductChanged(this)" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
          options +
        '</select>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">' +
        '<div class="form-group">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Quantity</label>' +
          '<input type="number" id="addLiQty" min="1" value="1" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;text-align:center;">' +
        '</div>' +
        '<div class="form-group">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Retail Price ($)</label>' +
          '<input type="number" id="addLiPrice" step="0.01" min="0" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;text-align:right;">' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="consignmentConfirmAddLineItem(\'' + esc(placementId) + '\')">Add Item</button>' +
      '</div>';
    openModal(html);
  }

  function addLiProductChanged(selectEl) {
    var opt = selectEl.options[selectEl.selectedIndex];
    var price = opt ? opt.getAttribute('data-price') : '';
    var priceInput = document.getElementById('addLiPrice');
    if (priceInput && price) {
      priceInput.value = parseFloat(price).toFixed(2);
    }
  }

  function confirmAddLineItem(placementId) {
    var selectEl = document.getElementById('addLiProduct');
    var qtyEl = document.getElementById('addLiQty');
    var priceEl = document.getElementById('addLiPrice');

    var pid = selectEl ? selectEl.value : '';
    if (!pid) { showToast('Select a product', 'error'); return; }
    var opt = selectEl.options[selectEl.selectedIndex];
    var productName = opt ? opt.getAttribute('data-name') : '';
    var qty = qtyEl ? parseInt(qtyEl.value) || 0 : 0;
    if (qty <= 0) { showToast('Quantity must be at least 1', 'error'); return; }
    var retailPrice = priceEl ? parseFloat(priceEl.value) || 0 : 0;

    var liKey = MastDB.consignments.newKey();
    var lineItem = {
      lineItemId: liKey,
      productId: pid,
      productName: productName,
      qty: qty,
      retailPrice: retailPrice,
      datePlaced: new Date().toISOString(),
      qtySold: 0,
      qtyReturned: 0
    };

    MastDB.consignments.fieldRef(placementId, 'lineItems/' + liKey).set(lineItem).then(function() {
      savePlacementTotals(placementId);
      showToast('Item added');
      closeModal();
    });
  }

  // ============================================================
  // Window-exposed functions (for onclick handlers)
  // ============================================================

  // Navigation
  window.consignmentShowList = function() { showView('list'); };
  window.consignmentShowDetail = function(id) { showView('detail', id); };
  window.consignmentShowNew = function() { showView('new'); };

  // CRUD
  window.consignmentSaveNew = saveNewPlacement;
  window.consignmentEditLocation = editLocationModal;
  window.consignmentSaveLocation = saveLocation;
  window.consignmentClose = async function(id) {
    if (await mastConfirm('Close this placement? You can reopen it later.', { title: 'Close Placement' })) closePlacement(id);
  };
  window.consignmentReopen = reopenPlacement;

  // Line item actions
  window.consignmentRecordSale = recordSaleModal;
  window.consignmentConfirmSale = confirmSale;
  window.consignmentRecordReturn = recordReturnModal;
  window.consignmentConfirmReturn = confirmReturn;
  window.consignmentAddLineItem = addLineItemModal;
  window.consignmentAddLiProductChanged = addLiProductChanged;
  window.consignmentConfirmAddLineItem = confirmAddLineItem;

  // Product rows in new form
  window.consignmentAddProductRow = addProductRow;
  window.consignmentProductSelected = productSelected;
  window.consignmentRemoveProductRow = removeProductRow;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('consignment', {
    routes: {
      'galleries': { tab: 'galleriesTab', setup: function() {
        currentView = 'list';
        currentPlacementId = null;
        loadPlacements();
        // Ensure products are loaded for product picker
        if (!window.productsLoaded && typeof window.loadProducts === 'function') {
          window.loadProducts();
        }
      } }
    },
    detachListeners: function() {
      unloadPlacements();
    }
  });

})();
