/**
 * orders-core.js — shared order display/format helpers (T6 keystone, PR1).
 *
 * Background (orders-js-retirement-cut-plan.md): retiring app/modules/orders.js
 * (the 6.8K-line biggest V1) is blocked because staying modules consume its
 * logic as bare globals. This module is the first, cleanest slice of that core:
 * the genuinely cross-module-shared, *stateless* order display/format helpers
 * (badge styles, order number, items label, tz-aware order dates, the order
 * progress stepper) — lifted VERBATIM out of orders.js's IIFE.
 *
 * These are consumed cross-module today by fulfillment.js, wholesale.js,
 * wholesale-v2.js, sales.js, and the shell (procurement/inventory tables +
 * the New-Orders / Ready-to-Ship dashboard cards). orders.js itself still
 * references them as bare names (e.g. tzPartsFromIso inside renderOrders),
 * which now resolve to these window globals.
 *
 * EAGER (peer of mast-format/mast-sanitize, before any lazy module) on purpose:
 * fulfillment.js bare-calls these without loadModule('orders'), so an eager home
 * guarantees they always resolve — closing a latent load-order fragility that
 * existed while they lived only inside lazy-loaded orders.js.
 *
 * Pure verbatim move — NO behavior change. The order CACHE, lifecycle state
 * machine (transitionOrder), shipping/invoice/commission/RMA surfaces, and the
 * V1 UI stay in orders.js (they are entangled with the module-private order
 * cache + the V1 screens and are removed in later cut-plan PRs).
 *
 * Exposes window.OrdersCore + back-compat window.<name> aliases (the exact names
 * orders.js used to export), so every existing bare-global / window.* call site
 * is untouched. Vanilla ES5-ish (var/IIFE), no build step.
 */
(function () {
  'use strict';

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

  function etsySourceBadgeStyle() {
    return 'background:#F1641E;color:white;';
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
  // Order cache accessor + inventory write cluster + triage/confirm
  // + production-requests cores (T6 cut-plan PR1b).
  //
  // Lifted VERBATIM out of orders.js's IIFE. These are the genuinely
  // cross-module-shared, DOM-FREE order-write cores:
  //  - getOrdersArray: reads the shell 'orders' cache global (consumed by
  //    fulfillment.js as a bare global).
  //  - getItemInventoryStatus / getItemFulfillmentKey: per-item inventory
  //    status + fulfillment-key helpers (getItemInventoryStatus is consumed
  //    cross-module by orders-v2).
  //  - triageAndConfirmOrder: the DOM-free confirm/triage write core that
  //    OrdersBridge.triageConfirm, executeTriageConfirm, and transitionOrder
  //    all delegate to.
  //  - _bumpStock / reserveInventory / releaseInventory / pullFromStock: the
  //    atomic per-bucket inventory increment primitive + its order-lifecycle
  //    wrappers.
  //  - createProductionRequests: opens admin/buildJobs build requests.
  //
  // They reference only eager shell globals (orders, inventory,
  // getItemComboKey, writeAudit, MastDB) + each other, so the move is a pure
  // relocation with NO behavior change. (PR1c moved the render-coupled
  // lifecycle/invoice surfaces — transitionOrder/loadOrders/generateInvoice —
  // and PR1d the order-write cores below; the remaining V1 UI screens + the
  // OrdersBridge/RMA email + refund cores stay in orders.js for later
  // cut-plan PRs.)
  // ============================================================

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

  // Atomically bump a product's per-bucket stock counters. Each name in `fields`
  // (e.g. 'committed', 'onHand') is incremented by the signed `delta` on the
  // `_default` bucket, and — when `ck` names a real variant bucket — on that
  // bucket too. Returns false (no write) when the product has no stock record.
  //
  // These writes go through MastDB.multiUpdate, NOT MastDB.update with
  // '_default/committed'-style keys. MastDB.update would prefix each key with the
  // 'stock.' fieldPath and hand Firestore the field path 'stock._default/committed';
  // Firestore forbids '/' in field paths, so the call threw and the surrounding
  // try/catch swallowed it — inventory silently never moved. multiUpdate takes a
  // full slash path per leaf and translates each into a slash-free nested field
  // update (dot-joined fieldPath via mergeFields), preserving the atomic increment.
  async function _bumpStock(pid, delta, ck, fields) {
    var inv = inventory[pid];
    if (!inv || !inv.stock || !inv.stock._default) return false;
    var base = 'admin/inventory/' + pid + '/stock/';
    var updates = {};
    fields.forEach(function (f) {
      updates[base + '_default/' + f] = MastDB.serverIncrement(delta);
    });
    if (ck && ck !== '_default' && inv.stock[ck]) {
      fields.forEach(function (f) {
        updates[base + ck + '/' + f] = MastDB.serverIncrement(delta);
      });
    }
    await MastDB.multiUpdate(updates);
    return true;
  }

  async function reserveInventory(pid, qty, ck, orderId) {
    try {
      if (!(await _bumpStock(pid, qty, ck, ['committed']))) return;
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
    try {
      if (!(await _bumpStock(pid, -qty, ck, ['committed']))) return;
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
    try {
      if (!(await _bumpStock(pid, -qty, ck, ['committed', 'onHand']))) return;
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
  // Render-coupled order lifecycle + invoice surface (T6 cut-plan PR1c).
  //
  // Lifted VERBATIM out of orders.js's IIFE, with ONE deliberate deviation
  // (and only this): every call to a V1-UI render function — renderOrders()
  // and renderOrderDetail() — is wrapped in the shell's own existing guard
  // idiom `if (typeof <fn> === 'function') <fn>(...)` (see index.html's order
  // real-time listener). Rationale: the DB write has already succeeded by the
  // time these run; the render is a UI refresh of the V1 orders screens
  // (renderOrders/renderOrderDetail STAY in orders.js). orders-core is eager,
  // so when orders.js (the V1 UI) isn't loaded — the default V2 mode — an
  // unguarded call would throw a ReferenceError AFTER a successful write and
  // surface a spurious "Error updating order" toast. The guard makes the
  // refresh gracefully skip. Nothing else changed from the originals.
  //
  // Why these are eager here (not in lazy orders.js): fulfillment.js (staying)
  // bare-calls transitionOrder/loadOrders WITHOUT loadModule('orders') — moving
  // them eager closes that latent load-order fragility (same win as PR1b's
  // DOM-free cores). generateInvoice is also called by wholesale.js.
  //
  // Transitive DOM-free closure moved together: orderTotalDollars (canonical
  // grand-total, consumed by markOrderInvoicePaid + buildInvoiceSection and
  // 9 more V1-render sites still in orders.js — they now resolve it as the
  // window global) and the invoice-internal getInvoiceDueDays /
  // computeInvoiceDueDate (no external callers; kept module-private here).
  // Shell globals these bodies reference (orders cache, ordersLoaded,
  // ORDER_VALID_TRANSITIONS, showToast, esc, writeAudit, emitTestingEvent,
  // firebase, MastDB) remain available eagerly.
  // ============================================================

  // Canonical order grand-total (DOLLARS).
  // Orders arrive from two writers with different money conventions:
  // MCP/createTestOrder stamps integer-cents `totalCents`; the storefront
  // (submitOrder) stored dollar `total` (legacy) and now also stamps `totalCents`.
  // Some harness/MCP-seeded orders (e.g. SGTE-0187/0188) put CENTS in the dollar
  // `total` field — reading `o.total` raw renders "$102000.00" instead of $1,020.
  // moneyVal prefers `totalCents`/100, falling back to dollar `total` — the SAME
  // single source of truth the orders-v2 detail and the server's
  // orderRevenueCents normalizer use, so every surface agrees regardless of which
  // writer produced the record. (Breakdown fields — subtotal/shipping/tax — are
  // not reconciled here; the grand total is what these v1 surfaces display.)
  function orderTotalDollars(o) {
    if (!o) return 0;
    return (window.MastUI && window.MastUI.Num)
      ? (window.MastUI.Num.moneyVal(o, 'totalCents', 'total') || 0)
      : (o.total || 0);
  }

  function loadOrders() {
    if (ordersLoaded) {
      if (typeof renderOrders === 'function') renderOrders();
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
        if (typeof renderOrderDetail === 'function') renderOrderDetail(orderId);
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
        if (typeof renderOrderDetail === 'function') renderOrderDetail(orderId);
        return;
      }

      // Direct transition to shipped (e.g., from packed with tracking)
      if (newStatus === 'shipped') {
        try {
          await firebase.functions().httpsCallable('onOrderShipped')({ orderId: orderId, tenantId: MastDB.tenantId() });
        } catch (shipErr) { console.error('onOrderShipped call failed:', shipErr); }
      }

      showToast('Order updated to ' + updates['status']);
      if (typeof renderOrderDetail === 'function') renderOrderDetail(orderId);
    } catch (err) {
      showToast('Error updating order: ' + err.message, true);
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

  // Invoice status badges now render via the canonical MastUI.statusBadge(status,
  // 'invoice') engine (Track 5 / Wave 2; shared/mast-ui.js _statusRegistry.invoice).
  // The text colors were captured verbatim from the former invoiceStatusBadgeStyle
  // map when the registry was built, so the rendered hue is identical; labels are
  // the registry's Title-Case (Draft/Sent/Paid/Overdue). The draft view already
  // rendered "Draft"; the summary view's previously raw-lowercase label now matches
  // it. invoiceStatusBadgeStyle had no cross-module consumer, so it is removed.

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
      if (fromOrdersCache && typeof renderOrderDetail === 'function') renderOrderDetail(orderId);
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
            if (typeof renderOrderDetail === 'function') renderOrderDetail(orderId);
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
      if (typeof renderOrderDetail === 'function') renderOrderDetail(orderId);
    } catch (err) {
      showToast('Failed to send invoice: ' + err.message, true);
    }
  }

  async function markOrderInvoicePaid(orderId) {
    var o = orders[orderId];
    if (!o) return;
    try {
      var now = new Date().toISOString();
      var totalCents = Math.round(orderTotalDollars(o) * 100);
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
      if (typeof renderOrderDetail === 'function') renderOrderDetail(orderId);
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
      h += window.MastUI.statusBadge('draft', 'invoice');
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
      h += '<div style="font-weight:700;">Total: $' + orderTotalDollars(o).toFixed(2) + '</div>';
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
      rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Status</span>' + window.MastUI.statusBadge(effectiveStatus, 'invoice') + '</div>';
      if (o.invoiceIssuedAt) rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Issued</span><span>' + formatOrderDate(o.invoiceIssuedAt) + '</span></div>';
      if (o.invoiceSentAt)  rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Sent</span><span>' + formatOrderDate(o.invoiceSentAt) + '</span></div>';
      if (o.invoiceDueDate) rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Due Date</span><span>' + esc(o.invoiceDueDate) + '</span></div>';
      if (o.invoicePaidAt)  rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Paid</span><span style="color:#4ade80;">' + formatOrderDate(o.invoicePaidAt) + '</span></div>';
      rows += '<div style="display:flex;justify-content:space-between;padding:4px 0;"><span style="color:var(--warm-gray-light);">Amount</span><span>$' + orderTotalDollars(o).toFixed(2) + '</span></div>';
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
  // PR1d — order-write cores (cancel / add-note / mark-shipped)
  //
  // The DOM-free write cores that OrdersBridge.{cancelOrder,bulkCancel,
  // addNote,bulkMarkShipped} and the legacy V1 detail handlers
  // (cancelOrder / addOrderNote) both delegate to. Moved here verbatim so
  // PR3 can absorb OrdersBridge into orders-v2 with the cores already
  // reachable from the eager shared floor. They read the live record from
  // the global `orders` cache (a shell global, seeded by the bridge when the
  // V2 twin drives the flow) and reference only eager shell globals
  // (orders, productionRequests, getItemComboKey, MastDB, writeAudit,
  // firebase, MastFlow) + the inventory/display cores already in this file
  // (releaseInventory, getItemFulfillmentKey). They are already DOM-free —
  // no renderOrderDetail/renderOrders calls — so no render guards were
  // needed; the toast / closeModal / input-clear UI stays in the V1
  // wrappers in orders.js.
  // ============================================================

  // DOM-free cancellation core (single source for the legacy detail "Cancel
  // Order" handler + the orders-v2 native action via OrdersBridge.cancelOrder).
  // The DOM read of #cancelReason and the toast/closeModal UI live in the
  // legacy handler; this core is the legacy cancellation logic VERBATIM with
  // the reason lifted to an argument. It reads the live record from the global
  // `orders` cache (seeded by the bridge when the V2 twin drives the flow).
  // Firestore writes are byte-identical to the pre-extraction handler:
  // releaseInventory (variant-aware), cancel open buildJobs reqs, write
  // cancelledAt/cancelReason, MastFlow 'closed' transition (force), and the
  // non-fatal CS-ticket creation. Returns void.
  async function _cancelOrderCore(orderId, reason) {
    var o = orders[orderId];
    if (!o) return;
    var now = new Date().toISOString();

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

    // Create CS ticket for admin-initiated cancellation (non-fatal)
    if (!o.cancellationTicketId) {
      try {
        // Allocate the human-facing ticket number ATOMICALLY. The old
        // get→compute→write-back raced under bulk cancellation: bulkCancel runs
        // _cancelOrderCore per row, but each row's MastDB.get('cs_config/ticketing')
        // returned the same (stale) nextNumber, so every cancel minted T-0001 and
        // the counter never advanced. A Firestore transaction read-modify-writes
        // the counter in one atomic step (server read, retried on contention), so
        // every concurrent ticket creation — bulk OR the detail-screen path — gets
        // a distinct number. The closure replaces the whole doc, so copy existing
        // fields forward; read the allocated number back from the committed value.
        var tcPrefix = 'T';
        var nextNum = 1;
        var txRes = await MastDB.transaction('cs_config/ticketing', function(cur) {
          var doc = (cur && typeof cur === 'object') ? cur : {};
          var next = {};
          for (var f in doc) next[f] = doc[f];
          next.prefix = doc.prefix || 'T';
          next.nextNumber = (typeof doc.nextNumber === 'number' ? doc.nextNumber : 1) + 1;
          return next;
        });
        if (txRes && txRes.value && typeof txRes.value.nextNumber === 'number') {
          tcPrefix = txRes.value.prefix || 'T';
          nextNum = txRes.value.nextNumber - 1;
        }
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
        await MastDB.orders.update(orderId, {
          cancellationTicketId: ticketId,
          cancellationTicketNumber: ticketNumber
        });
      } catch (csErr) {
        console.warn('CS ticket creation failed for cancelled order', orderId, csErr);
      }
    }
  }

  // DOM-free note-append core (single source for the legacy detail note handler
  // + the orders-v2 native action via OrdersBridge.addNote). The DOM read of
  // #orderNoteInput and the toast/input-clear UI live in the legacy handler;
  // this core is the legacy note-write logic VERBATIM with the note text lifted
  // to an argument. Shape-aware: preserves the map shape (tenant-MCP) when the
  // existing notes are an object, else appends to the array form. Reads the
  // live record from the global `orders` cache (seeded by the bridge when the
  // V2 twin drives the flow). Firestore writes are byte-identical. Returns void.
  async function _addOrderNoteCore(orderId, text) {
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
  }

  // DOM-free full-side-effect "mark shipped" core. Mirrors the direct-to-shipped
  // writes of the legacy transitionOrder('shipped') path: status='shipped' +
  // shippedAt, a 'shipped' statusHistory entry, and the onOrderShipped CF
  // (server-side inventory deduction + customer shipped-email). It does NOT
  // emit toasts / re-render / run the transition-validity guard — those are
  // caller concerns. Reads the live record from the global `orders` cache
  // (seeded by the bridge). This core is consumed by OrdersBridge.bulkMarkShipped,
  // which BOTH the legacy bulk handler (bulkOrdersMarkShipped) and the orders-v2
  // twin's bulk bar now call (PR3) — so the legacy bulk path runs FULL ship
  // side-effects instead of the bare status flip it used to do. Returns void.
  async function _markOrderShippedCore(orderId) {
    var o = orders[orderId];
    if (!o) return;
    var now = new Date().toISOString();
    var history = Array.isArray(o.statusHistory) ? o.statusHistory.slice() : (o.statusHistory ? Object.values(o.statusHistory) : []);
    history.push({ status: 'shipped', at: now, by: 'admin' });
    var updates = { status: 'shipped', shippedAt: now, statusHistory: history };
    await MastDB.orders.update(orderId, updates);
    Object.keys(updates).forEach(function(k) { o[k] = updates[k]; });
    await writeAudit('update', 'orders', orderId);
    // Trigger inventory deduction + shipped email via cloud function (non-fatal,
    // matches the legacy transitionOrder shipped branch).
    try {
      await firebase.functions().httpsCallable('onOrderShipped')({ orderId: orderId, tenantId: MastDB.tenantId() });
    } catch (shipErr) { console.error('onOrderShipped call failed:', shipErr); }
  }

  // ============================================================
  // viewOrder — open an order's detail view (PR3b).
  // ------------------------------------------------------------
  // Relocated from orders.js. The legacy #orders list/detail UI in orders.js is
  // retired (removed in cut-plan PR3b-2); orders-v2 is the sole order surface.
  // Every external opener routes here — fulfillment.js's "View" onclick, the
  // dashboard New-Orders / Ready-to-Ship cards, customers.js, history deep-links,
  // and the orders MastNavStack restorer — so it lives in the EAGER core to
  // resolve even when orders.js is unloaded (the default V2 mode). Navigate to the
  // orders route (loads orders-v2 if needed) and open the record once it lands in
  // V2.byId. This is the live V2-aware branch lifted verbatim from orders.js's
  // viewOrder; the obsolete legacy-detail fallback was dropped with that UI.
  function viewOrder(orderId) {
    selectedOrderId = orderId;
    navigateTo('orders');
    var _tries = 0;
    (function openWhenReady() {
      if (window.OrdersV2 && typeof OrdersV2.has === 'function' && OrdersV2.has(orderId)) {
        OrdersV2.open(orderId);
        return;
      }
      if (++_tries <= 60) setTimeout(openWhenReady, 100); // poll up to ~6s for load()
    })();
  }

  // ============================================================
  // Dashboard Cards (New Orders / Ready to Ship)
  // ============================================================
  // Relocated VERBATIM from orders.js (T6 PR4a). The shell calls these on every
  // dashboard render (renderDashCardWithGating) and from the orders real-time
  // listener refresh — both permanent consumers — so they live in the EAGER core
  // and no longer require a loadModule('orders'). They read the shell 'orders'
  // cache + ordersLoaded as bare globals (resolved at call-time, post-boot) and
  // the eager order display helpers above; DASHBOARD_CARDS / renderDashboardCard /
  // updateCardActivity / esc are shell globals.

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
  // Exports — window.OrdersCore namespace + back-compat window.<name> aliases
  // (the exact globals orders.js used to export, so all existing bare-global /
  // window.* call sites across modules + the shell are untouched).
  // ============================================================
  var OrdersCore = {
    orderStatusBadgeStyle: orderStatusBadgeStyle,
    etsySourceBadgeStyle: etsySourceBadgeStyle,
    getOrderDisplayNumber: getOrderDisplayNumber,
    getOrderItemsLabel: getOrderItemsLabel,
    formatOrderDate: formatOrderDate,
    formatOrderDateTime: formatOrderDateTime,
    renderOrderProgress: renderOrderProgress,
    ensureTenantTz: ensureTenantTz,
    tzPartsFromIso: tzPartsFromIso,
    // PR1b — order cache accessor + inventory/triage/production write cores
    getOrdersArray: getOrdersArray,
    getItemInventoryStatus: getItemInventoryStatus,
    getItemFulfillmentKey: getItemFulfillmentKey,
    triageAndConfirmOrder: triageAndConfirmOrder,
    reserveInventory: reserveInventory,
    releaseInventory: releaseInventory,
    pullFromStock: pullFromStock,
    createProductionRequests: createProductionRequests,
    // PR1c — render-coupled lifecycle + invoice surface (+ orderTotalDollars)
    orderTotalDollars: orderTotalDollars,
    loadOrders: loadOrders,
    transitionOrder: transitionOrder,
    isOrderInvoiceable: isOrderInvoiceable,
    getEffectiveInvoiceStatus: getEffectiveInvoiceStatus,
    generateInvoice: generateInvoice,
    sendInvoice: sendInvoice,
    markOrderInvoicePaid: markOrderInvoicePaid,
    resendInvoice: resendInvoice,
    buildInvoiceSection: buildInvoiceSection,
    // PR1d — order-write cores (cancel / add-note / mark-shipped)
    _cancelOrderCore: _cancelOrderCore,
    _addOrderNoteCore: _addOrderNoteCore,
    _markOrderShippedCore: _markOrderShippedCore,
    // PR3b — order-detail opener (routes through orders-v2)
    viewOrder: viewOrder,
    // PR4a — dashboard cards (shell renders these on every dashboard load)
    renderDashCardNewOrders: renderDashCardNewOrders,
    renderDashCardReadyToShip: renderDashCardReadyToShip
  };

  if (typeof window !== 'undefined') {
    window.OrdersCore = OrdersCore;
    window.orderStatusBadgeStyle = orderStatusBadgeStyle;
    window.etsySourceBadgeStyle = etsySourceBadgeStyle;
    window.getOrderDisplayNumber = getOrderDisplayNumber;
    window.getOrderItemsLabel = getOrderItemsLabel;
    window.formatOrderDate = formatOrderDate;
    window.formatOrderDateTime = formatOrderDateTime;
    window.renderOrderProgress = renderOrderProgress;
    // tz helpers — orders.js's V1 render code still bare-references these
    // (tzPartsFromIso / ensureTenantTz) until those screens are removed in a
    // later cut-plan PR; expose them so those references resolve.
    window.ensureTenantTz = ensureTenantTz;
    window.tzPartsFromIso = tzPartsFromIso;
    // PR1b — order cache accessor + inventory/triage/production write cores
    // (exact names orders.js used to export; bare-global + window.* callers in
    // fulfillment.js / orders-v2 / OrdersBridge / the V1 UI are untouched).
    window.getOrdersArray = getOrdersArray;
    window.getItemInventoryStatus = getItemInventoryStatus;
    window.getItemFulfillmentKey = getItemFulfillmentKey;
    window.triageAndConfirmOrder = triageAndConfirmOrder;
    window.reserveInventory = reserveInventory;
    window.releaseInventory = releaseInventory;
    window.pullFromStock = pullFromStock;
    window.createProductionRequests = createProductionRequests;
    // PR1c — render-coupled lifecycle + invoice surface (exact names orders.js
    // used to export). transitionOrder/loadOrders are bare-called by
    // fulfillment.js (no loadModule) — eager home closes that fragility;
    // generateInvoice is called by wholesale.js; the invoice fns + the
    // orderTotalDollars helper are bare-referenced by the V1 render code that
    // stays in orders.js, so they resolve to these window globals.
    window.orderTotalDollars = orderTotalDollars;
    window.loadOrders = loadOrders;
    window.transitionOrder = transitionOrder;
    window.isOrderInvoiceable = isOrderInvoiceable;
    window.getEffectiveInvoiceStatus = getEffectiveInvoiceStatus;
    window.generateInvoice = generateInvoice;
    window.sendInvoice = sendInvoice;
    window.markOrderInvoicePaid = markOrderInvoicePaid;
    window.resendInvoice = resendInvoice;
    window.buildInvoiceSection = buildInvoiceSection;
    // PR1d — order-write cores. The legacy V1 detail handlers in orders.js
    // (cancelOrder / addOrderNote) bare-call these, and OrdersBridge
    // delegates to them; expose the exact names so both resolve.
    window._cancelOrderCore = _cancelOrderCore;
    window._addOrderNoteCore = _addOrderNoteCore;
    window._markOrderShippedCore = _markOrderShippedCore;
    // PR3b — viewOrder (the order-detail opener) relocated here from orders.js so
    // fulfillment.js / customers.js / the dashboard cards / history deep-links /
    // the orders restorer resolve it with orders.js unloaded.
    window.viewOrder = viewOrder;
    // PR4a — dashboard cards (New Orders / Ready to Ship) relocated here from
    // orders.js so the shell dashboard renders them eagerly without a
    // loadModule('orders'); the orders real-time listener refresh path (typeof-
    // guarded in index.html) also resolves them.
    window.renderDashCardNewOrders = renderDashCardNewOrders;
    window.renderDashCardReadyToShip = renderDashCardReadyToShip;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OrdersCore;
  }
})();
