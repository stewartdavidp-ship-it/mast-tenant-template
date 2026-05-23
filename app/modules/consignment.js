/**
 * Consignment Module — Track pieces placed at galleries, boutiques, and shops.
 * Lazy-loaded via MastAdmin module registry.
 *
 * Data model: admin/consignments/{placementId}
 * Route: galleries (in Sell section)
 */
(function() {
  'use strict';

  var formatCurrency = typeof formatPriceCents === 'function'
    ? formatPriceCents
    : function(c) { return '$' + ((c || 0) / 100).toFixed(2); };

  // ============================================================
  // Module-private state
  // ============================================================

  var placementsData = {};
  var placementsLoaded = false;
  var placementsListener = null;
  var currentView = 'list'; // 'list' | 'detail' | 'new' | 'galleries' | 'galleryDetail' | 'galleryEdit'
  var currentPlacementId = null;
  // W2.7: gallery entities (admin/galleries/{galleryId}).
  var galleriesData = {};
  var galleriesLoaded = false;
  var galleriesListener = null;
  var currentGalleryId = null;

  // Tenant-TZ-aware date helpers for URL filter (createdAt is ISO timestamp).
  var _tenantTz = null;
  function ensureTenantTz() {
    if (_tenantTz !== null) return Promise.resolve(_tenantTz);
    try {
      return MastDB.businessEntity.get('operations').then(function(snap) {
        var ops = (snap && typeof snap.val === 'function') ? snap.val() : snap;
        var tz = ops && ops.localization && ops.localization.timezone;
        _tenantTz = (tz && typeof tz === 'string') ? tz : 'UTC';
        return _tenantTz;
      }).catch(function() { _tenantTz = 'UTC'; return 'UTC'; });
    } catch (e) {
      _tenantTz = 'UTC';
      return Promise.resolve('UTC');
    }
  }
  function tzPartsFromIso(iso) {
    if (!iso) return null;
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return null;
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: _tenantTz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    var parts = {};
    fmt.formatToParts(dt).forEach(function(x) { if (x.type !== 'literal') parts[x.type] = x.value; });
    return parts;
  }

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
    } else if (currentView === 'galleries') {
      renderGalleryList();
    } else if (currentView === 'galleryDetail' && currentGalleryId) {
      renderGalleryDetail(currentGalleryId);
    } else if (currentView === 'galleryEdit') {
      renderGalleryEditForm(currentGalleryId);
    } else {
      renderPlacementList();
    }
  }

  // ============================================================
  // W2.7 — Gallery-as-entity (admin/galleries)
  // ============================================================
  function loadGalleries(cb) {
    if (galleriesLoaded) { if (cb) cb(); return; }
    try {
      galleriesListener = MastDB.subscribe('admin/galleries', function(val) {
        galleriesData = val || {};
        galleriesLoaded = true;
        if (currentView === 'galleries' || currentView === 'galleryDetail') renderCurrentView();
        if (cb) { var done = cb; cb = null; done(); }
      });
    } catch (e) {
      // Fallback to one-shot get.
      MastDB.get('admin/galleries').then(function(val) {
        galleriesData = val || {};
        galleriesLoaded = true;
        if (cb) cb();
      }).catch(function() { galleriesData = {}; galleriesLoaded = true; if (cb) cb(); });
    }
  }

  function _placementsForGallery(galleryId) {
    // Match by galleryId FK first; fall back to locationName match for legacy
    // placements that haven't been backfilled yet.
    var g = galleriesData[galleryId];
    var legacyKey = g && g.name ? g.name.trim().toLowerCase() : '';
    return Object.keys(placementsData).map(function(k) {
      return placementsData[k];
    }).filter(function(p) {
      if (!p) return false;
      if (p.galleryId === galleryId) return true;
      if (!p.galleryId && legacyKey && (p.locationName || '').trim().toLowerCase() === legacyKey) return true;
      return false;
    });
  }

  function _galleryPayoutsDue(galleryId) {
    // Sum unpaid commission across all placements for this gallery.
    // unpaid = max(0, makerEarnings - sum(settlements.amountReceivedCents)).
    // Note: legacy placements compute makerEarnings as the maker's share; what
    // the gallery owes the maker is commissionOwed less settlements paid in.
    // Per W1.10 spec: "sum unpaid commission across all placements for this
    // gallery" — interpret as unpaid maker earnings (what gallery still owes).
    var placements = _placementsForGallery(galleryId);
    var total = 0;
    placements.forEach(function(p) {
      var totals = calculatePlacementTotals(p);
      var settlements = (p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
      var paid = Object.values(settlements).reduce(function(s, x) {
        return s + ((x && Number(x.amountReceivedCents)) || 0);
      }, 0);
      var owed = Math.max(0, (totals.makerEarnings || 0) - paid);
      total += owed;
    });
    return total;
  }

  function renderGalleryList() {
    var tab = document.getElementById('galleriesTab');
    if (!tab) return;
    if (!galleriesLoaded) {
      tab.innerHTML = '<div style="color:var(--warm-gray);padding:40px 0;text-align:center;">Loading galleries...</div>';
      loadGalleries(function() { renderCurrentView(); });
      return;
    }
    var galleries = Object.keys(galleriesData).map(function(id) {
      var g = galleriesData[id]; g._id = id; return g;
    });
    // Sort by Payouts Due descending (highest-owed first).
    var rows = galleries.map(function(g) {
      var placements = _placementsForGallery(g._id);
      var active = placements.filter(function(p) { return (p.status || 'active') === 'active'; }).length;
      return {
        g: g,
        active: active,
        total: placements.length,
        payoutsDue: _galleryPayoutsDue(g._id)
      };
    }).sort(function(a, b) { return b.payoutsDue - a.payoutsDue; });

    var html = _galleriesSubNavHtml('galleries');
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0;">' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">' + rows.length + ' galler' + (rows.length === 1 ? 'y' : 'ies') + '</div>' +
      '<button class="btn btn-primary" onclick="consignmentNewGallery()">+ New Gallery</button>' +
    '</div>';

    if (rows.length === 0) {
      html += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">&#127963;&#65039;</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No gallery entities yet</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);max-width:480px;margin:0 auto;">Galleries are first-class entities now. Each holds addresses, contacts, default commission %, and rolls up Payouts Due across all its placements. Use the backfill script <code>scripts/backfill-gallery-entities.js</code> to derive these from existing placement <code>locationName</code> values.</p>' +
      '</div>';
      tab.innerHTML = html;
      return;
    }

    html += '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;overflow:hidden;">' +
      '<thead><tr style="background:var(--cream);text-align:left;">' +
        '<th style="padding:8px 10px;">Name</th>' +
        '<th style="padding:8px 10px;">Addresses</th>' +
        '<th style="padding:8px 10px;">Contacts</th>' +
        '<th style="padding:8px 10px;" align="right">Default %</th>' +
        '<th style="padding:8px 10px;" align="right">Active</th>' +
        '<th style="padding:8px 10px;" align="right">Payouts Due</th>' +
      '</tr></thead><tbody>';
    rows.forEach(function(r) {
      var g = r.g;
      var addrCount = (g.addresses || []).length;
      var contactCount = (g.contacts || []).length;
      var pct = (typeof g.defaultCommissionPct === 'number') ? (Math.round(g.defaultCommissionPct * 100) / 100) + '%' : '—';
      html += '<tr style="border-top:1px solid var(--cream-dark,#e8e0d4);cursor:pointer;" onclick="consignmentShowGallery(\'' + _jsAttr(g._id) + '\')">' +
        '<td style="padding:8px 10px;font-weight:600;">' + esc(g.name || '(unnamed)') + '</td>' +
        '<td style="padding:8px 10px;color:var(--warm-gray);">' + addrCount + '</td>' +
        '<td style="padding:8px 10px;color:var(--warm-gray);">' + contactCount + '</td>' +
        '<td style="padding:8px 10px;" align="right">' + pct + '</td>' +
        '<td style="padding:8px 10px;" align="right">' + r.active + ' / ' + r.total + '</td>' +
        '<td style="padding:8px 10px;" align="right" style="font-weight:600;color:' + (r.payoutsDue > 0 ? '#F59E0B' : 'var(--warm-gray)') + ';">' + formatCurrency(r.payoutsDue) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    tab.innerHTML = html;
  }

  function _galleriesSubNavHtml(active) {
    return '<div class="view-tabs" style="margin-bottom:0;">' +
      '<div class="view-tab' + (active === 'placements' ? ' active' : '') + '" onclick="consignmentShowList()">Placements</div>' +
      '<div class="view-tab' + (active === 'galleries' ? ' active' : '') + '" onclick="consignmentShowGalleries()">Galleries</div>' +
    '</div>';
  }

  function renderGalleryDetail(galleryId) {
    var tab = document.getElementById('galleriesTab');
    if (!tab) return;
    var g = galleriesData[galleryId];
    if (!g) {
      tab.innerHTML = '<button class="detail-back" onclick="consignmentShowGalleries()">&larr; Galleries</button>' +
        '<div style="padding:24px;color:var(--danger);">Gallery not found.</div>';
      return;
    }
    var placements = _placementsForGallery(galleryId);
    var active = placements.filter(function(p) { return (p.status || 'active') === 'active'; });
    var closed = placements.filter(function(p) { return (p.status || 'active') !== 'active'; });
    var payoutsDue = _galleryPayoutsDue(galleryId);
    var addresses = (g.addresses || []);
    var contacts = (g.contacts || []);

    var html = '<button class="detail-back" onclick="consignmentShowGalleries()">&larr; Galleries</button>' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin:16px 0;gap:16px;">' +
        '<div>' +
          '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">' + esc(g.name || '(unnamed)') + '</h3>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Default commission: ' + ((typeof g.defaultCommissionPct === 'number') ? esc((Math.round(g.defaultCommissionPct * 100) / 100) + '%') : '—') + '</div>' +
        '</div>' +
        '<div style="text-align:right;">' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">Payouts Due</div>' +
          '<div style="font-size:1.6rem;font-weight:700;color:' + (payoutsDue > 0 ? '#F59E0B' : 'var(--charcoal)') + ';">' + formatCurrency(payoutsDue) + '</div>' +
          '<button class="btn btn-secondary btn-small" style="margin-top:6px;" onclick="consignmentEditGallery(\'' + _jsAttr(galleryId) + '\')">Edit</button>' +
        '</div>' +
      '</div>';

    // Addresses
    html += '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;margin-bottom:12px;">' +
      '<h4 style="margin:0 0 10px;font-size:0.9rem;">Addresses</h4>';
    if (addresses.length === 0) html += '<div style="color:var(--warm-gray);font-size:0.85rem;">No addresses on file.</div>';
    else addresses.forEach(function(a) {
      html += '<div style="padding:4px 0;font-size:0.85rem;">' + esc([a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(', ')) + '</div>';
    });
    html += '</section>';

    // Contacts
    html += '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;margin-bottom:12px;">' +
      '<h4 style="margin:0 0 10px;font-size:0.9rem;">Contacts</h4>';
    if (contacts.length === 0) html += '<div style="color:var(--warm-gray);font-size:0.85rem;">No contacts on file.</div>';
    else contacts.forEach(function(c) {
      html += '<div style="padding:4px 0;font-size:0.85rem;"><b>' + esc(c.name || '—') + '</b>' +
        (c.role ? ' <span style="color:var(--warm-gray);">· ' + esc(c.role) + '</span>' : '') +
        '<div style="color:var(--warm-gray);font-size:0.78rem;">' + esc(c.email || '') + (c.phone ? ' · ' + esc(c.phone) : '') + '</div>' +
      '</div>';
    });
    html += '</section>';

    // Notes
    if (g.notes) {
      html += '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;margin-bottom:12px;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">Notes</h4>' +
        '<div style="font-size:0.85rem;white-space:pre-wrap;color:var(--warm-gray);">' + esc(g.notes) + '</div>' +
      '</section>';
    }

    function _placementsTable(list, label) {
      if (list.length === 0) return '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;margin-bottom:12px;"><h4 style="margin:0 0 10px;font-size:0.9rem;">' + esc(label) + '</h4><div style="color:var(--warm-gray);font-size:0.85rem;">None.</div></section>';
      var inner = list.map(function(p) {
        var totals = calculatePlacementTotals(p);
        return '<tr style="border-top:1px solid var(--cream-dark,#e8e0d4);cursor:pointer;" onclick="consignmentShowDetail(\'' + _jsAttr(p.placementId) + '\')">' +
          '<td style="padding:6px 8px;">' + esc(p.locationName || '—') + '</td>' +
          '<td style="padding:6px 8px;">' + esc(p.status || 'active') + '</td>' +
          '<td style="padding:6px 8px;" align="right">' + formatCurrency(totals.totalSold) + '</td>' +
          '<td style="padding:6px 8px;" align="right">' + formatCurrency(totals.makerEarnings) + '</td>' +
        '</tr>';
      }).join('');
      return '<section style="background:#fff;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;padding:16px;margin-bottom:12px;">' +
        '<h4 style="margin:0 0 10px;font-size:0.9rem;">' + esc(label) + ' (' + list.length + ')</h4>' +
        '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;"><thead><tr style="text-align:left;color:var(--warm-gray);">' +
          '<th style="padding:6px 8px;">Placement</th><th style="padding:6px 8px;">Status</th><th style="padding:6px 8px;" align="right">Sold</th><th style="padding:6px 8px;" align="right">Earnings</th>' +
        '</tr></thead><tbody>' + inner + '</tbody></table>' +
      '</section>';
    }
    html += _placementsTable(active, 'Active placements');
    html += _placementsTable(closed, 'Historical placements');

    tab.innerHTML = html;
  }

  function renderGalleryEditForm(galleryId) {
    var tab = document.getElementById('galleriesTab');
    if (!tab) return;
    var g = galleryId ? (galleriesData[galleryId] || {}) : {};
    var isEdit = !!galleryId;
    var addresses = (g.addresses && g.addresses.length) ? g.addresses : [{ street: '', city: '', state: '', zip: '', country: '' }];
    var contacts = (g.contacts && g.contacts.length) ? g.contacts : [{ name: '', email: '', phone: '', role: '' }];

    function addrRowsHtml() {
      return addresses.map(function(a, i) {
        return '<div style="display:grid;grid-template-columns:2fr 1fr 80px 100px 100px;gap:8px;margin-bottom:6px;" data-gal-addr-row="' + i + '">' +
          '<input data-gal-addr="street" data-i="' + i + '" placeholder="Street" value="' + esc(a.street || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
          '<input data-gal-addr="city" data-i="' + i + '" placeholder="City" value="' + esc(a.city || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
          '<input data-gal-addr="state" data-i="' + i + '" placeholder="ST" value="' + esc(a.state || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
          '<input data-gal-addr="zip" data-i="' + i + '" placeholder="Zip" value="' + esc(a.zip || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
          '<input data-gal-addr="country" data-i="' + i + '" placeholder="Country" value="' + esc(a.country || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '</div>';
      }).join('');
    }
    function contactRowsHtml() {
      return contacts.map(function(c, i) {
        return '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:6px;" data-gal-contact-row="' + i + '">' +
          '<input data-gal-contact="name" data-i="' + i + '" placeholder="Name" value="' + esc(c.name || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
          '<input data-gal-contact="email" data-i="' + i + '" placeholder="Email" value="' + esc(c.email || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
          '<input data-gal-contact="phone" data-i="' + i + '" placeholder="Phone" value="' + esc(c.phone || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
          '<input data-gal-contact="role" data-i="' + i + '" placeholder="Role" value="' + esc(c.role || '') + '" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '</div>';
      }).join('');
    }

    var html = '<button class="detail-back" onclick="consignmentShowGalleries()">&larr; Galleries</button>' +
      '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:16px 0;">' + (isEdit ? 'Edit Gallery' : 'New Gallery') + '</h3>' +
      '<form id="galleryEditForm" onsubmit="event.preventDefault();consignmentSaveGallery(' + (isEdit ? '\'' + _jsAttr(galleryId) + '\'' : 'null') + ');return false;" style="max-width:760px;">' +
        '<div style="margin-bottom:12px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Name *</label>' +
          '<input id="gal_name" required value="' + esc(g.name || '') + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
            '<label style="font-size:0.85rem;font-weight:600;">Addresses</label>' +
          '</div>' +
          '<div id="galAddressRows">' + addrRowsHtml() + '</div>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">' +
            '<label style="font-size:0.85rem;font-weight:600;">Contacts</label>' +
          '</div>' +
          '<div id="galContactRows">' + contactRowsHtml() + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:120px 100px 1fr;gap:8px;margin-bottom:12px;">' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Default %</label>' +
            '<input id="gal_pct" type="number" min="0" max="100" step="0.5" value="' + esc((typeof g.defaultCommissionPct === 'number') ? g.defaultCommissionPct : '') + '" placeholder="40" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Currency</label>' +
            '<input id="gal_currency" value="' + esc(g.currency || 'USD') + '" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '</div>' +
        '<div style="margin-bottom:16px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="gal_notes" rows="3" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;font-family:inherit;">' + esc(g.notes || '') + '</textarea></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button type="button" class="btn btn-secondary" onclick="consignmentShowGalleries()">Cancel</button>' +
          (isEdit ? '<button type="button" class="btn btn-secondary" style="color:var(--danger);border-color:var(--danger);" onclick="consignmentDeleteGallery(\'' + _jsAttr(galleryId) + '\')">Delete</button>' : '') +
          '<button type="submit" class="btn btn-primary">' + (isEdit ? 'Save' : 'Create gallery') + '</button>' +
        '</div>' +
      '</form>';
    tab.innerHTML = html;
  }

  function _collectGalleryFormValues() {
    function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
    var name = val('gal_name');
    var pct = parseFloat(val('gal_pct'));
    var currency = val('gal_currency') || 'USD';
    var notes = val('gal_notes');
    var addresses = [];
    document.querySelectorAll('[data-gal-addr-row]').forEach(function(row) {
      var rec = {};
      row.querySelectorAll('[data-gal-addr]').forEach(function(inp) {
        rec[inp.getAttribute('data-gal-addr')] = inp.value.trim();
      });
      if (Object.values(rec).some(function(v) { return v; })) addresses.push(rec);
    });
    var contacts = [];
    document.querySelectorAll('[data-gal-contact-row]').forEach(function(row) {
      var rec = {};
      row.querySelectorAll('[data-gal-contact]').forEach(function(inp) {
        rec[inp.getAttribute('data-gal-contact')] = inp.value.trim();
      });
      if (Object.values(rec).some(function(v) { return v; })) contacts.push(rec);
    });
    return {
      name: name,
      addresses: addresses,
      contacts: contacts,
      defaultCommissionPct: isNaN(pct) ? null : pct,
      currency: currency,
      notes: notes
    };
  }

  async function saveGallery(galleryId) {
    var v = _collectGalleryFormValues();
    if (!v.name) { showToast('Name is required'); return; }
    var now = new Date().toISOString();
    var id = galleryId || MastDB.newKey('admin/galleries');
    var existing = galleryId ? (galleriesData[galleryId] || {}) : {};
    var rec = Object.assign({}, existing, v, {
      id: id,
      createdAt: existing.createdAt || now,
      updatedAt: now
    });
    try {
      await MastDB.set('admin/galleries/' + id, rec);
      galleriesData[id] = rec;
      showToast(galleryId ? 'Gallery saved' : 'Gallery created');
      currentGalleryId = id;
      currentView = 'galleryDetail';
      renderCurrentView();
    } catch (e) {
      showToast('Save failed: ' + (e.message || String(e)), true);
    }
  }

  async function deleteGalleryEntity(galleryId) {
    var g = galleriesData[galleryId];
    if (!g) return;
    if (!await mastConfirm('Delete "' + (g.name || 'this gallery') + '"? Linked placements will remain but lose the gallery FK.', { title: 'Delete gallery', danger: true })) return;
    try {
      await MastDB.set('admin/galleries/' + galleryId, null);
      delete galleriesData[galleryId];
      showToast('Gallery deleted');
      currentView = 'galleries';
      currentGalleryId = null;
      renderCurrentView();
    } catch (e) {
      showToast('Delete failed: ' + (e.message || String(e)), true);
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

    // URL-driven filters from MCP admin links: status, dateFrom, dateTo, placementIds (#galleries?...)
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
    var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
    var urlIdsParam = (rp && typeof rp.placementIds === 'string') ? rp.placementIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var hasUrlFilter = !!(urlStatus || urlDateFrom || urlDateTo || urlIds.length);
    if (hasUrlFilter && (urlDateFrom || urlDateTo) && _tenantTz === null) {
      ensureTenantTz().then(function() { renderPlacementList(); });
    }

    var placements = Object.values(placementsData).sort(function(a, b) {
      if (a.status === 'active' && b.status !== 'active') return -1;
      if (a.status !== 'active' && b.status === 'active') return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    if (hasUrlFilter) {
      placements = placements.filter(function(p) {
        if (urlStatus && (p.status || 'active') !== urlStatus) return false;
        if (urlIdLookup && !urlIdLookup[p.placementId]) return false;
        if (urlDateFrom || urlDateTo) {
          var parts = tzPartsFromIso(p.createdAt || '');
          if (!parts) return false;
          var ds = parts.year + '-' + parts.month + '-' + parts.day;
          if (urlDateFrom && ds < urlDateFrom) return false;
          if (urlDateTo && ds > urlDateTo) return false;
        }
        return true;
      });
    }

    if (!placements.length && !hasUrlFilter) {
      tab.innerHTML = _galleriesSubNavHtml('placements') +
        '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">🏛️</div>' +
          '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No consignment placements yet</p>' +
          '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Track pieces placed at galleries, boutiques, and shops.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px;" onclick="consignmentShowNew()">+ New Placement</button>' +
        '</div>';
      return;
    }

    var html = '';

    if (hasUrlFilter) {
      var bparts = [];
      if (urlIds.length) bparts.push(urlIds.length + ' selected placement' + (urlIds.length === 1 ? '' : 's'));
      if (urlStatus) bparts.push('status: ' + urlStatus);
      if (urlDateFrom && urlDateTo) bparts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
      else if (urlDateFrom) bparts.push('from ' + urlDateFrom + ' onward');
      else if (urlDateTo) bparts.push('through ' + urlDateTo);
      html += '<div id="consignmentUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>🏛️ Showing ' + bparts.join(', ') + ' (' + placements.length + ')</span>' +
        '<button type="button" onclick="clearConsignmentFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    html += _galleriesSubNavHtml('placements');
    html +=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin:16px 0;">' +
        '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Galleries & Consignment</h3>' +
        '<button class="btn btn-primary" onclick="consignmentShowNew()">+ New Placement</button>' +
      '</div>';

    if (!placements.length) {
      html += '<div style="text-align:center;padding:30px;color:#999;font-size:0.85rem;">No placements match the filter.</div>';
      tab.innerHTML = html;
      return;
    }

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

    var settlements = (p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
    var totalSettledCents = Object.values(settlements).reduce(function(sum, s) {
      return sum + (s && Number(s.amountReceivedCents) || 0);
    }, 0);
    var outstanding = Math.max(0, totals.makerEarnings - totalSettledCents);

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
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:12px;border-top:1px solid var(--cream-dark);">' +
          '<div>' +
            '<div class="consignment-stat-label">Payouts Received</div>' +
            '<div style="font-size:1rem;font-weight:600;">' + formatCurrency(totalSettledCents) +
              ' · <span style="color:var(--warm-gray);">Outstanding: ' + formatCurrency(outstanding) + '</span></div>' +
          '</div>' +
          '<button class="btn btn-outline btn-small" onclick="consignmentRecordPayout(\'' + esc(placementId) + '\')">+ Record Payout</button>' +
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
      var retailPrice = priceInput ? Math.round((parseFloat(priceInput.value) || 0) * 100) : 0;

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

  // ============================================================
  // Payout received — Path B billing (cash-received basis).
  // Consignment sales count toward monthly revenue WHEN the
  // payout arrives, not when the gallery sells the item.
  // ============================================================
  function recordPayoutModal(placementId) {
    var p = placementsData[placementId];
    if (!p) { showToast('Placement not found', 'error'); return; }
    var totals = calculatePlacementTotals(p);
    var settlements = (p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
    var alreadyCents = Object.values(settlements).reduce(function(sum, s) {
      return sum + (s && Number(s.amountReceivedCents) || 0);
    }, 0);
    var outstandingCents = Math.max(0, totals.makerEarnings - alreadyCents);
    var today = new Date().toISOString().split('T')[0];

    var html =
      '<div style="padding:24px;">' +
      '<h3 style="font-size:1.15rem;font-weight:500;margin:0 0 4px;">Record Payout from ' + esc(p.locationName) + '</h3>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:16px;">' +
        'Outstanding earnings: <strong>' + formatCurrency(outstandingCents) + '</strong>' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:12px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Amount Received ($)</label>' +
        '<input type="number" id="payoutAmount" step="0.01" min="0" max="100000" value="' + (outstandingCents / 100).toFixed(2) + '" style="width:160px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:12px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Received Date</label>' +
        '<input type="date" id="payoutDate" value="' + today + '" style="width:160px;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">Revenue is attributed to the month the payment actually arrived.</div>' +
      '</div>' +
      '<div class="form-group" style="margin-bottom:20px;">' +
        '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes (optional)</label>' +
        '<input type="text" id="payoutNotes" placeholder="e.g. check #4521" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
      '</div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="consignmentConfirmPayout(\'' + esc(placementId) + '\')">Record Payout</button>' +
      '</div>' +
      '</div>';
    openModal(html);
  }

  async function confirmPayout(placementId) {
    var amountEl = document.getElementById('payoutAmount');
    var dateEl = document.getElementById('payoutDate');
    var notesEl = document.getElementById('payoutNotes');
    var amountDollars = parseFloat(amountEl && amountEl.value) || 0;
    var receivedDate = (dateEl && dateEl.value) || new Date().toISOString().split('T')[0];
    var notes = (notesEl && notesEl.value || '').trim();

    if (amountDollars <= 0 || amountDollars > 100000) {
      showToast('Amount must be between $0.01 and $100,000', 'error');
      return;
    }
    if (!receivedDate) {
      showToast('Received date required', 'error');
      return;
    }

    var amountCents = Math.round(amountDollars * 100);
    var settlementId = MastDB.consignments.newKey();
    var receivedAtIso = receivedDate + 'T12:00:00.000Z';
    var now = new Date().toISOString();

    var p = placementsData[placementId];
    var totals = p ? calculatePlacementTotals(p) : { makerEarnings: 0 };
    var existingSettlements = (p && p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
    var totalPreviouslySettledCents = Object.values(existingSettlements).reduce(function(sum, s) {
      return sum + (s && Number(s.amountReceivedCents) || 0);
    }, 0);
    var expectedAmountCents = Math.max(0, totals.makerEarnings - totalPreviouslySettledCents);

    var settlementRecord = {
      settlementId: settlementId,
      date: receivedDate,
      amountReceivedCents: amountCents,
      expectedAmountCents: expectedAmountCents,
      method: null,
      referenceNumber: null,
      notes: notes || null,
      createdAt: now,
      createdBy: (window.currentUser && window.currentUser.uid) || 'admin'
    };

    try {
      await MastDB.consignments.setField(placementId, 'settlements/' + settlementId, settlementRecord);

      var newTotalSettledCents = totalPreviouslySettledCents + amountCents;
      await MastDB.consignments.update(placementId, {
        totalSettled: newTotalSettledCents,
        lastSettlementDate: receivedDate,
        updatedAt: now
      });

      try {
        await firebase.functions().httpsCallable('recordTenantRevenue')({
          tenantId: (MastDB && MastDB.tenantId && MastDB.tenantId()) || undefined,
          channelKey: 'consignment',
          sourceId: placementId + ':' + settlementId,
          receivedAt: receivedAtIso,
          grossCents: amountCents,
          salesTaxCents: 0,
          shippingCents: 0,
          processorFeesCents: 0,
          marketplaceFeesCents: 0,
          refundsCents: 0
        });
      } catch (revErr) {
        console.warn('Consignment payout accumulator write failed (non-fatal):', revErr && revErr.message ? revErr.message : revErr);
      }

      closeModal();
      showToast('Payout of ' + formatCurrency(amountCents) + ' recorded');
      renderPlacementDetail(placementId);
    } catch (err) {
      console.error('Consignment payout error:', err);
      showToast('Failed to record payout: ' + err.message, 'error');
    }
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
    var retailPrice = priceEl ? Math.round((parseFloat(priceEl.value) || 0) * 100) : 0;

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

  // Payout received (Path B billing)
  window.consignmentRecordPayout = recordPayoutModal;
  window.consignmentConfirmPayout = confirmPayout;

  // Product rows in new form
  window.consignmentAddProductRow = addProductRow;
  window.consignmentProductSelected = productSelected;
  window.consignmentRemoveProductRow = removeProductRow;

  // URL-filter clear (MCP admin-link landings)
  window.clearConsignmentFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'status' && k !== 'dateFrom' && k !== 'dateTo' && k !== 'placementIds') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('galleries', clean);
    else location.hash = '#galleries';
    setTimeout(function() { if (typeof renderPlacementList === 'function') renderPlacementList(); }, 0);
  };
  window.renderConsignmentList = renderPlacementList;

  // W2.7 — Gallery-as-entity windowed actions
  window.consignmentShowGalleries = function() {
    currentView = 'galleries';
    currentGalleryId = null;
    if (!galleriesLoaded) loadGalleries(function() { renderCurrentView(); });
    else renderCurrentView();
  };
  window.consignmentShowGallery = function(id) {
    currentGalleryId = id;
    currentView = 'galleryDetail';
    if (!galleriesLoaded) loadGalleries(function() { renderCurrentView(); });
    else renderCurrentView();
  };
  // W2 R3 Fix 2: New Gallery now opens a true in-page modal (was silently
  // re-rendering #galleriesTab inline, which on certain widths/scroll
  // positions appeared to do nothing). Modal reuses the same form field
  // ids + data attributes so _collectGalleryFormValues() works unchanged.
  // Submit calls consignmentSaveGalleryModal which closes the modal,
  // persists the entity, and refreshes the list.
  window.consignmentNewGallery = function() {
    var addrRows =
      '<div style="display:grid;grid-template-columns:2fr 1fr 80px 100px 100px;gap:8px;margin-bottom:6px;" data-gal-addr-row="0">' +
        '<input data-gal-addr="street" data-i="0" placeholder="Street" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '<input data-gal-addr="city" data-i="0" placeholder="City" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '<input data-gal-addr="state" data-i="0" placeholder="ST" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '<input data-gal-addr="zip" data-i="0" placeholder="Zip" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '<input data-gal-addr="country" data-i="0" placeholder="Country" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
      '</div>';
    var contactRows =
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:6px;" data-gal-contact-row="0">' +
        '<input data-gal-contact="name" data-i="0" placeholder="Name" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '<input data-gal-contact="email" data-i="0" placeholder="Email" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '<input data-gal-contact="phone" data-i="0" placeholder="Phone" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
        '<input data-gal-contact="role" data-i="0" placeholder="Role" style="padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.85rem;">' +
      '</div>';
    var html =
      '<h3 style="font-size:1.15rem;font-weight:500;margin:0 0 16px;">New Gallery</h3>' +
      '<form id="newGalleryModalForm" onsubmit="event.preventDefault();consignmentSaveGalleryModal();return false;">' +
        '<div style="margin-bottom:12px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Name *</label>' +
          '<input id="gal_name" required style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Addresses</label>' +
          '<div id="galAddressRows">' + addrRows + '</div>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Contacts</label>' +
          '<div id="galContactRows">' + contactRows + '</div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:120px 100px 1fr;gap:8px;margin-bottom:12px;">' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Default %</label>' +
            '<input id="gal_pct" type="number" min="0" max="100" step="0.5" placeholder="40" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
          '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Currency</label>' +
            '<input id="gal_currency" value="USD" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '</div>' +
        '<div style="margin-bottom:16px;"><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="gal_notes" rows="3" style="width:100%;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;font-family:inherit;"></textarea></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
          '<button type="button" class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button type="submit" class="btn btn-primary">Create gallery</button>' +
        '</div>' +
      '</form>';
    openModal(html);
  };

  // Submit handler for the New Gallery modal. Persists the entity then
  // closes the modal and shows the Galleries list with the new row.
  window.consignmentSaveGalleryModal = async function() {
    var v = _collectGalleryFormValues();
    if (!v.name) { showToast('Name is required'); return; }
    var now = new Date().toISOString();
    var id = MastDB.newKey('admin/galleries');
    var rec = Object.assign({}, v, { id: id, createdAt: now, updatedAt: now });
    try {
      await MastDB.set('admin/galleries/' + id, rec);
      galleriesData[id] = rec;
      closeModal();
      showToast('Gallery created');
      currentGalleryId = id;
      currentView = 'galleryDetail';
      renderCurrentView();
    } catch (e) {
      showToast('Save failed: ' + (e.message || String(e)), true);
    }
  };
  window.consignmentEditGallery = function(id) {
    currentGalleryId = id;
    currentView = 'galleryEdit';
    renderCurrentView();
  };
  window.consignmentSaveGallery = saveGallery;
  window.consignmentDeleteGallery = deleteGalleryEntity;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('consignment', {
    routes: {
      'galleries': { tab: 'galleriesTab', setup: function() {
        // W2 R2 Fix 4: honor ?subView=galleries URL param so deep-link + sub-tab
        // refresh land on the Galleries entity view instead of always defaulting
        // to Placements. Without this, currentView was forcibly reset to 'list'
        // on every route entry, hiding the new W2.7 surfaces.
        var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
        var sv = rp && typeof rp.subView === 'string' ? rp.subView : '';
        if (sv === 'galleries') {
          currentView = 'galleries';
          currentGalleryId = null;
        } else if (sv === 'galleryDetail' && rp.galleryId) {
          currentView = 'galleryDetail';
          currentGalleryId = rp.galleryId;
        } else {
          currentView = 'list';
          currentPlacementId = null;
        }
        loadPlacements();
        loadGalleries();
        // Ensure products are loaded for product picker
        if (!window.productsLoaded && typeof window.loadProducts === 'function') {
          window.loadProducts();
        }
      } }
    },
    detachListeners: function() {
      unloadPlacements();
      if (galleriesListener && typeof galleriesListener === 'function') {
        try { galleriesListener(); } catch (e) {}
      }
      galleriesListener = null;
      galleriesData = {};
      galleriesLoaded = false;
    }
  });

})();
