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
 * domain logic. The per-material spot-pricing config (mode / metal / purity /
 * markup) is now edited natively here — onSave delegates it to the bridge, which
 * carries pricingMode/spotMetal to updateMaterial (the spot-linked rule:
 * replacementCost stays auto-managed by the daily spot job, never written here).
 * The three remaining V1-only material-cost tools are now native here too —
 * purchase-UOM conversion factor (edit form), landed-cost proration (edit-form
 * allocator), and materials CSV import (3-step wizard) — all single-sourced
 * through MakerMaterialsBridge so V1/V2 write identically (the bridge wraps the
 * legacy proration math, the CSV parser/mapper, and the import writer). The
 * "→ classic" escape hatch is gone. Flag-gated (?ui=1) at #materials-v2.
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
  var SPOT_METALS = ['gold', 'silver', 'platinum'];   // mirror legacy maker.js options

  function num(v) { return (v == null || v === '') ? null : (isNaN(Number(v)) ? null : Number(v)); }
  // RBAC: materials reuses the legacy 'materials' permission route (the V2 twin
  // re-homes the same object). Gate every write handler — create/edit/archive/import.
  function canEdit() { return (typeof window.can === 'function') ? window.can('materials', 'edit') : true; }

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
          { k: 'Unit of measure', v: m.unitOfMeasure ? esc(UOM_LABEL[m.unitOfMeasure] || m.unitOfMeasure) : '—' },
          { k: 'Purchase UOM', v: m.purchaseUOM ? esc(UOM_LABEL[m.purchaseUOM] || m.purchaseUOM) : '—' },
          { k: 'Conversion factor', v: (m.conversionFactor != null && m.conversionFactor !== 0) ? esc(String(m.conversionFactor)) + ' ' + (m.unitOfMeasure ? esc(m.unitOfMeasure) : 'units') + ' / purchase unit' : '—' }
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
        var purchaseUomOpts = '<option value="">Same as stock UOM</option>' + UOM_OPTIONS.map(function (o) { return '<option value="' + esc(o.value) + '"' + (m.purchaseUOM === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
        var statusOpts = ['active', 'archived'].map(function (s) { return '<option value="' + s + '"' + ((m.status || 'active') === s ? ' selected' : '') + '>' + s + '</option>'; }).join('');
        var isSpot = m.pricingMode === 'spot-linked';
        var modeOpts = [{ v: 'fixed', l: 'Fixed (manual unit cost)' }, { v: 'spot-linked', l: 'Spot-linked (daily metals market)' }]
          .map(function (o) { return '<option value="' + o.v + '"' + ((isSpot ? 'spot-linked' : 'fixed') === o.v ? ' selected' : '') + '>' + o.l + '</option>'; }).join('');
        var metalOpts = SPOT_METALS.map(function (mt) { return '<option value="' + mt + '"' + (m.spotMetal === mt ? ' selected' : '') + '>' + (mt.charAt(0).toUpperCase() + mt.slice(1)) + '</option>'; }).join('');
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }

        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New material' : 'Edit this material') + '</div>' +
          fg('Name *', '<input class="form-input" id="matV2Name" value="' + esc(m.name || '') + '" style="width:100%;" placeholder="e.g. 14K Gold Wire">') +
          row2(
            fg('Category', '<select class="form-input" id="matV2Category" style="width:100%;">' + catOpts + '</select>', true),
            fg('Unit of measure', '<select class="form-input" id="matV2Uom" style="width:100%;">' + uomOpts + '</select>', true)
          ) +
          fg('Pricing mode', '<select class="form-input" id="matV2PricingMode" style="width:100%;" onchange="MaterialsV2.toggleSpot(this.value)">' + modeOpts + '</select>') +
          row2(
            // Fixed: editable unit cost. Spot-linked: read-only (auto-managed by the spot job).
            '<div id="matV2CostFixed" class="form-group" style="flex:1;min-width:150px;display:' + (isSpot ? 'none' : 'block') + ';"><label class="form-label">Unit cost ($)</label><input class="form-input" type="number" step="0.01" min="0" id="matV2Cost" value="' + (m.unitCost != null ? esc(m.unitCost) : '') + '" style="width:100%;" placeholder="0.00"></div>' +
            '<div id="matV2CostSpot" class="form-group" style="flex:1;min-width:150px;display:' + (isSpot ? 'block' : 'none') + ';"><label class="form-label">Unit cost (auto)</label><input class="form-input" type="number" value="' + (m.unitCost != null ? esc(m.unitCost) : '') + '" style="width:100%;" disabled></div>' +
            fg('On hand', '<input class="form-input" type="number" step="0.01" min="0" id="matV2OnHand" value="' + (m.onHandQty != null ? esc(m.onHandQty) : '') + '" style="width:100%;" placeholder="0">', true)
          ) +
          '<div id="matV2SpotFields" style="display:' + (isSpot ? 'block' : 'none') + ';">' +
            row2(
              fg('Spot metal', '<select class="form-input" id="matV2SpotMetal" style="width:100%;">' + metalOpts + '</select>', true),
              fg('Purity (fraction)', '<input class="form-input" type="number" step="0.001" min="0" max="1" id="matV2Purity" value="' + (m.purity != null ? esc(m.purity) : '') + '" style="width:100%;" placeholder="e.g. 0.585 (14k)">', true)
            ) +
            fg('Markup over spot (%)', '<input class="form-input" type="number" step="0.1" min="0" id="matV2Markup" value="' + (m.markupOverSpot != null ? esc(m.markupOverSpot) : '') + '" style="width:100%;" placeholder="e.g. 8">') +
            '<div class="mu-sub" style="margin-top:6px;">⚡ Auto-managed daily: spot × purity × (1 + markup%). Unit cost &amp; replacement cost are set by the spot-price job — not from this form.</div>' +
          '</div>' +
          // Landed-cost proration (fixed pricing only — spot unit cost is auto-managed).
          // Allocates a freight/customs/fees charge across the qty it covers and adds
          // the per-unit share onto Unit cost above (committed on Save). Single-sourced
          // through MakerMaterialsBridge.prorateLandedCost.
          '<details id="matV2LandedBox" style="margin:2px 0 6px;border:1px solid var(--cream-dark);border-radius:6px;display:' + (isSpot ? 'none' : 'block') + ';">' +
            '<summary style="cursor:pointer;padding:8px 12px;font-size:0.85rem;font-weight:600;">+ Apply landed cost (freight, customs)</summary>' +
            '<div style="padding:0 12px 12px;">' +
              '<div class="mu-sub" style="margin:4px 0 10px;">Add freight, customs, or supplier fees to your unit cost. Enter the extra charge and the qty it covers — we prorate per unit and update Unit cost above.</div>' +
              '<div style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;">' +
                '<div class="form-group" style="flex:1;min-width:120px;margin:0;"><label class="form-label">Extra charge ($)</label><input class="form-input" type="number" step="0.01" min="0" id="matV2LandedExtra" style="width:100%;" placeholder="e.g. 25.00"></div>' +
                '<div class="form-group" style="flex:1;min-width:120px;margin:0;"><label class="form-label">Qty covered</label><input class="form-input" type="number" step="0.01" min="0" id="matV2LandedQty" style="width:100%;" placeholder="e.g. 100"></div>' +
                '<button type="button" class="btn btn-secondary" onclick="MaterialsV2.applyLanded()">Apply</button>' +
              '</div>' +
            '</div>' +
          '</details>' +
          // Purchase UOM → stock UOM conversion. A material bought by the case but
          // stocked by the unit costs correctly when the conversion factor is set.
          row2(
            fg('Purchase UOM', '<select class="form-input" id="matV2PurchaseUom" style="width:100%;">' + purchaseUomOpts + '</select>', true),
            fg('Conversion factor', '<input class="form-input" type="number" step="0.0001" min="0" id="matV2ConvFactor" value="' + (m.conversionFactor != null && m.conversionFactor !== 0 ? esc(m.conversionFactor) : '') + '" style="width:100%;" placeholder="e.g. 20 (1 oz = 20 dwt)">', true)
          ) +
          '<div class="mu-sub" style="margin:-6px 0 8px;">How many stock units come in one purchase unit (leave blank if you buy &amp; stock in the same UOM).</div>' +
          row2(
            fg('Reorder threshold', '<input class="form-input" type="number" step="0.01" min="0" id="matV2ReorderThreshold" value="' + (m.reorderThreshold != null ? esc(m.reorderThreshold) : '') + '" style="width:100%;">', true),
            fg('Reorder qty', '<input class="form-input" type="number" step="0.01" min="0" id="matV2ReorderQty" value="' + (m.reorderQty != null ? esc(m.reorderQty) : '') + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Vendor SKU', '<input class="form-input" id="matV2VendorSku" value="' + esc(m.vendorSku || '') + '" style="width:100%;">', true),
            fg('Lead time (days)', '<input class="form-input" type="number" step="1" min="0" id="matV2LeadTime" value="' + (m.leadTimeDays != null ? esc(m.leadTimeDays) : '') + '" style="width:100%;">', true)
          ) +
          (mode === 'create' ? '' : fg('Status', '<select class="form-input" id="matV2Status" style="width:100%;">' + statusOpts + '</select>')) +
          fg('Notes', '<textarea class="form-input" id="matV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(m.notes || '') + '</textarea>');
      }
    },
    onSave: function (rec, mode) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit materials', true); return false; }
      if (!window.MakerMaterialsBridge) { if (window.showToast) showToast('Materials engine still loading — try again', true); return false; }
      var data = {
        name: (document.getElementById('matV2Name') || {}).value || '',
        category: (document.getElementById('matV2Category') || {}).value || '',
        unitOfMeasure: (document.getElementById('matV2Uom') || {}).value || 'each',
        onHandQty: num((document.getElementById('matV2OnHand') || {}).value) || 0,
        reorderThreshold: num((document.getElementById('matV2ReorderThreshold') || {}).value) || 0,
        reorderQty: num((document.getElementById('matV2ReorderQty') || {}).value) || 0,
        vendorSku: (document.getElementById('matV2VendorSku') || {}).value || null,
        leadTimeDays: num((document.getElementById('matV2LeadTime') || {}).value),
        notes: (document.getElementById('matV2Notes') || {}).value || ''
      };
      if (!data.name.trim()) { if (window.showToast) showToast('Name is required', true); return false; }

      // Purchase-UOM → stock-UOM conversion factor (so a buy-by-the-case /
      // stock-by-the-unit material costs correctly). Persisted on both create and
      // edit (the bridge → createMaterial/updateMaterial carry these keys).
      var purchaseUom = (document.getElementById('matV2PurchaseUom') || {}).value || '';
      var convFactor = num((document.getElementById('matV2ConvFactor') || {}).value);
      data.purchaseUOM = purchaseUom || null;
      data.conversionFactor = (convFactor != null && convFactor > 0) ? convFactor : null;

      // Pricing mode (per-material spot config). Delegated to the bridge → updateMaterial,
      // which honors the spot-linked rule: replacementCost is auto-managed by the daily
      // spot job, so we never write unitCost/replacementCost for spot-linked here.
      var isSpot = ((document.getElementById('matV2PricingMode') || {}).value) === 'spot-linked';
      if (isSpot) {
        var purity = num((document.getElementById('matV2Purity') || {}).value);
        // Friendly karat auto-correct (mirror legacy maker.js): 14 → 0.583, 24 → 1.
        if (purity != null && purity > 1 && purity <= 24) purity = Math.round((purity / 24) * 1000) / 1000;
        if (!(purity > 0) || purity > 1) {
          if (window.showToast) showToast('Purity must be a fraction between 0 and 1 (e.g. 0.585 for 14k, 0.925 sterling, 0.999 fine)', true);
          return false;
        }
        var markup = num((document.getElementById('matV2Markup') || {}).value);
        data.pricingMode = 'spot-linked';
        data.spotMetal = (document.getElementById('matV2SpotMetal') || {}).value || 'gold';
        data.purity = purity;
        data.markupOverSpot = markup == null ? 0 : markup;
        // No unitCost / replacementCost — the spot-price job owns those for spot-linked.
      } else {
        data.pricingMode = 'fixed';
        data.spotMetal = null;
        data.purity = null;
        data.markupOverSpot = null;
        data.unitCost = num((document.getElementById('matV2Cost') || {}).value) || 0;
      }
      var statusEl = document.getElementById('matV2Status');
      if (statusEl) data.status = statusEl.value;

      if (mode === 'create') {
        return Promise.resolve(window.MakerMaterialsBridge.create(data)).then(function () {
          if (window.showToast) showToast('Material created'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[materials-v2] create', e); if (window.showToast) showToast('Create failed', true); return false; });
      }
      var id = rec._key || rec.materialId || rec.id;
      return Promise.resolve(window.MakerMaterialsBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows the
        // edited fields immediately; reloadSoon() then refreshes server-computed
        // fields (bookCost/costHistory) into the cache for the next open.
        Object.assign(V2.byId[id] || rec, data);
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

  // ── Native CSV import wizard (close V1 makerOpenImport('materials') gap) ────
  // 3 steps (upload → map columns → preview/confirm). Parsing uses PapaParse /
  // SheetJS (already loaded globally, same as legacy). The COLUMN SCHEMA, the
  // per-row MAPPER (sanitize + number coercion + defaults), and the WRITE
  // (status:'draft', importedFrom:'csv' + importLog) all delegate to
  // MakerMaterialsBridge so the import stays single-sourced with the legacy
  // wizard — the twin never reimplements the parse/validate/write logic.
  var Import = (function () {
    var st = null;
    function fields() { return window.MakerMaterialsBridge.importFields(); }
    function open() {
      st = { step: 1, parsedData: null, headers: [], mappings: {}, filename: '', defaultUom: '', defaultCategory: '' };
      render();
    }
    function close() { st = null; if (typeof closeModal === 'function') closeModal(); }
    function setMapping(key, val) { if (!st) return; if (val === '' || val == null) delete st.mappings[key]; else st.mappings[key] = parseInt(val, 10); }
    function setDefault(key, val) { if (st) st[key] = val; }
    function step(dir) {
      if (!st) return;
      if (dir > 0 && st.step === 1 && !st.parsedData) { if (window.showToast) showToast('Upload a file first', true); return; }
      if (dir > 0 && st.step === 2) {
        var missing = fields().filter(function (f) {
          if (!f.required) return false;
          if (st.mappings[f.key] !== undefined) return false;
          if (f.key === 'unitOfMeasure' && st.defaultUom) return false;
          return true;
        });
        if (missing.length) { if (window.showToast) showToast('Map required fields: ' + missing.map(function (f) { return f.label; }).join(', '), true); return; }
      }
      st.step = Math.max(1, Math.min(3, st.step + dir));
      render();
    }
    async function pickFile(input) {
      if (!st) return;
      var file = input && input.files && input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { if (window.showToast) showToast('File must be under 5MB', true); return; }
      st.filename = file.name;
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      function ingest(headers, dataRows) {
        if (!dataRows || dataRows.length < 1) { if (window.showToast) showToast('File has no data rows', true); return; }
        if (dataRows.length > 1000) { if (window.showToast) showToast('Max 1,000 rows allowed. File has ' + dataRows.length, true); return; }
        st.headers = headers.map(function (h) { return String(h); });
        st.parsedData = dataRows.filter(function (row) { return row.some(function (c) { return c !== '' && c != null; }); });
        st.mappings = window.MakerMaterialsBridge.autoDetectImportMappings(st.headers);
        render();
      }
      if (['xlsx', 'xls'].indexOf(ext) >= 0) {
        // SheetJS lazy-loaded on first import use (Track 3).
        try { await window.ensureXlsx(); } catch (err) { if (window.showToast) showToast('Failed to load spreadsheet parser', true); return; }
        var r = new FileReader();
        r.onload = function (e) {
          try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (data.length < 2) { if (window.showToast) showToast('File has no data rows', true); return; }
            ingest(data[0], data.slice(1));
          } catch (err) { if (window.showToast) showToast('Failed to parse file: ' + err.message, true); }
        };
        r.readAsArrayBuffer(file);
      } else {
        // PapaParse lazy-loaded on first import use (Track 3).
        try { await window.ensurePapa(); } catch (err) { if (window.showToast) showToast('Failed to load CSV parser', true); return; }
        Papa.parse(file, {
          complete: function (res) {
            if (!res.data || res.data.length < 2) { if (window.showToast) showToast('File has no data rows', true); return; }
            ingest(res.data[0], res.data.slice(1));
          },
          error: function (err) { if (window.showToast) showToast('Failed to parse CSV: ' + err.message, true); }
        });
      }
    }
    function mappedRows() {
      var defaults = { defaultUom: st.defaultUom, defaultCategory: st.defaultCategory };
      return (st.parsedData || []).map(function (row) { return window.MakerMaterialsBridge.mapImportRow(row, st.mappings, defaults); });
    }
    function run() {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to import materials', true); return; }
      var records = mappedRows();
      var valid = records.filter(function (r) { return r._valid !== false; });
      var btn = document.getElementById('matV2ImportBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
      Promise.resolve(window.MakerMaterialsBridge.importMaterialRecords(valid, st.filename)).then(function (res) {
        if (window.showToast) showToast(res.imported + ' material' + (res.imported === 1 ? '' : 's') + ' imported' + (res.skipped ? ', ' + res.skipped + ' skipped' : ''));
        close(); reloadSoon();
      }).catch(function (e) {
        console.error('[materials-v2] import', e);
        if (window.showToast) showToast('Import failed', true);
        if (btn) { btn.disabled = false; btn.textContent = 'Import'; }
      });
    }
    function steps(cur) {
      var h = '<div style="display:flex;gap:4px;margin:0 0 16px;">';
      for (var s = 1; s <= 3; s++) {
        var bg = s === cur ? 'var(--amber)' : (s < cur ? 'var(--teal)' : 'var(--cream-dark)');
        h += '<div style="flex:1;height:4px;border-radius:2px;background:' + bg + ';"></div>';
      }
      return h + '</div>';
    }
    function renderStep1() {
      var h = '<div style="font-weight:600;margin-bottom:8px;">Step 1 · Upload file</div>';
      h += '<div class="mu-sub" style="margin-bottom:14px;">Upload a .csv or .xlsx file. Max 5MB, 1,000 rows. The first row must be column headers.</div>';
      h += '<div style="border:2px dashed var(--cream-dark);border-radius:8px;padding:26px;text-align:center;">';
      h += '<input type="file" accept=".csv,.xlsx,.xls" onchange="MaterialsV2.importPickFile(this)">';
      h += '</div>';
      if (st.parsedData) {
        h += '<div style="margin-top:14px;font-size:0.85rem;color:var(--teal);font-weight:600;">' + esc(st.filename) + ' — ' + st.parsedData.length + ' rows, ' + st.headers.length + ' columns</div>';
        h += '<div style="overflow-x:auto;margin-top:10px;"><table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>';
        st.headers.forEach(function (hd) { h += '<th style="padding:4px 8px;text-align:left;border-bottom:1px solid var(--cream-dark);font-weight:600;white-space:nowrap;">' + esc(hd) + '</th>'; });
        h += '</tr></thead><tbody>';
        st.parsedData.slice(0, 5).forEach(function (row) {
          h += '<tr>';
          st.headers.forEach(function (hd, i) { h += '<td style="padding:4px 8px;border-bottom:1px solid var(--cream-dark);white-space:nowrap;max-width:150px;overflow:hidden;text-overflow:ellipsis;">' + esc(String(row[i] == null ? '' : row[i])) + '</td>'; });
          h += '</tr>';
        });
        h += '</tbody></table></div>';
      }
      return h;
    }
    function renderStep2() {
      var h = '<div style="font-weight:600;margin-bottom:8px;">Step 2 · Map columns</div>';
      h += '<div class="mu-sub" style="margin-bottom:14px;">Match your file columns to material fields. Auto-detected matches are pre-selected. Required fields are marked *.</div>';
      fields().forEach(function (f) {
        var mapped = st.mappings[f.key];
        var auto = mapped !== undefined;
        h += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;padding:6px 10px;border-radius:6px;background:' + (auto ? 'rgba(42,124,111,0.06)' : 'transparent') + ';">';
        h += '<div style="min-width:150px;font-size:0.85rem;font-weight:500;">' + esc(f.label) + (f.required ? ' *' : '') + '</div>';
        h += '<select class="form-input" onchange="MaterialsV2.importSetMapping(\'' + f.key + '\', this.value)" style="flex:1;">';
        h += '<option value="">— Don\'t import —</option>';
        st.headers.forEach(function (hd, i) { h += '<option value="' + i + '"' + (mapped === i ? ' selected' : '') + '>' + esc(hd) + '</option>'; });
        h += '</select></div>';
      });
      var uomOpts = UOM_OPTIONS.map(function (o) { return '<option value="' + esc(o.value) + '"' + (st.defaultUom === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('');
      h += '<div style="margin-top:14px;padding:10px 12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;">';
      h += '<div style="font-size:0.85rem;font-weight:500;margin-bottom:6px;">Default unit of measure (when not mapped)</div>';
      h += '<select class="form-input" onchange="MaterialsV2.importSetDefault(\'defaultUom\', this.value)"><option value="">—</option>' + uomOpts + '</select></div>';
      h += '<div style="margin-top:10px;padding:10px 12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;">';
      h += '<div style="font-size:0.85rem;font-weight:500;margin-bottom:6px;">Default category (when not mapped)</div>';
      h += '<input class="form-input" type="text" value="' + esc(st.defaultCategory || '') + '" placeholder="e.g. Imported" onchange="MaterialsV2.importSetDefault(\'defaultCategory\', this.value)"></div>';
      return h;
    }
    function renderStep3() {
      var records = mappedRows();
      var valid = [], invalid = 0;
      records.forEach(function (r) { if (r._valid !== false) valid.push(r); else invalid++; });
      var fs = fields().filter(function (f) { return st.mappings[f.key] !== undefined || f.required; });
      var h = '<div style="font-weight:600;margin-bottom:8px;">Step 3 · Preview &amp; confirm</div>';
      h += '<div class="mu-sub" style="margin-bottom:12px;">' + valid.length + ' valid row' + (valid.length === 1 ? '' : 's') + ' ready' + (invalid ? ', ' + invalid + ' will be skipped (missing required fields)' : '') + '. Imported materials land as <strong>draft</strong>.</div>';
      h += '<div style="overflow-x:auto;margin-bottom:14px;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;"><thead><tr>';
      fs.forEach(function (f) { h += '<th style="padding:6px 8px;text-align:left;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;font-weight:600;">' + esc(f.label) + '</th>'; });
      h += '</tr></thead><tbody>';
      valid.slice(0, 10).forEach(function (rec) {
        h += '<tr>';
        fs.forEach(function (f) { h += '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(String(rec[f.key] == null ? '' : rec[f.key])) + '</td>'; });
        h += '</tr>';
      });
      if (valid.length > 10) h += '<tr><td colspan="' + fs.length + '" style="padding:8px;text-align:center;color:var(--warm-gray);font-style:italic;">… and ' + (valid.length - 10) + ' more rows</td></tr>';
      h += '</tbody></table></div>';
      return h;
    }
    function render() {
      if (!st || typeof openModal !== 'function') return;
      var body = st.step === 1 ? renderStep1() : st.step === 2 ? renderStep2() : renderStep3();
      var records = st.step === 3 ? mappedRows() : null;
      var validCount = records ? records.filter(function (r) { return r._valid !== false; }).length : 0;
      var foot = '<div style="display:flex;justify-content:space-between;gap:8px;margin-top:18px;">';
      foot += st.step > 1
        ? '<button class="btn btn-secondary" onclick="MaterialsV2.importStep(-1)">← Back</button>'
        : '<button class="btn btn-secondary" onclick="MaterialsV2.importClose()">Cancel</button>';
      foot += st.step < 3
        ? '<button class="btn btn-primary" onclick="MaterialsV2.importStep(1)">Continue</button>'
        : '<button class="btn btn-primary" id="matV2ImportBtn" onclick="MaterialsV2.importRun()"' + (validCount ? '' : ' disabled') + '>Import ' + validCount + ' material' + (validCount === 1 ? '' : 's') + '</button>';
      foot += '</div>';
      openModal(
        '<div style="max-width:760px;">' +
          '<h2 style="font-size:1.15rem;margin:0 0 12px;">Import materials</h2>' +
          steps(st.step) + body + foot +
        '</div>'
      );
    }
    return { open: open, close: close, render: render, step: step, pickFile: pickFile, setMapping: setMapping, setDefault: setDefault, run: run };
  })();

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
        '<button class="btn btn-secondary" onclick="MaterialsV2.importCsv()">↑ Import CSV</button>' +
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
    toggleSpot: function (mode) {
      var on = mode === 'spot-linked';
      var spotFields = document.getElementById('matV2SpotFields');
      var costFixed = document.getElementById('matV2CostFixed');
      var costSpot = document.getElementById('matV2CostSpot');
      var landedBox = document.getElementById('matV2LandedBox');
      if (spotFields) spotFields.style.display = on ? 'block' : 'none';
      if (costFixed) costFixed.style.display = on ? 'none' : 'block';
      if (costSpot) costSpot.style.display = on ? 'block' : 'none';
      // Landed-cost proration modifies the manual Unit cost input — irrelevant for
      // spot-linked (the spot job owns that cost), so hide it there.
      if (landedBox) landedBox.style.display = on ? 'none' : 'block';
    },
    // Landed-cost proration in the edit form — distribute a freight/customs charge
    // across the qty it covers, then add the per-unit share onto the Unit cost
    // input (committed when the user Saves). Math single-sourced through the bridge.
    applyLanded: function () {
      var costEl = document.getElementById('matV2Cost');
      var extraEl = document.getElementById('matV2LandedExtra');
      var qtyEl = document.getElementById('matV2LandedQty');
      if (!costEl || !extraEl || !qtyEl || !window.MakerMaterialsBridge) return;
      var res;
      try { res = window.MakerMaterialsBridge.prorateLandedCost(parseFloat(costEl.value) || 0, extraEl.value, qtyEl.value); }
      catch (e) { if (window.showToast) showToast(e.message, true); return; }
      costEl.value = res.unitCost;
      extraEl.value = ''; qtyEl.value = '';
      if (window.showToast) showToast('Added $' + res.addPerUnit.toFixed(4) + '/unit — review and Save to commit');
    },
    toggleArchived: function (on) { V2.showArchived = !!on; render(); },
    open: function (id) {
      MastEntity.get('materials-v2').fetch(id).then(function (rec) { if (rec) MastEntity.openRecord('materials-v2', rec, 'read'); });
    },
    create: function () {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to add materials', true); return; }
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('maker'); } catch (e) {} }
      MastEntity.openRecord('materials-v2', {}, 'create');
    },
    archive: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to archive materials', true); return; }
      var m = V2.byId[id]; if (!m) return;
      var msg = 'Archive “' + (m.name || 'material') + '”? It will be hidden from active lists (you can show archived to find it).';
      (typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'Archive material', confirmLabel: 'Archive' }) : Promise.resolve(true)).then(function (ok) {
        if (!ok || !window.MakerMaterialsBridge) return;
        Promise.resolve(window.MakerMaterialsBridge.archive(id)).then(function () {
          if (window.showToast) showToast('Material archived'); U.slideOut.requestCloseForce(); reloadSoon();
        }).catch(function (e) { console.error('[materials-v2] archive', e); if (window.showToast) showToast('Archive failed', true); });
      });
    },
    importCsv: function () {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to import materials', true); return; }
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('maker'); } catch (e) {} }
      if (!window.MakerMaterialsBridge || typeof window.MakerMaterialsBridge.importMaterialRecords !== 'function') {
        if (window.showToast) showToast('Materials engine still loading — try again', true); return;
      }
      Import.open();
    },
    importPickFile: function (input) { Import.pickFile(input); },
    importBack: function () { Import.render(); },
    importStep: function (dir) { Import.step(dir); },
    importSetMapping: function (key, val) { Import.setMapping(key, val); },
    importSetDefault: function (key, val) { Import.setDefault(key, val); },
    importRun: function () { Import.run(); },
    importClose: function () { Import.close(); },
    exportCsv: function () { return MastEntity.exportRows('materials-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('materials-v2', {
    routes: { 'materials-v2': { tab: 'materialsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
