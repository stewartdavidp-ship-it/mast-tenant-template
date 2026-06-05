/**
 * audit-suppressions-v2.js — conversion of the standalone "Audit Suppressions"
 * page that lives inside the audit-feedback.js helper module (legacy route
 * #suppressions, renderManagementPage()).
 *
 * Legacy shows a hand-rolled, ruleId/batchId-grouped list of suppressed audit
 * rules with per-row Remove (un-suppress) buttons. This re-hosts the READ on the
 * Entity Engine: a MastEntity schema drives the standard flat list (one row per
 * suppression), and a row click opens a read-focused Faceted Record slide-out
 * built from MastUI primitives.
 *
 * Variant (read-focused): un-suppressing is the only mutation and it is a
 * destructive, sibling-aware action that stays on the legacy surface. So this
 * twin has NO onSave and NO Remove wiring — it composes a "Manage in classic
 * view" button (navigateToClassic('suppressions')) that drops the user onto the
 * legacy page where Remove already lives. Flag-gated (`?ui=1`), side-by-side
 * with legacy #suppressions; never touches it.
 *
 * Data: tenants/{tid}/rule_suppressions/{suppId}. Read via MastDB.list with a
 * bound limit (the legacy page does an unbounded MastDB.get on the whole
 * collection; we cap it). Same doc shape AuditFeedback.listSuppressions yields.
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
  var READ_LIMIT = 500;

  // Static label maps mirror audit-feedback.js SUPPRESSION_REASONS / _SCOPES.
  // Prefer the live module's constants when present so the two never drift.
  var REASONS = (window.AuditFeedback && AuditFeedback.SUPPRESSION_REASONS) || [
    { id: 'not-applicable', label: "Doesn't apply to my work" },
    { id: 'intentional',    label: 'Intentional design choice' },
    { id: 'temporary',      label: 'Temporary — will revisit' },
    { id: 'disagree',       label: 'Disagree with this rule' },
    { id: 'other',          label: 'Other (explain below)' }
  ];
  var SCOPES = (window.AuditFeedback && AuditFeedback.SUPPRESSION_SCOPES) || [
    { id: 'product',  label: 'This product only' },
    { id: 'category', label: 'This category' },
    { id: 'tenant',   label: 'All my products (tenant-wide)' }
  ];
  function reasonLabel(id) { var r = REASONS.filter(function (x) { return x.id === id; })[0]; return r ? r.label : (id || '—'); }
  function scopeLabel(id) { var s = SCOPES.filter(function (x) { return x.id === id; })[0]; return s ? s.label : (id || '—'); }
  function scopeStr(r) {
    if (r.scope === 'tenant') return scopeLabel('tenant');
    return scopeLabel(r.scope) + (r.scopeId ? ': ' + r.scopeId : '');
  }
  function batchStr(r) { return r.batchId ? 'Batch …' + String(r.batchId).slice(-8) : 'Single'; }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('audit-suppressions-v2', {
    label: 'Suppression', labelPlural: 'Suppressions', size: 'md',
    route: 'audit-suppressions-v2',
    recordId: function (r) { return r.id; },
    // fields[0] is the slide-out title source (engine reads record[name]
    // directly, no get()), so it must be a real string property — `rule` is
    // materialized onto each row in load() from ruleId.
    fields: [
      { name: 'rule', label: 'Rule', type: 'text', list: true, readOnly: true, group: 'Suppression' },
      { name: 'scope', label: 'Scope / batch', type: 'text', list: true, readOnly: true,
        get: function (r) { return scopeStr(r) + (r.batchId ? ' · ' + batchStr(r) : ''); } },
      { name: 'reason', label: 'Reason', type: 'text', list: true, readOnly: true,
        get: function (r) { return reasonLabel(r.reason); } },
      { name: 'by', label: 'Suppressed by', type: 'text', list: true, readOnly: true,
        get: function (r) { return r.createdBy ? String(r.createdBy).slice(0, 8) : '—'; } },
      { name: 'when', label: 'When', type: 'date', list: true, readOnly: true,
        get: function (r) { return r.createdAt || null; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      // Read-focused Faceted Record — tiles + Overview/Provenance facets.
      // No edit/Remove (un-suppress stays on legacy #suppressions); a
      // "Manage in classic view" button routes there.
      render: function (UI, r) {
        var tiles = UI.tiles([
          { k: 'Rule', v: esc(r.ruleId || '—'), hero: true },
          { k: 'Scope', v: esc(scopeLabel(r.scope)) },
          { k: 'Reason', v: esc(reasonLabel(r.reason)) },
          { k: 'When', v: r.createdAt ? N.date(r.createdAt) : '—' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'prov', label: 'Provenance' }], 'ov');

        var scopeKv = UI.kv([
          { k: 'Rule', v: esc(r.ruleId || '—') },
          { k: 'Scope', v: esc(scopeLabel(r.scope)) },
          { k: 'Target', v: esc(r.scope === 'tenant' ? 'All products (tenant-wide)' : (r.scopeId || '—')) },
          { k: 'Reason', v: esc(reasonLabel(r.reason)) }
        ]);
        var reasonCard = r.reasonText
          ? UI.card('Explanation', '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;font-style:italic;">&ldquo;' + esc(r.reasonText) + '&rdquo;</div>')
          : '';

        var prov = UI.kv([
          { k: 'Suppression id', v: esc(r.id || '—') },
          { k: 'Batch', v: esc(r.batchId ? batchStr(r) + ' (' + r.batchId + ')' : 'Single (not part of a batch)') },
          { k: 'Suppressed by', v: esc(r.createdBy || '—') },
          { k: 'Added', v: r.createdAt ? N.date(r.createdAt) : '—' }
        ]);
        var manageBtn =
          '<div style="margin-top:16px;">' +
          '<button type="button" class="btn btn-secondary" onclick="AuditSuppressionsV2.classic()">Manage in classic view →</button>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">Removing a suppression (un-suppress) is done on the classic Suppressions page. Removal is per-row; sibling batch rows are unaffected.</div>' +
          '</div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Suppression', scopeKv) + reasonCard + manageBtn + '</div>' +
          '<div class="mu-pane" data-pane="prov" hidden>' + UI.card('Provenance', prov) + '</div>';
      }
    }
    // No onSave → no Edit button (un-suppress is a legacy-only write).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'when', sortDir: 'desc', q: '', loaded: false };

  function load() {
    if (!(window.MastDB && MastDB.list)) { V2.rows = []; render(); return; }
    MastDB.list('rule_suppressions', { limit: READ_LIMIT }).then(function (raw) {
      var out = [];
      Object.keys(raw || {}).forEach(function (id) {
        var d = raw[id] || {};
        var r = {
          id: id,
          ruleId: d.ruleId, scope: d.scope, scopeId: d.scopeId,
          reason: d.reason, reasonText: d.reasonText || null,
          createdAt: d.createdAt, createdBy: d.createdBy,
          batchId: d.batchId || null
        };
        r.rule = d.ruleId || '(unnamed rule)';   // real string for title + list column
        out.push(r);
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.id] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[audit-suppressions-v2] load', e); V2.loaded = true; render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.ruleId || '').toLowerCase().indexOf(q) >= 0 ||
               scopeStr(r).toLowerCase().indexOf(q) >= 0 ||
               reasonLabel(r.reason).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('audit-suppressions-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('auditSuppressionsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'auditSuppressionsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function tile(value, label) {
    return '<div style="background:var(--cream);border-radius:8px;padding:12px 18px;flex:1;min-width:120px;text-align:center;">' +
      '<div style="font-size:1.6rem;font-weight:700;color:var(--charcoal);">' + value + '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(label) + '</div></div>';
  }

  function render() {
    var tab = ensureTab();
    var rows = visibleRows();
    var batches = {};
    V2.rows.forEach(function (r) { if (r.batchId) batches[r.batchId] = true; });
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Audit Suppressions</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(V2.rows.length) + ' suppression' + (V2.rows.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:12px;margin:12px 0;flex-wrap:wrap;">' +
        tile(N.count(V2.rows.length), 'Suppressions') + tile(N.count(Object.keys(batches).length), 'Batches') +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search rule, scope, reason…" value="' + esc(V2.q) +
        '" oninput="AuditSuppressionsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('audit-suppressions-v2', {
        rows: rows, sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'AuditSuppressionsV2.sort', onRowClickFnName: 'AuditSuppressionsV2.open',
        empty: { title: 'No suppressions yet', message: V2.loaded ? 'Suppressed audit findings will appear here.' : 'Loading…' }
      });
  }

  window.AuditSuppressionsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'when' ? 'desc' : 'asc'); }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('audit-suppressions-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('audit-suppressions-v2', rec, 'read');
      });
    },
    // navigateToClassic bypasses the V2 route remap so this reaches LEGACY
    // #suppressions (where the Remove / un-suppress write lives) even when the
    // redesign flag is on; without it the remap would loop back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('suppressions');
      else if (typeof navigateTo === 'function') navigateTo('suppressions');
    }
  };

  MastAdmin.registerModule('audit-suppressions-v2', {
    routes: { 'audit-suppressions-v2': { tab: 'auditSuppressionsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
