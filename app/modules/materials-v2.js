/**
 * materials-v2.js — conversion #6 of the slide-out backlog (doc 17 §11/§12).
 *
 * Legacy maker.js manages materials with an inline edit + a fixed-position modal
 * (openMaterialModal). This re-hosts the materials list + detail on the Entity
 * Engine: a schema-driven list + a Faceted Record slide-out with custom read/edit
 * interiors (the PR-114 detail.render / detail.editRender hooks).
 *
 * Variant (doc 17 §1a): a material has related collections (cost history, the
 * recipes that use it) but no governed lifecycle (status active/archived is an
 * assigned attribute) → Faceted Record.
 *
 * Writes DELEGATE to window.MakerMaterialsBridge (exposed in maker.js) so the
 * cost-history append, dual-basis (bookCost/replacementCost) sync, and
 * recipes-dirty recompute stay single-sourced — the twin never reimplements that
 * domain logic. The spot-pricing config (spot-linked metal/purity/markup), the
 * landed-cost helper and purchase-UOM conversion are advanced setup that stays on
 * legacy #materials; this twin edits the common fields (a partial update
 * preserves the rest). Flag-gated (?ui=1) at #materials-v2, side-by-side.
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
  var UOM_OPTIONS = [
    { value: 'dwt', label: 'DWT (pennyweight)' }, { value: 'carat', label: 'Carat' }, { value: 'gram', label: 'Gram' },
    { value: 'count', label: 'Count (each)' }, { value: 'inch', label: 'Inch' }, { value: 'foot', label: 'Foot' },
    { value: 'oz', label: 'Ounce (oz)' }, { value: 'sqin', label: 'Square Inch' }, { value: 'ml', label: 'Milliliter' }, { value: 'each', label: 'Each' }
  ];
  var UOM_LABEL = {}; UOM_OPTIONS.forEach(function (o) { UOM_LABEL[o.value] = o.label; });

  function num(v) { return (v == null || v === '') ? null : (isNaN(Number(v)) ? null : Number(v)); }

  // ── schema (Faceted Record) ─────────────────────────────────────────
  MastEntity.define('materials-v2', {
    label: 'Material', labelPlural: 'Materials', size: 'lg',
    route: 'materials-v2',
    recordId: function (m) { return m._key || m.materialId || m.id; },
    fields: [
      { name: 'name', label: 'Name', type: 'text', list: true, required: true, group: 'Material' },
      { name: 'category', label: 'Category', type: 'text', list: true, readOnly: true, get: function (m) { return m.category || '—'; } },
      { name: 'unitCost', label: 'Unit cost', type: 'money', list: true, readOnly: true, get: function (m) { return m.unitCost || 0; } },
      { name: 'onHand', label: 'On hand', type: 'number', list: true, readOnly: true, get: function (m) { return m.onHandQty || 0; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'archived'], tone: function (v) { return v === 'archived' ? 'neutral' : 'success'; } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, m) {
        var uses = (V2.usage[m._key] || []);
        var tiles = UI.tiles([
          { k: 'Unit cost', v: N.money(m.unitCost || 0) || '$0.00', hero: true },
          { k: 'On hand', v: (m.onHandQty != null ? (m.onHandQty + (m.unitOfMeasure ? ' ' + esc(m.unitOfMeasure) : '')) : '—') },
          { k: 'Reorder at', v: (m.reorderThreshold != null && m.reorderThreshold !== 0) ? esc(String(m.reorderThreshold)) : '—' },
          { k: 'Used in', v: N.count(uses.length) + ' recipe' + (uses.length === 1 ? '' : 's') }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'cost', label: 'Cost history' }, { key: 'recipes', label: 'Recipes' }], 'ov');

        var costing = UI.kv([
          { k: 'Unit cost', v: N.money(m.unitCost || 0) || '$0.00' },
          { k: 'Pricing mode', v: m.pricingMode === 'spot-linked' ? 'Spot-linked' : 'Fixed' },
          { k: 'Book cost', v: m.bookCost != null ? (N.money(m.bookCost) || '$0.00') : '—' },
          { k: 'Replacement cost', v: m.replacementCost != null ? (N.money(m.replacementCost) || '$0.00') : '—' },
          { k: 'Unit of measure', v: m.unitOfMeasure ? esc(UOM_LABEL[m.unitOfMeasure] || m.unitOfMeasure) : '—' }
        ]);
        var stock = UI.kv([
          { k: 'On hand', v: m.onHandQty != null ? esc(String(m.onHandQty)) : '—' },
          { k: 'Reorder threshold', v: m.reorderThreshold != null ? esc(String(m.reorderThreshold)) : '—' },
          { k: 'Reorder qty', v: m.reorderQty != null ? esc(String(m.reorderQty)) : '—' },
          { k: 'Lead time', v: m.leadTimeDays != null ? (m.leadTimeDays + ' days') : '—' }
        ]);
        var vendor = UI.kv([
          { k: 'Vendor SKU', v: m.vendorSku ? esc(m.vendorSku) : '—' },
          { k: 'Notes', v: m.notes ? esc(m.notes) : '—' }
        ]);
        var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">' +
          (m.status !== 'archived' ? '<button class="btn btn-secondary" onclick="MaterialsV2.archive(\'' + esc(m._key) + '\')">Archive</button>' : '') +
          '<button class="btn btn-secondary" onclick="MaterialsV2.classic()">Spot pricing / landed cost in classic view →</button>' +
          '</div>';

        var hist = (m.costHistory || []).slice().reverse().map(function (h) {
          return { label: (N.money(h.cost) || '$0.00') + (h.changedBy ? ' · ' + esc(h.changedBy === 'legacy' ? 'migrated' : (h.changedBy.indexOf('@') >= 0 ? h.changedBy : 'edit')) : ''), at: h.changedAt ? N.date(h.changedAt) : '', done: true };
        });
        var histBody = hist.length
          ? UI.timeline([{ label: 'Current · ' + (N.money(m.unitCost || 0) || '$0.00'), at: m.costChangedAt ? N.date(m.costChangedAt) : '', done: true }].concat(hist))
          : '<span class="mu-sub">No price changes recorded yet (' + (N.money(m.unitCost || 0) || '$0.00') + ' current).</span>';

        var recipesBody = uses.length
          ? UI.relatedTable([{ label: 'Recipe', render: function (r) { return esc(r.name); } }, { label: 'Status', render: function (r) { return UI.badge(r.status || 'active', r.status === 'archived' ? 'neutral' : 'success'); } }], uses)
          : '<span class="mu-sub">Not used in any recipe.</span>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Costing', costing) + UI.card('Stock', stock) + UI.card('Vendor & notes', vendor + actions) + '</div>' +
          '<div class="mu-pane" data-pane="cost" hidden>' + UI.card('Cost history', histBody) + '</div>' +
          '<div class="mu-pane" data-pane="recipes" hidden>' + UI.cardTable('Used in recipes (' + uses.length + ')', recipesBody) + '</div>';
      },
      editRender: function (m, mode) {
        m = m || {};
        var catSet = {}; V2.rows.forEach(function (x) { if (x.category) catSet[x.category] = true; }); if (m.category) catSet[m.category] = true;
        var catOpts = '<option value="">Select category</option>' + Object.keys(catSet).sort().map(function (c) {
          return '<option value="' + esc(c) + '"' + (m.category === c ? ' selected' : '') + '>' + esc(c) + '</option>';
        }).join('');
        var uomOpts = UOM_OPTIONS.map(function (o) { return '<option value="' + esc(o.value) + '"' + (m.unitOfMeasure === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
        var statusOpts = ['active', 'archived'].map(function (s) { return '<option value="' + s + '"' + ((m.status || 'active') === s ? ' selected' : '') + '>' + s + '</option>'; }).join('');
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }

        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New material' : 'Edit this material') + '</div>' +
          fg('Name *', '<input class="form-input" id="matV2Name" value="' + esc(m.name || '') + '" style="width:100%;" placeholder="e.g. 14K Gold Wire">') +
          row2(
            fg('Category', '<select class="form-input" id="matV2Category" style="width:100%;">' + catOpts + '</select>', true),
            fg('Unit of measure', '<select class="form-input" id="matV2Uom" style="width:100%;">' + uomOpts + '</select>', true)
          ) +
          row2(
            fg('Unit cost ($)', '<input class="form-input" type="number" step="0.01" min="0" id="matV2Cost" value="' + (m.unitCost != null ? esc(m.unitCost) : '') + '" style="width:100%;" placeholder="0.00">', true),
            fg('On hand', '<input class="form-input" type="number" step="0.01" min="0" id="matV2OnHand" value="' + (m.onHandQty != null ? esc(m.onHandQty) : '') + '" style="width:100%;" placeholder="0">', true)
          ) +
          row2(
            fg('Reorder threshold', '<input class="form-input" type="number" step="0.01" min="0" id="matV2ReorderThreshold" value="' + (m.reorderThreshold != null ? esc(m.reorderThreshold) : '') + '" style="width:100%;">', true),
            fg('Reorder qty', '<input class="form-input" type="number" step="0.01" min="0" id="matV2ReorderQty" value="' + (m.reorderQty != null ? esc(m.reorderQty) : '') + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Vendor SKU', '<input class="form-input" id="matV2VendorSku" value="' + esc(m.vendorSku || '') + '" style="width:100%;">', true),
            fg('Lead time (days)', '<input class="form-input" type="number" step="1" min="0" id="matV2LeadTime" value="' + (m.leadTimeDays != null ? esc(m.leadTimeDays) : '') + '" style="width:100%;">', true)
          ) +
          (mode === 'create' ? '' : fg('Status', '<select class="form-input" id="matV2Status" style="width:100%;">' + statusOpts + '</select>')) +
          fg('Notes', '<textarea class="form-input" id="matV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(m.notes || '') + '</textarea>') +
          (m.pricingMode === 'spot-linked' ? '<div class="mu-sub" style="margin-top:6px;">⚡ Spot-linked — replacement cost is auto-managed by the spot-price job. Edit spot config in the classic view.</div>' : '');
      }
    },
    onSave: function (rec, mode) {
      if (!window.MakerMaterialsBridge) { if (window.showToast) showToast('Materials engine still loading — try again', true); return false; }
      var data = {
        name: (document.getElementById('matV2Name') || {}).value || '',
        category: (document.getElementById('matV2Category') || {}).value || '',
        unitOfMeasure: (document.getElementById('matV2Uom') || {}).value || 'each',
        unitCost: num((document.getElementById('matV2Cost') || {}).value) || 0,
        onHandQty: num((document.getElementById('matV2OnHand') || {}).value) || 0,
        reorderThreshold: num((document.getElementById('matV2ReorderThreshold') || {}).value) || 0,
        reorderQty: num((document.getElementById('matV2ReorderQty') || {}).value) || 0,
        vendorSku: (document.getElementById('matV2VendorSku') || {}).value || null,
        leadTimeDays: num((document.getElementById('matV2LeadTime') || {}).value),
        notes: (document.getElementById('matV2Notes') || {}).value || ''
      };
      if (!data.name.trim()) { if (window.showToast) showToast('Name is required', true); return false; }
      var statusEl = document.getElementById('matV2Status');
      if (statusEl) data.status = statusEl.value;

      if (mode === 'create') {
        return Promise.resolve(window.MakerMaterialsBridge.create(data)).then(function () {
          if (window.showToast) showToast('Material created'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[materials-v2] create', e); if (window.showToast) showToast('Create failed', true); return false; });
      }
      var id = rec._key || rec.materialId || rec.id;
      return Promise.resolve(window.MakerMaterialsBridge.update(id, data)).then(function () {
        Object.assign(rec, data);   // fresh read re-render
        if (window.showToast) showToast('Material updated'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[materials-v2] update', e); if (window.showToast) showToast('Update failed', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, usage: {}, sortKey: 'name', sortDir: 'asc', q: '', showArchived: false, loaded: false };

  function buildUsage(materials, recipes) {
    var usage = {};
    materials.forEach(function (m) { usage[m._key] = []; });
    Object.keys(recipes || {}).forEach(function (rid) {
      var r = recipes[rid]; if (!r || typeof r !== 'object') return;
      var li = r.lineItems || {};
      var seen = {};
      Object.keys(li).forEach(function (k) {
        var mid = li[k] && li[k].materialId;
        if (mid && usage[mid] && !seen[mid]) { seen[mid] = 1; usage[mid].push({ name: r.name || rid, status: r.status || 'active' }); }
      });
    });
    return usage;
  }

  function load() {
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('maker'); } catch (e) {} } // ensure the bridge + caches
    Promise.all([
      Promise.resolve(MastDB.get('admin/materials')),
      Promise.resolve(MastDB.recipes ? MastDB.recipes.list(200) : null)
    ]).then(function (res) {
      var matVal = res[0] || {};
      var recSnap = res[1]; var recipes = (recSnap && typeof recSnap.val === 'function') ? recSnap.val() : (recSnap || {});
      var out = [];
      Object.keys(matVal).forEach(function (k) {
        var m = matVal[k]; if (m && typeof m === 'object') { m = Object.assign({ _key: k }, m); m.status = m.status || 'active'; out.push(m); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.usage = buildUsage(out, recipes);
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[materials-v2] load', e); render(); });
  }
  function reloadSoon() { setTimeout(load, 250); }   // let the legacy write + listener settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (!V2.showArchived) rows = rows.filter(function (m) { return m.status !== 'archived'; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (m) { return String(m.name || '').toLowerCase().indexOf(q) >= 0 || String(m.category || '').toLowerCase().indexOf(q) >= 0; });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('materials-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('materialsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'materialsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var active = V2.rows.filter(function (m) { return m.status !== 'archived'; }).length;
    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Materials</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + N.count(active) + ' active · ' + N.count(V2.rows.length) + ' total</span>' +
        '<button class="btn btn-primary" style="margin-left:auto;" onclick="MaterialsV2.create()">+ New Material</button>' +
        '<button class="btn btn-secondary" onclick="MaterialsV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="display:flex;gap:12px;align-items:center;margin:12px 0;flex-wrap:wrap;">' +
        '<input class="form-input" placeholder="Search name or category…" value="' + esc(V2.q) + '" oninput="MaterialsV2.search(this.value)" style="max-width:320px;font-size:0.9rem;">' +
        '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--warm-gray);cursor:pointer;"><input type="checkbox" onchange="MaterialsV2.toggleArchived(this.checked)"' + (V2.showArchived ? ' checked' : '') + '> Show archived</label>' +
      '</div>' +
      MastEntity.renderList('materials-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'MaterialsV2.sort', onRowClickFnName: 'MaterialsV2.open',
        empty: { title: 'No materials', message: V2.loaded ? 'Add a material to start tracking costs.' : 'Loading…' }
      });
  }

  window.MaterialsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'unitCost' || key === 'onHand' ? 'desc' : 'asc'); }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    toggleArchived: function (on) { V2.showArchived = !!on; render(); },
    open: function (id) {
      MastEntity.get('materials-v2').fetch(id).then(function (rec) { if (rec) MastEntity.openRecord('materials-v2', rec, 'read'); });
    },
    create: function () {
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('maker'); } catch (e) {} }
      MastEntity.openRecord('materials-v2', {}, 'create');
    },
    archive: function (id) {
      var m = V2.byId[id]; if (!m) return;
      var msg = 'Archive “' + (m.name || 'material') + '”? It will be hidden from active lists (you can show archived to find it).';
      (typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'Archive material', confirmLabel: 'Archive' }) : Promise.resolve(true)).then(function (ok) {
        if (!ok || !window.MakerMaterialsBridge) return;
        Promise.resolve(window.MakerMaterialsBridge.archive(id)).then(function () {
          if (window.showToast) showToast('Material archived'); U.slideOut.requestCloseForce(); reloadSoon();
        }).catch(function (e) { console.error('[materials-v2] archive', e); if (window.showToast) showToast('Archive failed', true); });
      });
    },
    classic: function () { if (typeof navigateTo === 'function') navigateTo('materials'); },
    exportCsv: function () { return MastEntity.exportRows('materials-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('materials-v2', {
    routes: { 'materials-v2': { tab: 'materialsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
