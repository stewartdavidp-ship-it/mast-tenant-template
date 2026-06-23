/**
 * auditlog-v2.js — Activity history, V2 (read-only log over admin/auditLog).
 *
 * Conversion of legacy #auditlog (Audit Log). The audit trail is APPEND-ONLY
 * history — no writes, ever (writeAudit in index.html is the only client
 * writer; CFs append server-side). This re-hosts the READ on the Entity
 * Engine: standard flat list + read-only Faceted Record slide-out, with the
 * legacy filters (actor / action / area / date range) and the same cursor
 * pager ("Load older", endBefore(time), page size 50).
 *
 * Read path mirrors legacy EXACTLY: MastDB.auditLog.ref().orderByChild('time')
 * .limitToLast(pageSize+1). ⚠ `time` is MIXED-TYPE in live data — client
 * writeAudit stamps Date.now() (number), server writers stamp Firestore
 * Timestamps — so server-side ordering interleaves the two runs; like legacy,
 * we normalize client-side via _timeMs() and sort ourselves (debt: unify the
 * writer's time type server-side).
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

  var PAGE = 50;
  var ACTION_TONE = { create: 'success', update: 'info', 'delete': 'danger' };
  var ACTION_LABEL = { create: 'Created', update: 'Updated', 'delete': 'Deleted' };

  function entityLabel(e) {
    return (window.ENTITY_LABELS && ENTITY_LABELS[e]) || e || '—';
  }
  // Normalize mixed-type `time` (number ms | ISO | Firestore Timestamp) — the
  // shared legacy helper when present, else a local mirror of it.
  function _timeMs(r) {
    if (typeof window._auditTimeMs === 'function') return window._auditTimeMs(r);
    var t = r && r.time;
    if (t == null) return 0;
    if (typeof t === 'number') return t;
    if (typeof t === 'string') { var p = Date.parse(t); return isNaN(p) ? 0 : p; }
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (t.seconds != null) return t.seconds * 1000;
    return 0;
  }

  // ── schema (read-only log record) ───────────────────────────────────
  MastEntity.define('auditlog-v2', {
    label: 'Activity', labelPlural: 'Activity', size: 'md', route: 'auditlog-v2',
    recordId: function (r) { return r._key; },
    // fields[0] is the SO title — a real string materialized in mat().
    fields: [
      { name: 'title', label: 'What happened', type: 'text', list: true, readOnly: true },
      { name: 'whenIso', label: 'When', type: 'date', list: true, readOnly: true },
      { name: 'actorName', label: 'Who', type: 'text', list: true, readOnly: true },
      { name: 'action', label: 'Action', type: 'status', list: true, readOnly: true,
        get: function (r) { return (r.event && r.event.action) || '—'; },
        format: function (v) { return ACTION_LABEL[v] || v; },
        tone: function (v) { return ACTION_TONE[v] || 'neutral'; } },
      { name: 'area', label: 'Area', type: 'text', list: true, readOnly: true }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var ev = r.event || {}, ctx = r.context || {}, actor = r.actor || {};
        var tiles = UI.tiles([
          { k: 'Action', v: UI.badge(ACTION_LABEL[ev.action] || ev.action || '—', ACTION_TONE[ev.action] || 'neutral'), hero: true },
          { k: 'Area', v: esc(entityLabel(ev.entity)) },
          { k: 'Who', v: esc(r.actorName) },
          { k: 'When', v: r.whenIso ? N.date(r.whenIso) : '—' }
        ]);
        var kv = UI.kv([
          { k: 'What happened', v: esc(r.title) },
          { k: 'Area', v: esc(entityLabel(ev.entity)) },
          { k: 'Record id', v: ev.entityId ? '<span style="font-family:monospace;font-size:0.78rem;">' + esc(ev.entityId) + '</span>' : '—' },
          { k: 'Who', v: esc(r.actorName) + (actor.role ? ' <span style="color:var(--warm-gray);">(' + esc(actor.role) + ')</span>' : '') },
          { k: 'When', v: r.whenMs ? MastFormat.dateTime(r.whenMs) : '—' },
          { k: 'Where', v: ctx.gpsMode === 'fair' ? 'At a fair / event' : 'In the studio' }
        ]);
        var prov = UI.kv([
          { k: 'Entry id', v: '<span style="font-family:monospace;font-size:0.78rem;">' + esc(r._key) + '</span>' },
          { k: 'Actor uid', v: actor.uid ? '<span style="font-family:monospace;font-size:0.78rem;">' + esc(actor.uid) + '</span>' : '—' },
          { k: 'Event id', v: ctx.eventId ? esc(ctx.eventId) : '—' }
        ]);
        var note = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:12px;">Activity entries are permanent history — they can\'t be edited or deleted.</div>';
        return tiles + UI.card('Entry', kv) + UI.card('Provenance', prov) + note;
      }
    }
    // No onSave → no Edit button. Append-only history is read-only by design.
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = {
    rows: [], byId: {}, loaded: false,
    hasMore: false, lastTime: null, loading: false,
    fActor: '', fAction: '', fEntity: '', fFrom: '', fTo: '',
    actors: {}
  };

  function mat(key, e) {
    var r = Object.assign({ _key: key }, e);
    r.whenMs = _timeMs(e);
    r.whenIso = r.whenMs ? new Date(r.whenMs).toISOString() : null;
    r.actorName = (e.actor && e.actor.displayName) || 'Unknown';
    var ev = e.event || {};
    r.area = entityLabel(ev.entity);
    r.title = (ACTION_LABEL[ev.action] || ev.action || '—') + ' · ' + entityLabel(ev.entity) +
      (ev.entityId ? ' · ' + String(ev.entityId).slice(0, 18) : '');
    return r;
  }

  function ingest(snap) {
    var rows = (snap && typeof snap.val === 'function') ? snap.val() : snap;
    rows = rows || {};
    var out = [];
    Object.keys(rows).forEach(function (k) {
      if (!rows[k]) return;
      var r = mat(k, rows[k]);
      out.push(r);
      if (r.actor && r.actor.uid && r.actor.displayName) V2.actors[r.actor.uid] = r.actor.displayName;
    });
    out.sort(function (a, b) { return b.whenMs - a.whenMs; });
    if (out.length > PAGE) {
      V2.hasMore = true;
      var oldest = out[out.length - 1];
      V2.lastTime = oldest.time || null;
      out.pop();
    } else {
      V2.hasMore = false;
      V2.lastTime = null;
    }
    return out;
  }

  function load() {
    if (typeof can === 'function' && !can('auditlog', 'view')) { V2.rows = []; V2.loaded = true; render(); return; }
    var ref = MastDB.auditLog.ref().orderByChild('time').limitToLast(PAGE + 1);
    Promise.resolve(ref.once('value')).then(function (snap) {
      V2.rows = ingest(snap);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[auditlog-v2] load', e); V2.loaded = true; render(); });
  }

  function loadMore() {
    if (!V2.lastTime || V2.loading) return;
    V2.loading = true; render();
    var ref = MastDB.auditLog.ref().orderByChild('time').endBefore(V2.lastTime).limitToLast(PAGE + 1);
    Promise.resolve(ref.once('value')).then(function (snap) {
      var more = ingest(snap);
      V2.rows = V2.rows.concat(more);
      more.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loading = false; render();
    }).catch(function (e) { console.error('[auditlog-v2] loadMore', e); V2.loading = false; render(); });
  }

  function visibleRows() {
    var fromTs = V2.fFrom ? new Date(V2.fFrom + 'T00:00:00').getTime() : 0;
    var toTs = V2.fTo ? new Date(V2.fTo + 'T23:59:59').getTime() : Infinity;
    return V2.rows.filter(function (r) {
      var ev = r.event || {};
      if (V2.fEntity && ev.entity !== V2.fEntity) return false;
      if (V2.fAction && ev.action !== V2.fAction) return false;
      if (V2.fActor && (!r.actor || r.actor.uid !== V2.fActor)) return false;
      if (r.whenMs < fromTs || r.whenMs > toTs) return false;
      return true;
    });
  }

  function ensureTab() {
    var el = document.getElementById('auditlogV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'auditlogV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function sel(id, fnName, current, options, allLabel) {
    var opts = '<option value="">' + esc(allLabel) + '</option>' + options.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (current === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('');
    return '<select id="' + id + '" class="form-input" style="font-size:0.85rem;padding:6px 10px;max-width:180px;" onchange="' + fnName + '(this.value)">' + opts + '</select>';
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Activity history' }) + '<div style="margin-top:14px;color:var(--warm-gray);">Loading…</div>';
      return;
    }
    var rows = visibleRows();
    var actorOpts = Object.keys(V2.actors).map(function (uid) { return [uid, V2.actors[uid]]; })
      .sort(function (a, b) { return a[1].localeCompare(b[1]); });
    var entitySet = {};
    V2.rows.forEach(function (r) { var e = r.event && r.event.entity; if (e) entitySet[e] = entityLabel(e); });
    var entityOpts = Object.keys(entitySet).map(function (e) { return [e, entitySet[e]]; })
      .sort(function (a, b) { return a[1].localeCompare(b[1]); });

    tab.innerHTML =
      U.pageHeader({
        title: 'Activity history',
        count: N.count(rows.length) + ' of ' + N.count(V2.rows.length) + ' loaded entr' + (V2.rows.length === 1 ? 'y' : 'ies'),
        actionsHtml: '<button class="btn btn-secondary" onclick="AuditlogV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0;">' +
        sel('alV2Actor', 'AuditlogV2.setActor', V2.fActor, actorOpts, 'Everyone') +
        sel('alV2Action', 'AuditlogV2.setAction', V2.fAction, [['create', 'Created'], ['update', 'Updated'], ['delete', 'Deleted']], 'All actions') +
        sel('alV2Entity', 'AuditlogV2.setEntity', V2.fEntity, entityOpts, 'All areas') +
        '<input type="date" id="alV2From" class="form-input" style="font-size:0.85rem;padding:6px 10px;" value="' + esc(V2.fFrom) + '" onchange="AuditlogV2.setFrom(this.value)">' +
        '<span style="color:var(--warm-gray);font-size:0.85rem;">to</span>' +
        '<input type="date" id="alV2To" class="form-input" style="font-size:0.85rem;padding:6px 10px;" value="' + esc(V2.fTo) + '" onchange="AuditlogV2.setTo(this.value)">' +
      '</div>' +
      MastEntity.renderList('auditlog-v2', {
        rows: rows,
        onRowClickFnName: 'AuditlogV2.open',
        empty: { title: 'No activity', message: 'No entries match these filters.' }
      }) +
      (V2.hasMore
        ? '<div style="margin:16px 0;text-align:center;"><button class="btn btn-secondary" onclick="AuditlogV2.more()"' + (V2.loading ? ' disabled' : '') + '>' + (V2.loading ? 'Loading…' : 'Load older entries') + '</button></div>'
        : '');
  }

  window.AuditlogV2 = {
    open: function (id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('auditlog-v2', rec, 'read'); },
    setActor: function (v) { V2.fActor = v; render(); },
    setAction: function (v) { V2.fAction = v; render(); },
    setEntity: function (v) { V2.fEntity = v; render(); },
    setFrom: function (v) { V2.fFrom = v || ''; render(); },
    setTo: function (v) { V2.fTo = v || ''; render(); },
    more: loadMore,
    exportCsv: function () { return MastEntity.exportRows('auditlog-v2', visibleRows(), 'filtered'); }
  };

  MastAdmin.registerModule('auditlog-v2', {
    routes: { 'auditlog-v2': { tab: 'auditlogV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
