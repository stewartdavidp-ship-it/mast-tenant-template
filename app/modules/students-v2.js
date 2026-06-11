/**
 * students-v2.js — read-focused Faceted Record twin of the legacy Students
 * roster surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy students.js (#students) hosts a multi-view admin: a roster of student
 * records with an in-pane detail (renderStudentDetail) plus Clearance-Types,
 * Business-Documents and Waiver-template tooling. This twin re-hosts ONE of
 * those surfaces — the roster -> read detail — on the Entity Engine: a
 * schema-driven list + a read-focused Faceted Record slide-out
 * (Overview / Clearances / Documents / Notes facets).
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
 * logic (mirrors the contacts-v2 / ContactsBridge precedent). The per-checklist,
 * per-clearance, per-document editors with Google-Drive linking + the waiver
 * template tooling remain bespoke on legacy #students (no V2 home). The signed
 * per-student waiver link is native here. Flag-gated (?ui=1) at #students-v2,
 * side-by-side.
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
      render: function (UI, s) {
        var waiverOk = s.waiverStatus === 'signed';
        var safetyOk = s.safetyOrientationCompleted === true;
        var tiles = UI.tiles([
          { k: 'Waiver', v: waiverOk ? 'Signed' : cap(s.waiverStatus || 'pending'), hero: true },
          { k: 'Safety orientation', v: safetyOk ? 'Completed' : 'Not completed' },
          { k: 'Photo waiver', v: esc(cap(s.photoWaiverStatus || 'pending')) },
          { k: 'Minor', v: s.isMinor ? 'Yes (under 18)' : 'No' }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'enrollments', label: 'Enrollments' },
          { key: 'clearances', label: 'Clearances' },
          { key: 'documents', label: 'Documents' }, { key: 'notes', label: 'Notes' }
        ], 'ov');

        // Enrollments — joined by studentId OR email (the storefront writes
        // customerEmail, not studentId); rows drill to the enrollment record.
        var sid = s._key || s.id, sem = String(s.email || '').toLowerCase();
        var myEnrolls = V2.enrollments.filter(function (e) {
          return e.studentId === sid || (sem && String(e.studentEmail || e.customerEmail || '').toLowerCase() === sem);
        }).sort(function (a, b) { return String(b.enrolledAt || '').localeCompare(String(a.enrolledAt || '')); });
        var EN_LABEL = { confirmed: 'Confirmed', waitlisted: 'Waitlist', cancelled: 'Cancelled', 'no-show': 'No-show', completed: 'Attended', late: 'Late', 'checked-in': 'Checked in', 'attended-pending-waiver': 'Attended (waiver pending)', cancelled_by_session: 'Session cancelled' };
        var EN_TONE = { confirmed: 'success', waitlisted: 'amber', cancelled: 'neutral', 'no-show': 'danger', completed: 'teal', late: 'warning', 'checked-in': 'teal', 'attended-pending-waiver': 'amber', cancelled_by_session: 'neutral' };
        var enrollsBody = myEnrolls.length
          ? UI.relatedTable([
              { label: 'Class', render: function (e) {
                  var c = e.classId && V2.classMap[e.classId];
                  var nm = (c && c.name) || e.classId || '—';
                  return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'enrollments-v2\',\'' + esc(e._key) + '\')">' + esc(nm) + '</button>';
              } },
              { label: 'Enrolled', render: function (e) { return e.enrolledAt ? N.date(e.enrolledAt) : '—'; } },
              { label: 'Paid', align: 'right', render: function (e) { return N.money(N.moneyVal(e, 'pricePaidCents', 'pricePaid')) || '—'; } },
              { label: 'Status', render: function (e) { var st = e.status || '—'; return UI.badge(EN_LABEL[st] || st, EN_TONE[st] || 'neutral'); } }
            ], myEnrolls)
          : '<span class="mu-sub">No enrollments yet.</span>';

        // Overview — profile + onboarding + emergency contact.
        var profile = UI.kv([
          { k: 'Status', v: UI.badge(cap(s.status || 'active'), s.status === 'inactive' ? 'neutral' : 'success') },
          { k: 'Contact ID', v: s.contactId ? esc(s.contactId) : '—' },
          { k: 'Birth date', v: s.birthDate ? esc(s.birthDate) : '—' },
          { k: 'Minor', v: s.isMinor ? 'Yes (under 18)' : 'No' },
          { k: 'Guardian contact', v: (s.isMinor && s.guardianContactId) ? esc(s.guardianContactId) : '—' },
          { k: 'Added', v: s.createdAt ? N.date(s.createdAt) : '—' }
        ]);
        var onboarding = UI.kv([
          { k: 'Waiver', v: UI.badge(waiverOk ? 'Signed' : cap(s.waiverStatus || 'pending'), waiverOk ? 'success' : 'amber') +
            (s.waiverSignedAt ? ' <span class="mu-sub">' + N.date(s.waiverSignedAt) + '</span>' : '') },
          { k: 'Safety orientation', v: UI.badge(safetyOk ? 'Completed' : 'Not completed', safetyOk ? 'success' : 'amber') +
            (s.safetyOrientationDate ? ' <span class="mu-sub">' + N.date(s.safetyOrientationDate) + '</span>' : '') },
          { k: 'Photo waiver', v: esc(cap(s.photoWaiverStatus || 'pending')) },
          { k: 'Checklist', v: checklistDone(s) + ' / ' + ONBOARDING_FIELDS.length + ' complete' }
        ]);
        var ec = s.emergencyContact || {};
        var emerg = ec.name
          ? esc(ec.name + (ec.phone ? ' · ' + ec.phone : '') + (ec.relationship ? ' (' + ec.relationship + ')' : ''))
          : '—';
        var emergency = UI.kv([{ k: 'Emergency contact', v: emerg }]);
        // Identity / profile / onboarding / emergency / medical editing is NATIVE
        // now (the Edit button on this slide-out). Per-clearance, per-document,
        // checklist and waiver-template editors remain bespoke on legacy #students.
        // Per-student signed waiver link (anti-forge, audit 2026-06-01 P2): mints a
        // tokened link bound to THIS student via generateWaiverLink. Signing it
        // flips only this student; a tokenless submission is create-new-only.
        var waiverLinkBtn = '<div style="margin-top:12px;"><button class="btn btn-secondary" onclick="StudentsV2.copyWaiverLink(\'' + esc(s._key) + '\')">🔗 Copy waiver link</button> <span class="mu-sub">Signed link tied to this student — send it to them to sign.</span></div>';

        // Clearances — active + expired, with cleared-by / expiry.
        var clr = clearancesOf(s);
        var t = today();
        var clearancesBody = clr.length ? UI.relatedTable([
          { label: 'Clearance', render: function (c) { return esc(c.label || c.clearanceId || '—'); } },
          { label: 'Cleared', render: function (c) {
            var by = (c.clearedAt || '') + (c.clearedBy ? ' by ' + c.clearedBy : '');
            return by ? '<span class="mu-sub">' + esc(by) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Status', render: function (c) {
            var expired = c.expiresAt && c.expiresAt < t;
            if (expired) return UI.badge('Expired ' + c.expiresAt, 'danger');
            return UI.badge(c.expiresAt ? ('Expires ' + c.expiresAt) : 'Active', 'success'); } }
        ], clr) : '<span class="mu-sub">No clearances on file.</span>';

        // Documents — title / type / status (full management stays on legacy).
        var docs = documentsOf(s);
        var documentsBody = docs.length ? UI.relatedTable([
          { label: 'Document', render: function (d) {
            return esc(d.title || 'Untitled') + (d.driveFileName ? ' <span class="mu-sub">· 📄 ' + esc(d.driveFileName) + '</span>' : ''); } },
          { label: 'Type', render: function (d) { return '<span class="mu-sub">' + esc(cap(d.type || 'other')) + '</span>'; } },
          { label: 'Status', render: function (d) {
            var st = d.status || 'pending';
            var tone = st === 'current' ? 'success' : st === 'expired' ? 'danger' : 'amber';
            return UI.badge(cap(st), tone); } }
        ], docs) : '<span class="mu-sub">No documents on file.</span>';

        // Notes — medical (allergies + medical notes) + internal instructor notes.
        function noteBlock(label, text) {
          return '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin:0 0 6px;">' + esc(label) + '</div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(text) + '</div>';
        }
        var noteParts = [];
        if (s.allergies) noteParts.push(noteBlock('Allergies', s.allergies));
        if (s.medicalNotes) noteParts.push(noteBlock('Medical notes', s.medicalNotes));
        if (s.instructorNotes) noteParts.push('<div style="margin-top:' + (noteParts.length ? '12px' : '0') + ';">' + noteBlock('Instructor notes', s.instructorNotes) + '</div>');
        var notesBody = noteParts.length ? noteParts.join('') : '<span class="mu-sub">No notes.</span>';

        // Danger zone — hard delete via the bridge (RBAC + mastConfirm + FK
        // warn in the remove() handler; writeAudit in the bridge core).
        var dangerZone = can('students', 'delete')
          ? UI.card('Danger zone', '<button class="btn btn-danger btn-small" onclick="StudentsV2.remove(\'' + esc(s._key || s.id) + '\')">Delete student</button>')
          : '';
        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Profile', profile) + UI.card('Onboarding', onboarding + waiverLinkBtn) + UI.card('Emergency contact', emergency) + '</div>' +
          '<div class="mu-pane" data-pane="enrollments" hidden>' +
            UI.cardTable('Enrollments (' + myEnrolls.length + ')', enrollsBody) + '</div>' +
          '<div class="mu-pane" data-pane="clearances" hidden>' +
            UI.cardTable('Clearances (' + activeClearances(s).length + ' active · ' + clr.length + ' total)', clearancesBody) + '</div>' +
          '<div class="mu-pane" data-pane="documents" hidden>' +
            UI.cardTable('Documents (' + docs.length + ')', documentsBody) + '</div>' +
          '<div class="mu-pane" data-pane="notes" hidden>' + UI.card('Notes', notesBody) + '</div>' + dangerZone;
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
  var V2 = { rows: [], byId: {}, enrollments: [], classMap: {}, sortKey: 'displayName', sortDir: 'asc', q: '', statusFilter: 'active', loaded: false };

  // Run-once data load shared by route setup and cold drills (fetch gate).
  var _loadPromise = null;
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (!_loadPromise) _loadPromise = loadData();
    return _loadPromise;
  }
  function load() { _loadPromise = null; loadData().then(render); }
  function loadData() {
    // Ensure the legacy students module is loaded so window.StudentsBridge
    // (the delegated write path) exists — mirrors contacts-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('students'); } catch (e) {} }
    // Enrollments load alongside for the Enrollments facet (joins by studentId
    // or email — the storefront writes customerEmail, not studentId).
    return Promise.all([
      Promise.resolve(MastDB.get('students')).catch(function () { return {}; }),
      Promise.resolve(MastDB.enrollments.list(2000)).catch(function () { return {}; }),
      Promise.resolve(MastDB.classes.list(200)).catch(function () { return {}; })
    ]).then(function (res) {
      var val = res[0] || {};
      function toMap(x) { return (x && typeof x.val === 'function') ? (x.val() || {}) : (x || {}); }
      var ev = toMap(res[1]);
      V2.enrollments = Object.keys(ev).map(function (k) { return Object.assign({ _key: k }, ev[k]); });
      V2.classMap = toMap(res[2]);
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
        count: N.count(V2.rows.length) + ' student' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-primary" onclick="StudentsV2.create()">+ New student</button>' +
          '<button class="btn btn-secondary" onclick="StudentsV2.exportCsv()">↓ Export</button>'
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

  window.StudentsV2 = {
    remove: function (id) {
      if (!can('students', 'delete')) { if (window.showToast) showToast('Delete access required.', true); return; }
      if (!window.StudentsBridge || !window.StudentsBridge.remove) { if (window.showToast) showToast('Engine still loading — try again', true); return; }
      var rec = V2.byId[id];
      var em = ((rec && rec.email) || '').toLowerCase();
      var refs = V2.enrollments.filter(function (e) { return e.studentId === id || (em && String(e.studentEmail || e.customerEmail || '').toLowerCase() === em); }).length;
      var msg = 'Delete the student "' + ((rec && rec.displayName) || '') + '"?' + (refs ? ' They have ' + refs + ' enrollment' + (refs === 1 ? '' : 's') + ' — enrollment history keeps the name but loses the profile (waivers, clearances, documents).' : '') + ' This cannot be undone.';
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
      // Ensure the legacy module (and thus window.StudentsBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('students'); } catch (e) {} }
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
    exportCsv: function () { return MastEntity.exportRows('students-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('students-v2', {
    routes: { 'students-v2': { tab: 'studentsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
