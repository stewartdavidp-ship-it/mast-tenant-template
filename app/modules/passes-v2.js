/**
 * passes-v2.js — read-focused Faceted Record twin of the legacy class Passes
 * surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy book.js (#passes, owned by the Book module) hosts the pass-definition
 * list as a data-table and swaps the pane in-place to a read-only detail
 * (_renderPassDetailView: Definition + Instance counts + Cohorts) with its own
 * Edit button. This twin re-hosts that VIEW on the Entity Engine: a schema-driven
 * list + a read-focused Faceted Record slide-out (Overview / Sales facets).
 *
 * Variant (doc 17 §1a): a pass DEFINITION is a product/config record (name,
 * price, visit count, validity window, class scope, priority) with no governed
 * lifecycle — its status (active / draft / archived …) is an assigned attribute
 * → Faceted Record, NOT Process/MastFlow.
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the multi-section
 * pass-definition form — Basic Info / Pricing & Terms / Options / Auto-Renew /
 * Class Scope) + an onSave that DELEGATES to window.PassesBridge (exposed in
 * book.js) so the pass-definition write — priceCents conversion, the unlimited-
 * type visitCount rule, and the public dual-write (syncPassDefToPublic) — stays
 * single-sourced; the twin never reimplements that logic. Per-instance pass
 * issuing/redeeming + cohort tooling (a different surface) stays on legacy
 * #passes. Flag-gated (?ui=1) at #passes-v2, side-by-side.
 *
 * Data: definitions live at admin/passDefinitions (MastDB.passDefinitions →
 * that path; .list(100) is the legacy accessor). The Sales facet reads the
 * aggregate doc admin/passDefinitionAggregates/{id} — a single one-shot keyed
 * read per detail open (the same cheap read legacy _kickPassDetailLoad does; the
 * heavier per-instance index + cohort tooling stays on legacy).
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
  function can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }

  // Status semantics mirror book.js (CLASS_STATUSES reused for passes):
  // active is the "live/sellable" state; everything else is non-live.
  var STATUS_LABEL = { active: 'Active', draft: 'Draft', published: 'Published', completed: 'Completed', archived: 'Archived' };
  var STATUS_TONE = { active: 'success', published: 'success', draft: 'neutral', completed: 'info', archived: 'amber' };
  function statusTone(v) { return STATUS_TONE[v] || 'neutral'; }
  function statusLabel(v) { return STATUS_LABEL[v] || (v ? cap(v) : '—'); }

  function cap(s) { return s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : ''; }
  function passName(p) { return (p && p.name) || '(unnamed)'; }
  function statusOf(p) { return (p && p.status) || 'draft'; }
  // priceCents → "$X.XX"; absent handled by callers (em-dash).
  function priceVal(p) { return N.moneyVal(p, 'priceCents', null); }
  // "N visits" or "Unlimited" (mirror legacy list/detail).
  function visitsText(p) { return (p && p.visitCount) ? (p.visitCount + (p.visitCount === 1 ? ' visit' : ' visits')) : 'Unlimited'; }
  // "N days" or "No limit" (mirror legacy list/detail).
  function validityText(p) { return (p && p.validityDays) ? (p.validityDays + ' days') : 'No limit'; }
  // Eligibility = allowed class scope; empty/absent ⇒ any class (legacy hint).
  function eligibilityText(p) {
    var ids = p && p.allowedClassIds;
    if (!ids || !ids.length) return 'Any class';
    return MastFormat.countNoun(ids.length, 'class', 'classes');
  }
  // Sales aggregate doc (admin/passDefinitionAggregates/{id}) attached to the
  // record before open; null until the one-shot read resolves / if never computed.
  function agg(p) { return p && p.__agg; }

  // Edit-form vocab — mirrors book.js (PASS_TYPES / PASS_PRIORITIES / CLASS_STATUSES,
  // activation + renew options) so the native form offers the same choices the
  // legacy savePassDefinition form does. PassesBridge owns the write semantics.
  var PASS_TYPES = ['drop-in', 'pack', 'unlimited', 'limited', 'series', 'intro'];
  var PASS_PRIORITIES = ['high', 'medium', 'low'];
  var PASS_STATUSES = ['draft', 'active', 'published', 'completed', 'archived'];
  var ACTIVATION_OPTS = [{ value: 'purchase', label: 'On purchase' }, { value: 'first_use', label: 'On first use' }];
  var RENEW_OPTS = ['monthly', 'quarterly', 'yearly'];

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('passes-v2', {
    label: 'Pass', labelPlural: 'Passes', size: 'md',
    route: 'passes-v2',
    recordId: function (p) { return p._key || p.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true, group: 'Pass', get: passName },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true, get: function (p) { return p.type || '—'; } },
      { name: 'price', label: 'Price', type: 'money', list: true, readOnly: true, align: 'right', get: priceVal },
      { name: 'visits', label: 'Visits', type: 'text', list: true, readOnly: true, sortable: false, get: visitsText },
      { name: 'validity', label: 'Validity', type: 'text', list: true, readOnly: true, sortable: false, get: validityText },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'draft', 'published', 'completed', 'archived'],
        get: statusOf,
        tone: statusTone }
    ],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return ensureLoaded().then(function () { return V2.byId[id] || null; });
    },
    detail: {
      render: function (UI, p) {
        var price = priceVal(p);
        var tiles = UI.tiles([
          { k: 'Price', v: (N.money(price) || '—') + (p.autoRenew ? ' /' + esc(p.renewFrequency || 'month') : ''), hero: true },
          { k: 'Visits', v: esc(visitsText(p)) },
          { k: 'Validity', v: esc(validityText(p)) },
          { k: 'Status', v: UI.badge(statusLabel(statusOf(p)), statusTone(statusOf(p))) }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'sales', label: 'Sales' },
          { key: 'holders', label: 'Holders' }
        ], 'ov');
        // Holders — per-instance cohorts (V1-removal: the legacy cohort
        // drill-down lives here now). Async fill via PassesBridge (one
        // indexed query per detail open, mirroring legacy).
        var holdersBody = '<div id="pv2Holders"><span class="mu-sub">Loading holders…</span></div>';
        setTimeout(function () { window.PassesV2 && PassesV2._fillHolders(p._key || p.id); }, 0);

        // Overview — definition + pricing/terms + options + scope + description.
        var definition = UI.kv([
          { k: 'Type', v: esc(p.type || '—') },
          { k: 'Status', v: UI.badge(statusLabel(statusOf(p)), statusTone(statusOf(p))) },
          { k: 'Priority', v: esc(cap(p.priority || 'medium')) },
          { k: 'Intro only', v: p.introOnly ? 'Yes' : 'No' }
        ]);
        var terms = UI.kv([
          { k: 'Price', v: (N.money(price) || '—') },
          { k: 'Visits', v: esc(visitsText(p)) },
          { k: 'Validity', v: esc(validityText(p)) },
          { k: 'Activation', v: esc(p.activationTrigger === 'first_use' ? 'On first use' : 'On purchase') },
          { k: 'Auto-renew', v: p.autoRenew ? ('Yes · ' + esc(cap(p.renewFrequency || 'month'))) : 'No' },
          { k: 'Online purchase', v: (p.onlinePurchasable === false) ? 'No' : 'Yes' }
        ]);
        var scope = UI.kv([
          { k: 'Eligibility', v: esc(eligibilityText(p)) }
        ]);
        var descBody = p.description
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(p.description) + '</div>'
          : '<span class="mu-sub">No description.</span>';
        // Pass-definition create/edit (all sections above + the public dual-write)
        // is now native to this twin via the Edit button → onSave → PassesBridge.

        // Sales — instance counts from the aggregate doc (one-shot read). Full
        // per-instance cohort drill-down stays on legacy #passes.
        var a = agg(p);
        var salesBody;
        if (a) {
          salesBody = UI.kv([
            { k: 'Sold', v: N.count(a.sold || 0) },
            { k: 'Active', v: N.count(a.active || 0) },
            { k: 'Used', v: N.count(a.used || 0) },
            { k: 'Expired', v: N.count(a.expired || 0) },
            { k: 'Revoked', v: N.count(a.revoked || 0) }
          ]);
        } else if (p.__aggLoading) {
          salesBody = '<span class="mu-sub">Loading sales…</span>';
        } else {
          salesBody = '<span class="mu-sub">No instance counts computed yet for this pass.</span>';
        }

        // Danger zone — hard delete via the bridge (RBAC + mastConfirm + FK
        // warn in the remove() handler; writeAudit in the bridge core).
        var dangerZone = can('passes', 'delete')
          ? UI.card('Danger zone', '<button class="btn btn-danger btn-small" onclick="PassesV2.remove(\'' + esc(p._key || p.id) + '\')">Delete pass</button>')
          : '';
        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Definition', definition) +
            UI.card('Pricing & terms', terms) +
            UI.card('Class scope', scope) +
            UI.card('Description', descBody) +
          '</div>' +
          '<div class="mu-pane" data-pane="sales" hidden>' + UI.card('Instance counts', salesBody) + '</div>' +
          '<div class="mu-pane" data-pane="holders" hidden>' + UI.cardTable('Holders', holdersBody) + '</div>' + dangerZone;
      },
      // Native edit/create form — the legacy showPassDefForm section set, grouped:
      // Basic Info (name*, type*, status, description), Pricing & Terms (price* in
      // dollars, visit count, validity days, activation), Options (priority, sort
      // order, online purchase, intro only), Auto-Renew (toggle + frequency), and
      // a Class Scope checkbox picker (active classes; none checked ⇒ any class).
      // onSave delegates to window.PassesBridge — no write logic reimplemented.
      editRender: function (p, mode) {
        p = p || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        function grp(label) { return '<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:14px 0 4px;">' + esc(label) + '</div>'; }
        function opts(list, sel) {
          return list.map(function (o) {
            var val = (typeof o === 'object') ? o.value : o;
            var lab = (typeof o === 'object') ? o.label : cap(o);
            return '<option value="' + esc(val) + '"' + (String(sel) === String(val) ? ' selected' : '') + '>' + esc(lab) + '</option>';
          }).join('');
        }
        var priceVal2 = (p.priceCents != null) ? (p.priceCents / 100).toFixed(2) : '';
        var allowedIds = p.allowedClassIds || [];
        var activeClasses = (V2.classes || []).filter(function (c) { return c.status === 'active'; });
        var scopeHtml = activeClasses.length
          ? activeClasses.map(function (c) {
              var on = allowedIds.indexOf(c.id) !== -1 ? ' checked' : '';
              return '<label style="display:block;font-size:0.85rem;margin-bottom:6px;"><input type="checkbox" name="pdfV2Scope" value="' + esc(c.id) + '"' + on + '> ' + esc(c.name || c.id) + '</label>';
            }).join('')
          : '<span class="mu-sub">No active classes — this pass applies to any class.</span>';
        var renewStyle = (p.autoRenew ? '' : ' style="display:none;"');
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New pass' : 'Edit this pass') + '</div>' +
          grp('Basic info') +
          fg('Name *', '<input class="form-input" id="pdfV2Name" value="' + esc(p.name || '') + '" style="width:100%;" placeholder="e.g. 10-Class Pack">') +
          row2(
            fg('Type *', '<select class="form-input" id="pdfV2Type" style="width:100%;">' + opts(PASS_TYPES, p.type || 'pack') + '</select>', true),
            fg('Status', '<select class="form-input" id="pdfV2Status" style="width:100%;">' + opts(PASS_STATUSES, statusOf(p)) + '</select>', true)
          ) +
          fg('Description', '<textarea class="form-input" id="pdfV2Desc" rows="2" style="width:100%;resize:vertical;" placeholder="What does this pass include?">' + esc(p.description || '') + '</textarea>') +
          grp('Pricing & terms') +
          row2(
            fg('Price ($) *', '<input class="form-input" type="number" min="0" step="0.01" id="pdfV2Price" value="' + esc(priceVal2) + '" style="width:100%;">', true),
            fg('Activation', '<select class="form-input" id="pdfV2Activation" style="width:100%;">' + opts(ACTIVATION_OPTS, p.activationTrigger || 'purchase') + '</select>', true)
          ) +
          row2(
            fg('Visit count', '<input class="form-input" type="number" min="1" id="pdfV2Visits" value="' + esc(p.visitCount || '') + '" style="width:100%;" placeholder="Leave blank for unlimited">', true),
            fg('Validity (days)', '<input class="form-input" type="number" min="1" id="pdfV2Validity" value="' + esc(p.validityDays || '') + '" style="width:100%;" placeholder="No limit">', true)
          ) +
          grp('Options') +
          row2(
            fg('Priority', '<select class="form-input" id="pdfV2Priority" style="width:100%;">' + opts(PASS_PRIORITIES, p.priority || 'medium') + '</select>', true),
            fg('Sort order', '<input class="form-input" type="number" min="0" id="pdfV2Sort" value="' + esc(p.sortOrder || 0) + '" style="width:100%;">', true)
          ) +
          row2(
            fg('Online purchase', '<select class="form-input" id="pdfV2Online" style="width:100%;">' + opts([{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }], (p.onlinePurchasable === false) ? 'false' : 'true') + '</select>', true),
            fg('Intro only', '<select class="form-input" id="pdfV2Intro" style="width:100%;">' + opts([{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }], p.introOnly ? 'true' : 'false') + '</select>', true)
          ) +
          grp('Auto-renew') +
          row2(
            fg('Auto-renew', '<select class="form-input" id="pdfV2AutoRenew" style="width:100%;" onchange="PassesV2.toggleRenew(this.value)">' + opts([{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }], p.autoRenew ? 'true' : 'false') + '</select>', true),
            '<div class="form-group" id="pdfV2RenewWrap"' + renewStyle + ' style="flex:1;min-width:150px;' + (p.autoRenew ? '' : 'display:none;') + '"><label class="form-label">Frequency</label><select class="form-input" id="pdfV2RenewFreq" style="width:100%;">' + opts(RENEW_OPTS, p.renewFrequency || 'monthly') + '</select></div>'
          ) +
          grp('Class scope') +
          '<div class="mu-sub" style="margin-bottom:8px;">Leave all unchecked to allow this pass for any class.</div>' +
          '<div style="max-height:200px;overflow-y:auto;">' + scopeHtml + '</div>';
      }
    },
    onSave: function (rec, mode) {
      if (!window.PassesBridge) { if (window.showToast) showToast('Passes engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      var scope = Array.prototype.slice.call(document.querySelectorAll('input[name="pdfV2Scope"]:checked')).map(function (cb) { return cb.value; });
      var data = {
        name: val('pdfV2Name'),
        type: val('pdfV2Type') || 'pack',
        status: val('pdfV2Status') || 'draft',
        description: val('pdfV2Desc'),
        priceDollars: val('pdfV2Price'),
        activationTrigger: val('pdfV2Activation') || 'purchase',
        visitCount: val('pdfV2Visits'),
        validityDays: val('pdfV2Validity'),
        priority: val('pdfV2Priority') || 'medium',
        sortOrder: val('pdfV2Sort'),
        onlinePurchasable: val('pdfV2Online'),
        introOnly: val('pdfV2Intro'),
        autoRenew: val('pdfV2AutoRenew'),
        renewFrequency: val('pdfV2RenewFreq'),
        allowedClassIds: scope
      };
      // Validation mirrors legacy savePassDefinition: name required; valid price required.
      if (!data.name.trim()) { if (window.showToast) showToast('Name is required.', true); return false; }
      var price = parseFloat(data.priceDollars);
      if (isNaN(price) || price < 0) { if (window.showToast) showToast('A valid price is required.', true); return false; }

      if (mode === 'create') {
        return Promise.resolve(window.PassesBridge.create(data)).then(function () {
          if (window.showToast) showToast('Pass created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[passes-v2] create', e); if (window.showToast) showToast('Error saving pass.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(window.PassesBridge.update(id, data)).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open.
        Object.assign(V2.byId[id] || rec, {
          name: data.name.trim(), type: data.type, status: data.status,
          description: data.description.trim() || null, priceCents: Math.round(price * 100),
          visitCount: data.type === 'unlimited' ? null : (parseInt(data.visitCount, 10) || null),
          validityDays: parseInt(data.validityDays, 10) || null,
          allowedClassIds: scope.length ? scope : null,
          autoRenew: data.autoRenew === 'true', priority: data.priority,
          onlinePurchasable: data.onlinePurchasable !== 'false', introOnly: data.introOnly === 'true'
        });
        if (window.showToast) showToast('Pass updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[passes-v2] update', e); if (window.showToast) showToast('Error updating pass.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, classes: [], sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', typeFilter: 'all', loaded: false };

  // Run-once data load shared by route setup and cold drills (fetch gate).
  var _loadPromise = null;
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (!_loadPromise) _loadPromise = loadData();
    return _loadPromise;
  }
  function load() { _loadPromise = null; loadData().then(render); }
  function loadData() {
    // Ensure the legacy book module is loaded so window.PassesBridge (the
    // delegated write path) exists — mirrors contacts-v2 / students-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
    // Pass definitions + the class catalog (for the scope picker) load together;
    // both one-shot keyed-object reads (no listeners).
    return Promise.all([
      Promise.resolve(MastDB.passDefinitions.list(100)).catch(function () { return null; }),
      Promise.resolve(MastDB.classes.list(200)).catch(function () { return null; })
    ]).then(function (res) {
      var snap = res[0];
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var p = val[k];
        if (p && typeof p === 'object') { p = Object.assign({ _key: k }, p); p.status = p.status || 'draft'; out.push(p); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      var csnap = res[1];
      var cval = (csnap && typeof csnap.val === 'function') ? csnap.val() : csnap;
      V2.classes = Object.keys(cval || {}).map(function (k) { return Object.assign({ id: k }, cval[k]); });
      V2.loaded = true;
    }).catch(function (e) { console.error('[passes-v2] load', e); });
  }
  function reloadSoon() { V2.loaded = false; _loadPromise = null; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  // One-shot aggregate read for the open pass (cheap keyed doc; mirrors legacy
  // _kickPassDetailLoad's aggregate fetch). Re-opens the panel once it lands so
  // the Sales facet fills in. Cached on the record for the session.
  function loadAggregate(p) {
    if (!p || p.__agg || p.__aggLoading) return;
    p.__aggLoading = true;
    Promise.resolve(MastDB.get('admin/passDefinitionAggregates/' + (p._key || p.id))).then(function (a) {
      p.__aggLoading = false;
      p.__agg = a || { sold: 0, active: 0, used: 0, expired: 0, revoked: 0 };
      // Only re-render if this pass is still the open record.
      if (window.MastUI.slideOut.isOpen()) MastEntity.openRecord('passes-v2', p, 'read');
    }).catch(function (e) {
      p.__aggLoading = false;
      console.warn('[passes-v2] aggregate load failed:', e && e.message);
    });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (p) { return statusOf(p) === V2.statusFilter; });
    if (V2.typeFilter !== 'all') rows = rows.filter(function (p) { return p.type === V2.typeFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (p) {
        return String(p.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(p.type || '').toLowerCase().indexOf(q) >= 0 ||
               String(p.description || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('passes-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('passesV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'passesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function typeOptions() {
    var seen = {}, types = [];
    V2.rows.forEach(function (p) { if (p.type && !seen[p.type]) { seen[p.type] = 1; types.push(p.type); } });
    types.sort();
    return ['<option value="all"' + (V2.typeFilter === 'all' ? ' selected' : '') + '>All types</option>'].concat(
      types.map(function (t) { return '<option value="' + esc(t) + '"' + (V2.typeFilter === t ? ' selected' : '') + '>' + esc(cap(t)) + '</option>'; })
    ).join('');
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="PassesV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Passes',
        count: N.count(V2.rows.length) + ' pass' + (V2.rows.length === 1 ? '' : 'es'),
        actionsHtml: '<button class="btn btn-primary" onclick="PassesV2.create()">+ New pass</button>' +
          '<button class="btn btn-secondary" onclick="PassesV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:12px 0;">' + filters +
        '<select class="form-input" onchange="PassesV2.filterType(this.value)" style="max-width:170px;font-size:0.9rem;margin-left:4px;">' + typeOptions() + '</select>' +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, type or description…" value="' + esc(V2.q) +
        '" oninput="PassesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('passes-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'PassesV2.sort', onRowClickFnName: 'PassesV2.open',
        empty: { title: 'No passes', message: V2.loaded ? 'Create a pass to get started.' : 'Loading…' }
      });
  }

  window.PassesV2 = {
    remove: function (id) {
      if (!can('passes', 'delete')) { if (window.showToast) showToast('Delete access required.', true); return; }
      if (!window.PassesBridge || !window.PassesBridge.remove) { if (window.showToast) showToast('Engine still loading — try again', true); return; }
      var rec = V2.byId[id];
      var msg = 'Delete the pass "' + ((rec && rec.name) || '') + '"? Archived passes only — sold passes in customer wallets keep working from their own copies. This cannot be undone.';
      mastConfirm(msg, { title: 'Delete Pass', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(window.PassesBridge.remove(id)).then(function () {
          delete V2.byId[id];
          V2.rows = V2.rows.filter(function (x) { return (x._key || x.id) !== id; });
          if (window.showToast) showToast('Pass deleted');
          try { U.slideOut.requestClose(); } catch (_) {}
          render();
        }).catch(function (e) { if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true); });
      });
    },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'price' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    filterType: function (t) { V2.typeFilter = t || 'all'; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('passes-v2').fetch(id).then(function (rec) {
        if (rec) { MastEntity.openRecord('passes-v2', rec, 'read'); loadAggregate(rec); }
      });
    },
    create: function () {
      // Ensure the legacy book module (and thus window.PassesBridge) is loaded
      // before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
      MastEntity.openRecord('passes-v2', {}, 'create');
    },
    // Show/hide the renew-frequency field as the auto-renew toggle changes (mirrors
    // the legacy form's _passToggleFields for this one field).
    toggleRenew: function (v) {
      var wrap = document.getElementById('pdfV2RenewWrap');
      if (wrap) wrap.style.display = (v === 'true') ? '' : 'none';
    },
    // Per-instance issuing/redeeming + per-holder cohort tooling have no V2 home
    // yet, so the Sales tab keeps a deep-link to classic #passes. navigateToClassic
    // so the V2 route remap doesn't loop us back to this twin.
    // Holders facet — cohort pills + instances table + per-cohort export bar
    // (Copy emails / Download CSV). PassesBridge single-sources the
    // defs/matcher/query with the legacy cohort block; export mirrors legacy
    // book.js _passCohortCopyEmails / _passCohortDownloadCsv (read-only).
    _holdersState: {},
    _fillHolders: function (passDefId, cohortKey) {
      var el = document.getElementById('pv2Holders');
      if (!el) return;
      if (!window.PassesBridge || !window.PassesBridge.loadInstances) {
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
        setTimeout(function () { PassesV2._fillHolders(passDefId, cohortKey); }, 600);
        return;
      }
      var st = PassesV2._holdersState;
      var renderTbl = function (instances) {
        var defs = window.PassesBridge.cohortDefs();
        var sel = cohortKey || st.cohort || 'active';
        st.cohort = sel; st.instances = instances; st.defId = passDefId;
        var pills = defs.map(function (c) {
          var n = instances.filter(function (i) { return window.PassesBridge.instanceMatches(i, c.key); }).length;
          return '<button class="btn btn-small ' + (c.key === sel ? 'btn-primary' : 'btn-secondary') + '" onclick="PassesV2._cohort(\'' + c.key + '\')">' + esc(c.label) + ' (' + n + ')</button>';
        }).join(' ');
        var rows = instances.filter(function (i) { return window.PassesBridge.instanceMatches(i, sel); });
        st.rows = rows;
        var tbl = rows.length
          ? U.relatedTable([
              { label: 'Holder', render: function (i) { return esc(i.customerName || i.customerEmail || i.uid || '—'); } },
              { label: 'Status', render: function (i) { return U.badge(i.status || '—', i.status === 'active' ? 'success' : 'neutral'); } },
              { label: 'Visits left', align: 'right', render: function (i) { return i.visitsRemaining != null ? N.count(i.visitsRemaining) : '—'; } },
              { label: 'Expires', render: function (i) { return i.expiresAt ? N.date(i.expiresAt) : '—'; } },
              { label: 'Last used', render: function (i) { return i.lastUsedAt ? N.date(i.lastUsedAt) : '—'; } }
            ], rows)
          : '<span class="mu-sub">No holders in this cohort.</span>';
        // Per-cohort export bar — mirrors legacy book.js _renderPassCohortBlock:
        // "Copy emails (N)" copies the cohort's holder emails to the clipboard;
        // "Download CSV" exports the cohort's holders. Read-only (no writes).
        var nEmails = rows.filter(function (i) { return i.customerEmail; }).length;
        var exportBar = '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary btn-small" onclick="PassesV2._cohortCopyEmails()"' + (nEmails ? '' : ' disabled') + '>Copy emails (' + nEmails + ')</button>' +
          '<button class="btn btn-secondary btn-small" onclick="PassesV2._cohortDownloadCsv()"' + (rows.length ? '' : ' disabled') + '>Download CSV</button>' +
          '<span class="mu-sub" style="margin-left:auto;">' + MastFormat.countNoun(rows.length, 'holder') + '</span>' +
        '</div>';
        var el2 = document.getElementById('pv2Holders');
        if (el2) el2.innerHTML = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">' + pills + '</div>' + tbl + exportBar;
      };
      if (st.defId === passDefId && st.instances && cohortKey) { renderTbl(st.instances); return; }
      Promise.resolve(window.PassesBridge.loadInstances(passDefId)).then(renderTbl)
        .catch(function (e) {
          console.error('[passes-v2] holders', e);
          var el3 = document.getElementById('pv2Holders');
          if (el3) el3.innerHTML = '<span class="mu-sub">Could not load holders.</span>';
        });
    },
    _cohort: function (key) { PassesV2._fillHolders(PassesV2._holdersState.defId, key); },
    // Per-cohort holder export — read-only, mirrors legacy book.js
    // _passCohortCopyEmails / _passCohortDownloadCsv. Operates on the holders
    // currently matched into the selected cohort (PassesV2._holdersState.rows).
    _cohortRows: function () { return (PassesV2._holdersState && PassesV2._holdersState.rows) || []; },
    _cohortCopyEmails: function () {
      var emails = PassesV2._cohortRows().map(function (i) { return i.customerEmail; }).filter(Boolean);
      if (!emails.length) return;
      var text = emails.join(', ');
      var ok = function () { if (window.showToast) showToast('Copied ' + MastFormat.countNoun(emails.length, 'email')); };
      var fb = function () { if (typeof mastCopyFallback === 'function') mastCopyFallback('Copy emails', text); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(ok).catch(fb);
      } else { fb(); }
    },
    _cohortDownloadCsv: function () {
      var rows = PassesV2._cohortRows();
      if (!rows.length) return;
      // Same columns as legacy book.js cohort CSV; cells run through the shared
      // _csvCell helper (formula-injection-safe quoting).
      var header = ['customerName', 'customerEmail', 'status', 'visitsRemaining', 'visitsUsed', 'activatedAt', 'expiresAt', 'lastUsedAt'];
      var cell = (typeof window._csvCell === 'function')
        ? window._csvCell
        : function (s) { var v = String(s == null ? '' : s); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = [header.join(',')];
      rows.forEach(function (r) { lines.push(header.map(function (k) { return cell(r[k] == null ? '' : r[k]); }).join(',')); });
      var st = PassesV2._holdersState || {};
      MastExport.downloadBlob('pass-cohort-' + (st.defId || 'pass') + '-' + (st.cohort || 'cohort') + '.csv', lines.join('\n'), 'text/csv');
    },
    exportCsv: function () { return MastEntity.exportRows('passes-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('passes-v2', {
    routes: { 'passes-v2': { tab: 'passesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
