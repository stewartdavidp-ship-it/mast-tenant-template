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
    try { if (localStorage.getItem('mastUiRedesign') === '1') return true; } catch (e) {}
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
    label: 'Order', labelPlural: 'Orders', size: 'lg',
    recordId: function (o) { return o._key || o.id; },
    fields: [
      { name: 'orderNumber', label: 'Order', type: 'text', list: true, required: true, group: 'Order' },
      { name: 'email', label: 'Customer', type: 'text', list: true, group: 'Order' },
      { name: 'items', label: 'Items', type: 'number', list: true, group: 'Order',
        get: function (o) { return Array.isArray(o.items) ? o.items.length : (o.itemCount || o.items || 0); } },
      { name: 'total', label: 'Total', type: 'money', list: true, group: 'Order' },
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Order',
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      { name: 'tracking', label: 'Tracking', type: 'text', list: true, group: 'Fulfillment' },
      { name: 'source', label: 'Source', type: 'text', group: 'Order' },
      { name: 'placedAt', label: 'Placed', type: 'date', group: 'Order' }
    ],
    onSave: function (rec, mode) {
      var id = rec._key || rec.id;
      if (!id || !window.MastDB || !MastDB.orders) return true;
      // Edit mode persists only the operator-editable fields (status, tracking).
      return MastDB.orders.update(id, { status: rec.status, tracking: rec.tracking })
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
    if (!window.MastDB) return;
    var apply = function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    };
    if (MastDB.subscribe) { V2.off = MastDB.subscribe('admin/orders', apply); }
    else if (MastDB.list) { MastDB.list('admin/orders').then(apply); }
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
    var id = 'ordersV2Tab';
    var el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('section');
    el.id = id; el.className = 'tab-content'; el.style.display = 'none';
    var host = document.querySelector('main') || document.getElementById('content') || document.body;
    host.appendChild(el);
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
    routes: { 'orders-v2': { tab: 'ordersV2Tab', setup: function () { ensureTab(); if (!V2.off) load(); else render(); } } }
  });
})();
