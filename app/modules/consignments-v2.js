/**
 * consignments-v2.js — read-focused Faceted Record twin of the legacy
 * Consignment PLACEMENTS list (doc 17 §11/§12; conversion playbook).
 *
 * Legacy consignment.js (#galleries) hosts a multi-view admin: Placements,
 * Galleries (first-class entities), and Payouts. The sibling galleries-v2
 * re-hosts the GALLERY records; THIS twin re-hosts the other lens — the
 * PLACEMENTS list -> read detail. A placement is "pieces consigned to one
 * gallery", carrying its own sold / earnings / value / status: a
 * placement-centric record, distinct from the gallery-centric sibling.
 *
 * Variant (doc 17 §1a): a placement is a transaction-shaped record (a gallery +
 * a set of consigned pieces + per-piece sold/returned + value totals). Its
 * status (active / closed) is a flat operator toggle — no exit-checklists, no
 * guarded advance, no gated lifecycle -> Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused: editing a placement, recording sales/returns, settling payouts
 * and the whole Galleries/Payouts machinery stay single-sourced on legacy
 * #galleries via a "manage in classic view" link. This twin re-hosts the VIEW
 * only — no onSave, no edit form, no sale/return/settlement tooling. Flag-gated
 * (?ui=1) at #consignments-v2, side-by-side; never touches consignment.js.
 *
 * Money units: placement line-item retailPrice is stored in CENTS (writer:
 * Math.round($ * 100)); both v2 twins convert it to dollars via N.moneyVal so they
 * render placements identically to the legacy consignment.js detail view;
 * settlements are CENTS (amountReceivedCents).
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

  // status (active / closed) is a flat assigned attribute -> the header badge +
  // a list column, the Faceted-Record shape.
  var STATUS_TONE = { active: 'success', closed: 'neutral' };
  function placementStatus(p) { return (p && p.status) || 'active'; }

  // Gallery name: resolve the FK against admin/galleries; fall back to the
  // placement's own locationName string (legacy placements pre-FK-backfill).
  function galleryName(p) {
    if (!p) return '(unnamed)';
    var g = p.galleryId ? V2.galleries[p.galleryId] : null;
    return (g && g.name) || p.locationName || '(unnamed)';
  }
  // fields[0] (the slide-out title source) — a real, human title for the record.
  function placementTitle(p) {
    var t = placementTotals(p);
    var name = galleryName(p);
    return t.placed ? (name + ' — ' + t.placed + ' piece' + (t.placed === 1 ? '' : 's')) : name;
  }

  // Per-placement totals (mirror consignment.js calculatePlacementTotals AND the
  // sibling galleries-v2 placementTotals): retailPrice is stored in CENTS, converted
  // to dollars via N.moneyVal so totals match N.money (dollars) + settlement math.
  function placementTotals(p) {
    var lineItems = (p && p.lineItems) || {};
    var retail = 0, sold = 0, placed = 0, soldUnits = 0, returnedUnits = 0;
    Object.keys(lineItems).forEach(function (k) {
      var li = lineItems[k] || {};
      var qty = li.qty || 0, qtySold = li.qtySold || 0, qtyReturned = li.qtyReturned || 0, price = N.moneyVal(li, 'retailPrice', null) || 0;
      retail += qty * price; sold += qtySold * price; placed += qty;
      soldUnits += qtySold; returnedUnits += qtyReturned;
    });
    var rate = (p && p.commissionRate) || 0;
    return {
      retail: retail, sold: sold, placed: placed,
      soldUnits: soldUnits, returnedUnits: returnedUnits, rate: rate,
      makerEarnings: sold * (1 - rate), commissionOwed: sold * rate
    };
  }
  function pieceCount(p) { return placementTotals(p).placed; }
  function soldUnits(p) { return placementTotals(p).soldUnits; }
  function placedValue(p) { return placementTotals(p).retail; }
  function makerEarnings(p) { return placementTotals(p).makerEarnings; }

  // Settlements are CENTS (amountReceivedCents); outstanding maker earnings =
  // earnings (dollars) less settlements paid in (mirrors galleries-v2 payoutsDue).
  function settledDollars(p) {
    var settlements = (p && p.settlements && typeof p.settlements === 'object') ? p.settlements : {};
    return Object.keys(settlements).reduce(function (s, k) {
      return s + ((settlements[k] && Number(settlements[k].amountReceivedCents)) || 0) / 100;
    }, 0);
  }
  function outstandingDollars(p) { return Math.max(0, makerEarnings(p) - settledDollars(p)); }

  function pctLabel(p) {
    var rate = (p && p.commissionRate) || 0;
    return Math.round(rate * 100) + '%';
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('consignments-v2', {
    label: 'Consignment', labelPlural: 'Consignments', size: 'lg',
    route: 'consignments-v2',
    recordId: function (p) { return p.placementId || p._key || p.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real title string.
      { name: 'gallery', label: 'Gallery', type: 'text', list: true, readOnly: true, group: 'Placement', get: placementTitle },
      { name: 'pieces', label: 'Pieces', type: 'number', list: true, readOnly: true, align: 'right', get: pieceCount },
      { name: 'sold', label: 'Sold', type: 'number', list: true, readOnly: true, align: 'right', get: soldUnits },
      { name: 'value', label: 'Value', type: 'money', list: true, readOnly: true, align: 'right', get: placedValue },
      { name: 'earnings', label: 'Your earnings', type: 'money', list: true, readOnly: true, align: 'right', get: makerEarnings },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'closed'],
        get: placementStatus,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } },
      { name: 'placedAt', label: 'Placed', type: 'date', list: true, readOnly: true, get: function (p) { return p.createdAt || null; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, p) {
        var t = placementTotals(p);
        var st = placementStatus(p);
        var tiles = UI.tiles([
          { k: 'Pieces placed', v: N.count(t.placed) || '0', hero: true },
          { k: 'Sold', v: N.count(t.soldUnits) || '0' },
          { k: 'Value', v: (N.money(t.retail) || '$0.00') },
          { k: 'Status', v: UI.badge(st === 'active' ? 'Active' : 'Closed', STATUS_TONE[st] || 'neutral') }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'pieces', label: 'Pieces' }
        ], 'ov');

        // Overview — gallery + status + commission terms + placed date + totals.
        var placement = UI.kv([
          { k: 'Gallery', v: esc(galleryName(p)) },
          { k: 'Status', v: UI.badge(st === 'active' ? 'Active' : 'Closed', STATUS_TONE[st] || 'neutral') },
          { k: 'Commission', v: esc(pctLabel(p)) + ' <span class="mu-sub">to gallery</span>' },
          { k: 'Contact', v: p.locationContact ? esc(p.locationContact) : '—' },
          { k: 'Email', v: p.locationEmail ? esc(p.locationEmail) : '—' },
          { k: 'Placed', v: p.createdAt ? N.date(p.createdAt) : '—' }
        ]);
        var earnings = UI.kv([
          { k: 'Total placed value', v: N.money(t.retail) || '$0.00' },
          { k: 'Total sold', v: N.money(t.sold) || '$0.00' },
          { k: 'Your earnings', v: N.money(t.makerEarnings) || '$0.00' },
          { k: 'Commission owed', v: N.money(t.commissionOwed) || '$0.00' },
          { k: 'Payouts received', v: N.money(settledDollars(p)) || '$0.00' },
          { k: 'Outstanding', v: N.money(outstandingDollars(p)) || '$0.00' }
        ]);
        var notes = p.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(p.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';
        // Placement editing + sale/return + payout settlement stay on legacy #galleries.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="ConsignmentsV2.classic()">Record sale / settle / manage in classic view →</button></div>';

        // Pieces — the consigned line items (on/under the record; cheap to read here).
        var lineItems = (p.lineItems && typeof p.lineItems === 'object') ? p.lineItems : {};
        var rows = Object.keys(lineItems).map(function (k) {
          var li = lineItems[k] || {};
          var qty = li.qty || 0, qtySold = li.qtySold || 0, qtyReturned = li.qtyReturned || 0, price = N.moneyVal(li, 'retailPrice', null) || 0;
          return {
            name: li.productName || 'Unknown',
            placed: qty, sold: qtySold,
            onHand: qty - qtySold - qtyReturned,
            retail: price,
            earns: qtySold * price * (1 - t.rate)
          };
        });
        var piecesBody = rows.length ? UI.relatedTable([
          { label: 'Piece', render: function (r) { return esc(r.name); } },
          { label: 'Placed', align: 'right', render: function (r) { return N.count(r.placed) || '0'; } },
          { label: 'Retail', align: 'right', render: function (r) { return N.money(r.retail) || '$0.00'; } },
          { label: 'Sold', align: 'right', render: function (r) { return N.count(r.sold) || '0'; } },
          { label: 'On hand', align: 'right', render: function (r) { return N.count(r.onHand); } },
          { label: 'Maker earns', align: 'right', render: function (r) { return N.money(r.earns) || '$0.00'; } }
        ], rows) : '<span class="mu-sub">No pieces on this placement — add items in the classic Galleries view.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Placement', placement) + UI.card('Earnings', earnings + manage) + UI.card('Notes', notes) + '</div>' +
          '<div class="mu-pane" data-pane="pieces" hidden>' + UI.cardTable('Consigned pieces (' + rows.length + ')', piecesBody) + '</div>';
      }
    }
    // No onSave -> no Edit button (placement editing + sale/return + settlement stay on legacy #galleries).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, galleries: {}, sortKey: 'placedAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    Promise.all([
      Promise.resolve(MastDB.get('admin/consignments')),
      Promise.resolve(MastDB.get('admin/galleries'))
    ]).then(function (res) {
      var plVal = res[0] || {}, galVal = res[1] || {};
      V2.galleries = (galVal && typeof galVal === 'object') ? galVal : {};
      var out = [];
      Object.keys(plVal).forEach(function (k) {
        var p = plVal[k];
        if (p && typeof p === 'object') { p = Object.assign({ placementId: k }, p); out.push(p); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.placementId] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[consignments-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (p) { return placementStatus(p) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (p) {
        if (String(galleryName(p)).toLowerCase().indexOf(q) >= 0) return true;
        if (String(p.locationContact || '').toLowerCase().indexOf(q) >= 0) return true;
        return String(p.locationEmail || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('consignments-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('consignmentsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'consignmentsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['closed', 'Closed']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ConsignmentsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Consignments',
        count: N.count(V2.rows.length) + ' placement' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="ConsignmentsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search gallery or contact…" value="' + esc(V2.q) +
        '" oninput="ConsignmentsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('consignments-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ConsignmentsV2.sort', onRowClickFnName: 'ConsignmentsV2.open',
        empty: { title: 'No consignment placements', message: V2.loaded ? 'Track pieces placed at galleries in the classic Galleries view.' : 'Loading…' }
      });
  }

  window.ConsignmentsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'placedAt' || key === 'pieces' || key === 'sold' || key === 'value' || key === 'earnings' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('consignments-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('consignments-v2', rec, 'read');
      });
    },
    // Placement editing + sale/return + payout machinery -> classic Galleries view.
    // Consignments live under the Galleries & Consignment surface (#galleries);
    // use navigateToClassic so the V2 route remap doesn't loop us back to a twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('galleries');
      else if (typeof navigateTo === 'function') navigateTo('galleries');
    },
    exportCsv: function () { return MastEntity.exportRows('consignments-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('consignments-v2', {
    routes: { 'consignments-v2': { tab: 'consignmentsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
