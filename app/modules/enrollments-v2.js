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

  function can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }

  // Status label/tone maps cover BOTH writer vocabularies in public/enrollments:
  // book.js ENROLLMENT_STATUSES (confirmed/waitlisted/cancelled/no-show/
  // completed/late) AND the storefront-CF statuses live data carries
  // (checked-in, attended-pending-waiver, cancelled_by_session) — the
  // CS-round lesson: characterize per WRITER, resolve both (playbook §0c-5).
  // Plain-language labels are display-only; stored vocab is untouched.
  var STATUS_LABEL = {
    confirmed: 'Confirmed', waitlisted: 'Waitlist', cancelled: 'Cancelled',
    'no-show': 'No-show', completed: 'Attended', late: 'Late',
    'checked-in': 'Checked in', 'attended-pending-waiver': 'Attended (waiver pending)',
    cancelled_by_session: 'Session cancelled'
  };
  var STATUS_TONE = {
    confirmed: 'success', waitlisted: 'amber', cancelled: 'neutral',
    'no-show': 'danger', completed: 'teal', late: 'warning',
    'checked-in': 'teal', 'attended-pending-waiver': 'amber',
    cancelled_by_session: 'neutral'
  };
  // A seat that can still be acted on (the roster verbs). Completed/attended
  // and cancelled records are immutable history — no actions, no edit.
  function isActionable(st) {
    return st === 'confirmed' || st === 'checked-in' || st === 'late' || st === 'waitlisted' || st === 'attended-pending-waiver';
  }

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
        options: ['confirmed', 'waitlisted', 'checked-in', 'completed', 'late', 'no-show', 'attended-pending-waiver', 'cancelled', 'cancelled_by_session'],
        get: function (e) { return e.status || '—'; },
        format: function (v) { return STATUS_LABEL[v] || v; },
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    // Cold drills (session roster rows) reach this fetch before route setup —
    // gate on a run-once ensureLoaded() so the class/session name joins exist.
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return ensureLoaded().then(function () { return V2.byId[id] || null; });
    },
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
        // Cross-drills: student profile / customer record / class / session —
        // stacked SO with Back (all four fetches are cold-drill safe).
        function dlink(entity, id, text) {
          return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'' + entity + '\',\'' + esc(String(id)) + '\')">' + esc(text) + '</button>';
        }
        var student = UI.kv([
          { k: 'Name', v: e.studentId ? dlink('students-v2', e.studentId, studentName(e)) : esc(studentName(e)) },
          { k: 'Email', v: studentEmail(e) ? esc(studentEmail(e)) : '—' },
          { k: 'Phone', v: (e.studentPhone || e.phone) ? esc(e.studentPhone || e.phone) : '—' },
          { k: 'Customer', v: e.customerId ? dlink('customers-v2', e.customerId, 'View customer record →') : '—' }
        ]);
        var classCard = UI.kv([
          { k: 'Class', v: e.classId ? dlink('classes-v2', e.classId, className(e)) : esc(className(e)) },
          { k: 'Session', v: e.sessionId ? dlink('sessions-v2', e.sessionId, sessionLabel(e)) : '—' },
          { k: 'Capacity', v: (sess && sess.capacity) ? N.count(sess.capacity) : '—' },
          { k: 'Status', v: UI.badge(statusDisplay(e), STATUS_TONE[e.status] || 'neutral') }
        ]);
        var lifecycle = UI.kv([
          { k: 'Enrolled', v: e.enrolledAt ? N.date(e.enrolledAt) : (e.createdAt ? N.date(e.createdAt) : '—') },
          { k: 'Attended', v: e.attendedAt ? N.date(e.attendedAt) : '—' },
          { k: 'Cancelled', v: e.cancelledAt ? N.date(e.cancelledAt) : '—' },
          { k: 'Waitlist position', v: e.waitlistPosition ? ('#' + e.waitlistPosition) : '—' }
        ]);
        // Roster actions — native here, delegated to window.EnrollmentsBridge
        // (state-free cores in book.js; seat-count/waitlist side effects stay
        // single-sourced). Immutable history (attended/cancelled) gets none.
        var manage = '';
        var st = e.status;
        if (isActionable(st) && can('enrollments', 'edit')) {
          var id = esc(e._key || e.id);
          var btns = [];
          if (st === 'waitlisted') {
            btns.push('<button class="btn btn-primary btn-small" onclick="EnrollmentsV2.act(\'' + id + '\',\'promote\')">▲ Promote to confirmed</button>');
          } else {
            btns.push('<button class="btn btn-secondary btn-small" onclick="EnrollmentsV2.act(\'' + id + '\',\'completed\')">✓ Mark attended</button>');
            if (st !== 'late') btns.push('<button class="btn btn-secondary btn-small" onclick="EnrollmentsV2.act(\'' + id + '\',\'late\')">Mark late</button>');
            btns.push('<button class="btn btn-secondary btn-small" onclick="EnrollmentsV2.act(\'' + id + '\',\'no-show\')">Mark no-show</button>');
          }
          btns.push('<button class="btn btn-danger btn-small" onclick="EnrollmentsV2.act(\'' + id + '\',\'cancel\')">Cancel enrollment</button>');
          manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' + btns.join('') + '</div>';
        }

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
    // No onSave → no Edit button on the read SO. The roster verbs above are the
    // only writes; CREATE goes through the separate intake entity below
    // (commission-intake-v2 pattern: onSave on THIS entity would surface a
    // misleading Edit button on immutable history records).
  });

  // ── operator intake (create-only entity) ────────────────────────────
  // Phone/walk-in sign-up: class → session → student, delegated to
  // window.EnrollmentsBridge.create (capacity-aware: a full session lands the
  // seat on the waitlist with the next position).
  MastEntity.define('enrollment-intake-v2', {
    label: 'Enrollment', labelPlural: 'Enrollments', size: 'md',
    recordId: function (e) { return e._key || e.id; },
    fields: [
      { name: 'student', label: 'Student', type: 'text', readOnly: true, get: function (e) { return (e && e.studentName) || 'New enrollment'; } }
    ],
    fetch: function () { return Promise.resolve(null); },
    detail: {
      render: function () { return ''; },
      editRender: function () {
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var classOpts = '<option value="">Select a class…</option>' + Object.keys(V2.classMap).map(function (k) {
          var c = V2.classMap[k];
          return '<option value="' + esc(k) + '">' + esc((c && c.name) || k) + '</option>';
        }).join('');
        var studentOpts = '<option value="">— Type a name below —</option>' + Object.keys(V2.studentMap).map(function (k) {
          var s = V2.studentMap[k];
          return '<option value="' + esc(k) + '" data-name="' + esc(s.displayName || '') + '" data-email="' + esc(s.email || '') + '">' + esc(s.displayName || k) + '</option>';
        }).join('');
        return '<div class="mu-editbar"><span class="mu-editpill">NEW</span>New enrollment</div>' +
          fg('Class *', '<select class="form-input" id="enV2Class" style="width:100%;" onchange="EnrollmentsV2._intakeClassChanged(this.value)">' + classOpts + '</select>') +
          fg('Session *', '<select class="form-input" id="enV2Session" style="width:100%;"><option value="">Select a class first…</option></select>') +
          fg('Student', '<select class="form-input" id="enV2Student" style="width:100%;" onchange="EnrollmentsV2._intakeStudentChanged(this)">' + studentOpts + '</select>') +
          fg('Name *', '<input class="form-input" id="enV2Name" name="enV2Name" style="width:100%;" placeholder="e.g. Elena Vasquez">') +
          fg('Email', '<input class="form-input" id="enV2Email" type="email" style="width:100%;" placeholder="student@example.com">') +
          fg('Price paid ($)', '<input class="form-input" id="enV2Price" type="number" min="0" step="0.01" style="width:100%;" placeholder="0.00">') +
          fg('Notes', '<textarea class="form-input" id="enV2Notes" rows="2" style="width:100%;resize:vertical;"></textarea>') +
          '<div class="mu-sub" style="margin-top:8px;">If the session is full, the student is added to the waitlist automatically.</div>';
      }
    },
    onSave: function (rec, mode) {
      if (mode !== 'create') return false;
      if (!can('enrollments', 'edit')) { if (window.showToast) showToast('Enrollment write access required.', true); return false; }
      if (!window.EnrollmentsBridge) { if (window.showToast) showToast('Enrollments engine still loading — try again', true); return false; }
      function v(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
      var priceRaw = v('enV2Price');
      var data = {
        classId: v('enV2Class'), sessionId: v('enV2Session'),
        studentId: v('enV2Student') || null,
        name: v('enV2Name'), email: v('enV2Email'),
        pricePaidCents: priceRaw === '' ? 0 : MastFormat.parseCents(priceRaw),
        notes: v('enV2Notes')
      };
      if (!data.classId) { if (window.showToast) showToast('Class is required.', true); return false; }
      if (!data.sessionId) { if (window.showToast) showToast('Session is required.', true); return false; }
      if (!data.name) { if (window.showToast) showToast('Student name is required.', true); return false; }
      return Promise.resolve(window.EnrollmentsBridge.create(data)).then(function (res) {
        if (window.showToast) showToast(res && res.status === 'waitlisted' ? 'Session full — added to the waitlist.' : 'Enrollment created.');
        load();
        return true;
      }).catch(function (e) {
        console.error('[enrollments-v2] create', e);
        if (window.showToast) showToast('Error: ' + (e && e.message || 'could not create enrollment.'), true);
        return false;
      });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, classMap: {}, sessionMap: {}, studentMap: {}, sortKey: 'enrolledAt', sortDir: 'desc', q: '', statusFilter: 'all', loaded: false };

  function toMap(snap) {
    var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
    return val || {};
  }

  // Run-once data load shared by route setup and cold drills (fetch gate).
  var _loadPromise = null;
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (!_loadPromise) _loadPromise = loadData();
    return _loadPromise;
  }
  function load() { _loadPromise = null; loadData().then(render); }
  function loadData() {
    // Class + session maps (for name joins) load alongside the enrollments — all
    // cheap one-shot reads, mirroring book.js loadEnrollments + allClassesMap/
    // allSessionsMap. Detail.render is synchronous, so these must be ready first.
    // Ensure the legacy Book module is loaded so window.EnrollmentsBridge (the
    // delegated write path) exists — mirrors classes-v2 / contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
    return Promise.all([
      Promise.resolve(MastDB.enrollments.list(500)),
      Promise.resolve(MastDB.classes.list(200)).catch(function () { return {}; }),
      Promise.resolve(MastDB.classSessions.list(1000)).catch(function () { return {}; }),
      Promise.resolve(MastDB.get('students')).catch(function () { return {}; })
    ]).then(function (res) {
      V2.classMap = toMap(res[1]);
      V2.sessionMap = toMap(res[2]);
      V2.studentMap = toMap(res[3]);
      var val = toMap(res[0]);
      var out = [];
      Object.keys(val).forEach(function (k) {
        var e = val[k];
        if (e && typeof e === 'object') { e = Object.assign({ _key: k }, e); out.push(e); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true;
    }).catch(function (err) { console.error('[enrollments-v2] load', err); });
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
        count: N.count(V2.rows.length) + ' ' + MastFormat.plural(V2.rows.length, 'enrollment'),
        actionsHtml: (can('enrollments', 'edit') ? '<button class="btn btn-primary" onclick="EnrollmentsV2.create()">+ New enrollment</button>' : '') +
          '<button class="btn btn-secondary" onclick="EnrollmentsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search student, email or class…" value="' + esc(V2.q) +
        '" oninput="EnrollmentsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('enrollments-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'EnrollmentsV2.sort', onRowClickFnName: 'EnrollmentsV2.open',
        empty: { title: 'No enrollments', message: V2.loaded ? 'Enrollments appear here when students book classes — or add one with “+ New enrollment”.' : 'Loading…' }
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
    // Roster verbs — delegated to the state-free EnrollmentsBridge cores in
    // book.js (single-sourced side effects). 'cancel' confirms first; the
    // others are reversible status writes.
    act: function (id, action) {
      if (!can('enrollments', 'edit')) { if (window.showToast) showToast('Enrollment write access required.', true); return; }
      if (!window.EnrollmentsBridge) { if (window.showToast) showToast('Enrollments engine still loading — try again', true); return; }
      var run = function () {
        var p = (action === 'promote') ? window.EnrollmentsBridge.promote(id)
              : (action === 'cancel') ? window.EnrollmentsBridge.cancel(id)
              : window.EnrollmentsBridge.setStatus(id, action);
        return Promise.resolve(p).then(function () {
          if (window.showToast) showToast('Enrollment updated.');
          // Patch the live cached record so the re-opened SO reflects the write
          // immediately; load() then refreshes the list + joins.
          var rec = V2.byId[id];
          if (rec) {
            rec.status = (action === 'promote') ? 'confirmed' : (action === 'cancel') ? 'cancelled' : action;
            if (action === 'promote') rec.waitlistPosition = null;
            MastEntity.openRecord('enrollments-v2', rec, 'read');
          }
          load();
        }).catch(function (e) {
          console.error('[enrollments-v2] ' + action, e);
          if (window.showToast) showToast('Error: ' + (e && e.message || 'action failed.'), true);
        });
      };
      if (action === 'cancel') {
        var doCancel = (typeof window.mastConfirm === 'function')
          ? window.mastConfirm('Cancel this enrollment?', { title: 'Cancel Enrollment', danger: true })
          : Promise.resolve(true);
        Promise.resolve(doCancel).then(function (ok) { if (ok) run(); });
        return;
      }
      run();
    },
    create: function (preset) {
      // Ensure the legacy Book module (and thus window.EnrollmentsBridge) is
      // loaded before opening the intake form — mirrors ClassesV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
      var open = function () {
        MastEntity.openRecord('enrollment-intake-v2', {}, 'create');
        // Walk-in entry point (session SO): pre-select the class + session.
        if (preset && preset.classId) {
          setTimeout(function () {
            var cls = document.getElementById('enV2Class');
            if (!cls) return;
            cls.value = preset.classId;
            EnrollmentsV2._intakeClassChanged(preset.classId);
            if (preset.sessionId) {
              var sess = document.getElementById('enV2Session');
              if (sess) sess.value = preset.sessionId;
            }
          }, 0);
        }
      };
      // The picker options come from the load()-built maps; a cold call (from
      // the session SO before this module's route ever ran) loads them first.
      if (V2.loaded) open(); else ensureLoaded().then(open);
    },
    // Intake form helpers — dependent session picker + student autofill.
    _intakeClassChanged: function (classId) {
      var sel = document.getElementById('enV2Session');
      if (!sel) return;
      var today = new Date().toISOString().slice(0, 10);
      var opts = Object.keys(V2.sessionMap).map(function (k) {
        var s = V2.sessionMap[k]; return { id: k, s: s };
      }).filter(function (x) {
        return x.s && x.s.classId === classId && String(x.s.status || 'scheduled').toLowerCase() !== 'cancelled';
      }).sort(function (a, b) {
        // Upcoming first (soonest on top), then past (most recent first).
        var af = String(a.s.date || '') >= today, bf = String(b.s.date || '') >= today;
        if (af !== bf) return af ? -1 : 1;
        var cmp = String(a.s.date || '').localeCompare(String(b.s.date || ''));
        return af ? cmp : -cmp;
      });
      sel.innerHTML = opts.length
        ? '<option value="">Select a session…</option>' + opts.map(function (x) {
            var full = x.s.capacity && (x.s.enrolled || 0) >= x.s.capacity;
            return '<option value="' + esc(x.id) + '">' + esc((x.s.date ? N.date(x.s.date) : x.id) + (x.s.startTime ? ' · ' + fmtTime(x.s.startTime) : '') + (full ? ' — FULL (waitlist)' : '')) + '</option>';
          }).join('')
        : '<option value="">No sessions for this class</option>';
    },
    _intakeStudentChanged: function (sel) {
      var opt = sel && sel.options[sel.selectedIndex];
      if (!opt || !opt.value) return;
      var nameEl = document.getElementById('enV2Name'), emailEl = document.getElementById('enV2Email');
      if (nameEl) nameEl.value = opt.getAttribute('data-name') || '';
      if (emailEl) emailEl.value = opt.getAttribute('data-email') || '';
    },
    exportCsv: function () { return MastEntity.exportRows('enrollments-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('enrollments-v2', {
    routes: { 'enrollments-v2': { tab: 'enrollmentsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
