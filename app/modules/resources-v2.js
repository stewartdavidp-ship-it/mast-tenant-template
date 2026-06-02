/**
 * resources-v2.js — read-focused Faceted Record twin of the legacy class
 * Resources surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy book.js (#resources, owned by the Book module) hosts resources (the
 * rooms / equipment a class books) as a stack of cards and swaps the pane
 * in-place to a bespoke create/edit form (showResourceForm: Basic Info / Details
 * / Internal Notes). This twin re-hosts that list→detail VIEW on the Entity
 * Engine: a schema-driven list + a read-focused Faceted Record slide-out
 * (Overview / Classes facets).
 *
 * Variant (doc 17 §1a): a resource is a simple equipment/room record (a few
 * attributes + the classes that book it) with no governed lifecycle — its status
 * (active / inactive) is an assigned attribute → Faceted Record, NOT Process/
 * MastFlow. The record is nearly flat, but classes genuinely reference it
 * (class.resourceId), so the Classes facet is a real related collection, not pad.
 *
 * Read-focused: creating/editing a resource is a bespoke multi-section form
 * coupled to the legacy Book module and stays single-sourced on legacy
 * #resources via a "manage in classic view" link. This twin re-hosts the VIEW
 * only — no onSave, no edit form. Flag-gated (?ui=1) at #resources-v2,
 * side-by-side; never touches book.js.
 *
 * Data: resources live at admin/resources (MastDB.resources → that path);
 * classes-that-book-it is derived from public/classes (class.resourceId) — both
 * one-shot keyed-object reads loaded together.
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

  var STATUS_LABEL = { active: 'Active', inactive: 'Inactive' };
  var STATUS_TONE = { active: 'success', inactive: 'neutral' };
  // type (room / equipment) is a category, not a lifecycle — a quiet tint.
  var TYPE_TONE = { room: 'teal', equipment: 'info' };

  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
  function resName(r) { return (r && r.name) || '(unnamed)'; }
  function statusOf(r) { return (r && r.status) || 'active'; }
  function typeOf(r) { return (r && r.type) || ''; }
  function capacityOf(r) {
    var c = r && r.capacity;
    return (c == null || c === '' || isNaN(c)) ? null : Number(c);
  }
  // Classes that book this resource (cheap: one-shot public/classes read).
  function classesFor(r) {
    var id = r && (r._key || r.id);
    if (!id) return [];
    return V2.classes.filter(function (c) { return c && c.resourceId === id; });
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('resources-v2', {
    label: 'Resource', labelPlural: 'Resources', size: 'md',
    route: 'resources-v2',
    recordId: function (r) { return r._key || r.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true, group: 'Overview', get: resName },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true,
        get: function (r) { return cap(typeOf(r)) || '—'; } },
      { name: 'subType', label: 'Sub-type', type: 'text', list: true, readOnly: true,
        get: function (r) { return (r && r.subType) || '—'; } },
      { name: 'capacity', label: 'Capacity', type: 'number', list: true, readOnly: true, align: 'right',
        get: function (r) { return capacityOf(r); } },
      { name: 'classCount', label: 'Classes', type: 'number', list: true, readOnly: true, align: 'right', sortable: true,
        get: function (r) { return classesFor(r).length; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'inactive'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, r) {
        var classes = classesFor(r);
        var cp = capacityOf(r);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(r)] || 'Active', STATUS_TONE[statusOf(r)] || 'neutral'), hero: true },
          { k: 'Type', v: typeOf(r) ? UI.badge(cap(typeOf(r)), TYPE_TONE[typeOf(r)] || 'neutral') : '—' },
          { k: 'Capacity', v: cp == null ? '—' : N.count(cp) },
          { k: 'Classes', v: N.count(classes.length) }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'classes', label: 'Classes' }
        ], 'ov');

        // Overview — identity + details (mirrors legacy Basic Info / Details).
        var overview = UI.kv([
          { k: 'Name', v: esc(resName(r)) },
          { k: 'Type', v: typeOf(r) ? UI.badge(cap(typeOf(r)), TYPE_TONE[typeOf(r)] || 'neutral') : '—' },
          { k: 'Sub-type', v: r.subType ? esc(r.subType) : '—' },
          { k: 'Capacity', v: cp == null ? '—' : N.count(cp) },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(r)] || 'Active', STATUS_TONE[statusOf(r)] || 'neutral') }
        ]);
        var descBody = r.description
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(r.description) + '</div>'
          : '<span class="mu-sub">No description.</span>';
        var notesBody = r.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(r.notes) + '</div>'
          : '<span class="mu-sub">No internal notes.</span>';
        // Resource editing stays on legacy #resources. Use navigateToClassic so
        // the V2 route remap doesn't loop us back to this twin.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="ResourcesV2.classic()">Manage in classic view →</button></div>';

        // Classes — active first, then other (mirrors legacy detail grouping).
        var active = classes.filter(function (c) { return c.status === 'active'; });
        var other = classes.filter(function (c) { return c.status !== 'active'; });
        function classCols() {
          return [
            { label: 'Class', render: function (c) { return esc(c.name || '—'); } },
            { label: 'Type', render: function (c) { return c.type ? '<span class="mu-sub">' + esc(c.type) + '</span>' : '<span class="mu-sub">—</span>'; } },
            { label: 'Status', render: function (c) { return UI.badge(c.status || '—', c.status === 'active' ? 'success' : 'neutral'); } }
          ];
        }
        var classesBody;
        if (!classes.length) {
          classesBody = '<span class="mu-sub">No classes book this resource.</span>';
        } else {
          classesBody = '';
          if (active.length) classesBody += '<div class="mu-sub" style="margin:0 0 6px;">Active (' + active.length + ')</div>' + UI.relatedTable(classCols(), active);
          if (other.length) classesBody += '<div class="mu-sub" style="margin:' + (active.length ? '14px' : '0') + ' 0 6px;">Other (' + other.length + ')</div>' + UI.relatedTable(classCols(), other);
        }

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Details', overview) +
            UI.card('Description', descBody) +
            UI.card('Internal notes', notesBody + manage) +
          '</div>' +
          '<div class="mu-pane" data-pane="classes" hidden>' + UI.cardTable('Classes (' + classes.length + ')', classesBody) + '</div>';
      }
    }
    // No onSave → no Edit button (resource editing stays on legacy #resources).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, classes: [], sortKey: 'name', sortDir: 'asc', q: '', typeFilter: 'all', statusFilter: 'all', loaded: false };

  function load() {
    // Resources + classes (for the Classes facet/count) load together; both
    // one-shot keyed-object reads.
    Promise.all([
      Promise.resolve(MastDB.get('admin/resources')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/classes')).catch(function () { return null; })
    ]).then(function (res) {
      var rv = res[0] || {}, cv = res[1] || {};
      var out = [];
      Object.keys(rv).forEach(function (k) {
        var r = rv[k];
        if (r && typeof r === 'object') { r = Object.assign({ _key: k }, r); r.status = r.status || 'active'; out.push(r); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (x) { V2.byId[x._key] = x; });
      V2.classes = Object.keys(cv).map(function (k) { var c = cv[k] || {}; c.id = c.id || k; return c; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[resources-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.typeFilter !== 'all') rows = rows.filter(function (r) { return typeOf(r) === V2.typeFilter; });
    if (V2.statusFilter !== 'all') rows = rows.filter(function (r) { return statusOf(r) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return String(resName(r)).toLowerCase().indexOf(q) >= 0 ||
               String((r && r.subType) || '').toLowerCase().indexOf(q) >= 0 ||
               String(typeOf(r)).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('resources-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('resourcesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'resourcesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var typeFilters = [['all', 'All types'], ['room', 'Rooms'], ['equipment', 'Equipment']]
      .map(function (f) {
        var on = V2.typeFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ResourcesV2.filterType(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    var statusFilters = [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ResourcesV2.filterStatus(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Resources',
        count: N.count(V2.rows.length) + ' resource' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-secondary" onclick="ResourcesV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + typeFilters + '<span style="width:10px;"></span>' + statusFilters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, sub-type or type…" value="' + esc(V2.q) +
        '" oninput="ResourcesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('resources-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ResourcesV2.sort', onRowClickFnName: 'ResourcesV2.open',
        empty: { title: 'No resources', message: V2.loaded ? 'Add rooms and equipment in the classic Resources view.' : 'Loading…' }
      });
  }

  window.ResourcesV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = ((key === 'classCount' || key === 'capacity') ? 'desc' : 'asc'); }
      render();
    },
    filterType: function (f) { V2.typeFilter = f; render(); },
    filterStatus: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('resources-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('resources-v2', rec, 'read');
      });
    },
    // Resource editing → classic Resources view. Use navigateToClassic so the
    // V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('resources');
      else if (typeof navigateTo === 'function') navigateTo('resources');
    },
    exportCsv: function () { return MastEntity.exportRows('resources-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('resources-v2', {
    routes: { 'resources-v2': { tab: 'resourcesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
