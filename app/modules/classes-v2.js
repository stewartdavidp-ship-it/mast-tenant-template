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
        // Basic-record editing is NATIVE now (the Edit button on this slide-out).
        // What still has NO V2 home: the SESSION GENERATION sub-flow (schedule
        // builder → materializeSessions), series pricing, instructor/resource
        // assignment, skills/certs, waiver, and the image library — those stay
        // bespoke on legacy #book. navigateToClassic avoids looping back here.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="ClassesV2.classic()">Schedule &amp; sessions in classic view →</button></div>';

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
          sessionsBody = '<span class="mu-sub">No sessions generated yet. Generate sessions in the classic view.</span>';
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
            fg('Type *', '<select class="form-input" id="clV2Type" style="width:100%;">' + typeOpts + '</select>', true),
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
          (mode === 'create'
            ? '<div class="mu-sub" style="margin-top:8px;">Schedule, sessions, series pricing, assignment, skills/certs, waiver and the class image are set up in the classic view after creating.</div>'
            : '<div class="mu-sub" style="margin-top:8px;">Schedule &amp; sessions, series pricing, assignment, skills/certs, waiver and the class image are edited in the classic view.</div>');
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
        return Promise.resolve(window.ClassesBridge.create(data)).then(function () {
          if (window.showToast) showToast('Class created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[classes-v2] create', e); if (window.showToast) showToast('Error saving class.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.ClassesBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, livePatch());
        if (window.showToast) showToast('Class updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[classes-v2] update', e); if (window.showToast) showToast('Error updating class.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var V2 = { rows: [], byId: {}, sessionsByClass: {}, today: todayStr(), sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

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
      Promise.resolve(MastDB.get('public/classSessions')).catch(function () { return null; })
    ]).then(function (res) {
      var cv = res[0] || {}, sv = res[1] || {};
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
    var filters = [['all', 'All'], ['draft', 'Draft'], ['active', 'Active'], ['published', 'Published'], ['completed', 'Completed'], ['archived', 'Archived']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ClassesV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Classes',
        count: N.count(V2.rows.length) + ' class' + (V2.rows.length === 1 ? '' : 'es'),
        actionsHtml: '<button class="btn btn-primary" onclick="ClassesV2.create()">+ New class</button>' +
          '<button class="btn btn-secondary" onclick="ClassesV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, category, type or instructor…" value="' + esc(V2.q) +
        '" oninput="ClassesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('classes-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ClassesV2.sort', onRowClickFnName: 'ClassesV2.open',
        empty: { title: 'No classes', message: V2.loaded ? 'Add a class to get started.' : 'Loading…' }
      });
  }

  window.ClassesV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'price' || key === 'capacity' || key === 'upcoming' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
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
    // The basic class record is created/edited NATIVELY here. The SESSION
    // GENERATION sub-flow (schedule builder → materializeSessions), series
    // pricing, instructor/resource assignment, skills/certs, waiver, and the
    // image library have no V2 home → classic Classes catalog (route 'book').
    // Use navigateToClassic so the V2 route remap doesn't loop back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('book');
      else if (typeof navigateTo === 'function') navigateTo('book');
    },
    exportCsv: function () { return MastEntity.exportRows('classes-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('classes-v2', {
    routes: { 'classes-v2': { tab: 'classesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
