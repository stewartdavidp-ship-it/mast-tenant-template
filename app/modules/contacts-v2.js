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
 * Create + edit are NATIVE here: a custom detail.editRender (the identity field
 * set, grouped like the legacy modal/detail) + an onSave that DELEGATES to
 * window.ContactsBridge (exposed in contacts.js) so the contact write, the
 * create/update audit, and the background Google-Contact create/push stay
 * single-sourced — this twin never reimplements that logic (mirrors the
 * materials-v2 / MakerMaterialsBridge precedent). Classic burn-down (operations
 * Wave A): logging interactions, inquiry Respond, and Google sync are NATIVE
 * here too, over ContactsBridge cores (logInteraction / prepareInquiryResponse
 * / respondToInquiry / googleStatus / googleConnect / googleSync) — the classic
 * link is retired. Flag-gated (?ui=1) at #contacts-v2, side-by-side.
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
      { name: 'name', label: 'Name', type: 'text', list: true, required: true, group: 'Identity', get: contactName },
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
        var cid0 = c._key || c.id;
        // All formerly-classic actions are native (classic burn-down Wave A):
        // log interaction + respond by email live here, over ContactsBridge.
        var manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="ContactsV2.logInteraction(\'' + esc(cid0) + '\')">+ Log interaction</button>' +
          (c.email ? '<button class="btn btn-secondary" onclick="ContactsV2.respond(\'' + esc(cid0) + '\')">Respond by email →</button>' : '') +
          '</div>';
        // Delete (operations W3): confirm + writeAudit, gated on
        // can('contacts','delete'). Interactions are nested on the doc (they
        // cascade); the linked customer + Google contact are NOT touched.
        var cid = c._key || c.id;
        if (typeof window.can !== 'function' || window.can('contacts', 'delete')) {
          manage += '<div style="margin-top:10px;"><button class="btn btn-secondary btn-small" style="color:var(--text-danger);" onclick="ContactsV2.remove(\'' + esc(cid) + '\')">Delete contact</button></div>';
        }

        // ── Interactions facet — the cheap in-memory related collection ──
        var intCols = [
          { label: 'Date', render: function (it) { return '<span class="mu-sub">' + esc(it.date || '—') + '</span>'; } },
          { label: 'Type', render: function (it) { return UI.badge(it.type || '—', INTERACTION_TONE[it.type] || 'neutral'); } },
          { label: 'Notes', render: function (it) {
              var n = it.notes ? esc(it.notes) : '—';
              var docs = (it.documents && it.documents.length) ? ' <span class="mu-sub">(' + MastFormat.countNoun(it.documents.length, 'doc') + ')</span>' : '';
              return n + docs;
            } }
        ];
        var addInt = '<div style="margin-bottom:10px;"><button class="btn btn-secondary btn-small" onclick="ContactsV2.logInteraction(\'' + esc(cid0) + '\')">+ Log interaction</button></div>';
        var interactionsBody = addInt + (ints.length
          ? UI.relatedTable(intCols, ints)
          : '<span class="mu-sub">No interactions logged yet — calls, emails, meetings and site visits land here.</span>');

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
      },
      // Native edit form — the legacy modal/detail identity field set, grouped.
      // Field set mirrors contacts.js openAddContactModal / renderContactDetail:
      // name (required), email, phone, company, category (required), website,
      // address, notes, driveFolderLink. Spot Google/Drive *sync* setup stays on
      // legacy (not edited here — a partial update preserves googleContactId etc).
      editRender: function (c, mode) {
        c = c || {};
        var catOpts = CONTACT_CATEGORIES.map(function (cat) {
          return '<option value="' + esc(cat) + '"' + (categoryOf(c) === cat ? ' selected' : '') + '>' + esc(cat) + '</option>';
        }).join('');
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New contact' : 'Edit this contact') + '</div>' +
          fg('Name *', '<input class="form-input" id="ctV2Name" name="name" value="' + esc(c.name || '') + '" style="width:100%;" placeholder="Company or person name">') +
          row2(
            fg('Email', '<input class="form-input" type="email" id="ctV2Email" value="' + esc(c.email || '') + '" style="width:100%;" placeholder="email@example.com">', true),
            fg('Phone', '<input class="form-input" type="tel" id="ctV2Phone" value="' + esc(c.phone || '') + '" style="width:100%;" placeholder="(555) 123-4567">', true)
          ) +
          fg('Company / Organization', '<input class="form-input" id="ctV2Company" value="' + esc(c.company || '') + '" style="width:100%;">') +
          row2(
            fg('Category *', '<select class="form-input" id="ctV2Category" style="width:100%;">' + catOpts + '</select>', true),
            fg('Website', '<input class="form-input" type="url" id="ctV2Website" value="' + esc(c.website || '') + '" style="width:100%;" placeholder="https://...">', true)
          ) +
          fg('Address', '<input class="form-input" id="ctV2Address" value="' + esc(c.address || '') + '" style="width:100%;" placeholder="Street, City, State ZIP">') +
          fg('Notes', '<textarea class="form-input" id="ctV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(c.notes || '') + '</textarea>') +
          fg('Drive folder link', '<input class="form-input" id="ctV2Drive" value="' + esc(c.driveFolderLink || '') + '" style="width:100%;" placeholder="https://drive.google.com/drive/folders/...">');
      }
    },
    onSave: function (rec, mode) {
      if (!window.ContactsBridge) { if (window.showToast) showToast('Contacts engine still loading — try again', true); return false; }
      var data = {
        name: (document.getElementById('ctV2Name') || {}).value || '',
        email: ((document.getElementById('ctV2Email') || {}).value || '').trim() || null,
        phone: ((document.getElementById('ctV2Phone') || {}).value || '').trim() || null,
        company: ((document.getElementById('ctV2Company') || {}).value || '').trim() || null,
        category: (document.getElementById('ctV2Category') || {}).value || 'Other',
        website: ((document.getElementById('ctV2Website') || {}).value || '').trim() || null,
        address: ((document.getElementById('ctV2Address') || {}).value || '').trim() || null,
        notes: ((document.getElementById('ctV2Notes') || {}).value || '').trim() || null,
        driveFolderLink: ((document.getElementById('ctV2Drive') || {}).value || '').trim() || null
      };
      if (!data.name.trim()) { if (window.showToast) showToast('Contact name is required.', true); return false; }

      if (mode === 'create') {
        // "Add linked contact from a customer" (customers-core) stashes a
        // _pendingContactCustomerLink before navigating here; on create we link
        // the new contact to that customer (mirrors legacy saveNewContact's
        // linkedIds.contactIds + byContactId index write). T6 — absorbed from the
        // legacy modal path so the customers flow keeps working post-retire.
        var pendingLink = window._pendingContactCustomerLink || null;
        return Promise.resolve(window.ContactsBridge.create(data)).then(function (newId) {
          if (window.showToast) showToast('Contact created.');
          if (pendingLink && pendingLink.customerId && newId) {
            return linkContactToCustomer(newId, pendingLink.customerId).then(function () {
              window._pendingContactCustomerLink = null; reloadSoon(); return true;
            }).catch(function (e) { console.error('[contacts-v2] customer-link', e); reloadSoon(); return true; });
          }
          reloadSoon(); return true;
        }).catch(function (e) { console.error('[contacts-v2] create', e); if (window.showToast) showToast('Error saving contact.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.ContactsBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, data);
        if (window.showToast) showToast('Contact updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[contacts-v2] update', e); if (window.showToast) showToast('Error updating contact.', true); return false; });
    }
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
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  // Bridge gate (classic burn-down Wave A): every native action runs through
  // ContactsBridge; load the legacy module first if the bridge isn't up yet.
  function withBridge(fn) {
    // ContactsBridge is now defined in the absorbed IIFE at the END of this file
    // (T6), so it is always present once contacts-v2.js has executed.
    if (window.ContactsBridge) return fn(window.ContactsBridge);
    if (window.showToast) showToast('Contacts engine still loading — try again', true);
  }
  // Refresh the list AND the open record SO after a write.
  function refreshOpen(id) {
    Promise.resolve(MastDB.contacts.get(id)).then(function (c) {
      if (!c) return;
      var rec = Object.assign({ _key: id }, c);
      V2.byId[id] = rec;
      MastEntity.openRecord('contacts-v2', rec, 'read', true);
    }).catch(function () {});
    reloadSoon();
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
        count: N.count(V2.rows.length) + ' ' + MastFormat.plural(V2.rows.length, 'contact'),
        actionsHtml: '<button class="btn btn-primary" onclick="ContactsV2.create()">+ New contact</button>' +
          '<button class="btn btn-secondary" onclick="ContactsV2.google()">Google Contacts</button>' +
          '<button class="btn btn-secondary" onclick="ContactsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, email or company…" value="' + esc(V2.q) +
        '" oninput="ContactsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('contacts-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ContactsV2.sort', onRowClickFnName: 'ContactsV2.open',
        empty: { title: 'No contacts', message: V2.loaded ? 'Add a contact to get started.' : 'Loading…' }
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
    create: function () {
      // Prefill name/email when opened from the customers "add linked contact"
      // flow (customers-core stashes _pendingContactCustomerLink). T6.
      var pending = window._pendingContactCustomerLink || null;
      var seed = pending ? { name: pending.prefillName || '', email: pending.prefillEmail || '' } : {};
      MastEntity.openRecord('contacts-v2', seed, 'create');
    },
    // ── Classic burn-down Wave A: native sub-surface actions ─────────
    // All writes via ContactsBridge cores; modals use the shared app modal.
    logInteraction: function (id) {
      if (typeof window.can === 'function' && !window.can('contacts', 'edit')) {
        if (window.showToast) showToast('You don\u2019t have permission to edit contacts', true); return;
      }
      withBridge(function (b) {
        var types = (b.INTERACTION_TYPES || ['Call', 'Email', 'Meeting', 'Site Visit', 'Payment', 'Signed Doc', 'Other'])
          .map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('');
        var today = new Date().toISOString().slice(0, 10);
        openModal(
          '<div class="modal-header"><h3>Log interaction</h3>' +
            '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
          '<div class="modal-body">' +
            '<div class="form-group"><label>Date</label><input type="date" id="ctV2IntDate" value="' + today + '"></div>' +
            '<div class="form-group"><label>Type</label><select id="ctV2IntType">' + types + '</select></div>' +
            '<div class="form-group"><label>Notes *</label><textarea id="ctV2IntNotes" rows="4" placeholder="What happened? What was decided?"></textarea></div>' +
            '<div class="form-group"><label>Attach document (optional)</label>' +
              '<input type="text" id="ctV2IntDrive" placeholder="Paste Google Drive file URL">' +
              '<p class="mu-sub" style="margin-top:4px;">Paste a Drive URL to attach file metadata to this interaction.</p></div>' +
          '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
            '<button class="btn btn-primary" data-cid="' + esc(id) + '" onclick="ContactsV2.saveInteraction(this.dataset.cid)">Log interaction</button>' +
          '</div>');
      });
    },
    saveInteraction: function (id) {
      withBridge(function (b) {
        Promise.resolve(b.logInteraction(id, {
          date: ((document.getElementById('ctV2IntDate') || {}).value || ''),
          type: ((document.getElementById('ctV2IntType') || {}).value || 'Other'),
          notes: ((document.getElementById('ctV2IntNotes') || {}).value || ''),
          driveUrl: ((document.getElementById('ctV2IntDrive') || {}).value || '')
        })).then(function () {
          if (typeof closeModal === 'function') closeModal();
          if (window.showToast) showToast('Interaction logged');
          refreshOpen(id);
        }).catch(function (e) {
          if (window.showToast) showToast(e && e.message || 'Could not log interaction', true);
        });
      });
    },
    respond: function (id) {
      if (typeof window.can === 'function' && !window.can('contacts', 'edit')) {
        if (window.showToast) showToast('You don\u2019t have permission to edit contacts', true); return;
      }
      withBridge(function (b) {
        Promise.resolve(b.prepareInquiryResponse(id, null, null)).then(function (prep) {
          openModal(
            '<div class="modal-header"><h3>Respond by email</h3>' +
              '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
            '<div class="modal-body">' +
              '<div class="form-group"><label>To</label><input type="text" value="' + esc(prep.toEmail) + '" readonly style="opacity:0.7;cursor:default;"></div>' +
              '<div class="form-group"><label>Subject</label><input type="text" id="ctV2RespSubject" value="' + esc(prep.subject) + '"></div>' +
              '<div class="form-group"><label>Message</label><textarea id="ctV2RespBody" rows="12" style="font-family:monospace;font-size:0.85rem;white-space:pre-wrap;">' + esc(prep.bodyTemplate) + '</textarea></div>' +
              '<input type="hidden" id="ctV2RespInquiryId" value="' + esc(prep.inquiryId || '') + '">' +
              '<input type="hidden" id="ctV2RespToEmail" value="' + esc(prep.toEmail) + '">' +
            '</div>' +
            '<div class="modal-footer">' +
              '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
              '<button class="btn btn-primary" id="ctV2RespSend" data-cid="' + esc(id) + '" onclick="ContactsV2.sendResponse(this.dataset.cid)">Send response</button>' +
            '</div>');
        }).catch(function (e) {
          if (window.showToast) showToast(e && e.message || 'Could not prepare response', true);
        });
      });
    },
    sendResponse: function (id) {
      var btn = document.getElementById('ctV2RespSend');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending\u2026'; }
      var toEmail = ((document.getElementById('ctV2RespToEmail') || {}).value || '');
      withBridge(function (b) {
        Promise.resolve(b.respondToInquiry(id, {
          subject: ((document.getElementById('ctV2RespSubject') || {}).value || ''),
          body: ((document.getElementById('ctV2RespBody') || {}).value || ''),
          toEmail: toEmail,
          inquiryId: ((document.getElementById('ctV2RespInquiryId') || {}).value || '')
        })).then(function () {
          if (typeof closeModal === 'function') closeModal();
          if (window.showToast) showToast('Response sent to ' + toEmail);
          refreshOpen(id);
        }).catch(function (e) {
          if (btn) { btn.disabled = false; btn.textContent = 'Send response'; }
          if (window.showToast) showToast('Failed to send: ' + (e && e.message || e), true);
        });
      });
    },
    google: function () {
      withBridge(function (b) {
        Promise.resolve(b.googleStatus()).then(function (connected) {
          openModal(
            '<div class="modal-header"><h3>Google Contacts</h3>' +
              '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
            '<div class="modal-body">' +
              '<div class="form-group" id="ctV2GStatus">' +
                (connected ? U.badge('Connected', 'success') : U.badge('Not connected', 'neutral')) +
              '</div>' +
              (connected
                ? '<div class="form-group"><label><input type="radio" name="ctV2GMode" value="group" checked style="margin-right:8px;">Only contacts in my business group</label></div>' +
                  '<div class="form-group"><label><input type="radio" name="ctV2GMode" value="all" style="margin-right:8px;">All my Google contacts</label></div>'
                : '<p class="mu-sub">Connect your Google account to import contacts and keep Mast contacts pushed to Google.</p>') +
            '</div>' +
            '<div class="modal-footer">' +
              '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
              (connected
                ? '<button class="btn btn-primary" onclick="ContactsV2.googleSync()">Import now</button>'
                : '<button class="btn btn-primary" onclick="ContactsV2.googleConnect()">Connect Google</button>') +
            '</div>');
        });
      });
    },
    googleConnect: function () {
      withBridge(function (b) {
        b.googleConnect(function () {
          if (typeof closeModal === 'function') closeModal();
          ContactsV2.google();   // re-open with refreshed status
        });
      });
    },
    googleSync: function () {
      var mode = document.querySelector('input[name="ctV2GMode"]:checked');
      var syncAll = !!(mode && mode.value === 'all');
      if (typeof closeModal === 'function') closeModal();
      if (window.showToast) showToast('Syncing Google Contacts\u2026');
      withBridge(function (b) {
        Promise.resolve(b.googleSync(syncAll)).then(function (res) {
          if (window.showToast) showToast(res.created > 0 ? res.created + ' contact(s) imported from Google' : 'No new contacts to import');
          load();
        }).catch(function (e) {
          if (window.showToast) showToast('Sync failed: ' + (e && e.message || e), true);
        });
      });
    },
    // Delete — confirm + ContactsBridge.remove (which writeAudits + cleans the
    // byContactId index row). RBAC re-checked here (the button is also gated).
    remove: function (id) {
      if (typeof window.can === 'function' && !window.can('contacts', 'delete')) {
        if (window.showToast) showToast('You don’t have permission to delete contacts', true); return;
      }
      var go = function () {
        if (!window.ContactsBridge || !ContactsBridge.remove) {
          if (window.showToast) showToast('Contacts engine still loading — try again', true); return;
        }
        Promise.resolve(ContactsBridge.remove(id)).then(function () {
          if (window.showToast) showToast('Contact deleted');
          try { U.slideOut.requestCloseForce(); } catch (e) {}
          load();
        }).catch(function (e) {
          console.error('[contacts-v2] delete', e);
          if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true);
        });
      };
      mastConfirm('Delete this contact and its logged interactions? The linked customer record (if any) is not deleted.', { title: 'Delete contact', confirmLabel: 'Delete', danger: true })
        .then(function (ok) { if (ok) go(); });
    },
    exportCsv: function () { return MastEntity.exportRows('contacts-v2', visibleRows(), 'all'); }
  };

  // Link a freshly-created contact to the originating customer — mirrors the
  // legacy saveNewContact atomic linkedIds write (customer.linkedIds.contactIds +
  // byContactId index + in-memory patch via customersAppendLinkedContact). T6.
  function linkContactToCustomer(contactId, customerId) {
    return Promise.resolve(MastDB.get('admin/customers/' + customerId + '/linkedIds')).then(function (linked) {
      linked = linked || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };
      var contactIds = (linked.contactIds || []).slice();
      if (contactIds.indexOf(contactId) === -1) contactIds.push(contactId);
      var now = new Date().toISOString();
      var updates = {};
      updates['admin/customers/' + customerId + '/linkedIds/contactIds'] = contactIds;
      updates['admin/customers/' + customerId + '/updatedAt'] = now;
      updates['admin/customerIndexes/byContactId/' + contactId] = customerId;
      return MastDB.multiUpdate(updates);
    }).then(function () {
      if (typeof window.customersAppendLinkedContact === 'function') {
        try { window.customersAppendLinkedContact(customerId, contactId); } catch (e) {}
      }
    });
  }

  MastAdmin.registerModule('contacts-v2', {
    routes: {
      'contacts-v2': { tab: 'contactsV2Tab', setup: function () { ensureTab(); render(); load(); } },
      // Legacy #contacts route ABSORBED (T6): contacts.js is deleted, so the twin
      // owns the bare route directly (no MAST_V2_ROUTE_MAP remap). The write path
      // (window.ContactsBridge + its inquiry/Google cores) lives in the
      // non-flag-gated IIFE appended below.
      'contacts': { tab: 'contactsV2Tab', setup: function () { ensureTab(); render(); load(); } }
    }
  });
})();


// ============================================================================
// ABSORBED FROM contacts.js (V1) — T6 retirement (absorb-first cut).
//
// contacts-v2 is the sole contacts (CRM) surface; the V1 contacts.js UI is
// deleted. This self-contained, NON-flag-gated IIFE re-hosts — VERBATIM
// (byte-identical) — window.ContactsBridge and its full state-free core closure
// (create/update/remove + logInteraction/prepareInquiryResponse/respondToInquiry
// + the Google-Contacts cluster), the write/lookup path contacts-v2 AND
// inquiries-v2 single-source through. It references only shell globals
// (MastDB / firebase / writeAudit / currentUser / emitTestingEvent /
// fetchDriveFileMetadata / TENANT_CONFIG / TENANT_BRAND / showToast / openModal /
// document) plus its own closure (INTERACTION_TYPES, GOOGLE_CONTACTS_FUNCTIONS_BASE,
// the cores, and a private contactsLoaded cache flag carried so the cores’
// invalidations stay harmless no-ops). Not flag-gated: the bridge must exist for
// inquiries-v2 + the contacts-v2 native actions regardless of the UI-redesign flag.
// ============================================================================
(function () {
  'use strict';

  // V1 list-cache flag; the cores invalidate it. No reader survives the retire
  // (the V1 list is gone), so these stay harmless no-ops.
  var contactsLoaded = false;
  var INTERACTION_TYPES = ['Call', 'Email', 'Meeting', 'Site Visit', 'Payment', 'Signed Doc', 'Other'];

  async function pushContactToGoogle(contact) {
    try {
      var connected = await isGoogleContactsConnected();
      if (!connected || !contact.googleContactId) return;

      var idToken = await currentUser.getIdToken();
      var tenantId = window.TENANT_ID || 'dev';

      var response = await fetch(GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsUpdate', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + idToken,
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({
          resourceName: contact.googleContactId,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          company: contact.company,
          category: contact.category
        })
      });

      if (!response.ok) {
        console.error('Google contact update failed:', await response.text());
      }
    } catch (err) {
      console.error('Push to Google failed:', err);
    }
  }

  async function logInteractionCore(contactId, input) {
    input = input || {};
    var date = (input.date || '').trim();
    var type = input.type || 'Other';
    var notes = (input.notes || '').trim();
    var driveUrl = (input.driveUrl || '').trim();
    if (!notes) throw new Error('Notes are required.');
    if (!date) throw new Error('Date is required.');

    var documents = [];
    if (driveUrl) {
      // Try to fetch Drive file metadata
      var docMeta = await fetchDriveFileMetadata(driveUrl);
      if (docMeta) {
        docMeta.attachedBy = currentUser ? currentUser.uid : 'unknown';
        docMeta.source = 'studio';
        docMeta.notes = '';
        documents.push(docMeta);
      }
    }

    var interactionId = MastUtil.genId('int_');
    var interactionData = {
      id: interactionId,
      date: date,
      loggedBy: currentUser ? currentUser.uid : 'unknown',
      type: type,
      notes: notes,
      documents: documents,
      createdAt: new Date().toISOString()
    };
    await MastDB.contacts.setInteraction(contactId, interactionId, interactionData);
    await writeAudit('create', 'contacts', contactId);
    contactsLoaded = false;
    return interactionData;
  }

  async function prepareInquiryResponseCore(contactId, directInquiryId, specificInteraction) {
    // Load contact
    var contact = await MastDB.contacts.get(contactId);
    if (!contact) throw new Error('Contact not found.');

    // Find the inquiry record — use direct ID if provided, else query by contactId
    var inquiry = null;
    if (directInquiryId) {
      inquiry = await MastDB.get('inquiries/' + directInquiryId);
    }
    if (!inquiry) {
      var iqVal = await MastDB.query('inquiries').orderByChild('contactId').equalTo(contactId).limitToLast(1).once();
      if (iqVal) {
        var keys = Object.keys(iqVal);
        inquiry = iqVal[keys[keys.length - 1]];
      }
    }

    // Use contact email, fall back to inquiry email
    var toEmail = contact.email || (inquiry && inquiry.email) || '';
    if (!toEmail) throw new Error('No email address found for this contact.');

    var brandName = (TENANT_CONFIG && TENANT_CONFIG.brand && TENANT_CONFIG.brand.name) || 'Our Shop';
    var brandEmail = (TENANT_CONFIG && TENANT_CONFIG.email && TENANT_CONFIG.email.from) || '';
    var brandPhone = '';
    try {
      brandPhone = (await MastDB.get('config/brand/phone')) || '';
    } catch (e) { /* no phone */ }

    var firstName = (contact.name || '').split(' ')[0] || 'there';

    // Build subject and quoted content from the specific interaction or inquiry
    var replyContext = '';
    var subjectRef = '';
    if (specificInteraction) {
      subjectRef = specificInteraction.type || 'your message';
      replyContext = specificInteraction.notes || '';
    } else if (inquiry) {
      subjectRef = inquiry.type || 'your inquiry';
      replyContext = inquiry.message || '';
    } else {
      subjectRef = 'your message';
    }
    var originalDate = specificInteraction ? (specificInteraction.date || '') : (inquiry ? (inquiry.createdAt || '').slice(0, 10) : '');
    var inquiryId = inquiry ? (inquiry.id || '') : '';
    var subject = 'Re: ' + subjectRef + ' — ' + brandName;

    // Build signature
    var sigParts = [brandName];
    if (brandEmail) sigParts.push(brandEmail);
    if (brandPhone) sigParts.push(brandPhone);
    var signature = sigParts.join('\n');

    // Build default body template
    var bodyTemplate = 'Hi ' + firstName + ',\n\n' +
      'Thank you for reaching out to ' + brandName + '!\n\n' +
      '\n\n' +
      'Best regards,\n' + signature;

    if (replyContext) {
      bodyTemplate += '\n\n---\nOriginal message' + (originalDate ? ' (' + originalDate + ')' : '') + ':\n' + replyContext;
    }

    return { toEmail: toEmail, subject: subject, bodyTemplate: bodyTemplate, inquiryId: inquiryId };
  }

  async function respondToInquiryCore(contactId, input) {
    input = input || {};
    var subject = (input.subject || '').trim();
    var body = (input.body || '').trim();
    var toEmail = input.toEmail;
    var inquiryId = input.inquiryId || '';
    if (!subject) throw new Error('Subject is required.');
    if (!body) throw new Error('Message body is required.');
    if (!toEmail) throw new Error('Recipient email is required.');

    // Convert plain text body to HTML (preserve line breaks)
    var bodyHtml = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

    // Call Cloud Function to send email. A thrown error (send failed) skips
    // everything below so the record never gets ahead of an email that didn't go.
    var cfResult = await firebase.functions().httpsCallable('sendInquiryResponse')({
      tenantId: MastDB.tenantId(),
      contactId: contactId,
      inquiryId: inquiryId,
      subject: subject,
      body: bodyHtml,
      toEmail: toEmail
    });

    // Record as interaction on the contact (only when we have a contact to attach
    // it to — inquiry leads may have no linked contact yet).
    var now = new Date().toISOString();
    if (contactId) {
      var interactionId = MastUtil.genId('int_');
      await MastDB.contacts.setInteraction(contactId, interactionId, {
        id: interactionId,
        date: now.slice(0, 10),
        type: 'Email',
        notes: subject + ': ' + body.substring(0, 500),
        documents: [],
        loggedBy: currentUser ? currentUser.uid : 'unknown',
        createdAt: now
      });
    }

    // Update inquiry status to 'responded'
    if (inquiryId) {
      await MastDB.set('inquiries/' + inquiryId + '/status', 'responded');
      await MastDB.set('inquiries/' + inquiryId + '/respondedAt', now);
      if (window.writeAudit) { try { await writeAudit('update', 'inquiry', inquiryId); } catch (e) {} }
    }
    // Invalidate the contacts cache so the freshly-logged interaction shows.
    contactsLoaded = false;
    return (cfResult && cfResult.data) || {};
  }

  var GOOGLE_CONTACTS_FUNCTIONS_BASE = (window.TENANT_FIREBASE_CONFIG && TENANT_FIREBASE_CONFIG.cloudFunctionsBase) || 'https://us-central1-mast-platform-prod.cloudfunctions.net';

  async function isGoogleContactsConnected() {
    if (!currentUser) return false;
    try {
      var rec = await MastDB.get('config/googleContacts/' + currentUser.uid);
      return rec != null;
    } catch (e) {
      return false;
    }
  }

  async function connectGoogleContacts(onDone) {
    if (!currentUser) { showToast('Please sign in first.', true); return; }

    try {
      var idToken = await currentUser.getIdToken();
      var tenantId = window.TENANT_ID || 'dev';
      var url = GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsAuthStart?idToken=' + encodeURIComponent(idToken) + '&tenantId=' + encodeURIComponent(tenantId);

      var popup = window.open(url, 'googleContactsAuth', 'width=500,height=700');
      if (!popup) {
        showToast('Popup blocked. Please allow popups and try again.', true);
        return;
      }

      // Listen for the postMessage from the callback
      var messageHandler = function(event) {
        if (event.data && event.data.type === 'google-contacts-connected') {
          window.removeEventListener('message', messageHandler);
          showToast('Google Contacts connected!');
          updateGoogleContactsButtons();
          if (typeof onDone === 'function') onDone(true);
        } else if (event.data && event.data.type === 'google-contacts-error') {
          window.removeEventListener('message', messageHandler);
          showToast('Google Contacts authorization failed.', true);
          if (typeof onDone === 'function') onDone(false);
        }
      };
      window.addEventListener('message', messageHandler);
    } catch (err) {
      showToast('Failed to start Google authorization: ' + err.message, true);
    }
  }

  async function createGoogleContact(contactData) {
    try {
      var connected = await isGoogleContactsConnected();
      if (!connected) return; // Not connected — skip silently

      var idToken = await currentUser.getIdToken();
      var tenantId = window.TENANT_ID || 'dev';
      var groupName = (TENANT_BRAND && TENANT_BRAND.name) || 'My Business';

      var response = await fetch(GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsCreate', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + idToken,
          'Content-Type': 'application/json',
          'X-Tenant-ID': tenantId
        },
        body: JSON.stringify({
          name: contactData.name,
          category: contactData.category,
          groupName: groupName
        })
      });

      if (!response.ok) {
        var errText = await response.text();
        console.error('Failed to create Google Contact:', errText);
        return;
      }

      var result = await response.json();
      if (result.resourceName) {
        await MastDB.contacts.setGoogleContactId(contactData.id, result.resourceName);
      }
    } catch (err) {
      // Best-effort — don't block contact creation
      console.error('Google Contact creation failed:', err);
    }
  }

  async function googleSyncCore(syncAll) {
    var connected = await isGoogleContactsConnected();
    if (!connected) throw new Error('Please connect Google Contacts first.');

    var idToken = await currentUser.getIdToken();
    var tenantId = window.TENANT_ID || 'dev';
    var groupName = (TENANT_BRAND && TENANT_BRAND.name) || 'My Business';

    var body = syncAll
      ? { allContacts: true }
      : { groupName: groupName };

    var response = await fetch(GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsSync', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error('Google contacts sync failed:', errText);
      throw new Error('Failed to sync Google Contacts.');
    }

    var data = await response.json();
    var contacts = data.contacts || [];

    // Check existing contacts for googleContactId matches — read FRESH (the
    // module-level cache may be cold when called from the V2 twin).
    var existingIds = {};
    var fresh = await MastDB.contacts.list();
    Object.keys(fresh || {}).forEach(function(k) {
      var c = fresh[k];
      if (c && c.googleContactId) existingIds[c.googleContactId] = true;
    });

    var created = 0;
    for (var i = 0; i < contacts.length; i++) {
      var person = contacts[i];
      if (existingIds[person.resourceName]) continue;

      var id = 'contact_' + Date.now().toString(36) + '_' + i;
      var now = new Date().toISOString();
      await MastDB.contacts.set(id, {
        id: id,
        name: person.name || 'Unknown',
        email: person.email || null,
        phone: person.phone || null,
        company: person.company || null,
        category: person.category || 'Other',
        website: null,
        address: null,
        notes: null,
        googleContactId: person.resourceName,
        driveFolderLink: null,
        createdAt: now,
        createdBy: currentUser ? currentUser.uid : 'unknown',
        updatedAt: now
      });
      created++;
    }
    contactsLoaded = false;
    return { created: created };
  }

  async function updateGoogleContactsButtons() {
      var connectBtn = document.getElementById('googleContactsConnectBtn');
      var syncBtn = document.getElementById('googleContactsSyncBtn');
      if (!connectBtn || !syncBtn) return;
      var connected = await isGoogleContactsConnected();
      connectBtn.style.display = connected ? 'none' : '';
      syncBtn.style.display = connected ? '' : 'none';
    }

  window.ContactsBridge = {
      create: async function (data) {
        var id = MastUtil.genId('contact_');
        var now = new Date().toISOString();
        var contactData = {
          id: id,
          name: (data.name || '').trim(),
          email: data.email || null,
          phone: data.phone || null,
          company: data.company || null,
          category: data.category || 'Other',
          website: data.website || null,
          address: data.address || null,
          notes: data.notes || null,
          googleContactId: null,
          driveFolderLink: data.driveFolderLink || null,
          createdAt: now,
          createdBy: currentUser ? currentUser.uid : 'unknown',
          updatedAt: now
        };
        await MastDB.contacts.set(id, contactData);
        await writeAudit('create', 'contacts', id);
        emitTestingEvent('createContact', {});
        contactsLoaded = false;
        createGoogleContact(contactData); // background; mirrors saveNewContact
        return id;
      },
      update: async function (id, data) {
        var updates = {
          name: (data.name || '').trim(),
          email: data.email || null,
          phone: data.phone || null,
          company: data.company || null,
          category: data.category || 'Other',
          website: data.website || null,
          address: data.address || null,
          notes: data.notes || null,
          driveFolderLink: data.driveFolderLink || null,
          updatedAt: new Date().toISOString()
        };
        await MastDB.contacts.update(id, updates);
        await writeAudit('update', 'contacts', id);
        contactsLoaded = false;
        // Push to Google in background — mirrors saveContactEditMode.
        var contact = await MastDB.contacts.get(id);
        if (contact && contact.googleContactId) pushContactToGoogle(contact);
        return id;
      },
      // Delete (operations W3 — NEW capability, legacy had none). Removes the
      // contact record + the customer-link index row. Does NOT touch the linked
      // customer record or the Google contact (Mast is not the system of record
      // for either). Interactions live nested on the contact doc, so they go
      // with it.
      remove: async function (id) {
        if (!id) throw new Error('contact id required');
        await MastDB.contacts.remove(id);
        try { await MastDB.remove('admin/customerIndexes/byContactId/' + id); } catch (e) { /* index row may not exist */ }
        await writeAudit('delete', 'contacts', id);
        contactsLoaded = false;
        return id;
      },
      // Classic burn-down (operations Wave A): the formerly classic-only
      // sub-surfaces, exposed as state-free cores so contacts-v2 hosts the UI.
      INTERACTION_TYPES: INTERACTION_TYPES,
      logInteraction: logInteractionCore,
      prepareInquiryResponse: prepareInquiryResponseCore,
      respondToInquiry: respondToInquiryCore,
      googleStatus: isGoogleContactsConnected,
      googleConnect: connectGoogleContacts,
      googleSync: googleSyncCore
    };
})();
