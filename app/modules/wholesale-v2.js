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
 * Read-focused: editing a B2B account is complex and storefront-coupled (pricing
 * tiers, NET-terms versioning, credit/MOQ rules, resale-cert/tax-exempt handling,
 * authorized-user links) and stays single-sourced on legacy #wholesale via a
 * "manage in classic view" link. This twin re-hosts the VIEW only — no onSave,
 * no edit form, no orders/AR/cadence sub-tools (those stay on legacy too).
 * Flag-gated (?ui=1) at #wholesale-v2, side-by-side; never touches wholesale.js.
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
      { name: 'name', label: 'Account', type: 'text', list: true, readOnly: true, group: 'Account', get: accountName },
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
        // Storefront-coupled B2B pricing/terms editing stays on legacy #wholesale.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="WholesaleV2.classic()">Manage in classic view →</button></div>';

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
      }
    }
    // No onSave → no Edit button (B2B pricing/terms editing stays on legacy #wholesale).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

  function load() {
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
        actionsHtml: '<button class="btn btn-secondary" onclick="WholesaleV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, territory or rep…" value="' + esc(V2.q) +
        '" oninput="WholesaleV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('wholesale-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'WholesaleV2.sort', onRowClickFnName: 'WholesaleV2.open',
        empty: { title: 'No wholesale accounts', message: V2.loaded ? 'Add boutiques, galleries or rep agencies in the classic Wholesale view.' : 'Loading…' }
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
    // Storefront-coupled B2B editing → classic Wholesale view. Use
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
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
