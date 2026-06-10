/**
 * ship-v2.js — Ship queue, V2 (queue/worklist archetype, standard-record-ui §10).
 *
 * "What ships next": packed orders waiting on a label + everything in transit.
 * Same queue pattern as pack-v2 (one-click guarded advance via MastFlow; row
 * click opens the orders-v2 record SO). Marking shipped is hard-gated by the
 * pickship 'labeled' phase on a purchased label — when blocked, the record SO
 * checklist explains it.
 *
 * TEMP-LINK DEBT (tracked in sales-v2-build-plan.md): label purchase (Shippo
 * rates/buy) still happens on the classic Ship screen — the header link below
 * deep-links there. Native V2 label purchase is the queue archetype's P3.
 *
 * Flag-gated (`uiRedesign`), side-by-side route `#ship-v2`.
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

  var STAGES = {
    packed:            { phase: 'labeled', next: 'shipped',   nextLabel: 'Mark shipped →', bucket: 'label' },
    handed_to_carrier: { phase: 'shipped', next: 'delivered', nextLabel: 'Delivered ✓',    bucket: 'transit' },
    shipped:           { phase: 'shipped', next: 'delivered', nextLabel: 'Delivered ✓',    bucket: 'transit' }
  };
  var TONE = { packed: 'teal', handed_to_carrier: 'teal', shipped: 'teal' };

  var V2 = { rows: [], byId: {}, sortKey: 'placedAt', sortDir: 'asc', bucket: 'all', off: null, busy: {} };

  function inQueue(o) { return !!STAGES[String(o.status || '').toLowerCase()]; }
  function toRows(tree) {
    var out = [];
    Object.keys(tree || {}).forEach(function (k) {
      var o = tree[k]; if (!o || typeof o !== 'object') return;
      var r = Object.assign({ _key: k }, o);
      if (inQueue(r)) out.push(r);
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
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[ship-v2] list', e); });
    if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
  }

  function trackingLabel(o) {
    var t = o.tracking;
    if (t && typeof t === 'object') return [t.carrier, t.trackingNumber].filter(Boolean).join(' ');
    if (typeof t === 'string' && t) return t;
    var sh = o.shipping || {};
    return sh.trackingNumber || sh.tracking_number || '';
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.bucket !== 'all') rows = rows.filter(function (r) { return STAGES[String(r.status).toLowerCase()].bucket === V2.bucket; });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      if (k === 'tracking') return trackingLabel(r);
      var f = MastEntity.get('orders-v2') && MastEntity.get('orders-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function columns() {
    var N = window.MastUI.Num;
    return [
      { key: 'orderNumber', label: 'Order', render: function (r) { return r.orderNumber || r._key; } },
      { key: 'email', label: 'Customer', render: function (r) { return r.customerName || r.email || '—'; } },
      { key: 'total', label: 'Total', align: 'right', render: function (r) { return N.money(N.moneyVal(r, 'totalCents', 'total')) || '—'; } },
      { key: 'status', label: 'Status',
        render: function (r) { var s = String(r.status).toLowerCase(); return window.MastUI.badge(s.replace(/_/g, ' '), TONE[s] || 'neutral'); } },
      { key: 'tracking', label: 'Tracking',
        render: function (r) { return trackingLabel(r) || '<span style="color:var(--warm-gray);">—</span>'; } },
      { key: '_advance', label: '', sortable: false, align: 'right', render: function (r) {
          var st = STAGES[String(r.status).toLowerCase()]; if (!st) return '';
          var busy = V2.busy[r._key];
          return '<button class="btn btn-secondary" ' + (busy ? 'disabled ' : '') +
            'style="font-size:0.78rem;padding:4px 10px;white-space:nowrap;" ' +
            'onclick="event.stopPropagation();ShipV2.advance(\'' + r._key + '\')">' +
            (busy ? '…' : st.nextLabel) + '</button>';
        } }
    ];
  }

  function ensureTab() {
    var el = document.getElementById('shipV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'shipV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function counts() {
    var c = { all: V2.rows.length, label: 0, transit: 0 };
    V2.rows.forEach(function (r) { c[STAGES[String(r.status).toLowerCase()].bucket]++; });
    return c;
  }

  function render() {
    var tab = ensureTab();
    var c = counts();
    var pills = [['all', 'All'], ['label', 'To ship'], ['transit', 'In transit']].map(function (p) {
      var on = V2.bucket === p[0];
      return '<button onclick="ShipV2.setBucket(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + (c[p[0]] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Ship</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + window.MastUI.Num.count(V2.rows.length) + ' in queue</span>' +
        // Tracked temp-link (debt): native label purchase is queue P3.
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="ShipV2.classicLabels()">Buy labels (classic) ↗</button>' +
        '<button class="btn btn-secondary" onclick="ShipV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      window.MastEntity.renderList('orders-v2', {
        columns: columns(),
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ShipV2.sort', onRowClickFnName: 'ShipV2.open',
        empty: { title: 'Nothing waiting to ship', message: 'Packed orders land here until they\'re delivered.' }
      });
  }

  function advance(id) {
    var rec = V2.byId[id]; if (!rec || V2.busy[id]) return;
    var st = STAGES[String(rec.status).toLowerCase()]; if (!st) return;
    V2.busy[id] = true; render();
    var done = function () { delete V2.busy[id]; render(); };
    // Engine FIRST, then the spec — the spec's IIFE registers itself with
    // window.MastFlow and silently no-ops if the engine isn't loaded yet
    // (the Promise.all race behind 'Unknown workflow: pickship').
    MastAdmin.loadModule('workflowEngine')
      .then(function () { return MastAdmin.loadModule('pickshipWorkflow'); })
      .then(function () {
        rec.id = rec.id || rec._key;
        return window.MastFlow.transition('pickship', rec, st.next, { recordId: rec.id, expectedFromPhase: st.phase });
      })
      .then(function () {
        if (window.showToast) showToast((rec.orderNumber || 'Order') + ' → ' + st.next);
        done();
      })
      .catch(function (e) {
        done();
        if (e && e.code === 'REQUIREMENTS_UNMET') {
          if (window.showToast) showToast('Blocked — see the checklist for what\'s missing', true);
          open(id);
        } else if (e && e.code === 'STALE_STATE') {
          if (window.showToast) showToast('Order changed elsewhere — refreshing', true);
          load();
        } else {
          console.error('[ship-v2] advance', e);
          if (window.showToast) showToast('Could not advance: ' + (e && e.message || e), true);
        }
      });
  }

  function open(id) {
    var rec = V2.byId[id]; if (!rec) return;
    MastAdmin.loadModule('orders-v2').then(function () {
      window.MastEntity.openRecord('orders-v2', rec, 'read');
    }).catch(function (e) { console.error('[ship-v2] open', e); });
  }

  window.ShipV2 = {
    sort: function (key) {
      if (key === '_advance') return;
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setBucket: function (b) { V2.bucket = b; render(); },
    open: open,
    advance: advance,
    classicLabels: function () { if (window.navigateToClassic) navigateToClassic('ship'); },
    exportCsv: function () { return window.MastEntity.exportRows('orders-v2', visibleRows(), 'ship-queue'); }
  };

  MastAdmin.registerModule('ship-v2', {
    routes: { 'ship-v2': { tab: 'shipV2Tab', setup: function () {
      ensureTab();
      MastAdmin.loadModule('orders-v2').then(function () { render(); load(); })
        .catch(function (e) { console.error('[ship-v2] setup', e); });
    } } }
  });
})();
