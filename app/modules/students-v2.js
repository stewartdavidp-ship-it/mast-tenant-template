/**
 * students-v2.js — read-focused Faceted Record twin of the legacy Students
 * roster surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy students.js (#students) hosts a multi-view admin: a roster of student
 * records with an in-pane detail (renderStudentDetail) plus Clearance-Types,
 * Business-Documents and Waiver-template tooling. This twin re-hosts ONE of
 * those surfaces — the roster -> read detail — on the Entity Engine: a
 * schema-driven list + a Faceted Record slide-out (Overview / Onboarding /
 * Enrollments / Clearances / Documents / Notes facets) where Onboarding,
 * Clearances and Documents are now natively EDITABLE in-pane.
 *
 * Variant (doc 17 §1a test): a student is a person record with related
 * collections (clearances, documents, an onboarding checklist) but no governed
 * lifecycle — its status (active / inactive) is an assigned attribute, not a
 * workflow phase -> Faceted Record, NOT Process/MastFlow.
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the identity /
 * profile / emergency / medical / onboarding field set, grouped like the legacy
 * form) + an onSave that DELEGATES to window.StudentsBridge (exposed in
 * students.js) so the student write, the onboardingChecklist seeding and the
 * isMinor auto-compute stay single-sourced — this twin never reimplements that
 * logic (mirrors the contacts-v2 / ContactsBridge precedent). The per-clearance,
 * onboarding-checklist and per-document sub-editors are ALSO native now — each
 * delegates to a window.StudentsBridge method (addClearance / removeClearance /
 * saveChecklistItem / saveDocument / removeDocument / saveClearanceType) so the
 * sub-collection writes stay single-sourced with legacy. Per-document/-checklist
 * Google-Drive linking reuses the in-repo global fetchDriveFileMetadata (browser
 * Google OAuth — NO new cross-repo code; degrades to a plain URL when Google
 * isn't connected). The signed per-student waiver link is native here.
 *
 * FLAGGED (still legacy-only, intentionally out of scope here): the tenant-level
 * WAIVER-TEMPLATE tooling (rich-text template editor + signatures viewer) and the
 * public signing pipeline (generateWaiverLink CF + waiver.html). That's a
 * roster/config surface plus a gated CF, NOT a per-student sub-editor — it needs
 * its own V2 home alongside Clearance-Types and Business-Documents config.
 * Flag-gated (?ui=1) at #students-v2, side-by-side.
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

  // Status vocabularies mirror students.js (WAIVER_STATUSES / PHOTO_WAIVER_STATUSES).
  var WAIVER_STATUSES = ['pending', 'signed', 'expired'];
  var PHOTO_WAIVER_STATUSES = ['pending', 'accepted', 'declined'];

  // Onboarding checklist requirements mirror students.js ONBOARDING_FIELDS.
  var ONBOARDING_FIELDS = [
    { key: 'liabilityWaiver', label: 'Liability Waiver' },
    { key: 'safetyOrientation', label: 'Safety Orientation' },
    { key: 'photoRelease', label: 'Photo Release' },
    { key: 'guardianConsent', label: 'Guardian Consent' }
  ];
  // Sub-editor vocabularies — mirror students.js (STORAGE_OPTIONS / DOC_TYPES /
  // doc + checklist status enums) so the native twin writes the identical shape.
  var STORAGE_OPTIONS = [
    { value: 'physical', label: 'Physical' },
    { value: 'google-drive', label: 'Google Drive' },
    { value: 'dropbox', label: 'Dropbox' },
    { value: 'other', label: 'Other' }
  ];
  var DOC_TYPES = ['waiver', 'medical', 'guardian-consent', 'photo-release', 'certification', 'other'];
  var DOC_STATUSES = ['current', 'pending', 'expired', 'not-applicable'];
  var CHECKLIST_STATUSES = ['pending', 'completed', 'not-applicable'];

  // helpers (mirror students.js)
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ') : ''; }
  function studentName(s) { return (s && s.displayName) || 'Unnamed'; }
  function today() { return new Date().toISOString().split('T')[0]; }
  function clearancesOf(s) { return Array.isArray(s.clearances) ? s.clearances : []; }
  function activeClearances(s) {
    var t = today();
    return clearancesOf(s).filter(function (c) { return !c.expiresAt || c.expiresAt >= t; });
  }
  function documentsOf(s) { return Array.isArray(s.documents) ? s.documents : []; }
  // Onboarding gap summary — waiver signed + safety done = onboarded; else list gaps.
  function onboardingLabel(s) {
    var waiverOk = s.waiverStatus === 'signed';
    var safetyOk = s.safetyOrientationCompleted === true;
    if (waiverOk && safetyOk) return 'Onboarded';
    var gaps = [];
    if (!waiverOk) gaps.push('waiver');
    if (!safetyOk) gaps.push('safety');
    return 'Missing: ' + gaps.join(', ');
  }
  function onboardingTone(s) {
    return (s.waiverStatus === 'signed' && s.safetyOrientationCompleted === true) ? 'success' : 'amber';
  }
  function checklistDone(s) {
    var checklist = s.onboardingChecklist || {};
    var n = 0;
    ONBOARDING_FIELDS.forEach(function (f) { if (checklist[f.key] && checklist[f.key].status === 'completed') n++; });
    return n;
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('students-v2', {
    label: 'Student', labelPlural: 'Students', size: 'lg',
    route: 'students-v2',
    recordId: function (s) { return s._key || s.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'displayName', label: 'Name', type: 'text', list: true, readOnly: true, group: 'Profile', get: studentName },
      { name: 'contactId', label: 'Contact', type: 'text', list: true, readOnly: true, get: function (s) { return s.contactId || '—'; } },
      { name: 'onboarding', label: 'Onboarding', type: 'text', list: true, readOnly: true, sortable: false, tone: onboardingTone, get: onboardingLabel },
      { name: 'clearances', label: 'Clearances', type: 'number', list: true, readOnly: true, sortable: false, get: function (s) { return activeClearances(s).length; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'inactive'],
        get: function (s) { return s.status || 'active'; },
        tone: function (v) { return v === 'inactive' ? 'neutral' : 'success'; } }
    ],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return ensureLoaded().then(function () { return V2.byId[id] || null; });
    },
    detail: {
      // Composed from per-pane builders (below) so each editable pane can be
      // re-rendered in place after a sub-edit — the products-v2 rerenderPane
      // convention. Onboarding / Clearances / Documents host native in-pane
      // sub-editors; Overview / Enrollments / Notes are read.
      render: function (UI, s) {
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'onboarding', label: 'Onboarding' },
          { key: 'enrollments', label: 'Enrollments' }, { key: 'clearances', label: 'Clearances' },
          { key: 'documents', label: 'Documents' }, { key: 'notes', label: 'Notes' }
        ], 'ov');
        var dangerZone = can('students', 'delete')
          ? UI.card('Danger zone', '<button class="btn btn-danger btn-small" onclick="StudentsV2.remove(\'' + esc(s._key || s.id) + '\')">Delete student</button>')
          : '';
        return tilesFor(s) + tabsBar +
          paneDiv('ov', overviewPane(s), false) +
          paneDiv('onboarding', onboardingPane(s), true) +
          paneDiv('enrollments', enrollmentsPane(s), true) +
          paneDiv('clearances', clearancesPane(s), true) +
          paneDiv('documents', documentsPane(s), true) +
          paneDiv('notes', notesPane(s), true) + dangerZone;
      },
      // Native edit form — the legacy openStudentForm field set, grouped
      // (Identity / Profile / Emergency / Medical / Onboarding / Internal).
      // Per-clearance / per-document / checklist / waiver-template editors stay
      // bespoke on legacy #students (a partial update here preserves those).
      editRender: function (s, mode) {
        s = s || {};
        var ec = s.emergencyContact || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        function grp(label) { return '<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:14px 0 4px;">' + esc(label) + '</div>'; }
        function opts(list, sel) {
          return list.map(function (o) {
            var val = (typeof o === 'object') ? o.value : o;
            var lab = (typeof o === 'object') ? o.label : cap(o);
            return '<option value="' + esc(val) + '"' + (String(sel) === String(val) ? ' selected' : '') + '>' + esc(lab) + '</option>';
          }).join('');
        }
        var isMinorSel = s.isMinor === true ? 'true' : s.isMinor === false ? 'false' : 'auto';
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New student' : 'Edit this student') + '</div>' +
          grp('Identity') +
          fg('Display name *', '<input class="form-input" id="stV2Name" value="' + esc(s.displayName || '') + '" style="width:100%;" placeholder="Full name">') +
          fg('Contact ID' + (mode === 'create' ? ' *' : ''), '<input class="form-input" id="stV2ContactId" value="' + esc(s.contactId || '') + '" style="width:100%;" placeholder="Contact ID">') +
          grp('Profile') +
          row2(
            fg('Birth date', '<input class="form-input" type="date" id="stV2BirthDate" value="' + esc(s.birthDate || '') + '" style="width:100%;">', true),
            fg('Minor (under 18)', '<select class="form-input" id="stV2IsMinor" style="width:100%;">' + opts([{ value: 'auto', label: 'Auto from birth date' }, { value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], isMinorSel) + '</select>', true)
          ) +
          row2(
            fg('Guardian Contact ID', '<input class="form-input" id="stV2Guardian" value="' + esc(s.guardianContactId || '') + '" style="width:100%;" placeholder="Parent/guardian contact ID">', true),
            fg('Photo waiver status', '<select class="form-input" id="stV2PhotoWaiver" style="width:100%;">' + opts(PHOTO_WAIVER_STATUSES, s.photoWaiverStatus || 'pending') + '</select>', true)
          ) +
          grp('Emergency contact') +
          row2(
            fg('Name', '<input class="form-input" id="stV2EcName" value="' + esc(ec.name || '') + '" style="width:100%;">', true),
            fg('Phone', '<input class="form-input" type="tel" id="stV2EcPhone" value="' + esc(ec.phone || '') + '" style="width:100%;">', true)
          ) +
          fg('Relationship', '<input class="form-input" id="stV2EcRel" value="' + esc(ec.relationship || '') + '" style="width:100%;" placeholder="e.g., Parent, Spouse">') +
          grp('Medical') +
          fg('Allergies', '<input class="form-input" id="stV2Allergies" value="' + esc(s.allergies || '') + '" style="width:100%;" placeholder="Known allergies">') +
          fg('Medical notes', '<textarea class="form-input" id="stV2Medical" rows="2" style="width:100%;resize:vertical;">' + esc(s.medicalNotes || '') + '</textarea>') +
          grp('Onboarding') +
          row2(
            fg('Waiver status', '<select class="form-input" id="stV2Waiver" style="width:100%;">' + opts(WAIVER_STATUSES, s.waiverStatus || 'pending') + '</select>', true),
            fg('Waiver signed date', '<input class="form-input" type="date" id="stV2WaiverDate" value="' + esc(s.waiverSignedAt || '') + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Safety orientation', '<select class="form-input" id="stV2Safety" style="width:100%;">' + opts([{ value: 'false', label: 'Not completed' }, { value: 'true', label: 'Completed' }], s.safetyOrientationCompleted ? 'true' : 'false') + '</select>', true),
            fg('Safety orientation date', '<input class="form-input" type="date" id="stV2SafetyDate" value="' + esc(s.safetyOrientationDate || '') + '" style="width:100%;">', true)
          ) +
          grp('Internal') +
          fg('Instructor notes', '<textarea class="form-input" id="stV2Instructor" rows="2" style="width:100%;resize:vertical;" placeholder="Internal notes (not shown to student)">' + esc(s.instructorNotes || '') + '</textarea>') +
          (mode === 'create' ? '' :
            fg('Status', '<select class="form-input" id="stV2Status" style="width:100%;">' + opts(['active', 'inactive'], s.status || 'active') + '</select>'));
      }
    },
    onSave: function (rec, mode) {
      if (!window.StudentsBridge) { if (window.showToast) showToast('Students engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      var data = {
        displayName: val('stV2Name'),
        contactId: val('stV2ContactId'),
        birthDate: val('stV2BirthDate') || null,
        isMinor: val('stV2IsMinor'),
        guardianContactId: val('stV2Guardian').trim() || null,
        photoWaiverStatus: val('stV2PhotoWaiver') || 'pending',
        emergencyContact: {
          name: val('stV2EcName').trim() || null,
          phone: val('stV2EcPhone').trim() || null,
          relationship: val('stV2EcRel').trim() || null
        },
        allergies: val('stV2Allergies').trim() || null,
        medicalNotes: val('stV2Medical').trim() || null,
        waiverStatus: val('stV2Waiver') || 'pending',
        waiverSignedAt: val('stV2WaiverDate') || null,
        safetyOrientationCompleted: val('stV2Safety') === 'true',
        safetyOrientationDate: val('stV2SafetyDate') || null,
        instructorNotes: val('stV2Instructor').trim() || null,
        status: (mode === 'create') ? undefined : (val('stV2Status') || 'active')
      };
      // Validation mirrors legacy saveStudent: name required; contact ID required
      // on create only.
      if (!data.displayName.trim()) { if (window.showToast) showToast('Display name is required.', true); return false; }
      if (mode === 'create' && !data.contactId.trim()) { if (window.showToast) showToast('Contact ID is required for new students.', true); return false; }

      if (mode === 'create') {
        return Promise.resolve(window.StudentsBridge.create(data)).then(function () {
          if (window.showToast) showToast('Student created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[students-v2] create', e); if (window.showToast) showToast('Error saving student.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.StudentsBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, data);
        if (window.showToast) showToast('Student updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[students-v2] update', e); if (window.showToast) showToast('Error updating student.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, enrollments: [], classMap: {}, clearanceTypes: [], sortKey: 'displayName', sortDir: 'asc', q: '', statusFilter: 'active', loaded: false };

  // Run-once data load shared by route setup and cold drills (fetch gate).
  var _loadPromise = null;
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (!_loadPromise) _loadPromise = loadData();
    return _loadPromise;
  }
  function load() { _loadPromise = null; loadData().then(render); }
  function loadData() {
    // Enrollments load alongside for the Enrollments facet (joins by studentId
    // or email — the storefront writes customerEmail, not studentId).
    return Promise.all([
      Promise.resolve(MastDB.get('students')).catch(function () { return {}; }),
      Promise.resolve(MastDB.enrollments.list(2000)).catch(function () { return {}; }),
      Promise.resolve(MastDB.classes.list(200)).catch(function () { return {}; }),
      // Clearance types power the per-clearance editor's type picker.
      Promise.resolve(MastDB.get('settings/clearanceTypes')).catch(function () { return {}; })
    ]).then(function (res) {
      var val = res[0] || {};
      function toMap(x) { return (x && typeof x.val === 'function') ? (x.val() || {}) : (x || {}); }
      var ev = toMap(res[1]);
      V2.enrollments = Object.keys(ev).map(function (k) { return Object.assign({ _key: k }, ev[k]); });
      V2.classMap = toMap(res[2]);
      var ctVal = res[3] || {};
      V2.clearanceTypes = Object.keys(ctVal).map(function (k) { return Object.assign({ _key: k }, ctVal[k]); });
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var s = val[k];
        if (s && typeof s === 'object') { s = Object.assign({ _key: k }, s); s.status = s.status || 'active'; out.push(s); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true;
    }).catch(function (e) { console.error('[students-v2] load', e); });
  }
  function reloadSoon() { V2.loaded = false; _loadPromise = null; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (s) { return (s.status || 'active') === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (s) {
        return String(s.displayName || '').toLowerCase().indexOf(q) >= 0 ||
               String(s.contactId || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('students-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('studentsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'studentsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="StudentsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Students',
        count: N.count(V2.rows.length) + ' ' + MastFormat.plural(V2.rows.length, 'student'),
        actionsHtml: '<button class="btn btn-primary" onclick="StudentsV2.create()">+ New student</button>' +
          '<button class="btn btn-secondary" onclick="StudentsV2.exportCsv()">↓ Export</button>' +
          // Tenant-level config (waiver templates / clearance types / business
          // documents) lives in the Student settings hub (students-config-v2),
          // not as a roster facet — the legacy #students "view-tabs", re-homed.
          '<button class="btn btn-secondary" onclick="StudentsV2.openSettings()">⚙ Settings</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or contact…" value="' + esc(V2.q) +
        '" oninput="StudentsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('students-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'StudentsV2.sort', onRowClickFnName: 'StudentsV2.open',
        empty: { title: 'No students', message: V2.loaded ? 'Add a student to get started.' : 'Loading…' }
      });
  }

  // ── Faceted-record pane builders + native sub-editors ───────────────
  // Each pane's body is a pure builder so it can be re-rendered in place after
  // a sub-edit (rerenderPane) — mirrors products-v2's pricingPane/rerenderPricingPane.
  function paneDiv(key, inner, hidden) {
    return '<div class="mu-pane" data-pane="' + key + '"' + (hidden ? ' hidden' : '') + '>' + inner + '</div>';
  }
  function rerenderPane(key, inner) {
    var body = document.getElementById('mastSlideOutBody');
    var el = body && body.querySelector('.mu-pane[data-pane="' + key + '"]');
    if (el) el.innerHTML = inner;
  }
  function tilesFor(s) {
    var waiverOk = s.waiverStatus === 'signed', safetyOk = s.safetyOrientationCompleted === true;
    return U.tiles([
      { k: 'Waiver', v: waiverOk ? 'Signed' : cap(s.waiverStatus || 'pending'), hero: true },
      { k: 'Safety orientation', v: safetyOk ? 'Completed' : 'Not completed' },
      { k: 'Photo waiver', v: esc(cap(s.photoWaiverStatus || 'pending')) },
      { k: 'Minor', v: s.isMinor ? 'Yes (under 18)' : 'No' }
    ]);
  }
  function overviewPane(s) {
    var waiverOk = s.waiverStatus === 'signed', safetyOk = s.safetyOrientationCompleted === true;
    var profile = U.kv([
      { k: 'Status', v: U.badge(cap(s.status || 'active'), s.status === 'inactive' ? 'neutral' : 'success') },
      { k: 'Contact ID', v: s.contactId ? esc(s.contactId) : '—' },
      { k: 'Birth date', v: s.birthDate ? esc(s.birthDate) : '—' },
      { k: 'Minor', v: s.isMinor ? 'Yes (under 18)' : 'No' },
      { k: 'Guardian contact', v: (s.isMinor && s.guardianContactId) ? esc(s.guardianContactId) : '—' },
      { k: 'Added', v: s.createdAt ? N.date(s.createdAt) : '—' }
    ]);
    var onboarding = U.kv([
      { k: 'Waiver', v: U.badge(waiverOk ? 'Signed' : cap(s.waiverStatus || 'pending'), waiverOk ? 'success' : 'amber') +
        (s.waiverSignedAt ? ' <span class="mu-sub">' + N.date(s.waiverSignedAt) + '</span>' : '') },
      { k: 'Safety orientation', v: U.badge(safetyOk ? 'Completed' : 'Not completed', safetyOk ? 'success' : 'amber') +
        (s.safetyOrientationDate ? ' <span class="mu-sub">' + N.date(s.safetyOrientationDate) + '</span>' : '') },
      { k: 'Photo waiver', v: esc(cap(s.photoWaiverStatus || 'pending')) },
      { k: 'Checklist', v: checklistDone(s) + ' / ' + ONBOARDING_FIELDS.length + ' complete' }
    ]);
    var ec = s.emergencyContact || {};
    var emerg = ec.name
      ? esc(ec.name + (ec.phone ? ' · ' + ec.phone : '') + (ec.relationship ? ' (' + ec.relationship + ')' : ''))
      : '—';
    // Per-student signed waiver link (anti-forge, audit 2026-06-01 P2): mints a
    // tokened link bound to THIS student via generateWaiverLink — native here.
    var waiverLinkBtn = '<div style="margin-top:12px;"><button class="btn btn-secondary" onclick="StudentsV2.copyWaiverLink(\'' + esc(s._key) + '\')">🔗 Copy waiver link</button> <span class="mu-sub">Signed link tied to this student — send it to them to sign.</span></div>';
    return U.card('Profile', profile) + U.card('Onboarding', onboarding + waiverLinkBtn) +
      U.card('Emergency contact', U.kv([{ k: 'Emergency contact', v: emerg }]));
  }
  function enrollmentsPane(s) {
    var sid = s._key || s.id, sem = String(s.email || '').toLowerCase();
    var myEnrolls = V2.enrollments.filter(function (e) {
      return e.studentId === sid || (sem && String(e.studentEmail || e.customerEmail || '').toLowerCase() === sem);
    }).sort(function (a, b) { return String(b.enrolledAt || '').localeCompare(String(a.enrolledAt || '')); });
    var EN_LABEL = { confirmed: 'Confirmed', waitlisted: 'Waitlist', cancelled: 'Cancelled', 'no-show': 'No-show', completed: 'Attended', late: 'Late', 'checked-in': 'Checked in', 'attended-pending-waiver': 'Attended (waiver pending)', cancelled_by_session: 'Session cancelled' };
    var EN_TONE = { confirmed: 'success', waitlisted: 'amber', cancelled: 'neutral', 'no-show': 'danger', completed: 'teal', late: 'warning', 'checked-in': 'teal', 'attended-pending-waiver': 'amber', cancelled_by_session: 'neutral' };
    var body = myEnrolls.length
      ? U.relatedTable([
          { label: 'Class', render: function (e) {
              var c = e.classId && V2.classMap[e.classId];
              var nm = (c && c.name) || e.classId || '—';
              return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'enrollments-v2\',\'' + esc(e._key) + '\')">' + esc(nm) + '</button>';
          } },
          { label: 'Enrolled', render: function (e) { return e.enrolledAt ? N.date(e.enrolledAt) : '—'; } },
          { label: 'Paid', align: 'right', render: function (e) { return N.money(N.moneyVal(e, 'pricePaidCents', 'pricePaid')) || '—'; } },
          { label: 'Status', render: function (e) { var st = e.status || '—'; return U.badge(EN_LABEL[st] || st, EN_TONE[st] || 'neutral'); } }
        ], myEnrolls)
      : '<span class="mu-sub">No enrollments yet.</span>';
    return U.cardTable('Enrollments (' + myEnrolls.length + ')', body);
  }
  function notesPane(s) {
    function noteBlock(label, text) {
      return '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin:0 0 6px;">' + esc(label) + '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(text) + '</div>';
    }
    var parts = [];
    if (s.allergies) parts.push(noteBlock('Allergies', s.allergies));
    if (s.medicalNotes) parts.push(noteBlock('Medical notes', s.medicalNotes));
    if (s.instructorNotes) parts.push('<div style="margin-top:' + (parts.length ? '12px' : '0') + ';">' + noteBlock('Instructor notes', s.instructorNotes) + '</div>');
    return U.card('Notes', parts.length ? parts.join('') : '<span class="mu-sub">No notes.</span>');
  }

  // ── Onboarding checklist sub-task manager (per-item editor) ──────────
  function onboardingPane(s) {
    var checklist = s.onboardingChecklist || {}, t = today();
    var rows = ONBOARDING_FIELDS.map(function (f) {
      var item = checklist[f.key] || {}, status = item.status || 'pending';
      var tone = status === 'completed' ? 'success' : status === 'not-applicable' ? 'neutral' : 'amber';
      var meta = [];
      if (item.storageLocation) meta.push(cap(item.storageLocation));
      if (item.completedDate) meta.push('Completed ' + item.completedDate);
      if (item.expiryDate) meta.push(item.expiryDate < t ? 'Expired ' + item.expiryDate : 'Expires ' + item.expiryDate);
      if (item.driveFileName) meta.push('📄 ' + item.driveFileName);
      var metaHtml = meta.length ? '<div class="mu-sub" style="margin-top:3px;">' + esc(meta.join(' · ')) + '</div>' : '';
      return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--border,rgba(127,127,127,.15));">' +
        '<div><div>' + U.badge(cap(status), tone) + ' <span style="font-weight:600;margin-left:4px;">' + esc(f.label) + '</span></div>' + metaHtml + '</div>' +
        '<button class="btn btn-small btn-secondary" onclick="StudentsV2.chkEdit(\'' + esc(s._key) + '\',\'' + f.key + '\')">Edit</button>' +
      '</div>';
    }).join('');
    return U.card('Onboarding checklist (' + checklistDone(s) + ' / ' + ONBOARDING_FIELDS.length + ' complete)', rows);
  }
  function checklistForm(s, fieldKey) {
    var field = ONBOARDING_FIELDS.filter(function (f) { return f.key === fieldKey; })[0];
    if (!field) return onboardingPane(s);
    var item = (s.onboardingChecklist || {})[fieldKey] || {};
    var inner =
      fgRow('Status', selectHtml('stV2ChkStatus', CHECKLIST_STATUSES, item.status || 'pending')) +
      fgRow('Storage location', selectHtml('stV2ChkStorage', [{ value: '', label: '—' }].concat(STORAGE_OPTIONS), item.storageLocation || '')) +
      fgRow('Completed date', dateHtml('stV2ChkCompleted', item.completedDate)) +
      fgRow('Expiry date', dateHtml('stV2ChkExpiry', item.expiryDate)) +
      driveField('Chk', item.documentUrl, item) +
      fgRow('Notes', '<textarea class="form-input" id="stV2ChkNotes" rows="2" style="width:100%;resize:vertical;">' + esc(item.notes || '') + '</textarea>') +
      formButtons('StudentsV2.chkSave(\'' + esc(s._key) + '\',\'' + fieldKey + '\')', 'StudentsV2.chkCancel(\'' + esc(s._key) + '\')', 'Save');
    return U.card('Edit: ' + esc(field.label), inner);
  }

  // ── Per-clearance editor (type picker + inline new-type + expiry logic) ──
  function clearancesPane(s) {
    var clr = clearancesOf(s), t = today();
    var addBtn = '<button class="btn btn-small btn-secondary" onclick="StudentsV2.clrAdd(\'' + esc(s._key) + '\')">+ Add</button>';
    var rows = clr.map(function (c, i) { return Object.assign({ _idx: i }, c); });
    var table = clr.length ? U.relatedTable([
      { label: 'Clearance', render: function (c) { return esc(c.label || c.clearanceId || '—'); } },
      { label: 'Cleared', render: function (c) {
        var by = (c.clearedAt || '') + (c.clearedBy ? ' by ' + c.clearedBy : '');
        return by ? '<span class="mu-sub">' + esc(by) + '</span>' : '<span class="mu-sub">—</span>'; } },
      { label: 'Status', render: function (c) {
        var expired = c.expiresAt && c.expiresAt < t;
        if (expired) return U.badge('Expired ' + c.expiresAt, 'danger');
        return U.badge(c.expiresAt ? ('Expires ' + c.expiresAt) : 'Active', 'success'); } },
      { label: '', align: 'right', render: function (c) { return '<button class="btn btn-small btn-danger" onclick="StudentsV2.clrRemove(\'' + esc(s._key) + '\',' + c._idx + ')">Remove</button>'; } }
    ], rows) : '<span class="mu-sub">No clearances on file.</span>';
    return U.card('Clearances (' + activeClearances(s).length + ' active · ' + clr.length + ' total)', table, { headerRight: addBtn });
  }
  function clearanceForm(s) {
    var typeOpts = V2.clearanceTypes.map(function (ct) { return '<option value="' + esc(ct._key) + '">' + esc(ct.label || ct._key) + '</option>'; }).join('');
    var inner =
      fgRow('Clearance type *', '<select class="form-input" id="stV2ClType" onchange="StudentsV2.clrTypeChange()" style="width:100%;"><option value="">Select…</option>' + typeOpts + '<option value="__new__">+ New clearance type…</option></select>') +
      '<div id="stV2ClNewWrap" style="display:none;border-left:2px solid var(--teal);padding-left:10px;margin:0 0 10px;">' +
        fgRow('New type name', '<input class="form-input" id="stV2ClNewLabel" style="width:100%;" placeholder="e.g., Torch Safety">') +
        fgRow('Requires expiry', selectHtml('stV2ClNewExpiry', [{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }], 'false')) +
      '</div>' +
      fgRow('Cleared by *', '<input class="form-input" id="stV2ClBy" style="width:100%;" placeholder="Staff member name">') +
      fgRow('Expires at', dateHtml('stV2ClExpires', '')) +
      fgRow('Notes', '<textarea class="form-input" id="stV2ClNotes" rows="2" style="width:100%;resize:vertical;"></textarea>') +
      formButtons('StudentsV2.clrSave(\'' + esc(s._key) + '\')', 'StudentsV2.clrCancel(\'' + esc(s._key) + '\')', 'Add clearance');
    return U.card('New clearance', inner);
  }

  // ── Per-document editor (+ optional Google-Drive linking) ────────────
  function documentsPane(s) {
    var docs = documentsOf(s);
    var addBtn = '<button class="btn btn-small btn-secondary" onclick="StudentsV2.docAdd(\'' + esc(s._key) + '\')">+ New</button>';
    var rows = docs.map(function (d, i) { return Object.assign({ _idx: i }, d); });
    var table = docs.length ? U.relatedTable([
      { label: 'Document', render: function (d) { return esc(d.title || 'Untitled') + (d.driveFileName ? ' <span class="mu-sub">· 📄 ' + esc(d.driveFileName) + '</span>' : ''); } },
      { label: 'Type', render: function (d) { return '<span class="mu-sub">' + esc(cap(d.type || 'other')) + '</span>'; } },
      { label: 'Status', render: function (d) {
        var st = d.status || 'pending';
        var tone = st === 'current' ? 'success' : st === 'expired' ? 'danger' : 'amber';
        return U.badge(cap(st), tone); } },
      { label: '', align: 'right', render: function (d) {
        return '<button class="btn btn-small btn-secondary" onclick="StudentsV2.docEdit(\'' + esc(s._key) + '\',' + d._idx + ')">Edit</button> ' +
          '<button class="btn btn-small btn-danger" onclick="StudentsV2.docRemove(\'' + esc(s._key) + '\',' + d._idx + ')">Remove</button>'; } }
    ], rows) : '<span class="mu-sub">No documents on file.</span>';
    return U.card('Documents (' + docs.length + ')', table, { headerRight: addBtn });
  }
  function documentForm(s, idx) {
    var docs = documentsOf(s);
    var isNew = (idx == null);
    var d = (!isNew && docs[idx]) ? docs[idx] : {};
    var inner =
      fgRow('Title *', '<input class="form-input" id="stV2DocTitle" value="' + esc(d.title || '') + '" style="width:100%;" placeholder="Document title">') +
      fgRow('Type', selectHtml('stV2DocType', DOC_TYPES, d.type || 'other')) +
      fgRow('Status', selectHtml('stV2DocStatus', DOC_STATUSES, d.status || 'current')) +
      fgRow('Storage location', selectHtml('stV2DocStorage', [{ value: '', label: '—' }].concat(STORAGE_OPTIONS), d.storageLocation || '')) +
      fgRow('On-file date', dateHtml('stV2DocOnFile', d.onFileDate)) +
      fgRow('Expiry date', dateHtml('stV2DocExpiry', d.expiryDate)) +
      driveField('Doc', d.documentUrl, d) +
      fgRow('Description', '<textarea class="form-input" id="stV2DocDesc" rows="2" style="width:100%;resize:vertical;">' + esc(d.description || '') + '</textarea>') +
      fgRow('Notes', '<textarea class="form-input" id="stV2DocNotes" rows="2" style="width:100%;resize:vertical;">' + esc(d.notes || '') + '</textarea>') +
      formButtons('StudentsV2.docSave(\'' + esc(s._key) + '\',' + (isNew ? 'null' : idx) + ')', 'StudentsV2.docCancel(\'' + esc(s._key) + '\')', isNew ? 'Create document' : 'Save');
    return U.card(isNew ? 'New document' : 'Edit document', inner);
  }

  // Small form-control helpers (kept local so the sub-editors read uniformly).
  function fgRow(label, inner) { return '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
  function formButtons(saveCall, cancelCall, saveLabel) {
    return '<div style="display:flex;gap:8px;margin-top:14px;"><button class="btn btn-primary btn-small" onclick="' + saveCall + '">' + esc(saveLabel || 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="' + cancelCall + '">Cancel</button></div>';
  }
  function selectHtml(id, options, sel) {
    var opts = options.map(function (o) {
      var v = (o && typeof o === 'object') ? o.value : o;
      var l = (o && typeof o === 'object') ? o.label : cap(o);
      return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
    return '<select class="form-input" id="' + id + '" style="width:100%;">' + opts + '</select>';
  }
  function dateHtml(id, val) { return '<input class="form-input" type="date" id="' + id + '" value="' + esc(val || '') + '" style="width:100%;">'; }

  // Google-Drive link field — plain URL input + (when a Drive share link is
  // pasted) an auto-fetched file preview. The metadata fetch reuses the in-repo
  // global fetchDriveFileMetadata (browser Google OAuth via requestGoogleOAuthToken);
  // NO new cross-repo code. Degrades to a plain URL when Google isn't connected.
  function isDriveUrl(url) { return url && /drive\.google\.com|docs\.google\.com/.test(url); }
  function drivePreview(prefix, drive) {
    return '<div style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);border-radius:6px;padding:6px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;">' +
      '<span style="font-size:0.85rem;">📄 <strong>' + esc(drive.driveFileName || '') + '</strong>' + (drive.driveLastModified ? ' · ' + esc(String(drive.driveLastModified).split('T')[0]) : '') + '</span>' +
      '<button type="button" class="btn btn-small btn-secondary" onclick="StudentsV2.driveUnlink(\'' + prefix + '\')">Unlink</button></div>';
  }
  function driveField(prefix, url, drive) {
    drive = drive || {};
    return '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">Document URL or Google Drive link</label>' +
      '<input class="form-input" id="stV2' + prefix + 'Url" value="' + esc(url || '') + '" style="width:100%;" placeholder="https://drive.google.com/file/d/…" onblur="StudentsV2.driveBlur(\'' + prefix + '\')">' +
      '<div id="stV2' + prefix + 'Drive" data-fileid="' + esc(drive.driveFileId || '') + '" data-filename="' + esc(drive.driveFileName || '') + '" data-modified="' + esc(drive.driveLastModified || '') + '" style="margin-top:6px;' + (drive.driveFileName ? '' : 'display:none;') + '">' + (drive.driveFileName ? drivePreview(prefix, drive) : '') + '</div>' +
      '<div class="mu-sub" style="margin-top:4px;">Paste a Drive share link to auto-link the file (needs a Google connection — otherwise just stores the URL).</div></div>';
  }
  function collectDrive(prefix) {
    var el = document.getElementById('stV2' + prefix + 'Drive');
    if (el && el.dataset && el.dataset.filename) {
      return { driveFileId: el.dataset.fileid || null, driveFileName: el.dataset.filename || null, driveLastModified: el.dataset.modified || null };
    }
    return { driveFileId: null, driveFileName: null, driveLastModified: null };
  }

  function bridge() {
    if (window.StudentsBridge && typeof window.StudentsBridge.addClearance === 'function') return window.StudentsBridge;
    if (window.showToast) showToast('Students engine still loading — try again', true);
    return null;
  }

  window.StudentsV2 = {
    remove: function (id) {
      if (!can('students', 'delete')) { if (window.showToast) showToast('Delete access required.', true); return; }
      if (!window.StudentsBridge || !window.StudentsBridge.remove) { if (window.showToast) showToast('Engine still loading — try again', true); return; }
      var rec = V2.byId[id];
      var em = ((rec && rec.email) || '').toLowerCase();
      var refs = V2.enrollments.filter(function (e) { return e.studentId === id || (em && String(e.studentEmail || e.customerEmail || '').toLowerCase() === em); }).length;
      var msg = 'Delete the student "' + ((rec && rec.displayName) || '') + '"?' + (refs ? ' They have ' + MastFormat.countNoun(refs, 'enrollment') + ' — enrollment history keeps the name but loses the profile (waivers, clearances, documents).' : '') + ' This cannot be undone.';
      mastConfirm(msg, { title: 'Delete Student', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(window.StudentsBridge.remove(id)).then(function () {
          delete V2.byId[id];
          V2.rows = V2.rows.filter(function (x) { return (x._key || x.id) !== id; });
          if (window.showToast) showToast('Student deleted');
          try { U.slideOut.requestClose(); } catch (_) {}
          render();
        }).catch(function (e) { if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true); });
      });
    },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('students-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('students-v2', rec, 'read');
      });
    },
    create: function () {
      MastEntity.openRecord('students-v2', {}, 'create');
    },
    // Mint + copy a signed per-student waiver link (anti-forge, audit 2026-06-01
    // P2). Calls the admin-gated generateWaiverLink CF; the returned URL carries
    // an HMAC token bound to studentId so submitWaiverSignature flips only that
    // student. The browser can't hold the signing key, so minting is server-side.
    copyWaiverLink: function (id) {
      var tid = (window.MastDB && MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || '';
      if (window.showToast) showToast('Generating waiver link…');
      return firebase.functions().httpsCallable('generateWaiverLink')({ tenantId: tid, studentId: id })
        .then(function (res) {
          var url = res && res.data && res.data.url;
          if (!url) throw new Error('No link returned');
          if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(url).then(function () { if (window.showToast) showToast('Per-student waiver link copied'); });
          }
          if (typeof mastCopyFallback === 'function') mastCopyFallback('Copy this waiver link', url);
        })
        .catch(function (err) {
          var msg = (err && (err.message || (err.details && err.details.message))) || 'Failed to generate link';
          if (window.showToast) showToast('Could not generate waiver link: ' + msg, true);
        });
    },
    exportCsv: function () { return MastEntity.exportRows('students-v2', visibleRows(), V2.statusFilter); },
    // Tenant-level Student settings (waiver templates / clearance types / business
    // documents) — the legacy #students config view-tabs, re-homed at students-config-v2.
    openSettings: function () { if (typeof window.navigateTo === 'function') navigateTo('students-config-v2'); else location.hash = '#students-config-v2'; },

    // ── Onboarding checklist sub-task editor ──────────────────────────
    chkEdit: function (id, key) { var s = V2.byId[id]; if (s) rerenderPane('onboarding', checklistForm(s, key)); },
    chkCancel: function (id) { var s = V2.byId[id]; if (s) rerenderPane('onboarding', onboardingPane(s)); },
    chkSave: function (id, key) {
      var b = bridge(); if (!b) return;
      var fields = {
        status: (document.getElementById('stV2ChkStatus') || {}).value || 'pending',
        storageLocation: (document.getElementById('stV2ChkStorage') || {}).value || null,
        completedDate: (document.getElementById('stV2ChkCompleted') || {}).value || null,
        expiryDate: (document.getElementById('stV2ChkExpiry') || {}).value || null,
        documentUrl: (document.getElementById('stV2ChkUrl') || {}).value || null,
        notes: ((document.getElementById('stV2ChkNotes') || {}).value || '').trim() || null
      };
      Object.assign(fields, collectDrive('Chk'));
      Promise.resolve(b.saveChecklistItem(id, key, fields)).then(function () {
        var rec = V2.byId[id]; if (!rec) return;
        rec.onboardingChecklist = rec.onboardingChecklist || {};
        rec.onboardingChecklist[key] = Object.assign({}, rec.onboardingChecklist[key], fields);
        if (window.showToast) showToast('Checklist updated');
        rerenderPane('onboarding', onboardingPane(rec));
        rerenderPane('ov', overviewPane(rec));   // checklist count + tiles live on Overview
        reloadSoon();
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
    },

    // ── Per-clearance editor ──────────────────────────────────────────
    clrAdd: function (id) { var s = V2.byId[id]; if (s) rerenderPane('clearances', clearanceForm(s)); },
    clrCancel: function (id) { var s = V2.byId[id]; if (s) rerenderPane('clearances', clearancesPane(s)); },
    clrTypeChange: function () {
      var sel = document.getElementById('stV2ClType'), wrap = document.getElementById('stV2ClNewWrap');
      if (sel && wrap) wrap.style.display = (sel.value === '__new__') ? '' : 'none';
    },
    clrSave: function (id) {
      var b = bridge(); if (!b) return;
      var typeVal = (document.getElementById('stV2ClType') || {}).value || '';
      var clearedBy = ((document.getElementById('stV2ClBy') || {}).value || '').trim();
      var expiresAt = (document.getElementById('stV2ClExpires') || {}).value || null;
      var notes = ((document.getElementById('stV2ClNotes') || {}).value || '').trim() || null;
      if (!typeVal) { if (window.showToast) showToast('Select a clearance type', true); return; }
      if (!clearedBy) { if (window.showToast) showToast('Cleared by is required', true); return; }
      function persist(ct) {
        // Expiry logic mirrors legacy saveClearance: a type that requires expiry
        // can't be cleared without an expiry date.
        if (ct.requiresExpiry && !expiresAt) { if (window.showToast) showToast('This clearance type requires an expiry date', true); return; }
        var entry = { clearanceId: ct._key, label: ct.label || ct._key, clearedAt: today(), clearedBy: clearedBy, expiresAt: expiresAt, notes: notes };
        Promise.resolve(b.addClearance(id, entry)).then(function (arr) {
          var rec = V2.byId[id]; if (rec) rec.clearances = arr;
          if (window.showToast) showToast('Clearance added');
          rerenderPane('clearances', clearancesPane(rec || { _key: id, clearances: arr }));
          reloadSoon();
        }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      }
      if (typeVal === '__new__') {
        var label = ((document.getElementById('stV2ClNewLabel') || {}).value || '').trim();
        var reqExp = (document.getElementById('stV2ClNewExpiry') || {}).value === 'true';
        if (!label) { if (window.showToast) showToast('Enter a name for the new clearance type', true); return; }
        Promise.resolve(b.saveClearanceType(null, { label: label, requiresExpiry: reqExp, description: null })).then(function (ct) {
          V2.clearanceTypes.push(ct); persist(ct);
        }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      } else {
        var ct = V2.clearanceTypes.filter(function (x) { return x._key === typeVal; })[0];
        if (!ct) { if (window.showToast) showToast('Clearance type not found', true); return; }
        persist(ct);
      }
    },
    clrRemove: function (id, idx) {
      var b = bridge(); if (!b) return;
      mastConfirm('Remove this clearance?', { title: 'Remove clearance', confirmLabel: 'Remove', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(b.removeClearance(id, Number(idx))).then(function (arr) {
          var rec = V2.byId[id]; if (rec) rec.clearances = arr;
          if (window.showToast) showToast('Clearance removed');
          rerenderPane('clearances', clearancesPane(rec || { _key: id, clearances: arr }));
          reloadSoon();
        }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      });
    },

    // ── Per-document editor (+ Google-Drive linking) ──────────────────
    docAdd: function (id) { var s = V2.byId[id]; if (s) rerenderPane('documents', documentForm(s, null)); },
    docEdit: function (id, idx) { var s = V2.byId[id]; if (s) rerenderPane('documents', documentForm(s, Number(idx))); },
    docCancel: function (id) { var s = V2.byId[id]; if (s) rerenderPane('documents', documentsPane(s)); },
    docSave: function (id, idx) {
      var b = bridge(); if (!b) return;
      var title = ((document.getElementById('stV2DocTitle') || {}).value || '').trim();
      if (!title) { if (window.showToast) showToast('Title is required', true); return; }
      var record = {
        title: title,
        type: (document.getElementById('stV2DocType') || {}).value || 'other',
        status: (document.getElementById('stV2DocStatus') || {}).value || 'current',
        storageLocation: (document.getElementById('stV2DocStorage') || {}).value || null,
        onFileDate: (document.getElementById('stV2DocOnFile') || {}).value || null,
        expiryDate: (document.getElementById('stV2DocExpiry') || {}).value || null,
        documentUrl: (document.getElementById('stV2DocUrl') || {}).value || null,
        description: ((document.getElementById('stV2DocDesc') || {}).value || '').trim() || null,
        notes: ((document.getElementById('stV2DocNotes') || {}).value || '').trim() || null
      };
      Object.assign(record, collectDrive('Doc'));
      var di = (idx === null || idx === 'null' || idx == null) ? null : Number(idx);
      Promise.resolve(b.saveDocument(id, di, record)).then(function (arr) {
        var rec = V2.byId[id]; if (rec) rec.documents = arr;
        if (window.showToast) showToast(di != null ? 'Document saved' : 'Document added');
        rerenderPane('documents', documentsPane(rec || { _key: id, documents: arr }));
        reloadSoon();
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
    },
    docRemove: function (id, idx) {
      var b = bridge(); if (!b) return;
      mastConfirm('Delete this document?', { title: 'Delete document', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(b.removeDocument(id, Number(idx))).then(function (arr) {
          var rec = V2.byId[id]; if (rec) rec.documents = arr;
          if (window.showToast) showToast('Document deleted');
          rerenderPane('documents', documentsPane(rec || { _key: id, documents: arr }));
          reloadSoon();
        }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
      });
    },

    // ── Google-Drive link helpers (shared by checklist + document forms) ──
    driveBlur: function (prefix) {
      var input = document.getElementById('stV2' + prefix + 'Url'); if (!input) return;
      var url = (input.value || '').trim();
      if (!isDriveUrl(url)) return;
      var box = document.getElementById('stV2' + prefix + 'Drive'); if (!box) return;
      if (typeof fetchDriveFileMetadata !== 'function') return;   // Drive helper unavailable — keep the plain URL
      box.style.display = ''; box.innerHTML = '<span class="mu-sub">Fetching file info…</span>';
      Promise.resolve(fetchDriveFileMetadata(url)).then(function (meta) {
        if (!meta) { box.innerHTML = '<span class="mu-sub" style="color:var(--danger);">Could not fetch Drive file.</span>'; return; }
        var m = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        box.dataset.fileid = (m && m[1]) || '';
        box.dataset.filename = meta.name || '';
        box.dataset.modified = meta.modifiedTime || '';
        box.innerHTML = drivePreview(prefix, { driveFileName: meta.name, driveLastModified: meta.modifiedTime });
      }).catch(function () { box.innerHTML = '<span class="mu-sub" style="color:var(--danger);">Drive fetch failed.</span>'; });
    },
    driveUnlink: function (prefix) {
      var box = document.getElementById('stV2' + prefix + 'Drive');
      if (box) { box.innerHTML = ''; box.style.display = 'none'; box.dataset.fileid = ''; box.dataset.filename = ''; box.dataset.modified = ''; }
      var input = document.getElementById('stV2' + prefix + 'Url'); if (input) input.value = '';
    }
  };

  MastAdmin.registerModule('students-v2', {
    routes: {
      'students-v2': { tab: 'studentsV2Tab', setup: function () { ensureTab(); render(); load(); } },
      // Legacy #students route ABSORBED (T6): students.js is deleted, so the twin
      // owns the bare route directly (no MAST_V2_ROUTE_MAP remap). The write path
      // (window.StudentsBridge) lives in the non-flag-gated IIFE appended below.
      'students': { tab: 'studentsV2Tab', setup: function () { ensureTab(); render(); load(); } }
    }
  });
})();


// ============================================================================
// ABSORBED FROM students.js (V1) — T6 retirement (absorb-first cut).
//
// students-v2 (roster) + students-config-v2 (settings hub) are the sole students
// surfaces; the V1 students.js UI is deleted. This self-contained, NON-flag-gated
// IIFE re-hosts — VERBATIM (byte-identical) — window.StudentsBridge, the write
// path students-v2 single-sources through (create / update / remove + the native
// sub-editors addClearance / removeClearance / saveChecklistItem / saveDocument /
// removeDocument / saveClearanceType), plus its two transitive helpers
// (buildStudentFields field-transform + writeStudent, which make the EXACT writes
// the legacy saveStudent did). It references only shell globals (MastDB /
// writeAudit / Date) plus its own closure. The legacy `studentsLoaded` list-cache
// flag is carried as a private var so the bridge's invalidations stay no-ops (the
// V1 list it gated is gone). Not flag-gated: the bridge must exist for students-v2
// regardless of the UI-redesign flag.
// ============================================================================
(function () {
  'use strict';

  // V1 list-cache flag; the bridge invalidates it on every write. No reader
  // survives the retire (the V1 roster is gone), so these stay harmless no-ops.
  var studentsLoaded = false;

  function buildStudentFields(data, isNew) {
    data = data || {};
    var birthDate = data.birthDate || null;
    var fields = {
      displayName: (data.displayName || '').trim(),
      contactId: (data.contactId || '').trim() || null,
      birthDate: birthDate || null,
      guardianContactId: data.guardianContactId || null,
      photoWaiverStatus: data.photoWaiverStatus || 'pending',
      emergencyContact: {
        name: (data.emergencyContact && data.emergencyContact.name) || null,
        phone: (data.emergencyContact && data.emergencyContact.phone) || null,
        relationship: (data.emergencyContact && data.emergencyContact.relationship) || null,
      },
      allergies: data.allergies || null,
      medicalNotes: data.medicalNotes || null,
      waiverStatus: data.waiverStatus || 'pending',
      waiverSignedAt: data.waiverSignedAt || null,
      safetyOrientationCompleted: data.safetyOrientationCompleted === true,
      safetyOrientationDate: data.safetyOrientationDate || null,
      instructorNotes: data.instructorNotes || null,
    };
    // isMinor: 'true'/'false' manual override, else auto-compute from birthDate.
    var isMinorSelect = data.isMinor;
    if (isMinorSelect === true || isMinorSelect === 'true') fields.isMinor = true;
    else if (isMinorSelect === false || isMinorSelect === 'false') fields.isMinor = false;
    else if (birthDate) {
      var birth = new Date(birthDate);
      var now = new Date();
      var age = now.getFullYear() - birth.getFullYear();
      var m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
      fields.isMinor = age < 18;
    }
    if (!isNew && data.status) fields.status = data.status || 'active';
    return fields;
  }

  // Make the EXACT write saveStudent() makes: a full `set` for a new student
  // (seeding status/clearances/documents/onboardingChecklist) or a partial
  // `update` for an existing one. Returns the student id.
  async function writeStudent(id, fields, isNew) {
    if (isNew) {
      id = MastDB.newKey('students');
      fields.createdAt = new Date().toISOString();
      fields.status = 'active';
      fields.clearances = [];
      fields.documents = [];
      fields.onboardingChecklist = {
        liabilityWaiver: { status: fields.waiverStatus === 'signed' ? 'completed' : 'pending' },
        safetyOrientation: { status: fields.safetyOrientationCompleted ? 'completed' : 'pending' },
        photoRelease: { status: fields.photoWaiverStatus === 'accepted' ? 'completed' : 'pending' },
        guardianConsent: { status: fields.isMinor ? 'pending' : 'not-applicable' },
      };
      await MastDB.set('students/' + id, fields);
    } else {
      fields.updatedAt = new Date().toISOString();
      await MastDB.update('students/' + id, fields);
    }
    return id;
  }

  window.StudentsBridge = {
    create: async function (data) {
      var fields = buildStudentFields(data, true);
      var id = await writeStudent(null, fields, true);
      studentsLoaded = false;
      return id;
    },
    update: async function (id, data) {
      var fields = buildStudentFields(data, false);
      await writeStudent(id, fields, false);
      studentsLoaded = false;
      return id;
    },
    // Hard delete (the twin confirms + checks enrollment references first).
    remove: async function (id) {
      await MastDB.remove('students/' + id);
      studentsLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'student', id);
      return true;
    },
    // ── Sub-collection editors (students-v2 native sub-editors) ──────────
    // Clearances + documents are arrays and the onboarding checklist is a map on
    // the student doc; legacy edits them via saveClearance / saveDoc / saveChecklist.
    // These make the SAME writes (same paths + updatedAt stamping) so the twin's
    // in-pane sub-editors stay single-sourced. Each reads the live doc, applies the
    // change by index/key, writes back, and returns the new value for the twin to
    // mirror into its cache. (The twin builds the entry/record shape — there is no
    // field transform here, unlike buildStudentFields.)
    addClearance: async function (studentId, entry) {
      var stu = (await MastDB.get('students/' + studentId)) || {};
      var clearances = Array.isArray(stu.clearances) ? stu.clearances.slice() : [];
      clearances.push(entry);
      await MastDB.set('students/' + studentId + '/clearances', clearances);
      await MastDB.set('students/' + studentId + '/updatedAt', new Date().toISOString());
      studentsLoaded = false;
      if (window.writeAudit) writeAudit('create', 'student-clearance', studentId);
      return clearances;
    },
    removeClearance: async function (studentId, idx) {
      var stu = (await MastDB.get('students/' + studentId)) || {};
      var clearances = Array.isArray(stu.clearances) ? stu.clearances.slice() : [];
      if (idx < 0 || idx >= clearances.length) return clearances;
      clearances.splice(idx, 1);
      await MastDB.set('students/' + studentId + '/clearances', clearances);
      await MastDB.set('students/' + studentId + '/updatedAt', new Date().toISOString());
      studentsLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'student-clearance', studentId);
      return clearances;
    },
    saveChecklistItem: async function (studentId, fieldKey, fields) {
      await MastDB.update('students/' + studentId + '/onboardingChecklist/' + fieldKey, fields);
      await MastDB.set('students/' + studentId + '/updatedAt', new Date().toISOString());
      studentsLoaded = false;
      if (window.writeAudit) writeAudit('update', 'student-checklist', studentId);
      return fields;
    },
    saveDocument: async function (studentId, docIdx, record) {
      var stu = (await MastDB.get('students/' + studentId)) || {};
      var docs = Array.isArray(stu.documents) ? stu.documents.slice() : [];
      var now = new Date().toISOString();
      var isNew = !(docIdx != null && docs[docIdx]);
      if (docIdx != null && docs[docIdx]) {
        docs[docIdx] = Object.assign({}, docs[docIdx], record, { updatedAt: now });
      } else {
        docs.push(Object.assign({ documentId: MastUtil.genId('doc_'), createdAt: now }, record, { updatedAt: now }));
      }
      await MastDB.set('students/' + studentId + '/documents', docs);
      await MastDB.set('students/' + studentId + '/updatedAt', now);
      studentsLoaded = false;
      if (window.writeAudit) writeAudit(isNew ? 'create' : 'update', 'student-document', studentId);
      return docs;
    },
    removeDocument: async function (studentId, docIdx) {
      var stu = (await MastDB.get('students/' + studentId)) || {};
      var docs = Array.isArray(stu.documents) ? stu.documents.slice() : [];
      if (docIdx < 0 || docIdx >= docs.length) return docs;
      docs.splice(docIdx, 1);
      await MastDB.set('students/' + studentId + '/documents', docs);
      await MastDB.set('students/' + studentId + '/updatedAt', new Date().toISOString());
      studentsLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'student-document', studentId);
      return docs;
    },
    // Clearance types are a tenant-level settings map (settings/clearanceTypes);
    // the twin lets the user create one inline from the clearance editor so it
    // isn't blocked when none exist yet. Mirrors legacy saveClearanceType.
    saveClearanceType: async function (typeId, fields) {
      if (typeId) {
        await MastDB.update('settings/clearanceTypes/' + typeId, fields);
        if (window.writeAudit) writeAudit('update', 'clearance-type', typeId);
        return Object.assign({ _key: typeId }, fields);
      }
      var key = MastDB.newKey('settings/clearanceTypes');
      fields.createdAt = new Date().toISOString();
      await MastDB.set('settings/clearanceTypes/' + key, fields);
      if (window.writeAudit) writeAudit('create', 'clearance-type', key);
      return Object.assign({ _key: key }, fields);
    }
  };
})();
