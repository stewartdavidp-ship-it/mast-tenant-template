/**
 * products-v2.js — the products surface, rebuilt on the Entity Engine.
 *
 * Build plan: docs/ux-audit/products-v2-build-plan.md (design ratified).
 * The most complex object in the app — the composition of three systems:
 *   • process   — governed lifecycle (MastFlow productsWorkflow): Draft → Review → Published → Archived
 *   • variants  — a synthetic Default (base) + per-variant inherit/override
 *   • sub-objects — recipe / pricing / inventory, each first-class, per-variant
 *
 * Phasing (flag-gated #products-v2, side-by-side with legacy, retire legacy at parity):
 *   P0a  list + read SO (this commit)               ← products list, one-object read detail
 *   P0b  variant-expanding list (extend MastUI.list)
 *   P1   Default/product SO: MastFlow process + tab flow
 *   P2   variant SO: inherit/override tabs
 *   P3   edit-in-V2 via additive MakerProductBridge + real Advance (onFlowAdvance)
 *   P4   add-variant-from-Default + per-variant overrides
 *   P5   Revising loop, flip #products, retire legacy
 *
 * Flag-gated (?ui=1) at #products-v2; legacy maker.js / renderProductDetail untouched.
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

  var N = window.MastUI.Num;

  // Lifecycle status → badge tone. Status is workflow-governed (P1 wires MastFlow);
  // here it is read-only and drives the list + detail badge only.
  var STATUS_TONE = {
    draft: 'neutral', ready: 'amber', active: 'teal', archived: 'neutral'
  };
  var STATUS_LABEL = { draft: 'Draft', ready: 'Review', active: 'Published', archived: 'Archived' };
  var MODE_LABEL = { build: 'Build', var: 'Value-add', resell: 'Resell' };

  function statusLabel(s) { return STATUS_LABEL[String(s || 'draft').toLowerCase()] || (s || 'Draft'); }
  function variantCount(p) { return Array.isArray(p.variants) ? p.variants.length : 0; }
  function variantsLabel(p) { var n = variantCount(p); return n > 0 ? (n + ' variants') : 'Default only'; }
  function categoryLabel(p) {
    if (p.category) return p.category;
    if (Array.isArray(p.categories) && p.categories.length) return p.categories.join(', ');
    return '';
  }
  function price(p) { return N.moneyVal(p, 'priceCents', 'price'); }

  function stamp(p, id) {
    p._key = id || p.pid || p._key;
    // fields[0] is read directly for the slide-out title — materialise a real string.
    p._title = p.name || ('Product ' + (p._key || ''));
    return p;
  }

  MastEntity.define('products-v2', {
    label: 'Product', labelPlural: 'Products', size: 'xl', route: 'products-v2',
    recordId: function (p) { return p._key || p.pid; },
    fields: [
      { name: '_title', label: 'Product', type: 'text', list: true, group: 'Product', readOnly: true },
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Lifecycle', readOnly: true,
        get: function (p) { return statusLabel(p.status); },
        tone: function (v) {
          // tone reads the RAW status; v may be the display label, so normalise both.
          var k = String(v || '').toLowerCase();
          if (STATUS_TONE[k]) return STATUS_TONE[k];
          if (k === 'review') return 'amber'; if (k === 'published') return 'teal';
          return 'neutral';
        } },
      { name: 'category', label: 'Category', type: 'text', list: true, group: 'Product', readOnly: true,
        get: function (p) { return categoryLabel(p); } },
      { name: 'mode', label: 'Mode', type: 'text', list: true, group: 'Product', readOnly: true,
        get: function (p) { return MODE_LABEL[p.acquisitionType || 'build'] || 'Build'; } },
      { name: 'variants', label: 'Variants', type: 'text', list: true, sortable: false, group: 'Product', readOnly: true,
        get: function (p) { return variantsLabel(p); } },
      { name: 'price', label: 'Price', type: 'money', list: true, group: 'Money', readOnly: true, align: 'right',
        get: function (p) { return price(p); } }
    ],
    fetch: function (id) {
      return Promise.resolve(MastDB.products.get(id)).then(function (p) {
        return p ? stamp(Object.assign({}, p), id) : null;
      });
    },

    // P0a read interior — a placeholder that already composes engine primitives
    // (P1 replaces this with the MastFlow process header + the tab flow). No
    // onSave yet: editing arrives in P3 via the delegation bridge.
    detail: {
      render: function (U, p) {
        var tiles = U.tiles([
          { k: 'Status', v: statusLabel(p.status), hero: true },
          { k: 'Price', v: N.money(price(p)) || '—' },
          { k: 'Variants', v: variantCount(p) || 'Default only' },
          { k: 'Mode', v: MODE_LABEL[p.acquisitionType || 'build'] || 'Build' }
        ]);
        var info = U.kv([
          { k: 'Category', v: categoryLabel(p) || '—' },
          { k: 'Business line', v: p.businessLine || '—' },
          { k: 'Slug', v: p.slug || '—' },
          { k: 'Acquisition', v: MODE_LABEL[p.acquisitionType || 'build'] || 'Build' }
        ]);
        var note = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">' +
          'Read-only skeleton (P0a). The process stepper + tab flow (Pricing · Recipe · Inventory · ' +
          'Channels · Image) and variant inherit/override arrive in P1–P2.</div>';
        return U.stickyHead(tiles, '') + U.card('Overview', info) + note;
      }
    }
  });

  // ── State + data (same source as legacy: public/products) ───────────
  var V2 = { rows: [], byId: {}, sortKey: '_title', sortDir: 'asc', filter: 'all' };

  function toRows(list) {
    var out = [];
    (list || []).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      out.push(stamp(Object.assign({}, p), p.pid));
    });
    return out;
  }
  function load() {
    if (!window.MastDB || !MastDB.products) return;
    Promise.resolve(MastDB.products.list()).then(function (list) {
      V2.rows = toRows(list);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    }).catch(function (e) { console.error('[products-v2] load', e); render(); });
  }

  function statusCounts() {
    var c = { all: V2.rows.length };
    V2.rows.forEach(function (r) { var s = String(r.status || 'draft').toLowerCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }
  function visibleRows() {
    var rows = V2.rows;
    if (V2.filter && V2.filter !== 'all') {
      rows = rows.filter(function (r) { return String(r.status || 'draft').toLowerCase() === V2.filter; });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('products-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('productsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'productsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var counts = statusCounts();
    var pills = ['all', 'draft', 'ready', 'active', 'archived'].map(function (s) {
      var on = V2.filter === s;
      var label = s === 'all' ? 'All' : statusLabel(s);
      return '<button onclick="ProductsV2.setFilter(\'' + s + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--charcoal,var(--text))' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        label + ' <span style="color:var(--warm-gray);">' + (counts[s] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      window.MastUI.pageHeader({ title: 'Products', count: N.count(V2.rows.length) + ' products',
        actionsHtml: '<button class="btn btn-secondary" onclick="ProductsV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      window.MastEntity.renderList('products-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ProductsV2.sort', onRowClickFnName: 'ProductsV2.open',
        empty: { title: 'No products match these filters', message: 'Try clearing filters.' }
      });
  }

  window.ProductsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'price') ? 'desc' : 'asc'; }
      render();
    },
    setFilter: function (s) { V2.filter = s; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) window.MastEntity.openRecord('products-v2', rec, 'read'); },
    exportCsv: function () { return window.MastEntity.exportRows('products-v2', visibleRows(), V2.filter); }
  };

  MastAdmin.registerModule('products-v2', {
    routes: { 'products-v2': { tab: 'productsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
