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
 * Read-focused: editing an employee in legacy is a set of bespoke sub-forms
 * (employee fields, compliance, docs, hours, references) coupled to the legacy
 * pane — those stay on legacy #team. This twin re-hosts the VIEW.
 *
 * RBAC: this surface shows pay. The legacy module is reached only via the 'team'
 * route, gated by can('team','view'); flag twins bypass the per-route gate, so
 * this module re-checks can('team','view') at setup and refuses to render
 * otherwise — mirroring the legacy boundary exactly (pay is not gated below
 * team-view in legacy). Flag-gated (?ui=1) at #team-v2, side-by-side; never
 * touches team.js.
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

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('team-v2', {
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
          '<div class="mu-pane" data-pane="compliance" hidden>' + UI.cardTable('Compliance — ' + compBadge, compTable) + '</div>' +
          '<div class="mu-pane" data-pane="records" hidden>' + UI.card('Records', records) +
            '<div class="mu-sub" style="margin-top:10px;">Add or edit documents, hours and references in the classic Team view.</div></div>';
      }
    }
    // No onSave → no Edit button (editing stays on legacy #team).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'fullName', sortDir: 'asc', q: '', allowed: true, loaded: false };

  function load() {
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
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Team</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(active) + ' active · ' + N.count(V2.rows.length) + ' total</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="TeamV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or title…" value="' + esc(V2.q) +
        '" oninput="TeamV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('team-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'TeamV2.sort', onRowClickFnName: 'TeamV2.open',
        empty: { title: 'No employees', message: V2.loaded ? 'Add team members in the classic Team view.' : 'Loading…' }
      });
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
