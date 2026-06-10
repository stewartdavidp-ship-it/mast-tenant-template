/**
 * fulfillment-v2.js — ONE fulfillment queue (queue archetype,
 * standard-record-ui §10), replacing the separate pack-v2 + ship-v2 twins.
 *
 * Operator review (2026-06-10): Pack and Ship are not two objects — they're
 * one continuous process over the same orders, sliced by stage. This module
 * serves BOTH routes (#pack-v2 and #ship-v2) with one queue spanning the
 * whole post-payment pipeline; the route you arrive by only picks the default
 * stage bucket (Pack → "To pick", Ship → "To ship"). Same one-click guarded
 * advance via MastFlow as before (blocked → record SO checklist), row click
 * opens the standard orders-v2 record SO.
 *
 * TEMP-LINK DEBT (tracked): label purchase (Shippo rates/buy) deep-links to
 * classic Ship until the native label flow lands.
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

  // The whole post-payment pipeline, one stage map. Phase keys match
  // pickship.workflow.js; 'pack' (phase picked) is the branch point and
  // advances into the pack-ship branch explicitly.
  var STAGES = {
    confirmed:         { phase: 'confirmed', next: 'picked',    nextLabel: 'Picked ✓',      bucket: 'pick' },
    building:          { phase: 'confirmed', next: 'picked',    nextLabel: 'Picked ✓',      bucket: 'pick' },
    ready:             { phase: 'confirmed', next: 'picked',    nextLabel: 'Picked ✓',      bucket: 'pick' },
    pack:              { phase: 'picked',    next: 'packing',   nextLabel: 'Pack & ship →', bucket: 'pack', branchChoice: 'pack-ship' },
    packing:           { phase: 'packing',   next: 'labeled',   nextLabel: 'Packed ✓',      bucket: 'pack' },
    packed:            { phase: 'labeled',   next: 'shipped',   nextLabel: 'Mark shipped →', bucket: 'ship' },
    handed_to_carrier: { phase: 'shipped',   next: 'delivered', nextLabel: 'Delivered ✓',   bucket: 'transit' },
    shipped:           { phase: 'shipped',   next: 'delivered', nextLabel: 'Delivered ✓',   bucket: 'transit' }
  };
  var TONE = { confirmed: 'info', building: 'amber', ready: 'teal', pack: 'amber', packing: 'amber',
    packed: 'teal', handed_to_carrier: 'teal', shipped: 'teal' };
  var BUCKETS = [['all', 'All'], ['pick', 'To pick'], ['pack', 'To pack'], ['ship', 'To ship'], ['transit', 'In transit']];

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
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[fulfillment-v2] list', e); });
    if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
  }

  function ageDays(o) {
    var t = o.placedAt || o.createdAt; if (!t) return null;
    return Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 86400000));
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
      if (k === 'age') return ageDays(r);
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
      { key: 'items', label: 'Items', align: 'right',
        render: function (r) { return Array.isArray(r.items) ? r.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : (r.itemCount || 0); } },
      { key: 'total', label: 'Total', align: 'right', render: function (r) { return N.money(N.moneyVal(r, 'totalCents', 'total')) || '—'; } },
      { key: 'status', label: 'Status',
        render: function (r) { var s = String(r.status).toLowerCase(); return window.MastUI.badge(s.replace(/_/g, ' '), TONE[s] || 'neutral'); } },
      { key: 'tracking', label: 'Tracking',
        render: function (r) { return trackingLabel(r) || '<span style="color:var(--warm-gray);">—</span>'; } },
      { key: 'age', label: 'Age', align: 'right',
        render: function (r) { var d = ageDays(r); return d === null ? '—' : (d === 0 ? 'today' : d + 'd'); } },
      { key: '_advance', label: '', sortable: false, align: 'right', render: function (r) {
          var st = STAGES[String(r.status).toLowerCase()]; if (!st) return '';
          var busy = V2.busy[r._key];
          return '<button class="btn btn-secondary" ' + (busy ? 'disabled ' : '') +
            'style="font-size:0.78rem;padding:4px 10px;white-space:nowrap;" ' +
            'onclick="event.stopPropagation();FulfillV2.advance(\'' + r._key + '\')">' +
            (busy ? '…' : st.nextLabel) + '</button>';
        } }
    ];
  }

  function ensureTab() {
    var el = document.getElementById('fulfillmentV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'fulfillmentV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function counts() {
    var c = { all: V2.rows.length, pick: 0, pack: 0, ship: 0, transit: 0 };
    V2.rows.forEach(function (r) { c[STAGES[String(r.status).toLowerCase()].bucket]++; });
    return c;
  }

  function render() {
    var tab = ensureTab();
    var c = counts();
    var pills = BUCKETS.map(function (p) {
      var on = V2.bucket === p[0];
      return '<button onclick="FulfillV2.setBucket(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + (c[p[0]] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Fulfillment</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + window.MastUI.Num.count(V2.rows.length) + ' in the pipeline</span>' +
        // Tracked temp-link (debt): native label purchase is the queue's P3.
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="FulfillV2.classicLabels()">Buy labels (classic) ↗</button>' +
        '<button class="btn btn-secondary" onclick="FulfillV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      window.MastEntity.renderList('orders-v2', {
        columns: columns(),
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'FulfillV2.sort', onRowClickFnName: 'FulfillV2.open',
        empty: { title: 'Nothing in the pipeline', message: 'Paid orders land here until they\'re delivered.' }
      });
  }

  // One-click advance: same engine path + guards as the Process pane. Engine
  // FIRST, then the spec (the spec IIFE no-ops without the engine — the old
  // Promise.all race).
  function advance(id) {
    var rec = V2.byId[id]; if (!rec || V2.busy[id]) return;
    var st = STAGES[String(rec.status).toLowerCase()]; if (!st) return;
    V2.busy[id] = true; render();
    var done = function () { delete V2.busy[id]; render(); };
    MastAdmin.loadModule('workflowEngine')
      .then(function () { return MastAdmin.loadModule('pickshipWorkflow'); })
      .then(function () {
        rec.id = rec.id || rec._key;
        var opts = { recordId: rec.id, expectedFromPhase: st.phase };
        if (st.branchChoice) opts.branchChoice = st.branchChoice;
        return window.MastFlow.transition('pickship', rec, st.next, opts);
      })
      .then(function () {
        if (window.showToast) showToast((rec.orderNumber || 'Order') + ' → ' + st.nextLabel.replace(/[→✓]/g, '').trim());
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
          console.error('[fulfillment-v2] advance', e);
          if (window.showToast) showToast('Could not advance: ' + (e && e.message || e), true);
        }
      });
  }

  function open(id) {
    var rec = V2.byId[id]; if (!rec) return;
    MastAdmin.loadModule('orders-v2').then(function () {
      window.MastEntity.openRecord('orders-v2', rec, 'read');
    }).catch(function (e) { console.error('[fulfillment-v2] open', e); });
  }

  window.FulfillV2 = {
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
    exportCsv: function () { return window.MastEntity.exportRows('orders-v2', visibleRows(), 'fulfillment-' + V2.bucket); }
  };

  // Both routes land in the SAME queue; the route only picks the entry bucket.
  function setupFor(bucket) {
    return function () {
      ensureTab();
      V2.bucket = bucket;
      MastAdmin.loadModule('orders-v2').then(function () { render(); load(); })
        .catch(function (e) { console.error('[fulfillment-v2] setup', e); });
    };
  }
  MastAdmin.registerModule('fulfillment-v2', {
    routes: {
      'pack-v2': { tab: 'fulfillmentV2Tab', setup: setupFor('pick') },
      'ship-v2': { tab: 'fulfillmentV2Tab', setup: setupFor('ship') }
    }
  });
})();
