/**
 * Orders + Commissions + Dashboard Cards Module
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';


  // orderTotalDollars (canonical order grand-total, DOLLARS) moved to
  // shared/orders-core.js (eager) in PR1c as transitive closure of the invoice
  // surface (markOrderInvoicePaid / buildInvoiceSection consume it). The bare
  // orderTotalDollars(...) references in the V1 render code below resolve to
  // window.orderTotalDollars exposed there.

  // ============================================================
  // Badge Style Helpers (inline colors per style guide)
  // ============================================================

  // orderStatusBadgeStyle + ORDER_STATUS_BADGE_COLORS moved to shared/orders-core.js
  // (eager). Bare references below resolve to window.orderStatusBadgeStyle.

  // etsySourceBadgeStyle moved to shared/orders-core.js (eager).

  // ============================================================
  // Orders Management
  // ============================================================

  // loadOrders moved to shared/orders-core.js (eager) in PR1c: it's bare-called
  // by fulfillment.js / wholesale.js / the shell without loadModule('orders'),
  // so an eager home closes that latent load-order fragility. Its renderOrders()
  // refresh is now guarded (typeof === 'function') so it skips gracefully when
  // the V1 orders UI isn't loaded.

  // getOrdersArray moved to shared/orders-core.js (eager): reads the shell
  // 'orders' cache global. Bare refs + window.getOrdersArray resolve there.

  // getOrderDisplayNumber, the tenant-tz cluster (ensureTenantTz / tzPartsFromIso),
  // formatOrderDate, formatOrderDateTime, and getOrderItemsLabel moved to
  // shared/orders-core.js (eager). Bare references below (incl. tzPartsFromIso /
  // ensureTenantTz in the V1 render code) resolve to the corresponding window
  // globals exposed there.



  // ============================================================
  // Dashboard Cards
  // ============================================================

  function renderDashCardNewOrders() {
    var container = document.getElementById('dashCardNewOrders');
    if (!container) return;
    if (!ordersLoaded) { container.innerHTML = ''; return; }
    var cardConfig = DASHBOARD_CARDS.find(function(c) { return c.id === 'newOrders'; });

    var newOrders = getOrdersArray().filter(function(o) {
      return (o.status || 'placed') === 'placed';
    });

    var contentHtml = '';
    if (newOrders.length === 0) {
      contentHtml = '<div class="dash-queue-empty">No new orders.</div>';
    } else {
      contentHtml = '<div class="dash-queue-grid">';
      newOrders.forEach(function(o) {
        var key = o._key;
        var num = esc(getOrderDisplayNumber(o));
        var status = o.status || 'placed';
        var customer = o.customerName || o.email || '';
        var sourceBadge = o.source === 'etsy' ? ' <span class="status-badge" style="font-size:0.72rem;' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
        contentHtml += '<div class="dash-queue-item" onclick="viewOrder(\'' + esc(key) + '\')">' +
          '<div class="dash-queue-row">' +
            '<span class="dash-queue-order-num">' + num + sourceBadge + '</span>' +
            '<span class="status-badge pill" style="font-size:0.72rem;padding:2px 8px;' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span>' +
          '</div>' +
          (customer ? '<div class="dash-queue-customer">' + esc(customer) + '</div>' : '') +
          '<div class="dash-queue-meta">' +
            '<span>' + getOrderItemsLabel(o) + '</span>' +
            '<span>$' + orderTotalDollars(o).toFixed(2) + '</span>' +
            '<span>' + formatOrderDate(o.placedAt || o.pendingPaymentAt) + '</span>' +
          '</div>' +
        '</div>';
      });
      contentHtml += '</div>';
    }

    container.innerHTML = renderDashboardCard(cardConfig, newOrders.length, contentHtml);
    if (newOrders.length > 0 && typeof updateCardActivity === 'function') {
      var latestTs = newOrders.reduce(function(max, o) { var t = o.placedAt || o.createdAt || ''; return t > max ? t : max; }, '');
      updateCardActivity('newOrders', latestTs);
    }
  }

  // Dashboard Card: Ready to Ship

  function renderDashCardReadyToShip() {
    var container = document.getElementById('dashCardReadyToShip');
    if (!container) return;
    if (!ordersLoaded) { container.innerHTML = ''; return; }
    var cardConfig = DASHBOARD_CARDS.find(function(c) { return c.id === 'readyToShip'; });

    var packedOrders = getOrdersArray().filter(function(o) {
      return o.status === 'packed';
    });

    var contentHtml = '';
    if (packedOrders.length === 0) {
      contentHtml = '<div class="dash-queue-empty">No packed orders awaiting pickup.</div>';
    } else {
      contentHtml = '<div class="dash-queue-grid">';
      packedOrders.forEach(function(o) {
        var key = o._key;
        var num = esc(getOrderDisplayNumber(o));
        var customer = o.customerName || o.email || '';
        var sourceBadge = o.source === 'etsy' ? ' <span class="status-badge" style="font-size:0.72rem;' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
        contentHtml += '<div class="dash-queue-item" onclick="viewOrder(\'' + esc(key) + '\')">' +
          '<div class="dash-queue-row">' +
            '<span class="dash-queue-order-num">' + num + sourceBadge + '</span>' +
            '<span class="status-badge pill" style="font-size:0.72rem;padding:2px 8px;' + orderStatusBadgeStyle('packed') + '">packed</span>' +
          '</div>' +
          (customer ? '<div class="dash-queue-customer">' + esc(customer) + '</div>' : '') +
          '<div class="dash-queue-meta">' +
            '<span>' + getOrderItemsLabel(o) + '</span>' +
            '<span>$' + orderTotalDollars(o).toFixed(2) + '</span>' +
            '<span>' + formatOrderDate(o.placedAt || o.pendingPaymentAt) + '</span>' +
          '</div>' +
        '</div>';
      });
      contentHtml += '</div>';
    }

    container.innerHTML = renderDashboardCard(cardConfig, packedOrders.length, contentHtml);
    if (packedOrders.length > 0 && typeof updateCardActivity === 'function') {
      var latestTs = packedOrders.reduce(function(max, o) { var t = o.placedAt || o.createdAt || ''; return t > max ? t : max; }, '');
      updateCardActivity('readyToShip', latestTs);
    }
  }

  // ============================================================
  // RMA / Returns Admin Management
  // ============================================================

  var rmaData = {};
  var rmaLoaded = false;
  var rmaFilter = 'all';
  var selectedRmaId = null;

  var RMA_STATUS_BADGE_COLORS = {
    requested:     { bg: 'rgba(230,81,0,0.2)',  color: '#FFB74D', border: 'rgba(230,81,0,0.35)' },
    approved:      { bg: 'rgba(21,101,192,0.2)', color: '#64B5F6', border: 'rgba(21,101,192,0.35)' },
    'shipped-back':{ bg: 'rgba(123,31,162,0.2)', color: '#CE93D8', border: 'rgba(123,31,162,0.35)' },
    received:      { bg: 'rgba(27,92,82,0.25)',  color: '#4DB6AC', border: 'rgba(27,92,82,0.4)' },
    inspected:     { bg: 'rgba(0,121,107,0.2)',  color: '#4DB6AC', border: 'rgba(0,121,107,0.35)' },
    restocked:     { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    seconds:       { bg: 'rgba(255,152,0,0.2)',  color: '#FFB74D', border: 'rgba(255,152,0,0.35)' },
    'repair-queued':{ bg: 'rgba(33,150,243,0.2)', color: '#64B5F6', border: 'rgba(33,150,243,0.35)' },
    'written-off': { bg: 'rgba(158,158,158,0.2)', color: '#BDBDBD', border: 'rgba(158,158,158,0.35)' },
    'refund-issued':{ bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    declined:      { bg: 'rgba(198,40,40,0.2)',  color: '#EF5350', border: 'rgba(198,40,40,0.35)' }
  };

  function rmaBadgeStyle(status) {
    var c = RMA_STATUS_BADGE_COLORS[status] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  var RMA_VALID_TRANSITIONS = {
    requested:     ['approved', 'declined'],
    approved:      ['shipped-back'],
    'shipped-back':['received'],
    received:      ['inspected'],
    inspected:     ['restocked', 'seconds', 'repair-queued', 'written-off'],
    restocked:     [],
    seconds:       [],
    'repair-queued':[],
    'written-off': [],
    'refund-issued':[],
    declined:      []
  };

  function viewRmaTicket(ticketId) {
    navigateTo('cs-tickets');
    var open = function() {
      if (typeof csOpenThread === 'function') csOpenThread(ticketId);
    };
    if (typeof csOpenThread === 'function') {
      open();
    } else if (typeof MastAdmin !== 'undefined' && typeof MastAdmin.loadModule === 'function') {
      MastAdmin.loadModule('customer-service').then(function() {
        setTimeout(open, 100);
      });
    }
  }

  function loadRmaData() {
    if (rmaLoaded) { renderRma(); return; }
    MastDB.query('admin/rma').limitToLast(200).once('value').then(function(snap) {
      rmaData = snap.val() || {};
      rmaLoaded = true;
      renderRma();
      updateRmaSidebarBadge();
    }).catch(function(err) {
      console.error('[RMA] load error:', err);
      var loadingEl = document.getElementById('rmaLoading');
      var emptyEl = document.getElementById('rmaEmpty');
      if (loadingEl) loadingEl.style.display = 'none';
      if (emptyEl) { emptyEl.style.display = ''; emptyEl.innerHTML = '<p style="color:var(--danger)">Error loading returns: ' + err.message + '</p>'; }
    });
  }

  function updateRmaSidebarBadge() {
    var requestedCount = Object.keys(rmaData).filter(function(k) {
      return rmaData[k].status === 'requested';
    }).length;
    var badge = document.getElementById('sidebarRmaBadge');
    if (badge) {
      if (requestedCount > 0) {
        badge.textContent = requestedCount;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  function getRmaArray() {
    var arr = [];
    Object.keys(rmaData).forEach(function(key) {
      var r = rmaData[key];
      r._key = key;
      arr.push(r);
    });
    arr.sort(function(a, b) {
      return (b.requestedAt || b.createdAt || '').localeCompare(a.requestedAt || a.createdAt || '');
    });
    return arr;
  }

  function setRmaFilter(filter) {
    rmaFilter = filter;
    renderRma();
  }

  function renderRma() {
    var loadingEl = document.getElementById('rmaLoading');
    var emptyEl = document.getElementById('rmaEmpty');
    var tableEl = document.getElementById('rmaTable');
    var tbodyEl = document.getElementById('rmaTableBody');
    var countEl = document.getElementById('rmaCount');
    var pillsEl = document.getElementById('rmaFilterPills');

    if (loadingEl) loadingEl.style.display = 'none';

    var all = getRmaArray();

    // Count by status
    var counts = {};
    all.forEach(function(r) {
      var s = r.status || 'requested';
      counts[s] = (counts[s] || 0) + 1;
    });

    // Render filter pills
    var activeCount = (counts.requested || 0) + (counts.approved || 0) + (counts['shipped-back'] || 0) + (counts.received || 0) + (counts.inspected || 0);
    var completedCount = (counts.restocked || 0) + (counts.seconds || 0) + (counts['repair-queued'] || 0) + (counts['written-off'] || 0) + (counts['refund-issued'] || 0);
    var pillStatuses = [
      { key: 'all', label: 'All', count: all.length },
      { key: 'active', label: 'Active', count: activeCount },
      { key: 'requested', label: 'Requested', count: counts.requested || 0 },
      { key: 'approved', label: 'Approved', count: counts.approved || 0 },
      { key: 'received', label: 'Received', count: (counts.received || 0) + (counts.inspected || 0) },
      { key: 'completed', label: 'Completed', count: completedCount },
      { key: 'declined', label: 'Declined', count: counts.declined || 0 }
    ];
    var pillHtml = '';
    pillStatuses.forEach(function(p) {
      pillHtml += '<button class="order-filter-pill' + (rmaFilter === p.key ? ' active' : '') +
        '" onclick="setRmaFilter(\'' + p.key + '\')">' + p.label +
        '<span class="pill-count">(' + p.count + ')</span></button>';
    });
    if (pillsEl) pillsEl.innerHTML = pillHtml;

    // Filter
    var filtered;
    var ACTIVE_STATUSES = ['requested', 'approved', 'shipped-back', 'received', 'inspected'];
    var COMPLETED_STATUSES = ['restocked', 'seconds', 'repair-queued', 'written-off', 'refund-issued'];
    if (rmaFilter === 'all') {
      filtered = all;
    } else if (rmaFilter === 'active') {
      filtered = all.filter(function(r) { return ACTIVE_STATUSES.indexOf(r.status) >= 0; });
    } else if (rmaFilter === 'completed') {
      filtered = all.filter(function(r) { return COMPLETED_STATUSES.indexOf(r.status) >= 0; });
    } else if (rmaFilter === 'received') {
      filtered = all.filter(function(r) { return r.status === 'received' || r.status === 'inspected'; });
    } else {
      filtered = all.filter(function(r) { return r.status === rmaFilter; });
    }

    if (countEl) countEl.textContent = filtered.length + ' return' + (filtered.length !== 1 ? 's' : '');

    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      if (tableEl) tableEl.style.display = 'none';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    var rowsHtml = '';
    filtered.forEach(function(r) {
      var key = r._key;
      var status = r.status || 'requested';
      var itemCount = (r.items || []).reduce(function(sum, item) { return sum + (item.qty || 1); }, 0);
      rowsHtml += '<tr onclick="viewRma(\'' + esc(key) + '\')" style="cursor:pointer;">' +
        '<td style="font-weight:500;">' + esc((key || '').substring(0, 8)) + '</td>' +
        '<td>' + esc(r.orderNumber || (r.orderId || '').substring(0, 8)) + '</td>' +
        '<td>' + esc(r.customerEmail || '') + '</td>' +
        '<td>' + itemCount + ' item' + (itemCount !== 1 ? 's' : '') + '</td>' +
        '<td>$' + ((r.refundAmountCents || 0) / 100).toFixed(2) + '</td>' +
        '<td><span class="status-badge" style="' + rmaBadgeStyle(status) + '">' + esc(status.replace(/-/g, ' ')) + '</span></td>' +
        '<td>' + formatOrderDate(r.requestedAt) + '</td>' +
      '</tr>';
    });
    if (tbodyEl) tbodyEl.innerHTML = rowsHtml;
  }

  // W1.5: operator-initiated RMA entry. Refund-intent only — no payment-provider API call.
  function openNewRmaModal(originOrderId) {
    var existing = document.getElementById('newRmaModal');
    if (existing) existing.remove();
    var modal = document.createElement('div');
    modal.id = 'newRmaModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

    var preselected = originOrderId ? orders[originOrderId] : null;
    var orderOptionsHtml = '<option value="">— Select order —</option>';
    var orderArr = Object.keys(orders || {}).map(function(k) {
      var o = orders[k]; o._id = k; return o;
    }).sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); }).slice(0, 200);
    orderArr.forEach(function(o) {
      var num = getOrderDisplayNumber(o);
      var who = o.customerName || o.email || '';
      var sel = (originOrderId && o._id === originOrderId) ? ' selected' : '';
      orderOptionsHtml += '<option value="' + esc(o._id) + '"' + sel + '>' + esc(num) + ' — ' + esc(who) + '</option>';
    });

    var pickerDisabled = preselected ? ' disabled' : '';
    var pickerNote = preselected
      ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Locked — launched from order detail.</div>'
      : '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Optional — leave empty to record a return without a source order.</div>';

    modal.innerHTML = '<div style="background:var(--cream,#f5f0e8);border-radius:12px;padding:24px;max-width:520px;width:90%;max-height:85vh;overflow-y:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="margin:0;font-size:1.15rem;">New Return</h3>' +
        '<span onclick="closeNewRmaModal()" style="cursor:pointer;font-size:1.15rem;color:var(--warm-gray);">&times;</span>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Source Order' + (preselected ? ' *' : '') + '</label>' +
        '<select id="newRmaOrderId"' + pickerDisabled + ' style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
          orderOptionsHtml +
        '</select>' +
        pickerNote +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Type</label>' +
        '<select id="newRmaType" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
          '<option value="refund" selected>Refund</option>' +
          '<option value="exchange">Exchange</option>' +
        '</select>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Customer Email</label>' +
        '<input type="email" id="newRmaEmail" value="' + esc((preselected && (preselected.email || preselected.customerEmail)) || '') + '" placeholder="customer@example.com" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Reason</label>' +
        '<textarea id="newRmaReason" rows="3" placeholder="Customer reported breakage on arrival..." style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;resize:vertical;background:var(--cream,#f5f0e8);box-sizing:border-box;"></textarea>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Refund Amount ($)</label>' +
        '<input type="number" min="0" step="0.01" id="newRmaAmount" placeholder="0.00" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Refund intent only — no payment provider call from this form.</div>' +
      '</div>' +

      '<div style="margin-bottom:14px;display:flex;align-items:center;gap:8px;">' +
        '<input type="checkbox" id="newRmaRestock" style="margin:0;">' +
        '<label for="newRmaRestock" style="font-size:0.85rem;cursor:pointer;">Restock inventory on completion</label>' +
      '</div>' +

      '<div id="newRmaError" style="color:var(--danger);font-size:0.85rem;margin-bottom:8px;display:none;"></div>' +

      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="closeNewRmaModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="newRmaSaveBtn" onclick="saveNewRma()">Create Return</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(modal);
    // Stash locked originOrderId so save can read it (disabled select returns '').
    modal.dataset.lockedOrderId = preselected ? (originOrderId || '') : '';
  }

  function closeNewRmaModal() {
    var modal = document.getElementById('newRmaModal');
    if (modal) modal.remove();
  }

  async function saveNewRma() {
    var modal = document.getElementById('newRmaModal');
    var lockedOrderId = modal && modal.dataset ? (modal.dataset.lockedOrderId || '') : '';
    var orderId = lockedOrderId || (document.getElementById('newRmaOrderId') || {}).value || '';
    var type = (document.getElementById('newRmaType') || {}).value || 'refund';
    var email = ((document.getElementById('newRmaEmail') || {}).value || '').trim();
    var reason = ((document.getElementById('newRmaReason') || {}).value || '').trim();
    var amountRaw = (document.getElementById('newRmaAmount') || {}).value || '';
    var refundCents = amountRaw ? Math.round(parseFloat(amountRaw) * 100) : 0;
    var restock = !!(document.getElementById('newRmaRestock') || {}).checked;

    var errEl = document.getElementById('newRmaError');
    function showErr(m) { if (errEl) { errEl.textContent = m; errEl.style.display = 'block'; } }

    if (lockedOrderId && !orderId) { showErr('Missing source order.'); return; }

    var btn = document.getElementById('newRmaSaveBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Creating...'; }

    try {
      var rmaId = 'rma_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      var srcOrder = orderId ? orders[orderId] : null;
      var orderNumber = srcOrder ? getOrderDisplayNumber(srcOrder) : '';
      var nowIso = new Date().toISOString();
      var rec = {
        type: type,
        originOrderId: orderId || null,
        orderId: orderId || null,
        orderNumber: orderNumber,
        customerEmail: email || (srcOrder && (srcOrder.email || srcOrder.customerEmail)) || '',
        reason: reason,
        refundAmountCents: refundCents,
        restockInventory: restock,
        status: 'requested',
        items: [],
        requestedAt: nowIso,
        createdAt: nowIso,
        createdBy: 'operator',
        source: 'operator-initiated'
      };
      await MastDB.set('admin/rma/' + rmaId, rec);
      rmaData[rmaId] = rec;
      closeNewRmaModal();
      showToast('Return created');
      renderRma();
    } catch (err) {
      console.error('[RMA] create error:', err);
      showErr('Error: ' + (err && err.message || 'unknown'));
      if (btn) { btn.disabled = false; btn.textContent = 'Create Return'; }
    }
  }

  function viewRma(rmaId) {
    selectedRmaId = rmaId;
    document.getElementById('rmaListView').style.display = 'none';
    var detailEl = document.getElementById('rmaDetailView');
    detailEl.style.display = 'block';
    // Hide other tabs that may be visible (e.g., packTab when navigating from order detail)
    var packTab = document.getElementById('packTab');
    if (packTab) packTab.style.display = 'none';
    var shipTab = document.getElementById('shipTab');
    if (shipTab) shipTab.style.display = 'none';
    renderRmaDetail(rmaId);
  }

  function backToRmaList() {
    selectedRmaId = null;
    document.getElementById('rmaListView').style.display = 'block';
    document.getElementById('rmaDetailView').style.display = 'none';
    document.getElementById('rmaDetailView').innerHTML = '';
  }

  function renderRmaDetail(rmaId) {
    var r = rmaData[rmaId];
    if (!r) {
      document.getElementById('rmaDetailView').innerHTML = '<p>RMA not found.</p>';
      return;
    }
    var detailEl = document.getElementById('rmaDetailView');
    var status = r.status || 'requested';

    // Action buttons (simple transitions only — inspection/disposition have their own panels)
    var actionsHtml = '';
    var simpleActions = { 'requested': ['approved', 'declined'], 'approved': ['shipped-back'], 'shipped-back': ['received'] };
    var simpleNext = simpleActions[status] || [];
    simpleNext.forEach(function(ns) {
      // Approving an RMA is a sensitive function gated by rma.approve.
      if (ns === 'approved' && !hasPermission('rma', 'approve')) return;
      var label = { 'approved': 'Approve', 'declined': 'Decline', 'shipped-back': 'Mark Shipped Back', 'received': 'Mark Received' }[ns] || ns.replace(/-/g, ' ');
      var btnClass = ns === 'declined' ? 'btn btn-danger' : 'btn btn-primary';
      actionsHtml += '<button class="' + btnClass + '" style="font-size:0.78rem;padding:6px 14px;" onclick="transitionRma(\'' + esc(rmaId) + '\', \'' + esc(ns) + '\')">' + label + '</button>';
    });

    // Items
    var itemsHtml = '';
    (r.items || []).forEach(function(item) {
      itemsHtml += '<div class="order-item-row">' +
        '<div class="order-item-name">' + esc(item.name) + ' x' + (item.qty || 1) + '</div>' +
        '<div class="order-item-price">$' + ((item.priceCents || 0) * (item.qty || 1) / 100).toFixed(2) + '</div>' +
      '</div>';
    });

    // Status timeline
    var isTerminal = ['restocked', 'seconds', 'repair-queued', 'written-off', 'refund-issued', 'declined'].indexOf(status) >= 0;
    var RMA_STEPS = [
      { key: 'requested', label: 'Requested', field: 'requestedAt' },
      { key: 'approved', label: 'Approved', field: 'approvedAt' },
      { key: 'shipped-back', label: 'Shipped Back', field: 'shippedBackAt' },
      { key: 'received', label: 'Received', field: 'receivedAt' },
      { key: 'inspected', label: 'Inspected', field: 'inspectedAt' }
    ];
    // Add terminal step based on what actually happened
    if (isTerminal && status !== 'declined') {
      var terminalLabels = { restocked: 'Restocked', seconds: 'Seconds', 'repair-queued': 'Repair Queued', 'written-off': 'Written Off', 'refund-issued': 'Refund Issued' };
      RMA_STEPS.push({ key: status, label: terminalLabels[status] || status, field: 'refundIssuedAt' });
    }

    var timelineHtml = '';
    var reachedCurrent = false;
    RMA_STEPS.forEach(function(step) {
      var ts = r[step.field];
      var isCurrent = status === step.key;
      var cls = '';
      if (isCurrent) { cls = 'current'; reachedCurrent = true; }
      else if (ts && !reachedCurrent) { cls = 'completed'; }

      timelineHtml += '<div class="rma-step ' + cls + '">' +
        '<div class="rma-step-dot"></div>' +
        '<div class="rma-step-label">' + esc(step.label) + '</div>' +
        (ts ? '<div class="rma-step-date">' + formatOrderDateTime(ts) + '</div>' : '') +
      '</div>';
    });
    if (status === 'declined') {
      timelineHtml += '<div class="rma-step current" style="color:#EF5350;">' +
        '<div class="rma-step-dot" style="background:#EF5350;border-color:#EF5350;"></div>' +
        '<div class="rma-step-label" style="color:#EF5350;">Declined</div>' +
      '</div>';
    }

    // Refund allocation section
    var itemsTotalCents = (r.items || []).reduce(function(s, i) { return s + (i.priceCents || 0) * (i.qty || 1); }, 0);
    var taxOnReturnCents = r.taxOnReturnedCents || 0;
    var refundHtml = '<div class="order-detail-section">' +
      '<div class="order-detail-section-title">Refund</div>' +
      '<div class="order-summary-row"><span>Items Total</span><span>$' + (itemsTotalCents / 100).toFixed(2) + '</span></div>' +
      (taxOnReturnCents > 0 ? '<div class="order-summary-row"><span>Tax</span><span>$' + (taxOnReturnCents / 100).toFixed(2) + '</span></div>' : '') +
      '<div class="order-summary-row total" style="color:var(--text,#e0e0e0);"><span>Refund Amount</span><span>$' + ((r.refundAmountCents || 0) / 100).toFixed(2) + '</span></div>' +
      '<div style="margin-top:0.5rem;font-size:0.85rem;color:var(--warm-gray-light);">Method: ' + esc((r.refundMethod || 'original_payment').replace(/_/g, ' ')) + '</div>';

    // Admin override for refund method (hide on terminal statuses)
    var terminalStatuses = ['refund-issued', 'declined', 'restocked', 'seconds', 'repair-queued', 'written-off'];
    if (terminalStatuses.indexOf(status) === -1) {
      refundHtml += '<div style="margin-top:0.75rem;">' +
        '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);">Override Refund Method</label>' +
        '<div style="display:flex;gap:8px;margin-top:4px;">' +
          '<select id="rmaRefundMethodOverride" style="padding:4px 8px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);">' +
            '<option value="original_payment"' + (r.refundMethod === 'original_payment' ? ' selected' : '') + '>Original Payment</option>' +
            '<option value="store_credit"' + (r.refundMethod === 'store_credit' ? ' selected' : '') + '>Store Credit</option>' +
          '</select>' +
          '<input type="number" id="rmaRefundAmountOverride" value="' + ((r.refundAmountCents || 0) / 100).toFixed(2) + '" step="0.01" min="0" style="width:100px;padding:4px 8px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);">' +
          '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="overrideRmaRefund(\'' + esc(rmaId) + '\')">Update</button>' +
        '</div>' +
      '</div>';
    }
    refundHtml += '</div>';

    // Link to order
    var orderLinkHtml = '';
    if (r.orderId) {
      orderLinkHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Linked Order</div>' +
        '<a href="#" onclick="backToRmaList();viewOrder(\'' + esc(r.orderId) + '\');return false;" style="color:var(--teal);font-size:0.9rem;">' +
        'View Order ' + esc(r.orderNumber || r.orderId) + ' &rarr;</a>' +
      '</div>';

      // Load original order payment details into a placeholder
      orderLinkHtml += '<div id="rmaOrderPaymentSummary"></div>';
      MastDB.orders.get(r.orderId).then(function(order) {
        if (!order) return;
        var el = document.getElementById('rmaOrderPaymentSummary');
        if (!el) return;
        var fp = function(v) { return '$' + (v || 0).toFixed(2); };
        var html = '<div class="order-detail-section" style="background:rgba(0,0,0,0.15);border-radius:8px;padding:1rem;">' +
          '<div class="order-detail-section-title">Original Order Payment</div>' +
          '<div style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem;">';
        var rmaSubtotal = order.subtotal || 0;
        if (order.membershipDiscount && order.membershipDiscount.discountCents) rmaSubtotal += order.membershipDiscount.discountCents / 100;
        html += '<div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>' + fp(rmaSubtotal) + '</span></div>';
        if (order.membershipDiscount && order.membershipDiscount.discountCents) {
          html += '<div style="display:flex;justify-content:space-between;color:var(--amber-light);"><span>' + esc(order.membershipDiscount.programName || 'Member Discount') + '</span><span>-' + fp(order.membershipDiscount.discountCents / 100) + '</span></div>';
        }
        if (order.coupon && order.coupon.discount) {
          html += '<div style="display:flex;justify-content:space-between;color:var(--teal);"><span>Coupon (' + esc(order.coupon.code) + ')</span><span>-' + fp(order.coupon.discount) + '</span></div>';
        }
        html += '<div style="display:flex;justify-content:space-between;"><span>Tax</span><span>' + fp(order.tax) + '</span></div>';
        var rmaShipLabel = (order.shippingMethod && order.shippingMethod.label) || 'Shipping';
        html += '<div style="display:flex;justify-content:space-between;"><span>' + esc(rmaShipLabel) + '</span><span>' + (order.shippingCost > 0 ? fp(order.shippingCost) : 'Free') + '</span></div>';
        var wd = order.walletDeductions || {};
        if (wd.totalDeductionCents > 0) {
          if (wd.loyalty && wd.loyalty.amountCents > 0) {
            html += '<div style="display:flex;justify-content:space-between;color:var(--amber-light);"><span>Loyalty (' + (wd.loyalty.pointsUsed || 0) + ' ' + esc(wd.loyalty.pointName || 'pts') + ')</span><span>-' + fp(wd.loyalty.amountCents / 100) + '</span></div>';
          }
          if (wd.giftCards && wd.giftCards.length > 0) {
            var gcAmt = wd.giftCards.reduce(function(s, g) { return s + (g.amountCents || 0); }, 0);
            if (gcAmt > 0) html += '<div style="display:flex;justify-content:space-between;color:var(--amber-light);"><span>Gift Card</span><span>-' + fp(gcAmt / 100) + '</span></div>';
          }
          if (wd.credits && wd.credits.length > 0) {
            var crAmt = wd.credits.reduce(function(s, c) { return s + (c.amountCents || 0); }, 0);
            if (crAmt > 0) html += '<div style="display:flex;justify-content:space-between;color:var(--amber-light);"><span>Store Credit</span><span>-' + fp(crAmt / 100) + '</span></div>';
          }
        }
        html += '<div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--cream-dark);padding-top:6px;margin-top:4px;"><span>Total Charged</span><span>' + fp(orderTotalDollars(order)) + '</span></div>';
        html += '</div></div>';
        el.innerHTML = html;
        // Also populate the disposition panel summary if visible
        var disposEl = document.getElementById('rmaDispositionPaymentSummary');
        if (disposEl) disposEl.innerHTML = html;
      });
    }

    var csTicketHtml = r.ticketId ? '<div class="order-detail-section">' +
      '<div class="order-detail-section-title">CS Ticket</div>' +
      '<a href="#" onclick="event.preventDefault();viewRmaTicket(\'' + esc(r.ticketId) + '\')" style="color:var(--teal);font-size:0.9rem;">' + esc(r.ticketNumber || r.ticketId) + ' &rarr;</a>' +
    '</div>' : '';

    detailEl.innerHTML = '<button class="detail-back" onclick="backToRmaList()">&#8592; Back to Returns</button>' +
      '<div class="order-detail-header">' +
        '<div>' +
          '<div class="order-detail-title">RMA ' + esc((rmaId || '').substring(0, 8)) + '</div>' +
          '<div class="order-detail-meta">' +
            '<span class="status-badge pill" style="' + rmaBadgeStyle(status) + '">' + esc(status.replace(/-/g, ' ')) + '</span>' +
            ' &middot; Order ' + esc(r.orderNumber || '') +
            ' &middot; ' + esc(r.customerEmail || '') +
            ' &middot; ' + formatOrderDateTime(r.requestedAt) +
          '</div>' +
        '</div>' +
        '<div class="order-actions">' + actionsHtml + '</div>' +
      '</div>' +
      '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Status</div>' +
        '<div class="rma-status-timeline">' + timelineHtml + '</div>' +
      '</div>' +
      '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Return Reason</div>' +
        renderRmaReasonBlock(rmaId, r) +
      '</div>' +
      '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Items Being Returned</div>' +
        itemsHtml +
      '</div>' +
      (r.returnTrackingNumber ? '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Return Tracking</div>' +
        '<div style="font-family:monospace;font-size:0.9rem;">' + esc(r.returnTrackingNumber) + '</div>' +
      '</div>' : '') +
      // Inspection panel (when status is 'received')
      (status === 'received' ? '<div class="order-detail-section" style="border:1px solid var(--teal);border-radius:8px;padding:1rem;">' +
        '<div class="order-detail-section-title" style="color:var(--teal);">Inspection</div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">Result</label>' +
          '<select id="rmaInspectResult" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);">' +
            '<option value="pass">Pass</option>' +
            '<option value="fail">Fail</option>' +
          '</select>' +
        '</div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="rmaInspectNotes" placeholder="Inspection notes..." style="width:100%;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);min-height:60px;"></textarea>' +
        '</div>' +
        '<button class="btn btn-primary" style="font-size:0.78rem;padding:6px 14px;" onclick="submitInspection(\'' + esc(rmaId) + '\')">Complete Inspection</button>' +
      '</div>' : '') +
      // Inspection result display (when already inspected)
      (r.inspection ? '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Inspection Result</div>' +
        '<div><span class="status-badge" style="' + (r.inspection.result === 'pass' ? 'background:rgba(46,125,50,0.25);color:#66BB6A;border:1px solid rgba(46,125,50,0.4);' : 'background:rgba(198,40,40,0.2);color:#EF5350;border:1px solid rgba(198,40,40,0.35);') + '">' + esc(r.inspection.result) + '</span></div>' +
        (r.inspection.notes ? '<div style="margin-top:0.5rem;font-size:0.85rem;color:var(--warm-gray);">' + esc(r.inspection.notes) + '</div>' : '') +
      '</div>' : '') +
      // Disposition panel (when status is 'inspected')
      (status === 'inspected' ? '<div class="order-detail-section" style="border:1px solid var(--teal);border-radius:8px;padding:1rem;">' +
        '<div class="order-detail-section-title" style="color:var(--teal);">Disposition &amp; Refund</div>' +
        '<div id="rmaDispositionPaymentSummary" style="margin-bottom:0.75rem;"></div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">What happens to the item?</label>' +
          '<select id="rmaDisposition" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);width:100%;">' +
            '<option value="restock">Restock — Return to full inventory</option>' +
            '<option value="seconds">Seconds — Move to clearance</option>' +
            '<option value="repair">Repair — Queue for repair</option>' +
            '<option value="write-off">Write Off — Record as loss</option>' +
          '</select>' +
        '</div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">Refund Method</label>' +
          '<select id="rmaDisposRefundMethod" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);">' +
            '<option value="store-credit"' + (r.refundMethod === 'store_credit' ? ' selected' : '') + '>Store Credit</option>' +
            '<option value="credit-card"' + (r.refundMethod === 'original_payment' ? ' selected' : '') + '>Original Payment</option>' +
          '</select>' +
          '<input type="number" id="rmaDisposRefundAmount" value="' + ((r.refundAmountCents || 0) / 100).toFixed(2) + '" step="0.01" min="0" style="margin-left:8px;width:100px;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);">' +
        '</div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="rmaDisposNotes" placeholder="Disposition notes..." style="width:100%;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);min-height:40px;"></textarea>' +
        '</div>' +
        '<button class="btn btn-primary" style="font-size:0.78rem;padding:6px 14px;" onclick="completeRma(\'' + esc(rmaId) + '\')">Complete RMA &amp; Issue Refund</button>' +
      '</div>' : '') +
      // Disposition result display (when terminal)
      (r.disposition ? '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Disposition</div>' +
        '<div style="font-size:0.9rem;"><strong>' + esc({ restock: 'Restocked', seconds: 'Seconds/Clearance', repair: 'Repair Queued', 'write-off': 'Written Off' }[r.disposition.action] || r.disposition.action) + '</strong></div>' +
        (r.disposition.notes ? '<div style="margin-top:0.5rem;font-size:0.85rem;color:var(--warm-gray);">' + esc(r.disposition.notes) + '</div>' : '') +
      '</div>' : '') +
      refundHtml +
      orderLinkHtml +
      csTicketHtml;
  }

  async function transitionRma(rmaId, actionOrStatus) {
    var r = rmaData[rmaId];
    if (!r) return;

    // Map old status-based transitions to cloud function actions
    var actionMap = {
      'approved': 'approve',
      'declined': 'decline',
      'shipped-back': 'mark-shipped-back',
      'received': 'mark-received'
    };
    var action = actionMap[actionOrStatus] || actionOrStatus;

    if (action === 'approve' && !hasPermission('rma', 'approve')) {
      showToast('You do not have permission to approve returns.', true);
      return;
    }

    try {
      showToast('Processing...');
      var result = await firebase.functions().httpsCallable('transitionRma')({
        tenantId: MastDB.tenantId(),
        rmaId: rmaId,
        action: action
      });
      if (result.data && result.data.success) {
        // Refresh RMA data from server
        var snap = await MastDB.get('admin/rma/' + rmaId);
        rmaData[rmaId] = snap.val() || rmaData[rmaId];
        renderRmaDetail(rmaId);
        updateRmaSidebarBadge();
        showToast('RMA ' + (result.data.newStatus || action).replace(/-/g, ' '));
        var RMA_TICKET_MESSAGES = {
          'approved': 'Your return request has been approved. Please ship items back within 7 days.',
          'declined': "After review, we're unable to approve this return request. Please contact us if you have questions.",
          'received': "We've received your returned items and are inspecting them now."
        };
        var ticketMsg = RMA_TICKET_MESSAGES[actionOrStatus];
        var rmaTicketId = rmaData[rmaId] && rmaData[rmaId].ticketId;
        if (rmaTicketId && ticketMsg) {
          try {
            var tNow = new Date().toISOString();
            var tMsgId = 'msg_' + Date.now().toString(36);
            await MastDB.set('cs_tickets/' + rmaTicketId + '/messages/' + tMsgId, {
              id: tMsgId,
              body: ticketMsg,
              direction: 'outbound',
              isInternal: false,
              authorName: 'System',
              authorEmail: null,
              createdAt: tNow
            });
            await MastDB.update('cs_tickets/' + rmaTicketId, { updatedAt: tNow });
          } catch (e) {}
        }
      } else {
        showToast('Failed: ' + ((result.data || {}).error || 'Unknown error'), true);
      }
    } catch (err) {
      showToast('Failed to update RMA: ' + (err.message || err), true);
    }
  }

  async function submitInspection(rmaId) {
    var resultEl = document.getElementById('rmaInspectResult');
    var notesEl = document.getElementById('rmaInspectNotes');
    var result = resultEl ? resultEl.value : 'pass';
    var notes = notesEl ? notesEl.value.trim() : '';

    try {
      showToast('Submitting inspection...');
      var resp = await firebase.functions().httpsCallable('transitionRma')({
        tenantId: MastDB.tenantId(),
        rmaId: rmaId,
        action: 'inspect',
        payload: { result: result, notes: notes }
      });
      if (resp.data && resp.data.success) {
        var snap = await MastDB.get('admin/rma/' + rmaId);
        rmaData[rmaId] = snap.val() || rmaData[rmaId];
        renderRmaDetail(rmaId);
        showToast('Inspection recorded');
      }
    } catch (err) {
      showToast('Inspection failed: ' + (err.message || err), true);
    }
  }

  async function completeRma(rmaId) {
    var disposEl = document.getElementById('rmaDisposition');
    var methodEl = document.getElementById('rmaDisposRefundMethod');
    var amountEl = document.getElementById('rmaDisposRefundAmount');
    var notesEl = document.getElementById('rmaDisposNotes');

    var disposition = disposEl ? disposEl.value : 'write-off';
    var refundMethod = methodEl ? methodEl.value : 'store-credit';
    var amountCents = amountEl ? Math.round(parseFloat(amountEl.value) * 100) : 0;
    var notes = notesEl ? notesEl.value.trim() : '';

    if (isNaN(amountCents) || amountCents < 0) {
      showToast('Invalid refund amount', true);
      return;
    }

    try {
      showToast('Completing RMA...');
      var resp = await firebase.functions().httpsCallable('transitionRma')({
        tenantId: MastDB.tenantId(),
        rmaId: rmaId,
        action: 'complete',
        payload: {
          disposition: disposition,
          notes: notes,
          refundAllocation: [{ method: refundMethod, amountCents: amountCents }]
        }
      });
      if (resp.data && resp.data.success) {
        var snap = await MastDB.get('admin/rma/' + rmaId);
        rmaData[rmaId] = snap.val() || rmaData[rmaId];
        renderRmaDetail(rmaId);
        updateRmaSidebarBadge();
        showToast('RMA completed — refund issued');
        var rmaTicketId = rmaData[rmaId] && rmaData[rmaId].ticketId;
        if (rmaTicketId) {
          try {
            var tNow = new Date().toISOString();
            var tMsgId = 'msg_' + Date.now().toString(36);
            await MastDB.set('cs_tickets/' + rmaTicketId + '/messages/' + tMsgId, {
              id: tMsgId,
              body: 'Your return is complete. Your refund has been processed.',
              direction: 'outbound',
              isInternal: false,
              authorName: 'System',
              authorEmail: null,
              createdAt: tNow
            });
            await MastDB.update('cs_tickets/' + rmaTicketId, { updatedAt: tNow });
          } catch (e) {}
        }
      }
    } catch (err) {
      showToast('Complete failed: ' + (err.message || err), true);
    }
  }

  // ── Devon B: Return Reason Code (Paradigm A read → edit → save/cancel) ──
  var _rmaReasonEditing = {}; // rmaId -> bool
  var _cachedAllowedReturnReasons = null; // populated lazily

  var DEFAULT_RETURN_REASONS = ['defective', 'wrong-item', 'not-as-described', 'changed-mind', 'damaged-in-transit', 'arrived-late', 'other'];

  function _humanizeReason(code) {
    if (!code) return '';
    var s = String(code).replace(/[-_]+/g, ' ').trim();
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function _allowedReasonCodes() {
    if (_cachedAllowedReturnReasons && _cachedAllowedReturnReasons.length) {
      return _cachedAllowedReturnReasons.slice();
    }
    return DEFAULT_RETURN_REASONS.slice();
  }

  function _ensureAllowedReasonsLoaded() {
    if (_cachedAllowedReturnReasons !== null) return Promise.resolve();
    return MastDB.termsConfig.get().then(function(snap) {
      var tc = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      if (tc && Array.isArray(tc.allowedReturnReasons) && tc.allowedReturnReasons.length) {
        _cachedAllowedReturnReasons = tc.allowedReturnReasons.slice();
      } else {
        _cachedAllowedReturnReasons = [];
      }
    }).catch(function() { _cachedAllowedReturnReasons = []; });
  }

  function renderRmaReasonBlock(rmaId, r) {
    var code = r.returnReasonCode || '';
    var detail = r.returnReasonDetail || '';
    // Back-compat: legacy RMAs stored the dropdown choice concatenated into returnReason as "code - detail".
    if (!code && r.returnReason) {
      var raw = String(r.returnReason);
      var sepIdx = raw.indexOf(' - ');
      if (sepIdx > 0) {
        code = raw.slice(0, sepIdx);
        if (!detail) detail = raw.slice(sepIdx + 3);
      } else {
        code = raw;
      }
    }
    if (_rmaReasonEditing[rmaId]) {
      var codes = _allowedReasonCodes();
      // Make sure the current code (if any) appears even if it's not in the active enum.
      if (code && codes.indexOf(code) === -1) codes.unshift(code);
      var opts = '<option value="">Select a reason…</option>' + codes.map(function(c) {
        return '<option value="' + esc(c) + '"' + (c === code ? ' selected' : '') + '>' + esc(_humanizeReason(c)) + '</option>';
      }).join('');
      return '<div style="display:flex;flex-direction:column;gap:8px;">' +
        '<select id="rmaReasonCodeEdit_' + esc(rmaId) + '" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);max-width:280px;">' + opts + '</select>' +
        '<textarea id="rmaReasonDetailEdit_' + esc(rmaId) + '" placeholder="Additional detail (optional)" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);min-height:60px;">' + esc(detail) + '</textarea>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-primary" style="font-size:0.78rem;padding:6px 14px;" onclick="saveRmaReason(\'' + esc(rmaId) + '\')">Save</button>' +
          '<button class="btn btn-outline" style="font-size:0.78rem;padding:6px 14px;" onclick="cancelRmaReasonEdit(\'' + esc(rmaId) + '\')">Cancel</button>' +
        '</div>' +
      '</div>';
    }
    var chip = code
      ? '<span class="status-badge pill" style="background:rgba(0,121,107,0.15);color:var(--teal);border:1px solid rgba(0,121,107,0.35);font-size:0.78rem;">' + esc(_humanizeReason(code)) + '</span>'
      : '<span style="color:var(--warm-gray-light);font-size:0.85rem;">No reason code</span>';
    var detailHtml = detail
      ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:6px;">' + esc(detail) + '</div>'
      : (!code && r.returnReason ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:6px;">' + esc(r.returnReason) + '</div>' : '');
    return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        chip +
        '<button class="btn btn-outline" style="font-size:0.72rem;padding:3px 10px;" onclick="editRmaReason(\'' + esc(rmaId) + '\')">Edit</button>' +
      '</div>' + detailHtml;
  }

  window.editRmaReason = function(rmaId) {
    _ensureAllowedReasonsLoaded().then(function() {
      _rmaReasonEditing[rmaId] = true;
      renderRmaDetail(rmaId);
    });
  };

  window.cancelRmaReasonEdit = function(rmaId) {
    _rmaReasonEditing[rmaId] = false;
    renderRmaDetail(rmaId);
  };

  window.saveRmaReason = async function(rmaId) {
    var codeEl = document.getElementById('rmaReasonCodeEdit_' + rmaId);
    var detailEl = document.getElementById('rmaReasonDetailEdit_' + rmaId);
    if (!codeEl) return;
    var newCode = codeEl.value || '';
    var newDetail = detailEl ? detailEl.value.trim() : '';
    if (!newCode) {
      showToast('Please select a reason code.', true);
      return;
    }
    var combined = newDetail ? (newCode + ' - ' + newDetail) : newCode;
    try {
      await MastDB.update('admin/rma/' + rmaId, {
        returnReasonCode: newCode,
        returnReasonDetail: newDetail,
        returnReason: combined,
        updatedAt: new Date().toISOString()
      });
      if (typeof writeAudit === 'function') {
        try { writeAudit('update', 'rma', rmaId, { field: 'returnReasonCode', value: newCode }); } catch (_e) {}
      }
      if (rmaData[rmaId]) {
        rmaData[rmaId].returnReasonCode = newCode;
        rmaData[rmaId].returnReasonDetail = newDetail;
        rmaData[rmaId].returnReason = combined;
      }
      _rmaReasonEditing[rmaId] = false;
      renderRmaDetail(rmaId);
      showToast('Return reason updated');
    } catch (err) {
      showToast('Failed to update reason: ' + (err && err.message || err), true);
    }
  };

  async function overrideRmaRefund(rmaId) {
    var methodEl = document.getElementById('rmaRefundMethodOverride');
    var amountEl = document.getElementById('rmaRefundAmountOverride');
    if (!methodEl || !amountEl) return;

    var method = methodEl.value;
    var amountCents = Math.round(parseFloat(amountEl.value) * 100);
    if (isNaN(amountCents) || amountCents < 0) {
      showToast('Invalid refund amount', 'error');
      return;
    }

    try {
      await MastDB.update('admin/rma/' + rmaId, {
        refundMethod: method,
        refundAmountCents: amountCents,
        updatedAt: new Date().toISOString()
      });
      rmaData[rmaId].refundMethod = method;
      rmaData[rmaId].refundAmountCents = amountCents;
      renderRmaDetail(rmaId);
      showToast('Refund updated');
    } catch (err) {
      showToast('Failed to update refund: ' + err.message, 'error');
    }
  }


  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  // orderStatusBadgeStyle, etsySourceBadgeStyle, getOrderDisplayNumber,
  // formatOrderDate, formatOrderDateTime, getOrderItemsLabel, renderOrderProgress
  // are now exported by shared/orders-core.js (eager).
  // loadOrders + transitionOrder + the invoice surface (isOrderInvoiceable /
  // getEffectiveInvoiceStatus / invoiceStatusBadgeStyle / generateInvoice /
  // sendInvoice / markOrderInvoicePaid / resendInvoice / buildInvoiceSection) +
  // orderTotalDollars are now exported by shared/orders-core.js (eager) — PR1c.
  window.viewRmaTicket = viewRmaTicket;

  window.renderDashCardNewOrders = renderDashCardNewOrders;
  window.renderDashCardReadyToShip = renderDashCardReadyToShip;
  window.loadRmaData = loadRmaData;
  window.setRmaFilter = setRmaFilter;
  window.renderRma = renderRma;
  window.openNewRmaModal = openNewRmaModal;
  window.closeNewRmaModal = closeNewRmaModal;
  window.saveNewRma = saveNewRma;
  window.viewRma = viewRma;
  window.backToRmaList = backToRmaList;
  window.renderRmaDetail = renderRmaDetail;
  window.transitionRma = transitionRma;
  window.submitInspection = submitInspection;
  window.completeRma = completeRma;
  window.overrideRmaRefund = overrideRmaRefund;
  window.rmaBadgeStyle = rmaBadgeStyle;


  // ============================================================
  // RMA Ask AI registration
  // ============================================================

  function paintRmaAskAiSlot() {
    var slot = document.getElementById('rmaAskAiSlot');
    if (!slot) return;
    if (window.MastAskAi && window.MastAskAi.isEnabled()) {
      slot.innerHTML = '<button class="btn" style="font-size:0.85rem;padding:6px 12px;" onclick="MastAskAi.open(\'rma\')" title="Ask Claude about your returns">✨ Ask AI</button>';
    } else {
      slot.innerHTML = '';
    }
  }

  window.addEventListener('mastaskai:ready', paintRmaAskAiSlot);
  window.addEventListener('mastaskai:configchanged', paintRmaAskAiSlot);
  paintRmaAskAiSlot();

  if (window.MastAskAi) {
    window.MastAskAi.register('rma', {
      title: 'Ask AI about your returns',
      placeholder: 'e.g. What is my return rate this period? Which products get returned most? What reasons come up most?',
      notes: [
        'RMA statuses: requested, approved, declined, shipped-back, received, inspected, restocked, seconds, repair-queued, written-off, refund-issued.',
        'Active = requested|approved|shipped-back|received|inspected. Completed = restocked|seconds|repair-queued|written-off|refund-issued.',
        'Reasons are user-submitted strings (e.g. "damaged in shipping", "wrong size", "changed mind") — group similar wordings yourself when answering.',
        'requestedAt and createdAt are ISO timestamps; use the more recent of the two when computing age.',
        'topProducts buckets by item.productName across all RMAs in the current view; topReasons groups by the reason field.',
        'refundsTotalUSD reflects refund-issued items only; outstandingTotalUSD is items in active statuses where a refund may still be issued.'
      ],
      buildContext: function() {
        var all = getRmaArray();
        var ACTIVE = ['requested', 'approved', 'shipped-back', 'received', 'inspected'];
        var COMPLETED = ['restocked', 'seconds', 'repair-queued', 'written-off', 'refund-issued'];
        var filtered;
        if (rmaFilter === 'all') filtered = all;
        else if (rmaFilter === 'active') filtered = all.filter(function(r) { return ACTIVE.indexOf(r.status) >= 0; });
        else if (rmaFilter === 'completed') filtered = all.filter(function(r) { return COMPLETED.indexOf(r.status) >= 0; });
        else filtered = all.filter(function(r) { return (r.status || 'requested') === rmaFilter; });

        var byStatus = {}, byReason = {}, byProduct = {}, byMonth = {};
        var refundsTotalCents = 0, outstandingTotalCents = 0;
        filtered.forEach(function(r) {
          var status = r.status || 'requested';
          if (!byStatus[status]) byStatus[status] = { count: 0 };
          byStatus[status].count++;

          var reason = (r.reason || '(unspecified)').trim();
          if (!byReason[reason]) byReason[reason] = { count: 0 };
          byReason[reason].count++;

          (r.items || []).forEach(function(it) {
            var pname = it.productName || '(unknown)';
            if (!byProduct[pname]) byProduct[pname] = { count: 0, qty: 0 };
            byProduct[pname].count++;
            byProduct[pname].qty += (it.qty || 1);
          });

          var dateStr = r.requestedAt || r.createdAt || '';
          var month = dateStr.substring(0, 7) || 'unknown';
          if (!byMonth[month]) byMonth[month] = { count: 0 };
          byMonth[month].count++;

          var refundCents = Math.round((r.refundAmount || 0) * 100);
          if (status === 'refund-issued') refundsTotalCents += refundCents;
          else if (ACTIVE.indexOf(status) >= 0) outstandingTotalCents += refundCents;
        });

        var topProducts = Object.keys(byProduct)
          .map(function(name) { return { product: name, returnCount: byProduct[name].count, qty: byProduct[name].qty }; })
          .sort(function(a, b) { return b.returnCount - a.returnCount; })
          .slice(0, 10);

        var topReasons = Object.keys(byReason)
          .map(function(reason) { return { reason: reason, count: byReason[reason].count }; })
          .sort(function(a, b) { return b.count - a.count; })
          .slice(0, 10);

        var recentRmas = filtered.slice(0, 15).map(function(r) {
          return {
            requestedAt: (r.requestedAt || r.createdAt || '').slice(0, 10),
            customer: r.customerEmail || r.customerName || '(unknown)',
            status: r.status || 'requested',
            reason: r.reason || '(unspecified)',
            itemCount: (r.items || []).reduce(function(t, it) { return t + (it.qty || 1); }, 0),
            refundUSD: r.refundAmount ? +(+r.refundAmount).toFixed(2) : 0
          };
        });

        return {
          route: '/app#rma',
          pageTitle: 'Returns (RMA)',
          filters: { status: rmaFilter },
          aggregates: {
            rowCount: filtered.length,
            activeCount: filtered.filter(function(r) { return ACTIVE.indexOf(r.status) >= 0; }).length,
            completedCount: filtered.filter(function(r) { return COMPLETED.indexOf(r.status) >= 0; }).length,
            refundsTotalUSD: +(refundsTotalCents / 100).toFixed(2),
            outstandingTotalUSD: +(outstandingTotalCents / 100).toFixed(2),
            byStatus: byStatus,
            byMonth: byMonth
          },
          topProducts: topProducts,
          topReasons: topReasons,
          recentRmas: recentRmas
        };
      }
    });
  }

  // ============================================================
  // Register with MastAdmin
  // ============================================================


  MastAdmin.registerModule('orders', {
    routes: {
      // 'orders' route ABSORBED into orders-v2 (T6 PR3) — it owns the bare route
      // now (OrdersBridge moved there). The legacy orders list/detail/triage UI in
      // this file is retired-but-present (reached only as fulfillment's
      // viewOrder/openShippingModal target + the dashboard cards) until PR3b deletes it.
      // 'commissions' route ABSORBED into commissions-v2 (T6 PR2).
      'rma': { tab: 'rmaTab', setup: function() { loadRmaData(); } }
    },
    detachListeners: function() {
      rmaData = {};
      rmaLoaded = false;
      // Hide detail views to prevent bleed into other routes
      var rmaDetail = document.getElementById('rmaDetailView');
      if (rmaDetail) { rmaDetail.style.display = 'none'; rmaDetail.innerHTML = ''; }
      var orderDetail = document.getElementById('orderDetailView');
      if (orderDetail) { orderDetail.style.display = 'none'; orderDetail.innerHTML = ''; }
    }
  });

})();
