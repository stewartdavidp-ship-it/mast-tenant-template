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
    tzPartsFromIso: tzPartsFromIso
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
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OrdersCore;
  }
})();
