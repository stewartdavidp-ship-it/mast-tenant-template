/**
 * pos-v2.js — Sales Ledger, V2 (transaction archetype, standard-record-ui §10).
 *
 * The record of IN-PERSON sales: orders whose source is an in-person /
 * seller-entered channel (pos, manual, phone, comp, admin). Ringing up a sale
 * happens in the standalone /pos/ checkout app (composer archetype) — this
 * screen is where those sales land, day totals included, each row opening the
 * standard orders-v2 record slide-out.
 *
 * Near-clone of orders-v2 by design: same entity, same SO, custom column set
 * + source scoping + day tiles. Flag-gated (`uiRedesign`), route `#pos-v2`.
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
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI;
  var IN_PERSON = { pos: 'POS', manual: 'Manual', phone: 'Phone', comp: 'Comp', admin: 'Admin' };
  var STATUS_TONE = {
    placed: 'amber', confirmed: 'info', building: 'amber', packed: 'teal',
    shipped: 'teal', delivered: 'success', cancelled: 'neutral', refunded: 'danger'
  };

  var V2 = { rows: [], byId: {}, sortKey: 'placedAt', sortDir: 'desc', range: 'week', status: 'all', off: null };

  function isLedgerRow(o) { return !!IN_PERSON[String(o.source || '').toLowerCase()]; }
  function toRows(tree) {
    var out = [];
    Object.keys(tree || {}).forEach(function (k) {
      var o = tree[k]; if (!o || typeof o !== 'object') return;
      var r = Object.assign({ _key: k }, o);
      if (isLedgerRow(r)) out.push(r);
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
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[pos-v2] list', e); });
    if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
  }

  function rowTime(o) { var t = o.placedAt || o.createdAt; return t ? new Date(t).getTime() : 0; }
  function startOfToday() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function inRange(o) {
    if (V2.range === 'all') return true;
    var t = rowTime(o);
    if (V2.range === 'today') return t >= startOfToday();
    return t >= startOfToday() - 6 * 86400000; // week = today + prior 6 days
  }

  function rowTotal(o) { return U.Num.moneyVal(o, 'totalCents', 'total') || 0; }

  function visibleRows() {
    var rows = V2.rows.filter(inRange);
    if (V2.status !== 'all') rows = rows.filter(function (r) { return String(r.status || '').toLowerCase() === V2.status; });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      if (k === 'source') return IN_PERSON[String(r.source || '').toLowerCase()] || r.source;
      var f = MastEntity.get('orders-v2') && MastEntity.get('orders-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  // Distinct statuses present in the current date range — drives the status
  // filter dropdown (parity with the legacy Sales Ledger status filter), so the
  // operator only sees statuses their data actually contains.
  function statusOptions() {
    var seen = {};
    V2.rows.filter(inRange).forEach(function (r) { var s = String(r.status || '').toLowerCase(); if (s) seen[s] = true; });
    return Object.keys(seen).sort();
  }

  function columns() {
    var N = U.Num;
    return [
      { key: 'orderNumber', label: 'Sale', render: function (r) { return r.orderNumber || r._key; } },
      { key: 'placedAt', label: 'When', render: function (r) { return N.date(r.placedAt || r.createdAt) || '—'; } },
      { key: 'email', label: 'Customer', render: function (r) { return r.customerName || r.email || 'Walk-in'; } },
      { key: 'items', label: 'Items', align: 'right',
        render: function (r) { return Array.isArray(r.items) ? r.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : (r.itemCount || 0); } },
      { key: 'total', label: 'Total', align: 'right', render: function (r) { return N.money(rowTotal(r)) || '—'; } },
      { key: 'paymentMethod', label: 'Payment', render: function (r) { return r.paymentMethod || '—'; } },
      { key: 'source', label: 'Channel',
        render: function (r) { return U.badge(IN_PERSON[String(r.source || '').toLowerCase()] || r.source, 'teal'); } },
      { key: 'status', label: 'Status',
        render: function (r) { var s = String(r.status || '').toLowerCase(); return U.badge(s.replace(/_/g, ' '), STATUS_TONE[s] || 'neutral'); } }
    ];
  }

  function ensureTab() {
    var el = document.getElementById('posV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'posV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var rows = visibleRows();
    var sum = 0; rows.forEach(function (r) { if (String(r.status).toLowerCase() !== 'cancelled' && String(r.status).toLowerCase() !== 'refunded') sum += rowTotal(r); });
    var today = V2.rows.filter(function (r) { return rowTime(r) >= startOfToday(); });
    var todaySum = 0; today.forEach(function (r) { todaySum += rowTotal(r); });

    var pills = [['today', 'Today'], ['week', 'Last 7 days'], ['all', 'All']].map(function (p) {
      var on = V2.range === p[0];
      return '<button onclick="PosV2.setRange(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + p[1] + '</button>';
    }).join('');

    // Status filter (parity with legacy Sales Ledger). Reset a stale selection
    // that's no longer present in the current range so the list can't go blank.
    var statuses = statusOptions();
    if (V2.status !== 'all' && statuses.indexOf(V2.status) < 0) V2.status = 'all';
    var cap = function (s) { return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' '); };
    var statusSel = '<select onchange="PosV2.setStatus(this.value)" class="form-input" ' +
      'style="padding:6px 10px;font-size:0.85rem;width:auto;display:inline-block;vertical-align:middle;">' +
      '<option value="all"' + (V2.status === 'all' ? ' selected' : '') + '>All statuses</option>' +
      statuses.map(function (s) { return '<option value="' + s + '"' + (V2.status === s ? ' selected' : '') + '>' + cap(s) + '</option>'; }).join('') +
      '</select>';

    tab.innerHTML =
      U.pageHeader({ title: 'Sales Ledger', subtitle: 'in-person & seller-entered sales',
        actionsHtml: '<button class="btn btn-primary" onclick="PosV2.openCheckout()">Open POS checkout ↗</button>' +
          '<button class="btn btn-secondary" onclick="PosV2.exportCsv()">↓ Export</button>' }) +
      U.tiles([
        { k: (V2.range === 'today' ? 'Today' : V2.range === 'week' ? 'Last 7 days' : 'All time'), v: U.Num.money(sum), hero: true },
        { k: 'Sales shown', v: U.Num.count(rows.length) },
        { k: 'Today', v: U.Num.money(todaySum) + ' · ' + MastFormat.countNoun(today.length, 'sale') }
      ]) +
      '<div style="margin:14px 0;display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><div>' + pills + '</div>' + statusSel + '</div>' +
      window.MastEntity.renderList('orders-v2', {
        columns: columns(),
        rows: rows, sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'PosV2.sort', onRowClickFnName: 'PosV2.open',
        empty: { title: 'No in-person sales yet', message: 'Sales rung up at the POS checkout land here.' }
      });
  }

  window.PosV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'desc'; }
      render();
    },
    setRange: function (rg) { V2.range = rg; render(); },
    setStatus: function (st) { V2.status = st || 'all'; render(); },
    open: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      MastAdmin.loadModule('orders-v2').then(function () {
        window.MastEntity.openRecord('orders-v2', rec, 'read');
      }).catch(function (e) { console.error('[pos-v2] open', e); });
    },
    openCheckout: function () { try { window.open('../pos/', '_blank'); } catch (e) {} },
    exportCsv: function () { return window.MastEntity.exportRows('orders-v2', visibleRows(), 'sales-ledger-' + V2.range); }
  };

  MastAdmin.registerModule('pos-v2', {
    routes: { 'pos-v2': { tab: 'posV2Tab', setup: function () {
      ensureTab();
      MastAdmin.loadModule('orders-v2').then(function () { render(); load(); })
        .catch(function (e) { console.error('[pos-v2] setup', e); });
    } } }
  });
})();
