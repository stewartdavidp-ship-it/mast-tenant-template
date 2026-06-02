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
 * Read-focused: editing a student in legacy is a set of bespoke sub-forms
 * (identity / profile / emergency / medical / onboarding, plus per-checklist,
 * per-clearance and per-document editors with Google-Drive linking) coupled to
 * the legacy pane — those stay single-sourced on legacy #students via a "manage
 * in classic view" link. This twin re-hosts the VIEW only — no onSave, no edit
 * form, no clearance/document/waiver sub-tools (those stay on legacy too).
 * Flag-gated (?ui=1) at #students-v2, side-by-side; never touches students.js.
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
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
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
          { key: 'ov', label: 'Overview' }, { key: 'clearances', label: 'Clearances' },
          { key: 'documents', label: 'Documents' }, { key: 'notes', label: 'Notes' }
        ], 'ov');

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
        // Bespoke student editing (identity, profile, onboarding, checklist) stays on legacy #students.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="StudentsV2.classic()">Manage in classic view →</button></div>';

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

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Profile', profile) + UI.card('Onboarding', onboarding) + UI.card('Emergency contact', emergency + manage) + '</div>' +
          '<div class="mu-pane" data-pane="clearances" hidden>' +
            UI.cardTable('Clearances (' + activeClearances(s).length + ' active · ' + clr.length + ' total)', clearancesBody) + '</div>' +
          '<div class="mu-pane" data-pane="documents" hidden>' +
            UI.cardTable('Documents (' + docs.length + ')', documentsBody) + '</div>' +
          '<div class="mu-pane" data-pane="notes" hidden>' + UI.card('Notes', notesBody) + '</div>';
      }
    }
    // No onSave → no Edit button (student editing stays on legacy #students).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'displayName', sortDir: 'asc', q: '', statusFilter: 'active', loaded: false };

  function load() {
    Promise.resolve(MastDB.get('students')).then(function (val) {
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var s = val[k];
        if (s && typeof s === 'object') { s = Object.assign({ _key: k }, s); s.status = s.status || 'active'; out.push(s); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[students-v2] load', e); render(); });
  }

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
        actionsHtml: '<button class="btn btn-secondary" onclick="StudentsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or contact…" value="' + esc(V2.q) +
        '" oninput="StudentsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('students-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'StudentsV2.sort', onRowClickFnName: 'StudentsV2.open',
        empty: { title: 'No students', message: V2.loaded ? 'Add students in the classic Students view.' : 'Loading…' }
      });
  }

  window.StudentsV2 = {
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
    // Bespoke student editing → classic Students view. Use navigateToClassic so
    // the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('students');
      else if (typeof navigateTo === 'function') navigateTo('students');
    },
    exportCsv: function () { return MastEntity.exportRows('students-v2', visibleRows(), V2.statusFilter); }
  };

  MastAdmin.registerModule('students-v2', {
    routes: { 'students-v2': { tab: 'studentsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
