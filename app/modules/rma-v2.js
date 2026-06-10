/**
 * rma-v2.js — Returns, V2 (transaction archetype, standard-record-ui §10).
 *
 * Same engine pattern as orders-v2, over the same orders/{id} records, but
 * scoped to the return lifecycle: list = orders in any return_* state (plus
 * recently resolved), detail = transaction template with the 'return' MastFlow
 * (requested → approved → in transit → received → resolved). Refund money
 * movement stays external (record-only, same policy as the refund tools).
 *
 * Flag-gated (`uiRedesign`), side-by-side route `#rma-v2`.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity) return;
  if (!flagOn()) return;

  var RETURN_STATUSES = ['return_requested', 'return_approved', 'return_shipped', 'return_received', 'partially_returned'];
  var STATUS_TONE = {
    return_requested: 'amber', return_approved: 'info', return_shipped: 'teal',
    return_received: 'teal', partially_returned: 'success', refunded: 'success', cancelled: 'neutral'
  };
  function statusLabel(s) { s = String(s || '').replace(/^return_/, '').replace(/_/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); }

  MastEntity.define('rma-v2', {
    label: 'Return', labelPlural: 'Returns', size: 'xl',
    recordId: function (o) { return o._key || o.id; },
    fields: [
      { name: 'orderNumber', label: 'Order', type: 'text', list: true, required: true, group: 'Return', readOnly: true },
      { name: 'email', label: 'Customer', type: 'text', list: true, group: 'Return', readOnly: true,
        get: function (o) { return o.customerName || o.email || ''; } },
      { name: 'total', label: 'Order total', type: 'money', list: true, group: 'Return', readOnly: true,
        get: function (o) { return window.MastUI.Num.moneyVal(o, 'totalCents', 'total'); } },
      { name: 'refunded', label: 'Refunded', type: 'money', list: true, group: 'Return', readOnly: true,
        get: function (o) { return (typeof o.refundedCents === 'number') ? o.refundedCents / 100 : null; } },
      // Status is governed by the return workflow — never a form dropdown.
      // tone() receives only the value, which is the friendly label in list
      // cells (via get) but the raw enum in the SO header badge — normalize both.
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Return', readOnly: true,
        get: function (o) { return statusLabel(o.status); },
        tone: function (v) {
          var s = String(v || '').toLowerCase().replace(/^return_/, '').replace(/_/g, ' ');
          return ({ requested: 'amber', approved: 'info', shipped: 'teal', received: 'teal',
            'partially returned': 'success', refunded: 'success', cancelled: 'neutral' })[s] || 'neutral';
        } },
      { name: 'returnReason', label: 'Reason', type: 'text', list: true, group: 'Return',
        get: function (o) { return o.returnReason || o.rmaReason || ''; } },
      { name: 'returnTracking', label: 'Return tracking', type: 'text', group: 'Return' },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, group: 'Return', readOnly: true }
    ],
    route: 'rma-v2',
    fetch: function (id) { return MastDB.orders.get(id).then(function (o) { return o ? Object.assign({ _key: id }, o) : null; }); },
    detail: {
      template: 'transaction',
      flow: 'return',
      flowModule: 'returnWorkflow',
      customerEntity: 'customers-v2',
      tiles: function (r) {
        var N = window.MastUI.Num;
        var n = Array.isArray(r.items) ? r.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : 0;
        return [
          { k: 'Order total', v: N.money(N.moneyVal(r, 'totalCents', 'total')) || '—', hero: true },
          { k: 'Refunded', v: (typeof r.refundedCents === 'number') ? N.money(r.refundedCents / 100) : '—' },
          { k: 'Items', v: n },
          { k: 'Reason', v: r.returnReason || r.rmaReason || '—' }
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
        return { status: statusLabel(r.status), tone: STATUS_TONE[String(r.status || '').toLowerCase()] || 'neutral',
          tracking: r.returnTracking || null };
      },
      timeline: function (r) {
        var N = window.MastUI.Num;
        var hist = Array.isArray(r.statusHistory) ? r.statusHistory : [];
        var ev = hist.filter(function (h) {
          var s = String(h.status || '');
          return /^return_/.test(s) || s === 'refunded' || s === 'delivered' || s === 'partially_returned';
        }).map(function (h) { return { label: statusLabel(h.status), at: N.date(h.at), done: true }; });
        if (!ev.length) ev.push({ label: statusLabel(r.status), at: N.date(r.updatedAt), done: true });
        return ev;
      }
    },
    onSave: function (rec, mode) {
      if (typeof window.can === 'function' && !window.can('rma', 'edit')) {
        if (window.showToast) showToast('You do not have permission to edit returns.', true);
        return false;
      }
      var id = rec._key || rec.id;
      if (!id || !window.MastDB || !MastDB.orders) return true;
      // Status advances through the return workflow; edit persists the
      // return-handling fields only.
      return MastDB.orders.update(id, {
        returnReason: rec.returnReason || null,
        returnTracking: rec.returnTracking || null
      }).then(function () { return true; });
    }
  });

  var V2 = { rows: [], byId: {}, sortKey: 'updatedAt', sortDir: 'desc', filter: 'open', off: null };

  function isReturnRow(o) {
    var s = String(o.status || '').toLowerCase();
    if (RETURN_STATUSES.indexOf(s) !== -1) return true;
    // Resolved view: refunded orders that went through a return (statusHistory
    // carries a return_* hop) — keeps plain cancel/refund orders out of this queue.
    if (s === 'refunded' && Array.isArray(o.statusHistory)) {
      return o.statusHistory.some(function (h) { return /^return_/.test(String(h.status || '')); });
    }
    return false;
  }
  function isOpen(o) {
    var s = String(o.status || '').toLowerCase();
    return RETURN_STATUSES.indexOf(s) !== -1 && s !== 'partially_returned';
  }

  function toRows(tree) {
    var out = [];
    Object.keys(tree || {}).forEach(function (k) {
      var o = tree[k]; if (!o || typeof o !== 'object') return;
      var r = Object.assign({ _key: k }, o);
      if (isReturnRow(r)) out.push(r);
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
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[rma-v2] list', e); });
    if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.filter === 'open') rows = rows.filter(isOpen);
    else if (V2.filter === 'resolved') rows = rows.filter(function (r) { return !isOpen(r); });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('rma-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('rmaV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'rmaV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var open = V2.rows.filter(isOpen).length;
    var pills = [['open', 'Open', open], ['resolved', 'Resolved', V2.rows.length - open], ['all', 'All', V2.rows.length]].map(function (p) {
      var on = V2.filter === p[0];
      return '<button onclick="RmaV2.setFilter(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + p[2] + '</span></button>';
    }).join('');

    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Returns</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + window.MastUI.Num.count(V2.rows.length) + ' returns</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="RmaV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      window.MastEntity.renderList('rma-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'RmaV2.sort', onRowClickFnName: 'RmaV2.open',
        empty: { title: 'No returns', message: 'Customer returns land here when requested.' }
      });
  }

  window.RmaV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setFilter: function (s) { V2.filter = s; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) window.MastEntity.openRecord('rma-v2', rec, 'read'); },
    exportCsv: function () { return window.MastEntity.exportRows('rma-v2', visibleRows(), V2.filter); }
  };

  MastAdmin.registerModule('rma-v2', {
    routes: { 'rma-v2': { tab: 'rmaV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
