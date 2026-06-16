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
 * The Placements + Payouts machinery is native too: new placements are created
 * here (FK stamped), pieces are managed on the placement record (consignments-v2),
 * and recording a settlement (payout received) is native on the Payouts facet —
 * routed through window.GalleriesBridge.recordSettlement (the gated CF call in
 * consignment.js). No navigateToClassic hatch. Flag-gated (?ui=1) at
 * #galleries-v2, side-by-side.
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

  // ── repeatable form-row templates (shared by editRender + the "+ Add"
  // handlers, so dynamically appended rows are pixel- and scrape-identical) ──
  // Address = a BLOCK: street on its own full-width line, then city/state/zip/
  // country beneath (the old single-line layout truncated Country to "Counti…").
  function addrRowHtml(a, i) {
    a = a || {};
    function inp(key, ph, extra) { return '<input class="form-input" data-gal-addr="' + key + '" data-i="' + i + '" placeholder="' + ph + '" value="' + esc(a[key] || '') + '" style="width:100%;"' + (extra || '') + '>'; }
    return '<div data-gal-addr-row="' + i + '" style="padding:10px 12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;">' +
      '<div style="margin-bottom:8px;">' + inp('street', 'Street address') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<div style="flex:2;min-width:140px;">' + inp('city', 'City') + '</div>' +
        '<div style="flex:0 0 64px;">' + inp('state', 'ST', ' maxlength="3"') + '</div>' +
        '<div style="flex:1;min-width:90px;">' + inp('zip', 'Zip') + '</div>' +
        '<div style="flex:1;min-width:120px;">' + inp('country', 'Country') + '</div>' +
      '</div>' +
    '</div>';
  }
  function contactRowHtml(c, i) {
    c = c || {};
    function inp(key, ph, type) { return '<input class="form-input" type="' + (type || 'text') + '" data-gal-contact="' + key + '" data-i="' + i + '" placeholder="' + ph + '" value="' + esc(c[key] || '') + '" style="width:100%;">'; }
    return '<div data-gal-contact-row="' + i + '" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">' +
      '<div style="flex:1.3;min-width:160px;">' + inp('name', 'Name') + '</div>' +
      '<div style="flex:1.4;min-width:190px;">' + inp('email', 'Email', 'email') + '</div>' +
      '<div style="flex:1;min-width:130px;">' + inp('phone', 'Phone', 'tel') + '</div>' +
      '<div style="flex:0.8;min-width:100px;">' + inp('role', 'Role') + '</div>' +
    '</div>';
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

  // Per-placement payout breakdown for the Payouts pane: earned / settled / due
  // plus the flattened settlement history (newest first).
  function payoutBreakdown(g) {
    var rows = [], history = [];
    placementsForGallery(g).forEach(function (p) {
      var t = placementTotals(p);
      var settlements = (p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
      var paid = 0;
      Object.keys(settlements).forEach(function (k) {
        var st = settlements[k] || {};
        var amt = (Number(st.amountReceivedCents) || 0) / 100;
        paid += amt;
        history.push({ placement: p, at: st.settledAt || st.createdAt || st.date || null, amount: amt, note: st.note || st.method || '' });
      });
      rows.push({ p: p, earned: t.makerEarnings || 0, settled: paid, due: Math.max(0, (t.makerEarnings || 0) - paid) });
    });
    history.sort(function (a, b) { return new Date(b.at || 0) - new Date(a.at || 0); });
    return { rows: rows, history: history };
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
    fetch: function (id) {
      // Cache-miss fallback so cross-drills (placement -> gallery) work even
      // when this module's list hasn't loaded yet in the session.
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return Promise.resolve(MastDB.get('admin/galleries/' + id)).then(function (g) {
        return g ? Object.assign({ _key: id }, g) : null;
      });
    },
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
          { key: 'ov', label: 'Overview' }, { key: 'pieces', label: 'Placements (' + allPlacements.length + ')' },
          { key: 'payouts', label: 'Payouts' },
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
          // Drill into the placement record (consignments-v2 stacked SO, Back
          // returns here) — the placement/gallery split was previously two
          // disconnected surfaces. Label by placed date, not the gallery's own
          // name echoed back.
          { label: 'Placement', render: function (r) {
              var label = 'Placed ' + (r.p.createdAt ? N.date(r.p.createdAt) : '(undated)');
              return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'consignments-v2\',\'' + esc(r.p.placementId || r.p._key || '') + '\')">' + esc(label) + '</button>';
            } },
          { label: 'Status', render: function (r) { return UI.badge(r.status, r.status === 'active' ? 'success' : 'neutral'); } },
          { label: 'Pieces', align: 'right', render: function (r) { return N.count(r.placed) || '0'; } },
          { label: 'Sold', align: 'right', render: function (r) { return N.money(r.sold) || '$0.00'; } },
          { label: 'Maker earns', align: 'right', render: function (r) { return N.money(r.owed) || '$0.00'; } },
          // Name-matched legacy placements (no galleryId FK): one audited click
          // stamps the FK and retires the string match (ratified hub plan).
          { label: '', render: function (r) {
              if (r.p.galleryId) return '';
              return '<button type="button" class="mu-link" title="This placement is matched by name only — stamp the gallery link (audited)" ' +
                'onclick="event.stopPropagation();GalleriesV2.linkPlacement(\'' + esc(g._key) + '\',\'' + esc(r.p.placementId || r.p._key || '') + '\')">link ⚭</button>';
            } }
        ], pieceRows) : '<span class="mu-sub">No placements yet — add one below.</span>';

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

        // Payouts — per-placement earned/settled/due + settlement history.
        var canSettle = (typeof window.can !== 'function' || window.can('galleries', 'edit'));
        var pb = payoutBreakdown(g);
        var dueCols = [
          { label: 'Placement', render: function (r) {
              var label = 'Placed ' + (r.p.createdAt ? N.date(r.p.createdAt) : '(undated)');
              return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'consignments-v2\',\'' + esc(r.p.placementId || r.p._key || '') + '\')">' + esc(label) + '</button>';
            } },
          { label: 'Maker earned', align: 'right', render: function (r) { return N.money(r.earned) || '$0.00'; } },
          { label: 'Settled', align: 'right', render: function (r) { return N.money(r.settled) || '$0.00'; } },
          { label: 'Due', align: 'right', render: function (r) {
              return r.due > 0 ? '<strong>' + N.money(r.due) + '</strong>' : '<span class="mu-sub">$0.00</span>';
            } }
        ];
        // Per-placement "Record settlement" — native, routed through the same
        // recordConsignmentSettlement CF the classic form uses.
        if (canSettle) dueCols.push({ label: '', align: 'right', render: function (r) {
          var pKey = r.p.placementId || r.p._key || '';
          return (r.due > 0 && pKey)
            ? '<button type="button" class="mu-link" onclick="GalleriesV2.recordSettlement(\'' + esc(pKey) + '\',\'' + esc(g._key) + '\')">Record settlement</button>'
            : '<span class="mu-sub">—</span>';
        } });
        var dueRows = pb.rows.length ? UI.relatedTable(dueCols, pb.rows)
          : '<span class="mu-sub">Nothing owed — no placements yet.</span>';
        var histRows = pb.history.length ? UI.relatedTable([
          { label: 'Settled', render: function (h) { return h.at ? N.date(h.at) : '—'; } },
          { label: 'Placement', render: function (h) { return 'Placed ' + (h.placement.createdAt ? N.date(h.placement.createdAt) : '(undated)'); } },
          { label: 'Note', render: function (h) { return h.note ? '<span class="mu-sub">' + esc(h.note) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Amount', align: 'right', render: function (h) { return N.money(h.amount) || '—'; } }
        ], pb.history) : '<span class="mu-sub">No settlements recorded yet.</span>';
        // Settlements are recorded natively per-placement (the "Record settlement"
        // action on the "Owed to you" table above) — routed through the gated
        // recordConsignmentSettlement CF; no classic hatch.
        var settleHint = '<div class="mu-sub" style="margin-top:12px;">Record a settlement from the “Owed to you” table above when a payout arrives.</div>';

        var newPlacementBtn = (typeof window.can !== 'function' || window.can('galleries', 'edit'))
          ? '<div style="margin-top:14px;"><button class="btn btn-primary" onclick="GalleriesV2.newPlacement(\'' + esc(g._key) + '\')">+ New placement</button></div>'
          : '';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Gallery', gallery) + UI.card('Primary contact', primaryContact) + UI.card('Addresses', addressBody) + '</div>' +
          '<div class="mu-pane" data-pane="pieces" hidden>' + UI.cardTable('Placements (' + allPlacements.length + ')', piecesBody + newPlacementBtn) + '</div>' +
          '<div class="mu-pane" data-pane="payouts" hidden>' + UI.card('Owed to you', dueRows) + UI.cardTable('Settlement history', histRows + settleHint) + '</div>' +
          '<div class="mu-pane" data-pane="contacts" hidden>' + UI.cardTable('Contacts (' + contacts.length + ')', contactsBody) + '</div>' +
          '<div class="mu-pane" data-pane="notes" hidden>' + UI.card('Notes', notesBody) + '</div>';
      },
      // Native edit/create form. Mirrors the classic renderGalleryEditForm field
      // set exactly: name (required), repeatable addresses + contacts, default
      // commission %, currency, notes. Engine-first chrome (form-group / mu-editbar).
      editRender: function (g, mode) {
        g = g || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:120px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function grp(label, hint) {
          return '<div style="margin:14px 0 4px;"><span style="font-size:0.9rem;font-weight:600;color:var(--teal);">' + esc(label) + '</span>' +
            (hint ? ' <span class="mu-sub" style="font-size:0.78rem;">' + esc(hint) + '</span>' : '') + '</div>';
        }
        // Engine repeatable rows (MastUI.repeatRows): same templates, engine-owned
        // "+ Add" handler — the per-module add/padRows plumbing is retired.
        var addrRows = U.repeatRows({ id: 'galV2Addrs', rows: addressesOf(g), template: addrRowHtml, addLabel: '+ Add address' });
        var contactRows = U.repeatRows({ id: 'galV2Contacts', rows: contactsOf(g), template: contactRowHtml, addLabel: '+ Add contact' });
        var pctVal = (typeof g.defaultCommissionPct === 'number') ? g.defaultCommissionPct : '';
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New gallery' : 'Edit this gallery') + '</div>' +
          fg('Name *', '<input class="form-input" id="galV2Name" value="' + esc(g.name || '') + '" style="width:100%;" placeholder="Gallery, boutique or shop name">') +
          grp('Addresses') + addrRows +
          grp('Contacts', '— people at the gallery, kept on this record (not your Contacts list)') + contactRows +
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
      // Validation mirrors legacy saveGallery: name required — plus format
      // checks on contact email/phone so bad data can't enter the record.
      if (!data.name.trim()) { if (window.showToast) showToast('Gallery name is required.', true); return false; }
      for (var ci = 0; ci < data.contacts.length; ci++) {
        var c = data.contacts[ci];
        var who = c.name || ('contact ' + (ci + 1));
        if (!U.validate.email(c.email)) {
          if (window.showToast) showToast('"' + c.email + '" doesn\'t look like a valid email (' + who + ').', true);
          return false;
        }
        if (!U.validate.phone(c.phone)) {
          if (window.showToast) showToast('"' + c.phone + '" doesn\'t look like a valid phone number (' + who + ').', true);
          return false;
        }
      }

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

  // ── placement intake (create-only) — placements are born FROM a gallery,
  // so the galleryId FK is stamped automatically and the free-text location
  // path dies (ratified hub plan, 2026-06-10). Pieces are added on the
  // placement record afterwards (classic Add Line Item — tracked debt).
  MastEntity.define('placement-intake-v2', {
    label: 'Placement', labelPlural: 'Placements', size: 'lg', route: 'galleries-v2',
    recordId: function (r) { return r._key || 'new'; },
    fields: [{ name: 'locationName', label: 'Gallery', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(null); },
    detail: {
      editRender: function (r, mode) {
        var g = V2.intakeGallery || {};
        var primary = (contactsOf(g) || [])[0] || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var pct = (typeof g.defaultCommissionPct === 'number') ? g.defaultCommissionPct : '';
        return '<div class="mu-editbar"><span class="mu-editpill">NEW</span>New placement at ' + esc(galleryName(g)) + '</div>' +
          '<div class="mu-sub" style="margin-bottom:10px;">Linked to this gallery automatically — no retyping the location.</div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Commission to gallery (%) *', '<input class="form-input" type="number" min="0" max="100" step="1" id="plNewRate" value="' + esc(pct) + '" placeholder="40" style="width:100%;">', true) +
            fg('Contact name', '<input class="form-input" id="plNewContact" value="' + esc(primary.name || '') + '" style="width:100%;">', true) +
          '</div>' +
          fg('Contact email', '<input class="form-input" type="email" id="plNewEmail" value="' + esc(primary.email || '') + '" style="width:100%;">') +
          fg('Notes', '<textarea class="form-input" id="plNewNotes" rows="3" placeholder="Terms discussed, delivery plans…" style="width:100%;resize:vertical;"></textarea>') +
          '<div class="mu-sub">Next step after creating: add the consigned pieces on the placement record.</div>';
      }
    },
    onSave: function (rec, mode) {
      if (mode !== 'create') return false;
      if (typeof window.can === 'function' && !window.can('galleries', 'edit')) {
        if (window.showToast) showToast('You do not have permission to add placements.', true);
        return false;
      }
      var g = V2.intakeGallery;
      if (!g || !g._key) { if (window.showToast) showToast('Gallery context lost — reopen and try again.', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
      var ratePct = parseFloat(val('plNewRate'));
      if (isNaN(ratePct) || ratePct < 0 || ratePct > 100) { if (window.showToast) showToast('Commission must be 0-100%.', true); return false; }
      // commissionRate is canonically a 0–1 FRACTION: every reader (this module's
      // and consignments-v2's placementTotals payout math + pctLabel display) treats
      // it as such, and consignment.js createPlacement stores input%/100. The form
      // collects a whole-number percent, so divide by 100 before persisting — writing
      // the raw 40 made the record show "4000%" and broke maker-earnings math.
      var commissionRate = ratePct / 100;
      var email = val('plNewEmail');
      if (!U.validate.email(email)) { if (window.showToast) showToast('"' + email + '" doesn\'t look like a valid email.', true); return false; }
      var id = MastDB.consignments.newKey();
      var now = new Date().toISOString();
      // Mirrors consignment.js createPlacement() exactly, plus the galleryId FK.
      var placement = {
        placementId: id,
        galleryId: g._key,
        locationName: g.name || '',
        locationContact: val('plNewContact'),
        locationEmail: email,
        commissionRate: commissionRate,
        status: 'active',
        lineItems: {},
        notes: val('plNewNotes'),
        totalRetailValue: 0, totalSold: 0, makerEarnings: 0, commissionOwed: 0,
        createdAt: now, updatedAt: now
      };
      return Promise.resolve(MastDB.set('admin/consignments/' + id, placement)).then(function () {
        if (window.writeAudit) writeAudit('create', 'consignment-placement', id);
        if (window.showToast) showToast('Placement created — add the consigned pieces next.');
        reloadSoon();
        setTimeout(function () { MastEntity.drill('consignments-v2', id); }, 200);
        return true;
      }).catch(function (e) {
        console.error('[galleries-v2] new placement', e);
        if (window.showToast) showToast('Failed to create placement: ' + (e && e.message || e), true);
        return false;
      });
    }
  });

  window.GalleriesV2 = {
    // Ratified hub plan: placements are created FROM the gallery (FK stamped).
    newPlacement: function (galleryKey) {
      MastEntity.get('galleries-v2').fetch(galleryKey).then(function (g) {
        if (!g) { if (window.showToast) showToast('Gallery not found.', true); return; }
        V2.intakeGallery = g;
        MastEntity.openRecord('placement-intake-v2', {}, 'create');
      });
    },
    // One audited click stamps the galleryId FK on a name-matched placement.
    linkPlacement: function (galleryKey, placementKey) {
      if (typeof window.can === 'function' && !window.can('galleries', 'edit')) {
        if (window.showToast) showToast('You do not have permission to edit placements.', true);
        return;
      }
      if (!galleryKey || !placementKey) return;
      Promise.resolve(MastDB.update('admin/consignments/' + placementKey, {
        galleryId: galleryKey, updatedAt: new Date().toISOString()
      })).then(function () {
        if (window.writeAudit) writeAudit('update', 'consignment-placement-link', placementKey);
        if (window.showToast) showToast('Placement linked to this gallery.');
        reloadSoon();
      }).catch(function (e) {
        console.error('[galleries-v2] link placement', e);
        if (window.showToast) showToast('Could not link: ' + (e && e.message || e), true);
      });
    },
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
    // ── native settlement (payout received) — per placement ───────────────
    // Opens a form (amount + date + notes), then routes through GalleriesBridge.
    // recordSettlement — which mints the idempotencyKey, runs the outstanding-
    // earnings cap pre-check, and calls the recordConsignmentSettlement CF (the
    // same path classic confirmPayout uses; no raw client settlement write here).
    // galleryKey is the open gallery record so we can re-open it after the write.
    recordSettlement: function (placementId, galleryKey) {
      if (typeof window.can === 'function' && !window.can('galleries', 'edit')) {
        if (window.showToast) showToast('You do not have permission to record settlements.', true); return;
      }
      if (typeof openModal !== 'function') { if (window.showToast) showToast('Dialog unavailable — try again', true); return; }
      var p = V2.placements.filter(function (x) { return (x.placementId || x._key) === placementId; })[0];
      if (!p) { if (window.showToast) showToast('Placement not found — reload and try again.', true); return; }
      var t = placementTotals(p);
      var settlements = (p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
      var paid = Object.keys(settlements).reduce(function (s, k) { return s + ((settlements[k] && Number(settlements[k].amountReceivedCents)) || 0) / 100; }, 0);
      var outstanding = Math.max(0, (t.makerEarnings || 0) - paid);
      var today = new Date().toISOString().split('T')[0];
      var label = 'Placement placed ' + (p.createdAt ? N.date(p.createdAt) : '(undated)');
      var html = '<div class="modal-header"><h3>Record settlement</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
        '<div style="padding:20px;">' +
        '<div class="mu-sub" style="margin-bottom:14px;">' + esc(label) + ' · Outstanding: <strong>' + esc(N.money(outstanding) || '$0.00') + '</strong></div>' +
        '<div class="form-group" style="margin-bottom:14px;"><label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Amount received ($)</label>' +
        '<input id="galV2SettleAmount" type="number" min="0" step="0.01" value="' + esc(outstanding > 0 ? outstanding.toFixed(2) : '') + '" class="form-input" style="width:100%;"></div>' +
        '<div class="form-group" style="margin-bottom:14px;"><label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Received date</label>' +
        '<input id="galV2SettleDate" type="date" value="' + esc(today) + '" class="form-input" style="width:100%;">' +
        '<div class="mu-sub" style="margin-top:4px;">Revenue is attributed to the month the payment actually arrived.</div></div>' +
        '<div class="form-group" style="margin-bottom:14px;"><label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Notes (optional)</label>' +
        '<input id="galV2SettleNotes" type="text" placeholder="e.g. check #4521" class="form-input" style="width:100%;"></div>' +
        '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="GalleriesV2.confirmSettlement(\'' + esc(placementId) + '\',\'' + esc(galleryKey || '') + '\')">Record settlement</button>' +
        '</div></div>';
      openModal(html);
    },
    confirmSettlement: function (placementId, galleryKey) {
      if (!window.GalleriesBridge || typeof window.GalleriesBridge.recordSettlement !== 'function') {
        if (window.showToast) showToast('Consignment tools are still loading — try again in a moment.', true); return;
      }
      var amountEl = document.getElementById('galV2SettleAmount');
      var dateEl = document.getElementById('galV2SettleDate');
      var notesEl = document.getElementById('galV2SettleNotes');
      var amountDollars = amountEl ? parseFloat(amountEl.value) : NaN;
      var receivedDate = (dateEl && dateEl.value) || '';
      var notes = (notesEl && notesEl.value) || '';
      Promise.resolve(window.GalleriesBridge.recordSettlement(placementId, { amountDollars: amountDollars, receivedDate: receivedDate, notes: notes }))
        .then(function (res) {
          if (typeof closeModal === 'function') closeModal();
          if (window.showToast) showToast('Settlement of ' + (window.formatCents ? window.formatCents(res.amountCents) : ('$' + (res.amountCents / 100).toFixed(2))) + ' recorded');
          // Refresh placement+gallery caches, then re-open the gallery record so the
          // Payouts facet reflects the new settlement (mirrors edit's post-save reopen).
          reloadSoon();
          if (galleryKey) setTimeout(function () {
            MastEntity.get('galleries-v2').fetch(galleryKey).then(function (rec) {
              if (rec) MastEntity.openRecord('galleries-v2', rec, 'read');
            });
          }, 350);
        })
        // Surface the server's reason verbatim (e.g. the over-cap rejection).
        .catch(function (e) { if (window.showToast) showToast((e && e.message) || 'Could not record settlement', true); });
    },
    exportCsv: function () { return MastEntity.exportRows('galleries-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('galleries-v2', {
    routes: { 'galleries-v2': { tab: 'galleriesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
