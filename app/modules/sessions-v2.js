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
  function can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }

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
    // Cold drills (calendar entries, classes-v2 session rows, enrollment SOs)
    // reach this fetch before the module's route setup has run — gate on a
    // run-once ensureLoaded() so the class-name map + rows exist (playbook
    // gotcha: a bare-doc fallback renders the SO without sibling state).
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return ensureLoaded().then(function () { return V2.byId[id] || null; });
    },
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
        // Drill to the parent class record (stacked SO with Back) — same panel,
        // no route nav (MastEntity.drill; classes-v2 fetch is cold-drill safe).
        var viewClass = s.classId
          ? '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="MastEntity.drill(\'classes-v2\',\'' + esc(s.classId) + '\')">View full class →</button></div>'
          : '';
        // Run-session runtime — native, delegated to window.SessionsBridge
        // (state-free cores in book.js; V1-removal directive: the legacy
        // session-ops view's whole flow lives here now). Cancelled/completed
        // occurrences are history: no ops.
        var ops = '';
        var sid = esc(s._key || s.id);
        var isStarted = !!s.classStartedAt;
        if (statusOf(s) === 'scheduled' && can('calendar', 'edit')) {
          var phase = isStarted ? 'In progress' : 'Check-in';
          ops = '<div class="mu-sub" style="margin-top:10px;">Run this session — ' + phase + '</div>' +
            '<div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary btn-small" onclick="SessionsV2.checkInAll(\'' + sid + '\')">Check in all</button>' +
            (!isStarted ? '<button class="btn btn-primary btn-small" onclick="SessionsV2.startClass(\'' + sid + '\')">▶ Start class</button>' : '') +
            '<button class="btn btn-secondary btn-small" onclick="SessionsV2.closeOutAll(\'' + sid + '\')">Close out all</button>' +
            '<button class="btn btn-secondary btn-small" onclick="SessionsV2.walkIn(\'' + esc(s.classId || '') + '\',\'' + sid + '\')">+ Walk-in</button>' +
            '<button class="btn btn-danger btn-small" onclick="SessionsV2.cancelSession(\'' + sid + '\')">Cancel session</button></div>' +
            '<div style="margin-top:10px;">' +
              '<textarea class="form-input" id="sessV2Notes" rows="2" style="width:100%;resize:vertical;" placeholder="Session notes (kept on the close-out)…">' + esc(s.sessionNotes || '') + '</textarea>' +
              '<button class="btn btn-primary btn-small" style="margin-top:6px;" onclick="SessionsV2.closeSession(\'' + sid + '\')">✓ Complete session</button>' +
            '</div>';
        }
        // Roster — async fill (placeholder + post-render fetch of this
        // session's enrollments; CampaignsBridge.renderChipInto pattern).
        var roster = '<div id="sessV2Roster"><span class="mu-sub">Loading roster…</span></div>';
        setTimeout(function () { window.SessionsV2 && SessionsV2._fillRoster(s._key || s.id); }, 0);

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Session', overview + viewClass + ops) +
          UI.card('Roster', roster) + '</div>';
      },
      // ── Native per-session EDIT (reschedule + reassign) ────────────────
      // Reschedule = date / start-end time / capacity / location; reassign =
      // instructor / resource / additionalStaff (co-teachers / assistants —
      // the ONLY surface where additionalStaff is editable). Create mode adds a
      // class picker (ad-hoc one-off outside the class schedule). Persisted via
      // SessionsBridge (reschedule / reassign / createSession) → the legacy
      // saveSessionAssignment + materializer write shapes, single-sourced; the
      // conflict check is the legacy checkConflicts (warn, not block).
      editRender: function (s, mode) {
        s = s || {};
        var isCreate = mode === 'create';
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        function row3(a, b, c) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + c + '</div>'; }
        // Class picker (create only) — pre-fills duration/capacity defaults on save.
        var classPicker = '';
        if (isCreate) {
          var clsKeys = Object.keys(V2.classMeta).sort(function (a, b) { return String(V2.classes[a] || '').localeCompare(String(V2.classes[b] || '')); });
          var clsOpts = '<option value="">— Pick a class —</option>' + clsKeys.map(function (k) {
            return '<option value="' + esc(k) + '"' + (s.classId === k ? ' selected' : '') + '>' + esc(V2.classes[k] || k) + '</option>';
          }).join('');
          classPicker = fg('Class *', '<select class="form-input" id="sessV2EClass" style="width:100%;">' + clsOpts + '</select>');
        }
        // Instructor picker — qualified vs missing-skills grouping when the class
        // has requiredSkills (a guide, never a block; mirrors assignToSession).
        var cls = (s.classId && V2.classMeta[s.classId]) || null;
        var reqSkills = (cls && Array.isArray(cls.requiredSkills)) ? cls.requiredSkills : [];
        var instrList = Object.keys(V2.instructors).map(function (k) {
          return Object.assign({ id: k }, V2.instructors[k]);
        }).filter(function (i) { return i.status === 'active'; });
        function instrOpt(i) {
          return '<option value="' + esc(i.id) + '"' + (s.instructorId === i.id ? ' selected' : '') + '>' + esc(i.name || i.id) + '</option>';
        }
        var instrOpts;
        if (!reqSkills.length || isCreate) {
          instrOpts = '<option value="">— No instructor —</option>' + instrList.map(instrOpt).join('');
        } else {
          var qual = [], unqual = [];
          instrList.forEach(function (i) {
            var have = {}; (Array.isArray(i.skills) ? i.skills : []).forEach(function (sl) { have[sl] = true; });
            var missing = reqSkills.filter(function (sl) { return !have[sl]; });
            (missing.length ? unqual : qual).push(i);
          });
          instrOpts = '<option value="">— No instructor —</option>';
          if (qual.length) instrOpts += '<optgroup label="Qualified (' + qual.length + ')">' + qual.map(instrOpt).join('') + '</optgroup>';
          if (unqual.length) instrOpts += '<optgroup label="Missing required skills (' + unqual.length + ')">' + unqual.map(instrOpt).join('') + '</optgroup>';
        }
        var resList = Object.keys(V2.resources).map(function (k) { return Object.assign({ id: k }, V2.resources[k]); })
          .filter(function (r) { return r.status === 'active'; });
        var resOpts = '<option value="">— No room/equipment —</option>' + resList.map(function (r) {
          return '<option value="' + esc(r.id) + '"' + (s.resourceId === r.id ? ' selected' : '') + '>' + esc(r.name || r.id) + (r.type ? ' (' + esc(r.type) + ')' : '') + '</option>';
        }).join('');

        // Seed the additional-staff editor scratch state (cloned so cancel can't
        // mutate the on-disk record). Rendered into #sessV2StaffList post-DOM.
        SessionsV2._staffState = Array.isArray(s.additionalStaff) ? MastUtil.clone(s.additionalStaff) : [];
        setTimeout(function () { SessionsV2._renderStaff(); }, 0);

        var cap = capacityOf(s);
        return '<div class="mu-editbar"><span class="mu-editpill">' + (isCreate ? 'NEW' : 'EDITING') + '</span>' + (isCreate ? 'New ad-hoc session' : 'Reschedule &amp; reassign this session') + '</div>' +
          classPicker +
          '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">WHEN</span>Date, time &amp; capacity</div>' +
          row3(
            fg('Date *', '<input class="form-input" type="date" id="sessV2EDate" value="' + esc(dateStr(s)) + '" style="width:100%;">', true),
            fg('Start time *', '<input class="form-input" type="time" id="sessV2EStart" value="' + esc(s.startTime || '') + '" style="width:100%;">', true),
            fg('End time', '<input class="form-input" type="time" id="sessV2EEnd" value="' + esc(s.endTime || '') + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Capacity', '<input class="form-input" type="number" min="0" id="sessV2ECapacity" value="' + (cap != null ? esc(cap) : '') + '" style="width:100%;" placeholder="Class default">', true),
            fg('Location', '<input class="form-input" id="sessV2ELocation" value="' + esc(s.location || '') + '" style="width:100%;" placeholder="e.g. Studio B (overrides room)">', true)
          ) +
          '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">WHO</span>Instructor, room &amp; co-teachers</div>' +
          row2(
            fg('Instructor', '<select class="form-input" id="sessV2EInstr" style="width:100%;">' + instrOpts + '</select>', true),
            fg('Room / equipment', '<select class="form-input" id="sessV2ERes" style="width:100%;">' + resOpts + '</select>', true)
          ) +
          '<div class="form-group"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
            '<label class="form-label" style="margin:0;">Additional staff</label>' +
            '<button type="button" class="btn btn-secondary btn-small" onclick="SessionsV2._addStaff()">+ Add staff</button></div>' +
            '<div id="sessV2StaffList"></div>' +
            '<div class="mu-sub" style="margin-top:4px;">Co-teachers, assistants, shadows &amp; observers. Only the primary instructor is checked against required skills.</div>' +
          '</div>' +
          '<div class="mu-sub" style="margin-top:10px;">Schedule conflicts (instructor or room double-booked) are flagged on save, but won’t block it.</div>';
      }
    },
    // Top-level onSave (engine reads s.onSave) → the Edit button appears in read
    // mode and the in-place editor saves through SessionsV2._save (reschedule +
    // reassign, or ad-hoc create) → SessionsBridge → legacy write shapes.
    onSave: function (rec, mode) {
      return SessionsV2._save(rec, mode);
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  // classMeta[id] = the full class record (for the create picker + per-class
  // duration default); classes[id] = the resolved NAME (kept for cheap list
  // display). instructors / resources feed the reschedule/reassign/create form
  // pickers — loaded once here so the editor never reads legacy DOM.
  var V2 = { rows: [], byId: {}, classes: {}, classMeta: {}, instructors: {}, resources: {}, today: todayStr(), sortKey: 'date', sortDir: 'desc', q: '', statusFilter: 'all', whenFilter: 'all', loaded: false };

  // Run-once data load shared by route setup and cold drills (fetch gate).
  var _loadPromise = null;
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (!_loadPromise) _loadPromise = loadData();
    return _loadPromise;
  }
  function load() { loadData().then(render); }
  function loadData() {
    V2.today = todayStr();
    // Ensure the legacy Book module is loaded so window.SessionsBridge (the
    // delegated session-op write path) exists — mirrors enrollments-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
    // Sessions + their parent classes load together; both one-shot keyed-object
    // reads (mirrors classes-v2 load / calendar-v2 load). public/classes resolves
    // the class NAME; public/classSessions is the occurrence list.
    return Promise.all([
      Promise.resolve(MastDB.get('public/classSessions')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/classes')).catch(function () { return null; }),
      // Instructor / resource pickers for the reschedule/reassign/create form.
      Promise.resolve(MastDB.instructors.list(100)).catch(function () { return {}; }),
      Promise.resolve(MastDB.resources.list(100)).catch(function () { return {}; })
    ]).then(function (res) {
      var sv = res[0] || {}, cv = res[1] || {};
      function toMap(x) { return (x && typeof x.val === 'function') ? (x.val() || {}) : (x || {}); }
      V2.instructors = toMap(res[2]);
      V2.resources = toMap(res[3]);
      V2.classes = {}; V2.classMeta = {};
      Object.keys(cv).forEach(function (k) {
        var c = cv[k]; if (c && typeof c === 'object') { V2.classes[k] = c.name || c.title || c.className || k; V2.classMeta[k] = c; }
      });
      var out = [];
      Object.keys(sv).forEach(function (k) {
        var s = sv[k];
        if (s && typeof s === 'object' && s.date) { s = Object.assign({ _key: k }, s); out.push(s); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true;
    }).catch(function (e) { console.error('[sessions-v2] load', e); });
  }
  // Refresh the cache after a legacy write settles (mirrors classes-v2).
  function reloadSoon() { V2.loaded = false; _loadPromise = null; setTimeout(load, 250); }

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
    // One schedule surface, two lenses (Month · List) — the calendar grid and
    // this flat list are two views of the same occurrences (plan: classes-v2-
    // build-plan.md CONSOLIDATION; fulfillment-v2 route-pick-the-lens precedent).
    var lensPills =
      '<button class="btn btn-small btn-secondary" onclick="navigateTo(\'calendar-v2\')">Month</button> ' +
      '<button class="btn btn-small btn-primary">List</button>';
    tab.innerHTML =
      U.pageHeader({
        title: 'Schedule',
        count: N.count(V2.rows.length) + ' ' + MastFormat.plural(V2.rows.length, 'session'),
        actionsHtml:
          (can('calendar', 'edit') ? '<button class="btn btn-primary" onclick="SessionsV2.create()">+ New session</button> ' : '') +
          '<button class="btn btn-secondary" onclick="SessionsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + lensPills +
        '<span style="width:1px;background:var(--border,rgba(127,127,127,0.3));margin:0 4px;"></span>' + statusPills +
        '<span style="width:1px;background:var(--border,rgba(127,127,127,0.3));margin:0 4px;"></span>' + whenPills + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search class, instructor or location…" value="' + esc(V2.q) +
        '" oninput="SessionsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('sessions-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'SessionsV2.sort', onRowClickFnName: 'SessionsV2.open',
        empty: { title: 'No sessions', message: V2.loaded ? 'Generate sessions from a class — open it in Classes and use ⚙ Generate sessions.' : 'Loading…' }
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
    // Session ops — delegated to the state-free SessionsBridge cores in book.js.
    complete: function (id) {
      if (!can('calendar', 'edit')) { if (window.showToast) showToast('Schedule write access required.', true); return; }
      if (!window.SessionsBridge) { if (window.showToast) showToast('Schedule engine still loading — try again', true); return; }
      Promise.resolve(window.SessionsBridge.complete(id)).then(function () {
        if (window.showToast) showToast('Session marked complete.');
        var rec = V2.byId[id];
        if (rec) { rec.status = 'completed'; MastEntity.openRecord('sessions-v2', rec, 'read'); }
        render();
      }).catch(function (e) { console.error('[sessions-v2] complete', e); if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    cancelSession: function (id) {
      if (!can('calendar', 'edit')) { if (window.showToast) showToast('Schedule write access required.', true); return; }
      if (!window.SessionsBridge) { if (window.showToast) showToast('Schedule engine still loading — try again', true); return; }
      var ask = (typeof window.mastConfirm === 'function')
        ? window.mastConfirm('Cancel this session? Students will need to be notified.', { title: 'Cancel Session', danger: true })
        : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(window.SessionsBridge.cancel(id)).then(function () {
          if (window.showToast) showToast('Session cancelled.');
          var rec = V2.byId[id];
          if (rec) { rec.status = 'cancelled'; MastEntity.openRecord('sessions-v2', rec, 'read'); }
          render();
        });
      }).catch(function (e) { console.error('[sessions-v2] cancel', e); if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    // ── Run-session verbs (SessionsBridge cores; refresh SO after each) ──
    _afterRunAction: function (sessionId, msg) {
      if (window.showToast && msg) showToast(msg);
      // Fresh-read the session so phase/status reflect the write, re-render.
      Promise.resolve(MastDB.classSessions.get(sessionId)).then(function (fresh) {
        if (fresh && V2.byId[sessionId]) Object.assign(V2.byId[sessionId], fresh);
        var rec = V2.byId[sessionId];
        if (rec) MastEntity.openRecord('sessions-v2', rec, 'read');
        render();
      }).catch(function () {});
    },
    _guardRun: function () {
      if (!can('calendar', 'edit')) { if (window.showToast) showToast('Schedule write access required.', true); return false; }
      if (!window.SessionsBridge || !window.SessionsBridge.checkIn) { if (window.showToast) showToast('Schedule engine still loading — try again', true); return false; }
      return true;
    },
    checkIn: function (enrollId, sessionId) {
      if (!SessionsV2._guardRun()) return;
      Promise.resolve(window.SessionsBridge.checkIn(enrollId)).then(function () {
        SessionsV2._afterRunAction(sessionId, 'Checked in.');
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    checkInAll: function (sessionId) {
      if (!SessionsV2._guardRun()) return;
      Promise.resolve(window.SessionsBridge.checkInAll(sessionId)).then(function (n) {
        SessionsV2._afterRunAction(sessionId, MastFormat.countNoun(n, 'student') + ' checked in.');
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    startClass: function (sessionId) {
      if (!SessionsV2._guardRun()) return;
      Promise.resolve(window.SessionsBridge.start(sessionId)).then(function () {
        SessionsV2._afterRunAction(sessionId, 'Class started.');
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    closeOut: function (enrollId, sessionId, status) {
      if (!SessionsV2._guardRun()) return;
      Promise.resolve(window.SessionsBridge.closeOut(enrollId, status)).then(function (finalStatus) {
        SessionsV2._afterRunAction(sessionId, finalStatus === 'attended-pending-waiver' ? 'Closed out (pending waiver).' : 'Closed out.');
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    closeOutAll: function (sessionId) {
      if (!SessionsV2._guardRun()) return;
      Promise.resolve(window.SessionsBridge.closeOutAll(sessionId)).then(function (n) {
        SessionsV2._afterRunAction(sessionId, MastFormat.countNoun(n, 'student') + ' closed out.');
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    closeSession: function (sessionId) {
      if (!SessionsV2._guardRun()) return;
      var notes = ((document.getElementById('sessV2Notes') || {}).value || '');
      var ask = (typeof window.mastConfirm === 'function')
        ? window.mastConfirm('Complete this session? Open seats are auto-completed.', { title: 'Complete Session' })
        : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(window.SessionsBridge.close(sessionId, notes)).then(function (n) {
          SessionsV2._afterRunAction(sessionId, 'Session completed' + (n ? ' (' + n + ' auto-completed)' : '') + '.');
        });
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    walkIn: function (classId, sessionId) {
      // Walk-in = the enrollment intake, pre-aimed at this session.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('enrollments-v2'); } catch (e) {} }
      var go = function () {
        if (window.EnrollmentsV2 && EnrollmentsV2.create) { EnrollmentsV2.create({ classId: classId, sessionId: sessionId }); return true; }
        return false;
      };
      if (go()) return;
      setTimeout(function () { if (!go() && window.showToast) showToast('Enrollments engine still loading — try again', true); }, 800);
    },
    incidentForm: function (enrollId) {
      var wrap = document.getElementById('sessV2IncWrap');
      if (!wrap) return;
      wrap.style.display = '';
      var idEl = document.getElementById('sessV2IncEnroll'); if (idEl) idEl.value = enrollId;
      var d = document.getElementById('sessV2IncDesc'); if (d) { d.value = ''; d.focus(); }
    },
    saveIncident: function (sessionId) {
      if (!SessionsV2._guardRun()) return;
      var inc = {
        type: ((document.getElementById('sessV2IncType') || {}).value || 'other'),
        severity: ((document.getElementById('sessV2IncSeverity') || {}).value || 'low'),
        description: ((document.getElementById('sessV2IncDesc') || {}).value || '')
      };
      var enrollId = ((document.getElementById('sessV2IncEnroll') || {}).value || '');
      if (!inc.description.trim()) { if (window.showToast) showToast('Description required.', true); return; }
      Promise.resolve(window.SessionsBridge.addIncident(enrollId, inc)).then(function () {
        if (window.showToast) showToast('Incident saved.');
        var wrap = document.getElementById('sessV2IncWrap'); if (wrap) wrap.style.display = 'none';
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); });
    },
    // Async roster fill for the session SO (placeholder div + post-render fetch).
    // Click a row → drill to the enrollment record (stacked SO with Back).
    _fillRoster: function (sessionId) {
      var el = document.getElementById('sessV2Roster');
      if (!el) return;
      Promise.resolve(MastDB.enrollments.bySession(sessionId)).then(function (snap) {
        var data = (snap && typeof snap.val === 'function') ? (snap.val() || {}) : (snap || {});
        var rows = Object.keys(data).map(function (k) { return Object.assign({ _key: k }, data[k]); });
        var el2 = document.getElementById('sessV2Roster');
        if (!el2) return;
        if (!rows.length) { el2.innerHTML = '<span class="mu-sub">No one is enrolled yet.</span>'; return; }
        var EN_LABEL = { confirmed: 'Confirmed', waitlisted: 'Waitlist', cancelled: 'Cancelled', 'no-show': 'No-show', completed: 'Attended', late: 'Late', 'checked-in': 'Checked in', 'attended-pending-waiver': 'Attended (waiver pending)', cancelled_by_session: 'Session cancelled' };
        var EN_TONE = { confirmed: 'success', waitlisted: 'amber', cancelled: 'neutral', 'no-show': 'danger', completed: 'teal', late: 'warning', 'checked-in': 'teal', 'attended-pending-waiver': 'amber', cancelled_by_session: 'neutral' };
        var sess = V2.byId[sessionId] || {};
        var runnable = String(sess.status || 'scheduled').toLowerCase() === 'scheduled' && can('calendar', 'edit');
        el2.innerHTML = U.relatedTable([
          { label: 'Student', render: function (e) {
              var nm = e.studentName || e.customerName || '(unnamed)';
              return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'enrollments-v2\',\'' + esc(e._key) + '\')">' + esc(nm) + '</button>';
          } },
          { label: 'Paid', align: 'right', render: function (e) { return N.money(N.moneyVal(e, 'pricePaidCents', 'pricePaid')) || '—'; } },
          { label: 'Status', render: function (e) {
              var st = e.status || '—';
              return U.badge(EN_LABEL[st] || st, EN_TONE[st] || 'neutral');
          } },
          { label: '', render: function (e) {
              if (!runnable) return '';
              var eid = esc(e._key), btns = [];
              if (e.status === 'confirmed') btns.push('<button class="btn btn-secondary btn-small" onclick="SessionsV2.checkIn(\'' + eid + '\',\'' + esc(sessionId) + '\')">Check in</button>');
              if (e.status === 'checked-in' || e.status === 'confirmed' || e.status === 'late') {
                btns.push('<button class="btn btn-secondary btn-small" onclick="SessionsV2.closeOut(\'' + eid + '\',\'' + esc(sessionId) + '\',\'completed\')">Attended</button>');
                btns.push('<button class="btn btn-secondary btn-small" onclick="SessionsV2.closeOut(\'' + eid + '\',\'' + esc(sessionId) + '\',\'no-show\')">No-show</button>');
              }
              btns.push('<button type="button" class="btn-icon" title="Record incident" onclick="SessionsV2.incidentForm(\'' + eid + '\')">⚠</button>');
              return '<div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:flex-end;">' + btns.join('') + '</div>';
          } }
        ], rows) +
        // Incident mini-form (hidden; one per roster card — legacy parity).
        '<div id="sessV2IncWrap" style="display:none;margin-top:10px;border:1px solid var(--border,rgba(127,127,127,0.3));border-radius:8px;padding:10px;">' +
          '<input type="hidden" id="sessV2IncEnroll">' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:6px;">' +
            '<select class="form-input" id="sessV2IncType" style="flex:1;min-width:120px;"><option value="injury">Injury</option><option value="equipment">Equipment</option><option value="behavior">Behavior</option><option value="other" selected>Other</option></select>' +
            '<select class="form-input" id="sessV2IncSeverity" style="flex:1;min-width:120px;"><option value="low" selected>Low</option><option value="medium">Medium</option><option value="high">High</option></select>' +
          '</div>' +
          '<textarea class="form-input" id="sessV2IncDesc" rows="2" style="width:100%;resize:vertical;" placeholder="What happened?"></textarea>' +
          '<div style="margin-top:6px;display:flex;gap:8px;">' +
            '<button class="btn btn-primary btn-small" onclick="SessionsV2.saveIncident(\'' + esc(sessionId) + '\')">Save incident</button>' +
            '<button class="btn btn-secondary btn-small" onclick="document.getElementById(\'sessV2IncWrap\').style.display=\'none\'">Cancel</button>' +
          '</div></div>';
      }).catch(function (e) {
        console.error('[sessions-v2] roster', e);
        var el3 = document.getElementById('sessV2Roster');
        if (el3) el3.innerHTML = '<span class="mu-sub">Could not load the roster.</span>';
      });
    },
    // ── Per-session reschedule / reassign + ad-hoc create ───────────────
    // Open a blank create form (ad-hoc one-off session). Class is picked in the
    // form. Mirrors classes-v2.create → MastEntity.openRecord(...,'create').
    create: function (seed) {
      if (!can('calendar', 'edit')) { if (window.showToast) showToast('Schedule write access required.', true); return; }
      ensureLoaded().then(function () { MastEntity.openRecord('sessions-v2', seed || {}, 'create'); });
    },
    // additionalStaff editor — scratch state + in-place rows (mirrors the legacy
    // _assignStaff* editor; the ONLY surface where additionalStaff is editable).
    _staffState: [],
    _STAFF_ROLES: ['shadow', 'assist', 'co-teach', 'observer'],
    _renderStaff: function () {
      var list = document.getElementById('sessV2StaffList');
      if (!list) return;
      var st = SessionsV2._staffState || [];
      if (!st.length) { list.innerHTML = '<div class="mu-sub" style="padding:4px 0;">No additional staff.</div>'; return; }
      var instrs = Object.keys(V2.instructors).map(function (k) { return Object.assign({ id: k }, V2.instructors[k]); })
        .filter(function (i) { return i.status === 'active'; });
      list.innerHTML = st.map(function (entry, idx) {
        var instrOpts = '<option value="">— Freeform name —</option>' + instrs.map(function (i) {
          return '<option value="' + esc(i.id) + '"' + (entry.instructorId === i.id ? ' selected' : '') + '>' + esc(i.name || i.id) + '</option>';
        }).join('');
        var roleOpts = SessionsV2._STAFF_ROLES.map(function (r) {
          return '<option value="' + r + '"' + (entry.role === r ? ' selected' : '') + '>' + r + '</option>';
        }).join('');
        return '<div style="margin-bottom:10px;">' +
          '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap;">' +
            '<select class="form-input" style="flex:1;min-width:120px;" onchange="SessionsV2._staffField(' + idx + ',\'instructorId\',this.value)">' + instrOpts + '</select>' +
            '<select class="form-input" style="flex:0 0 130px;" onchange="SessionsV2._staffField(' + idx + ',\'role\',this.value)">' + roleOpts + '</select>' +
            '<button type="button" class="btn btn-secondary btn-small" onclick="SessionsV2._removeStaff(' + idx + ')">Remove</button>' +
          '</div>' +
          (entry.instructorId ? '' :
            '<input type="text" class="form-input" style="margin-bottom:6px;" placeholder="Name (for staff not in the instructor list)" value="' + esc(entry.freeformName || '') + '" oninput="SessionsV2._staffField(' + idx + ',\'freeformName\',this.value)">') +
          '<input type="text" class="form-input" placeholder="Notes (optional)" value="' + esc(entry.notes || '') + '" oninput="SessionsV2._staffField(' + idx + ',\'notes\',this.value)">' +
          '</div>';
      }).join('');
    },
    _addStaff: function () { SessionsV2._staffState.push({ instructorId: null, freeformName: '', role: 'assist', notes: '' }); SessionsV2._renderStaff(); },
    _removeStaff: function (idx) { SessionsV2._staffState.splice(idx, 1); SessionsV2._renderStaff(); },
    _staffField: function (idx, field, value) {
      var e = SessionsV2._staffState[idx]; if (!e) return;
      if (field === 'instructorId') {
        e.instructorId = value || null;
        if (value) e.freeformName = '';
        SessionsV2._renderStaff(); // toggles the freeform input → full re-render
      } else { e[field] = value; }
    },
    // Persist a reschedule + reassign (edit) or an ad-hoc session (create) via
    // SessionsBridge → legacy write shapes. Conflicts are WARNED (toast), never
    // blocking — matching legacy saveSessionAssignment. Returns a Promise<bool>.
    _save: function (rec, mode) {
      if (!can('calendar', 'edit')) { if (window.showToast) showToast('Schedule write access required.', true); return false; }
      if (!window.SessionsBridge || !window.SessionsBridge.reschedule) { if (window.showToast) showToast('Schedule engine still loading — try again', true); return false; }
      function v(id) { return ((document.getElementById(id) || {}).value || ''); }
      var date = v('sessV2EDate'), startTime = v('sessV2EStart');
      if (!date || !startTime) { if (window.showToast) showToast('Date and start time are required.', true); return false; }
      // Read the additional-staff scratch state directly (kept in sync by the
      // onchange/oninput handlers).
      var staff = (SessionsV2._staffState || []).slice();
      var when = { date: date, startTime: startTime, endTime: v('sessV2EEnd') || null,
                   capacity: v('sessV2ECapacity'), location: v('sessV2ELocation') };
      var instrId = v('sessV2EInstr') || null, resId = v('sessV2ERes') || null;

      function warnConflicts(res) {
        var c = res && res.conflicts;
        if (Array.isArray(c) && c.length && window.showToast) {
          showToast('Saved — conflict: ' + c[0] + (c.length > 1 ? ' (+' + (c.length - 1) + ' more)' : ''), true);
        }
        return res;
      }

      if (mode === 'create') {
        var classId = v('sessV2EClass');
        if (!classId) { if (window.showToast) showToast('Pick a class for the session.', true); return false; }
        return Promise.resolve(window.SessionsBridge.createSession(classId, {
          date: when.date, startTime: when.startTime, endTime: when.endTime,
          capacity: when.capacity, location: when.location, instructorId: instrId, resourceId: resId,
          additionalStaff: staff
        })).then(function (res) {
          // createSession doesn't write additionalStaff in its core (the
          // materializer shape has none); if any was added, reassign to persist it.
          var id = res && res.id;
          var after = (id && staff.length)
            ? Promise.resolve(window.SessionsBridge.reassign(id, { instructorId: instrId, resourceId: resId, additionalStaff: staff }))
            : Promise.resolve(null);
          return after.then(function () { warnConflicts(res); if (window.showToast) showToast('Session created.'); reloadSoon(); return true; });
        }).catch(function (e) { console.error('[sessions-v2] create', e); if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); return false; });
      }

      var sid = rec._key || rec.id;
      // reschedule (date/time/capacity/location) then reassign (instructor/
      // resource/additionalStaff). Two PATCH writes, both single-sourced.
      return Promise.resolve(window.SessionsBridge.reschedule(sid, when))
        .then(function (r1) {
          return Promise.resolve(window.SessionsBridge.reassign(sid, { instructorId: instrId, resourceId: resId, additionalStaff: staff }))
            .then(function (r2) {
              // Surface the union of conflicts from both writes (dedup the first).
              var all = [].concat((r1 && r1.conflicts) || [], (r2 && r2.conflicts) || []);
              warnConflicts({ conflicts: all });
              // Mutate the live cached record so the post-save read re-render shows
              // the edit at once; reloadSoon refreshes for the next open.
              var live = V2.byId[sid] || rec;
              live.date = when.date; live.startTime = when.startTime;
              if (when.endTime) live.endTime = when.endTime;
              if (when.capacity !== '' && !isNaN(parseInt(when.capacity, 10))) live.capacity = parseInt(when.capacity, 10);
              live.location = (when.location || '').trim() || null;
              live.instructorId = instrId;
              live.instructorName = instrId && V2.instructors[instrId] ? (V2.instructors[instrId].name || null) : null;
              live.resourceId = resId;
              live.resourceName = resId && V2.resources[resId] ? (V2.resources[resId].name || null) : null;
              live.additionalStaff = (staff || []).map(function (x) {
                return { instructorId: x.instructorId || null, freeformName: x.instructorId ? null : (x.freeformName || '').trim() || null,
                         role: SessionsV2._STAFF_ROLES.indexOf(x.role) !== -1 ? x.role : 'assist', notes: (x.notes || '').trim() || null };
              }).filter(function (x) { return x.instructorId || x.freeformName; });
              if (window.showToast) showToast('Session updated.');
              reloadSoon();
              return true;
            });
        }).catch(function (e) { console.error('[sessions-v2] save', e); if (window.showToast) showToast('Error: ' + (e && e.message || 'failed.'), true); return false; });
    },
    exportCsv: function () { return MastEntity.exportRows('sessions-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('sessions-v2', {
    routes: { 'sessions-v2': { tab: 'sessionsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
