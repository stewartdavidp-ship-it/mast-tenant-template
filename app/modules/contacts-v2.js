/**
 * contacts-v2.js — read-focused Faceted Record twin of the legacy Contacts (CRM)
 * surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy contacts.js (#contacts) hosts the contact list as a table and swaps the
 * pane in-place to a read/edit contact detail (renderContactDetail: Identity /
 * Notes / Links / Record cards + a customer-signals panel + an interaction
 * timeline) with its own Edit toggle and Log-Interaction modal. This twin
 * re-hosts that VIEW on the Entity Engine: a schema-driven list + a read-focused
 * Faceted Record slide-out (Overview / Interactions / Notes facets).
 *
 * Variant (doc 17 §1a): a contact is a person record (party-shaped — identity +
 * the interactions logged against it + an optional linked customer) with NO
 * governed lifecycle. There is no status field on the record; its CATEGORY
 * (Supplier / Gallery / Press / …) is the classifier and the legacy detail
 * renders it as the prominent badge under the name. So category is modelled as
 * the engine's single status-typed field → it becomes the header badge + a list
 * badge. → Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused: creating/editing a contact and logging interactions are bespoke
 * forms + modals coupled to the legacy Contacts module (inline edit toggle, Log
 * Interaction, inquiry Respond, Google/Drive sync). Those stay single-sourced on
 * legacy #contacts via a "manage in classic view" link. This twin re-hosts the
 * VIEW only — no onSave, no edit form. Flag-gated (?ui=1) at #contacts-v2,
 * side-by-side; never touches contacts.js.
 *
 * Data: contacts live at admin/contacts (MastDB.contacts.list → that subtree);
 * each contact's interactions are nested under contact.interactions (already in
 * memory from the list read — zero extra queries, mirrors contacts.js). The
 * contact→customer link is the admin/customerIndexes/byContactId map (one cheap
 * one-shot read loaded with the list).
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

  // Mirror contacts.js CONTACT_CATEGORIES (the classifier). Tone the badge by
  // category so the list + header read at a glance (neutral for the catch-all).
  var CONTACT_CATEGORIES = ['Supplier', 'Facilities', 'Gallery', 'Marketplace', 'Event Organizer', 'Partner', 'Student', 'Press', 'Other'];
  var CATEGORY_TONE = {
    Supplier: 'teal', Facilities: 'info', Gallery: 'amber', Marketplace: 'amber',
    'Event Organizer': 'info', Partner: 'success', Student: 'teal', Press: 'warning', Other: 'neutral'
  };
  function categoryOf(c) { return (c && c.category) || 'Other'; }
  function contactName(c) { return (c && c.name) || '(unnamed)'; }

  // Interactions are nested on the contact (admin/contacts/{id}/interactions) —
  // already loaded by the list read, like contacts.js _lastInteraction. Newest
  // first. Each: { id, date, type, notes, documents[], loggedBy, createdAt }.
  function interactionsOf(c) {
    var raw = c && c.interactions;
    if (!raw) return [];
    var arr = Object.keys(raw).map(function (k) { return raw[k]; }).filter(function (x) { return x && typeof x === 'object'; });
    arr.sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
    return arr;
  }
  function lastInteraction(c) { var a = interactionsOf(c); return a.length ? a[0] : null; }
  var INTERACTION_TONE = {
    Call: 'info', Email: 'teal', Meeting: 'amber', 'Site Visit': 'amber',
    Payment: 'success', 'Signed Doc': 'success', Other: 'neutral'
  };
  // The contact→customer link (admin/customerIndexes/byContactId/{contactId}).
  function linkedCustomerId(c) {
    var id = c && (c._key || c.id);
    return id ? (V2.byContactId[id] || null) : null;
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('contacts-v2', {
    label: 'Contact', labelPlural: 'Contacts', size: 'md',
    route: 'contacts-v2',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true, group: 'Identity', get: contactName },
      { name: 'company', label: 'Company', type: 'text', list: true, readOnly: true, get: function (c) { return c.company || '—'; } },
      { name: 'email', label: 'Email', type: 'text', list: true, readOnly: true, get: function (c) { return c.email || '—'; } },
      { name: 'phone', label: 'Phone', type: 'text', list: true, readOnly: true, sortable: false, get: function (c) { return c.phone || '—'; } },
      { name: 'interactionCount', label: 'Interactions', type: 'number', list: true, readOnly: true, align: 'right', get: function (c) { return interactionsOf(c).length; } },
      // Category is the contact's classifier → the engine's single status field
      // (header badge in detail, badge in the list). Mirrors the legacy detail's
      // prominent category badge under the name.
      { name: 'category', label: 'Category', type: 'status', list: true, readOnly: true,
        options: CONTACT_CATEGORIES, get: categoryOf,
        tone: function (v) { return CATEGORY_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, c) {
        var ints = interactionsOf(c);
        var last = ints.length ? ints[0] : null;
        var linkedId = linkedCustomerId(c);

        var tiles = UI.tiles([
          { k: 'Category', v: UI.badge(categoryOf(c), CATEGORY_TONE[categoryOf(c)] || 'neutral'), hero: true },
          { k: 'Interactions', v: N.count(ints.length) },
          { k: 'Last contact', v: last ? esc(last.date || '—') : '—' },
          { k: 'Customer', v: linkedId ? UI.badge('Linked', 'success') : '<span class="mu-sub">Not linked</span>' }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' },
          { key: 'interactions', label: 'Interactions' },
          { key: 'notes', label: 'Notes' }
        ], 'ov');

        // ── Overview — contact identity + links + record meta ──
        var emailV = c.email
          ? '<a href="mailto:' + esc(c.email) + '" style="color:var(--teal,teal);">' + esc(c.email) + '</a>' : '—';
        var phoneV = c.phone
          ? '<a href="tel:' + esc(c.phone) + '" style="color:var(--teal,teal);">' + esc(c.phone) + '</a>' : '—';
        var websiteV = c.website
          ? '<a href="' + esc(c.website) + '" target="_blank" rel="noopener" style="color:var(--teal,teal);">' + esc(c.website) + '</a>' : '—';
        var identity = UI.kv([
          { k: 'Name', v: esc(contactName(c)) },
          { k: 'Company', v: c.company ? esc(c.company) : '—' },
          { k: 'Category', v: UI.badge(categoryOf(c), CATEGORY_TONE[categoryOf(c)] || 'neutral') },
          { k: 'Email', v: emailV },
          { k: 'Phone', v: phoneV },
          { k: 'Website', v: websiteV },
          { k: 'Address', v: c.address ? esc(c.address) : '—' }
        ]);

        // Linked customer + sync links. Editing identity / managing the customer
        // link / Google sync all stay on legacy — surface the state read-only and
        // point to the classic view (drilling to customers-v2 is out of scope for
        // a read twin; the link map is loaded but the customer record is not).
        var driveV = c.driveFolderLink
          ? '<a href="' + esc(c.driveFolderLink) + '" target="_blank" rel="noopener" style="color:var(--teal,teal);">Open folder</a>' : '—';
        var googleV = c.googleContactId
          ? '<a href="https://contacts.google.com/person/' + esc(String(c.googleContactId).replace('people/', '')) + '" target="_blank" rel="noopener" style="color:var(--teal,teal);">Synced</a>'
          : '<span class="mu-sub">Not synced</span>';
        var links = UI.kv([
          { k: 'Linked customer', v: linkedId ? UI.badge('Linked', 'success') : '<span class="mu-sub">None</span>' },
          { k: 'Drive folder', v: driveV },
          { k: 'Google Contact', v: googleV }
        ]);

        function fmtDT(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d.getTime()) ? esc(iso) : esc(d.toLocaleString()); }
        var record = UI.kv([
          { k: 'Created', v: fmtDT(c.createdAt) },
          { k: 'Created by', v: c.createdBy ? esc(c.createdBy) : '—' },
          { k: 'Updated', v: fmtDT(c.updatedAt) }
        ]);
        // Identity / linked-customer / interaction editing stays on legacy
        // #contacts. navigateToClassic so the V2 route remap doesn't loop back here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="ContactsV2.classic()">Manage in classic view →</button></div>';

        // ── Interactions facet — the cheap in-memory related collection ──
        var intCols = [
          { label: 'Date', render: function (it) { return '<span class="mu-sub">' + esc(it.date || '—') + '</span>'; } },
          { label: 'Type', render: function (it) { return UI.badge(it.type || '—', INTERACTION_TONE[it.type] || 'neutral'); } },
          { label: 'Notes', render: function (it) {
              var n = it.notes ? esc(it.notes) : '—';
              var docs = (it.documents && it.documents.length) ? ' <span class="mu-sub">(' + it.documents.length + ' doc' + (it.documents.length === 1 ? '' : 's') + ')</span>' : '';
              return n + docs;
            } }
        ];
        var interactionsBody = ints.length
          ? UI.relatedTable(intCols, ints)
          : '<span class="mu-sub">No interactions logged yet. Log interactions in the classic Contacts view.</span>';

        // ── Notes facet ──
        var notesBody = c.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(c.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Identity', identity) +
            UI.card('Links', links) +
            UI.card('Record', record + manage) +
          '</div>' +
          '<div class="mu-pane" data-pane="interactions" hidden>' +
            UI.cardTable('Interactions (' + ints.length + ')', interactionsBody) +
          '</div>' +
          '<div class="mu-pane" data-pane="notes" hidden>' +
            UI.card('Notes', notesBody) +
          '</div>';
      }
    }
    // No onSave → no Edit button (contact editing stays on legacy #contacts).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, byContactId: {}, sortKey: 'name', sortDir: 'asc', q: '', categoryFilter: 'all', loaded: false };

  function load() {
    // Contacts (with nested interactions) + the contact→customer index load
    // together; both one-shot keyed-object reads (no listeners).
    Promise.all([
      Promise.resolve(MastDB.contacts.list()).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/customerIndexes/byContactId')).catch(function () { return null; })
    ]).then(function (res) {
      var cv = res[0] || {};
      var out = [];
      Object.keys(cv).forEach(function (k) {
        var c = cv[k];
        if (c && typeof c === 'object') { out.push(Object.assign({ _key: k }, c)); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.byContactId = res[1] || {};
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[contacts-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.categoryFilter !== 'all') rows = rows.filter(function (c) { return categoryOf(c) === V2.categoryFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (c) {
        return String(c.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(c.email || '').toLowerCase().indexOf(q) >= 0 ||
               String(c.company || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('contacts-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('contactsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'contactsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var cats = ['all'].concat(CONTACT_CATEGORIES);
    var filters = cats.map(function (cat) {
      var on = V2.categoryFilter === cat;
      var label = cat === 'all' ? 'All' : cat;
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ContactsV2.filter(\'' + esc(cat) + '\')">' + esc(label) + '</button>';
    }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Contacts',
        count: N.count(V2.rows.length) + ' contact' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="ContactsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, email or company…" value="' + esc(V2.q) +
        '" oninput="ContactsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('contacts-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ContactsV2.sort', onRowClickFnName: 'ContactsV2.open',
        empty: { title: 'No contacts', message: V2.loaded ? 'Add contacts in the classic Contacts view.' : 'Loading…' }
      });
  }

  window.ContactsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'interactionCount' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (cat) { V2.categoryFilter = cat; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('contacts-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('contacts-v2', rec, 'read');
      });
    },
    // Bespoke contact edit + interaction logging → classic Contacts view. Use
    // navigateToClassic so the V2 route remap doesn't loop back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('contacts');
      else if (typeof navigateTo === 'function') navigateTo('contacts');
    },
    exportCsv: function () { return MastEntity.exportRows('contacts-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('contacts-v2', {
    routes: { 'contacts-v2': { tab: 'contactsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
