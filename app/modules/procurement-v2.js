/**
 * procurement-v2.js — conversion #5 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy procurement.js lists purchase orders with inline row-expansion
 * (procurementToggleExpand → renderPoExpand). This re-hosts that VIEW on the
 * Entity Engine: a schema-driven list + a read-focused Faceted Record slide-out.
 *
 * Process record (Tier 1 Work Item C/E — supersedes the original Faceted-Record
 * call): the PO is now a MastFlow process record on the `procurement` workflow
 * (Draft → Ordered → Received, + Cancelled). The slide-out hosts the MastFlow
 * stepper (detail.flow), and the two forward advances are intercepted via
 * detail.onFlowAdvance to open side-effecting captures rather than a plain status
 * write:
 *   - Draft → Ordered  = "send to vendor": generate the PO document, queue the
 *     vendor email, stamp sentAt (ProcurementBridge.send).
 *   - Ordered → Received = the per-line receive-capture slide-out
 *     (ProcurementBridge.receive — receipt + inventory-lot + PO-status + supplier
 *     price-history writes, the ONE shared write path; stock-on-hand is applied
 *     server-side by the onPurchaseReceiptCreated Cloud Function).
 *
 * Phase changes stay DATA-DRIVEN: sending sets status=submitted, receiving rolls
 * status to received/partially_received, cancel sets cancelled — and reconcile-
 * on-open promotes __workflow.phase to match status. This keeps ONE transition
 * path (reconcile) so a partial that completes, an MCP-recorded receipt, or a
 * cancel can't leave phase and status diverged. Writes go ONLY through the
 * Bridge / MastFlow (no direct MastDB write here).
 *
 * Still legacy-only (ProcurementV2.classic escape hatch): New PO, Apply Landed
 * Costs, Vendors, and Lots management. Flag-gated (?ui=1) at #procurement-v2,
 * side-by-side. Writes go ONLY through the Bridge — no direct MastDB write here.
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
  function canEdit() { return typeof window.can === 'function' ? window.can('procurement', 'edit') : true; }
  function outstanding(l) { return (Number(l.qtyOrdered) || 0) - (Number(l.qtyReceived) || 0); }
  // Mirror legacy renderPoExpand gating (procurement.js): Receive when there is
  // an open status with outstanding qty; Cancel when status is draft/submitted/
  // partially_received. (No Submit/Close: legacy procurement.js has NO write that
  // sets 'submitted'/'closed' — those are inbound-only data states.)
  function canReceivePo(po) {
    if (!canEdit()) return false;
    var open = po.status === 'submitted' || po.status === 'partially_received' || po.status === 'draft';
    return open && (po.lines || []).some(function (l) { return outstanding(l) > 0; });
  }
  function canCancelPo(po) {
    if (!canEdit()) return false;
    return po.status === 'draft' || po.status === 'submitted' || po.status === 'partially_received';
  }

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
      flow: 'procurement',
      flowModule: 'procurementWorkflow',
      // Intercept the two forward advances to open side-effecting captures
      // instead of a plain status write. Returning non-false = handled (the
      // engine skips its default transition). Phase then follows the data via
      // reconcile-on-open (reloadThenOpen → openPo → reconcilePhase).
      onFlowAdvance: function (target, po) {
        if (target === 'ordered') { openSendDialog(po); return true; }
        if (target === 'received') {
          if (canReceivePo(po)) openReceiveForm(po);
          else if (window.showToast) showToast('Nothing left to receive on this PO.', true);
          return true;
        }
        return false;
      },
      // Route checklist "Go →" targets to the right detail pane.
      onFlowTarget: function (targetId) {
        var pane = (targetId === 'detail-lines') ? 'lines' : 'ov';
        var body = document.getElementById('mastSlideOutBody'); if (!body) return true;
        var btn = body.querySelector('.mu-ptabs button[onclick*="\'' + pane + '\'"]');
        if (btn) btn.click();
        return true;
      },
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
        // Forward actions (Send / Record receipt) live on the MastFlow stepper
        // above (Advance), intercepted by detail.onFlowAdvance. Cancel is an
        // out-of-band terminal action (not a forward phase), kept here; Print is
        // a convenience reprint of the PO document. Both delegate to the Bridge.
        var actionBtns = '<button class="btn btn-secondary btn-small" onclick="ProcurementV2.printPo(\'' + esc(po.poId) + '\')">Print PO</button> ';
        if (canCancelPo(po)) actionBtns += '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="ProcurementV2.cancel(\'' + esc(po.poId) + '\')">Cancel PO</button>';
        var manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' + actionBtns + '</div>';

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

        // MastFlow stepper host — _initEntityFlow (engine) fills #muFlowHost after
        // render because the schema sets detail.flow. Custom render must emit it
        // (the transaction/party templates emit it for you; we don't use one).
        var flowHost = '<div id="muFlowHost" style="margin:10px 0 4px;font-size:0.85rem;color:var(--warm-gray);">Loading workflow…</div>';

        return tiles + flowHost + tabsBar +
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
    return Promise.all([
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
        po._vendorEmail = (vendors[po.vendorId] && vendors[po.vendorId].email) || '';
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

  // ── Phase reconcile (the single transition path) ────────────────────
  // __workflow.phase is canonical once set, so the engine's derivePhaseFromLegacy
  // stops running and status can move underneath it (receipt rollup, MCP receipt/
  // cancel, a partial that completes). On every open we promote phase to match
  // status when status is forward-or-terminal of the recorded phase. force:true
  // because received/cancelled have no exit reqs and 'ordered' gates only on a
  // soft 'sent'. Never demotes.
  var PHASE_ORDER = { draft: 0, ordered: 1, received: 2, cancelled: 2 };
  var STATUS_TO_PHASE = { draft: 'draft', submitted: 'ordered', partially_received: 'ordered', received: 'received', closed: 'received', cancelled: 'cancelled' };
  function reconcilePhase(po) {
    if (!po || !window.MastFlow || typeof MastFlow.transition !== 'function') return Promise.resolve(false);
    var cur = po.__workflow && po.__workflow.phase;
    if (!cur) return Promise.resolve(false);                 // no canonical phase → derivePhaseFromLegacy covers it
    var want = STATUS_TO_PHASE[po.status] || 'draft';
    if (want === cur) return Promise.resolve(false);
    var forward = (PHASE_ORDER[want] > PHASE_ORDER[cur]) || want === 'received' || want === 'cancelled';
    if (!forward) return Promise.resolve(false);
    po.id = po.poId;
    return MastFlow.transition('procurement', po, want, {
      recordId: po.poId, expectedFromPhase: cur, force: true, reason: 'reconcile phase → status=' + po.status
    }).then(function () { return true; }).catch(function (e) { console.warn('[procurement-v2] reconcile', e && e.message); return false; });
  }
  // Open a PO slide-out: reconcile phase first, then let the Entity Engine render
  // (it auto-inits the MastFlow stepper because the schema sets detail.flow).
  function openPo(rec) {
    if (!rec) return;
    rec.id = rec.poId;
    reconcilePhase(rec).then(function () { MastEntity.openRecord('procurement-v2', rec, 'read'); });
  }

  // ── PO document (Work Item B): one HTML builder, used for both print + email ──
  function buildPoHtml(po) {
    var lines = po.lines || [];
    var rows = lines.map(function (l) {
      var qty = Number(l.qtyOrdered) || 0, cost = Number(l.unitCost) || 0;
      return '<tr>' +
        '<td style="padding:6px 8px;border-bottom:1px solid rgb(238,238,238);">' + esc(lineLabel(l)) + (l.vendorSku ? '<br><span style="color:rgb(136,136,136);font-size:11px;">SKU ' + esc(l.vendorSku) + '</span>' : '') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid rgb(238,238,238);text-align:right;">' + qty + (l.unitOfMeasure ? ' ' + esc(l.unitOfMeasure) : '') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid rgb(238,238,238);text-align:right;">' + (N.money(cost) || '$0.00') + '</td>' +
        '<td style="padding:6px 8px;border-bottom:1px solid rgb(238,238,238);text-align:right;">' + (N.money(qty * cost) || '$0.00') + '</td>' +
      '</tr>';
    }).join('');
    return '<div style="font-family:Arial,Helvetica,sans-serif;color:rgb(34,34,34);padding:24px;max-width:680px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
        '<h1 style="font-size:20px;margin:0;">Purchase Order</h1>' +
        '<div style="text-align:right;font-size:13px;"><strong>' + esc(po.poNumber || String(po.poId).slice(0, 8)) + '</strong>' +
          (po.orderDate ? '<br>Ordered: ' + esc(N.date(po.orderDate)) : '') +
          (po.expectedDate ? '<br>Expected: ' + esc(N.date(po.expectedDate)) : '') + '</div>' +
      '</div>' +
      '<div style="margin:14px 0;font-size:13px;"><strong>Vendor:</strong> ' + esc(po._vendor || '(unknown vendor)') +
        (po._vendorEmail ? ' · ' + esc(po._vendorEmail) : '') + '</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px;">' +
        '<thead><tr style="background:rgb(245,245,245);"><th style="padding:6px 8px;text-align:left;">Item</th><th style="padding:6px 8px;text-align:right;">Qty</th><th style="padding:6px 8px;text-align:right;">Unit</th><th style="padding:6px 8px;text-align:right;">Total</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="4" style="padding:8px;color:rgb(136,136,136);">No line items.</td></tr>') + '</tbody>' +
      '</table>' +
      '<div style="text-align:right;margin-top:12px;font-size:14px;"><strong>Total: ' + (N.money(poTotal(po)) || '$0.00') + '</strong></div>' +
      (po.paymentTerms ? '<div style="margin-top:10px;font-size:12px;color:rgb(85,85,85);">Terms: ' + esc(po.paymentTerms) + (po.incoterm ? ' · ' + esc(po.incoterm) : '') + '</div>' : '') +
      (po.vendorMessage ? '<div style="margin-top:10px;font-size:12px;color:rgb(85,85,85);">' + esc(po.vendorMessage) + '</div>' : '') +
      (po.notes ? '<div style="margin-top:6px;font-size:12px;color:rgb(136,136,136);">Notes: ' + esc(po.notes) + '</div>' : '') +
    '</div>';
  }
  function doPrintPo(po) {
    var w = window.open('', '_blank');
    if (!w) { if (window.showToast) showToast('Allow pop-ups to print the PO.', true); return; }
    w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>PO ' + esc(po.poNumber || String(po.poId).slice(0, 8)) + '</title></head><body>' +
      buildPoHtml(po) + '<scr' + 'ipt>setTimeout(function(){window.print();},250);</scr' + 'ipt></body></html>');
    w.document.close();
  }

  // ── Send to vendor = Draft→Ordered (Work Item B) ────────────────────
  // Opens a preview slide-out; on confirm, ProcurementBridge.send queues the
  // vendor email + stamps sentAt + status=submitted, then reconcile-on-open
  // promotes the phase to Ordered.
  function openSendDialog(po) {
    var html = buildPoHtml(po);
    var emailNote = po._vendorEmail
      ? 'Will email the PO to <strong>' + esc(po._vendorEmail) + '</strong> and mark it Ordered.'
      : 'No vendor email on file — this marks the PO Ordered without emailing. Use Print to share it.';
    var body = U.card('Send purchase order',
      '<div class="mu-sub" style="margin-bottom:10px;">' + emailNote + '</div>' +
      '<div style="border:1px solid var(--cream-dark,rgba(127,127,127,.2));border-radius:8px;max-height:46vh;overflow:auto;background:rgb(255,255,255);">' + html + '</div>');
    U.slideOut.open({
      id: 'send-' + po.poId, title: 'Send PO', subtitle: esc(po._vendor || ''), size: 'lg',
      mode: 'create', deepLink: false, createLabel: (po._vendorEmail ? 'Send & mark ordered' : 'Mark ordered'),
      render: function () { return body; },
      isDirty: function () { return true; },
      onSave: function () { return submitSend(po.poId, html); }
    });
  }
  function submitSend(poId, html) {
    if (!window.ProcurementBridge || typeof ProcurementBridge.send !== 'function') {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
      if (window.showToast) showToast('Procurement engine still loading — try again', true);
      return false;
    }
    var po = V2.byId[poId] || {};
    window.ProcurementBridge.send(poId, { subject: 'Purchase Order ' + (po.poNumber || poId), html: html }).then(function (res) {
      if (window.showToast) showToast(res && res.emailed ? 'PO sent to vendor' : 'PO marked ordered');
      U.slideOut.requestCloseForce();
      return reloadThenOpen(poId);
    }).catch(function (e) {
      if (window.showToast) showToast('Failed to send PO: ' + (e && e.message || e), true);
    });
    return false;
  }

  window.ProcurementV2 = {
    printPo: function (id) { var po = V2.byId[id]; if (po) doPrintPo(po); },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'ordered' || key === 'expected' || key === 'total' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('procurement-v2').fetch(id).then(function (rec) {
        if (rec) openPo(rec);
      });
    },
    // navigateToClassic — retained ONLY as an escape hatch. Everything in this
    // module's PO flow (view + receive + cancel) is native; there is no classic
    // procurement surface a user must fall back to for the PO lifecycle.
    classic: function () { if (typeof navigateTo === 'function') navigateTo('procurement'); },
    exportCsv: function () { return MastEntity.exportRows('procurement-v2', visibleRows(), 'all'); },

    // ── Receive capture (delegates to ProcurementBridge.receive) ──────────
    receive: function (id) {
      var po = V2.byId[id];
      if (!po || !canReceivePo(po)) return;
      openReceiveForm(po);
    },
    submitReceive: function (poId) {
      var body = document.getElementById('mastSlideOutBody');
      if (!body) return false;
      var dateEl = body.querySelector('[data-rv="receivedAt"]');
      var invEl = body.querySelector('[data-rv="invoiceRef"]');
      var addlLabelEl = body.querySelector('[data-rv="addlLabel"]');
      var addlAmountEl = body.querySelector('[data-rv="addlAmount"]');
      var lines = [];
      body.querySelectorAll('[data-poline]').forEach(function (row) {
        var poLineId = row.getAttribute('data-poline');
        var qtyEl = row.querySelector('[data-rl="qty"]');
        var costEl = row.querySelector('[data-rl="cost"]');
        var lotEl = row.querySelector('[data-rl="lot"]');
        lines.push({
          poLineId: poLineId,
          qtyReceivedNow: parseFloat(qtyEl && qtyEl.value) || 0,
          unitCostOverride: costEl && costEl.value,
          lotNumber: lotEl && lotEl.value
        });
      });
      var meta = {
        receivedAt: (dateEl && dateEl.value) || undefined,
        invoiceRef: invEl && invEl.value,
        addlLabel: addlLabelEl && addlLabelEl.value,
        addlAmount: addlAmountEl && addlAmountEl.value
      };
      // Guard: the Bridge lives in the legacy procurement module; if it hasn't
      // loaded yet, kick the load and ask the user to retry (no silent throw).
      if (!window.ProcurementBridge) {
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
        if (window.showToast) showToast('Procurement engine still loading — try again', true);
        return false;
      }
      // Drive the whole exit ourselves (write → force-close the receive form →
      // reload + re-open the PO on fresh data), then return false so the engine's
      // create-mode _save handler does NOTHING further (no duplicate toast/close).
      window.ProcurementBridge.receive(poId, lines, meta).then(function (receiptId) {
        if (window.showToast) showToast('Receipt recorded');
        U.slideOut.requestCloseForce();
        return reloadThenOpen(poId);
      }).catch(function (e) {
        if (window.showToast) showToast('Failed to record receipt: ' + (e && e.message || e), true);
      });
      return false;
    },

    // ── Cancel (delegates to ProcurementBridge.cancel → legacy cancelPo) ───
    cancel: function (id) {
      var po = V2.byId[id];
      if (!po || !canCancelPo(po)) return;
      if (!window.ProcurementBridge) {
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
        if (window.showToast) showToast('Procurement engine still loading — try again', true);
        return;
      }
      // cancelPo owns its own mastConfirm; reload + re-open the PO after.
      window.ProcurementBridge.cancel(id).then(function () { reloadThenOpen(id); });
    }
  };

  // Reload v2 data from Firebase, then re-open the PO slide-out on fresh data so
  // the Receipts/Lines facets + status reflect the write. (The Bridge mutated the
  // LEGACY caches; this twin keeps its own — so reload rather than read across.)
  function reloadThenOpen(poId) {
    return load().then(function () {
      var rec = V2.byId[poId];
      if (rec) openPo(rec);
    });
  }

  // Receive form — a per-line capture surface on the shared slide-out. Each open
  // PO line → received-qty / unit-cost-override / lot inputs (mirrors the legacy
  // Record Receipt modal). Composed with MastUI.card; no hand-rolled chrome.
  function openReceiveForm(po) {
    var open = (po.lines || []).filter(function (l) { return outstanding(l) > 0; });
    var rows = open.map(function (l) {
      var label = l.descriptionSnapshot || l.targetId || '—';
      var out = outstanding(l);
      return '<div data-poline="' + esc(l.lineId) + '" style="display:grid;grid-template-columns:2fr 0.8fr 1fr 1fr 1.2fr;gap:8px;padding:8px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.2));align-items:center;font-size:0.85rem;">' +
        '<span>' + esc(label) + (l.kind ? ' <span class="mu-sub">· ' + esc(l.kind) + '</span>' : '') + '</span>' +
        '<span style="font-family:monospace;">' + out + (l.unitOfMeasure ? ' ' + esc(l.unitOfMeasure) : '') + '</span>' +
        '<input class="form-input" data-rl="qty" type="number" min="0" max="' + out + '" step="0.01" value="' + out + '" style="font-size:0.85rem;">' +
        '<input class="form-input" data-rl="cost" type="number" min="0" step="0.01" placeholder="' + (Number(l.unitCost) || 0).toFixed(2) + '" style="font-size:0.85rem;">' +
        '<input class="form-input" data-rl="lot" type="text" placeholder="LOT-…" style="font-size:0.85rem;">' +
      '</div>';
    }).join('');
    var head = '<div style="display:grid;grid-template-columns:2fr 0.8fr 1fr 1fr 1.2fr;gap:8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--warm-gray);padding-bottom:4px;">' +
      '<span>Target</span><span>Outstanding</span><span>Receive now</span><span>Unit cost (override)</span><span>Lot #</span></div>';
    var today = new Date().toISOString().slice(0, 10);
    var metaRow = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">' +
        '<label style="font-size:0.78rem;color:var(--warm-gray);">Received date<input class="form-input" data-rv="receivedAt" type="date" value="' + today + '" style="font-size:0.9rem;margin-top:2px;"></label>' +
        '<label style="font-size:0.78rem;color:var(--warm-gray);">Vendor invoice #<input class="form-input" data-rv="invoiceRef" type="text" style="font-size:0.9rem;margin-top:2px;"></label>' +
      '</div>';
    var addlRow = '<div style="display:grid;grid-template-columns:1fr 0.8fr;gap:10px;margin-top:12px;">' +
        '<label style="font-size:0.78rem;color:var(--warm-gray);">Additional cost label (e.g. freight)<input class="form-input" data-rv="addlLabel" type="text" style="font-size:0.9rem;margin-top:2px;"></label>' +
        '<label style="font-size:0.78rem;color:var(--warm-gray);">Amount<input class="form-input" data-rv="addlAmount" type="number" min="0" step="0.01" style="font-size:0.9rem;margin-top:2px;"></label>' +
      '</div>' +
      '<div class="mu-sub" style="margin-top:4px;">Captured here; allocate via the classic "Apply landed" once received.</div>';
    var bodyHtml = U.card('Record receipt — ' + esc(po.poNumber || String(po.poId).slice(0, 8)),
      metaRow + head + rows + addlRow);
    U.slideOut.open({
      id: 'receive-' + po.poId,
      title: 'Record receipt',
      subtitle: esc(po._vendor || ''),
      size: 'lg',
      mode: 'create',
      deepLink: false,
      createLabel: 'Record',
      render: function () { return bodyHtml; },
      isDirty: function () { return true; },
      onSave: function () { return window.ProcurementV2.submitReceive(po.poId); }
    });
  }

  MastAdmin.registerModule('procurement-v2', {
    routes: { 'procurement-v2': { tab: 'procurementV2Tab', setup: function () {
      // Ensure the legacy procurement module is loaded so window.ProcurementBridge
      // (the shared receive/cancel write cores) exists before the user acts.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
      ensureTab(); render(); load();
    } } }
  });
})();
