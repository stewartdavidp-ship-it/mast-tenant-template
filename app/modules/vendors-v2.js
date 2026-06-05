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
 * contacts-v2 / ContactsBridge precedent). Archiving, product-supplier links, and
 * PO/receipt sub-tools remain bespoke and coupled to legacy #procurement and keep
 * a "manage in classic view" link. Flag-gated (?ui=1) at #vendors-v2, side-by-side.
 *
 * Data: vendors live at admin/vendors (keyed by vendorId) — read directly with
 * MastDB.get('admin/vendors') (same path procurement.js reads). The Supplies facet
 * derives from admin/productSuppliers (vendor-keyed via ps.vendorId) — a cheap
 * one-shot keyed-object read loaded alongside vendors. Money is DOLLAR-denominated
 * (procurement fmt is Number(n).toFixed(2), no /100) → MastUI.Num.money(dollars).
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
  function supplyLabel(ps) {
    if (ps.vendorDescription) return ps.vendorDescription;
    if (ps.targetKind === 'material') {
      var m = V2.materials[ps.targetId];
      return (m && m.name) || ps.targetId || '—';
    }
    return ps.targetId || '—';
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
        var supplies = suppliesFor(v);
        var tiles = UI.tiles([
          { k: 'Category', v: esc(categoryOf(v)), hero: true },
          { k: 'Terms', v: esc((v.defaultPaymentTerms ? String(v.defaultPaymentTerms) : '—')) },
          { k: 'Lead time', v: (leadDays(v) != null ? (N.count(leadDays(v)) + ' days') : '—') },
          { k: 'Supplies', v: N.count(supplies.length) }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'supplies', label: 'Supplies' }
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
          { k: 'Tax ID', v: v.taxId ? esc(v.taxId) : '—' },
          { k: 'Account #', v: v.accountNumber ? esc(v.accountNumber) : '—' }
        ]);
        var notesBody = v.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(v.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';
        // Vendor identity editing is NATIVE now (the Edit button on this slide-out).
        // What still has NO V2 home: archiving, product-supplier links, and
        // PO/receipt sub-tools — those stay bespoke on legacy #procurement.
        // navigateToClassic so the V2 route remap doesn't loop back to this twin.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="VendorsV2.classic()">Archive / link products in classic view →</button></div>';

        // Supplies — products/materials this vendor supplies (preferred first),
        // with cost + lead time + MOQ. Read-only mirror of renderVendorProducts.
        var sorted = supplies.slice().sort(function (a, b) {
          var pa = a.preferred ? 0 : 1, pb = b.preferred ? 0 : 1;
          if (pa !== pb) return pa - pb;
          return String(supplyLabel(a)).localeCompare(String(supplyLabel(b)));
        });
        var suppliesBody = sorted.length ? UI.relatedTable([
          { label: 'Item', render: function (ps) {
            return esc(supplyLabel(ps)) + (ps.preferred ? ' <span class="mu-sub">· preferred</span>' : '');
          } },
          { label: 'Vendor SKU', render: function (ps) { return ps.vendorSku ? '<span class="mu-sub">' + esc(ps.vendorSku) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'MOQ', align: 'right', render: function (ps) { return ps.moq != null ? N.count(ps.moq) : '<span class="mu-sub">—</span>'; } },
          { label: 'Lead', align: 'right', render: function (ps) { return ps.leadTimeDays != null ? esc(ps.leadTimeDays + 'd') : '<span class="mu-sub">—</span>'; } },
          { label: 'Cost', align: 'right', render: function (ps) { return N.money(ps.unitCost) || '<span class="mu-sub">—</span>'; } }
        ], sorted) : '<span class="mu-sub">No products linked to this vendor.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Vendor', identity) +
            UI.card('Contact', contact) +
            UI.card('Terms & account', terms) +
            UI.card('Notes', notesBody + manage) +
          '</div>' +
          '<div class="mu-pane" data-pane="supplies" hidden>' + UI.cardTable('Supplies (' + supplies.length + ')', suppliesBody) + '</div>';
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
          row2(
            fg('Tax ID', '<input class="form-input" id="vnV2TaxId" value="' + esc(v.taxId || '') + '" style="width:100%;">', true),
            fg('Account number', '<input class="form-input" id="vnV2Acct" value="' + esc(v.accountNumber || '') + '" style="width:100%;">', true)
          ) +
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
        taxId: val('vnV2TaxId') || null,
        accountNumber: val('vnV2Acct') || null,
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
  var V2 = { rows: [], byId: {}, productSuppliers: [], materials: {}, sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'active', loaded: false };

  function load() {
    // Ensure the legacy procurement module is loaded so window.VendorsBridge
    // (the delegated write path) exists — mirrors contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
    // Vendors + product-suppliers (Supplies facet/count) + materials (target
    // label lookup) load together; all one-shot keyed-object reads at admin/*.
    Promise.all([
      Promise.resolve(MastDB.get('admin/vendors')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/productSuppliers')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/materials')).catch(function () { return null; })
    ]).then(function (res) {
      var vv = res[0] || {}, pv = res[1] || {}, mv = res[2] || {};
      var out = [];
      Object.keys(vv).forEach(function (k) {
        var v = vv[k];
        if (v && typeof v === 'object') { v = Object.assign({ _key: k }, v); v.vendorId = v.vendorId || k; out.push(v); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.vendorId] = r; });
      V2.productSuppliers = Object.keys(pv).map(function (k) { var ps = pv[k] || {}; ps.id = ps.id || k; return ps; });
      V2.materials = mv || {};
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
        count: N.count(V2.rows.length) + ' vendor' + (V2.rows.length === 1 ? '' : 's'),
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

  window.VendorsV2 = {
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
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('procurement'); } catch (e) {} }
      MastEntity.openRecord('vendors-v2', {}, 'create');
    },
    // Vendor identity create/edit is native. Archiving, product-supplier links,
    // and PO/receipt sub-tools are still bespoke on legacy #procurement (no V2
    // home; vendors live under Procurement, no top-level legacy route). Use
    // navigateToClassic so the V2 route remap doesn't loop us back to a twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('procurement');
      else if (typeof navigateTo === 'function') navigateTo('procurement');
    },
    exportCsv: function () { return MastEntity.exportRows('vendors-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('vendors-v2', {
    routes: { 'vendors-v2': { tab: 'vendorsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
