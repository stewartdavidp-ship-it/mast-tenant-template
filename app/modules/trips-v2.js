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
 * read-focused Faceted Record, NO edit affordance (matches legacy). Scoped to
 * the current user's trips (the all-drivers admin toggle stays on legacy #trips).
 * Flag-gated (`?ui=1`), side-by-side with legacy `#trips`; never touches it.
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
    fields: [
      { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true, group: 'Trip',
        get: function (t) { return t.startTime || t.tripDate || null; } },
      { name: 'destination', label: 'Destination', type: 'text', list: true, readOnly: true,
        get: function (t) { return locLabel(t.destination); } },
      { name: 'purpose', label: 'Purpose', type: 'text', list: true, readOnly: true,
        get: function (t) { return purposeText(t); } },
      { name: 'miles', label: 'Miles', type: 'number', list: true, readOnly: true,
        get: function (t) { return t.miles || 0; } },
      { name: 'deductible', label: 'Deductible', type: 'money', list: true, readOnly: true,
        get: function (t) { return t.deductibleValue || 0; } }
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

        var route = UI.kv([
          { k: 'Origin', v: esc(locLabel(t.origin)) },
          { k: 'Destination', v: esc(locLabel(t.destination)) }
        ]);
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
  var V2 = { rows: [], byId: {}, sortKey: 'date', sortDir: 'desc', q: '', loaded: false };

  function currentUid() {
    try { return (window.firebase && firebase.auth().currentUser && firebase.auth().currentUser.uid) || null; } catch (e) { return null; }
  }

  function load() {
    var uid = currentUid();
    if (!uid) { V2.rows = []; render(); return; }
    // NB: do NOT pass orderBy — orderByChild('startTime') returns 0 rows in the
    // Firestore-compat layer for this path (verified on sgtest15). Fetch the
    // user's recent trips and sort client-side (visibleRows defaults to date desc).
    Promise.resolve(MastDB.trips.list(uid, { limit: 200 })).then(function (snap) {
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var t = val[k]; if (t && typeof t === 'object' && t.status === 'completed') out.push(Object.assign({ id: k }, t));
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.id] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[trips-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return locLabel(r.destination).toLowerCase().indexOf(q) >= 0 ||
               locLabel(r.origin).toLowerCase().indexOf(q) >= 0 ||
               purposeText(r).toLowerCase().indexOf(q) >= 0;
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
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Trips</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(V2.rows.length) + ' trips</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="TripsV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin:12px 0;flex-wrap:wrap;">' +
        tile(N.count(s.count), 'Trips') + tile(s.miles.toFixed(1), 'Miles') + tile(N.money(s.ded) || '$0.00', 'Deductible') +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search destination, origin, purpose…" value="' + esc(V2.q) +
        '" oninput="TripsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('trips-v2', {
        rows: rows, sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'TripsV2.sort', onRowClickFnName: 'TripsV2.open',
        empty: { title: 'No trips yet', message: V2.loaded ? 'Completed trips will appear here.' : 'Loading…' }
      });
  }

  function tile(value, label) {
    return '<div style="background:var(--cream);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
      '<div style="font-size:1.6rem;font-weight:700;color:var(--charcoal);">' + value + '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(label) + '</div></div>';
  }

  window.TripsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'date' ? 'desc' : 'asc'); }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('trips-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('trips-v2', rec, 'read');
      });
    },
    exportCsv: function () { return MastEntity.exportRows('trips-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('trips-v2', {
    routes: { 'trips-v2': { tab: 'tripsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
