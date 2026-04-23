/**
 * Promotions Module — Sale/Promotion Management
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // Module-private state
  var promotionsData = {};
  var promotionsListener = null;
  var promotionsLoaded = false;
  var currentFilter = 'active';
  var productsCache = null;

  var STATUS_COLORS = {
    active: '#16a34a',
    scheduled: '#2563eb',
    ended: '#9ca3af'
  };

  // ── Helpers ──

  function esc(s) { if (!s) return ''; var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function formatCents(cents) {
    if (typeof cents !== 'number' || isNaN(cents)) return '';
    return '$' + (cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function computeStatus(sale) {
    if (sale.archived) return 'ended';
    var now = new Date().toISOString();
    if (sale.startDate && sale.startDate > now) return 'scheduled';
    if (sale.endDate && sale.endDate < now) return 'ended';
    return 'active';
  }

  function calcSalePrice(originalCents, discountType, discountValue) {
    if (discountType === 'percent') return Math.round(originalCents * (1 - discountValue / 100));
    return Math.max(0, originalCents - discountValue);
  }

  function extractPids(products) {
    if (!Array.isArray(products)) return [];
    return products.map(function(p) { return typeof p === 'string' ? p : p.pid; }).filter(Boolean);
  }

  function formatDiscount(sale) {
    if (sale.discountType === 'percent') return sale.discountValue + '% off';
    return formatCents(sale.discountValue) + ' off';
  }

  function statusBadge(status) {
    var bg = STATUS_COLORS[status] || '#9ca3af';
    return '<span style="display:inline-block;background:' + bg + ';color:white;font-size:0.72rem;font-weight:600;padding:2px 8px;border-radius:4px;text-transform:capitalize;">' + status + '</span>';
  }

  // ── Data Loading ──

  function loadPromotions() {
    if (promotionsLoaded) {
      renderPromotions();
      return;
    }
    promotionsListener = MastDB.promotions.listen(200, function(snap) {
      promotionsData = snap.val() || {};
      promotionsLoaded = true;
      renderPromotions();
    }, function(err) {
      console.error('Promotions listener error:', err);
    });
  }

  async function loadProductsCache() {
    if (productsCache) return productsCache;
    var data = (await MastDB.products.list(500)) || {};
    productsCache = Object.entries(data).map(function(entry) {
      var val = entry[1];
      return {
        pid: val.pid || entry[0],
        name: val.name || entry[0],
        priceCents: val.priceCents || 0,
        categories: val.categories || [],
        options: val.options || [],
        status: val.status || 'active'
      };
    }).filter(function(p) { return p.status === 'active'; });
    return productsCache;
  }

  // ── Render List ──

  function renderPromotions() {
    var loadingEl = document.getElementById('promotionsLoading');
    var emptyEl = document.getElementById('promotionsEmpty');
    var tableEl = document.getElementById('promotionsTable');
    var tbodyEl = document.getElementById('promotionsTableBody');
    var cardsEl = document.getElementById('promotionCards');
    var filterBar = document.getElementById('promotionsFilterBar');

    if (loadingEl) loadingEl.style.display = 'none';

    var ids = Object.keys(promotionsData);
    if (ids.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      if (tableEl) tableEl.style.display = 'none';
      if (cardsEl) cardsEl.innerHTML = '';
      if (filterBar) filterBar.style.display = 'none';
      return;
    }

    if (emptyEl) emptyEl.style.display = 'none';
    if (filterBar) filterBar.style.display = '';

    // Build list with computed status
    var sales = ids.map(function(id) {
      var s = promotionsData[id];
      return Object.assign({ id: id, computedStatus: computeStatus(s) }, s);
    });

    // Filter
    if (currentFilter !== 'all') {
      sales = sales.filter(function(s) {
        if (currentFilter === 'ended') return s.computedStatus === 'ended';
        return s.computedStatus === currentFilter;
      });
    }

    // Sort: active first, then scheduled, then ended
    var statusOrder = { active: 0, scheduled: 1, ended: 2 };
    sales.sort(function(a, b) {
      var diff = (statusOrder[a.computedStatus] || 9) - (statusOrder[b.computedStatus] || 9);
      if (diff !== 0) return diff;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    if (sales.length === 0) {
      if (tableEl) tableEl.style.display = 'none';
      if (cardsEl) cardsEl.innerHTML = '<p style="text-align:center;color:var(--warm-gray);padding:2rem;">No ' + currentFilter + ' promotions.</p>';
      return;
    }

    if (tableEl) tableEl.style.display = '';

    // Desktop table
    var tableHtml = '';
    for (var i = 0; i < sales.length; i++) {
      var s = sales[i];
      var pids = extractPids(s.products || []);
      var dateStr = '';
      if (s.startDate && s.endDate) dateStr = formatDate(s.startDate) + ' \u2013 ' + formatDate(s.endDate);
      else if (s.startDate && !s.endDate) dateStr = 'From ' + formatDate(s.startDate) + (s.keepAfterEnd ? ' (ongoing)' : '');
      else dateStr = '\u2014';

      tableHtml += '<tr>' +
        '<td><strong>' + esc(s.name) + '</strong>' +
          (s.keepAfterEnd ? ' <span style="font-size:0.72rem;background:rgba(37,99,235,0.15);color:#2563eb;padding:2px 6px;border-radius:3px;">Ongoing</span>' : '') +
        '</td>' +
        '<td>' + esc(formatDiscount(s)) + '</td>' +
        '<td>' + pids.length + ' product' + (pids.length !== 1 ? 's' : '') + '</td>' +
        '<td>' + statusBadge(s.computedStatus) + '</td>' +
        '<td><span style="font-size:0.85rem;color:var(--warm-gray);">' + dateStr + '</span></td>' +
        '<td><div class="event-actions">' +
          '<button class="btn-icon" onclick="openPromotionModal(\'' + esc(s.id) + '\')" title="Edit">\u270E</button>' +
          (s.computedStatus === 'active' ? '<button class="btn-icon" onclick="confirmEndPromotion(\'' + esc(s.id) + '\')" title="End Sale">\u23F9</button>' : '') +
          '<button class="btn-icon danger" onclick="confirmDeletePromotion(\'' + esc(s.id) + '\')" title="Delete">\u2716</button>' +
        '</div></td>' +
      '</tr>';
    }
    if (tbodyEl) tbodyEl.innerHTML = tableHtml;

    // Mobile cards
    var cardsHtml = '';
    for (var j = 0; j < sales.length; j++) {
      var sc = sales[j];
      var pidsc = extractPids(sc.products || []);
      var dateStrc = '';
      if (sc.startDate && sc.endDate) dateStrc = formatDate(sc.startDate) + ' \u2013 ' + formatDate(sc.endDate);
      else if (sc.startDate) dateStrc = 'From ' + formatDate(sc.startDate);

      cardsHtml += '<div class="coupon-card">' +
        '<div class="coupon-card-header">' +
          '<strong>' + esc(sc.name) + '</strong> ' + statusBadge(sc.computedStatus) +
        '</div>' +
        '<div style="margin:8px 0;">' +
          '<span style="font-weight:600;">' + esc(formatDiscount(sc)) + '</span>' +
          ' \u00B7 ' + pidsc.length + ' product' + (pidsc.length !== 1 ? 's' : '') +
        '</div>' +
        (dateStrc ? '<div style="font-size:0.85rem;color:var(--warm-gray);">' + dateStrc + '</div>' : '') +
        '<div class="coupon-card-actions" style="margin-top:10px;display:flex;gap:8px;">' +
          '<button class="btn btn-sm" onclick="openPromotionModal(\'' + esc(sc.id) + '\')">Edit</button>' +
          (sc.computedStatus === 'active' ? '<button class="btn btn-sm" onclick="confirmEndPromotion(\'' + esc(sc.id) + '\')">End</button>' : '') +
          '<button class="btn btn-sm btn-danger" onclick="confirmDeletePromotion(\'' + esc(sc.id) + '\')">Delete</button>' +
        '</div>' +
      '</div>';
    }
    if (cardsEl) cardsEl.innerHTML = cardsHtml;
  }

  // ── Filter ──

  window.filterPromotions = function(status, el) {
    currentFilter = status;
    var pills = document.querySelectorAll('#promotionsFilterBar .filter-pill');
    pills.forEach(function(p) { p.classList.remove('active'); });
    if (el) el.classList.add('active');
    renderPromotions();
  };

  // ── Create/Edit Modal ──

  window.openPromotionModal = function(saleId) {
    var isEdit = !!saleId;
    var sale = isEdit ? promotionsData[saleId] : null;

    loadProductsCache().then(function(allProducts) {
      var existingPids = sale ? extractPids(sale.products || []) : [];

      var html = '<div class="modal-header"><h3>' + (isEdit ? 'Edit Sale' : 'Create Sale') + '</h3>' +
        '<button class="modal-close" onclick="closeModal()">\u2716</button></div>' +
        '<div class="modal-body">' +
          '<div class="form-group"><label>Sale Name</label>' +
            '<input type="text" id="promoName" value="' + esc(sale ? sale.name : '') + '" placeholder="e.g., Spring Sale, Seconds" class="form-input" /></div>' +
          '<div class="checkout-form-row" style="display:flex;gap:12px;">' +
            '<div class="form-group" style="flex:1;"><label>Discount Type</label>' +
              '<select id="promoDiscountType" class="form-input" onchange="promoTypeChanged()">' +
                '<option value="percent"' + (sale && sale.discountType === 'percent' ? ' selected' : '') + '>Percent Off</option>' +
                '<option value="fixed"' + (sale && sale.discountType === 'fixed' ? ' selected' : '') + '>Fixed Amount Off</option>' +
              '</select></div>' +
            '<div class="form-group" style="flex:1;"><label>Discount Value</label>' +
              '<input type="number" id="promoDiscountValue" value="' + (sale ? sale.discountValue : '') + '" placeholder="' + (sale && sale.discountType === 'fixed' ? 'Amount in cents' : '0-100') + '" min="0" class="form-input" /></div>' +
          '</div>' +
          '<div class="checkout-form-row" style="display:flex;gap:12px;">' +
            '<div class="form-group" style="flex:1;"><label>Start Date</label>' +
              '<input type="datetime-local" id="promoStartDate" value="' + (sale && sale.startDate ? sale.startDate.slice(0,16) : new Date().toISOString().slice(0,16)) + '" class="form-input" /></div>' +
            '<div class="form-group" style="flex:1;"><label>End Date <span style="color:var(--warm-gray);font-size:0.8em;">(optional)</span></label>' +
              '<input type="datetime-local" id="promoEndDate" value="' + (sale && sale.endDate ? sale.endDate.slice(0,16) : '') + '" class="form-input" /></div>' +
          '</div>' +
          '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
            '<input type="checkbox" id="promoKeepAfterEnd"' + (sale && sale.keepAfterEnd ? ' checked' : '') + ' /> Keep after end (prevent auto-archiving)</label></div>' +
          '<div class="form-group"><label>Products</label>' +
            '<div id="promoProductPicker" style="max-height:250px;overflow-y:auto;border:1px solid var(--border,#ddd);border-radius:8px;padding:8px;">';

      // Product checkboxes
      for (var i = 0; i < allProducts.length; i++) {
        var p = allProducts[i];
        var isChecked = existingPids.indexOf(p.pid) !== -1;
        var priceStr = p.priceCents ? formatCents(p.priceCents) : '';
        html += '<label style="display:flex;align-items:center;gap:8px;padding:6px 4px;cursor:pointer;border-bottom:1px solid var(--border-light,#eee);">' +
          '<input type="checkbox" class="promo-product-cb" data-pid="' + esc(p.pid) + '"' + (isChecked ? ' checked' : '') + ' />' +
          '<span style="flex:1;">' + esc(p.name) + '</span>' +
          (priceStr ? '<span style="color:var(--warm-gray);font-size:0.85em;">' + priceStr + '</span>' : '') +
        '</label>';
      }

      html += '</div></div>' +
        '</div>' +
        '<div class="modal-footer">' +
          '<button class="btn" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="savePromotion(' + (isEdit ? '\'' + esc(saleId) + '\'' : '') + ')">' + (isEdit ? 'Update' : 'Create Sale') + '</button>' +
        '</div>';

      openModal(html);
    });
  };

  window.promoTypeChanged = function() {
    var type = document.getElementById('promoDiscountType').value;
    var valInput = document.getElementById('promoDiscountValue');
    if (valInput) valInput.placeholder = type === 'fixed' ? 'Amount in cents (e.g., 500 = $5)' : '0-100';
  };

  // ── Save ──

  window.savePromotion = async function(existingSaleId) {
    var name = (document.getElementById('promoName').value || '').trim();
    var discountType = document.getElementById('promoDiscountType').value;
    var discountValue = parseFloat(document.getElementById('promoDiscountValue').value);
    var startDate = document.getElementById('promoStartDate').value;
    var endDate = document.getElementById('promoEndDate').value || null;
    var keepAfterEnd = document.getElementById('promoKeepAfterEnd').checked;

    // Validation
    if (!name) { showToast('Sale name is required', true); return; }
    if (isNaN(discountValue) || discountValue <= 0) { showToast('Discount value must be greater than 0', true); return; }
    if (discountType === 'percent' && discountValue > 100) { showToast('Percent cannot exceed 100', true); return; }
    if (!startDate) { showToast('Start date is required', true); return; }

    // Collect selected products
    var checkboxes = document.querySelectorAll('.promo-product-cb:checked');
    var products = [];
    checkboxes.forEach(function(cb) { products.push(cb.getAttribute('data-pid')); });
    if (products.length === 0) { showToast('Select at least one product', true); return; }

    // Convert dates to ISO
    var startISO = new Date(startDate).toISOString();
    var endISO = endDate ? new Date(endDate).toISOString() : null;

    if (endISO && endISO < startISO) { showToast('End date must be after start date', true); return; }

    var now = new Date().toISOString();
    var data = {
      name: name,
      discountType: discountType,
      discountValue: discountValue,
      products: products,
      startDate: startISO,
      endDate: endISO,
      keepAfterEnd: keepAfterEnd,
      updatedAt: now
    };

    try {
      if (existingSaleId) {
        await MastDB.promotions.update(existingSaleId, data);
        writeAudit('update', 'sale-promotion', existingSaleId);
        showToast('Sale updated');
      } else {
        data.archived = false;
        data.createdAt = now;
        var promoId = MastDB.promotions.newKey();
        await MastDB.promotions.set(promoId, data);
        writeAudit('create', 'sale-promotion', promoId);
        showToast('Sale created');
      }
      closeModal();
    } catch (err) {
      console.error('Save promotion error:', err);
      showToast('Failed to save promotion', true);
    }
  };

  // ── End Sale ──

  window.confirmEndPromotion = function(saleId) {
    var sale = promotionsData[saleId];
    if (!sale) return;
    var html = '<div class="modal-header"><h3>End Sale</h3>' +
      '<button class="modal-close" onclick="closeModal()">\u2716</button></div>' +
      '<div class="modal-body"><p>End <strong>' + esc(sale.name) + '</strong> now? Products will return to full price on the storefront.</p></div>' +
      '<div class="modal-footer">' +
        '<button class="btn" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="endPromotion(\'' + esc(saleId) + '\')">End Sale</button>' +
      '</div>';
    openModal(html);
  };

  window.endPromotion = async function(saleId) {
    try {
      await MastDB.promotions.update(saleId, { endDate: new Date().toISOString(), updatedAt: new Date().toISOString() });
      writeAudit('update', 'sale-promotion', saleId);
      showToast('Sale ended');
      closeModal();
    } catch (err) {
      showToast('Failed to end sale', true);
    }
  };

  // ── Delete ──

  window.confirmDeletePromotion = function(saleId) {
    var sale = promotionsData[saleId];
    if (!sale) return;
    var html = '<div class="modal-header"><h3>Delete Sale</h3>' +
      '<button class="modal-close" onclick="closeModal()">\u2716</button></div>' +
      '<div class="modal-body"><p>Permanently delete <strong>' + esc(sale.name) + '</strong>? This cannot be undone.</p></div>' +
      '<div class="modal-footer">' +
        '<button class="btn" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-danger" onclick="deletePromotion(\'' + esc(saleId) + '\')">Delete</button>' +
      '</div>';
    openModal(html);
  };

  window.deletePromotion = async function(saleId) {
    try {
      await MastDB.promotions.remove(saleId);
      writeAudit('delete', 'sale-promotion', saleId);
      showToast('Sale deleted');
      closeModal();
    } catch (err) {
      showToast('Failed to delete sale', true);
    }
  };

  // ── Module Registration ──

  MastAdmin.registerModule('promotions', {
    routes: {
      promotions: {
        tab: 'promotionsTab',
        setup: function() { loadPromotions(); }
      }
    },
    lazyLoad: function() { loadPromotions(); },
    attachListeners: function() {
      if (!promotionsListener) {
        promotionsListener = MastDB.promotions.listen(200, function(snap) {
          promotionsData = snap.val() || {};
          promotionsLoaded = true;
          if (document.getElementById('promotionsTab') && document.getElementById('promotionsTab').style.display !== 'none') {
            renderPromotions();
          }
        });
      }
    },
    detachListeners: function() {
      if (promotionsListener) {
        MastDB.promotions.unlisten(promotionsListener);
        promotionsListener = null;
      }
      promotionsLoaded = false;
      promotionsData = {};
      productsCache = null;
    }
  });

})();
