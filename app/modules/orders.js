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
      var sourceBadge = o.source === 'etsy' ? ' <span class="order-source-badge etsy">Etsy</span>' : '';
      rowsHtml += '<tr onclick="viewOrder(\'' + esc(key) + '\')">' +
        '<td><span style="font-family:monospace;font-weight:600;">' + num + '</span>' + sourceBadge + '</td>' +
        '<td>' + esc(o.email || '') + '</td>' +
        '<td>' + getOrderItemsLabel(o) + '</td>' +
        '<td>$' + (o.total || 0).toFixed(2) + '</td>' +
        '<td><span class="status-badge pill order-status ' + status + '">' + status.replace(/_/g, ' ') + '</span></td>' +
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
      var cardSourceBadge = o.source === 'etsy' ? '<span class="order-source-badge etsy" style="margin-left:8px;">Etsy</span>' : '';
      cardHtml += '<div class="order-card" onclick="viewOrder(\'' + esc(key) + '\')">' +
        '<div class="order-card-header">' +
          '<span class="order-card-number">' + num + cardSourceBadge + '</span>' +
          '<span class="status-badge pill order-status ' + status + '">' + status.replace(/_/g, ' ') + '</span>' +
        '</div>' +
        '<div class="order-card-details">' +
          '<span class="order-card-detail">' + esc(o.email || '') + '</span>' +
          '<span class="order-card-detail">' + getOrderItemsLabel(o) + '</span>' +
          '<span class="order-card-detail">$' + (o.total || 0).toFixed(2) + '</span>' +
          '<span class="order-card-detail">' + formatOrderDate(o.placedAt) + '</span>' +
        '</div>' +
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
      placed: 'Placed', confirmed: 'Confirmed', building: 'Building',
      ready: 'Ready', packing: 'Packing', packed: 'Packed',
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
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'ready\')">Mark Ready</button>';
      } else if (t === 'building') {
        actionsHtml += '<button class="btn btn-secondary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'building\')">Needs Building</button>';
      } else if (t === 'packing') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'packing\')">Start Packing</button>';
      } else if (t === 'packed') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'packed\')">Mark Packed</button>';
      } else if (t === 'handed_to_carrier') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'handed_to_carrier\')">Handed to Carrier</button>';
      } else if (t === 'shipped') {
        actionsHtml += '<button class="btn btn-primary" onclick="openShippingModal(\'' + esc(orderId) + '\')">Mark Shipped</button>';
      } else if (t === 'delivered') {
        actionsHtml += '<button class="btn btn-primary" onclick="transitionOrder(\'' + esc(orderId) + '\', \'delivered\')">Mark Delivered</button>';
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
      etsyRows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Source</span><span class="order-source-badge etsy">Etsy</span></div>';
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
      trackingHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Tracking</div>' +
        '<div class="order-tracking-info">' +
          '<strong>' + esc(o.tracking.carrier || '') + '</strong>' +
          '<span style="font-family:monospace;">' + esc(o.tracking.trackingNumber) + '</span>' +
          (o.tracking.trackingUrl ? '<a href="' + esc(o.tracking.trackingUrl) + '" target="_blank" class="order-tracking-link">Track Package</a>' : '') +
        '</div>' +
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
            '<span class="production-request-status ' + prStatus + '">' + prStatus.replace('-', ' ') + '</span>' +
            prActions +
          '</div>' +
        '</div>';
      });
      productionRequestsHtml = '<div class="order-detail-section">' +
        '<div class="order-detail-section-title">Production Requests</div>' +
        prRows +
      '</div>';
    }

    var backLabel = _viewOrderReturnRoute ? 'Back to ' + _viewOrderReturnRoute.charAt(0).toUpperCase() + _viewOrderReturnRoute.slice(1) : 'Back to Orders';
    detailEl.innerHTML = '<button class="detail-back" onclick="backToOrders()">&#8592; ' + backLabel + '</button>' +
      '<div class="order-detail-header">' +
        '<div>' +
          '<div class="order-detail-title">' + num + (o.source === 'etsy' ? ' <span class="order-source-badge etsy">Etsy</span>' : '') + '</div>' +
          '<div class="order-detail-meta">' +
            '<span class="status-badge pill order-status ' + status + '">' + status.replace(/_/g, ' ') + '</span> &middot; ' +
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
      notesHtml;
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

      // Append to statusHistory
      var history = o.statusHistory ? o.statusHistory.slice() : [];
      history.push({ status: newStatus, at: now, by: 'admin' });
      updates['statusHistory'] = history;

      // Append to fulfillmentLog for packing/shipping milestones
      if (newStatus === 'packed' || newStatus === 'handed_to_carrier') {
        var ffLog = o.fulfillmentLog ? o.fulfillmentLog.slice() : [];
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

  function openShippingModal(orderId) {
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
        '<button class="btn btn-primary" onclick="submitShipping(\'' + esc(orderId) + '\')">Mark Shipped</button>' +
      '</div>' +
    '</div>';
    openModal(html);
  }

  async function submitShipping(orderId) {
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
        var sourceBadge = o.source === 'etsy' ? ' <span class="order-source-badge etsy" style="font-size:0.7rem;">Etsy</span>' : '';
        contentHtml += '<div class="dash-queue-item" onclick="viewOrder(\'' + esc(key) + '\')">' +
          '<div class="dash-queue-row">' +
            '<span class="dash-queue-order-num">' + num + sourceBadge + '</span>' +
            '<span class="status-badge pill order-status ' + status + '" style="font-size:0.7rem;padding:2px 8px;">' + status.replace(/_/g, ' ') + '</span>' +
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
        var sourceBadge = o.source === 'etsy' ? ' <span class="order-source-badge etsy" style="font-size:0.7rem;">Etsy</span>' : '';
        contentHtml += '<div class="dash-queue-item" onclick="viewOrder(\'' + esc(key) + '\')">' +
          '<div class="dash-queue-row">' +
            '<span class="dash-queue-order-num">' + num + sourceBadge + '</span>' +
            '<span class="status-badge pill order-status packed" style="font-size:0.7rem;padding:2px 8px;">packed</span>' +
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
  window.submitShipping = submitShipping;
  window.openCancelOrderModal = openCancelOrderModal;
  window.cancelOrder = cancelOrder;
  window.addOrderNote = addOrderNote;
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
    if (!ordersLoaded) loadOrders();
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
