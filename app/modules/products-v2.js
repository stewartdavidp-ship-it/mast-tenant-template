/**
 * products-v2.js — the products surface, rebuilt on the Entity Engine.
 *
 * Build plan: docs/ux-audit/products-v2-build-plan.md (design ratified).
 * The most complex object in the app — process × variants × sub-objects.
 *
 * Phasing (flag-gated #products-v2, side-by-side with legacy):
 *   P0a  list + read SO                                   ✓ (PR 180, 181)
 *   P0b  variant-expanding list + variant SO              ← this commit
 *   P1   Default/product SO: process header + tab flow
 *   P2   variant SO: full inherit/override tabs
 *   P3   edit-in-V2 via MakerProductBridge + real Advance
 *   P4   add-variant write + per-variant overrides
 *   P5   Revising loop, flip default, retire legacy
 *
 * The list renders products → expand to the synthetic Default + variants inline
 * + "Add variant" (matching legacy getProductVariantsForRender). The slide-out
 * presents ONE object: a Default/product OR a single variant.
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

  var STATUS_TONE = { draft: 'neutral', ready: 'amber', active: 'teal', archived: 'neutral' };
  var STATUS_LABEL = { draft: 'Draft', ready: 'Review', active: 'Published', archived: 'Archived' };
  var MODE_LABEL = { build: 'Build', var: 'Value-add', resell: 'Resell' };

  function statusLabel(s) { return STATUS_LABEL[String(s || 'draft').toLowerCase()] || (s || 'Draft'); }
  function statusTone(s) { return STATUS_TONE[String(s || 'draft').toLowerCase()] || 'neutral'; }
  function variantCount(p) { return Array.isArray(p.variants) ? p.variants.length : 0; }
  function variantsLabel(p) { var n = variantCount(p); return n > 0 ? (n + ' variants') : 'Default only'; }
  function categoryLabel(p) {
    if (p.category) return p.category;
    if (Array.isArray(p.categories) && p.categories.length) return p.categories.join(', ');
    return '';
  }
  function price(p) { return N.moneyVal(p, 'priceCents', 'price'); }
  function firstImage(p) {
    if (Array.isArray(p.images) && p.images.length) return p.images[0];
    return '';
  }
  function stamp(p, id) {
    p._key = id || p.pid || p._key;
    p._title = p.name || ('Product ' + (p._key || ''));
    return p;
  }

  // ── Variant model (mirrors legacy getProductVariantsForRender) ──────
  // Synthetic Default first (holds product-level base values), then real variants.
  function variantLabel(v) {
    if (!v || !v.combo) return 'Variant';
    var parts = Object.keys(v.combo).map(function (k) { return v.combo[k]; }).filter(Boolean);
    return parts.length ? parts.join(' / ') : 'Variant';
  }
  function variantPrice(p, v) {
    if (v && typeof v.priceCents === 'number') return v.priceCents / 100;
    return price(p); // inherits Default
  }
  function variantOverridden(p, v) {
    return !!(v && typeof v.priceCents === 'number' && v.priceCents !== p.priceCents);
  }
  function realVariants(p) {
    return (Array.isArray(p.variants) ? p.variants : []).map(function (v, i) {
      return Object.assign({ id: v.id || ('v' + i) }, v);
    });
  }

  // ════════════════ Entity: the product / Default ════════════════
  MastEntity.define('products-v2', {
    label: 'Product', labelPlural: 'Products', size: 'xl', route: 'products-v2',
    recordId: function (p) { return p._key || p.pid; },
    fields: [
      { name: '_title', label: 'Product', type: 'text', list: true, group: 'Product', readOnly: true },
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Lifecycle', readOnly: true,
        get: function (p) { return statusLabel(p.status); },
        tone: function (v) { var k = String(v || '').toLowerCase();
          if (k === 'review') return 'amber'; if (k === 'published') return 'teal'; return statusTone(k); } },
      { name: 'category', label: 'Category', type: 'text', list: true, group: 'Product', readOnly: true, get: categoryLabel },
      { name: 'mode', label: 'Mode', type: 'text', list: true, group: 'Product', readOnly: true,
        get: function (p) { return MODE_LABEL[p.acquisitionType || 'build'] || 'Build'; } },
      { name: 'variants', label: 'Variants', type: 'text', list: true, sortable: false, group: 'Product', readOnly: true, get: variantsLabel },
      { name: 'price', label: 'Price', type: 'money', list: true, group: 'Money', readOnly: true, align: 'right', get: price }
    ],
    fetch: function (id) {
      return Promise.resolve(MastDB.products.get(id)).then(function (p) { return p ? stamp(Object.assign({}, p), id) : null; });
    },
    // P0b read interior (P1 adds the MastFlow process header). Default = product-level.
    detail: {
      render: function (UU, p) {
        var tiles = UU.tiles([
          { k: 'Status', v: statusLabel(p.status), hero: true },
          { k: 'Price', v: N.money(price(p)) || '—' },
          { k: 'Variants', v: variantCount(p) || 'Default only' },
          { k: 'Mode', v: MODE_LABEL[p.acquisitionType || 'build'] || 'Build' }
        ]);
        var img = firstImage(p);
        var heroImg = img ? '<img src="' + esc(img) + '" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--border);float:left;margin:0 16px 8px 0;">' : '';
        var info = UU.kv([
          { k: 'Category', v: categoryLabel(p) || '—' },
          { k: 'Business line', v: p.businessLine || '—' },
          { k: 'Slug', v: p.slug || '—' },
          { k: 'Acquisition', v: MODE_LABEL[p.acquisitionType || 'build'] || 'Build' }
        ]);
        var desc = p.description ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.55;margin:6px 0 12px;">' + esc(String(p.description).slice(0, 320)) + '</div>' : '';
        var note = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">◆ Default — base for all variants. Process header + tab flow (Pricing · Recipe · Inventory · Channels · Image) arrive in P1.</div>';
        return UU.stickyHead(tiles, '') + '<div>' + heroImg + desc + UU.card('Overview', info) + note + '</div>';
      }
    }
  });

  // ════════════════ Entity: a single variant ════════════════
  // recordId = pid + '::' + variantId. fetch reconstructs the variant record.
  MastEntity.define('product-variant-v2', {
    label: 'Variant', labelPlural: 'Variants', size: 'lg', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Variant', type: 'text', list: true, group: 'Variant', readOnly: true }],
    fetch: function (id) { return Promise.resolve(buildVariantRecord(id)); },
    detail: {
      render: function (UU, r) {
        var p = r.product || {}, v = r.variant || {};
        var ov = variantOverridden(p, v);
        var swatchPrice = N.money(variantPrice(p, v)) || '—';
        var tiles = UU.tiles([
          { k: 'Price', v: swatchPrice, hero: true },
          { k: 'Source', v: ov ? 'Override' : 'Inherits Default' },
          { k: 'Product', v: p.name || '—' },
          { k: 'Status', v: statusLabel(p.status) + ' (product)' }
        ]);
        function inhRow(label, val, from) {
          return '<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);font-size:0.9rem;">' +
            '<span style="color:var(--warm-gray);width:120px;flex-shrink:0;">' + esc(label) + '</span>' +
            '<span style="color:var(--text);">' + val + ' <span style="color:var(--warm-gray);font-size:0.78rem;">· ' + esc(from) + '</span></span>' +
            '<span style="margin-left:auto;"><button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantTodo()">Override</button></span></div>';
        }
        var rows =
          inhRow('Retail price', N.money(variantPrice(p, v)) || '—', ov ? 'overridden' : 'inherited from Default') +
          inhRow('SKU', esc(v.sku || '—'), v.sku ? 'set' : 'not set') +
          inhRow('Recipe / cost', '—', 'inherits the base recipe') +
          inhRow('Inventory', 'Build to order', 'inherited') +
          inhRow('Image', 'Shared product image', 'inherited');
        var back = '<div style="margin-top:14px;"><button class="btn btn-secondary btn-small" onclick="ProductsV2.open(\'' + esc(p._key || p.pid) + '\')">← Back to Default (' + esc(p.name || 'product') + ')</button></div>';
        var note = '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:10px;">A variant has no process — it follows the product. Full per-tab inherit/override arrives in P2.</div>';
        return UU.stickyHead(tiles, '') + '<div>' + UU.card('Variant details', rows) + back + note + '</div>';
      }
    }
  });

  function buildVariantRecord(id) {
    var parts = String(id || '').split('::'); var pid = parts[0], vid = parts[1];
    var p = V2.byId[pid];
    if (!p) return null;
    var v = realVariants(p).filter(function (x) { return x.id === vid; })[0] || { id: vid, combo: {} };
    return { _key: id, _title: (p.name || 'Product') + ' — ' + variantLabel(v), product: p, variant: v };
  }

  // ── State + data ────────────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: '_title', sortDir: 'asc', filter: 'all', expanded: {} };

  function toRows(map) {
    var out = []; map = map || {};
    Object.keys(map).forEach(function (k) {
      var p = map[k]; if (!p || typeof p !== 'object') return;
      out.push(stamp(Object.assign({}, p), p.pid || k));
    });
    return out;
  }
  function load() {
    if (!window.MastDB || !MastDB.products) return;
    Promise.resolve(MastDB.products.get()).then(function (map) {
      V2.rows = toRows(map);
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
    if (V2.filter && V2.filter !== 'all') rows = rows.filter(function (r) { return String(r.status || 'draft').toLowerCase() === V2.filter; });
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
  function ensureStyles() {
    if (document.getElementById('pv2-styles')) return;
    var s = document.createElement('style'); s.id = 'pv2-styles';
    s.textContent = [
      '.pv2-list{border:1px solid var(--border);border-radius:12px;overflow:hidden;}',
      '.pv2-row{display:grid;grid-template-columns:26px 44px 1fr 120px 96px 96px;gap:12px;align-items:center;padding:11px 14px;border-bottom:1px solid var(--border);cursor:pointer;font-size:0.9rem;}',
      '.pv2-row:last-child{border-bottom:0;} .pv2-row:hover{background:color-mix(in srgb,var(--amber) 6%,transparent);}',
      '.pv2-exp{background:transparent;border:0;color:var(--warm-gray);font-size:0.78rem;cursor:pointer;width:22px;padding:4px;border-radius:5px;}',
      '.pv2-exp:hover{color:var(--text);} .pv2-exp.sp{visibility:hidden;}',
      '.pv2-row img.th{width:40px;height:40px;border-radius:7px;object-fit:cover;border:1px solid var(--border);}',
      '.pv2-row .ph{width:40px;height:40px;border-radius:7px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--warm-gray);font-size:0.85rem;}',
      '.pv2-nm{color:var(--text);} .pv2-meta{color:var(--warm-gray);} .pv2-r{text-align:right;font-variant-numeric:tabular-nums;}',
      '.pv2-sub{background:color-mix(in srgb,black 14%,transparent);} .pv2-sub .pv2-nm{padding-left:8px;display:flex;align-items:center;gap:8px;}',
      '.pv2-def .pv2-nm{color:var(--info);font-weight:600;padding-left:8px;display:flex;align-items:center;gap:8px;}',
      '.pv2-add .pv2-nm{color:var(--teal);padding-left:8px;}',
      '.pv2-branch{color:var(--warm-gray);font-size:0.78rem;}',
      '.pv2-ov{font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em;background:color-mix(in srgb,var(--amber) 22%,transparent);color:var(--amber);padding:2px 7px;border-radius:5px;margin-left:6px;}'
    ].join('');
    document.head.appendChild(s);
  }

  function rowHtml(p) {
    var has = variantCount(p) > 0;
    var img = firstImage(p);
    var thumb = img ? '<img class="th" src="' + esc(img) + '" alt="">' : '<div class="ph">' + esc((p.name || 'P').slice(0, 1)) + '</div>';
    var exp = has
      ? '<button class="pv2-exp" onclick="event.stopPropagation();ProductsV2.toggle(\'' + esc(p._key) + '\')">' + (V2.expanded[p._key] ? '▼' : '▶') + '</button>'
      : '<button class="pv2-exp sp"></button>';
    var badge = U.badge(statusLabel(p.status), statusTone(p.status));
    var html = '<div class="pv2-row" onclick="ProductsV2.open(\'' + esc(p._key) + '\')" tabindex="0" role="button">' +
      exp + thumb +
      '<span class="pv2-nm">' + esc(p.name || '(unnamed)') + ' <span class="pv2-meta">· ' + esc(categoryLabel(p) || '—') + '</span></span>' +
      '<span>' + badge + '</span>' +
      '<span class="pv2-r pv2-meta">' + (N.money(price(p)) || '—') + '</span>' +
      '<span class="pv2-r pv2-meta">' + variantsLabel(p) + '</span></div>';
    if (has && V2.expanded[p._key]) {
      // Default row
      html += '<div class="pv2-row pv2-sub pv2-def" onclick="ProductsV2.open(\'' + esc(p._key) + '\')" tabindex="0" role="button">' +
        '<span class="pv2-exp sp"></span><span></span>' +
        '<span class="pv2-nm"><span class="pv2-branch">└</span>◆ Default <span class="pv2-meta" style="font-weight:400;">· base for all variants</span></span>' +
        '<span></span><span class="pv2-r pv2-meta">' + (N.money(price(p)) || '—') + '</span><span class="pv2-r pv2-meta">' + variantCount(p) + ' inherit</span></div>';
      // Variant rows
      realVariants(p).forEach(function (v) {
        var ov = variantOverridden(p, v);
        html += '<div class="pv2-row pv2-sub" onclick="ProductsV2.openVariant(\'' + esc(p._key + '::' + v.id) + '\')" tabindex="0" role="button">' +
          '<span class="pv2-exp sp"></span><span></span>' +
          '<span class="pv2-nm"><span class="pv2-branch">└</span>' + esc(variantLabel(v)) + (ov ? '<span class="pv2-ov">override</span>' : '') + '</span>' +
          '<span class="pv2-meta" style="font-size:0.78rem;">follows product</span>' +
          '<span class="pv2-r pv2-meta"' + (ov ? ' style="color:var(--amber);"' : '') + '>' + (N.money(variantPrice(p, v)) || '—') + '</span>' +
          '<span class="pv2-r pv2-meta">' + (ov ? 'override' : 'inherits') + '</span></div>';
      });
      // Add-variant row
      html += '<div class="pv2-row pv2-sub pv2-add" onclick="ProductsV2.addVariant(\'' + esc(p._key) + '\')" tabindex="0" role="button">' +
        '<span class="pv2-exp sp"></span><span></span>' +
        '<span class="pv2-nm"><span class="pv2-branch">└</span>+ Add variant <span class="pv2-meta">· inherits the Default, then override</span></span>' +
        '<span></span><span></span><span></span></div>';
    }
    return html;
  }

  function render() {
    var tab = ensureTab(); ensureStyles();
    var counts = statusCounts();
    var pills = ['all', 'draft', 'ready', 'active', 'archived'].map(function (s) {
      var on = V2.filter === s; var label = s === 'all' ? 'All' : statusLabel(s);
      return '<button onclick="ProductsV2.setFilter(\'' + s + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--charcoal,var(--text))' : 'var(--warm-gray)') + ';border-radius:999px;padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        label + ' <span style="color:var(--warm-gray);">' + (counts[s] || 0) + '</span></button>';
    }).join('');
    var rows = visibleRows();
    var body = rows.length
      ? '<div class="pv2-list">' + rows.map(rowHtml).join('') + '</div>'
      : '<div style="padding:46px;text-align:center;color:var(--warm-gray);">No products match these filters.</div>';
    tab.innerHTML =
      U.pageHeader({ title: 'Products', count: N.count(V2.rows.length) + ' products',
        actionsHtml: '<button class="btn btn-secondary" onclick="ProductsV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;">' + pills + '</div>' + body;
  }

  window.ProductsV2 = {
    setFilter: function (s) { V2.filter = s; render(); },
    toggle: function (id) { V2.expanded[id] = !V2.expanded[id]; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) MastEntity.openRecord('products-v2', rec, 'read'); },
    openVariant: function (key) { var rec = buildVariantRecord(key); if (rec) MastEntity.openRecord('product-variant-v2', rec, 'read'); },
    addVariant: function (id) {
      var p = V2.byId[id];
      MastAdmin.showToast('Add variant for "' + (p ? p.name : id) + '" — write flow lands in P4 (inherits the Default).');
    },
    editVariantTodo: function () { MastAdmin.showToast('Per-variant override editing lands in P2/P3.'); },
    exportCsv: function () { return MastEntity.exportRows('products-v2', visibleRows(), V2.filter); }
  };

  MastAdmin.registerModule('products-v2', {
    routes: { 'products-v2': { tab: 'productsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
