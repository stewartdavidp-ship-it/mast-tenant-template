/**
 * enrollments-v2.js — read-focused Faceted Record twin of the legacy Enrollments
 * surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy book.js (#enrollments, the Book module) hosts a roster of enrollment
 * records with an in-pane read detail (renderEnrollmentList -> _enrollView ->
 * _renderEnrollmentDetailView) plus inline roster quick-actions (Mark attended /
 * late / no-show, Promote waitlist, Cancel) and class/session scheduling tooling.
 * This twin re-hosts ONE of those surfaces — the roster -> read detail — on the
 * Entity Engine: a schema-driven list + a read-focused Faceted Record slide-out
 * (Overview / Payment / Notes facets).
 *
 * Variant (doc 17 §1a test, run against the REAL data): an enrollment links a
 * student to a class/session with a status drawn from book.js ENROLLMENT_STATUSES
 * = ['confirmed','waitlisted','cancelled','no-show','completed','late']. That
 * status is an ASSIGNED/DERIVED attribute — the legacy roster actions just SET it
 * (_bookMarkAttended writes status:'completed', _bookMarkNoShow writes
 * status:'no-show', _bookPromoteWaitlist writes status:'confirmed'); there are no
 * gated transitions, exit-checklists, or a single guarded Advance. So this is a
 * Faceted Record, NOT Process/MastFlow. (A genuine governed lifecycle — like
 * orders' pickship — would be Process; an enrollment isn't one.)
 *
 * Read-focused: editing an enrollment in legacy means the roster status actions
 * + cancellation, which mutate seat counts, waitlist promotion and downstream
 * class capacity — those stay single-sourced on legacy #enrollments via a "manage
 * in classic view" link. This twin re-hosts the VIEW only — no onSave, no edit
 * form, no status actions (those stay on legacy too). Flag-gated (?ui=1) at
 * #enrollments-v2, side-by-side; never touches book.js.
 *
 * Joins: the list + detail show class and session NAMES, which live on separate
 * records (MastDB.classes / MastDB.classSessions), exactly as book.js joins via
 * allClassesMap / allSessionsMap. This module loads those two cheap one-shot maps
 * alongside the enrollments at setup so the SYNCHRONOUS detail.render has names
 * ready; if a join misses, it shows the id (no extra per-row reads).
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

  // Status label/tone maps mirror book.js ENROLLMENT_STATUSES (read-only display).
  var STATUS_LABEL = {
    confirmed: 'Confirmed', waitlisted: 'Waitlisted', cancelled: 'Cancelled',
    'no-show': 'No-show', completed: 'Completed', late: 'Late'
  };
  var STATUS_TONE = {
    confirmed: 'success', waitlisted: 'amber', cancelled: 'neutral',
    'no-show': 'danger', completed: 'teal', late: 'warning'
  };

  // ── join helpers (read from the maps built at load; fall back to ids) ─
  function classOf(e) { return e && e.classId ? V2.classMap[e.classId] : null; }
  function sessionOf(e) { return e && e.sessionId ? V2.sessionMap[e.sessionId] : null; }
  function studentName(e) { return (e && (e.studentName || e.customerName)) || '(unnamed student)'; }
  function studentEmail(e) { return (e && (e.studentEmail || e.customerEmail)) || ''; }
  function className(e) {
    var c = classOf(e);
    return c && c.name ? c.name : (e && e.classId ? e.classId : '—');
  }
  // "May 1, 2026 · 6:00 PM" — the legacy session subline (date + start time).
  function sessionLabel(e) {
    if (!e || !e.sessionId) return '—';
    var s = sessionOf(e);
    if (!s) return e.sessionId;
    var when = s.date ? N.date(s.date) : '';
    var time = s.startTime ? fmtTime(s.startTime) : '';
    return (when + (when && time ? ' · ' : '') + time) || e.sessionId;
  }
  // Light HH:MM -> "h:MM AM/PM" (no formatTime dependency from the core shell).
  function fmtTime(hhmm) {
    if (!hhmm || typeof hhmm !== 'string' || hhmm.indexOf(':') < 0) return hhmm || '';
    var parts = hhmm.split(':');
    var h = parseInt(parts[0], 10);
    if (isNaN(h)) return hhmm;
    var min = parts[1] || '00';
    var ap = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + min + ' ' + ap;
  }
  // Title source for the slide-out — "<student> — <class>" (fields[0] via get).
  function titleOf(e) {
    var nm = studentName(e);
    var cls = className(e);
    return (cls && cls !== '—') ? (nm + ' — ' + cls) : nm;
  }
  // Status with waitlist position appended ("waitlisted #3"), matching the roster.
  function statusDisplay(e) {
    var st = (e && e.status) || '';
    if (st === 'waitlisted' && e && e.waitlistPosition) return STATUS_LABEL[st] + ' #' + e.waitlistPosition;
    return STATUS_LABEL[st] || (st || '—');
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('enrollments-v2', {
    label: 'Enrollment', labelPlural: 'Enrollments', size: 'lg',
    route: 'enrollments-v2',
    recordId: function (e) { return e._key || e.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'student', label: 'Student', type: 'text', list: true, readOnly: true, group: 'Enrollment', get: titleOf },
      { name: 'className', label: 'Class', type: 'text', list: true, readOnly: true, sortable: false, get: className },
      { name: 'session', label: 'Session', type: 'text', list: true, readOnly: true, sortable: false, get: sessionLabel },
      { name: 'paid', label: 'Paid', type: 'money', list: true, readOnly: true, align: 'right',
        get: function (e) { return N.moneyVal(e, 'pricePaidCents', 'pricePaid'); } },
      { name: 'enrolledAt', label: 'Enrolled', type: 'date', list: true, readOnly: true,
        get: function (e) { return e.enrolledAt || e.createdAt || null; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['confirmed', 'waitlisted', 'cancelled', 'no-show', 'completed', 'late'],
        get: function (e) { return e.status || '—'; },
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, e) {
        var sess = sessionOf(e);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(statusDisplay(e), STATUS_TONE[e.status] || 'neutral'), hero: true },
          { k: 'Paid', v: (N.money(N.moneyVal(e, 'pricePaidCents', 'pricePaid')) || '—') },
          { k: 'Enrolled', v: (e.enrolledAt || e.createdAt) ? N.date(e.enrolledAt || e.createdAt) : '—' },
          { k: 'Session', v: e.sessionId ? esc(sessionLabel(e)) : '—' }
        ]);
        var hasMoney = (N.moneyVal(e, 'pricePaidCents', 'pricePaid') != null) || e.paymentMethod || e.paymentRef || e.passId;
        var tabs = [{ key: 'ov', label: 'Overview' }];
        if (hasMoney) tabs.push({ key: 'payment', label: 'Payment' });
        tabs.push({ key: 'notes', label: 'Notes' });
        var tabsBar = UI.paneTabsBar(tabs, 'ov');

        // Overview — student + class/session + lifecycle dates.
        var student = UI.kv([
          { k: 'Name', v: esc(studentName(e)) },
          { k: 'Email', v: studentEmail(e) ? esc(studentEmail(e)) : '—' },
          { k: 'Phone', v: (e.studentPhone || e.phone) ? esc(e.studentPhone || e.phone) : '—' },
          { k: 'Customer', v: e.customerId ? esc(e.customerId) : '—' }
        ]);
        var classCard = UI.kv([
          { k: 'Class', v: esc(className(e)) },
          { k: 'Session', v: e.sessionId ? esc(sessionLabel(e)) : '—' },
          { k: 'Capacity', v: (sess && sess.capacity) ? N.count(sess.capacity) : '—' },
          { k: 'Status', v: UI.badge(statusDisplay(e), STATUS_TONE[e.status] || 'neutral') }
        ]);
        var lifecycle = UI.kv([
          { k: 'Enrolled', v: e.enrolledAt ? N.date(e.enrolledAt) : (e.createdAt ? N.date(e.createdAt) : '—') },
          { k: 'Attended', v: e.attendedAt ? N.date(e.attendedAt) : '—' },
          { k: 'Cancelled', v: e.cancelledAt ? N.date(e.cancelledAt) : '—' },
          { k: 'Waitlist position', v: e.waitlistPosition ? ('#' + e.waitlistPosition) : '—' }
        ]);
        // Status actions (mark attended / no-show / promote / cancel) + seat-count
        // and waitlist side effects stay on legacy #enrollments.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="EnrollmentsV2.classic()">Manage in classic view →</button></div>';

        // Payment — amount + method + reference + pass (only when money on record).
        var paymentBody = UI.kv([
          { k: 'Amount paid', v: N.money(N.moneyVal(e, 'pricePaidCents', 'pricePaid')) || '—' },
          { k: 'Method', v: e.paymentMethod ? esc(e.paymentMethod) : '—' },
          { k: 'Reference', v: e.paymentRef ? esc(e.paymentRef) : '—' },
          { k: 'Pass used', v: e.passId ? esc(e.passId) : '—' }
        ]);

        // Notes — operator notes on the enrollment.
        var notesBody = e.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(e.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';

        var panes =
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Student', student) + UI.card('Class & session', classCard) + UI.card('Lifecycle', lifecycle + manage) + '</div>';
        if (hasMoney) panes += '<div class="mu-pane" data-pane="payment" hidden>' + UI.card('Payment', paymentBody) + '</div>';
        panes += '<div class="mu-pane" data-pane="notes" hidden>' + UI.card('Notes', notesBody) + '</div>';

        return tiles + tabsBar + panes;
      }
    }
    // No onSave → no Edit button (status actions + cancellation stay on legacy #enrollments).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, classMap: {}, sessionMap: {}, sortKey: 'enrolledAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function toMap(snap) {
    var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
    return val || {};
  }

  function load() {
    // Class + session maps (for name joins) load alongside the enrollments — all
    // cheap one-shot reads, mirroring book.js loadEnrollments + allClassesMap/
    // allSessionsMap. Detail.render is synchronous, so these must be ready first.
    Promise.all([
      Promise.resolve(MastDB.enrollments.list(500)),
      Promise.resolve(MastDB.classes.list(200)).catch(function () { return {}; }),
      Promise.resolve(MastDB.classSessions.list(1000)).catch(function () { return {}; })
    ]).then(function (res) {
      V2.classMap = toMap(res[1]);
      V2.sessionMap = toMap(res[2]);
      var val = toMap(res[0]);
      var out = [];
      Object.keys(val).forEach(function (k) {
        var e = val[k];
        if (e && typeof e === 'object') { e = Object.assign({ _key: k }, e); out.push(e); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (err) { console.error('[enrollments-v2] load', err); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (e) { return (e.status || '') === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (e) {
        return String(studentName(e)).toLowerCase().indexOf(q) >= 0 ||
               String(studentEmail(e)).toLowerCase().indexOf(q) >= 0 ||
               String(className(e)).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('enrollments-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('enrollmentsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'enrollmentsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['confirmed', 'Confirmed'], ['waitlisted', 'Waitlisted'], ['completed', 'Completed'], ['no-show', 'No-show'], ['cancelled', 'Cancelled']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="EnrollmentsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Enrollments',
        count: N.count(V2.rows.length) + ' enrollment' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="EnrollmentsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search student, email or class…" value="' + esc(V2.q) +
        '" oninput="EnrollmentsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('enrollments-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'EnrollmentsV2.sort', onRowClickFnName: 'EnrollmentsV2.open',
        empty: { title: 'No enrollments', message: V2.loaded ? 'Enrollments appear here when students book classes. Manage them in the classic Enrollments view.' : 'Loading…' }
      });
  }

  window.EnrollmentsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'paid' || key === 'enrolledAt' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('enrollments-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('enrollments-v2', rec, 'read');
      });
    },
    // Status actions + cancellation → classic Enrollments view. Use
    // navigateToClassic so the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('enrollments');
      else if (typeof navigateTo === 'function') navigateTo('enrollments');
    },
    exportCsv: function () { return MastEntity.exportRows('enrollments-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('enrollments-v2', {
    routes: { 'enrollments-v2': { tab: 'enrollmentsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
