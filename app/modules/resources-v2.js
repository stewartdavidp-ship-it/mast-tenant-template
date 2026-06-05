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
 * Create + edit are NATIVE here: a custom detail.editRender (the Basic Info /
 * Details / Internal Notes field set, grouped like the legacy form) + an onSave
 * that DELEGATES to window.ResourcesBridge (exposed in book.js, the module that
 * owns resource CRUD) so the resource write stays single-sourced — this twin
 * never reimplements that logic (mirrors the contacts-v2 / ContactsBridge and
 * instructors / InstructorsBridge precedent). No classic view is maintained.
 * Flag-gated (?ui=1) at #resources-v2, side-by-side.
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
  // Mirror book.js RESOURCE_TYPES (the legacy showResourceForm type options).
  var RESOURCE_TYPES = ['room', 'equipment'];

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
      { name: 'name', label: 'Name', type: 'text', list: true, required: true, group: 'Overview', get: resName },
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
            UI.card('Internal notes', notesBody) +
          '</div>' +
          '<div class="mu-pane" data-pane="classes" hidden>' + UI.cardTable('Classes (' + classes.length + ')', classesBody) + '</div>';
      },
      // Native edit form — mirrors the legacy showResourceForm field set, grouped
      // (Basic Info / Details / Internal Notes): name (required), type (required,
      // room/equipment), status, sub-type, capacity, description, notes.
      editRender: function (r, mode) {
        r = r || {};
        var typeOpts = RESOURCE_TYPES.map(function (t) {
          return '<option value="' + t + '"' + (typeOf(r) === t ? ' selected' : '') + '>' + cap(t) + '</option>';
        }).join('');
        var statusOpts = ['active', 'inactive'].map(function (s) {
          return '<option value="' + s + '"' + (statusOf(r) === s ? ' selected' : '') + '>' + cap(s) + '</option>';
        }).join('');
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New resource' : 'Edit this resource') + '</div>' +
          fg('Name *', '<input class="form-input" id="resV2Name" value="' + esc(r.name || '') + '" style="width:100%;" placeholder="e.g. Main Studio, Kiln #1">') +
          row2(
            fg('Type *', '<select class="form-input" id="resV2Type" style="width:100%;">' + typeOpts + '</select>', true),
            fg('Status', '<select class="form-input" id="resV2Status" style="width:100%;">' + statusOpts + '</select>', true)
          ) +
          row2(
            fg('Sub-type', '<input class="form-input" id="resV2SubType" value="' + esc(r.subType || '') + '" style="width:100%;" placeholder="e.g. Kiln, Pottery Wheel">', true),
            fg('Capacity', '<input class="form-input" type="number" min="0" id="resV2Capacity" value="' + (capacityOf(r) == null ? '' : capacityOf(r)) + '" style="width:100%;" placeholder="Max students">', true)
          ) +
          fg('Description', '<textarea class="form-input" id="resV2Desc" rows="2" style="width:100%;resize:vertical;" placeholder="What is this resource used for?">' + esc(r.description || '') + '</textarea>') +
          fg('Internal notes', '<textarea class="form-input" id="resV2Notes" rows="2" style="width:100%;resize:vertical;" placeholder="Admin-only notes…">' + esc(r.notes || '') + '</textarea>');
      }
    },
    onSave: function (rec, mode) {
      if (!window.ResourcesBridge) { if (window.showToast) showToast('Resources engine still loading — try again', true); return false; }
      var capRaw = ((document.getElementById('resV2Capacity') || {}).value || '').trim();
      var data = {
        name: (document.getElementById('resV2Name') || {}).value || '',
        type: (document.getElementById('resV2Type') || {}).value || RESOURCE_TYPES[0],
        status: (document.getElementById('resV2Status') || {}).value || 'active',
        subType: ((document.getElementById('resV2SubType') || {}).value || '').trim() || null,
        capacity: capRaw === '' ? null : (parseInt(capRaw, 10) || null),
        description: ((document.getElementById('resV2Desc') || {}).value || '').trim() || null,
        notes: ((document.getElementById('resV2Notes') || {}).value || '').trim() || null
      };
      if (!data.name.trim()) { if (window.showToast) showToast('Resource name is required.', true); return false; }

      if (mode === 'create') {
        return Promise.resolve(window.ResourcesBridge.create(data)).then(function () {
          if (window.showToast) showToast('Resource created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[resources-v2] create', e); if (window.showToast) showToast('Error saving resource.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.ResourcesBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, data);
        if (window.showToast) showToast('Resource updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[resources-v2] update', e); if (window.showToast) showToast('Error updating resource.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, classes: [], sortKey: 'name', sortDir: 'asc', q: '', typeFilter: 'all', statusFilter: 'all', loaded: false };

  function load() {
    // Ensure the legacy book module is loaded so window.ResourcesBridge (the
    // delegated write path) exists — mirrors contacts-v2 / ContactsBridge.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
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
  function reloadSoon() { V2.loaded = false; setTimeout(load, 250); }   // let the legacy write settle, then refresh

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
        actionsHtml: '<button class="btn btn-primary" onclick="ResourcesV2.create()">+ New resource</button>' +
          '<button class="btn btn-secondary" onclick="ResourcesV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + typeFilters + '<span style="width:10px;"></span>' + statusFilters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, sub-type or type…" value="' + esc(V2.q) +
        '" oninput="ResourcesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('resources-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ResourcesV2.sort', onRowClickFnName: 'ResourcesV2.open',
        empty: { title: 'No resources', message: V2.loaded ? 'Add a room or piece of equipment to get started.' : 'Loading…' }
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
    create: function () {
      // Ensure the legacy book module (and thus window.ResourcesBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
      MastEntity.openRecord('resources-v2', {}, 'create');
    },
    exportCsv: function () { return MastEntity.exportRows('resources-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('resources-v2', {
    routes: { 'resources-v2': { tab: 'resourcesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
