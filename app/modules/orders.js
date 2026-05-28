/**
 * Orders + Commissions + Dashboard Cards Module
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var orderFilter = 'active';
  var ordersSortKey = 'placedAt';
  var ordersSortDir = 'desc';
  var orderSourceFilter = 'all';
  // W1.2: bulk selection state — keys of selected orders in current filtered view.
  var selectedOrderIds = Object.create(null);
  // W1.7: commission sort state. Field: 'date'|'piece'|'customer'|'status'|'deadline'|'total'. Direction: 'asc'|'desc'.
  var commissionSort = { field: 'deadline', dir: 'asc' };
  // W2 R2 Fix 1: commission-detail active tab state ('spec'|'thread'|'milestones'|'money'|'terms').
  // Must be declared at module scope so render fns reading it don't ReferenceError.
  var commDetailActiveTab = 'spec';
  // W2.2 R4: cache of milestones-by-commission-id; read+written by _renderCommissionMilestonesTab.
  // Must be declared at module scope so the renderer doesn't ReferenceError on first read.
  var commMilestonesCache = Object.create(null);
  var _viewOrderReturnRoute = null;

  // ============================================================
  // Badge Style Helpers (inline colors per style guide)
  // ============================================================

  var ORDER_STATUS_BADGE_COLORS = {
    pending_payment: { bg: 'rgba(230,81,0,0.2)', color: '#FFB74D', border: 'rgba(230,81,0,0.35)' },
    payment_failed:  { bg: 'rgba(198,40,40,0.2)', color: '#EF5350', border: 'rgba(198,40,40,0.35)' },
    placed:          { bg: 'rgba(230,81,0,0.2)', color: '#FFB74D', border: 'rgba(230,81,0,0.35)' },
    confirmed:       { bg: 'rgba(21,101,192,0.2)', color: '#64B5F6', border: 'rgba(21,101,192,0.35)' },
    building:        { bg: 'rgba(123,31,162,0.2)', color: '#CE93D8', border: 'rgba(123,31,162,0.35)' },
    ready:           { bg: 'rgba(27,92,82,0.25)', color: '#4DB6AC', border: 'rgba(27,92,82,0.4)' },
    pack:            { bg: 'rgba(27,92,82,0.25)', color: '#4DB6AC', border: 'rgba(27,92,82,0.4)' },
    packing:         { bg: 'rgba(249,168,37,0.2)', color: '#FFD54F', border: 'rgba(249,168,37,0.35)' },
    packed:          { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    handed_to_carrier: { bg: 'rgba(69,39,160,0.2)', color: '#B39DDB', border: 'rgba(69,39,160,0.35)' },
    shipped:         { bg: 'rgba(40,53,147,0.2)', color: '#7986CB', border: 'rgba(40,53,147,0.35)' },
    delivered:       { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    cancelled:       { bg: 'rgba(155,35,53,0.2)', color: '#EF5350', border: 'rgba(155,35,53,0.35)' },
    return_requested:    { bg: 'rgba(230,81,0,0.2)', color: '#FFB74D', border: 'rgba(230,81,0,0.35)' },
    return_approved:     { bg: 'rgba(230,81,0,0.2)', color: '#FFB74D', border: 'rgba(230,81,0,0.35)' },
    return_shipped:      { bg: 'rgba(69,39,160,0.2)', color: '#B39DDB', border: 'rgba(69,39,160,0.35)' },
    return_received:     { bg: 'rgba(21,101,192,0.2)', color: '#64B5F6', border: 'rgba(21,101,192,0.35)' },
    partially_returned:  { bg: 'rgba(230,81,0,0.2)', color: '#FFB74D', border: 'rgba(230,81,0,0.35)' },
    refunded:            { bg: 'rgba(155,35,53,0.2)', color: '#EF5350', border: 'rgba(155,35,53,0.35)' }
  };

  function orderStatusBadgeStyle(status) {
    var c = ORDER_STATUS_BADGE_COLORS[status] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  var PROD_REQUEST_STATUS_COLORS = {
    pending:     { bg: 'rgba(230,81,0,0.2)', color: '#FFB74D', border: 'rgba(230,81,0,0.35)' },
    assigned:    { bg: 'rgba(21,101,192,0.2)', color: '#64B5F6', border: 'rgba(21,101,192,0.35)' },
    'in-progress': { bg: 'rgba(123,31,162,0.2)', color: '#CE93D8', border: 'rgba(123,31,162,0.35)' },
    completed:   { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    fulfilled:   { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    cancelled:   { bg: 'rgba(198,40,40,0.2)', color: '#EF5350', border: 'rgba(198,40,40,0.35)' }
  };

  function prodRequestBadgeStyle(status) {
    var c = PROD_REQUEST_STATUS_COLORS[status] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  function etsySourceBadgeStyle() {
    return 'background:#F1641E;color:white;';
  }

  // ============================================================
  // Orders Management
  // ============================================================

  function loadOrders() {
    if (ordersLoaded) {
      renderOrders();
    }
  }

  function getOrdersArray() {
    var arr = [];
    Object.keys(orders).forEach(function(key) {
      var o = orders[key];
      o._key = key;
      arr.push(o);
    });
    arr.sort(function(a, b) {
      return (b.placedAt || '').localeCompare(a.placedAt || '');
    });
    return arr;
  }

  function getOrderDisplayNumber(order) {
    return order.orderNumber || order.orderId || order._key;
  }

  // Tenant business timezone, fetched lazily from businessEntity. All
  // date display + filtering goes through this so admin agrees with
  // MCP regardless of where the user is browsing from.
  var _tenantTz = null;
  var _tenantTzLoading = null;
  function ensureTenantTz() {
    if (_tenantTz !== null) return Promise.resolve(_tenantTz);
    if (_tenantTzLoading) return _tenantTzLoading;
    _tenantTzLoading = (window.MastDB && MastDB.businessEntity
      ? MastDB.businessEntity.get('operations')
      : Promise.resolve({ data: null })
    ).then(function(r) {
      var d = (r && r.data) || {};
      _tenantTz = (d.localization && d.localization.timezone) || '';
      return _tenantTz;
    }).catch(function() { _tenantTz = ''; return ''; });
    return _tenantTzLoading;
  }
  function tzPartsFromIso(isoStr) {
    if (!isoStr) return null;
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return null;
    var opts = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false };
    if (_tenantTz) opts.timeZone = _tenantTz;
    var fmt = new Intl.DateTimeFormat('en-CA', opts);
    var parts = fmt.formatToParts(d).reduce(function(acc, p) { acc[p.type] = p.value; return acc; }, {});
    return parts; // { year, month, day, hour, minute, ... }
  }

  function formatOrderDate(isoStr) {
    if (!isoStr) return '';
    var p = tzPartsFromIso(isoStr);
    if (!p) return isoStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[parseInt(p.month, 10) - 1] + ' ' + parseInt(p.day, 10) + ', ' + p.year;
  }

  function formatOrderDateTime(isoStr) {
    if (!isoStr) return '';
    var p = tzPartsFromIso(isoStr);
    if (!p) return isoStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var hours = parseInt(p.hour, 10);
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return months[parseInt(p.month, 10) - 1] + ' ' + parseInt(p.day, 10) + ', ' + hours + ':' + p.minute + ' ' + ampm;
  }

  function getOrderItemsLabel(order) {
    if (!order.items || !order.items.length) return '0 items';
    var total = 0;
    order.items.forEach(function(item) { total += (item.qty || 1); });
    return total + (total === 1 ? ' item' : ' items');
  }

  // ============================================================
  // Filter / Render
  // ============================================================

  function setOrderFilter(filter) {
    orderFilter = filter;
    renderOrders();
  }

  function filterOrdersBySource() {
    var sel = document.getElementById('orderSourceFilter');
    orderSourceFilter = sel ? sel.value : 'all';
    renderOrders();
  }

  // ============================================================
  // W1.2: Bulk-select helpers (Mark Shipped / Cancel / Export CSV)
  // ============================================================
  function updateOrdersBulkBar() {
    var bar = document.getElementById('ordersBulkBar');
    var count = document.getElementById('ordersBulkCount');
    var keys = Object.keys(selectedOrderIds);
    if (bar) bar.style.display = keys.length ? 'flex' : 'none';
    if (count) count.textContent = keys.length + ' selected';
    var allCb = document.getElementById('ordersBulkSelectAll');
    if (allCb) {
      var visibleCbs = document.querySelectorAll('.orders-bulk-cb');
      var allChecked = visibleCbs.length > 0;
      visibleCbs.forEach(function(cb) { if (!cb.checked) allChecked = false; });
      allCb.checked = allChecked;
    }
  }
  function toggleOrdersBulkSelect(key, cb) {
    if (!key) return;
    if (cb && cb.checked) selectedOrderIds[key] = true;
    else delete selectedOrderIds[key];
    updateOrdersBulkBar();
  }
  function toggleOrdersBulkSelectAll(masterCb) {
    var cbs = document.querySelectorAll('.orders-bulk-cb');
    cbs.forEach(function(cb) {
      cb.checked = !!(masterCb && masterCb.checked);
      var k = cb.getAttribute('data-key');
      if (cb.checked) selectedOrderIds[k] = true;
      else delete selectedOrderIds[k];
    });
    updateOrdersBulkBar();
  }
  function bulkOrdersClear() {
    selectedOrderIds = Object.create(null);
    var cbs = document.querySelectorAll('.orders-bulk-cb');
    cbs.forEach(function(cb) { cb.checked = false; });
    updateOrdersBulkBar();
  }
  function _bulkOrdersSelected() {
    var keys = Object.keys(selectedOrderIds);
    var all = getOrdersArray();
    var byKey = {};
    all.forEach(function(o) { byKey[o._key] = o; });
    return keys.map(function(k) { return byKey[k]; }).filter(Boolean);
  }
  async function bulkOrdersMarkShipped() {
    var orders = _bulkOrdersSelected();
    if (!orders.length) return;
    var etsyBlocked = orders.filter(function(o) { return o.source === 'etsy'; });
    if (etsyBlocked.length) {
      if (typeof window.MastToast === 'object' && window.MastToast.warn) {
        window.MastToast.warn(etsyBlocked.length + ' Etsy order(s) skipped — Etsy ships via Etsy.');
      }
    }
    var eligible = orders.filter(function(o) { return o.source !== 'etsy'; });
    if (!eligible.length) return;
    if (!window.confirm('Mark ' + eligible.length + ' order(s) as shipped?')) return;
    var ok = 0, fail = 0;
    for (var i = 0; i < eligible.length; i++) {
      try {
        if (window.MastDB && MastDB.orders && MastDB.orders.update) {
          await MastDB.orders.update(eligible[i]._key, { status: 'shipped', shippedAt: new Date().toISOString() });
        }
        ok++;
      } catch (e) { fail++; }
    }
    if (window.MastToast && window.MastToast.success) window.MastToast.success('Marked ' + ok + ' shipped' + (fail ? ' (' + fail + ' failed)' : ''));
    bulkOrdersClear();
  }
  async function bulkOrdersCancel() {
    var orders = _bulkOrdersSelected();
    if (!orders.length) return;
    if (!window.confirm('Cancel ' + orders.length + ' order(s)? This cannot be undone via this dialog.')) return;
    var ok = 0, fail = 0;
    for (var i = 0; i < orders.length; i++) {
      try {
        if (window.MastDB && MastDB.orders && MastDB.orders.update) {
          await MastDB.orders.update(orders[i]._key, { status: 'cancelled', cancelledAt: new Date().toISOString() });
        }
        ok++;
      } catch (e) { fail++; }
    }
    if (window.MastToast && window.MastToast.success) window.MastToast.success('Cancelled ' + ok + (fail ? ' (' + fail + ' failed)' : ''));
    bulkOrdersClear();
  }
  function bulkOrdersExportCsv() {
    var orders = _bulkOrdersSelected();
    if (!orders.length) {
      // If nothing selected, export all currently visible (filter result).
      orders = (function() {
        var rows = [];
        var all = getOrdersArray();
        var keys = Array.from(document.querySelectorAll('.orders-bulk-cb')).map(function(cb) { return cb.getAttribute('data-key'); });
        var byKey = {}; all.forEach(function(o) { byKey[o._key] = o; });
        keys.forEach(function(k) { if (byKey[k]) rows.push(byKey[k]); });
        return rows;
      })();
    }
    if (!orders.length) return;
    var cols = ['orderId','displayNumber','email','status','total','items','tracking','placedAt','source'];
    var lines = [cols.join(',')];
    orders.forEach(function(o) {
      var row = [
        o._key || '',
        getOrderDisplayNumber(o),
        o.email || '',
        o.status || '',
        (o.total || 0).toFixed(2),
        (o.items || []).reduce(function(s, it) { return s + (it.qty || 1); }, 0),
        (o.tracking && (o.tracking.trackingNumber || o.tracking.number)) || '',
        o.placedAt || o.createdAt || '',
        o.source || 'direct'
      ];
      lines.push(row.map(function(v) {
        var s = String(v == null ? '' : v);
        if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      }).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'orders-export-' + (new Date().toISOString().slice(0,10)) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function renderOrders() {
    var loadingEl = document.getElementById('ordersLoading');
    var emptyEl = document.getElementById('ordersEmpty');
    var tableEl = document.getElementById('ordersTable');
    var tbodyEl = document.getElementById('ordersTableBody');
    var cardsEl = document.getElementById('orderCards');
    var countEl = document.getElementById('ordersCount');
    var pillsEl = document.getElementById('ordersFilterPills');

    if (loadingEl) loadingEl.style.display = 'none';

    var all = getOrdersArray();

    // Count by status
    var counts = {};
    all.forEach(function(o) {
      var s = o.status || 'placed';
      counts[s] = (counts[s] || 0) + 1;
    });

    // Active count = not delivered, not cancelled, not payment_failed
    var activeCount = all.filter(function(o) {
      return o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'payment_failed';
    }).length;

    // Update sidebar badge with placed order count
    var placedCount = counts.placed || 0;
    var badge = document.getElementById('sidebarOrdersBadge');
    if (badge) {
      if (placedCount > 0) {
        badge.textContent = placedCount;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }

    // Render filter pills
    // W1.2: Today / This Week date pills, computed in tenant tz.
    var _today = (function() {
      var p = tzPartsFromIso(new Date().toISOString());
      return p ? (p.year + '-' + p.month + '-' + p.day) : '';
    })();
    var _weekStart = (function() {
      if (!_today) return '';
      var t = new Date(_today + 'T00:00:00');
      // Treat Monday as start of week
      var dow = t.getDay(); // 0=Sun..6=Sat
      var diff = (dow + 6) % 7;
      t.setDate(t.getDate() - diff);
      var mm = String(t.getMonth() + 1).padStart(2, '0');
      var dd = String(t.getDate()).padStart(2, '0');
      return t.getFullYear() + '-' + mm + '-' + dd;
    })();
    var todayCount = 0, weekCount = 0;
    all.forEach(function(o) {
      var p = tzPartsFromIso(o.placedAt || o.createdAt || '');
      if (!p) return;
      var d = p.year + '-' + p.month + '-' + p.day;
      if (_today && d === _today) todayCount++;
      if (_weekStart && d >= _weekStart) weekCount++;
    });
    var pillStatuses = [
      { key: 'active', label: 'Active', count: activeCount },
      { key: 'today', label: 'Today', count: todayCount },
      { key: 'this_week', label: 'This Week', count: weekCount },
      { key: 'all', label: 'All', count: all.length },
      { key: 'pending_payment', label: 'Pending Payment', count: counts.pending_payment || 0 },
      { key: 'placed', label: 'Placed', count: counts.placed || 0 },
      { key: 'confirmed', label: 'Confirmed', count: counts.confirmed || 0 },
      { key: 'building', label: 'Building', count: counts.building || 0 },
      { key: 'pack', label: 'Pack', count: counts.pack || 0 },
      { key: 'packing', label: 'Packing', count: counts.packing || 0 },
      { key: 'packed', label: 'Packed', count: counts.packed || 0 },
      { key: 'handed_to_carrier', label: 'Handed to Carrier', count: counts.handed_to_carrier || 0 },
      { key: 'shipped', label: 'Shipped', count: counts.shipped || 0 },
      { key: 'delivered', label: 'Delivered', count: counts.delivered || 0 },
      { key: 'cancelled', label: 'Cancelled', count: counts.cancelled || 0 },
      { key: 'payment_failed', label: 'Payment Failed', count: counts.payment_failed || 0 }
    ];
    var pillHtml = '';
    pillStatuses.forEach(function(p) {
      pillHtml += '<button class="order-filter-pill' + (orderFilter === p.key ? ' active' : '') +
        '" onclick="setOrderFilter(\'' + p.key + '\')">' + p.label +
        '<span class="pill-count">(' + p.count + ')</span></button>';
    });
    if (pillsEl) pillsEl.innerHTML = pillHtml;

    // Filter by source
    var sourceFiltered = all;
    if (orderSourceFilter === 'direct') {
      sourceFiltered = all.filter(function(o) { return !o.source || o.source === 'direct'; });
    } else if (orderSourceFilter === 'etsy') {
      sourceFiltered = all.filter(function(o) { return o.source === 'etsy'; });
    }

    // Filter orders by status
    var filtered;
    if (orderFilter === 'all') {
      filtered = sourceFiltered;
    } else if (orderFilter === 'active') {
      filtered = sourceFiltered.filter(function(o) {
        return o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'payment_failed';
      });
    } else if (orderFilter === 'today') {
      filtered = sourceFiltered.filter(function(o) {
        var p = tzPartsFromIso(o.placedAt || o.createdAt || '');
        if (!p) return false;
        return _today && (p.year + '-' + p.month + '-' + p.day) === _today;
      });
    } else if (orderFilter === 'this_week') {
      filtered = sourceFiltered.filter(function(o) {
        var p = tzPartsFromIso(o.placedAt || o.createdAt || '');
        if (!p) return false;
        return _weekStart && (p.year + '-' + p.month + '-' + p.day) >= _weekStart;
      });
    } else {
      filtered = sourceFiltered.filter(function(o) { return (o.status || 'placed') === orderFilter; });
    }

    // URL-driven filters: status, dateFrom, dateTo, orderIds (#orders?...)
    var routeParams = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var statusFromUrl = routeParams && typeof routeParams.status === 'string' ? routeParams.status : '';
    var dateFrom = routeParams && typeof routeParams.dateFrom === 'string' ? routeParams.dateFrom.slice(0, 10) : '';
    var dateTo = routeParams && typeof routeParams.dateTo === 'string' ? routeParams.dateTo.slice(0, 10) : '';
    var orderIdsParam = routeParams && typeof routeParams.orderIds === 'string' ? routeParams.orderIds : '';
    var orderIdSet = orderIdsParam
      ? orderIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
      : [];
    var orderIdLookup = orderIdSet.length > 0 ? Object.create(null) : null;
    if (orderIdLookup) orderIdSet.forEach(function(id) { orderIdLookup[id] = true; });

    if (dateFrom || dateTo) {
      // Use the tenant business timezone so the filter matches the UI's
      // DATE column AND the MCP's filter (both also use tenant TZ).
      var tzDateStr = function(iso) {
        var p = tzPartsFromIso(iso);
        if (!p) return '';
        return p.year + '-' + p.month + '-' + p.day;
      };
      filtered = filtered.filter(function(o) {
        var d = tzDateStr(o.placedAt || o.createdAt || '');
        if (!d) return false;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    }
    if (orderIdLookup) {
      filtered = filtered.filter(function(o) { return orderIdLookup[o._key] || orderIdLookup[o.orderId]; });
    }

    // URL-filter banner — surfaces active filters so users know why
    // fewer orders are showing, with a Clear button.
    var hasUrlFilter = !!(statusFromUrl || dateFrom || dateTo || orderIdSet.length);
    var bannerEl = document.getElementById('ordersDateBanner');
    if (!bannerEl && hasUrlFilter) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'ordersDateBanner';
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      var pillsParent = pillsEl && pillsEl.parentNode;
      if (pillsParent) pillsParent.insertBefore(bannerEl, pillsEl.nextSibling);
    }
    if (bannerEl) {
      if (hasUrlFilter) {
        var parts = [];
        if (orderIdSet.length) parts.push(orderIdSet.length + ' selected order' + (orderIdSet.length === 1 ? '' : 's'));
        if (statusFromUrl) parts.push('status: ' + String(statusFromUrl).replace(/_/g, ' '));
        if (dateFrom && dateTo) parts.push('from ' + dateFrom + ' to ' + dateTo);
        else if (dateFrom) parts.push('from ' + dateFrom + ' onward');
        else if (dateTo) parts.push('through ' + dateTo);
        var label = 'Showing ' + parts.join(', ');
        bannerEl.innerHTML = '<span>📅 ' + label + '</span><button type="button" onclick="clearOrdersDateFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
        bannerEl.style.display = 'flex';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    if (countEl) countEl.textContent = filtered.length + ' order' + (filtered.length !== 1 ? 's' : '');

    if (filtered.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      if (tableEl) tableEl.style.display = 'none';
      if (cardsEl) cardsEl.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    // Production request queue summary
    var pendingRequests = Object.keys(productionRequests).filter(function(k) {
      var j = productionRequests[k];
      return j.status === 'pending';
    });
    var queueSummaryHtml = '';
    if (pendingRequests.length > 0) {
      queueSummaryHtml = '<div class="build-queue-summary" onclick="switchTab(\'production\')">' +
        pendingRequests.length + ' production request' + (pendingRequests.length !== 1 ? 's' : '') + ' pending</div>';
    }

    // W1.2: prune selectedOrderIds to keys still present in filtered view.
    var _filteredKeys = Object.create(null);
    filtered.forEach(function(o) { _filteredKeys[o._key] = true; });
    Object.keys(selectedOrderIds).forEach(function(k) {
      if (!_filteredKeys[k]) delete selectedOrderIds[k];
    });

    // Sortable headers — re-rendered each cycle to reflect active sort.
    var headEl = document.getElementById('ordersTableHead');
    if (headEl && typeof window.mastSortableTh === 'function') {
      var headHtml = '<th style="width:28px;"><input type="checkbox" id="ordersBulkSelectAll" onclick="toggleOrdersBulkSelectAll(this)" title="Select all visible"></th>';
      headHtml += window.mastSortableTh('Order',    'orderId',   ordersSortKey, ordersSortDir, 'window._ordersSort');
      headHtml += window.mastSortableTh('Customer', 'email',     ordersSortKey, ordersSortDir, 'window._ordersSort');
      headHtml += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);">Items</th>';
      headHtml += window.mastSortableTh('Total',    'total',     ordersSortKey, ordersSortDir, 'window._ordersSort');
      headHtml += window.mastSortableTh('Status',   'status',    ordersSortKey, ordersSortDir, 'window._ordersSort');
      headHtml += '<th style="text-align:left;padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);">Tracking</th>';
      headHtml += window.mastSortableTh('Date',     'placedAt',  ordersSortKey, ordersSortDir, 'window._ordersSort');
      headEl.innerHTML = headHtml;
    }
    // Sort the filtered set.
    if (typeof window.mastSortRows === 'function') {
      filtered = window.mastSortRows(filtered, ordersSortKey, ordersSortDir, function(row, key) {
        if (key === 'orderId') return getOrderDisplayNumber(row);
        if (key === 'placedAt') return row.placedAt || row.createdAt || '';
        if (key === 'total') return Number(row.total) || 0;
        return row && row[key];
      });
    }

    // Table rows
    var rowsHtml = '';
    filtered.forEach(function(o) {
      var key = o._key;
      var num = esc(getOrderDisplayNumber(o));
      var status = o.status || 'placed';
      var sourceBadge = o.source === 'etsy' ? ' <span class="status-badge" style="' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
      var effInv = getEffectiveInvoiceStatus(o);
      var invBadge = effInv ? ' <span class="status-badge" style="font-size:0.72rem;padding:1px 6px;' + invoiceStatusBadgeStyle(effInv) + '">INV:' + effInv + '</span>' : '';
      var trk = (o.tracking && (o.tracking.trackingNumber || o.tracking.number)) || '';
      var checked = selectedOrderIds[key] ? ' checked' : '';
      rowsHtml += '<tr onclick="viewOrder(\'' + esc(key) + '\')">' +
        '<td onclick="event.stopPropagation();"><input type="checkbox" class="orders-bulk-cb" data-key="' + esc(key) + '"' + checked + ' onclick="event.stopPropagation();toggleOrdersBulkSelect(\'' + esc(key) + '\', this)"></td>' +
        '<td><span style="font-family:monospace;font-weight:600;">' + num + '</span>' + sourceBadge + '</td>' +
        '<td>' + esc(o.email || '') + '</td>' +
        '<td>' + getOrderItemsLabel(o) + '</td>' +
        '<td>$' + (o.total || 0).toFixed(2) + '</td>' +
        '<td><span class="status-badge pill" style="' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span>' + invBadge + '</td>' +
        '<td>' + (trk ? '<span style="font-family:monospace;font-size:0.78rem;">' + esc(trk) + '</span>' : '<span style="color:var(--warm-gray);">—</span>') + '</td>' +
        '<td>' + formatOrderDate(o.placedAt || o.pendingPaymentAt) + '</td>' +
        '</tr>';
    });
    if (tbodyEl) tbodyEl.innerHTML = rowsHtml;
    updateOrdersBulkBar();

    // Mobile cards
    var cardHtml = queueSummaryHtml;
    filtered.forEach(function(o) {
      var key = o._key;
      var num = esc(getOrderDisplayNumber(o));
      var status = o.status || 'placed';
      var cardSourceBadge = o.source === 'etsy' ? '<span class="status-badge" style="margin-left:8px;' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
      var cardEffInv = getEffectiveInvoiceStatus(o);
      var cardInvBadge = cardEffInv ? '<span class="status-badge" style="margin-left:6px;font-size:0.72rem;padding:1px 6px;' + invoiceStatusBadgeStyle(cardEffInv) + '">INV:' + cardEffInv + '</span>' : '';
      var cardShippable = ['confirmed', 'building', 'pack', 'packing', 'packed', 'handed_to_carrier'].indexOf(status) !== -1;
      var cardBtns = '<div style="display:flex;gap:6px;flex-shrink:0;">';
      if (cardShippable) {
        cardBtns += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();openShippingModal(\'' + esc(key) + '\')">Ship</button>';
      }
      cardBtns += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();viewOrder(\'' + esc(key) + '\')">View</button></div>';

      cardHtml += '<div class="order-card" onclick="viewOrder(\'' + esc(key) + '\')">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
          '<div>' +
            '<div style="font-weight:600;font-family:monospace;">' + num + ' <span class="status-badge pill" style="' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span>' + cardSourceBadge + cardInvBadge + '</div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(o.email || '') + ' &mdash; ' + getOrderItemsLabel(o) + '</div>' +
          '</div>' +
          cardBtns +
        '</div>' +
        renderOrderProgress(status) +
      '</div>';
    });
    if (cardsEl) cardsEl.innerHTML = cardHtml;
  }

  // ============================================================
  // Order Progress Flow
  // ============================================================

  function renderOrderProgress(status) {
    // Define the happy-path steps
    var steps = ['placed', 'confirmed', 'pack', 'packing', 'packed', 'shipped', 'delivered'];
    // Insert building after confirmed if order went through building
    if (status === 'building' || (status !== 'placed' && status !== 'confirmed')) {
      // Check if building should be shown — include it if current or past
      // We'll detect by checking if building is in the path
    }

    // Simplified: define all possible steps, determine which are in the flow
    var allSteps = ['placed', 'confirmed', 'building', 'pack', 'packing', 'packed', 'shipped', 'delivered'];
    var stepLabels = {
      placed: 'Placed', confirmed: 'Confirmed', building: 'Build',
      pack: 'Pack', packing: 'Packing', packed: 'Packed',
      shipped: 'Shipped', delivered: 'Delivered'
    };

    // Determine which steps to show
    var flow;
    if (status === 'cancelled') {
      return '<div class="order-progress"><div class="order-progress-step cancelled"><span class="order-progress-dot"></span>Cancelled</div></div>';
    } else if (status === 'pending_payment' || status === 'payment_failed') {
      var plabel = status === 'pending_payment' ? 'Pending Payment' : 'Payment Failed';
      return '<div class="order-progress"><div class="order-progress-step current"><span class="order-progress-dot"></span>' + plabel + '</div></div>';
    } else if (status === 'handed_to_carrier') {
      flow = ['placed', 'confirmed', 'building', 'pack', 'packing', 'packed', 'shipped', 'delivered'];
    } else {
      flow = ['placed', 'confirmed', 'building', 'pack', 'packing', 'packed', 'shipped', 'delivered'];
    }

    var currentIdx = flow.indexOf(status);
    // If order skipped building (went straight to ready+), show Build as skipped
    var skippedBuild = status !== 'building' && currentIdx > flow.indexOf('building');
    var html = '<div class="order-progress">';
    flow.forEach(function(step, idx) {
      var cls;
      if (step === 'building' && skippedBuild) {
        cls = 'skipped';
      } else if (idx < currentIdx) {
        cls = 'completed';
      } else if (idx === currentIdx) {
        cls = 'current';
      } else {
        cls = 'upcoming';
      }
      html += '<div class="order-progress-step ' + cls + '">' +
        '<span class="order-progress-dot"></span>' +
        stepLabels[step] +
      '</div>';
      if (idx < flow.length - 1) {
        var connCls = idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : '';
        if (step === 'building' && skippedBuild) connCls = 'done';
        html += '<div class="order-progress-connector ' + connCls + '"></div>';
      }
    });
    html += '</div>';
    return html;
  }

  // ============================================================
  // Order Detail View
  // ============================================================

  function viewOrder(orderId) {
    _viewOrderReturnRoute = currentRoute !== 'orders' ? currentRoute : null;
    selectedOrderId = orderId;
    // Preserve MastNavStack across this internal navigation — top-level
    // navigateTo() clears the stack unless _mastNavInternal is set. Without
    // this, pushing a stack entry then calling viewOrder (e.g. from a
    // customer detail) loses the push and "Back" falls through to the
    // orders list instead of the pushing context.
    window._mastNavInternal = true;
    try {
      navigateTo('orders');
    } finally {
      window._mastNavInternal = false;
    }
    // Hide feature gate callout on detail view
    var gateEls = document.querySelectorAll('.feature-gate-callout');
    gateEls.forEach(function(el) { el.remove(); });
    document.getElementById('ordersListView').style.display = 'none';
    var detailEl = document.getElementById('orderDetailView');
    detailEl.style.display = 'block';
    renderOrderDetail(orderId);
    emitTestingEvent('viewOrder', {}); // Testing Mode
  }

  function backToOrders() {
    // MastFlow: tear down per-order subscription on close.
    if (_mfOrderActiveSubscription && _mfOrderActiveSubscription.off) {
      try { _mfOrderActiveSubscription.off(); } catch (e) {}
      _mfOrderActiveSubscription = null;
    }
    // MastNavStack-aware: if there's a stacked entry, return to that context.
    if (window.MastNavStack && MastNavStack.size() > 0) {
      selectedOrderId = null;
      document.getElementById('orderDetailView').style.display = 'none';
      document.getElementById('orderDetailView').className = 'order-detail';
      MastNavStack.popAndReturn();
      return;
    }
    selectedOrderId = null;
    if (_viewOrderReturnRoute) {
      var route = _viewOrderReturnRoute;
      _viewOrderReturnRoute = null;
      document.getElementById('orderDetailView').style.display = 'none';
      document.getElementById('orderDetailView').className = 'order-detail';
      navigateTo(route);
    } else {
      document.getElementById('ordersListView').style.display = 'block';
      document.getElementById('orderDetailView').style.display = 'none';
      document.getElementById('orderDetailView').className = 'order-detail';
    }
  }

  function renderOrderDetail(orderId) {
    var o = orders[orderId];
    if (!o) {
      document.getElementById('orderDetailView').innerHTML = '<p>Order not found.</p>';
      return;
    }
    var detailEl = document.getElementById('orderDetailView');
    var status = o.status || 'placed';
    var num = esc(getOrderDisplayNumber(o));

    // Workflow-orthogonal action buttons only. Forward motion through the
    // workflow (Confirm / Build / Pack / Packed / Shipped / Delivered) now
    // lives in the MastFlow header below — those status-specific buttons
    // were removed when the pick/ship workflow was migrated to MastFlow.
    var actionsHtml = '';
    var canCancel = (ORDER_VALID_TRANSITIONS[status] || []).indexOf('cancelled') !== -1;
    if (canCancel) {
      actionsHtml += '<button class="btn btn-danger" onclick="openCancelOrderModal(\'' + esc(orderId) + '\')">Cancel Order</button>';
    }
    // Invoice generation (wholesale/net-terms orders without a live invoice)
    if (isOrderInvoiceable(o)) {
      actionsHtml += '<button class="btn btn-secondary" onclick="generateInvoice(\'' + esc(orderId) + '\')">Generate Invoice</button>';
    }
    // W1.5: Start Return — available on any shipped/delivered/completed order. Operator-initiated RMA.
    if (status === 'shipped' || status === 'delivered' || status === 'completed') {
      actionsHtml += '<button class="btn btn-secondary" onclick="openNewRmaModal(\'' + esc(orderId) + '\')">Start Return</button>';
    }

    // Items section
    var itemsHtml = '';
    (o.items || []).forEach(function(item) {
      var optStr = '';
      if (item.options && typeof item.options === 'object') {
        var parts = [];
        Object.keys(item.options).forEach(function(k) { parts.push(k + ': ' + item.options[k]); });
        optStr = parts.join(', ');
      }
      var ffHtml = '';
      if (o.fulfillment) {
        var ffKey = getItemFulfillmentKey(item);
        var ff = o.fulfillment[ffKey];
        if (ff) {
          if (ff.source === 'stock') {
            ffHtml = '<span class="order-item-fulfillment stock">From Stock</span>';
          } else if (ff.source === 'build') {
            var bjStatus = '';
            if (ff.buildJobId && productionRequests[ff.buildJobId]) {
              bjStatus = ' (' + productionRequests[ff.buildJobId].status + ')';
            }
            ffHtml = '<span class="order-item-fulfillment build">Build' + bjStatus + '</span>';
          }
        }
      } else if (o.status === 'placed') {
        var invStatus = getItemInventoryStatus(item);
        var invCls = invStatus.status === 'stock' ? 'inv-stock' : invStatus.status === 'partial' ? 'inv-partial' : invStatus.status === 'build' ? 'inv-build' : invStatus.status === 'out' ? 'inv-out' : 'inv-unknown';
        var invIcon = invStatus.status === 'stock' ? '&#10003; ' : invStatus.status === 'partial' ? '&#9888; ' : invStatus.status === 'build' ? '&#128296; ' : invStatus.status === 'out' ? '&#10007; ' : '';
        ffHtml = '<span class="order-item-inv ' + invCls + '">' + invIcon + esc(invStatus.label) + '</span>';
      }
      itemsHtml += '<div class="order-item-row">' +
        '<div>' +
          '<div class="order-item-name">' + esc(item.name) + ' x' + (item.qty || 1) + '</div>' +
          (optStr ? '<div class="order-item-options">' + esc(optStr) + '</div>' : '') +
          ffHtml +
        '</div>' +
        '<div class="order-item-price">$' + (((item.priceCents || 0) * (item.qty || 1)) / 100).toFixed(2) + '</div>' +
      '</div>';
    });

    // Order summary
    var displaySubtotal = o.subtotal || 0;
    if (o.membershipDiscount && o.membershipDiscount.discountCents) {
      displaySubtotal = displaySubtotal + (o.membershipDiscount.discountCents / 100);
    }
    var summaryHtml = '<div class="order-summary-row"><span>Subtotal</span><span>$' + displaySubtotal.toFixed(2) + '</span></div>';
    if (o.membershipDiscount && o.membershipDiscount.discountCents) {
      summaryHtml += '<div class="order-summary-row discount"><span>' + esc(o.membershipDiscount.programName || 'Member Discount') + '</span><span>-$' + (o.membershipDiscount.discountCents / 100).toFixed(2) + '</span></div>';
    }
    var shipLabel = (o.shippingMethod && o.shippingMethod.label) || 'Standard';
    var shipCost = o.shippingCost || 0;
    summaryHtml += '<div class="order-summary-row"><span>' + esc(shipLabel) + '</span><span>' + (shipCost > 0 ? '$' + shipCost.toFixed(2) : 'Free') + '</span></div>';
    if (o.tax) {
      var displayRate = o.taxRate || (o.subtotal ? o.tax / o.subtotal : 0);
      summaryHtml += '<div class="order-summary-row"><span>Tax (' + (displayRate * 100).toFixed(1) + '% ' + (o.taxState || '') + ')</span><span>$' + o.tax.toFixed(2) + '</span></div>';
    }
    if (o.coupon && o.coupon.discount) {
      summaryHtml += '<div class="order-summary-row discount"><span>Coupon (' + esc(o.coupon.code) + ')</span><span>-$' + o.coupon.discount.toFixed(2) + '</span></div>';
    }
    if (o.walletDeductions && o.walletDeductions.totalDeductionCents > 0) {
      if (o.walletDeductions.loyalty && o.walletDeductions.loyalty.amountCents > 0) {
        summaryHtml += '<div class="order-summary-row discount"><span>Loyalty</span><span>-$' + (o.walletDeductions.loyalty.amountCents / 100).toFixed(2) + '</span></div>';
      }
      var gcTotal = 0;
      if (o.walletDeductions.giftCards) {
        for (var gi = 0; gi < o.walletDeductions.giftCards.length; gi++) gcTotal += o.walletDeductions.giftCards[gi].amountCents || 0;
      }
      if (gcTotal > 0) {
        summaryHtml += '<div class="order-summary-row discount"><span>Gift Card</span><span>-$' + (gcTotal / 100).toFixed(2) + '</span></div>';
      }
      var credTotal = 0;
      if (o.walletDeductions.credits) {
        for (var ci = 0; ci < o.walletDeductions.credits.length; ci++) credTotal += o.walletDeductions.credits[ci].amountCents || 0;
      }
      if (credTotal > 0) {
        summaryHtml += '<div class="order-summary-row discount"><span>Store Credit</span><span>-$' + (credTotal / 100).toFixed(2) + '</span></div>';
      }
    }
    summaryHtml += '<div class="order-summary-row total"><span>Total</span><span class="order-summary-value">$' + (o.total || 0).toFixed(2) + '</span></div>';

    // Addresses
    var ship = o.shipping || {};
    var shipHtml = '<p>' + esc(ship.name || '') + '<br>' +
      esc(ship.address1 || '') +
      (ship.address2 ? '<br>' + esc(ship.address2) : '') +
      '<br>' + esc(ship.city || '') + ', ' + esc(ship.state || '') + ' ' + esc(ship.zip || '') + '</p>';
    var billHtml = '';
    if (o.billing && !o.billing.same) {
      var bill = o.billing;
      billHtml = '<p>' + esc(bill.name || '') + '<br>' +
        esc(bill.address1 || '') +
        (bill.address2 ? '<br>' + esc(bill.address2) : '') +
        '<br>' + esc(bill.city || '') + ', ' + esc(bill.state || '') + ' ' + esc(bill.zip || '') + '</p>';
    } else {
      billHtml = '<p style="color:var(--warm-gray);font-style:italic;">Same as shipping</p>';
    }

    // Square payment info
    var paymentHtml = '';
    if (o.squarePaymentId || o.squareOrderId || o.squareCheckoutId) {
      var payRows = '';
      if (o.squarePaymentId) {
        payRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Payment ID</span><span style="font-family:monospace;font-size:0.85rem;">' + esc(o.squarePaymentId) + '</span></div>';
      }
      if (o.paidAmount) {
        payRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Amount Paid</span><span>$' + (o.paidAmount / 100).toFixed(2) + '</span></div>';
      }
      if (o.squareOrderId) {
        payRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Square Order</span><span style="font-family:monospace;font-size:0.85rem;">' + esc(o.squareOrderId) + '</span></div>';
      }
      var payStatus = status === 'pending_payment' ? 'Awaiting Payment' : status === 'payment_failed' ? 'Failed' : 'Paid';
      payRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Payment Status</span><span>' + payStatus + '</span></div>';
      paymentHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Payment (Square)</div>' +
        payRows +
      '</div>';
    }

    // Etsy info
    var etsyHtml = '';
    if (o.source === 'etsy' && o.etsyReceiptId) {
      var etsyRows = '';
      etsyRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Source</span><span class="status-badge" style="' + etsySourceBadgeStyle() + '">Etsy</span></div>';
      etsyRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Receipt ID</span><span style="font-family:monospace;font-size:0.85rem;">' +
        (o.etsyOrderUrl ? '<a href="' + esc(o.etsyOrderUrl) + '" target="_blank" style="color:var(--teal);">' + esc(o.etsyReceiptId) + '</a>' : esc(o.etsyReceiptId)) +
        '</span></div>';
      if (o.etsyBuyerUsername) {
        etsyRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Buyer</span><span>' + esc(o.etsyBuyerUsername) + '</span></div>';
      }
      if (o.etsyTrackingPushed) {
        etsyRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Tracking Pushed</span><span style="color:var(--teal);">&#10003; ' + formatOrderDateTime(o.etsyTrackingPushedAt) + '</span></div>';
      }
      etsyHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Etsy Order</div>' +
        etsyRows +
      '</div>';
    }

    // Tracking
    var trackingHtml = '';
    if (o.tracking && o.tracking.trackingNumber) {
      var labelActions = '';
      if (o.tracking.labelUrl) {
        labelActions += '<a href="' + esc(o.tracking.labelUrl) + '" target="_blank" class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;text-decoration:none;">View / Print Label</a>';
      }
      if (o.tracking.shipmentId && o.status === 'shipped') {
        labelActions += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;color:var(--danger);" onclick="shippingVoidLabel(\'' + esc(orderId) + '\')">Void Label</button>';
      }
      trackingHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Tracking</div>' +
        '<div class="order-tracking-info">' +
          '<strong>' + esc(o.tracking.carrier || '') + '</strong>' +
          '<span style="font-family:monospace;">' + esc(o.tracking.trackingNumber) + '</span>' +
          (o.tracking.trackingUrl ? '<a href="' + esc(o.tracking.trackingUrl) + '" target="_blank" class="order-tracking-link">Track Package</a>' : '') +
        '</div>' +
        (labelActions ? '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">' + labelActions + '</div>' : '') +
        (o.tracking.labelProvider ? '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:6px;">Label via ' + esc(o.tracking.labelProvider) + (o.tracking.purchasedAt ? ' on ' + formatOrderDateTime(o.tracking.purchasedAt) : '') + '</div>' : '') +
      '</div>';
    }

    // Invoice
    var invoiceHtml = buildInvoiceSection(orderId);

    // Fulfillment Log
    var ffLogHtml = '';
    var ffLog = o.fulfillmentLog || [];
    if (ffLog.length > 0) {
      var ffEntries = '';
      ffLog.slice().reverse().forEach(function(entry) {
        var label = entry.event === 'packed' ? 'Packed' :
          entry.event === 'handed_to_carrier' ? 'Handed to Carrier' : esc(entry.event);
        ffEntries += '<div class="order-timeline-entry">' +
          '<div class="order-timeline-time">' + formatOrderDateTime(entry.timestamp) + '</div>' +
          '<div class="order-timeline-text">' + label +
            ' <span style="color:var(--warm-gray-light);">via ' + esc(entry.method || 'unknown') + '</span>' +
            (entry.bundleId ? ' <span style="color:var(--warm-gray-light);">bundle: ' + esc(entry.bundleId) + '</span>' : '') +
            (entry.carrier ? ' <span style="color:var(--warm-gray-light);">' + esc(entry.carrier) + '</span>' : '') +
          '</div>' +
        '</div>';
      });
      ffLogHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Fulfillment Log</div>' +
        '<div class="order-timeline">' + ffEntries + '</div>' +
      '</div>';
    }

    // Timeline — always show, built from statusHistory + fallback to timestamp fields
    var timelineHtml = '';
    var history = o.statusHistory || [];
    var timelineEntries = [];

    if (history.length > 0) {
      // Use statusHistory if available
      history.forEach(function(h) {
        timelineEntries.push({
          status: h.status,
          at: h.at,
          by: h.by || '',
          note: h.note || ''
        });
      });
    } else {
      // Reconstruct timeline from individual timestamp fields
      var statusTimestamps = [
        { key: 'pending_payment', field: 'pendingPaymentAt' },
        { key: 'placed', field: 'placedAt' },
        { key: 'confirmed', field: 'confirmedAt' },
        { key: 'building', field: 'buildingAt' },
        { key: 'pack', field: 'packAt' },
        { key: 'packing', field: 'packingAt' },
        { key: 'packed', field: 'packedAt' },
        { key: 'handed_to_carrier', field: 'handedToCarrierAt' },
        { key: 'shipped', field: 'shippedAt' },
        { key: 'delivered', field: 'deliveredAt' },
        { key: 'cancelled', field: 'cancelledAt' }
      ];
      statusTimestamps.forEach(function(st) {
        if (o[st.field]) {
          timelineEntries.push({ status: st.key, at: o[st.field], by: '', note: '' });
        }
      });
      // If no timestamps found, at least show creation
      if (timelineEntries.length === 0 && (o.createdAt || o.placedAt)) {
        timelineEntries.push({ status: status, at: o.createdAt || o.placedAt || '', by: '', note: '' });
      }
    }

    if (timelineEntries.length > 0) {
      // Sort chronologically then show most recent first
      timelineEntries.sort(function(a, b) { return (a.at || '').localeCompare(b.at || ''); });
      var entries = '';
      timelineEntries.slice().reverse().forEach(function(h) {
        var statusLabel = (h.status || h.to || 'unknown').replace(/_/g, ' ');
        statusLabel = statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1);
        entries += '<div class="order-timeline-entry">' +
          '<div class="order-timeline-time">' + formatOrderDateTime(h.at) + '</div>' +
          '<div class="order-timeline-text">' + esc(statusLabel) +
            (h.note ? ' — ' + esc(h.note) : '') +
            (h.by ? ' <span style="color:var(--warm-gray-light);">by ' + esc(h.by) + '</span>' : '') +
          '</div>' +
        '</div>';
      });
      timelineHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Timeline</div>' +
        '<div class="order-timeline">' + entries + '</div>' +
      '</div>';
    } else {
      // Always show timeline section even if empty
      timelineHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Timeline</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray-light);padding:8px 0;">No history recorded yet.</div>' +
      '</div>';
    }

    // Notes — accept legacy array shape or tenant-MCP map shape ({noteId: {text, by, at}})
    var rawNotes = o.notes;
    var notesArr = Array.isArray(rawNotes)
      ? rawNotes.slice()
      : (rawNotes && typeof rawNotes === 'object'
        ? Object.keys(rawNotes).map(function(k) {
            var n = rawNotes[k] || {};
            return { id: k, text: n.text, at: n.at, by: n.by };
          })
        : []);
    notesArr.sort(function(a, b) { return (a.at || '').localeCompare(b.at || ''); });
    var notesListHtml = '';
    notesArr.forEach(function(n) {
      notesListHtml += '<div class="order-note">' +
        '<div class="order-note-time">' + formatOrderDateTime(n.at) + '</div>' +
        '<div class="order-note-text">' + esc(n.text) + '</div>' +
      '</div>';
    });
    var notesHtml = '<div class="order-detail-section">' +
      '<div class="order-detail-section-title">Notes</div>' +
      (notesListHtml ? '<div class="order-notes-list">' + notesListHtml + '</div>' : '') +
      '<div class="order-note-input">' +
        '<input type="text" id="orderNoteInput" placeholder="Add a note...">' +
        '<button class="btn btn-secondary" onclick="addOrderNote(\'' + esc(orderId) + '\')">Add</button>' +
      '</div>' +
    '</div>';

    // Production requests for this order
    var orderRequests = Object.keys(productionRequests).filter(function(k) {
      return productionRequests[k].orderId === orderId;
    });
    var productionRequestsHtml = '';
    if (orderRequests.length > 0) {
      var prRows = '';
      orderRequests.forEach(function(k) {
        var pr = productionRequests[k];
        // Skip gift card production requests (shouldn't exist, but filter just in case)
        if (pr.productId && pr.productId.startsWith('gift-card')) return;
        var prStatus = pr.status || 'pending';
        var prActions = '';
        if (prStatus === 'pending') {
          prActions = '<button class="btn btn-secondary" style="font-size:0.72rem;padding:4px 10px;" onclick="openFulfillModal(\'' + esc(k) + '\', \'' + esc(orderId) + '\')">Fulfill</button>' +
            '<button class="btn btn-primary" style="font-size:0.72rem;padding:4px 10px;" onclick="openAssignToJobModal(\'' + esc(k) + '\')">Assign to Job</button>';
        } else if (prStatus === 'assigned') {
          var jobName = pr.jobId && productionJobs[pr.jobId] ? productionJobs[pr.jobId].name : 'Job';
          prActions = '<a href="#" onclick="switchTab(\'production\');viewProductionJob(\'' + esc(pr.jobId) + '\');return false;" style="font-size:0.72rem;color:var(--teal);">View ' + esc(jobName) + '</a>';
        } else if (prStatus === 'fulfilled') {
          prActions = '<span style="font-size:0.72rem;color:var(--warm-gray);">Fulfilled' + (pr.fulfilledBy ? ' by ' + esc(pr.fulfilledBy) : '') + '</span>';
        }
        // W3.6 (D-FIN-W3-6): per-job burdened labor cell. Filled async via
        // _w3FillOrderLaborCells() after detail renders. Only meaningful when
        // pr.jobId is set; otherwise renders 'No job'.
        var laborCellId = 'w3LaborCell_' + esc(k);
        var laborCell = pr.jobId
          ? '<span id="' + laborCellId + '" data-w3-job-id="' + esc(pr.jobId) + '" ' +
            'style="font-size:0.72rem;color:var(--warm-gray);">Loading labor…</span>'
          : '<span style="font-size:0.72rem;color:var(--warm-gray);">No job</span>';
        prRows += '<div class="production-request-row">' +
          '<div>' +
            '<strong>' + esc(pr.productName || '') + '</strong>' +
            (pr.options ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">(' + esc(Object.values(pr.options).join(', ')) + ')</span>' : '') +
            ' x' + (pr.qty || 1) +
            '<div style="margin-top:4px;">' + laborCell + '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span class="status-badge" style="' + prodRequestBadgeStyle(prStatus) + '">' + prStatus.replace('-', ' ') + '</span>' +
            prActions +
          '</div>' +
        '</div>';
      });
      productionRequestsHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Production Requests</div>' +
        prRows +
        '<div id="w3OrderLaborBanner_' + esc(orderId) + '"></div>' +
      '</div>';
    }

    // Email History section (loaded async)
    var emailSectionId = 'orderEmailSection_' + orderId;
    var emailHtml = '<div class="order-detail-section" id="' + emailSectionId + '">' +
      '<div class="order-detail-section-title">Email History</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray-light);padding:4px 0;">Loading...</div>' +
    '</div>';

    // Manual send buttons — contextual based on order status
    var emailSendHtml = '<div class="order-email-send-section">';
    var sendBtns = '';
    if ((status === 'confirmed' || status === 'building' || status === 'pack' || status === 'packing' || status === 'packed') && o.email) {
      sendBtns += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="sendOrderEmailFromDetail(\'' + esc(orderId) + '\', \'confirmed\')">Send Confirmation</button>';
    }
    if ((status === 'shipped' || status === 'delivered') && o.email && o.tracking && o.tracking.trackingNumber) {
      sendBtns += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="sendOrderEmailFromDetail(\'' + esc(orderId) + '\', \'shipped\')">Send Shipping Notification</button>';
    }
    if (o.email) {
      sendBtns += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="toggleAdhocEmailForm(\'' + esc(orderId) + '\')">Send Custom Email</button>';
    }
    if (sendBtns) {
      emailSendHtml += '<div class="order-email-send-btns">' + sendBtns + '</div>';
    }
    emailSendHtml += '<div id="adhocEmailForm_' + orderId + '" style="display:none;" class="order-adhoc-form">' +
      '<input type="text" id="adhocSubject_' + orderId + '" placeholder="Subject">' +
      '<textarea id="adhocBody_' + orderId + '" placeholder="Message body (plain text — will be wrapped in your branded template)"></textarea>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="sendAdhocOrderEmail(\'' + esc(orderId) + '\')">Send</button>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="toggleAdhocEmailForm(\'' + esc(orderId) + '\')">Cancel</button>' +
      '</div>' +
    '</div>';
    emailSendHtml += '</div>';

    // Prefer the MastNavStack label (set by the pushing context, e.g. a
    // customer detail's Orders tab) so the back button reads "Back to <name>".
    var stackLabel = (window.MastNavStack && MastNavStack.size() > 0 && typeof MastNavStack.label === 'function') ? MastNavStack.label() : null;
    var backLabel = stackLabel
      ? 'Back to ' + stackLabel
      : (_viewOrderReturnRoute ? 'Back to ' + _viewOrderReturnRoute.charAt(0).toUpperCase() + _viewOrderReturnRoute.slice(1) : 'Back to Orders');
    detailEl.innerHTML = '<button class="detail-back" onclick="backToOrders()">&#8592; ' + backLabel + '</button>' +
      '<div class="order-detail-header">' +
        '<div>' +
          '<div class="order-detail-title">' + num + (o.source === 'etsy' ? ' <span class="status-badge" style="' + etsySourceBadgeStyle() + '">Etsy</span>' : '') + '</div>' +
          '<div class="order-detail-meta">' +
            '<span class="status-badge pill" style="' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span> &middot; ' +
            formatOrderDateTime(o.placedAt || o.pendingPaymentAt) + ' &middot; ' + esc(o.email || '') +
          '</div>' +
        '</div>' +
        '<div class="order-actions">' + actionsHtml + '</div>' +
      '</div>' +
      // MastFlow workflow header — populated async by _initOrderWorkflowHeader.
      // This is now the only workflow surface — the legacy renderOrderProgress
      // stepper + status-specific inline action buttons have been removed.
      // Forward motion (Confirm Order → Build → Pack → Ship → Deliver) goes
      // through the Advance button below; specialized dialogs (triage,
      // shipping) are intercepted onAdvance for the relevant target phases.
      '<div id="orderWorkflowHeader" style="margin:14px 0;font-size:0.85rem;color:var(--warm-gray);">Loading workflow…</div>' +
      '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Items</div>' +
        itemsHtml +
      '</div>' +
      '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Summary</div>' +
        summaryHtml +
      '</div>' +
      '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Addresses</div>' +
        '<div class="order-address-grid">' +
          '<div><strong style="font-size:0.78rem;color:var(--warm-gray-light);">SHIPPING</strong>' + shipHtml + '</div>' +
          '<div><strong style="font-size:0.78rem;color:var(--warm-gray-light);">BILLING</strong>' + billHtml + '</div>' +
        '</div>' +
      '</div>' +
      timelineHtml +
      paymentHtml +
      invoiceHtml +
      etsyHtml +
      trackingHtml +
      ffLogHtml +
      productionRequestsHtml +
      emailHtml +
      emailSendHtml +
      notesHtml;

    // Load email history async
    loadOrderEmails(orderId, emailSectionId);
    // W3.6: fill per-job burdened-labor cells async (no-throw).
    try { _w3FillOrderLaborCells(orderId, o); } catch (_) {}
    // MastFlow workflow header — second engine surface (after commissions).
    _initOrderWorkflowHeader(orderId);
  }

  // ===== MastFlow integration for orders (pickship workflow) =====
  var _mfOrderResolversRegistered = false;
  var _mfOrderActiveSubscription = null;  // { orderId, off }

  function _initOrderWorkflowHeader(orderId) {
    if (!window.MastAdmin || typeof MastAdmin.loadModule !== 'function') return;
    // Sequential: engine first (it must register window.MastFlow before the
    // spec's IIFE checks for it), then the spec.
    MastAdmin.loadModule('workflowEngine').then(function() {
      return MastAdmin.loadModule('pickshipWorkflow');
    }).then(function() {
      if (!window.MastFlow) return;
      _registerOrderTargetResolvers();
      _subscribeOrderRecord(orderId);
      _renderOrderWorkflowHeaderInto(orderId);
    }).catch(function(err) {
      console.error('[orders] MastFlow init failed:', err);
      var host = document.getElementById('orderWorkflowHeader');
      if (host) host.innerHTML = '<span style="color:var(--danger,#b81d1d);">Workflow header failed to load.</span>';
    });
  }

  function _registerOrderTargetResolvers() {
    if (_mfOrderResolversRegistered || !window.MastFlow) return;
    var SECTION_TARGETS = {
      'detail-customer': 'order-detail-meta',
      'detail-items': 'order-items',
      'detail-payment': 'order-summary',
      'detail-shipping': 'order-shipping',
      'buy-labels': null  // navigates to fulfillment buy-labels route
    };
    Object.keys(SECTION_TARGETS).forEach(function(tid) {
      MastFlow.registerTargetResolver('pickship', tid, function() {
        if (tid === 'buy-labels') {
          if (typeof navigateTo === 'function') navigateTo('ship');
          return;
        }
        // Scroll to the closest section header matching the target.
        var sectionTitles = document.querySelectorAll('.order-detail-section-title');
        for (var i = 0; i < sectionTitles.length; i++) {
          var t = (sectionTitles[i].textContent || '').toLowerCase();
          if ((tid === 'detail-items' && t.indexOf('items') !== -1) ||
              (tid === 'detail-payment' && t.indexOf('summary') !== -1) ||
              (tid === 'detail-shipping' && t.indexOf('address') !== -1) ||
              (tid === 'detail-customer' && t.indexOf('order') !== -1)) {
            sectionTitles[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
            return;
          }
        }
      });
    });
    _mfOrderResolversRegistered = true;
  }

  function _subscribeOrderRecord(orderId) {
    if (_mfOrderActiveSubscription && _mfOrderActiveSubscription.off) {
      try { _mfOrderActiveSubscription.off(); } catch (e) {}
    }
    var off = MastDB.subscribe('admin/orders/' + orderId, function(snapValue) {
      if (!snapValue) return;
      var prev = orders[orderId] || {};
      orders[orderId] = Object.assign({}, prev, snapValue, { _key: orderId });
      _renderOrderWorkflowHeaderInto(orderId);
    });
    _mfOrderActiveSubscription = { orderId: orderId, off: off };
  }

  function _renderOrderWorkflowHeaderInto(orderId) {
    var o = orders[orderId];
    if (!o || !window.MastFlow) return;
    o.id = orderId;
    var host = document.getElementById('orderWorkflowHeader');
    if (!host) return;
    MastFlow.renderHeader('pickship', o, {
      onAdvance: function(targetPhaseKey) {
        // Intercept specific transitions to open the existing rich-capture
        // dialogs instead of doing a plain status write. The dialogs write
        // their fields directly (fulfillment, tracking, label, etc.); the
        // MastFlow record subscription picks up the status change and
        // re-renders. This keeps existing complex flows intact while
        // making the engine the operator's primary surface.
        //   - confirmed: triage dialog drives per-item inventory decision
        //     and writes o.fulfillment.
        //   - shipped:  ship dialog captures tracking + label + carrier.
        if (targetPhaseKey === 'confirmed' && !o.fulfillment && typeof openTriageDialog === 'function') {
          openTriageDialog(orderId);
          return;
        }
        if (targetPhaseKey === 'shipped' && !(o.shipping && (o.shipping.trackingNumber || o.shipping.tracking_number)) && typeof openSimpleShipDialog === 'function') {
          openSimpleShipDialog(orderId);
          return;
        }
        _doOrderTransition(orderId, targetPhaseKey, { expectedFromPhase: o.__workflow && o.__workflow.phase || null });
      },
      onBack: function(targetPhaseKey) {
        _doOrderTransition(orderId, targetPhaseKey, { expectedFromPhase: o.__workflow && o.__workflow.phase || null });
      },
      onBranch: function(branchChoiceKey, entryPhaseKey) {
        _doOrderTransition(orderId, entryPhaseKey, {
          expectedFromPhase: o.__workflow && o.__workflow.phase || null,
          branchChoice: branchChoiceKey
        });
      },
      onForce: function() {
        var reason = window.prompt('Force-advance reason (will be audited):');
        if (!reason) return;
        MastFlow.evaluate('pickship', o).then(function(ev) {
          var target = ev.nextPhases[0];
          if (!target) { showToast('No next phase to force.'); return; }
          _doOrderTransition(orderId, target, {
            expectedFromPhase: ev.currentPhase ? ev.currentPhase.key : null,
            force: true, reason: reason
          });
        });
      }
    }).then(function(res) {
      host.innerHTML = res.html;
      // Deep-link: ?focus=<phaseKey> scrolls the header into view + pulses
      // the target step (e.g. from a "stuck in Picked" fulfillment-queue link).
      var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
      if (rp && rp.focus) MastFlow.focusPhase('orderWorkflowHeader', rp.focus);
    }).catch(function(err) {
      console.error('[orders] renderHeader failed:', err);
      host.innerHTML = '<span style="color:var(--danger,#b81d1d);">Workflow header error.</span>';
    });
  }

  function _doOrderTransition(orderId, targetPhaseKey, opts) {
    var o = orders[orderId];
    if (!o) return;
    o.id = orderId;
    opts = Object.assign({ recordId: orderId }, opts || {});
    MastFlow.transition('pickship', o, targetPhaseKey, opts).then(function(res) {
      showToast('Order advanced to ' + res.to);
      emitTestingEvent('orderPhase', { from: res.from, to: res.to, forced: !!opts.force });
      renderOrderDetail(orderId);
    }).catch(function(err) {
      if (err.code === 'STALE_STATE') {
        showToast('Another operator changed this order — refreshed.', true);
        MastDB.orders.get(orderId).then(function(fresh) {
          if (fresh) orders[orderId] = Object.assign({}, fresh, { _key: orderId });
          renderOrderDetail(orderId);
        });
      } else if (err.code === 'REQUIREMENTS_UNMET') {
        showToast('Requirements not met — see checklist.', true);
      } else if (err.code === 'BRANCH_CHOICE_REQUIRED') {
        showToast('Choose a fulfillment method first.', true);
      } else if (err.code === 'SPEC_MISMATCH') {
        showToast('Workflow updated — manual review needed.', true);
      } else {
        console.error('[orders] transition failed:', err);
        showToast('Transition failed: ' + (err.message || err), true);
      }
    });
  }

  // W3.6 — Per-job burdened labor surface for order detail.
  // For each Production Request with a jobId, look up the burden allocated to
  // that job in the order's period window and render "Base | Burdened | Δ | Source"
  // in the production-request row. When all jobs roll up to _overhead only,
  // surface the per-job info banner (time-clock lacks jobId today).
  async function _w3FillOrderLaborCells(orderId, order) {
    if (!window.MastFinanceW3) return;
    var W3 = window.MastFinanceW3;
    var orderDate = (order && (order.placedAt || order.createdAt || order.confirmedAt)) || null;
    if (!orderDate) return;
    var dateStr = String(orderDate).slice(0, 10);
    // Use a 90-day window ending at the order date to give us coverage of the
    // jobs that produced the order even when work spanned earlier periods.
    var d = new Date(dateStr + 'T00:00:00.000Z');
    var startDate = new Date(d.getTime() - 90 * 86400000).toISOString().slice(0, 10);
    var bannerEl = document.getElementById('w3OrderLaborBanner_' + orderId);
    var cells = document.querySelectorAll('[id^="w3LaborCell_"][data-w3-job-id]');
    if (!cells || !cells.length) {
      if (bannerEl) bannerEl.innerHTML = '';
      return;
    }
    var anyAllocated = false;
    var anyOverheadOnly = false;
    var totalAllocated = 0;
    for (var i = 0; i < cells.length; i++) {
      var cell = cells[i];
      var jobId = cell.getAttribute('data-w3-job-id');
      if (!jobId) continue;
      try {
        var jb = await W3.getJobBurden(jobId, startDate, dateStr);
        if (!jb || !jb.allocatedBurden) {
          cell.innerHTML = '<span style="color:var(--warm-gray);">No burdened labor recorded</span>';
          anyOverheadOnly = true;
          continue;
        }
        anyAllocated = true;
        totalAllocated += jb.allocatedBurden;
        var chip = W3.renderSourceTagChip(jb.dominantSource,
          jb.dominantSource === 'mixed' ? 'LOW' : null);
        cell.innerHTML =
          '<span style="font-size:0.72rem;color:var(--warm-gray);">Burdened labor (job):</span> ' +
          '<strong style="font-size:0.78rem;">$' + (jb.allocatedBurden / 100).toFixed(2) + '</strong> ' +
          chip;
      } catch (err) {
        cell.innerHTML = '<span style="color:var(--warm-gray);">Labor unavailable</span>';
      }
    }
    if (!bannerEl) return;
    if (!anyAllocated && cells.length > 0) {
      bannerEl.innerHTML = W3.perJobOverheadBanner();
    } else if (anyOverheadOnly && anyAllocated) {
      bannerEl.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">' +
        'Some jobs on this order have no per-job labor attribution — those hours are absorbed in ' +
        '<em>Fixed Overhead</em> rather than the per-job line.</div>';
    } else {
      bannerEl.innerHTML = '';
    }
  }

  // ============================================================
  // Order Email Helpers
  // ============================================================

  function loadOrderEmails(orderId, containerId) {
    MastDB.emails.queryByOrder(orderId).then(function(snap) {
      var container = document.getElementById(containerId);
      if (!container) return;
      var emails = [];
      // Accept Firestore-shape map ({docId: emailData}, MastDB current),
      // legacy RTDB DataSnapshot (snap.forEach(child => child.val()/child.key)),
      // or array fallback. Mirrors the notes shape-fix pattern (PR #4).
      if (snap && typeof snap.forEach === 'function' && typeof snap.val === 'function' && !Array.isArray(snap)) {
        // Legacy Firebase RTDB DataSnapshot
        snap.forEach(function(child) {
          var e = child.val() || {};
          e._key = child.key;
          emails.push(e);
        });
      } else if (Array.isArray(snap)) {
        snap.forEach(function(e, i) {
          if (e && typeof e === 'object') {
            if (!e._key) e._key = 'idx_' + i;
            emails.push(e);
          }
        });
      } else if (snap && typeof snap === 'object') {
        Object.keys(snap).forEach(function(key) {
          var e = snap[key];
          if (e && typeof e === 'object') {
            e._key = key;
            emails.push(e);
          }
        });
      }
      emails.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

      if (emails.length === 0) {
        container.innerHTML = '<div class="order-detail-section-title">Email History</div>' +
          '<div style="font-size:0.85rem;color:var(--warm-gray-light);padding:4px 0;">No emails sent for this order yet.</div>';
        return;
      }

      var entriesHtml = '';
      emails.forEach(function(em) {
        var statusColor = em.status === 'sent' ? 'var(--teal)' : '#EF5350';
        var statusIcon = em.status === 'sent' ? '&#10003;' : '&#10007;';
        var typeLabel = (em.emailType || 'unknown').replace(/^order_/, '').replace(/_/g, ' ');
        typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);

        entriesHtml += '<div class="order-email-entry" onclick="toggleEmailDetail(\'' + esc(em._key) + '\')">' +
          '<div class="order-email-header">' +
            '<span class="order-email-subject">' + esc(em.subject || '(no subject)') + '</span>' +
            '<span class="status-badge" style="font-size:0.72rem;padding:2px 8px;background:' + (em.status === 'sent' ? 'rgba(46,125,50,0.2)' : 'rgba(198,40,40,0.2)') + ';color:' + statusColor + ';border:1px solid ' + (em.status === 'sent' ? 'rgba(46,125,50,0.35)' : 'rgba(198,40,40,0.35)') + ';">' + statusIcon + ' ' + esc(em.status || '') + '</span>' +
          '</div>' +
          '<div class="order-email-meta">' +
            '<span>' + esc(typeLabel) + '</span>' +
            '<span>&middot;</span>' +
            '<span>' + esc(em.to || '') + '</span>' +
            '<span>&middot;</span>' +
            '<span>' + formatOrderDateTime(em.createdAt) + '</span>' +
            (em.provider ? '<span>&middot;</span><span>' + esc(em.provider) + '</span>' : '') +
          '</div>' +
          '<div id="emailDetail_' + em._key + '" class="order-email-expanded" style="display:none;">' +
            '<div style="margin-bottom:6px;"><strong>From:</strong> ' + esc(em.from || '') + '</div>' +
            '<div style="margin-bottom:6px;"><strong>To:</strong> ' + esc(em.to || '') + '</div>' +
            (em.error ? '<div style="margin-bottom:6px;color:#EF5350;"><strong>Error:</strong> ' + esc(em.error) + '</div>' : '') +
            (em.htmlSnapshot ? '<iframe id="emailPreview_' + em._key + '" sandbox="" style="height:300px;" onload="injectEmailPreview(\'' + esc(em._key) + '\')"></iframe>' : '<div style="color:var(--warm-gray-light);font-size:0.78rem;">No HTML preview available.</div>') +
            '<div class="order-email-actions">' +
              '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 10px;" onclick="event.stopPropagation();resendOrderEmail(\'' + esc(em._key) + '\', \'' + esc(orderId) + '\')">Resend</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      });

      container.innerHTML = '<div class="order-detail-section-title">Email History (' + emails.length + ')</div>' + entriesHtml;

      // Store email snapshots for preview injection
      emails.forEach(function(em) {
        if (em.htmlSnapshot) {
          container.setAttribute('data-html-' + em._key, em.htmlSnapshot);
        }
      });
    }).catch(function(err) {
      var container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = '<div class="order-detail-section-title">Email History</div>' +
          '<div style="font-size:0.85rem;color:#EF5350;padding:4px 0;">Failed to load emails: ' + esc(err.message) + '</div>';
      }
    });
  }

  function toggleEmailDetail(emailKey) {
    var el = document.getElementById('emailDetail_' + emailKey);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  function injectEmailPreview(emailKey) {
    var iframe = document.getElementById('emailPreview_' + emailKey);
    if (!iframe) return;
    // Find the stored HTML from parent container
    var parent = iframe.closest('.order-detail-section');
    if (!parent) return;
    var html = parent.getAttribute('data-html-' + emailKey);
    if (!html) return;
    var doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
  }

  async function sendOrderEmailFromDetail(orderId, emailType) {
    try {
      showToast('Sending ' + emailType + ' email...');
      var result = await firebase.functions().httpsCallable('testOrderEmail')({
        orderId: orderId,
        emailType: emailType,
        tenantId: MastDB.tenantId()
      });
      showToast('Email sent to ' + result.data.sentTo);
      // Refresh email history
      var sectionId = 'orderEmailSection_' + orderId;
      setTimeout(function() { loadOrderEmails(orderId, sectionId); }, 2000);
    } catch (err) {
      showToast('Failed to send email: ' + (err.message || err), true);
    }
  }

  async function resendOrderEmail(emailKey, orderId) {
    try {
      var em = await MastDB.emails.get(emailKey);
      if (!em) { showToast('Email log entry not found', true); return; }

      showToast('Resending email...');
      if (em.emailType && em.emailType.startsWith('order_') && em.emailType !== 'order_custom') {
        var type = em.emailType.replace('order_', '');
        await firebase.functions().httpsCallable('testOrderEmail')({
          orderId: orderId,
          emailType: type,
          tenantId: MastDB.tenantId()
        });
      } else {
        // For custom or unknown types, re-trigger via sendCustomOrderEmail
        await firebase.functions().httpsCallable('sendCustomOrderEmail')({
          orderId: orderId,
          subject: em.subject || 'Re-sent email',
          body: '(This is a re-send of a previous email)',
          tenantId: MastDB.tenantId()
        });
      }
      showToast('Email re-sent successfully');
      var sectionId = 'orderEmailSection_' + orderId;
      setTimeout(function() { loadOrderEmails(orderId, sectionId); }, 2000);
    } catch (err) {
      showToast('Failed to resend: ' + (err.message || err), true);
    }
  }

  function toggleAdhocEmailForm(orderId) {
    var el = document.getElementById('adhocEmailForm_' + orderId);
    if (!el) return;
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
  }

  async function sendAdhocOrderEmail(orderId) {
    var subject = document.getElementById('adhocSubject_' + orderId);
    var body = document.getElementById('adhocBody_' + orderId);
    if (!subject || !body) return;
    var subjectVal = subject.value.trim();
    var bodyVal = body.value.trim();
    if (!subjectVal || !bodyVal) {
      showToast('Subject and body are required', true);
      return;
    }

    try {
      showToast('Sending custom email...');
      var result = await firebase.functions().httpsCallable('sendCustomOrderEmail')({
        orderId: orderId,
        subject: subjectVal,
        body: bodyVal,
        tenantId: MastDB.tenantId()
      });
      showToast('Custom email sent to ' + result.data.sentTo);
      subject.value = '';
      body.value = '';
      toggleAdhocEmailForm(orderId);
      var sectionId = 'orderEmailSection_' + orderId;
      setTimeout(function() { loadOrderEmails(orderId, sectionId); }, 2000);
    } catch (err) {
      showToast('Failed to send: ' + (err.message || err), true);
    }
  }

  // ============================================================
  // Invoice Management
  // ============================================================

  function isOrderInvoiceable(o) {
    var terms = (o.paymentTerms || '').toLowerCase();
    var isNetTerms = terms === 'net15' || terms === 'net30' || terms === 'net60';
    // W2c — wholesale orders from checkout.js write the discriminator as
    // `type: 'wholesale'` (not `orderType`), so the original gate was always
    // false on real wholesale orders and the Generate Invoice button never
    // appeared. Accept all three field forms; no schema migration needed.
    var isWholesale = o.isWholesale === true || o.orderType === 'wholesale' || o.type === 'wholesale';
    var status = o.invoiceStatus;
    var canGenerate = !status || status === 'draft';
    return (isNetTerms || isWholesale) && canGenerate;
  }

  function getInvoiceDueDays(o) {
    var terms = (o.paymentTerms || '').toLowerCase();
    if (terms === 'net15') return 15;
    if (terms === 'net60') return 60;
    return 30;
  }

  function computeInvoiceDueDate(o) {
    var days = getInvoiceDueDays(o);
    var d = new Date();
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function getEffectiveInvoiceStatus(o) {
    var status = o.invoiceStatus;
    if (status === 'sent' && o.invoiceDueDate) {
      var dueMs = new Date(o.invoiceDueDate + 'T00:00:00Z').getTime();
      if (Date.now() > dueMs) return 'overdue';
    }
    return status || null;
  }

  function invoiceStatusBadgeStyle(status) {
    var m = {
      draft:   'background:rgba(107,114,128,0.2);color:#9ca3af;border:1px solid rgba(107,114,128,0.35);',
      sent:    'background:rgba(59,130,246,0.2);color:#60a5fa;border:1px solid rgba(59,130,246,0.35);',
      paid:    'background:rgba(34,197,94,0.2);color:#4ade80;border:1px solid rgba(34,197,94,0.35);',
      overdue: 'background:rgba(220,38,38,0.2);color:#f87171;border:1px solid rgba(220,38,38,0.35);'
    };
    return m[status] || m.draft;
  }

  async function generateInvoice(orderId) {
    // Allow callers outside the orders module (e.g. wholesale.js viewWholesaleOrder)
    // to invoke this without first populating the orders cache. Fetch from MastDB
    // when missing. Only re-render the orders-tab detail when we were actually
    // operating against the orders-tab cached copy; otherwise the caller handles
    // its own re-render.
    var o = orders[orderId];
    var fromOrdersCache = !!o;
    if (!o) {
      try {
        var snap = await MastDB.orders.get(orderId);
        o = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      } catch (_e) {}
    }
    if (!o) { showToast('Order not found', true); return; }
    try {
      var now = new Date().toISOString();
      var year = new Date().getFullYear();

      var configRaw = await MastDB.get('admin/config/invoicing');
      var config = (configRaw && typeof configRaw.val === 'function') ? (configRaw.val() || {}) : (configRaw || {});
      var seq = typeof config.invoiceSequence === 'number' ? config.invoiceSequence : 0;
      var nextSeq = seq + 1;
      var invoiceNumber = 'INV-' + year + '-' + String(nextSeq).padStart(4, '0');

      if (config && Object.keys(config).length > 0) {
        await MastDB.update('admin/config/invoicing', { invoiceSequence: nextSeq });
      } else {
        await MastDB.set('admin/config/invoicing', { invoiceSequence: nextSeq });
      }

      var dueDate = computeInvoiceDueDate(o);
      await MastDB.orders.update(orderId, {
        invoiceStatus: 'draft',
        invoiceNumber: invoiceNumber,
        invoiceDueDate: dueDate,
        invoiceIssuedAt: now,
        updatedAt: now
      });
      o.invoiceStatus = 'draft';
      o.invoiceNumber = invoiceNumber;
      o.invoiceDueDate = dueDate;
      o.invoiceIssuedAt = now;

      showToast('Invoice ' + invoiceNumber + ' generated');
      if (fromOrdersCache) renderOrderDetail(orderId);
    } catch (err) {
      showToast('Failed to generate invoice: ' + err.message, true);
    }
  }

  async function sendInvoice(orderId) {
    var o = orders[orderId];
    if (!o || !o.invoiceNumber) return;
    try {
      showToast('Sending invoice ' + o.invoiceNumber + '...');
      var now = new Date().toISOString();

      // Square adapter: if the tenant uses Square as payment processor, route through
      // Square Invoices API so the customer receives a Square-hosted payment link.
      // Falls back to Mast-native email if Square isn't configured or the call fails.
      var processor = 'square';
      try { processor = (await MastDB.get('config/paymentProcessor')) || 'square'; } catch (_) {}

      if (processor === 'square') {
        try {
          var sqResult = await firebase.functions().httpsCallable('createSquareInvoice')({
            tenantId: MastDB.tenantId(),
            orderId: orderId
          });
          if (sqResult.data && sqResult.data.success) {
            o.invoiceStatus = 'sent';
            o.invoiceSentAt = now;
            o.squareInvoiceId = sqResult.data.squareInvoiceId || null;
            o.squareInvoiceUrl = sqResult.data.squareInvoiceUrl || null;
            showToast('Invoice ' + o.invoiceNumber + ' sent via Square — customer will receive a payment link');
            renderOrderDetail(orderId);
            return;
          }
        } catch (sqErr) {
          console.warn('Square invoice send failed, falling back to email:', sqErr.message);
        }
      }

      // Mast-native email fallback
      if (o.email) {
        try {
          await firebase.functions().httpsCallable('testOrderEmail')({
            orderId: orderId,
            emailType: 'invoice',
            tenantId: MastDB.tenantId()
          });
        } catch (emailErr) {
          console.warn('Invoice email send failed (non-fatal):', emailErr.message);
        }
      }

      await MastDB.orders.update(orderId, {
        invoiceStatus: 'sent',
        invoiceSentAt: now,
        updatedAt: now
      });
      o.invoiceStatus = 'sent';
      o.invoiceSentAt = now;

      showToast('Invoice ' + o.invoiceNumber + ' sent to ' + (o.email || 'customer'));
      renderOrderDetail(orderId);
    } catch (err) {
      showToast('Failed to send invoice: ' + err.message, true);
    }
  }

  async function markOrderInvoicePaid(orderId) {
    var o = orders[orderId];
    if (!o) return;
    try {
      var now = new Date().toISOString();
      var totalCents = Math.round((o.total || 0) * 100);
      await MastDB.orders.update(orderId, {
        invoiceStatus: 'paid',
        invoicePaidAt: now,
        invoicePaidAmount: totalCents,
        updatedAt: now
      });
      o.invoiceStatus = 'paid';
      o.invoicePaidAt = now;
      o.invoicePaidAmount = totalCents;
      showToast('Invoice marked as paid');
      renderOrderDetail(orderId);
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
  }

  async function resendInvoice(orderId) {
    var o = orders[orderId];
    if (!o || !o.email || !o.invoiceNumber) return;
    try {
      showToast('Resending invoice ' + o.invoiceNumber + '...');
      await firebase.functions().httpsCallable('testOrderEmail')({
        orderId: orderId,
        emailType: 'invoice',
        tenantId: MastDB.tenantId()
      });
      showToast('Invoice ' + o.invoiceNumber + ' resent to ' + o.email);
    } catch (err) {
      showToast('Failed to resend: ' + err.message, true);
    }
  }

  function buildInvoiceSection(orderId) {
    var o = orders[orderId];
    if (!o) return '';

    var effectiveStatus = getEffectiveInvoiceStatus(o);

    if (!effectiveStatus) return '';

    var h = '<div class="order-detail-section">';
    h += '<div class="order-detail-section-title">Invoice</div>';

    if (effectiveStatus === 'draft') {
      // Full preview panel
      h += '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:16px;margin-bottom:12px;">';

      // Header row
      h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:8px;">';
      h += '<div>';
      h += '<div style="font-size:1.15rem;font-weight:700;">' + esc(o.invoiceNumber || '') + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);">Issue Date: ' + formatOrderDate(o.invoiceIssuedAt || new Date().toISOString()) + '</div>';
      h += '<div style="font-size:0.78rem;color:var(--warm-gray-light);">Due Date: ' + esc(o.invoiceDueDate || '—') + '</div>';
      h += '</div>';
      h += '<span class="status-badge pill" style="' + invoiceStatusBadgeStyle('draft') + '">Draft</span>';
      h += '</div>';

      // Bill To
      var ship = o.shipping || {};
      h += '<div style="margin-bottom:14px;">';
      h += '<div style="font-size:0.72rem;color:var(--warm-gray-light);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Bill To</div>';
      h += '<div style="font-size:0.85rem;">' + esc(ship.name || o.customerName || o.email || '') + '</div>';
      if (o.email) h += '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(o.email) + '</div>';
      if (ship.address1) {
        h += '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(ship.address1) + (ship.address2 ? ', ' + esc(ship.address2) : '') + '</div>';
        h += '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(ship.city || '') + ', ' + esc(ship.state || '') + ' ' + esc(ship.zip || '') + '</div>';
      }
      h += '</div>';

      // Line items
      h += '<div style="border-top:1px solid rgba(255,255,255,0.08);padding-top:12px;margin-bottom:12px;">';
      h += '<div style="display:flex;gap:8px;margin-bottom:6px;font-size:0.72rem;color:var(--warm-gray-light);text-transform:uppercase;letter-spacing:0.5px;">';
      h += '<div style="flex:1;">Item</div><div style="width:50px;text-align:center;">Qty</div><div style="width:70px;text-align:right;">Unit</div><div style="width:70px;text-align:right;">Total</div>';
      h += '</div>';
      (o.items || []).forEach(function(item) {
        var qty = item.qty || 1;
        var unitCents = item.priceCents || 0;
        var lineCents = unitCents * qty;
        h += '<div style="display:flex;gap:8px;padding:4px 0;font-size:0.85rem;border-bottom:1px solid rgba(255,255,255,0.05);">';
        h += '<div style="flex:1;">' + esc(item.name) + '</div>';
        h += '<div style="width:50px;text-align:center;">' + qty + '</div>';
        h += '<div style="width:70px;text-align:right;">$' + (unitCents / 100).toFixed(2) + '</div>';
        h += '<div style="width:70px;text-align:right;">$' + (lineCents / 100).toFixed(2) + '</div>';
        h += '</div>';
      });
      h += '</div>';

      // Totals
      h += '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:3px;margin-bottom:14px;">';
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Subtotal: $' + (o.subtotal || 0).toFixed(2) + '</div>';
      if (o.tax) h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Tax: $' + o.tax.toFixed(2) + '</div>';
      if (o.shippingCost) h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Shipping: $' + o.shippingCost.toFixed(2) + '</div>';
      h += '<div style="font-weight:700;">Total: $' + (o.total || 0).toFixed(2) + '</div>';
      h += '</div>';

      // Payment instructions
      h += '<div style="font-size:0.78rem;color:var(--warm-gray);border-top:1px solid rgba(255,255,255,0.08);padding-top:10px;">Payment due by ' + esc(o.invoiceDueDate || '—') + '</div>';

      h += '</div>';

      // Action buttons
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
      h += '<button class="btn btn-primary" onclick="sendInvoice(\'' + esc(orderId) + '\')">Send Invoice</button>';
      h += '<button class="btn btn-secondary" onclick="generateInvoice(\'' + esc(orderId) + '\')">Regenerate</button>';
      h += '</div>';

    } else {
      // Summary for sent / overdue / paid
      var rows = '';
      rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Invoice #</span><span style="font-weight:600;">' + esc(o.invoiceNumber || '—') + '</span></div>';
      rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Status</span><span class="status-badge pill" style="' + invoiceStatusBadgeStyle(effectiveStatus) + '">' + effectiveStatus + '</span></div>';
      if (o.invoiceIssuedAt) rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Issued</span><span>' + formatOrderDate(o.invoiceIssuedAt) + '</span></div>';
      if (o.invoiceSentAt)  rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Sent</span><span>' + formatOrderDate(o.invoiceSentAt) + '</span></div>';
      if (o.invoiceDueDate) rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Due Date</span><span>' + esc(o.invoiceDueDate) + '</span></div>';
      if (o.invoicePaidAt)  rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Paid</span><span style="color:#4ade80;">' + formatOrderDate(o.invoicePaidAt) + '</span></div>';
      rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Amount</span><span>$' + (o.total || 0).toFixed(2) + '</span></div>';
      if (o.squareInvoiceId) {
        var sqLinkHtml = o.squareInvoiceUrl
          ? '<a href="' + esc(o.squareInvoiceUrl) + '" target="_blank" rel="noopener" style="color:var(--teal);">View on Square ↗</a>'
          : 'Square Invoice';
        rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Via Square</span><span style="font-size:0.85rem;">' + sqLinkHtml + '</span></div>';
      }

      h += rows;
      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;">';
      if (effectiveStatus !== 'paid') {
        h += '<button class="btn btn-primary" onclick="markOrderInvoicePaid(\'' + esc(orderId) + '\')">Mark as Paid</button>';
      }
      if ((effectiveStatus === 'sent' || effectiveStatus === 'overdue') && !o.squareInvoiceId) {
        h += '<button class="btn btn-secondary" onclick="resendInvoice(\'' + esc(orderId) + '\')">Resend Invoice</button>';
      }
      h += '<a class="btn btn-secondary" href="#" onclick="event.preventDefault();navigateTo(\'finance-ar\')">View in Finance AR</a>';
      h += '</div>';
    }

    h += '</div>';
    return h;
  }

  // ============================================================
  // Inventory Helpers
  // ============================================================

  function getItemInventoryStatus(item) {
    var inv = inventory[item.pid];
    var qty = item.qty || 1;
    if (!inv) return { status: 'unknown', label: 'No inventory data', available: 0 };
    if (inv.stockType === 'made-to-order' || inv.stockType === 'made-to-order-only' || inv.stockType === 'build-to-order') {
      return { status: 'build', label: 'Build to Order', available: 0 };
    }
    if (inv.stockType === 'stock-to-build') {
      var ck2 = getItemComboKey(item.pid, item.options);
      var se2 = (ck2 !== '_default' && inv.stock && inv.stock[ck2]) ? inv.stock[ck2] : (inv.stock && inv.stock._default) || null;
      var avail2 = se2 ? Math.max(0, (se2.onHand || 0) - (se2.committed || 0) - (se2.held || 0) - (se2.damaged || 0)) : 0;
      if (avail2 <= 0) return { status: 'build', label: 'Made to Order (stock depleted)', available: 0 };
    }
    var ck = getItemComboKey(item.pid, item.options);
    var stockEntry = (ck !== '_default' && inv.stock && inv.stock[ck])
      ? inv.stock[ck]
      : (inv.stock && inv.stock._default) || null;
    var available = stockEntry ? Math.max(0, (stockEntry.onHand || 0) - (stockEntry.committed || 0) - (stockEntry.held || 0) - (stockEntry.damaged || 0)) : 0;
    if (available >= qty) {
      return { status: 'stock', label: 'In Stock (' + available + ' available)', available: available };
    } else if (available > 0) {
      return { status: 'partial', label: 'Low Stock (' + available + ' available, need ' + qty + ')', available: available };
    } else {
      return { status: 'out', label: 'Not in Stock', available: 0 };
    }
  }

  function getItemFulfillmentKey(item) {
    var key = item.pid || '';
    if (item.options && typeof item.options === 'object') {
      var optVals = Object.values(item.options).map(function(v) {
        return v.toString().toLowerCase().replace(/[^a-z0-9]/g, '');
      });
      if (optVals.length > 0) key += '_' + optVals.join('_');
    }
    return key;
  }

  // ============================================================
  // Order Triage Dialog
  // ============================================================

  function openTriageDialog(orderId) {
    var o = orders[orderId];
    if (!o) return;
    var orderNum = getOrderDisplayNumber(o);
    var items = o.items || [];

    var rowsHtml = '';
    items.forEach(function(item, idx) {
      var qty = item.qty || 1;
      var optStr = '';
      if (item.options && typeof item.options === 'object') {
        var parts = [];
        Object.keys(item.options).forEach(function(k) { parts.push(k + ': ' + item.options[k]); });
        optStr = parts.join(', ');
      }

      // Gift cards are digital — auto-fulfilled via email, skip physical triage
      var isGiftCard = item.bookingType === 'gift-card' || item.isGiftCard;
      if (isGiftCard) {
        rowsHtml += '<tr>' +
          '<td style="padding:8px 10px;">' +
            '<div style="font-weight:500;">' + esc(item.name) + ' x' + qty + '</div>' +
            (optStr ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(optStr) + '</div>' : '') +
          '</td>' +
          '<td style="padding:8px 10px;text-align:center;">&mdash;</td>' +
          '<td style="padding:8px 10px;"><span class="order-item-inv inv-stock" style="background:rgba(46,125,50,0.2);color:#66BB6A;">Digital</span></td>' +
          '<td style="padding:8px 10px;font-size:0.85rem;color:var(--teal);">Emailed to recipient</td>' +
        '</tr>';
        return;
      }

      var invStatus = getItemInventoryStatus(item);
      var invCls = invStatus.status === 'stock' ? 'inv-stock' : invStatus.status === 'partial' ? 'inv-partial' : invStatus.status === 'build' ? 'inv-build' : invStatus.status === 'out' ? 'inv-out' : 'inv-unknown';
      var autoAction = (invStatus.status === 'stock') ? 'stock' : 'build';

      rowsHtml += '<tr>' +
        '<td style="padding:8px 10px;">' +
          '<div style="font-weight:500;">' + esc(item.name) + ' x' + qty + '</div>' +
          (optStr ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(optStr) + '</div>' : '') +
        '</td>' +
        '<td style="padding:8px 10px;text-align:center;">' + invStatus.available + '</td>' +
        '<td style="padding:8px 10px;"><span class="order-item-inv ' + invCls + '">' + esc(invStatus.label) + '</span></td>' +
        '<td style="padding:8px 10px;">' +
          '<label style="margin-right:12px;cursor:pointer;font-size:0.85rem;">' +
            '<input type="radio" name="triage_' + idx + '" value="stock" ' + (autoAction === 'stock' ? 'checked' : '') +
            (invStatus.status === 'out' || invStatus.status === 'build' ? ' disabled' : '') +
            ' onchange="updateTriageSummary(\'' + esc(orderId) + '\')" style="margin-right:4px;">From Stock' +
          '</label>' +
          '<label style="cursor:pointer;font-size:0.85rem;">' +
            '<input type="radio" name="triage_' + idx + '" value="build" ' + (autoAction === 'build' ? 'checked' : '') +
            ' onchange="updateTriageSummary(\'' + esc(orderId) + '\')" style="margin-right:4px;">Send to Build' +
          '</label>' +
        '</td>' +
      '</tr>';
    });

    var html = '<div class="modal-header">' +
      '<h3 style="margin:0;">Order Triage &#8212; ' + esc(orderNum) + '</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body" style="padding:16px;max-height:60vh;overflow-y:auto;">' +
      '<p style="margin:0 0 12px;color:var(--warm-gray);font-size:0.9rem;">Review inventory for each item and choose how to fulfill.</p>' +
      '<table style="width:100%;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:2px solid var(--cream-dark);text-align:left;">' +
          '<th style="padding:8px 10px;">Item</th>' +
          '<th style="padding:8px 10px;text-align:center;">Avail</th>' +
          '<th style="padding:8px 10px;">Inventory</th>' +
          '<th style="padding:8px 10px;">Action</th>' +
        '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
      '<div id="triageSummary" style="margin-top:16px;padding:12px;background:var(--cream-dark);border-radius:6px;font-size:0.9rem;"></div>' +
    '</div>' +
    '<div class="modal-footer" style="padding:12px 16px;display:flex;gap:8px;justify-content:flex-end;">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" id="triageConfirmBtn" onclick="executeTriageConfirm(\'' + esc(orderId) + '\')">Confirm &amp; Route</button>' +
    '</div>';

    openModal(html);
    updateTriageSummary(orderId);
  }

  function updateTriageSummary(orderId) {
    var o = orders[orderId];
    if (!o) return;
    var items = o.items || [];
    var stockCount = 0;
    var buildCount = 0;
    items.forEach(function(item, idx) {
      var radios = document.getElementsByName('triage_' + idx);
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) {
          if (radios[i].value === 'stock') stockCount++;
          else buildCount++;
        }
      }
    });
    var summaryEl = document.getElementById('triageSummary');
    if (!summaryEl) return;
    var msg = '';
    if (buildCount === 0) {
      msg = '<strong>' + stockCount + ' item' + (stockCount !== 1 ? 's' : '') + ' from stock.</strong> Order will advance to <strong style="color:#2E7D32;">Ready</strong> for packing.';
    } else if (stockCount === 0) {
      msg = '<strong>' + buildCount + ' item' + (buildCount !== 1 ? 's' : '') + ' need building.</strong> Order will advance to <strong style="color:#7B1FA2;">Building</strong> with production requests created.';
    } else {
      msg = '<strong>' + stockCount + ' from stock, ' + buildCount + ' need building.</strong> Stock committed. Build items sent to production. Order status: <strong style="color:#7B1FA2;">Building</strong>';
    }
    summaryEl.innerHTML = msg;
  }

  async function executeTriageConfirm(orderId) {
    var o = orders[orderId];
    if (!o) return;
    var items = o.items || [];
    var itemActions = [];
    items.forEach(function(item, idx) {
      var action = 'build';
      var radios = document.getElementsByName('triage_' + idx);
      for (var i = 0; i < radios.length; i++) {
        if (radios[i].checked) { action = radios[i].value; break; }
      }
      itemActions.push({ item: item, action: action });
    });

    // Disable button to prevent double-click
    var btn = document.getElementById('triageConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Processing...'; }

    try {
      await triageAndConfirmOrder(orderId, itemActions);
      closeModal();
      showToast('Order confirmed and routed');
      renderOrderDetail(orderId);
      emitTestingEvent('triageConfirm', {}); // Testing Mode
    } catch (err) {
      showToast('Error: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm & Route'; }
    }
  }

  async function triageAndConfirmOrder(orderId, itemActions) {
    var o = orders[orderId];
    if (!o) throw new Error('Order not found');
    var now = new Date().toISOString();
    var updates = {};
    var history = o.statusHistory ? o.statusHistory.slice() : [];

    // Build fulfillment map from admin choices
    var ff = {};
    var needsBuilding = false;
    itemActions.forEach(function(ia) {
      var ffKey = getItemFulfillmentKey(ia.item);
      if (ia.action === 'stock') {
        ff[ffKey] = { source: 'stock', buildJobId: null, ready: true };
        var ck = getItemComboKey(ia.item.pid, ia.item.options);
        reserveInventory(ia.item.pid, ia.item.qty || 1, ck);
      } else {
        ff[ffKey] = { source: 'build', buildJobId: null, ready: false };
        needsBuilding = true;
      }
    });

    updates['fulfillment'] = ff;
    updates['confirmedAt'] = now;
    history.push({ status: 'confirmed', at: now, by: 'admin' });

    if (!needsBuilding) {
      updates['status'] = 'pack';
      updates['packAt'] = now;
      history.push({ status: 'pack', at: now, by: 'system', note: 'All items in stock' });
    } else {
      updates['status'] = 'building';
      updates['buildingAt'] = now;
      history.push({ status: 'building', at: now, by: 'system', note: 'Items need to be made' });
    }
    updates['statusHistory'] = history;

    await MastDB.orders.update(orderId, updates);
    await writeAudit('update', 'orders', orderId);

    if (updates['status'] === 'building') {
      await createProductionRequests(orderId, o, ff);
    }
  }

  // ============================================================
  // Order Status Transitions
  // ============================================================

  async function transitionOrder(orderId, newStatus) {
    var o = orders[orderId];
    if (!o) return;
    var currentStatus = o.status || 'placed';
    var valid = ORDER_VALID_TRANSITIONS[currentStatus] || [];
    if (!valid.includes(newStatus)) {
      showToast('Cannot transition from ' + currentStatus + ' to ' + newStatus, true);
      return;
    }

    try {
      var now = new Date().toISOString();
      var updates = {};
      updates['status'] = newStatus;
      updates[newStatus + 'At'] = now;

      // Append to statusHistory (handle both array and object formats)
      var history = Array.isArray(o.statusHistory) ? o.statusHistory.slice() : (o.statusHistory ? Object.values(o.statusHistory) : []);
      history.push({ status: newStatus, at: now, by: 'admin' });
      updates['statusHistory'] = history;

      // Append to fulfillmentLog for packing/shipping milestones
      if (newStatus === 'packed' || newStatus === 'handed_to_carrier') {
        var ffLog = Array.isArray(o.fulfillmentLog) ? o.fulfillmentLog.slice() : (o.fulfillmentLog ? Object.values(o.fulfillmentLog) : []);
        ffLog.push({ event: newStatus, timestamp: now, userId: 'admin', method: 'manual' });
        updates['fulfillmentLog'] = ffLog;
      }

      // On confirm: use triage function with auto-determined actions
      if (newStatus === 'confirmed') {
        var autoActions = (o.items || []).map(function(item) {
          var invStatus = getItemInventoryStatus(item);
          return { item: item, action: invStatus.status === 'stock' ? 'stock' : 'build' };
        });
        await triageAndConfirmOrder(orderId, autoActions);
        renderOrderDetail(orderId);
        return; // triageAndConfirmOrder handles all updates
      }

      await MastDB.orders.update(orderId, updates);
      // Update local state so re-render shows new status
      Object.keys(updates).forEach(function(k) { o[k] = updates[k]; });
      await writeAudit('update', 'orders', orderId);

      // Testing Mode event
      emitTestingEvent('transitionOrder', { newStatus: newStatus });

      // Auto-progress handed_to_carrier -> shipped
      if (newStatus === 'handed_to_carrier') {
        var shippedAt = new Date().toISOString();
        var shippedUpdates = {
          status: 'shipped',
          shippedAt: shippedAt
        };
        var sh = updates['statusHistory'] || history;
        sh.push({ status: 'shipped', at: shippedAt, by: 'system', note: 'Auto-shipped on carrier hand-off' });
        shippedUpdates['statusHistory'] = sh;
        var ffLog2 = (updates['fulfillmentLog'] || o.fulfillmentLog || []).slice();
        ffLog2.push({ event: 'shipped', timestamp: shippedAt, userId: 'system', method: 'auto' });
        shippedUpdates['fulfillmentLog'] = ffLog2;
        await MastDB.orders.update(orderId, shippedUpdates);
        Object.keys(shippedUpdates).forEach(function(k) { o[k] = shippedUpdates[k]; });

        // Trigger inventory deduction + shipped email via cloud function
        try {
          await firebase.functions().httpsCallable('onOrderShipped')({ orderId: orderId, tenantId: MastDB.tenantId() });
        } catch (shipErr) { console.error('onOrderShipped call failed:', shipErr); }

        showToast(o.email ? 'Order shipped — customer notified' : 'Order shipped — no customer email on file');
        renderOrderDetail(orderId);
        return;
      }

      // Direct transition to shipped (e.g., from packed with tracking)
      if (newStatus === 'shipped') {
        try {
          await firebase.functions().httpsCallable('onOrderShipped')({ orderId: orderId, tenantId: MastDB.tenantId() });
        } catch (shipErr) { console.error('onOrderShipped call failed:', shipErr); }
      }

      showToast('Order updated to ' + updates['status']);
      renderOrderDetail(orderId);
    } catch (err) {
      showToast('Error updating order: ' + err.message, true);
    }
  }

  async function reserveInventory(pid, qty, ck, orderId) {
    var inv = inventory[pid];
    if (!inv || !inv.stock || !inv.stock._default) return;
    try {
      var updates = {};
      updates['_default/committed'] = MastDB.serverIncrement(qty);
      if (ck && ck !== '_default' && inv.stock[ck]) {
        updates[ck + '/committed'] = MastDB.serverIncrement(qty);
      }
      await MastDB.update('admin/inventory/' + pid + '/stock', updates);
      await writeAudit('update', 'inventory', pid);
      await MastDB.push('admin/inventory/' + pid + '/history', {
        action: 'committed', reason: 'order_placed', qty: qty, comboKey: ck || '_default',
        orderId: orderId || null, actor: 'maker', actorType: 'maker',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error reserving inventory:', err);
    }
  }

  async function releaseInventory(pid, qty, ck, orderId) {
    var inv = inventory[pid];
    if (!inv || !inv.stock || !inv.stock._default) return;
    try {
      var updates = {};
      updates['_default/committed'] = MastDB.serverIncrement(-qty);
      if (ck && ck !== '_default' && inv.stock[ck]) {
        updates[ck + '/committed'] = MastDB.serverIncrement(-qty);
      }
      await MastDB.update('admin/inventory/' + pid + '/stock', updates);
      await writeAudit('update', 'inventory', pid);
      await MastDB.push('admin/inventory/' + pid + '/history', {
        action: 'released', reason: 'order_cancelled', qty: qty, comboKey: ck || '_default',
        orderId: orderId || null, actor: 'maker', actorType: 'maker',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error releasing inventory:', err);
    }
  }

  async function pullFromStock(pid, qty, ck, orderId) {
    var inv = inventory[pid];
    if (!inv || !inv.stock || !inv.stock._default) return;
    try {
      var updates = {};
      updates['_default/committed'] = MastDB.serverIncrement(-qty);
      updates['_default/onHand'] = MastDB.serverIncrement(-qty);
      if (ck && ck !== '_default' && inv.stock[ck]) {
        updates[ck + '/committed'] = MastDB.serverIncrement(-qty);
        updates[ck + '/onHand'] = MastDB.serverIncrement(-qty);
      }
      await MastDB.update('admin/inventory/' + pid + '/stock', updates);
      await writeAudit('update', 'inventory', pid);
      await MastDB.push('admin/inventory/' + pid + '/history', {
        action: 'shipped', reason: 'order_shipped', qty: -qty, comboKey: ck || '_default',
        orderId: orderId || null, actor: 'maker', actorType: 'maker',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error('Error pulling from stock:', err);
    }
  }

  // ============================================================
  // Production Requests
  // ============================================================

  async function createProductionRequests(orderId, order, fulfillment) {
    if (!fulfillment) return;
    var items = order.items || [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      // Skip digital items (gift cards) — no production needed
      if (item.bookingType === 'gift-card' || item.isGiftCard) continue;
      var ffKey = getItemFulfillmentKey(item);
      var ff = fulfillment[ffKey];
      if (ff && ff.source === 'build') {
        var reqId = MastDB.productionRequests.newKey();
        await MastDB.productionRequests.set(reqId, {
          requestId: reqId,
          orderId: orderId,
          orderNumber: order.orderNumber || order.orderId,
          productId: item.pid,
          productName: item.name,
          options: item.options || null,
          qty: item.qty || 1,
          status: 'pending',
          priority: 'normal',
          notes: '',
          jobId: null,
          lineItemId: null,
          fulfilledAt: null,
          fulfilledBy: null,
          createdAt: new Date().toISOString()
        });
        await writeAudit('create', 'buildJobs', reqId);
        // Link production request to fulfillment
        await MastDB.orders.subRef(orderId, 'fulfillment', ffKey, 'buildJobId').set(reqId);
      }
    }
  }

  // ============================================================
  // Shipping Modal
  // ============================================================

  // ============================================================
  // Shipping Panel — Multi-step (API) or Manual fallback
  // ============================================================

  var _shippingState = {};

  async function _getShippingProvider() {
    try {
      var snap = await MastDB.config.shippingProvider('provider').once('value');
      return snap.val() || 'manual';
    } catch(e) { return 'manual'; }
  }

  async function _getStudioLocations() {
    var snap = await MastDB.studioLocations.get();
    return (snap || {});
  }

  async function _getPackagePresets() {
    try {
      var snap = await MastDB.config.shippingProvider('packagePresets').once('value');
      return snap.val() || [];
    } catch(e) { return []; }
  }

  function _calcOrderWeight(order) {
    var totalOz = 0;
    (order.items || []).forEach(function(item) {
      var prod = (typeof productsData !== 'undefined' && productsData) ? productsData.find(function(p) { return p.pid === item.pid; }) : null;
      if (prod && prod.weightOz) totalOz += prod.weightOz * (item.qty || 1);
    });
    return totalOz;
  }

  function openShippingModal(orderId) {
    _shippingState = { orderId: orderId, step: 'loading', rates: [], selectedRate: null };
    openModal('<div style="max-width:500px;padding:16px;text-align:center;"><div class="loading">Loading shipping options...</div></div>');
    _initShippingPanel(orderId);
  }

  async function _initShippingPanel(orderId) {
    try {
      var provider = await _getShippingProvider();
      _shippingState.provider = provider;

      if (provider === 'manual') {
        _renderManualShipping(orderId);
        return;
      }

      var locations = await _getStudioLocations();
      var presets = await _getPackagePresets();
      var order = orders[orderId];
      var autoWeight = _calcOrderWeight(order);

      _shippingState.locations = locations;
      _shippingState.presets = presets;
      _shippingState.autoWeight = autoWeight;
      _shippingState.step = 'configure';
      _renderShippingPanel();
    } catch (err) {
      openModal('<div style="max-width:400px;"><h3>Shipping Error</h3><p style="color:var(--danger);">' + esc(err.message) + '</p><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>');
    }
  }

  function _renderManualShipping(orderId) {
    var order = orders[orderId];
    var etsyNote = (order && order.source === 'etsy') ?
      '<div style="background:rgba(241,100,30,0.15);border:1px solid rgba(241,100,30,0.4);border-radius:6px;padding:8px 12px;margin-bottom:16px;font-size:0.85rem;color:#fdba74;">' +
        '<strong>Etsy Order</strong> — Tracking will be pushed to Etsy automatically when you mark shipped.' +
      '</div>' : '';
    var html = '<div style="max-width:400px;">' +
      '<h3>Mark as Shipped</h3>' +
      etsyNote +
      '<div class="form-group">' +
        '<label>Carrier</label>' +
        '<select id="shippingCarrier">' +
          '<option value="USPS">USPS</option>' +
          '<option value="UPS">UPS</option>' +
          '<option value="FedEx">FedEx</option>' +
          '<option value="Other">Other</option>' +
        '</select>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Tracking Number</label>' +
        '<input type="text" id="shippingTrackingNum" placeholder="Enter tracking number">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Note (optional)</label>' +
        '<input type="text" id="shippingNote" placeholder="e.g. Shipped Priority Mail">' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="submitManualShipping(\'' + esc(orderId) + '\')">Mark Shipped</button>' +
      '</div>' +
    '</div>';
    openModal(html);
  }

  function _renderShippingPanel() {
    var s = _shippingState;
    var order = orders[s.orderId];
    var num = order ? getOrderDisplayNumber(order) : s.orderId;

    // Ship-from dropdown
    var locKeys = Object.keys(s.locations || {});
    var defaultLocKey = '';
    locKeys.forEach(function(k) { if (s.locations[k].isDefaultShipFrom) defaultLocKey = k; });
    if (!s.selectedFromKey) s.selectedFromKey = defaultLocKey || (locKeys.length > 0 ? locKeys[0] : '');

    var fromLoc = s.locations[s.selectedFromKey] || {};
    var fromOptions = '';
    locKeys.forEach(function(k) {
      var loc = s.locations[k];
      if (!loc.address1) return; // Skip locations without addresses
      var label = (loc.name || k) + ' — ' + [loc.city, loc.state].filter(Boolean).join(', ');
      fromOptions += '<option value="' + esc(k) + '"' + (s.selectedFromKey === k ? ' selected' : '') + '>' + esc(label) + '</option>';
    });

    var noAddressWarning = fromOptions === '' ?
      '<div style="background:rgba(255,152,0,0.15);border:1px solid rgba(255,152,0,0.4);border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:0.85rem;color:#fdba74;">' +
        'No studio locations have ship-from addresses. <a href="#" onclick="closeModal();navigateTo(\'settings\');return false;" style="color:#fed7aa;font-weight:600;">Add one in Settings</a>' +
      '</div>' : '';

    // Ship-to (from order)
    var addr = order.shippingAddress || order.shipping || order.address || {};
    var toLine = [addr.name, addr.address1, addr.city, addr.state, addr.zip].filter(Boolean).join(', ');

    // Package — auto-select first preset if available
    if (s.selectedPreset === undefined && s.presets && s.presets.length > 0) {
      s.selectedPreset = 0;
    }
    var presetOptions = '<option value="custom">Custom dimensions</option>';
    (s.presets || []).forEach(function(p, i) {
      presetOptions += '<option value="' + i + '"' + (s.selectedPreset === i ? ' selected' : '') + '>' +
        esc(p.name) + ' (' + p.lengthIn + '×' + p.widthIn + '×' + p.heightIn + '")</option>';
    });

    // Pre-fill dims from selected preset
    var selectedPresetObj = (s.selectedPreset !== undefined && s.presets) ? s.presets[s.selectedPreset] : null;
    var presetL = selectedPresetObj ? selectedPresetObj.lengthIn : (s.parcelLength || '');
    var presetW = selectedPresetObj ? selectedPresetObj.widthIn : (s.parcelWidth || '');
    var presetH = selectedPresetObj ? selectedPresetObj.heightIn : (s.parcelHeight || '');

    var autoWeightNote = s.autoWeight > 0 ? ' (auto-calculated from products: ' + s.autoWeight + ' oz)' : '';
    var currentWeight = s.manualWeight || s.autoWeight || '';

    var configHtml = '<div style="max-width:500px;">' +
      '<h3 style="margin:0 0 16px;">Ship Order ' + esc(num) + '</h3>' +
      noAddressWarning +

      // Ship-from
      '<div class="form-group">' +
        '<label style="font-weight:600;">Ship From</label>' +
        '<select id="shipFromSelect" onchange="_shippingState.selectedFromKey=this.value">' + fromOptions + '</select>' +
      '</div>' +
      '<input type="hidden" id="shipFromPhone" value="' + esc(fromLoc.phone || '617-642-4279') + '">' +

      // Ship-to (read-only)
      '<div class="form-group">' +
        '<label style="font-weight:600;">Ship To</label>' +
        '<div style="padding:8px 12px;background:var(--cream);border-radius:6px;font-size:0.9rem;">' + esc(toLine || 'No shipping address on order') + '</div>' +
      '</div>' +

      // Package
      '<div class="form-group">' +
        '<label style="font-weight:600;">Package</label>' +
        '<select id="shipPackagePreset" onchange="shippingSelectPreset(this.value)">' + presetOptions + '</select>' +
      '</div>' +
      '<div id="shipCustomDims" style="display:' + (s.selectedPreset !== undefined ? 'none' : 'block') + ';">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<div class="form-group" style="min-width:80px;flex:1;"><label>Length (in)</label><input type="number" id="shipLength" min="0" step="0.1" value="' + presetL + '"></div>' +
          '<div class="form-group" style="min-width:80px;flex:1;"><label>Width (in)</label><input type="number" id="shipWidth" min="0" step="0.1" value="' + presetW + '"></div>' +
          '<div class="form-group" style="min-width:80px;flex:1;"><label>Height (in)</label><input type="number" id="shipHeight" min="0" step="0.1" value="' + presetH + '"></div>' +
        '</div>' +
      '</div>' +
      '<div class="form-group" style="max-width:200px;">' +
        '<label>Weight (oz)' + (autoWeightNote ? '<span style="font-size:0.78rem;color:var(--warm-gray);font-weight:400;">' + autoWeightNote + '</span>' : '') + '</label>' +
        '<input type="number" id="shipWeight" min="0" step="0.1" value="' + currentWeight + '">' +
      '</div>' +

      // Actions
      '<div style="display:flex;gap:8px;justify-content:space-between;margin-top:16px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="shippingSwitchToManual(\'' + esc(s.orderId) + '\')">Enter tracking manually</button>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-primary" id="shipGetRatesBtn" onclick="shippingGetRates()" ' + (fromOptions === '' ? 'disabled' : '') + '>Get Rates</button>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Rate results
    if (s.step === 'rates' && s.rates.length > 0) {
      configHtml = _renderRateResults();
    } else if (s.step === 'buying') {
      configHtml = '<div style="max-width:500px;padding:16px;text-align:center;"><div class="loading">Purchasing label...</div></div>';
    }

    openModal(configHtml);
  }

  function _renderRateResults() {
    var s = _shippingState;
    var order = orders[s.orderId];
    var num = order ? getOrderDisplayNumber(order) : s.orderId;

    var html = '<div style="max-width:550px;">' +
      '<h3 style="margin:0 0 4px;">Shipping Rates — ' + esc(num) + '</h3>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin:0 0 16px;">Select a rate to purchase a shipping label</p>';

    if (s.rateError) {
      html += '<div style="background:rgba(220,53,69,0.15);border:1px solid rgba(220,53,69,0.4);border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:0.85rem;color:#fca5a5;">' + esc(s.rateError) + '</div>';
    }

    html += '<div style="overflow-x:auto;">' +
      '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
      '<thead><tr style="border-bottom:2px solid var(--cream-dark);">' +
        '<th style="text-align:left;padding:8px;">Carrier</th>' +
        '<th style="text-align:left;padding:8px;">Service</th>' +
        '<th style="text-align:right;padding:8px;">Price</th>' +
        '<th style="text-align:right;padding:8px;">Est. Days</th>' +
        '<th style="padding:8px;"></th>' +
      '</tr></thead><tbody>';

    s.rates.forEach(function(rate, idx) {
      var selected = s.selectedRate === idx;
      html += '<tr style="border-bottom:1px solid var(--cream-dark);' + (selected ? 'background:rgba(0,128,128,0.08);' : '') + '">' +
        '<td style="padding:8px;font-weight:600;">' + esc(rate.carrier || '') + '</td>' +
        '<td style="padding:8px;">' + esc(rate.service || '') + '</td>' +
        '<td style="padding:8px;text-align:right;font-family:monospace;font-weight:600;">$' + parseFloat(rate.price || 0).toFixed(2) + '</td>' +
        '<td style="padding:8px;text-align:right;">' + (rate.estimatedDays || '—') + '</td>' +
        '<td style="padding:8px;text-align:right;">' +
          '<button class="btn ' + (selected ? 'btn-primary' : 'btn-secondary') + '" style="font-size:0.78rem;padding:4px 12px;" onclick="shippingSelectRate(' + idx + ')">' + (selected ? 'Selected' : 'Select') + '</button>' +
        '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="shippingBackToConfigure()">Back</button>' +
        '<button class="btn btn-primary" id="shipBuyLabelBtn" onclick="shippingBuyLabel()" ' + (s.selectedRate === null ? 'disabled' : '') + '>Buy Label</button>' +
      '</div>' +
    '</div>';
    return html;
  }

  function shippingSelectPreset(val) {
    var s = _shippingState;
    var customDims = document.getElementById('shipCustomDims');
    if (val === 'custom') {
      s.selectedPreset = undefined;
      if (customDims) customDims.style.display = 'block';
    } else {
      var idx = parseInt(val);
      s.selectedPreset = idx;
      var preset = s.presets[idx];
      if (preset) {
        document.getElementById('shipLength').value = preset.lengthIn || '';
        document.getElementById('shipWidth').value = preset.widthIn || '';
        document.getElementById('shipHeight').value = preset.heightIn || '';
      }
      if (customDims) customDims.style.display = 'none';
    }
  }

  function shippingSelectRate(idx) {
    _shippingState.selectedRate = idx;
    // Re-render with selection
    openModal(_renderRateResults());
  }

  function shippingBackToConfigure() {
    _shippingState.step = 'configure';
    _shippingState.rates = [];
    _shippingState.selectedRate = null;
    _renderShippingPanel();
  }

  function shippingSwitchToManual(orderId) {
    _renderManualShipping(orderId);
  }

  async function shippingGetRates() {
    var s = _shippingState;
    var btn = document.getElementById('shipGetRatesBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Getting rates...'; }

    try {
      var fromLoc = s.locations[s.selectedFromKey];
      if (!fromLoc || !fromLoc.address1) {
        showToast('Selected location has no address', true);
        if (btn) { btn.disabled = false; btn.textContent = 'Get Rates'; }
        return;
      }

      var order = orders[s.orderId];
      var toAddr = order.shippingAddress || order.shipping || order.address || {};

      var lengthIn = parseFloat(document.getElementById('shipLength').value) || 0;
      var widthIn = parseFloat(document.getElementById('shipWidth').value) || 0;
      var heightIn = parseFloat(document.getElementById('shipHeight').value) || 0;
      var weightOz = parseFloat(document.getElementById('shipWeight').value) || 0;

      if (!weightOz) {
        showToast('Weight is required', true);
        if (btn) { btn.disabled = false; btn.textContent = 'Get Rates'; }
        return;
      }

      var token = await auth.currentUser.getIdToken();
      var resp = await callCF('/shippingGetRates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          tenantId: MastDB.tenantId(),
          from: {
            name: fromLoc.name || '',
            address1: fromLoc.address1,
            address2: fromLoc.address2 || '',
            city: fromLoc.city,
            state: fromLoc.state,
            zip: fromLoc.zip,
            phone: (document.getElementById('shipFromPhone') && document.getElementById('shipFromPhone').value.trim()) || fromLoc.phone || '0000000000',
            email: 'info@runmast.com'
          },
          to: {
            name: toAddr.name || (order.customerName || ''),
            address1: toAddr.address1 || toAddr.line1 || '',
            address2: toAddr.address2 || toAddr.line2 || '',
            city: toAddr.city || '',
            state: toAddr.state || '',
            zip: toAddr.zip || toAddr.postalCode || '',
            phone: toAddr.phone || ''
          },
          parcel: { lengthIn: lengthIn, widthIn: widthIn, heightIn: heightIn, weightOz: weightOz }
        })
      });

      var data = await resp.json();

      if (!resp.ok) {
        s.rateError = data.error || 'Failed to get rates';
        s.step = 'rates';
        s.rates = [];
        _renderShippingPanel();
        return;
      }

      var rates = (data.result && data.result.rates) || data.rates || [];
      rates.sort(function(a, b) { return parseFloat(a.price || 0) - parseFloat(b.price || 0); });

      s.rates = rates;
      s.rateError = null;
      s.step = 'rates';
      s.selectedRate = rates.length > 0 ? 0 : null; // Auto-select cheapest
      _renderShippingPanel();

    } catch (err) {
      showToast('Error getting rates: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Get Rates'; }
    }
  }

  async function shippingBuyLabel() {
    var s = _shippingState;
    if (s.selectedRate === null) return;
    var rate = s.rates[s.selectedRate];
    if (!rate) return;

    s.step = 'buying';
    _renderShippingPanel();

    try {
      var token = await auth.currentUser.getIdToken();
      var resp = await callCF('/shippingBuyLabel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          tenantId: MastDB.tenantId(),
          rateId: rate.id,
          orderId: s.orderId
        })
      });

      var data = await resp.json();

      if (!resp.ok) {
        showToast(data.error || 'Failed to buy label', true);
        s.step = 'rates';
        _renderShippingPanel();
        return;
      }

      var result = data.result || data;

      // Update local order state
      var order = orders[s.orderId];
      var now = new Date().toISOString();
      var history = (order && order.statusHistory) ? order.statusHistory.slice() : [];
      history.push({ status: 'shipped', at: now, by: 'admin', note: (result.carrier || '') + ' via ' + s.provider });

      await MastDB.orders.update(s.orderId, {
        status: 'shipped',
        shippedAt: now,
        tracking: {
          carrier: result.carrier || rate.carrier || '',
          trackingNumber: result.trackingNumber || '',
          trackingUrl: result.trackingUrl || '',
          shipmentId: result.shipmentId || '',
          labelUrl: result.labelUrl || '',
          labelProvider: s.provider,
          purchasedAt: now
        },
        statusHistory: history
      });
      await writeAudit('update', 'orders', s.orderId);

      // Trigger inventory deduction + shipped email via cloud function (canonical path)
      try {
        await firebase.functions().httpsCallable('onOrderShipped')({ orderId: s.orderId, tenantId: MastDB.tenantId() });
      } catch (shipErr) { console.error('onOrderShipped call failed:', shipErr); }

      closeModal();
      showToast('Label purchased — order shipped!');

      // Show label action
      if (result.labelUrl) {
        setTimeout(function() {
          _offerLabelPrint(s.orderId, result.labelUrl);
        }, 500);
      }

    } catch (err) {
      showToast('Error buying label: ' + err.message, true);
      s.step = 'rates';
      _renderShippingPanel();
    }
  }

  function _offerLabelPrint(orderId, labelUrl) {
    var order = orders[orderId];
    var carrier = (order && order.tracking && order.tracking.carrier) || '';
    var isMobile = window.innerWidth < 600;
    var html = '<div style="max-width:400px;text-align:center;">' +
      '<div style="font-size:1.6rem;margin-bottom:8px;">&#x2705;</div>' +
      '<h3 style="margin:0 0 8px;">Label Ready</h3>' +
      '<p style="color:var(--warm-gray);font-size:0.9rem;margin:0 0 16px;">Your shipping label has been purchased and tracking is set.</p>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">' +
        (isMobile ?
          '<a href="' + esc(labelUrl) + '" target="_blank" class="btn btn-primary" style="text-decoration:none;">View Label</a>' :
          '<button class="btn btn-primary" onclick="printShippingLabel(\'' + esc(orderId) + '\')">Print Label (4×6)</button>') +
        '<a href="' + esc(labelUrl) + '" target="_blank" class="btn btn-secondary" style="text-decoration:none;">Download PDF</a>' +
        '<button class="btn btn-secondary" onclick="closeModal()">Done</button>' +
      '</div>' +
    '</div>';
    openModal(html);
  }

  async function printShippingLabel(orderId) {
    var order = orders[orderId];
    if (!order || !order.tracking || !order.tracking.labelUrl) {
      showToast('No label URL found on this order', true);
      return;
    }
    var labelUrl = order.tracking.labelUrl;
    var carrier = order.tracking.carrier || '';
    var num = getOrderDisplayNumber(order);

    // Try LabelKeeper API if key is configured
    try {
      var lkUrl = (typeof LK_API_URL !== 'undefined') ? LK_API_URL : 'https://labelkeeper-api-1075204398975.us-central1.run.app';
      // Try to get LK API key — check production module first, then read directly
      var lkKey = null;
      if (typeof _getLkApiKey === 'function') {
        lkKey = await _getLkApiKey();
      }
      if (!lkKey) {
        try {
          var snap = await MastDB.get('config/labelkeeper/apiKey');
          lkKey = snap.val();
          if (!lkKey) {
            snap = await MastDB.get('admin/config/labelkeeper/apiKey');
            lkKey = snap.val();
          }
        } catch(e) {}
      }
      if (lkKey) {
        var resp = await fetch(lkUrl + '/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + lkKey },
          body: JSON.stringify({
            type: 'shipping-label',
            labelImageUrl: labelUrl,
            orderId: num,
            carrier: carrier
          })
        });
        if (resp.ok) {
          var data = await resp.json();
          if (data.url) {
            window.open(data.url, '_blank');
            showToast('Label opened in LabelKeeper');
            return;
          }
        }
      }
    } catch (e) {
      console.warn('LabelKeeper session failed, falling back to direct open:', e.message);
    }

    // Fallback: open label URL directly
    window.open(labelUrl, '_blank');
    showToast('Label opened — use browser print at 4×6');
  }

  async function shippingVoidLabel(orderId) {
    if (!await mastConfirm('Void this shipping label? The postage will be refunded to your account.', { title: 'Void Label', danger: true })) return;
    var o = orders[orderId];
    if (!o || !o.tracking || !o.tracking.shipmentId) {
      showToast('No API-purchased label to void', true);
      return;
    }
    try {
      var token = await auth.currentUser.getIdToken();
      var resp = await callCF('/shippingVoidLabel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          tenantId: MastDB.tenantId(),
          shipmentId: o.tracking.shipmentId,
          orderId: orderId
        })
      });
      var data = await resp.json();
      if (!resp.ok) {
        showToast(data.error || 'Failed to void label', true);
        return;
      }
      // Update local state — CF already cleared tracking on order
      var now = new Date().toISOString();
      var history = (o.statusHistory || []).slice();
      history.push({ status: 'confirmed', at: now, by: 'admin', note: 'Label voided — refund initiated' });
      await MastDB.orders.update(orderId, {
        status: 'confirmed',
        shippedAt: null,
        tracking: null,
        statusHistory: history
      });
      await writeAudit('update', 'orders', orderId);
      showToast('Label voided — order returned to confirmed');
    } catch (err) {
      showToast('Error voiding label: ' + err.message, true);
    }
  }

  async function submitManualShipping(orderId) {
    var carrier = document.getElementById('shippingCarrier').value;
    var trackingNum = document.getElementById('shippingTrackingNum').value.trim();
    var note = document.getElementById('shippingNote').value.trim();

    if (!trackingNum) {
      showToast('Please enter a tracking number', true);
      return;
    }

    try {
      var now = new Date().toISOString();
      var trackingUrl = '';
      if (TRACKING_URLS[carrier]) {
        trackingUrl = TRACKING_URLS[carrier](trackingNum);
      }

      var o = orders[orderId];
      var history = (o && o.statusHistory) ? o.statusHistory.slice() : [];
      history.push({ status: 'shipped', at: now, by: 'admin', note: note || carrier + ' ' + trackingNum });

      await MastDB.orders.update(orderId, {
        status: 'shipped',
        shippedAt: now,
        tracking: {
          carrier: carrier,
          trackingNumber: trackingNum,
          trackingUrl: trackingUrl
        },
        statusHistory: history
      });
      await writeAudit('update', 'orders', orderId);

      // Trigger inventory deduction + shipped email via cloud function (canonical path)
      try {
        await firebase.functions().httpsCallable('onOrderShipped')({ orderId: orderId, tenantId: MastDB.tenantId() });
      } catch (shipErr) { console.error('onOrderShipped call failed:', shipErr); }

      closeModal();
      showToast('Order marked as shipped');
    } catch (err) {
      showToast('Error updating shipping: ' + err.message, true);
    }
  }

  // ============================================================
  // Simple Ship Dialog (Order Detail — no Shippo integration)
  // ============================================================

  function openSimpleShipDialog(orderId) {
    var order = orders[orderId];
    var num = order ? getOrderDisplayNumber(order) : orderId;
    var html = '<div style="max-width:420px;">' +
      '<h3 style="margin:0 0 16px;">Ship Order ' + esc(num) + '</h3>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        '<div class="form-group" style="flex:1;min-width:140px;">' +
          '<label>Carrier</label>' +
          '<select id="simpleShipCarrier" style="width:100%;">' +
            '<option value="USPS">USPS</option>' +
            '<option value="UPS">UPS</option>' +
            '<option value="FedEx">FedEx</option>' +
            '<option value="DHL">DHL</option>' +
            '<option value="Other">Other</option>' +
          '</select>' +
        '</div>' +
        '<div class="form-group" style="flex:1;min-width:140px;">' +
          '<label>Method</label>' +
          '<select id="simpleShipMethod" style="width:100%;">' +
            '<option value="Ground">Ground</option>' +
            '<option value="Priority">Priority</option>' +
            '<option value="2-Day">2-Day</option>' +
            '<option value="Overnight">Overnight</option>' +
            '<option value="Other">Other</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Tracking / Confirmation Number</label>' +
        '<input type="text" id="simpleShipTracking" placeholder="Enter tracking number">' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Attach Label <span style="color:var(--warm-gray);font-weight:400;">(optional)</span></label>' +
        '<input type="file" id="simpleShipLabel" accept=".pdf,.png,.jpg,.jpeg" style="font-size:0.85rem;">' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">PDF or image of shipping label. Stored with order for reprinting.</p>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="simpleShipBtn" onclick="submitSimpleShip(\'' + esc(orderId) + '\')">Ship</button>' +
      '</div>' +
    '</div>';
    openModal(html);
  }

  async function submitSimpleShip(orderId) {
    var carrier = document.getElementById('simpleShipCarrier').value;
    var method = document.getElementById('simpleShipMethod').value;
    var trackingNum = document.getElementById('simpleShipTracking').value.trim();
    var labelFile = document.getElementById('simpleShipLabel').files[0];

    if (!trackingNum) {
      showToast('Enter a tracking number', true);
      return;
    }

    var btn = document.getElementById('simpleShipBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Shipping...'; }

    try {
      var now = new Date().toISOString();
      var trackingUrl = '';
      if (TRACKING_URLS[carrier]) {
        trackingUrl = TRACKING_URLS[carrier](trackingNum);
      }

      // Upload label file if provided
      var labelUrl = '';
      if (labelFile) {
        try {
          var storageRef = firebase.storage().ref();
          var labelPath = MastDB.tenantId() + '/shipping-labels/' + orderId + '/' + labelFile.name;
          var uploadResult = await storageRef.child(labelPath).put(labelFile);
          labelUrl = await uploadResult.ref.getDownloadURL();
        } catch (uploadErr) {
          console.warn('Label upload failed:', uploadErr.message);
          // Continue without label — not a blocking error
        }
      }

      var o = orders[orderId];
      var history = Array.isArray(o.statusHistory) ? o.statusHistory.slice() : (o.statusHistory ? Object.values(o.statusHistory) : []);
      history.push({ status: 'shipped', at: now, by: 'admin', note: carrier + ' ' + method + ' ' + trackingNum });

      var trackingData = {
        carrier: carrier,
        method: method,
        trackingNumber: trackingNum,
        trackingUrl: trackingUrl
      };
      if (labelUrl) trackingData.labelUrl = labelUrl;

      await MastDB.orders.update(orderId, {
        status: 'shipped',
        shippedAt: now,
        tracking: trackingData,
        statusHistory: history
      });
      await writeAudit('update', 'orders', orderId);

      // Trigger inventory deduction + shipped email via cloud function (canonical path)
      try {
        await firebase.functions().httpsCallable('onOrderShipped')({ orderId: orderId, tenantId: MastDB.tenantId() });
      } catch (shipErr) { console.error('onOrderShipped call failed:', shipErr); }

      closeModal();
      showToast('Order shipped — ' + carrier + ' ' + method);
      renderOrderDetail(orderId);
    } catch (err) {
      showToast('Error: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Ship'; }
    }
  }

  // ============================================================
  // Cancel Order Modal
  // ============================================================

  function openCancelOrderModal(orderId) {
    var o = orders[orderId];
    var num = o ? getOrderDisplayNumber(o) : orderId;
    var html = '<div style="max-width:400px;">' +
      '<h3>Cancel Order</h3>' +
      '<p style="margin:12px 0;color:var(--warm-gray);">Are you sure you want to cancel order <strong>' + esc(num) + '</strong>? ' +
      'This will release committed inventory and cancel any open production requests.</p>' +
      '<div class="form-group">' +
        '<label>Reason (optional)</label>' +
        '<textarea id="cancelReason" rows="3" placeholder="Why is this order being cancelled?"></textarea>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Keep Order</button>' +
        '<button class="btn btn-danger" onclick="cancelOrder(\'' + esc(orderId) + '\')">Cancel Order</button>' +
      '</div>' +
    '</div>';
    openModal(html);
  }

  async function cancelOrder(orderId) {
    try {
      var o = orders[orderId];
      if (!o) return;
      var now = new Date().toISOString();
      var reason = document.getElementById('cancelReason').value.trim();

      var history = o.statusHistory ? o.statusHistory.slice() : [];
      history.push({ status: 'cancelled', at: now, by: 'admin', note: reason || null });

      // Release committed inventory (variant-aware)
      if (o.fulfillment) {
        (o.items || []).forEach(function(item) {
          var ffKey = getItemFulfillmentKey(item);
          var ff = o.fulfillment[ffKey];
          if (ff && ff.source === 'stock' && ff.ready) {
            releaseInventory(item.pid, item.qty || 1, getItemComboKey(item.pid, item.options));
          }
        });
      }

      // Cancel open production requests
      var reqKeys = Object.keys(productionRequests).filter(function(k) {
        return productionRequests[k].orderId === orderId &&
          (productionRequests[k].status === 'pending' || productionRequests[k].status === 'assigned');
      });
      for (var i = 0; i < reqKeys.length; i++) {
        await MastDB.productionRequests.update(reqKeys[i], {
          status: 'cancelled',
          cancelledAt: now
        });
        await writeAudit('update', 'buildJobs', reqKeys[i]);
      }

      // Write only the cancellation-specific fields here; let MastFlow.transition
      // own the status flip + statusHistory append + workflow audit row, so the
      // timeline has exactly one entry per transition (not one from here AND
      // one from recordExtraPatch).
      await MastDB.orders.update(orderId, {
        cancelledAt: now,
        cancelReason: reason || null
      });
      await writeAudit('update', 'orders', orderId);

      // Route the workflow transition through MastFlow so the audit row at
      // admin/workflowTransitions/order/{orderId}/{txId} fires. force:true
      // bypasses requirement gating (operator's already decided);
      // expectedFromPhase is omitted to skip the optimistic-lock (this is
      // an admin-initiated cancellation, not a contested transition).
      var cancelledRec = orders[orderId] || {};
      cancelledRec.id = orderId;
      // Seed statusHistory snapshot so recordExtraPatch appends to the
      // current history, not an empty one (it reads from the live record).
      cancelledRec.statusHistory = history;
      try {
        if (window.MastFlow && MastFlow.getDefinition('pickship')) {
          await MastFlow.transition('pickship', cancelledRec, 'closed', {
            recordId: orderId,
            force: true,
            reason: reason || 'admin cancellation'
          });
        } else {
          // Engine not loaded (e.g. order list cancel without detail-view
          // ever having opened) — fall back to the legacy write so the
          // status flip still lands. Cancellation audit row is lost.
          await MastDB.orders.update(orderId, {
            status: 'cancelled',
            statusHistory: history
          });
        }
      } catch (mfErr) {
        console.error('[orders] MastFlow cancellation transition failed; falling back to legacy write:', mfErr);
        await MastDB.orders.update(orderId, {
          status: 'cancelled',
          statusHistory: history
        });
      }

      closeModal();
      showToast('Order cancelled');

      // Create CS ticket for admin-initiated cancellation (non-fatal)
      if (!o.cancellationTicketId) {
        try {
          var tcSnap = await MastDB.get('cs_config/ticketing');
          var tc = (tcSnap && tcSnap.val && tcSnap.val()) || {};
          var tcPrefix = tc.prefix || 'T';
          var nextNum = typeof tc.nextNumber === 'number' ? tc.nextNumber : 1;
          var ticketNumber = tcPrefix + '-' + String(nextNum).padStart(4, '0');
          var ticketId = 'ticket_' + Date.now().toString(36);
          var cMsgId = 'msg_' + Date.now().toString(36);
          var orderNum = o.orderNumber || orderId;
          var contactEmail = o.email || o.billingEmail || '';
          var contactName = o.billingName || o.customerName || '';
          var cancellationMsg = 'Order #' + orderNum + ' was cancelled by an admin.' + (reason ? ' Reason: ' + reason : '');
          await MastDB.set('cs_tickets/' + ticketId, {
            id: ticketId,
            ticketNumber: ticketNumber,
            subject: 'Order #' + orderNum + ' cancelled by admin',
            status: 'open',
            priority: 'normal',
            source: 'inquiry',
            contactEmail: contactEmail,
            contactName: contactName || null,
            orderId: orderId,
            body: 'Admin cancelled order #' + orderNum + '.',
            createdAt: now,
            updatedAt: now
          });
          await MastDB.set('cs_tickets/' + ticketId + '/messages/' + cMsgId, {
            id: cMsgId,
            body: cancellationMsg,
            direction: 'outbound',
            isInternal: true,
            authorName: 'System',
            authorEmail: null,
            createdAt: now
          });
          if (tcSnap && tcSnap.val && tcSnap.val()) {
            await MastDB.update('cs_config/ticketing', { nextNumber: nextNum + 1 });
          } else {
            await MastDB.set('cs_config/ticketing', { prefix: tcPrefix, nextNumber: nextNum + 1 });
          }
          await MastDB.orders.update(orderId, {
            cancellationTicketId: ticketId,
            cancellationTicketNumber: ticketNumber
          });
        } catch (csErr) {
          console.warn('CS ticket creation failed for cancelled order', orderId, csErr);
        }
      }
    } catch (err) {
      showToast('Error cancelling order: ' + err.message, true);
    }
  }

  // ============================================================
  // Order Notes
  // ============================================================

  async function addOrderNote(orderId) {
    var input = document.getElementById('orderNoteInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;

    try {
      var o = orders[orderId];
      var rawNotes = o && o.notes;
      var newNote = { text: text, at: new Date().toISOString(), by: 'admin' };
      if (rawNotes && !Array.isArray(rawNotes) && typeof rawNotes === 'object') {
        // Map shape (tenant-MCP) — append a new map entry, preserve shape
        var noteId = 'n' + Date.now() + Math.random().toString(36).slice(2, 6);
        await MastDB.orders.subRef(orderId, 'notes', noteId).set(newNote);
      } else {
        var notes = Array.isArray(rawNotes) ? rawNotes.slice() : [];
        notes.push(newNote);
        await MastDB.orders.subRef(orderId, 'notes').set(notes);
      }
      await writeAudit('update', 'orders', orderId);
      input.value = '';
      showToast('Note added');
    } catch (err) {
      showToast('Error adding note: ' + err.message, true);
    }
  }

  // ============================================================
  // Commissions
  // ============================================================

  function loadCommissions() {
    var loading = document.getElementById('commissionsLoading');
    if (loading) loading.style.display = '';
    MastDB.commissions.query().limitToLast(200).once().then(function(snap) {
      commissionsData = snap.val() || {};
      commissionsLoaded = true;
      if (loading) loading.style.display = 'none';
      renderCommissions();
    }).catch(function(err) {
      if (loading) loading.style.display = 'none';
      showToast('Error loading commissions: ' + err.message, true);
    });
  }

  function renderCommissions() {
    // URL-driven filters from MCP admin links: status, dateFrom, dateTo,
    // commissionIds (#commissions?...). URL-overrides-pill — when any URL
    // filter is present, bypass the dropdown filter for this render.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
    var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
    var urlIdsParam = (rp && typeof rp.commissionIds === 'string') ? rp.commissionIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var hasUrlFilter = !!(urlStatus || urlDateFrom || urlDateTo || urlIds.length);
    if (hasUrlFilter && (urlDateFrom || urlDateTo) && _tenantTz === null) {
      // First render uses browser TZ; re-render once tenant TZ resolves.
      ensureTenantTz().then(function() { renderCommissions(); });
    }

    var filterEl = document.getElementById('commissionsStatusFilter');
    var filter = filterEl ? filterEl.value : 'all';
    var items = Object.keys(commissionsData).map(function(k) {
      var c = commissionsData[k];
      c.id = k;
      return c;
    });
    if (hasUrlFilter) {
      items = items.filter(function(c) {
        if (urlStatus && c.status !== urlStatus) return false;
        if (urlIdLookup && !urlIdLookup[c.id]) return false;
        if (urlDateFrom || urlDateTo) {
          var p = tzPartsFromIso(c.createdAt || '');
          if (!p) return false;
          var d = p.year + '-' + p.month + '-' + p.day;
          if (urlDateFrom && d < urlDateFrom) return false;
          if (urlDateTo && d > urlDateTo) return false;
        }
        return true;
      });
    } else if (filter !== 'all') {
      items = items.filter(function(c) { return c.status === filter; });
    }

    // W1.7: sort by commissionSort. Undefined values sink to the bottom regardless of dir.
    var sortField = commissionSort.field || 'date';
    var sortDir = commissionSort.dir === 'asc' ? 1 : -1;
    function _valFor(c, f) {
      if (f === 'date') return c.createdAt || '';
      if (f === 'deadline') return c.targetDeadline || '';
      if (f === 'total') return (typeof c.quoteAmountCents === 'number') ? c.quoteAmountCents : null;
      if (f === 'piece') return (c.sourcePieceName || '').toLowerCase();
      if (f === 'customer') return (c.customerName || '').toLowerCase();
      if (f === 'status') return (c.status || '').toLowerCase();
      return '';
    }
    items.sort(function(a, b) {
      var av = _valFor(a, sortField);
      var bv = _valFor(b, sortField);
      var aMissing = (av === '' || av === null || av === undefined);
      var bMissing = (bv === '' || bv === null || bv === undefined);
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });

    // URL-filter banner — surfaces active MCP-link filters with Clear button.
    var bannerEl = document.getElementById('commissionsUrlFilterBanner');
    var tableEl = document.getElementById('commissionsTable');
    if (!bannerEl && hasUrlFilter && tableEl && tableEl.parentNode) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'commissionsUrlFilterBanner';
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      tableEl.parentNode.insertBefore(bannerEl, tableEl);
    }
    if (bannerEl) {
      if (hasUrlFilter) {
        var parts = [];
        if (urlIds.length) parts.push(urlIds.length + ' selected commission' + (urlIds.length === 1 ? '' : 's'));
        if (urlStatus) parts.push('status: ' + String(urlStatus).replace(/-/g, ' '));
        if (urlDateFrom && urlDateTo) parts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
        else if (urlDateFrom) parts.push('from ' + urlDateFrom + ' onward');
        else if (urlDateTo) parts.push('through ' + urlDateTo);
        bannerEl.innerHTML = '<span>🎨 Showing ' + parts.join(', ') + '</span>' +
          '<button type="button" onclick="clearCommissionsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
        bannerEl.style.display = 'flex';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    var countEl = document.getElementById('commissionsCount');
    if (countEl) countEl.textContent = items.length + ' inquir' + (items.length === 1 ? 'y' : 'ies');

    var emptyEl = document.getElementById('commissionsEmpty');
    var tableEl = document.getElementById('commissionsTable');

    if (items.length === 0) {
      if (emptyEl) emptyEl.style.display = '';
      if (tableEl) tableEl.style.display = 'none';
      return;
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    var statusColors = {
      'new': 'background:var(--gold);color:white;',
      'in-discussion': 'background:#42a5f5;color:white;',
      'accepted': 'background:#4caf50;color:white;',
      'declined': 'background:var(--warm-gray);color:white;',
      'built': 'background:#7e57c2;color:white;',
      'completed': 'background:var(--teal);color:white;'
    };

    // W1.7: render interactive status chip row. Active chip highlighted.
    var chipsEl = document.getElementById('commissionsStatusChips');
    if (chipsEl) {
      var currentFilter = (filterEl && filterEl.value) || 'all';
      var chipStatuses = ['all', 'new', 'in-discussion', 'accepted', 'built', 'completed', 'declined'];
      var chipHtml = chipStatuses.map(function(s) {
        var label = s === 'all' ? 'All' : s.replace(/-/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); });
        var isActive = currentFilter === s;
        var base = 'cursor:pointer;font-size:0.78rem;padding:4px 10px;border-radius:12px;border:1px solid var(--cream-dark);margin-right:6px;background:transparent;color:inherit;';
        if (isActive) {
          var activeStyle = statusColors[s] || 'background:var(--teal);color:white;';
          base = 'cursor:pointer;font-size:0.78rem;padding:4px 10px;border-radius:12px;border:1px solid transparent;margin-right:6px;' + activeStyle;
        }
        return '<button type="button" class="status-chip" data-status="' + esc(s) + '" onclick="setCommissionStatusFilter(\'' + esc(s) + '\')" style="' + base + '">' + esc(label) + '</button>';
      }).join('');
      chipsEl.innerHTML = chipHtml;
    }

    // W1.7: render sort indicators. Arrow on active column only.
    var sortFields = ['piece', 'customer', 'status', 'deadline', 'total', 'date'];
    sortFields.forEach(function(f) {
      var el = document.getElementById('commSort' + f.charAt(0).toUpperCase() + f.slice(1));
      if (el) el.textContent = (sortField === f) ? (sortDir === 1 ? '▲' : '▼') : '';
    });

    function _fmtMoney(cents) {
      if (typeof cents !== 'number') return '—';
      return '$' + (cents / 100).toFixed(2);
    }
    function _fmtDeadline(d) {
      if (!d) return '—';
      try {
        // Accept ISO date (YYYY-MM-DD) or full ISO. Render locale date.
        var dt = new Date(d.length === 10 ? d + 'T00:00:00' : d);
        if (isNaN(dt.getTime())) return esc(String(d));
        return dt.toLocaleDateString();
      } catch (e) { return esc(String(d)); }
    }

    var html = '';
    items.forEach(function(c) {
      var product = productsData.find(function(p) { return p.pid === c.sourcePieceId; });
      var imgSrc = product && product.images && product.images.length ? product.images[0] : '';
      // W1 Round 2 — Fix 5: align PIECE column empty-state with Deadline / Total $.
      var pieceName = c.sourcePieceName || (product ? product.name : '—');
      var statusLabel = (c.status || 'new').replace(/-/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); });
      var dateStr = c.createdAt ? new Date(c.createdAt).toLocaleDateString() : '—';
      var notes = c.notes || '';
      if (notes.length > 50) notes = notes.substring(0, 47) + '...';

      html += '<tr style="cursor:pointer;" onclick="viewCommissionDetail(\'' + esc(c.id) + '\')">' +
        '<td style="display:flex;align-items:center;gap:8px;">' +
          (imgSrc ? '<img src="' + esc(imgSrc) + '" style="width:32px;height:32px;border-radius:4px;object-fit:cover;">' : '') +
          '<span style="font-size:0.85rem;">' + esc(pieceName) + '</span>' +
        '</td>' +
        '<td style="font-size:0.85rem;">' + esc(c.customerName || '—') + '</td>' +
        '<td style="font-size:0.85rem;">' + esc(c.customerContact || '—') + '</td>' +
        '<td style="font-size:0.85rem;color:var(--warm-gray);">' + esc(notes) + '</td>' +
        '<td><span class="status-badge" style="' + (statusColors[c.status] || '') + 'font-size:0.72rem;">' + esc(statusLabel) + '</span></td>' +
        '<td style="font-size:0.85rem;">' + esc((c.channel || '').toUpperCase()) + '</td>' +
        '<td style="font-size:0.85rem;">' + esc(_fmtDeadline(c.targetDeadline)) + '</td>' +
        '<td style="font-size:0.85rem;">' + esc(_fmtMoney(c.quoteAmountCents)) + '</td>' +
        '<td style="font-size:0.85rem;">' + esc(dateStr) + '</td>' +
        '<td>' + (c.ticketId ? '<a href="#" onclick="event.stopPropagation();event.preventDefault();viewCommissionTicket(\'' + esc(c.ticketId) + '\')" style="color:var(--teal);font-size:0.85rem;white-space:nowrap;">View ticket →</a>' : '<span style="color:var(--warm-gray);font-size:0.85rem;">—</span>') + '</td>' +
      '</tr>';
    });
    document.getElementById('commissionsTableBody').innerHTML = html;
  }

  // W1.7: chip-driven status filter. Keeps the legacy select in sync.
  function setCommissionStatusFilter(s) {
    var sel = document.getElementById('commissionsStatusFilter');
    if (sel) sel.value = s;
    renderCommissions();
  }

  // W1.7: sortable column headers. Same-field click toggles direction.
  function setCommissionSort(field) {
    if (commissionSort.field === field) {
      commissionSort.dir = (commissionSort.dir === 'asc') ? 'desc' : 'asc';
    } else {
      commissionSort.field = field;
      // Default sensible direction per field: deadline asc, total/date desc.
      commissionSort.dir = (field === 'deadline' || field === 'piece' || field === 'customer' || field === 'status') ? 'asc' : 'desc';
    }
    renderCommissions();
  }

  // W2 R3 Fix 1: tab swap for commission detail. The tab buttons rendered
  // by viewCommissionDetail use inline onclick="setCommissionDetailTab(...)"
  // — that handler was never defined, so clicking Thread/Milestones/Money/
  // Terms threw ReferenceError and the body never swapped. Defines + exposes
  // on window so the inline onclick resolves; re-runs viewCommissionDetail
  // to re-render the body with the newly selected tab.
  function setCommissionDetailTab(commId, tabKey) {
    if (!commId || !tabKey) return;
    commDetailActiveTab = tabKey;
    viewCommissionDetail(commId);
  }

  function viewCommissionDetail(commId) {
    var c = commissionsData[commId];
    if (!c) return;
    c.id = commId;
    var product = productsData.find(function(p) { return p.pid === c.sourcePieceId; });
    var imgSrc = product && product.images && product.images.length ? product.images[0] : '';
    var pieceName = c.sourcePieceName || (product ? product.name : 'Unknown');
    var dateStr = c.createdAt ? new Date(c.createdAt).toLocaleString() : '—';

    // W3c — expanded status enum. Original values stay (back-compat for existing
    // rows); new values capture the full custom-order pipeline so a vendor doesn't
    // have to flatten "deposit paid" / "in fabrication" / "cold-shop" / "balance
    // invoiced" / "shipped" into one ambiguous "built" or "completed."
    var statusOptions = ['new', 'in-discussion', 'quoted', 'accepted', 'deposit-paid', 'design-locked', 'in-fabrication', 'cold-shop', 'balance-invoiced', 'shipped', 'built', 'delivered', 'followed-up', 'completed', 'declined', 'canceled'];
    var statusSelect = '<select id="commStatusSelect" onchange="updateCommissionStatus(\'' + esc(commId) + '\', this.value)" style="font-size:0.85rem;padding:6px 10px;border-radius:6px;border:1px solid var(--cream-dark);">';
    statusOptions.forEach(function(s) {
      var label = s.replace(/-/g, ' ').replace(/\b\w/g, function(l) { return l.toUpperCase(); });
      statusSelect += '<option value="' + s + '"' + (c.status === s ? ' selected' : '') + '>' + label + '</option>';
    });
    statusSelect += '</select>';

    // Inspiration pieces section
    var inspirationHtml = '';
    if (c.inspirationPieces && c.inspirationPieces.length) {
      var pieceThumbs = '';
      c.inspirationPieces.forEach(function(ip) {
        var inspProduct = productsData.find(function(p) { return p.pid === ip.pid; });
        var thumb = inspProduct && inspProduct.images && inspProduct.images.length ? inspProduct.images[0] : '';
        pieceThumbs += '<div style="text-align:center;">' +
          (thumb ? '<img src="' + esc(thumb) + '" style="width:64px;height:64px;border-radius:6px;object-fit:cover;">' : '') +
          '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:2px;">' + esc(ip.name || ip.pid) + '</div>' +
        '</div>';
      });
      inspirationHtml = '<span style="color:var(--warm-gray);">Inspiration</span><div style="display:flex;gap:10px;flex-wrap:wrap;">' + pieceThumbs + '</div>';
    }

    // Reference image section
    var refImageHtml = '';
    if (c.referenceImageUrl) {
      refImageHtml = '<span style="color:var(--warm-gray);">Reference</span><div><img src="' + esc(c.referenceImageUrl) + '" style="max-width:200px;max-height:200px;border-radius:8px;object-fit:cover;cursor:pointer;" onclick="window.open(this.src,\'_blank\')"></div>';
    }

    // Proposal section — visible when status is in-discussion or later
    var proposalSection = '';
    var showProposal = ['in-discussion', 'accepted', 'built', 'completed'].indexOf(c.status) !== -1;
    if (showProposal || c.proposalPrice || c.proposalTimeline || c.proposalSpec) {
      var hasProposal = c.proposalPrice || c.proposalTimeline || c.proposalSpec;
      proposalSection =
        '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:16px;">' +
          '<h4 style="margin:0 0 16px 0;font-size:1rem;">Proposal</h4>' +
          '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px 16px;font-size:0.9rem;">' +
            '<span style="color:var(--warm-gray);">Price</span>' +
            '<span><input type="text" id="commProposalPrice" value="' + esc(c.proposalPrice || '') + '" placeholder="e.g. $250" style="width:140px;padding:6px 8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;"></span>' +
            '<span style="color:var(--warm-gray);">Timeline</span>' +
            '<span><input type="text" id="commProposalTimeline" value="' + esc(c.proposalTimeline || '') + '" placeholder="e.g. 3-4 weeks" style="width:200px;padding:6px 8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;"></span>' +
            '<span style="color:var(--warm-gray);">Spec / Design Notes</span>' +
            '<span><textarea id="commProposalSpec" rows="4" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;resize:vertical;box-sizing:border-box;" placeholder="Describe the piece, materials, design details...">' + esc(c.proposalSpec || '') + '</textarea></span>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:14px;">' +
            '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="saveCommissionProposal(\'' + esc(commId) + '\')">Save Proposal</button>' +
            (hasProposal && c.customerContact ? '<button class="btn btn-primary" style="font-size:0.85rem;" onclick="sendCommissionProposal(\'' + esc(commId) + '\')">Send Proposal to Customer</button>' : '') +
          '</div>' +
          '<div id="commProposalStatus" style="margin-top:8px;font-size:0.85rem;"></div>' +
          (c.proposalSentAt ? '<div style="margin-top:8px;font-size:0.78rem;color:var(--warm-gray);">Proposal sent: ' + esc(new Date(c.proposalSentAt).toLocaleString()) + '</div>' : '') +
        '</div>';
    }

    // Documents section — visible when status is in-discussion or later
    var docsSection = '';
    var showDocs = ['in-discussion', 'accepted', 'built', 'completed'].indexOf(c.status) !== -1;
    var docs = c.documents ? Object.keys(c.documents).map(function(k) { var d = c.documents[k]; d.id = k; return d; }) : [];
    if (showDocs || docs.length > 0) {
      var docsListHtml = '';
      docs.sort(function(a, b) { return (b.addedAt || '').localeCompare(a.addedAt || ''); });
      docs.forEach(function(doc) {
        var icon = doc.type === 'drive' ? '&#x1F4C4;' : '&#x1F4CE;';
        var dateStr = doc.addedAt ? new Date(doc.addedAt).toLocaleDateString() : '';
        docsListHtml += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--cream-dark,#e8e0d4);font-size:0.85rem;">' +
          '<span style="font-size:1.15rem;">' + icon + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<a href="' + esc(doc.url || doc.webViewLink || '#') + '" target="_blank" style="color:var(--teal);text-decoration:none;font-weight:500;">' + esc(doc.name || 'Untitled') + '</a>' +
            (doc.mimeType ? '<span style="color:var(--warm-gray);font-size:0.78rem;margin-left:8px;">' + esc(doc.mimeType.split('/').pop()) + '</span>' : '') +
          '</div>' +
          '<span style="color:var(--warm-gray);font-size:0.78rem;white-space:nowrap;">' + esc(dateStr) + '</span>' +
          '<button class="btn-icon danger" style="padding:4px 6px;font-size:0.78rem;" onclick="event.stopPropagation();removeCommissionDoc(\'' + esc(commId) + '\',\'' + esc(doc.id) + '\')" title="Remove">&times;</button>' +
        '</div>';
      });

      docsSection =
        '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:16px;">' +
          '<h4 style="margin:0 0 12px 0;font-size:1rem;">Documents</h4>' +
          (docsListHtml ? '<div style="margin-bottom:16px;">' + docsListHtml + '</div>' : '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 16px 0;">No documents attached yet.</p>') +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="openCommissionDocLinkModal(\'' + esc(commId) + '\')">+ Link Google Doc</button>' +
            '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="openCommissionDocUploadModal(\'' + esc(commId) + '\')">+ Upload File</button>' +
          '</div>' +
        '</div>';
    }

    // Production job link — visible when accepted
    var jobSection = '';
    if (c.status === 'accepted' && !c.productionJobId) {
      jobSection =
        '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:16px;">' +
          '<h4 style="margin:0 0 8px 0;font-size:1rem;">Production</h4>' +
          '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 12px 0;">Customer accepted — create a production job to track the build.</p>' +
          '<button class="btn btn-primary" style="font-size:0.85rem;" onclick="createCommissionJob(\'' + esc(commId) + '\')">Create Production Job</button>' +
        '</div>';
    } else if (c.productionJobId) {
      jobSection =
        '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:16px;">' +
          '<h4 style="margin:0 0 8px 0;font-size:1rem;">Production</h4>' +
          '<p style="font-size:0.85rem;margin:0;">Linked to production job. <a href="#" onclick="event.preventDefault();navigateTo(\'production\')" style="color:var(--teal);">View in Production</a></p>' +
        '</div>';
    }

    // W2.1: header (always-visible) + tabbed body. Tabs: Spec / Thread /
    // Milestones / Money / Terms. Spec preserves the legacy surface; the
    // CS-ticket link moved into the Thread tab (rendered inline).
    var headerHtml =
    '<button class="detail-back" onclick="closeCommissionDetail()">&larr; Back to Custom Orders</button>' +
    '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
      '<div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:20px;">' +
        (imgSrc ? '<img src="' + esc(imgSrc) + '" style="width:80px;height:80px;border-radius:8px;object-fit:cover;">' : '') +
        '<div>' +
          '<h3 style="margin:0 0 4px 0;font-size:1.15rem;">' + esc(pieceName) + '</h3>' +
          '<div style="font-size:0.85rem;color:var(--warm-gray);">Commission Inquiry</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px 16px;font-size:0.9rem;">' +
        '<span style="color:var(--warm-gray);">Customer</span><span>' + esc(c.customerName || '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Contact</span><span>' + esc(c.customerContact || '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Channel</span><span>' + esc((c.channel || '').toUpperCase()) + '</span>' +
        '<span style="color:var(--warm-gray);">Date</span><span>' + esc(dateStr) + '</span>' +
        '<span style="color:var(--warm-gray);">Status</span><span>' + statusSelect + '</span>' +
        '<span style="color:var(--warm-gray);">Notes</span><span style="white-space:pre-wrap;">' + esc(c.notes || '—') + '</span>' +
        inspirationHtml +
        refImageHtml +
      '</div>' +
    '</div>';

    // MastFlow-managed workflow header (stepper + checklist + Advance/Back).
    // Rendered async after this innerHTML write — see _initCommissionWorkflowHeader.
    // The legacy _renderCommissionPhaseStepper is now unused but retained
    // for back-compat until pick/ship validates the MastFlow abstraction.
    var stepperHtml = '<div id="commWorkflowHeader" style="margin-top:14px;font-size:0.85rem;color:var(--warm-gray);">Loading workflow…</div>';

    var tabs = [
      { key: 'spec',       label: 'Spec' },
      { key: 'thread',     label: 'Thread' + (c.ticketId ? '' : ' (—)') },
      { key: 'milestones', label: 'Milestones' },
      { key: 'money',      label: 'Money' },
      { key: 'terms',      label: 'Terms' }
    ];
    var tabBarHtml = stepperHtml + '<div style="display:flex;gap:4px;margin-top:16px;border-bottom:1px solid var(--cream-dark,#e8e0d4);">';
    tabs.forEach(function(t) {
      var isActive = commDetailActiveTab === t.key;
      tabBarHtml += '<button type="button" style="background:none;border:none;border-bottom:2px solid ' +
        (isActive ? 'var(--teal)' : 'transparent') +
        ';color:' + (isActive ? 'var(--teal)' : 'var(--warm-gray)') +
        ';padding:8px 14px;font-size:0.9rem;cursor:pointer;font-weight:' + (isActive ? '600' : '400') + ';" ' +
        'onclick="setCommissionDetailTab(\'' + _jsAttr(commId) + '\',\'' + _jsAttr(t.key) + '\')">' +
        esc(t.label) + '</button>';
    });
    tabBarHtml += '</div>';

    var bodyHtml = '<div id="commTabBody" style="margin-top:16px;">';
    if (commDetailActiveTab === 'spec') {
      bodyHtml += proposalSection + docsSection + jobSection;
    } else if (commDetailActiveTab === 'thread') {
      bodyHtml += _renderCommissionThreadTab(commId, c);
    } else if (commDetailActiveTab === 'milestones') {
      bodyHtml += _renderCommissionMilestonesTab(commId, c);
    } else if (commDetailActiveTab === 'money') {
      bodyHtml += _renderCommissionMoneyTab(commId, c);
    } else if (commDetailActiveTab === 'terms') {
      bodyHtml += _renderCommissionTermsTab(commId, c);
    }
    bodyHtml += '</div>';

    document.getElementById('commissionDetailView').innerHTML = headerHtml + tabBarHtml + bodyHtml;
    document.getElementById('commissionDetailView').style.display = '';
    document.getElementById('commissionsListView').style.display = 'none';

    // Async loads for tabs that need them.
    if (commDetailActiveTab === 'thread' && c.ticketId) {
      _loadCommissionThread(commId, c.ticketId);
    } else if (commDetailActiveTab === 'milestones') {
      _loadCommissionMilestones(commId);
    }

    // MastFlow workflow header — async init (loads engine + spec on first
    // open, registers target resolvers, subscribes to record, renders).
    _initCommissionWorkflowHeader(commId);
  }

  // ===== MastFlow integration =====
  // One-time flags so we don't re-register resolvers / re-load modules
  // every time the detail view re-renders.
  var _mfResolversRegistered = false;
  var _mfActiveSubscription = null;  // { commId, off }

  function _initCommissionWorkflowHeader(commId) {
    if (!window.MastAdmin || typeof MastAdmin.loadModule !== 'function') return;
    // Sequential load: engine must finish parsing (so window.MastFlow is set)
    // BEFORE the spec runs, because the spec's IIFE bails early if MastFlow
    // isn't on window yet. Parallel Promise.all() races on small specs that
    // load faster than the engine.
    MastAdmin.loadModule('workflowEngine').then(function() {
      return MastAdmin.loadModule('commissionsWorkflow');
    }).then(function() {
      if (!window.MastFlow) return;
      _registerCommissionTargetResolvers();
      _subscribeCommissionRecord(commId);
      _renderWorkflowHeaderInto(commId);
    }).catch(function(err) {
      console.error('[commissions] MastFlow init failed:', err);
      var host = document.getElementById('commWorkflowHeader');
      if (host) host.innerHTML = '<span style="color:var(--danger,#b81d1d);">Workflow header failed to load.</span>';
    });
  }

  function _registerCommissionTargetResolvers() {
    if (_mfResolversRegistered || !window.MastFlow) return;
    // Each target id from commissions.workflow.js maps to a focus behavior.
    // Tab IDs map to setCommissionDetailTab + scroll.
    var TAB_TARGETS = {
      'header-contact':           { tab: 'spec', scrollTo: null },
      'header-notes':             { tab: 'spec', scrollTo: null },
      'spec-tab-proposal-price':  { tab: 'spec', scrollTo: 'commProposalPrice' },
      'spec-tab-proposal-spec':   { tab: 'spec', scrollTo: 'commProposalSpec' },
      'spec-tab-proposal-timeline': { tab: 'spec', scrollTo: 'commProposalTimeline' },
      'spec-tab-proposal-send':   { tab: 'spec', scrollTo: 'commProposalStatus' },
      'spec-tab-create-job':      { tab: 'spec', scrollTo: null },
      'spec-tab-tracking':        { tab: 'spec', scrollTo: null },
      'money-tab':                { tab: 'money', scrollTo: null },
      'money-tab-send-invoice':   { tab: 'money', scrollTo: null },
      'money-tab-record-payment': { tab: 'money', scrollTo: null },
      'milestones-tab':           { tab: 'milestones', scrollTo: null },
      'thread-tab':               { tab: 'thread', scrollTo: null }
    };
    Object.keys(TAB_TARGETS).forEach(function(tid) {
      MastFlow.registerTargetResolver('commissions', tid, function() {
        var t = TAB_TARGETS[tid];
        var currentCommId = _mfActiveSubscription && _mfActiveSubscription.commId;
        if (!currentCommId) return;
        if (t.tab && t.tab !== commDetailActiveTab) {
          setCommissionDetailTab(currentCommId, t.tab);
        }
        if (t.scrollTo) {
          setTimeout(function() {
            var el = document.getElementById(t.scrollTo);
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              if (typeof el.focus === 'function') el.focus();
            }
          }, 50);
        }
      });
    });
    _mfResolversRegistered = true;
  }

  function _subscribeCommissionRecord(commId) {
    // Replace any prior subscription.
    if (_mfActiveSubscription && _mfActiveSubscription.off) {
      try { _mfActiveSubscription.off(); } catch (e) {}
    }
    var off = MastDB.subscribe('admin/commissions/' + commId, function(snapValue) {
      if (!snapValue) return;
      var prev = commissionsData[commId] || {};
      // Merge — preserve client-only fields like _milestonesCount.
      var merged = Object.assign({}, prev, snapValue, { id: commId });
      commissionsData[commId] = merged;
      // Only re-render the workflow header on live updates (don't blow away
      // the whole detail view — the user could be typing in a field).
      _renderWorkflowHeaderInto(commId);
    });
    _mfActiveSubscription = { commId: commId, off: off };
  }

  function _renderWorkflowHeaderInto(commId) {
    var c = commissionsData[commId];
    if (!c || !window.MastFlow) return;
    c.id = commId;
    var host = document.getElementById('commWorkflowHeader');
    if (!host) return;
    MastFlow.renderHeader('commissions', c, {
      onAdvance: function(targetPhaseKey) {
        _doCommissionTransition(commId, targetPhaseKey, { expectedFromPhase: c.__workflow && c.__workflow.phase || null });
      },
      onBack: function(targetPhaseKey) {
        _doCommissionTransition(commId, targetPhaseKey, { expectedFromPhase: c.__workflow && c.__workflow.phase || null });
      },
      onForce: function() {
        var reason = window.prompt('Force-advance reason (will be audited):');
        if (!reason) return;
        // Force-advance to the next phase if there is one.
        MastFlow.evaluate('commissions', c).then(function(ev) {
          var target = ev.nextPhases[0];
          if (!target) { showToast('No next phase available to force.'); return; }
          _doCommissionTransition(commId, target, {
            expectedFromPhase: ev.currentPhase ? ev.currentPhase.key : null,
            force: true,
            reason: reason
          });
        });
      }
    }).then(function(res) {
      host.innerHTML = res.html;
      // Deep-link: ?focus=<phaseKey> scrolls the header into view + pulses
      // the target step (e.g. from a "stuck in Quoted" dashboard link).
      var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
      if (rp && rp.focus) MastFlow.focusPhase('commWorkflowHeader', rp.focus);
    }).catch(function(err) {
      console.error('[commissions] renderHeader failed:', err);
      host.innerHTML = '<span style="color:var(--danger,#b81d1d);">Workflow header error.</span>';
    });
  }

  function _doCommissionTransition(commId, targetPhaseKey, opts) {
    var c = commissionsData[commId];
    if (!c) return;
    c.id = commId;
    opts = Object.assign({ recordId: commId }, opts || {});
    MastFlow.transition('commissions', c, targetPhaseKey, opts).then(function(res) {
      showToast('Advanced to ' + res.to);
      emitTestingEvent('commissionPhase', { from: res.from, to: res.to, forced: !!opts.force });
      // Also fire the legacy CS-thread system message that the old
      // updateCommissionStatus did, since callers downstream depend on it.
      var c2 = commissionsData[commId];
      if (c2 && c2.ticketId && c2.status && COMMISSION_STATUS_MESSAGES[c2.status]) {
        var now = new Date().toISOString();
        var msgId = 'msg_' + Date.now().toString(36);
        MastDB.set('cs_tickets/' + c2.ticketId + '/messages/' + msgId, {
          id: msgId,
          body: COMMISSION_STATUS_MESSAGES[c2.status],
          direction: 'outbound',
          isInternal: false,
          authorName: 'System',
          authorEmail: null,
          createdAt: now
        }).then(function() {
          return MastDB.update('cs_tickets/' + c2.ticketId, { updatedAt: now });
        }).catch(function(e) { console.error('[commissions] thread msg post failed:', e); });
      }
      // Re-render the detail view (also re-renders header via subscription).
      viewCommissionDetail(commId);
    }).catch(function(err) {
      if (err.code === 'STALE_STATE') {
        showToast('Another operator changed this order — refreshed.', true);
        // Re-load the record + re-render.
        MastDB.commissions.get(commId).then(function(fresh) {
          if (fresh) commissionsData[commId] = Object.assign({}, fresh, { id: commId });
          viewCommissionDetail(commId);
        });
      } else if (err.code === 'REQUIREMENTS_UNMET') {
        showToast('Requirements not met — see checklist.', true);
      } else if (err.code === 'SPEC_MISMATCH') {
        showToast('Workflow updated — manual review needed.', true);
      } else {
        console.error('[commissions] transition failed:', err);
        showToast('Transition failed: ' + (err.message || err), true);
      }
    });
  }

  // ===== D6 — Phase stepper above commission detail tabs =====
  // Maps the 16-value c.status enum into 7 visible phases. Each phase lists
  // every status that should light it up; the first phase whose statuses
  // include c.status is the current one.
  var COMMISSION_PHASES = [
    { key: 'inquiry',    label: 'Inquiry',    statuses: ['new', 'in-discussion'] },
    { key: 'quoted',     label: 'Quoted',     statuses: ['quoted'] },
    { key: 'accepted',   label: 'Accepted',   statuses: ['accepted', 'deposit-paid'] },
    { key: 'making',     label: 'In progress', statuses: ['design-locked', 'in-fabrication', 'cold-shop'] },
    { key: 'invoiced',   label: 'Invoiced',   statuses: ['balance-invoiced'] },
    { key: 'shipped',    label: 'Shipped',    statuses: ['shipped', 'built'] },
    { key: 'delivered',  label: 'Delivered',  statuses: ['delivered', 'followed-up', 'completed'] }
  ];
  function _commissionPhaseIndex(status) {
    if (!status) return 0;
    for (var i = 0; i < COMMISSION_PHASES.length; i++) {
      if (COMMISSION_PHASES[i].statuses.indexOf(status) !== -1) return i;
    }
    return -1; // unknown / terminal-failure status
  }
  function _renderCommissionPhaseStepper(c) {
    var status = c.status || 'new';
    // Terminal-failure states get a single pill instead of a stepper.
    if (status === 'declined' || status === 'canceled') {
      var label = status.charAt(0).toUpperCase() + status.slice(1);
      return '<div style="margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(220,38,38,0.08);color:var(--danger,#b81d1d);font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;">' +
        '✕ ' + label +
      '</div>';
    }
    var currentIdx = _commissionPhaseIndex(status);
    var html = '<div style="margin-top:14px;display:flex;align-items:center;gap:0;overflow-x:auto;padding-bottom:4px;" aria-label="Commission progress" role="list">';
    COMMISSION_PHASES.forEach(function(p, i) {
      var state = i < currentIdx ? 'done' : (i === currentIdx ? 'current' : 'upcoming');
      var dotBg, dotColor, dotBorder, labelColor, labelWeight;
      if (state === 'done') {
        dotBg = 'var(--teal)'; dotColor = '#fff'; dotBorder = 'var(--teal)';
        labelColor = 'var(--teal)'; labelWeight = '600';
      } else if (state === 'current') {
        dotBg = '#fff'; dotColor = 'var(--teal)'; dotBorder = 'var(--teal)';
        labelColor = 'var(--teal)'; labelWeight = '700';
      } else {
        dotBg = 'transparent'; dotColor = 'var(--warm-gray)'; dotBorder = 'var(--cream-dark)';
        labelColor = 'var(--warm-gray)'; labelWeight = '500';
      }
      // Connector line to the next phase (skip after last).
      var connector = '';
      if (i < COMMISSION_PHASES.length - 1) {
        var lineColor = i < currentIdx ? 'var(--teal)' : 'var(--cream-dark)';
        connector = '<div style="flex:1;height:2px;background:' + lineColor + ';min-width:18px;"></div>';
      }
      var glyph = state === 'done' ? '✓' : String(i + 1);
      html += '<div role="listitem" style="display:flex;align-items:center;gap:6px;flex-shrink:0;" title="' + esc(p.label) + '">' +
        '<div style="width:22px;height:22px;border-radius:50%;background:' + dotBg + ';color:' + dotColor + ';border:2px solid ' + dotBorder + ';display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;flex-shrink:0;">' + glyph + '</div>' +
        '<span style="font-size:0.78rem;color:' + labelColor + ';font-weight:' + labelWeight + ';white-space:nowrap;">' + esc(p.label) + '</span>' +
      '</div>' + connector;
    });
    html += '</div>';
    return html;
  }

  // ===== W2.1: Thread tab — inline CS-ticket messages =====
  function _renderCommissionThreadTab(commId, c) {
    if (!c.ticketId) {
      return '<div style="background:var(--cream);border-radius:8px;padding:24px;color:var(--warm-gray);font-size:0.9rem;">' +
        'No customer-service thread linked to this commission yet.' +
      '</div>';
    }
    var msgs = commThreadCache[c.ticketId];
    if (!msgs) {
      return '<div style="background:var(--cream);border-radius:8px;padding:24px;color:var(--warm-gray);font-size:0.9rem;">Loading thread…</div>';
    }
    if (!msgs.length) {
      return '<div style="background:var(--cream);border-radius:8px;padding:24px;color:var(--warm-gray);font-size:0.9rem;">' +
        'Thread exists but has no messages yet. ' +
        '<a href="#" onclick="event.preventDefault();viewCommissionTicket(\'' + _jsAttr(c.ticketId) + '\',\'' + _jsAttr(commId) + '\')" style="color:var(--teal);">Open in CS Tickets &rarr;</a>' +
      '</div>';
    }
    var rows = msgs.map(function(m) {
      var who = esc(m.authorName || m.authorEmail || (m.direction === 'inbound' ? (c.customerName || 'Customer') : 'Team'));
      var when = m.createdAt ? new Date(m.createdAt).toLocaleString() : '';
      var dirChip = m.direction === 'inbound' ? 'IN' : (m.direction === 'outbound' ? 'OUT' : '—');
      var noteFlag = m.isInternal ? ' <span style="background:#fffbe6;color:#a67c00;padding:1px 6px;border-radius:4px;font-size:0.72rem;">internal</span>' : '';
      return '<div style="border-bottom:1px solid var(--cream-dark);padding:10px 0;">' +
        '<div style="display:flex;gap:8px;align-items:center;font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">' +
          '<span style="background:var(--cream-dark);padding:1px 6px;border-radius:4px;">' + esc(dirChip) + '</span>' +
          '<strong style="color:var(--text);">' + who + '</strong>' +
          noteFlag +
          '<span style="margin-left:auto;">' + esc(when) + '</span>' +
        '</div>' +
        '<div style="font-size:0.9rem;white-space:pre-wrap;">' + esc(m.body || '') + '</div>' +
      '</div>';
    }).join('');
    return '<div style="background:var(--cream);border-radius:8px;padding:24px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<h4 style="margin:0;font-size:1rem;">CS Thread</h4>' +
        '<a href="#" onclick="event.preventDefault();viewCommissionTicket(\'' + _jsAttr(c.ticketId) + '\',\'' + _jsAttr(commId) + '\')" style="color:var(--teal);font-size:0.85rem;">Open in CS Tickets &rarr;</a>' +
      '</div>' +
      rows +
    '</div>';
  }

  async function _loadCommissionThread(commId, ticketId) {
    try {
      var ticket = await MastDB.get('cs_tickets/' + ticketId);
      var msgs = (ticket && ticket.messages) ? Object.values(ticket.messages) : [];
      msgs.sort(function(a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });
      commThreadCache[ticketId] = msgs;
    } catch (err) {
      console.error('[commission] load thread:', err);
      commThreadCache[ticketId] = [];
    }
    var c = commissionsData[commId];
    if (c && commDetailActiveTab === 'thread') {
      var bodyEl = document.getElementById('commTabBody');
      if (bodyEl) bodyEl.innerHTML = _renderCommissionThreadTab(commId, c);
    }
  }

  // ===== W2.2: Milestones tab + Post Milestone modal =====
  var COMMISSION_MILESTONE_STAGES = [
    { key: 'kickoff',          label: 'Kickoff',          tmpl: 'Hi {customerName}, we\'re kicking off your custom piece. Expect updates as the work progresses.' },
    { key: 'design-locked',    label: 'Design locked',    tmpl: 'Quick update — the design is now locked and we\'re moving to fabrication.' },
    { key: 'in-fabrication',   label: 'In fabrication',   tmpl: 'Fabrication is underway. We\'ll share a WIP photo soon.' },
    { key: 'wip-photo',        label: 'WIP photo',        tmpl: 'Here\'s a work-in-progress photo of your piece.' },
    { key: 'cold-shop',        label: 'Cold-shop',        tmpl: 'The piece is out of the hot shop and in cold-shop finishing.' },
    { key: 'balance-invoiced', label: 'Balance invoiced', tmpl: 'Your balance invoice is on its way separately. Once paid, we\'ll ship.' },
    { key: 'ready-to-ship',    label: 'Ready to ship',    tmpl: 'Your piece is finished and ready to ship.' },
    { key: 'shipped',          label: 'Shipped',          tmpl: 'Your piece has shipped! Tracking details to follow.' },
    { key: 'delivered',        label: 'Delivered',        tmpl: 'Tracking shows your piece has arrived. We hope you love it.' }
  ];

  function _milestoneStageLabel(key) {
    for (var i = 0; i < COMMISSION_MILESTONE_STAGES.length; i++) {
      if (COMMISSION_MILESTONE_STAGES[i].key === key) return COMMISSION_MILESTONE_STAGES[i].label;
    }
    return key;
  }

  function _renderCommissionMilestonesTab(commId, c) {
    var ms = commMilestonesCache[commId];
    var listHtml;
    if (!ms) {
      listHtml = '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading milestones…</div>';
    } else if (!ms.length) {
      listHtml = '<div style="color:var(--warm-gray);font-size:0.9rem;">No milestones posted yet.</div>';
    } else {
      listHtml = ms.map(function(m) {
        var photo = m.photoUrl ? '<img src="' + esc(m.photoUrl) + '" style="max-width:180px;max-height:180px;border-radius:6px;object-fit:cover;margin-top:8px;">' : '';
        var when = m.postedAt ? new Date(m.postedAt).toLocaleString() : '';
        var sent = m.emailQueuedAt ? '<span style="color:var(--teal);font-size:0.72rem;margin-left:8px;">emailed</span>' : '';
        return '<div style="border-bottom:1px solid var(--cream-dark);padding:12px 0;">' +
          '<div style="display:flex;gap:8px;align-items:center;font-size:0.85rem;">' +
            '<strong>' + esc(_milestoneStageLabel(m.stage)) + '</strong>' +
            sent +
            '<span style="margin-left:auto;color:var(--warm-gray);font-size:0.78rem;">' + esc(when) + '</span>' +
          '</div>' +
          (m.copyHtml ? '<div style="font-size:0.9rem;white-space:pre-wrap;margin-top:4px;">' + esc(m.copyHtml) + '</div>' : '') +
          photo +
        '</div>';
      }).join('');
    }
    return '<div style="background:var(--cream);border-radius:8px;padding:24px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
        '<h4 style="margin:0;font-size:1rem;">Milestones</h4>' +
        '<button class="btn btn-primary" style="font-size:0.85rem;" onclick="openCommissionMilestoneModal(\'' + _jsAttr(commId) + '\')">+ Post Milestone</button>' +
      '</div>' +
      listHtml +
    '</div>';
  }

  async function _loadCommissionMilestones(commId) {
    try {
      var snap = await MastDB.get('admin/commissions/' + commId + '/milestones');
      var ms = snap ? Object.keys(snap).map(function(k) { var m = snap[k]; m.id = k; return m; }) : [];
      ms.sort(function(a, b) { return (b.postedAt || '').localeCompare(a.postedAt || ''); });
      commMilestonesCache[commId] = ms;
    } catch (err) {
      console.error('[commission] load milestones:', err);
      commMilestonesCache[commId] = [];
    }
    var c = commissionsData[commId];
    // Feed denormalized count onto the record so the MastFlow "milestone
    // posted" requirement predicate can evaluate synchronously without
    // re-reading Firebase.
    if (c) c._milestonesCount = (commMilestonesCache[commId] || []).length;
    if (c && commDetailActiveTab === 'milestones') {
      var bodyEl = document.getElementById('commTabBody');
      if (bodyEl) bodyEl.innerHTML = _renderCommissionMilestonesTab(commId, c);
    }
    // Milestone count changed → re-render workflow header so the chip + checklist update.
    if (c && window.MastFlow && _mfActiveSubscription && _mfActiveSubscription.commId === commId) {
      _renderWorkflowHeaderInto(commId);
    }
  }

  function openCommissionMilestoneModal(commId) {
    var c = commissionsData[commId];
    if (!c) return;
    var stageOpts = COMMISSION_MILESTONE_STAGES.map(function(s) {
      return '<option value="' + esc(s.key) + '">' + esc(s.label) + '</option>';
    }).join('');
    var defaultTmpl = COMMISSION_MILESTONE_STAGES[0].tmpl.replace('{customerName}', c.customerName || 'there');
    var hasEmail = c.customerContact && c.customerContact.indexOf('@') !== -1;
    var html =
      '<div class="modal-body" style="max-width:500px;">' +
        '<h3 style="margin-top:0;">Post Milestone</h3>' +
        '<div class="form-group">' +
          '<label>Stage</label>' +
          '<select id="commMilestoneStage" onchange="onCommMilestoneStageChange(\'' + _jsAttr(commId) + '\')">' + stageOpts + '</select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Photo (optional)</label>' +
          '<input type="file" id="commMilestonePhoto" accept="image/*">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Copy</label>' +
          '<textarea id="commMilestoneCopy" rows="4" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;resize:vertical;box-sizing:border-box;">' + esc(defaultTmpl) + '</textarea>' +
        '</div>' +
        '<div class="form-group">' +
          '<label style="display:flex;gap:8px;align-items:center;font-size:0.9rem;">' +
            '<input type="checkbox" id="commMilestoneSendEmail" ' + (hasEmail ? 'checked' : 'disabled') + '> Send to client' +
            (hasEmail ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">(' + esc(c.customerContact) + ')</span>'
                      : ' <span style="color:#a67c00;font-size:0.78rem;">(no email on file)</span>') +
          '</label>' +
        '</div>' +
        '<div id="commMilestoneStatus" style="margin-top:8px;font-size:0.85rem;"></div>' +
        '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-primary" id="commMilestoneSubmit" onclick="submitCommissionMilestone(\'' + _jsAttr(commId) + '\')">Post</button>' +
        '</div>' +
      '</div>';
    openModal(html);
  }
  window.openCommissionMilestoneModal = openCommissionMilestoneModal;

  function onCommMilestoneStageChange(commId) {
    var c = commissionsData[commId];
    var stageEl = document.getElementById('commMilestoneStage');
    var copyEl = document.getElementById('commMilestoneCopy');
    if (!stageEl || !copyEl || !c) return;
    var stageDef = COMMISSION_MILESTONE_STAGES.find(function(s) { return s.key === stageEl.value; });
    if (stageDef) copyEl.value = stageDef.tmpl.replace('{customerName}', c.customerName || 'there');
  }
  window.onCommMilestoneStageChange = onCommMilestoneStageChange;

  function _commSha1Hex(s) {
    var enc = new TextEncoder().encode(s);
    return crypto.subtle.digest('SHA-1', enc).then(function(buf) {
      var bytes = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        if (h.length < 2) h = '0' + h;
        hex += h;
      }
      return hex;
    });
  }

  async function submitCommissionMilestone(commId) {
    var c = commissionsData[commId];
    if (!c) return;
    var stage = document.getElementById('commMilestoneStage').value;
    var copyHtml = document.getElementById('commMilestoneCopy').value.trim();
    var sendEmailEl = document.getElementById('commMilestoneSendEmail');
    var sendEmail = sendEmailEl && sendEmailEl.checked && !sendEmailEl.disabled;
    var fileEl = document.getElementById('commMilestonePhoto');
    var file = fileEl && fileEl.files && fileEl.files[0];
    var statusEl = document.getElementById('commMilestoneStatus');
    var submitBtn = document.getElementById('commMilestoneSubmit');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Posting…'; }

    try {
      var milestoneId = 'mst_' + Date.now().toString(36);
      var photoUrl = null;
      if (file) {
        if (statusEl) statusEl.textContent = 'Uploading photo…';
        var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
        var path = MastDB.storagePath('commissions/' + commId + '/milestones/' + milestoneId + '.' + ext);
        var ref = firebase.storage().ref(path);
        var task = ref.put(file);
        await new Promise(function(res, rej) { task.on('state_changed', null, rej, res); });
        photoUrl = await task.snapshot.ref.getDownloadURL();
      }

      var now = new Date().toISOString();
      var user = firebase.auth().currentUser;
      var postedBy = (user && (user.email || user.uid)) || null;

      var milestone = {
        stage: stage,
        postedAt: now,
        photoUrl: photoUrl,
        copyHtml: copyHtml,
        postedBy: postedBy
      };
      await MastDB.set('admin/commissions/' + commId + '/milestones/' + milestoneId, milestone);

      // Bump commission status if the stage implies one.
      var statusEnum = ['design-locked', 'in-fabrication', 'cold-shop', 'balance-invoiced', 'shipped', 'delivered'];
      var statusUpdate = (statusEnum.indexOf(stage) !== -1 && c.status !== stage) ? stage : null;
      if (statusUpdate) {
        await MastDB.commissions.update(commId, { status: statusUpdate, updatedAt: now });
        commissionsData[commId].status = statusUpdate;
      }

      if (sendEmail && c.customerContact && c.customerContact.indexOf('@') !== -1) {
        if (statusEl) statusEl.textContent = 'Queuing email…';
        var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || '';
        var brandName = (window.TENANT_CONFIG && window.TENANT_CONFIG.brand && window.TENANT_CONFIG.brand.name) || 'The Team';
        var idemSeed = tenantId + '|' + commId + '|' + stage + '|' + Date.now();
        var idempotencyKey = await _commSha1Hex(idemSeed);
        var subject = brandName + ' — ' + _milestoneStageLabel(stage) + ' update on your commission';
        var photoBlock = photoUrl ? '<p><img src="' + esc(photoUrl) + '" style="max-width:400px;border-radius:6px;"></p>' : '';
        var htmlBody =
          '<p>Hi ' + esc(c.customerName || 'there') + ',</p>' +
          '<p>' + esc(copyHtml).replace(/\n/g, '<br>') + '</p>' +
          photoBlock +
          '<p>— ' + esc(brandName) + '</p>';
        await MastDB.set('emailQueue/' + idempotencyKey, {
          id: idempotencyKey,
          emailType: 'commission_milestone',
          to: c.customerContact,
          toName: c.customerName || null,
          subject: subject,
          htmlBody: htmlBody,
          fromName: brandName,
          idempotencyKey: idempotencyKey,
          queuedAt: now,
          queuedBy: postedBy,
          status: 'queued',
          attemptCount: 0,
          meta: { commissionId: commId, milestoneId: milestoneId, stage: stage, photoUrl: photoUrl }
        });
        await MastDB.update('admin/commissions/' + commId + '/milestones/' + milestoneId, { emailQueuedAt: now, emailIdempotencyKey: idempotencyKey });
        milestone.emailQueuedAt = now;
        milestone.emailIdempotencyKey = idempotencyKey;
      }

      await writeAudit('create', 'commissionMilestone', milestoneId);
      closeModal();
      showToast('Milestone posted' + (sendEmail && c.customerContact && c.customerContact.indexOf('@') !== -1 ? ' — email queued' : ''));
      delete commMilestonesCache[commId];
      _loadCommissionMilestones(commId);
      if (statusUpdate) viewCommissionDetail(commId);
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = '#ef5350'; }
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Post'; }
    }
  }
  window.submitCommissionMilestone = submitCommissionMilestone;

  // ===== W2.1: Money tab =====
  function _renderCommissionMoneyTab(commId, c) {
    function _money(cents) {
      if (cents == null || isNaN(cents)) return '—';
      return '$' + (cents / 100).toFixed(2);
    }
    var quote = c.quoteAmountCents;
    var deposit = c.depositAmountCents;
    var balance = (quote != null && deposit != null) ? (quote - deposit) : null;
    var rows = [
      ['Quote (total)',     _money(quote)],
      ['Deposit',           _money(deposit) + (c.depositPaidAt ? ' <span style="color:var(--teal);font-size:0.78rem;">paid ' + esc(new Date(c.depositPaidAt).toLocaleDateString()) + '</span>' : '')],
      ['Balance remaining', _money(balance)],
      ['Balance invoiced',  c.balanceInvoicedAt ? esc(new Date(c.balanceInvoicedAt).toLocaleDateString()) : '—'],
      ['Balance paid',      c.balancePaidAt ? esc(new Date(c.balancePaidAt).toLocaleDateString()) : '—']
    ];
    var html = '<div style="background:var(--cream);border-radius:8px;padding:24px;">' +
      '<h4 style="margin:0 0 12px 0;font-size:1rem;">Money</h4>' +
      '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.9rem;">';
    rows.forEach(function(r) {
      html += '<span style="color:var(--warm-gray);">' + esc(r[0]) + '</span><span>' + r[1] + '</span>';
    });
    html += '</div></div>';
    return html;
  }

  // ===== W2.1: Terms tab =====
  function _renderCommissionTermsTab(commId, c) {
    var content;
    if (c.acceptedTermsVersionId) {
      var when = c.acceptedAt ? new Date(c.acceptedAt).toLocaleString() : '';
      content =
        '<div style="font-size:0.9rem;">' +
          '<span style="background:#e8f5e9;color:#2e7d32;padding:3px 10px;border-radius:12px;font-size:0.78rem;font-weight:600;">Accepted</span> ' +
          'version <strong>' + esc(c.acceptedTermsVersionId) + '</strong>' +
          (when ? ' on ' + esc(when) : '') +
        '</div>';
    } else {
      content =
        '<div style="font-size:0.9rem;color:var(--warm-gray);margin-bottom:12px;">Customer has not yet accepted the commission terms.</div>' +
        '<button class="btn btn-primary" style="font-size:0.85rem;" onclick="sendCommissionTermsToken(\'' + _jsAttr(commId) + '\')">Send Terms</button>' +
        '<div id="commTermsStatus" style="margin-top:8px;font-size:0.85rem;"></div>';
    }
    return '<div style="background:var(--cream);border-radius:8px;padding:24px;">' +
      '<h4 style="margin:0 0 12px 0;font-size:1rem;">Commission Terms</h4>' +
      content +
    '</div>';
  }

  async function sendCommissionTermsToken(commId) {
    var c = commissionsData[commId];
    if (!c) return;
    var statusEl = document.getElementById('commTermsStatus');
    if (!c.customerContact || c.customerContact.indexOf('@') === -1) {
      if (statusEl) { statusEl.textContent = 'No customer email on file.'; statusEl.style.color = '#a67c00'; }
      return;
    }
    try {
      var snap = await MastDB.get('admin/commissionTerms');
      var versions = snap ? Object.keys(snap).map(function(k) { var v = snap[k]; v.id = k; return v; }) : [];
      var published = versions.filter(function(v) { return v.status === 'published'; });
      published.sort(function(a, b) { return (b.publishedAt || '').localeCompare(a.publishedAt || ''); });
      if (!published.length) {
        if (statusEl) { statusEl.textContent = 'No published terms version yet. Create one in Commission Terms.'; statusEl.style.color = '#a67c00'; }
        return;
      }
      var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID;
      if (statusEl) { statusEl.textContent = 'Sending…'; statusEl.style.color = 'var(--warm-gray)'; }
      var res = await firebase.functions().httpsCallable('mintCommissionTermsToken')({
        tenantId: tenantId,
        commissionId: commId,
        customerEmail: c.customerContact,
        termsVersionId: published[0].id
      });
      var data = (res && res.data) || {};
      if (data.success === false) throw new Error(data.error || 'mint failed');
      if (statusEl) { statusEl.textContent = 'Terms link sent to ' + c.customerContact + '.'; statusEl.style.color = 'var(--teal)'; }
      showToast('Terms link sent');
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = '#ef5350'; }
    }
  }
  window.sendCommissionTermsToken = sendCommissionTermsToken;

  async function saveCommissionProposal(commId) {
    var price = document.getElementById('commProposalPrice').value.trim();
    var timeline = document.getElementById('commProposalTimeline').value.trim();
    var spec = document.getElementById('commProposalSpec').value.trim();
    var statusEl = document.getElementById('commProposalStatus');
    try {
      var updates = {};
      updates['proposalPrice'] = price || null;
      updates['proposalTimeline'] = timeline || null;
      updates['proposalSpec'] = spec || null;
      await MastDB.commissions.update(commId, updates);
      Object.assign(commissionsData[commId], updates);
      if (statusEl) { statusEl.textContent = 'Proposal saved.'; statusEl.style.color = 'var(--teal)'; }
      await writeAudit('update', 'commission', commId);
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = 'var(--danger)'; }
    }
  }

  async function sendCommissionProposal(commId) {
    var c = commissionsData[commId];
    if (!c) return;
    // Save first
    await saveCommissionProposal(commId);
    c = commissionsData[commId];

    if (!c.proposalPrice && !c.proposalSpec) {
      showToast('Add price or spec details before sending', true);
      return;
    }

    var contact = c.customerContact || '';
    var isEmail = contact.indexOf('@') !== -1;
    if (!isEmail) {
      showToast('Customer contact is not an email — copy the proposal and send manually', true);
      return;
    }

    try {
      var user = firebase.auth().currentUser;
      if (!user) { showToast('Sign in required', true); return; }
      var token = await user.getIdToken();

      var resp = await callCF('/commissionProposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({
          commissionId: commId,
          customerEmail: contact,
          customerName: c.customerName,
          pieceName: c.sourcePieceName || 'Custom Piece',
          price: c.proposalPrice,
          timeline: c.proposalTimeline,
          spec: c.proposalSpec
        })
      });
      var result = await resp.json();
      if (result.success) {
        await MastDB.commissions.update(commId, { proposalSentAt: new Date().toISOString() });
        commissionsData[commId].proposalSentAt = new Date().toISOString();
        showToast('Proposal sent to ' + contact);
        emitTestingEvent('sendProposal', {});
        viewCommissionDetail(commId); // Refresh
      } else {
        showToast('Failed to send: ' + (result.error || 'Unknown error'), true);
      }
    } catch (err) {
      showToast('Error sending proposal: ' + err.message, true);
    }
  }

  async function createCommissionJob(commId) {
    var c = commissionsData[commId];
    if (!c) return;
    try {
      var jobId = MastDB.productionJobs.newKey();
      var jobData = {
        name: 'Commission: ' + (c.sourcePieceName || 'Custom Piece') + ' for ' + (c.customerName || 'Customer'),
        status: 'active',
        type: 'commission',
        commissionId: commId,
        items: [],
        createdAt: new Date().toISOString()
      };
      await MastDB.productionJobs.set(jobId, jobData);
      await MastDB.commissions.update(commId, { productionJobId: jobId });
      commissionsData[commId].productionJobId = jobId;
      showToast('Production job created');
      emitTestingEvent('createCommissionJob', {});
      await writeAudit('create', 'productionJob', jobId);
      viewCommissionDetail(commId); // Refresh
    } catch (err) {
      showToast('Error creating job: ' + err.message, true);
    }
  }

  function openCommissionDocLinkModal(commId) {
    var html =
      '<div style="max-width:450px;">' +
        '<h3>Link Google Doc</h3>' +
        '<div class="form-group">' +
          '<label>Google Drive URL</label>' +
          '<input type="text" id="commDocDriveUrl" placeholder="https://docs.google.com/document/d/...">' +
          '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Paste a link to a Google Doc, Sheet, or Drive file.</p>' +
        '</div>' +
        '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="saveCommissionDocLink(\'' + esc(commId) + '\')">Add Link</button>' +
        '</div>' +
      '</div>';
    openModal(html);
  }

  async function saveCommissionDocLink(commId) {
    var url = document.getElementById('commDocDriveUrl').value.trim();
    if (!url) { showToast('Paste a Google Drive URL', true); return; }

    try {
      var meta = await fetchDriveFileMetadata(url);
      var docData = {
        type: 'drive',
        name: meta ? meta.name : url.split('/').pop() || 'Google Doc',
        url: url,
        webViewLink: meta ? meta.webViewLink : url,
        mimeType: meta ? meta.mimeType : null,
        addedAt: new Date().toISOString()
      };
      var docRef = MastDB.commissions.documents(commId).push();
      await docRef.set(docData);
      if (!commissionsData[commId].documents) commissionsData[commId].documents = {};
      commissionsData[commId].documents[docRef.key] = docData;
      await writeAudit('update', 'commission', commId);
      closeModal();
      showToast('Document linked');
      viewCommissionDetail(commId);
    } catch (err) {
      showToast('Error linking document: ' + err.message, true);
    }
  }

  function openCommissionDocUploadModal(commId) {
    var html =
      '<div style="max-width:450px;">' +
        '<h3>Upload File</h3>' +
        '<div class="form-group">' +
          '<label>Select File</label>' +
          '<input type="file" id="commDocFileInput" style="font-size:0.85rem;">' +
          '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Max 10 MB. PDFs, images, and documents accepted.</p>' +
        '</div>' +
        '<div id="commDocUploadStatus" style="font-size:0.85rem;margin-top:8px;"></div>' +
        '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-primary" id="commDocUploadBtn" onclick="uploadCommissionDoc(\'' + esc(commId) + '\')">Upload</button>' +
        '</div>' +
      '</div>';
    openModal(html);
  }

  async function uploadCommissionDoc(commId) {
    var fileInput = document.getElementById('commDocFileInput');
    var statusEl = document.getElementById('commDocUploadStatus');
    var uploadBtn = document.getElementById('commDocUploadBtn');

    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
      showToast('Select a file first', true); return;
    }
    var file = fileInput.files[0];
    if (file.size > 10 * 1024 * 1024) {
      showToast('File must be under 10 MB', true); return;
    }

    if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading...'; }
    if (statusEl) { statusEl.textContent = 'Uploading...'; statusEl.style.color = 'var(--warm-gray)'; }

    try {
      var ext = file.name.split('.').pop() || 'bin';
      var fileName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      var storageRef = storage.ref(MastDB.storagePath('commission-docs/' + commId + '/' + fileName));
      var uploadTask = storageRef.put(file);

      await new Promise(function(resolve, reject) {
        uploadTask.on('state_changed',
          function(snapshot) {
            var pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            if (statusEl) statusEl.textContent = 'Uploading... ' + pct + '%';
          },
          reject,
          resolve
        );
      });

      var downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();

      var docData = {
        type: 'upload',
        name: file.name,
        url: downloadUrl,
        mimeType: file.type || null,
        size: file.size,
        addedAt: new Date().toISOString()
      };
      var docRef = MastDB.commissions.documents(commId).push();
      await docRef.set(docData);
      if (!commissionsData[commId].documents) commissionsData[commId].documents = {};
      commissionsData[commId].documents[docRef.key] = docData;
      await writeAudit('update', 'commission', commId);
      closeModal();
      showToast('File uploaded');
      viewCommissionDetail(commId);
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = '#ef5350'; }
      if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = 'Upload'; }
    }
  }

  async function removeCommissionDoc(commId, docId) {
    if (!await mastConfirm('Remove this document?', { title: 'Remove Document', danger: true })) return;
    try {
      await MastDB.commissions.documents(commId, docId).remove();
      if (commissionsData[commId] && commissionsData[commId].documents) {
        delete commissionsData[commId].documents[docId];
      }
      await writeAudit('update', 'commission', commId);
      showToast('Document removed');
      viewCommissionDetail(commId);
    } catch (err) {
      showToast('Error removing document: ' + err.message, true);
    }
  }

  function openNewCommissionModal() {
    window._newCommInspirationPids = [];
    var modal = document.createElement('div');
    modal.id = 'newCommissionModal';
    modal.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;';

    // Build product grid for inspiration picker
    var catalogHtml = '';
    (productsData || []).forEach(function(p) {
      if (!p.images || !p.images.length) return;
      catalogHtml += '<div class="new-comm-catalog-item" data-pid="' + esc(p.pid) + '" onclick="toggleNewCommInspiration(this,\'' + esc(p.pid) + '\')" ' +
        'style="width:64px;cursor:pointer;text-align:center;border:2px solid transparent;border-radius:6px;padding:4px;">' +
        '<img src="' + esc(p.images[0]) + '" style="width:56px;height:56px;border-radius:4px;object-fit:cover;" />' +
        '<div style="font-size:0.72rem;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p.name) + '</div>' +
      '</div>';
    });

    modal.innerHTML = '<div style="background:var(--cream,#f5f0e8);border-radius:12px;padding:24px;max-width:560px;width:90%;max-height:85vh;overflow-y:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="margin:0;font-size:1.15rem;">New Commission</h3>' +
        '<span onclick="closeNewCommissionModal()" style="cursor:pointer;font-size:1.15rem;color:var(--warm-gray);">&times;</span>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Customer Name *</label>' +
        '<input type="text" id="newCommName" placeholder="Jane Smith" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Email or Phone *</label>' +
        '<input type="text" id="newCommContact" placeholder="jane@example.com or (555) 123-4567" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Channel</label>' +
        '<select id="newCommChannel" style="padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);">' +
          '<option value="phone">Phone Call</option>' +
          '<option value="email">Email</option>' +
          '<option value="in-person">In Person</option>' +
          '<option value="social">Social Media</option>' +
          '<option value="other">Other</option>' +
        '</select>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Piece Title *</label>' +
        '<input type="text" id="newCommPieceTitle" placeholder="e.g. Anniversary glass pumpkin trio" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
      '</div>' +

      '<div style="display:flex;gap:8px;margin-bottom:14px;">' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Target Deadline</label>' +
          '<input type="date" id="newCommTargetDeadline" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Quote $</label>' +
          '<input type="number" min="0" step="0.01" id="newCommQuoteAmount" placeholder="0.00" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
        '</div>' +
        '<div style="flex:1;">' +
          '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Deposit $</label>' +
          '<input type="number" min="0" step="0.01" id="newCommDepositAmount" placeholder="0.00" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
        '</div>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">What are they looking for?</label>' +
        '<textarea id="newCommNotes" rows="3" placeholder="Describe what the customer asked about — size, colors, style, occasion..." style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;resize:vertical;background:var(--cream,#f5f0e8);box-sizing:border-box;"></textarea>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Attachments <span style="font-size:0.78rem;">(images, PDFs — uploaded after create)</span></label>' +
        '<input type="file" id="newCommAttachments" multiple accept="image/*,application/pdf" style="font-size:0.85rem;">' +
      '</div>' +

      (catalogHtml ? '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Inspiration pieces <span style="font-size:0.78rem;">(optional — click to select)</span></label>' +
        '<div id="newCommCatalogGrid" style="display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto;padding:4px;">' + catalogHtml + '</div>' +
      '</div>' : '') +

      '<div id="newCommError" style="color:var(--danger);font-size:0.85rem;margin-bottom:8px;display:none;"></div>' +

      '<div style="display:flex;gap:8px;justify-content:flex-end;">' +
        '<button class="btn btn-secondary" onclick="closeNewCommissionModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="newCommSaveBtn" onclick="saveNewCommission()">Create Commission</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(modal);
  }

  function toggleNewCommInspiration(el, pid) {
    var idx = window._newCommInspirationPids.indexOf(pid);
    if (idx === -1) {
      window._newCommInspirationPids.push(pid);
      el.style.borderColor = 'var(--teal)';
      el.style.background = 'rgba(0,128,128,0.1)';
    } else {
      window._newCommInspirationPids.splice(idx, 1);
      el.style.borderColor = 'transparent';
      el.style.background = 'transparent';
    }
  }

  function closeNewCommissionModal() {
    var modal = document.getElementById('newCommissionModal');
    if (modal) modal.remove();
    window._newCommInspirationPids = [];
  }

  async function saveNewCommission() {
    var name = document.getElementById('newCommName').value.trim();
    var contact = document.getElementById('newCommContact').value.trim();
    var channel = document.getElementById('newCommChannel').value;
    var notes = document.getElementById('newCommNotes').value.trim();
    // W1.6: structured fields
    var pieceTitle = (document.getElementById('newCommPieceTitle') || {}).value;
    pieceTitle = pieceTitle ? pieceTitle.trim() : '';
    var targetDeadline = (document.getElementById('newCommTargetDeadline') || {}).value || '';
    var quoteRaw = (document.getElementById('newCommQuoteAmount') || {}).value || '';
    var depositRaw = (document.getElementById('newCommDepositAmount') || {}).value || '';
    var quoteAmountCents = quoteRaw ? Math.round(parseFloat(quoteRaw) * 100) : null;
    var depositAmountCents = depositRaw ? Math.round(parseFloat(depositRaw) * 100) : null;
    var attachInput = document.getElementById('newCommAttachments');
    var attachFiles = (attachInput && attachInput.files) ? Array.from(attachInput.files) : [];
    var errorEl = document.getElementById('newCommError');

    if (!name || !contact) {
      errorEl.textContent = 'Customer name and contact info are required.';
      errorEl.style.display = '';
      return;
    }
    if (!pieceTitle) {
      errorEl.textContent = 'Piece title is required.';
      errorEl.style.display = '';
      return;
    }

    var btn = document.getElementById('newCommSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    errorEl.style.display = 'none';

    try {
      var commId = MastDB.newKey('admin/commissions');

      // Build inspiration list
      var inspirationPieces = [];
      (window._newCommInspirationPids || []).forEach(function(pid) {
        var match = productsData.find(function(p) { return p.pid === pid; });
        inspirationPieces.push({ pid: pid, name: match ? match.name : pid });
      });

      var record = {
        customerName: name,
        customerContact: contact,
        channel: channel,
        notes: notes || null,
        pieceTitle: pieceTitle,
        targetDeadline: targetDeadline || null,
        quoteAmountCents: quoteAmountCents,
        depositAmountCents: depositAmountCents,
        inspirationPieces: inspirationPieces.length > 0 ? inspirationPieces : null,
        referenceImageUrl: null,
        status: 'new',
        createdAt: new Date().toISOString()
      };

      await MastDB.commissions.set(commId, record);
      await writeAudit('create', 'commission', commId);

      // W1.6: Upload attachments (after commission exists).
      if (attachFiles.length && typeof firebase !== 'undefined' && firebase.storage) {
        btn.textContent = 'Uploading attachments...';
        var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID;
        var attachmentMeta = [];
        for (var i = 0; i < attachFiles.length; i++) {
          var f = attachFiles[i];
          try {
            var safeName = f.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            var storagePath = tenantId + '/commissions/' + commId + '/attachments/' + Date.now() + '_' + safeName;
            var ref = firebase.storage().ref(storagePath);
            var snap = await ref.put(f);
            var url = await snap.ref.getDownloadURL();
            var attId = MastDB.newKey('admin/commissions/' + commId + '/attachments');
            var meta = {
              name: f.name,
              url: url,
              storagePath: storagePath,
              mimeType: f.type || null,
              size: f.size,
              uploadedAt: new Date().toISOString()
            };
            await MastDB.set('admin/commissions/' + commId + '/attachments/' + attId, meta);
            attachmentMeta.push(Object.assign({ id: attId }, meta));
          } catch (eUp) {
            console.warn('Commission attachment upload failed', eUp);
          }
        }
        if (attachmentMeta.length) record.attachments = attachmentMeta;
      }

      // Update local data
      commissionsData[commId] = record;
      renderCommissions();

      closeNewCommissionModal();
      showToast('Commission created');
      emitTestingEvent('createCommission', {});

      // Open detail view for the new commission
      viewCommissionDetail(commId);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Create Commission';
      errorEl.textContent = 'Error: ' + err.message;
      errorEl.style.display = '';
    }
  }

  function closeCommissionDetail() {
    document.getElementById('commissionDetailView').style.display = 'none';
    document.getElementById('commissionDetailView').innerHTML = '';
    document.getElementById('commissionsListView').style.display = '';
    // W2.1: reset tab so next detail open starts on Spec.
    commDetailActiveTab = 'spec';
    // MastFlow: tear down the per-record subscription so we don't leak
    // listeners across detail-view opens.
    if (_mfActiveSubscription && _mfActiveSubscription.off) {
      try { _mfActiveSubscription.off(); } catch (e) {}
      _mfActiveSubscription = null;
    }
  }

  function viewCommissionTicket(ticketId, commId) {
    // Push the originating commission onto the nav stack so the ticket's
    // "← Back" can return to the specific custom order, not the ticket list.
    if (window.MastNavStack && typeof MastNavStack.push === 'function') {
      var c = commId && commissionsData ? commissionsData[commId] : null;
      MastNavStack.push({
        route: 'commissions',
        view: 'detail',
        state: { commId: commId || null },
        label: c ? ('Custom Order ' + (c.commissionNumber || commId)) : 'Custom Order'
      });
    }
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

  var COMMISSION_STATUS_MESSAGES = {
    accepted: "Great news — your commission request has been accepted and is now in our production queue. We’ll keep you updated as it progresses.",
    in_production: "Your commission is now in production. We’ll notify you when it’s complete.",
    ready: "Your commission is complete and ready. We’ll be in touch shortly to arrange pickup or shipment.",
    shipped: "Your commission has been shipped. You’ll receive tracking information separately.",
    cancelled: "Unfortunately, we need to cancel your commission request. Please reach out if you have any questions."
  };

  async function updateCommissionStatus(commId, newStatus) {
    try {
      await MastDB.commissions.update(commId, { status: newStatus });
      commissionsData[commId].status = newStatus;
      await writeAudit('update', 'commission', commId);

      var ticketId = commissionsData[commId] && commissionsData[commId].ticketId;
      if (ticketId) {
        var msgBody = COMMISSION_STATUS_MESSAGES[newStatus] || ('Your commission status has been updated to: ' + newStatus + '.');
        var now = new Date().toISOString();
        var msgId = 'msg_' + Date.now().toString(36);
        await MastDB.set('cs_tickets/' + ticketId + '/messages/' + msgId, {
          id: msgId,
          body: msgBody,
          direction: 'outbound',
          isInternal: false,
          authorName: 'System',
          authorEmail: null,
          createdAt: now
        });
        await MastDB.update('cs_tickets/' + ticketId, { updatedAt: now });
      }

      showToast('Status updated');
      emitTestingEvent('commissionStatus', { newStatus: newStatus });
      // Re-render detail to show/hide proposal and production sections
      viewCommissionDetail(commId);
    } catch (err) {
      showToast('Error updating status: ' + err.message, true);
    }
  }

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
            '<span>$' + (o.total || 0).toFixed(2) + '</span>' +
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
            '<span>$' + (o.total || 0).toFixed(2) + '</span>' +
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
          '<select id="rmaRefundMethodOverride" style="padding:4px 8px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);">' +
            '<option value="original_payment"' + (r.refundMethod === 'original_payment' ? ' selected' : '') + '>Original Payment</option>' +
            '<option value="store_credit"' + (r.refundMethod === 'store_credit' ? ' selected' : '') + '>Store Credit</option>' +
          '</select>' +
          '<input type="number" id="rmaRefundAmountOverride" value="' + ((r.refundAmountCents || 0) / 100).toFixed(2) + '" step="0.01" min="0" style="width:100px;padding:4px 8px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);">' +
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
        html += '<div style="display:flex;justify-content:space-between;font-weight:600;border-top:1px solid var(--cream-dark);padding-top:6px;margin-top:4px;"><span>Total Charged</span><span>' + fp(order.total) + '</span></div>';
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
          '<select id="rmaInspectResult" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);">' +
            '<option value="pass">Pass</option>' +
            '<option value="fail">Fail</option>' +
          '</select>' +
        '</div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="rmaInspectNotes" placeholder="Inspection notes..." style="width:100%;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);min-height:60px;"></textarea>' +
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
          '<select id="rmaDisposition" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);width:100%;">' +
            '<option value="restock">Restock — Return to full inventory</option>' +
            '<option value="seconds">Seconds — Move to clearance</option>' +
            '<option value="repair">Repair — Queue for repair</option>' +
            '<option value="write-off">Write Off — Record as loss</option>' +
          '</select>' +
        '</div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">Refund Method</label>' +
          '<select id="rmaDisposRefundMethod" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);">' +
            '<option value="store-credit"' + (r.refundMethod === 'store_credit' ? ' selected' : '') + '>Store Credit</option>' +
            '<option value="credit-card"' + (r.refundMethod === 'original_payment' ? ' selected' : '') + '>Original Payment</option>' +
          '</select>' +
          '<input type="number" id="rmaDisposRefundAmount" value="' + ((r.refundAmountCents || 0) / 100).toFixed(2) + '" step="0.01" min="0" style="margin-left:8px;width:100px;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);">' +
        '</div>' +
        '<div style="margin-bottom:0.75rem;">' +
          '<label style="font-size:0.72rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--warm-gray-light);display:block;margin-bottom:4px;">Notes</label>' +
          '<textarea id="rmaDisposNotes" placeholder="Disposition notes..." style="width:100%;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);min-height:40px;"></textarea>' +
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
        '<select id="rmaReasonCodeEdit_' + esc(rmaId) + '" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);max-width:280px;">' + opts + '</select>' +
        '<textarea id="rmaReasonDetailEdit_' + esc(rmaId) + '" placeholder="Additional detail (optional)" style="padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;font-size:0.85rem;background:var(--cream);color:var(--charcoal);min-height:60px;">' + esc(detail) + '</textarea>' +
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

  // Also add RMA indicator(s) to order detail view in admin
  var _origRenderOrderDetail = renderOrderDetail;
  renderOrderDetail = function(orderId) {
    _origRenderOrderDetail(orderId);
    var o = orders[orderId];
    if (!o) return;
    // Collect all RMA IDs (prefer rmaIds object, fall back to single rmaId)
    var rmaIdList = [];
    if (o.rmaIds) {
      rmaIdList = Object.keys(o.rmaIds);
    } else if (o.rmaId) {
      rmaIdList = [o.rmaId];
    }
    if (rmaIdList.length === 0) return;

    var detailEl = document.getElementById('orderDetailView');
    if (!detailEl) return;

    var bannersHtml = '';
    for (var i = 0; i < rmaIdList.length; i++) {
      var rid = rmaIdList[i];
      var rma = rmaData[rid];
      var rmaStatus = rma ? rma.status : 'unknown';
      var label = rmaIdList.length > 1 ? 'Return #' + (i + 1) : 'Return Request';
      bannersHtml += '<div class="order-detail-section" style="background:rgba(230,81,0,0.08);border-radius:6px;padding:12px 16px;margin-top:8px;">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
          '<span style="font-size:1.15rem;">&#x21A9;</span>' +
          '<span style="font-size:0.85rem;font-weight:500;">' + esc(label) + '</span>' +
          '<span class="status-badge" style="' + rmaBadgeStyle(rmaStatus) + '">' + esc(rmaStatus.replace(/-/g, ' ')) + '</span>' +
          '<a href="#" onclick="navigateTo(\'rma\');setTimeout(function(){viewRma(\'' + esc(rid) + '\');},100);return false;" style="font-size:0.78rem;color:var(--teal);margin-left:auto;">View RMA &rarr;</a>' +
        '</div>' +
      '</div>';
    }
    var header = detailEl.querySelector('.order-detail-header');
    if (header && header.nextSibling) {
      var div = document.createElement('div');
      div.innerHTML = bannersHtml;
      while (div.firstChild) {
        header.parentNode.insertBefore(div.firstChild, header.nextSibling);
      }
    }
  };

  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  window.orderStatusBadgeStyle = orderStatusBadgeStyle;
  window.etsySourceBadgeStyle = etsySourceBadgeStyle;
  window.loadOrders = loadOrders;
  window.getOrdersArray = getOrdersArray;
  window.getOrderDisplayNumber = getOrderDisplayNumber;
  window.formatOrderDate = formatOrderDate;
  window.formatOrderDateTime = formatOrderDateTime;
  window.getOrderItemsLabel = getOrderItemsLabel;
  window.setOrderFilter = setOrderFilter;
  window.toggleOrdersBulkSelect = toggleOrdersBulkSelect;
  window.toggleOrdersBulkSelectAll = toggleOrdersBulkSelectAll;
  window._ordersSort = function(key) {
    if (ordersSortKey === key) ordersSortDir = (ordersSortDir === 'asc') ? 'desc' : 'asc';
    else { ordersSortKey = key; ordersSortDir = (key === 'placedAt' || key === 'total') ? 'desc' : 'asc'; }
    renderOrders();
  };
  window.bulkOrdersClear = bulkOrdersClear;
  window.bulkOrdersMarkShipped = bulkOrdersMarkShipped;
  window.bulkOrdersCancel = bulkOrdersCancel;
  window.bulkOrdersExportCsv = bulkOrdersExportCsv;
  window.updateOrdersBulkBar = updateOrdersBulkBar;
  window.filterOrdersBySource = filterOrdersBySource;
  window.clearCommissionsFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { status: 1, dateFrom: 1, dateTo: 1, commissionIds: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    if (typeof navigateTo === 'function') navigateTo('commissions', next);
  };
  window.clearOrdersDateFilter = function() {
    // Drop all URL-driven filters (status + date range + specific order IDs);
    // keep route and any non-filter params. navigateTo re-applies + re-renders.
    var params = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { status: 1, dateFrom: 1, dateTo: 1, orderIds: 1 };
    Object.keys(params).forEach(function(k) {
      if (!DROP[k]) next[k] = params[k];
    });
    if (typeof navigateTo === 'function') navigateTo('orders', next);
  };
  window.renderOrders = renderOrders;
  window.renderOrderProgress = renderOrderProgress;
  window.viewOrder = viewOrder;
  window.backToOrders = backToOrders;
  window.renderOrderDetail = renderOrderDetail;
  window.getItemInventoryStatus = getItemInventoryStatus;
  window.getItemFulfillmentKey = getItemFulfillmentKey;
  window.openTriageDialog = openTriageDialog;
  window.updateTriageSummary = updateTriageSummary;
  window.executeTriageConfirm = executeTriageConfirm;
  window.triageAndConfirmOrder = triageAndConfirmOrder;
  window.transitionOrder = transitionOrder;
  window.packAndNavigate = async function(orderId) {
    await transitionOrder(orderId, 'packing');
    // Navigate to Pack Queue if Ship module is active
    var sub = getTenantSubscription ? getTenantSubscription() : {};
    var hasShip = (sub.modules || []).indexOf('ship') !== -1;
    if (hasShip && typeof navigateTo === 'function') {
      navigateTo('pack');
    }
  };
  window.reserveInventory = reserveInventory;
  window.releaseInventory = releaseInventory;
  window.pullFromStock = pullFromStock;
  window.createProductionRequests = createProductionRequests;
  window.openShippingModal = openShippingModal;
  window.openSimpleShipDialog = openSimpleShipDialog;
  window.submitSimpleShip = submitSimpleShip;
  window.submitManualShipping = submitManualShipping;
  window.shippingGetRates = shippingGetRates;
  window.shippingBuyLabel = shippingBuyLabel;
  window.shippingSelectRate = shippingSelectRate;
  window.shippingSelectPreset = shippingSelectPreset;
  window.shippingBackToConfigure = shippingBackToConfigure;
  window.shippingSwitchToManual = shippingSwitchToManual;
  window.shippingVoidLabel = shippingVoidLabel;
  window.printShippingLabel = printShippingLabel;
  window.openCancelOrderModal = openCancelOrderModal;
  window.cancelOrder = cancelOrder;
  window.addOrderNote = addOrderNote;
  window.loadOrderEmails = loadOrderEmails;
  window.toggleEmailDetail = toggleEmailDetail;
  window.injectEmailPreview = injectEmailPreview;
  window.sendOrderEmailFromDetail = sendOrderEmailFromDetail;
  window.resendOrderEmail = resendOrderEmail;
  window.toggleAdhocEmailForm = toggleAdhocEmailForm;
  window.sendAdhocOrderEmail = sendAdhocOrderEmail;
  window.viewCommissionTicket = viewCommissionTicket;
  window.viewRmaTicket = viewRmaTicket;
  window.loadCommissions = loadCommissions;
  window.renderCommissions = renderCommissions;
  window.viewCommissionDetail = viewCommissionDetail;
  window.setCommissionDetailTab = setCommissionDetailTab;
  window.setCommissionStatusFilter = setCommissionStatusFilter;
  window.setCommissionSort = setCommissionSort;
  window.saveCommissionProposal = saveCommissionProposal;
  window.sendCommissionProposal = sendCommissionProposal;
  window.createCommissionJob = createCommissionJob;
  window.openCommissionDocLinkModal = openCommissionDocLinkModal;
  window.saveCommissionDocLink = saveCommissionDocLink;
  window.openCommissionDocUploadModal = openCommissionDocUploadModal;
  window.uploadCommissionDoc = uploadCommissionDoc;
  window.removeCommissionDoc = removeCommissionDoc;
  window.openNewCommissionModal = openNewCommissionModal;
  window.toggleNewCommInspiration = toggleNewCommInspiration;
  window.closeNewCommissionModal = closeNewCommissionModal;
  window.saveNewCommission = saveNewCommission;
  window.closeCommissionDetail = closeCommissionDetail;
  window.updateCommissionStatus = updateCommissionStatus;
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
  window.isOrderInvoiceable = isOrderInvoiceable;
  window.getEffectiveInvoiceStatus = getEffectiveInvoiceStatus;
  window.invoiceStatusBadgeStyle = invoiceStatusBadgeStyle;
  window.generateInvoice = generateInvoice;
  window.sendInvoice = sendInvoice;
  window.markOrderInvoicePaid = markOrderInvoicePaid;
  window.resendInvoice = resendInvoice;
  window.buildInvoiceSection = buildInvoiceSection;

  // ============================================================
  // Ask AI registration (MastAskAi page registry)
  // CC Idea -Os1Lrm8ShTKZMafXV4k. Modal/launch live in window.MastAskAi.
  // ============================================================

  function paintOrdersAskAiSlot() {
    var slot = document.getElementById('ordersAskAiSlot');
    if (!slot) return;
    if (window.MastAskAi && window.MastAskAi.isEnabled()) {
      slot.innerHTML = '<button class="btn" style="font-size:0.85rem;padding:6px 12px;" onclick="MastAskAi.open(\'orders\')" title="Ask Claude about these orders">✨ Ask AI</button>';
    } else {
      slot.innerHTML = '';
    }
  }

  window.addEventListener('mastaskai:ready', paintOrdersAskAiSlot);
  window.addEventListener('mastaskai:configchanged', paintOrdersAskAiSlot);
  paintOrdersAskAiSlot();

  if (window.MastAskAi) {
    window.MastAskAi.register('orders', {
      title: 'Ask AI about these orders',
      placeholder: 'e.g. Which customers placed multiple orders this month? Which status has the most orders stuck?',
      notes: [
        'Amounts are USD (dollars, NOT cents — different convention from the Expenses page).',
        'Status enum: pending_payment, payment_failed, placed, confirmed, building, ready, pack, packing, packed, handed_to_carrier, shipped, delivered, cancelled, return_requested, return_approved, return_shipped, return_received, partially_returned, refunded.',
        'The "active" filter means: not delivered, not cancelled, not payment_failed.',
        'Sources: direct (the tenant storefront) or etsy (synced from Etsy).',
        'topOrders is sorted by total descending; topCustomers is by lifetime spend within the current view.',
        'byMonth keys are YYYY-MM based on order placedAt.',
        'If filters.dateFrom or filters.dateTo is set, the listing is narrowed to that range — not all orders for the tenant.'
      ],
      buildContext: function() {
        // Mirror renderOrders' filter logic so the snapshot matches the on-screen list
        var all = getOrdersArray();
        var sourceFiltered = all;
        if (orderSourceFilter === 'direct') {
          sourceFiltered = all.filter(function(o) { return !o.source || o.source === 'direct'; });
        } else if (orderSourceFilter === 'etsy') {
          sourceFiltered = all.filter(function(o) { return o.source === 'etsy'; });
        }
        var filtered;
        if (orderFilter === 'all') {
          filtered = sourceFiltered;
        } else if (orderFilter === 'active') {
          filtered = sourceFiltered.filter(function(o) {
            return o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'payment_failed';
          });
        } else {
          filtered = sourceFiltered.filter(function(o) { return (o.status || 'placed') === orderFilter; });
        }
        var routeParams = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
        var dateFrom = routeParams && typeof routeParams.dateFrom === 'string' ? routeParams.dateFrom.slice(0, 10) : '';
        var dateTo   = routeParams && typeof routeParams.dateTo   === 'string' ? routeParams.dateTo.slice(0, 10)   : '';
        if (dateFrom || dateTo) {
          filtered = filtered.filter(function(o) {
            var d = (o.placedAt || o.createdAt || '').slice(0, 10);
            if (dateFrom && d < dateFrom) return false;
            if (dateTo && d > dateTo) return false;
            return true;
          });
        }

        var totalUSD = 0;
        var byStatus = {}, byMonth = {}, bySource = {}, byCustomer = {};
        filtered.forEach(function(o) {
          var amt = o.total || 0;
          totalUSD += amt;
          var status = o.status || 'placed';
          if (!byStatus[status]) byStatus[status] = { count: 0, totalUSD: 0 };
          byStatus[status].count++; byStatus[status].totalUSD += amt;
          var month = ((o.placedAt || o.createdAt || '').substring(0, 7)) || 'unknown';
          if (!byMonth[month]) byMonth[month] = { count: 0, totalUSD: 0 };
          byMonth[month].count++; byMonth[month].totalUSD += amt;
          var source = o.source || 'direct';
          if (!bySource[source]) bySource[source] = { count: 0, totalUSD: 0 };
          bySource[source].count++; bySource[source].totalUSD += amt;
          var customer = o.email || '(no email)';
          if (!byCustomer[customer]) byCustomer[customer] = { count: 0, totalUSD: 0 };
          byCustomer[customer].count++; byCustomer[customer].totalUSD += amt;
        });
        Object.keys(byStatus).forEach(function(k) { byStatus[k].totalUSD = +byStatus[k].totalUSD.toFixed(2); });
        Object.keys(byMonth).forEach(function(k)  { byMonth[k].totalUSD  = +byMonth[k].totalUSD.toFixed(2);  });
        Object.keys(bySource).forEach(function(k) { bySource[k].totalUSD = +bySource[k].totalUSD.toFixed(2); });

        var topOrders = filtered.slice()
          .sort(function(a, b) { return (b.total || 0) - (a.total || 0); })
          .slice(0, 15)
          .map(function(o) {
            return {
              number:   getOrderDisplayNumber(o),
              placedAt: (o.placedAt || o.createdAt || '').slice(0, 10),
              customer: o.email || '(no email)',
              totalUSD: +(o.total || 0).toFixed(2),
              status:   o.status || 'placed',
              source:   o.source || 'direct',
              itemCount: (o.items || []).reduce(function(s, it) { return s + (it.qty || 1); }, 0)
            };
          });

        var topCustomers = Object.keys(byCustomer)
          .map(function(email) { return { email: email, orderCount: byCustomer[email].count, totalUSD: +byCustomer[email].totalUSD.toFixed(2) }; })
          .sort(function(a, b) { return b.totalUSD - a.totalUSD; })
          .slice(0, 10);

        return {
          route: '/app#orders',
          pageTitle: 'Orders',
          filters: {
            status:   orderFilter,
            source:   orderSourceFilter,
            dateFrom: dateFrom || null,
            dateTo:   dateTo   || null
          },
          aggregates: {
            rowCount: filtered.length,
            totalUSD: +totalUSD.toFixed(2),
            byStatus: byStatus,
            byMonth:  byMonth,
            bySource: bySource
          },
          topOrders:    topOrders,
          topCustomers: topCustomers
        };
      }
    });
  }

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

  function ensureOrdersData() {
    // Sync filter state to URL params on every route entry. Absent params
    // reset to defaults — otherwise an MCP deep link with ?status=X would
    // become the user's persistent default until they manually reset.
    var params = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    orderFilter = (params && typeof params.status === 'string' && params.status) ? params.status : 'active';
    orderSourceFilter = (params && typeof params.source === 'string' && params.source) ? params.source : 'all';
    // Defensive: hide the legacy ordersLoading spinner up-front. renderOrders
    // already hides it, but if the orders listener takes >8s to first-fire
    // (slow network, large tenant) the spinner sits past the auto-detect
    // threshold (feedback 7D5FOKTGdGaVTjstHLqk). The empty/data state will
    // repaint when the listener lands.
    var loadingEl = document.getElementById('ordersLoading');
    if (loadingEl) loadingEl.style.display = 'none';
    // Warm the tenant timezone cache so date display + filter use it.
    // First render may run before this resolves; once it does, re-render.
    var tzAlreadyKnown = _tenantTz !== null;
    ensureTenantTz().then(function() {
      if (!tzAlreadyKnown && ordersLoaded) renderOrders();
    });
    if (ordersLoaded) renderOrders();
  }

  // Register MastNavStack restorer for the orders route — re-opens an
  // order detail when popping back from a cross-module navigation.
  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('orders', function(view, state) {
      if (view !== 'detail' || !state || !state.orderId) return;
      var openIt = function() {
        if (orders[state.orderId]) {
          viewOrder(state.orderId);
          if (state.scrollTop != null) {
            setTimeout(function() { window.scrollTo(0, state.scrollTop); }, 50);
          }
        }
      };
      if (!ordersLoaded) {
        // Defer until orders load
        var tries = 0;
        var iv = setInterval(function() {
          if (ordersLoaded || tries++ > 25) { clearInterval(iv); openIt(); }
        }, 100);
      } else openIt();
    });
  }

  MastAdmin.registerModule('orders', {
    routes: {
      'orders': { tab: 'ordersTab', setup: function() { ensureOrdersData(); } },
      'rma': { tab: 'rmaTab', setup: function() { loadRmaData(); } },
      'commissions': { tab: 'commissionsTab', setup: function() {
        if (!commissionsLoaded) loadCommissions();
        else renderCommissions();
        // Deep links — two flavors supported:
        //   1) Legacy ?view=commissions&id=xxx (URL search)
        //   2) W2.1 hash params  #commissions?subView=detail&commissionId=xxx
        var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
        var deepId = null;
        if (rp && rp.subView === 'detail' && rp.commissionId) {
          deepId = rp.commissionId;
        } else {
          var urlParams = new URLSearchParams(window.location.search);
          if (urlParams.get('view') === 'commissions' && urlParams.get('id')) {
            deepId = urlParams.get('id');
            window.history.replaceState({}, '', window.location.pathname + '#commissions');
          }
        }
        if (deepId) {
          // Reset to spec tab on fresh deep-link.
          commDetailActiveTab = 'spec';
          var checkReady = setInterval(function() {
            if (commissionsData[deepId]) { clearInterval(checkReady); viewCommissionDetail(deepId); }
          }, 200);
          setTimeout(function() { clearInterval(checkReady); }, 5000);
        }
      } }
    },
    detachListeners: function() {
      commissionsData = {};
      commissionsLoaded = false;
      rmaData = {};
      rmaLoaded = false;
      // Hide detail views to prevent bleed into other routes
      var rmaDetail = document.getElementById('rmaDetailView');
      if (rmaDetail) { rmaDetail.style.display = 'none'; rmaDetail.innerHTML = ''; }
      var commDetail = document.getElementById('commissionDetailView');
      if (commDetail) { commDetail.style.display = 'none'; commDetail.innerHTML = ''; }
      var orderDetail = document.getElementById('orderDetailView');
      if (orderDetail) { orderDetail.style.display = 'none'; orderDetail.innerHTML = ''; }
    }
  });

})();
