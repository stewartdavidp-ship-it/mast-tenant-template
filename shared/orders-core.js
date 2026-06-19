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
  // relocation with NO behavior change. The V1 UI screens + the render-coupled
  // lifecycle/invoice surfaces (transitionOrder, loadOrders, generateInvoice,
  // the cancel/note/email/bulk/refund cores) stay in orders.js for later
  // cut-plan PRs — they call renderOrderDetail/renderOrders (V1 UI).
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
    createProductionRequests: createProductionRequests
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
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OrdersCore;
  }
})();
