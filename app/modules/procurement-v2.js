/**
 * procurement-v2.js — conversion #5 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy procurement.js lists purchase orders with inline row-expansion
 * (procurementToggleExpand → renderPoExpand). This re-hosts that VIEW on the
 * Entity Engine: a schema-driven list + a read-focused Faceted Record slide-out.
 *
 * Variant (doc 17 §1a test): a PO is a transaction-shaped record (vendor + line
 * items + totals). Its status is NOT a gated workflow — `received` /
 * `partially_received` are DERIVED from received quantities (procurement.js:
 * `allMet ? 'received' : anyReceived ? 'partially_received'`), with manual
 * submit/cancel/close actions. No exit-checklists, no guarded advance → it is a
 * Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused: the Receive / Submit / Cancel / Close actions carry heavy domain
 * logic (receipt + inventory-lot + supplier price-history writes) coupled to the
 * legacy pane — those stay on legacy #procurement. This twin re-hosts the VIEW
 * (PO list + line items + receiving progress + receipt history). Flag-gated
 * (?ui=1) at #procurement-v2, side-by-side; never touches procurement.js.
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

  var U = window.MastUI, N = U.Num, esc = U._esc;
  var STATUS_TONE = { draft: 'neutral', submitted: 'info', partially_received: 'amber', received: 'success', closed: 'neutral', cancelled: 'danger' };
  function statusLabel(s) { return s === 'partially_received' ? 'partial' : (s || 'draft'); }

  // helpers (mirror procurement.js)
  function poTotal(po) {
    if (typeof po.total === 'number' && po.total > 0) return po.total;
    var sum = 0;
    (po.lines || []).forEach(function (l) { sum += (Number(l.qtyOrdered) || 0) * (Number(l.unitCost) || 0); });
    return sum;
  }
  function lineLabel(l) { return l.descriptionSnapshot || l.targetId || '—'; }
  function recvSummary(po) {
    var lines = po.lines || []; if (!lines.length) return '—';
    var done = lines.filter(function (l) { return (Number(l.qtyReceived) || 0) >= (Number(l.qtyOrdered) || 0); }).length;
    return done + ' / ' + lines.length + ' lines';
  }
  function progressBar(received, ordered) {
    var pct = (Number(ordered) || 0) > 0 ? Math.min(100, ((Number(received) || 0) / Number(ordered)) * 100) : 0;
    return '<div style="height:6px;background:rgba(127,127,127,.18);border-radius:3px;margin-top:4px;overflow:hidden;">' +
      '<div style="width:' + pct.toFixed(0) + '%;height:100%;background:var(--teal);"></div></div>';
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('procurement-v2', {
    label: 'Purchase order', labelPlural: 'Procurement', size: 'xl',
    route: 'procurement-v2',
    recordId: function (po) { return po.poId || po.id; },
    fields: [
      { name: 'poNumber', label: 'PO #', type: 'text', list: true, readOnly: true, group: 'PO' },
      { name: 'vendor', label: 'Vendor', type: 'text', list: true, readOnly: true, get: function (po) { return po._vendor || '(unknown vendor)'; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['draft', 'submitted', 'partially_received', 'received', 'closed', 'cancelled'],
        get: function (po) { return statusLabel(po.status); },
        tone: function (v) { return STATUS_TONE[v] || (v === 'partial' ? 'amber' : 'neutral'); } },
      { name: 'ordered', label: 'Ordered', type: 'date', list: true, readOnly: true, get: function (po) { return po.orderDate || null; } },
      { name: 'expected', label: 'Expected', type: 'date', list: true, readOnly: true, get: function (po) { return po.expectedDate || null; } },
      { name: 'total', label: 'Total', type: 'money', list: true, readOnly: true, get: function (po) { return poTotal(po); } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, po) {
        var tiles = UI.tiles([
          { k: 'Total', v: N.money(poTotal(po)) || '$0.00', hero: true },
          { k: 'Ordered', v: po.orderDate ? N.date(po.orderDate) : '—' },
          { k: 'Expected', v: po.expectedDate ? N.date(po.expectedDate) : '—' },
          { k: 'Received', v: esc(recvSummary(po)) }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'lines', label: 'Lines' }, { key: 'receipts', label: 'Receipts' }], 'ov');

        var vendor = UI.kv([
          { k: 'Vendor', v: esc(po._vendor || '(unknown vendor)') },
          { k: 'Status', v: UI.badge(statusLabel(po.status), STATUS_TONE[po.status] || 'neutral') },
          { k: 'Order date', v: po.orderDate ? N.date(po.orderDate) : '—' },
          { k: 'Expected', v: po.expectedDate ? N.date(po.expectedDate) : '—' },
          { k: 'Currency', v: po.currency ? esc(po.currency) : '—' },
          { k: 'Payment terms', v: po.paymentTerms ? esc(po.paymentTerms) : '—' },
          { k: 'Incoterm', v: po.incoterm ? esc(po.incoterm) : '—' },
          { k: 'Notes', v: po.notes ? esc(po.notes) : '—' }
        ]);
        var summary = UI.kv([
          { k: 'Lines', v: N.count((po.lines || []).length) },
          { k: 'Total', v: N.money(poTotal(po)) || '$0.00' },
          { k: 'Received', v: esc(recvSummary(po)) }
        ]);
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="ProcurementV2.classic()">Record receipt / manage in classic view →</button></div>';

        var lines = po.lines || [];
        var linesTable = lines.length ? UI.relatedTable([
          { label: 'Item', render: function (l) { return esc(lineLabel(l)) + (l.kind ? ' <span class="mu-sub">· ' + esc(l.kind) + '</span>' : ''); } },
          { label: 'Vendor SKU', render: function (l) { return l.vendorSku ? '<span class="mu-sub">' + esc(l.vendorSku) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Ordered', align: 'right', render: function (l) { return esc((l.qtyOrdered || 0) + (l.unitOfMeasure ? ' ' + l.unitOfMeasure : '')); } },
          { label: 'Received', render: function (l) { return '<div>' + (l.qtyReceived || 0) + ' / ' + (l.qtyOrdered || 0) + progressBar(l.qtyReceived, l.qtyOrdered) + '</div>'; } },
          { label: 'Unit', align: 'right', render: function (l) { return N.money(l.unitCost) || '—'; } }
        ], lines) : '<span class="mu-sub">No line items.</span>';

        var receipts = (po._receipts || []);
        var receiptsBody = receipts.length ? receipts.map(function (r) {
          var rLines = r.lines || [];
          var rQty = rLines.reduce(function (s, l) { return s + (Number(l.qtyReceivedNow) || 0); }, 0);
          var rValue = rLines.reduce(function (s, l) { return s + (Number(l.qtyReceivedNow) || 0) * (Number(l.unitCostHomeCurrency) || 0); }, 0);
          return '<div style="padding:10px 14px;border:1px solid var(--cream-dark,rgba(127,127,127,.2));border-radius:8px;margin-bottom:6px;font-size:0.85rem;display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;">' +
            '<span>' + (r.receivedAt ? N.date(r.receivedAt) : '—') +
              (r.vendorInvoiceRef ? ' · <span style="font-family:monospace;">' + esc(r.vendorInvoiceRef) + '</span>' : '') +
              ' · ' + rLines.length + (rLines.length === 1 ? ' line' : ' lines') + ' · ' + rQty + ' units' +
              (r.landedCostsApplied ? ' · <span style="color:var(--teal);">landed costs applied</span>' : '') + '</span>' +
            '<span style="font-family:monospace;">' + (N.money(rValue) || '$0.00') + '</span>' +
          '</div>';
        }).join('') : '<span class="mu-sub">No receipts recorded yet.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Vendor & terms', vendor) + UI.card('Summary', summary + manage) + '</div>' +
          '<div class="mu-pane" data-pane="lines" hidden>' + UI.cardTable('Lines (' + lines.length + ')', linesTable) + '</div>' +
          '<div class="mu-pane" data-pane="receipts" hidden>' + UI.cardTable('Receipts (' + receipts.length + ')', receiptsBody) + '</div>';
      }
    }
    // No onSave → no Edit button (Receive/Submit/Cancel/Close stay on legacy #procurement).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'ordered', sortDir: 'desc', q: '', statusFilter: 'open', loaded: false };
  var OPEN = { draft: true, submitted: true, partially_received: true };

  function load() {
    Promise.all([
      Promise.resolve(MastDB.get('admin/purchaseOrders')),
      Promise.resolve(MastDB.get('admin/vendors')),
      Promise.resolve(MastDB.get('admin/purchaseReceipts'))
    ]).then(function (res) {
      var posVal = res[0] || {}, vendors = res[1] || {}, receipts = res[2] || {};
      var receiptsByPo = {};
      Object.keys(receipts).forEach(function (k) { var r = receipts[k]; if (r && r.poId) (receiptsByPo[r.poId] = receiptsByPo[r.poId] || []).push(r); });
      Object.keys(receiptsByPo).forEach(function (poId) { receiptsByPo[poId].sort(function (a, b) { return String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')); }); });
      var out = [];
      Object.keys(posVal).forEach(function (k) {
        var po = posVal[k]; if (!po || typeof po !== 'object') return;
        po = Object.assign({ poId: k }, po);
        po.poNumber = po.poNumber || String(k).slice(0, 8);
        po.status = po.status || 'draft';
        po._vendor = (vendors[po.vendorId] && vendors[po.vendorId].name) || '(unknown vendor)';
        po._receipts = receiptsByPo[k] || [];
        out.push(po);
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.poId] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[procurement-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter === 'open') rows = rows.filter(function (po) { return OPEN[po.status]; });
    else if (V2.statusFilter !== 'all') rows = rows.filter(function (po) { return po.status === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (po) {
        return String(po.poNumber || '').toLowerCase().indexOf(q) >= 0 ||
               String(po._vendor || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('procurement-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('procurementV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'procurementV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var openCount = V2.rows.filter(function (po) { return OPEN[po.status]; }).length;
    var filters = [['open', 'Open'], ['all', 'All'], ['received', 'Received'], ['closed', 'Closed'], ['cancelled', 'Cancelled']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ProcurementV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Purchase Orders</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(openCount) + ' open · ' + N.count(V2.rows.length) + ' total</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="ProcurementV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search PO # or vendor…" value="' + esc(V2.q) +
        '" oninput="ProcurementV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('procurement-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ProcurementV2.sort', onRowClickFnName: 'ProcurementV2.open',
        empty: { title: 'No purchase orders', message: V2.loaded ? 'No POs match this filter.' : 'Loading…' }
      });
  }

  window.ProcurementV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'ordered' || key === 'expected' || key === 'total' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('procurement-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('procurement-v2', rec, 'read');
      });
    },
    classic: function () { if (typeof navigateTo === 'function') navigateTo('procurement'); },
    exportCsv: function () { return MastEntity.exportRows('procurement-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('procurement-v2', {
    routes: { 'procurement-v2': { tab: 'procurementV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
