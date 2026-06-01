/**
 * orders-v2.js — PROOF module (Phase 1). The Orders screen rebuilt as a
 * MastEntity schema instead of hand-written UI, to validate the engine on a
 * real, rich record before any fan-out (docs/ux-audit/CONTROL-PLANE.md).
 *
 * Flag-gated (`uiRedesign`) and self-mounting on route `#orders-v2`, so it runs
 * SIDE-BY-SIDE with the legacy orders.js for comparison — no hijack of the live
 * route during the proof. Verify on a dev pod: list + sort + filter + row→slide-out
 * read→edit→dirty-guard→save, export round-trip, and BOTH dark/light modes.
 *
 * The whole screen below is derived from one schema — there is no bespoke list,
 * modal, dirty-flag, or CSV code here. That is the point of the proof.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      // Reviewer convenience: ?ui=1 in the URL turns it on (and persists), so a
      // single link works in any browser — no devtools/localStorage needed.
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity) return;       // engines must be loaded
  if (!flagOn()) return;                                     // strangler: off by default

  // ── Schema: the entire Orders surface, declaratively ────────────────
  var STATUS_TONE = {
    placed: 'amber', confirmed: 'info', building: 'amber', packed: 'teal',
    shipped: 'teal', delivered: 'success', cancelled: 'neutral', refunded: 'danger',
    payment_failed: 'danger'
  };
  MastEntity.define('orders-v2', {
    label: 'Order', labelPlural: 'Orders', size: 'xl',
    recordId: function (o) { return o._key || o.id; },
    fields: [
      { name: 'orderNumber', label: 'Order', type: 'text', list: true, required: true, group: 'Order', readOnly: true },
      { name: 'email', label: 'Customer', type: 'text', list: true, group: 'Order', readOnly: true },
      { name: 'items', label: 'Items', type: 'number', list: true, group: 'Order',
        get: function (o) { return Array.isArray(o.items) ? o.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : (o.itemCount || 0); } },
      { name: 'total', label: 'Total', type: 'money', list: true, group: 'Order',
        get: function (o) { return window.MastUI.Num.moneyVal(o, 'totalCents', 'total'); } },
      // Status is GOVERNED BY THE WORKFLOW (detail.flow), not edited as a field —
      // readOnly so the form never offers a status dropdown (doc 17 §2). It still
      // drives the list badge + the slide-out header badge.
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Fulfillment', readOnly: true,
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      // Item-type tags so you can see what kinds of items an order contains.
      { name: 'contents', label: 'Contents', type: 'tags', list: true, sortable: false, group: 'Order',
        get: function (o) {
          var lbl = { 'product': 'Product', 'gift-card': 'Gift Card', 'class': 'Class', 'class-materials': 'Materials', 'pass': 'Pass' };
          var seen = {}, out = [];
          (o.items || []).forEach(function (it) { var t = it.itemType || 'product'; if (!seen[t]) { seen[t] = 1; out.push(lbl[t] || t); } });
          return out;
        } },
      { name: 'tracking', label: 'Tracking', type: 'text', list: true, group: 'Fulfillment',
        get: function (o) { var t = o.tracking; if (!t) return ''; if (typeof t === 'string') return t; return [t.carrier, t.trackingNumber].filter(Boolean).join(' '); } },
      { name: 'source', label: 'Source', type: 'text', group: 'Order', readOnly: true },
      { name: 'placedAt', label: 'Placed', type: 'date', group: 'Order', readOnly: true }
    ],
    // Drill target + restorer source (fetch by id).
    route: 'orders-v2',
    fetch: function (id) { return MastDB.orders.get(id).then(function (o) { return o ? Object.assign({ _key: id }, o) : null; }); },
    // Designed Transaction detail (read mode) — all from real fields (doc 17).
    // detail.flow composes the MastFlow pickship lifecycle: the Process pane
    // hosts the stepper + checklist + guarded Advance (NOT a status dropdown).
    detail: {
      template: 'transaction',
      flow: 'pickship',
      flowModule: 'pickshipWorkflow',
      customerEntity: 'customers-v2',
      tiles: function (r) {
        var N = window.MastUI.Num;
        var n = Array.isArray(r.items) ? r.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : 0;
        return [
          { k: 'Total', v: N.money(N.moneyVal(r, 'totalCents', 'total')) || '—', hero: true },
          { k: 'Items', v: n },
          { k: 'Payment', v: r.paymentMethod || '—' },
          { k: 'Source', v: r.source || '—' }
        ];
      },
      lineItems: function (r) {
        var N = window.MastUI.Num;
        return (r.items || []).map(function (it) {
          return { name: it.productName || it.name || 'Item', qty: it.qty,
            price: N.moneyVal(it, 'priceCents', 'price'), total: N.moneyVal(it, 'lineTotalCents', 'lineTotal') };
        });
      },
      totals: function (r) {
        var N = window.MastUI.Num;
        return { subtotal: N.moneyVal(r, 'subtotalCents', 'subtotal'), shipping: N.moneyVal(r, 'shippingCents', 'shipping'),
          tax: N.moneyVal(r, 'taxCents', 'tax'), total: N.moneyVal(r, 'totalCents', 'total') };
      },
      customer: function (r) {
        var sh = r.shipping || {};
        var addr = [sh.address1 || sh.line1, (sh.city ? sh.city + (sh.state ? ', ' + sh.state : '') : '')].filter(Boolean).join('<br>');
        return { id: r.customerId, name: r.customerName || r.email, email: r.email, address: addr };
      },
      fulfillment: function (r) {
        var t = r.tracking, track = null;
        if (t && typeof t === 'object') {
          var label = [t.carrier, t.trackingNumber].filter(Boolean).join(' ');
          track = t.trackingUrl ? '<a href="' + t.trackingUrl + '" target="_blank" rel="noopener" style="color:var(--teal);">' + label + '</a>' : label;
        } else if (typeof t === 'string') { track = t; }
        return { status: r.status, tone: STATUS_TONE[String(r.status || '').toLowerCase()] || 'neutral', tracking: track || null };
      },
      timeline: function (r) {
        var ev = [{ label: 'Placed', at: window.MastUI.Num.date(r.placedAt), done: true }];
        var st = String(r.status || '').toLowerCase();
        if (st && st !== 'placed') ev.push({ label: st.charAt(0).toUpperCase() + st.slice(1), at: window.MastUI.Num.date(r.updatedAt), done: true });
        return ev;
      }
    },
    onSave: function (rec, mode) {
      var id = rec._key || rec.id;
      if (!id || !window.MastDB || !MastDB.orders) return true;
      // Status is governed by the workflow (Process pane), so edit persists only
      // tracking. Status advances through MastFlow, never a form write.
      return MastDB.orders.update(id, { tracking: rec.tracking })
        .then(function () { return true; });
    }
  });

  // ── State + data (same source as legacy: admin/orders) ──────────────
  var V2 = { rows: [], byId: {}, sortKey: 'placedAt', sortDir: 'desc', filter: 'all', off: null };

  function toRows(tree) {
    var out = [];
    tree = tree || {};
    Object.keys(tree).forEach(function (k) {
      var o = tree[k]; if (!o || typeof o !== 'object') return;
      out.push(Object.assign({ _key: k }, o));
    });
    return out;
  }
  function load() {
    var o = window.MastDB && MastDB.orders;
    if (!o) return;
    var apply = function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    };
    // Real source = the orders entity accessor (53 records), NOT raw admin/orders
    // (which holds only QBO-webhook test docs). list() for initial paint; listen()
    // for live updates where available.
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[orders-v2] list', e); });
    if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.filter && V2.filter !== 'all') {
      rows = rows.filter(function (r) { return String(r.status || '').toLowerCase() === V2.filter; });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('orders-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function statusCounts() {
    var c = { all: V2.rows.length };
    V2.rows.forEach(function (r) { var s = String(r.status || '').toLowerCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }

  function ensureTab() {
    // Container now lives in index.html (matches every other module); fall back
    // to dynamic creation only if absent.
    var el = document.getElementById('ordersV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ordersV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var counts = statusCounts();
    var pills = ['all', 'placed', 'confirmed', 'delivered', 'cancelled', 'refunded'].map(function (s) {
      var on = V2.filter === s;
      return '<button onclick="OrdersV2.setFilter(\'' + s + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--charcoal,var(--text))' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        s.charAt(0).toUpperCase() + s.slice(1) + ' <span style="color:var(--warm-gray);">' + (counts[s] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Orders</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + window.MastUI.Num.count(V2.rows.length) + ' orders</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="OrdersV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      window.MastEntity.renderList('orders-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'OrdersV2.sort', onRowClickFnName: 'OrdersV2.open',
        empty: { title: 'No orders match these filters', message: 'Try clearing filters.' }
      });
  }

  // ── Public handlers (referenced by the engine-rendered HTML) ────────
  window.OrdersV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setFilter: function (s) { V2.filter = s; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) window.MastEntity.openRecord('orders-v2', rec, 'read'); },
    exportCsv: function () { return window.MastEntity.exportRows('orders-v2', visibleRows(), V2.filter); }
  };

  // ── Register the side-by-side route ─────────────────────────────────
  MastAdmin.registerModule('orders-v2', {
    routes: { 'orders-v2': { tab: 'ordersV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
