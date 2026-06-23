/**
 * team-v2.js — conversion #4 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy team.js shows the roster and swaps the pane in-place to an employee
 * detail (currentView='detail' → renderEmployeeDetail). This re-hosts the roster
 * + employee detail on the Entity Engine: a schema-driven list + a read-focused
 * Faceted Record slide-out (Overview / Compliance / Records facets).
 *
 * Variant (doc 17 §1a test): an employee record has rich related collections
 * (compliance checklist, documents, hours, references) but no governed lifecycle
 * (status active/terminated is an assigned attribute) → Faceted Record.
 *
 * Create + edit of the employee RECORD are NATIVE here: a custom
 * detail.editRender (the legacy identity / employment / contact / pay field set,
 * grouped) + an onSave that DELEGATES to window.TeamBridge (exposed in team.js)
 * so the employee write + validation stay single-sourced — this twin never
 * reimplements buildEmployeeFields / writeEmployee (mirrors the
 * StudentsBridge / ContactsBridge precedent). Classic burn-down (operations
 * Wave B): the heavy sub-surfaces — Time Clock, PTO, Labor Burden, Documents,
 * Onboarding — are RE-HOSTED here as page lenses via window.TeamPanels
 * (team.js renders the same battle-tested panels into this page's container;
 * one implementation, no classic link). The classic hatch is retired.
 *
 * RBAC: this surface shows pay. VIEW is gated by can('team','view') (mirrors the
 * legacy route boundary; pay is not gated below team-view in legacy). The WRITE
 * UI (the + New action, the Edit button, and onSave) is gated by
 * can('team','edit') — the legacy "manage" capability — so a viewer without edit
 * gets a pure read Faceted Record. Flag-gated (?ui=1) at #team-v2, side-by-side;
 * never touches team.js other than reading window.TeamBridge.
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

  // Mirror the legacy route boundary: team data (incl. pay) is visible to
  // can('team','view'). If the resolver isn't present, default open (same as legacy).
  function canViewTeam() { return typeof window.can === 'function' ? window.can('team', 'view') : true; }
  // The write boundary for the employee RECORD (identity / employment / contact /
  // pay). Gate create + edit on can('team','edit') — pay is sensitive, and this
  // is the legacy "manage" capability (canManageTeam() === can('team','edit')).
  // No resolver → default open (same as legacy). Keeps lint-rbac CHECK C born-0.
  function canEditTeam() { return typeof window.can === 'function' ? window.can('team', 'edit') : true; }

  // Employment vocab — mirrors team.js EMPLOYMENT_TYPES / PAY_TYPES /
  // PAY_FREQUENCIES exactly. Status mirrors the legacy form (active / inactive /
  // terminated); the list/header status field collapses non-terminated → active.
  var EMPLOYMENT_TYPES = ['full-time', 'part-time', 'temp', 'contractor'];
  var PAY_TYPES = ['hourly', 'salary', 'piece-rate'];
  var PAY_FREQUENCIES = ['weekly', 'bi-weekly', 'monthly'];
  var EMP_STATUSES = ['active', 'inactive', 'terminated'];

  var COMPLIANCE_FIELDS = [
    { key: 'i9', label: 'I-9' }, { key: 'w4', label: 'W-4' }, { key: 'stateWithholding', label: 'State Withholding' },
    { key: 'offerLetter', label: 'Offer Letter' }, { key: 'workersComp', label: "Workers' Comp Certificate" }
  ];
  // Mirror team.js select vocabularies exactly so the native sub-editors write
  // the same option values the legacy forms do.
  var COMPLIANCE_STATUSES = [
    { value: 'missing', label: 'Missing' }, { value: 'completed', label: 'Completed' }, { value: 'not-applicable', label: 'Not Applicable' }
  ];
  var STORAGE_OPTIONS = [
    { value: '', label: 'Not specified' },
    { value: 'physical', label: 'Physical' }, { value: 'google-drive', label: 'Google Drive' },
    { value: 'dropbox', label: 'Dropbox' }, { value: 'gusto', label: 'Gusto' }, { value: 'other', label: 'Other' }
  ];
  var DOC_TYPES = ['employment', 'tax', 'certification', 'insurance', 'license', 'legal', 'compliance', 'financial', 'other'];
  var DOC_STATUSES = [
    { value: 'current', label: 'Current' }, { value: 'pending', label: 'Pending' },
    { value: 'expired', label: 'Expired' }, { value: 'not-applicable', label: 'Not Applicable' }
  ];
  var REFERENCE_OUTCOMES = ['positive', 'neutral', 'concerning', 'not-checked'];

  // helpers (mirror team.js)
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function fmtDollars(cents) { return (cents == null || cents === 0) ? 'not set' : (N.money(cents / 100) || '$0.00'); }
  function fmtRate(cents, payType) {
    if (cents == null) return 'not set';
    return (N.money(cents / 100) || '$0.00') + (payType === 'salary' ? '/mo' : '/hr');
  }
  function calcMonthlyCost(emp) {
    if (!emp.payRate) return 0;
    if (emp.payType === 'salary') return emp.payRate;
    return Math.round((emp.payRate || 0) * (emp.scheduledHoursPerWeek || 0) * 4.33);
  }
  function countOf(v) { return Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : 0); }

  // ── Sub-editor helpers (native compliance / documents / references) ──────
  // Documents + references can be a push-key MAP (the legacy writer's shape) or
  // an array (older data); normalize to a list with a stable id for the bridge.
  function collOf(v, idField) {
    if (Array.isArray(v)) return v.map(function (r, i) { return Object.assign({ _id: (r && (r[idField] || r._key)) || String(i) }, r); });
    if (v && typeof v === 'object') return Object.keys(v).map(function (k) { return Object.assign({ _id: k }, v[k]); });
    return [];
  }
  // Normalize an array-shaped (legacy) collection into a push-key map keyed by
  // its id field, so the live cache can be patched by id after a sub-write. The
  // canonical stored shape IS a map (the writer mints push keys); reloadSoon()
  // re-reads the authoritative shape right after.
  function mapFromColl(v, idField) {
    var out = {};
    if (Array.isArray(v)) v.forEach(function (r, i) { var k = (r && (r[idField] || r._key)) || ('k_' + i); out[k] = r; });
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { out[k] = v[k]; });
    return out;
  }
  // Re-render a single faceted-record pane in place after a sub-edit (mirrors
  // students-v2 rerenderPane). The engine renders the detail into #mastSlideOutBody.
  function rerenderPane(key, inner) {
    var body = document.getElementById('mastSlideOutBody');
    var el = body && body.querySelector('.mu-pane[data-pane="' + key + '"]');
    if (el) el.innerHTML = inner;
  }
  function bridge() {
    if (window.TeamBridge && typeof window.TeamBridge.saveCompliance === 'function') return window.TeamBridge;
    if (window.showToast) showToast('Team engine still loading — try again', true);
    return null;
  }
  // Small form-control helpers (kept local; mirror students-v2's so the
  // sub-editors read uniformly).
  function fgRow(label, inner) { return '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
  function txtH(id, v, ph) { return '<input class="form-input" id="' + id + '" value="' + esc(v == null ? '' : v) + '" style="width:100%;"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'; }
  function taH(id, v) { return '<textarea class="form-input" id="' + id + '" rows="2" style="width:100%;resize:vertical;">' + esc(v == null ? '' : v) + '</textarea>'; }
  function dateH(id, v) { return '<input class="form-input" type="date" id="' + id + '" value="' + esc(v || '') + '" style="width:100%;">'; }
  function selH(id, options, sel) {
    return '<select class="form-input" id="' + id + '" style="width:100%;">' + options.map(function (o) {
      var v = (o && typeof o === 'object') ? o.value : o;
      var l = (o && typeof o === 'object') ? o.label : cap(String(o).replace('-', ' '));
      return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
  }
  function formButtons(saveCall, cancelCall, saveLabel) {
    return '<div style="display:flex;gap:8px;margin-top:14px;"><button class="btn btn-primary btn-small" onclick="' + saveCall + '">' + esc(saveLabel || 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="' + cancelCall + '">Cancel</button></div>';
  }
  function val(id) { return ((document.getElementById(id) || {}).value || ''); }

  // ── Faceted-record pane builders ─────────────────────────────────────────
  // Each pane body is a pure builder so the native sub-editors can re-render it
  // in place after a write (rerenderPane) — mirrors students-v2.
  function paneDiv(key, inner, hidden) {
    return '<div class="mu-pane" data-pane="' + key + '"' + (hidden ? ' hidden' : '') + '>' + inner + '</div>';
  }
  function tilesFor(e) {
    var monthly = calcMonthlyCost(e);
    return U.tiles([
      { k: 'Pay', v: esc(fmtRate(e.payRate, e.payType)), hero: true },
      { k: 'Type', v: esc(cap(String(e.payType || 'not set').replace('-', ' '))) },
      { k: 'Schedule', v: e.scheduledHoursPerWeek ? (e.scheduledHoursPerWeek + ' hrs/wk') : '—' },
      { k: 'Monthly', v: monthly > 0 ? esc(fmtDollars(monthly)) : '—' }
    ]);
  }
  function overviewPane(UI, e) {
    var monthly = calcMonthlyCost(e);
    var employment = UI.kv([
      { k: 'Job title', v: e.jobTitle ? esc(e.jobTitle) : '—' },
      { k: 'Employment type', v: esc(cap(String(e.employmentType || '').replace('-', ' '))) || '—' },
      { k: 'Started', v: e.startDate ? esc(e.startDate) : '—' },
      { k: 'Status', v: cap(e.status || 'active') + (e.status === 'terminated' && e.terminationDate ? ' (' + esc(e.terminationDate) + ')' : '') },
      { k: 'Pay', v: esc(fmtRate(e.payRate, e.payType)) },
      { k: 'Pay frequency', v: esc(cap(String(e.payFrequency || 'not set').replace('-', ' '))) },
      { k: 'Schedule', v: e.scheduledHoursPerWeek ? (e.scheduledHoursPerWeek + ' hrs/week') : '—' },
      { k: 'Monthly cost', v: monthly > 0 ? esc(fmtDollars(monthly)) : '—' }
    ]);
    var addr = e.address && e.address.street
      ? esc(e.address.street + (e.address.city ? ', ' + e.address.city : '') + (e.address.state ? ', ' + e.address.state : '') + (e.address.zip ? ' ' + e.address.zip : ''))
      : '—';
    var emerg = (e.emergencyContact && e.emergencyContact.name)
      ? esc(e.emergencyContact.name + (e.emergencyContact.phone ? ' · ' + e.emergencyContact.phone : '') + (e.emergencyContact.relationship ? ' (' + e.emergencyContact.relationship + ')' : ''))
      : '—';
    var contact = UI.kv([
      { k: 'Phone', v: e.phone ? esc(e.phone) : '—' },
      { k: 'Address', v: addr },
      { k: 'SSN', v: e.ssnLast4 ? ('•••-••-' + esc(e.ssnLast4)) : '—' },
      { k: 'Emergency', v: emerg }
    ]);
    return UI.card('Employment', employment) + UI.card('Contact & personal', contact);
  }

  // ── Compliance pane (NATIVE per-employee EDIT — closes the V1-only gap) ──
  // The I-9 / W-4 / state-withholding / offer-letter / workers-comp status +
  // storage location + dates + link, editable inline → TeamBridge.saveCompliance.
  function compliancePane(UI, e) {
    var canEdit = canEditTeam();
    var gaps = 0;
    var compRows = COMPLIANCE_FIELDS.map(function (f) {
      var item = (e.complianceChecklist || {})[f.key] || {};
      var st = item.status || 'missing';
      if (st !== 'completed' && st !== 'not-applicable') gaps++;
      var tone = st === 'completed' ? 'success' : st === 'not-applicable' ? 'neutral' : 'amber';
      var label = st === 'completed' ? 'Complete' : st === 'not-applicable' ? 'N/A' : 'Missing';
      return { key: f.key, label: f.label, badge: UI.badge(label, tone),
        loc: item.storageLocation ? cap(String(item.storageLocation).replace('-', ' ')) : '', url: item.url || '' };
    });
    var cols = [
      { label: 'Requirement', render: function (r) { return esc(r.label); } },
      { label: 'Storage', render: function (r) {
        var loc = r.loc ? '<span class="mu-sub">' + esc(r.loc) + '</span>' : '<span class="mu-sub">—</span>';
        return loc + (r.url ? ' <a href="' + esc(r.url) + '" target="_blank" rel="noopener" class="mu-sub" style="color:var(--teal);">🔗</a>' : ''); } },
      { label: 'Status', render: function (r) { return r.badge; } }
    ];
    if (canEdit) cols.push({ label: '', align: 'right', render: function (r) {
      return '<button class="btn btn-small btn-secondary" onclick="TeamV2.compEdit(\'' + esc(e._key) + '\',\'' + esc(r.key) + '\')">Edit</button>'; } });
    var compTable = UI.relatedTable(cols, compRows);
    var compBadge = gaps > 0 ? (MastFormat.countNoun(gaps, 'gap')) : 'Complete';
    return UI.cardTable('Compliance — ' + compBadge, compTable);
  }
  function complianceForm(UI, e, fieldKey) {
    var f = COMPLIANCE_FIELDS.filter(function (x) { return x.key === fieldKey; })[0] || { key: fieldKey, label: fieldKey };
    var item = (e.complianceChecklist || {})[fieldKey] || {};
    var inner =
      fgRow('Status', selH('teamV2CompStatus', COMPLIANCE_STATUSES, item.status || 'missing')) +
      fgRow('Storage location', selH('teamV2CompStorage', STORAGE_OPTIONS, item.storageLocation || '')) +
      fgRow('Completed date', dateH('teamV2CompDate', item.completedDate)) +
      fgRow('Expiry date', dateH('teamV2CompExpiry', item.expiryDate)) +
      fgRow('Document link', txtH('teamV2CompUrl', item.url, 'https://… (Drive / payroll system)')) +
      fgRow('Notes', taH('teamV2CompNotes', item.notes)) +
      formButtons('TeamV2.compSave(\'' + esc(e._key) + '\',\'' + esc(fieldKey) + '\')', 'TeamV2.compCancel(\'' + esc(e._key) + '\')', 'Save');
    return UI.card('Edit: ' + esc(f.label), inner);
  }

  // ── Documents pane (NATIVE per-employee add/edit — metadata + link record) ──
  // No binary upload: the legacy form (and this) stores a document link /
  // Drive-metadata record (url), same as the tenant Business Documents surface.
  function documentsPane(UI, e) {
    var canEdit = canEditTeam();
    var docs = collOf(e.documents, 'documentId');
    var addBtn = canEdit ? '<button class="btn btn-small btn-secondary" onclick="TeamV2.docAdd(\'' + esc(e._key) + '\')">+ New</button>' : '';
    var cols = [
      { label: 'Document', render: function (d) { return esc(d.title || 'Untitled') + (d.driveFileName ? ' <span class="mu-sub">· 📄 ' + esc(d.driveFileName) + '</span>' : ''); } },
      { label: 'Type', render: function (d) { return '<span class="mu-sub">' + esc(cap(d.type || 'other')) + '</span>'; } },
      { label: 'Status', render: function (d) {
        var st = d.status || 'current';
        var tone = st === 'current' ? 'success' : st === 'expired' ? 'danger' : st === 'not-applicable' ? 'neutral' : 'amber';
        return UI.badge(cap(String(st).replace('-', ' ')), tone); } }
    ];
    if (canEdit) cols.push({ label: '', align: 'right', render: function (d) {
      return '<button class="btn btn-small btn-secondary" onclick="TeamV2.docEdit(\'' + esc(e._key) + '\',\'' + esc(d._id) + '\')">Edit</button> ' +
        '<button class="btn btn-small btn-danger" onclick="TeamV2.docRemove(\'' + esc(e._key) + '\',\'' + esc(d._id) + '\')">Remove</button>'; } });
    var table = docs.length ? UI.relatedTable(cols, docs) : '<span class="mu-sub">No documents on file.</span>';
    return UI.card('Documents (' + docs.length + ')', table, { headerRight: addBtn });
  }
  function documentForm(UI, e, docId) {
    var docs = collOf(e.documents, 'documentId');
    var d = docId ? (docs.filter(function (x) { return String(x._id) === String(docId); })[0] || {}) : {};
    var isNew = !docId;
    var inner =
      fgRow('Title *', txtH('teamV2DocTitle', d.title, 'e.g. Offer letter')) +
      fgRow('Type', selH('teamV2DocType', DOC_TYPES, d.type || 'other')) +
      fgRow('Status', selH('teamV2DocStatus', DOC_STATUSES, d.status || 'current')) +
      fgRow('Storage location', selH('teamV2DocStorage', STORAGE_OPTIONS, d.storageLocation || '')) +
      fgRow('On-file date', dateH('teamV2DocOnFile', d.onFileDate)) +
      fgRow('Expiry date', dateH('teamV2DocExpiry', d.expiryDate)) +
      fgRow('Document link', txtH('teamV2DocUrl', d.url, 'https://… (Drive / payroll system)')) +
      fgRow('Description', taH('teamV2DocDesc', d.description)) +
      fgRow('Notes', taH('teamV2DocNotes', d.notes)) +
      formButtons('TeamV2.docSave(\'' + esc(e._key) + '\',' + (isNew ? 'null' : '\'' + esc(docId) + '\'') + ')', 'TeamV2.docCancel(\'' + esc(e._key) + '\')', isNew ? 'Add document' : 'Save');
    return UI.card(isNew ? 'New document' : 'Edit document', inner);
  }

  // ── References pane (NATIVE per-employee add/edit) ──────────────────────
  function referencesPane(UI, e) {
    var canEdit = canEditTeam();
    var refs = collOf(e.references, 'referenceId');
    var addBtn = canEdit ? '<button class="btn btn-small btn-secondary" onclick="TeamV2.refAdd(\'' + esc(e._key) + '\')">+ New</button>' : '';
    var cols = [
      { label: 'Reference', render: function (r) { return esc(r.name || 'Unnamed') + (r.relationship ? ' <span class="mu-sub">· ' + esc(r.relationship) + '</span>' : ''); } },
      { label: 'Contact', render: function (r) { return '<span class="mu-sub">' + (r.phone ? esc(r.phone) : '—') + '</span>'; } },
      { label: 'Outcome', render: function (r) {
        var o = r.outcome || 'not-checked';
        var tone = o === 'positive' ? 'success' : o === 'concerning' ? 'danger' : o === 'neutral' ? 'amber' : 'neutral';
        return UI.badge(cap(String(o).replace('-', ' ')), tone); } }
    ];
    if (canEdit) cols.push({ label: '', align: 'right', render: function (r) {
      return '<button class="btn btn-small btn-secondary" onclick="TeamV2.refEdit(\'' + esc(e._key) + '\',\'' + esc(r._id) + '\')">Edit</button> ' +
        '<button class="btn btn-small btn-danger" onclick="TeamV2.refRemove(\'' + esc(e._key) + '\',\'' + esc(r._id) + '\')">Remove</button>'; } });
    var table = refs.length ? UI.relatedTable(cols, refs) : '<span class="mu-sub">No references on file.</span>';
    return UI.card('References (' + refs.length + ')', table, { headerRight: addBtn });
  }
  function referenceForm(UI, e, refId) {
    var refs = collOf(e.references, 'referenceId');
    var r = refId ? (refs.filter(function (x) { return String(x._id) === String(refId); })[0] || {}) : {};
    var isNew = !refId;
    var inner =
      fgRow('Name *', txtH('teamV2RefName', r.name, 'Reference name')) +
      fgRow('Phone', txtH('teamV2RefPhone', r.phone, '555-555-5555')) +
      fgRow('Relationship', txtH('teamV2RefRel', r.relationship, 'e.g. Former employer')) +
      fgRow('Outcome', selH('teamV2RefOutcome', REFERENCE_OUTCOMES, r.outcome || 'not-checked')) +
      fgRow('Checked date', dateH('teamV2RefDate', r.checkedDate)) +
      fgRow('Notes', taH('teamV2RefNotes', r.notes)) +
      formButtons('TeamV2.refSave(\'' + esc(e._key) + '\',' + (isNew ? 'null' : '\'' + esc(refId) + '\'') + ')', 'TeamV2.refCancel(\'' + esc(e._key) + '\')', isNew ? 'Add reference' : 'Save');
    return UI.card(isNew ? 'New reference' : 'Edit reference', inner);
  }

  // ── Records pane (counts + re-hosted sub-surface lenses) ────────────────
  function recordsPane(UI, e) {
    var hours = countOf(e.hoursLog);
    var records = UI.kv([
      { k: 'Documents', v: N.count(countOf(e.documents)) },
      { k: 'References', v: N.count(countOf(e.references)) },
      { k: 'Hours log entries', v: N.count(hours) }
    ]);
    return UI.card('Records', records) +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" onclick="TeamV2.setLens(\'timeclock\')">Time clock →</button>' +
        '<button class="btn btn-secondary" onclick="TeamV2.setLens(\'pto\')">PTO →</button>' +
        (canEditTeam() ? '<button class="btn btn-secondary" onclick="TeamV2.setLens(\'burden\')">Labor burden →</button>' : '') +
      '</div>';
  }

  // Native create + edit of the employee RECORD — the legacy form field set
  // (Identity & Contact / Emergency Contact / Employment / Pay), grouped like
  // openAddEmployeeForm. The heavy roster-level sub-surfaces (Time Clock, PTO,
  // Labor Burden, Onboarding) stay re-hosted via TeamPanels lenses; the
  // per-employee compliance / documents / references editors are NATIVE here
  // (TeamBridge.saveCompliance / addDocument / addReference). A partial update
  // preserves those nested collections + onboardingChecklist.
  // Hoisted so MastEntity.define can attach edit ONLY when can('team','edit')
  // (the engine shows the Edit button iff schema.onSave is a function — see
  // shared/mast-entity.js L513). Pay is sensitive; a viewer w/o edit sees no
  // Edit button and no + New action.
  function teamEditRender(e, mode) {
    e = e || {};
    var addr = e.address || {}, ec = e.emergencyContact || {};
    function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
    function row(parts) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + parts.join('') + '</div>'; }
    function grp(t) { return '<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:14px 0 4px;">' + esc(t) + '</div>'; }
    function txt(id, v, ph) { return '<input class="form-input" id="' + id + '" value="' + esc(v == null ? '' : v) + '" style="width:100%;"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'; }
    function num(id, v, step, ph) { return '<input class="form-input" type="number" id="' + id + '" value="' + esc(v == null ? '' : v) + '" step="' + step + '" style="width:100%;"' + (ph ? ' placeholder="' + esc(ph) + '"' : '') + '>'; }
    function dt(id, v) { return '<input class="form-input" type="date" id="' + id + '" value="' + esc(v || '') + '" style="width:100%;">'; }
    function sel(id, opts, cur) {
      return '<select class="form-input" id="' + id + '" style="width:100%;">' + opts.map(function (o) {
        return '<option value="' + esc(o) + '"' + (cur === o ? ' selected' : '') + '>' + esc(cap(String(o).replace('-', ' '))) + '</option>';
      }).join('') + '</select>';
    }
    var rateDollars = e.payRate ? (e.payRate / 100).toFixed(2) : '';
    return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New employee' : 'Edit this employee') + '</div>' +
      grp('Identity & contact') +
      fg('Full name *', txt('teamV2Name', e.fullName, '')) +
      row([
        fg('Preferred name', txt('teamV2Preferred', e.preferredName, 'Optional'), true),
        fg('Phone', txt('teamV2Phone', e.phone, '555-555-5555'), true)
      ]) +
      fg('Last 4 of SSN (reference only)', txt('teamV2Ssn', e.ssnLast4, '1234')) +
      '<div class="mu-sub" style="margin-top:-6px;">We only store the last 4 digits as a reference — full SSN should be in your payroll system.</div>' +
      fg('Street address', txt('teamV2Street', addr.street, '')) +
      row([
        fg('City', txt('teamV2City', addr.city, ''), true),
        fg('State', txt('teamV2State', addr.state, ''), true),
        fg('ZIP', txt('teamV2Zip', addr.zip, ''), true)
      ]) +
      grp('Emergency contact') +
      row([
        fg('Name', txt('teamV2EcName', ec.name, ''), true),
        fg('Phone', txt('teamV2EcPhone', ec.phone, ''), true),
        fg('Relationship', txt('teamV2EcRel', ec.relationship, 'e.g. Spouse'), true)
      ]) +
      grp('Employment') +
      row([
        fg('Job title', txt('teamV2Title', e.jobTitle, 'e.g. Studio assistant'), true),
        fg('Employment type', sel('teamV2Type', EMPLOYMENT_TYPES, e.employmentType || 'part-time'), true)
      ]) +
      row([
        fg('Start date', dt('teamV2Start', e.startDate), true),
        fg('Status', sel('teamV2Status', EMP_STATUSES, e.status || 'active'), true)
      ]) +
      fg('Termination date (if terminated)', dt('teamV2TermDate', e.terminationDate)) +
      grp('Pay') +
      row([
        fg('Pay type', sel('teamV2PayType', PAY_TYPES, e.payType || 'hourly'), true),
        fg('Pay rate ($)', num('teamV2Rate', rateDollars, '0.01', '0.00'), true)
      ]) +
      row([
        fg('Pay frequency', sel('teamV2Freq', PAY_FREQUENCIES, e.payFrequency || 'bi-weekly'), true),
        fg('Scheduled hours/week', num('teamV2Hours', e.scheduledHoursPerWeek, '1', ''), true)
      ]);
  }

  function teamOnSave(rec, mode) {
    // Mirror the legacy edit boundary exactly — pay is sensitive. Refuse the
    // write if can('team','edit') is false (the create/+New action + Edit button
    // are also hidden when false; re-check here as the authoritative gate).
    if (!canEditTeam()) { if (window.showToast) showToast("You don't have permission to edit team records.", true); return false; }
    if (!window.TeamBridge) { if (window.showToast) showToast('Team engine still loading — try again', true); return false; }
    function val(id) { return ((document.getElementById(id) || {}).value || ''); }
    var rateDollars = parseFloat(val('teamV2Rate'));
    var statusV = val('teamV2Status') || 'active';
    var data = {
      fullName: val('teamV2Name'),
      preferredName: val('teamV2Preferred'),
      phone: val('teamV2Phone'),
      ssnLast4: val('teamV2Ssn').trim(),
      address: { street: val('teamV2Street'), city: val('teamV2City'), state: val('teamV2State'), zip: val('teamV2Zip') },
      emergencyContact: { name: val('teamV2EcName'), phone: val('teamV2EcPhone'), relationship: val('teamV2EcRel') },
      jobTitle: val('teamV2Title'),
      employmentType: val('teamV2Type') || 'part-time',
      startDate: val('teamV2Start') || null,
      status: statusV,
      terminationDate: statusV === 'terminated' ? (val('teamV2TermDate') || null) : null,
      payType: val('teamV2PayType') || 'hourly',
      payRate: rateDollars ? Math.round(rateDollars * 100) : null,   // store CENTS (matches the writer)
      payFrequency: val('teamV2Freq') || 'bi-weekly',
      scheduledHoursPerWeek: parseInt(val('teamV2Hours'), 10) || null
    };
    // Validation mirrors legacy saveEmployee (name required; SSN 4 digits if set).
    // buildEmployeeFields in the bridge re-validates authoritatively and throws.
    if (!data.fullName.trim()) { if (window.showToast) showToast('Name is required.', true); return false; }
    if (data.ssnLast4 && !/^\d{4}$/.test(data.ssnLast4)) { if (window.showToast) showToast('SSN must be exactly 4 digits.', true); return false; }

    if (mode === 'create') {
      return Promise.resolve(window.TeamBridge.create(data)).then(function () {
        if (window.showToast) showToast('Employee created.'); reloadSoon(); return true;
      }).catch(function (err) { console.error('[team-v2] create', err); if (window.showToast) showToast(err && err.message ? err.message : 'Error saving employee.', true); return false; });
    }
    var id = rec._key || rec.id;
    return Promise.resolve(window.TeamBridge.update(id, data)).then(function () {
      // Mutate the LIVE cached record (=== the slide-out's read closure, since
      // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
      // the edited fields immediately on the post-save read re-render;
      // reloadSoon() then refreshes the cache for the next open. Object.assign
      // preserves nested collections (documents/hoursLog/references/compliance)
      // not touched by the edit form.
      Object.assign(V2.byId[id] || rec, data, { status: data.status });
      if (window.showToast) showToast('Employee updated.'); reloadSoon(); return true;
    }).catch(function (err) { console.error('[team-v2] update', err); if (window.showToast) showToast(err && err.message ? err.message : 'Error updating employee.', true); return false; });
  }

  // ── schema (Faceted Record — read always; native edit when can('team','edit')) ──
  var teamSchema = {
    label: 'Employee', labelPlural: 'Team', size: 'lg',
    route: 'team-v2',
    recordId: function (e) { return e._key || e.id; },
    fields: [
      { name: 'fullName', label: 'Name', type: 'text', list: true, readOnly: true, group: 'Employee' },
      { name: 'jobTitle', label: 'Title', type: 'text', list: true, readOnly: true, get: function (e) { return e.jobTitle || '—'; } },
      { name: 'employmentType', label: 'Type', type: 'text', list: true, readOnly: true, get: function (e) { return cap(String(e.employmentType || '').replace('-', ' ')) || '—'; } },
      { name: 'pay', label: 'Pay', type: 'text', list: true, readOnly: true, align: 'right', get: function (e) { return fmtRate(e.payRate, e.payType); } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'terminated'],
        tone: function (v) { return v === 'terminated' ? 'danger' : 'success'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, e) {
        var tiles = tilesFor(e);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'compliance', label: 'Compliance' },
          { key: 'documents', label: 'Documents' }, { key: 'references', label: 'References' },
          { key: 'records', label: 'Records' }
        ], 'ov');
        // Delete is the HARD remove (legacy edit can set status=terminated; this
        // is the destructive remove of admin/employees/{id}). Gated separately on
        // can('team','delete'), mirroring students-v2's danger zone.
        var dangerZone = can('team', 'delete')
          ? UI.card('Danger zone', '<button class="btn btn-danger btn-small" onclick="TeamV2.remove(\'' + esc(e._key || e.id) + '\')">Delete employee</button>' +
            '<div class="mu-sub" style="margin-top:6px;">Permanently removes this employee and all their records, compliance, and documents. This cannot be undone.</div>')
          : '';
        return tiles + tabsBar +
          paneDiv('ov', overviewPane(UI, e), false) +
          paneDiv('compliance', compliancePane(UI, e), true) +
          paneDiv('documents', documentsPane(UI, e), true) +
          paneDiv('references', referencesPane(UI, e), true) +
          paneDiv('records', recordsPane(UI, e), true) + dangerZone;
      }
    }
  };
  // Attach native edit ONLY for can('team','edit') — the engine shows the Edit
  // button (and accepts saves) iff schema.onSave is a function. team-v2 is
  // lazily loaded when the (view-gated) route is first hit, so canEditTeam() is
  // resolved here. A viewer without edit gets a pure read Faceted Record.
  if (canEditTeam()) {
    teamSchema.detail.editRender = teamEditRender;
    teamSchema.onSave = teamOnSave;
  }
  MastEntity.define('team-v2', teamSchema);

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'fullName', sortDir: 'asc', q: '', allowed: true, loaded: false, lens: 'roster' };

  // Sub-surface lenses (classic burn-down Wave B). Roster = the engine list;
  // the rest re-host the legacy panels via window.TeamPanels (manager-gated
  // like legacy renderTeam).
  function lensDefs() {
    var L = [['roster', 'Roster'], ['timeclock', 'Time clock'], ['pto', 'PTO']];
    if (canEditTeam()) L = L.concat([['burden', 'Labor burden'], ['docs', 'Documents'], ['onboarding', 'Onboarding']]);
    return L;
  }

  function load() {
    // TeamBridge (delegated write path) + TeamPanels (re-hosted HR sub-surfaces)
    // are defined synchronously by the absorbed IIFE at the bottom of this file
    // (T6: team.js retired, its closure lifted here) — no loadModule needed.
    Promise.resolve(MastDB.get('admin/employees')).then(function (val) {
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var e = val[k];
        if (e && typeof e === 'object') { e = Object.assign({ _key: k }, e); e.status = e.status || 'active'; out.push(e); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[team-v2] load', e); render(); });
  }
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.fullName || '').toLowerCase().indexOf(q) >= 0 ||
               String(r.jobTitle || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('team-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('teamV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'teamV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.allowed) {
      tab.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.15rem;font-weight:600;margin-bottom:6px;">Team access restricted</div>' +
        '<div style="font-size:0.9rem;">You don\'t have permission to view team and payroll data.</div></div>';
      return;
    }
    var active = V2.rows.filter(function (e) { return e.status !== 'terminated'; }).length;
    var canEdit = canEditTeam();
    // + New employee is part of the WRITE UI → gated by can('team','edit').
    var newBtn = canEdit ? '<button class="btn btn-primary" style="margin-left:auto;" onclick="TeamV2.create()">+ New employee</button>' : '';
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Team</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(active) + ' active · ' + N.count(V2.rows.length) + ' total</span>' +
        newBtn +
        '<button class="btn btn-secondary"' + (canEdit ? '' : ' style="margin-left:auto;"') + ' onclick="TeamV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0 10px;">' + lensDefs().map(function (p) {
        var on = V2.lens === p[0];
        return '<button onclick="TeamV2.setLens(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
          'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
          'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
          'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + p[1] + '</button>';
      }).join('') + '</div>' +
      (V2.lens === 'roster'
        ? '<div style="margin:4px 0 14px;"><input class="form-input" placeholder="Search name or title…" value="' + esc(V2.q) +
          '" oninput="TeamV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
          MastEntity.renderList('team-v2', {
            rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
            onSortFnName: 'TeamV2.sort', onRowClickFnName: 'TeamV2.open',
            empty: { title: 'No employees', message: V2.loaded ? (canEdit ? 'Add an employee to get started.' : 'No employees on file.') : 'Loading…' }
          })
        : '<div id="teamV2PanelHost"></div>');
    if (V2.lens !== 'roster') {
      // Re-hosted HR sub-surface — same battle-tested panel, now absorbed into
      // this file (TeamPanels lives in the IIFE below). One implementation.
      if (window.TeamPanels) {
        Promise.resolve(TeamPanels.show(V2.lens, document.getElementById('teamV2PanelHost')))
          .catch(function (e) { console.error('[team-v2] panel host', e); });
      }
    } else if (window.TeamPanels) {
      TeamPanels.release();
    }
  }

  window.TeamV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('team-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('team-v2', rec, 'read');
      });
    },
    create: function () {
      if (!canEditTeam()) { if (window.showToast) showToast("You don't have permission to add team members.", true); return; }
      // TeamBridge is defined synchronously by the absorbed IIFE below — no loadModule.
      MastEntity.openRecord('team-v2', {}, 'create');
    },

    // ── Delete employee (HARD remove) — gated can('team','delete') ──────────
    remove: function (id) {
      if (!can('team', 'delete')) { if (window.showToast) showToast('Delete access required.', true); return; }
      var b = bridge(); if (!b || !b.remove) return;
      var rec = V2.byId[id] || {};
      var nm = rec.fullName || 'this employee';
      mastConfirm('Delete the employee "' + nm + '" and all their records, compliance, and documents? This cannot be undone.',
        { title: 'Delete Employee', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(b.remove(id)).then(function () {
          delete V2.byId[id];
          V2.rows = V2.rows.filter(function (x) { return (x._key || x.id) !== id; });
          if (window.showToast) showToast('Employee deleted');
          try { U.slideOut.requestClose(); } catch (_) {}
          render();
        }).catch(function (e) { if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true); });
      });
    },

    // ── Per-employee compliance editor (NATIVE) ─────────────────────────────
    compEdit: function (id, key) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var e = V2.byId[id]; if (e) rerenderPane('compliance', complianceForm(U, e, key));
    },
    compCancel: function (id) { var e = V2.byId[id]; if (e) rerenderPane('compliance', compliancePane(U, e)); },
    compSave: function (id, key) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var b = bridge(); if (!b) return;
      var fields = {
        status: val('teamV2CompStatus') || 'missing',
        storageLocation: val('teamV2CompStorage') || null,
        completedDate: val('teamV2CompDate') || null,
        expiryDate: val('teamV2CompExpiry') || null,
        url: val('teamV2CompUrl').trim() || null,
        notes: val('teamV2CompNotes').trim() || null
      };
      Promise.resolve(b.saveCompliance(id, key, fields)).then(function (saved) {
        var e = V2.byId[id]; if (!e) return;
        e.complianceChecklist = e.complianceChecklist || {};
        e.complianceChecklist[key] = Object.assign({}, e.complianceChecklist[key], saved);
        if (window.showToast) showToast('Compliance item saved');
        rerenderPane('compliance', compliancePane(U, e));
        reloadSoon();
      }).catch(function (err) { if (window.showToast) showToast('Error: ' + (err && err.message || err), true); });
    },

    // ── Per-employee document editor (NATIVE — metadata + link record) ──────
    docAdd: function (id) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var e = V2.byId[id]; if (e) rerenderPane('documents', documentForm(U, e, null));
    },
    docEdit: function (id, docId) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var e = V2.byId[id]; if (e) rerenderPane('documents', documentForm(U, e, docId));
    },
    docCancel: function (id) { var e = V2.byId[id]; if (e) rerenderPane('documents', documentsPane(U, e)); },
    docSave: function (id, docId) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var b = bridge(); if (!b) return;
      var title = val('teamV2DocTitle').trim();
      if (!title) { if (window.showToast) showToast('Title is required', true); return; }
      var fields = {
        title: title,
        type: val('teamV2DocType') || 'other',
        status: val('teamV2DocStatus') || 'current',
        storageLocation: val('teamV2DocStorage') || null,
        onFileDate: val('teamV2DocOnFile') || null,
        expiryDate: val('teamV2DocExpiry') || null,
        url: val('teamV2DocUrl').trim() || null,
        description: val('teamV2DocDesc').trim() || null,
        notes: val('teamV2DocNotes').trim() || null
      };
      Promise.resolve(b.addDocument(id, fields, docId || null)).then(function (saved) {
        var e = V2.byId[id]; if (!e) return;
        if (!e.documents || Array.isArray(e.documents)) e.documents = mapFromColl(e.documents, 'documentId');
        e.documents[saved._key] = saved;
        if (window.showToast) showToast(docId ? 'Document saved' : 'Document added');
        rerenderPane('documents', documentsPane(U, e));
        rerenderPane('records', recordsPane(U, e));   // count lives on Records
        reloadSoon();
      }).catch(function (err) { if (window.showToast) showToast('Error: ' + (err && err.message || err), true); });
    },
    docRemove: function (id, docId) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var b = bridge(); if (!b) return;
      mastConfirm('Delete this document?', { title: 'Delete document', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(b.removeDocument(id, docId)).then(function () {
          var e = V2.byId[id]; if (e && e.documents) { if (Array.isArray(e.documents)) e.documents = mapFromColl(e.documents, 'documentId'); delete e.documents[docId]; }
          if (window.showToast) showToast('Document deleted');
          rerenderPane('documents', documentsPane(U, e || { _key: id }));
          rerenderPane('records', recordsPane(U, e || { _key: id }));
          reloadSoon();
        }).catch(function (err) { if (window.showToast) showToast('Error: ' + (err && err.message || err), true); });
      });
    },

    // ── Per-employee reference editor (NATIVE) ──────────────────────────────
    refAdd: function (id) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var e = V2.byId[id]; if (e) rerenderPane('references', referenceForm(U, e, null));
    },
    refEdit: function (id, refId) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var e = V2.byId[id]; if (e) rerenderPane('references', referenceForm(U, e, refId));
    },
    refCancel: function (id) { var e = V2.byId[id]; if (e) rerenderPane('references', referencesPane(U, e)); },
    refSave: function (id, refId) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var b = bridge(); if (!b) return;
      var name = val('teamV2RefName').trim();
      if (!name) { if (window.showToast) showToast('Name is required', true); return; }
      var fields = {
        name: name,
        phone: val('teamV2RefPhone').trim() || null,
        relationship: val('teamV2RefRel').trim() || null,
        outcome: val('teamV2RefOutcome') || 'not-checked',
        checkedDate: val('teamV2RefDate') || null,
        notes: val('teamV2RefNotes').trim() || null
      };
      Promise.resolve(b.addReference(id, fields, refId || null)).then(function (saved) {
        var e = V2.byId[id]; if (!e) return;
        if (!e.references || Array.isArray(e.references)) e.references = mapFromColl(e.references, 'referenceId');
        e.references[saved._key] = saved;
        if (window.showToast) showToast(refId ? 'Reference saved' : 'Reference added');
        rerenderPane('references', referencesPane(U, e));
        rerenderPane('records', recordsPane(U, e));
        reloadSoon();
      }).catch(function (err) { if (window.showToast) showToast('Error: ' + (err && err.message || err), true); });
    },
    refRemove: function (id, refId) {
      if (!canEditTeam()) { if (window.showToast) showToast('Edit access required.', true); return; }
      var b = bridge(); if (!b) return;
      mastConfirm('Delete this reference?', { title: 'Delete reference', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(b.removeReference(id, refId)).then(function () {
          var e = V2.byId[id]; if (e && e.references) { if (Array.isArray(e.references)) e.references = mapFromColl(e.references, 'referenceId'); delete e.references[refId]; }
          if (window.showToast) showToast('Reference deleted');
          rerenderPane('references', referencesPane(U, e || { _key: id }));
          rerenderPane('records', recordsPane(U, e || { _key: id }));
          reloadSoon();
        }).catch(function (err) { if (window.showToast) showToast('Error: ' + (err && err.message || err), true); });
      });
    },

    // Sub-surface lenses (classic burn-down Wave B): re-hosted legacy panels.
    setLens: function (l) {
      V2.lens = l;
      try { U.slideOut.requestCloseForce(); } catch (e) {}
      render();
    },
    exportCsv: function () { return MastEntity.exportRows('team-v2', visibleRows(), 'all'); }
  };

  function routeSetup() {
    ensureTab();
    V2.allowed = canViewTeam();
    render();
    if (V2.allowed) load();
  }
  MastAdmin.registerModule('team-v2', {
    routes: {
      'team-v2': { tab: 'teamV2Tab', setup: routeSetup },
      // Legacy #team route ABSORBED (T6): team.js is deleted, so the twin owns
      // the bare route directly (no MAST_V2_ROUTE_MAP remap, no navigateToClassic
      // fallback). TeamBridge + TeamPanels live in the absorbed IIFE below.
      'team': { tab: 'teamV2Tab', setup: routeSetup }
    }
  });
})();


// ============================================================================
// TeamBridge + TeamPanels + the full HR handler closure — ABSORBED from the
// retired team.js (T6). team.js (the legacy Team UI, ~3,388 lines) is deleted.
// Its roster/employee-detail UI was already superseded by team-v2 above, but it
// still single-sourced (a) every employee/compliance/document/reference WRITE
// through window.TeamBridge and (b) the re-hosted HR sub-surfaces (Time Clock /
// PTO / Labor Burden / Documents / Onboarding) through window.TeamPanels, both
// reached by team-v2 via loadModule('team'). That bridge, the panel host, and
// their full transitive closure (renderers, openX forms, save handlers, and the
// window.team* onclick handlers the panel HTML invokes) are lifted here VERBATIM.
// The closure is self-contained: it references only shell globals (MastDB / auth /
// can / esc / showToast / mastConfirm / fetchDriveFileMetadata / writeAudit / …)
// plus its own members; a cross-module word-boundary scan found ZERO consumers of
// any team-owned export outside team-v2. The legacy MastAdmin.registerModule('team')
// is dropped — team-v2's main IIFE owns the bare #team route now.
// ============================================================================
(function() {
  'use strict';

  var employeesData = [];
  var tenantDocs = [];
  var teamLoaded = false;
  var currentView = 'roster'; // roster | detail | docs
  var selectedEmployeeId = null;
  var editingEmployeeId = null;
  var editingDocId = null;
  var driveExplainerShown = false;

  // Time Clock state
  var tcSelectedEmployeeId = null;
  var tcWeekOffset = 0;
  var tcTimerInterval = null;

  // PTO state
  var ptoSelectedEmployeeId = null;
  var ptoPolicies = {};

  // Documents filter state
  var docFilterEmployee = '';
  var docFilterStatus = '';

  // Onboarding filter state
  var onboardingFilter = 'all';

  // ========================================
  // W3.2 / W3.3 — Labor Burden state
  // (Idea -OtMKtFHnUZE2xD25BzV; Job -OteH2BLijKcyZ5U9YXe)
  // Concepts: D-FIN-W3-3 (Labor Burden panel), D-FIN-W3-2 (Estimator settings).
  // Backend contract from Agent A: recordBurdenEntry + seedStateSutaTable CFs.
  // ========================================
  var burdenSubView = 'entries';    // 'entries' | 'estimator'
  var burdenSelectedEmployeeId = ''; // filters entries list
  var burdenSelectedPeriodId = '';   // form state
  var burdenBenefitRows = [];        // {type, amount} dollars; mirror of form
  var burdenJobsCache = null;        // [{id, name}]
  var burdenEntriesCache = {};       // {periodId: {employeeId: doc}}
  var burdenEstimator = null;        // _meta.burdenSource snapshot

  // --- Constants ---
  var COMPLIANCE_FIELDS = [
    { key: 'i9', label: 'I-9' },
    { key: 'w4', label: 'W-4' },
    { key: 'stateWithholding', label: 'State Withholding' },
    { key: 'offerLetter', label: 'Offer Letter' },
    { key: 'workersComp', label: "Workers' Comp Certificate" },
  ];
  var STORAGE_OPTIONS = [
    { value: 'physical', label: 'Physical' },
    { value: 'google-drive', label: 'Google Drive' },
    { value: 'dropbox', label: 'Dropbox' },
    { value: 'gusto', label: 'Gusto' },
    { value: 'other', label: 'Other' },
  ];
  var DOC_TYPES = ['employment', 'tax', 'certification', 'insurance', 'license', 'legal', 'compliance', 'financial', 'other'];
  var EMPLOYMENT_TYPES = ['full-time', 'part-time', 'temp', 'contractor'];
  var PAY_TYPES = ['hourly', 'salary', 'piece-rate'];
  var PAY_FREQUENCIES = ['weekly', 'bi-weekly', 'monthly'];
  var REFERENCE_OUTCOMES = ['positive', 'neutral', 'concerning', 'not-checked'];

  var INPUT_STYLE = 'width:100%;padding:9px 12px;border:1px solid var(--cream-dark,#ddd);border-radius:6px;font-size:0.9rem;background:var(--cream,var(--cream));box-sizing:border-box;font-family:DM Sans,sans-serif;color:var(--text-primary);';

  // --- Helpers ---
  function fmtDollars(cents) {
    if (cents == null || cents === 0) return 'not set';
    return '$' + (cents / 100).toFixed(2);
  }
  function fmtRate(cents, payType) {
    if (cents == null) return 'not set';
    var label = payType === 'salary' ? '/mo' : '/hr';
    return '$' + (cents / 100).toFixed(2) + label;
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function labelField(id, label, inputHtml) {
    return '<div><label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;" for="' + id + '">' + esc(label) + '</label>' + inputHtml + '</div>';
  }
  function textInput(id, value, placeholder) {
    return '<input id="' + id + '" type="text" value="' + esc(value || '') + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + ' style="' + INPUT_STYLE + '">';
  }
  function numberInput(id, value, step, placeholder) {
    return '<input id="' + id + '" type="number"' + (step ? ' step="' + step + '"' : '') + ' value="' + (value != null ? value : '') + '"' + (placeholder ? ' placeholder="' + esc(placeholder) + '"' : '') + ' style="' + INPUT_STYLE + '">';
  }
  function dateInput(id, value) {
    return '<input id="' + id + '" type="date" value="' + (value || '') + '" style="' + INPUT_STYLE + '">';
  }
  function selectInput(id, options, selectedValue) {
    var h = '<select id="' + id + '" style="' + INPUT_STYLE + '">';
    options.forEach(function(opt) {
      var val = typeof opt === 'string' ? opt : opt.value;
      var label = typeof opt === 'string' ? capitalize(opt.replace('-', ' ')) : opt.label;
      h += '<option value="' + esc(val) + '"' + (val === selectedValue ? ' selected' : '') + '>' + esc(label) + '</option>';
    });
    h += '</select>';
    return h;
  }
  function fullWidthDiv(content) { return '<div style="grid-column:1/-1;">' + content + '</div>'; }

  // Collapsible section: header with toggle, content hidden by default (or open)
  function collapsibleSection(id, title, contentHtml, opts) {
    opts = opts || {};
    var open = opts.open !== false; // open by default unless opts.open === false
    var badge = opts.badge || '';
    var rightHtml = opts.rightHtml || '';
    var h = '<div style="margin-bottom:16px;">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;padding:6px 0;" onclick="teamToggleSection(\'' + id + '\')">';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<span style="font-size:0.72rem;color:var(--warm-gray);transition:transform 0.15s;" id="' + id + 'Arrow">' + (open ? '\u25bc' : '\u25b6') + '</span>';
    h += '<span style="font-size:1rem;font-weight:600;">' + esc(title) + '</span>';
    if (badge) h += ' ' + badge;
    h += '</div>';
    h += rightHtml;
    h += '</div>';
    h += '<div id="' + id + '" style="' + (open ? '' : 'display:none;') + '">';
    h += contentHtml;
    h += '</div>';
    h += '</div>';
    return h;
  }

  function calcMonthlyCost(emp) {
    if (!emp.payRate) return 0;
    if (emp.payType === 'salary') return emp.payRate;
    return Math.round((emp.payRate || 0) * (emp.scheduledHoursPerWeek || 0) * 4.33);
  }

  function isDriveUrl(url) {
    return url && /drive\.google\.com|docs\.google\.com/.test(url);
  }

  // Renders the Drive URL + preview section used in compliance and document forms
  function renderDriveUrlField(prefix, existingUrl, existingDrive) {
    var drive = existingDrive || {};
    var h = '';
    h += fullWidthDiv(labelField(prefix + 'Url', 'URL or Google Drive link', textInput(prefix + 'Url', existingUrl || '', 'https://drive.google.com/file/d/...')));

    // Drive metadata preview (hidden until populated)
    h += '<div id="' + prefix + 'DrivePreview" style="grid-column:1/-1;display:' + (drive.driveFileName ? '' : 'none') + ';">';
    if (drive.driveFileName) {
      h += renderDrivePreview(prefix, drive);
    }
    h += '</div>';

    // Drive explainer (shown once per session when google-drive storage selected)
    h += '<div id="' + prefix + 'DriveExplainer" style="grid-column:1/-1;display:none;background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:6px;padding:10px 14px;font-size:0.78rem;color:#86efac;">';
    h += '\ud83d\udd17 Paste a Google Drive share link above to auto-link the file. Make sure linked files are set to <strong>restricted access</strong> in Drive (not "anyone with the link").';
    h += '</div>';

    return h;
  }

  function renderDrivePreview(prefix, drive) {
    var h = '<div style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-size:0.85rem;">\ud83d\udcc4 <strong>' + esc(drive.driveFileName || '') + '</strong>';
    if (drive.driveLastModified) h += ' \u00b7 Modified ' + (drive.driveLastModified || '').split('T')[0];
    h += '</div>';
    h += '<button type="button" class="btn btn-secondary btn-small" onclick="teamUnlinkDrive(\'' + esc(prefix) + '\')">Unlink</button>';
    h += '</div>';
    return h;
  }

  function attachDriveUrlListener(prefix, storageSelectId) {
    var urlEl = document.getElementById(prefix + 'Url');
    var storageEl = storageSelectId ? document.getElementById(storageSelectId) : null;

    if (urlEl) {
      urlEl.addEventListener('blur', function() {
        var url = this.value.trim();
        if (isDriveUrl(url)) {
          // Auto-switch storage to google-drive if not already
          if (storageEl && storageEl.value !== 'google-drive') {
            storageEl.value = 'google-drive';
          }
          fetchAndShowDrivePreview(prefix, url);
        }
      });
    }

    if (storageEl) {
      storageEl.addEventListener('change', function() {
        var explainer = document.getElementById(prefix + 'DriveExplainer');
        if (this.value === 'google-drive' && explainer && !driveExplainerShown) {
          explainer.style.display = '';
          driveExplainerShown = true;
        } else if (explainer && this.value !== 'google-drive') {
          explainer.style.display = 'none';
        }
      });
      // Trigger on load if already google-drive
      if (storageEl.value === 'google-drive' && !driveExplainerShown) {
        var explainer = document.getElementById(prefix + 'DriveExplainer');
        if (explainer) { explainer.style.display = ''; driveExplainerShown = true; }
      }
    }
  }

  async function fetchAndShowDrivePreview(prefix, url) {
    var preview = document.getElementById(prefix + 'DrivePreview');
    if (!preview) return;
    preview.innerHTML = '<div style="font-size:0.78rem;color:var(--warm-gray);">Fetching file info\u2026</div>';
    preview.style.display = '';

    var meta = await fetchDriveFileMetadata(url);
    if (!meta) {
      preview.innerHTML = '<div style="font-size:0.78rem;color:var(--danger);">Could not fetch file metadata. Check the URL and try again.</div>';
      return;
    }

    // Store metadata in hidden fields
    preview.dataset.driveFileId = url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || '';
    preview.dataset.driveFileName = meta.name || '';
    preview.dataset.driveLastModified = meta.modifiedTime || '';

    preview.innerHTML = renderDrivePreview(prefix, {
      driveFileName: meta.name,
      driveLastModified: meta.modifiedTime,
    });

    // Hide explainer once linked
    var explainer = document.getElementById(prefix + 'DriveExplainer');
    if (explainer) explainer.style.display = 'none';
  }

  function unlinkDrive(prefix) {
    var preview = document.getElementById(prefix + 'DrivePreview');
    if (preview) {
      preview.innerHTML = '';
      preview.style.display = 'none';
      delete preview.dataset.driveFileId;
      delete preview.dataset.driveFileName;
      delete preview.dataset.driveLastModified;
    }
    var urlEl = document.getElementById(prefix + 'Url');
    if (urlEl) urlEl.value = '';
  }

  function collectDriveFields(prefix) {
    var preview = document.getElementById(prefix + 'DrivePreview');
    if (preview && preview.dataset.driveFileName) {
      return {
        driveFileId: preview.dataset.driveFileId || null,
        driveFileName: preview.dataset.driveFileName || null,
        driveLastModified: preview.dataset.driveLastModified || null,
      };
    }
    return { driveFileId: null, driveFileName: null, driveLastModified: null };
  }

  // --- Time/PTO Helpers ---
  function getWeekRange(offset) {
    var now = new Date();
    var startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + (offset * 7));
    startOfWeek.setHours(0, 0, 0, 0);
    var endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(startOfWeek.getDate() + 6);
    endOfWeek.setHours(23, 59, 59, 999);
    return { start: startOfWeek, end: endOfWeek };
  }
  function formatTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    var h = d.getHours(), m = d.getMinutes(), ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + (m < 10 ? '0' : '') + m + ' ' + ampm;
  }
  function fmtDateShort(d) {
    return (d.getMonth() + 1) + '/' + d.getDate();
  }

  // --- Load ---
  async function loadTeam() {
    var container = document.getElementById('teamTab');
    if (!container && !(v2PanelHost && v2PanelHost.container)) return;
    if (container) container.innerHTML = '<div class="loading">Loading team\u2026</div>';

    try {
      var results = await Promise.all([
        MastDB.get('admin/employees'),
        MastDB.get('admin/documents'),
      ]);

      var empVal = results[0] || {};
      employeesData = Object.entries(empVal).map(function(entry) {
        var emp = entry[1];
        emp._key = entry[0];
        return emp;
      });

      var docsVal = results[1] || {};
      tenantDocs = Object.entries(docsVal).map(function(entry) {
        var doc = entry[1];
        doc._key = entry[0];
        return doc;
      });

      teamLoaded = true;
      rerenderHost();
    } catch (err) {
      console.error('Error loading team:', err);
      if (container) container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Error loading team data.</div>';
    }
  }

  // Returns true if the current user has operational management access (Admin or Manager).
  // Used to gate Team tabs that are not self-service (Time Clock, PTO, Documents, Onboarding).
  function canManageTeam() {
    return typeof can === 'function' ? can('team', 'edit') : true;
  }

  // ── V2 panel host (classic burn-down Wave B) ─────────────────────────
  // team-v2 re-hosts the legacy sub-surfaces (Time Clock / PTO / Labor Burden /
  // Documents / Onboarding) INSIDE the V2 page — same battle-tested panels,
  // one implementation, no classic link. The panels' own window.team* handlers
  // keep working because they getElementById within the rendered HTML; while a
  // V2 host is active we blank #teamTab so those ids stay unique.
  var v2PanelHost = null;   // { view, container } when a panel is shown in team-v2

  function panelHtml(view) {
    if (view === 'timeclock') return renderTimeClock();
    if (view === 'pto') return renderPto();
    if (view === 'burden') return renderLaborBurden();
    if (view === 'docs') return renderComplianceDocs();
    if (view === 'onboarding') return renderOnboarding();
    return '';
  }

  // Re-render whichever host (legacy tab or V2 panel container) is active.
  function rerenderHost() {
    if (v2PanelHost && v2PanelHost.container && document.body.contains(v2PanelHost.container)) {
      currentView = v2PanelHost.view;
      v2PanelHost.container.innerHTML = panelHtml(v2PanelHost.view);
      if (window.mastInitFilterPills) window.mastInitFilterPills(v2PanelHost.container);
      return;
    }
    var c = document.getElementById('teamTab');
    if (c) renderTeam(c);
  }

  window.TeamPanels = {
    // Show a legacy sub-surface in a V2 container. Manager gating mirrors
    // renderTeam (docs/onboarding/burden are manager-only).
    show: async function (view, container) {
      if (!container) return;
      if (!canManageTeam() && (view === 'docs' || view === 'onboarding' || view === 'burden')) view = 'timeclock';
      v2PanelHost = { view: view, container: container };
      var legacyTab = document.getElementById('teamTab');
      if (legacyTab) legacyTab.innerHTML = '';   // keep panel ids unique (legacy re-renders on next visit)
      if (!teamLoaded) {
        container.innerHTML = '<div class="loading">Loading team\u2026</div>';
        try {
          var results = await Promise.all([MastDB.get('admin/employees'), MastDB.get('admin/documents')]);
          var empVal = results[0] || {};
          employeesData = Object.entries(empVal).map(function (entry) { var emp = entry[1]; emp._key = entry[0]; return emp; });
          var docsVal = results[1] || {};
          tenantDocs = Object.entries(docsVal).map(function (entry) { var doc = entry[1]; doc._key = entry[0]; return doc; });
          teamLoaded = true;
        } catch (err) {
          container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--danger);">Error loading team data.</div>';
          return;
        }
      }
      rerenderHost();
    },
    // team-v2 calls this when leaving the panel lenses (back to its roster).
    release: function () { v2PanelHost = null; }
  };

  // --- Main Render ---
  function renderTeam(container) {
    v2PanelHost = null;   // legacy render claims the host (release any V2 panel)
    var mgr = canManageTeam();
    // Restrict manager-only tabs
    if (!mgr && (currentView === 'docs' || currentView === 'onboarding' || currentView === 'burden')) {
      currentView = 'roster';
    }
    var h = '';
    h += '<div class="view-tabs" style="margin-bottom:20px;">';
    h += '<button class="view-tab' + (currentView === 'roster' || currentView === 'detail' ? ' active' : '') + '" onclick="teamSwitchView(\'roster\')">Roster</button>';
    h += '<button class="view-tab' + (currentView === 'timeclock' ? ' active' : '') + '" onclick="teamSwitchView(\'timeclock\')">Time Clock</button>';
    h += '<button class="view-tab' + (currentView === 'pto' ? ' active' : '') + '" onclick="teamSwitchView(\'pto\')">PTO</button>';
    if (mgr) {
      h += '<button class="view-tab' + (currentView === 'burden' ? ' active' : '') + '" onclick="teamSwitchView(\'burden\')">Labor Burden</button>';
      h += '<button class="view-tab' + (currentView === 'docs' ? ' active' : '') + '" onclick="teamSwitchView(\'docs\')">Documents</button>';
      h += '<button class="view-tab' + (currentView === 'onboarding' ? ' active' : '') + '" onclick="teamSwitchView(\'onboarding\')">Onboarding</button>';
    }
    h += '</div>';

    if (currentView === 'roster') {
      h += renderRoster();
    } else if (currentView === 'detail') {
      h += renderEmployeeDetail();
    } else if (currentView === 'timeclock') {
      h += renderTimeClock();
    } else if (currentView === 'pto') {
      h += renderPto();
    } else if (currentView === 'burden') {
      h += renderLaborBurden();
    } else if (currentView === 'docs') {
      h += renderComplianceDocs();
    } else if (currentView === 'onboarding') {
      h += renderOnboarding();
    }

    container.innerHTML = h;
    if (window.mastInitFilterPills) window.mastInitFilterPills(container);
  }

  // ========================================
  // Tab: Time Clock
  // ========================================
  function renderTimeClock() {
    return canManageTeam() ? renderTimeClockManager() : renderTimeClockSelf();
  }

  function renderTimeClockManager() {
    var h = '';
    h += '<div id="tcActiveBanner" style="display:none;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:6px;padding:8px 14px;margin-bottom:12px;font-size:0.85rem;color:#fbbf24;"></div>';
    h += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<select id="tcEmpFilter" onchange="teamTcSetEmployee(this.value)" style="' + INPUT_STYLE + 'width:auto;min-width:180px;">';
    h += '<option value="">All employees</option>';
    employeesData.filter(function(e) { return (e.status || 'active') === 'active'; }).forEach(function(emp) {
      h += '<option value="' + esc(emp._key) + '"' + (tcSelectedEmployeeId === emp._key ? ' selected' : '') + '>' + esc(emp.fullName || '') + '</option>';
    });
    h += '</select>';
    h += '<div style="display:flex;align-items:center;gap:8px;">';
    h += '<button class="btn btn-secondary btn-small" onclick="teamTcPrevWeek()">&larr;</button>';
    h += '<span id="tcWeekLabel" style="font-size:0.85rem;font-weight:600;min-width:140px;text-align:center;"></span>';
    h += '<button class="btn btn-secondary btn-small" id="tcNextBtn" onclick="teamTcNextWeek()">&rarr;</button>';
    h += '</div>';
    h += '<button class="btn btn-primary btn-small" onclick="teamTcAddEntry()">+ Add Entry</button>';
    h += '</div>';
    h += '<div id="tcAddForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="tcAddFormInner"></div></div>';
    h += '<div id="tcTableWrap"><div class="loading">Loading time entries&hellip;</div></div>';
    setTimeout(loadTcManager, 0);
    return h;
  }

  async function loadTcManager() {
    var wrap = document.getElementById('tcTableWrap');
    var banner = document.getElementById('tcActiveBanner');
    if (!wrap) return;
    try {
      var raw = await MastDB.get('admin/timeEntries') || {};
      var all = Object.entries(raw).map(function(e) { var v = e[1]; v._key = e[0]; return v; });

      var active = all.filter(function(e) { return !e.clockOut; });
      if (banner) {
        if (active.length > 0) {
          banner.style.display = '';
          banner.innerHTML = '&#9889; <strong>' + MastFormat.countNoun(active.length, 'employee') + ' currently clocked in</strong>';
        } else {
          banner.style.display = 'none';
        }
      }

      var range = getWeekRange(tcWeekOffset);
      var lbl = document.getElementById('tcWeekLabel');
      var nxtBtn = document.getElementById('tcNextBtn');
      if (lbl) lbl.textContent = fmtDateShort(range.start) + ' – ' + fmtDateShort(range.end);
      if (nxtBtn) nxtBtn.disabled = tcWeekOffset >= 0;

      var entries = all.filter(function(e) {
        if (!e.clockIn) return false;
        var d = new Date(e.clockIn);
        return d >= range.start && d <= range.end;
      });
      if (tcSelectedEmployeeId) entries = entries.filter(function(e) { return e.employeeId === tcSelectedEmployeeId; });
      entries.sort(function(a, b) { return (b.clockIn || '').localeCompare(a.clockIn || ''); });

      var totalHrs = 0;
      entries.forEach(function(e) { if (e.hoursWorked) totalHrs += e.hoursWorked; });

      var h = '';
      if (entries.length === 0) {
        h = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);"><div style="font-size:1.6rem;margin-bottom:8px;">&#9201;</div><p style="font-size:0.9rem;font-weight:500;">No time entries this week</p></div>';
      } else {
        h += '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
        h += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));text-align:left;">';
        if (!tcSelectedEmployeeId) h += '<th style="padding:8px 10px;font-weight:600;">Employee</th>';
        h += '<th style="padding:8px 10px;font-weight:600;">Date</th><th style="padding:8px 10px;font-weight:600;">Clock In</th><th style="padding:8px 10px;font-weight:600;">Clock Out</th><th style="padding:8px 10px;font-weight:600;text-align:right;">Hours</th><th style="padding:8px 10px;font-weight:600;">Notes</th></tr></thead><tbody>';
        entries.forEach(function(entry) {
          var empObj = employeesData.find(function(e) { return e._key === entry.employeeId; });
          var isOpen = !entry.clockOut;
          h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
          if (!tcSelectedEmployeeId) h += '<td style="padding:8px 10px;">' + esc(empObj ? empObj.fullName : entry.employeeId || '—') + '</td>';
          h += '<td style="padding:8px 10px;">' + esc(entry.date || '') + '</td>';
          h += '<td style="padding:8px 10px;">' + formatTime(entry.clockIn) + '</td>';
          h += '<td style="padding:8px 10px;">' + (isOpen ? '<span style="color:#22c55e;font-size:0.78rem;font-weight:600;">&#9679; Active</span>' : formatTime(entry.clockOut)) + '</td>';
          h += '<td style="padding:8px 10px;text-align:right;">' + (isOpen ? '—' : (entry.hoursWorked != null ? entry.hoursWorked.toFixed(2) : '—')) + '</td>';
          h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + esc(entry.notes || '') + '</td></tr>';
        });
        h += '</tbody></table></div>';
        var selEmp = tcSelectedEmployeeId ? employeesData.find(function(e) { return e._key === tcSelectedEmployeeId; }) : null;
        h += '<div style="display:flex;justify-content:flex-end;gap:24px;padding:10px;border-top:2px solid var(--cream-dark,var(--cream-dark));font-size:0.85rem;">';
        h += '<div>Total hours: <strong>' + totalHrs.toFixed(2) + '</strong></div>';
        if (selEmp && selEmp.payRate) {
          h += '<div>Labor cost: <strong>$' + (totalHrs * selEmp.payRate / 100).toFixed(2) + '</strong></div>';
        }
        h += '</div>';
      }
      wrap.innerHTML = h;
    } catch (err) {
      if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading time entries.</div>';
    }
  }

  function renderTimeClockSelf() {
    var h = '<div id="tcSelfStatus" style="margin-bottom:16px;"><div class="loading">Loading&hellip;</div></div>';
    h += '<div id="tcSelfTable"><div class="loading">Loading your entries&hellip;</div></div>';
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    setTimeout(function() { loadTcSelf(uid); }, 0);
    return h;
  }

  async function loadTcSelf(uid) {
    var statusEl = document.getElementById('tcSelfStatus');
    var tableEl = document.getElementById('tcSelfTable');
    if (!statusEl) return;
    try {
      var raw = await MastDB.get('admin/timeEntries') || {};
      var mine = Object.entries(raw).map(function(e) { var v = e[1]; v._key = e[0]; return v; })
        .filter(function(e) { return e.employeeId === uid || e.createdBy === uid; })
        .sort(function(a, b) { return (b.clockIn || '').localeCompare(a.clockIn || ''); });
      var openEntry = mine.find(function(e) { return !e.clockOut; });

      var sh = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">';
      if (openEntry) {
        sh += '<div style="background:rgba(34,197,94,0.15);border:1px solid rgba(34,197,94,0.4);border-radius:8px;padding:10px 16px;">';
        sh += '<div style="font-size:0.85rem;color:#22c55e;font-weight:600;">&#9679; Clocked in since ' + formatTime(openEntry.clockIn) + '</div>';
        sh += '<div id="tcTimer" style="font-size:1.6rem;font-weight:700;font-family:monospace;color:#22c55e;"></div></div>';
        sh += '<button class="btn btn-primary" data-key="' + esc(openEntry._key) + '" onclick="teamTcClockOut(this.dataset.key)">Clock Out</button>';
        startTcTimer(openEntry.clockIn);
      } else {
        sh += '<button class="btn btn-primary" onclick="teamTcClockIn()">Clock In</button>';
        if (tcTimerInterval) { clearInterval(tcTimerInterval); tcTimerInterval = null; }
      }
      sh += '</div>';
      statusEl.innerHTML = sh;

      var th = '';
      if (mine.length === 0) {
        th = '<div style="text-align:center;padding:30px;color:var(--warm-gray);"><p style="font-size:0.9rem;font-weight:500;">No time entries yet</p></div>';
      } else {
        th += '<h4 style="font-size:0.9rem;font-weight:600;margin:16px 0 8px;">Recent Entries</h4>';
        th += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
        th += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));"><th style="padding:8px 10px;text-align:left;font-weight:600;">Date</th><th style="padding:8px 10px;text-align:left;font-weight:600;">In</th><th style="padding:8px 10px;text-align:left;font-weight:600;">Out</th><th style="padding:8px 10px;text-align:right;font-weight:600;">Hours</th></tr></thead><tbody>';
        mine.slice(0, 20).forEach(function(e) {
          var open = !e.clockOut;
          th += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
          th += '<td style="padding:8px 10px;">' + esc(e.date || '') + '</td>';
          th += '<td style="padding:8px 10px;">' + formatTime(e.clockIn) + '</td>';
          th += '<td style="padding:8px 10px;">' + (open ? '<span style="color:#22c55e;font-size:0.78rem;">Active</span>' : formatTime(e.clockOut)) + '</td>';
          th += '<td style="padding:8px 10px;text-align:right;">' + (open ? '—' : (e.hoursWorked != null ? e.hoursWorked.toFixed(2) : '—')) + '</td></tr>';
        });
        th += '</tbody></table>';
      }
      if (tableEl) tableEl.innerHTML = th;
    } catch (err) {
      if (statusEl) statusEl.innerHTML = '<div style="color:var(--danger);">Error loading time data.</div>';
    }
  }

  function startTcTimer(clockInIso) {
    if (tcTimerInterval) clearInterval(tcTimerInterval);
    function tick() {
      var el = document.getElementById('tcTimer');
      if (!el) { clearInterval(tcTimerInterval); tcTimerInterval = null; return; }
      var ms = Date.now() - new Date(clockInIso).getTime();
      var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), s = Math.floor((ms % 60000) / 1000);
      el.textContent = h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    tick();
    tcTimerInterval = setInterval(tick, 1000);
  }

  async function tcClockIn() {
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    var now = new Date();
    var key = MastDB.newKey('admin/timeEntries');
    var entry = { id: key, employeeId: uid, clockIn: now.toISOString(), clockOut: null, hoursWorked: null, date: now.toISOString().split('T')[0], status: 'active', createdBy: uid, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    try {
      await MastDB.set('admin/timeEntries/' + key, entry);
      showToast('Clocked in');
      loadTcSelf(uid);
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  async function tcClockOut(entryKey) {
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    try {
      var raw = await MastDB.get('admin/timeEntries/' + entryKey);
      if (!raw || !raw.clockIn) { showToast('Entry not found', true); return; }
      var now = new Date();
      var hrs = Math.round((now.getTime() - new Date(raw.clockIn).getTime()) / 36000) / 100;
      await MastDB.update('admin/timeEntries/' + entryKey, { clockOut: now.toISOString(), hoursWorked: hrs, status: 'complete', updatedAt: now.toISOString() });
      showToast('Clocked out — ' + hrs.toFixed(2) + ' hrs');
      loadTcSelf(uid);
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  function openTcAddForm() {
    var formEl = document.getElementById('tcAddForm'), innerEl = document.getElementById('tcAddFormInner');
    if (!formEl || !innerEl) return;
    var today = new Date().toISOString().split('T')[0];
    var empOpts = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; }).map(function(emp) {
      return '<option value="' + esc(emp._key) + '"' + (tcSelectedEmployeeId === emp._key ? ' selected' : '') + '>' + esc(emp.fullName || '') + '</option>';
    }).join('');
    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">New Time Entry</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:end;">';
    h += labelField('tcAEmp', 'Employee', '<select id="tcAEmp" style="' + INPUT_STYLE + '">' + empOpts + '</select>');
    h += labelField('tcADate', 'Date', dateInput('tcADate', today));
    h += labelField('tcAIn', 'Clock In', '<input id="tcAIn" type="time" style="' + INPUT_STYLE + '">');
    h += labelField('tcAOut', 'Clock Out', '<input id="tcAOut" type="time" style="' + INPUT_STYLE + '">');
    h += labelField('tcANotes', 'Notes', textInput('tcANotes', '', 'Optional'));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:10px;"><button class="btn btn-primary btn-small" onclick="teamTcSaveEntry()">Save</button><button class="btn btn-secondary btn-small" onclick="document.getElementById(\'tcAddForm\').style.display=\'none\'">Cancel</button></div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function saveTcEntry() {
    var empId = document.getElementById('tcAEmp').value;
    var date = document.getElementById('tcADate').value;
    var inTime = document.getElementById('tcAIn').value;
    var outTime = document.getElementById('tcAOut').value;
    if (!empId || !date || !inTime) { showToast('Employee, date, and clock-in time required', true); return; }
    var clockIn = date + 'T' + inTime + ':00', clockOut = outTime ? date + 'T' + outTime + ':00' : null;
    var hrs = clockOut ? Math.round((new Date(clockOut).getTime() - new Date(clockIn).getTime()) / 36000) / 100 : null;
    var key = MastDB.newKey('admin/timeEntries');
    try {
      await MastDB.set('admin/timeEntries/' + key, { id: key, employeeId: empId, clockIn: clockIn, clockOut: clockOut, hoursWorked: hrs, date: date, notes: document.getElementById('tcANotes').value.trim() || null, status: clockOut ? 'complete' : 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      showToast('Entry saved');
      document.getElementById('tcAddForm').style.display = 'none';
      loadTcManager();
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  // ========================================
  // Tab: PTO
  // ========================================
  function renderPto() {
    return canManageTeam() ? renderPtoManager() : renderPtoSelf();
  }

  function renderPtoManager() {
    var h = '';
    h += '<div id="ptoPolicyForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="ptoPolicyFormInner"></div></div>';
    h += '<div id="ptoUsageForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="ptoUsageFormInner"></div></div>';
    if (ptoSelectedEmployeeId) {
      h += '<button class="detail-back" onclick="teamPtoBack()">&larr; All Employees</button>';
      h += '<div id="ptoDetailWrap"><div class="loading">Loading PTO&hellip;</div></div>';
      setTimeout(function() { loadPtoDetail(ptoSelectedEmployeeId); }, 0);
    } else {
      h += '<div id="ptoBoardWrap"><div class="loading">Loading PTO data&hellip;</div></div>';
      setTimeout(loadPtoBoard, 0);
    }
    return h;
  }

  async function loadPtoBoard() {
    var wrap = document.getElementById('ptoBoardWrap');
    if (!wrap) return;
    try {
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var entries = Object.values(rawEntries);
      var rawPolicies = await MastDB.get('admin/ptoPolicy') || {};
      ptoPolicies = {};
      Object.entries(rawPolicies).forEach(function(e) { var p = e[1]; p._key = e[0]; ptoPolicies[p.employeeId || e[0]] = p; });

      var balMap = {}, usedYtd = {}, yr = new Date().getFullYear().toString();
      entries.forEach(function(e) {
        if (!e.employeeId) return;
        if (!balMap[e.employeeId] || (e.date || '') > (balMap[e.employeeId].date || '')) balMap[e.employeeId] = e;
        if (e.type === 'used' && (e.date || '').startsWith(yr)) usedYtd[e.employeeId] = (usedYtd[e.employeeId] || 0) + Math.abs(e.hours || 0);
      });

      var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
      var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;"><h2 style="margin:0;">PTO Overview</h2></div>';
      if (active.length === 0) {
        h += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No active employees.</div>';
      } else {
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;">';
        active.forEach(function(emp) {
          var bal = balMap[emp._key], policy = ptoPolicies[emp._key] || ptoPolicies['default'];
          var balance = bal ? (bal.balance || 0) : 0;
          var ytdUsed = usedYtd[emp._key] || 0;
          var aLabel = policy ? (policy.accrualType === 'annual-grant' ? 'Annual grant' : policy.accrualType === 'hourly' ? 'Hourly accrual' : 'Manual') : 'No policy';
          h += '<div onclick="teamPtoSelectEmp(\'' + esc(emp._key) + '\')" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
          h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:6px;">👤 ' + esc(emp.fullName || '') + '</div>';
          var balColor = balance < 0 ? '#d97706' : 'inherit';
          h += '<div style="font-size:1.6rem;font-weight:700;color:' + balColor + ';">' + balance.toFixed(1) + ' <span style="font-size:0.85rem;font-weight:400;color:var(--warm-gray);">hrs</span></div>';
          if (balance < 0) h += '<div style="font-size:0.72rem;color:#d97706;margin-top:2px;">Balance below zero — review accrual policy</div>';
          h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + esc(aLabel) + (ytdUsed > 0 ? ' · ' + ytdUsed.toFixed(1) + ' used YTD' : '') + '</div>';
          h += '</div>';
        });
        h += '</div>';
      }
      wrap.innerHTML = h;
    } catch (err) { if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading PTO data.</div>'; }
  }

  async function loadPtoDetail(empId) {
    var wrap = document.getElementById('ptoDetailWrap');
    if (!wrap) return;
    try {
      var emp = employeesData.find(function(e) { return e._key === empId; });
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var entries = Object.entries(rawEntries).map(function(e) { var v = e[1]; v._key = e[0]; return v; })
        .filter(function(e) { return e.employeeId === empId; })
        .sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var rawPolicies = await MastDB.get('admin/ptoPolicy') || {};
      ptoPolicies = {};
      Object.entries(rawPolicies).forEach(function(e) { var p = e[1]; p._key = e[0]; ptoPolicies[p.employeeId || e[0]] = p; });
      var policy = ptoPolicies[empId] || ptoPolicies['default'];
      var balance = entries[0] ? (entries[0].balance || 0) : 0;

      var h = '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">';
      h += '<div><h3 style="margin:0;">' + esc(emp ? emp.fullName : empId) + '</h3></div>';
      h += '<div style="display:flex;gap:8px;"><button class="btn btn-secondary btn-small" data-emp="' + esc(empId) + '" onclick="teamPtoEditPolicy(this.dataset.emp)">Edit Policy</button><button class="btn btn-primary btn-small" data-emp="' + esc(empId) + '" onclick="teamPtoRecordUsage(this.dataset.emp)">Record Usage</button></div></div>';
      h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px;">';
      var balColor = balance < 0 ? '#d97706' : 'inherit';
      h += '<div style="background:var(--cream,var(--cream));border:1px solid ' + (balance < 0 ? '#d97706' : 'var(--cream-dark,var(--cream-dark))') + ';border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Balance</div><div style="font-size:1.6rem;font-weight:700;color:' + balColor + ';">' + balance.toFixed(1) + '</div><div style="font-size:0.78rem;color:var(--warm-gray);">hours</div>' + (balance < 0 ? '<div style="font-size:0.72rem;color:#d97706;margin-top:4px;">Balance below zero — review accrual policy</div>' : '') + '</div>';
      if (policy) {
        var aType = policy.accrualType === 'annual-grant' ? 'Annual Grant' : policy.accrualType === 'hourly' ? 'Hourly' : 'Manual';
        var aDetail = policy.accrualType === 'annual-grant' && policy.accrualRate ? policy.accrualRate + ' hrs/year' : policy.accrualType === 'hourly' && policy.accrualRate ? policy.accrualRate + ' hrs/hr' : '';
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Accrual</div><div style="font-size:0.9rem;font-weight:600;">' + esc(aType) + '</div>' + (aDetail ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(aDetail) + '</div>' : '') + '</div>';
      }
      h += '</div>';
      h += '<h4 style="font-size:0.9rem;font-weight:600;margin-bottom:8px;">PTO History</h4>';
      if (entries.length === 0) {
        h += '<div style="color:var(--warm-gray);font-size:0.85rem;">No PTO history yet.</div>';
      } else {
        h += renderPtoTable(entries);
      }
      wrap.innerHTML = h;
    } catch (err) { if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading PTO details.</div>'; }
  }

  function renderPtoTable(entries) {
    var h = '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
    h += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));"><th style="padding:8px 10px;text-align:left;font-weight:600;">Date</th><th style="padding:8px 10px;text-align:left;font-weight:600;">Type</th><th style="padding:8px 10px;text-align:right;font-weight:600;">Hours</th><th style="padding:8px 10px;text-align:right;font-weight:600;">Balance</th><th style="padding:8px 10px;text-align:left;font-weight:600;">Notes</th></tr></thead><tbody>';
    entries.forEach(function(e) {
      var c = e.type === 'used' ? 'var(--danger)' : e.type === 'accrual' ? '#16a34a' : 'var(--warm-gray)';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
      h += '<td style="padding:8px 10px;">' + esc(e.date || '') + '</td>';
      h += '<td style="padding:8px 10px;color:' + c + ';">' + esc(capitalize(e.type || '')) + '</td>';
      h += '<td style="padding:8px 10px;text-align:right;color:' + c + ';">' + ((e.hours || 0) > 0 ? '+' : '') + (e.hours || 0).toFixed(1) + '</td>';
      h += '<td style="padding:8px 10px;text-align:right;font-weight:600;">' + (e.balance || 0).toFixed(1) + '</td>';
      h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + esc(e.notes || '') + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  function renderPtoSelf() {
    var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
    var h = '<div id="ptoSelfWrap"><div class="loading">Loading your PTO&hellip;</div></div>';
    setTimeout(function() { loadPtoSelf(uid); }, 0);
    return h;
  }

  async function loadPtoSelf(uid) {
    var wrap = document.getElementById('ptoSelfWrap');
    if (!wrap) return;
    try {
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var mine = Object.entries(rawEntries).map(function(e) { var v = e[1]; v._key = e[0]; return v; })
        .filter(function(e) { return e.employeeId === uid || e.createdBy === uid; })
        .sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
      var rawPolicies = await MastDB.get('admin/ptoPolicy') || {};
      var myPolicy = null;
      Object.values(rawPolicies).forEach(function(p) { if (p.employeeId === uid) myPolicy = p; });
      if (!myPolicy) Object.values(rawPolicies).forEach(function(p) { if (p.employeeId === 'default') myPolicy = p; });
      var balance = mine[0] ? (mine[0].balance || 0) : 0;

      var h = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:16px;">';
      var balColor = balance < 0 ? '#d97706' : 'inherit';
      h += '<div style="background:var(--cream,var(--cream));border:1px solid ' + (balance < 0 ? '#d97706' : 'var(--cream-dark,var(--cream-dark))') + ';border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Balance</div><div style="font-size:1.6rem;font-weight:700;color:' + balColor + ';">' + balance.toFixed(1) + '</div><div style="font-size:0.78rem;color:var(--warm-gray);">hours</div>' + (balance < 0 ? '<div style="font-size:0.72rem;color:#d97706;margin-top:4px;">Balance below zero — review accrual policy</div>' : '') + '</div>';
      if (myPolicy) {
        var aLabel = myPolicy.accrualType === 'annual-grant' ? 'Annual grant — ' + (myPolicy.accrualRate || 0) + ' hrs/year' : myPolicy.accrualType === 'hourly' ? 'Hourly — ' + (myPolicy.accrualRate || 0) + ' hrs/hr' : 'Manual';
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:4px;">Accrual</div><div style="font-size:0.85rem;font-weight:600;">' + esc(aLabel) + '</div></div>';
      }
      h += '</div>';
      h += '<div style="margin-bottom:12px;"><button class="btn btn-primary btn-small" onclick="teamPtoRequestSelf()">+ Request Time Off</button></div>';
      h += '<div id="ptoSelfUsageForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);"><div id="ptoSelfUsageFormInner"></div></div>';
      if (mine.length > 0) {
        h += '<h4 style="font-size:0.9rem;font-weight:600;margin-bottom:8px;">Your PTO History</h4>';
        h += renderPtoTable(mine);
      } else {
        h += '<div style="text-align:center;padding:30px;color:var(--warm-gray);"><p style="font-size:0.9rem;font-weight:500;">No PTO history yet</p></div>';
      }
      wrap.innerHTML = h;
    } catch (err) { if (wrap) wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading PTO data.</div>'; }
  }

  function openPtoPolicyForm(empId) {
    var formEl = document.getElementById('ptoPolicyForm'), innerEl = document.getElementById('ptoPolicyFormInner');
    if (!formEl || !innerEl) return;
    var emp = employeesData.find(function(e) { return e._key === empId; });
    var policy = ptoPolicies[empId] || ptoPolicies['default'] || {};
    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">PTO Policy — ' + esc(emp ? emp.fullName : empId) + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';
    h += labelField('ptoPType', 'Accrual type', selectInput('ptoPType', [{ value: 'annual-grant', label: 'Annual Grant' }, { value: 'hourly', label: 'Hourly Accrual' }, { value: 'manual', label: 'Manual' }, { value: 'none', label: 'No PTO' }], policy.accrualType || 'annual-grant'));
    h += labelField('ptoPRate', 'Accrual rate (hrs)', numberInput('ptoPRate', policy.accrualRate || '', '0.5', 'e.g. 40'));
    h += labelField('ptoPMax', 'Max balance (hrs)', numberInput('ptoPMax', policy.maxBalance || '', '1', 'e.g. 80'));
    h += labelField('ptoPCarry', 'Carryover limit', numberInput('ptoPCarry', policy.carryoverLimit || '', '1', 'blank = unlimited'));
    h += labelField('ptoPDate', 'Effective date', dateInput('ptoPDate', policy.effectiveDate || new Date().toISOString().split('T')[0]));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-primary btn-small" data-emp="' + esc(empId) + '" onclick="teamPtoSavePolicy(this.dataset.emp)">Save Policy</button><button class="btn btn-secondary btn-small" onclick="document.getElementById(\'ptoPolicyForm\').style.display=\'none\'">Cancel</button></div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function savePtoPolicy(empId) {
    var pol = { employeeId: empId, accrualType: document.getElementById('ptoPType').value, accrualRate: parseFloat(document.getElementById('ptoPRate').value) || 0, maxBalance: parseFloat(document.getElementById('ptoPMax').value) || 0, carryoverLimit: parseFloat(document.getElementById('ptoPCarry').value) || null, effectiveDate: document.getElementById('ptoPDate').value || null, updatedAt: new Date().toISOString() };
    try {
      var existing = ptoPolicies[empId];
      if (existing && existing._key) { await MastDB.update('admin/ptoPolicy/' + existing._key, pol); }
      else { var key = MastDB.newKey('admin/ptoPolicy'); pol.id = key; pol.createdAt = new Date().toISOString(); await MastDB.set('admin/ptoPolicy/' + key, pol); }
      showToast('Policy saved');
      document.getElementById('ptoPolicyForm').style.display = 'none';
      ptoSelectedEmployeeId = empId;
      var wrap = document.getElementById('ptoDetailWrap');
      if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; loadPtoDetail(empId); }
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  function openPtoUsageForm(empId, isSelf) {
    var cid = isSelf ? 'ptoSelfUsageForm' : 'ptoUsageForm', iid = isSelf ? 'ptoSelfUsageFormInner' : 'ptoUsageFormInner';
    var formEl = document.getElementById(cid), innerEl = document.getElementById(iid);
    if (!formEl || !innerEl) return;
    var emp = employeesData.find(function(e) { return e._key === empId; });
    var today = new Date().toISOString().split('T')[0];
    var typeOpts = isSelf ? [{ value: 'used', label: 'Time Off Used' }] : [{ value: 'used', label: 'Time Off Used' }, { value: 'accrual', label: 'Accrual' }, { value: 'adjustment', label: 'Adjustment' }];
    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isSelf ? 'Request Time Off' : 'Record PTO — ' + esc(emp ? emp.fullName : '')) + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:10px;align-items:end;">';
    h += labelField('ptoEType', 'Type', selectInput('ptoEType', typeOpts, 'used'));
    h += labelField('ptoEDate', 'Date', dateInput('ptoEDate', today));
    h += labelField('ptoEHours', 'Hours', numberInput('ptoEHours', '', '0.5', '8'));
    h += labelField('ptoENotes', 'Notes', textInput('ptoENotes', '', 'Optional'));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:12px;"><button class="btn btn-primary btn-small" data-emp="' + esc(empId) + '" data-self="' + (isSelf ? '1' : '0') + '" onclick="teamPtoSaveEntry(this.dataset.emp, this.dataset.self)">Save</button><button class="btn btn-secondary btn-small" onclick="document.getElementById(\'' + cid + '\').style.display=\'none\'">Cancel</button></div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function savePtoEntry(empId, isSelf) {
    var type = document.getElementById('ptoEType').value;
    var hours = parseFloat(document.getElementById('ptoEHours').value);
    var date = document.getElementById('ptoEDate').value;
    if (!hours || hours <= 0) { showToast('Hours required', true); return; }
    if (!date) { showToast('Date required', true); return; }
    try {
      var rawEntries = await MastDB.get('admin/ptoEntries') || {};
      var empEntries = Object.values(rawEntries).filter(function(e) { return e.employeeId === empId; }).sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });
      var currentBalance = empEntries.length > 0 ? (empEntries[empEntries.length - 1].balance || 0) : 0;
      var hoursVal = type === 'used' ? -Math.abs(hours) : Math.abs(hours);
      var newBalance = currentBalance + hoursVal;
      if (newBalance < 0) {
        var emp = employeesData.find(function(e) { return e._key === empId; });
        var empName = emp ? emp.fullName : empId;
        var msg = 'This will bring ' + empName + '’s balance to ' + newBalance.toFixed(1) + ' hours. Proceed?';
        var confirmed = typeof mastConfirm === 'function'
          ? await mastConfirm(msg, { title: 'Negative balance', confirmLabel: 'Proceed' })
          : window.confirm(msg);
        if (!confirmed) return;
      }
      var key = MastDB.newKey('admin/ptoEntries');
      await MastDB.set('admin/ptoEntries/' + key, { id: key, employeeId: empId, type: type, hours: hoursVal, date: date, notes: document.getElementById('ptoENotes').value.trim() || null, balance: newBalance, createdAt: new Date().toISOString() });
      showToast('PTO entry saved');
      if (isSelf === '1') {
        document.getElementById('ptoSelfUsageForm').style.display = 'none';
        var uid = auth && auth.currentUser ? auth.currentUser.uid : null;
        var wrap = document.getElementById('ptoSelfWrap');
        if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; loadPtoSelf(uid); }
      } else {
        document.getElementById('ptoUsageForm').style.display = 'none';
        var wrap = document.getElementById('ptoDetailWrap');
        if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; loadPtoDetail(empId); }
      }
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  // ========================================
  // Tab: Documents (Compliance Tracking)
  // ========================================
  function renderComplianceDocs() {
    var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    var missingCount = 0;
    active.forEach(function(emp) {
      var cl = emp.complianceChecklist || {};
      COMPLIANCE_FIELDS.forEach(function(f) { if (!cl[f.key] || cl[f.key].status !== 'completed') missingCount++; });
    });

    var h = '';
    if (missingCount > 0) {
      h += '<div style="background:rgba(217,119,6,0.15);border:1px solid rgba(217,119,6,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#fbbf24;">⚠ <strong>' + MastFormat.countNoun(missingCount, 'compliance gap') + '</strong> across your team.</div>';
    } else if (active.length > 0) {
      h += '<div style="background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#86efac;">✓ All employees have complete compliance documents on file.</div>';
    }

    h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center;">';
    h += '<select id="docFiltEmp" onchange="teamDocFilter()" style="' + INPUT_STYLE + 'width:auto;min-width:160px;"><option value="">All employees</option>';
    active.forEach(function(emp) { h += '<option value="' + esc(emp._key) + '"' + (docFilterEmployee === emp._key ? ' selected' : '') + '>' + esc(emp.fullName || '') + '</option>'; });
    h += '</select>';
    // Q6 sweep: Status as pills (4 bounded options). Employee filter stays
    // as dropdown — unbounded option set (one per active employee).
    h += '<div class="order-filter-pills" data-filter-for="docFiltStatus" style="margin:0;"></div>';
    h += '<select id="docFiltStatus" onchange="teamDocFilter()" style="display:none;"><option value="">All statuses</option><option value="completed"' + (docFilterStatus === 'completed' ? ' selected' : '') + '>On File</option><option value="missing"' + (docFilterStatus === 'missing' ? ' selected' : '') + '>Missing</option><option value="expired"' + (docFilterStatus === 'expired' ? ' selected' : '') + '>Expired</option></select>';
    h += '</div>';
    h += '<div id="docTableContainer">' + buildComplianceTable(active) + '</div>';
    h += '<div id="teamComplianceForm" style="display:none;margin-top:16px;"></div>';
    return h;
  }

  function buildComplianceTable(activeEmps) {
    var rows = [];
    activeEmps.forEach(function(emp) {
      if (docFilterEmployee && emp._key !== docFilterEmployee) return;
      var cl = emp.complianceChecklist || {};
      COMPLIANCE_FIELDS.forEach(function(f) {
        var item = cl[f.key] || {}, status = item.status || 'missing';
        if (status === 'completed' && item.expiryDate && Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000) <= 0) status = 'expired';
        if (docFilterStatus && docFilterStatus !== status) return;
        rows.push({ emp: emp, field: f, item: item, status: status });
      });
    });
    if (rows.length === 0) return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">No documents match the current filter.</div>';
    var h = '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
    h += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));text-align:left;"><th style="padding:8px 10px;font-weight:600;">Employee</th><th style="padding:8px 10px;font-weight:600;">Document</th><th style="padding:8px 10px;font-weight:600;">Status</th><th style="padding:8px 10px;font-weight:600;">Storage</th><th style="padding:8px 10px;font-weight:600;">Last Updated</th><th style="padding:8px 10px;font-weight:600;"></th></tr></thead><tbody>';
    rows.forEach(function(row) {
      var sc = row.status === 'completed' ? '#16a34a' : row.status === 'expired' ? 'var(--danger)' : '#d97706';
      var sl = row.status === 'completed' ? '✓ On File' : row.status === 'expired' ? '⚠ Expired' : '⚠ Missing';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
      h += '<td style="padding:8px 10px;font-weight:500;">' + esc(row.emp.fullName || '') + '</td>';
      h += '<td style="padding:8px 10px;">' + esc(row.field.label) + '</td>';
      h += '<td style="padding:8px 10px;"><span style="color:' + sc + ';font-weight:600;">' + sl + '</span>' + (row.item.expiryDate && row.status !== 'missing' ? '<div style="font-size:0.78rem;color:var(--warm-gray-light);">Expires ' + esc(row.item.expiryDate) + '</div>' : '') + '</td>';
      h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + (row.item.storageLocation ? esc(capitalize(row.item.storageLocation.replace('-', ' '))) : '—') + '</td>';
      h += '<td style="padding:8px 10px;color:var(--warm-gray);">' + (row.item.updatedAt ? esc(row.item.updatedAt.split('T')[0]) : '—') + '</td>';
      h += '<td style="padding:8px 10px;"><button class="btn btn-secondary btn-small" data-emp="' + esc(row.emp._key) + '" data-key="' + esc(row.field.key) + '" onclick="teamEditCompliance(this.dataset.emp, this.dataset.key)">' + (row.status === 'completed' ? 'Update' : 'Mark On File') + '</button></td>';
      h += '</tr>';
    });
    return h + '</tbody></table></div>';
  }

  // ========================================
  // Tab: Onboarding
  // ========================================
  var ONBOARDING_ITEMS = [
    { key: 'i9',               label: 'I-9 collected',            source: 'compliance' },
    { key: 'w4',               label: 'W-4 collected',            source: 'compliance' },
    { key: 'stateWithholding', label: 'State withholding form',   source: 'compliance' },
    { key: 'offerLetter',      label: 'Offer letter signed',      source: 'compliance' },
    { key: 'workersComp',      label: "Workers' comp certificate", source: 'compliance' },
    { key: 'addedToPayroll',   label: 'Added to payroll system',  source: 'onboarding' },
    { key: 'emergencyContact', label: 'Emergency contact on file', source: 'onboarding' },
  ];

  function isObItemDone(emp, key, source) {
    if (source === 'compliance') { var cl = emp.complianceChecklist || {}; return !!(cl[key] && cl[key].status === 'completed'); }
    if (key === 'emergencyContact') return !!(emp.emergencyContact && emp.emergencyContact.name);
    return !!((emp.onboardingChecklist || {})[key]);
  }

  function renderOnboarding() {
    var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    var incomplete = active.filter(function(emp) { return ONBOARDING_ITEMS.some(function(item) { return !isObItemDone(emp, item.key, item.source); }); });

    var h = '';
    if (incomplete.length > 0) {
      h += '<div style="background:rgba(217,119,6,0.15);border:1px solid rgba(217,119,6,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#fbbf24;">⚠ <strong>' + incomplete.length + ' employee' + (incomplete.length !== 1 ? 's have' : ' has') + ' incomplete onboarding</strong></div>';
    } else if (active.length > 0) {
      h += '<div style="background:rgba(22,163,74,0.15);border:1px solid rgba(22,163,74,0.4);border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:0.85rem;color:#86efac;">✓ All employees have completed onboarding.</div>';
    }

    h += '<div style="display:flex;gap:8px;margin-bottom:16px;">';
    h += '<button class="btn btn-secondary btn-small' + (onboardingFilter === 'all' ? ' active' : '') + '" onclick="teamObFilter(\'all\')">All</button>';
    h += '<button class="btn btn-secondary btn-small' + (onboardingFilter === 'incomplete' ? ' active' : '') + '" onclick="teamObFilter(\'incomplete\')">Incomplete only</button>';
    h += '</div>';

    var toShow = onboardingFilter === 'incomplete' ? incomplete : active;
    if (toShow.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">All employees have completed onboarding.</div>';
    } else {
      toShow.forEach(function(emp) {
        var done = ONBOARDING_ITEMS.filter(function(item) { return isObItemDone(emp, item.key, item.source); }).length;
        var total = ONBOARDING_ITEMS.length, pct = Math.round(done / total * 100), allDone = done === total;
        h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
        h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
        h += '<div><span style="font-weight:600;">' + esc(emp.fullName || '') + '</span>' + (emp.jobTitle ? ' <span style="color:var(--warm-gray);font-size:0.85rem;">— ' + esc(emp.jobTitle) + '</span>' : '') + (emp.startDate ? '<div style="font-size:0.78rem;color:var(--warm-gray-light);">Started ' + esc(emp.startDate) + '</div>' : '') + '</div>';
        h += '<div style="font-size:0.85rem;font-weight:600;color:' + (allDone ? '#16a34a' : '#d97706') + ';">' + done + ' / ' + total + ' complete</div>';
        h += '</div>';
        h += '<div style="height:4px;background:var(--cream-dark,#ddd);border-radius:2px;margin-bottom:10px;overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:' + (allDone ? '#16a34a' : '#d97706') + ';border-radius:2px;"></div></div>';
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:4px;">';
        ONBOARDING_ITEMS.forEach(function(item) {
          var isDone = isObItemDone(emp, item.key, item.source);
          var isClickable = item.source === 'onboarding' && item.key !== 'emergencyContact';
          h += '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;padding:4px 6px;border-radius:4px;cursor:' + (isClickable ? 'pointer' : item.source === 'compliance' ? 'pointer' : 'default') + ';"';
          if (isClickable) h += ' data-emp="' + esc(emp._key) + '" data-key="' + esc(item.key) + '" onclick="teamObToggle(this.dataset.emp, this.dataset.key)"';
          else if (item.source === 'compliance') h += ' data-emp="' + esc(emp._key) + '" data-key="' + esc(item.key) + '" onclick="teamEditCompliance(this.dataset.emp, this.dataset.key)"';
          h += '>';
          h += '<span style="color:' + (isDone ? '#16a34a' : 'var(--warm-gray)') + ';font-size:1rem;">' + (isDone ? '☑' : '☐') + '</span>';
          h += '<span style="color:' + (isDone ? '' : 'var(--warm-gray)') + ';">' + esc(item.label) + '</span>';
          h += '</label>';
        });
        h += '</div></div>';
      });
    }
    return h;
  }

  async function toggleObItem(empId, key) {
    var emp = employeesData.find(function(e) { return e._key === empId; });
    if (!emp) return;
    var ob = emp.onboardingChecklist || {};
    var newVal = !ob[key];
    try {
      var patch = {}; patch[key] = newVal;
      await MastDB.update('admin/employees/' + empId + '/onboardingChecklist', patch);
      emp.onboardingChecklist = emp.onboardingChecklist || {};
      emp.onboardingChecklist[key] = newVal;
      rerenderHost();
    } catch (err) { showToast('Error: ' + esc(err.message), true); }
  }

  // ========================================
  // Tab: Labor Burden (W3.3) + Estimator Settings (W3.2)
  // Idea -OtMKtFHnUZE2xD25BzV, Job -OteH2BLijKcyZ5U9YXe
  // Concept IDs: D-FIN-W3-3, D-FIN-W3-2 (UI portion).
  // ----
  // Note: spec called for the Estimator panel to live in settings.js. That file
  // does not exist in this tenant template — Settings sub-views are static
  // containers in app/index.html, which is owned by the pre-commit-hook
  // version-bumper and out-of-bounds for parallel-agent edits. So we expose
  // the Estimator as a second sub-tab inside the Labor Burden surface here in
  // team.js. Orchestrator follow-up: optionally promote to Settings → Finance
  // by adding a `settingsSubLaborBurden` container + nav button to index.html
  // in a serialized commit.
  // ========================================
  var BURDEN_SOURCE_LABELS = {
    'estimator': 'Estimator',
    'manual': 'Manual',
    'partner-check': 'Partner check',
    'partner-gusto': 'Gusto'
  };

  function _burdenPeriodIdToLabel(pid) {
    if (!pid || pid.indexOf('_') === -1) return pid || '';
    var parts = pid.split('_');
    return parts[0] + ' → ' + parts[1];
  }
  function _burdenIsoToday() { return new Date().toISOString().split('T')[0]; }
  function _burdenSuggestDefaultPeriodId() {
    // Default to the most-recent two-week pay period ending today.
    var end = new Date();
    var start = new Date(); start.setDate(end.getDate() - 13);
    return start.toISOString().split('T')[0] + '_' + end.toISOString().split('T')[0];
  }
  function _burdenDollarsToCents(v) {
    var n = parseFloat(v);
    if (isNaN(n)) return 0;
    return Math.round(n * 100);
  }
  function _burdenCentsToDollars(c) {
    if (c == null || isNaN(c)) return '';
    return (c / 100).toFixed(2);
  }

  function renderLaborBurden() {
    var h = '';
    h += '<div class="view-tabs" style="margin-bottom:16px;">';
    h += '<button class="view-tab' + (burdenSubView === 'entries' ? ' active' : '') + '" onclick="teamBurdenSetSubView(\'entries\')">Entries</button>';
    h += '<button class="view-tab' + (burdenSubView === 'estimator' ? ' active' : '') + '" onclick="teamBurdenSetSubView(\'estimator\')">Estimator Settings</button>';
    h += '</div>';
    if (burdenSubView === 'estimator') {
      h += '<div id="burdenEstimatorWrap"><div class="loading">Loading estimator settings&hellip;</div></div>';
      setTimeout(loadBurdenEstimatorPanel, 0);
    } else {
      h += renderBurdenEntriesPanel();
    }
    return h;
  }

  // ---- Entries panel (W3.3) ----
  function renderBurdenEntriesPanel() {
    var h = '';
    // R2-M8: form/bulk render as overlay modals (fixed-position scrim) instead
    // of inline-above-table. Keeps "+ Record Burden" button visible without
    // showing a stale duplicate when the form is open. The wraps themselves
    // are positioned by _burdenShowAsModal / hidden by display:none.
    h += '<div id="burdenFormWrap" style="display:none;"><div id="burdenFormInner"></div></div>';
    h += '<div id="burdenBulkWrap" style="display:none;"><div id="burdenBulkInner"></div></div>';
    h += '<div id="burdenToolbar" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">';
    h += '<select id="burdenEmpFilter" onchange="teamBurdenFilterEmployee(this.value)" style="' + INPUT_STYLE + 'width:auto;min-width:200px;">';
    h += '<option value="">All employees</option>';
    employeesData.filter(function(e) { return (e.status || 'active') === 'active'; }).forEach(function(emp) {
      h += '<option value="' + esc(emp._key) + '"' + (burdenSelectedEmployeeId === emp._key ? ' selected' : '') + '>' + esc(emp.fullName || '') + '</option>';
    });
    h += '</select>';
    h += '<button class="btn btn-primary btn-small" onclick="teamBurdenOpenForm()">+ Record Burden</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="teamBurdenOpenBulk()">Bulk paste from payroll export</button>';
    h += '</div>';
    h += '<div id="burdenListWrap"><div class="loading">Loading burden entries&hellip;</div></div>';
    setTimeout(loadBurdenEntries, 0);
    return h;
  }

  async function loadBurdenEntries() {
    var wrap = document.getElementById('burdenListWrap');
    if (!wrap) return;
    try {
      // Post-rework: flat collection — map keyed by `{periodId}__{employeeId}`.
      var raw = await MastDB.get('admin/burdenedLaborCost').catch(function() { return null; }) || {};
      // Rehydrate burdenEntriesCache into the legacy {periodId: {empId: doc}}
      // shape so the rest of the team-burden code (detail view, edit) keeps
      // working without a deeper refactor.
      var grouped = {};
      Object.keys(raw).forEach(function(compositeId) {
        var doc = raw[compositeId];
        if (!doc || typeof doc !== 'object') return;
        var pid = doc.periodId;
        var eid = doc.employeeId;
        if (!pid || !eid) {
          var sep = compositeId.indexOf('__');
          if (sep > 0) {
            if (!pid) pid = compositeId.slice(0, sep);
            if (!eid) eid = compositeId.slice(sep + 2);
          }
        }
        if (!pid || !eid) return;
        if (!grouped[pid]) grouped[pid] = {};
        grouped[pid][eid] = doc;
      });
      burdenEntriesCache = grouped;
      var rows = [];
      Object.keys(grouped).forEach(function(periodId) {
        var byEmp = grouped[periodId] || {};
        Object.keys(byEmp).forEach(function(empId) {
          var doc = byEmp[empId] || {};
          if (burdenSelectedEmployeeId && empId !== burdenSelectedEmployeeId) return;
          rows.push({
            periodId: periodId,
            employeeId: empId,
            totalBurden: doc.totalBurden || 0,
            source: doc.source || 'manual',
            breakdown: doc.breakdown || {
              wages: doc.wages, employerFica: doc.employerFica, futa: doc.futa,
              suta: doc.suta, wcPremium: doc.wcPremium, retirement: doc.retirement,
              benefits: doc.benefits
            },
            confidence: doc.confidence || null,
            updatedAt: doc.updatedAt || doc.createdAt || ''
          });
        });
      });
      rows.sort(function(a, b) { return (b.periodId || '').localeCompare(a.periodId || ''); });

      var h = '';
      if (rows.length === 0) {
        h += '<div style="text-align:center;padding:40px;color:var(--warm-gray);font-size:0.9rem;">No burden entries yet. Click <strong>+ Record Burden</strong> or paste a payroll export.</div>';
      } else {
        h += '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
        h += '<thead><tr style="border-bottom:2px solid var(--cream-dark,var(--cream-dark));">';
        h += '<th style="padding:8px 10px;text-align:left;font-weight:600;">Pay period</th>';
        h += '<th style="padding:8px 10px;text-align:left;font-weight:600;">Employee</th>';
        h += '<th style="padding:8px 10px;text-align:right;font-weight:600;">Total burden</th>';
        h += '<th style="padding:8px 10px;text-align:left;font-weight:600;">Source</th>';
        h += '<th style="padding:8px 10px;text-align:left;font-weight:600;">Confidence</th>';
        h += '<th style="padding:8px 10px;text-align:right;font-weight:600;">Actions</th>';
        h += '</tr></thead><tbody>';
        rows.forEach(function(r) {
          var emp = employeesData.find(function(e) { return e._key === r.employeeId; });
          var empName = emp ? emp.fullName : r.employeeId;
          // R2-M5: branded source-tag chip via shared helper (Agent C exposed
          // at window.MastFinanceW3.renderSourceTagChip / window.renderSourceTagChip).
          // Manual entries are HIGH confidence by definition (operator-entered);
          // estimator entries inherit doc.confidence (HIGH/MED/LOW computed by CF).
          var effectiveConf = r.confidence || (r.source === 'manual' ? 'HIGH' : null);
          var srcChip = (window.MastFinanceW3 && window.MastFinanceW3.renderSourceTagChip)
            ? window.MastFinanceW3.renderSourceTagChip(r.source, effectiveConf)
            : '<span style="background:rgba(0,0,0,0.05);padding:2px 8px;border-radius:10px;font-size:0.72rem;">' + esc(BURDEN_SOURCE_LABELS[r.source] || r.source) + '</span>';
          var confChip;
          if (effectiveConf) {
            var confBg, confFg;
            if (effectiveConf === 'HIGH')      { confBg = 'rgba(34,197,94,0.15)';  confFg = '#16a34a'; }
            else if (effectiveConf === 'LOW')  { confBg = 'rgba(239,68,68,0.15)';  confFg = '#ef4444'; }
            else                                { confBg = 'rgba(245,158,11,0.15)'; confFg = '#b45309'; }
            confChip = '<span style="background:' + confBg + ';color:' + confFg + ';padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;">' + esc(String(effectiveConf)) + '</span>';
          } else {
            confChip = '<span style="color:var(--warm-gray);font-size:0.72rem;">—</span>';
          }
          h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));cursor:pointer;" onclick="teamBurdenOpenDetail(\'' + esc(r.periodId) + '\',\'' + esc(r.employeeId) + '\')">';
          h += '<td style="padding:8px 10px;">' + esc(_burdenPeriodIdToLabel(r.periodId)) + '</td>';
          h += '<td style="padding:8px 10px;">' + esc(empName) + '</td>';
          h += '<td style="padding:8px 10px;text-align:right;font-weight:600;">$' + (r.totalBurden / 100).toFixed(2) + '</td>';
          h += '<td style="padding:8px 10px;">' + srcChip + '</td>';
          h += '<td style="padding:8px 10px;">' + confChip + '</td>';
          h += '<td style="padding:8px 10px;text-align:right;" onclick="event.stopPropagation();">';
          h += '<button class="btn btn-secondary btn-small" data-pid="' + esc(r.periodId) + '" data-eid="' + esc(r.employeeId) + '" onclick="teamBurdenEditEntry(this.dataset.pid, this.dataset.eid)">Edit</button>';
          h += '</td></tr>';
        });
        h += '</tbody></table></div>';
      }
      wrap.innerHTML = h;
    } catch (err) {
      console.error('[burden] loadBurdenEntries:', err);
      wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading burden entries: ' + esc(err && err.message || String(err)) + '</div>';
    }
  }

  function teamBurdenFilterEmployee(empId) {
    burdenSelectedEmployeeId = empId || '';
    loadBurdenEntries();
  }
  function teamBurdenSetSubView(v) {
    burdenSubView = v;
    rerenderHost();
  }

  // ---- Wages estimation from time-clock ----
  async function _burdenEstimateWagesCents(empId, periodId) {
    if (!empId || !periodId || periodId.indexOf('_') === -1) return 0;
    var parts = periodId.split('_');
    var start = parts[0], end = parts[1];
    var emp = employeesData.find(function(e) { return e._key === empId; });
    if (!emp || !emp.payRate) return 0;
    if (emp.payType === 'salary') {
      // Salary is monthly-cents; pro-rate by period length / ~30.42 days.
      var msPerDay = 24 * 60 * 60 * 1000;
      var days = Math.max(1, Math.round((new Date(end) - new Date(start)) / msPerDay) + 1);
      return Math.round(emp.payRate * (days / 30.4375));
    }
    // Hourly: sum hoursWorked across timeEntries in period.
    try {
      var raw = await MastDB.get('admin/timeEntries') || {};
      var totalHrs = 0;
      Object.values(raw).forEach(function(te) {
        if (!te || te.employeeId !== empId) return;
        var d = te.date || '';
        if (d >= start && d <= end) totalHrs += (parseFloat(te.hoursWorked) || 0);
      });
      return Math.round(totalHrs * emp.payRate); // payRate is cents/hr
    } catch (_) { return 0; }
  }

  // ---- Jobs picker source ----
  async function _burdenLoadJobs() {
    if (burdenJobsCache) return burdenJobsCache;
    var out = [];
    try {
      var orders = await MastDB.get('admin/orders').catch(function() { return null; }) || {};
      Object.entries(orders).slice(0, 200).forEach(function(e) {
        var id = e[0], v = e[1] || {};
        var label = v.orderNumber || v.name || id;
        if (v.customerName) label = label + ' — ' + v.customerName;
        out.push({ id: id, name: String(label).slice(0, 80) });
      });
    } catch (_) {}
    out.sort(function(a, b) { return a.name.localeCompare(b.name); });
    burdenJobsCache = out;
    return out;
  }

  // ---- Per-entry form ----
  async function openBurdenForm(prefillPeriodId, prefillEmpId) {
    var formEl = document.getElementById('burdenFormWrap');
    var innerEl = document.getElementById('burdenFormInner');
    if (!formEl || !innerEl) return;
    var bulkEl = document.getElementById('burdenBulkWrap');
    if (bulkEl) bulkEl.style.display = 'none';

    burdenSelectedPeriodId = prefillPeriodId || _burdenSuggestDefaultPeriodId();
    var empId = prefillEmpId || (employeesData[0] && employeesData[0]._key) || '';
    var existing = null;
    if (prefillPeriodId && prefillEmpId) {
      var p = burdenEntriesCache[prefillPeriodId];
      if (p && p[prefillEmpId]) existing = p[prefillEmpId];
    }
    var bd = (existing && existing.breakdown) || {};
    burdenBenefitRows = Array.isArray(bd.benefits) && bd.benefits.length
      ? bd.benefits.map(function(b) { return { type: b.type || '', amount: _burdenCentsToDollars(b.amount) }; })
      : [{ type: 'health', amount: '' }];
    var jobs = await _burdenLoadJobs();

    var h = '';
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:14px;">' + (existing ? 'Edit' : 'Record') + ' Burdened Labor Cost</div>';
    // Period + employee row
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:end;margin-bottom:12px;">';
    var parts = burdenSelectedPeriodId.split('_');
    h += labelField('burdenPStart', 'Pay period start', dateInput('burdenPStart', parts[0] || _burdenIsoToday()));
    h += labelField('burdenPEnd', 'Pay period end', dateInput('burdenPEnd', parts[1] || _burdenIsoToday()));
    var empOpts = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; })
      .map(function(e) { return { value: e._key, label: e.fullName + (e.employmentType ? ' (' + e.employmentType + ')' : '') }; });
    h += labelField('burdenEmp', 'Employee', selectInput('burdenEmp', empOpts, empId));
    h += '</div>';

    // Wages row with auto-fill button
    var wagesVal = existing ? _burdenCentsToDollars(bd.wages || 0) : '';
    h += '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;align-items:end;margin-bottom:12px;">';
    h += labelField('burdenWages', 'Wages ($)', numberInput('burdenWages', wagesVal, '0.01', 'e.g. 3200.00'));
    h += '<div><button class="btn btn-secondary btn-small" onclick="teamBurdenAutofillWages()" type="button">Auto-fill from time-clock</button></div>';
    h += '</div>';
    h += '<div id="burdenWagesHint" style="font-size:0.78rem;color:var(--warm-gray);margin-top:-6px;margin-bottom:12px;">Tip: click <strong>Auto-fill</strong> to pull <code>sum(hoursWorked) × payRate</code> from time-clock entries in the chosen period. Edit freely after.</div>';

    // Statutory + benefits
    h += '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px;">';
    // R2-M6: dollar placeholders + auto-compute hints. Auto-fill on Wages blur,
    // user can override after. We tag computed values with data-auto="1" so we
    // know whether to overwrite or respect an explicit edit.
    h += labelField('burdenFica', 'Employer FICA ($)', numberInput('burdenFica', _burdenCentsToDollars(bd.employerFica), '0.01', 'e.g. 244.80'));
    h += labelField('burdenFuta', 'FUTA ($)', numberInput('burdenFuta', _burdenCentsToDollars(bd.futa), '0.01', 'e.g. 19.20'));
    h += labelField('burdenSuta', 'SUTA ($)', numberInput('burdenSuta', _burdenCentsToDollars(bd.suta), '0.01', 'e.g. 84.00'));
    h += labelField('burdenWc', 'WC premium ($)', numberInput('burdenWc', _burdenCentsToDollars(bd.wcPremium), '0.01', ''));
    h += labelField('burdenRet', 'Retirement ($)', numberInput('burdenRet', _burdenCentsToDollars(bd.retirement), '0.01', ''));
    h += '</div>';

    // Benefits repeating rows
    h += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:6px;">Benefits</div>';
    h += '<div id="burdenBenefitsRows"></div>';
    h += '<div style="margin-bottom:12px;"><button class="btn btn-secondary btn-small" onclick="teamBurdenAddBenefit()" type="button">+ Add benefit</button></div>';

    // Optional jobId
    var jobOpts = [{ value: '', label: 'Untagged — allocate to overhead' }]
      .concat(jobs.map(function(j) { return { value: j.id, label: j.name }; }));
    var existingJob = existing && existing.jobId ? existing.jobId : '';
    h += '<div style="margin-bottom:12px;">';
    h += labelField('burdenJob', 'Attribute to job (optional)', selectInput('burdenJob', jobOpts, existingJob));
    h += '</div>';

    // Live total
    h += '<div id="burdenTotalLive" style="background:rgba(0,0,0,0.04);border-radius:6px;padding:10px 14px;font-size:0.9rem;margin-bottom:14px;">Total burden: <strong>$0.00</strong></div>';

    h += '<div style="display:flex;gap:8px;">';
    h += '<button class="btn btn-primary btn-small" onclick="teamBurdenSubmitForm()">' + (existing ? 'Save (re-submits, triggers re-allocation)' : 'Submit') + '</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="teamBurdenCancelForm()">Cancel</button>';
    h += '</div>';

    innerEl.innerHTML = h;
    _burdenShowAsModal(formEl);
    _burdenRenderBenefitRows();
    _burdenAttachLiveTotalListeners();
    _burdenRecomputeLiveTotal();
  }

  function _burdenRenderBenefitRows() {
    var wrap = document.getElementById('burdenBenefitsRows');
    if (!wrap) return;
    var BENEFIT_TYPES = ['health', 'dental', 'vision', 'life', 'disability', 'hsa', 'other'];
    var h = '';
    burdenBenefitRows.forEach(function(row, i) {
      h += '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;margin-bottom:8px;">';
      h += labelField('burdenBenT' + i, 'Type', selectInput('burdenBenT' + i, BENEFIT_TYPES.map(function(t) { return { value: t, label: capitalize(t) }; }), row.type || 'health'));
      h += labelField('burdenBenA' + i, 'Amount ($)', numberInput('burdenBenA' + i, row.amount || '', '0.01', '0.00'));
      h += '<div><button class="btn btn-secondary btn-small" type="button" data-i="' + i + '" onclick="teamBurdenRemoveBenefit(this.dataset.i)">✕</button></div>';
      h += '</div>';
    });
    wrap.innerHTML = h;
    // Re-attach listeners on new fields.
    _burdenAttachLiveTotalListeners();
  }

  function _burdenAttachLiveTotalListeners() {
    var ids = ['burdenWages','burdenFica','burdenFuta','burdenSuta','burdenWc','burdenRet'];
    ids.forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el._burdenListenerBound) { el.addEventListener('input', _burdenRecomputeLiveTotal); el._burdenListenerBound = true; }
    });
    burdenBenefitRows.forEach(function(_, i) {
      var el = document.getElementById('burdenBenA' + i);
      if (el && !el._burdenListenerBound) { el.addEventListener('input', _burdenRecomputeLiveTotal); el._burdenListenerBound = true; }
    });
    // R2-M6: mark dependent fields as "user-edited" once they receive input,
    // so wages-blur auto-compute won't clobber an explicit override.
    ['burdenFica','burdenFuta','burdenSuta'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el && !el._burdenUserEditBound) {
        el.addEventListener('input', function() { el.dataset.userEdited = '1'; });
        el._burdenUserEditBound = true;
      }
    });
    // Auto-compute statutory taxes when wages changes (operator can still override).
    var w = document.getElementById('burdenWages');
    if (w && !w._burdenAutoComputeBound) {
      w.addEventListener('blur', _burdenAutoComputeStatutory);
      w._burdenAutoComputeBound = true;
    }
  }

  function _burdenAutoComputeStatutory() {
    var wagesCents = _burdenDollarsToCents((document.getElementById('burdenWages') || {}).value);
    if (!wagesCents || wagesCents <= 0) return;
    function _setIfAuto(id, cents) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.dataset.userEdited === '1') return; // respect operator override
      el.value = (cents / 100).toFixed(2);
    }
    // FICA employer share = 7.65% of wages.
    _setIfAuto('burdenFica', Math.round(wagesCents * 0.0765));
    // FUTA = 0.6% of wages capped at $7,000 (700000 cents) per employee per year.
    // We don't have YTD-paid context in the form, so apply the per-period cap as
    // a reasonable upper bound (operator overrides for partial-cap periods).
    _setIfAuto('burdenFuta', Math.round(Math.min(wagesCents, 700000) * 0.006));
    // SUTA: use estimator config if available (tenant's operating state rate).
    // burdenEstimator is loaded by loadBurdenEstimatorPanel; for the entry form
    // path we may not have it cached, so default to 2.7% (federal credit-reduction
    // baseline) as a placeholder the operator should tune. Mark as autoComputed.
    var sutaRate = 0.027;
    try {
      var mult = (burdenEstimator && burdenEstimator.estimatorMultipliers) || {};
      var sutaMap = mult.suta || {};
      // Pick the first non-default state rate; if none, fall back to 2.7%.
      var keys = Object.keys(sutaMap);
      if (keys.length === 1) {
        var v = sutaMap[keys[0]];
        if (typeof v === 'number') sutaRate = v;
        else if (v && typeof v.rate === 'number') sutaRate = v.rate;
      }
    } catch (_) {}
    _setIfAuto('burdenSuta', Math.round(wagesCents * sutaRate));
    _burdenRecomputeLiveTotal();
  }

  function _burdenSnapshotFormFields() {
    function n(id) { return _burdenDollarsToCents((document.getElementById(id) || {}).value); }
    var benefits = burdenBenefitRows.map(function(_, i) {
      var t = (document.getElementById('burdenBenT' + i) || {}).value;
      var a = n('burdenBenA' + i);
      // Keep latest typed values in the in-memory row for re-renders.
      burdenBenefitRows[i] = { type: t || 'other', amount: _burdenCentsToDollars(a) };
      return { type: t || 'other', amount: a };
    }).filter(function(b) { return b.amount > 0; });
    return {
      wages: n('burdenWages'),
      employerFica: n('burdenFica'),
      futa: n('burdenFuta'),
      suta: n('burdenSuta'),
      wcPremium: n('burdenWc'),
      retirement: n('burdenRet'),
      benefits: benefits
    };
  }

  function _burdenRecomputeLiveTotal() {
    var bd = _burdenSnapshotFormFields();
    var total = bd.wages + bd.employerFica + bd.futa + bd.suta + bd.wcPremium + bd.retirement;
    bd.benefits.forEach(function(b) { total += b.amount; });
    var el = document.getElementById('burdenTotalLive');
    if (el) el.innerHTML = 'Total burden: <strong>$' + (total / 100).toFixed(2) + '</strong>';
  }

  // R2-M8: render the burden form/bulk/detail wrap as a centered modal
  // overlay so the entries-table toolbar (with its duplicate "+ Record Burden"
  // button) doesn't sit behind/below the inline form.
  function _burdenShowAsModal(wrapEl) {
    if (!wrapEl) return;
    // Wrap the inner content in a modal card with scrim. We toggle the wrap
    // from "invisible inline div" to "fixed-position scrim+card" via direct
    // style writes — no re-templating of the inner HTML required.
    wrapEl.style.cssText =
      'display:flex;position:fixed;inset:0;z-index:9000;' +
      'background:rgba(0,0,0,0.55);' +
      'align-items:flex-start;justify-content:center;' +
      'padding:48px 20px 20px;overflow-y:auto;';
    // The first child (inner content) becomes the card.
    var inner = wrapEl.firstElementChild;
    if (inner) {
      inner.style.cssText =
        'background:var(--cream,#f8f4ec);border:1px solid var(--cream-dark,#e8e0d4);' +
        'border-radius:10px;padding:20px 24px;max-width:780px;width:100%;' +
        'box-shadow:0 20px 50px rgba(0,0,0,0.4);max-height:calc(100vh - 68px);' +
        'overflow-y:auto;';
    }
    // Click-on-scrim dismisses (matches MastAskAi pattern).
    if (!wrapEl._burdenModalScrimBound) {
      wrapEl.addEventListener('click', function(ev) {
        if (ev.target === wrapEl) { wrapEl.style.display = 'none'; }
      });
      wrapEl._burdenModalScrimBound = true;
    }
  }

  async function teamBurdenAutofillWages() {
    var start = (document.getElementById('burdenPStart') || {}).value;
    var end = (document.getElementById('burdenPEnd') || {}).value;
    var empId = (document.getElementById('burdenEmp') || {}).value;
    if (!start || !end || !empId) { showToast('Pick employee + period first.', true); return; }
    var pid = start + '_' + end;
    var cents = await _burdenEstimateWagesCents(empId, pid);
    var wagesEl = document.getElementById('burdenWages');
    if (wagesEl) {
      wagesEl.value = _burdenCentsToDollars(cents);
      _burdenRecomputeLiveTotal();
    }
    if (cents === 0) showToast('No time-clock hours found for that employee in that period. Enter wages manually.', true);
    else showToast('Estimated wages: $' + (cents / 100).toFixed(2));
  }

  async function teamBurdenSubmitForm() {
    var start = (document.getElementById('burdenPStart') || {}).value;
    var end = (document.getElementById('burdenPEnd') || {}).value;
    var empId = (document.getElementById('burdenEmp') || {}).value;
    if (!start || !end) { showToast('Pay period dates required.', true); return; }
    if (start > end) { showToast('Period start must be on/before end.', true); return; }
    if (!empId) { showToast('Employee required.', true); return; }
    var bd = _burdenSnapshotFormFields();
    if (bd.wages <= 0) { showToast('Wages must be > $0.', true); return; }
    var periodId = start + '_' + end;
    var jobId = (document.getElementById('burdenJob') || {}).value || null;

    var btn = event && event.target;
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }
    try {
      var payload = {
        tenantId: MastDB.tenantId(),
        periodId: periodId,
        employeeId: empId,
        breakdown: bd,
        source: 'manual'
      };
      if (jobId) payload.jobId = jobId;
      var fn = firebase.functions().httpsCallable('recordBurdenEntry');
      var res = await fn(payload);
      var data = (res && res.data) ? res.data : {};
      if (!data || data.ok !== true) {
        var msg = (data && (data.message || data.error || data.code)) || 'CF returned no ok flag';
        showToast('Save failed: ' + msg, true);
        return;
      }
      showToast('Burden recorded: $' + ((data.totalBurden || 0) / 100).toFixed(2)
        + (data.allocationCfQueued ? ' — allocation queued.' : ''));
      teamBurdenCancelForm();
      loadBurdenEntries();
    } catch (err) {
      console.error('[burden] recordBurdenEntry threw:', err);
      var msg2 = (err && err.message) || (err && err.code) || String(err) || 'unknown error';
      if (err && err.details && err.details.code) msg2 += ' (' + err.details.code + ')';
      showToast('Save failed: ' + msg2, true);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
    }
  }

  function teamBurdenCancelForm() {
    var el = document.getElementById('burdenFormWrap');
    if (el) el.style.display = 'none';
  }

  function teamBurdenAddBenefit() {
    // Pull current typed values before re-render so we don't lose them.
    _burdenSnapshotFormFields();
    burdenBenefitRows.push({ type: 'other', amount: '' });
    _burdenRenderBenefitRows();
  }
  function teamBurdenRemoveBenefit(i) {
    _burdenSnapshotFormFields();
    var idx = parseInt(i, 10);
    if (!isNaN(idx) && idx >= 0 && idx < burdenBenefitRows.length) {
      burdenBenefitRows.splice(idx, 1);
    }
    if (burdenBenefitRows.length === 0) burdenBenefitRows.push({ type: 'health', amount: '' });
    _burdenRenderBenefitRows();
    _burdenRecomputeLiveTotal();
  }

  // ---- Bulk-paste panel ----
  // Expected column order matches common payroll CSV exports
  // (Gusto, QBO Payroll, Rippling, ADP RUN):
  // Employee | Pay Period Start | Pay Period End | Wages | FICA | FUTA | SUTA | WC | Benefits | Retirement
  function openBurdenBulk() {
    var wrapEl = document.getElementById('burdenBulkWrap');
    var innerEl = document.getElementById('burdenBulkInner');
    if (!wrapEl || !innerEl) return;
    var formEl = document.getElementById('burdenFormWrap');
    if (formEl) formEl.style.display = 'none';

    var h = '';
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;">Bulk paste — payroll export</div>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">Paste CSV or TSV (tab-separated). Header row optional. Expected columns:</div>';
    h += '<code style="display:block;background:rgba(0,0,0,0.05);padding:8px 10px;border-radius:4px;font-size:0.78rem;margin-bottom:10px;">Employee, Period Start, Period End, Wages, FICA, FUTA, SUTA, WC, Benefits, Retirement</code>';
    h += '<textarea id="burdenBulkText" placeholder="Jane Doe,2026-05-01,2026-05-14,3200,244.80,19.20,84.00,32.10,180.00,160.00" style="' + INPUT_STYLE + 'min-height:140px;font-family:monospace;font-size:0.85rem;"></textarea>';
    h += '<div style="margin-top:8px;display:flex;gap:8px;">';
    h += '<button class="btn btn-primary btn-small" onclick="teamBurdenBulkPreview()">Preview parse</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="teamBurdenBulkCancel()">Cancel</button>';
    h += '</div>';
    h += '<div id="burdenBulkPreview" style="margin-top:12px;"></div>';
    innerEl.innerHTML = h;
    _burdenShowAsModal(wrapEl);
  }

  function teamBurdenBulkCancel() {
    var el = document.getElementById('burdenBulkWrap');
    if (el) el.style.display = 'none';
  }

  function _burdenParseBulk(txt) {
    var lines = String(txt || '').split(/\r?\n/).map(function(l) { return l.trim(); }).filter(Boolean);
    if (lines.length === 0) return { rows: [], errors: ['No input.'] };
    // Strip header if it looks like one.
    var first = lines[0].toLowerCase();
    if (first.indexOf('employee') !== -1 && (first.indexOf('wages') !== -1 || first.indexOf('period') !== -1)) {
      lines.shift();
    }
    var rows = [], errors = [];
    lines.forEach(function(line, lineIdx) {
      var cells = line.indexOf('\t') !== -1 ? line.split('\t') : line.split(',');
      cells = cells.map(function(c) { return c.trim(); });
      if (cells.length < 4) {
        errors.push('Line ' + (lineIdx + 1) + ': need at least Employee, Start, End, Wages.');
        return;
      }
      var nameRaw = cells[0];
      var start = cells[1], end = cells[2];
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
        errors.push('Line ' + (lineIdx + 1) + ': dates must be YYYY-MM-DD (got "' + start + '", "' + end + '").');
        return;
      }
      // Match employee: exact full-name, then loose, then ID.
      var match = employeesData.filter(function(e) { return (e.status || 'active') === 'active' && (e.fullName || '').trim() === nameRaw; });
      var ambiguous = match.length > 1;
      var matchedEmpId = match.length === 1 ? match[0]._key : null;
      if (!matchedEmpId) {
        var loose = employeesData.filter(function(e) { return (e.fullName || '').trim().toLowerCase() === nameRaw.toLowerCase(); });
        if (loose.length === 1) matchedEmpId = loose[0]._key;
        else if (loose.length > 1) ambiguous = true;
      }
      if (!matchedEmpId) {
        var byId = employeesData.find(function(e) { return e._key === nameRaw; });
        if (byId) matchedEmpId = byId._key;
      }
      var breakdown = {
        wages: _burdenDollarsToCents(cells[3]),
        employerFica: _burdenDollarsToCents(cells[4]),
        futa: _burdenDollarsToCents(cells[5]),
        suta: _burdenDollarsToCents(cells[6]),
        wcPremium: _burdenDollarsToCents(cells[7]),
        benefits: cells[8] && _burdenDollarsToCents(cells[8]) > 0 ? [{ type: 'health', amount: _burdenDollarsToCents(cells[8]) }] : [],
        retirement: _burdenDollarsToCents(cells[9])
      };
      if (breakdown.wages <= 0) {
        errors.push('Line ' + (lineIdx + 1) + ': wages must be > $0.');
        return;
      }
      var total = breakdown.wages + breakdown.employerFica + breakdown.futa + breakdown.suta + breakdown.wcPremium + breakdown.retirement;
      breakdown.benefits.forEach(function(b) { total += b.amount; });
      rows.push({
        nameRaw: nameRaw,
        employeeId: matchedEmpId,
        ambiguous: ambiguous,
        periodId: start + '_' + end,
        breakdown: breakdown,
        totalCents: total
      });
    });
    return { rows: rows, errors: errors };
  }

  function teamBurdenBulkPreview() {
    var txt = (document.getElementById('burdenBulkText') || {}).value;
    var parsed = _burdenParseBulk(txt);
    var prev = document.getElementById('burdenBulkPreview');
    if (!prev) return;
    var h = '';
    if (parsed.errors.length) {
      h += '<div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:6px;padding:10px;margin-bottom:10px;color:#dc2626;font-size:0.85rem;">';
      h += parsed.errors.map(function(e) { return esc(e); }).join('<br>');
      h += '</div>';
    }
    if (parsed.rows.length === 0) {
      h += '<div style="color:var(--warm-gray);font-size:0.85rem;">No valid rows to submit.</div>';
      prev.innerHTML = h;
      return;
    }
    h += '<div style="overflow-x:auto;"><table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
    h += '<thead><tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));"><th style="padding:6px 8px;text-align:left;">Row</th><th style="padding:6px 8px;text-align:left;">Employee</th><th style="padding:6px 8px;text-align:left;">Period</th><th style="padding:6px 8px;text-align:right;">Total</th><th style="padding:6px 8px;text-align:left;">Status</th></tr></thead><tbody>';
    parsed.rows.forEach(function(r, i) {
      var status;
      if (r.ambiguous) status = '<span style="color:#d97706;">Ambiguous — pick:</span> <select data-row="' + i + '" class="burdenBulkPick" style="' + INPUT_STYLE + 'width:auto;font-size:0.78rem;padding:4px 8px;"><option value="">— select —</option>' + employeesData.filter(function(e) { return (e.fullName || '').toLowerCase() === r.nameRaw.toLowerCase(); }).map(function(e) { return '<option value="' + esc(e._key) + '">' + esc(e.fullName) + ' (' + esc(e._key.slice(0, 6)) + ')</option>'; }).join('') + '</select>';
      else if (!r.employeeId) status = '<span style="color:#dc2626;">No match for "' + esc(r.nameRaw) + '"</span>';
      else status = '<span style="color:#16a34a;">Matched</span>';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
      h += '<td style="padding:6px 8px;">' + (i + 1) + '</td>';
      h += '<td style="padding:6px 8px;">' + esc(r.nameRaw) + '</td>';
      h += '<td style="padding:6px 8px;">' + esc(_burdenPeriodIdToLabel(r.periodId)) + '</td>';
      h += '<td style="padding:6px 8px;text-align:right;">$' + (r.totalCents / 100).toFixed(2) + '</td>';
      h += '<td style="padding:6px 8px;">' + status + '</td>';
      h += '</tr>';
    });
    h += '</tbody></table></div>';
    var submittable = parsed.rows.filter(function(r) { return r.employeeId && !r.ambiguous; }).length;
    h += '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;">';
    h += '<button class="btn btn-primary btn-small" onclick="teamBurdenBulkSubmit()">Submit ' + submittable + ' rows</button>';
    h += '<span style="font-size:0.78rem;color:var(--warm-gray);">' + (parsed.rows.length - submittable) + ' need resolution before submit.</span>';
    h += '</div>';
    prev.innerHTML = h;
    // Cache parsed rows so submit can read them after operator picks ambiguous matches.
    prev._burdenParsedRows = parsed.rows;
  }

  async function teamBurdenBulkSubmit() {
    var prev = document.getElementById('burdenBulkPreview');
    if (!prev || !prev._burdenParsedRows) { showToast('Click Preview first.', true); return; }
    // Apply operator picks for ambiguous rows.
    var picks = prev.querySelectorAll('.burdenBulkPick');
    picks.forEach(function(sel) {
      var rowIdx = parseInt(sel.getAttribute('data-row'), 10);
      var val = sel.value;
      if (!isNaN(rowIdx) && val) {
        prev._burdenParsedRows[rowIdx].employeeId = val;
        prev._burdenParsedRows[rowIdx].ambiguous = false;
      }
    });
    var rows = prev._burdenParsedRows.filter(function(r) { return r.employeeId && !r.ambiguous; });
    if (rows.length === 0) { showToast('Nothing to submit.', true); return; }
    var fn = firebase.functions().httpsCallable('recordBurdenEntry');
    var tid = MastDB.tenantId();
    var ok = 0, fail = 0, errors = [];
    var total = rows.length;
    var done = 0;

    // M4 fix-up: Promise.allSettled with concurrency cap 5 (was sequential
    // for-await — N CF calls in series was 20×slower for typical 20-row pastes).
    // Progress UI updates after each row settles.
    function setProgress(n) {
      var prog = document.getElementById('burdenBulkProgress');
      if (prog) prog.textContent = 'Submitting ' + n + ' of ' + total + '…';
    }
    var progEl = document.getElementById('burdenBulkProgress');
    if (!progEl) {
      var prevWrap = document.getElementById('burdenBulkPreview');
      if (prevWrap) {
        var p = document.createElement('div');
        p.id = 'burdenBulkProgress';
        p.style.cssText = 'margin-top:10px;font-size:0.78rem;color:var(--warm-gray);';
        prevWrap.appendChild(p);
      }
    }
    setProgress(0);

    var CONCURRENCY = 5;
    var idx = 0;
    async function runOne(rowIdx) {
      var r = rows[rowIdx];
      try {
        var res = await fn({ tenantId: tid, periodId: r.periodId, employeeId: r.employeeId, breakdown: r.breakdown, source: 'manual' });
        var data = (res && res.data) ? res.data : {};
        if (data && data.ok === true) ok++;
        else { fail++; errors.push('Row ' + (rowIdx + 1) + ': ' + ((data && (data.message || data.error)) || 'no ok flag')); }
      } catch (err) {
        fail++;
        errors.push('Row ' + (rowIdx + 1) + ': ' + ((err && err.message) || String(err)));
      } finally {
        done++;
        setProgress(done);
      }
    }
    async function worker() {
      while (true) {
        var myIdx = idx++;
        if (myIdx >= rows.length) return;
        await runOne(myIdx);
      }
    }
    var workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, rows.length); w++) workers.push(worker());
    await Promise.allSettled(workers);

    showToast('Bulk submit: ' + ok + ' OK / ' + fail + ' failed' + (fail ? ' (see console)' : ''), fail > 0);
    if (errors.length) console.error('[burden] bulk errors:', errors);
    // Invalidate finance W3 caches so the next P&L re-render reflects the write.
    if (window.MastFinanceW3 && typeof window.MastFinanceW3.invalidateMetaCache === 'function') {
      try { window.MastFinanceW3.invalidateMetaCache(); } catch (_) {}
    }
    teamBurdenBulkCancel();
    loadBurdenEntries();
  }

  // ---- Detail view ----
  async function openBurdenDetail(periodId, empId) {
    var period = burdenEntriesCache[periodId] || {};
    var doc = period[empId];
    if (!doc) { showToast('Entry not found in cache; reloading.', true); loadBurdenEntries(); return; }
    var emp = employeesData.find(function(e) { return e._key === empId; });
    // R2-H3: Firestore writes flat fields (wages/employerFica/futa/suta/wcPremium/
    // retirement/benefits) on the doc; legacy/MCP path may nest under `breakdown`.
    // Read flat first, fall back to breakdown.
    var bd = doc.breakdown || {};
    function _bdField(name) {
      return doc[name] != null ? doc[name] : bd[name];
    }
    var lines = [
      ['Wages', _bdField('wages')],
      ['Employer FICA', _bdField('employerFica')],
      ['FUTA', _bdField('futa')],
      ['SUTA', _bdField('suta')],
      ['WC premium', _bdField('wcPremium')],
      ['Retirement', _bdField('retirement')]
    ];
    var benefitsList = Array.isArray(doc.benefits) ? doc.benefits : (Array.isArray(bd.benefits) ? bd.benefits : []);
    benefitsList.forEach(function(b) { lines.push(['Benefit: ' + (b.type || 'other'), b.amount]); });

    // Per-job allocation summary — flat collection (post-rework).
    var alloc = [];
    try {
      var allocRaw = await MastDB.get('admin/burdenedLaborByJob').catch(function() { return null; }) || {};
      Object.keys(allocRaw).forEach(function(compositeId) {
        var docByJob = allocRaw[compositeId] || {};
        if (docByJob.periodId !== periodId) return;
        if (docByJob.employeeId !== empId) return;
        var jid = docByJob.jobId;
        if (!jid) {
          var parts = compositeId.split('__');
          if (parts.length >= 3) jid = parts[parts.length - 1];
        }
        if (!jid) return;
        alloc.push({ jobId: jid, amount: docByJob.allocatedBurden || docByJob.amount || docByJob.allocatedCents || 0 });
      });
    } catch (_) {}

    var h = '';
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:10px;">Burden detail — ' + esc(emp ? emp.fullName : empId) + ' · ' + esc(_burdenPeriodIdToLabel(periodId)) + '</div>';
    h += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;margin-bottom:14px;">';
    lines.forEach(function(l) {
      h += '<tr><td style="padding:4px 8px;color:var(--warm-gray);">' + esc(l[0]) + '</td><td style="padding:4px 8px;text-align:right;">$' + ((l[1] || 0) / 100).toFixed(2) + '</td></tr>';
    });
    h += '<tr style="border-top:1px solid var(--cream-dark,var(--cream-dark));"><td style="padding:6px 8px;font-weight:600;">Total burden</td><td style="padding:6px 8px;text-align:right;font-weight:700;">$' + ((doc.totalBurden || 0) / 100).toFixed(2) + '</td></tr>';
    h += '</table>';
    // R2-M5: detail header uses branded source-tag chip + dash for unknown confidence.
    var _detailSrc = doc.source || 'manual';
    var _detailConf = doc.confidence || (_detailSrc === 'manual' ? 'HIGH' : null);
    var _srcChipHtml = (window.MastFinanceW3 && window.MastFinanceW3.renderSourceTagChip)
      ? window.MastFinanceW3.renderSourceTagChip(_detailSrc, _detailConf)
      : '<strong>' + esc(BURDEN_SOURCE_LABELS[_detailSrc] || _detailSrc) + '</strong>';
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
      + '<span>Source:</span> ' + _srcChipHtml
      + (_detailConf ? ' <span>· Confidence: <strong>' + esc(String(_detailConf)) + '</strong></span>' : ' <span>· Confidence: —</span>')
      + (doc.jobId ? ' <span>· Job: ' + esc(doc.jobId) + '</span>' : '')
      + '</div>';
    h += '<div style="font-weight:600;font-size:0.85rem;margin-bottom:6px;">Per-job allocation</div>';
    if (alloc.length === 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">No per-job allocations recorded for this period yet. Allocation CF runs after recordBurdenEntry.</div>';
    } else {
      h += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;margin-bottom:14px;">';
      alloc.forEach(function(a) {
        h += '<tr><td style="padding:4px 8px;">' + esc(a.jobId) + '</td><td style="padding:4px 8px;text-align:right;">$' + ((a.amount || 0) / 100).toFixed(2) + '</td></tr>';
      });
      h += '</table>';
    }
    h += '<div style="display:flex;gap:8px;">';
    h += '<button class="btn btn-primary btn-small" data-pid="' + esc(periodId) + '" data-eid="' + esc(empId) + '" onclick="teamBurdenEditEntry(this.dataset.pid, this.dataset.eid)">Edit</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="teamBurdenCloseDetail()">Close</button>';
    h += '</div>';

    var modalEl = document.getElementById('burdenFormWrap');
    var innerEl = document.getElementById('burdenFormInner');
    if (modalEl && innerEl) {
      innerEl.innerHTML = h;
      _burdenShowAsModal(modalEl);
    }
  }

  function teamBurdenCloseDetail() {
    var el = document.getElementById('burdenFormWrap');
    if (el) el.style.display = 'none';
  }

  // ---- Estimator settings panel (W3.2) ----
  // W3.5-2: NAICS-source provenance hint shown beneath the WC premium input.
  // Reads burdenSource.wcSource set by the seedSutaOnTeamEnable CF.
  //   - 'naics-X-${classCode}' → "Pre-filled from NAICS {code} ({className}) — confirm or override"
  //   - 'manufacturing-average' → "Default for manufacturing (3.5%) — set your actual rate for accuracy"
  //   - 'operator-*' / absent → no hint (operator-set or unknown)
  function _renderWcSourceHint(src) {
    try {
      var ws = (src && src.wcSource) || '';
      if (!ws) return '';
      if (ws.indexOf('operator-') === 0) return '';
      var hintStyle = 'display:block;margin-top:4px;font-style:italic;font-size:0.78rem;color:var(--warm-gray);';
      if (ws.indexOf('naics-') === 0) {
        // Format: naics-{naicsCode}-{classCode}
        // We display naicsCode + a human-readable className. The className is
        // not stamped on wcSource directly, so we read it from a sibling field
        // (burdenSource.wcClassName) if present; otherwise fall back to the
        // class code alone.
        var rest = ws.substring('naics-'.length);
        var dashIdx = rest.indexOf('-');
        var naicsCode = dashIdx >= 0 ? rest.substring(0, dashIdx) : rest;
        var classCode = dashIdx >= 0 ? rest.substring(dashIdx + 1) : '';
        var className = (src && src.wcClassName) || classCode || '';
        var label = className ? (naicsCode + ' (' + className + ')') : naicsCode;
        return '<span style="' + hintStyle + '">Pre-filled from NAICS ' + esc(label) + ' &mdash; confirm or override</span>';
      }
      if (ws === 'manufacturing-average') {
        return '<span style="' + hintStyle + '">Default for manufacturing (3.5%) &mdash; set your actual rate for accuracy</span>';
      }
      return '';
    } catch (_) { return ''; }
  }

  async function loadBurdenEstimatorPanel() {
    var wrap = document.getElementById('burdenEstimatorWrap');
    if (!wrap) return;
    try {
      var meta = await MastDB.get('admin/integrations/_meta').catch(function() { return null; }) || {};
      var src = meta.burdenSource || {};
      burdenEstimator = src;
      var mult = src.estimatorMultipliers || {};
      var sutaByState = mult.sutaByState || {}; // {state: {rate, isOverride}}
      var wcRate = mult.wcRate || 0;       // decimal e.g. 0.0123
      var benefitsRate = mult.benefitsRate || 0;
      var retirementRate = mult.retirementRate || 0;
      var lastSeeded = src.lastSeededAt || null;
      var lastFlipped = src.lastSourceFlippedAt || null;

      // Pull registered states from admin/nexusRegistrations (closest existing source).
      var nexus = await MastDB.get('admin/nexusRegistrations').catch(function() { return null; }) || {};
      var states = Object.keys(nexus).sort();
      if (states.length === 0) states = Object.keys(sutaByState).sort();

      var h = '';
      h += '<div style="font-weight:600;font-size:1rem;margin-bottom:6px;">Labor Burden Estimator</div>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">Default rates used when no payroll-partner data is available. Operator overrides win over seeded defaults until you Force Reseed.</p>';

      // SUTA per state
      h += '<div style="font-weight:600;font-size:0.9rem;margin:14px 0 6px;">SUTA rate by state</div>';
      if (states.length === 0) {
        h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No registered states found in <code>admin/nexusRegistrations</code>. Add nexus first or click <strong>Reseed defaults</strong> to seed all 50 states.</div>';
      } else {
        h += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;margin-bottom:10px;"><thead><tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));"><th style="padding:6px 8px;text-align:left;">State</th><th style="padding:6px 8px;text-align:left;">Default %</th><th style="padding:6px 8px;text-align:left;">Override %</th></tr></thead><tbody>';
        states.forEach(function(s) {
          var row = sutaByState[s] || {};
          var def = row.defaultRate != null ? (row.defaultRate * 100).toFixed(3) : (row.rate != null && !row.isOverride ? (row.rate * 100).toFixed(3) : '');
          var ovr = row.isOverride && row.rate != null ? (row.rate * 100).toFixed(3) : '';
          h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
          h += '<td style="padding:6px 8px;font-weight:600;">' + esc(s) + '</td>';
          h += '<td style="padding:6px 8px;color:var(--warm-gray);">' + esc(def) + '</td>';
          h += '<td style="padding:6px 8px;"><input type="number" step="0.001" id="bSuta_' + esc(s) + '" value="' + esc(ovr) + '" placeholder="(use default)" style="' + INPUT_STYLE + 'width:120px;padding:4px 8px;font-size:0.85rem;"></td>';
          h += '</tr>';
        });
        h += '</tbody></table>';
      }

      // Single-rate fields
      h += '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:14px 0;">';
      h += labelField('bWcRate', 'WC premium (% of wages)', '<input type="number" step="0.001" id="bWcRate" value="' + esc(wcRate ? (wcRate * 100).toFixed(3) : '') + '" placeholder="e.g. 1.2" style="' + INPUT_STYLE + '">' + _renderWcSourceHint(src));
      h += labelField('bBenRate', 'Benefits load (% of wages)', '<input type="number" step="0.001" id="bBenRate" value="' + esc(benefitsRate ? (benefitsRate * 100).toFixed(3) : '') + '" placeholder="e.g. 8.0" style="' + INPUT_STYLE + '">');
      h += labelField('bRetRate', 'Retirement match (% of wages)', '<input type="number" step="0.001" id="bRetRate" value="' + esc(retirementRate ? (retirementRate * 100).toFixed(3) : '') + '" placeholder="e.g. 3.0" style="' + INPUT_STYLE + '">');
      h += '</div>';

      h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">';
      h += '<button class="btn btn-primary btn-small" onclick="teamBurdenSaveEstimator()">Save</button>';
      h += '<button class="btn btn-secondary btn-small" onclick="teamBurdenReseedSuta(false)">Reseed SUTA defaults</button>';
      h += '<button class="btn btn-secondary btn-small" onclick="teamBurdenReseedSuta(true)" style="border-color:#dc2626;color:#dc2626;">Force reseed (overrides operator edits)</button>';
      h += '</div>';

      h += '<div style="margin-top:14px;font-size:0.78rem;color:var(--warm-gray);">';
      h += 'Last seeded: <strong>' + esc(lastSeeded || 'never') + '</strong>';
      h += ' · Last source flipped: <strong>' + esc(lastFlipped || 'never') + '</strong>';
      h += '</div>';

      wrap.innerHTML = h;
    } catch (err) {
      console.error('[burden] loadBurdenEstimatorPanel:', err);
      wrap.innerHTML = '<div style="color:var(--danger);padding:20px;">Error loading estimator settings: ' + esc(err && err.message || String(err)) + '</div>';
    }
  }

  async function teamBurdenSaveEstimator() {
    try {
      var existing = await MastDB.get('admin/integrations/_meta').catch(function() { return null; }) || {};
      var src = existing.burdenSource || {};
      var mult = (src.estimatorMultipliers && typeof src.estimatorMultipliers === 'object') ? Object.assign({}, src.estimatorMultipliers) : {};
      var prevSuta = mult.sutaByState || {};
      var newSuta = Object.assign({}, prevSuta);
      // Collect every override input present on screen.
      document.querySelectorAll('input[id^="bSuta_"]').forEach(function(inp) {
        var state = inp.id.replace(/^bSuta_/, '');
        var raw = inp.value;
        var prev = prevSuta[state] || {};
        if (raw === '' || raw == null) {
          // Clear override, keep default.
          newSuta[state] = Object.assign({}, prev, { isOverride: false, rate: prev.defaultRate != null ? prev.defaultRate : prev.rate });
        } else {
          var pct = parseFloat(raw);
          if (!isNaN(pct)) {
            newSuta[state] = Object.assign({}, prev, { rate: pct / 100, isOverride: true });
            if (newSuta[state].defaultRate == null && prev.rate != null && !prev.isOverride) {
              newSuta[state].defaultRate = prev.rate;
            }
          }
        }
      });
      function pct(id) { var v = parseFloat((document.getElementById(id) || {}).value); return isNaN(v) ? 0 : v / 100; }
      // Build canonical multiplier payload — canonical field names are
      // `wc` / `benefits` / `retirement` (NOT wcRate/benefitsRate). We
      // keep sutaByState in the existing shape (UI-owned) AND derive the
      // canonical `suta` map ({state: rate}) that the CF + advisor + MCP
      // consume; UI continues to read sutaByState for override metadata.
      mult.sutaByState = newSuta;
      var sutaMap = {};
      Object.keys(newSuta).forEach(function(s) {
        var r = newSuta[s] || {};
        if (typeof r.rate === 'number') sutaMap[s] = r.rate;
      });
      mult.suta = sutaMap;
      mult.wc = pct('bWcRate');
      mult.benefits = pct('bBenRate');
      mult.retirement = pct('bRetRate');
      // Drop the legacy *Rate aliases if present — single source of truth.
      delete mult.wcRate; delete mult.benefitsRate; delete mult.retirementRate;

      // H5 rework: prefer routing through setBurdenEstimatorConfig CF for
      // audit-consistent writes. Falls back to direct admin write if the CF
      // call fails (admin still has write permission on _meta).
      var routedOk = false;
      try {
        var setFn = firebase.functions().httpsCallable('setBurdenEstimatorConfig');
        var resp = await setFn({ tenantId: MastDB.tenantId(), multipliers: mult });
        var data = (resp && resp.data) || {};
        if (data.ok === true) routedOk = true;
      } catch (cfErr) {
        console.warn('[burden] setBurdenEstimatorConfig CF failed; falling back to direct write:', cfErr && cfErr.message);
      }
      if (!routedOk) {
        var nowIso = new Date().toISOString();
        var patch = Object.assign({}, existing, {
          burdenSource: Object.assign({}, src, {
            estimatorMultipliers: mult,
            updatedAt: nowIso,
            updatedBy: (auth && auth.currentUser && auth.currentUser.uid) || null
          })
        });
        await MastDB.set('admin/integrations/_meta', patch);
      }
      if (window.MastFinanceW3 && typeof window.MastFinanceW3.invalidateMetaCache === 'function') {
        try { window.MastFinanceW3.invalidateMetaCache(); } catch (_) {}
      }
      showToast('Estimator settings saved.');
      loadBurdenEstimatorPanel();
    } catch (err) {
      console.error('[burden] save estimator failed:', err);
      showToast('Save failed: ' + ((err && err.message) || String(err)), true);
    }
  }

  async function teamBurdenReseedSuta(force) {
    if (force) {
      var msg = 'Force reseed will OVERWRITE every operator-edited SUTA rate with the seeded default. Proceed?';
      var ok = typeof mastConfirm === 'function'
        ? await mastConfirm(msg, { title: 'Force reseed?', confirmLabel: 'Force reseed', danger: true })
        : window.confirm(msg);
      if (!ok) return;
    }
    try {
      var fn = firebase.functions().httpsCallable('seedStateSutaTable');
      var res = await fn({ tid: MastDB.tenantId(), force: !!force });
      var data = (res && res.data) ? res.data : {};
      if (data && data.ok === false) { showToast('Reseed failed: ' + (data.message || 'unknown'), true); return; }
      showToast('SUTA defaults' + (force ? ' force-' : ' ') + 'reseeded.');
      loadBurdenEstimatorPanel();
    } catch (err) {
      console.error('[burden] seedStateSutaTable threw:', err);
      showToast('Reseed failed: ' + ((err && err.message) || String(err)), true);
    }
  }

  // ========================================
  // Surface 1: Employee Roster
  // ========================================
  function renderRoster() {
    var h = '';

    // URL-driven filters from MCP admin links: status, employmentType, employeeIds, complianceGapsOnly
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlEmpType = (rp && typeof rp.employmentType === 'string') ? rp.employmentType : '';
    var urlIdsParam = (rp && typeof rp.employeeIds === 'string') ? rp.employeeIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var urlGapsOnly = !!(rp && (rp.complianceGapsOnly === '1' || rp.complianceGapsOnly === 'true'));
    var hasUrlFilter = !!(urlStatus || urlEmpType || urlIds.length || urlGapsOnly);

    var active;
    if (hasUrlFilter) {
      active = employeesData.filter(function(e) {
        var st = e.status || 'active';
        if (urlStatus) { if (st !== urlStatus) return false; }
        else if (st !== 'active') return false;
        if (urlEmpType && e.employmentType !== urlEmpType) return false;
        if (urlIdLookup && !urlIdLookup[e._key]) return false;
        if (urlGapsOnly) {
          var cl = e.complianceChecklist || {};
          var hasGap = false;
          COMPLIANCE_FIELDS.forEach(function(f) {
            if (!cl[f.key] || cl[f.key].status !== 'completed') hasGap = true;
          });
          if (!hasGap) return false;
        }
        return true;
      });
    } else {
      active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    }
    var partTime = active.filter(function(e) { return e.employmentType === 'part-time'; });
    var gapCount = 0;
    active.forEach(function(emp) {
      var cl = emp.complianceChecklist || {};
      COMPLIANCE_FIELDS.forEach(function(f) {
        if (!cl[f.key] || cl[f.key].status !== 'completed') gapCount++;
      });
    });
    var totalMonthlyCost = active.reduce(function(s, e) { return s + calcMonthlyCost(e); }, 0);

    // URL-filter banner
    if (hasUrlFilter) {
      var bparts = [];
      if (urlIds.length) bparts.push(MastFormat.countNoun(urlIds.length, 'selected employee'));
      if (urlStatus) bparts.push('status: ' + urlStatus);
      if (urlEmpType) bparts.push('type: ' + urlEmpType);
      if (urlGapsOnly) bparts.push('compliance gaps only');
      h += '<div id="teamUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>👥 Showing ' + bparts.join(', ') + ' (' + active.length + ')</span>' +
        '<button type="button" onclick="clearTeamFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<div>';
    h += '<h2 style="margin:0;">Your team</h2>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    h += active.length + ' active';
    if (partTime.length > 0) h += ' \u00b7 ' + partTime.length + ' part-time';
    if (gapCount > 0) h += ' \u00b7 <span style="color:#d97706;">\u26a0 ' + MastFormat.countNoun(gapCount, 'compliance gap') + '</span>';
    h += '</div>';
    if (active.length > 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">Monthly labor cost: <strong>' + fmtDollars(Math.round(totalMonthlyCost)) + '</strong></div>';
    }
    h += '</div>';
    h += '<button class="btn btn-primary" onclick="teamAddEmployee()">+ New Employee</button>';
    h += '</div>';

    h += '<div id="teamAddForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamAddFormInner"></div>';
    h += '</div>';

    h += '<div id="teamRosterCards">';
    if (active.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:1.6rem;margin-bottom:12px;">\ud83d\udc65</div>';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No employees yet</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Add your team members to track pay, hours, and compliance.</p>';
      h += '</div>';
    } else {
      active.forEach(function(emp) { h += renderEmployeeCard(emp); });
    }
    h += '</div>';
    return h;
  }

  function renderEmployeeCard(emp) {
    var h = '<div data-id="' + esc(emp._key) + '" onclick="teamViewEmployee(this.dataset.id)" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div>';
    h += '<span style="font-weight:600;font-size:0.9rem;">\ud83d\udc64 ' + esc(emp.fullName || '') + '</span>';
    if (emp.preferredName) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">(' + esc(emp.preferredName) + ')</span>';
    if (emp.jobTitle) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">\u2014 ' + esc(emp.jobTitle) + '</span>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray,var(--warm-gray));margin-top:2px;">';
    if (emp.employmentType) h += capitalize(emp.employmentType.replace('-', ' '));
    h += ' \u00b7 ' + fmtRate(emp.payRate, emp.payType);
    if (emp.scheduledHoursPerWeek) h += ' \u00b7 ' + emp.scheduledHoursPerWeek + ' hrs/week';
    h += '</div>';
    h += '</div>';
    h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="event.stopPropagation();teamEditEmployee(this.dataset.id)">Edit</button>';
    h += '</div>';

    // Compliance summary
    var cl = emp.complianceChecklist || {};
    var badges = [];
    var hasGaps = false;
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key];
      if (item && item.status === 'completed') {
        badges.push('<span style="color:#16a34a;font-size:0.78rem;">\u2713 ' + esc(f.label) + '</span>');
      } else {
        hasGaps = true;
        if (f.key === 'workersComp') {
          badges.push('<span style="color:#d97706;font-size:0.78rem;">\u26a0 Workers comp missing</span>');
        }
      }
    });

    // Check for upcoming expiry
    var soonestExpiry = null;
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key];
      if (item && item.expiryDate) {
        var days = Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
        if (days > 0 && days <= 90 && (soonestExpiry === null || days < soonestExpiry.days)) {
          soonestExpiry = { days: days, date: item.expiryDate };
        }
      }
    });

    if (!hasGaps) {
      var expiryNote = soonestExpiry ? ' \u00b7 Expires ' + soonestExpiry.date : '';
      h += '<div style="font-size:0.78rem;color:#16a34a;margin-top:4px;">\u2713 All documents on file' + expiryNote + '</div>';
    } else {
      h += '<div style="font-size:0.78rem;margin-top:4px;">' + badges.join(' \u00b7 ') + '</div>';
    }

    h += '</div>';
    return h;
  }

  // ========================================
  // Surface 2: Employee Detail
  // ========================================
  function renderEmployeeDetail() {
    var emp = employeesData.find(function(e) { return e._key === selectedEmployeeId; });
    if (!emp) return '<div style="color:var(--danger);">Employee not found.</div>';

    var h = '';
    h += '<button class="detail-back" onclick="teamSwitchView(\'roster\')">\u2190 Back to People</button>';

    h += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;">';
    h += '<div>';
    h += '<h3 style="margin:0;">' + esc(emp.fullName || '') + '</h3>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    if (emp.jobTitle) h += esc(emp.jobTitle) + ' \u00b7 ';
    h += capitalize((emp.employmentType || '').replace('-', ' '));
    if (emp.startDate) h += ' \u00b7 Started ' + emp.startDate;
    if (emp.status === 'terminated') h += ' \u00b7 <span style="color:var(--danger);">Terminated' + (emp.terminationDate ? ' ' + emp.terminationDate : '') + '</span>';
    h += '</div>';
    h += '</div>';
    h += '<button class="btn btn-secondary btn-small" data-id="' + esc(emp._key) + '" onclick="teamEditEmployee(this.dataset.id)">Edit</button>';
    h += '</div>';

    // Edit form container (form renders here when Edit is clicked)
    h += '<div id="teamAddForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamAddFormInner"></div>';
    h += '</div>';

    // Detail body — hidden when edit form is open
    h += '<div id="teamDetailBody">';

    // --- Pay & Employment (always visible, no collapse) ---
    h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="display:flex;gap:24px;flex-wrap:wrap;font-size:0.9rem;">';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">\ud83d\udcb0 Pay</span><br><strong>' + fmtRate(emp.payRate, emp.payType) + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Type</span><br><strong>' + esc(capitalize((emp.payType || 'not set').replace('-', ' '))) + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">\ud83d\udcc5 Schedule</span><br><strong>' + (emp.scheduledHoursPerWeek ? emp.scheduledHoursPerWeek + ' hrs/week' : 'not set') + '</strong></div>';
    h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Frequency</span><br><strong>' + esc(capitalize((emp.payFrequency || 'not set').replace('-', ' '))) + '</strong></div>';
    var monthly = calcMonthlyCost(emp);
    if (monthly > 0) h += '<div><span style="color:var(--warm-gray);font-size:0.78rem;">Monthly</span><br><strong>' + fmtDollars(monthly) + '</strong></div>';
    h += '</div></div>';

    // --- Contact & Personal (collapsible, open by default) ---
    var contactHtml = '';
    if (emp.phone) contactHtml += '<div style="font-size:0.85rem;margin-bottom:4px;">\ud83d\udcde ' + esc(emp.phone) + '</div>';
    if (emp.address && emp.address.street) {
      contactHtml += '<div style="font-size:0.85rem;margin-bottom:4px;">\ud83c\udfe0 ' + esc(emp.address.street);
      if (emp.address.city) contactHtml += ', ' + esc(emp.address.city);
      if (emp.address.state) contactHtml += ', ' + esc(emp.address.state);
      if (emp.address.zip) contactHtml += ' ' + esc(emp.address.zip);
      contactHtml += '</div>';
    }
    if (emp.ssnLast4) {
      contactHtml += '<div style="font-size:0.85rem;margin-bottom:4px;">\ud83d\udd12 SSN: \u2022\u2022\u2022-\u2022\u2022-' + esc(emp.ssnLast4) + '</div>';
    }
    if (emp.emergencyContact && emp.emergencyContact.name) {
      contactHtml += '<div style="font-size:0.85rem;margin-top:8px;">\ud83d\udea8 <strong>Emergency:</strong> ' + esc(emp.emergencyContact.name);
      if (emp.emergencyContact.phone) contactHtml += ' \u00b7 ' + esc(emp.emergencyContact.phone);
      if (emp.emergencyContact.relationship) contactHtml += ' (' + esc(emp.emergencyContact.relationship) + ')';
      contactHtml += '</div>';
    }
    if (!contactHtml) {
      contactHtml = '<div style="font-size:0.85rem;color:var(--warm-gray-light);">No contact info on file. Edit to add.</div>';
    }
    h += collapsibleSection('secContact', 'Contact & Personal', contactHtml);

    // --- Compliance Checklist (collapsible, open by default) ---
    var cl = emp.complianceChecklist || {};
    var compGaps = 0;
    var compHtml = '';
    COMPLIANCE_FIELDS.forEach(function(f) {
      var item = cl[f.key] || {};
      var status = item.status || 'missing';
      var statusColor = status === 'completed' ? '#16a34a' : status === 'not-applicable' ? 'var(--warm-gray-light)' : '#d97706';
      var statusIcon = status === 'completed' ? '\u2713' : status === 'not-applicable' ? '\u2014' : '\u26a0';
      var statusLabel = status === 'completed' ? 'Complete' : status === 'not-applicable' ? 'N/A' : 'Missing';
      if (status !== 'completed' && status !== 'not-applicable') compGaps++;

      compHtml += '<div data-emp="' + esc(emp._key) + '" data-key="' + esc(f.key) + '" onclick="teamEditCompliance(this.dataset.emp, this.dataset.key)" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:10px 14px;margin-bottom:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
      compHtml += '<div style="display:flex;justify-content:space-between;align-items:center;">';
      compHtml += '<div>';
      compHtml += '<span style="font-weight:500;font-size:0.9rem;">' + esc(f.label) + '</span>';
      if (item.storageLocation) compHtml += ' <span style="font-size:0.78rem;color:var(--warm-gray);">\u00b7 ' + esc(capitalize(item.storageLocation.replace('-', ' '))) + '</span>';
      if (item.expiryDate) {
        var daysToExpiry = Math.floor((new Date(item.expiryDate).getTime() - Date.now()) / 86400000);
        if (daysToExpiry <= 90 && daysToExpiry > 0) compHtml += ' <span style="font-size:0.78rem;color:#d97706;">\u26a0 expires in ' + daysToExpiry + 'd</span>';
        else if (daysToExpiry <= 0) compHtml += ' <span style="font-size:0.78rem;color:var(--danger);">Expired</span>';
      }
      compHtml += '</div>';
      compHtml += '<span style="color:' + statusColor + ';font-weight:600;font-size:0.85rem;">' + statusIcon + ' ' + statusLabel + '</span>';
      compHtml += '</div>';
      if (f.key === 'workersComp' && status !== 'completed') {
        compHtml += '<div style="font-size:0.72rem;color:#d97706;margin-top:4px;">Required in most states from your first employee. Check with your insurance agent if unsure.</div>';
      }
      if (item.driveFileName) {
        compHtml += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">\ud83d\udcc4 ' + esc(item.driveFileName);
        if (item.driveLastModified) compHtml += ' \u00b7 Modified ' + item.driveLastModified.split('T')[0];
        compHtml += '</div>';
      }
      compHtml += '</div>';
    });
    compHtml += '<div id="teamComplianceForm" style="display:none;"></div>';
    var compBadge = compGaps > 0 ? '<span style="color:#d97706;font-size:0.78rem;">\u26a0 ' + MastFormat.countNoun(compGaps, 'gap') + '</span>' : '<span style="color:#16a34a;font-size:0.78rem;">\u2713 Complete</span>';
    h += collapsibleSection('secCompliance', 'Compliance Checklist', compHtml, { badge: compBadge });

    // --- Employee Documents (collapsible, closed by default) ---
    var docs = [];
    var empDocs = emp.documents || {};
    if (Array.isArray(empDocs)) {
      docs = empDocs.map(function(d, i) { d._key = d.documentId || String(i); return d; });
    } else {
      docs = Object.entries(empDocs).map(function(e) { var d = e[1]; d._key = e[0]; return d; });
    }
    var docsHtml = '<div id="teamEmpDocForm" style="display:none;"></div>';
    if (docs.length === 0) {
      docsHtml += '<div style="font-size:0.85rem;color:var(--warm-gray);">No documents on file.</div>';
    } else {
      docs.forEach(function(doc) { docsHtml += renderDocCard(doc, false, emp._key); });
    }
    var docsRight = '<button class="btn btn-primary btn-small" data-emp="' + esc(emp._key) + '" onclick="event.stopPropagation();teamExpandAndAdd(\'secDocs\');teamAddEmpDoc(this.dataset.emp)">+ New Document</button>';
    h += collapsibleSection('secDocs', 'Documents', docsHtml, { open: docs.length > 0, badge: '<span style="font-size:0.78rem;color:var(--warm-gray);">' + docs.length + '</span>', rightHtml: docsRight });

    // --- Hours Log (collapsible, closed by default) ---
    var hoursLog = emp.hoursLog || {};
    var hoursCount = typeof hoursLog === 'object' ? Object.keys(hoursLog).length : 0;
    var hoursRight = '<button class="btn btn-primary btn-small" data-id="' + esc(emp._key) + '" onclick="event.stopPropagation();teamExpandAndAdd(\'secHours\');teamLogHours(this.dataset.id)">+ Log Hours</button>';
    h += collapsibleSection('secHours', 'Hours Log', renderHoursSection(emp), { open: false, badge: hoursCount > 0 ? '<span style="font-size:0.78rem;color:var(--warm-gray);">' + hoursCount + ' entries</span>' : '', rightHtml: hoursRight });

    // --- References (collapsible, closed by default) ---
    var refsData = emp.references || {};
    var refsCount = Array.isArray(refsData) ? refsData.length : Object.keys(refsData).length;
    var refsRight = '<button class="btn btn-primary btn-small" data-emp="' + esc(emp._key) + '" onclick="event.stopPropagation();teamExpandAndAdd(\'secRefs\');teamAddReference(this.dataset.emp)">+ New Reference</button>';
    h += collapsibleSection('secRefs', 'References', renderReferencesSection(emp), { open: false, badge: refsCount > 0 ? '<span style="font-size:0.78rem;color:var(--warm-gray);">' + refsCount + '</span>' : '', rightHtml: refsRight });

    h += '</div>'; // close teamDetailBody
    return h;
  }

  // ========================================
  // Compliance Checklist Edit
  // ========================================
  function openComplianceForm(empId, fieldKey) {
    var emp = employeesData.find(function(e) { return e._key === empId; });
    if (!emp) return;
    var cl = emp.complianceChecklist || {};
    var item = cl[fieldKey] || {};
    var fieldLabel = COMPLIANCE_FIELDS.find(function(f) { return f.key === fieldKey; });

    var formEl = document.getElementById('teamComplianceForm');
    if (!formEl) return;

    var h = '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">Edit: ' + esc(fieldLabel ? fieldLabel.label : fieldKey) + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += labelField('compStatus', 'Status', selectInput('compStatus', [
      { value: 'missing', label: 'Missing' },
      { value: 'completed', label: 'Completed' },
      { value: 'not-applicable', label: 'Not Applicable' },
    ], item.status || 'missing'));

    h += labelField('compStorage', 'Storage location', selectInput('compStorage', [{ value: '', label: 'Not specified' }].concat(STORAGE_OPTIONS), item.storageLocation || ''));

    h += labelField('compDate', 'Completed date', dateInput('compDate', item.completedDate || ''));
    h += labelField('compExpiry', 'Expiry date', dateInput('compExpiry', item.expiryDate || ''));

    h += renderDriveUrlField('comp', item.url || '', item);
    h += fullWidthDiv(labelField('compNotes', 'Notes', textInput('compNotes', item.notes || '', 'Optional')));

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;">';
    h += '<button class="btn btn-primary" data-emp="' + esc(empId) + '" data-key="' + esc(fieldKey) + '" onclick="teamSaveCompliance(this.dataset.emp, this.dataset.key)">Save</button>';
    h += '<button class="btn btn-secondary" onclick="document.getElementById(\'teamComplianceForm\').style.display=\'none\'">Cancel</button>';
    h += '</div>';
    h += '</div>';

    formEl.innerHTML = h;
    formEl.style.display = '';
    attachDriveUrlListener('comp', 'compStorage');
  }

  async function saveCompliance(empId, fieldKey) {
    var driveFields = collectDriveFields('comp');
    var fields = {
      status: document.getElementById('compStatus').value,
      storageLocation: document.getElementById('compStorage').value || null,
      completedDate: document.getElementById('compDate').value || null,
      expiryDate: document.getElementById('compExpiry').value || null,
      url: document.getElementById('compUrl').value.trim() || null,
      notes: document.getElementById('compNotes').value.trim() || null,
      driveFileId: driveFields.driveFileId,
      driveFileName: driveFields.driveFileName,
      driveLastModified: driveFields.driveLastModified,
    };
    try {
      await window.TeamBridge.saveCompliance(empId, fieldKey, fields);   // single-sourced write + audit (stamps updatedAt)
      showToast('Compliance item saved');
      document.getElementById('teamComplianceForm').style.display = 'none';
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Hours Section
  // ========================================
  function renderHoursSection(emp) {
    var h = '';

    h += '<div id="teamHoursForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:14px 18px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamHoursFormInner"></div>';
    h += '</div>';
    h += '<div id="teamHoursTable" style="font-size:0.85rem;color:var(--warm-gray);">Loading hours\u2026</div>';

    setTimeout(function() { loadHoursForEmployee(emp._key); }, 0);
    return h;
  }

  async function loadHoursForEmployee(empId) {
    var container = document.getElementById('teamHoursTable');
    if (!container) return;
    try {
      var eightWeeksAgo = new Date();
      eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
      var data = await MastDB.query('admin/employees/' + empId + '/hoursLog')
        .orderByChild('date')
        .startAt(eightWeeksAgo.toISOString().split('T')[0])
        .once() || {};
      var entries = Object.values(data).sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });

      if (entries.length === 0) {
        container.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;">No hours logged recently.</div>';
        return;
      }

      // Check week total for overtime warning
      var weekTotals = {};
      entries.forEach(function(e) {
        var d = new Date(e.date);
        var weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        var wk = weekStart.toISOString().split('T')[0];
        weekTotals[wk] = (weekTotals[wk] || 0) + (e.hoursWorked || 0) + (e.overtimeHours || 0);
      });

      // Current week warning
      var now = new Date();
      var currentWeekStart = new Date(now);
      currentWeekStart.setDate(now.getDate() - now.getDay());
      var currentWeekKey = currentWeekStart.toISOString().split('T')[0];
      var currentWeekTotal = weekTotals[currentWeekKey] || 0;

      var h = '';
      if (currentWeekTotal >= 38) {
        h += '<div style="background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:6px;padding:8px 12px;margin-bottom:8px;font-size:0.85rem;color:#fbbf24;">\u26a0 This employee has logged ' + currentWeekTotal.toFixed(1) + ' hours this week \u2014 approaching overtime.</div>';
      }

      h += '<table style="width:100%;font-size:0.85rem;border-collapse:collapse;">';
      h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));"><th style="text-align:left;padding:6px 8px;font-weight:600;">Date</th><th style="text-align:right;padding:6px 8px;font-weight:600;">Hours</th><th style="text-align:right;padding:6px 8px;font-weight:600;">OT</th><th style="text-align:left;padding:6px 8px;font-weight:600;">Notes</th></tr>';
      entries.slice(0, 20).forEach(function(entry) {
        h += '<tr style="border-bottom:1px solid var(--cream-dark,var(--cream-dark));">';
        h += '<td style="padding:6px 8px;">' + esc(entry.date || '') + '</td>';
        h += '<td style="padding:6px 8px;text-align:right;">' + (entry.hoursWorked || 0) + '</td>';
        h += '<td style="padding:6px 8px;text-align:right;">' + (entry.overtimeHours > 0 ? entry.overtimeHours : '\u2014') + '</td>';
        h += '<td style="padding:6px 8px;color:var(--warm-gray);">' + esc(entry.notes || '') + '</td>';
        h += '</tr>';
      });
      h += '</table>';
      container.innerHTML = h;
    } catch (err) {
      container.innerHTML = '<div style="color:var(--danger);">Error loading hours.</div>';
    }
  }

  function openLogHoursForm(empId) {
    var formEl = document.getElementById('teamHoursForm');
    var innerEl = document.getElementById('teamHoursFormInner');
    if (!formEl || !innerEl) return;

    var today = new Date().toISOString().split('T')[0];
    var h = '<div style="display:grid;grid-template-columns:1fr 1fr 1fr 2fr;gap:10px;align-items:end;">';
    h += labelField('hoursDate', 'Date', dateInput('hoursDate', today));
    h += labelField('hoursWorked', 'Hours', numberInput('hoursWorked', '', '0.5', '8'));
    h += labelField('hoursOT', 'Overtime', numberInput('hoursOT', '0', '0.5', '0'));
    h += labelField('hoursNotes', 'Notes', textInput('hoursNotes', '', 'Optional'));
    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:10px;">';
    h += '<button class="btn btn-primary btn-small" data-id="' + esc(empId) + '" onclick="teamSaveHours(this.dataset.id)">Save</button>';
    h += '<button class="btn btn-secondary btn-small" onclick="document.getElementById(\'teamHoursForm\').style.display=\'none\'">Cancel</button>';
    h += '</div>';
    innerEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function saveHours(empId) {
    var hours = parseFloat(document.getElementById('hoursWorked').value);
    if (!hours || hours <= 0) { showToast('Hours required', true); return; }
    var record = {
      date: document.getElementById('hoursDate').value,
      hoursWorked: hours,
      overtimeHours: parseFloat(document.getElementById('hoursOT').value) || 0,
      notes: document.getElementById('hoursNotes').value.trim() || null,
      loggedBy: auth.currentUser ? auth.currentUser.uid : 'admin',
      createdAt: new Date().toISOString(),
    };
    try {
      var logKey = MastDB.newKey('admin/employees/' + empId + '/hoursLog');
      record.logId = logKey;
      await MastDB.set('admin/employees/' + empId + '/hoursLog/' + logKey, record);
      showToast('Hours logged');
      document.getElementById('teamHoursForm').style.display = 'none';
      loadHoursForEmployee(empId);
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // References Section
  // ========================================
  function renderReferencesSection(emp) {
    var refs = emp.references || {};
    var refList = [];
    if (Array.isArray(refs)) {
      refList = refs.map(function(r, i) { r._key = r.referenceId || String(i); return r; });
    } else {
      refList = Object.entries(refs).map(function(e) { var r = e[1]; r._key = e[0]; return r; });
    }

    var h = '';
    h += '<div id="teamRefForm" style="display:none;"></div>';

    if (refList.length === 0) {
      h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No references on file.</div>';
    } else {
      refList.forEach(function(ref) {
        var outcomeColor = ref.outcome === 'concerning' ? '#d97706' : ref.outcome === 'positive' ? '#16a34a' : 'var(--warm-gray)';
        h += '<div data-emp="' + esc(emp._key) + '" data-ref="' + esc(ref._key) + '" onclick="teamEditReference(this.dataset.emp, this.dataset.ref)" style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:10px 14px;margin-bottom:6px;cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'">';
        h += '<div>';
        h += '<span style="font-weight:500;">' + esc(ref.name || '') + '</span>';
        if (ref.phone) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">' + esc(ref.phone) + '</span>';
        if (ref.relationship) h += ' <span style="font-size:0.85rem;color:var(--warm-gray);">(' + esc(ref.relationship) + ')</span>';
        h += ' <span class="status-badge" style="background:' + outcomeColor + '22;color:' + outcomeColor + ';">' + esc(capitalize((ref.outcome || 'not-checked').replace('-', ' '))) + '</span>';
        if (ref.checkedDate) h += ' <span style="font-size:0.78rem;color:var(--warm-gray-light);">' + esc(ref.checkedDate) + '</span>';
        h += '</div>';
        if (ref.notes) h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">' + esc(ref.notes) + '</div>';
        h += '</div>';
      });
    }
    return h;
  }

  var editingRefId = null;
  function openReferenceForm(empId, refId) {
    editingRefId = refId;
    var emp = employeesData.find(function(e) { return e._key === empId; });
    if (!emp) return;
    var refs = emp.references || {};
    var ref = {};
    if (refId) {
      if (Array.isArray(refs)) {
        ref = refs.find(function(r) { return (r.referenceId || '') === refId; }) || {};
      } else {
        ref = refs[refId] || {};
      }
    }

    var formEl = document.getElementById('teamRefForm');
    if (!formEl) return;

    var h = '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (refId ? 'Edit Reference' : 'New Reference') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += labelField('refName', 'Name', textInput('refName', ref.name || '', 'Reference name'));
    h += labelField('refPhone', 'Phone', textInput('refPhone', ref.phone || '', '555-555-5555'));
    h += labelField('refRelationship', 'Relationship', textInput('refRelationship', ref.relationship || '', 'e.g. Former employer'));
    h += labelField('refOutcome', 'Outcome', selectInput('refOutcome', REFERENCE_OUTCOMES.map(function(o) { return { value: o, label: capitalize(o.replace('-', ' ')) }; }), ref.outcome || 'not-checked'));
    h += labelField('refCheckedDate', 'Checked date', dateInput('refCheckedDate', ref.checkedDate || ''));
    h += labelField('refNotes', 'Notes', textInput('refNotes', ref.notes || '', 'Optional'));

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" data-emp="' + esc(empId) + '" onclick="teamSaveReference(this.dataset.emp)">' + (refId ? 'Save' : 'Create Reference') + '</button>';
    h += '<button class="btn btn-secondary" onclick="document.getElementById(\'teamRefForm\').style.display=\'none\'">Cancel</button>';
    if (refId) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-emp="' + esc(empId) + '" data-ref="' + esc(refId) + '" onclick="teamDeleteReference(this.dataset.emp, this.dataset.ref)">Delete</button></span>';
    }
    h += '</div>';
    h += '</div>';

    formEl.innerHTML = h;
    formEl.style.display = '';
  }

  async function saveReference(empId) {
    var name = document.getElementById('refName').value.trim();
    if (!name) { showToast('Name is required', true); return; }
    var fields = {
      name: name,
      phone: document.getElementById('refPhone').value.trim() || null,
      relationship: document.getElementById('refRelationship').value.trim() || null,
      outcome: document.getElementById('refOutcome').value,
      checkedDate: document.getElementById('refCheckedDate').value || null,
      notes: document.getElementById('refNotes').value.trim() || null,
    };
    try {
      // Single-sourced write + audit (bridge mints refId/createdAt + stamps updatedAt on create).
      await window.TeamBridge.addReference(empId, fields, editingRefId || null);
      showToast(editingRefId ? 'Reference saved' : 'Reference created');
      editingRefId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteReference(empId, refId) {
    if (!await mastConfirm('Delete this reference? This cannot be undone.', { title: 'Delete Reference', danger: true })) return;
    try {
      await window.TeamBridge.removeReference(empId, refId);   // single-sourced write + audit
      showToast('Reference deleted');
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Surface 3: Tenant Documents
  // ========================================
  function renderTenantDocs() {
    var h = '';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">';
    h += '<h2 style="margin:0;">Business Documents</h2>';
    h += '<button class="btn btn-primary" onclick="teamAddTenantDoc()">+ New Document</button>';
    h += '</div>';

    h += '<div id="teamDocForm" style="display:none;background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    h += '<div id="teamDocFormInner"></div>';
    h += '</div>';

    h += '<div id="teamDocCards">';
    if (tenantDocs.length === 0) {
      h += '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">';
      h += '<div style="font-size:1.6rem;margin-bottom:12px;">\ud83d\udcc4</div>';
      h += '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No business documents</p>';
      h += '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Track business licenses, insurance certificates, leases, and permits.</p>';
      h += '</div>';
    } else {
      tenantDocs.forEach(function(doc) { h += renderDocCard(doc, true, null); });
    }
    h += '</div>';
    return h;
  }

  function renderDocCard(doc, isTenantLevel, empId) {
    var docKey = esc(doc._key || doc.documentId || '');
    var clickAction = '';
    if (isTenantLevel) {
      clickAction = 'teamEditTenantDoc(\'' + docKey + '\')';
    } else if (empId) {
      clickAction = 'teamEditEmpDoc(\'' + esc(empId) + '\', \'' + docKey + '\')';
    }
    var h = '<div' + (clickAction ? ' onclick="' + clickAction + '"' : '') + ' style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:12px 16px;margin-bottom:8px;box-shadow:0 1px 3px rgba(0,0,0,0.08);' + (clickAction ? 'cursor:pointer;transition:border-color 0.15s;" onmouseover="this.style.borderColor=\'var(--amber)\'" onmouseout="this.style.borderColor=\'var(--cream-dark,var(--cream-dark))\'"' : '"') + '>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;">';
    h += '<div style="font-weight:600;font-size:0.9rem;">\ud83d\udcc4 ' + esc(doc.title || 'Untitled') + '</div>';
    h += '</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:4px;">';
    var parts = [];
    if (doc.type) parts.push(capitalize(doc.type));
    if (doc.storageLocation) parts.push(capitalize(doc.storageLocation.replace('-', ' ')));
    h += parts.join(' \u00b7 ');

    if (doc.driveFileName) {
      h += '<div style="margin-top:2px;">\ud83d\udcc4 ' + esc(doc.driveFileName);
      if (doc.driveLastModified) h += ' \u00b7 Modified ' + doc.driveLastModified.split('T')[0];
      h += '</div>';
    }

    if (doc.url) {
      h += '<div style="margin-top:2px;"><a href="' + esc(doc.url) + '" target="_blank" rel="noopener" style="color:var(--teal);font-size:0.78rem;">\ud83d\udd17 View document</a></div>';
    }

    if (doc.expiryDate) {
      var daysToExpiry = Math.floor((new Date(doc.expiryDate).getTime() - Date.now()) / 86400000);
      if (daysToExpiry <= 0) {
        h += '<div style="color:var(--danger);opacity:0.8;margin-top:2px;">Expired ' + doc.expiryDate + '</div>';
      } else if (daysToExpiry <= 90) {
        h += '<div style="color:#d97706;margin-top:2px;">\u26a0 Expires in ' + daysToExpiry + ' days (' + doc.expiryDate + ')</div>';
      } else {
        h += '<div style="margin-top:2px;">Expires ' + doc.expiryDate + '</div>';
      }
    }
    h += '</div></div>';
    return h;
  }

  // ========================================
  // Document Forms (shared for tenant + employee)
  // ========================================
  function openDocForm(docId, isTenantLevel, empId) {
    editingDocId = docId;
    var doc = {};
    if (docId && isTenantLevel) {
      doc = tenantDocs.find(function(d) { return d._key === docId || d.documentId === docId; }) || {};
    } else if (docId && empId) {
      var emp = employeesData.find(function(e) { return e._key === empId; });
      if (emp) {
        var empDocs = emp.documents || {};
        if (Array.isArray(empDocs)) {
          doc = empDocs.find(function(d) { return (d.documentId || d._key) === docId; }) || {};
        } else {
          doc = empDocs[docId] || {};
        }
      }
    }
    var isNew = !docId;

    var containerId = isTenantLevel ? 'teamDocForm' : 'teamEmpDocForm';
    var innerId = isTenantLevel ? 'teamDocFormInner' : null;
    var formEl = document.getElementById(containerId);
    if (!formEl) return;

    var h = '';
    if (!isTenantLevel) {
      h += '<div style="background:var(--cream,var(--cream));border:1px solid var(--cream-dark,var(--cream-dark));border-radius:8px;padding:16px 20px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,0.08);">';
    }
    h += '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Document' : 'Edit Document') + '</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">';

    h += labelField('docTitle', 'Title', textInput('docTitle', doc.title || '', 'e.g. Business License'));
    h += labelField('docType', 'Type', selectInput('docType', DOC_TYPES.map(function(t) { return { value: t, label: capitalize(t) }; }), doc.type || 'other'));
    h += labelField('docStorage', 'Storage', selectInput('docStorage', [{ value: '', label: 'Not specified' }].concat(STORAGE_OPTIONS), doc.storageLocation || ''));
    h += labelField('docExpiry', 'Expiry date', dateInput('docExpiry', doc.expiryDate || ''));
    h += labelField('docStatus', 'Status', selectInput('docStatus', [
      { value: 'current', label: 'Current' },
      { value: 'pending', label: 'Pending' },
      { value: 'expired', label: 'Expired' },
      { value: 'not-applicable', label: 'Not Applicable' },
    ], doc.status || 'current'));
    h += labelField('docOnFile', 'On file date', dateInput('docOnFile', doc.onFileDate || ''));
    h += renderDriveUrlField('doc', doc.url || '', doc);
    h += fullWidthDiv(labelField('docDesc', 'Description', textInput('docDesc', doc.description || '', 'Optional')));
    h += fullWidthDiv(labelField('docNotes', 'Notes', textInput('docNotes', doc.notes || '', 'Optional')));

    h += '</div>';
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';

    var saveAttr = isTenantLevel ? 'onclick="teamSaveDoc()"' : 'data-emp="' + esc(empId || '') + '" onclick="teamSaveEmpDoc(this.dataset.emp)"';
    h += '<button class="btn btn-primary" ' + saveAttr + '>' + (isNew ? 'Create Document' : 'Save') + '</button>';
    var cancelFn = isTenantLevel ? 'teamCancelDocForm()' : 'document.getElementById(\'teamEmpDocForm\').style.display=\'none\'';
    h += '<button class="btn btn-secondary" onclick="' + cancelFn + '">Cancel</button>';
    if (!isNew) {
      var deleteAttr = isTenantLevel
        ? 'data-id="' + esc(docId) + '" onclick="teamDeleteDoc(this.dataset.id)"'
        : 'data-emp="' + esc(empId || '') + '" data-id="' + esc(docId) + '" onclick="teamDeleteEmpDoc(this.dataset.emp, this.dataset.id)"';
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" ' + deleteAttr + '>Delete</button></span>';
    }
    h += '</div>';
    if (!isTenantLevel) h += '</div>';

    if (innerId) {
      document.getElementById(innerId).innerHTML = h;
    } else {
      formEl.innerHTML = h;
    }
    formEl.style.display = '';
    // Hide doc cards while form is open
    var docCards = document.getElementById('teamDocCards');
    if (docCards) docCards.style.display = 'none';
    setTimeout(function() {
      var el = document.getElementById('docTitle');
      if (el) el.focus();
      attachDriveUrlListener('doc', 'docStorage');
    }, 0);
  }

  function collectDocFields() {
    var driveFields = collectDriveFields('doc');
    return {
      title: document.getElementById('docTitle').value.trim(),
      type: document.getElementById('docType').value,
      storageLocation: document.getElementById('docStorage').value || null,
      expiryDate: document.getElementById('docExpiry').value || null,
      status: document.getElementById('docStatus').value || 'current',
      onFileDate: document.getElementById('docOnFile').value || null,
      url: document.getElementById('docUrl').value.trim() || null,
      description: document.getElementById('docDesc').value.trim() || null,
      notes: document.getElementById('docNotes').value.trim() || null,
      driveFileId: driveFields.driveFileId,
      driveFileName: driveFields.driveFileName,
      driveLastModified: driveFields.driveLastModified,
      updatedAt: new Date().toISOString(),
    };
  }

  async function saveDoc() {
    var fields = collectDocFields();
    if (!fields.title) { showToast('Title is required', true); return; }
    try {
      if (editingDocId) {
        await MastDB.update('admin/documents/' + editingDocId, fields);
        showToast('Document saved');
      } else {
        fields.createdAt = new Date().toISOString();
        fields.documentId = MastDB.newKey('admin/documents');
        await MastDB.set('admin/documents/' + fields.documentId, fields);
        showToast('Document created');
      }
      editingDocId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function saveEmpDoc(empId) {
    var fields = collectDocFields();
    if (!fields.title) { showToast('Title is required', true); return; }
    try {
      // Single-sourced write + audit (bridge mints docId/createdAt + stamps updatedAt on create).
      await window.TeamBridge.addDocument(empId, fields, editingDocId || null);
      showToast(editingDocId ? 'Document saved' : 'Document created');
      editingDocId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteDoc(docId) {
    if (!await mastConfirm('Delete this document? This cannot be undone.', { title: 'Delete Document', danger: true })) return;
    try {
      await MastDB.remove('admin/documents/' + docId);
      showToast('Document deleted');
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  async function deleteEmpDoc(empId, docId) {
    if (!await mastConfirm('Delete this document? This cannot be undone.', { title: 'Delete Document', danger: true })) return;
    try {
      await window.TeamBridge.removeDocument(empId, docId);   // single-sourced write + audit
      showToast('Document deleted');
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Employee Add/Edit Form (Full)
  // ========================================
  function openAddEmployeeForm(empId) {
    editingEmployeeId = empId;
    var emp = empId ? employeesData.find(function(e) { return e._key === empId; }) : {};
    if (!emp) emp = {};
    var isNew = !empId;
    var addr = emp.address || {};
    var ec = emp.emergencyContact || {};

    var formEl = document.getElementById('teamAddForm');
    var innerEl = document.getElementById('teamAddFormInner');
    if (!formEl || !innerEl) return;

    var h = '<div style="font-weight:600;font-size:0.9rem;margin-bottom:12px;">' + (isNew ? 'New Employee' : 'Edit Employee') + '</div>';

    // Identity & Contact
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Identity & Contact</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEmpName', 'Full name', textInput('teamEmpName', emp.fullName || '', ''));
    h += labelField('teamEmpPreferred', 'Preferred name', textInput('teamEmpPreferred', emp.preferredName || '', 'Optional'));
    h += labelField('teamEmpPhone', 'Phone', textInput('teamEmpPhone', emp.phone || '', '555-555-5555'));
    h += labelField('teamEmpSsn', 'Last 4 of SSN (reference only)', textInput('teamEmpSsn', emp.ssnLast4 || '', '1234'));
    h += '<div style="grid-column:1/-1;font-size:0.72rem;color:var(--warm-gray);margin-top:-8px;">We only store the last 4 digits as a reference \u2014 full SSN should be in Gusto or your payroll system.</div>';
    h += fullWidthDiv(labelField('teamEmpStreet', 'Street address', textInput('teamEmpStreet', addr.street || '', '')));
    h += labelField('teamEmpCity', 'City', textInput('teamEmpCity', addr.city || '', ''));
    h += labelField('teamEmpState', 'State', textInput('teamEmpState', addr.state || '', ''));
    h += labelField('teamEmpZip', 'ZIP', textInput('teamEmpZip', addr.zip || '', ''));
    h += '</div>';

    // Emergency Contact
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Emergency Contact</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEcName', 'Name', textInput('teamEcName', ec.name || '', ''));
    h += labelField('teamEcPhone', 'Phone', textInput('teamEcPhone', ec.phone || '', ''));
    h += labelField('teamEcRelation', 'Relationship', textInput('teamEcRelation', ec.relationship || '', 'e.g. Spouse'));
    h += '</div>';

    // Employment
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Employment</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEmpTitle', 'Job title', textInput('teamEmpTitle', emp.jobTitle || '', 'e.g. Studio assistant'));
    h += labelField('teamEmpType', 'Employment type', selectInput('teamEmpType', EMPLOYMENT_TYPES.map(function(t) { return { value: t, label: capitalize(t.replace('-', ' ')) }; }), emp.employmentType || 'part-time'));
    h += labelField('teamEmpStart', 'Start date', dateInput('teamEmpStart', emp.startDate || ''));
    h += labelField('teamEmpStatus', 'Status', selectInput('teamEmpStatus', [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'terminated', label: 'Terminated' },
    ], emp.status || 'active'));
    h += '<div id="teamTermDateWrap" style="' + (emp.status === 'terminated' ? '' : 'display:none;') + '">';
    h += labelField('teamEmpTermDate', 'Termination date', dateInput('teamEmpTermDate', emp.terminationDate || ''));
    h += '</div>';
    h += '</div>';

    // Pay
    h += '<div style="font-size:0.85rem;font-weight:600;color:var(--teal);margin-bottom:8px;">Pay</div>';
    h += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">';
    h += labelField('teamEmpPayType', 'Pay type', selectInput('teamEmpPayType', PAY_TYPES.map(function(t) { return { value: t, label: capitalize(t.replace('-', ' ')) }; }), emp.payType || 'hourly'));
    h += labelField('teamEmpRate', 'Pay rate ($)', numberInput('teamEmpRate', emp.payRate ? (emp.payRate / 100).toFixed(2) : '', '0.01', emp.payType === 'salary' ? '$/month' : '$/hr'));
    h += labelField('teamEmpFreq', 'Pay frequency', selectInput('teamEmpFreq', PAY_FREQUENCIES.map(function(t) { return { value: t, label: capitalize(t.replace('-', ' ')) }; }), emp.payFrequency || 'bi-weekly'));
    h += labelField('teamEmpHours', 'Scheduled hours/week', numberInput('teamEmpHours', emp.scheduledHoursPerWeek || '', '1', ''));
    h += '</div>';

    // Buttons
    h += '<div style="display:flex;gap:8px;margin-top:14px;align-items:center;">';
    h += '<button class="btn btn-primary" onclick="teamSaveEmployee()">' + (isNew ? 'Create Employee' : 'Save') + '</button>';
    h += '<button class="btn btn-secondary" onclick="teamCancelAddForm()">Cancel</button>';
    if (!isNew) {
      h += '<span style="margin-left:auto;"><button class="btn btn-danger btn-small" data-id="' + esc(empId) + '" onclick="teamDeleteEmployee(this.dataset.id)">Delete</button></span>';
    }
    h += '</div>';

    innerEl.innerHTML = h;
    formEl.style.display = '';

    // Hide roster cards and detail body while form is open
    var cards = document.getElementById('teamRosterCards');
    if (cards) cards.style.display = 'none';
    var detailBody = document.getElementById('teamDetailBody');
    if (detailBody) detailBody.style.display = 'none';

    // Toggle termination date visibility
    var statusSel = document.getElementById('teamEmpStatus');
    if (statusSel) {
      statusSel.addEventListener('change', function() {
        var wrap = document.getElementById('teamTermDateWrap');
        if (wrap) wrap.style.display = this.value === 'terminated' ? '' : 'none';
      });
    }

    setTimeout(function() { var el = document.getElementById('teamEmpName'); if (el) el.focus(); }, 0);
  }

  // Build the employee-record write shape from a plain data object. Single-sourced
  // so saveEmployee() (legacy form DOM) and window.TeamBridge (the team-v2 twin)
  // produce the EXACT same write. Money: payRate is stored in CENTS; the caller
  // passes payRate already in cents (the DOM form converts dollars→cents before
  // calling). Throws on validation failure so both callers surface the same error.
  function buildEmployeeFields(data) {
    data = data || {};
    var name = (data.fullName || '').trim();
    if (!name) throw new Error('Name is required');
    var ssnVal = (data.ssnLast4 || '').toString().trim();
    if (ssnVal && !/^\d{4}$/.test(ssnVal)) throw new Error('SSN must be exactly 4 digits');
    var addr = data.address || {};
    var ec = data.emergencyContact || {};
    var status = data.status || 'active';
    return {
      fullName: name,
      preferredName: (data.preferredName || '').trim() || null,
      phone: (data.phone || '').trim() || null,
      ssnLast4: ssnVal || null,
      address: {
        street: (addr.street || '').trim() || null,
        city: (addr.city || '').trim() || null,
        state: (addr.state || '').trim() || null,
        zip: (addr.zip || '').trim() || null,
      },
      emergencyContact: {
        name: (ec.name || '').trim() || null,
        phone: (ec.phone || '').trim() || null,
        relationship: (ec.relationship || '').trim() || null,
      },
      jobTitle: (data.jobTitle || '').trim() || null,
      employmentType: data.employmentType || 'part-time',
      startDate: data.startDate || null,
      status: status,
      terminationDate: status === 'terminated' ? (data.terminationDate || null) : null,
      payType: data.payType || 'hourly',
      payRate: (data.payRate || data.payRate === 0) ? data.payRate : null,
      payFrequency: data.payFrequency || 'bi-weekly',
      scheduledHoursPerWeek: data.scheduledHoursPerWeek || null,
      updatedAt: new Date().toISOString(),
    };
  }

  // The shared write. id null/undefined → create (mint emp_<ts>, stamp createdAt);
  // else update in place. Returns the employee id.
  async function writeEmployee(id, fields, isNew) {
    if (isNew) {
      fields.createdAt = new Date().toISOString();
      var newId = id || (MastUtil.genId('emp_'));
      await MastDB.set('admin/employees/' + newId, fields);
      return newId;
    }
    await MastDB.update('admin/employees/' + id, fields);
    return id;
  }

  async function saveEmployee() {
    var rateDollars = parseFloat(document.getElementById('teamEmpRate').value);
    var data = {
      fullName: document.getElementById('teamEmpName').value,
      preferredName: document.getElementById('teamEmpPreferred').value,
      phone: document.getElementById('teamEmpPhone').value,
      ssnLast4: document.getElementById('teamEmpSsn').value.trim(),
      address: {
        street: document.getElementById('teamEmpStreet').value,
        city: document.getElementById('teamEmpCity').value,
        state: document.getElementById('teamEmpState').value,
        zip: document.getElementById('teamEmpZip').value,
      },
      emergencyContact: {
        name: document.getElementById('teamEcName').value,
        phone: document.getElementById('teamEcPhone').value,
        relationship: document.getElementById('teamEcRelation').value,
      },
      jobTitle: document.getElementById('teamEmpTitle').value,
      employmentType: document.getElementById('teamEmpType').value,
      startDate: document.getElementById('teamEmpStart').value || null,
      status: document.getElementById('teamEmpStatus').value,
      terminationDate: document.getElementById('teamEmpStatus').value === 'terminated' ? (document.getElementById('teamEmpTermDate').value || null) : null,
      payType: document.getElementById('teamEmpPayType').value,
      payRate: rateDollars ? Math.round(rateDollars * 100) : null,
      payFrequency: document.getElementById('teamEmpFreq').value,
      scheduledHoursPerWeek: parseInt(document.getElementById('teamEmpHours').value) || null,
    };

    var fields;
    try { fields = buildEmployeeFields(data); }
    catch (e) { showToast(e.message, true); return; }

    try {
      if (editingEmployeeId) {
        await writeEmployee(editingEmployeeId, fields, false);
        showToast('Employee saved');
      } else {
        await writeEmployee(null, fields, true);
        showToast('Employee created');
      }
      editingEmployeeId = null;
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // Bridge for the team-v2 redesign twin (flag-gated #team-v2). It delegates
  // create/update here so the employee-record write stays single-sourced — the
  // twin never reimplements buildEmployeeFields / writeEmployee. Additive; no
  // behavior change to the legacy surface. These make the EXACT write
  // saveEmployee() makes, parameterized by a data object (the legacy handler
  // reads the form DOM, so it can't be called with an object). The twin passes
  // payRate already in CENTS (matching the stored shape). Mirrors
  // window.StudentsBridge / window.ContactsBridge.
  window.TeamBridge = {
    create: async function (data) {
      var fields = buildEmployeeFields(data);
      var id = await writeEmployee(null, fields, true);
      teamLoaded = false;
      return id;
    },
    update: async function (id, data) {
      var fields = buildEmployeeFields(data);
      await writeEmployee(id, fields, false);
      teamLoaded = false;
      return id;
    },
    // ── Per-employee HR sub-writes (close the V1-only gap in team-v2) ──────
    // These make the EXACT writes the legacy renderEmployeeDetail handlers make
    // (same paths + field shapes), parameterized by a data object so the team-v2
    // twin's native compliance/document/reference editors stay single-sourced.
    // Each audits (HR / I-9 / compliance data — auditable by design); legacy
    // never audited these, so this is a safe additive hardening shared by both
    // surfaces (the legacy handlers route through here). Mirrors StudentsBridge.

    // Hard delete the employee record (admin/employees/{id}) and all nested
    // collections (documents / references / complianceChecklist / hoursLog).
    // The CALLER confirms (mastConfirm danger) — the bridge is the write only.
    remove: async function (empId) {
      await MastDB.remove('admin/employees/' + empId);
      teamLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'employee', empId);
      return true;
    },
    // Per-employee compliance checklist item (I-9 / W-4 / state-withholding /
    // offer-letter / workers-comp): status + storage location + dates + link.
    // Path: admin/employees/{id}/complianceChecklist/{fieldKey}. `fields` is the
    // already-built write shape (the caller collects the form). updatedAt stamped.
    saveCompliance: async function (empId, fieldKey, fields) {
      var data = Object.assign({}, fields, { updatedAt: new Date().toISOString() });
      await MastDB.update('admin/employees/' + empId + '/complianceChecklist/' + fieldKey, data);
      teamLoaded = false;
      if (window.writeAudit) writeAudit('update', 'employee-compliance', empId, { field: fieldKey });
      return data;
    },
    // Per-employee document (metadata + link record — NO binary upload; the
    // legacy form stores a link/Drive-metadata record, same as the tenant docs).
    // id null/undefined → create (mint push key, stamp createdAt + documentId);
    // else update in place. Path: admin/employees/{id}/documents/{docId}.
    addDocument: async function (empId, fields, docId) {
      var now = new Date().toISOString();
      var data = Object.assign({}, fields, { updatedAt: now });
      var isNew = !docId;
      if (isNew) {
        docId = MastDB.newKey('admin/employees/' + empId + '/documents');
        data.createdAt = now;
        data.documentId = docId;
        await MastDB.set('admin/employees/' + empId + '/documents/' + docId, data);
      } else {
        await MastDB.update('admin/employees/' + empId + '/documents/' + docId, data);
      }
      teamLoaded = false;
      if (window.writeAudit) writeAudit(isNew ? 'create' : 'update', 'employee-document', empId, { documentId: docId });
      return Object.assign({ _key: docId }, data);
    },
    removeDocument: async function (empId, docId) {
      await MastDB.remove('admin/employees/' + empId + '/documents/' + docId);
      teamLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'employee-document', empId, { documentId: docId });
      return true;
    },
    // Per-employee reference (name / phone / relationship / outcome / notes).
    // id null/undefined → create (mint push key, stamp createdAt + referenceId);
    // else update. Path: admin/employees/{id}/references/{refId}.
    addReference: async function (empId, fields, refId) {
      var now = new Date().toISOString();
      var data = Object.assign({}, fields, { updatedAt: now });
      var isNew = !refId;
      if (isNew) {
        refId = MastDB.newKey('admin/employees/' + empId + '/references');
        data.createdAt = now;
        data.referenceId = refId;
        await MastDB.set('admin/employees/' + empId + '/references/' + refId, data);
      } else {
        await MastDB.update('admin/employees/' + empId + '/references/' + refId, data);
      }
      teamLoaded = false;
      if (window.writeAudit) writeAudit(isNew ? 'create' : 'update', 'employee-reference', empId, { referenceId: refId });
      return Object.assign({ _key: refId }, data);
    },
    removeReference: async function (empId, refId) {
      await MastDB.remove('admin/employees/' + empId + '/references/' + refId);
      teamLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'employee-reference', empId, { referenceId: refId });
      return true;
    }
  };

  async function deleteEmployee(empId) {
    if (!await mastConfirm('Delete this employee and all their data? This cannot be undone.', { title: 'Delete Employee', danger: true })) return;
    try {
      await window.TeamBridge.remove(empId);   // single-sourced write + audit
      showToast('Employee deleted');
      editingEmployeeId = null;
      selectedEmployeeId = null;
      currentView = 'roster';
      teamLoaded = false;
      loadTeam();
    } catch (err) {
      showToast('Error: ' + esc(err.message), true);
    }
  }

  // ========================================
  // Window Exports
  // ========================================
  window.loadTeam = loadTeam;
  window.teamSwitchView = function(view) {
    // docs and onboarding are manager-only; timeclock and pto show role-appropriate view
    if ((view === 'docs' || view === 'onboarding' || view === 'burden') && !canManageTeam()) {
      if (typeof showToast === 'function') showToast('This tab requires Manager or Admin access.', true);
      view = 'roster';
    }
    currentView = view;
    selectedEmployeeId = null;
    // Reset tab-specific state on switch
    if (view === 'timeclock') { tcWeekOffset = 0; tcSelectedEmployeeId = null; }
    if (view === 'pto') { ptoSelectedEmployeeId = null; }
    if (view === 'docs') { docFilterEmployee = ''; docFilterStatus = ''; }
    if (view === 'onboarding') { onboardingFilter = 'all'; }
    if (view === 'burden') { burdenSubView = 'entries'; }
    rerenderHost();
  };

  // Time Clock exports
  window.teamTcSetEmployee = function(id) { tcSelectedEmployeeId = id || null; loadTcManager(); };
  window.teamTcPrevWeek = function() { tcWeekOffset--; loadTcManager(); };
  window.teamTcNextWeek = function() { if (tcWeekOffset < 0) { tcWeekOffset++; loadTcManager(); } };
  window.teamTcAddEntry = function() { openTcAddForm(); };
  window.teamTcSaveEntry = saveTcEntry;
  window.teamTcClockIn = tcClockIn;
  window.teamTcClockOut = tcClockOut;

  // PTO exports
  window.teamPtoSelectEmp = function(id) { ptoSelectedEmployeeId = id; var wrap = document.getElementById('ptoBoardWrap'); if (wrap) { wrap.innerHTML = '<div class="loading">Loading&hellip;</div>'; } rerenderHost(); };
  window.teamPtoBack = function() { ptoSelectedEmployeeId = null; rerenderHost(); };
  window.teamPtoEditPolicy = function(empId) { openPtoPolicyForm(empId); };
  window.teamPtoSavePolicy = savePtoPolicy;
  window.teamPtoRecordUsage = function(empId) { openPtoUsageForm(empId, false); };
  window.teamPtoSaveEntry = savePtoEntry;
  window.teamPtoRequestSelf = function() { var uid = auth && auth.currentUser ? auth.currentUser.uid : null; openPtoUsageForm(uid, true); };

  // Documents exports
  window.teamDocFilter = function() {
    docFilterEmployee = document.getElementById('docFiltEmp').value;
    docFilterStatus = document.getElementById('docFiltStatus').value;
    var active = employeesData.filter(function(e) { return (e.status || 'active') === 'active'; });
    var tbl = document.getElementById('docTableContainer');
    if (tbl) tbl.innerHTML = buildComplianceTable(active);
  };

  // Onboarding exports
  window.teamObFilter = function(f) { onboardingFilter = f; rerenderHost(); };
  window.teamObToggle = toggleObItem;
  window.teamViewEmployee = function(id) {
    selectedEmployeeId = id;
    currentView = 'detail';
    rerenderHost();
  };
  window.teamAddEmployee = function() { openAddEmployeeForm(null); };
  window.teamEditEmployee = function(id) { openAddEmployeeForm(id); };
  window.teamSaveEmployee = saveEmployee;
  window.teamDeleteEmployee = deleteEmployee;
  window.teamCancelAddForm = function() {
    var el = document.getElementById('teamAddForm');
    if (el) el.style.display = 'none';
    var cards = document.getElementById('teamRosterCards');
    if (cards) cards.style.display = '';
    var detailBody = document.getElementById('teamDetailBody');
    if (detailBody) detailBody.style.display = '';
    editingEmployeeId = null;
  };
  window.teamLogHours = function(empId) { openLogHoursForm(empId); };
  window.teamSaveHours = saveHours;
  window.teamEditCompliance = function(empId, fieldKey) { openComplianceForm(empId, fieldKey); };
  window.teamSaveCompliance = saveCompliance;
  window.teamUnlinkDrive = unlinkDrive;
  window.teamToggleSection = function(id) {
    var el = document.getElementById(id);
    var arrow = document.getElementById(id + 'Arrow');
    if (el) {
      var show = el.style.display === 'none';
      el.style.display = show ? '' : 'none';
      if (arrow) arrow.textContent = show ? '\u25bc' : '\u25b6';
    }
  };
  window.teamExpandAndAdd = function(id) {
    var el = document.getElementById(id);
    var arrow = document.getElementById(id + 'Arrow');
    if (el && el.style.display === 'none') {
      el.style.display = '';
      if (arrow) arrow.textContent = '\u25bc';
    }
  };
  window.teamAddTenantDoc = function() { openDocForm(null, true, null); };
  window.teamEditTenantDoc = function(id) { openDocForm(id, true, null); };
  window.teamSaveDoc = saveDoc;
  window.teamDeleteDoc = deleteDoc;
  window.teamCancelDocForm = function() {
    var el = document.getElementById('teamDocForm');
    if (el) el.style.display = 'none';
    var docCards = document.getElementById('teamDocCards');
    if (docCards) docCards.style.display = '';
    editingDocId = null;
  };
  window.teamAddEmpDoc = function(empId) { openDocForm(null, false, empId); };
  window.teamEditEmpDoc = function(empId, docId) { openDocForm(docId, false, empId); };
  window.teamSaveEmpDoc = saveEmpDoc;
  window.teamDeleteEmpDoc = deleteEmpDoc;
  window.teamAddReference = function(empId) { openReferenceForm(empId, null); };
  window.teamEditReference = function(empId, refId) { openReferenceForm(empId, refId); };
  window.teamSaveReference = saveReference;
  window.teamDeleteReference = deleteReference;

  // URL-filter clear (MCP admin-link landings)
  window.clearTeamFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'status' && k !== 'employmentType' && k !== 'employeeIds' && k !== 'complianceGapsOnly') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('team', clean);
    else location.hash = '#team';
    setTimeout(function() {
      var container = document.getElementById('teamTab');
      if (container && typeof renderTeam === 'function') renderTeam(container);
    }, 0);
  };
  window.renderTeamRoster = function() {
    var container = document.getElementById('teamTab');
    if (container && typeof renderTeam === 'function') renderTeam(container);
  };

  // W3 — Labor Burden exports (concepts D-FIN-W3-3, D-FIN-W3-2 UI portion).
  window.teamBurdenSetSubView = teamBurdenSetSubView;
  window.teamBurdenFilterEmployee = teamBurdenFilterEmployee;
  window.teamBurdenOpenForm = function() { openBurdenForm(null, burdenSelectedEmployeeId || null); };
  window.teamBurdenOpenBulk = openBurdenBulk;
  window.teamBurdenBulkPreview = teamBurdenBulkPreview;
  window.teamBurdenBulkSubmit = teamBurdenBulkSubmit;
  window.teamBurdenBulkCancel = teamBurdenBulkCancel;
  window.teamBurdenAutofillWages = teamBurdenAutofillWages;
  window.teamBurdenSubmitForm = teamBurdenSubmitForm;
  window.teamBurdenCancelForm = teamBurdenCancelForm;
  window.teamBurdenAddBenefit = teamBurdenAddBenefit;
  window.teamBurdenRemoveBenefit = teamBurdenRemoveBenefit;
  window.teamBurdenOpenDetail = openBurdenDetail;
  window.teamBurdenCloseDetail = teamBurdenCloseDetail;
  window.teamBurdenEditEntry = function(pid, eid) { openBurdenForm(pid, eid); };
  window.teamBurdenSaveEstimator = teamBurdenSaveEstimator;
  window.teamBurdenReseedSuta = teamBurdenReseedSuta;

})();
