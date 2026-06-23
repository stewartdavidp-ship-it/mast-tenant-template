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
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  // Un-gated (Tier 1.5 P7, 2026-06-06): the procurement domain is the V2 default
  // for all users — no ?ui=1 required. The shared engine (MastEntity/MastUI) is
  // loaded unconditionally at boot, so self-registering here is always safe.

  var U = window.MastUI, N = U.Num, esc = U._esc;
  // Normalize a products list() result (array OR keyed object) to { pid: product }.
  function pidMap(r) { var o = {}; (Array.isArray(r) ? r : Object.values(r || {})).forEach(function (p) { if (p) { var id = p.pid || p._key || p.id; if (id) o[id] = p; } }); return o; }
  // A product is procurable on a PO when it's bought (resell) or value-add (var)
  // — NOT built in-house from materials (those replenish via build, not a PO).
  function procurable(p) { return p && p.status !== 'archived' && p.acquisitionType !== 'build'; }
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
    // Cold-safe: a drill in from another surface (e.g. a vendor's Purchase
    // Orders facet, or a lot's PO provenance) can land here before the
    // Procurement route has ever run its setup load() — so lazy-load on miss
    // (mirrors sessions-v2, drilled from the calendar before its own route).
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return load().then(function () { return V2.byId[id] || null; });
    },
    detail: {
      flow: 'procurement',
      flowModule: 'procurementWorkflow',
      guidedHeader: true,   // clickable step rail (no Advance/Back buttons); click a done step = review

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
          var addl = (r.additionalCosts || []).reduce(function (s, c) { return s + (Number(c.amount) || 0); }, 0);
          // Apply-landed (Tier 1.5 P3): offered when the receipt carries unallocated
          // additional costs (freight/duties). Delegates to ProcurementBridge.
          var landed = r.landedCostsApplied
            ? ' · <span style="color:var(--teal);">landed costs applied</span>'
            : (addl > 0 && canEdit()
              ? ' · <button class="btn btn-secondary btn-small" style="padding:2px 8px;" onclick="ProcurementV2.applyLanded(\'' + esc(r.receiptId) + '\',\'' + esc(po.poId) + '\')">Apply landed (' + (N.money(addl) || '$0.00') + ')</button>'
              : '');
          // Provenance: each received line drills to the LOT it created (lot →
          // the lot number it created, as a reference label. A PO and an inventory
          // lot are different domains (buying vs physical stock) — provenance flows
          // lot→PO (shown on the lot's own detail), so this is NOT a nav into the lot.
          var lineRows = rLines.map(function (rl) {
            var poLine = (po.lines || []).filter(function (l) { return l.lineId === rl.poLineId; })[0];
            var label = poLine ? (poLine.descriptionSnapshot || poLine.targetId || '—') : (rl.poLineId || '—');
            var lot = rl.lotId
              ? '<span class="mu-sub">Lot ' + esc(String(rl.lotId).slice(0, 8)) + '</span>'
              : '<span class="mu-sub">no lot</span>';
            return '<div style="display:flex;justify-content:space-between;gap:12px;padding:3px 0;">' +
              '<span>' + esc(label) + ' <span class="mu-sub">· ' + (Number(rl.qtyReceivedNow) || 0) + '</span></span>' + lot + '</div>';
          }).join('');
          return '<div style="padding:10px 14px;border:1px solid var(--cream-dark,rgba(127,127,127,.2));border-radius:8px;margin-bottom:6px;font-size:0.85rem;">' +
            '<div style="display:flex;justify-content:space-between;gap:14px;flex-wrap:wrap;align-items:center;">' +
              '<span>' + (r.receivedAt ? N.date(r.receivedAt) : '—') +
                (r.vendorInvoiceRef ? ' · <span style="font-family:monospace;">' + esc(r.vendorInvoiceRef) + '</span>' : '') +
                ' · ' + rLines.length + (rLines.length === 1 ? ' line' : ' lines') + ' · ' + rQty + ' units' +
                landed + '</span>' +
              '<span style="font-family:monospace;">' + (N.money(rValue) || '$0.00') + '</span>' +
            '</div>' +
            (lineRows ? '<div style="margin-top:8px;border-top:1px solid var(--cream-dark,rgba(127,127,127,.15));padding-top:6px;">' + lineRows + '</div>' : '') +
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

  // ── Reorder ("Needs reorder") — folded in from the retired reorder-v2 route ──
  // The Needs-reorder lens is a PRODUCER: it lists items at/below their reorder
  // point and drafts POs that open in the PO process slide-out (the loop closes
  // into the spine), instead of a separate dead-end queue. Writes go through
  // ProcurementBridge.createDraftPOs — no MastDB write verbs here (RBAC ratchet).
  function vendorName(vid) { return (V2.vendors[vid] && V2.vendors[vid].name) || '(unknown vendor)'; }
  function activeSuppliersFor(kind, id) {
    return Object.keys(V2.suppliers).map(function (k) { return V2.suppliers[k]; })
      .filter(function (ps) { return ps && ps.active !== false && ps.targetKind === kind && ps.targetId === id; });
  }
  function preferredVendor(kind, id) {
    var list = activeSuppliersFor(kind, id);
    var ps = list.filter(function (p) { return p.preferred; })[0] || (list.length === 1 ? list[0] : null);
    return ps ? { vendorId: ps.vendorId, ps: ps } : null;
  }
  function computeSuggestions() {
    var out = [];
    Object.keys(V2.materials).forEach(function (id) {
      var m = V2.materials[id]; if (!m || m.status === 'archived') return;
      var thr = Number(m.reorderThreshold); if (!(thr > 0)) return;
      var onHand = Number(m.onHandQty) || 0;
      if (onHand > thr) return;
      var sug = Number(m.reorderQty) > 0 ? Number(m.reorderQty) : Math.max(1, thr - onHand);
      var pv = preferredVendor('material', id);
      out.push({ kind: 'material', id: id, name: m.name || id, onHand: onHand, threshold: thr,
        uom: m.unitOfMeasure || '', suggestedQty: sug, vendorId: pv && pv.vendorId || null,
        unitCost: (pv && pv.ps && Number(pv.ps.unitCost)) || Number(m.unitCost) || 0,
        vendorSku: (pv && pv.ps && pv.ps.vendorSku) || null });
    });
    Object.keys(V2.products).forEach(function (id) {
      var p = V2.products[id]; if (!procurable(p)) return;             // archived/built-in-house excluded
      if (Array.isArray(p.variants) && p.variants.length > 0) return;  // per-variant reorder deferred
      var si = p.stockInfo || {}; var st = si.stockType || '';
      if (!st || /order|build/.test(st) || si.totalAvailable == null) return;  // only tracked stock
      var thr = si.lowStockThreshold != null ? Number(si.lowStockThreshold) : 2;
      var avail = Number(si.totalAvailable) || 0;
      if (avail > thr) return;
      var pv = preferredVendor('product', id);
      out.push({ kind: 'product', id: id, name: p.name || id, onHand: avail, threshold: thr,
        uom: '', suggestedQty: Math.max(1, thr - avail), vendorId: pv && pv.vendorId || null,
        unitCost: (pv && pv.ps && Number(pv.ps.unitCost)) || 0,
        vendorSku: (pv && pv.ps && pv.ps.vendorSku) || null });
    });
    out.sort(function (a, b) {
      return String(a.vendorId || 'zzz').localeCompare(String(b.vendorId || 'zzz')) || String(a.name).localeCompare(String(b.name));
    });
    return out;
  }
  function reorderLine(s) {
    return { kind: s.kind, targetId: s.id, variantKey: s.kind === 'product' ? '_default' : null,
      qtyOrdered: s.suggestedQty, unitCost: s.unitCost, vendorSku: s.vendorSku,
      unitOfMeasure: s.uom || null, descriptionSnapshot: s.name };
  }
  function qtyWithUom(n, uom) { return N.count(n) + (uom ? ' ' + uom : ''); }

  // Read-only list entity for the Needs-reorder lens — the STANDARD MastEntity
  // list (not a hand-rolled table); a row-click drafts a PO for that item.
  MastEntity.define('reorder-need', {
    label: 'Reorder need', labelPlural: 'Needs reorder', route: 'procurement-v2',
    recordId: function (s) { return s.kind + ':' + s.id; },
    fields: [
      { name: 'name', label: 'Item', type: 'text', list: true, readOnly: true, get: function (s) { return s.name; } },
      { name: 'kind', label: 'Kind', type: 'text', list: true, readOnly: true },
      { name: 'onHand', label: 'On hand', type: 'text', list: true, readOnly: true, align: 'right', get: function (s) { return qtyWithUom(s.onHand, s.uom); } },
      { name: 'threshold', label: 'Reorder at', type: 'number', list: true, readOnly: true },
      { name: 'suggestedQty', label: 'Suggested', type: 'text', list: true, readOnly: true, align: 'right', get: function (s) { return qtyWithUom(s.suggestedQty, s.uom); } },
      { name: 'vendor', label: 'Preferred vendor', type: 'text', list: true, readOnly: true, get: function (s) { return s.vendorId ? vendorName(s.vendorId) : '— set a preferred supplier'; } }
    ]
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'ordered', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false,
    vendors: {}, materials: {}, products: {}, suppliers: {}, suggestions: [] };
  // Flow-ordered lenses (pills). 'needs-reorder' lists low items (a producer into
  // the PO spine); the rest filter POs by phase. 'all' = every PO.
  var LENS_PRED = {
    draft: function (po) { return po.status === 'draft'; },
    'on-order': function (po) { return po.status === 'submitted' || po.status === 'partially_received'; },
    received: function (po) { return po.status === 'received' || po.status === 'closed'; },
    cancelled: function (po) { return po.status === 'cancelled'; }
  };

  function load() {
    return Promise.all([
      Promise.resolve(MastDB.get('admin/purchaseOrders')),
      Promise.resolve(MastDB.get('admin/vendors')),
      Promise.resolve(MastDB.get('admin/purchaseReceipts')),
      Promise.resolve(MastDB.get('admin/materials')),
      Promise.resolve(MastDB.products && MastDB.products.list ? MastDB.products.list() : MastDB.get('public/products')),
      Promise.resolve(MastDB.get('admin/productSuppliers'))
    ]).then(function (res) {
      var posVal = res[0] || {}, vendors = res[1] || {}, receipts = res[2] || {};
      // Products live at public/products (admin/products is empty); list() can
      // return an array OR a keyed object — normalize to { pid: product }.
      V2.vendors = vendors; V2.materials = res[3] || {}; V2.products = pidMap(res[4]); V2.suppliers = res[5] || {};
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
      V2.suggestions = computeSuggestions();
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[procurement-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    var pred = LENS_PRED[V2.statusFilter];
    if (pred) rows = rows.filter(pred);   // 'all' → no filter; 'needs-reorder' handled separately
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

  function lensCounts() {
    var c = { draft: 0, onorder: 0, received: 0, cancelled: 0 };
    V2.rows.forEach(function (po) {
      if (po.status === 'draft') c.draft++;
      else if (po.status === 'submitted' || po.status === 'partially_received') c.onorder++;
      else if (po.status === 'received' || po.status === 'closed') c.received++;
      else if (po.status === 'cancelled') c.cancelled++;
    });
    return c;
  }
  // Rounded search, right-aligned on the pills row (margin-left:auto) — matches
  // products-v2. Only on PO lenses; the reorder lens has no PO to search.
  function searchBox() {
    if (V2.statusFilter === 'needs-reorder') return '';
    var hasQ = !!(V2.q || '').trim();
    return '<div style="margin-left:auto;position:relative;width:230px;max-width:100%;">' +
      '<input type="text" value="' + esc(V2.q || '') + '" oninput="ProcurementV2.search(this.value)" placeholder="Search PO # or vendor…" ' +
        'style="width:100%;padding:7px 30px 7px 11px;border:1px solid var(--border);border-radius:999px;font-size:0.9rem;background:var(--cream,transparent);color:inherit;box-sizing:border-box;">' +
      '<button onclick="ProcurementV2.search(\'\')" aria-label="Clear search" title="Clear" style="position:absolute;right:6px;top:50%;transform:translateY(-50%);display:' + (hasQ ? 'flex' : 'none') + ';align-items:center;justify-content:center;width:20px;height:20px;border:0;border-radius:50%;background:color-mix(in srgb,var(--text-primary) 12%,transparent);color:var(--warm-gray);font-size:0.9rem;line-height:1;cursor:pointer;">×</button>' +
    '</div>';
  }
  function render() {
    var tab = ensureTab();
    var c = lensCounts();
    // The procurement HOME: one flow-shaped surface. Pills read in journey order
    // — Needs reorder (the entry) → Draft → On order → Received — so "where do I
    // start when low?" is answered the moment you land. Lots/Vendors are
    // reference surfaces (their own records), reached as secondary links.
    var lenses = [
      ['needs-reorder', 'Needs reorder', V2.suggestions.length],
      ['draft', 'Draft', c.draft],
      ['on-order', 'On order', c.onorder],
      ['received', 'Received', c.received],
      ['cancelled', 'Cancelled', c.cancelled],
      ['all', 'All', V2.rows.length]
    ];
    // Canonical list-facet pill (rounded 999px, amber-tint when active) — the SAME
    // control products-v2 uses, NOT btn-small. Journey order: the entry lens first.
    var pills = lenses.map(function (f) {
      var on = V2.statusFilter === f[0];
      return '<button onclick="ProcurementV2.filter(\'' + f[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        f[1] + ' <span style="color:var(--warm-gray);">' + N.count(f[2]) + '</span></button>';
    }).join('');
    // Standard page header strip (title · count · actions) — same as every list.
    var header = U.pageHeader({
      title: 'Procurement',
      count: N.count(c.draft + c.onorder) + ' open · ' + N.count(V2.suggestions.length) + ' to reorder',
      actionsHtml:
        '<button class="btn btn-primary" onclick="ProcurementV2.createNew()">+ New PO</button> ' +
        '<button class="btn btn-secondary" onclick="navigateTo(\'lots-v2\')">▦ Inventory lots</button> ' +
        '<button class="btn btn-secondary" onclick="navigateTo(\'vendors-v2\')">⚐ Vendors</button> ' +
        '<button class="btn btn-secondary" onclick="ProcurementV2.exportCsv()">↓ Export</button>'
    }) +
      '<div style="margin:14px 0 10px;display:flex;align-items:center;gap:8px 0;flex-wrap:wrap;">' + pills + searchBox() + '</div>';
    var body;
    if (V2.statusFilter === 'needs-reorder') {
      body = renderReorder();
    } else {
      body = MastEntity.renderList('procurement-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ProcurementV2.sort', onRowClickFnName: 'ProcurementV2.open',
        empty: { title: 'No purchase orders', message: V2.loaded ? 'No POs match this lens.' : 'Loading…' }
      });
    }
    tab.innerHTML = header + body;
  }
  // The Needs-reorder lens body: standard list of low items + the producer action.
  function renderReorder() {
    var sug = V2.suggestions;
    var withVendor = sug.filter(function (s) { return s.vendorId; });
    var vendorCount = Object.keys(withVendor.reduce(function (a, s) { a[s.vendorId] = 1; return a; }, {})).length;
    var action = withVendor.length
      ? '<button class="btn btn-primary" onclick="ProcurementV2.createDrafts()">Create ' + MastFormat.countNoun(vendorCount, 'draft PO') + ' (' + MastFormat.countNoun(withVendor.length, 'item') + ')</button>'
      : '';
    var hint = '<div class="mu-sub" style="margin:12px 0;">Items at or below their reorder point. Click one to draft a PO for it, or create grouped drafts for all — each opens in its process for review before sending.</div>';
    var listHtml = sug.length
      ? MastEntity.renderList('reorder-need', { rows: sug, onRowClickFnName: 'ProcurementV2.draftOne',
          empty: { title: 'Nothing to reorder', message: 'Stock is healthy.' } })
      : '<div class="mu-sub" style="padding:20px;">' + (V2.loaded ? 'Nothing below reorder threshold — stock is healthy.' : 'Loading…') + '</div>';
    return hint + (action ? '<div style="margin:12px 0;">' + action + '</div>' : '') + listHtml;
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
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
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

  // ── New PO create form (Tier 1.5 P1) ────────────────────────────────
  // V2 replacement for the legacy openNewPoModal. Captures vendor + dynamic line
  // rows (material/product picker + variant select for variant products) and
  // delegates the write to ProcurementBridge.createPO → a Draft PO that enters
  // the procurement workflow. Mirrors the receive/send capture pattern.
  var newPo = null;
  function npBlankLine() { return { kind: 'material', targetId: '', variantKey: '', qtyOrdered: 1, unitCost: 0, vendorSku: '' }; }
  function byNameEntry(a, b) { return String(a[1].name || '').localeCompare(String(b[1].name || '')); }
  function openNewPoForm() {
    var today = new Date().toISOString().slice(0, 10);
    newPo = { vendorId: '', poNumber: '', orderDate: today, expectedDate: '', notes: '', lines: [npBlankLine()] };
    U.slideOut.open({
      id: 'new-po', title: 'New purchase order', size: 'lg', mode: 'create', deepLink: false, createLabel: 'Create PO',
      render: function () { return buildNewPoBody(); },
      isDirty: function () { return true; },
      onSave: function () { return submitNewPo(); }
    });
  }
  function npRerender() { var b = document.getElementById('mastSlideOutBody'); if (b) b.innerHTML = buildNewPoBody(); }
  function buildNewPoBody() {
    if (!newPo) return '';
    var vendors = Object.keys(V2.vendors).map(function (k) { return [k, V2.vendors[k]]; })
      .filter(function (e) { return e[1] && e[1].active !== false; }).sort(byNameEntry);
    if (!vendors.length) return U.card('New purchase order', '<div class="mu-sub">No vendors yet — add one in Vendors first.</div>');
    var vendorOpts = '<option value="">— vendor (required) —</option>' + vendors.map(function (e) {
      return '<option value="' + esc(e[0]) + '"' + (newPo.vendorId === e[0] ? ' selected' : '') + '>' + esc(e[1].name || e[0]) + '</option>';
    }).join('');
    var head = '<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr;gap:10px;margin-bottom:10px;">' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);">Vendor<select style="width:100%;margin-top:2px;" onchange="ProcurementV2.npField(\'vendorId\',this.value)">' + vendorOpts + '</select></label>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);">Order date<input type="date" class="form-input" style="margin-top:2px;" value="' + esc(newPo.orderDate) + '" oninput="ProcurementV2.npField(\'orderDate\',this.value)"></label>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);">Expected<input type="date" class="form-input" style="margin-top:2px;" value="' + esc(newPo.expectedDate) + '" oninput="ProcurementV2.npField(\'expectedDate\',this.value)"></label>' +
    '</div>' +
    '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;">PO # (optional)<input type="text" class="form-input" style="margin-top:2px;" value="' + esc(newPo.poNumber) + '" oninput="ProcurementV2.npField(\'poNumber\',this.value)"></label>';
    var materials = Object.keys(V2.materials).map(function (k) { return [k, V2.materials[k]]; }).filter(function (e) { return e[1] && e[1].status !== 'archived'; }).sort(byNameEntry);
    var products = Object.keys(V2.products).map(function (k) { return [k, V2.products[k]]; }).filter(function (e) { return procurable(e[1]); }).sort(byNameEntry);
    var linesHdr = '<div style="display:grid;grid-template-columns:1fr 2fr 1fr 0.8fr 0.8fr 30px;gap:8px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--warm-gray);padding-bottom:4px;"><span>Kind</span><span>Material/Product</span><span>Vendor SKU</span><span>Qty</span><span>Unit cost</span><span></span></div>';
    var rows = newPo.lines.map(function (line, idx) { return npLineRow(line, idx, materials, products); }).join('');
    var addBtn = '<button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="ProcurementV2.npAddLine()">+ Add line</button>';
    return U.card('New purchase order', head) + U.card('Lines', linesHdr + rows + addBtn);
  }
  function npLineRow(line, idx, materials, products) {
    var kindSel = '<select onchange="ProcurementV2.npLine(' + idx + ',\'kind\',this.value)">' +
      '<option value="material"' + (line.kind === 'material' ? ' selected' : '') + '>material</option>' +
      '<option value="product"' + (line.kind === 'product' ? ' selected' : '') + '>product</option></select>';
    var targetCell;
    if (line.kind === 'material') {
      var mOpts = '<option value="">—</option>' + materials.map(function (e) { return '<option value="' + esc(e[0]) + '"' + (line.targetId === e[0] ? ' selected' : '') + '>' + esc(e[1].name || e[0]) + '</option>'; }).join('');
      targetCell = '<select style="width:100%;" onchange="ProcurementV2.npLine(' + idx + ',\'targetId\',this.value)">' + mOpts + '</select>';
    } else {
      var pOpts = '<option value="">— product —</option>' + products.map(function (e) { return '<option value="' + esc(e[0]) + '"' + (line.targetId === e[0] ? ' selected' : '') + '>' + esc(e[1].name || e[0]) + '</option>'; }).join('');
      targetCell = '<div><select style="width:100%;" onchange="ProcurementV2.npLine(' + idx + ',\'targetId\',this.value)">' + pOpts + '</select>';
      var prod = line.targetId ? V2.products[line.targetId] : null;
      var variants = (prod && Array.isArray(prod.variants)) ? prod.variants : [];
      if (variants.length) {
        var vOpts = '<option value="">— variant (required) —</option>' + variants.map(function (v) {
          var vid = v.id || ''; var vn = v.name || (v.combo ? Object.values(v.combo).join(' / ') : vid);
          return '<option value="' + esc(vid) + '"' + (line.variantKey === vid ? ' selected' : '') + '>' + esc(vn) + '</option>';
        }).join('');
        targetCell += '<select style="width:100%;margin-top:4px;" onchange="ProcurementV2.npLine(' + idx + ',\'variantKey\',this.value)">' + vOpts + '</select>';
      }
      targetCell += '</div>';
    }
    return '<div style="display:grid;grid-template-columns:1fr 2fr 1fr 0.8fr 0.8fr 30px;gap:8px;padding:8px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.2));align-items:center;">' +
      kindSel + targetCell +
      '<input type="text" class="form-input" placeholder="SKU" value="' + esc(line.vendorSku || '') + '" oninput="ProcurementV2.npLine(' + idx + ',\'vendorSku\',this.value)">' +
      '<input type="number" class="form-input" min="0" step="0.01" value="' + (line.qtyOrdered || 0) + '" oninput="ProcurementV2.npLine(' + idx + ',\'qtyOrdered\',parseFloat(this.value)||0)">' +
      '<input type="number" class="form-input" min="0" step="0.01" value="' + (line.unitCost || 0) + '" oninput="ProcurementV2.npLine(' + idx + ',\'unitCost\',parseFloat(this.value)||0)">' +
      '<button class="btn btn-secondary btn-small" style="padding:4px 8px;" onclick="ProcurementV2.npRemoveLine(' + idx + ')" title="Remove">×</button>' +
    '</div>';
  }
  function submitNewPo() {
    if (!newPo) return false;
    if (!newPo.vendorId) { if (window.showToast) showToast('Pick a vendor', true); return false; }
    var lines = [];
    for (var i = 0; i < newPo.lines.length; i++) {
      var l = newPo.lines[i];
      if (!l.targetId || !(l.qtyOrdered > 0)) continue;
      var descr = null, uom = null;
      if (l.kind === 'material') {
        var m = V2.materials[l.targetId];
        if (!m) { if (window.showToast) showToast('Line ' + (i + 1) + ': material not found', true); return false; }
        descr = m.name || null; uom = m.unitOfMeasure || null;
      } else {
        var p = V2.products[l.targetId];
        if (!p) { if (window.showToast) showToast('Line ' + (i + 1) + ': product not found', true); return false; }
        if (Array.isArray(p.variants) && p.variants.length > 0 && !l.variantKey) { if (window.showToast) showToast('Line ' + (i + 1) + ': pick a variant', true); return false; }
        var vn = '';
        if (l.variantKey && Array.isArray(p.variants)) { var vm = p.variants.filter(function (v) { return v.id === l.variantKey; })[0]; if (vm) vn = ' — ' + (vm.name || (vm.combo ? Object.values(vm.combo).join(' / ') : l.variantKey)); }
        descr = (p.name || l.targetId) + vn;
      }
      lines.push({ kind: l.kind, targetId: l.targetId, variantKey: l.kind === 'product' ? (l.variantKey || '_default') : null, qtyOrdered: l.qtyOrdered, unitCost: l.unitCost, vendorSku: l.vendorSku || null, unitOfMeasure: uom, descriptionSnapshot: descr });
    }
    if (!lines.length) { if (window.showToast) showToast('Add at least one line with a target + qty > 0', true); return false; }
    if (!window.ProcurementBridge || typeof ProcurementBridge.createPO !== 'function') {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
      if (window.showToast) showToast('Procurement engine still loading — try again', true);
      return false;
    }
    window.ProcurementBridge.createPO({
      vendorId: newPo.vendorId, poNumber: newPo.poNumber, orderDate: newPo.orderDate,
      expectedDate: newPo.expectedDate || null, notes: newPo.notes, lines: lines
    }).then(function (poId) {
      if (window.showToast) showToast('PO created (draft)');
      newPo = null;
      U.slideOut.requestCloseForce();
      return reloadThenOpen(poId);
    }).catch(function (e) { if (window.showToast) showToast('Failed to create PO: ' + (e && e.message || e), true); });
    return false;
  }

  window.ProcurementV2 = {
    createNew: function () { openNewPoForm(); },
    npField: function (f, v) { if (newPo) newPo[f] = v; },
    npLine: function (idx, f, v) {
      if (!newPo || !newPo.lines[idx]) return;
      newPo.lines[idx][f] = v;
      if (f === 'kind') { newPo.lines[idx].targetId = ''; newPo.lines[idx].variantKey = ''; npRerender(); }
      else if (f === 'targetId') { newPo.lines[idx].variantKey = ''; npRerender(); }
    },
    npAddLine: function () { if (newPo) { newPo.lines.push(npBlankLine()); npRerender(); } },
    npRemoveLine: function (idx) { if (newPo) { newPo.lines.splice(idx, 1); if (!newPo.lines.length) newPo.lines.push(npBlankLine()); npRerender(); } },
    printPo: function (id) { var po = V2.byId[id]; if (po) doPrintPo(po); },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'ordered' || key === 'expected' || key === 'total' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    // Needs-reorder producers → draft PO(s) that open in the process slide-out.
    draftOne: function (rowId) {
      var s = V2.suggestions.filter(function (x) { return (x.kind + ':' + x.id) === rowId; })[0];
      if (!s) return;
      if (!s.vendorId) { if (window.showToast) showToast('Set a preferred supplier for this item first (Vendors → Supplies).', true); return; }
      createDraftGroups([{ vendorId: s.vendorId, lines: [reorderLine(s)] }]);
    },
    createDrafts: function () {
      var withVendor = V2.suggestions.filter(function (s) { return s.vendorId; });
      if (!withVendor.length) { if (window.showToast) showToast('No low items have a preferred vendor yet.', true); return; }
      var byVendor = {};
      withVendor.forEach(function (s) { (byVendor[s.vendorId] = byVendor[s.vendorId] || []).push(reorderLine(s)); });
      var groups = Object.keys(byVendor).map(function (vid) { return { vendorId: vid, lines: byVendor[vid] }; });
      var msg = 'Create ' + MastFormat.countNoun(groups.length, 'draft PO') + ' from ' + MastFormat.countNoun(withVendor.length, 'low item') + '? Each opens for review before sending.';
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm(msg)).then(function (ok) { if (ok) createDraftGroups(groups); });
      else createDraftGroups(groups);
    },
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
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
        if (window.showToast) showToast('Procurement engine still loading — try again', true);
        return false;
      }
      // Drive the whole exit ourselves (write → force-close the receive form →
      // reload + re-open the PO on fresh data), then return false so the engine's
      // create-mode _save handler does NOTHING further (no duplicate toast/close).
      window.ProcurementBridge.receive(poId, lines, meta).then(function (receiptId) {
        U.slideOut.requestCloseForce();
        // Loop-close: a FULL receipt completes the PO → return to the procurement
        // HOME (on the Received lens, where the finished PO now sits) instead of
        // re-opening it. A PARTIAL receipt re-opens the PO to receive the rest.
        return load().then(function () {
          var po = V2.byId[poId];
          var full = po && (po.status === 'received' || po.status === 'closed');
          if (full) {
            if (window.showToast) showToast('PO fully received — stock is updating. Loop closed.');
            V2.statusFilter = 'received'; render();
          } else {
            if (window.showToast) showToast('Receipt recorded — more to receive.');
            if (po) openPo(po);
          }
        });
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
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
        if (window.showToast) showToast('Procurement engine still loading — try again', true);
        return;
      }
      // cancelPo owns its own mastConfirm; reload + re-open the PO after.
      window.ProcurementBridge.cancel(id).then(function () { reloadThenOpen(id); });
    },

    // Apply landed costs to a receipt (Tier 1.5 P3) → ProcurementBridge wraps the
    // legacy allocator (which owns its own confirm + toast). Reload + re-open the
    // PO on fresh data so the receipt shows "landed costs applied".
    applyLanded: function (receiptId, poId) {
      if (!window.ProcurementBridge || typeof ProcurementBridge.applyLandedCosts !== 'function') {
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
        if (window.showToast) showToast('Procurement engine still loading — try again', true);
        return;
      }
      Promise.resolve(window.ProcurementBridge.applyLandedCosts(receiptId)).then(function () { reloadThenOpen(poId); });
    }
  };

  // Create draft PO(s) via the Bridge, then OPEN the first in its process
  // slide-out — the loop closes into the spine (never a bounce to a flat list).
  function createDraftGroups(groups) {
    if (!window.ProcurementBridge || typeof ProcurementBridge.createDraftPOs !== 'function') {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
      if (window.showToast) showToast('Procurement engine still loading — try again', true);
      return;
    }
    ProcurementBridge.createDraftPOs(groups).then(function (ids) {
      if (window.showToast) showToast('Created ' + MastFormat.countNoun(ids.length, 'draft PO'));
      return load().then(function () {
        V2.statusFilter = 'draft'; render();
        var rec = ids && ids[0] && V2.byId[ids[0]];
        if (rec) openPo(rec);
      });
    }).catch(function (e) { if (window.showToast) showToast('Failed to create POs: ' + (e && e.message || e), true); });
  }

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

  function procurementRouteSetup() {
    // ProcurementBridge / VendorsBridge are defined in the absorbed engine IIFE
    // below (T6) — present synchronously once this file executes, no async load.
    ensureTab(); render(); load();
  }
  MastAdmin.registerModule('procurement-v2', {
    routes: {
      'procurement-v2': { tab: 'procurementV2Tab', setup: procurementRouteSetup },
      // Legacy #procurement route ABSORBED (T6): procurement.js is deleted, so the
      // twin owns the bare route directly (no MAST_V2_ROUTE_MAP remap). The engine
      // (ProcurementBridge + VendorsBridge + the receive→stock-restock→QBO path)
      // lives in the non-flag-gated IIFE appended below.
      'procurement': { tab: 'procurementV2Tab', setup: procurementRouteSetup }
    }
  });
})();



// ============================================================================
// ABSORBED FROM procurement.js (V1) — T6 retirement (absorb-first cut).
//
// procurement-v2 (POs/receiving, the UNIVERSAL #procurement surface) + vendors-v2
// both delegate their writes to window.ProcurementBridge / window.VendorsBridge,
// defined by procurement.js — the real engine (PO create/send/receive + landed
// costs + the receiving→stock-restock→QBO-push path; vendor/supply CRUD). There
// is no flag gate on either twin (procurement is remapped for ALL users), and the
// original IIFE has NO top-level side effects (defs/exports only), so this re-hosts
// procurement.js VERBATIM (its entire IIFE, minus the registerModule block) as a
// NON-flag-gated sibling IIFE. Both bridges + their full closure (incl.
// _buildReceiptWrite + the QBO/receiving CF calls) move intact; the V1 #procurement
// dashboard (#procurementTab) is retired (it was already unreachable — the route is
// remapped to procurement-v2 for everyone). vendors-v2 loadModule('procurement-v2')
// to obtain VendorsBridge from this absorbed engine.
// ============================================================================
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var vendorsData = {};
  var productSuppliersData = {};
  var purchaseOrdersData = {};
  var purchaseReceiptsData = {};
  var materialLotsData = {};
  var productLotsData = {};
  var materialsData = {};
  var productsData = {};

  var dataLoaded = false;
  var loadInFlight = false;

  // View navigation state. 'index' = the 3-tab landing; 'vendor-detail'
  // and 'lot-detail' are drill-downs entered via MastNavStack.
  var currentView = 'index';
  var currentTab = 'open-pos';      // open-pos | vendors | lots
  var poStatusFilter = 'open';
  var expandedPoId = null;
  var lotsShowEmpty = false;

  // Deep-link state — consumed once on setup(), then cleared.
  var deepLinkReceiptId = null;

  // Detail-view state.
  var selectedVendorId = null;
  var vendorDetailTab = 'products'; // products | pos | receipts
  var vendorEditMode = false;
  var vendorEditSnapshot = null;    // for MastDirty checks
  var selectedLotId = null;
  var selectedLotKind = null;       // material | product

  // ============================================================
  // Helpers
  // ============================================================

  function esc(s) {
    return (window.esc ? window.esc(s) : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  }
  function fmt$(n) { return (n == null || isNaN(n)) ? '—' : '$' + Number(n).toFixed(2); }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toISOString().slice(0, 10); } catch (e) { return iso; }
  }
  function relativeTime(iso) {
    if (!iso) return '—';
    var ms = Date.now() - new Date(iso).getTime();
    if (isNaN(ms)) return '—';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    var d = Math.floor(h / 24);
    if (d < 30) return d + 'd ago';
    var mo = Math.floor(d / 30);
    if (mo < 12) return mo + 'mo ago';
    return Math.floor(mo / 12) + 'y ago';
  }
  function statusBadge(status) {
    var bg = 'rgba(0,0,0,0.10)', color = 'var(--text)', label = status || '—';
    if (status === 'draft')                   { bg = 'rgba(0,0,0,0.10)'; color = 'var(--text)'; }
    else if (status === 'submitted')          { bg = 'rgba(0,0,0,0.18)'; color = 'var(--text)'; }
    else if (status === 'partially_received') { bg = 'rgba(196,133,60,0.30)'; color = 'var(--amber-light)'; label = 'partial'; }
    else if (status === 'received')           { bg = 'rgba(42,124,111,0.20)'; color = 'var(--teal)'; }
    else if (status === 'closed')             { bg = 'rgba(0,0,0,0.10)'; color = 'var(--text)'; }
    else if (status === 'cancelled')          { bg = 'rgba(220,38,38,0.20)'; color = 'var(--danger)'; }
    return '<span class="status-badge pill" style="background:' + bg + ';color:' + color + ';">' + esc(label) + '</span>';
  }
  function paymentBadge(r) {
    var ps = r && r.paymentStatus;
    if (!ps) return '';
    var bg, color, label;
    if (ps === 'paid')    { bg = 'rgba(42,124,111,0.20)';  color = 'var(--teal)';       label = 'paid'; }
    else if (ps === 'partial') { bg = 'rgba(196,133,60,0.30)'; color = 'var(--amber-light)'; label = 'partial'; }
    else                  { bg = 'rgba(220,38,38,0.20)';   color = 'var(--danger)';     label = 'unpaid'; }
    return '<span class="status-badge pill" style="background:' + bg + ';color:' + color + ';margin-left:4px;">' + label + '</span>';
  }
  function paymentLine(r) {
    var ps = r && r.paymentStatus;
    if (!ps) return '';
    var total = r.amountCents || 0;
    var paid  = r.paidAmount  || 0;
    var due   = r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : null;
    var text  = '';
    if (ps === 'paid') {
      text = 'Paid in full';
    } else if (ps === 'partial') {
      text = 'Partial — ' + fmt$(paid) + ' of ' + fmt$(total) + ' paid' + (due ? ' · due ' + due : '');
    } else {
      text = 'Unpaid' + (due ? ' · due ' + due : '');
    }
    var link = (ps !== 'paid')
      ? ' <button type="button" onclick="navigateTo(\'finance-ap\')" style="background:none;border:none;color:var(--teal);font-size:0.78rem;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline;text-underline-offset:2px;">Record payment →</button>'
      : '';
    return '<div style="font-size:0.78rem;margin-top:4px;">' +
      '<span style="color:' + (ps === 'paid' ? 'var(--teal)' : ps === 'partial' ? 'var(--amber-light)' : 'var(--danger)') + ';">' + text + '</span>' +
      link + '</div>';
  }
  function poTotal(po) {
    if (typeof po.total === 'number' && po.total > 0) return po.total;
    var sum = 0;
    (po.lines || []).forEach(function(l) {
      sum += (Number(l.qtyOrdered) || 0) * (Number(l.unitCost) || 0);
    });
    return sum;
  }
  // CSS that makes a <button> render flush like a row (for clickable list rows).
  // Resets browser button styles, keeps focus indicator.
  var ROW_BUTTON_CSS = 'all:unset;display:block;width:100%;cursor:pointer;font-family:inherit;color:inherit;box-sizing:border-box;';

  // Inline SVG sparkline for priceHistory[].
  function priceSparkline(history, width, height) {
    width = width || 80; height = height || 22;
    var pts = (history || []).map(function(h) { return Number(h.unitCost) || 0; }).filter(function(n) { return n > 0; });
    if (pts.length < 2) return '';
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var span = max - min || 1;
    var stepX = pts.length > 1 ? width / (pts.length - 1) : 0;
    var path = pts.map(function(v, i) {
      var x = i * stepX;
      var y = height - ((v - min) / span) * (height - 2) - 1;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastVal = pts[pts.length - 1], firstVal = pts[0];
    var trend = lastVal > firstVal ? 'var(--amber-light)' : (lastVal < firstVal ? 'var(--teal)' : 'var(--text)');
    return '<svg width="' + width + '" height="' + height + '" style="vertical-align:middle;">' +
      '<path d="' + path + '" fill="none" stroke="' + trend + '" stroke-width="1.5" />' +
    '</svg>';
  }

  // ============================================================
  // Data loading
  // ============================================================

  function loadAll() {
    if (loadInFlight) return Promise.resolve();
    loadInFlight = true;
    // Load the MastIntake provider catalog so the vendor editor's secure Tax ID /
    // bank account fields (identity-data) render + hydrate inline. Fire-and-forget,
    // fail-closed: if it can't load the secure field shows disabled.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
      try { MastAdmin.loadModule('connections-providers'); } catch (e) { /* fail-closed */ }
    }
    return Promise.all([
      MastDB.get('admin/vendors').then(function(v) { vendorsData = v || {}; }),
      MastDB.get('admin/productSuppliers').then(function(v) { productSuppliersData = v || {}; }),
      MastDB.get('admin/purchaseOrders').then(function(v) { purchaseOrdersData = v || {}; }),
      MastDB.get('admin/purchaseReceipts').then(function(v) { purchaseReceiptsData = v || {}; }),
      MastDB.get('admin/materialLots').then(function(v) { materialLotsData = v || {}; }),
      MastDB.get('admin/productLots').then(function(v) { productLotsData = v || {}; }),
      MastDB.get('admin/materials').then(function(v) { materialsData = v || {}; }),
      MastDB.get('admin/products').then(function(v) { productsData = v || {}; })
    ]).then(function() {
      dataLoaded = true;
      loadInFlight = false;
    }).catch(function(err) {
      loadInFlight = false;
      console.warn('[procurement] load error:', err && err.message);
      if (typeof showToast === 'function') showToast('Failed to load procurement data: ' + (err && err.message), true);
    });
  }
  function refresh() {
    dataLoaded = false;
    loadAll().then(render);
  }
  window.procurementRefresh = refresh;

  // ============================================================
  // Top-level render dispatcher
  // ============================================================

  function render() {
    var tab = document.getElementById('procurementTab');
    if (!tab) return;
    if (!dataLoaded) {
      tab.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading procurement…</div>';
      return;
    }
    if (currentView === 'vendor-detail') {
      tab.innerHTML = renderVendorDetail();
      // Bind/hydrate the secure Tax ID / bank account fields embedded in the edit form.
      if (vendorEditMode && window.MastIntake && typeof MastIntake.hydrate === 'function') {
        try { MastIntake.hydrate(tab); } catch (e) { /* fail-closed */ }
      }
      return;
    }
    if (currentView === 'lot-detail')    { tab.innerHTML = renderLotDetail();    return; }
    var html = '';
    html += renderHeader();
    html += renderKpiBand();
    html += renderTabBar();
    if (currentTab === 'open-pos')      html += renderOpenPosTab();
    else if (currentTab === 'vendors')  html += renderVendorsTab();
    else if (currentTab === 'lots')     html += renderLotsTab();
    tab.innerHTML = html;
  }

  function renderHeader() {
    var askAi = (window.MastAskAi && window.MastAskAi.isEnabled())
      ? '<button class="btn btn-secondary btn-small" onclick="MastAskAi.open(\'procurement\')" title="Ask Claude about your procurement">✨ Ask AI</button>'
      : '';
    return '<div class="section-header" style="margin-bottom:14px;">' +
      '<h2 style="margin:0;">Procurement</h2>' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:0.85rem;color:var(--warm-gray);">Vendors, POs, receipts, and on-hand lots</span>' +
        askAi +
        '<button class="btn btn-secondary btn-small" onclick="window.procurementRefresh()">Refresh</button>' +
      '</div>' +
    '</div>';
  }

  // ============================================================
  // KPI band
  // ============================================================

  function computeKpis() {
    var pos = Object.values(purchaseOrdersData);
    var openStatuses = { draft: true, submitted: true, partially_received: true };
    var openPos = pos.filter(function(p) { return openStatuses[p.status]; });
    var openByStatus = { draft: 0, submitted: 0, partially_received: 0 };
    var outstanding = 0;
    openPos.forEach(function(p) {
      openByStatus[p.status] = (openByStatus[p.status] || 0) + 1;
      outstanding += poTotal(p);
    });
    var lots = Object.values(materialLotsData);
    var inventoryValue = 0;
    lots.forEach(function(l) { inventoryValue += (Number(l.qtyRemaining) || 0) * (Number(l.unitCost) || 0); });
    var receipts = Object.values(purchaseReceiptsData);
    var lastReceiptAt = null;
    receipts.forEach(function(r) {
      var t = r.receivedAt || r.createdAt;
      if (t && (!lastReceiptAt || t > lastReceiptAt)) lastReceiptAt = t;
    });
    return { openCount: openPos.length, openByStatus: openByStatus, outstanding: outstanding, inventoryValue: inventoryValue, lastReceiptAt: lastReceiptAt };
  }
  function renderKpiBand() {
    var k = computeKpis();
    function card(label, value, sub) {
      return '<div style="flex:1;min-width:160px;padding:14px 18px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);">' +
        '<div style="font-size:0.78rem;color:var(--text);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:6px;opacity:0.8;">' + esc(label) + '</div>' +
        '<div style="font-family:monospace;font-size:1.6rem;font-weight:700;color:var(--text);">' + value + '</div>' +
        (sub ? '<div style="font-size:0.85rem;color:var(--text);opacity:0.72;margin-top:4px;">' + sub + '</div>' : '') +
      '</div>';
    }
    var parts = [];
    if (k.openByStatus.draft)              parts.push(k.openByStatus.draft + ' draft');
    if (k.openByStatus.submitted)          parts.push(k.openByStatus.submitted + ' submitted');
    if (k.openByStatus.partially_received) parts.push(k.openByStatus.partially_received + ' partial');
    var openSub = parts.join(' · ');
    var lastSub = k.lastReceiptAt ? fmtDate(k.lastReceiptAt) : 'no receipts yet';
    return '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px;">' +
      card('Open POs', String(k.openCount), openSub) +
      card('Outstanding', fmt$(k.outstanding), 'across open POs') +
      card('Inventory value', fmt$(k.inventoryValue), 'qtyRemaining × unitCost on material lots') +
      card('Last receipt', k.lastReceiptAt ? relativeTime(k.lastReceiptAt) : '—', lastSub) +
    '</div>';
  }

  // ============================================================
  // Tab bar
  // ============================================================

  function renderTabBar() {
    function btn(id, label) {
      var on = currentTab === id;
      return '<button class="view-tab' + (on ? ' active' : '') + '" onclick="window.procurementSwitchTab(\'' + id + '\')">' + esc(label) + '</button>';
    }
    return '<div class="view-tabs" style="margin-bottom:16px;">' +
      btn('open-pos', 'Open POs') +
      btn('vendors',  'Vendors') +
      btn('lots',     'Inventory Lots') +
    '</div>';
  }

  // ============================================================
  // Open POs tab
  // ============================================================

  function renderOpenPosTab() {
    var pos = Object.values(purchaseOrdersData);
    var counts = { all: pos.length, open: 0, draft: 0, submitted: 0, partially_received: 0, received: 0, closed: 0, cancelled: 0 };
    pos.forEach(function(p) {
      if (p.status in counts) counts[p.status]++;
      if (p.status === 'draft' || p.status === 'submitted' || p.status === 'partially_received') counts.open++;
    });
    var filtered = pos.filter(function(p) {
      if (poStatusFilter === 'all') return true;
      if (poStatusFilter === 'open') return p.status === 'draft' || p.status === 'submitted' || p.status === 'partially_received';
      return p.status === poStatusFilter;
    });
    filtered.sort(function(a, b) { return (b.orderDate || b.createdAt || '').localeCompare(a.orderDate || a.createdAt || ''); });

    var html = '';
    function pill(value, label, n) {
      var active = poStatusFilter === value;
      var bg = active ? 'rgba(42,124,111,0.16)' : 'transparent';
      var color = active ? 'var(--teal)' : 'var(--text)';
      var border = active ? '1px solid rgba(42,124,111,0.45)' : '1px solid var(--cream-dark)';
      return '<button onclick="window.procurementSetPoFilter(\'' + value + '\')" ' +
        'style="padding:5px 14px;background:' + bg + ';color:' + color + ';border:' + border +
        ';border-radius:14px;font-size:0.85rem;font-weight:' + (active ? '600' : '500') +
        ';cursor:pointer;margin-right:6px;font-family:\'DM Sans\',sans-serif;">' +
        esc(label) + ' <span style="opacity:0.7;font-weight:400;">(' + n + ')</span></button>';
    }
    html += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:14px;">';
    html += '<div>';
    html += pill('open',               'Open',      counts.open);
    html += pill('draft',              'Draft',     counts.draft);
    html += pill('submitted',          'Submitted', counts.submitted);
    html += pill('partially_received', 'Partial',   counts.partially_received);
    html += pill('received',           'Received',  counts.received);
    html += pill('cancelled',          'Cancelled', counts.cancelled);
    html += pill('all',                'All',       counts.all);
    html += '</div>';
    html += '<button class="btn btn-primary btn-small" onclick="window.procurementOpenNewPo()">+ New PO</button>';
    html += '</div>';

    if (filtered.length === 0) {
      html += '<div style="padding:40px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark);border-radius:10px;">' +
        'No POs match this filter.' +
      '</div>';
      return html;
    }

    html += '<div style="border:1px solid var(--cream-dark);border-radius:10px;overflow:hidden;background:var(--surface-card);">';
    html += '<div style="display:grid;grid-template-columns:1.2fr 1.4fr 0.8fr 0.9fr 0.8fr 0.9fr 30px;gap:12px;padding:10px 16px;background:rgba(42,124,111,0.06);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text);font-weight:600;border-bottom:1px solid var(--cream-dark);">' +
      '<span>PO #</span><span>Vendor</span><span>Status</span><span>Ordered</span><span>Expected</span><span style="text-align:right;">Total</span><span></span>' +
    '</div>';
    filtered.forEach(function(po, idx) {
      var v = vendorsData[po.vendorId] || {};
      var lineCount = (po.lines || []).length;
      var isExpanded = expandedPoId === po.poId;
      var rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)';
      html += '<div style="border-bottom:' + (idx < filtered.length - 1 || isExpanded ? '1px solid var(--cream-dark)' : 'none') + ';">';
      html += '<button type="button" aria-expanded="' + (isExpanded ? 'true' : 'false') + '" onclick="window.procurementToggleExpand(\'' + esc(po.poId) + '\')" ' +
        'style="' + ROW_BUTTON_CSS + 'background:' + rowBg + ';">' +
        '<div style="display:grid;grid-template-columns:1.2fr 1.4fr 0.8fr 0.9fr 0.8fr 0.9fr 30px;gap:12px;align-items:center;padding:14px 16px;text-align:left;">' +
        '<span style="font-family:monospace;font-weight:600;color:var(--text);">' + esc(po.poNumber || po.poId.slice(0, 8)) + '</span>' +
        '<span style="color:var(--text);">' + esc(v.name || '(unknown vendor)') + ' <span style="opacity:0.65;font-size:0.85rem;">· ' + lineCount + (lineCount === 1 ? ' line' : ' lines') + '</span></span>' +
        '<span>' + statusBadge(po.status) + '</span>' +
        '<span style="font-size:0.85rem;color:var(--text);">' + fmtDate(po.orderDate) + '</span>' +
        '<span style="font-size:0.85rem;color:var(--text);">' + fmtDate(po.expectedDate) + '</span>' +
        '<span style="text-align:right;font-family:monospace;font-weight:600;color:var(--text);">' + fmt$(poTotal(po)) + '</span>' +
        '<span style="color:var(--teal);font-size:0.85rem;font-weight:600;">' + (isExpanded ? '▾' : '▸') + '</span>' +
        '</div>' +
      '</button>';
      if (isExpanded) html += renderPoExpand(po);
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderPoExpand(po) {
    var canCancel = po.status === 'draft' || po.status === 'submitted' || po.status === 'partially_received';
    var html = '<div style="padding:14px 22px 18px 22px;background:rgba(42,124,111,0.025);border-top:1px solid var(--cream-dark);">';
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:14px;">';
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:0.85rem;color:var(--text);">';
    if (po.notes) html += '<span><strong>Notes:</strong> ' + esc(po.notes) + '</span>';
    if (po.paymentTerms) html += '<span><strong>Terms:</strong> ' + esc(po.paymentTerms) + '</span>';
    if (po.currency) html += '<span><strong>Currency:</strong> ' + esc(po.currency) + '</span>';
    if (po.incoterm) html += '<span><strong>Incoterm:</strong> ' + esc(po.incoterm) + '</span>';
    if (po.dropShip) html += '<span><strong>Drop-ship</strong></span>';
    if (po.memo) html += '<span><strong>Memo</strong> (consignment-in)</span>';
    html += '</div>';
    var poLines = po.lines || [];
    var hasOutstanding = poLines.some(function(l) { return (Number(l.qtyOrdered) || 0) > (Number(l.qtyReceived) || 0); });
    var canReceive = (po.status === 'submitted' || po.status === 'partially_received' || po.status === 'draft') && hasOutstanding;
    var rightActions = '';
    if (canReceive)  rightActions += '<button class="btn btn-primary btn-small" onclick="window.procurementOpenRecordReceipt(\'' + esc(po.poId) + '\')">Record Receipt</button>';
    if (canCancel)   rightActions += ' <button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="window.procurementCancelPo(\'' + esc(po.poId) + '\')">Cancel PO</button>';
    html += rightActions;
    html += '</div>';

    var lines = po.lines || [];
    if (lines.length) {
      html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;overflow:hidden;background:var(--surface-card);margin-bottom:14px;">';
      html += '<div style="display:grid;grid-template-columns:0.5fr 1.6fr 1fr 0.9fr 0.9fr 0.9fr;gap:10px;padding:8px 14px;background:rgba(42,124,111,0.06);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);">' +
        '<span>Kind</span><span>Target</span><span>Vendor SKU</span><span>Ordered</span><span>Received</span><span style="text-align:right;">Unit</span>' +
      '</div>';
      lines.forEach(function(line, i) {
        var pct = (Number(line.qtyOrdered) || 0) > 0 ? Math.min(100, ((Number(line.qtyReceived) || 0) / Number(line.qtyOrdered)) * 100) : 0;
        var targetLabel = line.descriptionSnapshot ||
          (line.kind === 'material' ? (materialsData[line.targetId] && materialsData[line.targetId].name) || line.targetId : line.targetId);
        var bar = '<div style="height:6px;background:rgba(0,0,0,0.06);border-radius:3px;margin-top:4px;overflow:hidden;"><div style="width:' + pct.toFixed(0) + '%;height:100%;background:var(--teal);"></div></div>';
        html += '<div style="display:grid;grid-template-columns:0.5fr 1.6fr 1fr 0.9fr 0.9fr 0.9fr;gap:10px;padding:10px 14px;align-items:center;font-size:0.85rem;color:var(--text);' + (i < lines.length - 1 ? 'border-bottom:1px solid var(--cream-dark);' : '') + '">' +
          '<span style="font-size:0.78rem;opacity:0.75;">' + esc(line.kind || '—') + '</span>' +
          '<span>' + esc(targetLabel) + '</span>' +
          '<span style="font-family:monospace;font-size:0.78rem;opacity:0.85;">' + esc(line.vendorSku || '—') + '</span>' +
          '<span style="font-family:monospace;">' + (line.qtyOrdered || 0) + (line.unitOfMeasure ? ' ' + esc(line.unitOfMeasure) : '') + '</span>' +
          '<span style="font-family:monospace;">' + (line.qtyReceived || 0) + ' / ' + (line.qtyOrdered || 0) + bar + '</span>' +
          '<span style="text-align:right;font-family:monospace;">' + fmt$(line.unitCost) + '</span>' +
        '</div>';
      });
      html += '</div>';
    }

    var receipts = Object.values(purchaseReceiptsData).filter(function(r) { return r.poId === po.poId; });
    receipts.sort(function(a, b) { return (b.receivedAt || '').localeCompare(a.receivedAt || ''); });
    if (receipts.length) {
      html += '<div style="font-size:0.85rem;color:var(--text);font-weight:600;margin-bottom:6px;">Receipts (' + receipts.length + ')</div>';
      html += '<div style="display:flex;flex-direction:column;gap:6px;">';
      receipts.forEach(function(r) {
        var rLines = r.lines || [];
        var rQty = rLines.reduce(function(s, l) { return s + (Number(l.qtyReceivedNow) || 0); }, 0);
        var rValue = rLines.reduce(function(s, l) { return s + (Number(l.qtyReceivedNow) || 0) * (Number(l.unitCostHomeCurrency) || 0); }, 0);
        var addl = (r.additionalCosts || []).reduce(function(s, c) { return s + (Number(c.amount) || 0); }, 0);
        var canApplyLanded = addl > 0 && !r.landedCostsApplied;
        html += '<div style="padding:10px 14px;border:1px solid var(--cream-dark);border-radius:8px;background:var(--surface-card);font-size:0.85rem;color:var(--text);display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;">' +
          '<div>' +
          '<span>' + fmtDate(r.receivedAt) +
          (r.vendorInvoiceRef ? ' · <span style="font-family:monospace;">' + esc(r.vendorInvoiceRef) + '</span>' : '') +
          ' · ' + rLines.length + (rLines.length === 1 ? ' line' : ' lines') +
          ' · ' + rQty + ' units' +
          (r.landedCostsApplied ? ' · <span style="color:var(--teal);">landed costs applied</span>' : '') +
          paymentBadge(r) +
          '</span>' +
          paymentLine(r) +
          '</div>' +
          '<span style="display:flex;align-items:center;gap:10px;flex-shrink:0;">' +
          '<span style="font-family:monospace;">' + fmt$(rValue) + (addl > 0 ? ' <span style="opacity:0.7;">+ ' + fmt$(addl) + ' addl</span>' : '') + '</span>' +
          (canApplyLanded ? '<button class="btn btn-secondary btn-small" onclick="window.procurementApplyLandedCosts(\'' + esc(r.receiptId) + '\')">Apply landed</button>' : '') +
          '</span>' +
        '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="font-size:0.85rem;color:var(--text);opacity:0.7;font-style:italic;">No receipts yet.</div>';
    }
    html += '</div>';
    return html;
  }

  // ============================================================
  // Vendors tab (index)
  // ============================================================

  function renderVendorsTab() {
    // URL-driven filters from MCP admin links: active, role, vendorIds.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlActive = (rp && typeof rp.active === 'string') ? rp.active : '';
    var urlRole = (rp && typeof rp.role === 'string') ? rp.role : '';
    var urlIdsParam = (rp && typeof rp.vendorIds === 'string') ? rp.vendorIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id){urlIdLookup[id]=true;});
    var hasUrlFilter = !!(urlActive || urlRole || urlIds.length);

    var vendors;
    if (hasUrlFilter) {
      vendors = Object.values(vendorsData).filter(function(v) {
        if (urlActive === 'true' && v.active === false) return false;
        if (urlActive === 'false' && v.active !== false) return false;
        if (urlActive === '' && v.active === false) return false;
        if (urlRole === 'supplier' && (v.roleFlags && v.roleFlags.isSupplier === false)) return false;
        if (urlRole === 'customer' && (v.roleFlags && v.roleFlags.isCustomer === false)) return false;
        if (urlIdLookup && !urlIdLookup[v.vendorId]) return false;
        return true;
      });
    } else {
      vendors = Object.values(vendorsData).filter(function(v) { return v.active !== false; });
    }
    vendors.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var psByVendor = {};
    Object.values(productSuppliersData).forEach(function(ps) {
      if (ps.active === false) return;
      psByVendor[ps.vendorId] = (psByVendor[ps.vendorId] || 0) + 1;
    });
    var spendByVendor = {};
    Object.values(purchaseOrdersData).forEach(function(po) {
      if (po.status !== 'received' && po.status !== 'partially_received' && po.status !== 'closed') return;
      var rs = Object.values(purchaseReceiptsData).filter(function(r) { return r.poId === po.poId; });
      var spent = 0;
      if (rs.length) {
        rs.forEach(function(r) {
          (r.lines || []).forEach(function(l) {
            spent += (Number(l.qtyReceivedNow) || 0) * (Number(l.unitCostHomeCurrency) || 0);
          });
        });
      } else {
        spent = poTotal(po);
      }
      spendByVendor[po.vendorId] = (spendByVendor[po.vendorId] || 0) + spent;
    });

    var html = '';
    if (hasUrlFilter) {
      var bParts = [];
      if (urlIds.length) bParts.push(MastFormat.countNoun(urlIds.length, 'selected vendor'));
      if (urlActive === 'true') bParts.push('active only');
      else if (urlActive === 'false') bParts.push('inactive only');
      if (urlRole) bParts.push('role: ' + urlRole);
      html += '<div id="procurementVendorsUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>&#127981; Showing ' + bParts.join(', ') + '</span>' +
        '<button type="button" onclick="clearProcurementFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }
    html += '<div style="display:flex;justify-content:flex-end;margin-bottom:14px;">' +
      '<button class="btn btn-primary btn-small" onclick="window.procurementOpenNewVendor()">+ New Vendor</button>' +
    '</div>';

    if (vendors.length === 0) {
      html += '<div style="padding:40px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark);border-radius:10px;">' +
        'No active vendors yet. Click + New Vendor to add one.' +
      '</div>';
      return html;
    }

    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">';
    vendors.forEach(function(v) {
      var nProducts = psByVendor[v.vendorId] || 0;
      var spend = spendByVendor[v.vendorId] || 0;
      html += '<button type="button" onclick="window.procurementOpenVendor(\'' + esc(v.vendorId) + '\')" ' +
        'style="' + ROW_BUTTON_CSS + 'padding:16px 18px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);text-align:left;">' +
        '<div style="font-size:1rem;font-weight:600;color:var(--text);margin-bottom:4px;">' + esc(v.name) + '</div>' +
        (v.vendorCode ? '<div style="font-family:monospace;font-size:0.78rem;color:var(--text);opacity:0.7;margin-bottom:10px;">' + esc(v.vendorCode) + '</div>' : '<div style="margin-bottom:10px;"></div>') +
        '<div style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem;color:var(--text);">' +
          (v.contactName ? '<div>' + esc(v.contactName) + '</div>' : '') +
          (v.email ? '<div style="opacity:0.85;">' + esc(v.email) + '</div>' : '') +
          (v.defaultLeadTimeDays != null ? '<div><span style="opacity:0.7;">Lead time</span> · ' + v.defaultLeadTimeDays + ' days</div>' : '') +
          (v.defaultPaymentTerms ? '<div><span style="opacity:0.7;">Terms</span> · ' + esc(v.defaultPaymentTerms) + '</div>' : '') +
          (v.defaultCurrency ? '<div><span style="opacity:0.7;">Currency</span> · ' + esc(v.defaultCurrency) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--cream-dark);font-size:0.85rem;">' +
          '<div><span style="opacity:0.7;">Supplies</span> <strong>' + nProducts + '</strong></div>' +
          '<div><span style="opacity:0.7;">Spend</span> <strong style="font-family:monospace;">' + fmt$(spend) + '</strong></div>' +
        '</div>' +
      '</button>';
    });
    html += '</div>';
    return html;
  }

  // ============================================================
  // Inventory Lots tab (index)
  // ============================================================

  function renderLotsTab() {
    var lots = Object.values(materialLotsData);
    if (!lotsShowEmpty) lots = lots.filter(function(l) { return (Number(l.qtyRemaining) || 0) > 0; });
    var html = '';
    html += '<div style="margin-bottom:14px;display:flex;justify-content:flex-end;">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text);cursor:pointer;">' +
        '<input type="checkbox" ' + (lotsShowEmpty ? 'checked' : '') + ' onchange="window.procurementToggleEmptyLots()"> Show consumed (qtyRemaining = 0)' +
      '</label>' +
    '</div>';
    if (lots.length === 0) {
      html += '<div style="padding:40px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark);border-radius:10px;">' +
        'No material lots yet.' +
      '</div>';
      return html;
    }
    var byMaterial = {};
    lots.forEach(function(l) {
      if (!byMaterial[l.targetId]) byMaterial[l.targetId] = [];
      byMaterial[l.targetId].push(l);
    });
    var materialIds = Object.keys(byMaterial);
    materialIds.sort(function(a, b) {
      var na = (materialsData[a] && materialsData[a].name) || a;
      var nb = (materialsData[b] && materialsData[b].name) || b;
      return na.localeCompare(nb);
    });
    materialIds.forEach(function(mid) {
      var rows = byMaterial[mid];
      rows.sort(function(a, b) { return (a.receivedAt || '').localeCompare(b.receivedAt || ''); });
      var totalQty = 0, totalValue = 0;
      rows.forEach(function(l) {
        var q = Number(l.qtyRemaining) || 0;
        totalQty += q;
        totalValue += q * (Number(l.unitCost) || 0);
      });
      var avgCost = totalQty > 0 ? totalValue / totalQty : 0;
      var matName = (materialsData[mid] && materialsData[mid].name) || mid;
      var uom = (materialsData[mid] && materialsData[mid].unitOfMeasure) || '';
      html += '<div style="margin-bottom:18px;border:1px solid var(--cream-dark);border-radius:10px;overflow:hidden;background:var(--surface-card);">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(42,124,111,0.06);">' +
        '<div style="font-weight:600;font-size:1rem;color:var(--text);">' + esc(matName) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--text);">' +
          '<span style="opacity:0.7;">Total</span> <strong style="font-family:monospace;">' + totalQty + (uom ? ' ' + esc(uom) : '') + '</strong>' +
          ' · <span style="opacity:0.7;">avg</span> <strong style="font-family:monospace;">' + fmt$(avgCost) + '</strong>' +
          ' · <span style="opacity:0.7;">value</span> <strong style="font-family:monospace;">' + fmt$(totalValue) + '</strong>' +
        '</div>' +
      '</div>';
      html += '<div style="display:grid;grid-template-columns:1.2fr 0.7fr 0.7fr 0.9fr 1fr 1fr;gap:10px;padding:8px 16px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);border-bottom:1px solid var(--cream-dark);">' +
        '<span>Lot</span><span>Received</span><span>Remaining</span><span>Unit cost</span><span>Vendor</span><span>Received date</span>' +
      '</div>';
      rows.forEach(function(l, idx) {
        var v = vendorsData[l.vendorId] || {};
        html += '<button type="button" onclick="window.procurementOpenLot(\'material\',\'' + esc(l.lotId) + '\')" ' +
          'style="' + ROW_BUTTON_CSS + 'text-align:left;' + (idx < rows.length - 1 ? 'border-bottom:1px solid var(--cream-dark);' : '') + '">' +
          '<div style="display:grid;grid-template-columns:1.2fr 0.7fr 0.7fr 0.9fr 1fr 1fr;gap:10px;padding:10px 16px;align-items:center;font-size:0.85rem;color:var(--text);">' +
            '<span style="font-family:monospace;font-weight:600;">' + esc(l.lotNumber || l.lotId.slice(0, 8)) + '</span>' +
            '<span style="font-family:monospace;">' + (l.qtyReceived || 0) + '</span>' +
            '<span style="font-family:monospace;font-weight:600;">' + (l.qtyRemaining || 0) + '</span>' +
            '<span style="font-family:monospace;">' + fmt$(l.unitCost) +
              (typeof l.unitCostOriginal === 'number' && l.unitCostOriginal !== l.unitCost
                ? ' <span style="font-size:0.78rem;opacity:0.65;">(was ' + fmt$(l.unitCostOriginal) + ')</span>' : '') +
            '</span>' +
            '<span>' + esc(v.name || (l.vendorId ? l.vendorId.slice(0, 8) : '—')) + '</span>' +
            '<span>' + fmtDate(l.receivedAt) + '</span>' +
          '</div>' +
        '</button>';
      });
      html += '</div>';
    });
    return html;
  }

  // ============================================================
  // Vendor detail view
  // ============================================================

  function renderVendorDetail() {
    var v = vendorsData[selectedVendorId];
    if (!v) {
      return '<div style="padding:40px;text-align:center;">Vendor not found. ' +
        '<button class="btn btn-secondary btn-small" onclick="window.procurementBackFromDetail()">Back</button></div>';
    }
    var backLabel = (window.MastNavStack && MastNavStack.label()) ? '← Back to ' + MastNavStack.label() : '← Back to Procurement';
    var html = '<button class="detail-back" onclick="window.procurementBackFromDetail()">' + esc(backLabel) + '</button>';

    // Header
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px;">';
    html += '<div>';
    html += '<h2 style="margin:0;font-size:1.6rem;">' + esc(v.name) + '</h2>';
    if (v.vendorCode) html += '<div style="font-family:monospace;font-size:0.85rem;color:var(--text);opacity:0.7;margin-top:4px;">' + esc(v.vendorCode) + '</div>';
    if (v.active === false) html += '<div style="margin-top:6px;"><span class="status-badge pill" style="background:rgba(0,0,0,0.18);color:var(--text);">archived</span></div>';
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;">';
    if (vendorEditMode) {
      html += '<span style="font-size:0.72rem;color:var(--amber);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Editing</span>';
    } else {
      html += '<button class="btn btn-secondary btn-small" onclick="window.procurementEnterVendorEdit()">Edit</button>';
      if (v.active !== false) {
        html += '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="window.procurementArchiveVendor()">Archive</button>';
      }
    }
    html += '</div></div>';

    // Body — read or edit form
    if (vendorEditMode) {
      html += renderVendorEditForm(v);
    } else {
      html += renderVendorReadCard(v);
    }

    // Sub-tabs (always visible, even in edit — they're not part of edit state)
    html += '<div class="view-tabs" style="margin-bottom:16px;">' +
      '<button class="view-tab' + (vendorDetailTab === 'products' ? ' active' : '') + '" onclick="window.procurementVendorTab(\'products\')">Products</button>' +
      '<button class="view-tab' + (vendorDetailTab === 'pos' ? ' active' : '') + '" onclick="window.procurementVendorTab(\'pos\')">POs</button>' +
      '<button class="view-tab' + (vendorDetailTab === 'receipts' ? ' active' : '') + '" onclick="window.procurementVendorTab(\'receipts\')">Receipts</button>' +
    '</div>';
    if (vendorDetailTab === 'products')      html += renderVendorProducts(v);
    else if (vendorDetailTab === 'pos')      html += renderVendorPos(v);
    else if (vendorDetailTab === 'receipts') html += renderVendorReceipts(v);
    return html;
  }

  function renderVendorReadCard(v) {
    function row(label, value) {
      return '<dt style="font-size:0.78rem;color:var(--text);opacity:0.72;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">' + esc(label) + '</dt>' +
             '<dd style="margin:0;color:var(--text);">' + value + '</dd>';
    }
    var html = '<div style="padding:18px 22px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);margin-bottom:18px;">';
    html += '<dl style="display:grid;grid-template-columns:160px 1fr;gap:8px 20px;margin:0;font-size:0.85rem;">';
    if (v.contactName) html += row('Contact', esc(v.contactName));
    if (v.email)       html += row('Email', esc(v.email));
    if (v.phone)       html += row('Phone', esc(v.phone));
    if (v.website)     html += row('Website', '<a href="' + esc(v.website) + '" target="_blank" rel="noopener">' + esc(v.website) + '</a>');
    if (v.defaultCurrency)         html += row('Default currency', esc(v.defaultCurrency));
    if (v.defaultPaymentTerms)     html += row('Payment terms', esc(v.defaultPaymentTerms));
    if (v.defaultLeadTimeDays != null) html += row('Lead time', v.defaultLeadTimeDays + ' days');
    if (v.defaultShipMethod)       html += row('Ship method', esc(v.defaultShipMethod));
    // PII (identity-data): render the masked last-4 only, never the raw value — a
    // not-yet-migrated legacy plaintext is masked on the fly by VendorSecureId.masked.
    if (window.VendorSecureId && VendorSecureId.has(v, 'taxId'))         html += row('Tax ID', esc(VendorSecureId.masked(v, 'taxId')));
    if (window.VendorSecureId && VendorSecureId.has(v, 'accountNumber')) html += row('Account #', esc(VendorSecureId.masked(v, 'accountNumber')));
    if (v.notes)         html += row('Notes', esc(v.notes));
    html += '</dl></div>';
    return html;
  }

  function renderVendorEditForm(v) {
    function field(id, label, value, type) {
      return '<div class="form-group">' +
        '<label for="' + id + '">' + esc(label) + '</label>' +
        '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '">' +
      '</div>';
    }
    var html = '<div style="padding:18px 22px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);margin-bottom:18px;">';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">';
    html += field('vendName',         'Name (required)',       v.name);
    html += field('vendCode',         'Vendor code',           v.vendorCode);
    html += field('vendContactName',  'Contact name',          v.contactName);
    html += field('vendEmail',        'Email',                 v.email, 'email');
    html += field('vendPhone',        'Phone',                 v.phone, 'tel');
    html += field('vendWebsite',      'Website',               v.website, 'url');
    html += field('vendCurrency',     'Default currency',      v.defaultCurrency);
    html += field('vendTerms',        'Payment terms',         v.defaultPaymentTerms);
    html += field('vendLeadTime',     'Default lead time (days)', v.defaultLeadTimeDays, 'number');
    html += field('vendShipMethod',   'Ship method',           v.defaultShipMethod);
    html += '</div>';
    // Tax ID (EIN/SSN) + bank account number are PII, encrypted at rest via MastIntake
    // (identity-data). The secure host replaces the legacy plaintext inputs — it owns
    // its label + counsel + masked/reveal grammar, so it sits full-width below the grid
    // (not in the 1fr 1fr grid, never beside a plaintext twin). Hydrated after render().
    if (window.VendorSecureId) {
      html += '<div style="margin-top:14px;">' + window.VendorSecureId.host(selectedVendorId, 'taxId', v) + '</div>';
      html += '<div style="margin-top:14px;">' + window.VendorSecureId.host(selectedVendorId, 'accountNumber', v) + '</div>';
    }
    html += '<div class="form-group" style="margin-top:14px;"><label for="vendNotes">Notes</label><textarea id="vendNotes" rows="2">' + esc(v.notes || '') + '</textarea></div>';
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">';
    html += '<button class="btn btn-secondary" onclick="window.procurementCancelVendorEdit()">Cancel</button>';
    html += '<button class="btn btn-primary" onclick="window.procurementSaveVendor()">Save</button>';
    html += '</div></div>';
    return html;
  }

  function renderVendorProducts(v) {
    var rows = Object.values(productSuppliersData).filter(function(ps) {
      return ps.vendorId === v.vendorId && ps.active !== false;
    });
    rows.sort(function(a, b) { return (a.vendorSku || '').localeCompare(b.vendorSku || ''); });
    if (rows.length === 0) {
      return '<div style="padding:30px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark);border-radius:10px;">No products linked to this vendor.</div>';
    }
    var html = '<div style="border:1px solid var(--cream-dark);border-radius:10px;overflow:hidden;background:var(--surface-card);">';
    html += '<div style="display:grid;grid-template-columns:1.3fr 1.5fr 0.6fr 0.6fr 0.7fr 0.7fr 1fr;gap:10px;padding:10px 16px;background:rgba(42,124,111,0.06);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);border-bottom:1px solid var(--cream-dark);">' +
      '<span>Vendor SKU</span><span>Target</span><span>UoM</span><span>MOQ</span><span>Lead</span><span>Cost</span><span>Trend</span>' +
    '</div>';
    rows.forEach(function(ps, i) {
      var targetLabel = ps.vendorDescription ||
        (ps.targetKind === 'material' ? (materialsData[ps.targetId] && materialsData[ps.targetId].name) || ps.targetId : ps.targetId);
      html += '<div style="display:grid;grid-template-columns:1.3fr 1.5fr 0.6fr 0.6fr 0.7fr 0.7fr 1fr;gap:10px;padding:10px 16px;align-items:center;font-size:0.85rem;color:var(--text);' +
        (i < rows.length - 1 ? 'border-bottom:1px solid var(--cream-dark);' : '') + '">' +
        '<span style="font-family:monospace;font-weight:600;">' + esc(ps.vendorSku || '—') + '</span>' +
        '<span>' + esc(targetLabel) + (ps.preferred ? ' <span style="background:rgba(42,124,111,0.16);color:var(--teal);padding:1px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;margin-left:4px;">preferred</span>' : '') + '</span>' +
        '<span>' + esc(ps.unitOfMeasure || '—') + '</span>' +
        '<span style="font-family:monospace;">' + (ps.moq != null ? ps.moq : '—') + '</span>' +
        '<span style="font-family:monospace;">' + (ps.leadTimeDays != null ? ps.leadTimeDays + 'd' : '—') + '</span>' +
        '<span style="font-family:monospace;font-weight:600;">' + fmt$(ps.unitCost) + '</span>' +
        '<span>' + priceSparkline(ps.priceHistory) +
          (Array.isArray(ps.priceHistory) && ps.priceHistory.length > 1
            ? ' <span style="font-size:0.72rem;opacity:0.7;">' + ps.priceHistory.length + ' obs</span>'
            : '') +
        '</span>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderVendorPos(v) {
    var rows = Object.values(purchaseOrdersData).filter(function(po) { return po.vendorId === v.vendorId; });
    rows.sort(function(a, b) { return (b.orderDate || b.createdAt || '').localeCompare(a.orderDate || a.createdAt || ''); });
    if (rows.length === 0) {
      return '<div style="padding:30px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark);border-radius:10px;">No POs to this vendor.</div>';
    }
    var html = '<div style="border:1px solid var(--cream-dark);border-radius:10px;overflow:hidden;background:var(--surface-card);">';
    html += '<div style="display:grid;grid-template-columns:1.2fr 0.9fr 0.9fr 0.9fr 0.9fr;gap:10px;padding:10px 16px;background:rgba(42,124,111,0.06);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);border-bottom:1px solid var(--cream-dark);">' +
      '<span>PO #</span><span>Status</span><span>Ordered</span><span>Expected</span><span style="text-align:right;">Total</span>' +
    '</div>';
    rows.forEach(function(po, i) {
      html += '<div style="display:grid;grid-template-columns:1.2fr 0.9fr 0.9fr 0.9fr 0.9fr;gap:10px;padding:10px 16px;align-items:center;font-size:0.85rem;color:var(--text);' +
        (i < rows.length - 1 ? 'border-bottom:1px solid var(--cream-dark);' : '') + '">' +
        '<span style="font-family:monospace;font-weight:600;">' + esc(po.poNumber || po.poId.slice(0, 8)) + '</span>' +
        '<span>' + statusBadge(po.status) + '</span>' +
        '<span>' + fmtDate(po.orderDate) + '</span>' +
        '<span>' + fmtDate(po.expectedDate) + '</span>' +
        '<span style="text-align:right;font-family:monospace;font-weight:600;">' + fmt$(poTotal(po)) + '</span>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderVendorReceipts(v) {
    var poIds = Object.values(purchaseOrdersData).filter(function(po) { return po.vendorId === v.vendorId; }).map(function(p) { return p.poId; });
    var rows = Object.values(purchaseReceiptsData).filter(function(r) { return poIds.indexOf(r.poId) >= 0; });
    rows.sort(function(a, b) { return (b.receivedAt || '').localeCompare(a.receivedAt || ''); });
    if (rows.length === 0) {
      return '<div style="padding:30px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark);border-radius:10px;">No receipts from this vendor.</div>';
    }
    var html = '<div style="display:flex;flex-direction:column;gap:8px;">';
    rows.forEach(function(r) {
      var po = purchaseOrdersData[r.poId] || {};
      var rLines = r.lines || [];
      var rValue = rLines.reduce(function(s, l) { return s + (Number(l.qtyReceivedNow) || 0) * (Number(l.unitCostHomeCurrency) || 0); }, 0);
      html += '<div id="proc-receipt-' + esc(r.receiptId) + '" style="padding:12px 16px;border:1px solid var(--cream-dark);border-radius:8px;background:var(--surface-card);font-size:0.85rem;color:var(--text);display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;">' +
        '<div>' +
        '<span>' + fmtDate(r.receivedAt) +
        ' · <span style="font-family:monospace;">' + esc(po.poNumber || r.poId.slice(0, 8)) + '</span>' +
        (r.vendorInvoiceRef ? ' · ' + esc(r.vendorInvoiceRef) : '') +
        ' · ' + rLines.length + (rLines.length === 1 ? ' line' : ' lines') +
        (r.landedCostsApplied ? ' · <span style="color:var(--teal);">landed costs applied</span>' : '') +
        paymentBadge(r) +
        '</span>' +
        paymentLine(r) +
        '</div>' +
        '<span style="font-family:monospace;flex-shrink:0;">' + fmt$(rValue) + '</span>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ============================================================
  // Lot detail view
  // ============================================================

  function renderLotDetail() {
    var lot = (selectedLotKind === 'material' ? materialLotsData : productLotsData)[selectedLotId];
    if (!lot) {
      return '<div style="padding:40px;text-align:center;">Lot not found. ' +
        '<button class="btn btn-secondary btn-small" onclick="window.procurementBackFromDetail()">Back</button></div>';
    }
    var backLabel = (window.MastNavStack && MastNavStack.label()) ? '← Back to ' + MastNavStack.label() : '← Back to Procurement';
    var matName = selectedLotKind === 'material'
      ? ((materialsData[lot.targetId] && materialsData[lot.targetId].name) || lot.targetId)
      : lot.targetId;
    var vendor = vendorsData[lot.vendorId] || {};
    var receipt = lot.receiptId ? purchaseReceiptsData[lot.receiptId] : null;
    var po = receipt ? purchaseOrdersData[receipt.poId] : null;

    var html = '<button class="detail-back" onclick="window.procurementBackFromDetail()">' + esc(backLabel) + '</button>';
    html += '<div style="margin-bottom:18px;">';
    html += '<h2 style="margin:0;font-size:1.6rem;">Lot ' + esc(lot.lotNumber || lot.lotId.slice(0, 8)) + '</h2>';
    html += '<div style="font-size:0.85rem;color:var(--text);opacity:0.72;margin-top:4px;">' + esc(matName) + ' · ' + esc(selectedLotKind) + '</div>';
    html += '</div>';

    function row(label, value) {
      return '<dt style="font-size:0.78rem;color:var(--text);opacity:0.72;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">' + esc(label) + '</dt>' +
             '<dd style="margin:0;color:var(--text);">' + value + '</dd>';
    }
    html += '<div style="padding:18px 22px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);margin-bottom:14px;">';
    html += '<dl style="display:grid;grid-template-columns:160px 1fr;gap:8px 20px;margin:0;font-size:0.85rem;">';
    html += row('Received',     '<span style="font-family:monospace;">' + (lot.qtyReceived || 0) + '</span>');
    html += row('Remaining',    '<span style="font-family:monospace;font-weight:600;">' + (lot.qtyRemaining || 0) + '</span>');
    html += row('Unit cost',    '<span style="font-family:monospace;">' + fmt$(lot.unitCost) +
      (typeof lot.unitCostOriginal === 'number' && lot.unitCostOriginal !== lot.unitCost
        ? ' <span style="opacity:0.65;">(was ' + fmt$(lot.unitCostOriginal) + ' before landed costs)</span>'
        : '') + '</span>');
    if (lot.currency) html += row('Currency', esc(lot.currency));
    html += row('Received date', fmtDate(lot.receivedAt));
    if (lot.expiresAt) html += row('Expires', fmtDate(lot.expiresAt));
    if (vendor.name) html += row('Vendor', esc(vendor.name));
    if (po) html += row('PO', '<span style="font-family:monospace;">' + esc(po.poNumber || po.poId.slice(0, 8)) + '</span>');
    if (receipt) html += row('Receipt', '<span style="font-family:monospace;">' + esc(receipt.vendorInvoiceRef || receipt.receiptId.slice(0, 8)) + '</span>' + ' · ' + fmtDate(receipt.receivedAt));
    if (typeof lot.owned === 'boolean') html += row('Ownership', lot.owned ? 'Owned' : 'On memo / consignment');
    if (lot.attrs && Object.keys(lot.attrs).length) {
      var attrParts = Object.keys(lot.attrs).map(function(k) { return esc(k) + ': ' + esc(String(lot.attrs[k])); });
      html += row('Attributes', attrParts.join(' · '));
    }
    html += '</dl></div>';

    if (lot.notes) {
      html += '<div style="padding:14px 22px;border:1px solid var(--cream-dark);border-radius:10px;background:var(--surface-card);margin-bottom:14px;">' +
        '<div style="font-size:0.78rem;color:var(--text);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;margin-bottom:8px;opacity:0.72;">Audit / notes</div>' +
        '<pre style="margin:0;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;color:var(--text);white-space:pre-wrap;">' + esc(lot.notes) + '</pre>' +
      '</div>';
    }
    return html;
  }

  // ============================================================
  // Write actions — Vendor CRUD + Cancel PO
  // ============================================================

  function openNewVendorModal() {
    if (typeof openModal !== 'function') return;
    var html = '<div style="max-width:560px;padding:24px;">' +
      '<h3 style="margin:0 0 14px 0;">New Vendor</h3>' +
      '<div class="form-group"><label for="nvName">Name (required)</label><input id="nvName" type="text"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
        '<div class="form-group"><label for="nvCode">Vendor code</label><input id="nvCode" type="text" placeholder="STULLER"></div>' +
        '<div class="form-group"><label for="nvContactName">Contact name</label><input id="nvContactName" type="text"></div>' +
        '<div class="form-group"><label for="nvEmail">Email</label><input id="nvEmail" type="email"></div>' +
        '<div class="form-group"><label for="nvPhone">Phone</label><input id="nvPhone" type="tel"></div>' +
        '<div class="form-group"><label for="nvWebsite">Website</label><input id="nvWebsite" type="url"></div>' +
        '<div class="form-group"><label for="nvCurrency">Default currency</label><input id="nvCurrency" type="text" placeholder="USD"></div>' +
        '<div class="form-group"><label for="nvTerms">Payment terms</label><input id="nvTerms" type="text" placeholder="net-30"></div>' +
        '<div class="form-group"><label for="nvLead">Default lead time (days)</label><input id="nvLead" type="number" min="0"></div>' +
      '</div>' +
      '<div class="form-group"><label for="nvNotes">Notes</label><textarea id="nvNotes" rows="2"></textarea></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="window.procurementSaveNewVendor()">Create</button>' +
      '</div></div>';
    openModal(html);
    setTimeout(function() { var el = document.getElementById('nvName'); if (el) el.focus(); }, 50);
  }

  async function saveNewVendor() {
    var name = (document.getElementById('nvName').value || '').trim();
    if (!name) {
      if (typeof showToast === 'function') showToast('Name is required', true);
      return;
    }
    var lead = (document.getElementById('nvLead').value || '').trim();
    var now = new Date().toISOString();
    var record = {
      name: name,
      legalName: null,
      vendorCode: (document.getElementById('nvCode').value || '').trim() || null,
      contactName: (document.getElementById('nvContactName').value || '').trim() || null,
      email: (document.getElementById('nvEmail').value || '').trim() || null,
      phone: (document.getElementById('nvPhone').value || '').trim() || null,
      addresses: [],
      defaultCurrency: (document.getElementById('nvCurrency').value || '').trim() || null,
      defaultPaymentTerms: (document.getElementById('nvTerms').value || '').trim() || null,
      defaultLeadTimeDays: lead === '' ? null : parseInt(lead, 10),
      defaultShipMethod: null,
      taxId: null,
      accountNumber: null,
      website: (document.getElementById('nvWebsite').value || '').trim() || null,
      notes: (document.getElementById('nvNotes').value || '').trim() || null,
      roleFlags: { isSupplier: true, isCustomer: false },
      active: true,
      createdAt: now,
      updatedAt: now
    };
    try {
      var vendorId = MastDB.newKey('admin/vendors');
      record.vendorId = vendorId;
      await MastDB.set('admin/vendors/' + vendorId, record);
      vendorsData[vendorId] = record;
      closeModal();
      if (typeof showToast === 'function') showToast('Vendor created');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to create vendor: ' + (err && err.message), true);
    }
  }

  function enterVendorEdit() {
    vendorEditMode = true;
    if (window.MastDirty) {
      window.MastDirty.register('procurementVendorEdit', _vendorEditIsDirty, { label: 'Vendor detail' });
    }
    render();
    setTimeout(function() {
      vendorEditSnapshot = _vendorEditSnapshotState();
      var el = document.getElementById('vendName'); if (el) el.focus();
    }, 50);
  }

  function _vendorEditSnapshotState() {
    // vendTaxId / vendAcctNumber are intentionally absent — they are now MastIntake
    // secure fields (identity-data) that persist on their own, not plaintext inputs.
    var ids = ['vendName','vendCode','vendContactName','vendEmail','vendPhone','vendWebsite','vendCurrency','vendTerms','vendLeadTime','vendShipMethod','vendNotes'];
    var snap = {};
    ids.forEach(function(id) { var el = document.getElementById(id); if (el) snap[id] = el.value || ''; });
    return snap;
  }
  function _vendorEditIsDirty() {
    if (!vendorEditSnapshot) return false;
    var cur = _vendorEditSnapshotState();
    return Object.keys(cur).some(function(k) { return cur[k] !== vendorEditSnapshot[k]; });
  }

  function cancelVendorEdit() {
    function doCancel() {
      vendorEditMode = false;
      vendorEditSnapshot = null;
      if (window.MastDirty) MastDirty.unregister('procurementVendorEdit');
      render();
    }
    if (window.MastDirty && MastDirty.getDirtyKeys && MastDirty.getDirtyKeys().indexOf('procurementVendorEdit') !== -1) {
      MastDirty.checkAndExit(doCancel);
    } else {
      doCancel();
    }
  }

  async function saveVendor() {
    var v = vendorsData[selectedVendorId];
    if (!v) return;
    var name = (document.getElementById('vendName').value || '').trim();
    if (!name) {
      if (typeof showToast === 'function') showToast('Name is required', true);
      return;
    }
    var leadStr = (document.getElementById('vendLeadTime').value || '').trim();
    var updates = {
      name: name,
      vendorCode: (document.getElementById('vendCode').value || '').trim() || null,
      contactName: (document.getElementById('vendContactName').value || '').trim() || null,
      email: (document.getElementById('vendEmail').value || '').trim() || null,
      phone: (document.getElementById('vendPhone').value || '').trim() || null,
      website: (document.getElementById('vendWebsite').value || '').trim() || null,
      defaultCurrency: (document.getElementById('vendCurrency').value || '').trim() || null,
      defaultPaymentTerms: (document.getElementById('vendTerms').value || '').trim() || null,
      defaultLeadTimeDays: leadStr === '' ? null : parseInt(leadStr, 10),
      defaultShipMethod: (document.getElementById('vendShipMethod').value || '').trim() || null,
      // taxId / accountNumber are no longer written here — they are encrypted at rest
      // via the MastIntake secure fields, which persist their own Ref/Masked pointers.
      notes: (document.getElementById('vendNotes').value || '').trim() || null,
      updatedAt: new Date().toISOString()
    };
    try {
      await MastDB.update('admin/vendors/' + selectedVendorId, updates);
      Object.assign(v, updates);
      vendorsData[selectedVendorId] = v;
      vendorEditSnapshot = _vendorEditSnapshotState(); // baseline now matches saved state
      if (typeof showToast === 'function') showToast('Vendor saved');
      render(); // stay in edit mode (Paradigm A)
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to save vendor: ' + (err && err.message), true);
    }
  }

  async function archiveVendor() {
    if (typeof window.mastConfirm !== 'function') return;
    var ok = await window.mastConfirm('Archive this vendor? Existing POs and history are preserved; the vendor stops appearing in the active list.');
    if (!ok) return;
    try {
      await MastDB.update('admin/vendors/' + selectedVendorId, { active: false, updatedAt: new Date().toISOString() });
      vendorsData[selectedVendorId].active = false;
      if (typeof showToast === 'function') showToast('Vendor archived');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to archive: ' + (err && err.message), true);
    }
  }

  async function cancelPo(poId) {
    if (typeof window.mastConfirm !== 'function') return;
    var po = purchaseOrdersData[poId];
    if (!po) return;
    var ok = await window.mastConfirm('Cancel ' + (po.poNumber || 'this PO') + '? This sets status to cancelled and locks further edits.');
    if (!ok) return;
    var now = new Date().toISOString();
    var note = '[cancelled ' + now + ']';
    var nextNotes = po.notes ? po.notes + '\n' + note : note;
    try {
      await MastDB.update('admin/purchaseOrders/' + poId, { status: 'cancelled', notes: nextNotes, updatedAt: now });
      po.status = 'cancelled';
      po.notes = nextNotes;
      if (typeof showToast === 'function') showToast('PO cancelled');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to cancel: ' + (err && err.message), true);
    }
  }

  // ============================================================
  // Write actions — New PO + Record Receipt + Apply Landed Costs
  // ============================================================
  //
  // Multi-doc writes use MastDB.multiUpdate where atomicity matters
  // (record_receipt creates a receipt + lots + updates PO line rollup +
  // status in one atomic write). Logic mirrors the procurement.ts MCP
  // tool implementations — same Firebase paths, same field shape, same
  // derived-state rules.

  // ----------- + New PO -----------

  // Per-modal builder state. Each "+ Add Line" appends to this and
  // re-renders the form. Cleared when the modal closes.
  var newPoLines = [];

  function openNewPoModal() {
    if (typeof openModal !== 'function') return;
    newPoLines = [_blankPoLine()];
    openModal(_renderNewPoModal());
    setTimeout(function() { var el = document.getElementById('npVendor'); if (el) el.focus(); }, 50);
  }
  function _blankPoLine() {
    return { kind: 'material', targetId: '', qtyOrdered: 1, unitCost: 0, vendorSku: '', unitOfMeasure: '', variantKey: '' };
  }
  // Product picker cell for a PO line: a product <select> plus, when the chosen
  // product has variants, a required variant <select> (stable variant id). A
  // single-variant / no-variant product resolves to '_default' at save. Both
  // controls are wrapped in one <div> so the modal grid keeps one cell per line.
  function _productLineCell(line, idx, products) {
    var prodOptions = '<option value="">— product —</option>' + products.map(function(e) {
      return '<option value="' + esc(e[0]) + '"' + (line.targetId === e[0] ? ' selected' : '') + '>' + esc(e[1].name || e[0]) + '</option>';
    }).join('');
    var html = '<div>' +
      '<select style="width:100%;" onchange="window.procurementUpdateNewPoLineRerender(' + idx + ',\'targetId\',this.value)">' + prodOptions + '</select>';
    var prod = line.targetId ? productsData[line.targetId] : null;
    var variants = (prod && Array.isArray(prod.variants)) ? prod.variants : [];
    if (variants.length > 0) {
      var vOptions = '<option value="">— variant (required) —</option>' + variants.map(function(v) {
        var vid = v.id || '';
        var vname = v.name || (v.combo ? Object.values(v.combo).join(' / ') : vid);
        return '<option value="' + esc(vid) + '"' + (line.variantKey === vid ? ' selected' : '') + '>' + esc(vname) + '</option>';
      }).join('');
      html += '<select style="width:100%;margin-top:4px;" onchange="window.procurementUpdateNewPoLineRerender(' + idx + ',\'variantKey\',this.value)">' + vOptions + '</select>';
    }
    return html + '</div>';
  }
  function _renderNewPoModal() {
    var vendors = Object.values(vendorsData).filter(function(v) { return v.active !== false; });
    vendors.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    var html = '<div style="max-width:760px;padding:24px;">' +
      '<h3 style="margin:0 0 14px 0;">New Purchase Order</h3>';
    if (vendors.length === 0) {
      html += '<div style="padding:16px;border:1px dashed var(--cream-dark);border-radius:8px;color:var(--text);opacity:0.8;">No vendors yet. Create one first via Vendors → + New Vendor.</div>' +
        '<div style="display:flex;justify-content:flex-end;margin-top:14px;"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div></div>';
      return html;
    }
    html += '<div style="display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:10px;">' +
      '<div class="form-group"><label for="npVendor">Vendor (required)</label>' +
        '<select id="npVendor">' +
          vendors.map(function(v) { return '<option value="' + esc(v.vendorId) + '">' + esc(v.name) + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="form-group"><label for="npNumber">PO #</label><input id="npNumber" type="text" placeholder="PO-2026-003"></div>' +
      '<div class="form-group"><label for="npOrdered">Order date</label><input id="npOrdered" type="date" value="' + (new Date().toISOString().slice(0, 10)) + '"></div>' +
      '<div class="form-group"><label for="npExpected">Expected date</label><input id="npExpected" type="date"></div>' +
    '</div>';
    html += '<div class="form-group"><label for="npNotes">Notes</label><input id="npNotes" type="text"></div>';
    // Lines
    html += '<div style="margin-top:10px;font-size:0.85rem;font-weight:600;color:var(--text);">Lines</div>';
    html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;overflow:hidden;background:var(--surface-card);margin-top:6px;">';
    html += '<div style="display:grid;grid-template-columns:1fr 2fr 1fr 0.8fr 0.8fr 30px;gap:8px;padding:8px 12px;background:rgba(42,124,111,0.06);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);border-bottom:1px solid var(--cream-dark);">' +
      '<span>Kind</span><span>Material/Product</span><span>Vendor SKU / UoM</span><span>Qty</span><span>Unit cost</span><span></span>' +
    '</div>';
    var materials = Object.entries(materialsData).filter(function(e) { return e[1].status !== 'archived'; })
      .sort(function(a, b) { return (a[1].name || '').localeCompare(b[1].name || ''); });
    var products = Object.entries(productsData).filter(function(e) { return e[1] && e[1].status !== 'archived'; })
      .sort(function(a, b) { return (a[1].name || '').localeCompare(b[1].name || ''); });
    newPoLines.forEach(function(line, idx) {
      var matOptions = '<option value="">—</option>' + materials.map(function(e) {
        return '<option value="' + esc(e[0]) + '"' + (line.targetId === e[0] ? ' selected' : '') + '>' + esc(e[1].name) + '</option>';
      }).join('');
      html += '<div style="display:grid;grid-template-columns:1fr 2fr 1fr 0.8fr 0.8fr 30px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--cream-dark);align-items:center;">' +
        '<select onchange="window.procurementUpdateNewPoLineRerender(' + idx + ',\'kind\',this.value)">' +
          '<option value="material"' + (line.kind === 'material' ? ' selected' : '') + '>material</option>' +
          '<option value="product"' + (line.kind === 'product' ? ' selected' : '') + '>product</option>' +
        '</select>' +
        (line.kind === 'material'
          ? '<select onchange="window.procurementUpdateNewPoLine(' + idx + ',\'targetId\',this.value)">' + matOptions + '</select>'
          : _productLineCell(line, idx, products)) +
        '<input type="text" placeholder="SKU / UoM" value="' + esc(line.vendorSku || line.unitOfMeasure || '') + '" oninput="window.procurementUpdateNewPoLine(' + idx + ',\'vendorSku\',this.value)">' +
        '<input type="number" min="0" step="0.01" value="' + (line.qtyOrdered || 0) + '" oninput="window.procurementUpdateNewPoLine(' + idx + ',\'qtyOrdered\',parseFloat(this.value)||0)">' +
        '<input type="number" min="0" step="0.01" value="' + (line.unitCost || 0) + '" oninput="window.procurementUpdateNewPoLine(' + idx + ',\'unitCost\',parseFloat(this.value)||0)">' +
        '<button class="btn btn-secondary btn-small" style="padding:4px 8px;" onclick="window.procurementRemoveNewPoLine(' + idx + ')" title="Remove">×</button>' +
      '</div>';
    });
    html += '</div>';
    html += '<button class="btn btn-secondary btn-small" style="margin-top:10px;" onclick="window.procurementAddNewPoLine()">+ Add line</button>';
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">';
    html += '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
    html += '<button class="btn btn-primary" onclick="window.procurementSaveNewPo()">Create PO</button>';
    html += '</div></div>';
    return html;
  }
  function updateNewPoLine(idx, field, value) {
    if (!newPoLines[idx]) return;
    newPoLines[idx][field] = value;
  }
  // Setter that re-renders the modal — needed when a change alters which controls
  // show: switching kind swaps material↔product inputs; choosing a product
  // reveals/hides its variant select. Resets dependent fields so a stale targetId
  // or variantKey can't carry across a kind/product switch.
  function updateNewPoLineRerender(idx, field, value) {
    if (!newPoLines[idx]) return;
    newPoLines[idx][field] = value;
    if (field === 'kind') { newPoLines[idx].targetId = ''; newPoLines[idx].variantKey = ''; }
    if (field === 'targetId') { newPoLines[idx].variantKey = ''; }
    var el = document.getElementById('modalContent');
    if (el) el.innerHTML = _renderNewPoModal();
  }
  function addNewPoLine() {
    newPoLines.push(_blankPoLine());
    document.getElementById('modalContent').innerHTML = _renderNewPoModal();
  }
  function removeNewPoLine(idx) {
    newPoLines.splice(idx, 1);
    if (newPoLines.length === 0) newPoLines.push(_blankPoLine());
    document.getElementById('modalContent').innerHTML = _renderNewPoModal();
  }
  async function saveNewPo() {
    var vendorId = (document.getElementById('npVendor') || {}).value;
    if (!vendorId) {
      if (typeof showToast === 'function') showToast('Pick a vendor', true);
      return;
    }
    var vendor = vendorsData[vendorId];
    // Validate every line + ensure target exists.
    var validLines = [];
    for (var i = 0; i < newPoLines.length; i++) {
      var l = newPoLines[i];
      if (!l.targetId || !(l.qtyOrdered > 0)) continue;
      if (l.kind === 'material' && !materialsData[l.targetId]) {
        if (typeof showToast === 'function') showToast('Line ' + (i + 1) + ': material not found', true);
        return;
      }
      if (l.kind === 'product') {
        var prod = productsData[l.targetId];
        if (!prod) {
          if (typeof showToast === 'function') showToast('Line ' + (i + 1) + ': product not found', true);
          return;
        }
        // A product with variants must have one chosen — receiving credits a
        // specific variant's stock, never a silent _default fallback.
        if (Array.isArray(prod.variants) && prod.variants.length > 0 && !l.variantKey) {
          if (typeof showToast === 'function') showToast('Line ' + (i + 1) + ': pick a variant', true);
          return;
        }
      }
      validLines.push(l);
    }
    if (validLines.length === 0) {
      if (typeof showToast === 'function') showToast('Add at least one line with target + qty > 0', true);
      return;
    }
    var poId = MastDB.newKey('admin/purchaseOrders');
    var now = new Date().toISOString();
    var lines = validLines.map(function(l) {
      var lineId = MastDB.newKey('admin/purchaseOrders');
      var uom = null;
      // For materials, prefer the material's declared UoM.
      if (l.kind === 'material' && materialsData[l.targetId]) uom = materialsData[l.targetId].unitOfMeasure || null;
      // variantKey: product lines resolve to a chosen variant id or '_default'
      // (single/no-variant products); material lines carry null. This is what
      // the receiving Cloud Function reads to credit the right stock entry.
      var variantKey = null, descr = null;
      if (l.kind === 'product') {
        var prod = productsData[l.targetId] || {};
        variantKey = l.variantKey || '_default';
        var vName = '';
        if (l.variantKey && Array.isArray(prod.variants)) {
          var vm = prod.variants.filter(function(v) { return v.id === l.variantKey; })[0];
          if (vm) vName = ' — ' + (vm.name || (vm.combo ? Object.values(vm.combo).join(' / ') : l.variantKey));
        }
        descr = (prod.name || l.targetId) + vName;
      } else if (l.kind === 'material' && materialsData[l.targetId]) {
        descr = materialsData[l.targetId].name || null;
      }
      return {
        lineId: lineId,
        kind: l.kind,
        targetId: l.targetId,
        variantKey: variantKey,
        vendorSku: l.vendorSku || null,
        descriptionSnapshot: descr,
        qtyOrdered: l.qtyOrdered,
        unitOfMeasure: uom,
        unitCost: l.unitCost || 0,
        discount: null,
        tax: null,
        qtyReceived: 0,
        qtyCancelled: 0,
        expectedDate: null,
        acquisitionTarget: l.kind === 'material' ? 'build-material' : null
      };
    });
    var orderDate = (document.getElementById('npOrdered') || {}).value || null;
    var expectedDate = (document.getElementById('npExpected') || {}).value || null;
    var record = {
      poId: poId,
      poNumber: ((document.getElementById('npNumber') || {}).value || '').trim() || null,
      vendorId: vendorId,
      status: 'draft',
      orderDate: orderDate,
      expectedDate: expectedDate,
      shipToLocationId: null,
      currency: vendor && vendor.defaultCurrency || null,
      fxRateAtPo: null,
      subtotal: null, tax: null, shipping: null, total: null,
      paymentTerms: vendor && vendor.defaultPaymentTerms || null,
      notes: ((document.getElementById('npNotes') || {}).value || '').trim() || null,
      vendorMessage: null, createdBy: null, approvedBy: null, incoterm: null,
      dropShip: false, dropShipCustomerId: null, memo: false,
      lines: lines,
      createdAt: now,
      updatedAt: now
    };
    try {
      await MastDB.set('admin/purchaseOrders/' + poId, record);
      purchaseOrdersData[poId] = record;
      newPoLines = [];
      closeModal();
      if (typeof showToast === 'function') showToast('PO created (draft)');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to create PO: ' + (err && err.message), true);
    }
  }

  // ----------- Record Receipt -----------

  var receiveDraft = null; // { poId, lines: [{poLineId, qtyReceivedNow, unitCostHomeCurrency, lotNumber}], invoiceRef, additionalCosts }

  function openRecordReceiptModal(poId) {
    if (typeof openModal !== 'function') return;
    var po = purchaseOrdersData[poId];
    if (!po) return;
    receiveDraft = {
      poId: poId,
      lines: (po.lines || []).map(function(l) {
        var outstanding = (Number(l.qtyOrdered) || 0) - (Number(l.qtyReceived) || 0);
        return {
          poLineId: l.lineId,
          qtyReceivedNow: outstanding > 0 ? outstanding : 0,
          unitCostHomeCurrency: '',
          lotNumber: ''
        };
      }),
      invoiceRef: '',
      receivedAt: new Date().toISOString().slice(0, 10),
      addlLabel: '',
      addlAmount: ''
    };
    openModal(_renderRecordReceiptModal());
    setTimeout(function() { var el = document.getElementById('rrInvoice'); if (el) el.focus(); }, 50);
  }
  function _renderRecordReceiptModal() {
    var po = purchaseOrdersData[receiveDraft.poId];
    var v = vendorsData[po.vendorId] || {};
    var html = '<div style="max-width:760px;padding:24px;">' +
      '<h3 style="margin:0 0 4px 0;">Record Receipt</h3>' +
      '<div style="font-size:0.85rem;color:var(--text);opacity:0.7;margin-bottom:14px;">' + esc(po.poNumber || po.poId.slice(0, 8)) + ' · ' + esc(v.name || '—') + '</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">' +
      '<div class="form-group"><label for="rrReceived">Received date</label><input id="rrReceived" type="date" value="' + esc(receiveDraft.receivedAt) + '"></div>' +
      '<div class="form-group"><label for="rrInvoice">Vendor invoice #</label><input id="rrInvoice" type="text"></div>' +
    '</div>';
    html += '<div style="margin-top:8px;font-size:0.85rem;font-weight:600;color:var(--text);">Lines</div>';
    html += '<div style="border:1px solid var(--cream-dark);border-radius:8px;overflow:hidden;background:var(--surface-card);margin-top:6px;">';
    html += '<div style="display:grid;grid-template-columns:2fr 0.8fr 1fr 1fr 1.2fr;gap:8px;padding:8px 12px;background:rgba(42,124,111,0.06);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);border-bottom:1px solid var(--cream-dark);">' +
      '<span>Target</span><span>Outstanding</span><span>Receive now</span><span>Unit cost (override)</span><span>Lot #</span>' +
    '</div>';
    (po.lines || []).forEach(function(l, idx) {
      var draft = receiveDraft.lines[idx];
      var outstanding = (Number(l.qtyOrdered) || 0) - (Number(l.qtyReceived) || 0);
      var targetLabel = l.descriptionSnapshot ||
        (l.kind === 'material' ? (materialsData[l.targetId] && materialsData[l.targetId].name) || l.targetId : l.targetId);
      html += '<div style="display:grid;grid-template-columns:2fr 0.8fr 1fr 1fr 1.2fr;gap:8px;padding:8px 12px;border-bottom:1px solid var(--cream-dark);align-items:center;font-size:0.85rem;">' +
        '<span>' + esc(targetLabel) + '</span>' +
        '<span style="font-family:monospace;">' + outstanding + (l.unitOfMeasure ? ' ' + esc(l.unitOfMeasure) : '') + '</span>' +
        '<input type="number" min="0" max="' + outstanding + '" step="0.01" value="' + (draft.qtyReceivedNow || 0) + '" oninput="window.procurementUpdateReceiveLine(' + idx + ',\'qtyReceivedNow\',parseFloat(this.value)||0)">' +
        '<input type="number" min="0" step="0.01" placeholder="' + (Number(l.unitCost) || 0).toFixed(2) + '" value="' + (draft.unitCostHomeCurrency || '') + '" oninput="window.procurementUpdateReceiveLine(' + idx + ',\'unitCostHomeCurrency\',this.value)">' +
        '<input type="text" placeholder="LOT-…" value="' + esc(draft.lotNumber || '') + '" oninput="window.procurementUpdateReceiveLine(' + idx + ',\'lotNumber\',this.value)">' +
      '</div>';
    });
    html += '</div>';
    // Additional costs (single-row capture for simplicity; full multi-row UI deferred)
    html += '<div style="margin-top:14px;font-size:0.85rem;font-weight:600;color:var(--text);">Additional costs (optional)</div>';
    html += '<div style="display:grid;grid-template-columns:1fr 0.8fr;gap:10px;">' +
      '<div class="form-group"><label for="rrAddlLabel">Label (e.g. freight)</label><input id="rrAddlLabel" type="text"></div>' +
      '<div class="form-group"><label for="rrAddlAmount">Amount ($)</label><input id="rrAddlAmount" type="number" min="0" step="0.01"></div>' +
    '</div>' +
    '<div style="font-size:0.78rem;color:var(--text);opacity:0.65;margin-top:-4px;">Captured here; allocate via "Apply landed" once received.</div>';
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">';
    html += '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>';
    html += '<button class="btn btn-primary" onclick="window.procurementSaveReceipt()">Record</button>';
    html += '</div></div>';
    return html;
  }
  function updateReceiveLine(idx, field, value) {
    if (!receiveDraft || !receiveDraft.lines[idx]) return;
    receiveDraft.lines[idx][field] = value;
  }
  // ── receipt write core (split out of saveReceipt) ─────────────────────
  //
  // saveReceipt() reads the receive-form DOM, then calls _buildReceiptWrite
  // (pure: builds the multiUpdate + receipt/lots/PO-status/price-history) and
  // _commitReceiptWrite (atomic write + QBO best-effort + local cache refresh).
  // ProcurementBridge.receive() calls the SAME two cores from a data object,
  // so the receive flow has ONE write path (mirrors saveStudent→buildStudentFields
  // /writeStudent and saveGallery→_writeGalleryRecord). Domain logic — receipt
  // shape, lot materialization, PO-status derivation, AP handoff, supplier
  // priceHistory — lives ONLY here and is byte-for-byte the original saveReceipt
  // body; the only change is the source of `receivedAt/invoiceRef/addl*/receiveLines`
  // (DOM vs object). No business-logic change.

  // input: { receivedAt (ISO string), invoiceRef (string|null), addlLabel (string),
  //          addlAmount (number|NaN), receiveLines: [{poLineId, qtyReceivedNow,
  //          unitCostHomeCurrency, lotNumber (string|null), _line }] }
  // returns { receiptId, receipt, updates, generatedLots, nextLines, nextStatus }
  function _buildReceiptWrite(po, input) {
    var receivedAt = input.receivedAt;
    var invoiceRef = input.invoiceRef;
    var addlLabel = input.addlLabel;
    var addlAmount = input.addlAmount;
    var receiveLines = input.receiveLines;

    var now = new Date().toISOString();
    var receiptId = MastDB.newKey('admin/purchaseReceipts');
    var updates = {};
    var generatedLots = [];

    // Materialize lots + record receipt lines.
    var receiptRecordLines = receiveLines.map(function(rl) {
      var lotPath = rl._line.kind === 'material' ? 'admin/materialLots' : 'admin/productLots';
      var lotId = MastDB.newKey(lotPath);
      generatedLots.push({ kind: rl._line.kind, lotId: lotId });
      var lot = {
        lotId: lotId,
        kind: rl._line.kind,
        targetId: rl._line.targetId,
        // Product lots record which variant they stocked (null for materials),
        // mirroring the PO line so lot history is traceable to a variant.
        variantKey: rl._line.kind === 'product' ? (rl._line.variantKey || '_default') : null,
        lotNumber: rl.lotNumber,
        vendorId: po.vendorId,
        receiptId: receiptId,
        qtyReceived: rl.qtyReceivedNow,
        qtyRemaining: rl.qtyReceivedNow,
        unitCost: rl.unitCostHomeCurrency,
        currency: po.currency || null,
        receivedAt: receivedAt,
        expiresAt: null,
        attrs: null,
        consumptionRule: null,
        owned: po.memo === true ? false : true,
        ownershipDate: po.memo === true ? null : receivedAt,
        notes: null,
        createdAt: now,
        updatedAt: now
      };
      updates[lotPath + '/' + lotId] = lot;
      return {
        poLineId: rl.poLineId,
        qtyReceivedNow: rl.qtyReceivedNow,
        unitCostHomeCurrency: rl.unitCostHomeCurrency,
        lotId: lotId,
        notes: null
      };
    });

    var additionalCosts = [];
    if (addlLabel && addlAmount > 0) {
      additionalCosts.push({ label: addlLabel, amount: addlAmount, currency: po.currency || null, allocationMethod: 'value' });
    }

    // Compute Finance AP handoff fields.
    var linesCostTotal = receiveLines.reduce(function(s, rl) { return s + (rl.qtyReceivedNow * rl.unitCostHomeCurrency); }, 0);
    var addlCostTotal = additionalCosts.reduce(function(s, c) { return s + (Number(c.amount) || 0); }, 0);
    var amountCents = Math.round((linesCostTotal + addlCostTotal) * 100);

    var dueDateBase = new Date(receivedAt);
    var terms = (po.paymentTerms || '').toLowerCase().replace(/-/g, '').replace(/\s+/g, '');
    var dueDays = 30;
    if (!terms || terms === 'due_on_receipt' || terms === 'dueonreceipt') { dueDays = 0; }
    else if (terms === 'net15') { dueDays = 15; }
    else if (terms === 'net30') { dueDays = 30; }
    else if (terms === 'net45') { dueDays = 45; }
    else if (terms === 'net60') { dueDays = 60; }
    else { var netMatch = terms.match(/(\d+)/); if (netMatch) dueDays = parseInt(netMatch[1], 10); }
    dueDateBase.setDate(dueDateBase.getDate() + dueDays);
    var dueDate = dueDateBase.toISOString().slice(0, 10);

    var receipt = {
      receiptId: receiptId,
      poId: po.poId,
      vendorId: po.vendorId,
      receivedAt: receivedAt,
      receivedBy: null,
      vendorInvoiceRef: invoiceRef,
      fxRateAtReceipt: null,
      lines: receiptRecordLines,
      additionalCosts: additionalCosts,
      notes: null,
      createdAt: now,
      paymentStatus: 'unpaid',
      amountCents: amountCents,
      dueDate: dueDate
    };
    updates['admin/purchaseReceipts/' + receiptId] = receipt;

    // Recompute PO line qtyReceived from all receipts (existing + new).
    var allReceipts = Object.values(purchaseReceiptsData).concat([receipt]);
    var sumByLine = {};
    allReceipts.forEach(function(r) {
      if (r.poId !== po.poId) return;
      (r.lines || []).forEach(function(rl) {
        sumByLine[rl.poLineId] = (sumByLine[rl.poLineId] || 0) + (Number(rl.qtyReceivedNow) || 0);
      });
    });
    var nextLines = (po.lines || []).map(function(l) {
      return Object.assign({}, l, { qtyReceived: sumByLine[l.lineId] || 0 });
    });
    var allMet = nextLines.length > 0 && nextLines.every(function(l) { return (l.qtyReceived || 0) >= (l.qtyOrdered || 0); });
    var anyReceived = nextLines.some(function(l) { return (l.qtyReceived || 0) > 0; });
    var nextStatus = po.status;
    if (po.status !== 'cancelled' && po.status !== 'closed') {
      if (allMet) nextStatus = 'received';
      else if (anyReceived) nextStatus = 'partially_received';
    }
    updates['admin/purchaseOrders/' + po.poId + '/lines'] = nextLines;
    updates['admin/purchaseOrders/' + po.poId + '/status'] = nextStatus;
    updates['admin/purchaseOrders/' + po.poId + '/updatedAt'] = now;

    // Append to ProductSupplier priceHistory for matching (vendorId, kind, targetId).
    Object.entries(productSuppliersData).forEach(function(entry) {
      var psId = entry[0], ps = entry[1];
      if (ps.vendorId !== po.vendorId) return;
      receiveLines.forEach(function(rl) {
        if (ps.targetKind !== rl._line.kind || ps.targetId !== rl._line.targetId) return;
        if (!(rl.unitCostHomeCurrency > 0)) return;
        var nextHistory = (ps.priceHistory || []).concat([{
          unitCost: rl.unitCostHomeCurrency,
          currency: ps.currency || null,
          recordedAt: now,
          source: 'receipt',
          ref: receiptId
        }]);
        updates['admin/productSuppliers/' + psId + '/priceHistory'] = nextHistory;
        updates['admin/productSuppliers/' + psId + '/unitCost'] = rl.unitCostHomeCurrency;
        updates['admin/productSuppliers/' + psId + '/updatedAt'] = now;
      });
    });

    return { receiptId: receiptId, receipt: receipt, updates: updates, generatedLots: generatedLots, nextLines: nextLines, nextStatus: nextStatus, now: now };
  }

  // Atomic write + QBO best-effort + local-cache refresh. UNCHANGED from the
  // original saveReceipt tail except: throws on failure (callers own the toast)
  // and does NOT touch the receive-form modal / re-render (those are caller UI).
  async function _commitReceiptWrite(po, built) {
    var updates = built.updates, receipt = built.receipt, receiptId = built.receiptId, generatedLots = built.generatedLots;
    await MastDB.multiUpdate(updates);
    // W1 final wire (Accounting Idea -OtKxQEhTDampnjEBjvS): new AP bill
    // (purchaseReceipt) → QBO push (best-effort).
    try {
      if (typeof firebase !== 'undefined' && firebase.functions) {
        var _trigger = firebase.functions().httpsCallable('triggerQboPush');
        _trigger({ tid: MastDB.tenantId(), entityType: 'apBill', mastId: receiptId })
          .catch(function(e) { console.warn('[qbo-push] apBill trigger failed:', e && e.message); });
      }
    } catch (_e) { console.warn('[qbo-push] apBill trigger error:', _e && _e.message); }
    // Local cache refresh
    purchaseReceiptsData[receiptId] = receipt;
    generatedLots.forEach(function(g) {
      var lot = updates[(g.kind === 'material' ? 'admin/materialLots' : 'admin/productLots') + '/' + g.lotId];
      if (g.kind === 'material') materialLotsData[g.lotId] = lot;
      else productLotsData[g.lotId] = lot;
    });
    po.lines = built.nextLines;
    po.status = built.nextStatus;
    po.updatedAt = built.now;
    return built;
  }

  async function saveReceipt() {
    if (!receiveDraft) return;
    var po = purchaseOrdersData[receiveDraft.poId];
    if (!po) return;
    // Read DOM (single-source for invoice / receivedAt / addl)
    var receivedAt = ((document.getElementById('rrReceived') || {}).value || receiveDraft.receivedAt) + 'T00:00:00.000Z';
    var invoiceRef = ((document.getElementById('rrInvoice') || {}).value || '').trim() || null;
    var addlLabel = ((document.getElementById('rrAddlLabel') || {}).value || '').trim();
    var addlAmount = parseFloat((document.getElementById('rrAddlAmount') || {}).value || '');
    // Collect non-zero lines (resolve unit-cost override → number here, in the DOM reader)
    var receiveLines = [];
    (po.lines || []).forEach(function(l, idx) {
      var d = receiveDraft.lines[idx];
      var qty = Number(d.qtyReceivedNow) || 0;
      if (!(qty > 0)) return;
      var unitOverride = parseFloat(d.unitCostHomeCurrency);
      var unitCost = (!isNaN(unitOverride) && unitOverride > 0) ? unitOverride : (Number(l.unitCost) || 0);
      receiveLines.push({
        poLineId: l.lineId,
        qtyReceivedNow: qty,
        unitCostHomeCurrency: unitCost,
        lotNumber: (d.lotNumber || '').trim() || null,
        _line: l
      });
    });
    if (receiveLines.length === 0) {
      if (typeof showToast === 'function') showToast('Enter at least one qty > 0', true);
      return;
    }
    var built = _buildReceiptWrite(po, { receivedAt: receivedAt, invoiceRef: invoiceRef, addlLabel: addlLabel, addlAmount: addlAmount, receiveLines: receiveLines });
    try {
      await _commitReceiptWrite(po, built);
      receiveDraft = null;
      closeModal();
      if (typeof showToast === 'function') showToast('Receipt recorded · ' + MastFormat.countNoun(built.generatedLots.length, 'lot') + ' created');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to record receipt: ' + (err && err.message), true);
    }
  }

  // ----------- Apply Landed Costs -----------

  async function applyLandedCosts(receiptId) {
    var receipt = purchaseReceiptsData[receiptId];
    if (!receipt) return;
    if (receipt.landedCostsApplied) {
      if (typeof showToast === 'function') showToast('Already applied', true);
      return;
    }
    if (typeof window.mastConfirm !== 'function') return;
    var addlTotal = (receipt.additionalCosts || []).reduce(function(s, c) { return s + (Number(c.amount) || 0); }, 0);
    if (!(addlTotal > 0)) {
      if (typeof showToast === 'function') showToast('No additional costs on this receipt', true);
      return;
    }
    var ok = await window.mastConfirm('Allocate $' + addlTotal.toFixed(2) + ' across the lots from this receipt? Each lot\'s unitCost is bumped by its share. Use Revert from the MCP if you need to redo.');
    if (!ok) return;

    // Compute value-based shares (matches the procurement.ts default).
    var lines = receipt.lines || [];
    var lineValues = lines.map(function(l) { return (Number(l.qtyReceivedNow) || 0) * (Number(l.unitCostHomeCurrency) || 0); });
    var totalValue = lineValues.reduce(function(s, v) { return s + v; }, 0);
    if (!(totalValue > 0)) {
      if (typeof showToast === 'function') showToast('Receipt has zero value — cannot allocate by value', true);
      return;
    }

    var po = purchaseOrdersData[receipt.poId];
    var lineKindByLineId = {};
    if (po && Array.isArray(po.lines)) po.lines.forEach(function(l) { lineKindByLineId[l.lineId] = l.kind; });

    var updates = {};
    var now = new Date().toISOString();
    var perLine = lines.map(function(l, i) {
      var alloc = (lineValues[i] / totalValue) * addlTotal;
      var perUnit = (Number(l.qtyReceivedNow) || 0) > 0 ? alloc / Number(l.qtyReceivedNow) : 0;
      return {
        poLineId: l.poLineId, lotId: l.lotId,
        unitCostBefore: Number(l.unitCostHomeCurrency) || 0,
        totalAllocated: alloc, perUnitAllocation: perUnit,
        unitCostAfter: (Number(l.unitCostHomeCurrency) || 0) + perUnit,
        perCost: (receipt.additionalCosts || []).map(function(c) {
          return { label: c.label, method: c.allocationMethod || 'value', allocated: ((lineValues[i] / totalValue) * (Number(c.amount) || 0)) };
        })
      };
    });
    perLine.forEach(function(pl) {
      if (!pl.lotId) return;
      var kind = lineKindByLineId[pl.poLineId];
      if (!kind) return;
      var lotPath = (kind === 'material' ? 'admin/materialLots' : 'admin/productLots') + '/' + pl.lotId;
      var lot = (kind === 'material' ? materialLotsData : productLotsData)[pl.lotId];
      if (!lot) return;
      var unitCostOriginal = typeof lot.unitCostOriginal === 'number' ? lot.unitCostOriginal : lot.unitCost;
      updates[lotPath + '/unitCostOriginal'] = unitCostOriginal;
      updates[lotPath + '/unitCost'] = pl.unitCostAfter;
      updates[lotPath + '/updatedAt'] = now;
      // local cache
      lot.unitCostOriginal = unitCostOriginal;
      lot.unitCost = pl.unitCostAfter;
      lot.updatedAt = now;
    });
    updates['admin/purchaseReceipts/' + receiptId + '/landedCostsApplied'] = true;
    updates['admin/purchaseReceipts/' + receiptId + '/landedCostAllocation'] = { appliedAt: now, perLine: perLine };
    receipt.landedCostsApplied = true;
    receipt.landedCostAllocation = { appliedAt: now, perLine: perLine };

    try {
      await MastDB.multiUpdate(updates);
      if (typeof showToast === 'function') showToast('Landed costs allocated across ' + MastFormat.countNoun(perLine.length, 'lot'));
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to apply: ' + (err && err.message), true);
    }
  }

  // ============================================================
  // Public API
  // ============================================================

  window.procurementSwitchTab = function(tab) {
    currentTab = tab;
    expandedPoId = null;
    render();
  };
  window.procurementSetPoFilter = function(value) {
    poStatusFilter = value;
    expandedPoId = null;
    render();
  };
  window.procurementToggleExpand = function(poId) {
    expandedPoId = expandedPoId === poId ? null : poId;
    render();
  };
  window.procurementToggleEmptyLots = function() {
    lotsShowEmpty = !lotsShowEmpty;
    render();
  };

  window.procurementOpenVendor = function(vendorId) {
    if (window.MastNavStack) {
      MastNavStack.push({
        route: 'procurement',
        view: 'vendor-detail',
        state: { vendorId: vendorId, scrollTop: window.scrollY || 0, fromTab: currentTab },
        label: 'Procurement'
      });
    }
    selectedVendorId = vendorId;
    currentView = 'vendor-detail';
    vendorDetailTab = 'products';
    vendorEditMode = false;
    render();
  };
  window.procurementOpenLot = function(kind, lotId) {
    if (window.MastNavStack) {
      MastNavStack.push({
        route: 'procurement',
        view: 'lot-detail',
        state: { lotKind: kind, lotId: lotId, scrollTop: window.scrollY || 0, fromTab: currentTab },
        label: 'Procurement'
      });
    }
    selectedLotKind = kind;
    selectedLotId = lotId;
    currentView = 'lot-detail';
    render();
  };
  window.procurementBackFromDetail = function() {
    function doBack() {
      currentView = 'index';
      selectedVendorId = null;
      selectedLotId = null;
      vendorEditMode = false;
      vendorEditSnapshot = null;
      if (window.MastDirty) MastDirty.unregister('procurementVendorEdit');
      if (window.MastNavStack && MastNavStack.size && MastNavStack.size() > 0) {
        MastNavStack.popAndReturn();
      } else {
        render();
      }
    }
    if (window.MastDirty && MastDirty.getDirtyKeys && MastDirty.getDirtyKeys().indexOf('procurementVendorEdit') !== -1) {
      MastDirty.checkAndExit(doBack);
    } else {
      doBack();
    }
  };
  // Bridge for the vendors-v2 redesign twin (flag-gated #vendors-v2). It delegates
  // create/update here so the vendor write (admin/vendors/{id} + roleFlags + active
  // + lead-time coercion) stays single-sourced — the twin never reimplements that
  // logic. Additive; no behavior change to the legacy surface. These mirror the
  // EXACT client writes saveNewVendor()/saveVendor() make, parameterized by data
  // (the legacy handlers read the DOM, so they can't be called with an object).
  // Mirrors window.ContactsBridge.
  window.VendorsBridge = {
    create: async function (data) {
      var lead = (data.defaultLeadTimeDays == null ? '' : String(data.defaultLeadTimeDays)).trim();
      var now = new Date().toISOString();
      var record = {
        name: (data.name || '').trim(),
        legalName: null,
        vendorCode: data.vendorCode || null,
        contactName: data.contactName || null,
        email: data.email || null,
        phone: data.phone || null,
        addresses: [],
        defaultCurrency: data.defaultCurrency || null,
        defaultPaymentTerms: data.defaultPaymentTerms || null,
        defaultLeadTimeDays: lead === '' ? null : parseInt(lead, 10),
        defaultShipMethod: data.defaultShipMethod || null,
        // taxId / accountNumber are PII encrypted at rest via MastIntake — the V2
        // editor's secure fields persist taxIdRef/accountNumberRef on their own; the
        // create path never seeds plaintext here (a new vendor saves first, then the
        // secure field attaches to its stable id).
        website: data.website || null,
        notes: data.notes || null,
        roleFlags: { isSupplier: true, isCustomer: false },
        active: true,
        createdAt: now,
        updatedAt: now
      };
      var vendorId = MastDB.newKey('admin/vendors');
      record.vendorId = vendorId;
      await MastDB.set('admin/vendors/' + vendorId, record);
      vendorsData[vendorId] = record;
      return vendorId;
    },
    update: async function (id, data) {
      var lead = (data.defaultLeadTimeDays == null ? '' : String(data.defaultLeadTimeDays)).trim();
      var updates = {
        name: (data.name || '').trim(),
        vendorCode: data.vendorCode || null,
        contactName: data.contactName || null,
        email: data.email || null,
        phone: data.phone || null,
        website: data.website || null,
        defaultCurrency: data.defaultCurrency || null,
        defaultPaymentTerms: data.defaultPaymentTerms || null,
        defaultLeadTimeDays: lead === '' ? null : parseInt(lead, 10),
        defaultShipMethod: data.defaultShipMethod || null,
        // taxId / accountNumber omitted — encrypted at rest via MastIntake (the V2
        // editor's secure fields persist their own Ref/Masked pointers). A partial
        // update never overwrites those refs with stale plaintext.
        notes: data.notes || null,
        updatedAt: new Date().toISOString()
      };
      await MastDB.update('admin/vendors/' + id, updates);
      if (vendorsData[id]) Object.assign(vendorsData[id], updates);
      return id;
    },
    // setVendorActive(id, active) → archive / unarchive a vendor (Tier 1.5 P5).
    // V2 owns the confirm; this is the bare write. Preserves all history.
    setVendorActive: async function (id, active) {
      if (!id) throw new Error('vendor id required');
      var now = new Date().toISOString();
      await MastDB.update('admin/vendors/' + id, { active: !!active, updatedAt: now });
      if (vendorsData[id]) { vendorsData[id].active = !!active; vendorsData[id].updatedAt = now; }
      return id;
    },
    // ── Product-supplier (vendor↔item pricing link) CRUD — Tier 1.5 P4 ──────
    // No legacy UI existed (links were read-only embeds; the only write was the
    // receipt priceHistory append). These are the V2 write path for the
    // vendors-v2 Supplies pane. admin/productSuppliers/{psId}. Setting preferred
    // clears the preferred flag on sibling links for the same item (one
    // preferred supplier per item — what the reorder queue resolves).
    createSupply: async function (data) {
      data = data || {};
      if (!data.vendorId || !data.targetId || !data.targetKind) throw new Error('vendor, item, and kind are required');
      var now = new Date().toISOString();
      var psId = MastDB.newKey('admin/productSuppliers');
      var record = {
        psId: psId, vendorId: data.vendorId, targetKind: data.targetKind, targetId: data.targetId,
        vendorSku: data.vendorSku || null, vendorDescription: data.vendorDescription || null,
        unitOfMeasure: data.unitOfMeasure || null,
        moq: (data.moq == null || data.moq === '') ? null : Number(data.moq),
        leadTimeDays: (data.leadTimeDays == null || data.leadTimeDays === '') ? null : parseInt(data.leadTimeDays, 10),
        unitCost: (data.unitCost == null || data.unitCost === '') ? null : Number(data.unitCost),
        currency: data.currency || null,
        preferred: !!data.preferred,
        priceHistory: [], active: true, createdAt: now, updatedAt: now
      };
      var updates = {}; updates['admin/productSuppliers/' + psId] = record;
      if (record.preferred) _clearSiblingPreferred(data.targetKind, data.targetId, psId, updates, now);
      await MastDB.multiUpdate(updates);
      productSuppliersData[psId] = record; _applyPreferredCache(updates);
      return psId;
    },
    updateSupply: async function (psId, data) {
      if (!psId) throw new Error('supplier link id required');
      data = data || {};
      var now = new Date().toISOString();
      var updates = {}; var ps = productSuppliersData[psId] || {};
      var fieldUpd = { updatedAt: now };
      ['vendorSku', 'vendorDescription', 'unitOfMeasure', 'currency'].forEach(function (k) { if (k in data) fieldUpd[k] = data[k] || null; });
      if ('moq' in data) fieldUpd.moq = (data.moq == null || data.moq === '') ? null : Number(data.moq);
      if ('leadTimeDays' in data) fieldUpd.leadTimeDays = (data.leadTimeDays == null || data.leadTimeDays === '') ? null : parseInt(data.leadTimeDays, 10);
      if ('unitCost' in data) fieldUpd.unitCost = (data.unitCost == null || data.unitCost === '') ? null : Number(data.unitCost);
      if ('preferred' in data) fieldUpd.preferred = !!data.preferred;
      Object.keys(fieldUpd).forEach(function (k) { updates['admin/productSuppliers/' + psId + '/' + k] = fieldUpd[k]; });
      if (fieldUpd.preferred === true) _clearSiblingPreferred(ps.targetKind, ps.targetId, psId, updates, now);
      await MastDB.multiUpdate(updates);
      if (productSuppliersData[psId]) Object.assign(productSuppliersData[psId], fieldUpd);
      _applyPreferredCache(updates);
      return psId;
    },
    archiveSupply: async function (psId) {
      if (!psId) throw new Error('supplier link id required');
      var now = new Date().toISOString();
      await MastDB.update('admin/productSuppliers/' + psId, { active: false, updatedAt: now });
      if (productSuppliersData[psId]) { productSuppliersData[psId].active = false; productSuppliersData[psId].updatedAt = now; }
      return psId;
    }
  };
  // Clear preferred on sibling supplier links for the same item (one preferred
  // per item). Adds field-path writes to `updates`; caller commits via multiUpdate.
  function _clearSiblingPreferred(kind, tid, keepId, updates, now) {
    Object.keys(productSuppliersData).forEach(function (id) {
      if (id === keepId) return;
      var ps = productSuppliersData[id];
      if (ps && ps.active !== false && ps.preferred && ps.targetKind === kind && ps.targetId === tid) {
        updates['admin/productSuppliers/' + id + '/preferred'] = false;
        updates['admin/productSuppliers/' + id + '/updatedAt'] = now;
      }
    });
  }
  function _applyPreferredCache(updates) {
    Object.keys(updates).forEach(function (path) {
      var m = path.match(/^admin\/productSuppliers\/([^/]+)\/preferred$/);
      if (m && productSuppliersData[m[1]]) productSuppliersData[m[1]].preferred = updates[path];
    });
  }

  window.procurementVendorTab = function(t) { vendorDetailTab = t; render(); };
  window.procurementEnterVendorEdit  = enterVendorEdit;
  window.procurementCancelVendorEdit = cancelVendorEdit;
  window.procurementSaveVendor       = saveVendor;
  window.procurementArchiveVendor    = archiveVendor;
  window.procurementOpenNewVendor    = openNewVendorModal;
  window.procurementSaveNewVendor    = saveNewVendor;
  window.procurementCancelPo         = cancelPo;

  window.procurementOpenNewPo        = openNewPoModal;
  window.procurementUpdateNewPoLine  = updateNewPoLine;
  window.procurementUpdateNewPoLineRerender = updateNewPoLineRerender;
  window.procurementAddNewPoLine     = addNewPoLine;
  window.procurementRemoveNewPoLine  = removeNewPoLine;
  window.procurementSaveNewPo        = saveNewPo;

  window.procurementOpenRecordReceipt = openRecordReceiptModal;
  window.procurementUpdateReceiveLine = updateReceiveLine;
  window.procurementSaveReceipt       = saveReceipt;

  window.procurementApplyLandedCosts  = applyLandedCosts;

  // ============================================================
  // ProcurementBridge — data-object entry to the SAME write cores
  // ============================================================
  //
  // The procurement-v2 redesign twin (flag-gated #procurement-v2) is read-focused
  // and must NOT reimplement the receive/cancel domain logic. This bridge exposes
  // those write actions parameterized by data (the legacy handlers read the form
  // DOM, so they can't be called with an object). It mirrors window.StudentsBridge
  // / window.GalleriesBridge: thin, additive, delegates to the shared cores
  // (_buildReceiptWrite + _commitReceiptWrite for receive; cancelPo for cancel).
  // It changes NO behavior on the legacy surface.

  function _ensureLoaded() {
    // The write cores compute against the in-memory caches (purchaseReceiptsData
    // for PO-status rollup, productSuppliersData for priceHistory). When the twin
    // drives the flow, legacy loadAll() may not have run — ensure it has so the
    // derived writes are computed against real data, exactly like the legacy path.
    return dataLoaded ? Promise.resolve() : Promise.resolve(loadAll());
  }

  window.ProcurementBridge = {
    // receive(poId, lines, meta?) → resolves to the new receiptId.
    //   lines: [{ poLineId, qtyReceivedNow, unitCostOverride?, lotNumber? }]
    //   meta:  { receivedAt? (YYYY-MM-DD), invoiceRef?, addlLabel?, addlAmount? }
    // Normalizes the same way the receive-form DOM reader (saveReceipt) does:
    // unit-cost override > 0 wins else the PO line's unitCost; date → ISO; then
    // runs the shared build + commit cores. No business-logic fork.
    receive: async function (poId, lines, meta) {
      await _ensureLoaded();
      var po = purchaseOrdersData[poId];
      if (!po) throw new Error('Purchase order not found');
      meta = meta || {};
      var dateStr = (meta.receivedAt || new Date().toISOString().slice(0, 10));
      var receivedAt = dateStr + 'T00:00:00.000Z';
      var invoiceRef = (meta.invoiceRef || '').trim() || null;
      var addlLabel = (meta.addlLabel || '').trim();
      var addlAmount = parseFloat(meta.addlAmount);
      var byLineId = {};
      (po.lines || []).forEach(function (l) { byLineId[l.lineId] = l; });
      var receiveLines = [];
      (lines || []).forEach(function (d) {
        var l = byLineId[d.poLineId];
        if (!l) return;
        var qty = Number(d.qtyReceivedNow) || 0;
        if (!(qty > 0)) return;
        var unitOverride = parseFloat(d.unitCostOverride);
        var unitCost = (!isNaN(unitOverride) && unitOverride > 0) ? unitOverride : (Number(l.unitCost) || 0);
        receiveLines.push({
          poLineId: l.lineId,
          qtyReceivedNow: qty,
          unitCostHomeCurrency: unitCost,
          lotNumber: (d.lotNumber || '').trim() || null,
          _line: l
        });
      });
      if (receiveLines.length === 0) throw new Error('Enter at least one qty > 0');
      var built = _buildReceiptWrite(po, { receivedAt: receivedAt, invoiceRef: invoiceRef, addlLabel: addlLabel, addlAmount: addlAmount, receiveLines: receiveLines });
      await _commitReceiptWrite(po, built);
      return built.receiptId;
    },
    // cancel(poId) → wraps the existing cancelPo (confirm + status:cancelled
    // write). cancelPo owns its own mastConfirm + cache update + legacy render;
    // the twin reloads its own data afterward.
    cancel: function (poId) {
      return _ensureLoaded().then(function () { return cancelPo(poId); });
    },
    // applyLandedCosts(receiptId) → wraps the legacy applyLandedCosts (Tier 1.5
    // P3). It owns its own mastConfirm + value-based allocation across the
    // receipt's lots + writes; the V2 caller reloads its own data afterward.
    applyLandedCosts: function (receiptId) {
      return _ensureLoaded().then(function () { return applyLandedCosts(receiptId); });
    },
    // send(poId, { subject, html }) → the "send to vendor" write for the
    // Draft→Ordered transition (Work Item B). Stamps sentAt + status='submitted'
    // and, when the vendor has an email, queues the PO document on emailQueue
    // (the type-agnostic email-queue-processor sends it). Atomic multiUpdate.
    // Returns { emailed }. Phase follows via procurement-v2's reconcile-on-open.
    send: async function (poId, opts) {
      await _ensureLoaded();
      var po = purchaseOrdersData[poId];
      if (!po) throw new Error('Purchase order not found');
      opts = opts || {};
      var now = new Date().toISOString();
      var vendor = vendorsData[po.vendorId] || {};
      var updates = {};
      updates['admin/purchaseOrders/' + poId + '/sentAt'] = now;
      updates['admin/purchaseOrders/' + poId + '/updatedAt'] = now;
      if (po.status === 'draft') updates['admin/purchaseOrders/' + poId + '/status'] = 'submitted';
      var emailed = false;
      if (vendor.email && opts.html) {
        var qKey = MastDB.newKey('emailQueue');
        updates['emailQueue/' + qKey] = {
          id: qKey,
          type: 'purchase_order',
          to: vendor.email,
          subject: opts.subject || ('Purchase Order ' + (po.poNumber || poId)),
          htmlBody: opts.html,
          status: 'queued',
          attemptCount: 0,
          idempotencyKey: 'po-send-' + poId + '-' + now,
          queuedAt: now
        };
        emailed = true;
      }
      await MastDB.multiUpdate(updates);
      po.sentAt = now; po.updatedAt = now;
      if (po.status === 'draft') po.status = 'submitted';
      return { emailed: emailed };
    },
    // createDraftPOs(groups) → create one DRAFT PO per vendor group from reorder
    // suggestions (Work Item D). groups: [{ vendorId, lines: [{ kind, targetId,
    // variantKey?, qtyOrdered, unitCost, vendorSku?, unitOfMeasure?,
    // descriptionSnapshot? }] }]. Mirrors the New-PO write shape (status:'draft').
    // Returns the created poIds. Keeps the PO-creation write in this baselined
    // module so the reorder twin holds no MastDB write verbs (RBAC).
    createDraftPOs: async function (groups) {
      await _ensureLoaded();
      var now = new Date().toISOString();
      var updates = {};
      var created = [];
      (groups || []).forEach(function (g) {
        if (!g || !g.vendorId || !g.lines || !g.lines.length) return;
        var vendor = vendorsData[g.vendorId] || {};
        var poId = MastDB.newKey('admin/purchaseOrders');
        var lines = g.lines.map(function (l) {
          return {
            lineId: MastDB.newKey('admin/purchaseOrders'),
            kind: l.kind,
            targetId: l.targetId,
            variantKey: l.kind === 'product' ? (l.variantKey || '_default') : null,
            vendorSku: l.vendorSku || null,
            descriptionSnapshot: l.descriptionSnapshot || null,
            qtyOrdered: Number(l.qtyOrdered) || 0,
            unitOfMeasure: l.unitOfMeasure || null,
            unitCost: Number(l.unitCost) || 0,
            discount: null, tax: null, qtyReceived: 0, qtyCancelled: 0, expectedDate: null,
            acquisitionTarget: l.kind === 'material' ? 'build-material' : null
          };
        });
        var rec = {
          poId: poId, poNumber: null, vendorId: g.vendorId, status: 'draft',
          orderDate: now.slice(0, 10), expectedDate: null, shipToLocationId: null,
          currency: vendor.defaultCurrency || null, fxRateAtPo: null,
          subtotal: null, tax: null, shipping: null, total: null,
          paymentTerms: vendor.defaultPaymentTerms || null,
          notes: 'Auto-drafted from reorder suggestions', vendorMessage: null,
          createdBy: null, approvedBy: null, incoterm: null,
          dropShip: false, dropShipCustomerId: null, memo: false,
          lines: lines, createdAt: now, updatedAt: now
        };
        updates['admin/purchaseOrders/' + poId] = rec;
        created.push(poId);
      });
      if (created.length) {
        await MastDB.multiUpdate(updates);
        created.forEach(function (poId) { purchaseOrdersData[poId] = updates['admin/purchaseOrders/' + poId]; });
      }
      return created;
    },
    // createPO(data) → create a single DRAFT purchase order (Tier 1.5 P1, the V2
    // "New PO" create form's write). data: { vendorId, poNumber?, orderDate?,
    // expectedDate?, notes?, lines: [{ kind, targetId, variantKey?, qtyOrdered,
    // unitCost?, vendorSku?, unitOfMeasure?, descriptionSnapshot? }] }. Mirrors
    // the legacy saveNewPo write shape; returns the new poId. Keeps PO creation
    // in this baselined module so the V2 twin holds no MastDB write verbs (RBAC).
    createPO: async function (data) {
      await _ensureLoaded();
      data = data || {};
      if (!data.vendorId) throw new Error('Vendor is required');
      var vendor = vendorsData[data.vendorId] || {};
      var validLines = (data.lines || []).filter(function (l) { return l && l.targetId && Number(l.qtyOrdered) > 0; });
      if (!validLines.length) throw new Error('Add at least one line with a target and qty > 0');
      var now = new Date().toISOString();
      var poId = MastDB.newKey('admin/purchaseOrders');
      var lines = validLines.map(function (l) {
        return {
          lineId: MastDB.newKey('admin/purchaseOrders'),
          kind: l.kind,
          targetId: l.targetId,
          variantKey: l.kind === 'product' ? (l.variantKey || '_default') : null,
          vendorSku: l.vendorSku || null,
          descriptionSnapshot: l.descriptionSnapshot || null,
          qtyOrdered: Number(l.qtyOrdered) || 0,
          unitOfMeasure: l.unitOfMeasure || null,
          unitCost: Number(l.unitCost) || 0,
          discount: null, tax: null, qtyReceived: 0, qtyCancelled: 0, expectedDate: null,
          acquisitionTarget: l.kind === 'material' ? 'build-material' : null
        };
      });
      var record = {
        poId: poId,
        poNumber: (data.poNumber || '').trim() || null,
        vendorId: data.vendorId,
        status: 'draft',
        orderDate: data.orderDate || now.slice(0, 10),
        expectedDate: data.expectedDate || null,
        shipToLocationId: null,
        currency: vendor.defaultCurrency || null, fxRateAtPo: null,
        subtotal: null, tax: null, shipping: null, total: null,
        paymentTerms: vendor.defaultPaymentTerms || null,
        notes: (data.notes || '').trim() || null, vendorMessage: null,
        createdBy: null, approvedBy: null, incoterm: null,
        dropShip: false, dropShipCustomerId: null, memo: false,
        lines: lines, createdAt: now, updatedAt: now
      };
      await MastDB.set('admin/purchaseOrders/' + poId, record);
      purchaseOrdersData[poId] = record;
      return poId;
    }
  };

  // ============================================================
  // MastNavStack restorer + module registration
  // ============================================================

  if (window.MastNavStack && typeof window.MastNavStack.registerRestorer === 'function') {
    window.MastNavStack.registerRestorer('procurement', function(entry) {
      if (!entry || !entry.state) { currentView = 'index'; render(); return; }
      var st = entry.state;
      if (st.fromTab) currentTab = st.fromTab;
      if (entry.view === 'vendor-detail' && st.vendorId) {
        selectedVendorId = st.vendorId;
        currentView = 'vendor-detail';
        vendorDetailTab = 'products';
      } else if (entry.view === 'lot-detail' && st.lotId) {
        selectedLotKind = st.lotKind || 'material';
        selectedLotId = st.lotId;
        currentView = 'lot-detail';
      } else {
        currentView = 'index';
      }
      render();
      if (typeof st.scrollTop === 'number') {
        setTimeout(function() { window.scrollTo(0, st.scrollTop); }, 0);
      }
    });
  }

  function _applyDeepLink() {
    var rid = deepLinkReceiptId;
    deepLinkReceiptId = null;
    var receipt = purchaseReceiptsData[rid];
    if (!receipt) {
      if (typeof showToast === 'function') showToast('Receipt not found', true);
      render();
      return;
    }
    var po = purchaseOrdersData[receipt.poId];
    var vendorId = (po && po.vendorId) || receipt.vendorId;
    if (!vendorId || !vendorsData[vendorId]) {
      if (typeof showToast === 'function') showToast('Vendor not found for this receipt', true);
      render();
      return;
    }
    selectedVendorId = vendorId;
    currentView = 'vendor-detail';
    vendorDetailTab = 'receipts';
    vendorEditMode = false;
    render();
    setTimeout(function() {
      var el = document.getElementById('proc-receipt-' + rid);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s';
      el.style.background = 'rgba(234,179,8,0.25)';
      setTimeout(function() {
        el.style.background = '';
        setTimeout(function() { el.style.transition = ''; }, 400);
      }, 2000);
    }, 50);
  }

  window.clearProcurementFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { active: 1, role: 1, vendorIds: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    if (typeof navigateTo === 'function') navigateTo('procurement', next);
  };

  function setup() {
    try {
      var raw = sessionStorage.getItem('procurementDeepLink');
      if (raw) {
        sessionStorage.removeItem('procurementDeepLink');
        var parsed = JSON.parse(raw);
        if (parsed && parsed.receiptId) deepLinkReceiptId = parsed.receiptId;
      }
    } catch (e) { deepLinkReceiptId = null; }

    // MCP admin links may target the vendors tab via URL filter params.
    try {
      var rp0 = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
      if (rp0 && (rp0.active || rp0.role || rp0.vendorIds)) {
        currentTab = 'vendors';
        currentView = 'index';
      }
    } catch (_e) {}

    if (!dataLoaded) {
      render();
      loadAll().then(function() {
        if (deepLinkReceiptId) { _applyDeepLink(); } else { render(); }
      });
    } else {
      if (deepLinkReceiptId) { _applyDeepLink(); } else { render(); }
    }
  }

  // ============================================================
  // Ask AI registration (MastAskAi page registry)
  // CC Idea -Os1Lrm8ShTKZMafXV4k.
  // ============================================================

  window.addEventListener('mastaskai:configchanged', function() {
    var tab = document.getElementById('procurementTab');
    if (tab && tab.style.display !== 'none' && currentView === 'index') {
      try { render(); } catch (_e) {}
    }
  });

  if (window.MastAskAi) {
    window.MastAskAi.register('procurement', {
      title: 'Ask AI about your procurement',
      placeholder: 'e.g. Which vendors am I spending the most with? Which POs are stuck submitted? What is sitting in inventory?',
      notes: [
        'Money fields are USD dollars (the procurement module uses dollars throughout, NOT cents).',
        'PO statuses: draft, submitted, partially_received, received, closed, cancelled. The "open" filter rolls up draft + submitted + partially_received.',
        'topVendorsBySpend looks at all-time PO totals across the vendor; topVendorsByOpen ranks by outstanding (open-PO) dollars.',
        'topLotsByValue is qtyRemaining × unitCost on each material lot — what is currently sitting on the shelves.',
        'lastReceiptAt is when material last entered inventory; gaps suggest a stalled supply pipeline.',
        'recentPOs lists the 15 most recent POs for context-aware questions about activity in the last few weeks.'
      ],
      buildContext: function() {
        var pos = Object.values(purchaseOrdersData);
        var lots = Object.values(materialLotsData);
        var vendors = vendorsData;

        // PO stats
        var byStatus = {}, byMonth = {}, byVendor = {};
        var totalAll = 0, totalOpen = 0;
        var openSet = { draft: true, submitted: true, partially_received: true };
        pos.forEach(function(p) {
          var t = poTotal(p);
          totalAll += t;
          var st = p.status || 'draft';
          if (!byStatus[st]) byStatus[st] = { count: 0, totalUSD: 0 };
          byStatus[st].count++; byStatus[st].totalUSD += t;
          if (openSet[st]) totalOpen += t;
          var month = (p.createdAt || p.submittedAt || '').substring(0, 7) || 'unknown';
          if (!byMonth[month]) byMonth[month] = { count: 0, totalUSD: 0 };
          byMonth[month].count++; byMonth[month].totalUSD += t;
          var vid = p.vendorId || '(unknown)';
          if (!byVendor[vid]) byVendor[vid] = { count: 0, totalUSD: 0, openTotalUSD: 0 };
          byVendor[vid].count++; byVendor[vid].totalUSD += t;
          if (openSet[st]) byVendor[vid].openTotalUSD += t;
        });
        Object.keys(byStatus).forEach(function(k) { byStatus[k].totalUSD = +byStatus[k].totalUSD.toFixed(2); });
        Object.keys(byMonth).forEach(function(k)  { byMonth[k].totalUSD  = +byMonth[k].totalUSD.toFixed(2); });

        function vendorName(id) {
          var v = vendors[id];
          return v ? (v.name || id) : id;
        }

        var topVendorsBySpend = Object.keys(byVendor)
          .map(function(id) {
            return { vendor: vendorName(id), poCount: byVendor[id].count, totalUSD: +byVendor[id].totalUSD.toFixed(2), openUSD: +byVendor[id].openTotalUSD.toFixed(2) };
          })
          .sort(function(a, b) { return b.totalUSD - a.totalUSD; })
          .slice(0, 10);

        var topVendorsByOpen = Object.keys(byVendor)
          .filter(function(id) { return byVendor[id].openTotalUSD > 0; })
          .map(function(id) {
            return { vendor: vendorName(id), openUSD: +byVendor[id].openTotalUSD.toFixed(2), poCount: byVendor[id].count };
          })
          .sort(function(a, b) { return b.openUSD - a.openUSD; })
          .slice(0, 10);

        var recentPOs = pos.slice()
          .sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); })
          .slice(0, 15)
          .map(function(p) {
            return {
              poNumber: p.poNumber || p.id || '(unknown)',
              vendor: vendorName(p.vendorId),
              status: p.status || 'draft',
              totalUSD: +poTotal(p).toFixed(2),
              createdAt: (p.createdAt || '').slice(0, 10)
            };
          });

        // Lots / inventory
        var inventoryValueUSD = 0;
        var byMaterial = {};
        lots.forEach(function(l) {
          var v = (Number(l.qtyRemaining) || 0) * (Number(l.unitCost) || 0);
          inventoryValueUSD += v;
          var matId = l.materialId || '(unknown)';
          var matName = (materialsData[matId] && materialsData[matId].name) || matId;
          if (!byMaterial[matName]) byMaterial[matName] = { lotCount: 0, totalValueUSD: 0, qtyRemaining: 0 };
          byMaterial[matName].lotCount++;
          byMaterial[matName].totalValueUSD += v;
          byMaterial[matName].qtyRemaining += (Number(l.qtyRemaining) || 0);
        });
        Object.keys(byMaterial).forEach(function(k) {
          byMaterial[k].totalValueUSD = +byMaterial[k].totalValueUSD.toFixed(2);
          byMaterial[k].qtyRemaining = +byMaterial[k].qtyRemaining.toFixed(2);
        });

        var topLotsByValue = lots.slice()
          .map(function(l) {
            var matId = l.materialId || '(unknown)';
            return {
              material: (materialsData[matId] && materialsData[matId].name) || matId,
              vendor: vendorName(l.vendorId),
              qtyRemaining: Number(l.qtyRemaining) || 0,
              unitCostUSD: Number(l.unitCost) || 0,
              valueUSD: +(((Number(l.qtyRemaining) || 0) * (Number(l.unitCost) || 0))).toFixed(2),
              receivedAt: (l.receivedAt || '').slice(0, 10)
            };
          })
          .sort(function(a, b) { return b.valueUSD - a.valueUSD; })
          .slice(0, 15);

        // Last receipt
        var receipts = Object.values(purchaseReceiptsData);
        var lastReceiptAt = null;
        receipts.forEach(function(r) {
          var t = r.receivedAt || r.createdAt;
          if (t && (!lastReceiptAt || t > lastReceiptAt)) lastReceiptAt = t;
        });

        return {
          route: '/app#procurement',
          pageTitle: 'Procurement',
          filters: {
            currentTab: currentTab,
            poStatusFilter: poStatusFilter
          },
          aggregates: {
            poCount: pos.length,
            openPoCount: pos.filter(function(p) { return openSet[p.status]; }).length,
            totalAllPosUSD: +totalAll.toFixed(2),
            totalOutstandingOpenUSD: +totalOpen.toFixed(2),
            inventoryValueUSD: +inventoryValueUSD.toFixed(2),
            lotCount: lots.length,
            vendorCount: Object.keys(vendors).length,
            lastReceiptAt: lastReceiptAt,
            byStatus: byStatus,
            byMonth: byMonth,
            byMaterial: byMaterial
          },
          topVendorsBySpend: topVendorsBySpend,
          topVendorsByOpen: topVendorsByOpen,
          topLotsByValue: topLotsByValue,
          recentPOs: recentPOs
        };
      }
    });
  }
})();
