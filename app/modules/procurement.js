/**
 * Procurement Module — read-only first cut.
 *
 * Wraps the 5 procurement entities (Vendors, ProductSuppliers, POs,
 * Receipts, Lots) in three operational views:
 *   - Open POs   (default landing) — what's ordered, what's coming in
 *   - Vendors    — directory + spend / lead-time / # products supplied
 *   - Inv Lots   — material lots on hand, grouped by material
 *
 * Plus a top KPI band: open POs / outstanding $ / inventory $ / last receipt.
 *
 * Read-only by design. Writes (create PO, record receipt, etc.) currently
 * happen via the tenant MCP and will layer on top of this UI later.
 *
 * Renders entirely from JS into the empty #procurementTab container,
 * mirroring the customers / students module pattern.
 *
 * No new CSS — uses existing tokens, .btn / .data-table / .loading.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var vendorsData = {};          // {vendorId: vendor}
  var productSuppliersData = {}; // {psId: ps}
  var purchaseOrdersData = {};   // {poId: po}
  var purchaseReceiptsData = {}; // {receiptId: receipt}
  var materialLotsData = {};     // {lotId: lot}
  var productLotsData = {};      // {lotId: lot}
  var materialsData = {};        // {materialId: material} — for lot grouping labels

  var dataLoaded = false;
  var loadInFlight = false;

  var currentTab = 'open-pos';   // open-pos | vendors | lots
  var poStatusFilter = 'open';   // open (= draft+submitted+partially_received) | all | <status>
  var expandedPoId = null;
  var lotsShowEmpty = false;

  // ============================================================
  // Helpers
  // ============================================================

  function esc(s) {
    return (window.esc ? window.esc(s) : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  }
  function fmt$(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Number(n).toFixed(2);
  }
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
    // Use .status-badge.pill class for shape (font-size 0.72rem, padding,
    // border-radius). Only background/color set inline, sourced from
    // tokenized colors per the design system rules.
    var bg = 'rgba(0,0,0,0.10)', color = 'var(--text)', label = status || '—';
    if (status === 'draft')                   { bg = 'rgba(0,0,0,0.10)'; color = 'var(--text)'; }
    else if (status === 'submitted')          { bg = 'rgba(0,0,0,0.18)'; color = 'var(--text)'; }
    else if (status === 'partially_received') { bg = 'rgba(196,133,60,0.30)'; color = 'var(--amber-light)'; label = 'partial'; }
    else if (status === 'received')           { bg = 'rgba(42,124,111,0.20)'; color = 'var(--teal)'; }
    else if (status === 'closed')             { bg = 'rgba(0,0,0,0.10)'; color = 'var(--text)'; }
    else if (status === 'cancelled')          { bg = 'rgba(220,38,38,0.20)'; color = 'var(--danger)'; }
    return '<span class="status-badge pill" style="background:' + bg + ';color:' + color + ';">' + esc(label) + '</span>';
  }

  function poTotal(po) {
    if (typeof po.total === 'number' && po.total > 0) return po.total;
    // Sum lines if total wasn't entered.
    var sum = 0;
    (po.lines || []).forEach(function(l) {
      sum += (Number(l.qtyOrdered) || 0) * (Number(l.unitCost) || 0);
    });
    return sum;
  }

  // ============================================================
  // Data loading — one-shot on entry, refresh on user action.
  // Matches the customer/students module pattern; no live listeners.
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
  // Render — top-level
  // ============================================================

  function render() {
    var tab = document.getElementById('procurementTab');
    if (!tab) return;
    if (!dataLoaded) {
      tab.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading procurement…</div>';
      return;
    }
    var html = '';
    html += renderHeader();
    html += renderKpiBand();
    html += renderTabBar();
    if (currentTab === 'open-pos')   html += renderOpenPosTab();
    else if (currentTab === 'vendors') html += renderVendorsTab();
    else if (currentTab === 'lots')    html += renderLotsTab();
    tab.innerHTML = html;
  }

  function renderHeader() {
    return '<div class="section-header" style="margin-bottom:14px;">' +
      '<h2 style="margin:0;">Procurement</h2>' +
      '<div style="display:flex;align-items:center;gap:12px;">' +
        '<span style="font-size:0.85rem;color:var(--warm-gray);">Read-only · vendors, POs, receipts, and on-hand lots</span>' +
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
    lots.forEach(function(l) {
      inventoryValue += (Number(l.qtyRemaining) || 0) * (Number(l.unitCost) || 0);
    });
    var receipts = Object.values(purchaseReceiptsData);
    var lastReceiptAt = null;
    receipts.forEach(function(r) {
      var t = r.receivedAt || r.createdAt;
      if (t && (!lastReceiptAt || t > lastReceiptAt)) lastReceiptAt = t;
    });
    return {
      openCount: openPos.length, openByStatus: openByStatus,
      outstanding: outstanding,
      inventoryValue: inventoryValue,
      lastReceiptAt: lastReceiptAt
    };
  }

  function renderKpiBand() {
    var k = computeKpis();
    function card(label, value, sub) {
      return '<div style="flex:1;min-width:160px;padding:14px 18px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:10px;background:var(--surface-card,#fff);">' +
        '<div style="font-size:0.78rem;color:var(--text);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;margin-bottom:6px;opacity:0.8;">' + esc(label) + '</div>' +
        '<div style="font-family:monospace;font-size:1.6rem;font-weight:700;color:var(--text);">' + value + '</div>' +
        (sub ? '<div style="font-size:0.78rem;color:var(--text);opacity:0.72;margin-top:4px;">' + sub + '</div>' : '') +
      '</div>';
    }
    var openSub = '';
    var parts = [];
    if (k.openByStatus.draft) parts.push(k.openByStatus.draft + ' draft');
    if (k.openByStatus.submitted) parts.push(k.openByStatus.submitted + ' submitted');
    if (k.openByStatus.partially_received) parts.push(k.openByStatus.partially_received + ' partial');
    if (parts.length) openSub = parts.join(' · ');
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
    // Filter pills with counts (against ALL pos, not the filtered set).
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
    filtered.sort(function(a, b) {
      var da = a.orderDate || a.createdAt || '';
      var db = b.orderDate || b.createdAt || '';
      return db.localeCompare(da);
    });

    var html = '';
    // Filter pills
    function pill(value, label, n) {
      var active = poStatusFilter === value;
      var bg = active ? 'rgba(42,124,111,0.16)' : 'transparent';
      var color = active ? 'var(--teal,#2a7c6f)' : 'var(--text)';
      var border = active ? '1px solid rgba(42,124,111,0.45)' : '1px solid var(--cream-dark,#e8e0d4)';
      return '<button onclick="window.procurementSetPoFilter(\'' + value + '\')" ' +
        'style="padding:5px 14px;background:' + bg + ';color:' + color + ';border:' + border +
        ';border-radius:14px;font-size:0.85rem;font-weight:' + (active ? '600' : '500') +
        ';cursor:pointer;margin-right:6px;font-family:\'DM Sans\',sans-serif;">' +
        esc(label) + ' <span style="opacity:0.7;font-weight:400;">(' + n + ')</span></button>';
    }
    html += '<div style="margin-bottom:14px;">';
    html += pill('open',                 'Open',          counts.open);
    html += pill('draft',                'Draft',         counts.draft);
    html += pill('submitted',            'Submitted',     counts.submitted);
    html += pill('partially_received',   'Partial',       counts.partially_received);
    html += pill('received',             'Received',      counts.received);
    html += pill('cancelled',            'Cancelled',     counts.cancelled);
    html += pill('all',                  'All',           counts.all);
    html += '</div>';

    if (filtered.length === 0) {
      html += '<div style="padding:40px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark,#e8e0d4);border-radius:10px;">' +
        'No POs match this filter. Create one via the tenant MCP — UI write paths come next.' +
      '</div>';
      return html;
    }

    // Table-shaped list, but as div rows so we can expand inline.
    html += '<div style="border:1px solid var(--cream-dark,#e8e0d4);border-radius:10px;overflow:hidden;background:var(--surface-card,#fff);">';
    // Header row
    html += '<div style="display:grid;grid-template-columns:1.2fr 1.4fr 0.8fr 0.9fr 0.8fr 0.9fr 30px;gap:12px;padding:10px 16px;background:rgba(42,124,111,0.06);font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--text);font-weight:600;border-bottom:1px solid var(--cream-dark,#e8e0d4);">' +
      '<span>PO #</span><span>Vendor</span><span>Status</span><span>Ordered</span><span>Expected</span><span style="text-align:right;">Total</span><span></span>' +
    '</div>';
    filtered.forEach(function(po, idx) {
      var v = vendorsData[po.vendorId] || {};
      var lineCount = (po.lines || []).length;
      var isExpanded = expandedPoId === po.poId;
      var rowBg = idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)';
      html += '<div style="border-bottom:' + (idx < filtered.length - 1 || isExpanded ? '1px solid var(--cream-dark,#e8e0d4)' : 'none') + ';">';
      html += '<div onclick="window.procurementToggleExpand(\'' + esc(po.poId) + '\')" style="display:grid;grid-template-columns:1.2fr 1.4fr 0.8fr 0.9fr 0.8fr 0.9fr 30px;gap:12px;align-items:center;padding:14px 16px;cursor:pointer;background:' + rowBg + ';">';
      html += '<span style="font-family:monospace;font-weight:600;color:var(--text);">' + esc(po.poNumber || po.poId.slice(0, 8)) + '</span>';
      html += '<span style="color:var(--text);">' + esc(v.name || '(unknown vendor)') + ' <span style="opacity:0.65;font-size:0.85rem;">· ' + lineCount + (lineCount === 1 ? ' line' : ' lines') + '</span></span>';
      html += '<span>' + statusBadge(po.status) + '</span>';
      html += '<span style="font-size:0.85rem;color:var(--text);">' + fmtDate(po.orderDate) + '</span>';
      html += '<span style="font-size:0.85rem;color:var(--text);">' + fmtDate(po.expectedDate) + '</span>';
      html += '<span style="text-align:right;font-family:monospace;font-weight:600;color:var(--text);">' + fmt$(poTotal(po)) + '</span>';
      html += '<span style="color:var(--teal,#2a7c6f);font-size:0.85rem;font-weight:600;">' + (isExpanded ? '▾' : '▸') + '</span>';
      html += '</div>';
      if (isExpanded) html += renderPoExpand(po);
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  function renderPoExpand(po) {
    var v = vendorsData[po.vendorId] || {};
    var html = '<div style="padding:14px 22px 18px 22px;background:rgba(42,124,111,0.025);border-top:1px solid var(--cream-dark,#e8e0d4);">';
    // Meta row
    html += '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:0.85rem;color:var(--text);margin-bottom:14px;">';
    if (po.notes) html += '<span><strong>Notes:</strong> ' + esc(po.notes) + '</span>';
    if (po.paymentTerms) html += '<span><strong>Terms:</strong> ' + esc(po.paymentTerms) + '</span>';
    if (po.currency) html += '<span><strong>Currency:</strong> ' + esc(po.currency) + '</span>';
    if (po.incoterm) html += '<span><strong>Incoterm:</strong> ' + esc(po.incoterm) + '</span>';
    if (po.dropShip) html += '<span><strong>Drop-ship</strong></span>';
    if (po.memo) html += '<span><strong>Memo</strong> (consignment-in)</span>';
    html += '</div>';

    // Lines
    var lines = po.lines || [];
    if (lines.length) {
      html += '<div style="border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;overflow:hidden;background:var(--surface-card,#fff);margin-bottom:14px;">';
      html += '<div style="display:grid;grid-template-columns:0.5fr 1.6fr 1fr 0.9fr 0.9fr 0.9fr;gap:10px;padding:8px 14px;background:rgba(42,124,111,0.06);font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);">' +
        '<span>Kind</span><span>Target</span><span>Vendor SKU</span><span>Ordered</span><span>Received</span><span style="text-align:right;">Unit</span>' +
      '</div>';
      lines.forEach(function(line, i) {
        var pct = (Number(line.qtyOrdered) || 0) > 0
          ? Math.min(100, ((Number(line.qtyReceived) || 0) / Number(line.qtyOrdered)) * 100) : 0;
        var targetLabel = line.descriptionSnapshot ||
          (line.kind === 'material' ? (materialsData[line.targetId] && materialsData[line.targetId].name) || line.targetId : line.targetId);
        var bar = '<div style="height:6px;background:rgba(0,0,0,0.06);border-radius:3px;margin-top:4px;overflow:hidden;"><div style="width:' + pct.toFixed(0) + '%;height:100%;background:var(--teal,#2a7c6f);"></div></div>';
        html += '<div style="display:grid;grid-template-columns:0.5fr 1.6fr 1fr 0.9fr 0.9fr 0.9fr;gap:10px;padding:10px 14px;align-items:center;font-size:0.85rem;color:var(--text);' + (i < lines.length - 1 ? 'border-bottom:1px solid var(--cream-dark,#e8e0d4);' : '') + '">' +
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

    // Linked receipts
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
        html += '<div style="padding:10px 14px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:8px;background:var(--surface-card,#fff);font-size:0.85rem;color:var(--text);display:flex;justify-content:space-between;gap:14px;align-items:center;flex-wrap:wrap;">' +
          '<span>' + fmtDate(r.receivedAt) +
          (r.vendorInvoiceRef ? ' · <span style="font-family:monospace;">' + esc(r.vendorInvoiceRef) + '</span>' : '') +
          ' · ' + rLines.length + (rLines.length === 1 ? ' line' : ' lines') +
          ' · ' + rQty + ' units' +
          (r.landedCostsApplied ? ' · <span style="color:var(--teal,#2a7c6f);">landed costs applied</span>' : '') +
          '</span>' +
          '<span style="font-family:monospace;">' + fmt$(rValue) + (addl > 0 ? ' <span style="opacity:0.7;">+ ' + fmt$(addl) + ' addl</span>' : '') + '</span>' +
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
  // Vendors tab
  // ============================================================

  function renderVendorsTab() {
    var vendors = Object.values(vendorsData).filter(function(v) { return v.active !== false; });
    vendors.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (vendors.length === 0) {
      return '<div style="padding:40px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark,#e8e0d4);border-radius:10px;">' +
        'No active vendors yet. Create one via the tenant MCP.' +
      '</div>';
    }

    // Pre-compute: # products per vendor, spend (received total) per vendor.
    var psByVendor = {};
    Object.values(productSuppliersData).forEach(function(ps) {
      if (ps.active === false) return;
      psByVendor[ps.vendorId] = (psByVendor[ps.vendorId] || 0) + 1;
    });
    var spendByVendor = {};
    Object.values(purchaseOrdersData).forEach(function(po) {
      if (po.status !== 'received' && po.status !== 'partially_received' && po.status !== 'closed') return;
      // Use the receipts for this PO if present (more accurate); else line totals.
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

    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;">';
    vendors.forEach(function(v) {
      var nProducts = psByVendor[v.vendorId] || 0;
      var spend = spendByVendor[v.vendorId] || 0;
      html += '<div style="padding:16px 18px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:10px;background:var(--surface-card,#fff);">' +
        '<div style="font-size:1rem;font-weight:600;color:var(--text);margin-bottom:4px;">' + esc(v.name) + '</div>' +
        (v.vendorCode ? '<div style="font-family:monospace;font-size:0.78rem;color:var(--text);opacity:0.7;margin-bottom:10px;">' + esc(v.vendorCode) + '</div>' : '<div style="margin-bottom:10px;"></div>') +
        '<div style="display:flex;flex-direction:column;gap:4px;font-size:0.85rem;color:var(--text);">' +
          (v.contactName ? '<div>' + esc(v.contactName) + '</div>' : '') +
          (v.email ? '<div style="opacity:0.85;">' + esc(v.email) + '</div>' : '') +
          (v.defaultLeadTimeDays != null ? '<div><span style="opacity:0.7;">Lead time</span> · ' + v.defaultLeadTimeDays + ' days</div>' : '') +
          (v.defaultPaymentTerms ? '<div><span style="opacity:0.7;">Terms</span> · ' + esc(v.defaultPaymentTerms) + '</div>' : '') +
          (v.defaultCurrency ? '<div><span style="opacity:0.7;">Currency</span> · ' + esc(v.defaultCurrency) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:14px;margin-top:12px;padding-top:10px;border-top:1px solid var(--cream-dark,#e8e0d4);font-size:0.85rem;">' +
          '<div><span style="opacity:0.7;">Supplies</span> <strong>' + nProducts + '</strong></div>' +
          '<div><span style="opacity:0.7;">Spend</span> <strong style="font-family:monospace;">' + fmt$(spend) + '</strong></div>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // ============================================================
  // Inventory Lots tab
  // ============================================================

  function renderLotsTab() {
    var lots = Object.values(materialLotsData);
    if (!lotsShowEmpty) lots = lots.filter(function(l) { return (Number(l.qtyRemaining) || 0) > 0; });
    if (lots.length === 0) {
      return '<div style="padding:40px;text-align:center;color:var(--text);opacity:0.7;border:1px dashed var(--cream-dark,#e8e0d4);border-radius:10px;">' +
        'No material lots yet. Lots are created when you record_purchase_receipt against a PO.' +
      '</div>';
    }
    // Group by material.
    var byMaterial = {};
    lots.forEach(function(l) {
      var key = l.targetId;
      if (!byMaterial[key]) byMaterial[key] = [];
      byMaterial[key].push(l);
    });
    var materialIds = Object.keys(byMaterial);
    materialIds.sort(function(a, b) {
      var na = (materialsData[a] && materialsData[a].name) || a;
      var nb = (materialsData[b] && materialsData[b].name) || b;
      return na.localeCompare(nb);
    });

    var html = '';
    // Toggle for empty lots
    html += '<div style="margin-bottom:14px;display:flex;justify-content:flex-end;">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text);cursor:pointer;">' +
        '<input type="checkbox" ' + (lotsShowEmpty ? 'checked' : '') + ' onchange="window.procurementToggleEmptyLots()"> Show consumed (qtyRemaining = 0)' +
      '</label>' +
    '</div>';

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

      html += '<div style="margin-bottom:18px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:10px;overflow:hidden;background:var(--surface-card,#fff);">';
      // Group header
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:rgba(42,124,111,0.06);">' +
        '<div style="font-weight:600;font-size:1rem;color:var(--text);">' + esc(matName) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--text);">' +
          '<span style="opacity:0.7;">Total</span> <strong style="font-family:monospace;">' + totalQty + (uom ? ' ' + esc(uom) : '') + '</strong>' +
          ' · <span style="opacity:0.7;">avg</span> <strong style="font-family:monospace;">' + fmt$(avgCost) + '</strong>' +
          ' · <span style="opacity:0.7;">value</span> <strong style="font-family:monospace;">' + fmt$(totalValue) + '</strong>' +
        '</div>' +
      '</div>';
      // Lot rows
      html += '<div style="display:grid;grid-template-columns:1.2fr 0.7fr 0.7fr 0.9fr 1fr 1fr;gap:10px;padding:8px 16px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--text);border-bottom:1px solid var(--cream-dark,#e8e0d4);">' +
        '<span>Lot</span><span>Received</span><span>Remaining</span><span>Unit cost</span><span>Vendor</span><span>Received date</span>' +
      '</div>';
      rows.forEach(function(l, idx) {
        var v = vendorsData[l.vendorId] || {};
        html += '<div style="display:grid;grid-template-columns:1.2fr 0.7fr 0.7fr 0.9fr 1fr 1fr;gap:10px;padding:10px 16px;align-items:center;font-size:0.85rem;color:var(--text);' + (idx < rows.length - 1 ? 'border-bottom:1px solid var(--cream-dark,#e8e0d4);' : '') + '">' +
          '<span style="font-family:monospace;font-weight:600;">' + esc(l.lotNumber || l.lotId.slice(0, 8)) + '</span>' +
          '<span style="font-family:monospace;">' + (l.qtyReceived || 0) + '</span>' +
          '<span style="font-family:monospace;font-weight:600;">' + (l.qtyRemaining || 0) + '</span>' +
          '<span style="font-family:monospace;">' + fmt$(l.unitCost) +
            (typeof l.unitCostOriginal === 'number' && l.unitCostOriginal !== l.unitCost
              ? ' <span style="font-size:0.78rem;opacity:0.65;">(was ' + fmt$(l.unitCostOriginal) + ')</span>' : '') +
          '</span>' +
          '<span>' + esc(v.name || (l.vendorId ? l.vendorId.slice(0, 8) : '—')) + '</span>' +
          '<span>' + fmtDate(l.receivedAt) + '</span>' +
        '</div>';
      });
      html += '</div>';
    });
    return html;
  }

  // ============================================================
  // Public API (window.* for inline onclick handlers)
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

  // ============================================================
  // Module registration
  // ============================================================

  function setup() {
    if (!dataLoaded) {
      render(); // shows the loading state immediately
      loadAll().then(render);
    } else {
      render();
    }
  }

  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('procurement', {
      routes: {
        procurement: { tab: 'procurementTab', setup: setup }
      }
    });
  } else {
    console.error('[procurement] MastAdmin.registerModule not available; module did not register');
  }
})();
