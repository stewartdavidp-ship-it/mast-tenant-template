/**
 * lots-v2.js — Tier 1.5 P2: Inventory Lots on the V2 engine.
 *
 * Ports the legacy procurement.js Inventory-Lots tab + lot-detail drill to a
 * MastEntity list + Faceted Record. Improves on legacy, which only showed
 * MATERIAL lots — this covers BOTH material and product lots (admin/materialLots
 * + admin/productLots), tagged by kind. Read-only (lots are created by receiving;
 * the only mutation is landed-cost allocation, surfaced on the PO receipt in
 * procurement-v2). Flag-gated (?ui=1); reached from the procurement-v2 header.
 */
(function () {
  'use strict';
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  // Un-gated (Tier 1.5 P7, 2026-06-06): the procurement domain is the V2 default
  // for all users — no ?ui=1 required. The shared engine (MastEntity/MastUI) is
  // loaded unconditionally at boot, so self-registering here is always safe.

  var U = window.MastUI, N = U.Num, esc = U._esc;
  function money(v) { return N.money(v) || '$0.00'; }

  MastEntity.define('lots-v2', {
    label: 'Inventory lot', labelPlural: 'Inventory lots', size: 'lg', route: 'lots-v2',
    recordId: function (l) { return l.lotId; },
    fields: [
      { name: 'lotNumber', label: 'Lot', type: 'text', list: true, readOnly: true, get: function (l) { return l.lotNumber || String(l.lotId).slice(0, 8); } },
      { name: 'item', label: 'Item', type: 'text', list: true, readOnly: true, get: function (l) { return l._itemName; } },
      { name: 'kind', label: 'Kind', type: 'text', list: true, readOnly: true, get: function (l) { return l._kind; } },
      { name: 'remaining', label: 'Remaining', type: 'number', list: true, readOnly: true, get: function (l) { return Number(l.qtyRemaining) || 0; } },
      { name: 'unitCost', label: 'Unit cost', type: 'money', list: true, readOnly: true, get: function (l) { return Number(l.unitCost) || 0; } },
      { name: 'vendor', label: 'Vendor', type: 'text', list: true, readOnly: true, get: function (l) { return l._vendor; } },
      { name: 'received', label: 'Received', type: 'date', list: true, readOnly: true, get: function (l) { return l.receivedAt || null; } }
    ],
    // Lazy: when drilled cold (e.g. from a procurement receipt line) the lots
    // data isn't loaded yet — load on demand, then resolve. Route-setup still
    // calls load() for the list; this only fills the gap for a direct drill.
    fetch: function (id) {
      if (L.byId[id] || L.loaded) return Promise.resolve(L.byId[id] || null);
      return load().then(function () { return L.byId[id] || null; });
    },
    detail: {
      render: function (UI, l) {
        var tiles = UI.tiles([
          { k: 'Remaining', v: String(Number(l.qtyRemaining) || 0) + (l._uom ? ' ' + l._uom : ''), hero: true },
          { k: 'Received', v: String(Number(l.qtyReceived) || 0) },
          { k: 'Unit cost', v: money(l.unitCost) },
          { k: 'Value', v: money((Number(l.qtyRemaining) || 0) * (Number(l.unitCost) || 0)) }
        ]);
        var info = UI.kv([
          { k: 'Item', v: esc(l._itemName) + ' · ' + esc(l._kind) },
          { k: 'Lot #', v: esc(l.lotNumber || String(l.lotId).slice(0, 8)) },
          { k: 'Unit cost', v: money(l.unitCost) + (typeof l.unitCostOriginal === 'number' && l.unitCostOriginal !== l.unitCost ? ' <span class="mu-sub">(was ' + money(l.unitCostOriginal) + ' before landed)</span>' : '') },
          { k: 'Currency', v: l.currency ? esc(l.currency) : '—' },
          { k: 'Received', v: l.receivedAt ? N.date(l.receivedAt) : '—' },
          { k: 'Expires', v: l.expiresAt ? N.date(l.expiresAt) : '—' },
          { k: 'Ownership', v: (typeof l.owned === 'boolean') ? (l.owned ? 'Owned' : 'On memo / consignment') : '—' }
        ]);
        var prov = UI.kv([
          { k: 'Vendor', v: esc(l._vendor || '—') },
          { k: 'PO', v: l._poNumber ? esc(l._poNumber) : '—' },
          { k: 'Receipt', v: l._receiptRef ? esc(l._receiptRef) : '—' }
        ]);
        var out = tiles + UI.card('Lot', info) + UI.card('Provenance', prov);
        if (l.attrs && Object.keys(l.attrs).length) {
          out += UI.card('Attributes', UI.kv(Object.keys(l.attrs).map(function (k) { return { k: esc(k), v: esc(String(l.attrs[k])) }; })));
        }
        if (l.notes) out += UI.card('Audit / notes', '<div style="white-space:pre-wrap;">' + esc(l.notes) + '</div>');
        return out;
      }
    }
  });

  var L = { rows: [], byId: {}, sortKey: 'received', sortDir: 'desc', q: '', kindFilter: 'all', showEmpty: false, loaded: false };

  function load() {
    return Promise.all([
      Promise.resolve(MastDB.get('admin/materialLots')),
      Promise.resolve(MastDB.get('admin/productLots')),
      Promise.resolve(MastDB.get('admin/vendors')),
      Promise.resolve(MastDB.get('admin/materials')),
      Promise.resolve(MastDB.products && MastDB.products.list ? MastDB.products.list() : MastDB.get('public/products')),
      Promise.resolve(MastDB.get('admin/purchaseReceipts')),
      Promise.resolve(MastDB.get('admin/purchaseOrders'))
    ]).then(function (res) {
      // Products live at public/products; list() returns array OR keyed — normalize for name lookup.
      var rawProducts = res[4]; var products = {};
      (Array.isArray(rawProducts) ? rawProducts : Object.values(rawProducts || {})).forEach(function (p) { if (p) { var id = p.pid || p._key || p.id; if (id) products[id] = p; } });
      var mLots = res[0] || {}, pLots = res[1] || {}, vendors = res[2] || {}, materials = res[3] || {}, receipts = res[5] || {}, pos = res[6] || {};
      var out = [];
      function add(lot, kind) {
        if (!lot || typeof lot !== 'object') return;
        var l = Object.assign({}, lot);
        l._kind = kind;
        l._itemName = kind === 'material' ? ((materials[l.targetId] && materials[l.targetId].name) || l.targetId) : ((products[l.targetId] && products[l.targetId].name) || l.targetId);
        l._uom = kind === 'material' ? ((materials[l.targetId] && materials[l.targetId].unitOfMeasure) || '') : '';
        l._vendor = (vendors[l.vendorId] && vendors[l.vendorId].name) || (l.vendorId ? String(l.vendorId).slice(0, 8) : '—');
        var rcpt = l.receiptId ? receipts[l.receiptId] : null;
        l._receiptRef = rcpt ? ((rcpt.vendorInvoiceRef || String(rcpt.receiptId).slice(0, 8)) + (rcpt.receivedAt ? ' · ' + N.date(rcpt.receivedAt) : '')) : '';
        var po = rcpt ? pos[rcpt.poId] : null;
        l._poNumber = po ? (po.poNumber || String(po.poId).slice(0, 8)) : '';
        out.push(l);
      }
      Object.keys(mLots).forEach(function (k) { add(mLots[k], 'material'); });
      Object.keys(pLots).forEach(function (k) { add(pLots[k], 'product'); });
      L.rows = out; L.byId = {}; out.forEach(function (r) { L.byId[r.lotId] = r; });
      L.loaded = true; render();
    }).catch(function (e) { console.error('[lots-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = L.rows;
    if (!L.showEmpty) rows = rows.filter(function (l) { return (Number(l.qtyRemaining) || 0) > 0; });
    if (L.kindFilter !== 'all') rows = rows.filter(function (l) { return l._kind === L.kindFilter; });
    if (L.q) {
      var q = L.q.toLowerCase();
      rows = rows.filter(function (l) {
        return String(l._itemName || '').toLowerCase().indexOf(q) >= 0 ||
          String(l.lotNumber || '').toLowerCase().indexOf(q) >= 0 ||
          String(l._vendor || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, L.sortKey, L.sortDir, function (r, k) {
      var f = MastEntity.get('lots-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('lotsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'lotsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var totalVal = L.rows.filter(function (l) { return (Number(l.qtyRemaining) || 0) > 0; })
      .reduce(function (s, l) { return s + (Number(l.qtyRemaining) || 0) * (Number(l.unitCost) || 0); }, 0);
    var filters = [['all', 'All'], ['material', 'Materials'], ['product', 'Products']].map(function (f) {
      var on = L.kindFilter === f[0];
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="LotsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
    }).join(' ');
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Inventory lots</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">value ' + money(totalVal) + '</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="navigateTo(\'procurement-v2\')">← Purchase orders</button>' +
        '<button class="btn btn-secondary" onclick="LotsV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;align-items:center;">' + filters +
        '<label style="margin-left:8px;font-size:0.85rem;color:var(--warm-gray);display:flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" ' + (L.showEmpty ? 'checked' : '') + ' onchange="LotsV2.toggleEmpty(this.checked)"> Show consumed</label>' +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search lot / item / vendor…" value="' + esc(L.q) + '" oninput="LotsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('lots-v2', {
        rows: visibleRows(), sortKey: L.sortKey, sortDir: L.sortDir,
        onSortFnName: 'LotsV2.sort', onRowClickFnName: 'LotsV2.open',
        empty: { title: 'No inventory lots', message: L.loaded ? 'No lots match this filter.' : 'Loading…' }
      });
  }

  window.LotsV2 = {
    sort: function (key) {
      if (L.sortKey === key) L.sortDir = (L.sortDir === 'asc' ? 'desc' : 'asc');
      else { L.sortKey = key; L.sortDir = (key === 'received' || key === 'remaining' || key === 'unitCost' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { L.kindFilter = f; render(); },
    toggleEmpty: function (on) { L.showEmpty = !!on; render(); },
    search: function (v) { L.q = v || ''; render(); },
    open: function (id) { MastEntity.get('lots-v2').fetch(id).then(function (rec) { if (rec) MastEntity.openRecord('lots-v2', rec, 'read'); }); },
    exportCsv: function () { return MastEntity.exportRows('lots-v2', visibleRows(), 'all'); },
    reload: function () { return load(); }
  };

  MastAdmin.registerModule('lots-v2', {
    routes: { 'lots-v2': { tab: 'lotsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
