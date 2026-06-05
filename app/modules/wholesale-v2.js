/**
 * wholesale-v2.js — read-focused Faceted Record twin of the legacy Wholesale
 * accounts surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy wholesale.js (#wholesale) hosts a 7-tab admin: a list of B2B accounts
 * with an inline card detail (renderWholesaleAccountDetail) plus Orders / AR
 * Aging / Cadence / Users / Requests / Dormant tooling. This twin re-hosts ONE
 * of those surfaces — the accounts list → read detail — on the Entity Engine:
 * a schema-driven list + a read-focused Faceted Record slide-out
 * (Overview / Contacts / Notes facets).
 *
 * Variant (doc 17 §1a): a wholesale account is a commercial-terms record (NET
 * terms, credit limit, MOQ rules, resale cert, sales rep, territory) with a few
 * related collections (contacts) but no governed lifecycle — its status
 * (active / on_hold / closed) is an assigned attribute → Faceted Record, NOT
 * Process/MastFlow.
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the account field
 * set, grouped like the legacy modal) + an onSave that DELEGATES to
 * window.WholesaleBridge (exposed in wholesale.js) so the account write stays
 * single-sourced — this twin never reimplements that logic (mirrors the
 * contacts-v2 / ContactsBridge precedent). The orders / AR aging / cadence /
 * authorized-users / requests / dormant sub-tools remain bespoke surfaces coupled
 * to legacy #wholesale and keep a "manage in classic view" link.
 * Flag-gated (?ui=1) at #wholesale-v2, side-by-side.
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

  // Label maps mirror wholesale.js (kept local — read-only display lookups).
  var NET_TERMS = { DUE_ON_RECEIPT: 'Due on receipt', NET_15: 'NET-15', NET_30: 'NET-30', NET_45: 'NET-45', NET_60: 'NET-60' };
  var ACCOUNT_TYPES = { retailer: 'Retailer / Boutique', gallery: 'Gallery', museum_store: 'Museum store', rep_agency: 'Sales rep agency', other: 'Other' };
  var PAYMENT_METHODS = { check: 'Check', card: 'Card', ach: 'ACH / bank transfer' };
  var STATUS_LABEL = { active: 'Active', on_hold: 'On hold', closed: 'Closed' };
  var STATUS_TONE = { active: 'success', on_hold: 'amber', closed: 'neutral' };

  // Option arrays for the native edit form — mirror wholesale.js WS_* tables
  // ({v,l} ordered) so the selects match the legacy modal exactly.
  var WS_NET_TERMS = [
    { v: 'DUE_ON_RECEIPT', l: 'Due on receipt' }, { v: 'NET_15', l: 'NET-15' },
    { v: 'NET_30', l: 'NET-30' }, { v: 'NET_45', l: 'NET-45' }, { v: 'NET_60', l: 'NET-60' }
  ];
  var WS_ACCOUNT_TYPES = [
    { v: 'retailer', l: 'Retailer / Boutique' }, { v: 'gallery', l: 'Gallery' },
    { v: 'museum_store', l: 'Museum store' }, { v: 'rep_agency', l: 'Sales rep agency' }, { v: 'other', l: 'Other' }
  ];
  var WS_PAYMENT_METHODS = [
    { v: 'check', l: 'Check' }, { v: 'card', l: 'Card' }, { v: 'ach', l: 'ACH / bank transfer' }
  ];
  var WS_ACCOUNT_STATUSES = [
    { v: 'active', l: 'Active' }, { v: 'on_hold', l: 'On hold' }, { v: 'closed', l: 'Closed' }
  ];

  function netLabel(a) { return NET_TERMS[a.netTerms] || '—'; }
  function typeLabel(a) { return ACCOUNT_TYPES[a.accountType] || ''; }
  function payLabel(a) { return PAYMENT_METHODS[a.paymentMethodDefault] || '—'; }
  function accountName(a) { return (a && a.name) || '(unnamed)'; }
  // "Retailer · Northeast · Rep: Jane" — the legacy list subline, for the Type column.
  function typeTerritory(a) {
    var t = typeLabel(a);
    return t + (t && a.territory ? ' · ' : '') + (a.territory || '') + (a.salesRepName ? ' · Rep: ' + a.salesRepName : '') || '—';
  }
  function contactsOf(a) { return a.contacts || (a.primaryContact ? [a.primaryContact] : []); }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('wholesale-v2', {
    label: 'Wholesale account', labelPlural: 'Wholesale', size: 'lg',
    route: 'wholesale-v2',
    recordId: function (a) { return a._key || a.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Account', type: 'text', list: true, required: true, group: 'Account', get: accountName },
      { name: 'typeTerritory', label: 'Type / territory', type: 'text', list: true, readOnly: true, sortable: false, get: typeTerritory },
      { name: 'creditLimit', label: 'Credit limit', type: 'money', list: true, readOnly: true, align: 'right',
        get: function (a) { return N.moneyVal(a, 'creditLimitCents', null); } },
      { name: 'lastOrderAt', label: 'Last order', type: 'date', list: true, readOnly: true, get: function (a) { return a.lastOrderAt || null; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'on_hold', 'closed'],
        get: function (a) { return a.status || 'active'; },
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, a) {
        var tiles = UI.tiles([
          { k: 'Credit limit', v: (N.money(N.moneyVal(a, 'creditLimitCents', null)) || '—'), hero: true },
          { k: 'Net terms', v: esc(netLabel(a)) },
          { k: 'Account type', v: esc(typeLabel(a) || '—') },
          { k: 'Last order', v: a.lastOrderAt ? N.date(a.lastOrderAt) : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'contacts', label: 'Contacts' }, { key: 'notes', label: 'Notes' }
        ], 'ov');

        // Overview — account + terms + credit + tax/resale.
        var account = UI.kv([
          { k: 'Status', v: UI.badge(STATUS_LABEL[a.status] || 'Active', STATUS_TONE[a.status] || 'neutral') },
          { k: 'Account type', v: esc(typeLabel(a) || '—') },
          { k: 'Territory', v: a.territory ? esc(a.territory) : '—' },
          { k: 'Sales rep', v: a.salesRepName ? esc(a.salesRepName) : '—' },
          { k: 'Added', v: a.createdAt ? N.date(a.createdAt) : '—' }
        ]);
        var terms = UI.kv([
          { k: 'Net terms', v: esc(netLabel(a)) },
          { k: 'Credit limit', v: N.money(N.moneyVal(a, 'creditLimitCents', null)) || '—' },
          { k: 'Opener minimum', v: N.money(N.moneyVal(a, 'minimumOpenerCents', null)) || '—' },
          { k: 'Reorder minimum', v: N.money(N.moneyVal(a, 'minimumReorderCents', null)) || '—' },
          { k: 'Default payment', v: esc(payLabel(a)) }
        ]);
        var taxResale = UI.kv([
          { k: 'Tax-exempt', v: (a.taxExempt !== false) ? 'Yes' : 'No' },
          { k: 'Resale cert', v: a.resaleCertNumber ? esc(a.resaleCertNumber) : '—' }
        ]);
        // Account create/edit is NATIVE now (the Edit button on this slide-out).
        // What still has NO V2 home: orders, AR aging, cadence, authorized-user
        // links, access requests, and dormant tooling — those stay bespoke on
        // legacy #wholesale. navigateToClassic so the V2 route remap doesn't loop
        // back here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="WholesaleV2.classic()">Orders / AR / users in classic view →</button></div>';

        // Contacts — primary + all contacts on file.
        var contacts = contactsOf(a);
        var contactsBody = contacts.length ? UI.relatedTable([
          { label: 'Name', render: function (c) { return esc(c.name || '—') + (c.role ? ' <span class="mu-sub">· ' + esc(c.role) + '</span>' : ''); } },
          { label: 'Email', render: function (c) { return c.email ? '<span class="mu-sub">' + esc(c.email) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Phone', render: function (c) { return c.phone ? '<span class="mu-sub">' + esc(c.phone) + '</span>' : '<span class="mu-sub">—</span>'; } }
        ], contacts) : '<span class="mu-sub">No contacts on file.</span>';

        // Notes — operator notes + rep notes.
        var notesBody = (a.notes || a.repNotes)
          ? (a.notes ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(a.notes) + '</div>' : '') +
            (a.repNotes ? '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin:12px 0 6px;">Rep notes</div>' +
              '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(a.repNotes) + '</div>' : '')
          : '<span class="mu-sub">No notes.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Account', account) + UI.card('Terms & credit', terms) + UI.card('Tax & resale', taxResale + manage) + '</div>' +
          '<div class="mu-pane" data-pane="contacts" hidden>' + UI.cardTable('Contacts (' + contacts.length + ')', contactsBody) + '</div>' +
          '<div class="mu-pane" data-pane="notes" hidden>' + UI.card('Notes', notesBody) + '</div>';
      },
      // Native edit form — the legacy modal field set (openNewWholesaleAccountModal),
      // grouped. Mirrors saveWholesaleAccount inputs: name (required), account type,
      // status, NET terms, default payment, credit limit / opener min / reorder min
      // ($ → cents), sales rep, territory, resale cert, tax-exempt, notes.
      editRender: function (a, mode) {
        a = a || {};
        function sel(id, opts, selected) {
          var o = opts.map(function (x) { return '<option value="' + esc(x.v) + '"' + (x.v === selected ? ' selected' : '') + '>' + esc(x.l) + '</option>'; }).join('');
          return '<select class="form-input" id="' + id + '" style="width:100%;">' + o + '</select>';
        }
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row(parts) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + parts.join('') + '</div>'; }
        function dollars(cents) { return (cents || cents === 0) ? (cents / 100) : ''; }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New wholesale account' : 'Edit this account') + '</div>' +
          fg('Account name *', '<input class="form-input" id="wsV2Name" value="' + esc(a.name || '') + '" style="width:100%;" placeholder="Coastal Home Boutique">') +
          row([
            fg('Type', sel('wsV2Type', WS_ACCOUNT_TYPES, a.accountType || 'retailer'), true),
            fg('Status', sel('wsV2Status', WS_ACCOUNT_STATUSES, a.status || 'active'), true)
          ]) +
          row([
            fg('NET terms', sel('wsV2NetTerms', WS_NET_TERMS, a.netTerms || 'NET_30'), true),
            fg('Default payment', sel('wsV2PaymentMethod', WS_PAYMENT_METHODS, a.paymentMethodDefault || 'check'), true)
          ]) +
          row([
            fg('Credit limit ($)', '<input class="form-input" type="number" min="0" step="1" id="wsV2CreditLimit" value="' + esc(dollars(a.creditLimitCents)) + '" style="width:100%;" placeholder="5000">', true),
            fg('Opener min ($)', '<input class="form-input" type="number" min="0" step="1" id="wsV2Opener" value="' + esc(dollars(a.minimumOpenerCents)) + '" style="width:100%;" placeholder="500">', true),
            fg('Reorder min ($)', '<input class="form-input" type="number" min="0" step="1" id="wsV2Reorder" value="' + esc(dollars(a.minimumReorderCents)) + '" style="width:100%;" placeholder="250">', true)
          ]) +
          row([
            fg('Sales rep', '<input class="form-input" id="wsV2Rep" value="' + esc(a.salesRepName || '') + '" style="width:100%;" placeholder="Jane Doe">', true),
            fg('Territory', '<input class="form-input" id="wsV2Territory" value="' + esc(a.territory || '') + '" style="width:100%;" placeholder="Northeast">', true)
          ]) +
          row([
            fg('Resale cert number', '<input class="form-input" id="wsV2ResaleCert" value="' + esc(a.resaleCertNumber || '') + '" style="width:100%;" placeholder="(optional)">', true),
            fg('Tax-exempt', '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;"><input id="wsV2TaxExempt" type="checkbox"' + (a.taxExempt !== false ? ' checked' : '') + '> Tax-exempt</label>', true)
          ]) +
          fg('Notes', '<textarea class="form-input" id="wsV2Notes" rows="2" style="width:100%;resize:vertical;">' + esc(a.notes || '') + '</textarea>');
      }
    },
    onSave: function (rec, mode) {
      if (!window.WholesaleBridge) { if (window.showToast) showToast('Wholesale engine still loading — try again', true); return false; }
      function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
      function toCents(id) {
        var v = (val(id) || '').trim();
        if (!v) return null;
        var n = parseFloat(v);
        return isNaN(n) ? null : Math.round(n * 100);
      }
      var name = (val('wsV2Name') || '').trim();
      if (!name) { if (window.showToast) showToast('Name is required', true); return false; }
      // Mirror the EXACT shape saveWholesaleAccount() builds.
      var data = {
        name: name,
        accountType: val('wsV2Type'),
        status: val('wsV2Status'),
        netTerms: val('wsV2NetTerms'),
        paymentMethodDefault: val('wsV2PaymentMethod'),
        creditLimitCents: toCents('wsV2CreditLimit'),
        minimumOpenerCents: toCents('wsV2Opener'),
        minimumReorderCents: toCents('wsV2Reorder'),
        salesRepName: (val('wsV2Rep') || '').trim() || null,
        territory: (val('wsV2Territory') || '').trim() || null,
        resaleCertNumber: (val('wsV2ResaleCert') || '').trim() || null,
        taxExempt: !!(document.getElementById('wsV2TaxExempt') || {}).checked,
        notes: (val('wsV2Notes') || '').trim() || null
      };
      if (mode === 'create') {
        return Promise.resolve(window.WholesaleBridge.create(data)).then(function () {
          if (window.showToast) showToast('Account created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[wholesale-v2] create', e); if (window.showToast) showToast('Error saving account.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.WholesaleBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, data);
        if (window.showToast) showToast('Account updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[wholesale-v2] update', e); if (window.showToast) showToast('Error updating account.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure the legacy wholesale module is loaded so window.WholesaleBridge
    // (the delegated write path) exists — mirrors contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('wholesale'); } catch (e) {} }
    Promise.resolve(MastDB.wholesaleAccounts.list(500)).then(function (snap) {
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var a = val[k];
        if (a && typeof a === 'object') { a = Object.assign({ _key: k }, a); a.status = a.status || 'active'; out.push(a); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[wholesale-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (a) { return (a.status || 'active') === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (a) {
        return String(a.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(a.territory || '').toLowerCase().indexOf(q) >= 0 ||
               String(a.salesRepName || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('wholesale-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('wholesaleV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'wholesaleV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['on_hold', 'On hold'], ['closed', 'Closed']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="WholesaleV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Wholesale',
        count: N.count(V2.rows.length) + ' account' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-primary" onclick="WholesaleV2.create()">+ New account</button>' +
          '<button class="btn btn-secondary" onclick="WholesaleV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, territory or rep…" value="' + esc(V2.q) +
        '" oninput="WholesaleV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('wholesale-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'WholesaleV2.sort', onRowClickFnName: 'WholesaleV2.open',
        empty: { title: 'No wholesale accounts', message: V2.loaded ? 'Add a boutique, gallery or rep agency to get started.' : 'Loading…' }
      });
  }

  window.WholesaleV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'creditLimit' || key === 'lastOrderAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('wholesale-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('wholesale-v2', rec, 'read');
      });
    },
    create: function () {
      // Ensure the legacy module (and thus window.WholesaleBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('wholesale'); } catch (e) {} }
      MastEntity.openRecord('wholesale-v2', {}, 'create');
    },
    // Orders, AR aging, cadence, authorized-user links, access requests, and
    // dormant tooling are still bespoke on legacy #wholesale (no V2 home).
    // Account create/edit is native. navigateToClassic so the V2 route remap
    // doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('wholesale');
      else if (typeof navigateTo === 'function') navigateTo('wholesale');
    },
    exportCsv: function () { return MastEntity.exportRows('wholesale-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('wholesale-v2', {
    routes: { 'wholesale-v2': { tab: 'wholesaleV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
