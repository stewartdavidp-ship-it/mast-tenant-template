/**
 * Procurement Module — v1 (drill-downs + writes).
 *
 * Wraps the 5 procurement entities (Vendors, ProductSuppliers, POs,
 * Receipts, Lots) in three operational views plus drill-down detail
 * pages for vendors and lots.
 *
 * Scope shipping in this commit:
 *   - Index: KPI band + Open POs / Vendors / Inventory Lots tabs
 *   - Vendor detail view (Products / POs / Receipts sub-tabs, priceHistory
 *     sparkline per ProductSupplier row)
 *   - Lot detail view (provenance, audit trail)
 *   - MastNavStack integration for cross-screen back-nav
 *   - Keyboard accessibility: clickable rows are real <button> elements
 *   - Vendor write paths: + New, Edit (Paradigm A), Archive
 *   - PO Cancel
 *
 * Deferred to next commit:
 *   - + New PO, Record Receipt, Apply Landed Cost (multi-doc writes)
 *
 * Design system audit performed against
 * mast-architecture/docs/admin-design-system.md before writing.
 *
 * Renders entirely from JS into the empty #procurementTab container,
 * mirroring the customers / students module pattern.
 */
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

  var dataLoaded = false;
  var loadInFlight = false;

  // View navigation state. 'index' = the 3-tab landing; 'vendor-detail'
  // and 'lot-detail' are drill-downs entered via MastNavStack.
  var currentView = 'index';
  var currentTab = 'open-pos';      // open-pos | vendors | lots
  var poStatusFilter = 'open';
  var expandedPoId = null;
  var lotsShowEmpty = false;

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
      ? ' <button type="button" onclick="navigateTo(\'finance-ap\')" style="background:none;border:none;color:var(--teal);font-size:0.8rem;cursor:pointer;padding:0;font-family:inherit;text-decoration:underline;text-underline-offset:2px;">Record payment →</button>'
      : '';
    return '<div style="font-size:0.8rem;margin-top:4px;">' +
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
    return Promise.all([
      MastDB.get('admin/vendors').then(function(v) { vendorsData = v || {}; }),
      MastDB.get('admin/productSuppliers').then(function(v) { productSuppliersData = v || {}; }),
      MastDB.get('admin/purchaseOrders').then(function(v) { purchaseOrdersData = v || {}; }),
      MastDB.get('admin/purchaseReceipts').then(function(v) { purchaseReceiptsData = v || {}; }),
      MastDB.get('admin/materialLots').then(function(v) { materialLotsData = v || {}; }),
      MastDB.get('admin/productLots').then(function(v) { productLotsData = v || {}; }),
      MastDB.get('admin/materials').then(function(v) { materialsData = v || {}; })
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
    if (currentView === 'vendor-detail') { tab.innerHTML = renderVendorDetail(); return; }
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
    return '<div class="section-header" style="margin-bottom:14px;">' +
      '<h2 style="margin:0;">Procurement</h2>' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:0.85rem;color:var(--warm-gray);">Vendors, POs, receipts, and on-hand lots</span>' +
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
    var vendors = Object.values(vendorsData).filter(function(v) { return v.active !== false; });
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
    if (v.taxId)        html += row('Tax ID', esc(v.taxId));
    if (v.accountNumber) html += row('Account #', esc(v.accountNumber));
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
    html += field('vendTaxId',        'Tax ID',                v.taxId);
    html += field('vendAcctNumber',   'Account number',        v.accountNumber);
    html += '</div>';
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
      html += '<div style="padding:12px 16px;border:1px solid var(--cream-dark);border-radius:8px;background:var(--surface-card);font-size:0.85rem;color:var(--text);display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;">' +
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
    var html = '<div style="max-width:560px;">' +
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
    var ids = ['vendName','vendCode','vendContactName','vendEmail','vendPhone','vendWebsite','vendCurrency','vendTerms','vendLeadTime','vendShipMethod','vendTaxId','vendAcctNumber','vendNotes'];
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
      taxId: (document.getElementById('vendTaxId').value || '').trim() || null,
      accountNumber: (document.getElementById('vendAcctNumber').value || '').trim() || null,
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
    return { kind: 'material', targetId: '', qtyOrdered: 1, unitCost: 0, vendorSku: '', unitOfMeasure: '' };
  }
  function _renderNewPoModal() {
    var vendors = Object.values(vendorsData).filter(function(v) { return v.active !== false; });
    vendors.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    var html = '<div style="max-width:760px;">' +
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
    newPoLines.forEach(function(line, idx) {
      var matOptions = '<option value="">—</option>' + materials.map(function(e) {
        return '<option value="' + esc(e[0]) + '"' + (line.targetId === e[0] ? ' selected' : '') + '>' + esc(e[1].name) + '</option>';
      }).join('');
      html += '<div style="display:grid;grid-template-columns:1fr 2fr 1fr 0.8fr 0.8fr 30px;gap:8px;padding:8px 12px;border-bottom:1px solid var(--cream-dark);align-items:center;">' +
        '<select onchange="window.procurementUpdateNewPoLine(' + idx + ',\'kind\',this.value)">' +
          '<option value="material"' + (line.kind === 'material' ? ' selected' : '') + '>material</option>' +
          '<option value="product"' + (line.kind === 'product' ? ' selected' : '') + '>product</option>' +
        '</select>' +
        (line.kind === 'material'
          ? '<select onchange="window.procurementUpdateNewPoLine(' + idx + ',\'targetId\',this.value)">' + matOptions + '</select>'
          : '<input type="text" placeholder="product PID" value="' + esc(line.targetId) + '" oninput="window.procurementUpdateNewPoLine(' + idx + ',\'targetId\',this.value)">') +
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
      return {
        lineId: lineId,
        kind: l.kind,
        targetId: l.targetId,
        vendorSku: l.vendorSku || null,
        descriptionSnapshot: null,
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
    var html = '<div style="max-width:760px;">' +
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
  async function saveReceipt() {
    if (!receiveDraft) return;
    var po = purchaseOrdersData[receiveDraft.poId];
    if (!po) return;
    // Read DOM (single-source for invoice / receivedAt / addl)
    var receivedAt = ((document.getElementById('rrReceived') || {}).value || receiveDraft.receivedAt) + 'T00:00:00.000Z';
    var invoiceRef = ((document.getElementById('rrInvoice') || {}).value || '').trim() || null;
    var addlLabel = ((document.getElementById('rrAddlLabel') || {}).value || '').trim();
    var addlAmount = parseFloat((document.getElementById('rrAddlAmount') || {}).value || '');
    // Collect non-zero lines
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

    try {
      await MastDB.multiUpdate(updates);
      // Local cache refresh
      purchaseReceiptsData[receiptId] = receipt;
      generatedLots.forEach(function(g) {
        var lot = updates[(g.kind === 'material' ? 'admin/materialLots' : 'admin/productLots') + '/' + g.lotId];
        if (g.kind === 'material') materialLotsData[g.lotId] = lot;
        else productLotsData[g.lotId] = lot;
      });
      po.lines = nextLines;
      po.status = nextStatus;
      po.updatedAt = now;
      receiveDraft = null;
      closeModal();
      if (typeof showToast === 'function') showToast('Receipt recorded · ' + generatedLots.length + ' lot' + (generatedLots.length === 1 ? '' : 's') + ' created');
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
      if (typeof showToast === 'function') showToast('Landed costs allocated across ' + perLine.length + ' lot' + (perLine.length === 1 ? '' : 's'));
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
  window.procurementAddNewPoLine     = addNewPoLine;
  window.procurementRemoveNewPoLine  = removeNewPoLine;
  window.procurementSaveNewPo        = saveNewPo;

  window.procurementOpenRecordReceipt = openRecordReceiptModal;
  window.procurementUpdateReceiveLine = updateReceiveLine;
  window.procurementSaveReceipt       = saveReceipt;

  window.procurementApplyLandedCosts  = applyLandedCosts;

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

  function setup() {
    if (!dataLoaded) {
      render();
      loadAll().then(render);
    } else {
      render();
    }
  }

  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('procurement', {
      routes: { procurement: { tab: 'procurementTab', setup: setup } }
    });
  } else {
    console.error('[procurement] MastAdmin.registerModule not available; module did not register');
  }
})();
