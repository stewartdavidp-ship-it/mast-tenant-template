/**
 * trips-v2.js — conversion #2 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy `trips.js` shows completed-trip history as a list of cards with
 * inline row-expansion (`toggleTripDetail`). This re-hosts that VIEW on the
 * Entity Engine: a MastEntity schema drives the standard list, and a row click
 * opens a read-focused Faceted Record slide-out instead of expanding in place.
 *
 * Variant (doc 17 §1a test): a completed trip has no governed lifecycle and the
 * legacy history is VIEW-ONLY (the only trip mutations are the active-trip
 * start/end flow + adding retroactive trips — neither is the history surface) →
 * read-focused Faceted Record, NO edit affordance (matches legacy). Defaults to
 * the current user's own trips; an "All drivers" admin toggle (admin role only,
 * matching legacy `isAdmin()`) switches the load to EVERY driver's completed
 * trips via the same bounded read legacy uses (`MastDB.trips.allDrivers()`), and
 * surfaces the driver per row. Closes the V1→V2 parity gap (the toggle used to be
 * legacy-#trips-only). Flag-gated (`?ui=1`), side-by-side with legacy `#trips`.
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

  // Purpose icon map (static; mirrors legacy DEFAULT_TRIP_PURPOSES). The record
  // already snapshots purposeLabel at save time, so label resolution needs no map.
  var PURPOSE_ICON = { 'fair-market': '🎪', vendor: '🏭', supplies: '🛒', 'studio-run': '🏠', bank: '🏦', delivery: '📦', other: '✏️' };
  function purposeText(t) {
    var label = t.purposeLabel || t.purpose || '';
    var icon = PURPOSE_ICON[t.purpose] || (t.purpose && t.purpose.indexOf('custom-') === 0 ? '📌' : '');
    return (icon ? icon + ' ' : '') + (label || '—');
  }
  function locLabel(o) { return (o && o.label) || '—'; }
  // Driver display (all-drivers admin mode only). Trip records snapshot
  // driverName at start/save time (trips.js); fall back to the uid if absent.
  function driverLabel(t) { return (t && (t.driverName || t.driverId)) || 'Unknown'; }
  function tripTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('trips-v2', {
    label: 'Trip', labelPlural: 'Trips', size: 'lg',
    route: 'trips-v2',
    recordId: function (t) { return t.id; },
    // fields[0] is the slide-out title source (the engine reads record[name]
    // directly, no get()), so it must be a real string property — `dest` is
    // materialized onto each row in load(). Date stays the default sort column.
    fields: [
      { name: 'dest', label: 'Destination', type: 'text', list: true, readOnly: true },
      { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true, group: 'Trip',
        get: function (t) { return t.startTime || t.tripDate || null; } },
      { name: 'purpose', label: 'Purpose', type: 'text', list: true, readOnly: true,
        get: function (t) { return purposeText(t); } },
      { name: 'miles', label: 'Miles', type: 'number', list: true, readOnly: true,
        get: function (t) { return t.miles || 0; } },
      { name: 'deductible', label: 'Deductible', type: 'money', list: true, readOnly: true,
        get: function (t) { return t.deductibleValue || 0; } }
      // Driver is NOT a schema field on purpose: it's only meaningful in the
      // all-drivers admin lens, and adding it here would also inject it into the
      // CSV export (exportColumns walks all fields) — regressing the own-trips
      // export. Instead render() injects a Driver list column + the detail facet
      // pushes a Driver row, both only in all-drivers mode; sorting works because
      // load() materializes `driver` (the label string) onto each row then.
    ],
    fetch: function (id) {
      var t = V2.byId[id];
      return Promise.resolve(t || null);
    },
    detail: {
      // Read-focused Faceted Record — tiles + Overview/Timing facets. No edit
      // (legacy trip history is view-only). Composes MastUI primitives.
      render: function (UI, t) {
        var tiles = UI.tiles([
          { k: 'Miles', v: (t.miles || 0).toFixed(1), hero: true },
          { k: 'Deductible', v: N.money(t.deductibleValue || 0) || '$0.00' },
          { k: 'Date', v: t.startTime ? N.date(t.startTime) : (t.tripDate ? N.date(t.tripDate) : '—') },
          { k: 'Purpose', v: esc(purposeText(t)) }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'timing', label: 'Timing' }], 'ov');

        var routeRows = [
          { k: 'Origin', v: esc(locLabel(t.origin)) },
          { k: 'Destination', v: esc(locLabel(t.destination)) }
        ];
        // Driver shown only when viewing another driver's trip (all-drivers lens).
        if (t.driverName || t.driverId) routeRows.push({ k: 'Driver', v: esc(driverLabel(t)) });
        var route = UI.kv(routeRows);
        var details = UI.kv([
          { k: 'Purpose', v: esc(purposeText(t)) },
          { k: 'Miles', v: (t.miles || 0).toFixed(1) + ' mi' + (t.milesSource ? ' (' + esc(t.milesSource) + ')' : '') },
          { k: 'Deductible', v: N.money(t.deductibleValue || 0) || '$0.00' }
        ]);
        var notesCard = t.notes ? UI.card('Notes', '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' + esc(t.notes) + '</div>') : '';

        var rate = (t.irsRateCentsPerMile || 0) + '¢/mi' + (t.irsRateYear ? ' (' + esc(t.irsRateYear) + ')' : '');
        var timing = UI.kv([
          { k: 'Started', v: t.startTime ? (N.date(t.startTime) + ' · ' + tripTime(t.startTime)) : '—' },
          { k: 'Ended', v: t.endTime ? (N.date(t.endTime) + ' · ' + tripTime(t.endTime)) : '—' },
          { k: 'IRS rate', v: esc(rate) }
        ]);

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Route', route) + UI.card('Details', details) + notesCard + '</div>' +
          '<div class="mu-pane" data-pane="timing" hidden>' + UI.card('Timing', timing) + '</div>';
      }
    }
    // No onSave → no Edit button (legacy trip history is view-only).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'date', sortDir: 'desc', q: '', loaded: false, lens: 'history', allDrivers: false };

  function currentUid() {
    try { return (window.firebase && firebase.auth().currentUser && firebase.auth().currentUser.uid) || null; } catch (e) { return null; }
  }

  // Admin gate for the all-drivers lens — EXACTLY legacy #trips's gate
  // (`isAdmin()` = current user role === 'admin'). The all-drivers view exposes
  // other people's trip data, so it must be admin-only; can('trips','view') is
  // too permissive (managers/users can hold view). Defensive: default-deny if
  // the global isn't resolvable.
  function canSeeAllDrivers() {
    try { return typeof window.isAdmin === 'function' ? !!window.isAdmin() : false; } catch (e) { return false; }
  }

  // Project one raw trip record into a list row (real string `dest` for the
  // title + list column; `id` materialized). driverUid stamps driverId from the
  // path key when the record didn't snapshot one (all-drivers flatten).
  function projectTrip(k, t, driverUid) {
    var r = Object.assign({ id: k }, t);
    r.dest = locLabel(t.destination);
    if (driverUid != null) {
      if (!r.driverId) r.driverId = driverUid;
      r.driver = driverLabel(r);   // sortable string for the all-drivers Driver column
    }
    return r;
  }

  function commitRows(out) {
    V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.id] = r; });
    V2.loaded = true; render();
  }

  function load() {
    // All-drivers admin lens (parity with legacy #trips' "All Drivers" toggle):
    // load EVERY driver's completed trips, flattened across uids. Reuses the
    // SAME bounded read legacy uses — MastDB.trips.allDrivers() — so no new
    // unbounded read is introduced (the helper lives in index.html, already
    // baselined; it scans the per-tenant trips/ collection). Admin-only.
    if (V2.allDrivers && canSeeAllDrivers()) {
      Promise.resolve(MastDB.trips.allDrivers()).then(function (val) {
        val = val || {};
        var out = [];
        Object.keys(val).forEach(function (driverUid) {
          var userTrips = val[driverUid] || {};
          Object.keys(userTrips).forEach(function (k) {
            var t = userTrips[k];
            if (t && typeof t === 'object' && t.status === 'completed') out.push(projectTrip(k, t, driverUid));
          });
        });
        commitRows(out);
      }).catch(function (e) { console.error('[trips-v2] load all-drivers', e); render(); });
      return;
    }
    var uid = currentUid();
    if (!uid) { V2.rows = []; render(); return; }
    // Read via the RTDB-compat ref keyed at trips/{uid} (the legacy #trips path),
    // NOT MastDB.trips.list()/MastDB.query() — verified on sgtest15 that query()
    // mishandles the trips/{uid} path (returns driver-uid docs, not the trips) and
    // that orderByChild('startTime')/limitToLast drop rows in the compat layer.
    // .once('value') is a one-shot read (satisfies the no-unbounded-listener rule);
    // a user's trip history is bounded, and we sort client-side (date desc default).
    Promise.resolve(MastDB.trips.ref(uid).once('value')).then(function (snap) {
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var t = val[k];
        if (t && typeof t === 'object' && t.status === 'completed') out.push(projectTrip(k, t));
      });
      commitRows(out);
    }).catch(function (e) { console.error('[trips-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return locLabel(r.destination).toLowerCase().indexOf(q) >= 0 ||
               locLabel(r.origin).toLowerCase().indexOf(q) >= 0 ||
               purposeText(r).toLowerCase().indexOf(q) >= 0 ||
               (V2.allDrivers && driverLabel(r).toLowerCase().indexOf(q) >= 0);
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('trips-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function summary(rows) {
    var miles = 0, ded = 0;
    rows.forEach(function (t) { miles += (t.miles || 0); ded += (t.deductibleValue || 0); });
    return { count: rows.length, miles: miles, ded: ded };
  }

  // List columns for the active lens. Own-trips mode uses the schema defaults
  // (Driver is list:false, so it's absent). All-drivers admin mode injects a
  // Driver column right after Destination so each row shows whose trip it is.
  function listColumns() {
    var cols = MastEntity.listColumns('trips-v2');
    if (!V2.allDrivers) return cols;
    var driverCol = { key: 'driver', label: 'Driver', align: 'left', sortable: true,
      render: function (row) { return esc(driverLabel(row)); } };
    var out = cols.slice();
    var destIdx = -1;
    out.forEach(function (c, i) { if (c.key === 'dest') destIdx = i; });
    out.splice(destIdx >= 0 ? destIdx + 1 : 0, 0, driverCol);
    return out;
  }

  function ensureTab() {
    var el = document.getElementById('tripsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'tripsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var rows = visibleRows();
    var s = summary(rows);
    // Classic burn-down Wave D: the trip FLOWS (start/end live tracking, the
    // retroactive multi-leg wizard, previous-trips picker) are body-level
    // modals exported by trips.js — generation-agnostic; this page is their V2
    // home. Mileage settings (IRS rates + locations) live on the Settings page.
    var lensPills = [['history', 'History'], ['report', 'Tax report']].map(function (p) {
      var on = V2.lens === p[0];
      return '<button onclick="TripsV2.setLens(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + p[1] + '</button>';
    }).join('');
    // All-drivers admin toggle — RBAC-gated (admin role only, matching legacy
    // #trips). Only meaningful in the History lens. Never rendered for non-admins,
    // so other drivers' data is never reachable from the UI for them.
    var allDriversPill = '';
    if (V2.lens === 'history' && canSeeAllDrivers()) {
      var ad = V2.allDrivers;
      allDriversPill =
        '<button onclick="TripsV2.toggleAllDrivers()" title="' +
          (ad ? 'Showing every driver\'s trips' : 'Show every driver\'s trips') + '" style="border:1px solid var(--border);' +
          'background:' + (ad ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
          'color:' + (ad ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
          'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-left:4px;">' +
          (ad ? '👥 All drivers' : '👤 My trips') + '</button>';
    }
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;flex-wrap:wrap;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Trips</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(V2.rows.length) + ' trips</span>' +
        '<span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-primary" onclick="TripsV2.startTrip()">Start trip</button>' +
          '<button class="btn btn-secondary" onclick="TripsV2.addPastTrip()">Add past trip</button>' +
          '<button class="btn btn-secondary" onclick="TripsV2.previousTrips()">Previous trips</button>' +
          '<button class="btn btn-secondary" onclick="TripsV2.exportCsv()">↓ Export</button>' +
        '</span>' +
      '</div>' +
      '<div style="margin:10px 0;display:flex;align-items:center;gap:0;flex-wrap:wrap;">' + lensPills + allDriversPill + '</div>' +
      (V2.lens === 'report'
        ? '<div id="tripsV2Report" class="mu-sub">Loading report…</div>'
        : '<div style="display:flex;gap:12px;margin:12px 0;flex-wrap:wrap;">' +
            tile(N.count(s.count), 'Trips') + tile(s.miles.toFixed(1), 'Miles') + tile(N.money(s.ded) || '$0.00', 'Deductible') +
          '</div>' +
          '<div style="margin:14px 0;"><input class="form-input" placeholder="' +
            (V2.allDrivers ? 'Search driver, destination, origin, purpose…' : 'Search destination, origin, purpose…') + '" value="' + esc(V2.q) +
            '" oninput="TripsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
          MastEntity.renderList('trips-v2', {
            rows: rows, sortKey: V2.sortKey, sortDir: V2.sortDir,
            columns: listColumns(),
            onSortFnName: 'TripsV2.sort', onRowClickFnName: 'TripsV2.open',
            empty: { title: 'No trips yet', message: V2.loaded ? (V2.allDrivers ? 'No completed trips for any driver yet.' : 'Start a trip or add a past one to get going.') : 'Loading…' }
          }));
    if (V2.lens === 'report') {
      withTrips(function () {
        // Pass OUR rows — the legacy loader drops rows in the compat layer.
        if (typeof window.renderTaxReport === 'function') renderTaxReport(document.getElementById('tripsV2Report'), V2.rows);
      });
    }
  }

  // T6: the trips engine (flow modals + report renderer + active-trip banner) is
  // now ABSORBED into this file (the non-flag-gated IIFE below), so its globals are
  // defined synchronously once trips-v2.js executes — no async module load needed.
  function withTrips(fn) {
    try { fn(); } catch (e) { if (window.showToast) showToast('Trips engine unavailable', true); }
  }

  function tile(value, label) {
    return '<div style="background:var(--cream);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
      '<div style="font-size:1.6rem;font-weight:700;color:var(--text-primary);">' + value + '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(label) + '</div></div>';
  }

  window.TripsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'date' ? 'desc' : 'asc'); }
      render();
    },
    setLens: function (l) { V2.lens = l; render(); },
    // Admin-only: flip between own-trips and all-drivers. Re-guarded here (not
    // just at render) so a stale/forged onclick can't load other drivers' data
    // for a non-admin. Reloads from the right source, resets to the default sort.
    toggleAllDrivers: function () {
      if (!canSeeAllDrivers()) return;
      V2.allDrivers = !V2.allDrivers;
      // If the active sort was the (now-absent) driver column, fall back to date.
      if (!V2.allDrivers && V2.sortKey === 'driver') { V2.sortKey = 'date'; V2.sortDir = 'desc'; }
      V2.loaded = false; render(); load();
    },
    // The flows are trips.js body-level modals — same implementation, V2 home.
    startTrip: function () { withTrips(function () { if (window.openStartTripModal) openStartTripModal(); }); },
    addPastTrip: function () { withTrips(function () { if (window.startRetroactiveManual) startRetroactiveManual(); }); },
    previousTrips: function () { withTrips(function () { if (window.openPreviousTripsModal) openPreviousTripsModal(); }); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('trips-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('trips-v2', rec, 'read');
      });
    },
    exportCsv: function () { return MastEntity.exportRows('trips-v2', visibleRows(), 'all'); }
  };

  function tripsRouteSetup() {
    ensureTab(); render(); load();
    // Trip flows + the active-trip pulse banner come from the absorbed engine
    // (IIFE below); surface any open trip (the banner is body-level, works everywhere).
    withTrips(function () {
      if (typeof window.initTripsModule === 'function') { try { initTripsModule(); } catch (e) {} }
      if (typeof window.checkForActiveTrip === 'function') { try { checkForActiveTrip(); } catch (e) {} }
    });
  }
  MastAdmin.registerModule('trips-v2', {
    routes: {
      'trips-v2': { tab: 'tripsV2Tab', setup: tripsRouteSetup },
      // Legacy #trips route ABSORBED (T6): trips.js is deleted, so the twin owns
      // the bare route directly (no MAST_V2_ROUTE_MAP remap). The trip engine
      // (flows + tax report + active-trip banner) lives in the non-flag-gated IIFE
      // appended below; the Legacy V1 #trips dashboard (#tripsTab) is retired.
      'trips': { tab: 'tripsV2Tab', setup: tripsRouteSetup }
    }
  });
})();



// ============================================================================
// ABSORBED FROM trips.js (V1) — T6 retirement (absorb-first cut).
//
// trips-v2 is a thin read-only history twin that DELEGATES every trip mutation
// + the tax report + the app-wide active-trip banner to trips.js globals
// (openStartTripModal / startRetroactiveManual / openPreviousTripsModal /
// renderTaxReport / loadTripsSettings / refreshTripsTabStatus / initTripsModule /
// checkForActiveTrip / …). trips.js is the real engine; the V1 #trips dashboard
// (rendered into the static #tripsTab) is Legacy-only and is dropped. This
// re-hosts trips.js VERBATIM (the entire IIFE, minus its registerModule) as a
// NON-flag-gated sibling IIFE so those globals exist for ALL users (the boot-time
// active-trip banner + the trips-v2 flow buttons + the settings page), and
// trips-v2 owns the bare #trips route directly. No top-level side effects in the
// original IIFE (defs only), so re-hosting is behaviour-identical.
// ============================================================================
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var tripsData = [];
  var tripsLoaded = false;
  var showsData = window.showsData || {}; // Cross-module: loaded by shows module or fetched locally
  var showsLoaded = !!(window.showsData && Object.keys(window.showsData).length > 0);

  // Local copy of formatShowDate — same implementation as modules/shows.js:308
  // but lives inside this IIFE so trips.js doesn't break when shows.js isn't
  // loaded (mileage nudge + retroactive modal title + previous-trips list all
  // call this; the nudge can fire before the shows module ever loads).
  function formatShowDate(dateStr) {
    if (!dateStr) return '';
    var parts = String(dateStr).split('-');
    if (parts.length < 3) return dateStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var m = months[parseInt(parts[1], 10) - 1];
    var d = parseInt(parts[2], 10);
    return (m || parts[1]) + ' ' + d + ', ' + parts[0];
  }
  var tripLocationsData = {};
  var tripLocationsLoaded = false;
  var tripSettingsData = { irsRates: { '2025': 70, '2026': 70 }, knownLocations: ['home-studio', 'new-studio'] };
  var activeTripData = null; // current user's open trip
  var selectedTripPurpose = null;
  var selectedTripPurposeLabel = null; // For custom "Other" purposes
  var tripMilesSource = null;
  var tripPulseTimer = null;
  var customTripPurposes = []; // User-added custom purposes

  // Default trip purpose options (Other always last)
  var DEFAULT_TRIP_PURPOSES = [
    { key: 'fair-market', icon: '🎪', label: 'Fair/Market' },
    { key: 'vendor', icon: '🏭', label: 'Vendor' },
    { key: 'supplies', icon: '🛒', label: 'Supplies' },
    { key: 'studio-run', icon: '🏠', label: 'Studio Run' },
    { key: 'bank', icon: '🏦', label: 'Bank' },
    { key: 'delivery', icon: '📦', label: 'Delivery' }
  ];
  var TRIP_PURPOSES = DEFAULT_TRIP_PURPOSES.concat([{ key: 'other', icon: '✏️', label: 'Other' }]);

  // Retroactive trip modal state
  var retroModalData = null;
  var distanceCalcTimeout = null;
  var tripReminderTimer = null;

  // ============================================================
  // Helpers — access globals from core
  // ============================================================

  function tripsGetUid() {
    return currentUser ? currentUser.uid : null;
  }

  // ============================================================
  // Load Functions
  // ============================================================

  function loadTrips() {
    var user = auth.currentUser;
    if (!user) return;
    // Load custom purposes on first load
    if (!tripsLoaded) loadCustomTripPurposes();
    var loading = document.getElementById('tripsLoading');
    if (loading) loading.style.display = '';

    MastDB.trips.ref(user.uid).orderByChild('startTime').limitToLast(200).once('value').then(function(snap) {
      var val = snap.val();
      tripsData = val ? Object.keys(val).map(function(k) { var t = val[k]; t.id = k; return t; }) : [];
      tripsData.sort(function(a, b) { return (b.startTime || '').localeCompare(a.startTime || ''); });
      tripsLoaded = true;
      // Check for active trip
      activeTripData = tripsData.find(function(t) { return t.status === 'open'; }) || null;
      if (activeTripData) showTripPulsingIndicator();
      else hideTripPulsingIndicator();
      renderTripsHistory();
      if (loading) loading.style.display = 'none';
    }).catch(function(err) {
      console.error('Error loading trips:', err);
      if (loading) loading.style.display = 'none';
    });
  }

  function loadTripLocations() {
    MastDB.tripLocations.ref().once('value').then(function(snap) {
      tripLocationsData = snap.val() || {};
      tripLocationsLoaded = true;
      // Auto-seed default locations if empty
      if (Object.keys(tripLocationsData).length === 0 && isAdmin()) {
        var seeds = {
          'home-studio': { label: 'Home Studio', lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString() },
          'new-studio': { label: 'New Studio', lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString() }
        };
        // Use individual .set(id, data) calls — collection-level .set() is not supported in Firestore
        var seedKeys = Object.keys(seeds);
        Promise.all(seedKeys.map(function(k) { return MastDB.tripLocations.set(k, seeds[k]); })).then(function() {
          tripLocationsData = seeds;
        }).catch(function() {});
      }
    });
  }

  function loadTripSettings() {
    MastDB.tripSettings.ref().once('value').then(function(snap) {
      var val = snap.val();
      if (val) {
        tripSettingsData = val;
        if (!tripSettingsData.irsRates) tripSettingsData.irsRates = { '2025': 70, '2026': 70 };
      } else if (isAdmin()) {
        // Auto-seed defaults
        var defaults = { irsRates: { '2025': 70, '2026': 70 }, knownLocations: ['home-studio', 'new-studio'] };
        MastDB.tripSettings.ref().set(defaults).then(function() {
          tripSettingsData = defaults;
        }).catch(function() {}); // silent if write fails
      }
    });
  }

  // ============================================================
  // Check for Active Trip
  // ============================================================

  function checkForActiveTrip() {
    var user = auth.currentUser;
    if (!user) return;
    MastDB.trips.ref(user.uid).orderByChild('status').equalTo('open').limitToLast(1).once('value').then(function(snap) {
      var val = snap.val() || {};
      var keys = Object.keys(val);
      if (keys.length > 0) {
        var key = keys[0];
        activeTripData = val[key] || null;
        if (activeTripData) {
          activeTripData.id = key;
          showTripPulsingIndicator();
          renderActiveTripBanner();
        } else {
          hideTripPulsingIndicator();
        }
      } else {
        activeTripData = null;
        hideTripPulsingIndicator();
      }
    });
  }

  // ============================================================
  // Pulsing Indicator
  // ============================================================

  function showTripPulsingIndicator() {
    var el = document.getElementById('tripPulsingIndicator');
    if (el) el.style.display = '';
    updatePulseLabel();
    if (tripPulseTimer) clearInterval(tripPulseTimer);
    tripPulseTimer = setInterval(updatePulseLabel, 60000);
  }

  function hideTripPulsingIndicator() {
    var el = document.getElementById('tripPulsingIndicator');
    if (el) el.style.display = 'none';
    if (tripPulseTimer) { clearInterval(tripPulseTimer); tripPulseTimer = null; }
  }

  function updatePulseLabel() {
    if (!activeTripData || !activeTripData.startTime) return;
    var elapsed = Date.now() - new Date(activeTripData.startTime).getTime();
    var mins = Math.floor(elapsed / 60000);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    var label = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
    var el = document.getElementById('tripPulseLabel');
    if (el) el.textContent = 'Trip in progress · ' + label;
  }

  // ============================================================
  // Active Trip Banner
  // ============================================================

  function renderActiveTripBanner() {
    var banner = document.getElementById('activeTripBanner');
    if (!banner) return;
    if (!activeTripData) { banner.style.display = 'none'; return; }
    var elapsed = Date.now() - new Date(activeTripData.startTime).getTime();
    var mins = Math.floor(elapsed / 60000);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    var timeStr = hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + 'm';
    var dest = activeTripData.destination ? activeTripData.destination.label : 'Unknown';
    banner.style.display = '';
    banner.innerHTML = '<div style="background:linear-gradient(135deg,#f59e0b,#d97706);color:white;border-radius:10px;padding:16px 20px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;" onclick="openEndTripSheet()">' +
      '<div>' +
        '<div style="font-weight:700;font-size:1rem;">🚗 Trip in Progress</div>' +
        '<div style="font-size:0.85rem;opacity:0.9;">To ' + esc(dest) + ' · ' + timeStr + '</div>' +
      '</div>' +
      '<button class="btn" style="background:white;color:#d97706;font-weight:700;border:none;padding:8px 16px;border-radius:8px;font-size:0.85rem;">End Trip</button>' +
    '</div>';
  }

  // ============================================================
  // Start Trip
  // ============================================================

  function openStartTripModal() {
    // Check for existing open trip first
    if (activeTripData) {
      showToast('You already have an open trip. End it first.', true);
      openEndTripSheet();
      return;
    }

    var modal = document.getElementById('startTripModal');
    if (modal) modal.style.display = 'flex';

    // Load locations if not loaded
    if (!tripLocationsLoaded) loadTripLocations();
    loadTripSettings();

    // GPS
    var statusEl = document.getElementById('startTripGpsStatus');
    var originSelect = document.getElementById('startTripOrigin');
    originSelect.innerHTML = '<option value="">Detecting location...</option>';

    if (!navigator.geolocation) {
      statusEl.textContent = '⚠️ GPS not available — select origin manually';
      populateOriginDropdown(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      function(pos) {
        var lat = pos.coords.latitude;
        var lng = pos.coords.longitude;
        statusEl.textContent = '📍 Location found';
        populateOriginDropdown({ lat: lat, lng: lng });
      },
      function(err) {
        statusEl.textContent = '⚠️ Could not get GPS — select origin manually';
        populateOriginDropdown(null);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );

    // Populate destination datalist
    populateDestinationList();
  }

  function populateOriginDropdown(gpsCoords) {
    var input = document.getElementById('startTripOrigin');
    var datalist = document.getElementById('originList');
    if (!input || !datalist) return;

    var options = '';
    var nearestLabel = null;

    // Find nearest location if GPS available
    if (gpsCoords && tripLocationsLoaded) {
      var minDist = Infinity;
      Object.keys(tripLocationsData).forEach(function(k) {
        var loc = tripLocationsData[k];
        if (!loc.lat || !loc.lng) return;
        var dist = haversineMeters(gpsCoords.lat, gpsCoords.lng, loc.lat, loc.lng);
        if (dist < minDist) { minDist = dist; nearestLabel = loc.label || k; }
      });
      if (minDist > 500) nearestLabel = null; // not close enough
    }

    // Add locations sorted by use count
    var locKeys = Object.keys(tripLocationsData);
    locKeys.sort(function(a, b) {
      return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0);
    });
    locKeys.forEach(function(k) {
      var loc = tripLocationsData[k];
      options += '<option value="' + esc(loc.label || k) + '">';
    });

    // Also add studio locations not already in trip locations
    Object.keys(studioLocations).forEach(function(k) {
      var sl = studioLocations[k];
      var alreadyInTrips = locKeys.some(function(lk) {
        return tripLocationsData[lk].label === sl.name;
      });
      if (!alreadyInTrips) {
        options += '<option value="' + esc(sl.name) + '">';
      }
    });

    datalist.innerHTML = options;

    // Pre-fill with nearest location or first option
    if (nearestLabel) {
      input.value = nearestLabel;
    } else if (locKeys.length > 0) {
      input.value = tripLocationsData[locKeys[0]].label || locKeys[0];
    }
  }

  function populateDestinationList() {
    var datalist = document.getElementById('destinationList');
    if (!datalist) return;
    var html = '';
    var locKeys = Object.keys(tripLocationsData);
    locKeys.sort(function(a, b) {
      return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0);
    });
    locKeys.forEach(function(k) {
      var loc = tripLocationsData[k];
      html += '<option value="' + esc(loc.label || k) + '">';
    });
    datalist.innerHTML = html;
  }

  function closeStartTripModal() {
    var modal = document.getElementById('startTripModal');
    if (modal) modal.style.display = 'none';
  }

  function confirmStartTrip() {
    var user = auth.currentUser;
    if (!user) { showToast('Not signed in', true); return; }

    var originLabel = document.getElementById('startTripOrigin').value.trim();
    var destInput = document.getElementById('startTripDestination').value.trim();

    if (!originLabel) { showToast('Enter an origin', true); return; }
    if (!destInput) { showToast('Enter a destination', true); return; }

    // Resolve origin — look up by label in known locations first
    var origin = { label: originLabel, lat: 0, lng: 0, geocoded: false };
    // Check trip locations
    var originKey = Object.keys(tripLocationsData).find(function(k) {
      return (tripLocationsData[k].label || '').toLowerCase() === originLabel.toLowerCase();
    });
    if (originKey) {
      var loc = tripLocationsData[originKey];
      origin = { label: loc.label || originLabel, lat: loc.lat || 0, lng: loc.lng || 0, geocoded: !!loc.lat };
    } else if (typeof studioLocations !== 'undefined') {
      // Check studio locations
      var studioKey = Object.keys(studioLocations).find(function(k) {
        return studioLocations[k].name.toLowerCase() === originLabel.toLowerCase();
      });
      if (studioKey) {
        var sl = studioLocations[studioKey];
        origin = { label: sl.name, lat: sl.lat, lng: sl.lng, geocoded: true };
      }
    }

    // Resolve destination — check if it matches existing location
    var destination = { label: destInput, lat: 0, lng: 0, geocoded: false };
    var matchedDestKey = Object.keys(tripLocationsData).find(function(k) {
      return (tripLocationsData[k].label || '').toLowerCase() === destInput.toLowerCase();
    });
    if (matchedDestKey) {
      var dl = tripLocationsData[matchedDestKey];
      destination = { label: dl.label, lat: dl.lat || 0, lng: dl.lng || 0, geocoded: !!dl.lat };
    }

    // Get IRS rate for current year
    var year = new Date().getFullYear();
    var rate = tripSettingsData.irsRates ? (tripSettingsData.irsRates[year] || tripSettingsData.irsRates[year - 1] || 70) : 70;

    // W1 fix — MastDB.trips.push(uid) on the Firestore adapter calls
    // DocumentReference.set(undefined) immediately and throws, breaking the
    // RTDB push→set pattern this module depends on. Pre-allocate the doc id
    // and write via .set(uid, id, data) instead.
    var tripId = MastDB.newKey('trips/' + user.uid);
    var tripData = {
      tripId: tripId,
      driverId: user.uid,
      driverName: user.displayName || user.email || 'Unknown',
      status: 'open',
      startTime: new Date().toISOString(),
      endTime: null,
      origin: origin,
      destination: destination,
      miles: 0,
      milesSource: null,
      purpose: null,
      notes: '',
      irsRateYear: year,
      irsRateCentsPerMile: rate,
      deductibleValue: 0,
      expenses: [],
      entryMethod: 'live'
    };

    MastDB.trips.set(user.uid, tripId, tripData).then(function() {
      // Add destination to tripLocations if new
      if (!matchedDestKey) {
        var slug = destInput.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        MastDB.tripLocations.ref(slug).set({
          label: destInput, lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString()
        });
        tripLocationsData[slug] = { label: destInput, lat: 0, lng: 0, useCount: 0 };
      }

      activeTripData = tripData;
      activeTripData.id = tripId;
      showTripPulsingIndicator();
      closeStartTripModal();
      showToast('Trip started — drive safe! 🚗');
      requestNotificationPermission(); // Ask for notification permission when starting a trip
      writeAudit('create', 'trips', tripId);
      emitTestingEvent('trip_started', { tripId: tripId });
      emitTestingEvent('trip_destination_set', { tripId: tripId, destination: destInput });

      // Schedule 4hr notification
      scheduleTripReminder();

      // Refresh if on trips page
      if (currentRoute === 'trips') { tripsLoaded = false; loadTrips(); }
      if (currentRoute === 'dashboard') renderActiveTripBanner();
    }).catch(function(err) {
      showToast('Error starting trip: ' + err.message, true);
    });
  }

  // ============================================================
  // End Trip
  // ============================================================

  function openEndTripSheet() {
    if (!activeTripData) { showToast('No active trip', true); return; }
    var sheet = document.getElementById('endTripSheet');
    if (sheet) sheet.style.display = '';

    // Elapsed time
    var elapsed = Date.now() - new Date(activeTripData.startTime).getTime();
    var mins = Math.floor(elapsed / 60000);
    var hrs = Math.floor(mins / 60);
    mins = mins % 60;
    var elapsedEl = document.getElementById('endTripElapsed');
    if (elapsedEl) elapsedEl.textContent = '⏱️ ' + (hrs > 0 ? hrs + 'h ' + mins + 'm' : mins + ' minutes');

    // Pre-fill destination
    var destEl = document.getElementById('endTripDestination');
    if (destEl && activeTripData.destination) destEl.value = activeTripData.destination.label || '';

    // Reset purpose selection
    selectedTripPurpose = null;
    selectedTripPurposeLabel = null;
    renderPurposeQuickPick();

    // Auto-calculate miles via Maps API
    var milesEl = document.getElementById('endTripMiles');
    var sourceEl = document.getElementById('endTripMilesSource');
    if (milesEl) milesEl.value = '';
    if (sourceEl) sourceEl.textContent = 'Calculating...';
    tripMilesSource = null;

    calculateTripDistance();

    // Populate destination datalist
    populateDestinationList();
  }

  function renderPurposeQuickPick() {
    var container = document.getElementById('purposeQuickPick');
    if (!container) return;
    var html = '';
    TRIP_PURPOSES.forEach(function(p) {
      var selected = selectedTripPurpose === p.key ? ' selected' : '';
      html += '<div class="purpose-chip' + selected + '" onclick="selectTripPurpose(\'' + p.key + '\')">' +
        p.icon + ' ' + p.label + '</div>';
    });
    container.innerHTML = html;
  }

  function selectTripPurpose(key) {
    if (key === 'other') {
      showOtherPurposeModal();
      return;
    }
    selectedTripPurpose = key;
    selectedTripPurposeLabel = null;
    renderPurposeQuickPick();
  }

  function showOtherPurposeModal() {
    // Remove existing modal if any
    var existing = document.getElementById('otherPurposeModal');
    if (existing) existing.remove();

    var isDark = document.body.classList.contains('dark-mode');
    var bg = isDark ? '#2a2a2a' : 'white';
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : 'var(--charcoal)';
    var inputBg = isDark ? '#1e1e1e' : '#f9f9f9';

    var overlay = document.createElement('div');
    overlay.id = 'otherPurposeModal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    overlay.innerHTML =
      '<div style="background:' + bg + ';border-radius:12px;padding:24px;width:100%;max-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.3);">' +
        '<div style="font-weight:700;font-size:1rem;margin-bottom:4px;color:' + textColor + ';">What was this trip for?</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:16px;">Enter a purpose — it will be saved for future trips.</div>' +
        '<input id="otherPurposeInput" type="text" placeholder="e.g. Glass class, Repair job, Post office" ' +
          'style="width:100%;padding:10px 12px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
          'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" />' +
        '<div style="display:flex;gap:10px;margin-top:16px;">' +
          '<button onclick="cancelOtherPurpose()" style="flex:1;padding:10px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.85rem;">Cancel</button>' +
          '<button onclick="confirmOtherPurpose()" style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--amber-glow,var(--amber));color:white;cursor:pointer;font-weight:600;font-family:DM Sans,sans-serif;font-size:0.85rem;">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    // Focus input
    setTimeout(function() {
      var input = document.getElementById('otherPurposeInput');
      if (input) input.focus();
    }, 100);

    // Enter key to confirm
    var input = document.getElementById('otherPurposeInput');
    if (input) {
      input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') confirmOtherPurpose();
        if (e.key === 'Escape') cancelOtherPurpose();
      });
    }
  }

  function cancelOtherPurpose() {
    var modal = document.getElementById('otherPurposeModal');
    if (modal) modal.remove();
  }

  function confirmOtherPurpose() {
    var input = document.getElementById('otherPurposeInput');
    var value = input ? input.value.trim() : '';
    if (!value) {
      showToast('Enter a purpose description', true);
      return;
    }

    // Generate a key from the label
    var key = 'custom-' + value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    // Save to Firebase so it appears in future trips
    var alreadyExists = customTripPurposes.some(function(p) { return p.key === key; });
    if (!alreadyExists) {
      var newPurpose = { key: key, icon: '📌', label: value };
      customTripPurposes.push(newPurpose);
      rebuildTripPurposes();
      // Persist to Firebase
      MastDB.set('tripCustomPurposes/' + key, { icon: '📌', label: value, createdAt: new Date().toISOString() });
    }

    // Select it
    selectedTripPurpose = key;
    selectedTripPurposeLabel = value;
    renderPurposeQuickPick();
    cancelOtherPurpose();
  }

  function rebuildTripPurposes() {
    TRIP_PURPOSES = DEFAULT_TRIP_PURPOSES.concat(customTripPurposes).concat([{ key: 'other', icon: '✏️', label: 'Other' }]);
  }

  function loadCustomTripPurposes() {
    MastDB.get('tripCustomPurposes').then(function(data) {
      if (!data) return;
      customTripPurposes = [];
      Object.keys(data).forEach(function(key) {
        customTripPurposes.push({ key: key, icon: data[key].icon || '📌', label: data[key].label });
      });
      rebuildTripPurposes();
    });
  }

  function closeEndTripSheet() {
    var sheet = document.getElementById('endTripSheet');
    if (sheet) sheet.style.display = 'none';
  }

  function confirmEndTrip() {
    if (!activeTripData) return;
    var user = auth.currentUser;
    if (!user) return;

    var miles = parseFloat(document.getElementById('endTripMiles').value) || 0;
    var destValue = document.getElementById('endTripDestination').value.trim();
    var notes = document.getElementById('endTripNotes').value.trim();

    // Inline validation with visual feedback
    var hasError = false;

    if (!selectedTripPurpose) {
      showToast('Select a trip purpose', true);
      var purposeContainer = document.getElementById('purposeQuickPick');
      if (purposeContainer) {
        purposeContainer.style.outline = '2px solid #dc2626';
        purposeContainer.style.borderRadius = '8px';
        purposeContainer.style.padding = '4px';
        purposeContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(function() { purposeContainer.style.outline = ''; purposeContainer.style.padding = ''; }, 3000);
      }
      hasError = true;
    }

    if (miles < 0) { showToast('Miles cannot be negative', true); hasError = true; }
    if (miles === 0 && tripMilesSource !== 'same-location') {
      if (!tripMilesSource || tripMilesSource === null) {
        showToast('Enter miles or tap "Enter miles manually"', true);
        var milesInput = document.getElementById('endTripMiles');
        if (milesInput) { milesInput.style.outline = '2px solid #dc2626'; setTimeout(function() { milesInput.style.outline = ''; }, 3000); }
        hasError = true;
      }
    }

    if (hasError) return;

    var source = tripMilesSource || 'manual-override';
    var rate = activeTripData.irsRateCentsPerMile || 70;
    var deductible = Math.round(miles * (rate / 100) * 100) / 100;

    // Update destination if changed
    var destination = activeTripData.destination || { label: destValue, lat: 0, lng: 0, geocoded: false };
    if (destValue && destValue !== destination.label) {
      destination.label = destValue;
    }

    // For custom purposes, store the label too
    var purposeLabel = selectedTripPurposeLabel || null;
    var purposeObj = TRIP_PURPOSES.find(function(p) { return p.key === selectedTripPurpose; });
    if (purposeObj && !purposeLabel) purposeLabel = purposeObj.label;

    var updates = {
      status: 'completed',
      endTime: new Date().toISOString(),
      miles: miles,
      milesSource: source,
      purpose: selectedTripPurpose,
      purposeLabel: purposeLabel,
      notes: notes,
      destination: destination,
      deductibleValue: deductible
    };

    MastDB.trips.update(user.uid, activeTripData.id, updates).then(function() {
      // Increment location use counts
      incrementLocationUseCount(activeTripData.origin);
      incrementLocationUseCount(destination);

      // Increment quick action count
      incrementQuickAction('start-trip');

      hideTripPulsingIndicator();
      closeEndTripSheet();
      activeTripData = null;
      showToast('Trip logged — ' + miles.toFixed(1) + ' miles · $' + deductible.toFixed(2) + ' deductible');
      writeAudit('update', 'trips', activeTripData ? activeTripData.id : 'unknown');
      emitTestingEvent('trip_completed', { tripId: activeTripData ? activeTripData.id : null, miles: miles, deductible: deductible });

      // Cancel reminder
      cancelTripReminder();

      // Refresh
      tripsLoaded = false;
      if (currentRoute === 'trips') loadTrips();
      if (currentRoute === 'dashboard') {
        var banner = document.getElementById('activeTripBanner');
        if (banner) banner.style.display = 'none';
      }
    }).catch(function(err) {
      showToast('Error ending trip: ' + err.message, true);
    });
  }

  function incrementLocationUseCount(locationObj) {
    if (!locationObj || !locationObj.label) return;
    var slug = locationObj.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    var ref = MastDB.tripLocations.ref(slug);
    ref.child('useCount').set(MastDB.serverIncrement(1));
    ref.child('lastUsed').set(new Date().toISOString());
    // Ensure label is set
    ref.child('label').set(locationObj.label);
  }

  async function discardActiveTrip() {
    if (!activeTripData) return;
    if (!await mastConfirm('Discard this trip? It will be deleted and not logged.', { title: 'Discard Trip', danger: true })) return;
    var user = auth.currentUser;
    if (!user) return;
    MastDB.trips.ref(user.uid + '/' + activeTripData.id).remove().then(function() {
      hideTripPulsingIndicator();
      closeEndTripSheet();
      activeTripData = null;
      showToast('Trip discarded');
      tripsLoaded = false;
      if (currentRoute === 'trips') loadTrips();
      var banner = document.getElementById('activeTripBanner');
      if (banner) banner.style.display = 'none';
    }).catch(function(err) {
      showToast('Error discarding trip: ' + err.message, true);
    });
  }

  // ============================================================
  // Distance Calculation (Google Maps Directions API)
  // ============================================================

  function calculateTripDistance() {
    if (!activeTripData) return;
    var origin = activeTripData.origin;
    var dest = activeTripData.destination;

    if (!origin || !dest) {
      setManualMilesMode('No origin/destination');
      return;
    }

    // Check if origin and destination are the same location (user hasn't moved)
    if (origin.lat && origin.lng && dest.lat && dest.lng) {
      var distMetersHav = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
      if (distMetersHav < 100) { // Less than 100 meters — effectively same spot
        document.getElementById('endTripMiles').value = 0;
        document.getElementById('endTripMilesSource').textContent = '📍 Same location';
        tripMilesSource = 'same-location';
        return;
      }
    }

    // Try using coordinates if available
    var originStr = origin.lat && origin.lng ? origin.lat + ',' + origin.lng : origin.label;
    var destStr = dest.lat && dest.lng ? dest.lat + ',' + dest.lng : dest.label;

    if (!originStr || !destStr) {
      setManualMilesMode('Missing location data');
      return;
    }

    // Set a timeout — if Maps API callback doesn't fire within 5s, fall back to manual/haversine
    if (distanceCalcTimeout) clearTimeout(distanceCalcTimeout);
    distanceCalcTimeout = setTimeout(function() {
      // API didn't respond in time — try haversine fallback
      if (origin.lat && origin.lng && dest.lat && dest.lng) {
        var fallbackMeters = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
        var fallbackMiles = Math.round((fallbackMeters / 1609.344) * 10) / 10;
        document.getElementById('endTripMiles').value = fallbackMiles;
        document.getElementById('endTripMilesSource').textContent = '📍 Estimated (straight-line)';
        tripMilesSource = 'haversine-fallback';
      } else {
        setManualMilesMode('Enter miles manually');
      }
    }, 5000);

    try {
      if (window.google && window.google.maps) {
        var service = new google.maps.DistanceMatrixService();
        service.getDistanceMatrix({
          origins: [originStr],
          destinations: [destStr],
          travelMode: 'DRIVING',
          unitSystem: google.maps.UnitSystem.IMPERIAL
        }, function(response, status) {
          // Cancel timeout — we got a response
          if (distanceCalcTimeout) { clearTimeout(distanceCalcTimeout); distanceCalcTimeout = null; }
          if (status === 'OK' && response.rows[0] && response.rows[0].elements[0].status === 'OK') {
            var distMeters = response.rows[0].elements[0].distance.value;
            var miles = Math.round((distMeters / 1609.344) * 10) / 10;
            document.getElementById('endTripMiles').value = miles;
            document.getElementById('endTripMilesSource').textContent = '📍 via Google Maps';
            tripMilesSource = 'maps-api';
          } else {
            setManualMilesMode('Maps unavailable');
          }
        });
      } else {
        // No Google Maps JS — cancel timeout and fall back immediately
        if (distanceCalcTimeout) { clearTimeout(distanceCalcTimeout); distanceCalcTimeout = null; }
        if (origin.lat && origin.lng && dest.lat && dest.lng) {
          var hvMeters = haversineMeters(origin.lat, origin.lng, dest.lat, dest.lng);
          var hvMiles = Math.round((hvMeters / 1609.344) * 10) / 10;
          document.getElementById('endTripMiles').value = hvMiles;
          document.getElementById('endTripMilesSource').textContent = '📍 Estimated (straight-line)';
          tripMilesSource = 'haversine-fallback';
        } else {
          setManualMilesMode('Enter miles manually');
        }
      }
    } catch (e) {
      if (distanceCalcTimeout) { clearTimeout(distanceCalcTimeout); distanceCalcTimeout = null; }
      setManualMilesMode('Enter miles manually');
    }
  }

  function setManualMilesMode(reason) {
    var sourceEl = document.getElementById('endTripMilesSource');
    if (sourceEl) sourceEl.textContent = reason || 'Enter miles manually';
    tripMilesSource = 'manual-override';
  }

  // ============================================================
  // Haversine Distance
  // ============================================================

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLng = (lng2 - lng1) * Math.PI / 180;
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // ============================================================
  // Trip Reminder (Push Notification fallback: in-app timer)
  // ============================================================

  function scheduleTripReminder() {
    cancelTripReminder();
    // 4 hours
    tripReminderTimer = setTimeout(function() {
      if (activeTripData) {
        showToast('⚠️ You have an open trip — still traveling?');
        // Also try browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification((TENANT_BRAND && TENANT_BRAND.name) || 'Admin', {
            body: 'You have an open trip — still traveling? Tap to end it.',
            icon: '/favicon.svg'
          });
        }
      }
    }, 4 * 60 * 60 * 1000);
  }

  function cancelTripReminder() {
    if (tripReminderTimer) { clearTimeout(tripReminderTimer); tripReminderTimer = null; }
  }

  // Request notification permission on first trip
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ============================================================
  // On-launch safety net: check if user is near known location
  // ============================================================

  function checkForgottenTrip() {
    if (!activeTripData) return;
    if (!navigator.geolocation) return;

    // Only check GPS if permission was already granted — don't prompt on startup
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
        if (result.state === 'granted') {
          doForgottenTripCheck();
        }
        // If 'prompt' or 'denied', skip silently — don't bother user on launch
      }).catch(function() {
        // permissions API not supported — skip to avoid popup
      });
    }
    return;
  }

  function doForgottenTripCheck() {
    navigator.geolocation.getCurrentPosition(function(pos) {
      var lat = pos.coords.latitude;
      var lng = pos.coords.longitude;

      // Check against studio locations
      var nearLocation = null;
      Object.keys(studioLocations).forEach(function(k) {
        var sl = studioLocations[k];
        if (haversineMeters(lat, lng, sl.lat, sl.lng) < 200) {
          nearLocation = sl.name;
        }
      });
      // Check trip locations too
      if (!nearLocation) {
        Object.keys(tripLocationsData).forEach(function(k) {
          var tl = tripLocationsData[k];
          if (tl.lat && tl.lng && haversineMeters(lat, lng, tl.lat, tl.lng) < 200) {
            nearLocation = tl.label || k;
          }
        });
      }

      if (nearLocation) {
        // Show soft prompt
        var banner = document.getElementById('activeTripBanner');
        if (banner && currentRoute === 'trips') {
          banner.innerHTML += '<div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:8px;padding:12px 16px;margin-bottom:12px;font-size:0.85rem;color:#fbbf24;">' +
            '📍 Looks like you\'re back at <strong>' + esc(nearLocation) + '</strong> — ' +
            '<a href="#" onclick="openEndTripSheet();return false;" style="color:#fcd34d;font-weight:600;">end your trip?</a>' +
          '</div>';
        }
      }
    }, function() {}, { enableHighAccuracy: false, timeout: 5000, maximumAge: 120000 });
  }

  // ============================================================
  // Trips History View
  // ============================================================

  function switchTripsSubView(view) {
    var history = document.getElementById('tripsSubHistory');
    var report = document.getElementById('tripsSubReport');
    if (history) history.style.display = view === 'history' ? '' : 'none';
    if (report) report.style.display = view === 'report' ? '' : 'none';

    document.querySelectorAll('#tripsSubNav .view-tab').forEach(function(btn) { btn.classList.remove('active'); });
    document.querySelectorAll('#tripsSubNav .view-tab').forEach(function(btn, i) {
      if ((i === 0 && view === 'history') || (i === 1 && view === 'report')) btn.classList.add('active');
    });

    if (view === 'report') {
      renderTaxReport();
      emitTestingEvent('trip_report_viewed', {});
    }
  }

  function renderTripsHistory() {
    var headerActions = document.getElementById('tripsHeaderActions');
    if (headerActions) {
      headerActions.innerHTML = '<button class="btn btn-secondary btn-sm" onclick="openPreviousTripsModal()" style="margin-right:6px;">Previous Trips</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="startRetroactiveManual()" style="margin-right:6px;">Add Past Trip</button>' +
        '<button class="btn btn-primary" onclick="openStartTripModal()">🚗 Start Trip</button>';
    }

    // Filters
    var filtersEl = document.getElementById('tripsFilters');
    if (filtersEl) {
      var currentYear = new Date().getFullYear();
      var currentMonth = new Date().getMonth();
      filtersEl.innerHTML =
        '<div class="order-filter-pills" data-filter-for="tripsMonthFilter" style="margin:0;"></div>' +
        '<select id="tripsMonthFilter" onchange="renderTripsList()" style="display:none;">' +
          '<option value="all">All Time</option>' +
          '<option value="' + currentYear + '-' + (currentMonth + 1) + '" selected>This Month</option>' +
          '<option value="' + currentYear + '-' + currentMonth + '">' + getMonthName(currentMonth - 1) + '</option>' +
          '<option value="' + currentYear + '">This Year (' + currentYear + ')</option>' +
          '<option value="' + (currentYear - 1) + '">' + (currentYear - 1) + '</option>' +
        '</select>' +
        (isAdmin() ? ' <label style="font-size:0.85rem;display:flex;align-items:center;gap:6px;"><input type="checkbox" id="tripsAllDrivers" onchange="loadAllDriversTrips()"> All Drivers</label>' : '');
      if (window.mastInitFilterPills) window.mastInitFilterPills(filtersEl);
    }

    renderActiveTripBanner();
    renderTripsList();
  }

  function getMonthName(idx) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[((idx % 12) + 12) % 12];
  }

  function renderTripsList() {
    var container = document.getElementById('tripsList');
    if (!container) return;

    // URL-driven filters from MCP admin links: status, dateFrom, dateTo, tripIds
    // (#trips?...). URL-overrides-pill — when any URL filter is present, bypass
    // the month dropdown and status default (completed) for this render.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
    var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
    var urlIdsParam = (rp && typeof rp.tripIds === 'string') ? rp.tripIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var hasUrlFilter = !!(urlStatus || urlDateFrom || urlDateTo || urlIds.length);

    var completed;
    if (hasUrlFilter) {
      // tripDate is YYYY-MM-DD or derived from startTime ISO; direct string compare.
      completed = tripsData.filter(function(t) {
        if (urlStatus && t.status !== urlStatus) return false;
        if (urlIdLookup && !urlIdLookup[t.id]) return false;
        if (urlDateFrom || urlDateTo) {
          var d = t.tripDate || (t.startTime ? t.startTime.slice(0, 10) : '');
          if (!d) return false;
          if (urlDateFrom && d < urlDateFrom) return false;
          if (urlDateTo && d > urlDateTo) return false;
        }
        return true;
      });
    } else {
      completed = tripsData.filter(function(t) { return t.status === 'completed'; });
      // Apply date filter
      var filterVal = document.getElementById('tripsMonthFilter') ? document.getElementById('tripsMonthFilter').value : 'all';
      if (filterVal !== 'all') {
        var parts = filterVal.split('-');
        var filterYear = parseInt(parts[0]);
        var filterMonth = parts[1] ? parseInt(parts[1]) : null;
        completed = completed.filter(function(t) {
          var d = new Date(t.startTime);
          if (filterMonth) return d.getFullYear() === filterYear && (d.getMonth() + 1) === filterMonth;
          return d.getFullYear() === filterYear;
        });
      }
    }

    // URL-filter banner — surfaces active MCP-link filters with Clear button.
    var bannerEl = document.getElementById('tripsUrlFilterBanner');
    if (!bannerEl && hasUrlFilter && container.parentNode) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'tripsUrlFilterBanner';
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      container.parentNode.insertBefore(bannerEl, container);
    }
    if (bannerEl) {
      if (hasUrlFilter) {
        var bparts = [];
        if (urlIds.length) bparts.push(urlIds.length + ' selected trip' + (urlIds.length === 1 ? '' : 's'));
        if (urlStatus) bparts.push('status: ' + String(urlStatus).replace(/-/g, ' '));
        if (urlDateFrom && urlDateTo) bparts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
        else if (urlDateFrom) bparts.push('from ' + urlDateFrom + ' onward');
        else if (urlDateTo) bparts.push('through ' + urlDateTo);
        bannerEl.innerHTML = '<span>🚗 Showing ' + bparts.join(', ') + '</span>' +
          '<button type="button" onclick="clearTripsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
        bannerEl.style.display = 'flex';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    if (completed.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.6rem;margin-bottom:12px;">🚗</div>' +
        '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No trips yet</p>' +
        '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Start your first business trip to begin tracking mileage.</p>' +
      '</div>';
      return;
    }

    // Summary
    var totalMiles = 0, totalDeductible = 0;
    completed.forEach(function(t) { totalMiles += (t.miles || 0); totalDeductible += (t.deductibleValue || 0); });

    var html = '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap;">' +
      '<div class="trip-stat-card" style="background:var(--cream,var(--cream));border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
        '<div class="trip-stat-value" style="font-size:1.6rem;font-weight:700;color:var(--text-primary);">' + completed.length + '</div>' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);">Trips</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,var(--cream));border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
        '<div class="trip-stat-value" style="font-size:1.6rem;font-weight:700;color:var(--text-primary);">' + totalMiles.toFixed(1) + '</div>' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);">Miles</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,var(--cream));border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
        '<div class="trip-stat-value" style="font-size:1.6rem;font-weight:700;color:var(--text-primary);">$' + totalDeductible.toFixed(2) + '</div>' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);">Deductible</div>' +
      '</div>' +
    '</div>';

    // Trip rows
    completed.forEach(function(t) {
      var d = new Date(t.startTime);
      var dateStr = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
      var dest = t.destination ? t.destination.label : 'Unknown';
      var purposeObj = TRIP_PURPOSES.find(function(p) { return p.key === t.purpose; });
      var purposeIcon = purposeObj ? purposeObj.icon : (t.purpose && t.purpose.indexOf('custom-') === 0 ? '📌' : '•');
      var driverNote = t.driverName && t.driverId !== (auth.currentUser ? auth.currentUser.uid : '') ? ' · ' + esc(t.driverName) : '';

      html += '<div class="trip-card" style="background:white;border:1px solid #eee;border-radius:8px;padding:12px 16px;margin-bottom:8px;cursor:pointer;" onclick="toggleTripDetail(\'' + t.id + '\')">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
          '<div>' +
            '<span class="trip-dest" style="font-weight:600;font-size:0.9rem;">' + purposeIcon + ' ' + esc(dest) + '</span>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);">' + dateStr + driverNote + '</div>' +
          '</div>' +
          '<div style="text-align:right;">' +
            '<div class="trip-miles" style="font-weight:600;">' + (t.miles || 0).toFixed(1) + ' mi</div>' +
            '<div class="trip-deductible" style="font-size:0.78rem;color:#059669;">$' + (t.deductibleValue || 0).toFixed(2) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="trip-detail" id="tripDetail_' + t.id + '" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid #eee;font-size:0.85rem;color:var(--warm-gray);">' +
          '<div>Origin: ' + esc(t.origin ? t.origin.label : 'Unknown') + '</div>' +
          '<div>Destination: ' + esc(dest) + '</div>' +
          '<div>Purpose: ' + (purposeObj ? purposeObj.icon + ' ' + purposeObj.label : (t.purposeLabel ? '📌 ' + esc(t.purposeLabel) : t.purpose)) + '</div>' +
          '<div>Miles: ' + (t.miles || 0).toFixed(1) + ' (' + (t.milesSource || 'unknown') + ')</div>' +
          '<div>IRS Rate: ' + (t.irsRateCentsPerMile || 0) + '¢/mi (' + (t.irsRateYear || '') + ')</div>' +
          '<div>Deductible: $' + (t.deductibleValue || 0).toFixed(2) + '</div>' +
          (t.notes ? '<div>Notes: ' + esc(t.notes) + '</div>' : '') +
          '<div>Time: ' + formatTripTime(t.startTime) + ' → ' + formatTripTime(t.endTime) + '</div>' +
        '</div>' +
      '</div>';
    });

    container.innerHTML = html;
  }

  function toggleTripDetail(tripId) {
    var el = document.getElementById('tripDetail_' + tripId);
    if (el) {
      el.style.display = el.style.display === 'none' ? '' : 'none';
      emitTestingEvent('trip_history_viewed', { tripId: tripId });
    }
  }

  function formatTripTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function loadAllDriversTrips() {
    var checkbox = document.getElementById('tripsAllDrivers');
    if (!checkbox || !isAdmin()) return;

    if (checkbox.checked) {
      // Load all drivers
      MastDB.trips.allDrivers().then(function(val) {
        val = val || {};
        tripsData = [];
        Object.keys(val).forEach(function(uid) {
          var userTrips = val[uid];
          Object.keys(userTrips).forEach(function(k) {
            var t = userTrips[k];
            t.id = k;
            t.driverId = uid;
            tripsData.push(t);
          });
        });
        tripsData.sort(function(a, b) { return (b.startTime || '').localeCompare(a.startTime || ''); });
        renderTripsList();
      });
    } else {
      tripsLoaded = false;
      loadTrips();
    }
  }

  // ============================================================
  // Tax Report
  // ============================================================

  function renderTaxReport(hostEl, rows) {
    // hostEl + rows (classic burn-down Wave D): trips-v2 re-hosts the report
    // in its own container and passes its OWN loaded rows — the legacy
    // loadTrips read (orderByChild/limitToLast) drops rows in the Firestore
    // compat layer (see trips-v2 load()), so self-loading here renders zeros.
    var container = hostEl || document.getElementById('taxReportContent');
    if (!container) return;
    if (Array.isArray(rows)) tripsData = rows;

    var currentYear = new Date().getFullYear();
    var completed = tripsData.filter(function(t) {
      return t.status === 'completed' && new Date(t.startTime).getFullYear() === currentYear;
    });

    var totalMiles = 0, totalDeductible = 0;
    completed.forEach(function(t) { totalMiles += (t.miles || 0); totalDeductible += (t.deductibleValue || 0); });
    var rate = tripSettingsData.irsRates ? (tripSettingsData.irsRates[currentYear] || 70) : 70;

    var html = '<div style="margin-bottom:20px;">' +
      '<div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap;">' +
        '<select id="taxReportYear" onchange="renderTaxReport()" style="padding:8px 12px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.9rem;">';
    for (var y = currentYear; y >= currentYear - 3; y--) {
      html += '<option value="' + y + '"' + (y === currentYear ? ' selected' : '') + '>' + y + '</option>';
    }
    html += '</select>' +
        '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="exportTripsCSV()">📄 Export CSV</button>' +
        '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="printTaxReport()">🖨️ Print Report</button>' +
      '</div>' +
    '</div>';

    // Summary cards
    html += '<div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap;">' +
      '<div class="trip-stat-card" style="background:var(--cream,var(--cream));border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Total Trips</div>' +
        '<div class="trip-stat-value" style="font-size:1.6rem;font-weight:700;margin-top:4px;">' + completed.length + '</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,var(--cream));border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">Total Miles</div>' +
        '<div class="trip-stat-value" style="font-size:1.6rem;font-weight:700;margin-top:4px;">' + totalMiles.toFixed(1) + '</div>' +
      '</div>' +
      '<div class="trip-stat-card" style="background:var(--cream,var(--cream));border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;">IRS Rate</div>' +
        '<div class="trip-stat-value" style="font-size:1.6rem;font-weight:700;margin-top:4px;">' + rate + '¢</div>' +
      '</div>' +
      '<div class="trip-stat-card trip-stat-highlight" style="background:#ecfdf5;border-radius:8px;padding:16px 20px;flex:1;min-width:140px;">' +
        '<div class="trip-stat-label" style="font-size:0.78rem;color:#059669;text-transform:uppercase;letter-spacing:0.5px;">Total Deductible</div>' +
        '<div class="trip-stat-value" style="font-size:1.6rem;font-weight:700;margin-top:4px;color:#059669;">$' + totalDeductible.toFixed(2) + '</div>' +
      '</div>' +
    '</div>';

    // Trip table
    if (completed.length > 0) {
      html += '<div style="overflow-x:auto;"><table class="trip-table" style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
        '<thead><tr style="border-bottom:2px solid #eee;text-align:left;">' +
          '<th style="padding:8px;">Date</th>' +
          '<th style="padding:8px;">Driver</th>' +
          '<th style="padding:8px;">Route</th>' +
          '<th style="padding:8px;">Purpose</th>' +
          '<th style="padding:8px;text-align:right;">Miles</th>' +
          '<th style="padding:8px;text-align:right;">Deductible</th>' +
        '</tr></thead><tbody>';
      completed.forEach(function(t) {
        var d = new Date(t.startTime);
        var dateStr = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
        var origin = t.origin ? t.origin.label : '?';
        var dest = t.destination ? t.destination.label : '?';
        var purposeObj = TRIP_PURPOSES.find(function(p) { return p.key === t.purpose; });
        html += '<tr style="border-bottom:1px solid #f0f0f0;">' +
          '<td style="padding:8px;">' + dateStr + '</td>' +
          '<td style="padding:8px;">' + esc(t.driverName || 'Unknown') + '</td>' +
          '<td style="padding:8px;">' + esc(origin) + ' → ' + esc(dest) + '</td>' +
          '<td style="padding:8px;">' + (purposeObj ? purposeObj.icon + ' ' + purposeObj.label : (t.purposeLabel ? '📌 ' + esc(t.purposeLabel) : t.purpose || '')) + '</td>' +
          '<td style="padding:8px;text-align:right;">' + (t.miles || 0).toFixed(1) + '</td>' +
          '<td style="padding:8px;text-align:right;">$' + (t.deductibleValue || 0).toFixed(2) + '</td>' +
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    container.innerHTML = html;
  }

  function exportTripsCSV() {
    var yearEl = document.getElementById('taxReportYear');
    var year = yearEl ? parseInt(yearEl.value) : new Date().getFullYear();
    var completed = tripsData.filter(function(t) {
      return t.status === 'completed' && new Date(t.startTime).getFullYear() === year;
    });

    // Cells run through the shared _csvCell guard (formula-injection-safe quoting:
    // prefixes "'" to =,+,-,@,tab,CR-leading cells + RFC-4180 quoting). Defensive
    // RFC-only fallback if the shell global is absent. Replaces the prior
    // force-quote-every-field idiom, which also left driver/origin/destination/
    // purpose un-escaped — clean cells are now conditionally quoted.
    var cell = (typeof window._csvCell === 'function')
      ? window._csvCell
      : function (s) { var v = String(s == null ? '' : s); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var csv = 'Date,Driver,Origin,Destination,Purpose,Miles,IRS Rate (¢/mi),Deductible ($),Notes\n';
    completed.forEach(function(t) {
      var d = new Date(t.startTime);
      var dateStr = (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear();
      csv += [
        dateStr,
        t.driverName || '',
        t.origin ? t.origin.label : '',
        t.destination ? t.destination.label : '',
        t.purpose || '',
        (t.miles || 0).toFixed(1),
        (t.irsRateCentsPerMile || 70),
        (t.deductibleValue || 0).toFixed(2),
        t.notes || ''
      ].map(cell).join(',') + '\n';
    });

    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'trip-mileage-report-' + year + '.csv';
    a.click();
    showToast('CSV exported');
  }

  function printTaxReport() {
    var container = document.getElementById('taxReportContent');
    if (!container) { window.print(); return; }

    var yearEl = document.getElementById('taxReportYear');
    var year = yearEl ? yearEl.value : new Date().getFullYear();
    var printWin = window.open('', '_blank', 'width=800,height=600');
    if (!printWin) { showToast('Pop-ups blocked — allow pop-ups to print', true); return; }

    printWin.document.write(
      '<!DOCTYPE html><html><head><meta charset="utf-8">' +
      '<title>Trip Mileage Report — ' + year + '</title>' +
      '<style>' +
        'body{font-family:\'DM Sans\',sans-serif;font-size:13px;color:#111;margin:24px;}' +
        'h2{margin:0 0 4px;font-size:1.15rem;}' +
        'p{margin:0 0 16px;font-size:0.85rem;color:#666;}' +
        'table{width:100%;border-collapse:collapse;}' +
        'th,td{padding:6px 8px;text-align:left;border-bottom:1px solid #e0e0e0;}' +
        'th{font-weight:700;border-bottom:2px solid #ccc;}' +
        '.stat-row{display:flex;gap:24px;margin-bottom:20px;}' +
        '.stat{background:#f8f8f8;border-radius:6px;padding:12px 16px;min-width:120px;}' +
        '.stat-label{font-size:0.72rem;text-transform:uppercase;color:#666;margin-bottom:2px;}' +
        '.stat-value{font-size:1.6rem;font-weight:700;}' +
        '.highlight{background:#ecfdf5;}.highlight .stat-value{color:#059669;}' +
        '@media print{body{margin:0;}}' +
      '</style></head><body>' +
      '<h2>Trip Mileage Tax Report — ' + year + '</h2>' +
      '<p>Generated ' + new Date().toLocaleDateString() + '</p>' +
      container.innerHTML +
      '<script>window.onload=function(){window.print();}<\/script>' +
      '</body></html>'
    );
    printWin.document.close();
  }

  // ============================================================
  // Settings: IRS Rates
  // ============================================================

  function renderIrsRates() {
    var container = document.getElementById('irsRatesList');
    if (!container) return;
    var rates = tripSettingsData.irsRates || {};
    var years = Object.keys(rates).sort().reverse();
    if (years.length === 0) {
      container.innerHTML = '<div style="padding:8px;color:var(--warm-gray);font-size:0.85rem;">No rates configured.</div>';
      if (typeof window.refreshTripsTabStatus === 'function') window.refreshTripsTabStatus();
      return;
    }
    var html = '';
    years.forEach(function(y) {
      html += '<div class="irs-rate-row" data-irs-year="' + y + '" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--cream,var(--cream));border-radius:6px;margin-bottom:6px;">' +
        '<span style="font-weight:600;">' + y + '</span>' +
        '<span>' + rates[y] + '¢/mile</span>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;color:#E53935;" onclick="removeIrsRate(\'' + y + '\')">Remove</button>' +
      '</div>';
    });
    container.innerHTML = html;
    if (typeof window.refreshTripsTabStatus === 'function') window.refreshTripsTabStatus();
  }

  function addIrsRate() {
    var yearEl = document.getElementById('newIrsYear');
    var rateEl = document.getElementById('newIrsRate');
    var year = yearEl ? yearEl.value.trim() : '';
    var rate = rateEl ? parseFloat(rateEl.value) : 0;
    if (!year || rate <= 0) { showToast('Enter year and rate', true); return; }

    MastDB.tripSettings.subRef('irsRates', year).set(rate).then(function() {
      tripSettingsData.irsRates[year] = rate;
      yearEl.value = '';
      rateEl.value = '';
      renderIrsRates();
      showToast('IRS rate saved: ' + year + ' = ' + rate + '¢/mile');
      writeAudit('update', 'settings', 'irsRate-' + year);
    });
  }

  async function removeIrsRate(year) {
    if (!await mastConfirm('Remove IRS rate for ' + year + '?', { title: 'Remove Rate' })) return;
    MastDB.tripSettings.subRef('irsRates', year).remove().then(function() {
      delete tripSettingsData.irsRates[year];
      renderIrsRates();
      showToast('Rate removed');
    });
  }

  // ============================================================
  // Settings: Trip Locations
  // ============================================================

  function renderTripLocations() {
    var container = document.getElementById('tripLocationsList');
    if (!container) return;
    var keys = Object.keys(tripLocationsData);
    keys.sort(function(a, b) { return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0); });
    if (keys.length === 0) {
      container.innerHTML = '<div style="padding:8px;color:var(--warm-gray);font-size:0.85rem;">No saved locations yet. Locations are auto-added when you start trips.</div>';
      if (typeof window.refreshTripsTabStatus === 'function') window.refreshTripsTabStatus();
      return;
    }
    var html = '';
    keys.forEach(function(k) {
      var loc = tripLocationsData[k];
      html += '<div class="trip-location-row" data-trip-loc-id="' + k + '" style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--cream,var(--cream));border-radius:6px;margin-bottom:6px;">' +
        '<div>' +
          '<div style="font-weight:600;font-size:0.9rem;">' + esc(loc.label || k) + '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);">Used ' + (loc.useCount || 0) + ' times</div>' +
        '</div>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;color:#E53935;" onclick="removeTripLocation(\'' + k + '\')">Remove</button>' +
      '</div>';
    });
    container.innerHTML = html;
    if (typeof window.refreshTripsTabStatus === 'function') window.refreshTripsTabStatus();
  }

  function addTripLocationManual() {
    var nameEl = document.getElementById('newTripLocationName');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) { showToast('Enter a location name', true); return; }
    var slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    MastDB.tripLocations.ref(slug).set({
      label: name, lat: 0, lng: 0, useCount: 0, lastUsed: new Date().toISOString()
    }).then(function() {
      tripLocationsData[slug] = { label: name, lat: 0, lng: 0, useCount: 0 };
      nameEl.value = '';
      renderTripLocations();
      showToast('Location added: ' + name);
    });
  }

  async function removeTripLocation(key) {
    if (!await mastConfirm('Remove this location?', { title: 'Remove Location' })) return;
    MastDB.tripLocations.ref(key).remove().then(function() {
      delete tripLocationsData[key];
      renderTripLocations();
      showToast('Location removed');
    });
  }

  // ============================================================
  // Init: Load on auth
  // ============================================================

  function initTripsModule() {
    loadTripLocations();
    loadTripSettings();
    checkForActiveTrip();
    // Notification permission is now requested when starting a trip, not on every login.
    // Forgotten trip GPS check only runs if permission was already granted (no popup).
    setTimeout(checkForgottenTrip, 3000);
  }

  // ============================================================
  // Settings lazy load for trips sub-view
  // ============================================================

  function loadTripsSettings() {
    loadTripLocations();
    loadTripSettings();
    // Wait briefly for data, then render
    setTimeout(function() {
      renderIrsRates();
      renderTripLocations();
    }, 500);
  }

  // ============================================================
  // Nudge Provider: Unrecorded Event Mileage
  // ============================================================

  registerNudgeProvider(async function mileageNudgeProvider() {
    var user = auth.currentUser;
    if (!user) return [];

    // Ensure shows data is loaded
    if (!showsLoaded) {
      try {
        showsData = (await MastDB.shows.list(200)) || {};
        showsLoaded = true;
      } catch (e) { return []; }
    }

    // Load user's trips
    var tripsSnap;
    try {
      tripsSnap = await MastDB.trips.ref(user.uid).limitToLast(500).once('value');
    } catch (e) { return []; }
    var allTrips = tripsSnap.val() || {};

    // Build set of dates that have trip records (YYYY-MM-DD)
    var tripDates = {};
    Object.values(allTrips).forEach(function(t) {
      if (t.startTime) {
        var d = new Date(t.startTime);
        tripDates[d.toISOString().slice(0, 10)] = true;
      }
      // Also check retroactive trips by their tripDate field
      if (t.tripDate) {
        tripDates[t.tripDate] = true;
      }
    });

    var now = new Date();
    var nudges = [];

    Object.keys(showsData).forEach(function(showId) {
      var s = showsData[showId];
      if (!s.startDate) return;
      var showDate = new Date(s.startDate + 'T12:00:00');
      // Only past shows
      if (showDate >= now) return;
      // Only shows with location info
      if (!s.locationCity && !s.locationState) return;
      // Check if any trip recorded for this show date
      var dateKey = s.startDate; // Already YYYY-MM-DD
      if (tripDates[dateKey]) return;
      // Multi-day: also check end date
      if (s.endDate && tripDates[s.endDate]) return;

      var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
      var dateStr = formatShowDate(s.startDate);
      nudges.push({
        key: 'mileage-show-' + showId,
        type: 'mileage',
        timestamp: s.startDate,
        showId: showId,
        html: 'You attended <strong>' + esc(s.name || 'a show') + '</strong> on ' + dateStr +
          (location ? ' in ' + esc(location) : '') + ' — mileage not recorded. ' +
          '<a href="#" onclick="startRetroactiveFromShow(\'' + esc(showId) + '\');return false;" ' +
          'style="color:#d97706;font-weight:600;">Record Now</a>'
      });
    });

    // Sort by most recent first
    nudges.sort(function(a, b) { return b.timestamp.localeCompare(a.timestamp); });
    return nudges;
  });

  // ============================================================
  // Retroactive Trip Entry
  // Flow A: Event-based (from show), Flow B: Manual destination
  // Both support multi-leg recording loop
  // ============================================================

  function startRetroactiveFromShow(showId) {
    var s = showsData[showId];
    if (s) { _openRetroFromShow(showId, s); return; }
    // W1 fix — when called from outside trips.js (e.g. the Show History P&L "Add
    // Mileage" button), trips' local showsData cache may not be populated yet.
    // Fall back to a one-shot fetch via MastDB so any show can drive a retro
    // trip without first navigating into Trips and waiting for its listener.
    if (window.MastDB && MastDB.shows && typeof MastDB.shows.get === 'function') {
      MastDB.shows.get(showId).then(function(fetched) {
        if (!fetched) { showToast('Show not found', true); return; }
        showsData[showId] = fetched;
        _openRetroFromShow(showId, fetched);
      }).catch(function() { showToast('Show not found', true); });
      return;
    }
    showToast('Show not found', true);
  }

  function _openRetroFromShow(showId, s) {
    var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
    retroModalData = {
      showId: showId,
      showName: s.name,
      showDate: s.startDate,
      showLocation: location,
      entryMethod: 'event-retroactive',
      legs: [],
      currentLegOrigin: null,
      eventSessionId: null
    };
    openRetroactiveTripModal();
  }

  function startRetroactiveManual() {
    retroModalData = {
      showId: null,
      showName: null,
      showDate: null,
      showLocation: null,
      entryMethod: 'manual-retroactive',
      legs: [],
      currentLegOrigin: null,
      eventSessionId: null
    };
    openRetroactiveTripModal();
  }

  function openRetroactiveTripModal() {
    // Remove existing modal if any
    var existing = document.getElementById('retroTripModal');
    if (existing) existing.remove();

    var isDark = document.body.classList.contains('dark-mode');
    var bg = isDark ? '#1e1e1e' : 'white';
    var cardBg = isDark ? '#2a2a2a' : '#f9f9f9';
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : 'var(--charcoal)';
    var inputBg = isDark ? 'var(--charcoal)' : '#fff';

    var isEventBased = !!retroModalData.showId;
    var title = isEventBased ? 'Record Mileage — ' + esc(retroModalData.showName) : 'Add Past Trip';
    var dateHint = isEventBased && retroModalData.showDate ? ' on ' + formatShowDate(retroModalData.showDate) : '';

    var overlay = document.createElement('div');
    overlay.id = 'retroTripModal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;' +
      'display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
    overlay.innerHTML =
      '<div style="background:' + bg + ';border-radius:12px;padding:24px;width:100%;max-width:420px;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.3);margin-top:40px;color:' + textColor + ';">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">' +
          '<div style="font-weight:700;font-size:1.0rem;">' + title + '</div>' +
          '<button onclick="closeRetroTripModal()" style="background:none;border:none;font-size:1.15rem;cursor:pointer;color:' + textColor + ';">✕</button>' +
        '</div>' +
        (dateHint ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:16px;">' + dateHint + '</div>' : '<div style="margin-bottom:16px;"></div>') +

        // Logged legs summary
        '<div id="retroLegsSummary" style="display:none;margin-bottom:16px;"></div>' +

        // Current leg form
        '<div id="retroLegForm">' +
          // Trip date (manual only, event-based pre-fills)
          (!isEventBased ? '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Trip Date</label>' +
            '<input type="date" id="retroTripDate" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
              'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" value="' + new Date().toISOString().slice(0, 10) + '">' +
          '</div>' : '') +

          // Start location
          '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Start Location</label>' +
            '<input type="text" id="retroOrigin" list="retroOriginList" placeholder="Type or select start location" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
              'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;">' +
            '<datalist id="retroOriginList">' + buildRetroOriginDatalist() + '</datalist>' +
          '</div>' +

          // End location
          '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;">End Location</label>' +
            (isEventBased && retroModalData.legs.length === 0
              ? '<input type="text" id="retroDestination" value="' + esc(retroModalData.showLocation || '') + '" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
                'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" list="retroDestList">'
              : '<input type="text" id="retroDestination" placeholder="Enter destination" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
                'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;" list="retroDestList">') +
            '<datalist id="retroDestList">' + buildRetroDestDatalist() + '</datalist>' +
          '</div>' +

          // Purpose
          '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Purpose</label>' +
            '<input type="text" id="retroPurpose" value="' + esc(isEventBased && retroModalData.legs.length === 0 ? retroModalData.showName || '' : '') + '" ' +
              'placeholder="e.g. Show, Supplies, Delivery" style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
              'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;">' +
          '</div>' +

          // Round trip toggle
          '<div style="margin-bottom:16px;display:flex;align-items:center;gap:10px;">' +
            '<label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:0.85rem;">' +
              '<input type="checkbox" id="retroRoundTrip" checked style="width:16px;height:16px;cursor:pointer;">' +
              ' Round trip' +
            '</label>' +
          '</div>' +

          // Miles override — when set, bypasses geocoding entirely. Fixes the
          // W1 side-find where fake/unknown addresses returned 0 miles because
          // both Maps API and haversine had nothing to compute against.
          '<div style="margin-bottom:12px;">' +
            '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Miles <span style="opacity:0.7;">(optional — overrides auto-calc)</span></label>' +
            '<input type="number" id="retroMilesOverride" min="0" step="0.1" placeholder="Leave blank to auto-calculate" ' +
              'style="width:100%;padding:8px 10px;border:1px solid ' + border + ';border-radius:8px;font-size:0.9rem;' +
              'background:' + inputBg + ';color:' + textColor + ';box-sizing:border-box;font-family:DM Sans,sans-serif;">' +
          '</div>' +

          // Calculated miles display
          '<div id="retroMilesDisplay" style="display:none;margin-bottom:12px;padding:10px 12px;background:' + cardBg + ';border-radius:8px;font-size:0.85rem;">' +
            '<span id="retroMilesValue"></span> <span id="retroMilesSource" style="color:var(--warm-gray);font-size:0.78rem;"></span>' +
          '</div>' +

          // Actions
          '<div style="display:flex;gap:10px;">' +
            '<button onclick="closeRetroTripModal()" style="flex:1;padding:10px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.85rem;">Cancel</button>' +
            '<button id="retroSaveLegBtn" onclick="saveRetroactiveLeg()" style="flex:1;padding:10px;border:none;border-radius:8px;background:var(--amber-glow,var(--amber));color:white;cursor:pointer;font-weight:600;font-family:DM Sans,sans-serif;font-size:0.85rem;">Calculate & Save Leg</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    // If we have legs already, pre-fill origin with last leg's destination
    if (retroModalData.legs.length > 0) {
      var lastLeg = retroModalData.legs[retroModalData.legs.length - 1];
      var originInput = document.getElementById('retroOrigin');
      if (originInput) originInput.value = lastLeg.destination.label;
      renderRetroLegsSummary();
    }
  }

  function closeRetroTripModal() {
    var modal = document.getElementById('retroTripModal');
    if (modal) modal.remove();
    retroModalData = null;
  }

  function buildRetroOriginDatalist() {
    var html = '';
    // Studio locations
    if (typeof studioLocations !== 'undefined') {
      Object.keys(studioLocations).forEach(function(k) {
        html += '<option value="' + esc(studioLocations[k].name) + '">';
      });
    }
    // Trip locations (sorted by use count)
    var keys = Object.keys(tripLocationsData);
    keys.sort(function(a, b) { return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0); });
    keys.forEach(function(k) {
      html += '<option value="' + esc(tripLocationsData[k].label || k) + '">';
    });
    return html;
  }

  function buildRetroDestDatalist() {
    var html = '';
    var keys = Object.keys(tripLocationsData);
    keys.sort(function(a, b) { return (tripLocationsData[b].useCount || 0) - (tripLocationsData[a].useCount || 0); });
    keys.forEach(function(k) {
      html += '<option value="' + esc(tripLocationsData[k].label || k) + '">';
    });
    return html;
  }

  function renderRetroLegsSummary() {
    var container = document.getElementById('retroLegsSummary');
    if (!container || !retroModalData || retroModalData.legs.length === 0) {
      if (container) container.style.display = 'none';
      return;
    }
    container.style.display = '';
    var isDark = document.body.classList.contains('dark-mode');
    var html = '<div style="font-size:0.78rem;font-weight:600;margin-bottom:6px;color:var(--warm-gray);">Legs recorded:</div>';
    retroModalData.legs.forEach(function(leg) {
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;' +
        'background:' + (isDark ? '#1a2e1a' : '#f0fdf4') + ';border-radius:6px;margin-bottom:4px;font-size:0.85rem;">' +
        '<span>' + esc(leg.origin.label) + ' → ' + esc(leg.destination.label) +
          (leg.roundTrip ? ' (round trip)' : '') + '</span>' +
        '<span style="font-weight:600;">' + leg.miles.toFixed(1) + ' mi</span>' +
      '</div>';
    });
    container.innerHTML = html;
  }

  async function saveRetroactiveLeg() {
    var user = auth.currentUser;
    if (!user) { showToast('Not signed in', true); return; }
    if (!retroModalData) return;

    var btn = document.getElementById('retroSaveLegBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Calculating...'; }

    // Get form values
    var originKey = document.getElementById('retroOrigin').value;
    var destValue = document.getElementById('retroDestination').value.trim();
    var purpose = document.getElementById('retroPurpose').value.trim();
    var roundTrip = document.getElementById('retroRoundTrip').checked;
    var tripDate = retroModalData.showDate || (document.getElementById('retroTripDate') ? document.getElementById('retroTripDate').value : new Date().toISOString().slice(0, 10));

    if (!destValue) { showToast('Enter a destination', true); if (btn) { btn.disabled = false; btn.textContent = 'Calculate & Save Leg'; } return; }

    // Resolve origin and destination
    var origin = resolveRetroOrigin(originKey);
    var destination = resolveRetroDestination(destValue);

    // Miles override — when present and > 0, skip geocoding entirely. The
    // override is interpreted as the one-way distance; round-trip doubling
    // still applies so the meaning matches the auto-calc path.
    var overrideEl = document.getElementById('retroMilesOverride');
    var overrideRaw = overrideEl ? (overrideEl.value || '').trim() : '';
    var overrideMiles = overrideRaw === '' ? NaN : parseFloat(overrideRaw);
    var onewayMiles, milesSource;
    if (!isNaN(overrideMiles) && overrideMiles > 0) {
      onewayMiles = overrideMiles;
      milesSource = 'manual-override';
    } else {
      var mileageResult = await calculateRetroactiveMileage(origin, destination);
      onewayMiles = mileageResult.miles;
      milesSource = mileageResult.source;
    }
    var totalMiles = roundTrip ? onewayMiles * 2 : onewayMiles;

    // Get IRS rate
    var tripYear = new Date(tripDate + 'T12:00:00').getFullYear();
    var rate = tripSettingsData.irsRates ? (tripSettingsData.irsRates[tripYear] || tripSettingsData.irsRates[tripYear - 1] || 70) : 70;
    var deductible = Math.round(totalMiles * (rate / 100) * 100) / 100;

    // Generate session ID for grouping legs
    if (!retroModalData.eventSessionId) {
      retroModalData.eventSessionId = 'session-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6);
    }

    // Create trip record — see comment on the active-trip path above; the
    // Firestore adapter's push(uid) call writes undefined, so allocate a key
    // up front and use .set(uid, id, data).
    var tripId = MastDB.newKey('trips/' + user.uid);
    var tripData = {
      tripId: tripId,
      driverId: user.uid,
      driverName: user.displayName || user.email || 'Unknown',
      status: 'completed',
      startTime: tripDate + 'T09:00:00.000Z',
      endTime: tripDate + 'T10:00:00.000Z',
      tripDate: tripDate,
      origin: origin,
      destination: destination,
      miles: totalMiles,
      milesSource: milesSource,
      purpose: purpose || null,
      purposeLabel: purpose || null,
      notes: roundTrip ? 'Round trip' : '',
      irsRateYear: tripYear,
      irsRateCentsPerMile: rate,
      deductibleValue: deductible,
      expenses: [],
      entryMethod: retroModalData.entryMethod,
      eventSessionId: retroModalData.eventSessionId,
      // W1b — when a trip is started from a show ("Add mileage to this show"),
      // carry the show linkage onto the trip itself so Show P&L can sum
      // travel costs without scanning eventSessionId labels.
      showId: retroModalData.showId || null,
      showName: retroModalData.showName || null,
      roundTrip: roundTrip
    };

    try {
      await MastDB.trips.set(user.uid, tripId, tripData);

      // Add destination to tripLocations if new
      var destSlug = destValue.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      if (!tripLocationsData[destSlug]) {
        await MastDB.tripLocations.ref(destSlug).set({
          label: destValue, lat: destination.lat || 0, lng: destination.lng || 0, useCount: 0, lastUsed: new Date().toISOString()
        });
        tripLocationsData[destSlug] = { label: destValue, lat: 0, lng: 0, useCount: 0 };
      }
      incrementLocationUseCount(origin);
      incrementLocationUseCount(destination);

      // Track this leg
      retroModalData.legs.push({
        tripId: tripId,
        origin: origin,
        destination: destination,
        miles: totalMiles,
        roundTrip: roundTrip,
        purpose: purpose
      });

      writeAudit('create', 'trips', tripId);
      showToast('Leg recorded — ' + totalMiles.toFixed(1) + ' mi · $' + deductible.toFixed(2));

      // Ask about more legs
      askForMoreLegs();
    } catch (err) {
      showToast('Error saving trip: ' + err.message, true);
      if (btn) { btn.disabled = false; btn.textContent = 'Calculate & Save Leg'; }
    }
  }

  function askForMoreLegs() {
    var formEl = document.getElementById('retroLegForm');
    if (!formEl) return;

    var isDark = document.body.classList.contains('dark-mode');
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : 'var(--charcoal)';

    renderRetroLegsSummary();

    formEl.innerHTML =
      '<div style="text-align:center;padding:20px 0;">' +
        '<div style="font-size:1.15rem;margin-bottom:16px;">Any other destinations on this trip?</div>' +
        '<div style="display:flex;gap:10px;justify-content:center;">' +
          '<button onclick="addAnotherLeg()" style="padding:10px 24px;border:none;border-radius:8px;background:var(--amber-glow,var(--amber));color:white;cursor:pointer;font-weight:600;font-family:DM Sans,sans-serif;font-size:0.9rem;">Yes, add another</button>' +
          '<button onclick="finishRetroactiveTrip()" style="padding:10px 24px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.9rem;">No, I\'m done</button>' +
        '</div>' +
      '</div>';
  }

  function addAnotherLeg() {
    openRetroactiveTripModal();
  }

  function finishRetroactiveTrip() {
    var totalMiles = 0;
    if (retroModalData) {
      retroModalData.legs.forEach(function(leg) {
        totalMiles += leg.miles;
      });
      var legCount = retroModalData.legs.length;
      closeRetroTripModal();
      showToast('Trip complete — ' + legCount + ' leg(s), ' + totalMiles.toFixed(1) + ' total miles');
    } else {
      closeRetroTripModal();
    }

    // Refresh trips list and dashboard
    tripsLoaded = false;
    if (currentRoute === 'trips') loadTrips();
    if (currentRoute === 'dashboard') renderDashboardTodos();
  }

  function resolveRetroOrigin(label) {
    if (!label) return { label: 'Unknown', lat: 0, lng: 0, geocoded: false };
    // Match by label in trip locations
    var tripKey = Object.keys(tripLocationsData).find(function(k) {
      return (tripLocationsData[k].label || '').toLowerCase() === label.toLowerCase();
    });
    if (tripKey) {
      var loc = tripLocationsData[tripKey];
      return { label: loc.label || label, lat: loc.lat || 0, lng: loc.lng || 0, geocoded: !!loc.lat };
    }
    // Match by name in studio locations
    if (typeof studioLocations !== 'undefined') {
      var studioKey = Object.keys(studioLocations).find(function(k) {
        return studioLocations[k].name.toLowerCase() === label.toLowerCase();
      });
      if (studioKey) {
        var sl = studioLocations[studioKey];
        return { label: sl.name, lat: sl.lat, lng: sl.lng, geocoded: true };
      }
    }
    // Free text entry
    return { label: label, lat: 0, lng: 0, geocoded: false };
  }

  function resolveRetroDestination(destValue) {
    var matchKey = Object.keys(tripLocationsData).find(function(k) {
      return (tripLocationsData[k].label || '').toLowerCase() === destValue.toLowerCase();
    });
    if (matchKey) {
      var dl = tripLocationsData[matchKey];
      return { label: dl.label, lat: dl.lat || 0, lng: dl.lng || 0, geocoded: !!dl.lat };
    }
    return { label: destValue, lat: 0, lng: 0, geocoded: false };
  }

  function calculateRetroactiveMileage(origin, destination) {
    return new Promise(function(resolve) {
      var originStr = origin.lat && origin.lng && origin.geocoded ? origin.lat + ',' + origin.lng : origin.label;
      var destStr = destination.lat && destination.lng && destination.geocoded ? destination.lat + ',' + destination.lng : destination.label;

      if (!originStr || !destStr) {
        resolve({ miles: 0, source: 'manual-override' });
        return;
      }

      var display = document.getElementById('retroMilesDisplay');
      var valueEl = document.getElementById('retroMilesValue');
      var sourceEl = document.getElementById('retroMilesSource');
      if (display) display.style.display = '';
      if (valueEl) valueEl.textContent = 'Calculating...';
      if (sourceEl) sourceEl.textContent = '';

      var timeout = setTimeout(function() {
        if (origin.lat && origin.lng && destination.lat && destination.lng) {
          var hv = haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng);
          var hvMiles = Math.round((hv / 1609.344) * 10) / 10;
          if (valueEl) valueEl.textContent = hvMiles.toFixed(1) + ' miles (one way)';
          if (sourceEl) sourceEl.textContent = 'Estimated (straight-line)';
          resolve({ miles: hvMiles, source: 'haversine-fallback' });
        } else {
          if (valueEl) valueEl.textContent = 'Enter miles manually';
          resolve({ miles: 0, source: 'manual-override' });
        }
      }, 5000);

      try {
        if (window.google && window.google.maps) {
          var service = new google.maps.DistanceMatrixService();
          service.getDistanceMatrix({
            origins: [originStr],
            destinations: [destStr],
            travelMode: 'DRIVING',
            unitSystem: google.maps.UnitSystem.IMPERIAL
          }, function(response, status) {
            clearTimeout(timeout);
            if (status === 'OK' && response.rows[0] && response.rows[0].elements[0].status === 'OK') {
              var meters = response.rows[0].elements[0].distance.value;
              var miles = Math.round((meters / 1609.344) * 10) / 10;
              if (valueEl) valueEl.textContent = miles.toFixed(1) + ' miles (one way)';
              if (sourceEl) sourceEl.textContent = 'via Google Maps';
              resolve({ miles: miles, source: 'maps-api' });
            } else {
              if (origin.lat && origin.lng && destination.lat && destination.lng) {
                var hv = haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng);
                var hvMiles = Math.round((hv / 1609.344) * 10) / 10;
                if (valueEl) valueEl.textContent = hvMiles.toFixed(1) + ' miles (one way)';
                if (sourceEl) sourceEl.textContent = 'Estimated (straight-line)';
                resolve({ miles: hvMiles, source: 'haversine-fallback' });
              } else {
                if (valueEl) valueEl.textContent = 'Maps unavailable';
                resolve({ miles: 0, source: 'manual-override' });
              }
            }
          });
        } else {
          clearTimeout(timeout);
          if (origin.lat && origin.lng && destination.lat && destination.lng) {
            var hv = haversineMeters(origin.lat, origin.lng, destination.lat, destination.lng);
            var hvMiles = Math.round((hv / 1609.344) * 10) / 10;
            if (valueEl) valueEl.textContent = hvMiles.toFixed(1) + ' miles (one way)';
            if (sourceEl) sourceEl.textContent = 'Estimated (straight-line)';
            resolve({ miles: hvMiles, source: 'haversine-fallback' });
          } else {
            if (valueEl) valueEl.textContent = 'Enter miles manually';
            resolve({ miles: 0, source: 'manual-override' });
          }
        }
      } catch (e) {
        clearTimeout(timeout);
        resolve({ miles: 0, source: 'manual-override' });
      }
    });
  }

  // ============================================================
  // Previous Trips (unrecorded shows list)
  // ============================================================

  function openPreviousTripsModal() {
    var user = auth.currentUser;
    if (!user) { showToast('Not signed in', true); return; }

    var isDark = document.body.classList.contains('dark-mode');
    var bg = isDark ? '#1e1e1e' : 'white';
    var border = isDark ? '#444' : '#ddd';
    var textColor = isDark ? '#e0e0e0' : 'var(--charcoal)';

    var existing = document.getElementById('prevTripsModal');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'prevTripsModal';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;' +
      'display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto;';
    overlay.innerHTML =
      '<div style="background:' + bg + ';border-radius:12px;padding:24px;width:100%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.3);margin-top:40px;color:' + textColor + ';">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
          '<div style="font-weight:700;font-size:1.0rem;">Previous Trips</div>' +
          '<button onclick="closePrevTripsModal()" style="background:none;border:none;font-size:1.15rem;cursor:pointer;color:' + textColor + ';">✕</button>' +
        '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Past shows with no mileage recorded:</div>' +
        '<div id="prevTripsListContent" style="color:' + textColor + ';">Loading...</div>' +
        '<div style="margin-top:16px;padding-top:12px;border-top:1px solid ' + border + ';">' +
          '<button onclick="closePrevTripsModal(); startRetroactiveManual();" style="width:100%;padding:10px;border:1px solid ' + border + ';border-radius:8px;background:transparent;color:' + textColor + ';cursor:pointer;font-family:DM Sans,sans-serif;font-size:0.85rem;">+ Add Past Trip Manually</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    loadPreviousTrips();
  }

  function closePrevTripsModal() {
    var modal = document.getElementById('prevTripsModal');
    if (modal) modal.remove();
  }

  async function loadPreviousTrips() {
    var container = document.getElementById('prevTripsListContent');
    if (!container) return;
    var user = auth.currentUser;
    if (!user) return;

    // Ensure shows loaded
    if (!showsLoaded) {
      try {
        showsData = (await MastDB.shows.list(200)) || {};
        showsLoaded = true;
      } catch (e) {
        container.innerHTML = '<div style="color:var(--warm-gray);">Could not load shows.</div>';
        return;
      }
    }

    // Load trips
    var tripsSnap;
    try {
      tripsSnap = await MastDB.trips.ref(user.uid).limitToLast(500).once('value');
    } catch (e) {
      container.innerHTML = '<div style="color:var(--warm-gray);">Could not load trips.</div>';
      return;
    }
    var allTrips = tripsSnap.val() || {};
    var tripDates = {};
    Object.values(allTrips).forEach(function(t) {
      if (t.startTime) tripDates[new Date(t.startTime).toISOString().slice(0, 10)] = true;
      if (t.tripDate) tripDates[t.tripDate] = true;
    });

    var now = new Date();
    var isDark = document.body.classList.contains('dark-mode');
    var items = [];

    Object.keys(showsData).forEach(function(showId) {
      var s = showsData[showId];
      if (!s.startDate) return;
      var showDate = new Date(s.startDate + 'T12:00:00');
      if (showDate >= now) return;
      if (!s.locationCity && !s.locationState) return;
      if (tripDates[s.startDate]) return;
      if (s.endDate && tripDates[s.endDate]) return;
      items.push({ showId: showId, show: s });
    });

    items.sort(function(a, b) { return (b.show.startDate || '').localeCompare(a.show.startDate || ''); });

    if (items.length === 0) {
      container.innerHTML = '<div style="padding:12px 0;text-align:center;color:var(--warm-gray);font-size:0.85rem;">All past shows have mileage recorded!</div>';
      return;
    }

    var html = '';
    items.forEach(function(item) {
      var s = item.show;
      var location = [s.locationCity, s.locationState].filter(Boolean).join(', ');
      html += '<div onclick="closePrevTripsModal(); startRetroactiveFromShow(\'' + esc(item.showId) + '\');" style="' +
        'padding:12px;border-radius:8px;margin-bottom:8px;cursor:pointer;' +
        'background:' + (isDark ? '#2a2a2a' : '#f9f9f9') + ';border:1px solid ' + (isDark ? '#444' : '#eee') + ';">' +
        '<div style="font-weight:600;font-size:0.9rem;">' + esc(s.name || 'Unnamed show') + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' +
          formatShowDate(s.startDate) + (location ? ' · ' + esc(location) : '') +
        '</div>' +
      '</div>';
    });
    container.innerHTML = html;
  }

  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  window.openStartTripModal = openStartTripModal;
  window.closeStartTripModal = closeStartTripModal;
  window.confirmStartTrip = confirmStartTrip;
  window.openEndTripSheet = openEndTripSheet;
  window.closeEndTripSheet = closeEndTripSheet;
  window.confirmEndTrip = confirmEndTrip;
  window.discardActiveTrip = discardActiveTrip;
  window.selectTripPurpose = selectTripPurpose;
  window.cancelOtherPurpose = cancelOtherPurpose;
  window.confirmOtherPurpose = confirmOtherPurpose;
  window.switchTripsSubView = switchTripsSubView;
  window.renderTripsList = renderTripsList;
  window.toggleTripDetail = toggleTripDetail;
  window.loadAllDriversTrips = loadAllDriversTrips;
  window.renderTaxReport = renderTaxReport;
  window.exportTripsCSV = exportTripsCSV;
  window.printTaxReport = printTaxReport;
  window.renderIrsRates = renderIrsRates;
  window.addIrsRate = addIrsRate;
  window.removeIrsRate = removeIrsRate;
  window.renderTripLocations = renderTripLocations;
  window.addTripLocationManual = addTripLocationManual;
  window.removeTripLocation = removeTripLocation;
  window.openPreviousTripsModal = openPreviousTripsModal;
  window.closePrevTripsModal = closePrevTripsModal;
  window.startRetroactiveFromShow = startRetroactiveFromShow;
  window.startRetroactiveManual = startRetroactiveManual;
  window.closeRetroTripModal = closeRetroTripModal;
  window.saveRetroactiveLeg = saveRetroactiveLeg;
  window.addAnotherLeg = addAnotherLeg;
  window.finishRetroactiveTrip = finishRetroactiveTrip;
  window.loadTripsSettings = loadTripsSettings;

  // Expose for core to call on auth (dashboard active trip banner)
  window.checkForActiveTrip = checkForActiveTrip;
  window.renderActiveTripBanner = renderActiveTripBanner;
  window.initTripsModule = initTripsModule;

  // URL-filter clear (MCP admin-link landings)
  window.clearTripsFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'status' && k !== 'dateFrom' && k !== 'dateTo' && k !== 'tripIds') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('trips', clean);
    else location.hash = '#trips';
    setTimeout(function() { if (typeof renderTripsList === 'function') renderTripsList(); }, 0);
  };
  window.renderTripsList = renderTripsList;
})();
