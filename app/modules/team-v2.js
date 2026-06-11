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

  // Native create + edit of the employee RECORD — the legacy form field set
  // (Identity & Contact / Emergency Contact / Employment / Pay), grouped like
  // openAddEmployeeForm. Heavy sub-surfaces (Time Clock, PTO, Documents,
  // Onboarding, Labor Burden, compliance-checklist edits) have their own
  // domain logic and NO V2 home — they stay on legacy via TeamV2.classic().
  // A partial update preserves those nested collections + onboardingChecklist.
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
        var monthly = calcMonthlyCost(e);
        var tiles = UI.tiles([
          { k: 'Pay', v: esc(fmtRate(e.payRate, e.payType)), hero: true },
          { k: 'Type', v: esc(cap(String(e.payType || 'not set').replace('-', ' '))) },
          { k: 'Schedule', v: e.scheduledHoursPerWeek ? (e.scheduledHoursPerWeek + ' hrs/wk') : '—' },
          { k: 'Monthly', v: monthly > 0 ? esc(fmtDollars(monthly)) : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'compliance', label: 'Compliance' }, { key: 'records', label: 'Records' }], 'ov');

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

        // Compliance checklist (read-only)
        var gaps = 0;
        var compRows = COMPLIANCE_FIELDS.map(function (f) {
          var item = (e.complianceChecklist || {})[f.key] || {};
          var st = item.status || 'missing';
          if (st !== 'completed' && st !== 'not-applicable') gaps++;
          var tone = st === 'completed' ? 'success' : st === 'not-applicable' ? 'neutral' : 'amber';
          var label = st === 'completed' ? 'Complete' : st === 'not-applicable' ? 'N/A' : 'Missing';
          return { label: f.label, badge: UI.badge(label, tone), loc: item.storageLocation ? cap(String(item.storageLocation).replace('-', ' ')) : '' };
        });
        var compTable = UI.relatedTable([
          { label: 'Requirement', render: function (r) { return esc(r.label); } },
          { label: 'Storage', render: function (r) { return r.loc ? '<span class="mu-sub">' + esc(r.loc) + '</span>' : '<span class="mu-sub">—</span>'; } },
          { label: 'Status', render: function (r) { return r.badge; } }
        ], compRows);
        var compBadge = gaps > 0 ? (gaps + ' gap' + (gaps !== 1 ? 's' : '')) : 'Complete';

        // Records summary (counts; full management stays on legacy #team)
        var docs = countOf(e.documents), hours = countOf(e.hoursLog), refs = countOf(e.references);
        var records = UI.kv([
          { k: 'Documents', v: N.count(docs) },
          { k: 'Hours log entries', v: N.count(hours) },
          { k: 'References', v: N.count(refs) }
        ]);

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Employment', employment) + UI.card('Contact & personal', contact) + '</div>' +
          '<div class="mu-pane" data-pane="compliance" hidden>' + UI.cardTable('Compliance — ' + compBadge, compTable) +
            '<div style="margin-top:10px;"><button class="btn btn-secondary" onclick="TeamV2.setLens(\'docs\')">Manage compliance documents →</button></div></div>' +
          '<div class="mu-pane" data-pane="records" hidden>' + UI.card('Records', records) +
            '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="btn btn-secondary" onclick="TeamV2.setLens(\'timeclock\')">Time clock →</button>' +
              '<button class="btn btn-secondary" onclick="TeamV2.setLens(\'pto\')">PTO →</button>' +
              (canEditTeam() ? '<button class="btn btn-secondary" onclick="TeamV2.setLens(\'burden\')">Labor burden →</button>' : '') +
            '</div></div>';
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
    // Ensure the legacy team module is loaded so window.TeamBridge (the
    // delegated write path) exists — mirrors contacts-v2 / students-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('team'); } catch (e) {} }
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
      // Re-hosted legacy sub-surface — same implementation, V2 home.
      MastAdmin.loadModule('team').then(function () {
        if (window.TeamPanels) TeamPanels.show(V2.lens, document.getElementById('teamV2PanelHost'));
      }).catch(function (e) { console.error('[team-v2] panel host', e); });
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
      // Ensure the legacy team module (and thus window.TeamBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create / StudentsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('team'); } catch (e) {} }
      MastEntity.openRecord('team-v2', {}, 'create');
    },
    // Sub-surface lenses (classic burn-down Wave B): re-hosted legacy panels.
    setLens: function (l) {
      V2.lens = l;
      try { U.slideOut.requestCloseForce(); } catch (e) {}
      render();
    },
    exportCsv: function () { return MastEntity.exportRows('team-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('team-v2', {
    routes: { 'team-v2': { tab: 'teamV2Tab', setup: function () {
      ensureTab();
      V2.allowed = canViewTeam();
      render();
      if (V2.allowed) load();
    } } }
  });
})();
