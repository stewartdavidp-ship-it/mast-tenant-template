/**
 * products-v2.js — the products surface, rebuilt on the Entity Engine.
 *
 * Build plan: docs/ux-audit/products-v2-build-plan.md (design ratified).
 * The most complex object in the app — process x variants x sub-objects.
 *
 * Phasing (flag-gated #products-v2, side-by-side with legacy):
 *   P0a  list + read SO                                   done (PR 180, 181)
 *   P0b  variant-expanding list + variant SO              done (PR 183)
 *   P1   Default/product SO: process header + tab flow    <- this commit
 *   P2   variant SO: full inherit/override tabs
 *   P3   edit-in-V2 via MakerProductBridge + real Advance
 *   P4   add-variant write + per-variant overrides
 *   P5   Revising loop, flip default, retire legacy
 *
 * The list renders products -> expand to the synthetic Default + variants inline
 * + "Add variant". The slide-out presents ONE object: a Default/product (process
 * + tab flow) OR a single variant (inherit/override).
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
  function firstImage(p) { return (Array.isArray(p.images) && p.images.length) ? p.images[0] : ''; }
  function stamp(p, id) { p._key = id || p.pid || p._key; p._title = p.name || ('Product ' + (p._key || '')); return p; }

  function variantLabel(v) {
    if (!v || !v.combo) return 'Variant';
    var parts = Object.keys(v.combo).map(function (k) { return v.combo[k]; }).filter(Boolean);
    return parts.length ? parts.join(' / ') : 'Variant';
  }
  function variantPrice(p, v) { return (v && typeof v.priceCents === 'number') ? v.priceCents / 100 : price(p); }
  function variantOverridden(p, v) { return !!(v && typeof v.priceCents === 'number' && v.priceCents !== p.priceCents); }
  function realVariants(p) {
    return (Array.isArray(p.variants) ? p.variants : []).map(function (v, i) { return Object.assign({ id: v.id || ('v' + i) }, v); });
  }

  // The variant switcher — ONE compact pill (low clutter, V1's failure was a
  // million things at once). At rest it shows only where you are; click opens a
  // popover to jump to the Default or any variant in place. currentVid = null on
  // the Default, or the variant id on a variant. No pill on a variant-less product.
  function variantSwitcherHtml(p, currentVid) {
    if (variantCount(p) === 0) return '';
    var pid = p._key || p.pid;
    var curLabel = currentVid
      ? variantLabel(realVariants(p).filter(function (x) { return x.id === currentVid; })[0] || { combo: {} })
      : '◆ Default';
    function item(label, isCur, onclick) {
      return '<button class="pv2-vitem"' + (isCur ? ' aria-current="true"' : '') + ' onclick="' + onclick + '">' +
        '<span class="vchk">' + (isCur ? '✓' : '') + '</span>' + label + '</button>';
    }
    var items = item('◆ Default <span class="pv2-meta" style="font-weight:400;">· base</span>', !currentVid, 'ProductsV2.open(\'' + esc(pid) + '\')');
    realVariants(p).forEach(function (v) {
      var tag = variantOverridden(p, v) ? ' <span class="pv2-meta" style="font-weight:400;">· custom price</span>' : '';
      items += item(esc(variantLabel(v)) + tag, currentVid === v.id, 'ProductsV2.openVariant(\'' + esc(pid + '::' + v.id) + '\')');
    });
    return '<div class="pv2-vswitch">' +
      '<button class="pv2-vpill" onclick="ProductsV2.toggleSwitcher(this)" title="Switch variant">' + esc(curLabel) + ' <span class="vcaret">▾</span></button>' +
      '<div class="pv2-vpop" hidden><div class="pv2-vpop-h">Switch to…</div>' + items + '</div></div>';
  }

  // Slide-out header strip: image thumbnail (click → full size) + the variant
  // switcher pill, on one line. Empty when there's neither.
  function headerStrip(p, imgSrc, imgName, currentVid) {
    var pid = p._key || p.pid;
    var drillId = currentVid ? (pid + '::' + currentVid) : pid;
    // The thumbnail drills into the image slide-out (all the product's images,
    // this object's image in large focus) — a stacked SO with Back, not a lightbox.
    var thumb = imgSrc
      ? '<button class="pv2-hthumb" onclick="MastEntity.drill(\'product-images-v2\',\'' + esc(drillId) + '\')" style="background-image:url(' + esc(imgSrc) + ');" title="View all images"><span class="mu-zoom">⤢</span></button>'
      : '';
    var sw = variantSwitcherHtml(p, currentVid);
    if (!thumb && !sw) return '';
    return '<div style="display:flex;align-items:center;gap:12px;margin:0 0 12px;flex-wrap:wrap;">' + thumb + sw + '</div>';
  }

  // ── Maker integration ───────────────────────────────────────────────
  // The engine MastFlow process model (detail.flow) needs maker loaded:
  // products.workflow's readiness predicates call window.makerComputeReadinessChecklist,
  // and Advance routes to the side-effect-bearing window.makerPromoteToReady /
  // makerLaunchToActive. Lazy-loaded before a product SO opens so the MastFlow
  // header renders with live readiness + the real handlers are available.
  function ensureMaker(cb) {
    if (window.makerComputeReadinessChecklist && window.makerPromoteToReady) return cb();
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') MastAdmin.loadModule('maker').then(cb).catch(cb);
    else cb();
  }
  // After a real advance, re-open the v2 SO from fresh data (the legacy handlers
  // re-render legacy views, not ours) so the stepper/badge reflect the new phase.
  function reopenProduct(pid) {
    Promise.resolve(MastDB.products.get(pid)).then(function (p) {
      if (!p) return;
      var rec = stamp(Object.assign({}, p), pid); V2.byId[pid] = rec;
      MastEntity.openRecord('products-v2', rec, 'read');
    });
  }
  function pricingPane(p) {
    var rows = [{ k: 'Retail price', v: N.money(price(p)) || '—' }];
    if (typeof p.wholesalePriceCents === 'number' && p.wholesalePriceCents > 0) rows.push({ k: 'Wholesale', v: N.money(p.wholesalePriceCents / 100) });
    rows.push({ k: 'Cost basis', v: p.recipeId ? 'From recipe (see Recipe tab)' : 'Manually priced' });
    var nOv = realVariants(p).filter(function (v) { return variantOverridden(p, v); }).length;
    rows.push({ k: 'Variant overrides', v: nOv ? (nOv + ' variant' + (nOv > 1 ? 's' : '')) : 'none' });
    return U.card('Pricing · Default (base)', U.kv(rows)) + '<div class="pv2-pnote">Base price propagates to every non-overridden variant. Editing lands in P3.</div>';
  }
  function recipePane(p) {
    if (p.recipeId) {
      return U.card('Recipe', U.kv([{ k: 'Status', v: 'Linked' }, { k: 'Recipe id', v: p.recipeId }])) +
        '<button class="btn btn-secondary btn-small" onclick="MastEntity.drill(\'recipe-v2\',\'' + esc(p.recipeId) + '\')">Open recipe →</button>' +
        '<span class="pv2-temp"> opens as its own stacked SO — Back returns here</span>';
    }
    return U.card('Recipe', '<span style="color:var(--warm-gray);">No recipe linked.</span>');
  }
  function inventoryPane(p) {
    var si = p.stockInfo || {};
    var hasVar = variantCount(p) > 0;
    // Inventory is per-VARIANT — it's never inherited. For a product with
    // variants the product-level number is the roll-up; each variant owns its
    // own stock (edit it on the variant's Inventory tab).
    var title = hasVar ? 'Inventory · all variants (roll-up)' : 'Inventory';
    var perVarNote = hasVar
      ? '<div class="pv2-pnote">Stock is tracked per variant — each one has its own count. The total above is the roll-up; set each variant’s stock on its Inventory tab.</div>'
      : '';
    return U.card(title, U.kv([
      { k: 'Stock type', v: si.stockType || '—' },
      { k: (hasVar ? 'On hand (all variants)' : 'On hand'), v: (si.totalOnHand != null ? String(si.totalOnHand) : '—') },
      { k: 'Low-stock at', v: (si.lowStockThreshold != null ? String(si.lowStockThreshold) : '—') },
      { k: 'Fulfillment', v: (si.stockFulfillmentDays != null ? si.stockFulfillmentDays + ' days' : '—') },
      { k: 'Wholesale MOQ', v: (p.moq != null ? String(p.moq) : '—') },
      { k: 'Case pack', v: (p.casePack != null ? String(p.casePack) : '—') }
    ]) + perVarNote);
  }
  function channelsPane(p) {
    var er = p.externalRefs || {};
    function ch(name, ref) { var on = ref && (ref.externalId || ref.syncEnabled); return { k: name, v: on ? U.badge('Mapped', 'teal') : U.badge('Off', 'neutral') }; }
    return U.card('Channels · product-level', U.kv([
      ch('Shopify', er.shopify), ch('Etsy', er.etsy), ch('Square', er.square),
      { k: 'Internal storefront', v: U.badge('On', 'teal') }
    ]));
  }
  function imagePane(p) {
    var imgs = Array.isArray(p.images) ? p.images : [];
    var thumbs = imgs.slice(0, 8).map(function (src) { return '<img class="pv2-galimg" src="' + esc(src) + '" alt="">'; }).join('') || '<span style="color:var(--warm-gray);">No images.</span>';
    var d = p.description ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.55;">' + esc(String(p.description).slice(0, 300)) + '</div>' : '';
    return U.card('Images (' + imgs.length + ')', '<div style="display:flex;flex-wrap:wrap;">' + thumbs + '</div>') + (d ? U.card('Description', d) : '');
  }
  function infoPane(p) {
    return U.card('Info · product-level', U.kv([
      { k: 'Category', v: categoryLabel(p) || '—' },
      { k: 'Business line', v: p.businessLine || '—' },
      { k: 'Slug', v: p.slug || '—' },
      { k: 'Acquisition', v: MODE_LABEL[p.acquisitionType || 'build'] || 'Build' },
      { k: 'SKU', v: p.sku || '—' }
    ]));
  }

  // ════════════════ Entity: the product / Default ════════════════
  MastEntity.define('products-v2', {
    label: 'Product', labelPlural: 'Products', size: 'xl', route: 'products-v2',
    recordId: function (p) { return p._key || p.pid; },
    fields: [
      { name: '_title', label: 'Product', type: 'text', list: true, group: 'Product', readOnly: true },
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Lifecycle', readOnly: true,
        get: function (p) { return statusLabel(p.status); },
        tone: function (v) { var k = String(v || '').toLowerCase(); if (k === 'review') return 'amber'; if (k === 'published') return 'teal'; return statusTone(k); } },
      { name: 'category', label: 'Category', type: 'text', list: true, group: 'Product', readOnly: true, get: categoryLabel },
      { name: 'mode', label: 'Mode', type: 'text', list: true, group: 'Product', readOnly: true, get: function (p) { return MODE_LABEL[p.acquisitionType || 'build'] || 'Build'; } },
      { name: 'variants', label: 'Variants', type: 'text', list: true, sortable: false, group: 'Product', readOnly: true, get: variantsLabel },
      { name: 'price', label: 'Price', type: 'money', list: true, group: 'Money', readOnly: true, align: 'right', get: price }
    ],
    fetch: function (id) { return Promise.resolve(MastDB.products.get(id)).then(function (p) { return p ? stamp(Object.assign({}, p), id) : null; }); },
    // Default/product SO: the ENGINE MastFlow process model. detail.flow makes the
    // engine render the real process header (stepper + readiness checklist + guarded
    // Advance) into #muFlowHost — the process is the pinned STRUCTURE, not a tab
    // (matches the ratified mock + the orders/commissions engine standard).
    detail: {
      flow: 'products',
      flowModule: 'productsWorkflow',
      // Pilot the ratified lean guided-record header (clickable step rail +
      // checklist-into-tabs, no Advance button). Opt-in flag read by
      // mast-entity._flowRender; orders/commissions stay on renderHeader.
      guidedHeader: true,
      // Advance runs the REAL promote/launch (gates + confirm + Shopify publish on
      // launch), not the engine's generic status transition — via the additive
      // onFlowAdvance hook. Mirrors maker.js's own onAdvance interception.
      onFlowAdvance: function (target, rec) {
        var pid = rec._key || rec.id || rec.pid;
        var fn = target === 'active' ? 'makerLaunchToActive' : (target === 'ready' ? 'makerPromoteToReady' : null);
        if (!fn) return false; // back/branch → generic transition
        ensureMaker(function () {
          if (!window[fn]) { MastAdmin.showToast('Maker not available'); return; }
          Promise.resolve(window.loadProducts ? window.loadProducts() : null).then(function () {
            Promise.resolve(window[fn](pid)).then(function () { reopenProduct(pid); }, function () { reopenProduct(pid); });
          });
        });
        return true; // handled
      },
      // Checklist "Go →" targets → focus the relevant V2 pane in place (the
      // record stays open; the requirement points INTO the live record, per the
      // guided-record model). Spec requirement targets → V2 pane key:
      //   define-section   (mode-chosen / defined)  → Recipe
      //   markup-section   (costed)                 → Pricing
      //   listing-section  (listingReady)           → Image
      //   channels-section (channeled)              → Channels
      // capacity-section has no v2 pane yet → fall back to the legacy define
      // deep-link below.
      onFlowTarget: function (targetId, rec) {
        var pid = rec._key || rec.id || rec.pid;
        var PANE = {
          'define-section': 'recipe',
          'markup-section': 'pricing',
          'listing-section': 'image',
          'channels-section': 'channels'
        };
        var pane = PANE[targetId];
        if (pane) {
          var body = document.getElementById('mastSlideOutBody');
          var btn = body && body.querySelector('.mu-ptabs button[onclick*="\'' + pane + '\'"]');
          if (btn) { btn.click(); if (typeof btn.scrollIntoView === 'function') btn.scrollIntoView({ block: 'nearest' }); return true; }
        }
        // Fallback: no matching v2 pane (e.g. capacity) → legacy define deep-link.
        ensureMaker(function () {
          if (typeof navigateToClassic === 'function') navigateToClassic('products');
          setTimeout(function () {
            if (window.makerOpenDefineForProduct) window.makerOpenDefineForProduct(pid);
            if (window.makerScrollToReadinessSection) setTimeout(function () { window.makerScrollToReadinessSection(targetId); }, 220);
          }, 160);
        });
        return true;
      },
      render: function (UU, p) {
        var tiles = UU.tiles([
          { k: 'Status', v: statusLabel(p.status), hero: true },
          { k: 'Price', v: N.money(price(p)) || '—' },
          { k: 'Variants', v: variantCount(p) || 'Default only' },
          { k: 'On hand', v: ((p.stockInfo && p.stockInfo.totalOnHand) != null ? String(p.stockInfo.totalOnHand) : '—') }
        ]);
        var tabs = [
          { key: 'pricing', label: 'Pricing' }, { key: 'recipe', label: 'Recipe' }, { key: 'inventory', label: 'Inventory' },
          { key: 'channels', label: 'Channels' }, { key: 'image', label: 'Image' }, { key: 'info', label: 'Info' }
        ];
        function pane(key, html, active) { return '<div class="mu-pane" data-pane="' + key + '"' + (active ? '' : ' hidden') + '>' + html + '</div>'; }
        // When the product has variants, make it unmistakable you're on the
        // Default (the base every variant inherits) — not a single variant.
        var nv = variantCount(p);
        var defaultBanner = nv > 0
          ? '<div style="margin:0 0 10px;padding:7px 12px;border-radius:8px;background:color-mix(in srgb,var(--info) 13%,transparent);color:var(--info);font-size:0.85rem;font-weight:600;">◆ Default — base for all ' + nv + ' variant' + (nv > 1 ? 's' : '') + '. Edits here apply to every variant unless it overrides.</div>'
          : '';
        // Product image thumbnail on the header — click for the full-size picture.
        // Header strip: product image thumbnail + the variant switcher pill.
        // #muFlowHost: the engine injects the MastFlow process header here (the structure).
        return headerStrip(p, firstImage(p), p.name || 'Product', null) + defaultBanner + UU.stickyHead(tiles, '') +
          '<div id="muFlowHost" class="pv2-flowhost">Loading workflow…</div>' +
          UU.paneTabsBar(tabs, 'pricing') +
          pane('pricing', pricingPane(p), true) +
          pane('recipe', recipePane(p)) +
          pane('inventory', inventoryPane(p)) +
          pane('channels', channelsPane(p)) +
          pane('image', imagePane(p)) +
          pane('info', infoPane(p));
      }
    }
  });

  // ════════════════ Entity: a single variant ════════════════
  MastEntity.define('product-variant-v2', {
    label: 'Variant', labelPlural: 'Variants', size: 'lg', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Variant', type: 'text', list: true, group: 'Variant', readOnly: true }],
    fetch: function (id) { return Promise.resolve(buildVariantRecord(id)); },
    detail: {
      render: function (UU, r) {
        var p = r.product || {}, v = r.variant || {};
        var ov = variantOverridden(p, v);
        var tiles = UU.tiles([
          { k: 'Price', v: N.money(variantPrice(p, v)) || '—', hero: true },
          { k: 'Source', v: ov ? 'Custom price' : 'Same as Default' },
          { k: 'Product', v: p.name || '—' },
          { k: 'Status', v: statusLabel(p.status) + ' (follows product)' }
        ]);
        // One row: a variant USES the Default for anything it doesn't set itself.
        // "custom" = this variant has its own value. setVerb = the call to action
        // when it's still shared (no "override" framing). Editing lands in P4.
        function row(label, value, state, isCustom, setVerb) {
          var btn = isCustom ? 'Edit' : (setVerb || 'Customize');
          return '<div class="pv2-inh"><span class="il">' + esc(label) + '</span>' +
            '<span class="iv"' + (isCustom ? ' style="color:var(--amber);font-weight:600;"' : '') + '>' + value + ' <span class="from">· ' + esc(state) + '</span></span>' +
            '<span class="ov"><button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantTodo()">' + esc(btn) + '</button></span></div>';
        }
        var tabs = [{ key: 'v-pricing', label: 'Pricing' }, { key: 'v-recipe', label: 'Recipe' }, { key: 'v-channels', label: 'Channels' }, { key: 'v-inventory', label: 'Inventory' }, { key: 'v-image', label: 'Image' }];
        function pane(key, html, active) { return '<div class="mu-pane" data-pane="' + key + '"' + (active ? '' : ' hidden') + '>' + html + '</div>'; }
        var ctx = '<div class="pv2-pnote">A variant uses the Default’s values for anything it doesn’t set itself. It has no lifecycle of its own — it follows the product.</div>';
        // Header strip: variant image (its own if set, else the product's) +
        // the variant switcher pill (current = this variant).
        var vimg = (v.image || v.imageUrl) || firstImage(p);
        return headerStrip(p, vimg, (p.name || 'Variant') + ' — ' + variantLabel(v), v.id) + UU.stickyHead(tiles, UU.paneTabsBar(tabs, 'v-pricing')) +
          pane('v-pricing', UU.card('Pricing', row('Retail price', N.money(variantPrice(p, v)) || '—', ov ? 'custom for this variant' : 'same as Default', ov, 'Set a custom price') + row('SKU', esc(v.sku || '—'), v.sku ? 'set for this variant' : 'uses the Default', !!v.sku, 'Set a SKU')) + ctx, true) +
          pane('v-recipe', UU.card('Recipe', row('Recipe', 'Product recipe', 'shared with the product', false, 'Give it its own recipe')) + '<div class="pv2-pnote">This variant uses the product’s recipe. Give it its own only if it’s actually made differently.</div>') +
          pane('v-channels', UU.card('Channels', row('Shopify', 'Live', 'same as the product', false, 'Map separately'))) +
          pane('v-inventory', UU.card('Inventory · this variant', UU.kv([
            { k: 'Stock type', v: (v.stockType || '—') },
            { k: 'On hand', v: (v.onHand != null ? String(v.onHand) : '—') },
            { k: 'Reorder at', v: (v.reorderAt != null ? String(v.reorderAt) : '—') }
          ]) + '<div class="pv2-pnote">Each variant tracks its <strong>own</strong> stock — inventory is never shared with or inherited from the Default.</div>')) +
          pane('v-image', UU.card('Image', row('Image', 'Product image', 'same as the product', false, 'Set a variant image')));
      }
    }
  });

  // ════════════════ Entity: a recipe (stacked SO, drilled from the product) ════════════════
  // The "tab summary → edit opens its own full-size SO → Back collapses to the
  // calling tab" pattern (operator-ratified). drill() pushes a back frame, so
  // Recipe → Back returns to the Default. Replaces the legacy recipe-builder
  // deep-link with a native V2 surface (debt register item cleared, read side).
  MastEntity.define('recipe-v2', {
    label: 'Recipe', labelPlural: 'Recipes', size: 'lg', route: null,
    recordId: function (r) { return r.recipeId || r._key; },
    fields: [{ name: 'name', label: 'Recipe', type: 'text', list: true, group: 'Recipe', readOnly: true }],
    fetch: function (id) {
      return Promise.resolve(MastDB.recipes.get(id)).then(function (rc) {
        if (!rc) return null; rc.recipeId = rc.recipeId || id; rc.name = rc.name || 'Recipe'; return rc;
      });
    },
    detail: {
      render: function (UU, rc) {
        var li = rc.lineItems || {};
        var rows = Object.keys(li).map(function (k) {
          var m = li[k] || {};
          var qty = (m.quantity != null ? m.quantity : '') + (m.unitOfMeasure ? (' ' + m.unitOfMeasure) : '');
          return '<tr><td>' + esc(m.materialName || '—') + '</td><td class="r">' + esc(qty) + '</td><td class="r">' + (N.money(m.unitCost) || '—') + '</td><td class="r">' + (N.money(m.extendedCost) || '—') + '</td></tr>';
        }).join('');
        var bom = '<table class="pv2-bom"><thead><tr><th>Material</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Ext</th></tr></thead><tbody>' + rows + '</tbody></table>';
        var tiles = UU.tiles([
          { k: 'Unit cost', v: N.money(rc.totalCost) || '—', hero: true },
          { k: 'Status', v: rc.status || '—' },
          { k: 'Materials', v: Object.keys(li).length },
          { k: 'Active tier', v: rc.activePriceTier || '—' }
        ]);
        var cost = UU.kv([
          { k: 'Materials', v: N.money(rc.totalMaterialCost) || '—' },
          { k: 'Labor', v: N.money(rc.laborCost) || '—' },
          { k: 'Other', v: N.money(rc.otherCost) || '—' },
          { k: 'Unit cost', v: N.money(rc.totalCost) || '—' }
        ]);
        var pr = UU.kv([
          { k: 'Active tier', v: rc.activePriceTier || '—' },
          { k: 'Retail', v: N.money(rc.retailPrice) || '—' },
          { k: 'Retail margin', v: (rc.retailMarginPct != null ? rc.retailMarginPct + '%' : '—') }
        ]);
        return UU.stickyHead(tiles, '') + '<div>' + UU.card('Bill of materials', bom) + UU.card('Cost', cost) + UU.card('Pricing', pr) +
          '<div class="pv2-pnote">Drilled from the product — Back returns to the Default. Recipe editing lands in P3.</div></div>';
      }
    }
  });

  // ════════════════ Entity: the image slide-out (drilled from the header) ════════════════
  // "Stick to SO" — clicking the header image drills into its own stacked slide-out
  // (Back collapses to the caller). Shows ALL the product's images, with the
  // Default's (or the variant's) image in large focus.
  MastEntity.define('product-images-v2', {
    label: 'Images', labelPlural: 'Images', size: 'lg', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Images', type: 'text', list: true, group: 'Images', readOnly: true }],
    fetch: function (id) {
      var parts = String(id || '').split('::'); var pid = parts[0], vid = parts[1];
      var p = V2.byId[pid]; if (!p) return null;
      var imgs = (Array.isArray(p.images) ? p.images : []).slice();
      var focus = 0, label = p.name || 'Product';
      if (vid) {
        var v = realVariants(p).filter(function (x) { return x.id === vid; })[0];
        label += ' — ' + variantLabel(v || { combo: {} });
        var vimg = v && (v.image || v.imageUrl);
        if (vimg) { var fi = imgs.indexOf(vimg); if (fi >= 0) focus = fi; else { imgs.unshift(vimg); focus = 0; } }
      }
      return { _key: id, _title: label + ' · Images', product: p, images: imgs, focus: focus };
    },
    detail: {
      render: function (UU, r) {
        var imgs = r.images || [];
        if (!imgs.length) return UU.card('Images', '<span style="color:var(--warm-gray);">No images for this product yet.</span>');
        var focusSrc = imgs[r.focus] || imgs[0];
        var large = '<div class="pv2-imgfocus"><img id="pv2ImgLarge" src="' + esc(focusSrc) + '" alt=""></div>';
        var strip = '<div class="pv2-imgstrip">' + imgs.map(function (src, i) {
          return '<button class="pv2-imgthumb' + (i === r.focus ? ' on' : '') + '" onclick="ProductsV2.focusImage(\'' + esc(src) + '\',this)"><img src="' + esc(src) + '" alt=""></button>';
        }).join('') + '</div>';
        return '<div class="pv2-pnote" style="margin-bottom:10px;">All images for ' + esc(r.product.name || 'this product') + ' — click a thumbnail to view it large.</div>' +
          UU.card('Focused', large) + UU.card('All images (' + imgs.length + ')', strip);
      }
    }
  });

  function buildVariantRecord(id) {
    var parts = String(id || '').split('::'); var pid = parts[0], vid = parts[1];
    var p = V2.byId[pid]; if (!p) return null;
    var v = realVariants(p).filter(function (x) { return x.id === vid; })[0] || { id: vid, combo: {} };
    return { _key: id, _title: (p.name || 'Product') + ' — ' + variantLabel(v), product: p, variant: v };
  }

  // ── State + data ────────────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: '_title', sortDir: 'asc', filter: 'all', expanded: {} };

  function toRows(map) {
    var out = []; map = map || {};
    Object.keys(map).forEach(function (k) { var p = map[k]; if (!p || typeof p !== 'object') return; out.push(stamp(Object.assign({}, p), p.pid || k)); });
    return out;
  }
  function load() {
    if (!window.MastDB || !MastDB.products) return;
    Promise.resolve(MastDB.products.get()).then(function (map) {
      V2.rows = toRows(map); V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; }); render();
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
      '.pv2-vswitch{position:relative;display:inline-block;}',
      '.pv2-vpill{background:color-mix(in srgb,var(--text) 8%,transparent);border:1px solid var(--border);color:var(--text);border-radius:999px;padding:5px 13px;font-size:0.85rem;cursor:pointer;font-family:inherit;}',
      '.pv2-vpill:hover{background:color-mix(in srgb,var(--text) 14%,transparent);}',
      '.vcaret{color:var(--warm-gray);font-size:0.72rem;margin-left:2px;}',
      '.pv2-vpop{position:absolute;top:calc(100% + 5px);left:0;z-index:60;min-width:230px;background:var(--surface-card,var(--bg));border:1px solid var(--border-strong,var(--border));border-radius:11px;box-shadow:0 14px 36px rgba(0,0,0,0.45);padding:5px;display:flex;flex-direction:column;gap:1px;}',
      '.pv2-vpop[hidden]{display:none;}',
      '.pv2-vpop-h{font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.04em;padding:6px 9px 4px;}',
      '.pv2-vitem{display:flex;align-items:center;gap:6px;background:transparent;border:0;color:var(--text);font:inherit;font-size:0.85rem;text-align:left;padding:7px 9px;border-radius:7px;cursor:pointer;white-space:nowrap;}',
      '.pv2-vitem:hover{background:color-mix(in srgb,var(--amber) 13%,transparent);}',
      '.pv2-vitem[aria-current="true"]{color:var(--teal);font-weight:600;}',
      '.vchk{display:inline-block;width:12px;color:var(--teal);font-size:0.72rem;flex-shrink:0;}',
      '.pv2-hthumb{width:64px;height:64px;border-radius:9px;border:1px solid var(--border);background-size:cover;background-position:center;padding:0;position:relative;cursor:zoom-in;flex:0 0 64px;}',
      '.pv2-hthumb:hover{box-shadow:0 0 0 2px var(--amber);} .pv2-hthumb .mu-zoom{position:absolute;right:3px;bottom:3px;width:16px;height:16px;border-radius:4px;background:rgba(0,0,0,.55);color:white;font-size:0.72rem;display:flex;align-items:center;justify-content:center;opacity:0;} .pv2-hthumb:hover .mu-zoom{opacity:1;}',
      '.pv2-imgfocus{display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,black 22%,transparent);border-radius:10px;padding:12px;}',
      '.pv2-imgfocus img{max-width:100%;max-height:min(58vh,440px);object-fit:contain;border-radius:8px;}',
      '.pv2-imgstrip{display:flex;flex-wrap:wrap;gap:8px;}',
      '.pv2-imgthumb{width:62px;height:62px;border-radius:8px;overflow:hidden;border:2px solid transparent;background:none;padding:0;cursor:pointer;}',
      '.pv2-imgthumb.on{border-color:var(--amber);} .pv2-imgthumb img{width:100%;height:100%;object-fit:cover;}',
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
      '.pv2-ov{font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em;background:color-mix(in srgb,var(--amber) 22%,transparent);color:var(--amber);padding:2px 7px;border-radius:5px;margin-left:6px;}',
      '.pv2-step{display:flex;align-items:center;margin:10px 0 4px;}',
      '.pv2-step .nd{width:21px;height:21px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;}',
      '.pv2-step .nd.done{background:var(--teal);color:var(--bg,var(--surface-card));}',
      '.pv2-step .nd.cur{background:var(--amber);color:var(--bg,var(--surface-card));box-shadow:0 0 0 4px color-mix(in srgb,var(--amber) 22%,transparent);}',
      '.pv2-step .nd.todo{background:transparent;border:1.5px solid var(--border);color:var(--warm-gray);}',
      '.pv2-step .lb{font-size:0.85rem;margin-left:7px;} .pv2-step .ln{flex:0 0 28px;height:1.5px;margin:0 10px;background:var(--border);} .pv2-step .ln.done{background:color-mix(in srgb,var(--teal) 60%,transparent);}',
      '.pv2-todo{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);font-size:0.85rem;} .pv2-todo:last-child{border-bottom:0;}',
      '.pv2-mk{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0;}',
      '.pv2-mk.met{background:color-mix(in srgb,var(--teal) 22%,transparent);color:var(--teal);} .pv2-mk.unmet{background:color-mix(in srgb,var(--amber) 20%,transparent);color:var(--amber);}',
      '.pv2-opt{font-size:0.72rem;text-transform:uppercase;color:var(--warm-gray);margin-left:4px;}',
      '.pv2-galimg{width:84px;height:84px;border-radius:8px;object-fit:cover;border:1px solid var(--border);margin:0 8px 8px 0;}',
      '.pv2-pnote{font-size:0.78rem;color:var(--warm-gray);margin-top:6px;} .pv2-temp{font-size:0.72rem;color:var(--warm-gray);margin-left:8px;}',
      '.pv2-inh{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border);font-size:0.9rem;} .pv2-inh:last-child{border-bottom:0;}',
      '.pv2-inh .il{color:var(--warm-gray);width:120px;flex-shrink:0;} .pv2-inh .iv{color:var(--text);} .pv2-inh .from{color:var(--warm-gray);font-size:0.78rem;} .pv2-inh .ov{margin-left:auto;}',
      '.pv2-archived{display:inline-block;font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em;background:color-mix(in srgb,var(--warm-gray) 18%,transparent);color:var(--warm-gray);padding:4px 11px;border-radius:8px;margin:8px 0;}',
      '.pv2-bom{width:100%;border-collapse:collapse;} .pv2-bom th{text-align:left;font-size:0.72rem;color:var(--warm-gray);padding:0 0 8px;font-weight:600;} .pv2-bom th.r,.pv2-bom td.r{text-align:right;font-variant-numeric:tabular-nums;} .pv2-bom td{padding:7px 0;font-size:0.85rem;border-top:1px solid var(--border);}',
      '.pv2-flowhost{margin:6px 0 16px;}'
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
    // A product WITH variants expands to its items (synthetic Default + variants)
    // on row-click — you don't jump into a slide-out; you pick the Default or a
    // variant. A variant-less product has nothing to expand, so it opens directly.
    var rowAction = has ? 'toggle' : 'open';
    var html = '<div class="pv2-row" onclick="ProductsV2.' + rowAction + '(\'' + esc(p._key) + '\')" tabindex="0" role="button">' +
      exp + thumb +
      '<span class="pv2-nm">' + esc(p.name || '(unnamed)') + ' <span class="pv2-meta">· ' + esc(categoryLabel(p) || '—') + '</span></span>' +
      '<span>' + U.badge(statusLabel(p.status), statusTone(p.status)) + '</span>' +
      '<span class="pv2-r pv2-meta">' + (N.money(price(p)) || '—') + '</span>' +
      '<span class="pv2-r pv2-meta">' + variantsLabel(p) + '</span></div>';
    if (has && V2.expanded[p._key]) {
      html += '<div class="pv2-row pv2-sub pv2-def" onclick="ProductsV2.open(\'' + esc(p._key) + '\')" tabindex="0" role="button">' +
        '<span class="pv2-exp sp"></span><span></span>' +
        '<span class="pv2-nm"><span class="pv2-branch">└</span>◆ Default <span class="pv2-meta" style="font-weight:400;">· base for all variants</span></span>' +
        '<span></span><span class="pv2-r pv2-meta">' + (N.money(price(p)) || '—') + '</span><span class="pv2-r pv2-meta">' + variantCount(p) + ' inherit</span></div>';
      realVariants(p).forEach(function (v) {
        var ov = variantOverridden(p, v);
        html += '<div class="pv2-row pv2-sub" onclick="ProductsV2.openVariant(\'' + esc(p._key + '::' + v.id) + '\')" tabindex="0" role="button">' +
          '<span class="pv2-exp sp"></span><span></span>' +
          '<span class="pv2-nm"><span class="pv2-branch">└</span>' + esc(variantLabel(v)) + (ov ? '<span class="pv2-ov">override</span>' : '') + '</span>' +
          '<span class="pv2-meta" style="font-size:0.78rem;">follows product</span>' +
          '<span class="pv2-r pv2-meta"' + (ov ? ' style="color:var(--amber);"' : '') + '>' + (N.money(variantPrice(p, v)) || '—') + '</span>' +
          '<span class="pv2-r pv2-meta">' + (ov ? 'override' : 'inherits') + '</span></div>';
      });
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
    var body = rows.length ? '<div class="pv2-list">' + rows.map(rowHtml).join('') + '</div>'
      : '<div style="padding:46px;text-align:center;color:var(--warm-gray);">No products match these filters.</div>';
    tab.innerHTML =
      U.pageHeader({ title: 'Products', count: N.count(V2.rows.length) + ' products',
        actionsHtml: '<button class="btn btn-secondary" onclick="ProductsV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;">' + pills + '</div>' + body;
  }

  window.ProductsV2 = {
    setFilter: function (s) { V2.filter = s; render(); },
    toggle: function (id) { V2.expanded[id] = !V2.expanded[id]; render(); },
    // Open/close the variant switcher popover. Selecting an item re-renders the
    // whole panel (open/openVariant), which clears the popover; this just handles
    // toggling + outside-click-to-close.
    toggleSwitcher: function (btn) {
      var wrap = btn.parentNode, pop = wrap.querySelector('.pv2-vpop');
      if (!pop) return;
      var willShow = pop.hidden;
      document.querySelectorAll('.pv2-vpop').forEach(function (p) { p.hidden = true; });
      pop.hidden = !willShow;
      if (!willShow) return;
      setTimeout(function () {
        function onDoc(e) { if (!wrap.contains(e.target)) { pop.hidden = true; document.removeEventListener('click', onDoc); } }
        document.addEventListener('click', onDoc);
      }, 0);
    },
    // Preload maker before the SO opens so the MastFlow process header renders with
    // live readiness (products.workflow predicates call makerComputeReadinessChecklist).
    open: function (id) { var rec = V2.byId[id]; if (rec) ensureMaker(function () { MastEntity.openRecord('products-v2', rec, 'read'); }); },
    openVariant: function (key) { var rec = buildVariantRecord(key); if (rec) MastEntity.openRecord('product-variant-v2', rec, 'read'); },
    addVariant: function (id) { var p = V2.byId[id]; MastAdmin.showToast('Add variant for "' + (p ? p.name : id) + '" — write flow (inherits the Default) lands in P4.'); },
    editVariantTodo: function () { MastAdmin.showToast('Per-variant override editing lands in P4.'); },
    // Image SO: click a gallery thumbnail to swap the large focused image.
    focusImage: function (src, btn) {
      var lg = document.getElementById('pv2ImgLarge'); if (lg) lg.src = src;
      if (btn && btn.parentNode) { btn.parentNode.querySelectorAll('.pv2-imgthumb').forEach(function (b) { b.classList.remove('on'); }); btn.classList.add('on'); }
    },
    exportCsv: function () { return MastEntity.exportRows('products-v2', visibleRows(), V2.filter); }
  };

  MastAdmin.registerModule('products-v2', {
    routes: { 'products-v2': { tab: 'productsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
