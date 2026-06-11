/**
 * calendar-v2.js — the CALENDAR index control (doc 17 §10), proven on class
 * sessions. A calendar is just an alternate INDEX lens over the same records:
 * it plots session occurrences (public/classSessions, generated from each
 * Class's schedule) by date, and a click OUTPUTS the session — the occurrence
 * you clicked — not the parent Class template. The parent Class is linked from
 * the session detail. Same index→detail handoff a table gives, different lens.
 *
 * Flag-gated (uiRedesign); self-mounts on route #calendar-v2 side-by-side with
 * the legacy book calendar.
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
  if (!window.MastAdmin || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;
  var now = new Date();
  var CAL = { year: now.getFullYear(), month: now.getMonth(), sessions: [], byId: {}, classes: {} };

  function statusTone(s) {
    var v = String(s || '').toLowerCase();
    return v === 'cancelled' ? 'danger' : (v === 'completed' ? 'success' : 'teal');
  }
  function className(classId) { return CAL.classes[classId] || 'Session'; }
  function enrolledCount(s) { return Array.isArray(s.enrolled) ? s.enrolled.length : (s.enrolledCount != null ? s.enrolledCount : (typeof s.enrolled === 'number' ? s.enrolled : 0)); }

  // ── Data ────────────────────────────────────────────────────────────
  function load() {
    if (!window.MastDB || !MastDB.classSessions) { render(); return; }
    Promise.all([
      Promise.resolve(MastDB.classSessions.list()).catch(function () { return {}; }),
      (MastDB.classes && MastDB.classes.list) ? Promise.resolve(MastDB.classes.list(200)).catch(function () { return {}; }) : Promise.resolve({})
    ]).then(function (res) {
      var sess = res[0] || {}, cls = res[1] || {};
      CAL.classes = {};
      Object.keys(cls).forEach(function (k) { var c = cls[k]; if (c) CAL.classes[k] = c.name || c.title || c.className || k; });
      CAL.sessions = Object.keys(sess).map(function (k) { var s = sess[k]; return Object.assign({ id: k }, s); }).filter(function (s) { return s.date; });
      CAL.byId = {}; CAL.sessions.forEach(function (s) { CAL.byId[s.id] = s; });
      render();
    }).catch(function (e) { console.error('[calendar-v2] load', e); render(); });
  }

  function entriesByDate() {
    var by = {};
    CAL.sessions.forEach(function (s) {
      var ds = String(s.date || '').slice(0, 10); if (!ds) return;
      (by[ds] = by[ds] || []).push({ id: s.id, label: className(s.classId), time: s.startTime || '', tone: statusTone(s.status) });
    });
    Object.keys(by).forEach(function (d) { by[d].sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); }); });
    return by;
  }

  // ── Render (the calendar control is the index) ──────────────────────
  function ensureTab() {
    var el = document.getElementById('calendarV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'calendarV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }
  function render() {
    var tab = ensureTab();
    // One schedule surface, two lenses (Month · List) — this grid and the
    // sessions-v2 flat list are two views of the same occurrences (plan:
    // classes-v2-build-plan.md CONSOLIDATION).
    var lensPills =
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' +
        '<button class="btn btn-small btn-primary">Month</button> ' +
        '<button class="btn btn-small btn-secondary" onclick="navigateTo(\'sessions-v2\')">List</button></div>';
    tab.innerHTML =
      U.pageHeader({
        title: 'Schedule',
        count: N.count(CAL.sessions.length) + ' session' + (CAL.sessions.length === 1 ? '' : 's')
      }) + lensPills +
      U.calendar({
        year: CAL.year, month: CAL.month, entriesByDate: entriesByDate(),
        onEntryFnName: 'CalendarV2.openSession', onNavFnName: 'CalendarV2.nav'
      });
  }

  window.CalendarV2 = {
    nav: function (dir) {
      if (dir === 'today') { var d = new Date(); CAL.year = d.getFullYear(); CAL.month = d.getMonth(); }
      else if (dir === 'prev') { CAL.month--; if (CAL.month < 0) { CAL.month = 11; CAL.year--; } }
      else { CAL.month++; if (CAL.month > 11) { CAL.month = 0; CAL.year++; } }
      render();
    },
    // Clicking an occurrence OUTPUTS the session — one detail surface for the
    // whole schedule: the sessions-v2 entity SO (roster, session ops, class
    // drill). MastEntity.drill lazy-loads the module; its fetch is cold-safe.
    openSession: function (id) {
      if (window.MastEntity && typeof MastEntity.drill === 'function') { MastEntity.drill('sessions-v2', id); return; }
      console.warn('[calendar-v2] MastEntity unavailable; cannot open session', id);
    }
  };

  MastAdmin.registerModule('calendar-v2', {
    routes: { 'calendar-v2': { tab: 'calendarV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
