/**
 * sales-events-v2.js — Faceted Record twin of the legacy Sales Events surface
 * (doc 17 §11/§12; conversion playbook).
 *
 * Legacy sales.js (#salesEvents, part of the Sales/PoS module) hosts a sales-
 * event list (markets / fairs / pop-ups where sales happen) with an in-pane
 * detail (renderSalesEventDetail: summary cards + packed-items allocations +
 * status-driven Pack/Fair/Close actions). This twin re-hosts that surface — the
 * event list to read detail — on the Entity Engine: a schema-driven list + a
 * Faceted Record slide-out (Overview / Allocations / Sales facets).
 *
 * Variant (doc 17 §1a): a sales event is a name/date/location/totals/status
 * record. Its status (planning / packed / active / closed) drives action
 * buttons, but it is NOT a gated MastFlow lifecycle — there are no exit-
 * checklists, no guarded Advance, no MastFlow.define; transitions are manual
 * MastDB.update writes. So it is a Faceted Record (status = an assigned
 * attribute shown as the header badge), NOT Process / MastFlow.
 *
 * NATIVE here — no classic escape hatch remains:
 *  - Create + edit: a custom detail.editRender (name / date / location / notes)
 *    + onSave delegating to window.SalesEventsBridge (so the salesEvents write,
 *    audit, and create-time inventory-location auto-create stay single-sourced).
 *  - Allocations CRUD (Allocations tab): allocate a packed quantity per product,
 *    adjust, remove — RBAC-gated (can('pos','edit')) + writeAudit via
 *    SalesEventsBridge.{upsertAllocation,removeAllocation}.
 *  - Status transitions (Overview actions): planning → packed → active → closed
 *    via SalesEventsBridge.setStatus, plus close → SalesEventsBridge.closeAndReconcile
 *    (the inventory reconciliation legacy applyEventReconciliation performs).
 *  - PoS launch ("Start fair" + "Open PoS"): Start fair is a plain status write
 *    (packed → active) that stamps the module's activeEventId; Open PoS opens the
 *    storefront PoS (../pos/?eventId=…). There is NO Cloud Function and NO till
 *    provisioning — the storefront PoS reads ?eventId and links live sales.
 *
 * Camera-vision packing (legacy "Start Packing" overlay) and offline manual-sale
 * entry are NOT re-hosted here — they are separate from the pack/launch/status
 * surface this twin closes, and manual sale carries the recordTenantRevenue
 * accumulator call (its own follow-up). The Allocations tab is the native
 * equivalent of building the packing list. Flag-gated (?ui=1) at #sales-events-v2.
 *
 * Data: events live at admin/salesEvents (MastDB.salesEvents). Revenue + the
 * Sales facet are derived from admin/sales (sale.eventId === event id, excluding
 * voided) — sale.amount is in CENTS (legacy formatCents). Products (for the
 * allocation picker) are a one-shot read of public/products. All keyed-object
 * reads loaded together.
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

  // Status vocabulary mirrors sales.js (EVENT_STATUS_COLORS keys + saveEvent
  // default 'planning'). Tones map to the shared badge palette (no hex here).
  var STATUS_LABEL = { planning: 'Planning', packed: 'Packed', active: 'Active', closed: 'Closed' };
  var STATUS_TONE = { planning: 'info', packed: 'amber', active: 'success', closed: 'neutral' };

  // ── module state + data ─────────────────────────────────────────────
  // reconOpen holds the event id whose Overview pane is showing the close/
  // reconcile form (instead of the status actions); products/productById feed
  // the Allocations "add product" picker.
  var V2 = { rows: [], byId: {}, salesByEvent: {}, products: [], productById: {},
             sortKey: 'date', sortDir: 'desc', q: '', statusFilter: 'all', reconOpen: null, loaded: false };

  function eventName(ev) { return (ev && ev.name) || '(unnamed)'; }
  function statusOf(ev) { return (ev && ev.status) || 'planning'; }
  function eventDate(ev) { return (ev && (ev.date || ev.createdAt)) || null; }
  function recordIdOf(ev) { return ev && (ev._key || ev.id || ev.eventId); }

  // Packed/sold totals from the allocations map (mirrors getEventAllocationsStats).
  function allocStats(ev) {
    var packed = 0, sold = 0, products = 0;
    var allocs = ev && ev.allocations;
    if (allocs) {
      Object.keys(allocs).forEach(function (pid) {
        var a = allocs[pid] || {};
        packed += (a.quantity || 0);
        sold += (a.sold || 0);
        products++;
      });
    }
    return { packed: packed, sold: sold, products: products };
  }
  function sellThroughPct(ev) {
    var s = allocStats(ev);
    return s.packed > 0 ? Math.round(s.sold / s.packed * 100) : null;
  }

  // Event-linked, non-voided sales (mirrors renderSalesEventDetail). One-shot
  // read of admin/sales, indexed by event id at load.
  function salesFor(ev) {
    var id = recordIdOf(ev);
    return (id && V2.salesByEvent[id]) ? V2.salesByEvent[id] : [];
  }
  // Revenue in DOLLARS (sale.amount is CENTS). null when there are no sales so
  // the money helpers render an em-dash rather than a misleading $0.00.
  function revenueDollars(ev) {
    var list = salesFor(ev);
    if (!list.length) return null;
    var cents = 0;
    list.forEach(function (s) { cents += (s.amount || 0); });
    return cents / 100;
  }
  function saleItemsLabel(s) {
    var items = s && s.items;
    if (!items || !items.length) return '0 items';
    var n = 0; items.forEach(function (it) { n += (it.quantity || 1); });
    return n + (n === 1 ? ' item' : ' items');
  }

  // ── RBAC + small toast helpers (shared by the native action handlers) ──
  function canEditEvents() { return typeof window.can !== 'function' || window.can('pos', 'edit'); }
  function notPermitted() { if (window.showToast) showToast('You don\'t have permission to do that.', true); }
  function engineLoading() { if (window.showToast) showToast('Sales engine still loading — try again', true); }
  function actionErr(e) { console.error('[sales-events-v2] action', e); if (window.showToast) showToast('Error: ' + ((e && e.message) || e), true); }

  // Re-open the slide-out on the same record (used after a status change so the
  // refreshed action set + badge render).
  function reopen(id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('sales-events-v2', rec, 'read'); }
  // Reload data (let a write settle), then re-open the record + refresh the list.
  function reloadThenOpen(id) {
    V2.loaded = false;
    setTimeout(function () {
      loadData().then(function () { render(); reopen(id); });
    }, 250);
  }
  // Optimistic local mutate of a cached allocation (so the Allocations table can
  // re-render in place without a full reopen — keeps the user on the tab).
  function mutAlloc(id, pid, patch) {
    var ev = V2.byId[id]; if (!ev) return;
    ev.allocations = ev.allocations || {};
    ev.allocations[pid] = Object.assign({}, ev.allocations[pid], patch);
  }
  function refreshAllocPane(id) {
    var ev = V2.byId[id]; if (!ev) return;
    var pane = document.querySelector('#mastSlideOutBody .mu-pane[data-pane="alloc"]');
    // Re-wrap with the same cardTable the initial detail render used, so the
    // "Packed items" card header survives an in-place refresh.
    if (pane) pane.innerHTML = U.cardTable('Packed items (' + allocStats(ev).products + ')', allocPaneInner(ev));
  }

  // ── Overview: native status / PoS-launch actions ────────────────────
  // Mirrors the legacy renderSalesEventDetail action set (minus camera packing,
  // which the Allocations tab replaces). planning → packed → active → closed.
  function statusActions(ev) {
    var id = recordIdOf(ev);
    var st = statusOf(ev);
    var stats = allocStats(ev);
    if (!canEditEvents()) {
      return '<span class="mu-sub">Status: ' + esc(STATUS_LABEL[st] || st) + '. You don\'t have permission to change it.</span>';
    }
    var jid = "'" + id + "'";
    var btns = [];
    var hint = '';
    if (st === 'planning') {
      var canPack = stats.products > 0;
      btns.push('<button class="btn btn-primary"' + (canPack ? '' : ' disabled title="Allocate at least one product first"') +
        ' onclick="SalesEventsV2.markPacked(' + jid + ')">📦 Mark as packed</button>');
      hint = 'Allocate products in the Allocations tab, then mark the event packed.';
    } else if (st === 'packed') {
      btns.push('<button class="btn btn-success" onclick="SalesEventsV2.startFair(' + jid + ')">🏪 Start fair</button>');
      btns.push('<button class="btn btn-secondary" onclick="SalesEventsV2.revertPlanning(' + jid + ')">↩️ Back to planning</button>');
      hint = 'Starting the fair links PoS sales to this event.';
    } else if (st === 'active') {
      btns.push('<button class="btn btn-primary" onclick="SalesEventsV2.openPoS(' + jid + ')">💰 Open PoS ↗</button>');
      btns.push('<button class="btn btn-danger" onclick="SalesEventsV2.closeBegin(' + jid + ')">🏁 Close &amp; reconcile</button>');
      hint = 'Open PoS records live sales; close &amp; reconcile when the event ends.';
    } else if (st === 'closed') {
      return '<span class="mu-sub">Closed' + (ev.closedAt ? ' on ' + N.date(ev.closedAt) : '') + '. ' +
        N.count(stats.sold) + ' sold of ' + N.count(stats.packed) + ' packed.</span>';
    }
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + btns.join('') + '</div>' +
      (hint ? '<div class="mu-sub" style="margin-top:8px;">' + hint + '</div>' : '');
  }

  // ── Overview: native close / reconcile form (replaces the legacy modal) ──
  function reconFormInner(ev) {
    var id = recordIdOf(ev);
    var allocs = ev.allocations || {};
    var rows = Object.keys(allocs).map(function (pid) {
      var a = allocs[pid] || {};
      var packed = a.quantity || 0, sold = a.sold || 0, remaining = packed - sold;
      return '<tr style="border-bottom:1px solid var(--cream-dark);">' +
        '<td style="padding:4px 6px;">' + esc(a.productName || pid) + '</td>' +
        '<td style="text-align:center;color:var(--warm-gray);">' + packed + '</td>' +
        '<td style="text-align:center;font-weight:600;">' + sold + '</td>' +
        '<td style="text-align:center;"><input type="number" min="0" max="' + remaining + '" value="' + remaining + '" class="seV2-ret" data-pid="' + esc(pid) + '" style="width:56px;text-align:center;"></td>' +
        '<td style="text-align:center;"><input type="number" min="0" max="' + remaining + '" value="0" class="seV2-dmg" data-pid="' + esc(pid) + '" style="width:56px;text-align:center;"></td>' +
        '</tr>';
    }).join('');
    var jid = "'" + id + "'";
    return '<div class="mu-editbar"><span class="mu-editpill">CLOSING</span>Reconcile &amp; close — account for unsold packed items.</div>' +
      '<div style="overflow:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:2px solid var(--cream-dark);">' +
          '<th style="text-align:left;padding:4px 6px;">Product</th><th>Packed</th><th>Sold</th><th>Returned</th><th>Damaged</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">' +
        '<button class="btn btn-secondary" onclick="SalesEventsV2.closeCancel(' + jid + ')">Cancel</button>' +
        '<button class="btn btn-danger" onclick="SalesEventsV2.closeConfirm(' + jid + ')">Close &amp; reconcile</button>' +
      '</div>';
  }

  // ── Allocations tab: native packing-list editor ─────────────────────
  function allocPaneInner(ev) {
    var id = recordIdOf(ev);
    var st = statusOf(ev);
    var editable = (st !== 'closed') && canEditEvents();
    var allocs = ev.allocations || {};
    var pids = Object.keys(allocs);

    var addCtl = '';
    if (editable) {
      var taken = {}; pids.forEach(function (p) { taken[p] = true; });
      var opts = (V2.products || []).filter(function (p) { return !taken[p.pid]; })
        .map(function (p) { return '<option value="' + esc(p.pid) + '">' + esc(p.name) + '</option>'; }).join('');
      if (opts) {
        addCtl = '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px;">' +
          '<div><label class="mu-sub" style="display:block;">Product</label>' +
            '<select id="seV2AllocPick" class="form-input" style="min-width:200px;font-size:0.9rem;">' + opts + '</select></div>' +
          '<div><label class="mu-sub" style="display:block;">Qty</label>' +
            '<input id="seV2AllocQty" class="form-input" type="number" min="1" value="1" style="width:80px;font-size:0.9rem;"></div>' +
          '<button class="btn btn-secondary" onclick="SalesEventsV2.allocAdd(\'' + id + '\')">+ Add product</button>' +
        '</div>';
      } else if (V2.products && V2.products.length && pids.length) {
        addCtl = '<div class="mu-sub" style="margin-bottom:10px;">All products are allocated. Adjust quantities below.</div>';
      } else if (!V2.products || !V2.products.length) {
        addCtl = '<div class="mu-sub" style="margin-bottom:10px;">No products available to allocate.</div>';
      }
    }

    var body;
    if (!pids.length) {
      body = '<span class="mu-sub">No products allocated yet.' + (editable ? ' Add one above to start the packing list.' : '') + '</span>';
    } else {
      var rows = pids.map(function (pid) {
        var a = allocs[pid] || {};
        var packed = a.quantity || 0, sold = a.sold || 0, remaining = packed - sold;
        var packedCell = editable
          ? '<input type="number" min="0" value="' + packed + '" class="seV2-qty" data-pid="' + esc(pid) + '" onchange="SalesEventsV2.allocSetQty(\'' + id + '\', this.dataset.pid)" style="width:64px;text-align:center;font-size:0.85rem;">'
          : String(packed);
        var lastCell = editable
          ? '<button class="btn btn-secondary btn-small" data-pid="' + esc(pid) + '" style="color:var(--danger);padding:2px 8px;" onclick="SalesEventsV2.allocRemove(\'' + id + '\', this.dataset.pid)" title="Remove from packing list">✕</button>'
          : (packed > 0 ? Math.round(sold / packed * 100) + '%' : '—');
        return '<tr style="border-bottom:1px solid var(--cream-dark);">' +
          '<td style="padding:4px 6px;font-weight:600;">' + esc(a.productName || pid) + '</td>' +
          '<td style="text-align:center;">' + packedCell + '</td>' +
          '<td style="text-align:center;">' + sold + '</td>' +
          '<td style="text-align:center;">' + remaining + '</td>' +
          '<td style="text-align:center;">' + lastCell + '</td>' +
        '</tr>';
      }).join('');
      body = '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">' +
        '<thead><tr style="border-bottom:2px solid var(--cream-dark);">' +
          '<th style="text-align:left;padding:4px 6px;">Product</th>' +
          '<th style="text-align:center;">Packed</th><th style="text-align:center;">Sold</th>' +
          '<th style="text-align:center;">Remaining</th>' +
          '<th style="text-align:center;">' + (editable ? '' : 'Sell-through') + '</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>';
    }
    return addCtl + body;
  }

  // ── schema (Faceted Record; create/edit native, read facets) ────────
  MastEntity.define('sales-events-v2', {
    label: 'Sales event', labelPlural: 'Sales Events', size: 'lg',
    route: 'sales-events-v2',
    recordId: function (ev) { return recordIdOf(ev); },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Event', type: 'text', list: true, required: true, group: 'Event', get: eventName },
      { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true, get: eventDate },
      { name: 'location', label: 'Location', type: 'text', list: true, readOnly: true, get: function (ev) { return ev.location || '—'; } },
      { name: 'revenue', label: 'Revenue', type: 'money', list: true, readOnly: true, align: 'right', get: revenueDollars },
      { name: 'sold', label: 'Sold', type: 'number', list: true, readOnly: true, align: 'right', sortable: false, get: function (ev) { return allocStats(ev).sold; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['planning', 'packed', 'active', 'closed'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, ev) {
        var id = recordIdOf(ev);
        var stats = allocStats(ev);
        var rev = revenueDollars(ev);
        var stPct = sellThroughPct(ev);
        var sales = salesFor(ev);

        var tiles = UI.tiles([
          { k: 'Revenue', v: (N.money(rev) || '—'), hero: true },
          { k: 'Items sold', v: N.count(stats.sold) },
          { k: 'Date', v: eventDate(ev) ? N.date(eventDate(ev)) : '—' },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(ev)] || 'Planning', STATUS_TONE[statusOf(ev)] || 'neutral') }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'alloc', label: 'Allocations' }, { key: 'sales', label: 'Sales' }
        ], 'ov');

        // Overview — native actions (or the close/reconcile form) + event details
        // + packed/sold/sell-through + notes.
        var actionsInner = (V2.reconOpen === id) ? reconFormInner(ev) : statusActions(ev);

        var details = UI.kv([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(ev)] || 'Planning', STATUS_TONE[statusOf(ev)] || 'neutral') },
          { k: 'Date', v: eventDate(ev) ? N.date(eventDate(ev)) : '—' },
          { k: 'Location', v: ev.location ? esc(ev.location) : '—' },
          { k: 'Created', v: ev.createdAt ? N.date(ev.createdAt) : '—' },
          { k: 'Closed', v: ev.closedAt ? N.date(ev.closedAt) : '—' }
        ]);
        var totals = UI.kv([
          { k: 'Revenue', v: N.money(rev) || '—' },
          { k: 'Items packed', v: N.count(stats.packed) },
          { k: 'Items sold', v: N.count(stats.sold) },
          { k: 'Remaining', v: N.count(stats.packed - stats.sold) },
          { k: 'Sell-through', v: stPct == null ? '—' : (stPct + '%') },
          { k: 'Products packed', v: N.count(stats.products) },
          { k: 'Sales recorded', v: N.count(sales.length) }
        ]);
        var notesBody = ev.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(ev.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';

        // Sales — event-linked, non-voided sales (revenue attribution).
        var salesBody = sales.length ? UI.relatedTable([
          { label: 'Sale', render: function (s) { return esc(s.saleNumber || s._key || '—'); } },
          { label: 'Items', render: function (s) { return '<span class="mu-sub">' + esc(saleItemsLabel(s)) + '</span>'; } },
          { label: 'Channel', render: function (s) { return s.channel ? '<span class="mu-sub">' + esc(s.channel) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Amount', align: 'right', render: function (s) { return N.money((s.amount || 0) / 100); } }
        ], sales) : '<span class="mu-sub">No sales recorded for this event yet.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Actions', actionsInner) +
            UI.card('Event', details) +
            UI.card('Totals', totals) +
            UI.card('Notes', notesBody) +
          '</div>' +
          '<div class="mu-pane" data-pane="alloc" hidden>' + UI.cardTable('Packed items (' + stats.products + ')', allocPaneInner(ev)) + '</div>' +
          '<div class="mu-pane" data-pane="sales" hidden>' + UI.cardTable('Sales (' + sales.length + ')', salesBody) + '</div>';
      },
      // Native edit form — the legacy createEventModal field set: name (required),
      // date (required), location, notes. Packing / status / close are NOT edited
      // here — a partial update via the Bridge preserves status / allocations / etc.
      editRender: function (ev, mode) {
        ev = ev || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New sales event' : 'Edit this event') + '</div>' +
          fg('Event name *', '<input class="form-input" id="seV2Name" value="' + esc(ev.name || '') + '" style="width:100%;" placeholder="Spring craft fair">') +
          row2(
            fg('Date *', '<input class="form-input" type="date" id="seV2Date" value="' + esc((ev.date || '').slice(0, 10)) + '" style="width:100%;">', true),
            fg('Location', '<input class="form-input" id="seV2Location" value="' + esc(ev.location || '') + '" style="width:100%;" placeholder="Venue or city">', true)
          ) +
          fg('Notes', '<textarea class="form-input" id="seV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(ev.notes || '') + '</textarea>');
      }
    },
    onSave: function (rec, mode) {
      if (!window.SalesEventsBridge) { if (window.showToast) showToast('Sales engine still loading — try again', true); return false; }
      var data = {
        name: ((document.getElementById('seV2Name') || {}).value || '').trim(),
        date: (document.getElementById('seV2Date') || {}).value || '',
        location: ((document.getElementById('seV2Location') || {}).value || '').trim(),
        notes: ((document.getElementById('seV2Notes') || {}).value || '').trim()
      };
      // Mirror legacy saveEvent() validation exactly.
      if (!data.name) { if (window.showToast) showToast('Event name is required', true); return false; }
      if (!data.date) { if (window.showToast) showToast('Event date is required', true); return false; }

      if (mode === 'create') {
        return Promise.resolve(window.SalesEventsBridge.create(data)).then(function () {
          if (window.showToast) showToast('Event created!'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[sales-events-v2] create', e); if (window.showToast) showToast('Error saving event.', true); return false; });
      }
      var id = recordIdOf(rec);
      return Promise.resolve(window.SalesEventsBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open. Only the
        // editable fields are merged — status / allocations are left intact.
        Object.assign(V2.byId[id] || rec, {
          name: data.name, date: data.date,
          location: data.location || null, notes: data.notes || null
        });
        if (window.showToast) showToast('Event updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[sales-events-v2] update', e); if (window.showToast) showToast('Error updating event.', true); return false; });
    }
  });

  // ── data ────────────────────────────────────────────────────────────
  function loadData() {
    // Ensure the legacy sales module is loaded so window.SalesEventsBridge (the
    // delegated write path) exists — mirrors contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('sales'); } catch (e) {} }
    // Events + sales + products load together; all one-shot keyed-object reads.
    // Sales are indexed by eventId (Revenue column + Sales facet); products feed
    // the Allocations "add product" picker (id → name, dropping discontinued/
    // archived — mirrors buildProductCatalogForVision / filterPackProducts).
    return Promise.all([
      Promise.resolve(MastDB.get('admin/salesEvents')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/sales')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/products')).catch(function () { return null; })
    ]).then(function (res) {
      var ev = res[0] || {}, sv = res[1] || {}, pv = res[2] || {};
      var out = [];
      Object.keys(ev).forEach(function (k) {
        var e = ev[k];
        if (e && typeof e === 'object') { e = Object.assign({ _key: k }, e); e.status = e.status || 'planning'; out.push(e); }
      });
      var byEvent = {};
      Object.keys(sv).forEach(function (k) {
        var s = sv[k];
        if (!s || typeof s !== 'object') return;
        if (!s.eventId || s.status === 'voided') return;
        s = Object.assign({ _key: k }, s);
        (byEvent[s.eventId] = byEvent[s.eventId] || []).push(s);
      });
      Object.keys(byEvent).forEach(function (id) {
        byEvent[id].sort(function (a, b) { return (b.timestamp || 0) - (a.timestamp || 0); });
      });
      var products = [], productById = {};
      Object.keys(pv).forEach(function (pid) {
        var p = pv[pid];
        if (!p || typeof p !== 'object') return;
        if (p.availability === 'discontinued' || p.status === 'archived') return;
        var name = p.name || pid;
        products.push({ pid: pid, name: name });
        productById[pid] = name;
      });
      products.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.salesByEvent = byEvent;
      V2.products = products; V2.productById = productById;
      V2.loaded = true;
    }).catch(function (e) { console.error('[sales-events-v2] load', e); V2.loaded = true; });
  }
  function load() { return loadData().then(render); }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (ev) { return statusOf(ev) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (ev) {
        return String(ev.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(ev.location || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('sales-events-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('salesEventsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'salesEventsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['planning', 'Planning'], ['packed', 'Packed'], ['active', 'Active'], ['closed', 'Closed']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="SalesEventsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Sales Events',
        count: N.count(V2.rows.length) + ' event' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-primary" onclick="SalesEventsV2.create()">+ New event</button>' +
          '<button class="btn btn-secondary" onclick="SalesEventsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or location…" value="' + esc(V2.q) +
        '" oninput="SalesEventsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('sales-events-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'SalesEventsV2.sort', onRowClickFnName: 'SalesEventsV2.open',
        empty: { title: 'No sales events', message: V2.loaded ? 'Create a market, fair or pop-up to get started.' : 'Loading…' }
      });
  }

  window.SalesEventsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'revenue' || key === 'date' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      V2.reconOpen = null;
      MastEntity.get('sales-events-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('sales-events-v2', rec, 'read');
      });
    },
    create: function () {
      // Ensure the legacy module (and thus window.SalesEventsBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('sales'); } catch (e) {} }
      MastEntity.openRecord('sales-events-v2', {}, 'create');
    },

    // ── Status transitions (native) ──
    markPacked: function (id) {
      if (!canEditEvents()) return notPermitted();
      if (!window.SalesEventsBridge) return engineLoading();
      var ev = V2.byId[id];
      if (!ev || allocStats(ev).products < 1) { if (window.showToast) showToast('Allocate at least one product before packing.', true); return; }
      Promise.resolve(window.SalesEventsBridge.setStatus(id, 'packed')).then(function () {
        if (window.showToast) showToast('Event marked as packed.'); reloadThenOpen(id);
      }).catch(actionErr);
    },
    startFair: function (id) {
      if (!canEditEvents()) return notPermitted();
      if (!window.SalesEventsBridge) return engineLoading();
      var go = function () {
        Promise.resolve(window.SalesEventsBridge.setStatus(id, 'active')).then(function () {
          if (window.showToast) showToast('Fair started — PoS sales now link to this event.'); reloadThenOpen(id);
        }).catch(actionErr);
      };
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm('Start the fair? PoS sales will link to this event.', { title: 'Start fair' })).then(function (ok) { if (ok) go(); });
      else go();
    },
    revertPlanning: function (id) {
      if (!canEditEvents()) return notPermitted();
      if (!window.SalesEventsBridge) return engineLoading();
      Promise.resolve(window.SalesEventsBridge.setStatus(id, 'planning')).then(function () {
        if (window.showToast) showToast('Event reverted to planning.'); reloadThenOpen(id);
      }).catch(actionErr);
    },
    // Mirror legacy: open the storefront PoS for this event in a new tab. No Cloud
    // Function — the PoS reads ?eventId and links live sales to the active event.
    openPoS: function (id) {
      try { window.open('../pos/?eventId=' + encodeURIComponent(id), '_blank'); } catch (e) {}
    },

    // ── Close + reconcile (native; replaces the legacy reconciliation modal) ──
    closeBegin: function (id) {
      if (!canEditEvents()) return notPermitted();
      var ev = V2.byId[id]; if (!ev) return;
      if (!ev.allocations || !Object.keys(ev.allocations).length) {
        // Nothing to reconcile — confirm + close straight through.
        var go = function () {
          if (!window.SalesEventsBridge) return engineLoading();
          Promise.resolve(window.SalesEventsBridge.closeAndReconcile(id, {}, ev)).then(function () {
            if (window.showToast) showToast('Event closed.'); reloadThenOpen(id);
          }).catch(actionErr);
        };
        if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm('Close this event? It has no packed items to reconcile.', { title: 'Close event' })).then(function (ok) { if (ok) go(); });
        else go();
        return;
      }
      V2.reconOpen = id; reopen(id);
    },
    closeCancel: function (id) { V2.reconOpen = null; reopen(id); },
    closeConfirm: function (id) {
      if (!canEditEvents()) return notPermitted();
      if (!window.SalesEventsBridge) return engineLoading();
      var ev = V2.byId[id]; if (!ev) return;
      var reconMap = {};
      document.querySelectorAll('#mastSlideOutBody .seV2-ret').forEach(function (el) {
        var pid = el.getAttribute('data-pid'); (reconMap[pid] = reconMap[pid] || {}).returned = parseInt(el.value, 10) || 0;
      });
      document.querySelectorAll('#mastSlideOutBody .seV2-dmg').forEach(function (el) {
        var pid = el.getAttribute('data-pid'); (reconMap[pid] = reconMap[pid] || {}).damaged = parseInt(el.value, 10) || 0;
      });
      Promise.resolve(window.SalesEventsBridge.closeAndReconcile(id, reconMap, ev)).then(function (summary) {
        V2.reconOpen = null;
        var msg = 'Event closed. ' + summary.totalReturned + ' returned';
        if (summary.totalDamaged > 0) msg += ', ' + summary.totalDamaged + ' damaged';
        if (summary.totalUnaccounted > 0) msg += ', ' + summary.totalUnaccounted + ' unaccounted';
        if (window.showToast) showToast(msg + '.');
        reloadThenOpen(id);
      }).catch(actionErr);
    },

    // ── Allocations CRUD (native) ──
    allocAdd: function (id) {
      if (!canEditEvents()) return notPermitted();
      if (!window.SalesEventsBridge) return engineLoading();
      var sel = document.getElementById('seV2AllocPick');
      var qtyEl = document.getElementById('seV2AllocQty');
      var pid = sel && sel.value;
      var qty = Math.max(1, parseInt(qtyEl && qtyEl.value, 10) || 1);
      if (!pid) { if (window.showToast) showToast('Pick a product to add.', true); return; }
      var name = V2.productById[pid] || pid;
      Promise.resolve(window.SalesEventsBridge.upsertAllocation(id, pid, name, qty)).then(function () {
        mutAlloc(id, pid, { quantity: qty, productName: name });
        if (window.showToast) showToast('Added ' + name + ' ×' + qty);
        refreshAllocPane(id); reloadSoon();
      }).catch(actionErr);
    },
    allocSetQty: function (id, pid) {
      if (!canEditEvents()) return notPermitted();
      if (!window.SalesEventsBridge) return engineLoading();
      var ev = V2.byId[id];
      var input = document.querySelector('#mastSlideOutBody .seV2-qty[data-pid="' + cssEscape(pid) + '"]');
      var qty = Math.max(0, parseInt(input && input.value, 10) || 0);
      var existing = ev && ev.allocations && ev.allocations[pid];
      var name = (existing && existing.productName) || V2.productById[pid] || pid;
      Promise.resolve(window.SalesEventsBridge.upsertAllocation(id, pid, name, qty)).then(function () {
        mutAlloc(id, pid, { quantity: qty, productName: name });
        refreshAllocPane(id); reloadSoon();
      }).catch(actionErr);
    },
    allocRemove: function (id, pid) {
      if (!canEditEvents()) return notPermitted();
      if (!window.SalesEventsBridge) return engineLoading();
      var go = function () {
        Promise.resolve(window.SalesEventsBridge.removeAllocation(id, pid)).then(function () {
          if (V2.byId[id] && V2.byId[id].allocations) delete V2.byId[id].allocations[pid];
          if (window.showToast) showToast('Removed from packing list.');
          refreshAllocPane(id); reloadSoon();
        }).catch(actionErr);
      };
      if (typeof window.mastConfirm === 'function') Promise.resolve(window.mastConfirm('Remove this product from the packing list?', { title: 'Remove product' })).then(function (ok) { if (ok) go(); });
      else go();
    },

    exportCsv: function () { return MastEntity.exportRows('sales-events-v2', visibleRows(), 'all'); }
  };

  // CSS.escape shim for attribute-selector lookups by pid (pids are safe Firebase
  // keys, but guard anyway for older engines).
  function cssEscape(s) { return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\\]]/g, '\\$&'); }

  MastAdmin.registerModule('sales-events-v2', {
    routes: { 'sales-events-v2': { tab: 'salesEventsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
