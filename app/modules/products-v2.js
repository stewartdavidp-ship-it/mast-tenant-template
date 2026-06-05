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
  // A variant's image is a BINDING into the product's gallery: variant.imageIndex
  // (canonical model — matches legacy bindVariantImage). Absent / -1 → the variant
  // inherits the product's primary image.
  function variantHasOwnImage(v) { return !!(v && typeof v.imageIndex === 'number' && v.imageIndex >= 0); }
  function variantImageSrc(p, v) {
    var imgs = Array.isArray(p.images) ? p.images : [];
    if (variantHasOwnImage(v) && v.imageIndex < imgs.length) {
      var im = imgs[v.imageIndex];
      return (typeof im === 'string') ? im : (im && im.url) || firstImage(p);
    }
    return firstImage(p);
  }
  function stamp(p, id) { p._key = id || p.pid || p._key; p._title = p.name || ('Product ' + (p._key || '')); return p; }

  function variantLabel(v) {
    if (!v || !v.combo) return 'Variant';
    var parts = Object.keys(v.combo).map(function (k) { return v.combo[k]; }).filter(Boolean);
    return parts.length ? parts.join(' / ') : 'Variant';
  }
  function variantPrice(p, v) { return (v && typeof v.priceCents === 'number') ? v.priceCents / 100 : price(p); }
  function variantOverridden(p, v) { return !!(v && typeof v.priceCents === 'number' && v.priceCents !== p.priceCents); }
  // Product-level price: a single price if every variant matches, else a low–high
  // range (so the product header reflects variants that price differently).
  function priceRange(p) {
    var prices = [price(p)];
    realVariants(p).forEach(function (v) { prices.push(variantPrice(p, v)); });
    prices = prices.filter(function (x) { return typeof x === 'number' && !isNaN(x); });
    if (!prices.length) return '';
    var min = Math.min.apply(null, prices), max = Math.max.apply(null, prices);
    return (min === max) ? N.money(min) : (N.money(min) + '–' + N.money(max));
  }
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
    var thumb;
    if (imgSrc) {
      // The thumbnail drills into the image slide-out (all the product's images,
      // this object's image in large focus) — a stacked SO with Back, not a lightbox.
      thumb = '<button class="pv2-hthumb" onclick="MastEntity.drill(\'product-images-v2\',\'' + esc(drillId) + '\')" style="background-image:url(' + esc(imgSrc) + ');" title="View all images"><span class="mu-zoom">⤢</span></button>';
    } else if (!currentVid) {
      // No image on the Default → an explicit "+ Upload image" placeholder that
      // opens the file picker in place (P4 read-item b). Variants don't get it
      // (a variant's image is bound from the product's gallery, not uploaded here).
      thumb = '<label class="pv2-hthumb pv2-hthumb-add" title="Upload product image"><input type="file" accept="image/*" style="display:none;" onchange="ProductsV2.uploadImage(\'' + esc(pid) + '\',this)"><span>+ Upload<br>image</span></label>';
    } else {
      thumb = '';
    }
    var sw = variantSwitcherHtml(p, currentVid);
    var inner = thumb + sw;
    // Always render the (id'd) container so a post-upload re-render has a target.
    return '<div id="pv2HeaderStrip" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;' + (inner ? 'margin:0 0 12px;' : '') + '">' + inner + '</div>';
  }
  // Re-render the Default header strip in place after an image upload swaps the
  // placeholder for a real thumbnail.
  function rerenderHeaderStrip(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var el = document.getElementById('pv2HeaderStrip');
    if (el) el.outerHTML = headerStrip(rec, firstImage(rec), rec.name || 'Product', null);
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
  // Run cb once window.MakerProductBridge is available — LOAD then act, rather
  // than bailing on a cold first click (the "still loading… try again" footgun).
  // maker is normally preloaded when an SO opens, so cb usually runs synchronously.
  function withProductBridge(cb) {
    if (window.MakerProductBridge) return cb();
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
      MastAdmin.loadModule('maker').then(function () {
        if (window.MakerProductBridge) cb();
        else MastAdmin.showToast('Could not load the product editor', true);
      }).catch(function () { MastAdmin.showToast('Could not load the product editor', true); });
    } else { MastAdmin.showToast('Product editor unavailable', true); }
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
    var pid = p._key || p.pid;
    if (V2.editPricing === pid) return pricingEditForm(p);
    var guarded = String(p.status || '').toLowerCase() === 'active';
    var editBtn = '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editPricing(\'' + esc(pid) + '\')">' + (guarded ? 'Revise' : 'Edit') + '</button>';
    var rows = [{ k: 'Retail price', v: N.money(price(p)) || '—' }];
    if (typeof p.wholesalePriceCents === 'number' && p.wholesalePriceCents > 0) rows.push({ k: 'Wholesale', v: N.money(p.wholesalePriceCents / 100) });
    rows.push({ k: 'Cost basis', v: p.recipeId ? 'From recipe (see Recipe tab)' : 'Manually priced' });
    var nOv = realVariants(p).filter(function (v) { return variantOverridden(p, v); }).length;
    rows.push({ k: 'Variant overrides', v: nOv ? (nOv + ' variant' + (nOv > 1 ? 's' : '')) : 'none' });
    return U.card('Pricing · Default (base)', U.kv(rows), { headerRight: editBtn }) + '<div class="pv2-pnote">Base price propagates to every non-overridden variant. Set a variant’s own price on its Pricing tab.</div>';
  }
  // Inline edit of the customer-facing price (direct priceCents — the model most
  // products use; markupConfig is vestigial). Delegates to the revision-aware
  // setFields bridge, same as Info. Cost basis (recipe) stays read-only.
  function pricingEditForm(p) {
    var pid = p._key || p.pid;
    var guarded = String(p.status || '').toLowerCase() === 'active';
    var retail = (typeof p.priceCents === 'number') ? (p.priceCents / 100) : (typeof p.price === 'number' ? p.price : '');
    var wholesale = (typeof p.wholesalePriceCents === 'number' && p.wholesalePriceCents > 0) ? (p.wholesalePriceCents / 100) : '';
    function money(label, id, val, hint) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + esc(label) +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;"><span style="font-size:0.9rem;">$</span>' +
        '<input id="' + id + '" type="number" step="0.01" min="0" value="' + esc(val === '' ? '' : String(val)) +
        '" style="flex:1;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;"></div>' +
        (hint ? '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(hint) + '</span>' : '') + '</label>';
    }
    var note = guarded ? '<div class="pv2-pnote">This product is Published — your edits stage as a pending revision and go live when you Apply.</div>' : '';
    var costNote = p.recipeId ? '<div class="pv2-pnote">Cost basis comes from the linked recipe (Recipe tab); this sets the customer-facing price directly.</div>' : '';
    var body = note +
      money('Retail price', 'pv2PriceRetail', retail) +
      money('Wholesale price (optional)', 'pv2PriceWholesale', wholesale, 'Leave blank if you don’t sell this wholesale.') +
      costNote +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.savePricing(\'' + esc(pid) + '\')">' + (guarded ? 'Stage changes' : 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelPricing(\'' + esc(pid) + '\')">Cancel</button>' +
      '</div>';
    return U.card('Edit pricing · Default (base)', body);
  }
  function rerenderPricingPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="pricing"]');
    if (paneEl) paneEl.innerHTML = pricingPane(rec);
  }
  function recipePane(p) {
    var pid = p._key || p.pid;
    if (p.recipeId) {
      var body = U.kv([{ k: 'Status', v: 'Linked' }, { k: 'Recipe id', v: p.recipeId }]) +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary btn-small" onclick="MastEntity.drill(\'recipe-v2\',\'' + esc(p.recipeId) + '\')">Open recipe →</button>' +
        '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeEditInBuilder(\'' + esc(p.recipeId) + '\')">Edit in builder ↗</button>' +
        '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeUnlink(\'' + esc(pid) + '\')">Unlink</button>' +
        '</div>';
      return U.card('Recipe', body) + '<div class="pv2-pnote">“Open recipe” reads it here (Back returns); “Edit in builder” opens the full recipe builder — a separate surface.</div>';
    }
    return U.card('Recipe', '<div style="color:var(--warm-gray);font-size:0.9rem;margin-bottom:10px;">No recipe linked. A recipe tracks the materials, labor, and cost behind this product.</div>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeCreate(\'' + esc(pid) + '\')">+ Create a recipe</button>');
  }
  function rerenderRecipePane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="recipe"]');
    if (pane) pane.innerHTML = recipePane(rec);
  }
  // Open the legacy recipe builder (sanctioned separate surface — not reimplemented
  // in v2). It hijacks the legacy pieces tab, so navigate there first.
  function openRecipeBuilderGated(recipeId) {
    withProductBridge(function () {
      MastAdmin.showToast('Opening recipe builder…');
      if (typeof navigateToClassic === 'function') navigateToClassic('products');
      else if (window.navigateTo) window.navigateTo('products');
      setTimeout(function () {
        if (window.makerOpenRecipeBuilder) window.makerOpenRecipeBuilder(recipeId);
        else MastAdmin.showToast('Recipe builder unavailable', true);
      }, 320);
    });
  }
  function inventoryPane(p) {
    var si = p.stockInfo || {};
    var hasVar = variantCount(p) > 0;
    // Inventory is per-VARIANT — it's never inherited. For a product with
    // variants the product-level number is the roll-up; each variant owns its
    // own stock (edit it on the variant's Inventory tab).
    var title = hasVar ? 'Inventory · all variants (roll-up)' : 'Inventory';
    var perVarNote = hasVar
      ? '<div class="pv2-pnote"><strong>On hand = all variants combined.</strong> Stock is tracked per variant — each one has its own count; the number above is the roll-up. Set each variant’s stock on its Inventory tab.</div>'
      // A variant-less product IS the stocked unit, so it's editable here.
      : '<div style="margin-top:10px;"><button class="btn btn-secondary btn-small" onclick="MastAdmin.showToast(\'Stock editing lands in P4.\')">Set stock</button></div>';
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
  // The Image TAB is LIGHT: a read gallery + quick Upload + a "Manage images"
  // drill. Set-primary / remove / reorder live in the product-images-v2 drill SO
  // (heavy edit → its own SO; the large hero there makes "primary" unmistakable
  // even with near-identical thumbnails). On Back the parent SO re-renders from
  // the shared record, so the tab reflects any changes.
  function imagePane(p) {
    var pid = p._key || p.pid;
    var imgs = (Array.isArray(p.images) ? p.images : []);
    var resolve = function (im) { return (typeof im === 'string') ? im : (im && im.url) || ''; };
    var uploadBtn = '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;"><input type="file" accept="image/*" style="display:none;" onchange="ProductsV2.uploadImage(\'' + esc(pid) + '\',this)">Upload image</label>';
    var body;
    if (!imgs.length) {
      body = '<div style="text-align:center;padding:22px 16px;color:var(--warm-gray);font-size:0.9rem;">No images yet. Upload one — the first image is the product’s primary.</div>';
    } else {
      body = '<div class="pv2-imggrid">' + imgs.map(function (im, idx) {
        var url = resolve(im); if (!url) return '';
        var badge = idx === 0 ? '<span class="pv2-imgbadge">Primary</span>' : '';
        return '<div class="pv2-imgcellwrap"><div class="pv2-imgcell" style="background-image:url(' + esc(url) + ');">' + badge + '</div></div>';
      }).join('') + '</div>' +
        '<div style="margin-top:12px;"><button class="btn btn-secondary btn-small" onclick="MastEntity.drill(\'product-images-v2\',\'' + esc(pid) + '\')">Manage images →</button> <span class="pv2-temp">set primary, remove, reorder</span></div>';
    }
    var d = p.description ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.55;">' + esc(String(p.description).slice(0, 300)) + '</div>' : '';
    return U.card('Images (' + imgs.length + ')', body, { headerRight: uploadBtn }) + (d ? U.card('Description', d) : '');
  }
  // Re-render the Image pane in place (after a quick in-tab upload). The drill SO
  // edits refresh on Back via the shared record, so they don't call this.
  function rerenderImagePane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="image"]');
    if (paneEl) paneEl.innerHTML = imagePane(rec);
  }
  function infoPane(p) {
    var pid = p._key || p.pid;
    if (V2.editInfo === pid) return infoEditForm(p);
    // Active products stage edits as a revision; say so up-front on the action.
    var guarded = String(p.status || '').toLowerCase() === 'active';
    var editLbl = guarded ? 'Revise' : 'Edit';
    var editBtn = '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editInfo(\'' + esc(pid) + '\')">' + editLbl + '</button>';
    return U.card('Info · product-level', U.kv([
      { k: 'Category', v: categoryLabel(p) || '—' },
      { k: 'Business line', v: p.businessLine || '—' },
      { k: 'Slug', v: p.slug || '—' },
      // Acquisition mode is structural (drives the cost/recipe machinery) — not
      // an inline-editable field here.
      { k: 'Acquisition', v: MODE_LABEL[p.acquisitionType || 'build'] || 'Build' },
      { k: 'SKU', v: p.sku || '—' }
    ]), { headerRight: editBtn });
  }
  // Inline edit form for the clean top-level Info fields. Writes delegate to
  // window.MakerProductBridge (no new backend) — loadModule+guard at call time.
  function infoEditForm(p) {
    var pid = p._key || p.pid;
    var guarded = String(p.status || '').toLowerCase() === 'active';
    function field(label, id, val) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + esc(label) +
        '<input id="' + id + '" type="text" value="' + esc(val == null ? '' : String(val)) +
        '" style="display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;"></label>';
    }
    var note = guarded
      ? '<div class="pv2-pnote">This product is Published — your edits stage as a pending revision and go live when you Apply.</div>'
      : '';
    var body = note +
      field('Category', 'pv2InfoCategory', categoryLabel(p)) +
      field('Business line', 'pv2InfoBizLine', p.businessLine) +
      field('Slug', 'pv2InfoSlug', p.slug) +
      field('SKU', 'pv2InfoSku', p.sku) +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveInfo(\'' + esc(pid) + '\')">' + (guarded ? 'Stage changes' : 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelInfo(\'' + esc(pid) + '\')">Cancel</button>' +
      '</div>';
    return U.card('Edit info · product-level', body);
  }
  // Re-render just the Info pane in place (keeps the user on the Info tab and
  // preserves scroll/guided-header state — no full SO re-open).
  function rerenderInfoPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="info"]');
    if (paneEl) paneEl.innerHTML = infoPane(rec);
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
        var prTile = priceRange(p) || '—';
        var tiles = UU.tiles([
          { k: 'Status', v: statusLabel(p.status), hero: true },
          // "Price range" only when it's actually a range; uniform variants → "Price".
          { k: (prTile.indexOf('–') >= 0 ? 'Price range' : 'Price'), v: prTile },
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
        // Header strip: variant image (its own binding if set, else the product's
        // primary) + the variant switcher pill (current = this variant).
        var vimg = variantImageSrc(p, v);
        return headerStrip(p, vimg, (p.name || 'Variant') + ' — ' + variantLabel(v), v.id) + UU.stickyHead(tiles, UU.paneTabsBar(tabs, 'v-pricing')) +
          pane('v-pricing', UU.card('Pricing', row('Retail price', N.money(variantPrice(p, v)) || '—', ov ? 'custom for this variant' : 'same as Default', ov, 'Set a custom price') + row('SKU', esc(v.sku || '—'), v.sku ? 'set for this variant' : 'uses the Default', !!v.sku, 'Set a SKU')) + ctx, true) +
          pane('v-recipe', UU.card('Recipe', row('Recipe', 'Product recipe', 'shared with the product', false, 'Give it its own recipe')) + '<div class="pv2-pnote">This variant uses the product’s recipe. Give it its own only if it’s actually made differently.</div>') +
          pane('v-channels', UU.card('Channels', row('Shopify', 'Live', 'same as the product', false, 'Map separately'))) +
          pane('v-inventory', UU.card('Inventory · this variant', UU.kv([
            { k: 'Stock type', v: (v.stockType || '—') },
            { k: 'On hand', v: (v.onHand != null ? String(v.onHand) : '—') },
            { k: 'Reorder at', v: (v.reorderAt != null ? String(v.reorderAt) : '—') }
          ]) + '<div style="margin-top:10px;"><button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantTodo()">Set this variant’s stock</button></div>' +
            '<div class="pv2-pnote">Each variant tracks its <strong>own</strong> stock — inventory is never shared with or inherited from the Default.</div>')) +
          pane('v-image', variantImagePane(UU, p, v));
      }
    }
  });
  // Variant Image pane: a variant's image is BOUND from the product's gallery
  // (not uploaded). Pick one of the product's images to give this variant its own,
  // or fall back to the product's primary. Light in-pane selection (the heavy
  // multi-image management lives in the product's image drill SO).
  function variantImagePane(UU, p, v) {
    var pid = p._key || p.pid;
    var imgs = Array.isArray(p.images) ? p.images : [];
    var resolve = function (im) { return (typeof im === 'string') ? im : (im && im.url) || ''; };
    if (!imgs.length) {
      return UU.card('Image · this variant', '<div style="text-align:center;padding:20px 16px;color:var(--warm-gray);font-size:0.9rem;">This product has no images yet. Add images on the product’s Image tab, then bind one to this variant here.</div>');
    }
    var own = variantHasOwnImage(v);
    var curIdx = own ? v.imageIndex : -1;
    // Status line up top makes the current assignment unmistakable.
    var status = own
      ? '<div style="font-size:0.9rem;margin-bottom:10px;">Using <strong>image #' + (curIdx + 1) + '</strong> for this variant. <button class="btn btn-secondary btn-small" onclick="ProductsV2.setVariantImage(\'' + esc(pid) + '\',\'' + esc(v.id) + '\',-1)">Use product default</button></div>'
      : '<div style="font-size:0.9rem;margin-bottom:10px;color:var(--warm-gray);">Using the <strong>product’s primary</strong> image. Tap one below to give this variant its own.</div>';
    var grid = '<div class="pv2-imggrid' + (own ? ' pv2-imggrid-sel' : '') + '">' + imgs.map(function (im, i) {
      var url = resolve(im); if (!url) return '';
      var sel = i === curIdx;
      var badge = sel ? '<span class="pv2-imgbadge">✓ This variant</span>'
        : (i === 0 && !own ? '<span class="pv2-imgbadge pv2-imgbadge-muted">Product default</span>' : '');
      var cap = sel ? '<div style="font-size:0.72rem;color:var(--amber,goldenrod);text-align:center;font-weight:600;">✓ Selected</div>'
        : '<div style="font-size:0.72rem;color:var(--warm-gray);text-align:center;">Image #' + (i + 1) + '</div>';
      return '<div class="pv2-imgcellwrap"><button class="pv2-imgcell pv2-imgpick' + (sel ? ' on' : '') + '" style="background-image:url(' + esc(url) + ');" title="Use image ' + (i + 1) + ' for this variant" onclick="ProductsV2.setVariantImage(\'' + esc(pid) + '\',\'' + esc(v.id) + '\',' + i + ')">' + badge + '</button>' + cap + '</div>';
    }).join('') + '</div>';
    return UU.card('Image · this variant', status + grid);
  }
  // Re-render just the variant Image pane (keeps the active tab) + the header
  // thumbnail after a binding change — a full SO re-open would reset to Pricing.
  function rerenderVariantImagePane(pid, vid) {
    var rec = buildVariantRecord(pid + '::' + vid); if (!rec) return;
    var p = rec.product, v = rec.variant;
    var body = document.getElementById('mastSlideOutBody'); if (!body) return;
    var paneEl = body.querySelector('.mu-pane[data-pane="v-image"]');
    if (paneEl) paneEl.innerHTML = variantImagePane(U, p, v);
    var hs = document.getElementById('pv2HeaderStrip');
    if (hs) hs.outerHTML = headerStrip(p, variantImageSrc(p, v), (p.name || 'Variant') + ' — ' + variantLabel(v), v.id);
  }

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
    fetch: function (id) { return imagesDrillRecord(id); },
    detail: {
      // The image MANAGER (heavy edit → its own drilled SO). Large hero of the
      // focused image makes "primary" unmistakable even with near-identical
      // thumbnails; click a thumbnail to focus, then set-primary / remove /
      // upload. Each edit re-renders this SO and syncs the shared product record
      // so the parent's Image tab reflects it on Back.
      render: function (UU, r) {
        var imgs = r.images || [];
        var key = r._key;
        var uploadBtn = '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;"><input type="file" accept="image/*" style="display:none;" onchange="ProductsV2.imgUpload(\'' + esc(key) + '\',this)">Upload image</label>';
        if (!imgs.length) return UU.card('Images', '<div style="text-align:center;padding:22px 16px;color:var(--warm-gray);font-size:0.9rem;">No images yet. Upload one — the first becomes the primary.</div>', { headerRight: uploadBtn });
        var focusSrc = imgs[r.focus] || imgs[0];
        var isPrimary = focusSrc === imgs[0];
        var large = '<div class="pv2-imgfocus"><img id="pv2ImgLarge" src="' + esc(focusSrc) + '" alt=""></div>';
        var heroActions = '<div style="display:flex;gap:8px;justify-content:center;align-items:center;margin-top:12px;flex-wrap:wrap;">' +
          (isPrimary
            ? '<span class="pv2-imgbadge" style="position:static;">Primary image</span>'
            : '<button class="btn btn-secondary btn-small" onclick="ProductsV2.imgMakePrimary(\'' + esc(key) + '\',\'' + esc(focusSrc) + '\')">Make primary</button>') +
          '<button class="btn btn-secondary btn-small" onclick="ProductsV2.imgRemove(\'' + esc(key) + '\',\'' + esc(focusSrc) + '\')">Remove</button>' +
          '</div>';
        var strip = '<div class="pv2-imgstrip">' + imgs.map(function (src, i) {
          return '<button class="pv2-imgthumb' + (i === r.focus ? ' on' : '') + '" onclick="ProductsV2.imgFocus(\'' + esc(key) + '\',\'' + esc(src) + '\')"><img src="' + esc(src) + '" alt=""></button>';
        }).join('') + '</div>';
        return '<div class="pv2-pnote" style="margin-bottom:10px;">Click a thumbnail to focus it, then set it primary or remove it. The primary (first) image is the product’s hero.</div>' +
          UU.card('Focused', large + heroActions, { headerRight: uploadBtn }) + UU.card('All images (' + imgs.length + ')', strip);
      }
    }
  });

  // Build the product-images-v2 drill record. focusUrl (optional) overrides the
  // default focus so a re-render can keep the user on the image they were editing.
  function imagesDrillRecord(id, focusUrl) {
    var parts = String(id || '').split('::'); var pid = parts[0], vid = parts[1];
    var p = V2.byId[pid]; if (!p) return null;
    var imgs = (Array.isArray(p.images) ? p.images : []).slice();
    var focus = 0, label = p.name || 'Product';
    if (vid) {
      var v = realVariants(p).filter(function (x) { return x.id === vid; })[0];
      label += ' — ' + variantLabel(v || { combo: {} });
      if (variantHasOwnImage(v) && v.imageIndex < imgs.length) focus = v.imageIndex;
    }
    if (focusUrl) { var fu = imgs.indexOf(focusUrl); if (fu >= 0) focus = fu; }
    return { _key: id, _title: label + ' · Images', product: p, images: imgs, focus: focus };
  }
  // Re-render the image drill SO in place (internal=true → keeps the drill stack,
  // so Back still returns to the product). Syncs nothing itself; callers update
  // the shared record first.
  function reopenImagesDrill(key, focusUrl) {
    var rec = imagesDrillRecord(key, focusUrl);
    if (rec) MastEntity.openRecord('product-images-v2', rec, 'read', true);
  }
  // Keep the products-v2 cache (= the parent SO's shared record) current after an
  // image write, so the Image tab reflects it when the user Backs out.
  function syncImagesCache(pid, res) {
    var rec = V2.byId[pid]; if (!rec || !res) return;
    if (Array.isArray(res.images)) rec.images = res.images;
    if (Array.isArray(res.imageIds)) rec.imageIds = res.imageIds;
  }

  function buildVariantRecord(id) {
    var parts = String(id || '').split('::'); var pid = parts[0], vid = parts[1];
    var p = V2.byId[pid]; if (!p) return null;
    var v = realVariants(p).filter(function (x) { return x.id === vid; })[0] || { id: vid, combo: {} };
    return { _key: id, _title: (p.name || 'Product') + ' — ' + variantLabel(v), product: p, variant: v };
  }

  // ── State + data ────────────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: '_title', sortDir: 'asc', filter: 'all', expanded: {}, editInfo: null, editPricing: null, q: '' };

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
    var q = (V2.q || '').trim().toLowerCase();
    if (q) rows = rows.filter(function (r) {
      return String(r.name || '').toLowerCase().indexOf(q) >= 0
        || String(categoryLabel(r) || '').toLowerCase().indexOf(q) >= 0
        || String(r.sku || '').toLowerCase().indexOf(q) >= 0;
    });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('products-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }
  // The list body only (rows or empty-state) — re-rendered on its own during
  // search so the search input keeps focus while you type.
  function renderListBody() {
    var rows = visibleRows();
    if (rows.length) return '<div class="pv2-list">' + rows.map(rowHtml).join('') + '</div>';
    var q = (V2.q || '').trim();
    return '<div style="padding:46px;text-align:center;color:var(--warm-gray);">No products match ' + (q ? '“' + esc(q) + '”' : 'these filters') + '.</div>';
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
      '.pv2-hthumb:hover{box-shadow:0 0 0 2px var(--amber,goldenrod);} .pv2-hthumb .mu-zoom{position:absolute;right:3px;bottom:3px;width:16px;height:16px;border-radius:4px;background:rgba(0,0,0,.55);color:white;font-size:0.72rem;display:flex;align-items:center;justify-content:center;opacity:0;} .pv2-hthumb:hover .mu-zoom{opacity:1;}',
      '.pv2-imgfocus{display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,black 22%,transparent);border-radius:10px;padding:12px;}',
      '.pv2-imgfocus img{max-width:100%;max-height:min(58vh,440px);object-fit:contain;border-radius:8px;}',
      '.pv2-imgstrip{display:flex;flex-wrap:wrap;gap:8px;}',
      '.pv2-imgthumb{width:62px;height:62px;border-radius:8px;overflow:hidden;border:2px solid transparent;background:none;padding:0;cursor:pointer;}',
      '.pv2-imgthumb.on{border-color:var(--amber,goldenrod);} .pv2-imgthumb img{width:100%;height:100%;object-fit:cover;}',
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
      '.pv2-hthumb-add{display:flex;align-items:center;justify-content:center;text-align:center;border-style:dashed;background:transparent;color:var(--warm-gray);font-size:0.72rem;line-height:1.2;cursor:pointer;}',
      '.pv2-hthumb-add:hover{box-shadow:0 0 0 2px var(--amber,goldenrod);color:var(--amber);}',
      '.pv2-imggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;}',
      '.pv2-imgcellwrap{display:flex;flex-direction:column;gap:6px;}',
      '.pv2-imgcell{position:relative;aspect-ratio:1;border-radius:10px;background-size:cover;background-position:center;border:1px solid var(--border);}',
      // Keyword fallbacks: --teal/--amber/--warm-gray aren't defined in the
      // slide-out scope, so these vars resolve empty here — without a fallback the
      // badge bg goes transparent and the highlight ring drops to none.
      '.pv2-imgbadge{position:absolute;top:6px;left:6px;background:var(--teal,teal);color:white;font-size:0.72rem;font-weight:600;padding:3px 8px;border-radius:6px;letter-spacing:.04em;}',
      '.pv2-imgbadge-muted{background:var(--warm-gray,gray);}',
      '.pv2-imgpick{cursor:pointer;padding:0;width:100%;transition:box-shadow .12s,opacity .12s,transform .12s;} .pv2-imgpick:hover{box-shadow:0 0 0 2px var(--amber,goldenrod);}',
      '.pv2-imgpick.on{box-shadow:0 0 0 4px var(--amber,goldenrod);transform:scale(1.03);position:relative;z-index:1;}',
      // When a variant image is chosen, fade the rest so the selected one pops.
      '.pv2-imggrid-sel .pv2-imgpick:not(.on){opacity:.45;} .pv2-imggrid-sel .pv2-imgpick:not(.on):hover{opacity:1;}',
      '.pv2-imgacts{display:flex;gap:4px;flex-wrap:wrap;}',
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
      '<span class="pv2-r pv2-meta">' + (priceRange(p) || '—') + '</span>' +
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
    var search = '<input id="pv2Search" type="text" value="' + esc(V2.q || '') + '" oninput="ProductsV2.setSearch(this.value)" placeholder="Search products…" ' +
      'style="margin-left:auto;width:230px;max-width:100%;padding:7px 11px;border:1px solid var(--border);border-radius:999px;font-size:0.9rem;background:var(--cream,transparent);color:inherit;box-sizing:border-box;">';
    tab.innerHTML =
      U.pageHeader({ title: 'Products', count: N.count(V2.rows.length) + ' products',
        actionsHtml: '<button class="btn btn-secondary" onclick="ProductsV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;display:flex;align-items:center;gap:8px 0;flex-wrap:wrap;">' + pills + search + '</div>' +
      '<div id="pv2ListBody">' + renderListBody() + '</div>';
  }

  window.ProductsV2 = {
    setFilter: function (s) { V2.filter = s; render(); },
    // Type-to-filter the list by name / category / SKU. Re-render only the list
    // body so the input keeps focus (no full re-render mid-keystroke).
    setSearch: function (v) {
      V2.q = v;
      var el = document.getElementById('pv2ListBody');
      if (el) el.innerHTML = renderListBody(); else render();
    },
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
    // Preload maker too, so the first image/edit click in a variant SO works
    // (no cold "still loading" — the variant's writes also delegate to the bridge).
    openVariant: function (key) { var rec = buildVariantRecord(key); if (rec) ensureMaker(function () { MastEntity.openRecord('product-variant-v2', rec, 'read'); }); },
    addVariant: function (id) { var p = V2.byId[id]; MastAdmin.showToast('Add variant for "' + (p ? p.name : id) + '" — write flow (inherits the Default) lands in P4.'); },
    editVariantTodo: function () { MastAdmin.showToast('Per-variant override editing lands in P4.'); },
    // Bind a variant to product.images[idx] (idx<0 → clear, use product default).
    setVariantImage: function (pid, variantId, idx) {
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setVariantImageIndex(pid, variantId, idx)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec) rec.variants = res.variants; // keep parent/list cache fresh
          // Re-render just the Image pane in place (stay on the Image tab) + refresh
          // the header thumbnail — a full SO re-open would bounce back to Pricing.
          rerenderVariantImagePane(pid, variantId);
          MastAdmin.showToast(idx >= 0 ? 'Image #' + (idx + 1) + ' set for this variant' : 'Variant image cleared');
        }, function (e) { console.error('[products-v2] setVariantImage', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── Pricing tab edit (direct price; revision-aware via setFields) ──
    editPricing: function (pid) { V2.editPricing = pid; rerenderPricingPane(pid); },
    cancelPricing: function (pid) { V2.editPricing = null; rerenderPricingPane(pid); },
    savePricing: function (pid) {
      var rec = V2.byId[pid] || {};
      function num(id) { var el = document.getElementById(id); if (!el) return null; var s = el.value.trim(); if (s === '') return ''; var n = Number(s); return (isFinite(n) && n >= 0) ? n : null; }
      var retail = num('pv2PriceRetail'), wholesale = num('pv2PriceWholesale');
      if (retail === '' || retail === null) { MastAdmin.showToast('Enter a valid retail price', true); return; }
      if (wholesale === null) { MastAdmin.showToast('Wholesale price isn’t valid', true); return; }
      var changed = {};
      var curRetail = (typeof rec.priceCents === 'number') ? rec.priceCents : (typeof rec.price === 'number' ? Math.round(rec.price * 100) : null);
      var newRetail = Math.round(retail * 100);
      if (newRetail !== curRetail) changed.priceCents = newRetail;
      var curWh = (typeof rec.wholesalePriceCents === 'number') ? rec.wholesalePriceCents : null;
      var newWh = (wholesale === '') ? null : Math.round(wholesale * 100);
      if (newWh !== curWh) changed.wholesalePriceCents = newWh;
      if (!Object.keys(changed).length) { V2.editPricing = null; rerenderPricingPane(pid); MastAdmin.showToast('No changes'); return; }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setFields(pid, changed)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Save failed: ' + ((res && res.error) || 'unknown'), true); return; }
          if (!res.staged) Object.assign(rec, changed);
          V2.editPricing = null; rerenderPricingPane(pid);
          MastAdmin.showToast(res.staged ? 'Staged ' + res.changed + ' change' + (res.changed === 1 ? '' : 's') + ' (Apply to go live)' : 'Saved');
        }, function (e) { console.error('[products-v2] savePricing', e); MastAdmin.showToast('Save failed', true); });
      });
    },
    // ── Recipe tab (link/create; building stays in the legacy builder) ─
    recipeCreate: function (pid) {
      withProductBridge(function () {
        var rec = V2.byId[pid] || {};
        MastAdmin.showToast('Creating recipe…');
        Promise.resolve(window.MakerProductBridge.createRecipeForProduct(pid, rec.name || 'Recipe')).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          if (rec) rec.recipeId = res.recipeId;
          openRecipeBuilderGated(res.recipeId); // straight into the builder to fill it in
        }, function (e) { console.error('[products-v2] recipeCreate', e); MastAdmin.showToast('Failed', true); });
      });
    },
    recipeEditInBuilder: function (recipeId) { openRecipeBuilderGated(recipeId); },
    recipeUnlink: function (pid) {
      function go() {
        withProductBridge(function () {
          Promise.resolve(window.MakerProductBridge.unlinkRecipe(pid)).then(function (res) {
            if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
            var rec = V2.byId[pid]; if (rec) rec.recipeId = null;
            rerenderRecipePane(pid); MastAdmin.showToast('Recipe unlinked');
          }, function (e) { console.error('[products-v2] recipeUnlink', e); MastAdmin.showToast('Failed', true); });
        });
      }
      if (window.mastConfirm) Promise.resolve(window.mastConfirm('Unlink this recipe from the product? The recipe itself isn’t deleted.', { title: 'Unlink recipe', confirmText: 'Unlink' })).then(function (ok) { if (ok) go(); });
      else go();
    },
    // ── Info tab edit (P4 pilot) ──────────────────────────────────────
    editInfo: function (pid) { V2.editInfo = pid; rerenderInfoPane(pid); },
    cancelInfo: function (pid) { V2.editInfo = null; rerenderInfoPane(pid); },
    saveInfo: function (pid) {
      function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
      var rec = V2.byId[pid] || {};
      var patch = {
        category: val('pv2InfoCategory'),
        businessLine: val('pv2InfoBizLine'),
        slug: val('pv2InfoSlug'),
        sku: val('pv2InfoSku')
      };
      // Only send fields that actually changed (cheaper writes, smaller revisions).
      var changed = {};
      if (patch.category !== (categoryLabel(rec) || '')) changed.category = patch.category;
      if (patch.businessLine !== (rec.businessLine || '')) changed.businessLine = patch.businessLine;
      if (patch.slug !== (rec.slug || '')) changed.slug = patch.slug;
      if (patch.sku !== (rec.sku || '')) changed.sku = patch.sku;
      if (!Object.keys(changed).length) { V2.editInfo = null; rerenderInfoPane(pid); MastAdmin.showToast('No changes'); return; }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setFields(pid, changed)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Save failed: ' + ((res && res.error) || 'unknown'), true); return; }
          // Mirror the live cache so the read pane shows the edit immediately.
          if (!res.staged) Object.assign(rec, changed);
          V2.editInfo = null;
          rerenderInfoPane(pid);
          MastAdmin.showToast(res.staged ? 'Staged ' + res.changed + ' change' + (res.changed === 1 ? '' : 's') + ' (Apply to go live)' : 'Saved');
        }, function (e) { console.error('[products-v2] saveInfo', e); MastAdmin.showToast('Save failed', true); });
      });
    },
    // ── Image tab edit (P4) ───────────────────────────────────────────
    uploadImage: function (pid, inputEl) {
      var file = inputEl && inputEl.files && inputEl.files[0];
      if (inputEl) inputEl.value = ''; // allow re-selecting the same file later
      if (!file) return;
      withProductBridge(function () {
        MastAdmin.showToast('Uploading image…');
        Promise.resolve(window.MakerProductBridge.addImage(pid, file)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Upload failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec) { rec.images = res.images; rec.imageIds = res.imageIds; }
          rerenderImagePane(pid); rerenderHeaderStrip(pid);
          MastAdmin.showToast('Image uploaded');
        }, function (e) { console.error('[products-v2] uploadImage', e); MastAdmin.showToast('Upload failed', true); });
      });
    },
    // ── Image MANAGER (the product-images-v2 drill SO) ────────────────
    // Heavy edit lives here, not in the tab. Each op is fresh-read + URL-keyed in
    // the bridge (index-safe — can't drop the wrong/another image), syncs the
    // shared product record, and re-renders the drill keeping focus.
    imgFocus: function (key, src) { reopenImagesDrill(key, src); },
    imgUpload: function (key, inputEl) {
      var file = inputEl && inputEl.files && inputEl.files[0];
      if (inputEl) inputEl.value = '';
      if (!file) return;
      var pid = String(key).split('::')[0];
      withProductBridge(function () {
        MastAdmin.showToast('Uploading image…');
        Promise.resolve(window.MakerProductBridge.addImage(pid, file)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Upload failed: ' + ((res && res.error) || 'unknown'), true); return; }
          syncImagesCache(pid, res); reopenImagesDrill(key, res.url);
          MastAdmin.showToast('Image uploaded');
        }, function (e) { console.error('[products-v2] imgUpload', e); MastAdmin.showToast('Upload failed', true); });
      });
    },
    imgMakePrimary: function (key, src) {
      var pid = String(key).split('::')[0];
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.makeImagePrimary(pid, src)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          syncImagesCache(pid, res); reopenImagesDrill(key, src);
          MastAdmin.showToast('Primary image updated');
        }, function (e) { console.error('[products-v2] imgMakePrimary', e); MastAdmin.showToast('Failed', true); });
      });
    },
    imgRemove: function (key, src) {
      var pid = String(key).split('::')[0];
      function go() {
        withProductBridge(function () {
          Promise.resolve(window.MakerProductBridge.removeImage(pid, src)).then(function (res) {
            if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
            syncImagesCache(pid, res); reopenImagesDrill(key);
            MastAdmin.showToast('Image removed');
          }, function (e) { console.error('[products-v2] imgRemove', e); MastAdmin.showToast('Failed', true); });
        });
      }
      if (window.mastConfirm) Promise.resolve(window.mastConfirm('Remove this image?', { title: 'Remove image', confirmText: 'Remove' })).then(function (ok) { if (ok) go(); });
      else go();
    },
    exportCsv: function () { return MastEntity.exportRows('products-v2', visibleRows(), V2.filter); }
  };

  MastAdmin.registerModule('products-v2', {
    routes: { 'products-v2': { tab: 'productsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
