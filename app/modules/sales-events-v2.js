/**
 * sales-events-v2.js — read-focused Faceted Record twin of the legacy Sales
 * Events surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy sales.js (#salesEvents, part of the Sales/PoS module) hosts a sales-
 * event list (markets / fairs / pop-ups where sales happen) with an in-pane
 * detail (renderSalesEventDetail: summary cards + packed-items allocations +
 * status-driven Pack/Fair/Close actions). This twin re-hosts ONE surface — the
 * event list to read detail — on the Entity Engine: a schema-driven list + a
 * read-focused Faceted Record slide-out (Overview / Sales facets).
 *
 * Variant (doc 17 §1a): a sales event is a name/date/location/totals/status
 * record. Its status (planning / packed / active / closed) drives action
 * buttons in the legacy detail, but it is NOT a gated MastFlow lifecycle — there
 * are no exit-checklists, no guarded Advance, no MastFlow.define; transitions are
 * manual MastDB.update writes. So it is a Faceted Record (status = an assigned
 * attribute shown as the header badge), NOT Process / MastFlow.
 *
 * Read-focused: creating / editing an event, packing-mode allocation edits, the
 * fair PoS launch, manual sales and status transitions all carry domain logic
 * (inventory-location creation, allocation math, PoS) coupled to the legacy pane
 * and stay single-sourced on legacy #salesEvents via a "manage in classic view"
 * link. This twin re-hosts the VIEW only — no onSave, no edit form, no
 * packing / PoS sub-tools. Flag-gated (?ui=1) at #sales-events-v2, side-by-side.
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the legacy modal
 * field set — name / date / location / notes) + an onSave that DELEGATES to
 * window.SalesEventsBridge (exposed in sales.js) so the salesEvents write, the
 * create/update audit, and the create-time inventory-location auto-create stay
 * single-sourced — this twin never reimplements that logic (mirrors the
 * contacts-v2 / ContactsBridge precedent). Packing-mode allocation edits, the
 * fair PoS launch, and manual status transitions still carry domain logic
 * coupled to the legacy pane and keep a "manage in classic view" link (no V2
 * home). This twin re-hosts the VIEW + native event create/edit.
 *
 * Data: events live at admin/salesEvents (MastDB.salesEvents). Revenue + the
 * Sales facet are derived from admin/sales (sale.eventId === event id, excluding
 * voided) — sale.amount is in CENTS (legacy formatCents). Both are one-shot
 * keyed-object reads loaded together.
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

  function eventName(ev) { return (ev && ev.name) || '(unnamed)'; }
  function statusOf(ev) { return (ev && ev.status) || 'planning'; }
  function eventDate(ev) { return (ev && (ev.date || ev.createdAt)) || null; }

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
    var id = ev && (ev._key || ev.id || ev.eventId);
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

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('sales-events-v2', {
    label: 'Sales event', labelPlural: 'Sales Events', size: 'lg',
    route: 'sales-events-v2',
    recordId: function (ev) { return ev._key || ev.id || ev.eventId; },
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
          { key: 'ov', label: 'Overview' }, { key: 'sales', label: 'Sales' }
        ], 'ov');

        // Overview — event details + packed/sold/sell-through + notes.
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
        // Event create/edit is NATIVE now (the Edit button on this slide-out).
        // What still has NO V2 home: packing-mode allocation edits, the fair PoS
        // launch, and manual status transitions (Pack/Fair/Close) — those carry
        // domain logic coupled to the legacy pane and stay on #salesEvents. Use
        // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="SalesEventsV2.classic()">Pack / launch fair / change status in classic view →</button></div>';

        // Sales — event-linked, non-voided sales (revenue attribution).
        var salesBody = sales.length ? UI.relatedTable([
          { label: 'Sale', render: function (s) { return esc(s.saleNumber || s._key || '—'); } },
          { label: 'Items', render: function (s) { return '<span class="mu-sub">' + esc(saleItemsLabel(s)) + '</span>'; } },
          { label: 'Channel', render: function (s) { return s.channel ? '<span class="mu-sub">' + esc(s.channel) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Amount', align: 'right', render: function (s) { return N.money((s.amount || 0) / 100); } }
        ], sales) : '<span class="mu-sub">No sales recorded for this event yet.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Event', details) +
            UI.card('Totals', totals) +
            UI.card('Notes', notesBody + manage) +
          '</div>' +
          '<div class="mu-pane" data-pane="sales" hidden>' + UI.cardTable('Sales (' + sales.length + ')', salesBody) + '</div>';
      },
      // Native edit form — the legacy createEventModal field set: name (required),
      // date (required), location, notes. Packing / PoS / status transitions are
      // NOT edited here (no domain logic in this twin) — a partial update via the
      // Bridge preserves status / allocations / closedAt etc.
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
      var id = rec._key || rec.id || rec.eventId;
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

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, salesByEvent: {}, sortKey: 'date', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure the legacy sales module is loaded so window.SalesEventsBridge (the
    // delegated write path) exists — mirrors contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('sales'); } catch (e) {} }
    // Events + sales load together; both one-shot keyed-object reads. Sales are
    // indexed by eventId for the Revenue column + Sales facet.
    Promise.all([
      Promise.resolve(MastDB.get('admin/salesEvents')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/sales')).catch(function () { return null; })
    ]).then(function (res) {
      var ev = res[0] || {}, sv = res[1] || {};
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
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.salesByEvent = byEvent;
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[sales-events-v2] load', e); render(); });
  }
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
    // Event create/edit is native (the Edit + New buttons on this twin). What
    // still has NO V2 home: packing-mode allocation edits, the fair PoS launch,
    // and manual status transitions — those stay bespoke on legacy #salesEvents.
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('salesEvents');
      else if (typeof navigateTo === 'function') navigateTo('salesEvents');
    },
    exportCsv: function () { return MastEntity.exportRows('sales-events-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('sales-events-v2', {
    routes: { 'sales-events-v2': { tab: 'salesEventsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
