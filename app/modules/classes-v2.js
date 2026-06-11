/**
 * classes-v2.js — read-focused Faceted Record twin of the legacy Classes catalog
 * (doc 17 §11/§12; conversion playbook).
 *
 * Legacy book.js (#book, owned by the Book module) hosts the class catalog as a
 * stack/table of classes and swaps the pane in-place to a class detail
 * (renderClassDetail: Class Details / Schedule & Assignment / Description /
 * Sessions sections) with its own Edit + Generate-Sessions + Publish controls.
 * This twin re-hosts that VIEW on the Entity Engine: a schema-driven list + a
 * read-focused Faceted Record slide-out (Overview / Sessions facets).
 *
 * Variant (doc 17 §1a): a class is a catalog record (title / description / price /
 * capacity, plus generated scheduled sessions and their enrollments) with related
 * collections but no governed lifecycle — its status (draft / active / published /
 * completed / archived) is an assigned attribute → Faceted Record, NOT Process/
 * MastFlow.
 *
 * Create + edit of the class RECORD (basic fields) is NATIVE here: a custom
 * detail.editRender (name / description / type / category / status / capacity /
 * min-enrollment / cancel-lead / price / duration / materials) + an onSave that
 * DELEGATES to window.ClassesBridge (exposed in book.js) so the class write +
 * money-in-cents conversion stay single-sourced — this twin never reimplements
 * that logic (mirrors the contacts-v2 / ContactsBridge precedent). What stays
 * bespoke on legacy #book (no V2 home): the SESSION GENERATION sub-flow (the
 * schedule builder → materializeSessions), series pricing, instructor/resource
 * assignment, required-skills/certs pickers, the waiver template picker, and the
 * class-image library. Those keep a scoped "Schedule & sessions in classic view"
 * link. Flag-gated (?ui=1) at #classes-v2, side-by-side.
 *
 * Data: classes live at public/classes (MastDB.classes → that path); generated
 * sessions live at public/classSessions (MastDB.classSessions, each with a
 * classId). Both are read once together (one-shot keyed-object reads, mirroring
 * book.js / calendar-v2) so a class's scheduled sessions + enrolled counts are
 * cheap. Money is in CENTS (priceCents) → MastUI.Num.moneyVal.
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

  // Label / tone maps mirror book.js TYPE_BADGE_COLORS / STATUS_BADGE_COLORS
  // (kept local — read-only display lookups, mapped to v2 tone tokens).
  // Mirror book.js CLASS_TYPES / CLASS_STATUSES (the editable option sets).
  var CLASS_TYPES = ['series', 'single', 'dropin', 'private'];
  var CLASS_STATUSES = ['draft', 'active', 'published', 'completed', 'archived'];
  var TYPE_LABEL = { series: 'Series', single: 'Single', dropin: 'Drop-in', 'private': 'Private' };
  var STATUS_LABEL = { draft: 'Draft', active: 'Active', published: 'Published', completed: 'Completed', archived: 'Archived' };
  var STATUS_TONE = {
    draft: 'neutral', active: 'success', published: 'teal', completed: 'success', archived: 'warning'
  };
  var SESSION_TONE = { scheduled: 'teal', cancelled: 'danger', completed: 'success' };

  function className(c) { return (c && (c.name || c.title || c.className)) || '(untitled)'; }
  function classType(c) { return (c && c.type) || ''; }
  function typeLabel(c) { var t = classType(c); return TYPE_LABEL[t] || t || ''; }
  function statusOf(c) { return (c && c.status) || 'draft'; }
  function statusLabel(c) { var s = statusOf(c); return STATUS_LABEL[s] || s; }
  // priceCents → dollars; for a series, the series price is the headline (mirrors
  // book.js list "$X (series)"). moneyVal is the single money source of truth.
  function priceVal(c) {
    if (classType(c) === 'series' && c.seriesInfo) {
      var sp = N.moneyVal(c.seriesInfo, 'seriesPriceCents', null);
      if (sp != null) return sp;
    }
    return N.moneyVal(c, 'priceCents', null);
  }
  function capacityOf(c) {
    var n = parseInt(c && (c.capacity != null ? c.capacity : c.maxStudents), 10);
    return isNaN(n) ? null : n;
  }

  // Sessions for a class (cheap: one-shot public/classSessions read, grouped by
  // classId). Sorted by date+time so "next session" and the table read naturally.
  function sessionsFor(c) {
    var id = c && (c._key || c.id);
    if (!id) return [];
    return (V2.sessionsByClass[id] || []).slice().sort(function (a, b) {
      return String((a.date || '') + (a.startTime || '')).localeCompare(String((b.date || '') + (b.startTime || '')));
    });
  }
  function upcomingSessions(c) {
    var today = V2.today;
    return sessionsFor(c).filter(function (s) {
      return s.date && String(s.date).slice(0, 10) >= today && String(s.status || '').toLowerCase() !== 'cancelled';
    });
  }
  function upcomingCount(c) { return upcomingSessions(c).length; }
  // enrolled is denormalized on the session (number); fall back to an array length.
  function sessEnrolled(s) {
    if (Array.isArray(s.enrolled)) return s.enrolled.length;
    if (s.enrolledCount != null) return s.enrolledCount;
    return (typeof s.enrolled === 'number') ? s.enrolled : 0;
  }
  function sessCapacity(s, c) {
    var n = parseInt(s.capacity != null ? s.capacity : capacityOf(c), 10);
    return isNaN(n) ? null : n;
  }

  // 12h time + M/D/YYYY date, mirroring book.js formatTime/formatDate cheaply.
  function fmtTime(t) {
    if (!t) return '';
    var parts = String(t).split(':'); var h = parseInt(parts[0], 10); var m = parts[1] || '00';
    if (isNaN(h)) return esc(t);
    var ampm = h >= 12 ? 'PM' : 'AM'; if (h > 12) h -= 12; if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
  }
  function fmtTimeRange(s) {
    var a = fmtTime(s.startTime), b = fmtTime(s.endTime);
    return a ? (a + (b ? (' – ' + b) : '')) : '—';
  }
  // Schedule summary string (recurring days+time / once date+time), for Overview.
  function scheduleText(c) {
    var sc = c && c.schedule; if (!sc) return '';
    var DAY = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
    if (sc.type === 'recurring' && Array.isArray(sc.days) && sc.days.length) {
      var d = sc.days.map(function (x) { return DAY[x] || x; }).join(', ');
      return d + (sc.startTime ? ' at ' + fmtTime(sc.startTime) : '');
    }
    if (sc.type === 'once') {
      var dt = sc.date || sc.startDate;
      return (dt ? N.date(dt) : '') + (sc.startTime ? ' at ' + fmtTime(sc.startTime) : '');
    }
    return '';
  }
  function materialsText(c) {
    if (!c) return '—';
    if (c.materialsIncluded) return c.materialsNote ? esc(c.materialsNote) : 'Included';
    var fee = N.moneyVal(c, 'materialsCostCents', null);
    if (fee != null) return (N.money(fee) || '') + ' fee' + (c.materialsNote ? ' — ' + esc(c.materialsNote) : '');
    return 'Not included';
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('classes-v2', {
    label: 'Class', labelPlural: 'Classes', size: 'lg',
    route: 'classes-v2',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Class', type: 'text', list: true, readOnly: true, group: 'Class', get: className },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true, get: function (c) { return typeLabel(c) || '—'; } },
      { name: 'price', label: 'Price', type: 'money', list: true, readOnly: true, align: 'right', get: priceVal },
      { name: 'capacity', label: 'Capacity', type: 'number', list: true, readOnly: true, align: 'right', get: capacityOf },
      { name: 'upcoming', label: 'Upcoming', type: 'number', list: true, readOnly: true, sortable: false, align: 'right', get: upcomingCount },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['draft', 'active', 'published', 'completed', 'archived'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    // Cold drills (session SOs' "View full class") reach this fetch before the
    // route setup has run — gate on a run-once ensureLoaded() so the sessions
    // index exists (the Sessions facet reads V2.sessionsByClass).
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return ensureLoaded().then(function () { return V2.byId[id] || null; });
    },
    detail: {
      render: function (UI, c) {
        var sessions = sessionsFor(c);
        var upcoming = upcomingSessions(c);
        var price = priceVal(c);
        var cap = capacityOf(c);

        var tiles = UI.tiles([
          { k: 'Price', v: (N.money(price) || '—') + (classType(c) === 'series' ? ' / series' : ''), hero: true },
          { k: 'Capacity', v: cap == null ? '—' : N.count(cap) },
          { k: 'Upcoming sessions', v: N.count(upcoming.length) },
          { k: 'Status', v: UI.badge(statusLabel(c), STATUS_TONE[statusOf(c)] || 'neutral') }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'sessions', label: 'Sessions' }
        ], 'ov');

        // Overview — class + schedule/assignment + description.
        var classKv = UI.kv([
          { k: 'Type', v: esc(typeLabel(c) || '—') },
          { k: 'Category', v: c.category ? esc(c.category) : '—' },
          { k: 'Status', v: UI.badge(statusLabel(c), STATUS_TONE[statusOf(c)] || 'neutral') },
          { k: 'Price', v: N.money(price) || '—' },
          { k: 'Capacity', v: cap == null ? '—' : (N.count(cap) + (c.minEnrollment ? ' (min ' + esc(c.minEnrollment) + ')' : '')) },
          { k: 'Duration', v: c.duration ? (esc(c.duration) + ' min') : '—' }
        ]);
        var schedKv = UI.kv([
          { k: 'Schedule', v: scheduleText(c) || '—' },
          { k: 'Instructor', v: c.instructorName ? esc(c.instructorName) : '—' },
          { k: 'Resource', v: c.resourceName ? esc(c.resourceName) : '—' },
          { k: 'Materials', v: materialsText(c) }
        ]);
        var descBody = c.description
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(c.description) + '</div>'
          : '<span class="mu-sub">No description.</span>';
        // Schedule + assignment + session generation are NATIVE now (edit form
        // sections + the Generate button below, all via ClassesBridge). What
        // still has NO V2 home: series pricing, skills/certs pickers, the waiver
        // template picker, and the class-image library — classic-linked.
        var manage = '';
        if (can('book', 'edit')) {
          var cid = esc(c._key || c.id), st0 = statusOf(c);
          var pubBtn = (st0 === 'draft' || st0 === 'active')
            ? '<button class="btn btn-secondary btn-small" onclick="ClassesV2.publish(\'' + cid + '\')">Publish to storefront</button>'
            : (st0 === 'published'
                ? '<button class="btn btn-secondary btn-small" onclick="ClassesV2.unpublish(\'' + cid + '\')">Unpublish</button>' : '');
          manage = '<div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-primary btn-small" onclick="ClassesV2.generate(\'' + cid + '\')">⚙ Generate sessions</button>' + pubBtn + '</div>';
        }

        // Sessions — upcoming first, then past (mirrors legacy detail ordering).
        var past = sessions.filter(function (s) {
          return !(s.date && String(s.date).slice(0, 10) >= V2.today) || String(s.status || '').toLowerCase() === 'cancelled';
        });
        function sessCols() {
          return [
            // Date drills to the session record (stacked SO with Back) — the
            // schedule surface's detail, with roster + session ops.
            { label: 'Date', render: function (s) {
                var label = s.date ? N.date(s.date) : '—';
                return s.id ? '<button type="button" class="mu-link" onclick="MastEntity.drill(\'sessions-v2\',\'' + esc(s.id) + '\')">' + esc(label) + '</button>' : esc(label);
            } },
            { label: 'Time', render: function (s) { return '<span class="mu-sub">' + fmtTimeRange(s) + '</span>'; } },
            { label: 'Enrolled', align: 'right', render: function (s) {
                var cp = sessCapacity(s, c);
                return N.count(sessEnrolled(s)) + (cp == null ? '' : (' / ' + N.count(cp)));
            } },
            { label: 'Status', render: function (s) {
                var st = String(s.status || 'scheduled').toLowerCase();
                return UI.badge(s.status || 'scheduled', SESSION_TONE[st] || 'teal');
            } }
          ];
        }
        var sessionsBody;
        if (!sessions.length) {
          sessionsBody = '<span class="mu-sub">No sessions generated yet — use ⚙ Generate sessions above.</span>';
        } else {
          sessionsBody = '';
          if (upcoming.length) sessionsBody += '<div class="mu-sub" style="margin:0 0 6px;">Upcoming (' + upcoming.length + ')</div>' + UI.relatedTable(sessCols(), upcoming);
          if (past.length) sessionsBody += '<div class="mu-sub" style="margin:' + (upcoming.length ? '14px' : '0') + ' 0 6px;">Past / cancelled (' + past.length + ')</div>' + UI.relatedTable(sessCols(), past);
        }

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Class', classKv) +
            UI.card('Schedule & assignment', schedKv) +
            UI.card('Description', descBody + manage) +
          '</div>' +
          '<div class="mu-pane" data-pane="sessions" hidden>' + UI.cardTable('Sessions (' + sessions.length + ')', sessionsBody) + '</div>';
      },
      // Native edit form — the class RECORD basic fields, grouped like the legacy
      // book.js showClassForm "Basic Info" + "Pricing & Capacity" + "Materials"
      // sections. Scope is the record only: name (required), description, type
      // (required), category, status, capacity (required), min-enrollment,
      // cancel-lead, price (required, dollars → cents in the bridge), duration
      // (required), materials. The SESSION GENERATION sub-flow (schedule builder
      // → materializeSessions), series pricing, instructor/resource assignment,
      // skills/certs, waiver, and image library stay bespoke on legacy #book —
      // a PATCH update preserves those fields.
      editRender: function (c, mode) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        function row3(a, b, c2) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + c2 + '</div>'; }
        var typeOpts = CLASS_TYPES.map(function (t) {
          return '<option value="' + t + '"' + (classType(c) === t ? ' selected' : '') + '>' + (TYPE_LABEL[t] || t) + '</option>';
        }).join('');
        var statusOpts = CLASS_STATUSES.map(function (s) {
          return '<option value="' + s + '"' + (statusOf(c) === s ? ' selected' : '') + '>' + (STATUS_LABEL[s] || s) + '</option>';
        }).join('');
        // Money is in CENTS on the record → render dollars in the input (mirrors
        // showClassForm: (priceCents / 100).toFixed(2)).
        var priceD = N.moneyVal(c, 'priceCents', null);
        var matCostD = N.moneyVal(c, 'materialsCostCents', null);
        var matIncl = !!c.materialsIncluded;
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New class' : 'Edit this class') + '</div>' +
          fg('Name *', '<input class="form-input" id="clV2Name" value="' + esc(c.name || c.title || '') + '" style="width:100%;" placeholder="e.g. Wheel Throwing Basics">') +
          fg('Description', '<textarea class="form-input" id="clV2Desc" rows="3" style="width:100%;resize:vertical;" placeholder="Class description for students…">' + esc(c.description || '') + '</textarea>') +
          row3(
            fg('Type *', '<select class="form-input" id="clV2Type" style="width:100%;" onchange="ClassesV2._typeChanged(this.value)">' + typeOpts + '</select>', true),
            fg('Category', '<input class="form-input" id="clV2Category" value="' + esc(c.category || '') + '" style="width:100%;" placeholder="e.g. pottery, glass">', true),
            fg('Status', '<select class="form-input" id="clV2Status" style="width:100%;">' + statusOpts + '</select>', true)
          ) +
          row3(
            fg('Capacity *', '<input class="form-input" type="number" min="1" id="clV2Capacity" value="' + (capacityOf(c) != null ? esc(capacityOf(c)) : '') + '" style="width:100%;">', true),
            fg('Drop-in price ($) *', '<input class="form-input" type="number" min="0" step="0.01" id="clV2Price" value="' + (priceD != null ? esc(priceD.toFixed(2)) : '') + '" style="width:100%;">', true),
            fg('Duration (min) *', '<input class="form-input" type="number" min="1" id="clV2Duration" value="' + (c.duration != null ? esc(c.duration) : '') + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Min enrollment', '<input class="form-input" type="number" min="0" id="clV2MinEnroll" value="' + (c.minEnrollment != null ? esc(c.minEnrollment) : '') + '" style="width:100%;" placeholder="Optional">', true),
            fg('Cancel lead days', '<input class="form-input" type="number" min="0" max="30" id="clV2CancelLead" value="' + (c.cancellationLeadDays != null ? esc(c.cancellationLeadDays) : '2') + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Materials included', '<select class="form-input" id="clV2MatIncl" style="width:100%;"><option value="false"' + (matIncl ? '' : ' selected') + '>No</option><option value="true"' + (matIncl ? ' selected' : '') + '>Yes</option></select>', true),
            fg('Materials cost ($)', '<input class="form-input" type="number" min="0" step="0.01" id="clV2MatCost" value="' + (matCostD != null ? esc(matCostD.toFixed(2)) : '') + '" style="width:100%;" placeholder="0.00">', true)
          ) +
          fg('Materials note', '<input class="form-input" id="clV2MatNote" value="' + esc(c.materialsNote || '') + '" style="width:100%;" placeholder="e.g. 25lbs of clay + glazes">') +
          // ── Schedule (delegated to ClassesBridge.setSchedule on save) ──
          (function () {
            var sc = c.schedule || {};
            var isOnce = sc.type === 'once';
            var DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
            var dayBoxes = DAYS.map(function (d) {
              var on = Array.isArray(sc.days) && sc.days.indexOf(d[0]) >= 0;
              return '<label style="display:inline-flex;align-items:center;gap:4px;margin-right:10px;font-size:0.85rem;"><input type="checkbox" class="clV2Day" value="' + d[0] + '"' + (on ? ' checked' : '') + '>' + d[1] + '</label>';
            }).join('');
            return '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">SCHEDULE</span>When this class runs (used by Generate sessions)</div>' +
              row2(
                fg('Repeats', '<select class="form-input" id="clV2SchedType" style="width:100%;" onchange="ClassesV2._schedTypeChanged(this.value)"><option value="recurring"' + (isOnce ? '' : ' selected') + '>Weekly (recurring)</option><option value="once"' + (isOnce ? ' selected' : '') + '>One time</option></select>', true),
                fg('Start time', '<input class="form-input" type="time" id="clV2SchedTime" value="' + esc(sc.startTime || '') + '" style="width:100%;">', true)
              ) +
              '<div id="clV2SchedRecurring"' + (isOnce ? ' style="display:none;"' : '') + '>' +
                fg('Days of the week', '<div style="padding:6px 0;">' + dayBoxes + '</div>') +
                row2(
                  fg('First day', '<input class="form-input" type="date" id="clV2SchedStart" value="' + esc(sc.startDate || '') + '" style="width:100%;">', true),
                  fg('Last day', '<input class="form-input" type="date" id="clV2SchedEnd" value="' + esc(sc.endDate || '') + '" style="width:100%;">', true)
                ) + '</div>' +
              '<div id="clV2SchedOnce"' + (isOnce ? '' : ' style="display:none;"') + '>' +
                fg('Date', '<input class="form-input" type="date" id="clV2SchedDate" value="' + esc(sc.date || sc.startDate || '') + '" style="width:100%;">') + '</div>';
          })() +
          // ── Assignment (delegated to ClassesBridge.assign on save) ──
          (function () {
            var instOpts = '<option value="">— No instructor —</option>' + Object.keys(V2.instructors).map(function (k) {
              var i = V2.instructors[k];
              return '<option value="' + esc(k) + '"' + (c.instructorId === k ? ' selected' : '') + '>' + esc(i.name || k) + '</option>';
            }).join('');
            var resOpts = '<option value="">— No room/equipment —</option>' + Object.keys(V2.resources).map(function (k) {
              var r = V2.resources[k];
              return '<option value="' + esc(k) + '"' + (c.resourceId === k || (!c.resourceId && c.resourceName && c.resourceName === r.name) ? ' selected' : '') + '>' + esc(r.name || k) + '</option>';
            }).join('');
            return '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">ASSIGNMENT</span>Who teaches it, where it happens</div>' +
              row2(
                fg('Instructor', '<select class="form-input" id="clV2Instructor" style="width:100%;">' + instOpts + '</select>', true),
                fg('Room / equipment', '<select class="form-input" id="clV2Resource" style="width:100%;">' + resOpts + '</select>', true)
              );
          })() +
          // ── Series details (shown when type = series; ClassesBridge.setExtras) ──
          (function () {
            var si = c.seriesInfo || {};
            return '<div id="clV2SeriesSection" style="' + (classType(c) === 'series' ? '' : 'display:none;') + '">' +
              '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">SERIES</span>Series pricing &amp; rules</div>' +
              row2(
                fg('Total sessions', '<input class="form-input" type="number" min="1" id="clV2SeriesTotal" value="' + (si.totalSessions != null ? esc(si.totalSessions) : '') + '" style="width:100%;">', true),
                fg('Series price ($)', '<input class="form-input" type="number" min="0" step="0.01" id="clV2SeriesPrice" value="' + (si.seriesPriceCents ? esc((si.seriesPriceCents / 100).toFixed(2)) : '') + '" style="width:100%;">', true)
              ) +
              row2(
                fg('Allow drop-in', '<select class="form-input" id="clV2SeriesDropin" style="width:100%;"><option value="true"' + (si.allowDropIn !== false ? ' selected' : '') + '>Yes</option><option value="false"' + (si.allowDropIn === false ? ' selected' : '') + '>No</option></select>', true),
                fg('Allow late enroll', '<select class="form-input" id="clV2SeriesLate" style="width:100%;"><option value="false"' + (si.allowLateEnroll !== true ? ' selected' : '') + '>No</option><option value="true"' + (si.allowLateEnroll === true ? ' selected' : '') + '>Yes</option></select>', true)
              ) + '</div>';
          })() +
          // ── Policies (waiver / enrollment window) ──
          (function () {
            var rw = !!c.requiresWaiver;
            var wtOpts = '<option value="">Select a waiver…</option>' + Object.keys(V2.waiverTemplates).map(function (k) {
              var t = V2.waiverTemplates[k] || {};
              if (t.status && t.status !== 'published' && c.waiverTemplateId !== k) return '';
              return '<option value="' + esc(k) + '"' + (c.waiverTemplateId === k ? ' selected' : '') + '>' + esc(t.title || 'Untitled') + '</option>';
            }).join('');
            return '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">POLICIES</span>Waiver &amp; enrollment window</div>' +
              row2(
                fg('Requires waiver', '<select class="form-input" id="clV2ReqWaiver" style="width:100%;" onchange="ClassesV2._waiverToggled(this.value)"><option value="false"' + (rw ? '' : ' selected') + '>No</option><option value="true"' + (rw ? ' selected' : '') + '>Yes</option></select>', true),
                '<div class="form-group" id="clV2WaiverTplWrap" style="flex:1;min-width:150px;' + (rw ? '' : 'display:none;') + '"><label class="form-label">Waiver template</label><select class="form-input" id="clV2WaiverTpl" style="width:100%;">' + wtOpts + '</select></div>'
              ) +
              row2(
                fg('Enrollment opens', '<input class="form-input" type="date" id="clV2EnrollOpen" value="' + esc(c.enrollmentOpenDate || '') + '" style="width:100%;">', true),
                fg('Enrollment closes', '<input class="form-input" type="date" id="clV2EnrollClose" value="' + esc(c.enrollmentCloseDate || '') + '" style="width:100%;">', true)
              ) +
              // Required certifications — checkboxes over admin/certTypes.
              (function () {
                var existing = {};
                (Array.isArray(c.requiredCertTypeIds) ? c.requiredCertTypeIds : []).forEach(function (t) { existing[t] = true; });
                var ids = Object.keys(V2.certTypes).filter(function (k) { return !(V2.certTypes[k] || {}).archivedAt; });
                var inner = ids.length
                  ? ids.map(function (k) {
                      return '<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;font-size:0.85rem;"><input type="checkbox" class="clV2Cert" value="' + esc(k) + '"' + (existing[k] ? ' checked' : '') + '>' + esc((V2.certTypes[k] || {}).name || k) + '</label>';
                    }).join('')
                  : '<span class="mu-sub">No certification types defined yet (Classes → Settings).</span>';
                return fg('Required certifications', '<div style="padding:6px 0;">' + inner + '</div>');
              })();
          })() +
          // ── Required skills (admin/skillCatalog; add-new via bridge ensureSkill) ──
          (function () {
            var have = {};
            (Array.isArray(c.requiredSkills) ? c.requiredSkills : []).forEach(function (sl) { have[sl] = true; });
            var slugs = Object.keys(V2.skillCatalog);
            Object.keys(have).forEach(function (sl) { if (slugs.indexOf(sl) < 0) slugs.push(sl); });
            var boxes = slugs.map(function (sl) {
              var label = (V2.skillCatalog[sl] && V2.skillCatalog[sl].label) || sl.replace(/-/g, ' ');
              return '<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;font-size:0.85rem;"><input type="checkbox" class="clV2Skill" value="' + esc(sl) + '"' + (have[sl] ? ' checked' : '') + '>' + esc(label) + '</label>';
            }).join('') || '<span class="mu-sub">No skills in the catalog yet — add one below.</span>';
            return '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">SKILLS</span>Required instructor skills</div>' +
              fg('Required skills', '<div id="clV2SkillBoxes" style="padding:6px 0;">' + boxes + '</div>' +
                '<div style="display:flex;gap:8px;margin-top:4px;"><input class="form-input" id="clV2NewSkill" placeholder="Add a skill — e.g. Wheel Throwing" style="flex:1;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();ClassesV2._addSkill();}"><button type="button" class="btn btn-secondary btn-small" onclick="ClassesV2._addSkill()">Add</button></div>');
          })() +
          // ── Class image (storefront card; upload CF + shared library picker) ──
          (function () {
            V2.editImageUrl = (mode !== 'create' && Array.isArray(c.imageIds) && c.imageIds.length) ? c.imageIds[0] : null;
            return '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">IMAGE</span>Class image</div>' +
              '<div id="clV2ImgPreview">' + (V2.editImageUrl ? '<img src="' + esc(V2.editImageUrl) + '" style="max-width:200px;max-height:120px;border-radius:8px;object-fit:cover;">' : '<span class="mu-sub">No image yet.</span>') + '</div>' +
              '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
                '<button type="button" class="btn btn-secondary btn-small" onclick="ClassesV2._pickImage()">Select from library</button>' +
                '<label class="btn btn-secondary btn-small" style="cursor:pointer;"><input type="file" accept="image/*" style="display:none;" onchange="ClassesV2._uploadImage(this)">Upload new</label>' +
                '<button type="button" class="btn btn-secondary btn-small" onclick="ClassesV2._removeImage()">Remove</button>' +
              '</div>';
          })() +
          (mode === 'create'
            ? '<div class="mu-sub" style="margin-top:8px;">After creating: “Generate sessions” on the class builds the schedule.</div>'
            : '');
      }
    },
    onSave: function (rec, mode) {
      if (!window.ClassesBridge) { if (window.showToast) showToast('Classes engine still loading — try again', true); return false; }
      var priceRaw = ((document.getElementById('clV2Price') || {}).value || '').trim();
      var matCostRaw = ((document.getElementById('clV2MatCost') || {}).value || '').trim();
      var data = {
        name: (document.getElementById('clV2Name') || {}).value || '',
        description: ((document.getElementById('clV2Desc') || {}).value || '').trim(),
        type: (document.getElementById('clV2Type') || {}).value || 'single',
        category: ((document.getElementById('clV2Category') || {}).value || '').trim(),
        status: (document.getElementById('clV2Status') || {}).value || 'draft',
        capacity: (document.getElementById('clV2Capacity') || {}).value,
        minEnrollment: (document.getElementById('clV2MinEnroll') || {}).value,
        cancellationLeadDays: (document.getElementById('clV2CancelLead') || {}).value,
        // Dollars here → the bridge converts to priceCents (mirrors saveClass).
        price: priceRaw === '' ? 0 : parseFloat(priceRaw),
        duration: (document.getElementById('clV2Duration') || {}).value,
        materialsIncluded: (document.getElementById('clV2MatIncl') || {}).value === 'true',
        materialsCostCents: matCostRaw === '' ? null : parseFloat(matCostRaw),
        materialsNote: ((document.getElementById('clV2MatNote') || {}).value || '').trim() || null
      };
      if (!data.name.trim()) { if (window.showToast) showToast('Class name is required.', true); return false; }
      if (priceRaw === '' || isNaN(parseFloat(priceRaw))) { if (window.showToast) showToast('Drop-in price is required.', true); return false; }

      // Schedule + assignment from the form sections (PATCHed via the bridge
      // after the record write so the shapes stay single-sourced in book.js).
      function readSchedule() {
        var type = ((document.getElementById('clV2SchedType') || {}).value) || 'recurring';
        if (type === 'once') {
          return { type: 'once', date: (document.getElementById('clV2SchedDate') || {}).value || null,
                   startTime: (document.getElementById('clV2SchedTime') || {}).value || '' };
        }
        var days = [];
        document.querySelectorAll('#mastSlideOut .clV2Day:checked').forEach(function (el) { days.push(el.value); });
        return { type: 'recurring', days: days,
                 startTime: (document.getElementById('clV2SchedTime') || {}).value || '',
                 startDate: (document.getElementById('clV2SchedStart') || {}).value || '',
                 endDate: (document.getElementById('clV2SchedEnd') || {}).value || '' };
      }
      function readAssign() {
        var iid = (document.getElementById('clV2Instructor') || {}).value || null;
        var rid = (document.getElementById('clV2Resource') || {}).value || null;
        return {
          instructorId: iid, instructorName: iid && V2.instructors[iid] ? (V2.instructors[iid].name || null) : null,
          resourceId: rid, resourceName: rid && V2.resources[rid] ? (V2.resources[rid].name || null) : null
        };
      }
      var schedule = readSchedule(), assign = readAssign();
      function readExtras() {
        function v(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
        var certs = [], skills = [];
        document.querySelectorAll('#mastSlideOut .clV2Cert:checked').forEach(function (el) { certs.push(el.value); });
        document.querySelectorAll('#mastSlideOut .clV2Skill:checked').forEach(function (el) { skills.push(el.value); });
        return {
          type: data.type,
          seriesTotal: v('clV2SeriesTotal'), seriesPrice: v('clV2SeriesPrice'),
          seriesDropIn: v('clV2SeriesDropin'), seriesLateEnroll: v('clV2SeriesLate'),
          requiresWaiver: v('clV2ReqWaiver') === 'true',
          waiverTemplateId: v('clV2WaiverTpl') || null,
          enrollmentOpenDate: v('clV2EnrollOpen') || null,
          enrollmentCloseDate: v('clV2EnrollClose') || null,
          requiredCertTypeIds: certs, requiredSkills: skills,
          imageUrl: V2.editImageUrl || null
        };
      }
      var extras = readExtras();
      if (extras.requiresWaiver && !extras.waiverTemplateId) { if (window.showToast) showToast('Pick a waiver template (or set Requires waiver to No).', true); return false; }

      // Cents-shaped patch for the LIVE cache so the post-save read re-render
      // (which reads priceCents / materialsCostCents) reflects the edit at once.
      function livePatch() {
        var mi = data.materialsIncluded;
        return {
          name: data.name.trim(), description: data.description, type: data.type,
          category: data.category.toLowerCase(), status: data.status,
          capacity: parseInt(data.capacity, 10) || 8,
          minEnrollment: parseInt(data.minEnrollment, 10) || null,
          cancellationLeadDays: parseInt(data.cancellationLeadDays, 10) || 2,
          priceCents: Math.round((data.price || 0) * 100),
          duration: parseInt(data.duration, 10) || 60,
          materialsIncluded: mi,
          materialsCostCents: mi ? null : (data.materialsCostCents && data.materialsCostCents > 0 ? Math.round(data.materialsCostCents * 100) : null),
          materialsNote: data.materialsNote
        };
      }

      if (mode === 'create') {
        return Promise.resolve(window.ClassesBridge.create(data)).then(function (newId) {
          return window.ClassesBridge.setSchedule(newId, schedule)
            .then(function () { return window.ClassesBridge.assign(newId, assign); })
            .then(function () { return window.ClassesBridge.setExtras(newId, extras); })
            .then(function () { if (window.showToast) showToast('Class created.'); reloadSoon(); return true; });
        }).catch(function (e) { console.error('[classes-v2] create', e); if (window.showToast) showToast('Error saving class.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.ClassesBridge.update(id, data)).then(function () {
        return window.ClassesBridge.setSchedule(id, schedule)
          .then(function () { return window.ClassesBridge.assign(id, assign); })
          .then(function () { return window.ClassesBridge.setExtras(id, extras); });
      }).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, livePatch(), {
          schedule: schedule, instructorId: assign.instructorId, instructorName: assign.instructorName,
          resourceId: assign.resourceId, resourceName: assign.resourceName,
          requiresWaiver: extras.requiresWaiver, waiverTemplateId: extras.waiverTemplateId,
          enrollmentOpenDate: extras.enrollmentOpenDate, enrollmentCloseDate: extras.enrollmentCloseDate,
          requiredCertTypeIds: extras.requiredCertTypeIds, requiredSkills: extras.requiredSkills,
          imageIds: extras.imageUrl ? [extras.imageUrl] : [],
          seriesInfo: extras.type === 'series' ? {
            totalSessions: parseInt(extras.seriesTotal, 10) || null,
            seriesPriceCents: extras.seriesPrice ? Math.round(parseFloat(extras.seriesPrice) * 100) : null,
            allowDropIn: extras.seriesDropIn !== 'false', allowLateEnroll: extras.seriesLateEnroll === 'true'
          } : null
        });
        if (window.showToast) showToast('Class updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[classes-v2] update', e); if (window.showToast) showToast('Error updating class.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var V2 = { rows: [], byId: {}, sessionsByClass: {}, instructors: {}, resources: {}, enrollments: [], waiverTemplates: {}, certTypes: {}, skillCatalog: {}, editImageUrl: null, today: todayStr(), sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', lens: 'catalog', loaded: false };

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
    // Ensure the legacy Book module is loaded so window.ClassesBridge (the
    // delegated write path) exists — mirrors contacts-v2 / materials-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
    // Classes + their generated sessions load together; both one-shot keyed-object
    // reads (mirrors book.js loadClassDetail + calendar-v2 load).
    return Promise.all([
      Promise.resolve(MastDB.get('public/classes')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/classSessions')).catch(function () { return null; }),
      // Rosters for the assignment pickers; enrollments feed the Reports lens.
      Promise.resolve(MastDB.instructors.list(100)).catch(function () { return {}; }),
      Promise.resolve(MastDB.resources.list(100)).catch(function () { return {}; }),
      Promise.resolve(MastDB.enrollments.list(2000)).catch(function () { return {}; }),
      // Editor pickers (V1-removal: waiver/certs/skills are native now).
      Promise.resolve(MastDB.get('settings/waiverTemplates')).catch(function () { return {}; }),
      Promise.resolve(MastDB.get('admin/certTypes')).catch(function () { return {}; }),
      Promise.resolve(MastDB.skillCatalog.list(200)).catch(function () { return {}; })
    ]).then(function (res) {
      var cv = res[0] || {}, sv = res[1] || {};
      function toMap(x) { return (x && typeof x.val === 'function') ? (x.val() || {}) : (x || {}); }
      V2.instructors = toMap(res[2]);
      V2.resources = toMap(res[3]);
      var ev = toMap(res[4]);
      V2.enrollments = Object.keys(ev).map(function (k) { return Object.assign({ _key: k }, ev[k]); });
      V2.waiverTemplates = toMap(res[5]);
      V2.certTypes = toMap(res[6]);
      V2.skillCatalog = toMap(res[7]);
      var out = [];
      Object.keys(cv).forEach(function (k) {
        var c = cv[k];
        if (c && typeof c === 'object') { c = Object.assign({ _key: k }, c); c.status = c.status || 'draft'; out.push(c); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      var byClass = {};
      Object.keys(sv).forEach(function (k) {
        var s = sv[k]; if (!s || typeof s !== 'object') return;
        s = Object.assign({ id: k }, s);
        if (!s.classId) return;
        (byClass[s.classId] = byClass[s.classId] || []).push(s);
      });
      V2.sessionsByClass = byClass;
      V2.loaded = true;
    }).catch(function (e) { console.error('[classes-v2] load', e); });
  }
  function reloadSoon() { V2.loaded = false; _loadPromise = null; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (c) { return statusOf(c) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (c) {
        return className(c).toLowerCase().indexOf(q) >= 0 ||
               String(c.category || '').toLowerCase().indexOf(q) >= 0 ||
               String(c.instructorName || '').toLowerCase().indexOf(q) >= 0 ||
               typeLabel(c).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('classes-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('classesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'classesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    // One classes hub, two lenses (Catalog · Reports) — Class Reports is a
    // computed lens over the same classes/sessions/enrollments, not a separate
    // surface (plan: classes-v2-build-plan.md CONSOLIDATION; finance-statements
    // route-picks-the-lens precedent). #book-reports deep-links to Reports.
    var lensPills = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' +
      '<button class="btn btn-small ' + (V2.lens === 'catalog' ? 'btn-primary' : 'btn-secondary') + '" onclick="ClassesV2.lens(\'catalog\')">Catalog</button> ' +
      '<button class="btn btn-small ' + (V2.lens === 'rooms' ? 'btn-primary' : 'btn-secondary') + '" onclick="ClassesV2.lens(\'rooms\')">Rooms &amp; equipment</button> ' +
      '<button class="btn btn-small ' + (V2.lens === 'reports' ? 'btn-primary' : 'btn-secondary') + '" onclick="ClassesV2.lens(\'reports\')">Reports</button></div>';
    if (V2.lens === 'rooms') {
      tab.innerHTML =
        U.pageHeader({
          title: 'Classes', count: 'rooms & equipment',
          actionsHtml: (can('resources', 'edit') ? '<button class="btn btn-primary" onclick="ClassesV2.newRoom()">+ New room or equipment</button>' : '')
        }) + lensPills + renderRooms();
      return;
    }
    if (V2.lens === 'reports') {
      tab.innerHTML =
        U.pageHeader({ title: 'Classes', count: 'attendance & revenue' }) +
        lensPills + renderReports();
      return;
    }
    var filters = [['all', 'All'], ['draft', 'Draft'], ['active', 'Active'], ['published', 'Published'], ['completed', 'Completed'], ['archived', 'Archived']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ClassesV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Classes',
        count: N.count(V2.rows.length) + ' class' + (V2.rows.length === 1 ? '' : 'es'),
        actionsHtml: (can('book', 'edit') ? '<button class="btn btn-primary" onclick="ClassesV2.create()">+ New class</button>' : '') +
          '<button class="btn btn-secondary" onclick="ClassesV2.exportCsv()">↓ Export</button>'
      }) +
      lensPills +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, category, type or instructor…" value="' + esc(V2.q) +
        '" oninput="ClassesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('classes-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ClassesV2.sort', onRowClickFnName: 'ClassesV2.open',
        empty: { title: 'No classes', message: V2.loaded ? 'Add a class to get started.' : 'Loading…' }
      });
  }

  // ── Rooms & equipment lens — the resources roster, hosted as a hub lens
  // (8→6 sidebar merge, operator-ratified Option B). Rows drill to the
  // resources-v2 entity SO (edit + danger zone live there, single-sourced);
  // create delegates to ResourcesV2.create. Reads V2.resources — already
  // loaded for the assignment pickers.
  function renderRooms() {
    var rows = Object.keys(V2.resources).map(function (k) {
      return Object.assign({ _key: k }, V2.resources[k]);
    }).sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); });
    if (!rows.length) return U.cardTable('Rooms & equipment', '<span class="mu-sub">No rooms or equipment yet. Add what classes get booked into — rooms, kilns, wheels.</span>');
    function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—'; }
    var table = U.relatedTable([
      { label: 'Name', render: function (r) {
          return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'resources-v2\',\'' + esc(r._key) + '\')">' + esc(r.name || '—') + '</button>';
      } },
      { label: 'Type', render: function (r) { return esc(cap(r.type)); } },
      { label: 'Sub-type', render: function (r) { return r.subType ? esc(r.subType) : '<span class="mu-sub">—</span>'; } },
      { label: 'Capacity', align: 'right', render: function (r) { return r.capacity != null ? N.count(r.capacity) : '—'; } },
      { label: 'Status', render: function (r) { return U.badge(cap(r.status || 'active'), (r.status || 'active') === 'active' ? 'success' : 'neutral'); } }
    ], rows);
    return U.cardTable('Rooms & equipment (' + rows.length + ')', table);
  }

  // ── Reports lens — attendance / revenue / fill, computed from the loaded
  // classes + sessions + enrollments. Revenue = SUM(enrollment pricePaidCents)
  // (seat revenue; the legacy tab's order-line join, sessionLogs depth and
  // incidents stay classic — debt register). Read-only.
  function renderReports() {
    var sessions = [];
    Object.keys(V2.sessionsByClass).forEach(function (cid) { sessions = sessions.concat(V2.sessionsByClass[cid]); });
    var completedSessions = sessions.filter(function (s) { return String(s.status || '').toLowerCase() === 'completed'; });
    var en = V2.enrollments;
    var attended = en.filter(function (e) { return e.status === 'completed' || e.status === 'checked-in' || e.status === 'attended-pending-waiver' || e.status === 'late'; }).length;
    var noShow = en.filter(function (e) { return e.status === 'no-show'; }).length;
    var attRate = (attended + noShow) ? Math.round(attended / (attended + noShow) * 100) : null;
    var active = en.filter(function (e) { return e.status === 'confirmed' || e.status === 'waitlisted' || e.status === 'checked-in'; }).length;
    var revenueCents = en.reduce(function (sum, e) {
      if (e.status === 'cancelled' || e.status === 'cancelled_by_session') return sum;
      return sum + (parseInt(e.pricePaidCents, 10) || 0);
    }, 0);

    var tiles = U.tiles([
      { k: 'Seat revenue', v: N.money(revenueCents / 100) || '$0.00', hero: true },
      { k: 'Attendance rate', v: attRate == null ? '—' : (attRate + '%') },
      { k: 'Active enrollments', v: N.count(active) },
      { k: 'Sessions completed', v: N.count(completedSessions.length) }
    ]);

    // Per-class: enrollments, fill rate (confirmed seats vs capacity over
    // non-cancelled sessions), seat revenue. Sorted by revenue.
    var perClass = V2.rows.map(function (c) {
      var cid = c._key;
      var cEn = en.filter(function (e) { return e.classId === cid && e.status !== 'cancelled' && e.status !== 'cancelled_by_session'; });
      var cRev = cEn.reduce(function (s, e) { return s + (parseInt(e.pricePaidCents, 10) || 0); }, 0);
      var cSess = (V2.sessionsByClass[cid] || []).filter(function (s) { return String(s.status || '').toLowerCase() !== 'cancelled'; });
      var seatCap = cSess.reduce(function (s, x) { return s + (parseInt(x.capacity, 10) || 0); }, 0);
      var seatFilled = cSess.reduce(function (s, x) { return s + sessEnrolled(x); }, 0);
      return { c: c, enrolls: cEn.length, rev: cRev, fill: seatCap ? Math.round(seatFilled / seatCap * 100) : null };
    }).filter(function (r) { return r.enrolls > 0 || (V2.sessionsByClass[r.c._key] || []).length > 0; })
      .sort(function (a, b) { return b.rev - a.rev; });

    var table = U.relatedTable([
      { label: 'Class', render: function (r) {
          return '<button type="button" class="mu-link" onclick="ClassesV2.open(\'' + esc(r.c._key) + '\')">' + esc(className(r.c)) + '</button>';
      } },
      { label: 'Enrollments', align: 'right', render: function (r) { return N.count(r.enrolls); } },
      { label: 'Fill rate', align: 'right', render: function (r) { return r.fill == null ? '—' : (r.fill + '%'); } },
      { label: 'Seat revenue', align: 'right', render: function (r) { return N.money(r.rev / 100) || '—'; } }
    ], perClass);

    // Repeat students — students with 2+ non-cancelled seats (email-keyed).
    var byEmail = {};
    en.forEach(function (e) {
      if (e.status === 'cancelled' || e.status === 'cancelled_by_session') return;
      var em = (e.studentEmail || e.customerEmail || '').toLowerCase();
      if (!em) return;
      (byEmail[em] = byEmail[em] || { name: e.studentName || e.customerName || em, n: 0 }).n++;
    });
    var repeats = Object.keys(byEmail).map(function (k) { return byEmail[k]; })
      .filter(function (r) { return r.n >= 2; }).sort(function (a, b) { return b.n - a.n; }).slice(0, 10);
    var repeatBody = repeats.length
      ? U.relatedTable([
          { label: 'Student', render: function (r) { return esc(r.name); } },
          { label: 'Enrollments', align: 'right', render: function (r) { return N.count(r.n); } }
        ], repeats)
      : '<span class="mu-sub">No repeat students yet.</span>';

    return tiles +
      U.cardTable('By class', perClass.length ? table : '<span class="mu-sub">No class activity yet.</span>') +
      U.cardTable('Repeat students', repeatBody);
  }

  window.ClassesV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'price' || key === 'capacity' || key === 'upcoming' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    lens: function (l) {
      V2.lens = (l === 'reports' || l === 'rooms') ? l : 'catalog';
      // Rooms can change via drilled SOs (create/edit/delete on resources-v2);
      // refresh the hub's copy when entering the lens so the roster is current.
      if (V2.lens === 'rooms') { load(); }
      render();
    },
    // Create delegates to the resources-v2 surface (its intake + bridge own
    // the write); lazy-load the module on a cold hub visit.
    newRoom: function () {
      if (window.ResourcesV2 && ResourcesV2.create) { ResourcesV2.create(); return; }
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule('resources-v2').then(function () {
          if (window.ResourcesV2 && ResourcesV2.create) ResourcesV2.create();
          else if (window.showToast) showToast('Rooms engine still loading — try again', true);
        }).catch(function () { if (window.showToast) showToast('Could not load rooms', true); });
      }
    },
    search: function (v) { V2.q = v || ''; render(); },
    // Generate sessions from the class schedule — the SAME materializer legacy
    // saveClass runs (duplicate-safe), via ClassesBridge.generateSessions.
    generate: function (id) {
      if (!can('book', 'edit')) { if (window.showToast) showToast('Classes write access required.', true); return; }
      if (!window.ClassesBridge || !window.ClassesBridge.generateSessions) { if (window.showToast) showToast('Classes engine still loading — try again', true); return; }
      Promise.resolve(window.ClassesBridge.generateSessions(id)).then(function () {
        reloadSoon();
        // Re-open after the refresh so the Sessions facet shows the new rows.
        setTimeout(function () { ClassesV2.open(id); }, 600);
      }).catch(function (e) {
        console.error('[classes-v2] generate', e);
        if (window.showToast) showToast('Error: ' + (e && e.message || 'could not generate sessions.'), true);
      });
    },
    // Publish / unpublish — bridge cores (checklist errors surface in the toast).
    publish: function (id) {
      if (!can('book', 'edit')) { if (window.showToast) showToast('Classes write access required.', true); return; }
      var ask = (typeof window.mastConfirm === 'function')
        ? window.mastConfirm('Publish this class? It will appear on the public storefront.', { title: 'Publish Class' })
        : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(window.ClassesBridge.publish(id)).then(function () {
          if (window.showToast) showToast('Class published.');
          var rec = V2.byId[id]; if (rec) { rec.status = 'published'; MastEntity.openRecord('classes-v2', rec, 'read'); }
          reloadSoon();
        });
      }).catch(function (e) { if (window.showToast) showToast(e && e.message || 'Publish failed.', true); });
    },
    unpublish: function (id) {
      if (!can('book', 'edit')) { if (window.showToast) showToast('Classes write access required.', true); return; }
      var ask = (typeof window.mastConfirm === 'function')
        ? window.mastConfirm('Unpublish this class? It will be hidden from the storefront.', { title: 'Unpublish Class' })
        : Promise.resolve(true);
      Promise.resolve(ask).then(function (ok) {
        if (!ok) return;
        return Promise.resolve(window.ClassesBridge.unpublish(id)).then(function () {
          if (window.showToast) showToast('Class unpublished — back to draft.');
          var rec = V2.byId[id]; if (rec) { rec.status = 'draft'; MastEntity.openRecord('classes-v2', rec, 'read'); }
          reloadSoon();
        });
      }).catch(function (e) { if (window.showToast) showToast(e && e.message || 'Unpublish failed.', true); });
    },
    // Edit-form helpers — series toggle, waiver toggle, skill add, image.
    _typeChanged: function (type) {
      var el = document.getElementById('clV2SeriesSection');
      if (el) el.style.display = type === 'series' ? '' : 'none';
    },
    _waiverToggled: function (v) {
      var el = document.getElementById('clV2WaiverTplWrap');
      if (el) el.style.display = v === 'true' ? '' : 'none';
    },
    _addSkill: function () {
      var input = document.getElementById('clV2NewSkill');
      var label = input && input.value.trim();
      if (!label) return;
      if (!window.ClassesBridge || !window.ClassesBridge.ensureSkill) { if (window.showToast) showToast('Classes engine still loading — try again', true); return; }
      Promise.resolve(window.ClassesBridge.ensureSkill(label)).then(function (slug) {
        if (!slug) return;
        V2.skillCatalog[slug] = V2.skillCatalog[slug] || { slug: slug, label: label };
        var boxes = document.getElementById('clV2SkillBoxes');
        if (boxes && !boxes.querySelector('input[value="' + slug + '"]')) {
          var lbl = document.createElement('label');
          lbl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;font-size:0.85rem;';
          lbl.innerHTML = '<input type="checkbox" class="clV2Skill" value="' + esc(slug) + '" checked>' + esc(label);
          boxes.appendChild(lbl);
        } else if (boxes) {
          boxes.querySelector('input[value="' + slug + '"]').checked = true;
        }
        input.value = '';
      }).catch(function (e) { if (window.showToast) showToast('Could not add skill.', true); console.error('[classes-v2] addSkill', e); });
    },
    _pickImage: function () {
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image picker unavailable', true); return; }
      window.openImagePicker(function (imgId, url) { V2.editImageUrl = url; ClassesV2._refreshImg(); });
    },
    _uploadImage: function (fileInput) {
      if (!fileInput.files || !fileInput.files[0]) return;
      if (window.showToast) showToast('Uploading image…');
      var reader = new FileReader();
      reader.onload = function (e) {
        var base64 = e.target.result.split(',')[1];
        window.auth.currentUser.getIdToken().then(function (token) {
          return window.callCF('/uploadImage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ image: base64, tags: ['class'], source: 'admin-upload' })
          });
        }).then(function (resp) { return resp.json(); }).then(function (result) {
          if (!result.success) throw new Error(result.error || 'Upload failed');
          V2.editImageUrl = result.url; ClassesV2._refreshImg();
          if (window.showToast) showToast('Image uploaded.');
        }).catch(function (err) { if (window.showToast) showToast('Upload failed: ' + (err && err.message || err), true); });
      };
      reader.readAsDataURL(fileInput.files[0]);
    },
    _removeImage: function () { V2.editImageUrl = null; ClassesV2._refreshImg(); },
    _refreshImg: function () {
      var el = document.getElementById('clV2ImgPreview');
      if (el) el.innerHTML = V2.editImageUrl
        ? '<img src="' + esc(V2.editImageUrl) + '" style="max-width:200px;max-height:120px;border-radius:8px;object-fit:cover;">'
        : '<span class="mu-sub">No image yet.</span>';
    },
    // Edit-form helper: toggle the recurring/once schedule sub-sections.
    _schedTypeChanged: function (type) {
      var rec = document.getElementById('clV2SchedRecurring'), once = document.getElementById('clV2SchedOnce');
      if (rec) rec.style.display = type === 'once' ? 'none' : '';
      if (once) once.style.display = type === 'once' ? '' : 'none';
    },
    open: function (id) {
      MastEntity.get('classes-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('classes-v2', rec, 'read');
      });
    },
    create: function () {
      // Ensure the legacy Book module (and thus window.ClassesBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
      MastEntity.openRecord('classes-v2', {}, 'create');
    },
    exportCsv: function () { return MastEntity.exportRows('classes-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('classes-v2', {
    routes: {
      'classes-v2': { tab: 'classesV2Tab', setup: function () { V2.lens = 'catalog'; ensureTab(); render(); load(); } },
      // Class Reports deep link — same hub, Reports lens (route picks the lens).
      'book-reports-v2': { tab: 'classesV2Tab', setup: function () { V2.lens = 'reports'; ensureTab(); render(); load(); } },
      // Rooms & Equipment deep link (#resources remaps here) — Rooms lens.
      'classes-rooms-v2': { tab: 'classesV2Tab', setup: function () { V2.lens = 'rooms'; ensureTab(); render(); load(); } }
    }
  });
})();
