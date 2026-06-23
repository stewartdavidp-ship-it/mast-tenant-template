/**
 * vendors-v2.js — read-focused Faceted/Flat Record twin of the legacy Vendors
 * surface (doc 17 §11/§12; conversion playbook).
 *
 * Vendors (procurement suppliers) are a SUB-VIEW inside the legacy Procurement
 * module (procurement.js #procurement → Vendors tab → renderVendorDetail): a grid
 * of supplier cards that swap the pane in-place to a vendor detail
 * (renderVendorReadCard + Products / POs / Receipts sub-tabs) with its own Edit /
 * Archive controls. This twin re-hosts that VIEW on the Entity Engine: a
 * schema-driven list + a read-focused Faceted Record slide-out
 * (Overview / Supplies facets). It NEVER touches procurement.js.
 *
 * Variant (doc 17 §1a): a vendor is a supplier record (contact + commercial terms
 * + lead time + the products it supplies) with NO governed lifecycle — its state
 * (active / archived) is the assigned boolean attribute `active`, not a workflow →
 * Faceted/Flat Record, NOT Process/MastFlow.
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the legacy vendor
 * field set, grouped like the New-Vendor modal / edit form) + an onSave that
 * DELEGATES to window.VendorsBridge (exposed in procurement.js) so the vendor
 * write (admin/vendors/{id} + roleFlags + active + lead-time coercion) stays
 * single-sourced — this twin never reimplements that logic (mirrors the
 * contacts-v2 / ContactsBridge precedent). Archiving and product-supplier links
 * are also native. The vendor's purchase orders / receipts are a READ-ONLY facet
 * whose rows drill into the canonical V2 PO surface (procurement-v2, the MastFlow
 * process record) via MastEntity.drill — the stacked slide-out with Back. There
 * is NO classic escape hatch: every vendor capability has a native V2 home.
 *
 * Data: vendors live at admin/vendors (keyed by vendorId) — read directly with
 * MastDB.get('admin/vendors') (same path procurement.js reads). The Supplies facet
 * derives from admin/productSuppliers (vendor-keyed via ps.vendorId) and renders a
 * read-only per-supplier price-history sparkline from ps.priceHistory[] (the same
 * Trend cell legacy procurement.renderVendorProducts shows); the Purchase
 * orders facet derives from admin/purchaseOrders + admin/purchaseReceipts filtered
 * by po.vendorId (mirror of procurement.renderVendorPos / renderVendorReceipts) —
 * all cheap one-shot keyed-object reads loaded alongside vendors. Money is DOLLAR-
 * denominated (procurement fmt is Number(n).toFixed(2), no /100) → N.money(dollars).
 */
(function () {
  'use strict';
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  // Un-gated (Tier 1.5 P7, 2026-06-06): the procurement domain is the V2 default
  // for all users — no ?ui=1 required. The shared engine (MastEntity/MastUI) is
  // loaded unconditionally at boot, so self-registering here is always safe.

  var U = window.MastUI, N = U.Num, esc = U._esc;
  // Normalize a products list() result (array OR keyed) to { pid: product }.
  function pidMap(r) { var o = {}; (Array.isArray(r) ? r : Object.values(r || {})).forEach(function (p) { if (p) { var id = p.pid || p._key || p.id; if (id) o[id] = p; } }); return o; }
  // A product is suppliable (can be on a PO / vendor link) when it's bought
  // (resell) or value-add (var) — not built in-house from materials.
  function procurable(p) { return p && p.status !== 'archived' && p.acquisitionType !== 'build'; }

  // `active` is the only lifecycle signal (boolean). Surface it as a two-state
  // status attribute (mirrors the legacy "archived" pill on the detail header).
  var STATUS_LABEL = { active: 'Active', archived: 'Archived' };
  var STATUS_TONE = { active: 'success', archived: 'neutral' };

  function vendorName(v) { return (v && v.name) || '(unnamed)'; }
  function statusOf(v) { return (v && v.active === false) ? 'archived' : 'active'; }
  // Best contact line for the list: name, else email, else phone.
  function contactOf(v) { return (v && (v.contactName || v.email || v.phone)) || ''; }
  function leadDays(v) { return (v && v.defaultLeadTimeDays != null) ? v.defaultLeadTimeDays : null; }
  // "NET-30 · 14d" / "NET-30" / "14d" — terms + lead time for the list cell.
  function termsLead(v) {
    var t = (v && v.defaultPaymentTerms) ? String(v.defaultPaymentTerms) : '';
    var l = leadDays(v);
    var ld = (l != null) ? (l + 'd') : '';
    return (t && ld) ? (t + ' · ' + ld) : (t || ld || '');
  }
  function categoryOf(v) {
    // Vendors have no explicit category in the legacy schema; the closest
    // first-class signal is the role (supplier / customer) on roleFlags.
    var rf = (v && v.roleFlags) || {};
    var roles = [];
    if (rf.isSupplier !== false) roles.push('Supplier');
    if (rf.isCustomer === true) roles.push('Customer');
    return roles.join(' · ') || 'Supplier';
  }
  // Address line from the structured addresses[] (first entry), if any.
  function addressLine(v) {
    var a = v && Array.isArray(v.addresses) ? v.addresses[0] : null;
    if (!a || typeof a !== 'object') return '';
    var parts = [a.line1 || a.street, a.city, a.state, a.zip || a.postalCode].filter(Boolean);
    return parts.join(', ');
  }
  // Products this vendor supplies (cheap: one-shot admin/productSuppliers read,
  // filtered by vendorId; mirrors procurement.renderVendorProducts).
  function suppliesFor(v) {
    var id = v && (v.vendorId || v._key || v.id);
    if (!id) return [];
    return V2.productSuppliers.filter(function (ps) { return ps && ps.vendorId === id && ps.active !== false; });
  }
  // Purchase orders to this vendor (mirrors procurement.renderVendorPos:
  // po.vendorId === vendorId, newest first). One-shot admin/purchaseOrders read.
  function posFor(v) {
    var id = v && (v.vendorId || v._key || v.id);
    if (!id) return [];
    return V2.purchaseOrders.filter(function (po) { return po && po.vendorId === id; })
      .sort(function (a, b) { return String(b.orderDate || b.createdAt || '').localeCompare(String(a.orderDate || a.createdAt || '')); });
  }
  // Receipts from this vendor (mirrors procurement.renderVendorReceipts: receipts
  // whose poId belongs to one of this vendor's POs, newest first).
  function receiptsFor(v) {
    var poIds = posFor(v).map(function (po) { return po.poId || po._key; });
    return V2.purchaseReceipts.filter(function (r) { return r && poIds.indexOf(r.poId) >= 0; })
      .sort(function (a, b) { return String(b.receivedAt || '').localeCompare(String(a.receivedAt || '')); });
  }
  // PO total — DOLLAR-denominated (mirrors procurement.poTotal): explicit total,
  // else sum of lines (qtyOrdered * unitCost).
  function poTotal(po) {
    if (typeof po.total === 'number' && po.total > 0) return po.total;
    var sum = 0;
    (po.lines || []).forEach(function (l) { sum += (Number(l.qtyOrdered) || 0) * (Number(l.unitCost) || 0); });
    return sum;
  }
  // PO status as a status attribute (matches procurement-v2's tones/labels).
  var PO_STATUS_TONE = { draft: 'neutral', submitted: 'info', partially_received: 'amber', received: 'success', closed: 'neutral', cancelled: 'danger' };
  function poStatusLabel(s) { return s === 'partially_received' ? 'partial' : (s || 'draft'); }
  // Value of a single receipt (sum of received qty × home-currency unit cost).
  function receiptValue(r) {
    return (r.lines || []).reduce(function (s, l) { return s + (Number(l.qtyReceivedNow) || 0) * (Number(l.unitCostHomeCurrency) || 0); }, 0);
  }
  function supplyLabel(ps) {
    if (ps.vendorDescription) return ps.vendorDescription;
    if (ps.targetKind === 'material') {
      var m = V2.materials[ps.targetId];
      return (m && m.name) || ps.targetId || '—';
    }
    var p = V2.products[ps.targetId];
    return (p && p.name) || ps.targetId || '—';
  }
  // Inline SVG price-history sparkline for a product-supplier's priceHistory[]
  // (each point { unitCost, recordedAt, source, ref }). Read-only mirror of
  // procurement.priceSparkline: maps positive unitCosts to a polyline, colors the
  // stroke by overall trend (rising = amber, falling = teal, flat = text) — all
  // design tokens, no hardcoded hex. Returns '' when there are <2 priced points
  // (the cost cell already shows the latest value). priceHistory rides on the
  // already-loaded admin/productSuppliers object (no extra read); the trailing
  // window is capped so a very long history can't blow up the inline SVG.
  var SPARK_MAX_PTS = 40;
  function priceSparkline(history, width, height) {
    width = width || 80; height = height || 22;
    var all = (Array.isArray(history) ? history : [])
      .map(function (h) { return Number(h && h.unitCost) || 0; })
      .filter(function (n) { return n > 0; });
    var pts = all.length > SPARK_MAX_PTS ? all.slice(all.length - SPARK_MAX_PTS) : all;
    if (pts.length < 2) return '';
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    var span = max - min || 1;
    var stepX = width / (pts.length - 1);
    var path = pts.map(function (v, i) {
      var x = i * stepX;
      var y = height - ((v - min) / span) * (height - 2) - 1;
      return (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var lastVal = pts[pts.length - 1], firstVal = pts[0];
    var trend = lastVal > firstVal ? 'var(--amber-light)' : (lastVal < firstVal ? 'var(--teal)' : 'var(--text)');
    var label = (lastVal > firstVal ? 'rising' : (lastVal < firstVal ? 'falling' : 'flat')) + ', ' + pts.length + ' observations';
    return '<svg width="' + width + '" height="' + height + '" style="vertical-align:middle;" role="img" aria-label="price trend ' + label + '">' +
      '<title>Price trend (' + label + ')</title>' +
      '<path d="' + path + '" fill="none" stroke="' + trend + '" stroke-width="1.5" />' +
    '</svg>';
  }

  // ── schema (read-only Faceted/Flat Record) ──────────────────────────
  MastEntity.define('vendors-v2', {
    label: 'Vendor', labelPlural: 'Vendors', size: 'lg',
    route: 'vendors-v2',
    recordId: function (v) { return v.vendorId || v._key || v.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Vendor', type: 'text', list: true, readOnly: true, group: 'Vendor', get: vendorName },
      { name: 'category', label: 'Category', type: 'text', list: true, readOnly: true, sortable: false, get: categoryOf },
      { name: 'contact', label: 'Contact', type: 'text', list: true, readOnly: true, sortable: false, get: function (v) { return contactOf(v) || '—'; } },
      { name: 'termsLead', label: 'Terms / lead', type: 'text', list: true, readOnly: true, sortable: false, get: function (v) { return termsLead(v) || '—'; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'archived'],
        get: statusOf,
        tone: function (val) { return STATUS_TONE[val] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, v) {
        var vid = v.vendorId || v._key || v.id;
        var supplies = suppliesFor(v);
        var pos = posFor(v);
        var receipts = receiptsFor(v);
        var tiles = UI.tiles([
          { k: 'Category', v: esc(categoryOf(v)), hero: true },
          { k: 'Terms', v: esc((v.defaultPaymentTerms ? String(v.defaultPaymentTerms) : '—')) },
          { k: 'Lead time', v: (leadDays(v) != null ? (N.count(leadDays(v)) + ' days') : '—') },
          { k: 'Supplies', v: N.count(supplies.length) }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'supplies', label: 'Supplies' }, { key: 'pos', label: 'Purchase orders' }
        ], 'ov');

        // Overview — identity + contact + commercial terms + tax/account.
        var identity = UI.kv([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(v)] || 'Active', STATUS_TONE[statusOf(v)] || 'neutral') },
          { k: 'Vendor code', v: v.vendorCode ? esc(v.vendorCode) : '—' },
          { k: 'Category', v: esc(categoryOf(v)) },
          { k: 'Added', v: v.createdAt ? N.date(v.createdAt) : '—' }
        ]);
        var website = v.website
          ? '<a href="' + esc(v.website) + '" target="_blank" rel="noopener" class="mu-link">' + esc(v.website) + '</a>'
          : '—';
        var contact = UI.kv([
          { k: 'Contact', v: v.contactName ? esc(v.contactName) : '—' },
          { k: 'Email', v: v.email ? esc(v.email) : '—' },
          { k: 'Phone', v: v.phone ? esc(v.phone) : '—' },
          { k: 'Website', v: website },
          { k: 'Address', v: addressLine(v) ? esc(addressLine(v)) : '—' }
        ]);
        var terms = UI.kv([
          { k: 'Payment terms', v: v.defaultPaymentTerms ? esc(v.defaultPaymentTerms) : '—' },
          { k: 'Lead time', v: (leadDays(v) != null ? (N.count(leadDays(v)) + ' days') : '—') },
          { k: 'Default currency', v: v.defaultCurrency ? esc(v.defaultCurrency) : '—' },
          { k: 'Ship method', v: v.defaultShipMethod ? esc(v.defaultShipMethod) : '—' },
          // PII (identity-data): masked last-4 only, never the raw value.
          { k: 'Tax ID', v: (window.VendorSecureId && VendorSecureId.has(v, 'taxId')) ? esc(VendorSecureId.masked(v, 'taxId')) : '—' },
          { k: 'Account #', v: (window.VendorSecureId && VendorSecureId.has(v, 'accountNumber')) ? esc(VendorSecureId.masked(v, 'accountNumber')) : '—' }
        ]);
        var notesBody = v.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(v.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';
        // Archive / unarchive is NATIVE now (Tier 1.5 P5). Product-supplier links
        // are managed natively in the Supplies pane (P4); the vendor's POs/receipts
        // are the read-only Purchase orders facet (drills to procurement-v2). No
        // classic escape hatch remains.
        var isArchived = statusOf(v) === 'archived';
        var manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="VendorsV2.toggleArchive(\'' + esc(vid) + '\',' + (isArchived ? 'true' : 'false') + ')">' + (isArchived ? 'Unarchive vendor' : 'Archive vendor') + '</button>' +
        '</div>';

        // Supplies — products/materials this vendor supplies (preferred first),
        // with cost + lead time + MOQ. Read-only mirror of renderVendorProducts.
        var sorted = supplies.slice().sort(function (a, b) {
          var pa = a.preferred ? 0 : 1, pb = b.preferred ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return String(supplyLabel(a)).localeCompare(String(supplyLabel(b)));
        });
        var suppliesBody = sorted.length ? UI.relatedTable([
          { label: 'Item', render: function (ps) {
            return esc(supplyLabel(ps)) + ' <span class="mu-sub">· ' + esc(ps.targetKind || '') + '</span>' + (ps.preferred ? ' <span class="mu-sub">· preferred</span>' : '');
          } },
          { label: 'Vendor SKU', render: function (ps) { return ps.vendorSku ? '<span class="mu-sub">' + esc(ps.vendorSku) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'MOQ', align: 'right', render: function (ps) { return ps.moq != null ? N.count(ps.moq) : '<span class="mu-sub">—</span>'; } },
          { label: 'Lead', align: 'right', render: function (ps) { return ps.leadTimeDays != null ? esc(ps.leadTimeDays + 'd') : '<span class="mu-sub">—</span>'; } },
          { label: 'Cost', align: 'right', render: function (ps) { return N.money(ps.unitCost) || '<span class="mu-sub">—</span>'; } },
          { label: 'Trend', align: 'right', render: function (ps) {
            // Per-supplier price-history sparkline (read-only; mirror of legacy
            // procurement renderVendorProducts "Trend" cell). priceHistory rides
            // on the already-loaded ps object — no extra read.
            var hist = Array.isArray(ps.priceHistory) ? ps.priceHistory : [];
            var spark = priceSparkline(hist);
            if (!spark) return '<span class="mu-sub">—</span>';
            return spark + ' <span class="mu-sub" style="font-size:0.72rem;">' + N.count(hist.length) + ' obs</span>';
          } },
          { label: '', align: 'right', render: function (ps) {
            var id = ps.id || ps.psId;
            return '<button class="btn btn-secondary btn-small" style="padding:2px 8px;" onclick="VendorsV2.editSupply(\'' + esc(vid) + '\',\'' + esc(id) + '\')">Edit</button> ' +
              '<button class="btn btn-secondary btn-small" style="padding:2px 8px;" onclick="VendorsV2.archiveSupply(\'' + esc(vid) + '\',\'' + esc(id) + '\')" title="Remove link">×</button>';
          } }
        ], sorted) : '<span class="mu-sub">No products linked to this vendor.</span>';
        var addSupply = '<div style="margin-top:10px;"><button class="btn btn-secondary btn-small" onclick="VendorsV2.addSupply(\'' + esc(vid) + '\')">+ Add supply</button></div>';

        // Purchase orders — READ-ONLY mirror of procurement.renderVendorPos. Each
        // row's PO # drills into the V2 procurement-v2 PO detail (stacked slide-out
        // with Back), NOT classic. PO writes (new/receive/cancel) live on
        // procurement-v2; this facet is purely a vendor-scoped view.
        var posBody = pos.length ? UI.relatedTable([
          { label: 'PO #', render: function (po) {
            var id = po.poId || po._key;
            var label = po.poNumber || String(id).slice(0, 8);
            return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'procurement-v2\',\'' + esc(id) + '\')">' + esc(label) + '</button>';
          } },
          { label: 'Status', render: function (po) { return UI.badge(poStatusLabel(po.status), PO_STATUS_TONE[po.status] || 'neutral'); } },
          { label: 'Ordered', render: function (po) { return po.orderDate ? N.date(po.orderDate) : '<span class="mu-sub">—</span>'; } },
          { label: 'Expected', render: function (po) { return po.expectedDate ? N.date(po.expectedDate) : '<span class="mu-sub">—</span>'; } },
          { label: 'Total', align: 'right', render: function (po) { return N.money(poTotal(po)) || '<span class="mu-sub">—</span>'; } }
        ], pos) : '<span class="mu-sub">No purchase orders to this vendor.</span>';
        // Receipts summary — a compact list of goods received from this vendor
        // (mirror of procurement.renderVendorReceipts; provenance, not actions).
        var receiptsBody = receipts.length ? UI.relatedTable([
          { label: 'Received', render: function (r) { return r.receivedAt ? N.date(r.receivedAt) : '<span class="mu-sub">—</span>'; } },
          { label: 'PO #', render: function (r) {
            var label = (V2.poById[r.poId] && V2.poById[r.poId].poNumber) || String(r.poId || '').slice(0, 8);
            return r.poId ? '<button type="button" class="mu-link" onclick="MastEntity.drill(\'procurement-v2\',\'' + esc(r.poId) + '\')">' + esc(label) + '</button>' : '<span class="mu-sub">—</span>';
          } },
          { label: 'Invoice', render: function (r) { return r.vendorInvoiceRef ? '<span class="mu-sub">' + esc(r.vendorInvoiceRef) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Lines', align: 'right', render: function (r) { return N.count((r.lines || []).length); } },
          { label: 'Value', align: 'right', render: function (r) { return N.money(receiptValue(r)) || '<span class="mu-sub">—</span>'; } }
        ], receipts) : '<span class="mu-sub">No receipts from this vendor yet.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Vendor', identity) +
            UI.card('Contact', contact) +
            UI.card('Terms & account', terms) +
            UI.card('Notes', notesBody + manage) +
          '</div>' +
          '<div class="mu-pane" data-pane="supplies" hidden>' + UI.cardTable('Supplies (' + supplies.length + ')', suppliesBody) + addSupply + '</div>' +
          '<div class="mu-pane" data-pane="pos" hidden>' +
            UI.cardTable('Purchase orders (' + pos.length + ')', posBody) +
            UI.cardTable('Receipts (' + receipts.length + ')', receiptsBody) +
          '</div>';
      },
      // Native edit form — the legacy New-Vendor modal / vendor edit field set,
      // grouped. Mirrors procurement.openNewVendorModal / renderVendorEditForm:
      // name (required), vendorCode, contactName, email, phone, website,
      // defaultCurrency, defaultPaymentTerms, defaultLeadTimeDays, defaultShipMethod,
      // taxId, accountNumber, notes. Archiving + product-supplier links + addresses[]
      // stay on legacy (a partial update preserves roleFlags/active/addresses).
      editRender: function (v, mode) {
        v = v || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        // Tax ID (EIN/SSN) + bank account number are PII, encrypted at rest via
        // MastIntake (identity-data). The secure host (own label + counsel + masked/
        // reveal) replaces the legacy plaintext inputs. A saved vendor hosts the real
        // field; a new vendor (create mode) is prompted to save first so the ref has a
        // stable id to attach to. Hydrate after the engine mounts this string.
        var vendorId = (mode === 'create') ? null : (v.vendorId || v._key || v.id || null);
        var secureBlock = window.VendorSecureId
          ? '<div class="form-group">' + VendorSecureId.host(vendorId, 'taxId', v) + '</div>' +
            '<div class="form-group">' + VendorSecureId.host(vendorId, 'accountNumber', v) + '</div>'
          : '';
        if (vendorId && window.MastIntake && typeof MastIntake.hydrate === 'function') {
          setTimeout(function () { try { MastIntake.hydrate(); } catch (e) { /* fail-closed */ } }, 0);
        }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New vendor' : 'Edit this vendor') + '</div>' +
          fg('Name *', '<input class="form-input" id="vnV2Name" value="' + esc(v.name || '') + '" style="width:100%;" placeholder="Supplier name">') +
          row2(
            fg('Vendor code', '<input class="form-input" id="vnV2Code" value="' + esc(v.vendorCode || '') + '" style="width:100%;" placeholder="STULLER">', true),
            fg('Contact name', '<input class="form-input" id="vnV2Contact" value="' + esc(v.contactName || '') + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Email', '<input class="form-input" type="email" id="vnV2Email" value="' + esc(v.email || '') + '" style="width:100%;" placeholder="email@example.com">', true),
            fg('Phone', '<input class="form-input" type="tel" id="vnV2Phone" value="' + esc(v.phone || '') + '" style="width:100%;" placeholder="(555) 123-4567">', true)
          ) +
          fg('Website', '<input class="form-input" type="url" id="vnV2Website" value="' + esc(v.website || '') + '" style="width:100%;" placeholder="https://...">') +
          row2(
            fg('Default currency', '<input class="form-input" id="vnV2Currency" value="' + esc(v.defaultCurrency || '') + '" style="width:100%;" placeholder="USD">', true),
            fg('Payment terms', '<input class="form-input" id="vnV2Terms" value="' + esc(v.defaultPaymentTerms || '') + '" style="width:100%;" placeholder="net-30">', true)
          ) +
          row2(
            fg('Default lead time (days)', '<input class="form-input" type="number" min="0" id="vnV2Lead" value="' + esc(v.defaultLeadTimeDays == null ? '' : v.defaultLeadTimeDays) + '" style="width:100%;">', true),
            fg('Ship method', '<input class="form-input" id="vnV2Ship" value="' + esc(v.defaultShipMethod || '') + '" style="width:100%;">', true)
          ) +
          secureBlock +
          fg('Notes', '<textarea class="form-input" id="vnV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(v.notes || '') + '</textarea>');
      }
    },
    onSave: function (rec, mode) {
      if (!window.VendorsBridge) { if (window.showToast) showToast('Vendors engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
      var data = {
        name: val('vnV2Name'),
        vendorCode: val('vnV2Code') || null,
        contactName: val('vnV2Contact') || null,
        email: val('vnV2Email') || null,
        phone: val('vnV2Phone') || null,
        website: val('vnV2Website') || null,
        defaultCurrency: val('vnV2Currency') || null,
        defaultPaymentTerms: val('vnV2Terms') || null,
        defaultLeadTimeDays: val('vnV2Lead') || null,
        defaultShipMethod: val('vnV2Ship') || null,
        // taxId / accountNumber are PII encrypted at rest via the MastIntake secure
        // fields, which persist their own Ref/Masked pointers — never collected here.
        notes: val('vnV2Notes') || null
      };
      if (!data.name) { if (window.showToast) showToast('Vendor name is required.', true); return false; }

      if (mode === 'create') {
        return Promise.resolve(window.VendorsBridge.create(data)).then(function () {
          if (window.showToast) showToast('Vendor created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[vendors-v2] create', e); if (window.showToast) showToast('Error saving vendor.', true); return false; });
      }
      var id = rec.vendorId || rec._key || rec.id;
      return Promise.resolve(window.VendorsBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Coerce
        // lead time to match the persisted shape so the post-save read re-render
        // matches; reloadSoon() then refreshes the cache for the next open.
        var coerced = Object.assign({}, data, { defaultLeadTimeDays: data.defaultLeadTimeDays === null ? null : parseInt(data.defaultLeadTimeDays, 10) });
        Object.assign(V2.byId[id] || rec, coerced);
        if (window.showToast) showToast('Vendor updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[vendors-v2] update', e); if (window.showToast) showToast('Error updating vendor.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, productSuppliers: [], materials: {}, products: {}, purchaseOrders: [], purchaseReceipts: [], poById: {}, sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'active', loaded: false };

  function load() {
    // Ensure the legacy procurement module is loaded so window.VendorsBridge
    // (the delegated write path) exists — mirrors contacts-v2. Also load the
    // MastIntake provider catalog so the editor's secure Tax ID / bank account
    // fields (identity-data) render + hydrate inline (fail-closed if it can't load).
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
      try { MastAdmin.loadModule('procurement-v2'); } catch (e) {}
      try { MastAdmin.loadModule('connections-providers'); } catch (e) {}
    }
    // Vendors + product-suppliers (Supplies facet/count) + materials (target
    // label lookup) load together; all one-shot keyed-object reads at admin/*.
    // Purchase orders + receipts feed the read-only Purchase orders facet (the PO
    // detail itself is drilled via procurement-v2, the canonical PO surface).
    return Promise.all([
      Promise.resolve(MastDB.get('admin/vendors')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/productSuppliers')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/materials')).catch(function () { return null; }),
      Promise.resolve((MastDB.products && MastDB.products.list ? MastDB.products.list() : MastDB.get('public/products'))).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/purchaseOrders')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/purchaseReceipts')).catch(function () { return null; })
    ]).then(function (res) {
      var vv = res[0] || {}, pv = res[1] || {}, mv = res[2] || {}, pos = res[4] || {}, rcpts = res[5] || {};
      // Products live at public/products; list() returns array OR keyed — normalize.
      V2.products = pidMap(res[3]);
      var out = [];
      Object.keys(vv).forEach(function (k) {
        var v = vv[k];
        if (v && typeof v === 'object') { v = Object.assign({ _key: k }, v); v.vendorId = v.vendorId || k; out.push(v); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.vendorId] = r; });
      V2.productSuppliers = Object.keys(pv).map(function (k) { var ps = pv[k] || {}; ps.id = ps.id || k; return ps; });
      V2.materials = mv || {};
      V2.purchaseOrders = Object.keys(pos).map(function (k) { var po = pos[k] || {}; po.poId = po.poId || k; po._key = k; return po; });
      V2.poById = {}; V2.purchaseOrders.forEach(function (po) { V2.poById[po.poId] = po; });
      V2.purchaseReceipts = Object.keys(rcpts).map(function (k) { var r = rcpts[k] || {}; r.receiptId = r.receiptId || k; return r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[vendors-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (v) { return statusOf(v) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (v) {
        return String(vendorName(v)).toLowerCase().indexOf(q) >= 0 ||
               String(contactOf(v)).toLowerCase().indexOf(q) >= 0 ||
               String(v.vendorCode || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('vendors-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('vendorsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'vendorsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['active', 'Active'], ['archived', 'Archived'], ['all', 'All']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="VendorsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Vendors',
        count: N.count(V2.rows.length) + ' ' + MastFormat.plural(V2.rows.length, 'vendor'),
        actionsHtml: '<button class="btn btn-primary" onclick="VendorsV2.create()">+ New vendor</button>' +
          '<button class="btn btn-secondary" onclick="VendorsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, contact or code…" value="' + esc(V2.q) +
        '" oninput="VendorsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('vendors-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'VendorsV2.sort', onRowClickFnName: 'VendorsV2.open',
        empty: { title: 'No vendors', message: V2.loaded ? 'Add a vendor to get started.' : 'Loading…' }
      });
  }

  // ── Supply (product-supplier link) form — Tier 1.5 P4 ───────────────
  var supplyDraft = null;
  function openSupplyForm(vendorId, ps) {
    ps = ps || null;
    supplyDraft = ps ? {
      vendorId: vendorId, psId: (ps.id || ps.psId), targetKind: ps.targetKind || 'material', targetId: ps.targetId || '',
      vendorSku: ps.vendorSku || '', unitCost: ps.unitCost == null ? '' : ps.unitCost, moq: ps.moq == null ? '' : ps.moq,
      leadTimeDays: ps.leadTimeDays == null ? '' : ps.leadTimeDays, preferred: !!ps.preferred
    } : { vendorId: vendorId, psId: null, targetKind: 'material', targetId: '', vendorSku: '', unitCost: '', moq: '', leadTimeDays: '', preferred: false };
    U.slideOut.open({
      id: 'supply-' + (supplyDraft.psId || 'new'), title: supplyDraft.psId ? 'Edit supply' : 'Add supply', size: 'md',
      mode: 'create', deepLink: false, createLabel: supplyDraft.psId ? 'Save' : 'Add',
      render: function () { return buildSupplyBody(); },
      isDirty: function () { return true; },
      onSave: function () { return submitSupply(); }
    });
  }
  function svRerender() { var b = document.getElementById('mastSlideOutBody'); if (b) b.innerHTML = buildSupplyBody(); }
  function buildSupplyBody() {
    if (!supplyDraft) return '';
    var d = supplyDraft;
    var items = (d.targetKind === 'material')
      ? Object.keys(V2.materials).map(function (k) { return [k, V2.materials[k]]; }).filter(function (e) { return e[1] && e[1].status !== 'archived'; })
      : Object.keys(V2.products).map(function (k) { return [k, V2.products[k]]; }).filter(function (e) { return procurable(e[1]); });
    items.sort(function (a, b) { return String(a[1].name || '').localeCompare(String(b[1].name || '')); });
    var itemOpts = '<option value="">— item —</option>' + items.map(function (e) { return '<option value="' + esc(e[0]) + '"' + (d.targetId === e[0] ? ' selected' : '') + '>' + esc(e[1].name || e[0]) + '</option>'; }).join('');
    function fg(label, inner) { return '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:8px;">' + label + inner + '</label>'; }
    var body =
      fg('Kind', '<select style="width:100%;margin-top:2px;" onchange="VendorsV2.svField(\'targetKind\',this.value)"><option value="material"' + (d.targetKind === 'material' ? ' selected' : '') + '>material</option><option value="product"' + (d.targetKind === 'product' ? ' selected' : '') + '>product</option></select>') +
      fg('Item', '<select style="width:100%;margin-top:2px;" onchange="VendorsV2.svField(\'targetId\',this.value)">' + itemOpts + '</select>') +
      fg('Vendor SKU', '<input class="form-input" style="width:100%;margin-top:2px;" value="' + esc(d.vendorSku || '') + '" oninput="VendorsV2.svField(\'vendorSku\',this.value)">') +
      '<div style="display:flex;gap:10px;">' +
        fg('Unit cost', '<input type="number" min="0" step="0.01" class="form-input" style="width:100%;margin-top:2px;" value="' + esc(String(d.unitCost)) + '" oninput="VendorsV2.svField(\'unitCost\',this.value)">') +
        fg('MOQ', '<input type="number" min="0" step="1" class="form-input" style="width:100%;margin-top:2px;" value="' + esc(String(d.moq)) + '" oninput="VendorsV2.svField(\'moq\',this.value)">') +
        fg('Lead (days)', '<input type="number" min="0" step="1" class="form-input" style="width:100%;margin-top:2px;" value="' + esc(String(d.leadTimeDays)) + '" oninput="VendorsV2.svField(\'leadTimeDays\',this.value)">') +
      '</div>' +
      '<label style="font-size:0.85rem;display:flex;align-items:center;gap:8px;margin-top:6px;cursor:pointer;"><input type="checkbox" ' + (d.preferred ? 'checked' : '') + ' onchange="VendorsV2.svField(\'preferred\',this.checked)"> Preferred supplier for this item</label>';
    return U.card(d.psId ? 'Edit supply' : 'Add supply', body);
  }
  function submitSupply() {
    if (!supplyDraft) return false;
    var d = supplyDraft;
    if (!d.targetId) { if (window.showToast) showToast('Pick an item', true); return false; }
    if (!window.VendorsBridge || typeof VendorsBridge.createSupply !== 'function') {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
      if (window.showToast) showToast('Vendors engine still loading — try again', true); return false;
    }
    var payload = { vendorId: d.vendorId, targetKind: d.targetKind, targetId: d.targetId, vendorSku: d.vendorSku || null, unitCost: d.unitCost, moq: d.moq, leadTimeDays: d.leadTimeDays, preferred: !!d.preferred };
    var p = d.psId ? VendorsBridge.updateSupply(d.psId, payload) : VendorsBridge.createSupply(payload);
    Promise.resolve(p).then(function () {
      if (window.showToast) showToast(d.psId ? 'Supply updated' : 'Supply added');
      supplyDraft = null; U.slideOut.requestCloseForce(); reloadThenOpenVendor(d.vendorId);
    }).catch(function (e) { if (window.showToast) showToast('Failed: ' + (e && e.message || e), true); });
    return false;
  }
  function reloadThenOpenVendor(vendorId) {
    V2.loaded = false;
    return load().then(function () { var rec = V2.byId[vendorId]; if (rec) MastEntity.openRecord('vendors-v2', rec, 'read'); });
  }

  window.VendorsV2 = {
    addSupply: function (vendorId) { openSupplyForm(vendorId, null); },
    editSupply: function (vendorId, psId) {
      var ps = V2.productSuppliers.filter(function (x) { return (x.id || x.psId) === psId; })[0];
      openSupplyForm(vendorId, ps || null);
    },
    archiveSupply: function (vendorId, psId) {
      var go = function () {
        Promise.resolve(window.VendorsBridge.archiveSupply(psId)).then(function () {
          if (window.showToast) showToast('Supply removed'); reloadThenOpenVendor(vendorId);
        }).catch(function (e) { if (window.showToast) showToast('Failed: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm('Remove this supplier link?')).then(function (ok) { if (ok) go(); });
      else go();
    },
    toggleArchive: function (vendorId, isCurrentlyArchived) {
      var go = function () {
        Promise.resolve(window.VendorsBridge.setVendorActive(vendorId, isCurrentlyArchived)).then(function () {
          if (window.showToast) showToast(isCurrentlyArchived ? 'Vendor unarchived' : 'Vendor archived'); reloadThenOpenVendor(vendorId);
        }).catch(function (e) { if (window.showToast) showToast('Failed: ' + (e && e.message || e), true); });
      };
      var msg = isCurrentlyArchived ? 'Unarchive this vendor?' : 'Archive this vendor? It will be hidden from active lists (history is kept).';
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm(msg)).then(function (ok) { if (ok) go(); });
      else go();
    },
    svField: function (f, v) {
      if (!supplyDraft) return;
      supplyDraft[f] = v;
      if (f === 'targetKind') { supplyDraft.targetId = ''; svRerender(); }
    },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('vendors-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('vendors-v2', rec, 'read');
      });
    },
    create: function () {
      // Ensure the legacy module (and thus window.VendorsBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement-v2'); } catch (e) {} }
      MastEntity.openRecord('vendors-v2', {}, 'create');
    },
    // Vendor identity create/edit + archiving + product-supplier links are all
    // native here; the vendor's purchase orders / receipts are now a read-only
    // facet that drills into the V2 procurement-v2 PO detail. No classic escape
    // hatch remains — every vendor capability has a native V2 home.
    exportCsv: function () { return MastEntity.exportRows('vendors-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('vendors-v2', {
    routes: { 'vendors-v2': { tab: 'vendorsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
