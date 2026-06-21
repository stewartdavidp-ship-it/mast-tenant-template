/**
 * diagnostics.js — Self-diagnosis surface (diagnostics L3).
 *
 * Admin-gated diagnostics view that surfaces what the L1 capture core (PR 789) and the
 * L2 read timing (PR 791) record:
 *   - recent auto-reported errors + slow queries, read (scrubbed) from feedbackReports
 *     (the sink L1's captures forward into), and
 *   - this-session captures/breadcrumbs from the in-memory MastError ring.
 *
 * Read-only; TENANT-SELF only (reads this tenant's feedbackReports — no cross-tenant /
 * fleet view; that boundary is runmast.com admin). Mirrors auditlog-v2.js (flat list +
 * read-only Faceted Record slide-out on the Entity Engine). The data it shows is already
 * PII-scrubbed at the source (MastError.scrubReport on every write); we never un-scrub.
 */
(function () {
  'use strict';
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;
  var PAGE = 100; // bounded read (lint-unbounded-read)

  var KIND_TONE = { 'slow-read': 'warning', error: 'danger', event: 'neutral' };
  var KIND_LABEL = { 'slow-read': 'Slow query', error: 'Error', event: 'Event' };

  function canView() { return (typeof can !== 'function') || can('settings', 'view'); }

  function _whenMs(r) {
    if (r && r.timestamp) { var p = Date.parse(r.timestamp); if (!isNaN(p)) return p; }
    var c = r && r.createdAt;
    if (c && typeof c.toMillis === 'function') return c.toMillis();
    if (c && c.seconds != null) return c.seconds * 1000;
    return 0;
  }

  // Normalize a persisted feedbackReport into a uniform diagnostics record.
  function matReport(key, r) {
    var rec = Object.assign({ _key: key }, r);
    rec.whenMs = _whenMs(r);
    rec.whenIso = rec.whenMs ? new Date(rec.whenMs).toISOString() : null;
    var desc = String(r.description || '');
    rec.kind = /slow read/i.test(desc) ? 'slow-read' : 'error';
    rec.summary = desc.split('\n').slice(1).join(' ').replace(/^Error:\s*/, '').trim().slice(0, 140) ||
      desc.split('\n')[0].slice(0, 140);
    rec.screen = r.screen || 'unknown';
    return rec;
  }

  // ── schema (read-only diagnostics record) ───────────────────────────
  MastEntity.define('diagnostics', {
    label: 'Diagnostic', labelPlural: 'Diagnostics', size: 'md', route: 'diagnostics',
    recordId: function (r) { return r._key; },
    fields: [
      { name: 'summary', label: 'What happened', type: 'text', list: true, readOnly: true },
      { name: 'kind', label: 'Kind', type: 'status', list: true, readOnly: true,
        format: function (v) { return KIND_LABEL[v] || v; },
        tone: function (v) { return KIND_TONE[v] || 'neutral'; } },
      { name: 'screen', label: 'Where', type: 'text', list: true, readOnly: true },
      { name: 'whenIso', label: 'When', type: 'date', list: true, readOnly: true }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var tiles = UI.tiles([
          { k: 'Kind', v: UI.badge(KIND_LABEL[r.kind] || r.kind, KIND_TONE[r.kind] || 'neutral'), hero: true },
          { k: 'Severity', v: esc(r.severity || '—') },
          { k: 'Where', v: esc(r.screen) },
          { k: 'When', v: r.whenIso ? N.date(r.whenIso) : '—' }
        ]);
        var detail = r.detail ? '<pre style="white-space:pre-wrap;word-break:break-word;font-size:0.78rem;color:var(--warm-gray-light);margin:0;">' + esc(String(r.detail)) + '</pre>' : '<span style="color:var(--warm-gray);">No further detail.</span>';
        var crumbs = _crumbHtml(r);
        var prov = UI.kv([
          { k: 'Report id', v: '<span style="font-family:monospace;font-size:0.78rem;">' + esc(r._key) + '</span>' },
          { k: 'App version', v: esc(r.appVersion || '—') }
        ]);
        var note = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:12px;">Reports are PII-scrubbed at capture (emails, long numbers, URL query strings, and sensitive fields are redacted).</div>';
        return tiles + UI.card('Detail', esc(r.summary) + '<div style="margin-top:10px;"></div>' + detail) +
          (crumbs ? UI.card('Breadcrumbs (last 60s)', crumbs) : '') + UI.card('Provenance', prov) + note;
      }
    }
  });

  function _crumbHtml(r) {
    var parts = [];
    function rows(label, arr, fmt) {
      if (!arr || !arr.length) return;
      parts.push('<div style="font-size:0.78rem;color:var(--warm-gray);margin:6px 0 2px;">' + esc(label) + '</div>');
      parts.push(arr.slice(-8).map(function (e) {
        return '<div style="font-family:monospace;font-size:0.78rem;color:var(--warm-gray-light);">' + esc(fmt(e)) + '</div>';
      }).join(''));
    }
    rows('Console', r.consoleBuffer, function (e) { return (e.level || 'log') + ': ' + String(e.msg || e.message || ''); });
    rows('Network', r.networkErrors, function (e) { return (e.status || '?') + ' ' + String(e.url || ''); });
    rows('Toasts', r.toastBuffer, function (e) { return String(e.msg || e.message || ''); });
    return parts.join('');
  }

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, loaded: false };

  function ingest(reports) {
    reports = reports || {};
    var out = [];
    Object.keys(reports).forEach(function (k) {
      if (!reports[k]) return;
      out.push(matReport(k, reports[k]));
    });
    out.sort(function (a, b) { return b.whenMs - a.whenMs; });
    return out;
  }

  function load() {
    if (!canView()) { V2.rows = []; V2.loaded = true; render(); return; }
    Promise.resolve(MastDB.query('feedbackReports').limitToLast(PAGE).once()).then(function (reports) {
      V2.rows = ingest(reports);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) {
      if (window.MastError) MastError.capture(e, { where: 'diagnostics.load' });
      V2.loaded = true; render();
    });
  }

  function ensureTab() {
    var el = document.getElementById('diagnosticsTab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'diagnosticsTab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function sessionPulse() {
    var ring = (window.MastError && MastError.recent) ? MastError.recent() : [];
    var crumbs = (window.MastError && MastError.recentCrumbs) ? MastError.recentCrumbs() : [];
    var slow = ring.filter(function (c) { return c.ctx && c.ctx.kind === 'slow-read'; }).length +
      crumbs.filter(function (c) { return c.kind === 'slow-read'; }).length;
    var errs = ring.length - ring.filter(function (c) { return c.ctx && c.ctx.kind === 'slow-read'; }).length;
    return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0;">' +
      U.badge(N.count(errs) + ' captured this session', errs ? 'danger' : 'success') +
      U.badge(N.count(slow) + ' slow read' + (slow === 1 ? '' : 's') + ' this session', slow ? 'warning' : 'neutral') +
      '</div>';
  }

  function render() {
    var tab = ensureTab();
    if (!canView()) {
      tab.innerHTML = U.pageHeader({ title: 'Diagnostics' }) +
        '<div style="margin-top:14px;color:var(--warm-gray);">You don\'t have access to diagnostics.</div>';
      return;
    }
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Diagnostics' }) + '<div style="margin-top:14px;color:var(--warm-gray);">Loading…</div>';
      return;
    }
    tab.innerHTML =
      U.pageHeader({
        title: 'Diagnostics',
        count: N.count(V2.rows.length) + ' recent report' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="DiagnosticsV2.refresh()">↻ Refresh</button>'
      }) +
      sessionPulse() +
      MastEntity.renderList('diagnostics', {
        rows: V2.rows,
        onRowClickFnName: 'DiagnosticsV2.open',
        empty: { title: 'Nothing to report', message: 'No errors or slow queries have been captured. That\'s a good sign.' }
      });
  }

  window.DiagnosticsV2 = {
    open: function (id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('diagnostics', rec, 'read'); },
    refresh: function () { V2.loaded = false; render(); load(); }
  };

  MastAdmin.registerModule('diagnostics', {
    routes: { 'diagnostics': { tab: 'diagnosticsTab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
