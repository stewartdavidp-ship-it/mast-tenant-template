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
  var orderSourceFilter = 'all';
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
    packing:         { bg: 'rgba(249,168,37,0.2)', color: '#FFD54F', border: 'rgba(249,168,37,0.35)' },
    packed:          { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    handed_to_carrier: { bg: 'rgba(69,39,160,0.2)', color: '#B39DDB', border: 'rgba(69,39,160,0.35)' },
    shipped:         { bg: 'rgba(40,53,147,0.2)', color: '#7986CB', border: 'rgba(40,53,147,0.35)' },
    delivered:       { bg: 'rgba(46,125,50,0.25)', color: '#66BB6A', border: 'rgba(46,125,50,0.4)' },
    cancelled:       { bg: 'rgba(155,35,53,0.2)', color: '#EF5350', border: 'rgba(155,35,53,0.35)' }
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

  function formatOrderDate(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  function formatOrderDateTime(isoStr) {
    if (!isoStr) return '';
    var d = new Date(isoStr);
    if (isNaN(d.getTime())) return isoStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var hours = d.getHours();
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    var mins = d.getMinutes().toString().padStart(2, '0');
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + hours + ':' + mins + ' ' + ampm;
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
    var pillStatuses = [
      { key: 'active', label: 'Active', count: activeCount },
      { key: 'all', label: 'All', count: all.length },
      { key: 'pending_payment', label: 'Pending Payment', count: counts.pending_payment || 0 },
      { key: 'placed', label: 'Placed', count: counts.placed || 0 },
      { key: 'confirmed', label: 'Confirmed', count: counts.confirmed || 0 },
      { key: 'building', label: 'Building', count: counts.building || 0 },
      { key: 'ready', label: 'Ready', count: counts.ready || 0 },
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
    } else {
      filtered = sourceFiltered.filter(function(o) { return (o.status || 'placed') === orderFilter; });
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

    // Table rows
    var rowsHtml = '';
    filtered.forEach(function(o) {
      var key = o._key;
      var num = esc(getOrderDisplayNumber(o));
      var status = o.status || 'placed';
      var sourceBadge = o.source === 'etsy' ? ' <span class="status-badge" style="' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
      rowsHtml += '<tr onclick="viewOrder(\'' + esc(key) + '\')">' +
        '<td><span style="font-family:monospace;font-weight:600;">' + num + '</span>' + sourceBadge + '</td>' +
        '<td>' + esc(o.email || '') + '</td>' +
        '<td>' + getOrderItemsLabel(o) + '</td>' +
        '<td>$' + (o.total || 0).toFixed(2) + '</td>' +
        '<td><span class="status-badge pill" style="' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span></td>' +
        '<td>' + formatOrderDate(o.placedAt || o.pendingPaymentAt) + '</td>' +
        '</tr>';
    });
    if (tbodyEl) tbodyEl.innerHTML = rowsHtml;

    // Mobile cards
    var cardHtml = queueSummaryHtml;
    filtered.forEach(function(o) {
      var key = o._key;
      var num = esc(getOrderDisplayNumber(o));
      var status = o.status || 'placed';
      var cardSourceBadge = o.source === 'etsy' ? '<span class="status-badge" style="margin-left:8px;' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
      var cardShippable = ['confirmed', 'building', 'ready', 'packing', 'packed', 'handed_to_carrier'].indexOf(status) !== -1;
      var cardBtns = '<div style="display:flex;gap:6px;flex-shrink:0;">';
      if (cardShippable) {
        cardBtns += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();openShippingModal(\'' + esc(key) + '\')">Ship</button>';
      }
      cardBtns += '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;" onclick="event.stopPropagation();viewOrder(\'' + esc(key) + '\')">View</button></div>';

      cardHtml += '<div class="order-card" onclick="viewOrder(\'' + esc(key) + '\')">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">' +
          '<div>' +
            '<div style="font-weight:600;font-family:monospace;">' + num + ' <span class="status-badge pill" style="' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span>' + cardSourceBadge + '</div>' +
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
    var steps = ['placed', 'confirmed', 'ready', 'packing', 'packed', 'shipped', 'delivered'];
    // Insert building after confirmed if order went through building
    if (status === 'building' || (status !== 'placed' && status !== 'confirmed')) {
      // Check if building should be shown — include it if current or past
      // We'll detect by checking if building is in the path
    }

    // Simplified: define all possible steps, determine which are in the flow
    var allSteps = ['placed', 'confirmed', 'building', 'ready', 'packing', 'packed', 'shipped', 'delivered'];
    var stepLabels = {
      placed: 'Placed', confirmed: 'Confirmed', building: 'Build',
      ready: 'Pack', packing: 'Packing', packed: 'Packed',
      handed_to_carrier: 'With Carrier', shipped: 'Shipped', delivered: 'Delivered'
    };

    // Determine which steps to show
    var flow;
    if (status === 'cancelled') {
      return '<div class="order-progress"><div class="order-progress-step cancelled"><span class="order-progress-dot"></span>Cancelled</div></div>';
    } else if (status === 'pending_payment' || status === 'payment_failed') {
      var plabel = status === 'pending_payment' ? 'Pending Payment' : 'Payment Failed';
      return '<div class="order-progress"><div class="order-progress-step current"><span class="order-progress-dot"></span>' + plabel + '</div></div>';
    } else if (status === 'building') {
      flow = ['placed', 'confirmed', 'building', 'ready', 'packing', 'packed', 'shipped', 'delivered'];
    } else if (status === 'handed_to_carrier') {
      flow = ['placed', 'confirmed', 'ready', 'packing', 'packed', 'handed_to_carrier', 'shipped', 'delivered'];
    } else {
      flow = ['placed', 'confirmed', 'ready', 'packing', 'packed', 'shipped', 'delivered'];
    }

    var currentIdx = flow.indexOf(status);
    var html = '<div class="order-progress">';
    flow.forEach(function(step, idx) {
      var cls = idx < currentIdx ? 'completed' : idx === currentIdx ? 'current' : 'upcoming';
      html += '<div class="order-progress-step ' + cls + '">' +
        '<span class="order-progress-dot"></span>' +
        stepLabels[step] +
      '</div>';
      if (idx < flow.length - 1) {
        var connCls = idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : '';
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
    navigateTo('orders');
    document.getElementById('ordersListView').style.display = 'none';
    var detailEl = document.getElementById('orderDetailView');
    detailEl.style.display = 'block';
    renderOrderDetail(orderId);
    emitTestingEvent('viewOrder', {}); // Testing Mode
  }

  function backToOrders() {
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

    // Action buttons
    var actionsHtml = '';
    var transitions = ORDER_VALID_TRANSITIONS[status] || [];
    transitions.forEach(function(t) {
      if (t === 'cancelled') {
        actionsHtml += '<button class="btn btn-danger" onclick="openCancelOrderModal(\'' + esc(orderId) + '\')">Cancel Order</button>';
      } else if (t === 'confirmed') {
        actionsHtml += '<button class="btn btn-primary" onclick="openTriageDialog(\'' + esc(orderId) + '\')">Confirm Order</button>';
      } else if (t === 'ready') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'ready\')">Pack</button>';
      } else if (t === 'building') {
        actionsHtml += '<button class="btn btn-secondary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'building\')">Build</button>';
      } else if (t === 'packing') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'packing\')">Packing</button>';
      } else if (t === 'packed') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'packed\')">Packed</button>';
      } else if (t === 'handed_to_carrier') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'handed_to_carrier\')">Handed to Carrier</button>';
      } else if (t === 'shipped') {
        actionsHtml += '<button class="btn btn-primary" onclick="openShippingModal(\'' + esc(orderId) + '\')">Ship</button>';
      } else if (t === 'delivered') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'delivered\')">Delivered</button>';
      }
    });

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
        '<div class="order-item-price">$' + ((item.price || 0) * (item.qty || 1)).toFixed(2) + '</div>' +
      '</div>';
    });

    // Order summary
    var summaryHtml = '<div class="order-summary-row"><span>Subtotal</span><span>$' + (o.subtotal || 0).toFixed(2) + '</span></div>';
    if (o.tax) {
      var displayRate = o.taxRate || (o.subtotal ? o.tax / o.subtotal : 0);
      summaryHtml += '<div class="order-summary-row"><span>Tax (' + (displayRate * 100).toFixed(1) + '% ' + (o.taxState || '') + ')</span><span>$' + o.tax.toFixed(2) + '</span></div>';
    }
    summaryHtml += '<div class="order-summary-row"><span>Shipping (' + esc((o.shippingMethod && o.shippingMethod.label) || 'Standard') + ')</span><span>$' + (o.shippingCost || 0).toFixed(2) + '</span></div>';
    if (o.coupon && o.coupon.discount) {
      summaryHtml += '<div class="order-summary-row discount"><span>Coupon (' + esc(o.coupon.code) + ')</span><span>-$' + o.coupon.discount.toFixed(2) + '</span></div>';
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
        payRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Payment ID</span><span style="font-family:monospace;font-size:0.82rem;">' + esc(o.squarePaymentId) + '</span></div>';
      }
      if (o.paidAmount) {
        payRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Amount Paid</span><span>$' + (o.paidAmount / 100).toFixed(2) + '</span></div>';
      }
      if (o.squareOrderId) {
        payRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Square Order</span><span style="font-family:monospace;font-size:0.82rem;">' + esc(o.squareOrderId) + '</span></div>';
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
      etsyRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Receipt ID</span><span style="font-family:monospace;font-size:0.82rem;">' +
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
        (o.tracking.labelProvider ? '<div style="font-size:0.75rem;color:var(--warm-gray-light);margin-top:6px;">Label via ' + esc(o.tracking.labelProvider) + (o.tracking.purchasedAt ? ' on ' + formatOrderDateTime(o.tracking.purchasedAt) : '') + '</div>' : '') +
      '</div>';
    }

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
        { key: 'ready', field: 'readyAt' },
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
        var statusLabel = h.status.replace(/_/g, ' ');
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
        '<div style="font-size:0.82rem;color:var(--warm-gray-light);padding:8px 0;">No history recorded yet.</div>' +
      '</div>';
    }

    // Notes
    var notesArr = o.notes || [];
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
        prRows += '<div class="production-request-row">' +
          '<div>' +
            '<strong>' + esc(pr.productName || '') + '</strong>' +
            (pr.options ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">(' + esc(Object.values(pr.options).join(', ')) + ')</span>' : '') +
            ' x' + (pr.qty || 1) +
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
      '</div>';
    }

    // Email History section (loaded async)
    var emailSectionId = 'orderEmailSection_' + orderId;
    var emailHtml = '<div class="order-detail-section" id="' + emailSectionId + '">' +
      '<div class="order-detail-section-title">Email History</div>' +
      '<div style="font-size:0.82rem;color:var(--warm-gray-light);padding:4px 0;">Loading...</div>' +
    '</div>';

    // Manual send buttons — contextual based on order status
    var emailSendHtml = '<div class="order-email-send-section">';
    var sendBtns = '';
    if ((status === 'confirmed' || status === 'building' || status === 'ready' || status === 'packing' || status === 'packed') && o.email) {
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

    var backLabel = _viewOrderReturnRoute ? 'Back to ' + _viewOrderReturnRoute.charAt(0).toUpperCase() + _viewOrderReturnRoute.slice(1) : 'Back to Orders';
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
      renderOrderProgress(status) +
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
      etsyHtml +
      trackingHtml +
      ffLogHtml +
      productionRequestsHtml +
      emailHtml +
      emailSendHtml +
      notesHtml;

    // Load email history async
    loadOrderEmails(orderId, emailSectionId);
  }

  // ============================================================
  // Order Email Helpers
  // ============================================================

  function loadOrderEmails(orderId, containerId) {
    MastDB.emails.queryByOrder(orderId).then(function(snap) {
      var container = document.getElementById(containerId);
      if (!container) return;
      var emails = [];
      snap.forEach(function(child) {
        var e = child.val();
        e._key = child.key;
        emails.push(e);
      });
      emails.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

      if (emails.length === 0) {
        container.innerHTML = '<div class="order-detail-section-title">Email History</div>' +
          '<div style="font-size:0.82rem;color:var(--warm-gray-light);padding:4px 0;">No emails sent for this order yet.</div>';
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
            '<span class="status-badge" style="font-size:0.7rem;padding:2px 8px;background:' + (em.status === 'sent' ? 'rgba(46,125,50,0.2)' : 'rgba(198,40,40,0.2)') + ';color:' + statusColor + ';border:1px solid ' + (em.status === 'sent' ? 'rgba(46,125,50,0.35)' : 'rgba(198,40,40,0.35)') + ';">' + statusIcon + ' ' + esc(em.status || '') + '</span>' +
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
          '<div style="font-size:0.82rem;color:#EF5350;padding:4px 0;">Failed to load emails: ' + esc(err.message) + '</div>';
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
      var snap = await MastDB.emails.get(emailKey);
      var em = snap.val();
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
  // Inventory Helpers
  // ============================================================

  function getItemInventoryStatus(item) {
    var inv = inventory[item.pid];
    var qty = item.qty || 1;
    if (!inv) return { status: 'unknown', label: 'No inventory data', available: 0 };
    if (inv.stockType === 'made-to-order' || inv.stockType === 'made-to-order-only') {
      return { status: 'build', label: 'Made to Order', available: 0 };
    }
    var ck = getItemComboKey(item.pid, item.options);
    var stockEntry = (ck !== '_default' && inv.stock && inv.stock[ck])
      ? inv.stock[ck]
      : (inv.stock && inv.stock._default) || null;
    var available = stockEntry ? (stockEntry.available || 0) : 0;
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
      var invStatus = getItemInventoryStatus(item);
      var optStr = '';
      if (item.options && typeof item.options === 'object') {
        var parts = [];
        Object.keys(item.options).forEach(function(k) { parts.push(k + ': ' + item.options[k]); });
        optStr = parts.join(', ');
      }

      var invCls = invStatus.status === 'stock' ? 'inv-stock' : invStatus.status === 'partial' ? 'inv-partial' : invStatus.status === 'build' ? 'inv-build' : invStatus.status === 'out' ? 'inv-out' : 'inv-unknown';
      var autoAction = (invStatus.status === 'stock') ? 'stock' : 'build';

      rowsHtml += '<tr>' +
        '<td style="padding:8px 10px;">' +
          '<div style="font-weight:500;">' + esc(item.name) + ' x' + qty + '</div>' +
          (optStr ? '<div style="font-size:0.8rem;color:var(--warm-gray);">' + esc(optStr) + '</div>' : '') +
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
      msg = '<strong>' + stockCount + ' from stock, ' + buildCount + ' need building.</strong> Stock items reserved. Build items sent to production. Order status: <strong style="color:#7B1FA2;">Building</strong>';
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
      updates['status'] = 'ready';
      updates['readyAt'] = now;
      history.push({ status: 'ready', at: now, by: 'system', note: 'All items in stock' });
    } else {
      updates['status'] = 'building';
      updates['buildingAt'] = now;
      history.push({ status: 'building', at: now, by: 'system', note: 'Items need to be made' });
    }
    updates['statusHistory'] = history;

    await MastDB.orders.ref(orderId).update(updates);
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

      await MastDB.orders.ref(orderId).update(updates);
      // Update local state so re-render shows new status
      Object.keys(updates).forEach(function(k) { o[k] = updates[k]; });
      await writeAudit('update', 'orders', orderId);

      // Testing Mode event
      emitTestingEvent('transitionOrder', { newStatus: newStatus });

      // Auto-progress handed_to_carrier -> shipped (triggers email notification via Cloud Function)
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
        await MastDB.orders.ref(orderId).update(shippedUpdates);

        var hasContact = !!(o.email);
        if (hasContact) {
          showToast('Order handed to carrier — customer notified');
        } else {
          showToast('Order handed to carrier — no customer contact on file');
        }
        return;
      }

      showToast('Order updated to ' + updates['status']);
      renderOrderDetail(orderId);
    } catch (err) {
      showToast('Error updating order: ' + err.message, true);
    }
  }

  async function reserveInventory(pid, qty, ck) {
    var inv = inventory[pid];
    if (!inv || !inv.stock || !inv.stock._default) return;
    try {
      var stockRef = MastDB.inventory.stockRef(pid);
      var updates = {};
      updates['_default/available'] = firebase.database.ServerValue.increment(-qty);
      updates['_default/reserved'] = firebase.database.ServerValue.increment(qty);
      // Also update specific variant if combo key exists in stock
      if (ck && ck !== '_default' && inv.stock[ck]) {
        updates[ck + '/available'] = firebase.database.ServerValue.increment(-qty);
        updates[ck + '/reserved'] = firebase.database.ServerValue.increment(qty);
      }
      await stockRef.update(updates);
      await writeAudit('update', 'inventory', pid);
    } catch (err) {
      console.error('Error reserving inventory:', err);
    }
  }

  async function releaseInventory(pid, qty, ck) {
    var inv = inventory[pid];
    if (!inv || !inv.stock || !inv.stock._default) return;
    try {
      var stockRef = MastDB.inventory.stockRef(pid);
      var updates = {};
      updates['_default/available'] = firebase.database.ServerValue.increment(qty);
      updates['_default/reserved'] = firebase.database.ServerValue.increment(-qty);
      if (ck && ck !== '_default' && inv.stock[ck]) {
        updates[ck + '/available'] = firebase.database.ServerValue.increment(qty);
        updates[ck + '/reserved'] = firebase.database.ServerValue.increment(-qty);
      }
      await stockRef.update(updates);
      await writeAudit('update', 'inventory', pid);
    } catch (err) {
      console.error('Error releasing inventory:', err);
    }
  }

  async function pullFromStock(pid, qty, ck) {
    var inv = inventory[pid];
    if (!inv || !inv.stock || !inv.stock._default) return;
    try {
      var stockRef = MastDB.inventory.stockRef(pid);
      var updates = {};
      updates['_default/reserved'] = firebase.database.ServerValue.increment(-qty);
      if (ck && ck !== '_default' && inv.stock[ck]) {
        updates[ck + '/reserved'] = firebase.database.ServerValue.increment(-qty);
      }
      await stockRef.update(updates);
      await writeAudit('update', 'inventory', pid);
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
      var ffKey = getItemFulfillmentKey(item);
      var ff = fulfillment[ffKey];
      if (ff && ff.source === 'build') {
        var reqRef = MastDB.productionRequests.ref().push();
        var reqId = reqRef.key;
        await reqRef.set({
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
    var snap = await MastDB.studioLocations.ref().once('value');
    return snap.val() || {};
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
      '<div style="background:#FFF3E0;border:1px solid #F1641E;border-radius:6px;padding:8px 12px;margin-bottom:16px;font-size:0.85rem;color:#E65100;">' +
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
      '<div style="background:#FFF3E0;border:1px solid #FF9800;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:0.85rem;color:#E65100;">' +
        'No studio locations have ship-from addresses. <a href="#" onclick="closeModal();navigateTo(\'settings\');return false;" style="color:#E65100;font-weight:600;">Add one in Settings</a>' +
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
        '<div style="padding:8px 12px;background:var(--cream);border-radius:6px;font-size:0.88rem;">' + esc(toLine || 'No shipping address on order') + '</div>' +
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
        '<label>Weight (oz)' + (autoWeightNote ? '<span style="font-size:0.75rem;color:var(--warm-gray);font-weight:400;">' + autoWeightNote + '</span>' : '') + '</label>' +
        '<input type="number" id="shipWeight" min="0" step="0.1" value="' + currentWeight + '">' +
      '</div>' +

      // Actions
      '<div style="display:flex;gap:8px;justify-content:space-between;margin-top:16px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" style="font-size:0.82rem;" onclick="shippingSwitchToManual(\'' + esc(s.orderId) + '\')">Enter tracking manually</button>' +
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
      '<p style="color:var(--warm-gray);font-size:0.82rem;margin:0 0 16px;">Select a rate to purchase a shipping label</p>';

    if (s.rateError) {
      html += '<div style="background:#FFEBEE;border:1px solid #E53935;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:0.85rem;color:#C62828;">' + esc(s.rateError) + '</div>';
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

      // Pull reserved items from stock
      if (order && order.fulfillment) {
        (order.items || []).forEach(function(item) {
          var ffKey = getItemFulfillmentKey(item);
          var ff = order.fulfillment[ffKey];
          if (ff && ff.source === 'stock') {
            pullFromStock(item.pid, item.qty || 1, getItemComboKey(item.pid, item.options));
          }
        });
      }

      await MastDB.orders.ref(s.orderId).update({
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
      '<div style="font-size:2rem;margin-bottom:8px;">&#x2705;</div>' +
      '<h3 style="margin:0 0 8px;">Label Ready</h3>' +
      '<p style="color:var(--warm-gray);font-size:0.88rem;margin:0 0 16px;">Your shipping label has been purchased and tracking is set.</p>' +
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
      if (typeof _getLkApiKey === 'function' && typeof LK_API_URL !== 'undefined') {
        var apiKey = await _getLkApiKey();
        if (apiKey) {
          var resp = await fetch(LK_API_URL + '/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
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
      }
    } catch (e) {
      console.warn('LabelKeeper session failed, falling back to direct open:', e.message);
    }

    // Fallback: open label URL directly
    window.open(labelUrl, '_blank');
    showToast('Label opened — use browser print at 4×6');
  }

  async function shippingVoidLabel(orderId) {
    if (!confirm('Void this shipping label? The postage will be refunded to your account.')) return;
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
      await MastDB.orders.ref(orderId).update({
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

      // Pull reserved items from stock (variant-aware)
      if (o && o.fulfillment) {
        (o.items || []).forEach(function(item) {
          var ffKey = getItemFulfillmentKey(item);
          var ff = o.fulfillment[ffKey];
          if (ff && ff.source === 'stock') {
            pullFromStock(item.pid, item.qty || 1, getItemComboKey(item.pid, item.options));
          }
        });
      }

      await MastDB.orders.ref(orderId).update({
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

      closeModal();
      showToast('Order marked as shipped');
    } catch (err) {
      showToast('Error updating shipping: ' + err.message, true);
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
      'This will release reserved inventory and cancel any open production requests.</p>' +
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

      // Release reserved inventory (variant-aware)
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
        await MastDB.productionRequests.ref(reqKeys[i]).update({
          status: 'cancelled',
          cancelledAt: now
        });
        await writeAudit('update', 'buildJobs', reqKeys[i]);
      }

      await MastDB.orders.ref(orderId).update({
        status: 'cancelled',
        cancelledAt: now,
        cancelReason: reason || null,
        statusHistory: history
      });
      await writeAudit('update', 'orders', orderId);

      closeModal();
      showToast('Order cancelled');
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
      var notes = o && o.notes ? o.notes.slice() : [];
      notes.push({ text: text, at: new Date().toISOString(), by: 'admin' });
      await MastDB.orders.subRef(orderId, 'notes').set(notes);
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
    MastDB.commissions.ref().limitToLast(200).once('value', function(snap) {
      commissionsData = snap.val() || {};
      commissionsLoaded = true;
      if (loading) loading.style.display = 'none';
      renderCommissions();
    });
  }

  function renderCommissions() {
    var filterEl = document.getElementById('commissionsStatusFilter');
    var filter = filterEl ? filterEl.value : 'all';
    var items = Object.keys(commissionsData).map(function(k) {
      var c = commissionsData[k];
      c.id = k;
      return c;
    });
    if (filter !== 'all') {
      items = items.filter(function(c) { return c.status === filter; });
    }
    items.sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });

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

    var html = '';
    items.forEach(function(c) {
      var product = productsData.find(function(p) { return p.pid === c.sourcePieceId; });
      var imgSrc = product && product.images && product.images.length ? product.images[0] : '';
      var pieceName = c.sourcePieceName || (product ? product.name : 'Unknown');
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
        '<td style="font-size:0.82rem;">' + esc(c.customerContact || '—') + '</td>' +
        '<td style="font-size:0.82rem;color:var(--warm-gray);">' + esc(notes) + '</td>' +
        '<td><span class="status-badge" style="' + (statusColors[c.status] || '') + 'font-size:0.72rem;">' + esc(statusLabel) + '</span></td>' +
        '<td style="font-size:0.82rem;">' + esc((c.channel || '').toUpperCase()) + '</td>' +
        '<td style="font-size:0.82rem;">' + esc(dateStr) + '</td>' +
      '</tr>';
    });
    document.getElementById('commissionsTableBody').innerHTML = html;
  }

  function viewCommissionDetail(commId) {
    var c = commissionsData[commId];
    if (!c) return;
    c.id = commId;
    var product = productsData.find(function(p) { return p.pid === c.sourcePieceId; });
    var imgSrc = product && product.images && product.images.length ? product.images[0] : '';
    var pieceName = c.sourcePieceName || (product ? product.name : 'Unknown');
    var dateStr = c.createdAt ? new Date(c.createdAt).toLocaleString() : '—';

    var statusOptions = ['new', 'in-discussion', 'accepted', 'declined', 'built', 'completed'];
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
          '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px 16px;font-size:0.88rem;">' +
            '<span style="color:var(--warm-gray);">Price</span>' +
            '<span><input type="text" id="commProposalPrice" value="' + esc(c.proposalPrice || '') + '" placeholder="e.g. $250" style="width:140px;padding:6px 8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.88rem;"></span>' +
            '<span style="color:var(--warm-gray);">Timeline</span>' +
            '<span><input type="text" id="commProposalTimeline" value="' + esc(c.proposalTimeline || '') + '" placeholder="e.g. 3-4 weeks" style="width:200px;padding:6px 8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.88rem;"></span>' +
            '<span style="color:var(--warm-gray);">Spec / Design Notes</span>' +
            '<span><textarea id="commProposalSpec" rows="4" style="width:100%;padding:8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.88rem;resize:vertical;box-sizing:border-box;" placeholder="Describe the piece, materials, design details...">' + esc(c.proposalSpec || '') + '</textarea></span>' +
          '</div>' +
          '<div style="display:flex;gap:8px;margin-top:14px;">' +
            '<button class="btn btn-secondary" style="font-size:0.82rem;" onclick="saveCommissionProposal(\'' + esc(commId) + '\')">Save Proposal</button>' +
            (hasProposal && c.customerContact ? '<button class="btn btn-primary" style="font-size:0.82rem;" onclick="sendCommissionProposal(\'' + esc(commId) + '\')">Send Proposal to Customer</button>' : '') +
          '</div>' +
          '<div id="commProposalStatus" style="margin-top:8px;font-size:0.82rem;"></div>' +
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
          '<span style="font-size:1.1rem;">' + icon + '</span>' +
          '<div style="flex:1;min-width:0;">' +
            '<a href="' + esc(doc.url || doc.webViewLink || '#') + '" target="_blank" style="color:var(--teal);text-decoration:none;font-weight:500;">' + esc(doc.name || 'Untitled') + '</a>' +
            (doc.mimeType ? '<span style="color:var(--warm-gray);font-size:0.75rem;margin-left:8px;">' + esc(doc.mimeType.split('/').pop()) + '</span>' : '') +
          '</div>' +
          '<span style="color:var(--warm-gray);font-size:0.78rem;white-space:nowrap;">' + esc(dateStr) + '</span>' +
          '<button class="btn-icon danger" style="padding:4px 6px;font-size:0.75rem;" onclick="event.stopPropagation();removeCommissionDoc(\'' + esc(commId) + '\',\'' + esc(doc.id) + '\')" title="Remove">&times;</button>' +
        '</div>';
      });

      docsSection =
        '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:16px;">' +
          '<h4 style="margin:0 0 12px 0;font-size:1rem;">Documents</h4>' +
          (docsListHtml ? '<div style="margin-bottom:16px;">' + docsListHtml + '</div>' : '<p style="font-size:0.82rem;color:var(--warm-gray);margin:0 0 16px 0;">No documents attached yet.</p>') +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary" style="font-size:0.82rem;" onclick="openCommissionDocLinkModal(\'' + esc(commId) + '\')">+ Link Google Doc</button>' +
            '<button class="btn btn-secondary" style="font-size:0.82rem;" onclick="openCommissionDocUploadModal(\'' + esc(commId) + '\')">+ Upload File</button>' +
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
          '<button class="btn btn-primary" style="font-size:0.82rem;" onclick="createCommissionJob(\'' + esc(commId) + '\')">Create Production Job</button>' +
        '</div>';
    } else if (c.productionJobId) {
      jobSection =
        '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);margin-top:16px;">' +
          '<h4 style="margin:0 0 8px 0;font-size:1rem;">Production</h4>' +
          '<p style="font-size:0.85rem;margin:0;">Linked to production job. <a href="#" onclick="event.preventDefault();navigateTo(\'production\')" style="color:var(--teal);">View in Production</a></p>' +
        '</div>';
    }

    var html = '<button class="detail-back" onclick="closeCommissionDetail()">&larr; Back to Commissions</button>' +
    '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">' +
      '<div style="display:flex;gap:16px;align-items:flex-start;margin-bottom:20px;">' +
        (imgSrc ? '<img src="' + esc(imgSrc) + '" style="width:80px;height:80px;border-radius:8px;object-fit:cover;">' : '') +
        '<div>' +
          '<h3 style="margin:0 0 4px 0;font-size:1.1rem;">' + esc(pieceName) + '</h3>' +
          '<div style="font-size:0.82rem;color:var(--warm-gray);">Commission Inquiry</div>' +
        '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:120px 1fr;gap:8px 16px;font-size:0.88rem;">' +
        '<span style="color:var(--warm-gray);">Customer</span><span>' + esc(c.customerName || '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Contact</span><span>' + esc(c.customerContact || '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Channel</span><span>' + esc((c.channel || '').toUpperCase()) + '</span>' +
        '<span style="color:var(--warm-gray);">Date</span><span>' + esc(dateStr) + '</span>' +
        '<span style="color:var(--warm-gray);">Status</span><span>' + statusSelect + '</span>' +
        '<span style="color:var(--warm-gray);">Notes</span><span style="white-space:pre-wrap;">' + esc(c.notes || '—') + '</span>' +
        inspirationHtml +
        refImageHtml +
      '</div>' +
    '</div>' +
    proposalSection +
    docsSection +
    jobSection;

    document.getElementById('commissionDetailView').innerHTML = html;
    document.getElementById('commissionDetailView').style.display = '';
    document.getElementById('commissionsListView').style.display = 'none';
  }

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
      await MastDB.commissions.ref(commId).update(updates);
      Object.assign(commissionsData[commId], updates);
      if (statusEl) { statusEl.textContent = 'Proposal saved.'; statusEl.style.color = 'var(--teal)'; }
      await writeAudit('update', 'commission', commId);
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = '#DC3545'; }
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
        await MastDB.commissions.subRef(commId, 'proposalSentAt').set(new Date().toISOString());
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
      var jobRef = MastDB.productionJobs.ref().push();
      var jobId = jobRef.key;
      var jobData = {
        name: 'Commission: ' + (c.sourcePieceName || 'Custom Piece') + ' for ' + (c.customerName || 'Customer'),
        status: 'active',
        type: 'commission',
        commissionId: commId,
        items: [],
        createdAt: new Date().toISOString()
      };
      await jobRef.set(jobData);
      await MastDB.commissions.subRef(commId, 'productionJobId').set(jobId);
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
          '<p style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">Paste a link to a Google Doc, Sheet, or Drive file.</p>' +
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
          '<p style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">Max 10 MB. PDFs, images, and documents accepted.</p>' +
        '</div>' +
        '<div id="commDocUploadStatus" style="font-size:0.82rem;margin-top:8px;"></div>' +
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
    if (!confirm('Remove this document?')) return;
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
        '<div style="font-size:0.68rem;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(p.name) + '</div>' +
      '</div>';
    });

    modal.innerHTML = '<div style="background:var(--cream,#f5f0e8);border-radius:12px;padding:24px;max-width:560px;width:90%;max-height:85vh;overflow-y:auto;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="margin:0;font-size:1.1rem;">New Commission</h3>' +
        '<span onclick="closeNewCommissionModal()" style="cursor:pointer;font-size:1.3rem;color:var(--warm-gray);">&times;</span>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.82rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Customer Name *</label>' +
        '<input type="text" id="newCommName" placeholder="Jane Smith" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.88rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.82rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Email or Phone *</label>' +
        '<input type="text" id="newCommContact" placeholder="jane@example.com or (555) 123-4567" style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.88rem;background:var(--cream,#f5f0e8);box-sizing:border-box;">' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.82rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Channel</label>' +
        '<select id="newCommChannel" style="padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.88rem;background:var(--cream,#f5f0e8);">' +
          '<option value="phone">Phone Call</option>' +
          '<option value="email">Email</option>' +
          '<option value="in-person">In Person</option>' +
          '<option value="social">Social Media</option>' +
          '<option value="other">Other</option>' +
        '</select>' +
      '</div>' +

      '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.82rem;color:var(--warm-gray);display:block;margin-bottom:4px;">What are they looking for?</label>' +
        '<textarea id="newCommNotes" rows="3" placeholder="Describe what the customer asked about — size, colors, style, occasion..." style="width:100%;padding:8px 10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.88rem;resize:vertical;background:var(--cream,#f5f0e8);box-sizing:border-box;"></textarea>' +
      '</div>' +

      (catalogHtml ? '<div style="margin-bottom:14px;">' +
        '<label style="font-size:0.82rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Inspiration pieces <span style="font-size:0.75rem;">(optional — click to select)</span></label>' +
        '<div id="newCommCatalogGrid" style="display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto;padding:4px;">' + catalogHtml + '</div>' +
      '</div>' : '') +

      '<div id="newCommError" style="color:#DC3545;font-size:0.82rem;margin-bottom:8px;display:none;"></div>' +

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
    var errorEl = document.getElementById('newCommError');

    if (!name || !contact) {
      errorEl.textContent = 'Customer name and contact info are required.';
      errorEl.style.display = '';
      return;
    }

    var btn = document.getElementById('newCommSaveBtn');
    btn.disabled = true;
    btn.textContent = 'Creating...';
    errorEl.style.display = 'none';

    try {
      var commRef = MastDB.commissions.ref();
      var commId = commRef.push().key;

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
        inspirationPieces: inspirationPieces.length > 0 ? inspirationPieces : null,
        referenceImageUrl: null,
        status: 'new',
        createdAt: new Date().toISOString()
      };

      await commRef.child(commId).set(record);
      await writeAudit('create', 'commission', commId);

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
  }

  async function updateCommissionStatus(commId, newStatus) {
    try {
      await MastDB.commissions.subRef(commId, 'status').set(newStatus);
      commissionsData[commId].status = newStatus;
      await writeAudit('update', 'commission', commId);
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
    var cardConfig = DASHBOARD_CARDS[1]; // newOrders

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
        var sourceBadge = o.source === 'etsy' ? ' <span class="status-badge" style="font-size:0.7rem;' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
        contentHtml += '<div class="dash-queue-item" onclick="viewOrder(\'' + esc(key) + '\')">' +
          '<div class="dash-queue-row">' +
            '<span class="dash-queue-order-num">' + num + sourceBadge + '</span>' +
            '<span class="status-badge pill" style="font-size:0.7rem;padding:2px 8px;' + orderStatusBadgeStyle(status) + '">' + status.replace(/_/g, ' ') + '</span>' +
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
  }

  // Dashboard Card: Ready to Ship

  function renderDashCardReadyToShip() {
    var container = document.getElementById('dashCardReadyToShip');
    if (!container) return;
    if (!ordersLoaded) { container.innerHTML = ''; return; }
    var cardConfig = DASHBOARD_CARDS[2]; // readyToShip

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
        var sourceBadge = o.source === 'etsy' ? ' <span class="status-badge" style="font-size:0.7rem;' + etsySourceBadgeStyle() + '">Etsy</span>' : '';
        contentHtml += '<div class="dash-queue-item" onclick="viewOrder(\'' + esc(key) + '\')">' +
          '<div class="dash-queue-row">' +
            '<span class="dash-queue-order-num">' + num + sourceBadge + '</span>' +
            '<span class="status-badge pill" style="font-size:0.7rem;padding:2px 8px;' + orderStatusBadgeStyle('packed') + '">packed</span>' +
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
  }

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
  window.filterOrdersBySource = filterOrdersBySource;
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
  window.reserveInventory = reserveInventory;
  window.releaseInventory = releaseInventory;
  window.pullFromStock = pullFromStock;
  window.createProductionRequests = createProductionRequests;
  window.openShippingModal = openShippingModal;
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
  window.loadCommissions = loadCommissions;
  window.renderCommissions = renderCommissions;
  window.viewCommissionDetail = viewCommissionDetail;
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

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  function ensureOrdersData() {
    if (ordersLoaded) renderOrders();
  }

  MastAdmin.registerModule('orders', {
    routes: {
      'orders': { tab: 'ordersTab', setup: function() { ensureOrdersData(); } },
      'commissions': { tab: 'commissionsTab', setup: function() {
        if (!commissionsLoaded) loadCommissions();
        // Deep link: ?view=commissions&id=xxx
        var urlParams = new URLSearchParams(window.location.search);
        var deepId = urlParams.get('id');
        if (deepId && urlParams.get('view') === 'commissions') {
          var checkReady = setInterval(function() {
            if (commissionsData[deepId]) { clearInterval(checkReady); viewCommissionDetail(deepId); }
          }, 200);
          setTimeout(function() { clearInterval(checkReady); }, 5000);
          window.history.replaceState({}, '', window.location.pathname + '#commissions');
        }
      } }
    },
    detachListeners: function() {
      commissionsData = {};
      commissionsLoaded = false;
    }
  });

})();
