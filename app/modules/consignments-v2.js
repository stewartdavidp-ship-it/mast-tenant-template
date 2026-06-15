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

  // ── native line-item editing (sale / return / add / remove) ─────────
  // Sales, returns and add/remove of consigned pieces are native here, routed
  // through window.GalleriesBridge (the gated write core in consignment.js).
  // Payout settlement is the one action still single-sourced on classic
  // #galleries (no V2 home yet) — see classic() below.
  function canEdit() { return typeof window.can !== 'function' || window.can('galleries', 'edit'); }
  function canDelete() { return typeof window.can !== 'function' || window.can('galleries', 'delete'); }

  // The bridge lives in the classic consignment.js module; ensure it's loaded
  // before invoking it (mirrors GalleriesV2.create's loadModule('consignment')).
  function withBridge(method) {
    if (window.GalleriesBridge && typeof window.GalleriesBridge[method] === 'function') {
      return Promise.resolve(window.GalleriesBridge);
    }
    var loaded = (window.MastAdmin && typeof MastAdmin.loadModule === 'function')
      ? Promise.resolve(MastAdmin.loadModule('consignment')) : Promise.resolve();
    return loaded.then(function () {
      if (!(window.GalleriesBridge && typeof window.GalleriesBridge[method] === 'function')) {
        throw new Error('Consignment tools are still loading — try again in a moment.');
      }
      return window.GalleriesBridge;
    });
  }

  // Product options for the Add-piece dialog: prefer the live products cache,
  // else read public/products. price is in DOLLARS (the dialog's unit).
  function loadProducts() {
    if (Array.isArray(window.productsData) && window.productsData.length) {
      return Promise.resolve(window.productsData.filter(function (p) { return p && p.status !== 'archived'; }).map(function (p) {
        return { pid: p.pid, name: p.name || p.pid, price: (typeof p.retailPrice === 'number' ? p.retailPrice : (typeof p.priceCents === 'number' ? p.priceCents / 100 : 0)) };
      }));
    }
    return Promise.resolve(MastDB.get('public/products')).then(function (val) {
      val = (val && typeof val === 'object') ? val : {};
      return Object.keys(val).map(function (pid) {
        var p = val[pid] || {};
        return { pid: pid, name: p.name || pid, price: (typeof p.priceCents === 'number' ? p.priceCents / 100 : (typeof p.price === 'number' ? p.price : 0)), status: p.status };
      }).filter(function (p) { return p.status !== 'archived'; });
    });
  }

  // After a mutation: re-fetch the placement, refresh the cache + list row, and
  // re-render the open slide-out (mirrors WholesaleV2's post-write reopen).
  function reloadAndReopen(placementId) {
    return Promise.resolve(MastDB.get('admin/consignments/' + placementId)).then(function (raw) {
      if (raw && typeof raw === 'object') {
        var rec = Object.assign({ placementId: placementId, _key: placementId }, raw);
        V2.byId[placementId] = rec;
        var idx = V2.rows.findIndex(function (r) { return (r.placementId || r._key || r.id) === placementId; });
        if (idx >= 0) V2.rows[idx] = rec;
        MastEntity.openRecord('consignments-v2', rec, 'read');
      }
      render();
    });
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
    fetch: function (id) {
      // Cache-miss fallback so cross-drills (gallery -> placement) work even
      // when this module's list hasn't loaded yet in the session.
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return Promise.resolve(MastDB.get('admin/consignments/' + id)).then(function (p) {
        return p ? Object.assign({ _key: id }, p) : null;
      });
    },
    detail: {
      render: function (UI, p) {
        var t = placementTotals(p);
        var st = placementStatus(p);
        var pid = p.placementId || p._key || p.id;
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
          { k: 'Gallery', v: p.galleryId
              ? '<button type="button" class="mu-link" onclick="MastEntity.drill(\'galleries-v2\',\'' + esc(p.galleryId) + '\')">' + esc(galleryName(p)) + '</button>'
              : esc(galleryName(p)) + ' <span class="mu-sub" title="This placement predates gallery records and is matched by name only — edit it in the classic view to link it.">· name-matched</span>' },
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
        // Sale / return / add / remove are native (Pieces tab). Payout settlement
        // is the one action still single-sourced on legacy #galleries (no V2 home yet).
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="ConsignmentsV2.classic()">Settle payout in classic view →</button> <span class="mu-sub">Recording sales, returns &amp; pieces is native — use the Pieces tab.</span></div>';

        // Pieces — the consigned line items (on/under the record; cheap to read here).
        var lineItems = (p.lineItems && typeof p.lineItems === 'object') ? p.lineItems : {};
        var rows = Object.keys(lineItems).map(function (k) {
          var li = lineItems[k] || {};
          var qty = li.qty || 0, qtySold = li.qtySold || 0, qtyReturned = li.qtyReturned || 0, price = N.moneyVal(li, 'retailPrice', null) || 0;
          return {
            key: k,
            name: li.productName || 'Unknown',
            placed: qty, sold: qtySold, returned: qtyReturned,
            onHand: qty - qtySold - qtyReturned,
            retail: price,
            earns: qtySold * price * (1 - t.rate)
          };
        });
        var canAct = canEdit() || canDelete();
        var pieceCols = [
          { label: 'Piece', render: function (r) { return esc(r.name); } },
          { label: 'Placed', align: 'right', render: function (r) { return N.count(r.placed) || '0'; } },
          { label: 'Retail', align: 'right', render: function (r) { return N.money(r.retail) || '$0.00'; } },
          { label: 'Sold', align: 'right', render: function (r) { return N.count(r.sold) || '0'; } },
          { label: 'On hand', align: 'right', render: function (r) { return N.count(r.onHand); } },
          { label: 'Maker earns', align: 'right', render: function (r) { return N.money(r.earns) || '$0.00'; } }
        ];
        if (canAct) pieceCols.push({ label: '', align: 'right', render: function (r) {
          var b = [];
          if (canEdit() && r.onHand > 0) b.push('<button type="button" class="mu-link" onclick="ConsignmentsV2.sell(\'' + esc(pid) + '\',\'' + esc(r.key) + '\')">Sell</button>');
          if (canEdit() && r.sold > 0) b.push('<button type="button" class="mu-link" onclick="ConsignmentsV2.recordReturn(\'' + esc(pid) + '\',\'' + esc(r.key) + '\')">Return</button>');
          if (canDelete()) b.push('<button type="button" class="mu-link" onclick="ConsignmentsV2.removePiece(\'' + esc(pid) + '\',\'' + esc(r.key) + '\')">Remove</button>');
          return b.join(' &nbsp; ') || '<span class="mu-sub">—</span>';
        } });
        var addBtn = canEdit()
          ? '<div style="margin-bottom:10px;"><button class="btn btn-small btn-primary" onclick="ConsignmentsV2.addPiece(\'' + esc(pid) + '\')">+ Add piece</button></div>'
          : '';
        var piecesBody = addBtn + (rows.length
          ? UI.relatedTable(pieceCols, rows)
          : '<span class="mu-sub">No pieces on this placement yet.</span>');

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

    // ── native line-item actions (route through GalleriesBridge) ──
    sell: function (placementId, lineItemId) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to record sales.', true); return; }
      if (typeof window.mastPrompt !== 'function') { if (window.showToast) showToast('Dialog unavailable — try again', true); return; }
      Promise.resolve(window.mastPrompt('How many sold?', { title: 'Record sale', placeholder: 'Quantity', confirmLabel: 'Record sale' })).then(function (raw) {
        if (raw == null || String(raw).trim() === '') return;
        return withBridge('recordSale')
          .then(function (B) { return B.recordSale(placementId, lineItemId, raw); })
          .then(function () { if (window.showToast) showToast('Sale recorded'); return reloadAndReopen(placementId); });
      }).catch(function (e) { if (window.showToast) showToast((e && e.message) || 'Could not record sale', true); });
    },
    recordReturn: function (placementId, lineItemId) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to record returns.', true); return; }
      if (typeof window.mastPrompt !== 'function') { if (window.showToast) showToast('Dialog unavailable — try again', true); return; }
      Promise.resolve(window.mastPrompt('How many returned?', { title: 'Record return', placeholder: 'Quantity', confirmLabel: 'Record return' })).then(function (raw) {
        if (raw == null || String(raw).trim() === '') return;
        return withBridge('recordReturn')
          .then(function (B) { return B.recordReturn(placementId, lineItemId, raw); })
          .then(function () { if (window.showToast) showToast('Return recorded'); return reloadAndReopen(placementId); });
      }).catch(function (e) { if (window.showToast) showToast((e && e.message) || 'Could not record return', true); });
    },
    addPiece: function (placementId) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to add pieces.', true); return; }
      if (typeof openModal !== 'function') { if (window.showToast) showToast('Dialog unavailable — try again', true); return; }
      loadProducts().then(function (products) {
        var opts = '<option value="">Select a product…</option>' + products.map(function (pr) {
          var dollars = (typeof pr.price === 'number' && pr.price) ? pr.price : 0;
          return '<option value="' + esc(pr.pid) + '" data-name="' + esc(pr.name) + '" data-price="' + esc(String(dollars)) + '">' + esc(pr.name) + (dollars ? (' ($' + dollars.toFixed(2) + ')') : '') + '</option>';
        }).join('');
        var html = '<div class="modal-header"><h3>Add piece</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>' +
          '<div style="padding:20px;">' +
          '<div class="form-group" style="margin-bottom:14px;"><label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Product</label>' +
          '<select id="cv2AddProduct" class="form-input" style="width:100%;" onchange="ConsignmentsV2._priceFromProduct(this)">' + opts + '</select></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">' +
          '<div class="form-group"><label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Quantity</label><input id="cv2AddQty" type="number" min="1" value="1" class="form-input" style="width:100%;"></div>' +
          '<div class="form-group"><label style="display:block;font-size:0.85rem;font-weight:600;margin-bottom:4px;">Retail price ($)</label><input id="cv2AddPrice" type="number" min="0" step="0.01" class="form-input" style="width:100%;"></div>' +
          '</div>' +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="ConsignmentsV2.confirmAddPiece(\'' + esc(placementId) + '\')">Add piece</button>' +
          '</div></div>';
        openModal(html);
      }).catch(function (e) { if (window.showToast) showToast((e && e.message) || 'Could not load products', true); });
    },
    _priceFromProduct: function (sel) {
      var opt = sel && sel.options[sel.selectedIndex];
      var price = opt ? opt.getAttribute('data-price') : '';
      var el = document.getElementById('cv2AddPrice');
      if (el && price && parseFloat(price)) el.value = parseFloat(price).toFixed(2);
    },
    confirmAddPiece: function (placementId) {
      var sel = document.getElementById('cv2AddProduct');
      var qtyEl = document.getElementById('cv2AddQty');
      var priceEl = document.getElementById('cv2AddPrice');
      var ppid = sel ? sel.value : '';
      if (!ppid) { if (window.showToast) showToast('Select a product', true); return; }
      var opt = sel.options[sel.selectedIndex];
      var name = opt ? opt.getAttribute('data-name') : '';
      var qty = qtyEl ? parseInt(qtyEl.value, 10) : 0;
      var price = priceEl ? parseFloat(priceEl.value) : 0; // DOLLARS — bridge converts to cents
      withBridge('addLineItem')
        .then(function (B) { return B.addLineItem(placementId, { productId: ppid, productName: name, qty: qty, retailPrice: price }); })
        .then(function () { if (typeof closeModal === 'function') closeModal(); if (window.showToast) showToast('Piece added'); return reloadAndReopen(placementId); })
        .catch(function (e) { if (window.showToast) showToast((e && e.message) || 'Could not add piece', true); });
    },
    removePiece: function (placementId, lineItemId) {
      if (!canDelete()) { if (window.showToast) showToast('You do not have permission to remove pieces.', true); return; }
      if (typeof window.mastConfirm !== 'function') { if (window.showToast) showToast('Dialog unavailable — try again', true); return; }
      var rec = V2.byId[placementId];
      var li = rec && rec.lineItems && rec.lineItems[lineItemId];
      var name = (li && li.productName) || 'this piece';
      Promise.resolve(window.mastConfirm('Remove "' + name + '" from this placement?', { title: 'Remove piece' })).then(function (ok) {
        if (!ok) return;
        return withBridge('removeLineItem')
          .then(function (B) { return B.removeLineItem(placementId, lineItemId); })
          .then(function () { if (window.showToast) showToast('Piece removed'); return reloadAndReopen(placementId); });
      }).catch(function (e) { if (window.showToast) showToast((e && e.message) || 'Could not remove piece', true); });
    },

    // Payout settlement is the one placement action with no V2 home yet — it
    // stays single-sourced on classic #galleries. navigateToClassic so the V2
    // route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('galleries');
      else if (typeof navigateTo === 'function') navigateTo('galleries');
    },
    exportCsv: function () { return MastEntity.exportRows('consignments-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('consignments-v2', {
    routes: { 'consignments-v2': { tab: 'consignmentsV2Tab', setup: function () {
      ensureTab(); render(); load();
      // Warm the classic module so window.GalleriesBridge (the write core for
      // sale/return/add/remove) is ready by the time the user acts.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('consignment'); } catch (e) {} }
    } } }
  });
})();
