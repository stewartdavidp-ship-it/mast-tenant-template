/**
 * sessions-v2.js — read-focused Faceted Record twin of the legacy Class Sessions
 * (the scheduled occurrences of a Class; doc 17 §11 + §12, conversion playbook).
 *
 * Legacy book.js (#book, owned by the Book module) materializes sessions from each
 * Class's schedule and manages them inside the class catalog + calendar (generate /
 * edit / cancel / mark-attended live there). The sibling calendar-v2 plots those
 * same occurrences on a month grid, and classes-v2 surfaces them as a per-class
 * Sessions facet. This twin is the third lens: a FLAT, sortable LIST of every
 * occurrence across all classes, click → a read-focused Faceted Record slide-out.
 * Same index then detail handoff as a table; a list lens over scheduled time.
 *
 * Variant (doc 17 §1a): a class session is class + date/time + capacity + enrolled +
 * status (scheduled / cancelled / completed) — its status is an ASSIGNED attribute,
 * not a governed lifecycle, so it is a Faceted Record, NOT Process/MastFlow.
 *
 * Read-focused: scheduling / editing / cancelling an occurrence is coupled to the
 * legacy Book session materializer (it regenerates a series, reflows enrollments,
 * fires waivers) and stays single-sourced on legacy #book via a "manage in classic
 * view" link. This twin re-hosts the VIEW only — no onSave, no edit form, no
 * generate / cancel / attendance tooling (those stay on legacy too). Flag-gated
 * (?ui=1) at #sessions-v2, side-by-side; never touches book.js.
 *
 * Data: sessions live at public/classSessions (MastDB.classSessions, each with a
 * classId); classes live at public/classes (MastDB.classes). Both are read once
 * together (one-shot keyed-object reads, mirroring book.js / calendar-v2 /
 * classes-v2) so the class NAME and per-occurrence enrolled count are cheap. The
 * enrolled-count + class-name resolution mirror calendar-v2 / classes-v2 exactly.
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

  // Status label / tone maps mirror book.js + calendar-v2 / classes-v2 SESSION
  // tones (kept local — read-only display lookups, mapped to v2 tone tokens).
  var STATUS_LABEL = { scheduled: 'Scheduled', cancelled: 'Cancelled', completed: 'Completed' };
  var STATUS_TONE = { scheduled: 'teal', cancelled: 'danger', completed: 'success' };
  function statusOf(s) { return String((s && s.status) || 'scheduled').toLowerCase(); }
  function statusTone(v) { return STATUS_TONE[v] || 'teal'; }
  function statusLabel(s) { var v = statusOf(s); return STATUS_LABEL[v] || (s && s.status) || 'Scheduled'; }

  // Class name resolution (mirrors calendar-v2.className / classes-v2.className):
  // the class doc carries name / title / className; fall back to the id.
  function className(s) {
    var id = s && s.classId;
    return (id && V2.classes[id]) || 'Session';
  }
  // enrolled is denormalized on the session (number); fall back to an array length
  // or enrolledCount (mirrors calendar-v2.enrolledCount / classes-v2.sessEnrolled).
  function enrolledCount(s) {
    if (Array.isArray(s.enrolled)) return s.enrolled.length;
    if (s.enrolledCount != null) return s.enrolledCount;
    return (typeof s.enrolled === 'number') ? s.enrolled : 0;
  }
  function capacityOf(s) {
    var n = parseInt(s && (s.capacity != null ? s.capacity : s.maxStudents), 10);
    return isNaN(n) ? null : n;
  }
  // "8 / 12" (or just "8" when capacity is unknown) — the list + tile fill string.
  function enrolledFill(s) {
    var cap = capacityOf(s);
    return N.count(enrolledCount(s)) + (cap == null ? '' : (' / ' + N.count(cap)));
  }

  // 12h time + range, mirroring classes-v2.fmtTime / fmtTimeRange cheaply.
  function fmtTime(t) {
    if (!t) return '';
    var parts = String(t).split(':'); var h = parseInt(parts[0], 10); var m = parts[1] || '00';
    if (isNaN(h)) return esc(t);
    var ampm = h >= 12 ? 'PM' : 'AM'; if (h > 12) h -= 12; if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
  }
  function fmtTimeRange(s) {
    var a = fmtTime(s.startTime), b = fmtTime(s.endTime);
    return a ? (a + (b ? (' to ' + b) : '')) : '';
  }
  function dateStr(s) { return s && s.date ? String(s.date).slice(0, 10) : ''; }
  function isUpcoming(s) { return dateStr(s) >= V2.today && statusOf(s) !== 'cancelled'; }

  // fields[0] (the slide-out title source) materializes a real "<class> — <date>"
  // title string so the panel reads naturally instead of as a bare id.
  function sessionTitle(s) {
    var d = s && s.date ? N.date(s.date) : '';
    return className(s) + (d ? (' — ' + d) : '');
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('sessions-v2', {
    label: 'Session', labelPlural: 'Sessions', size: 'md',
    route: 'sessions-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      // fields[0] — the slide-out title source (a real "<class> — <date>" string).
      { name: 'title', label: 'Class', type: 'text', list: true, readOnly: true, group: 'Session', get: sessionTitle },
      { name: 'date', label: 'Date', type: 'date', list: true, readOnly: true, get: function (s) { return s.date || null; } },
      { name: 'time', label: 'Time', type: 'text', list: true, readOnly: true, sortable: false, get: function (s) { return fmtTimeRange(s) || '—'; } },
      { name: 'enrolled', label: 'Enrolled', type: 'text', list: true, readOnly: true, align: 'right', sortable: false, get: enrolledFill },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['scheduled', 'cancelled', 'completed'],
        get: statusOf,
        tone: statusTone }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, s) {
        var cap = capacityOf(s);

        var tiles = UI.tiles([
          { k: 'Date', v: s.date ? N.date(s.date) : '—', hero: true },
          { k: 'Time', v: esc(fmtTimeRange(s) || '—') },
          { k: 'Enrolled', v: esc(enrolledFill(s)) },
          { k: 'Status', v: UI.badge(statusLabel(s), statusTone(statusOf(s))) }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }], 'ov');

        // Overview — the single facet: class + when + who + capacity/enrolled + status.
        // A class session is a thin occurrence record, so one Overview facet is the
        // honest shape (doc 17: do not pad facets a record doesn't have).
        var overview = UI.kv([
          { k: 'Class', v: esc(className(s)) },
          { k: 'Status', v: UI.badge(statusLabel(s), statusTone(statusOf(s))) },
          { k: 'Date', v: s.date ? N.date(s.date) : '—' },
          { k: 'Time', v: esc(fmtTimeRange(s) || '—') },
          { k: 'Enrolled', v: esc(enrolledFill(s)) + (cap == null ? '' : (' enrolled' + (enrolledCount(s) >= cap ? ' (full)' : ''))) },
          { k: 'Capacity', v: cap == null ? '—' : N.count(cap) },
          { k: 'Instructor', v: s.instructorName ? esc(s.instructorName) : '—' },
          { k: 'Location', v: s.location ? esc(s.location) : '—' }
        ]);
        // Drill to the parent class detail (the catalog record this occurrence came
        // from); the class lives on the legacy Book detail, opened by route.
        var viewClass = s.classId
          ? '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="SessionsV2.openClass(\'' + esc(s.classId) + '\')">View full class →</button></div>'
          : '';
        // Scheduling / editing / cancelling an occurrence stays on legacy #book.
        // navigateToClassic avoids looping the V2 route remap back to this twin.
        var manage = '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="SessionsV2.classic()">Manage in classic view →</button></div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Session', overview + viewClass + manage) + '</div>';
      }
    }
    // No onSave → no Edit button (scheduling / editing an occurrence stays on legacy #book).
  });

  // ── module state + data ─────────────────────────────────────────────
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var V2 = { rows: [], byId: {}, classes: {}, today: todayStr(), sortKey: 'date', sortDir: 'desc', q: '', statusFilter: 'all', whenFilter: 'all', loaded: false };

  function load() {
    V2.today = todayStr();
    // Sessions + their parent classes load together; both one-shot keyed-object
    // reads (mirrors classes-v2 load / calendar-v2 load). public/classes resolves
    // the class NAME; public/classSessions is the occurrence list.
    Promise.all([
      Promise.resolve(MastDB.get('public/classSessions')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/classes')).catch(function () { return null; })
    ]).then(function (res) {
      var sv = res[0] || {}, cv = res[1] || {};
      V2.classes = {};
      Object.keys(cv).forEach(function (k) {
        var c = cv[k]; if (c && typeof c === 'object') V2.classes[k] = c.name || c.title || c.className || k;
      });
      var out = [];
      Object.keys(sv).forEach(function (k) {
        var s = sv[k];
        if (s && typeof s === 'object' && s.date) { s = Object.assign({ _key: k }, s); out.push(s); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[sessions-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (s) { return statusOf(s) === V2.statusFilter; });
    if (V2.whenFilter === 'upcoming') rows = rows.filter(isUpcoming);
    else if (V2.whenFilter === 'past') rows = rows.filter(function (s) { return !isUpcoming(s); });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (s) {
        return className(s).toLowerCase().indexOf(q) >= 0 ||
               String(s.instructorName || '').toLowerCase().indexOf(q) >= 0 ||
               String(s.location || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('sessions-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('sessionsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'sessionsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var statusPills = [['all', 'All'], ['scheduled', 'Scheduled'], ['completed', 'Completed'], ['cancelled', 'Cancelled']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="SessionsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    var whenPills = [['all', 'All time'], ['upcoming', 'Upcoming'], ['past', 'Past']]
      .map(function (f) {
        var on = V2.whenFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="SessionsV2.when(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Sessions',
        count: N.count(V2.rows.length) + ' session' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="SessionsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + statusPills +
        '<span style="width:1px;background:var(--border,rgba(127,127,127,0.3));margin:0 4px;"></span>' + whenPills + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search class, instructor or location…" value="' + esc(V2.q) +
        '" oninput="SessionsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('sessions-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'SessionsV2.sort', onRowClickFnName: 'SessionsV2.open',
        empty: { title: 'No sessions', message: V2.loaded ? 'Generate sessions from a class schedule in the classic Classes / calendar view.' : 'Loading…' }
      });
  }

  window.SessionsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'date' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    when: function (f) { V2.whenFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('sessions-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('sessions-v2', rec, 'read');
      });
    },
    // Drill to the parent class detail (legacy Book detail). Close the panel first
    // so the route nav doesn't race the open overlay (mirrors calendar-v2.openClass).
    openClass: function (classId) {
      try { U.slideOut.requestClose(); } catch (e) {}
      if (typeof navigateTo === 'function') navigateTo('book-detail', { id: classId });
    },
    // Scheduling / editing → classic Classes catalog + calendar (route 'book').
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('book');
      else if (typeof navigateTo === 'function') navigateTo('book');
    },
    exportCsv: function () { return MastEntity.exportRows('sessions-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('sessions-v2', {
    routes: { 'sessions-v2': { tab: 'sessionsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
