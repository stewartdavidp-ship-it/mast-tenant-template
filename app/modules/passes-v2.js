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
 * Read-focused: creating/editing a pass definition is a multi-section bespoke
 * form (pricing & terms, options, auto-renew, class-scope checkbox picker) with
 * a public dual-write (syncPassDefToPublic), all coupled to the legacy Book
 * module — it stays single-sourced on legacy #passes via a "manage in classic
 * view" link. This twin re-hosts the VIEW only — no onSave, no edit form, and no
 * per-instance cohort tooling (that stays on legacy too). Flag-gated (?ui=1) at
 * #passes-v2, side-by-side; never touches book.js.
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
    return ids.length + ' class' + (ids.length === 1 ? '' : 'es');
  }
  // Sales aggregate doc (admin/passDefinitionAggregates/{id}) attached to the
  // record before open; null until the one-shot read resolves / if never computed.
  function agg(p) { return p && p.__agg; }

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
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
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
          { key: 'ov', label: 'Overview' }, { key: 'sales', label: 'Sales' }
        ], 'ov');

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
        // Multi-section pass editing (pricing/terms/options/scope + public
        // dual-write) stays on legacy #passes. Use navigateToClassic so the V2
        // route remap doesn't loop us back to this twin.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="PassesV2.classic()">Manage in classic view →</button></div>';

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
          ]) + '<div class="mu-sub" style="margin-top:10px;">Per-holder cohorts (expiring, lapsed, unused) live in the classic Passes view.</div>';
        } else if (p.__aggLoading) {
          salesBody = '<span class="mu-sub">Loading sales…</span>';
        } else {
          salesBody = '<span class="mu-sub">No instance counts computed yet for this pass.</span>';
        }

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Definition', definition) +
            UI.card('Pricing & terms', terms) +
            UI.card('Class scope', scope) +
            UI.card('Description', descBody + manage) +
          '</div>' +
          '<div class="mu-pane" data-pane="sales" hidden>' + UI.card('Instance counts', salesBody) + '</div>';
      }
    }
    // No onSave → no Edit button (pass-definition editing stays on legacy #passes).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', typeFilter: 'all', loaded: false };

  function load() {
    Promise.resolve(MastDB.passDefinitions.list(100)).then(function (snap) {
      var val = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var out = [];
      Object.keys(val || {}).forEach(function (k) {
        var p = val[k];
        if (p && typeof p === 'object') { p = Object.assign({ _key: k }, p); p.status = p.status || 'draft'; out.push(p); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[passes-v2] load', e); render(); });
  }

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
        actionsHtml: '<button class="btn btn-secondary" onclick="PassesV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:12px 0;">' + filters +
        '<select class="form-input" onchange="PassesV2.filterType(this.value)" style="max-width:170px;font-size:0.9rem;margin-left:4px;">' + typeOptions() + '</select>' +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, type or description…" value="' + esc(V2.q) +
        '" oninput="PassesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('passes-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'PassesV2.sort', onRowClickFnName: 'PassesV2.open',
        empty: { title: 'No passes', message: V2.loaded ? 'Create class passes in the classic Passes view.' : 'Loading…' }
      });
  }

  window.PassesV2 = {
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
    // Multi-section pass editing → classic Passes view. Use navigateToClassic so
    // the V2 route remap doesn't loop us back to this twin.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('passes');
      else if (typeof navigateTo === 'function') navigateTo('passes');
    },
    exportCsv: function () { return MastEntity.exportRows('passes-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('passes-v2', {
    routes: { 'passes-v2': { tab: 'passesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
