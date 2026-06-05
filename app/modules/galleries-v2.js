/**
 * galleries-v2.js — read-focused Faceted Record twin of the legacy Galleries &
 * Consignment surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy consignment.js (#galleries) hosts a multi-view admin: Placements,
 * Galleries (first-class entities), and Payouts. This twin re-hosts ONE of those
 * surfaces — the Galleries list → read detail — on the Entity Engine: a
 * schema-driven list + a read-focused Faceted Record slide-out
 * (Overview / Pieces / Contacts / Notes facets).
 *
 * Variant (doc 17 §1a): a gallery is a partner record (name, addresses, contacts,
 * default commission split) with related collections (consigned pieces = the
 * placements at that gallery) but NO governed lifecycle — it has no status field
 * of its own; "active" vs "dormant" is DERIVED from whether it currently holds
 * any active placements → Faceted Record, NOT Process/MastFlow. Partner-shaped,
 * like a wholesale account.
 *
 * Native gallery RECORD create + edit (name, addresses, contacts, default
 * commission split, currency, notes) — a custom detail.editRender + an onSave
 * that DELEGATES to window.GalleriesBridge (exposed in consignment.js, wrapping
 * the EXISTING admin/galleries write core). Never reimplements the write/merge
 * or validation logic. Mirrors contacts-v2 / students-v2.
 *
 * The Placements + Payouts machinery (record sale/return, settle payouts, print
 * statements) stays single-sourced on legacy #galleries — that's the consignment
 * PLACEMENT surface (the pieces/line-items), a separate surface from the gallery
 * record. The "Pieces" facet links there via navigateToClassic. Flag-gated
 * (?ui=1) at #galleries-v2, side-by-side.
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

  // Derived gallery status (no stored status field): a gallery is "active" while
  // it holds any active placement, else "dormant". A read-only assigned attribute
  // → the header badge + a list column, mirroring the Faceted-Record shape.
  var STATUS_TONE = { active: 'success', dormant: 'neutral' };

  function galleryName(g) { return (g && g.name) || '(unnamed)'; }
  function pctLabel(g) {
    return (typeof g.defaultCommissionPct === 'number')
      ? (Math.round(g.defaultCommissionPct * 100) / 100) + '%' : '—';
  }
  function contactsOf(g) { return (g && g.contacts) || []; }
  function addressesOf(g) { return (g && g.addresses) || []; }
  function addressLine(a) {
    return [a.street, a.city, a.state, a.zip, a.country].filter(Boolean).join(', ');
  }

  // Consigned pieces = the placements at this gallery. Match by galleryId FK
  // first; fall back to a locationName match for legacy placements not yet
  // backfilled with the FK (mirrors consignment.js `_placementsForGallery`).
  function placementsForGallery(g) {
    var legacyKey = (g && g.name) ? g.name.trim().toLowerCase() : '';
    return V2.placements.filter(function (p) {
      if (!p) return false;
      if (p.galleryId === g._key) return true;
      if (!p.galleryId && legacyKey && String(p.locationName || '').trim().toLowerCase() === legacyKey) return true;
      return false;
    });
  }
  // Totals for one placement (mirrors consignment.js `calculatePlacementTotals`).
  // line-item retailPrice is stored in CENTS (writer: Math.round($ * 100)); convert
  // to dollars via N.moneyVal so retail/sold/earnings line up with N.money (dollars)
  // and the amountReceivedCents/100 settlement math in payoutsDue.
  function placementTotals(p) {
    var lineItems = p.lineItems || {};
    var retail = 0, sold = 0, placed = 0;
    Object.keys(lineItems).forEach(function (k) {
      var li = lineItems[k];
      var qty = li.qty || 0, qtySold = li.qtySold || 0, price = N.moneyVal(li, 'retailPrice', null) || 0;
      retail += qty * price; sold += qtySold * price; placed += qty;
    });
    var rate = p.commissionRate || 0;
    return { retail: retail, sold: sold, placed: placed, makerEarnings: sold * (1 - rate), commissionOwed: sold * rate };
  }
  function activePlacements(g) { return placementsForGallery(g).filter(function (p) { return (p.status || 'active') === 'active'; }); }
  function pieceCount(g) {
    // total individual pieces currently placed across active placements
    return activePlacements(g).reduce(function (s, p) { return s + placementTotals(p).placed; }, 0);
  }
  function galleryStatus(g) { return activePlacements(g).length > 0 ? 'active' : 'dormant'; }
  // What we still owe this gallery's maker = unpaid maker earnings across all its
  // placements (mirrors consignment.js `_galleryPayoutsDue`).
  function payoutsDue(g) {
    return placementsForGallery(g).reduce(function (total, p) {
      var t = placementTotals(p);
      var settlements = (p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
      var paid = Object.keys(settlements).reduce(function (s, k) {
        return s + ((settlements[k] && Number(settlements[k].amountReceivedCents)) || 0) / 100;
      }, 0);
      return total + Math.max(0, (t.makerEarnings || 0) - paid);
    }, 0);
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('galleries-v2', {
    label: 'Gallery', labelPlural: 'Galleries', size: 'lg',
    route: 'galleries-v2',
    recordId: function (g) { return g._key || g.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Gallery', type: 'text', list: true, readOnly: true, group: 'Gallery', get: galleryName },
      { name: 'defaultCommissionPct', label: 'Default split', type: 'text', list: true, readOnly: true, align: 'right', sortable: false, get: pctLabel },
      { name: 'pieces', label: 'Pieces', type: 'number', list: true, readOnly: true, align: 'right', get: pieceCount },
      { name: 'payoutsDue', label: 'Payouts due', type: 'money', list: true, readOnly: true, align: 'right', get: payoutsDue },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'dormant'],
        get: galleryStatus,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, g) {
        var actCount = activePlacements(g).length;
        var allPlacements = placementsForGallery(g);
        var tiles = UI.tiles([
          { k: 'Pieces on consignment', v: N.count(pieceCount(g)) || '0', hero: true },
          { k: 'Commission split', v: esc(pctLabel(g)) },
          { k: 'Payouts due', v: (N.money(payoutsDue(g)) || '$0.00') },
          { k: 'Status', v: UI.badge(galleryStatus(g) === 'active' ? 'Active' : 'Dormant', STATUS_TONE[galleryStatus(g)] || 'neutral') }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'pieces', label: 'Pieces' },
          { key: 'contacts', label: 'Contacts' }, { key: 'notes', label: 'Notes' }
        ], 'ov');

        // Overview — gallery identity + commission terms + primary contact + addresses.
        var contacts = contactsOf(g);
        var primary = contacts[0] || null;
        var gallery = UI.kv([
          { k: 'Status', v: UI.badge(galleryStatus(g) === 'active' ? 'Active' : 'Dormant', STATUS_TONE[galleryStatus(g)] || 'neutral') },
          { k: 'Default commission', v: esc(pctLabel(g)) },
          { k: 'Currency', v: g.currency ? esc(g.currency) : '—' },
          { k: 'Active placements', v: N.count(actCount) + ' of ' + N.count(allPlacements.length) },
          { k: 'Payouts due', v: N.money(payoutsDue(g)) || '$0.00' },
          { k: 'Added', v: g.createdAt ? N.date(g.createdAt) : '—' }
        ]);
        var primaryContact = UI.kv([
          { k: 'Name', v: primary ? esc(primary.name || '—') + (primary.role ? ' <span class="mu-sub">· ' + esc(primary.role) + '</span>' : '') : '—' },
          { k: 'Email', v: (primary && primary.email) ? esc(primary.email) : '—' },
          { k: 'Phone', v: (primary && primary.phone) ? esc(primary.phone) : '—' }
        ]);
        var addresses = addressesOf(g);
        var addressBody = addresses.length
          ? addresses.map(function (a) {
              return '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' + esc(addressLine(a)) + '</div>';
            }).join('')
          : '<span class="mu-sub">No addresses on file.</span>';

        // Pieces — the consigned pieces, i.e. the placements at this gallery.
        var pieceRows = allPlacements.map(function (p) {
          var t = placementTotals(p);
          return { p: p, status: p.status || 'active', placed: t.placed, sold: t.sold, owed: t.makerEarnings };
        });
        var piecesBody = pieceRows.length ? UI.relatedTable([
          { label: 'Placement', render: function (r) { return esc(r.p.locationName || '—'); } },
          { label: 'Status', render: function (r) { return UI.badge(r.status, r.status === 'active' ? 'success' : 'neutral'); } },
          { label: 'Pieces', align: 'right', render: function (r) { return N.count(r.placed) || '0'; } },
          { label: 'Sold', align: 'right', render: function (r) { return N.money(r.sold) || '$0.00'; } },
          { label: 'Maker earns', align: 'right', render: function (r) { return N.money(r.owed) || '$0.00'; } }
        ], pieceRows) : '<span class="mu-sub">No consigned pieces — record a placement in the classic Galleries view.</span>';

        // Contacts — all contacts on file.
        var contactsBody = contacts.length ? UI.relatedTable([
          { label: 'Name', render: function (c) { return esc(c.name || '—') + (c.role ? ' <span class="mu-sub">· ' + esc(c.role) + '</span>' : ''); } },
          { label: 'Email', render: function (c) { return c.email ? '<span class="mu-sub">' + esc(c.email) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Phone', render: function (c) { return c.phone ? '<span class="mu-sub">' + esc(c.phone) + '</span>' : '<span class="mu-sub">—</span>'; } }
        ], contacts) : '<span class="mu-sub">No contacts on file.</span>';

        // Notes — gallery operator notes.
        var notesBody = g.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(g.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Gallery', gallery) + UI.card('Primary contact', primaryContact) + UI.card('Addresses', addressBody) + '</div>' +
          '<div class="mu-pane" data-pane="pieces" hidden>' + UI.cardTable('Consigned pieces (' + allPlacements.length + ')', piecesBody +
            '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="GalleriesV2.classic()">Manage placements in classic view →</button></div>') + '</div>' +
          '<div class="mu-pane" data-pane="contacts" hidden>' + UI.cardTable('Contacts (' + contacts.length + ')', contactsBody) + '</div>' +
          '<div class="mu-pane" data-pane="notes" hidden>' + UI.card('Notes', notesBody) + '</div>';
      },
      // Native edit/create form. Mirrors the classic renderGalleryEditForm field
      // set exactly: name (required), repeatable addresses + contacts, default
      // commission %, currency, notes. Engine-first chrome (form-group / mu-editbar).
      editRender: function (g, mode) {
        g = g || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:120px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function grp(label) { return '<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:14px 0 4px;">' + esc(label) + '</div>'; }
        // Repeatable rows: render existing + a few blank spares so editing never
        // drops data and adding is inline (scraped by index in onSave).
        function padRows(list, spares) {
          var arr = (Array.isArray(list) ? list.slice() : []);
          for (var i = 0; i < spares; i++) arr.push({});
          return arr;
        }
        var addrRows = padRows(addressesOf(g), 2).map(function (a, i) {
          function inp(key, ph) { return '<input class="form-input" data-gal-addr="' + key + '" data-i="' + i + '" placeholder="' + ph + '" value="' + esc(a[key] || '') + '" style="width:100%;">'; }
          return '<div data-gal-addr-row="' + i + '" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">' +
            '<div style="flex:2;min-width:140px;">' + inp('street', 'Street') + '</div>' +
            '<div style="flex:1;min-width:90px;">' + inp('city', 'City') + '</div>' +
            '<div style="flex:0 0 64px;">' + inp('state', 'ST') + '</div>' +
            '<div style="flex:0 0 80px;">' + inp('zip', 'Zip') + '</div>' +
            '<div style="flex:0 0 90px;">' + inp('country', 'Country') + '</div>' +
          '</div>';
        }).join('');
        var contactRows = padRows(contactsOf(g), 2).map(function (c, i) {
          function inp(key, ph) { return '<input class="form-input" data-gal-contact="' + key + '" data-i="' + i + '" placeholder="' + ph + '" value="' + esc(c[key] || '') + '" style="width:100%;">'; }
          return '<div data-gal-contact-row="' + i + '" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">' +
            '<div style="flex:1;min-width:110px;">' + inp('name', 'Name') + '</div>' +
            '<div style="flex:1;min-width:110px;">' + inp('email', 'Email') + '</div>' +
            '<div style="flex:1;min-width:110px;">' + inp('phone', 'Phone') + '</div>' +
            '<div style="flex:1;min-width:90px;">' + inp('role', 'Role') + '</div>' +
          '</div>';
        }).join('');
        var pctVal = (typeof g.defaultCommissionPct === 'number') ? g.defaultCommissionPct : '';
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New gallery' : 'Edit this gallery') + '</div>' +
          fg('Name *', '<input class="form-input" id="galV2Name" value="' + esc(g.name || '') + '" style="width:100%;" placeholder="Gallery, boutique or shop name">') +
          grp('Addresses') + addrRows +
          grp('Contacts') + contactRows +
          grp('Terms') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Default commission %', '<input class="form-input" type="number" min="0" max="100" step="0.5" id="galV2Pct" value="' + esc(pctVal) + '" placeholder="40" style="width:100%;">', true) +
            fg('Currency', '<input class="form-input" id="galV2Currency" value="' + esc(g.currency || 'USD') + '" style="width:100%;">', true) +
          '</div>' +
          fg('Notes', '<textarea class="form-input" id="galV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(g.notes || '') + '</textarea>');
      }
    },
    onSave: function (rec, mode) {
      if (!window.GalleriesBridge) { if (window.showToast) showToast('Galleries engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      function scrapeRows(rowSel, cellAttr) {
        var out = [];
        document.querySelectorAll('[' + rowSel + ']').forEach(function (row) {
          var r = {};
          row.querySelectorAll('[' + cellAttr + ']').forEach(function (inp) { r[inp.getAttribute(cellAttr)] = (inp.value || '').trim(); });
          if (Object.keys(r).some(function (k) { return r[k]; })) out.push(r);
        });
        return out;
      }
      var data = {
        name: val('galV2Name'),
        addresses: scrapeRows('data-gal-addr-row', 'data-gal-addr'),
        contacts: scrapeRows('data-gal-contact-row', 'data-gal-contact'),
        defaultCommissionPct: val('galV2Pct'),
        currency: val('galV2Currency'),
        notes: val('galV2Notes')
      };
      // Validation mirrors legacy saveGallery: name required.
      if (!data.name.trim()) { if (window.showToast) showToast('Gallery name is required.', true); return false; }

      if (mode === 'create') {
        return Promise.resolve(window.GalleriesBridge.create(data)).then(function () {
          if (window.showToast) showToast('Gallery created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[galleries-v2] create', e); if (window.showToast) showToast('Error saving gallery.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.GalleriesBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open. Normalize the
        // repeatable rows the same way the Bridge does so the read view matches.
        Object.assign(V2.byId[id] || rec, {
          name: data.name.trim(),
          addresses: data.addresses,
          contacts: data.contacts,
          defaultCommissionPct: (data.defaultCommissionPct === '' || isNaN(parseFloat(data.defaultCommissionPct))) ? null : parseFloat(data.defaultCommissionPct),
          currency: (data.currency || '').trim() || 'USD',
          notes: (data.notes || '').trim()
        });
        if (window.showToast) showToast('Gallery updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[galleries-v2] update', e); if (window.showToast) showToast('Error updating gallery.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, placements: [], sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure legacy consignment.js is loaded so window.GalleriesBridge (the
    // delegated write path) exists — mirrors contacts-v2 / students-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('consignment'); } catch (e) {} }
    Promise.all([
      Promise.resolve(MastDB.get('admin/galleries')),
      Promise.resolve(MastDB.get('admin/consignments'))
    ]).then(function (res) {
      var galVal = res[0] || {}, plVal = res[1] || {};
      var placements = [];
      Object.keys(plVal).forEach(function (k) {
        var p = plVal[k];
        if (p && typeof p === 'object') { p = Object.assign({ placementId: k }, p); placements.push(p); }
      });
      V2.placements = placements;
      var out = [];
      Object.keys(galVal).forEach(function (k) {
        var g = galVal[k];
        if (g && typeof g === 'object') { g = Object.assign({ _key: k }, g); out.push(g); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[galleries-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (g) { return galleryStatus(g) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (g) {
        if (String(g.name || '').toLowerCase().indexOf(q) >= 0) return true;
        return contactsOf(g).some(function (c) {
          return String(c.name || '').toLowerCase().indexOf(q) >= 0 || String(c.email || '').toLowerCase().indexOf(q) >= 0;
        });
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('galleries-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('galleriesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'galleriesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['dormant', 'Dormant']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="GalleriesV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Galleries',
        count: N.count(V2.rows.length) + ' galler' + (V2.rows.length === 1 ? 'y' : 'ies'),
        actionsHtml: '<button class="btn btn-primary" onclick="GalleriesV2.create()">+ New gallery</button>' +
          '<button class="btn btn-secondary" onclick="GalleriesV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or contact…" value="' + esc(V2.q) +
        '" oninput="GalleriesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('galleries-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'GalleriesV2.sort', onRowClickFnName: 'GalleriesV2.open',
        empty: { title: 'No galleries', message: V2.loaded ? 'Add a gallery, boutique or shop to get started.' : 'Loading…' }
      });
  }

  window.GalleriesV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'pieces' || key === 'payoutsDue' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('galleries-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('galleries-v2', rec, 'read');
      });
    },
    create: function () {
      // Ensure the legacy module (and thus window.GalleriesBridge) is loaded
      // before opening the create form — mirrors ContactsV2 / StudentsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('consignment'); } catch (e) {} }
      MastEntity.openRecord('galleries-v2', {}, 'create');
    },
    // KEPT CLASSIC: consignment PLACEMENT management (record sale/return, settle
    // payouts, print statements) — a separate surface (pieces/line-items) with no
    // V2 home. The gallery RECORD (identity/addresses/contacts/terms) is native
    // here. navigateToClassic so the V2 route remap doesn't loop back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('galleries');
      else if (typeof navigateTo === 'function') navigateTo('galleries');
    },
    exportCsv: function () { return MastEntity.exportRows('galleries-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('galleries-v2', {
    routes: { 'galleries-v2': { tab: 'galleriesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
