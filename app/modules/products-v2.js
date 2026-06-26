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
    if (!v) return 'Variant';
    // A custom variant name (variant.name) wins over the auto option-combo label.
    if (v.name) return v.name;
    if (!v.combo) return 'Variant';
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
    // Variants are first-class: every one carries a stable unique id. Key STRICTLY
    // by that id — index-based keying mis-targets writes after any reorder (the
    // cause of the earlier image-drop bug). A missing id is malformed data, so
    // surface it loudly rather than silently falling back to a positional index.
    return (Array.isArray(p.variants) ? p.variants : []).map(function (v, i) {
      if (v && v.id) return v;
      console.error('[products-v2] variant missing id — data bug (keying by index as a last resort)', (p && (p.pid || p._key)), i, v);
      return Object.assign({ id: 'v' + i }, v);
    });
  }
  // Quick-add attribute presets for the guided variant editor (Step 1). Each
  // pre-fills a common attribute name + starter choices the operator can edit;
  // an empty `choices` inserts just the named attribute (operator adds choices).
  // Chosen for a jewelry/maker tenant. Presets are editable after insertion and
  // "Custom…" is always available alongside.
  var VARIANT_PRESETS = [
    { label: 'Size', choices: ['6', '7', '8'] },
    { label: 'Color', choices: [] },
    { label: 'Material', choices: [] },
    { label: 'Scent', choices: [] },
    { label: 'Length', choices: ['16"', '18"', '20"'] }
  ];
  // Variant option combinatorics (for Add variant). combo key = option label
  // lower-cased (matches the stored combo objects, e.g. {size:'small'}).
  function comboSig(c) { return Object.keys(c || {}).sort().map(function (k) { return k + '=' + c[k]; }).join('|'); }
  function comboLabel(c) { return Object.keys(c || {}).map(function (k) { return c[k]; }).filter(Boolean).join(' / ') || '—'; }
  function productCombos(p) {
    var opts = (Array.isArray(p.options) ? p.options : []).filter(function (o) { return o.label && o.choices && o.choices.length; });
    if (!opts.length) return [];
    var keys = opts.map(function (o) { return String(o.label).toLowerCase(); });
    var arrays = opts.map(function (o) { return o.choices; });
    var rows = arrays.reduce(function (acc, choices) {
      var r = []; acc.forEach(function (e) { choices.forEach(function (ch) { r.push(e.concat([ch])); }); }); return r;
    }, [[]]);
    return rows.map(function (vals) { var obj = {}; keys.forEach(function (k, i) { obj[k] = vals[i]; }); return obj; });
  }
  function missingCombos(p) {
    var seen = {}; realVariants(p).forEach(function (v) { if (v.combo) seen[comboSig(v.combo)] = true; });
    return productCombos(p).filter(function (c) { return !seen[comboSig(c)]; });
  }
  // ── RBAC: the Sales/Forecast/Inventory facets inherit the permission of the
  // module they replaced (so revenue/margin/stock only show to roles with that
  // access); editing requires the products (or inventory) edit right. ──────
  function _can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }
  function canViewLens(lens) {
    if (lens === 'inventory') return _can('inventory', 'view');
    if (lens === 'sales') return _can('sales-by-product', 'view');
    if (lens === 'forecast') return _can('forecast', 'view');
    return _can('products', 'view');
  }
  function canEditProduct() { return _can('products', 'edit'); }
  function canEditStock() { return _can('inventory', 'edit'); }
  // Handler-level guards (defense-in-depth behind the hidden UI affordances):
  // return false + toast when the caller lacks permission.
  function _guardEditP() { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return false; } return true; }
  function _guardEditS() { if (!canEditStock()) { MastAdmin.showToast('You don’t have permission to edit stock', true); return false; } return true; }
  // Persist options (write-as-you-go) then re-render the editor. Removing or
  // renaming an attribute/choice can orphan existing variants; the bridge refuses
  // (needsConfirm) until we pass {prune:true}, so we surface a danger confirm
  // naming the affected variants before letting the destructive edit corrupt the
  // variant set. callOpts carries {prune} on the second (confirmed) call.
  function _saveOptions(id, opts, callOpts) {
    withProductBridge(function () {
      Promise.resolve(window.MakerProductBridge.setOptions(id, opts, callOpts)).then(function (res) {
        if (res && res.needsConfirm) {
          var orphans = res.orphans || [];
          var names = orphans.map(function (o) { return '• ' + (o.label || 'Variant'); }).join('\n');
          var msg = 'This option change removes ' + MastFormat.countNoun(orphans.length, 'variant') +
            ' you sell:\n\n' + names + '\n\nThose variants will be deleted. Continue?';
          if (typeof window.mastConfirm === 'function') {
            Promise.resolve(window.mastConfirm(msg, { title: 'Remove variants?', confirmLabel: 'Remove ' + orphans.length + ' & save', danger: true }))
              .then(function (ok) { if (ok) _saveOptions(id, opts, { prune: true }); });
          }
          return;
        }
        if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
        var rec = V2.byId[id];
        if (rec) { rec.options = res.options; if (Array.isArray(res.variants)) rec.variants = res.variants; }
        if (res.prunedCount) { MastAdmin.showToast('Removed ' + MastFormat.countNoun(res.prunedCount, 'orphaned variant')); markListDirty(); }
        rerenderVariantsEditor(id);
      }, function (e) { console.error('[products-v2] setOptions', e); MastAdmin.showToast('Failed', true); });
    });
  }
  // Variants & options editor — a DRILLED slide-out (our standard heavy-edit
  // surface), not a modal. Options editor (define attributes + choices) + the
  // missing-combination picker. Re-rendered in place after each change; Back
  // returns to the product SO (whose variant tree re-renders fresh).
  // Shared input style for the editor's text fields.
  var VE_FIELD_CSS = 'padding:6px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.85rem;background:var(--cream);color:inherit;box-sizing:border-box;';
  // Ephemeral, per-product editor UI state — which step is active, and whether the
  // custom name/choice inputs are revealed. NOT persisted (no MastFlow record);
  // reset implicitly when V2.byId is rebuilt. Keyed by product id.
  function _veState() { V2._ve = V2._ve || { step: {}, custom: {} }; return V2._ve; }
  // The active step for a product: 1 (define attributes) until the gate is met,
  // then 2 (pick combinations) by default; honor an explicit operator choice.
  function _veStep(id, hasAttr) {
    var s = _veState().step[id];
    if (!hasAttr) return 1;            // Step 2 unreachable until ≥1 valid attribute
    return s || 2;
  }
  // Bespoke step rail (Appendix A — reuses the existing, previously-unused
  // `.pv2-step` CSS so it matches the MastFlow guided-header look without a second
  // implementation). Pure presentation, driven by local state. Dots/labels are
  // clickable to jump; Step 2 only once the gate (hasAttr) is satisfied.
  function veRailHtml(id, step, hasAttr) {
    var s1cls = step === 1 ? 'cur' : 'done';
    var s2cls = step === 2 ? 'cur' : 'todo';
    var s1nav = step !== 1 ? ' onclick="ProductsV2.veStep(\'' + esc(id) + '\',1)" style="cursor:pointer;"' : '';
    var s2nav = (hasAttr && step !== 2) ? ' onclick="ProductsV2.veStep(\'' + esc(id) + '\',2)" style="cursor:pointer;"' : '';
    var hint = (step === 1 && !hasAttr)
      ? '<span style="color:var(--warm-gray);font-size:0.78rem;margin-left:8px;">add an attribute with a choice to continue</span>' : '';
    return '<div class="pv2-step">' +
      '<span class="nd ' + s1cls + '"' + s1nav + '>' + (step === 1 ? '1' : '✓') + '</span>' +
      '<span class="lb"' + s1nav + '>Define attributes</span>' +
      '<span class="ln' + (hasAttr ? ' done' : '') + '"></span>' +
      '<span class="nd ' + s2cls + '"' + s2nav + '>2</span>' +
      '<span class="lb"' + s2nav + '>Pick combinations</span>' + hint + '</div>';
  }
  // One existing attribute: name + remove, choice chips, and an add-a-choice input.
  function veAttrRowHtml(id, o, i) {
    var chips = (o.choices || []).map(function (ch) { return '<span style="display:inline-block;border:1px solid var(--border);border-radius:999px;padding:2px 9px;font-size:0.78rem;margin:2px;">' + esc(ch) + '</span>'; }).join('');
    return '<div style="border-top:1px solid var(--border);padding:9px 0;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;"><strong>' + esc(o.label) + '</strong>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.removeOption(\'' + esc(id) + '\',' + i + ')">Remove</button></div>' +
      '<div style="margin:4px 0;">' + (chips || '<span style="color:var(--warm-gray);font-size:0.78rem;">no choices yet</span>') + '</div>' +
      '<div style="display:flex;gap:6px;"><input id="pv2OptChoice_' + i + '" type="text" placeholder="add a choice" style="flex:1;' + VE_FIELD_CSS + '">' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.addChoice(\'' + esc(id) + '\',' + i + ')">+ choice</button></div></div>';
  }
  // Step 1 — Define attributes. Empty-state header + quick-add presets cure the
  // blank-canvas "what do I do next" problem; existing attributes render below.
  function veStep1Html(p, id, opts, validOpts, hasAttr) {
    var quick = VARIANT_PRESETS.map(function (pr) {
      var lbl = pr.choices.length ? (pr.label + ' (' + pr.choices.join(', ') + ')') : pr.label;
      return '<button class="btn btn-secondary btn-small" style="margin:3px;" onclick="ProductsV2.quickAddAttr(\'' + esc(id) + '\',\'' + esc(pr.label) + '\')">+ ' + esc(lbl) + '</button>';
    }).join('') +
      '<button class="btn btn-secondary btn-small" style="margin:3px;" onclick="ProductsV2.veCustom(\'' + esc(id) + '\')">+ Custom…</button>';
    var optHtml = opts.map(function (o, i) { return veAttrRowHtml(id, o, i); }).join('');
    // Reveal the manual name/first-choice inputs once attributes exist or the
    // operator picks "Custom…" — hidden on a clean empty state to keep it calm.
    var showCustom = !!_veState().custom[id] || opts.length > 0;
    var addOptRow = showCustom ? ('<div style="border-top:1px solid var(--border);padding:10px 0;display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
      '<input id="pv2OptLabel" type="text" placeholder="attribute name (e.g. Size)" style="flex:1;min-width:130px;' + VE_FIELD_CSS + '">' +
      '<input id="pv2OptChoice" type="text" placeholder="first choice (e.g. small)" style="flex:1;min-width:130px;' + VE_FIELD_CSS + '">' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.addOption(\'' + esc(id) + '\')">+ Add attribute</button></div>') : '';
    var header = !opts.length
      ? ('<div style="margin-bottom:6px;"><div style="font-weight:600;font-size:1.0rem;">Set up variants</div>' +
         '<div style="color:var(--warm-gray);font-size:0.85rem;">A variant is one version you price or stock separately. First, tell us <em>how</em> it varies.</div></div>' +
         '<div style="font-size:0.78rem;color:var(--warm-gray);margin:8px 0 4px;">Quick add:</div><div style="display:flex;flex-wrap:wrap;">' + quick + '</div>')
      : ('<div style="display:flex;flex-wrap:wrap;margin-bottom:4px;">' + quick + '</div>');
    var advance = hasAttr ? '<div style="margin-top:12px;"><button class="btn btn-primary btn-small" onclick="ProductsV2.veStep(\'' + esc(id) + '\',2)">Pick combinations →</button></div>' : '';
    return U.card('Step 1 · Define attributes', header + optHtml + addOptRow + advance);
  }
  // Collapsed Step-1 summary shown while on Step 2 (completed step → one-line row).
  function veStep1SummaryHtml(id, validOpts) {
    var summary = validOpts.map(function (o) { return '<strong>' + esc(o.label) + ':</strong> ' + esc((o.choices || []).join(', ')); }).join(' &nbsp;·&nbsp; ');
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--border);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:0.85rem;">' +
      '<div><span class="pv2-mk met">✓</span> ' + summary + '</div>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.veStep(\'' + esc(id) + '\',1)">Edit</button></div>';
  }
  // Step 2 — Pick combinations. Reframed as "the list of variants you sell": a
  // live removable list on top, legibility counts, then the missing combos + an
  // "Add all" shortcut. (Removable list + Add all use the new bridge methods.)
  function veStep2Html(p, id) {
    var variants = realVariants(p);
    var missing = missingCombos(p);
    var possible = productCombos(p).length;
    var sell = variants.length
      ? variants.map(function (v) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--border);padding:7px 0;font-size:0.85rem;">' +
            '<span>' + esc(comboLabel(v.combo)) + '</span>' +
            '<button class="btn btn-secondary btn-small" title="Remove this variant" onclick="ProductsV2.removeVariantConfirm(\'' + esc(id) + '\',\'' + esc(v.id) + '\')">✕</button></div>';
        }).join('')
      : '<div style="color:var(--warm-gray);font-size:0.85rem;padding:6px 0;">No variants yet — add the combinations you sell below.</div>';
    var counts = '<div style="font-size:0.78rem;color:var(--warm-gray);margin:8px 0 2px;">' + possible + ' possible · ' + variants.length + ' added · ' + missing.length + ' remaining</div>';
    var addMore;
    if (missing.length) {
      var btns = missing.map(function (c) { return '<button class="btn btn-secondary" style="margin:4px;" onclick="ProductsV2.confirmAddVariant(\'' + esc(id) + '\',\'' + esc(comboSig(c)) + '\')">+ ' + esc(comboLabel(c)) + '</button>'; }).join('');
      addMore = '<div style="font-size:0.78rem;color:var(--warm-gray);margin:6px 0 2px;">Add more:</div>' +
        '<div style="display:flex;flex-wrap:wrap;">' + btns + '</div>' +
        '<div style="margin-top:8px;"><button class="btn btn-primary btn-small" onclick="ProductsV2.addAllVariants(\'' + esc(id) + '\')">+ Add all ' + missing.length + '</button></div>';
    } else {
      addMore = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:6px 0;">Every combination already exists.</div>';
    }
    var base = '<div class="pv2-pnote" style="margin-top:12px;">Your <strong>◆ Default</strong> is the base — price, photo, and recipe are inherited by every variant unless you override them on that variant.</div>';
    var head = '<div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--warm-gray);">You sell · ' + MastFormat.countNoun(variants.length, 'variant') + '</div>';
    return U.card('Step 2 · Pick combinations', head + sell + counts + addMore + base);
  }
  function variantsEditorInner(p) {
    var id = p._key || p.pid;
    var opts = Array.isArray(p.options) ? p.options : [];
    var validOpts = opts.filter(function (o) { return o.label && o.choices && o.choices.length; });
    var hasAttr = validOpts.length > 0;
    var step = _veStep(id, hasAttr);
    var blocks = (step === 1)
      ? veStep1Html(p, id, opts, validOpts, hasAttr)
      : (veStep1SummaryHtml(id, validOpts) + veStep2Html(p, id));
    return '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:4px;">A variant is one version you price or stock separately — first define how it varies, then pick which combinations you sell.</div>' +
      veRailHtml(id, step, hasAttr) + blocks;
  }
  function variantsEditorBody(p) { return '<div id="pv2VarEditor">' + variantsEditorInner(p) + '</div>'; }
  function rerenderVariantsEditor(id) {
    var p = V2.byId[id]; if (!p) return;
    var el = document.getElementById('pv2VarEditor');
    if (el) el.innerHTML = variantsEditorInner(p);
  }

  // The variant switcher — ONE compact pill (low clutter, V1's failure was a
  // million things at once). At rest it shows only where you are; click opens a
  // popover to jump to the Default or any variant in place. currentVid = null on
  // the Default, or the variant id on a variant. No pill on a variant-less product.
  function variantSwitcherHtml(p, currentVid) {
    var pid = p._key || p.pid;
    // No variants yet → the pill becomes "+ Add variant" (same spot the switcher
    // would be), so you can branch a single-variant product into options.
    if (variantCount(p) === 0) {
      if (!canEditProduct()) return '';
      return '<div class="pv2-vswitch"><button class="pv2-vpill" onclick="ProductsV2.addVariant(\'' + esc(pid) + '\')" title="Add a variant" style="color:var(--teal,teal);">+ Add variant</button></div>';
    }
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
    // Persistent re-entry into the editor — once the first variant exists the
    // "+ Add variant" pill is gone, so without this there's no surfaced way to add
    // a 3rd variant or edit attributes. Footer item, divided from the switch list.
    var manage = canEditProduct()
      ? '<div style="border-top:1px solid var(--border);margin-top:4px;padding-top:4px;"><button class="pv2-vitem" onclick="ProductsV2.addVariant(\'' + esc(pid) + '\')"><span class="vchk"></span>⚙ Manage variants &amp; attributes</button></div>'
      : '';
    return '<div class="pv2-vswitch">' +
      '<button class="pv2-vpill" onclick="ProductsV2.toggleSwitcher(this)" title="Switch variant">' + esc(curLabel) + ' <span class="vcaret">▾</span></button>' +
      '<div class="pv2-vpop" hidden><div class="pv2-vpop-h">Switch to…</div>' + items + manage + '</div></div>';
  }

  // Slide-out header strip: image thumbnail (click → full size) + the variant
  // switcher pill, on one line. Empty when there's neither.
  function headerStrip(p, imgSrc, imgName, currentVid) {
    // Inject the pv2 stylesheet here, not just in the list render(): a product SO
    // can be opened by DRILLING straight in (e.g. from a channel's Products tab)
    // without the products-v2 list ever rendering. Without this, the header
    // thumbnail collapses to a dot and the variant switcher items render inline.
    // ensureStyles() is idempotent (guards on #pv2-styles).
    ensureStyles();
    var pid = p._key || p.pid;
    var drillId = currentVid ? (pid + '::' + currentVid) : pid;
    var thumb;
    if (imgSrc) {
      // The thumbnail drills into the image slide-out (all the product's images,
      // this object's image in large focus) — a stacked SO with Back, not a lightbox.
      thumb = '<button class="pv2-hthumb" onclick="MastEntity.drill(\'product-images-v2\',\'' + esc(drillId) + '\')" style="background-image:url(' + esc(imgSrc) + ');" title="View all images"><span class="mu-zoom">⤢</span></button>';
    } else if (!currentVid && canEditProduct()) {
      // No image on the Default → an explicit "+ Upload image" placeholder that
      // opens the file picker in place (P4 read-item b). Variants don't get it
      // (a variant's image is bound from the product's gallery, not uploaded here).
      // Hidden for view-only roles (no edit affordance).
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
    return Promise.resolve(MastDB.products.get(pid)).then(function (p) {
      if (!p) return;
      var rec = stamp(Object.assign({}, p), pid); V2.byId[pid] = rec;
      MastEntity.openRecord('products-v2', rec, 'read');
    });
  }
  // The header summary tiles — DERIVED from the product record, so the same
  // builder backs both the initial render and the post-write refresh (no cached
  // copy to drift). Price/Variants/On hand recompute straight from the record.
  function productTiles(UU, p) {
    var prTile = priceRange(p) || '—';
    return UU.tiles([
      { k: 'Status', v: statusLabel(p.status), hero: true },
      // "Price range" only when it's actually a range; uniform variants → "Price".
      { k: (prTile.indexOf('–') >= 0 ? 'Price range' : 'Price'), v: prTile },
      { k: 'Variants', v: variantCount(p) || 'Default only' },
      { k: 'On hand', v: ((p.stockInfo && p.stockInfo.totalOnHand) != null ? String(p.stockInfo.totalOnHand) : '—') }
    ]);
  }
  // Recompute the header summary (Price/On hand/Variants tiles) AND the Draft
  // readiness checklist from the SAME live record a pane save just mutated
  // (V2.byId[pid] === the open _flow.record) — in place, so the header updates
  // with the pane instead of holding the open-time snapshot until a reopen.
  function refreshProductSummary(pid) {
    var rec = V2.byId[pid];
    if (!rec || !window.MastEntity || !MastEntity.refreshFlowHeader) return;
    MastEntity.refreshFlowHeader(rec, productTiles(U, rec));
  }
  function pricingPane(p) {
    var pid = p._key || p.pid;
    if (V2.editPricing === pid) return pricingEditForm(p);
    var guarded = String(p.status || '').toLowerCase() === 'active';
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editPricing(\'' + esc(pid) + '\')">' + (guarded ? 'Revise' : 'Edit') + '</button>' : '';
    // Recipe is the cost source — fetch it (cached) so the Pricing tab can show
    // the unit cost, margin, and below-cost state instead of being blind to it.
    var rc = p.recipeId ? _recipeCache[p.recipeId] : null;
    if (p.recipeId && !rc) loadRecipeThenRerender(p.recipeId, pid);
    var rows = [{ k: 'Retail price', v: N.money(price(p)) || '—' }];
    if (typeof p.wholesalePriceCents === 'number' && p.wholesalePriceCents > 0) rows.push({ k: 'Wholesale', v: N.money(p.wholesalePriceCents / 100) });
    if (rc) {
      rows.push({ k: 'Cost basis', v: 'From recipe — ' + (N.money(rc.totalCost) || '—') + ' unit cost' });
      var mr = pricingMarginRow(p, rc); if (mr) rows.push(mr);
    } else {
      rows.push({ k: 'Cost basis', v: p.recipeId ? 'From recipe (see Recipe tab)' : 'Manually priced' });
    }
    var nOv = realVariants(p).filter(function (v) { return variantOverridden(p, v); }).length;
    rows.push({ k: 'Variant overrides', v: nOv ? (MastFormat.countNoun(nOv, 'variant')) : 'none' });
    var recipeBlock = rc ? pricingRecipeSummary(p, rc, { showApply: true }) : '';
    return U.card('Pricing · Default (base)', U.kv(rows), { headerRight: editBtn }) + recipeBlock + '<div class="pv2-pnote">Base price propagates to every non-overridden variant. Set a variant’s own price on its Pricing tab.</div>';
  }
  // Margin of the product's live retail price against the recipe unit cost.
  // Below cost (negative margin) is flagged in the module's danger style (the
  // same ⚠ / var(--danger) the reprice + what-if surfaces use). Returns a kv
  // row, or null when there's no cost or price to compare.
  function pricingMarginRow(p, rc) {
    var cost = Number(rc.totalCost) || 0;
    var retail = price(p);
    if (!(cost > 0) || typeof retail !== 'number' || !(retail > 0)) return null;
    var marginPct = ((retail - cost) / retail) * 100;
    if (retail < cost) {
      return { k: 'Margin', v: '<span style="color:var(--danger);font-weight:600;">⚠ ' + marginPct.toFixed(1) + '% — below cost</span>' };
    }
    return { k: 'Margin', v: marginPct.toFixed(1) + '%' };
  }
  // Recipe cost + tier prices for the Pricing tab — REUSES the Recipe tab's
  // Cost-breakdown card (recipeCostCard) and the shared tier-price rows
  // (recipeTierPriceRows, same format as the recipe "Pricing & tiers" card) so
  // the operator sees what the product costs and what the recipe would charge,
  // without retyping. opts.showApply adds the one-click apply action.
  function pricingRecipeSummary(p, rc, opts) {
    opts = opts || {};
    var pid = p._key || p.pid;
    var tier = (['wholesale', 'direct', 'retail'].indexOf(rc.activePriceTier) >= 0) ? rc.activePriceTier : 'direct';
    var tierLabel = (RECIPE_TIERS.filter(function (t) { return t.k === tier; })[0] || { l: 'Direct' }).l;
    var tierPrice = Number(rc[tier + 'Price']) || 0;
    var apply = (opts.showApply && canEditProduct() && tierPrice > 0)
      ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.applyRecipePrice(\'' + esc(pid) + '\')">Apply recipe pricing (' + esc(tierLabel.toLowerCase()) + ' · ' + (N.money(tierPrice) || '—') + ')</button>'
      : '';
    var note = opts.showApply
      ? '<div class="pv2-pnote">Tier prices come from the recipe’s markups (Recipe tab). “Apply recipe pricing” sets this product’s price to the active tier — change which tier is active on the Recipe tab.</div>'
      : '<div class="pv2-pnote">Tier prices come from the recipe’s markups — edit them on the Recipe tab.</div>';
    return recipeCostCard(rc) +
      U.card('Recipe tier prices', U.kv(recipeTierPriceRows(rc, tier)) + (apply ? '<div style="margin-top:10px;">' + apply + '</div>' : '')) +
      note;
  }
  // Inline edit of the customer-facing price (direct priceCents — the model most
  // products use; markupConfig is vestigial). Delegates to the revision-aware
  // setFields bridge, same as Info. Cost basis (recipe) stays read-only.
  function pricingEditForm(p) {
    var pid = p._key || p.pid;
    var guarded = String(p.status || '').toLowerCase() === 'active';
    var retail = (typeof p.priceCents === 'number') ? (p.priceCents / 100) : (typeof p.price === 'number' ? p.price : '');
    var wholesale = (typeof p.wholesalePriceCents === 'number' && p.wholesalePriceCents > 0) ? (p.wholesalePriceCents / 100) : '';
    var rc = p.recipeId ? _recipeCache[p.recipeId] : null;
    if (p.recipeId && !rc) loadRecipeThenRerender(p.recipeId, pid);
    function money(label, id, val, hint, extra) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + esc(label) +
        '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;"><span style="font-size:0.9rem;">$</span>' +
        '<input id="' + id + '" type="number" step="0.01" min="0" value="' + esc(val === '' ? '' : String(val)) +
        '"' + (extra || '') + ' style="flex:1;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;"></div>' +
        (hint ? '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(hint) + '</span>' : '') + '</label>';
    }
    var note = guarded ? '<div class="pv2-pnote">This product is Published — your edits stage as a pending revision and go live when you Apply.</div>' : '';
    // When recipe-linked, warn live as the operator types below the unit cost
    // (negative margin) — reuses the module's below-cost danger style. Pre-fill
    // the warning if the current price is already below cost.
    var retailExtra = rc ? ' oninput="ProductsV2.checkBelowCost(\'' + esc(pid) + '\')"' : '';
    var costNote = rc
      ? '<div class="pv2-pnote">Cost basis comes from the linked recipe: <strong>' + (N.money(rc.totalCost) || '—') + ' unit cost</strong>. This sets the customer-facing price directly.</div>'
      : (p.recipeId ? '<div class="pv2-pnote">Cost basis comes from the linked recipe (Recipe tab); this sets the customer-facing price directly.</div>' : '');
    var body = note +
      money('Retail price', 'pv2PriceRetail', retail, null, retailExtra) +
      (rc ? '<div id="pv2BelowCost" style="font-size:0.85rem;margin:-6px 0 12px;">' + belowCostWarningHtml(retail, rc) + '</div>' : '') +
      money('Wholesale price (optional)', 'pv2PriceWholesale', wholesale, 'Leave blank if you don’t sell this wholesale.') +
      costNote +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.savePricing(\'' + esc(pid) + '\')">' + (guarded ? 'Stage changes' : 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelPricing(\'' + esc(pid) + '\')">Cancel</button>' +
      '</div>';
    // Read-only recipe cost + tier prices so the operator isn't pricing from
    // memory (apply lives in the read view, not mid-edit).
    var recipeBlock = rc ? pricingRecipeSummary(p, rc, { showApply: false }) : '';
    return U.card('Edit pricing · Default (base)', body) + recipeBlock;
  }
  // Below-cost (negative-margin) warning markup for a given retail price
  // (dollars) vs the recipe unit cost. Empty string when at/above cost or
  // when there's nothing to compare. Shared by the initial render and the
  // live oninput check so both read identically.
  function belowCostWarningHtml(retailDollars, rc) {
    var cost = rc ? (Number(rc.totalCost) || 0) : 0;
    var val = (retailDollars === '' || retailDollars == null) ? NaN : Number(retailDollars);
    if (!(cost > 0) || !isFinite(val) || !(val > 0) || val >= cost) return '';
    var marginPct = ((val - cost) / val) * 100;
    return '<span style="color:var(--danger);font-weight:600;">⚠ Below cost — ' + (N.money(val) || '$' + val) +
      ' is under the recipe unit cost of ' + (N.money(cost) || '—') + ' (' + marginPct.toFixed(1) + '% margin).</span>';
  }
  function rerenderPricingPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="pricing"]');
    if (paneEl) paneEl.innerHTML = pricingPane(rec);
  }
  // Lightweight cache of fetched recipe records (for the Recipe-tab headline).
  var _recipeCache = {};
  function loadRecipeThenRerender(recipeId, pid) {
    if (_recipeCache[recipeId] || _recipeCache['__loading_' + recipeId]) return;
    _recipeCache['__loading_' + recipeId] = true;
    Promise.resolve(MastDB.recipes.get(recipeId)).then(function (rc) {
      delete _recipeCache['__loading_' + recipeId];
      // Pricing tab also costs from the recipe — re-render both panes (each
      // no-ops if its pane isn't on screen) so the recipe cost/tiers surface.
      if (rc) { _recipeCache[recipeId] = rc; rerenderRecipePane(pid); rerenderPricingPane(pid); }
    }, function () { delete _recipeCache['__loading_' + recipeId]; });
  }
  function recipePane(p) {
    var pid = p._key || p.pid;
    if (p.recipeId) {
      // Headline the recipe (name / cost / status / materials) — the raw recipe id
      // is meaningless to the user. Fetched async + cached; shows a loader first.
      var rc = _recipeCache[p.recipeId];
      var head;
      if (rc) {
        var mats = rc.lineItems ? Object.keys(rc.lineItems).length : 0;
        head = U.kv([
          { k: 'Recipe', v: esc(rc.name || 'Recipe') },
          { k: 'Unit cost', v: N.money(rc.totalCost) || '—' },
          { k: 'Status', v: rc.status ? esc(rc.status) : '—' },
          { k: 'Materials', v: String(mats) },
          { k: 'Retail', v: N.money(rc.retailPrice) || '—' }
        ]);
      } else {
        head = '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading recipe…</div>';
        loadRecipeThenRerender(p.recipeId, pid);
      }
      var canEd = canEditProduct();
      var body = head +
        '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
        '<button class="btn btn-primary btn-small" onclick="MastEntity.drill(\'recipe-v2\',\'' + esc(p.recipeId) + '\')">Open recipe →</button>' +
        (canEd ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeUnlink(\'' + esc(pid) + '\')">Unlink</button>' : '') +
        '</div>';
      return U.card('Recipe', body) + '<div class="pv2-pnote">“Open recipe” edits the full recipe here — materials, labor, pricing tiers, and per-variant cost (Back returns). Metal what-if pricing, bulk reprice, and CSV import are on the product list toolbar.</div>';
    }
    return U.card('Recipe', '<div style="color:var(--warm-gray);font-size:0.9rem;margin-bottom:10px;">No recipe linked. A recipe tracks the materials, labor, and cost behind this product.</div>' +
      (canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeCreate(\'' + esc(pid) + '\')">+ Create a recipe</button>' : '<span style="color:var(--warm-gray);font-size:0.85rem;">No recipe.</span>'));
  }
  function rerenderRecipePane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="recipe"]');
    if (pane) pane.innerHTML = recipePane(rec);
  }
  // Open the legacy recipe builder — R5 retired this as the everyday edit path
  // (the v2 recipe SO now owns BOM / labor / pricing / per-variant cost). The
  // former "Advanced ↗" door (navigateToClassic('products') → legacy builder) is
  // RETIRED: the three power tools it reached — what-if metal pricing, bulk
  // reprice, and product CSV import — are now native on the product list toolbar
  // (ProductsV2.openWhatIf / openReprice / importCsv), single-sourced through
  // window.MakerProductBridge. No products-v2 surface hops to the V1 builder.
  // Restore the originating tab after a stacked pop. The SO can
  // render more than once (e.g. a deep-link auto-open followed by our reopen), and
  // each render defaults to the first tab — so RE-ASSERT: keep clicking the target
  // tab whenever we're not on it, across a short window, so a late render can't
  // leave the user on the wrong tab.
  function restorePaneWhenReady(pane, tries) {
    if (!pane) return;
    tries = tries || 0;
    var body = document.getElementById('mastSlideOutBody');
    var vis = body && body.querySelector('.mu-pane:not([hidden])');
    var onTarget = vis && vis.getAttribute('data-pane') === pane;
    if (!onTarget) {
      var btn = body && body.querySelector('.mu-ptabs button[onclick*="\'' + pane + '\'"]');
      if (btn) btn.click();
    }
    if (tries < 12) setTimeout(function () { restorePaneWhenReady(pane, tries + 1); }, 80);
  }
  // Restore target for a stacked pop: pop returns to the v2 list (via popAndReturn
  // → navigateTo('products-v2')); reopen the EXACT view the user came from — the
  // variant SO or the product on its originating tab. We chain on the reopen so the
  // first restore attempt runs after its render, then the re-assert poll defends
  // against any later (deep-link) re-render.
  if (window.MastNavStack && typeof MastNavStack.registerRestorer === 'function') {
    MastNavStack.registerRestorer('products-v2', function (view, state) {
      if (view !== 'detail' || !state || !state.pid) return;
      setTimeout(function () {
        ensureMaker(function () {
          if (state.vid) {
            var vr = buildVariantRecord(state.pid + '::' + state.vid);
            if (vr) { MastEntity.openRecord('product-variant-v2', vr, 'read'); restorePaneWhenReady(state.pane); }
            return;
          }
          Promise.resolve(reopenProduct(state.pid)).then(function () {
            restorePaneWhenReady(state.pane);
          });
        });
      }, 60);
    });
  }
  // A variant's recipe is its independent slot within the product's recipe. The
  // builder is the (legacy) edit surface; here we just route into it focused on
  // this variant, creating the product recipe first if there isn't one yet.
  function variantRecipePane(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    var hasRecipe = !!p.recipeId;
    var btnLabel = hasRecipe ? 'Open recipe →' : 'Create & open recipe →';
    var statusV = hasRecipe ? 'Shares the product recipe — open it to give this variant its own cost' : 'No product recipe yet';
    var body = UU.kv([{ k: 'Recipe', v: statusV }]) +
      (canEditProduct() ? '<div style="margin-top:12px;"><button class="btn btn-primary btn-small" onclick="ProductsV2.variantOwnRecipe(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">' + btnLabel + '</button></div>' : '');
    return UU.card('Recipe', body) + '<div class="pv2-pnote">A variant can override the product recipe with its own materials, labor, or cost. Opening the recipe lands on this variant — then “Override for this variant”.</div>';
  }
  function inventoryPane(p) {
    var pid = p._key || p.pid;
    var si = p.stockInfo || {};
    var hasVar = variantCount(p) > 0;
    // A variant-less product IS the stocked unit (editable here). For a product
    // with variants the product-level number is the roll-up (read-only); each
    // variant owns its own stock (edit on the variant's Inventory tab).
    if (!hasVar && V2.editInv === pid) return inventoryEditForm(p);
    var title = hasVar ? 'Inventory · all variants (roll-up)' : 'Inventory';
    var headerRight = (hasVar || !canEditStock()) ? '' : '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editInventory(\'' + esc(pid) + '\')">Set stock</button>';
    var perVarNote = hasVar
      ? '<div class="pv2-pnote"><strong>On hand = all variants combined.</strong> Stock is tracked per variant — each one has its own count; the number above is the roll-up. Set each variant’s stock on its Inventory tab.</div>'
      : '';
    // Incoming = open PO coverage projected onto stock by the procurement CF
    // (stockInfo.totalIncoming + incomingEta). Surface it so the operator can
    // see "on order" against this product without opening Procurement.
    var incoming = si.totalIncoming != null ? si.totalIncoming : 0;
    var incomingRow = incoming > 0
      ? [{ k: 'Incoming (on order)', v: String(incoming) + (si.incomingEta ? ' · ETA ' + N.date(si.incomingEta) : '') }]
      : [];
    return U.card(title, U.kv([
      { k: 'Stock mode', v: si.stockType || '—' },
      { k: (hasVar ? 'On hand (all variants)' : 'On hand'), v: (si.totalOnHand != null ? String(si.totalOnHand) : '—') }
    ].concat(incomingRow).concat([
      { k: 'Low-stock at', v: (si.lowStockThreshold != null ? String(si.lowStockThreshold) : '—') },
      { k: 'Fulfillment', v: (si.stockFulfillmentDays != null ? si.stockFulfillmentDays + ' days' : '—') },
      { k: 'Wholesale MOQ', v: (p.moq != null ? String(p.moq) : '—') },
      { k: 'Case pack', v: (p.casePack != null ? String(p.casePack) : '—') }
    ])) + perVarNote, { headerRight: headerRight });
  }
  // The five stock count buckets (Available is always derived = onHand − committed − held).
  var STOCK_FIELDS = [['onHand', 'On hand'], ['committed', 'Committed'], ['held', 'Held'], ['damaged', 'Damaged'], ['incoming', 'Incoming']];
  function stockCountInputs(idPrefix, src) {
    src = src || {};
    return STOCK_FIELDS.map(function (f) {
      var cur = (src[f[0]] != null ? src[f[0]] : '');
      return '<label style="display:inline-block;margin:0 14px 12px 0;font-size:0.85rem;color:var(--warm-gray);">' + f[1] +
        '<input id="' + idPrefix + f[0] + '" type="number" min="0" step="1" value="' + esc(cur === '' ? '' : String(cur)) +
        '" style="display:block;width:120px;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;"></label>';
    }).join('');
  }
  function readStockCounts(idPrefix) {
    var out = {};
    STOCK_FIELDS.forEach(function (f) { var el = document.getElementById(idPrefix + f[0]); if (el) { var v = el.value.trim(); out[f[0]] = (v === '' ? 0 : Number(v)); } });
    return out;
  }
  function inventoryEditForm(p) {
    var pid = p._key || p.pid;
    var si = p.stockInfo || {};
    var src = { onHand: si.totalOnHand, committed: si.totalCommitted, held: si.totalHeld, damaged: si.totalDamaged, incoming: si.totalIncoming };
    var body = '<div style="display:flex;flex-wrap:wrap;">' + stockCountInputs('pv2Inv_', src) + '</div>' +
      '<div class="pv2-pnote">All counts for the stocked unit. <strong>Available</strong> is derived (on hand − committed − held). Stock mode &amp; low-stock threshold are set on the Fulfillment tab.</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveInventory(\'' + esc(pid) + '\')">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelInventory(\'' + esc(pid) + '\')">Cancel</button>' +
      '</div>';
    return U.card('Set stock', body);
  }
  function rerenderInventoryPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="inventory"]');
    if (pane) pane.innerHTML = inventoryPane(rec);
  }
  // ── Sales (read) ────────────────────────────────────────────────────
  // Per-product units + revenue from the shared sales map (last 500 orders),
  // window._mastProductSalesMap — the same source the products-list demand chips
  // use. No productsData dependency, so it works in a pure-v2 session.
  function _salesEntry(pid) { var m = window._mastProductSalesMap; return (m && m[pid]) || null; }
  function ensureSalesData(pid) {
    if (window._mastProductSalesMap) return;
    if (V2._salesLoading) return; V2._salesLoading = true;
    Promise.resolve(window._ensureProductSalesMap ? window._ensureProductSalesMap() : null)
      .then(function () { V2._salesLoading = false; rerenderSalesPane(pid); }, function () { V2._salesLoading = false; });
  }
  function _money(c) { return N.money((c || 0) / 100) || '—'; }
  function salesPane(p) {
    var pid = p._key || p.pid;
    if (!window._mastProductSalesMap) { ensureSalesData(pid); return U.card('Sales', '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading sales…</div>'); }
    var s = _salesEntry(pid) || {};
    var last = s.lastOrdered ? String(s.lastOrdered).slice(0, 10) : '—';
    var table = U.metricTable({
      columns: ['30 days', '90 days', 'All time'],
      rows: [
        { label: 'Units sold', cells: [String(s.last30 || 0), String(s.last90 || 0), String(s.allTime || 0)] },
        { label: 'Revenue', cells: [_money(s.revenue30), _money(s.revenue90), _money(s.revenueAll)] }
      ]
    });
    return U.card('Sales', table + '<div style="margin-top:14px;">' + U.kv([{ k: 'Last sold', v: last }]) + '</div>') +
      '<div class="pv2-pnote">Units &amp; revenue from the last 500 orders. Margin &amp; demand trend are on the Forecast tab.</div>';
  }
  function rerenderSalesPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="sales"]');
    if (pane) pane.innerHTML = salesPane(rec);
  }
  // ── Forecast (read + create-job) ────────────────────────────────────
  // Reuses the legacy forecast computation (window.forecastData), which needs the
  // legacy productsData primed — harmless in v2 (we set it from MastDB; the legacy
  // render fns it calls all guard on missing DOM). Cached after first compute.
  function _forecastEntry(pid) {
    var arr = window.forecastData; if (!Array.isArray(arr)) return null;
    for (var i = 0; i < arr.length; i++) if (arr[i] && arr[i].pid === pid) return arr[i];
    return null;
  }
  function ensureForecastData(pid) {
    if (Array.isArray(window.forecastData) && window.forecastData.length) return;
    if (V2._forecastLoading) return; V2._forecastLoading = true;
    Promise.resolve((window.productsData && window.productsData.length) ? null : MastDB.products.list())
      .then(function (all) {
        if (all) window.productsData = Array.isArray(all) ? all : Object.values(all || {});
        window.productsLoaded = true;
        return window._ensureProductSalesMap ? window._ensureProductSalesMap() : null;
      })
      .then(function () {
        try { if (window.computeAndRenderForecast) window.computeAndRenderForecast(); } catch (e) { console.error('[products-v2] forecast compute', e); }
        var t = 0;
        (function poll() {
          if (Array.isArray(window.forecastData) && window.forecastData.length) { V2._forecastLoading = false; rerenderForecastPane(pid); return; }
          if (t++ < 25) setTimeout(poll, 150); else { V2._forecastLoading = false; rerenderForecastPane(pid); }
        })();
      }, function () { V2._forecastLoading = false; });
  }
  function forecastPane(p) {
    var pid = p._key || p.pid;
    if (!(Array.isArray(window.forecastData) && window.forecastData.length)) { ensureForecastData(pid); return U.card('Forecast', '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading forecast…</div>'); }
    var f = _forecastEntry(pid);
    if (!f) return U.card('Forecast', '<div style="color:var(--warm-gray);font-size:0.9rem;">No forecast data for this product.</div>');
    var trend = f.trending ? 'Trending up' : (f.declining ? 'Declining' : 'Steady');
    var mode = f.isMTO ? 'Made to order' : (f.isStocked ? 'Stocked' : '—');
    var cov = (f.weeksCoverage != null && isFinite(f.weeksCoverage)) ? (f.weeksCoverage + ' weeks') : (f.isMTO ? 'n/a (made to order)' : '—');
    var table = U.metricTable({
      columns: ['30 days', '90 days', 'All time'],
      rows: [
        { label: 'Units sold', cells: [String(f.last30 || 0), String(f.last90 || 0), String(f.allTimeSold || 0)] },
        { label: 'Revenue', cells: [_money(f.revenue30Cents), _money(f.revenue90Cents), _money(f.revenueAllCents)] },
        { label: 'Margin', cells: [_money(f.margin30Cents), _money(f.margin90Cents), _money(f.marginAllCents)] }
      ]
    });
    var card = U.card('Forecast', table + '<div style="margin-top:14px;">' + U.kv([
      { k: 'Monthly sales rate', v: (f.monthlyRate != null ? f.monthlyRate + ' / mo' : '—') },
      { k: 'On-hand coverage', v: cov },
      { k: 'Trend', v: trend },
      { k: 'Fulfillment', v: mode }
    ]) + '</div>');
    var sug = '';
    if (f.suggestBuild && f.suggestedQty) {
      sug = U.card('Suggested build', '<div style="font-size:0.9rem;margin-bottom:10px;">Stock is low for the current sales rate. Suggested build: <strong>' + esc(String(f.suggestedQty)) + ' pcs</strong>.</div>' +
        (_can('jobs', 'edit') ? '<button class="btn btn-primary btn-small" onclick="ProductsV2.createForecastJob(\'' + esc(pid) + '\',' + Number(f.suggestedQty) + ')">Create production job →</button>' : '<span style="color:var(--warm-gray);font-size:0.85rem;">You don’t have permission to create production jobs.</span>'));
    } else if (f.considerStocking) {
      sug = '<div class="pv2-pnote">Made-to-order with steady demand — consider stocking it.</div>';
    }
    return card + sug;
  }
  function rerenderForecastPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="forecast"]');
    if (pane) pane.innerHTML = forecastPane(rec);
  }
  // Channel bindings: which channels the product sells on. A variant inherits the
  // binding unless its id is in excludedVariantIds. (externalRefs/listing IDs come
  // from the publish flow and are integration-managed — not edited here.)
  function productBindings(p) {
    if (p && Array.isArray(p.channelBindings)) return p.channelBindings;
    if (p && Array.isArray(p.channelIds)) return p.channelIds.map(function (cid) { return { channelId: cid, excludedVariantIds: [] }; });
    return [];
  }
  function bindingFor(p, channelId) { return productBindings(p).filter(function (b) { return b && b.channelId === channelId; })[0]; }
  function variantExcluded(p, channelId, vid) { var b = bindingFor(p, channelId); return !!(b && Array.isArray(b.excludedVariantIds) && b.excludedVariantIds.indexOf(vid) >= 0); }
  function ensureChannels(pid, rerenderFn) {
    if (V2._channelsCache || V2._channelsLoading) return;
    V2._channelsLoading = true;
    var done = rerenderFn || function () { rerenderChannelsPane(pid); };
    Promise.resolve(window.__mastChannelsCache || MastDB.get('admin/channels'))
      .then(function (ch) { V2._channelsCache = ch || {}; V2._channelsLoading = false; done(); }, function () { V2._channelsLoading = false; });
  }
  // The connected, active channels (shared mapping for the product + variant panes).
  function activeChannels() {
    if (!V2._channelsCache) return null;
    return Object.keys(V2._channelsCache).map(function (k) { var c = V2._channelsCache[k] || {}; return { id: k, name: c.name || c.displayName || c.platform || k, platform: c.platform || '', active: c.isActive !== false }; }).filter(function (c) { return c.active; });
  }
  function channelsPane(p) {
    var pid = p._key || p.pid;
    if (!V2._channelsCache) { ensureChannels(pid); return U.card('Channels', '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading channels…</div>'); }
    var channels = activeChannels();
    if (!channels.length) return U.card('Channels', '<div style="color:var(--warm-gray);font-size:0.9rem;">No channels connected. Connect one in the Channels module first.</div>');
    var hasVar = variantCount(p) > 0;
    var rows = channels.map(function (c) {
      var bound = !!bindingFor(p, c.id);
      var toggle = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.toggleChannel(\'' + esc(pid) + '\',\'' + esc(c.id) + '\')">' + (bound ? 'Remove' : 'Sell here') + '</button>' : '';
      var head = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-top:1px solid var(--border);">' +
        '<span>' + esc(c.name) + (c.platform ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">· ' + esc(c.platform) + '</span>' : '') + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px;">' + (bound ? U.badge('On', 'teal') : U.badge('Off', 'neutral')) + toggle + '</span></div>';
      var varRows = '';
      if (bound && hasVar) {
        var canEd = canEditProduct();
        varRows = '<div style="padding:2px 0 12px 14px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">' +
          realVariants(p).map(function (v) {
            var ex = variantExcluded(p, c.id, v.id);
            return '<button' + (canEd ? ' onclick="ProductsV2.toggleVariantChannel(\'' + esc(pid) + '\',\'' + esc(c.id) + '\',\'' + esc(v.id) + '\')"' : ' disabled') + ' title="' + (ex ? 'Excluded' : 'Included') + (canEd ? ' — tap to toggle' : '') + '" style="border:1px solid var(--border);border-radius:999px;padding:4px 11px;font-size:0.78rem;cursor:' + (canEd ? 'pointer' : 'default') + ';background:' + (ex ? 'transparent' : 'color-mix(in srgb,var(--teal) 16%,transparent)') + ';color:' + (ex ? 'var(--warm-gray)' : 'var(--teal,teal)') + ';' + (ex ? 'text-decoration:line-through;' : '') + '">' + esc(variantLabel(v)) + '</button>';
          }).join('') + (canEd ? '<span style="color:var(--warm-gray);font-size:0.72rem;">tap a variant to include / exclude</span>' : '') + '</div>';
      }
      return head + varRows;
    }).join('');
    return U.card('Channels · where this product sells', rows) +
      '<div class="pv2-pnote">Every variant inherits the product’s channels; tap a variant chip to exclude (or re-include) it on that channel. Listing IDs &amp; sync status come from connecting + publishing.</div>';
  }
  function rerenderChannelsPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="channels"]');
    if (pane) pane.innerHTML = channelsPane(rec);
  }
  // Variant Channels pane: a variant inherits the product's channels, but can be
  // EXCLUDED from any one of them (e.g. gold necklace direct-only while silver
  // sells everywhere). Shows each channel the product sells on + this variant's
  // status, with an Include/Exclude toggle. Binding/unbinding a channel itself
  // stays product-level (the product Channels tab) — here you only opt this
  // variant in or out of channels the product already sells on.
  function variantChannelsPane(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    if (!V2._channelsCache) { ensureChannels(pid, function () { rerenderVariantChannelsPane(pid, vid); }); return UU.card('Channels · this variant', '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading channels…</div>'); }
    var channels = activeChannels();
    // Link to the product's Channels tab — binding/unbinding a channel is a
    // product-level action, so the variant pane points there for the actual setup.
    var goToProduct = '<div style="margin-top:12px;"><button class="btn btn-secondary btn-small" onclick="ProductsV2.openToTab(\'' + esc(pid) + '\',\'channels\')">Open product Channels →</button></div>';
    if (!channels.length) return UU.card('Channels · this variant', '<div style="color:var(--warm-gray);font-size:0.9rem;">No channels connected. Connect one in the Channels module first.</div>');
    var bound = channels.filter(function (c) { return !!bindingFor(p, c.id); });
    if (!bound.length) return UU.card('Channels · this variant', '<div style="color:var(--warm-gray);font-size:0.9rem;">This product isn’t selling on any channel yet. Set channels on the product’s Channels tab — this variant inherits them.</div>' + goToProduct);
    var canEd = canEditProduct();
    var rows = bound.map(function (c) {
      var ex = variantExcluded(p, c.id, vid);
      var status = ex ? UU.badge('Excluded', 'neutral') : UU.badge('Selling', 'teal');
      var toggle = canEd ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.toggleVariantChannel(\'' + esc(pid) + '\',\'' + esc(c.id) + '\',\'' + esc(vid) + '\')">' + (ex ? 'Include' : 'Exclude') + '</button>' : '';
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-top:1px solid var(--border);">' +
        '<span>' + esc(c.name) + (c.platform ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">· ' + esc(c.platform) + '</span>' : '') + '</span>' +
        '<span style="display:flex;align-items:center;gap:8px;">' + status + toggle + '</span></div>';
    }).join('');
    return UU.card('Channels · this variant', rows + goToProduct) +
      '<div class="pv2-pnote">This variant inherits the product’s channels; exclude it from any one (e.g. sell the gold one direct-only while the rest go everywhere). Add or remove channels for the whole product on the product’s Channels tab.</div>';
  }
  function rerenderVariantChannelsPane(pid, vid) {
    var rec = buildVariantRecord(pid + '::' + vid); if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="v-channels"]');
    if (pane) pane.innerHTML = variantChannelsPane(U, rec.product, rec.variant);
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
    var uploadBtn = canEditProduct() ? '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;"><input type="file" accept="image/*" style="display:none;" onchange="ProductsV2.uploadImage(\'' + esc(pid) + '\',this)">Upload image</label>' : '';
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
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editInfo(\'' + esc(pid) + '\')">' + editLbl + '</button>' : '';
    var desc = p.description || '';
    var descShow = desc.length > 160 ? esc(desc.slice(0, 160)) + '…' : esc(desc);
    return U.card('Info · product-level', U.kv([
      { k: 'Name', v: p.name ? esc(p.name) : '—' },
      { k: 'Category', v: categoryLabel(p) || '—' },
      { k: 'Business line', v: p.businessLine || '—' },
      { k: 'Slug', v: p.slug || '—' },
      // Acquisition mode is structural (drives the cost/recipe machinery) — not
      // an inline-editable field here.
      { k: 'Acquisition', v: MODE_LABEL[p.acquisitionType || 'build'] || 'Build' },
      { k: 'SKU', v: p.sku || '—' },
      { k: 'Short description', v: p.shortDescription ? esc(p.shortDescription) : '—' },
      { k: 'Description', v: desc ? descShow : '—' }
    ]), { headerRight: editBtn });
  }
  // Inline edit form for the clean top-level Info fields. Writes delegate to
  // window.MakerProductBridge (no new backend) — loadModule+guard at call time.
  function infoEditForm(p) {
    var pid = p._key || p.pid;
    var guarded = String(p.status || '').toLowerCase() === 'active';
    var inputStyle = 'display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;';
    function field(label, id, val) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + esc(label) +
        '<input id="' + id + '" type="text" value="' + esc(val == null ? '' : String(val)) +
        '" style="' + inputStyle + '"></label>';
    }
    function textarea(label, id, val) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + esc(label) +
        '<textarea id="' + id + '" rows="3" style="' + inputStyle + 'resize:vertical;font-family:inherit;">' + esc(val == null ? '' : String(val)) + '</textarea></label>';
    }
    var note = guarded
      ? '<div class="pv2-pnote">This product is Published — your edits stage as a pending revision and go live when you Apply.</div>'
      : '';
    var body = note +
      field('Name', 'pv2InfoName', p.name) +
      field('Category', 'pv2InfoCategory', categoryLabel(p)) +
      field('Business line', 'pv2InfoBizLine', p.businessLine) +
      field('Slug', 'pv2InfoSlug', p.slug) +
      field('SKU', 'pv2InfoSku', p.sku) +
      field('Short description', 'pv2InfoShortDesc', p.shortDescription) +
      textarea('Description', 'pv2InfoDescription', p.description) +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveInfo(\'' + esc(pid) + '\')">' + (guarded ? 'Stage changes' : 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelInfo(\'' + esc(pid) + '\')">Cancel</button>' +
      '</div>';
    return U.card('Edit info · product-level', body);
  }
  // Re-render the Info tab in place — keeps the user on the Info tab; no full SO re-open.
  function rerenderInfoPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="info"]');
    if (paneEl) paneEl.innerHTML = infoPane(rec);
  }
  // ── Attributes (channel/merchandising metadata) ───────────────────────
  // Model (ratified, see docs/ux-audit/channel-attributes-research.md):
  //   attributes.authored  — set in Mast, pushed OUT on publish (tags/materials/custom). EDITABLE.
  //   attributes.imported  — mirrored FROM each channel, keyed by channelId. READ-ONLY.
  //   attributes.derived   — NOT stored; merchandising badges computed at render.
  // `authored.tags` reclaims the previously-vestigial product.tags.
  function productAttributes(p) {
    var a = (p && p.attributes) || {};
    var authored = a.authored || {};
    return {
      authored: authored,
      tags: Array.isArray(authored.tags) ? authored.tags : (Array.isArray(p.tags) ? p.tags : []),
      materials: Array.isArray(authored.materials) ? authored.materials : [],
      custom: (authored.custom && typeof authored.custom === 'object') ? authored.custom : {},
      imported: a.imported || {}
    };
  }
  // Derived badges — computed live, never stored (avoids staleness). Only what's
  // derivable from data already on the product (stockInfo); "top seller" needs the
  // sales map and is surfaced in the Sales lens, not stored here.
  function derivedBadges(p) {
    var out = [], si = p.stockInfo || {};
    var tracked = si.stockType && !/order|build/.test(si.stockType); // made/build-to-order never "out"
    if (tracked && si.totalAvailable != null) {
      var thr = (si.lowStockThreshold != null ? si.lowStockThreshold : 2);
      if (si.totalAvailable <= 0) out.push({ label: 'Out of stock', tone: 'amber' });
      else if (si.totalAvailable <= thr) out.push({ label: 'Low stock', tone: 'amber' });
    }
    return out;
  }
  function attrChips(items, color) {
    if (!items || !items.length) return '<span style="color:var(--warm-gray);font-size:0.85rem;">—</span>';
    return items.map(function (t) { return '<span style="display:inline-block;border:1px solid var(--border);border-radius:999px;padding:3px 10px;font-size:0.78rem;margin:0 6px 6px 0;color:' + (color || 'var(--text)') + ';">' + esc(String(t)) + '</span>'; }).join('');
  }
  function attributesPane(p) {
    var pid = p._key || p.pid;
    if (V2.editAttrs === pid) return attributesEditForm(p);
    var A = productAttributes(p);
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editAttributes(\'' + esc(pid) + '\')">Edit</button>' : '';
    var customKeys = Object.keys(A.custom);
    var authoredBody = U.kv([
      { k: 'Tags', v: attrChips(A.tags, 'var(--teal,teal)') },
      { k: 'Materials', v: attrChips(A.materials) }
    ]) + (customKeys.length ? '<div style="margin-top:8px;font-size:0.85rem;color:var(--warm-gray);">Custom: ' + customKeys.map(function (k) { return esc(k) + ' = ' + esc(String(A.custom[k])); }).join(' · ') + '</div>' : '');
    var badges = derivedBadges(p);
    var derivedHtml = badges.length ? badges.map(function (b) { return U.badge(b.label, b.tone); }).join(' ') : '<span style="color:var(--warm-gray);font-size:0.85rem;">No badges right now.</span>';
    var impKeys = Object.keys(A.imported);
    var importedHtml = impKeys.length ? impKeys.map(function (cid) {
      var ci = A.imported[cid] || {};
      var name = (V2._channelsCache && V2._channelsCache[cid] && (V2._channelsCache[cid].name || V2._channelsCache[cid].platform)) || cid;
      var rows = [];
      if (Array.isArray(ci.tags) && ci.tags.length) rows.push({ k: 'Tags', v: attrChips(ci.tags) });
      if (ci.productType) rows.push({ k: 'Type', v: esc(String(ci.productType)) });
      if (Array.isArray(ci.materials) && ci.materials.length) rows.push({ k: 'Materials', v: attrChips(ci.materials) });
      if (Array.isArray(ci.occasion) && ci.occasion.length) rows.push({ k: 'Occasion', v: attrChips(ci.occasion) });
      if (Array.isArray(ci.style) && ci.style.length) rows.push({ k: 'Style', v: attrChips(ci.style) });
      if (ci.vendor) rows.push({ k: 'Vendor', v: esc(String(ci.vendor)) });
      return '<div style="margin-bottom:10px;"><div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--warm-gray);margin-bottom:4px;">' + esc(name) + '</div>' + (rows.length ? U.kv(rows) : '<span style="color:var(--warm-gray);font-size:0.85rem;">—</span>') + '</div>';
    }).join('') : '<div style="color:var(--warm-gray);font-size:0.9rem;">Channel attributes appear here once products sync from connected channels.</div>';
    return U.card('Attributes · authored', authoredBody, { headerRight: editBtn }) +
      U.card('Merchandising badges · derived', derivedHtml) +
      U.card('From channels · imported (read-only)', importedHtml) +
      '<div class="pv2-pnote">Authored attributes are yours — pushed out to channels on publish. Imported mirrors what each channel sent. Badges are computed live from stock &amp; sales (not stored).</div>';
  }
  function attributesEditForm(p) {
    var pid = p._key || p.pid;
    var A = productAttributes(p);
    var inputStyle = 'display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;';
    function csv(label, id, arr, hint) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + esc(label) +
        '<input id="' + id + '" type="text" value="' + esc((arr || []).join(', ')) + '" style="' + inputStyle + '">' +
        '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(hint) + '</span></label>';
    }
    var body =
      csv('Tags', 'pv2AttrTags', A.tags, 'Comma-separated. Your merchandising tags (pushed to channels on publish).') +
      csv('Materials', 'pv2AttrMaterials', A.materials, 'Comma-separated. e.g. sterling silver, resin.') +
      '<div class="pv2-pnote">Imported (channel) attributes and derived badges aren’t edited here — only your authored ones.</div>' +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveAttributes(\'' + esc(pid) + '\')">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelAttributes(\'' + esc(pid) + '\')">Cancel</button>' +
      '</div>';
    return U.card('Edit attributes · authored', body);
  }
  function rerenderAttributesPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="attributes"]');
    if (paneEl) paneEl.innerHTML = attributesPane(rec);
  }
  // ── Variant Attributes (override-or-inherit authored tags/materials) ──
  // A variant inherits the product's authored tags/materials unless it sets its
  // own (variant.attributes.authored). Same provenance model as the product;
  // imported is the per-variant channel mirror (rare — most channels send tags at
  // the product level), derived badges are computed per-variant from its stock.
  function variantAttributes(p, v) {
    var va = (v && v.attributes) || {};
    var authored = va.authored || {};
    var prod = productAttributes(p);
    var ownTags = Array.isArray(authored.tags) ? authored.tags : null;       // null = inherit
    var ownMaterials = Array.isArray(authored.materials) ? authored.materials : null;
    return {
      authored: authored,
      ownTags: ownTags, ownMaterials: ownMaterials,
      effTags: ownTags != null ? ownTags : prod.tags,
      effMaterials: ownMaterials != null ? ownMaterials : prod.materials,
      tagsOverridden: ownTags != null,
      materialsOverridden: ownMaterials != null,
      imported: va.imported || {}
    };
  }
  function variantDerivedBadges(p, v) {
    var out = [], vsi = variantStockInfo(p, v), si = p.stockInfo || {};
    var tracked = si.stockType && !/order|build/.test(si.stockType);
    if (tracked && vsi.available != null) {
      var thr = (si.lowStockThreshold != null ? si.lowStockThreshold : 2);
      if (vsi.available <= 0) out.push({ label: 'Out of stock', tone: 'amber' });
      else if (vsi.available <= thr) out.push({ label: 'Low stock', tone: 'amber' });
    }
    return out;
  }
  function variantAttributesPane(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    if (V2.editVarAttrs === (pid + '::' + vid)) return variantAttributesEditForm(UU, p, v);
    var A = variantAttributes(p, v);
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantAttributes(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Edit</button>' : '';
    function effV(items, overridden) {
      return attrChips(items, overridden ? 'var(--amber)' : null) + (overridden ? ' ' + UU.badge('override', 'amber') : ' <span class="from">· inherits product</span>');
    }
    var authoredBody = UU.kv([
      { k: 'Tags', v: effV(A.effTags, A.tagsOverridden) },
      { k: 'Materials', v: effV(A.effMaterials, A.materialsOverridden) }
    ]);
    var badges = variantDerivedBadges(p, v);
    var derivedHtml = badges.length ? badges.map(function (b) { return UU.badge(b.label, b.tone); }).join(' ') : '<span style="color:var(--warm-gray);font-size:0.85rem;">No badges right now.</span>';
    var impKeys = Object.keys(A.imported);
    var importedHtml = impKeys.length ? impKeys.map(function (cid) {
      var ci = A.imported[cid] || {};
      var name = (V2._channelsCache && V2._channelsCache[cid] && (V2._channelsCache[cid].name || V2._channelsCache[cid].platform)) || cid;
      var rows = [];
      if (Array.isArray(ci.tags) && ci.tags.length) rows.push({ k: 'Tags', v: attrChips(ci.tags) });
      if (Array.isArray(ci.materials) && ci.materials.length) rows.push({ k: 'Materials', v: attrChips(ci.materials) });
      return '<div style="margin-bottom:10px;"><div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:.04em;color:var(--warm-gray);margin-bottom:4px;">' + esc(name) + '</div>' + (rows.length ? UU.kv(rows) : '<span style="color:var(--warm-gray);font-size:0.85rem;">—</span>') + '</div>';
    }).join('') : '<div style="color:var(--warm-gray);font-size:0.9rem;">This variant inherits the product’s channel attributes. Per-variant channel data lands here only if a channel sends it.</div>';
    return UU.card('Attributes · this variant', authoredBody, { headerRight: editBtn }) +
      UU.card('Merchandising badges · derived', derivedHtml) +
      UU.card('From channels · imported (read-only)', importedHtml) +
      '<div class="pv2-pnote">A variant inherits the product’s authored tags &amp; materials unless it overrides them here — e.g. give the gold one its own tags. Blank a field to go back to inheriting.</div>';
  }
  function variantAttributesEditForm(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    var A = variantAttributes(p, v), prod = productAttributes(p);
    var inputStyle = 'display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;';
    function csv(label, id, ownArr, inheritArr) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + esc(label) +
        '<input id="' + id + '" type="text" value="' + esc((ownArr || []).join(', ')) + '" placeholder="inherits: ' + esc((inheritArr || []).join(', ') || 'none') + '" style="' + inputStyle + '">' +
        '<span style="font-size:0.72rem;color:var(--warm-gray);">Comma-separated. Blank = inherit the product’s.</span></label>';
    }
    var body =
      csv('Tags', 'pv2VarAttrTags', A.ownTags, prod.tags) +
      csv('Materials', 'pv2VarAttrMaterials', A.ownMaterials, prod.materials) +
      '<div class="pv2-pnote">Setting a field overrides the product just for this variant; blank clears the override (back to inheriting).</div>' +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveVariantAttributes(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelVariantAttributes(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Cancel</button>' +
      '</div>';
    return UU.card('Edit attributes · this variant', body);
  }
  function rerenderVariantAttributesPane(pid, vid) {
    var rec = buildVariantRecord(pid + '::' + vid); if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="v-attributes"]');
    if (paneEl) paneEl.innerHTML = variantAttributesPane(U, rec.product, rec.variant);
  }
  // Fulfillment is its own top-level tab (operator: "does not work inside Info").
  // Re-render in place so editing keeps the user on the Fulfillment tab.
  function rerenderFulfillmentPane(pid) {
    var rec = V2.byId[pid]; if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var paneEl = body && body.querySelector('.mu-pane[data-pane="fulfillment"]');
    if (paneEl) paneEl.innerHTML = fulfillmentPane(rec);
  }
  // ── Fulfillment (how the product ships) ───────────────────────────────
  // stockType + lead time live on the inventory record (admin/inventory); the
  // "second" flag is membership in the 'seconds' category (existing storefront
  // logic: seconds only sell from on-hand stock, never built).
  var STOCK_MODES = [
    { v: 'in-stock', l: 'In stock — track inventory, ship only what’s on hand' },
    { v: 'limited', l: 'Limited — track inventory, ship only what’s on hand' },
    { v: 'strict', l: 'Strict — track inventory, never oversell' },
    { v: 'stock-to-build', l: 'Stock to build — keep some on hand, rebuild when low' },
    { v: 'made-to-order', l: 'Made to order — built per order (uses lead time)' },
    { v: 'build-to-order', l: 'Build to order — built per order (uses lead time)' }
  ];
  function stockModeLabel(t) { for (var i = 0; i < STOCK_MODES.length; i++) if (STOCK_MODES[i].v === t) return STOCK_MODES[i].l; return t || '—'; }
  function productIsSecond(p) { return Array.isArray(p.categories) && p.categories.indexOf('seconds') >= 0; }
  function availabilityLabel(p) { return String(p.availability || '').toLowerCase() === 'discontinued' ? 'Discontinued' : 'Available'; }
  function productDimensions(p) { return (p.makerAttributes && p.makerAttributes.dimensions) || ''; }
  function fulfillmentPane(p) {
    var pid = p._key || p.pid;
    if (V2.editFulfill === pid) return fulfillmentEditForm(p);
    var si = p.stockInfo || {};
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editFulfillment(\'' + esc(pid) + '\')">Edit</button>' : '';
    var lead = (si.productionLeadTimeDays != null ? MastFormat.countNoun(si.productionLeadTimeDays, 'day') : '—');
    var dims = productDimensions(p);
    return U.card('Fulfillment', U.kv([
      { k: 'Stock mode', v: (si.stockType ? esc(si.stockType) : '—') },
      { k: 'Lead time to build', v: lead },
      { k: 'Batch size', v: (p.batchSize ? esc(String(p.batchSize)) + ' / build' : '—') },
      { k: 'Availability', v: availabilityLabel(p) === 'Discontinued' ? U.badge('Discontinued', 'amber') : '<span class="from">Available</span>' },
      { k: 'Dimensions', v: dims ? esc(dims) : '—' },
      { k: 'Weight', v: (p.weightOz != null && p.weightOz !== '') ? esc(String(p.weightOz)) + ' oz' : '—' },
      { k: 'Is a second', v: productIsSecond(p) ? U.badge('Second / B-grade', 'amber') : '<span class="from">no</span>' }
    ]), { headerRight: editBtn });
  }
  function fulfillmentEditForm(p) {
    var pid = p._key || p.pid;
    var si = p.stockInfo || {};
    var guarded = String(p.status || '').toLowerCase() === 'active';
    var curMode = si.stockType || 'made-to-order';
    var opts = STOCK_MODES.map(function (m) { return '<option value="' + esc(m.v) + '"' + (m.v === curMode ? ' selected' : '') + '>' + esc(m.l) + '</option>'; }).join('');
    var lead = (si.productionLeadTimeDays != null ? si.productionLeadTimeDays : '');
    var isSec = productIsSecond(p);
    var isDiscontinued = String(p.availability || '').toLowerCase() === 'discontinued';
    var dims = productDimensions(p);
    var weightOz = (p.weightOz != null ? p.weightOz : '');
    var fieldStyle = 'display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;';
    // On Active products, stock mode + lead time write live (operational), but the
    // catalog fields (availability, dimensions, weight, second-flag) stage as a
    // pending revision — call out the split so it isn't surprising.
    var note = guarded
      ? '<div class="pv2-pnote">This product is Published — stock mode and lead time apply live; availability, dimensions, weight and the second flag stage as a pending revision (go live when you Apply).</div>'
      : '';
    var body = note +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Stock mode' +
      '<select id="pv2FulStockMode" style="' + fieldStyle + '">' + opts + '</select>' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);">Made/Build-to-order never go “out of stock” — they ship on the lead time. Tracked modes ship only what’s on hand.</span></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Lead time to build (days)' +
      '<input id="pv2FulLead" type="number" min="0" step="1" value="' + esc(lead === '' ? '' : String(lead)) + '" style="' + fieldStyle + 'width:140px;"></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Batch size (units per build)' +
      '<input id="pv2FulBatchSize" type="number" min="0" step="1" value="' + esc(p.batchSize != null && p.batchSize !== '' ? String(p.batchSize) : '') + '" placeholder="e.g. 12" style="' + fieldStyle + 'width:140px;">' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);">How many you make in one production run — drives capacity planning.</span></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Availability' +
      '<select id="pv2FulAvailability" style="' + fieldStyle + '">' +
      '<option value="available"' + (!isDiscontinued ? ' selected' : '') + '>Available</option>' +
      '<option value="discontinued"' + (isDiscontinued ? ' selected' : '') + '>Discontinued</option>' +
      '</select></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Dimensions' +
      '<input id="pv2FulDimensions" type="text" value="' + esc(dims) + '" placeholder="e.g. 1.5&quot; x 0.75&quot;" style="' + fieldStyle + '"></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Weight (oz)' +
      '<input id="pv2FulWeightOz" type="number" min="0" step="0.1" value="' + esc(weightOz === '' ? '' : String(weightOz)) + '" placeholder="e.g. 12" style="' + fieldStyle + 'width:140px;"></label>' +
      '<label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:0.9rem;cursor:pointer;">' +
      '<input id="pv2FulSecond" type="checkbox"' + (isSec ? ' checked' : '') + ' style="width:16px;height:16px;cursor:pointer;">This is a second / B-grade</label>' +
      '<div class="pv2-pnote">Seconds only sell from on-hand stock (never built) and hide on the storefront when out of stock.</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveFulfillment(\'' + esc(pid) + '\')">' + (guarded ? 'Stage changes' : 'Save') + '</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelFulfillment(\'' + esc(pid) + '\')">Cancel</button>' +
      '</div>';
    return U.card('Edit fulfillment', body);
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
    // Drill-in path (e.g. from a channel's Products tab): register the fetched
    // record in V2.byId so the async pane re-renders (Channels/Forecast, which
    // look the record up by pid) resolve — otherwise they stick on "Loading…".
    fetch: function (id) { return Promise.resolve(MastDB.products.get(id)).then(function (p) { if (!p) return null; var rec = stamp(Object.assign({}, p), id); V2.byId[rec._key] = rec; return rec; }); },
    // Default/product SO: the ENGINE MastFlow process model. detail.flow makes the
    // engine render the real process header (stepper + readiness checklist + guarded
    // Advance) into #muFlowHost — the process is the pinned STRUCTURE, not a tab
    // (matches the ratified mock + the orders/commissions engine standard).
    detail: {
      flow: 'products',
      flowModule: 'productsWorkflow',
      // Cancel-on-leave: switching away from a tab mid-edit discards the
      // in-progress edit (reverts that pane to read view). Engine fires this
      // before hiding the pane being left; nothing persists without Save/Stage.
      onPaneLeave: function (prevPane, nextPane, rec) {
        var pid = rec._key || rec.pid;
        if (prevPane === 'info' && V2.editInfo) { V2.editInfo = null; rerenderInfoPane(pid); }
        else if (prevPane === 'fulfillment' && V2.editFulfill) { V2.editFulfill = null; rerenderFulfillmentPane(pid); }
        else if (prevPane === 'pricing' && V2.editPricing) { V2.editPricing = null; rerenderPricingPane(pid); }
        else if (prevPane === 'inventory' && V2.editInv) { V2.editInv = null; rerenderInventoryPane(pid); }
        else if (prevPane === 'attributes' && V2.editAttrs) { V2.editAttrs = null; rerenderAttributesPane(pid); }
      },
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
      // guided-record model). EVERY requirement `target` emitted by the products
      // MastFlow spec (workflows/products.workflow.js) now has a native V2 home —
      // there is no longer any reason to bounce to the legacy define page:
      //   define-section   (mode-chosen / defined)  → Recipe
      //   markup-section   (costed)                 → Pricing
      //   listing-section  (listingReady)           → Image
      //   channels-section (channeled / -live)      → Channels
      //   capacity-section (capacityPlanned)        → Fulfillment (batch size lives there)
      // The legacy `navigateToClassic('products')` fallback was removed once
      // capacity-section landed on the Fulfillment pane (its last unmapped
      // section). An unrecognized target now no-ops gracefully (return false →
      // the engine logs and does nothing) rather than dumping the user into V1.
      onFlowTarget: function (targetId, rec) {
        var PANE = {
          'define-section': 'recipe',
          'markup-section': 'pricing',
          'listing-section': 'image',
          'channels-section': 'channels',
          'capacity-section': 'fulfillment'
        };
        var pane = PANE[targetId];
        if (!pane) return false; // unknown target → let the engine no-op (no classic bounce)
        var body = document.getElementById('mastSlideOutBody');
        var btn = body && body.querySelector('.mu-ptabs button[onclick*="\'' + pane + '\'"]');
        if (btn) { btn.click(); if (typeof btn.scrollIntoView === 'function') btn.scrollIntoView({ block: 'nearest' }); }
        return true;
      },
      render: function (UU, p) {
        // Fresh open/reopen always starts read-only — a prior session's abandoned
        // edit flag must not reopen a pane in edit mode (cancel-on-leave on close).
        V2.editInfo = V2.editFulfill = V2.editPricing = V2.editInv = V2.editAttrs = null;
        var tiles = productTiles(UU, p);
        var tabs = [
          { key: 'pricing', label: 'Pricing' }, { key: 'sales', label: 'Sales' }, { key: 'recipe', label: 'Recipe' },
          { key: 'inventory', label: 'Inventory' }, { key: 'forecast', label: 'Forecast' },
          { key: 'fulfillment', label: 'Fulfillment' }, { key: 'channels', label: 'Channels' }, { key: 'image', label: 'Image' }, { key: 'info', label: 'Info' }, { key: 'attributes', label: 'Attributes' }
        ].filter(function (t) {
          // Finance-sensitive tabs follow the retired module's view permission.
          if (t.key === 'sales') return canViewLens('sales');
          if (t.key === 'forecast') return canViewLens('forecast');
          if (t.key === 'inventory') return canViewLens('inventory');
          return true;
        });
        function pane(key, html, active) { return '<div class="mu-pane" data-pane="' + key + '"' + (active ? '' : ' hidden') + '>' + html + '</div>'; }
        // When the product has variants, make it unmistakable you're on the
        // Default (the base every variant inherits) — not a single variant.
        var nv = variantCount(p);
        var defaultBanner = nv > 0
          ? '<div style="margin:0 0 10px;padding:7px 12px;border-radius:8px;background:color-mix(in srgb,var(--info) 13%,transparent);color:var(--info);font-size:0.85rem;font-weight:600;">◆ Default — base for all ' + MastFormat.countNoun(nv, 'variant') + '. Edits here apply to every variant unless it overrides.</div>'
          : '';
        // Product image thumbnail on the header — click for the full-size picture.
        // Header strip: product image thumbnail + the variant switcher pill.
        // #muFlowHost: the engine injects the MastFlow process header here (the structure).
        return headerStrip(p, firstImage(p), p.name || 'Product', null) + defaultBanner + UU.stickyHead(tiles, '') +
          '<div id="muFlowHost" class="pv2-flowhost">Loading workflow…</div>' +
          UU.paneTabsBar(tabs, 'pricing') +
          pane('pricing', pricingPane(p), true) +
          (canViewLens('sales') ? pane('sales', salesPane(p)) : '') +
          pane('recipe', recipePane(p)) +
          (canViewLens('inventory') ? pane('inventory', inventoryPane(p)) : '') +
          (canViewLens('forecast') ? pane('forecast', forecastPane(p)) : '') +
          pane('fulfillment', fulfillmentPane(p)) +
          pane('channels', channelsPane(p)) +
          pane('image', imagePane(p)) +
          pane('info', infoPane(p)) +
          pane('attributes', attributesPane(p));
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
      // Cancel-on-leave for the variant SO's edit-in-pane tabs (see the product
      // entity's onPaneLeave). rec._key is 'pid::vid'.
      onPaneLeave: function (prevPane, nextPane, rec) {
        var parts = String(rec._key || '').split('::'); var pid = parts[0], vid = parts[1];
        if (prevPane === 'v-pricing' && V2.editVarPricing) { V2.editVarPricing = null; rerenderVariantPricingPane(pid, vid); }
        else if (prevPane === 'v-inventory' && V2.editVarInv) { V2.editVarInv = null; rerenderVariantInventoryPane(pid, vid); }
        else if (prevPane === 'v-info' && V2.editVarInfo) { V2.editVarInfo = null; rerenderVariantInfoPane(pid, vid); }
        else if (prevPane === 'v-fulfill' && V2.editVarFulfill) { V2.editVarFulfill = null; rerenderVariantFulfillmentPane(pid, vid); }
        else if (prevPane === 'v-attributes' && V2.editVarAttrs) { V2.editVarAttrs = null; rerenderVariantAttributesPane(pid, vid); }
      },
      render: function (UU, r) {
        // Fresh open always starts read-only (cancel-on-leave on close/reopen).
        V2.editVarPricing = V2.editVarInv = V2.editVarInfo = V2.editVarFulfill = V2.editVarAttrs = null;
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
        var tabs = [{ key: 'v-pricing', label: 'Pricing' }, { key: 'v-recipe', label: 'Recipe' }, { key: 'v-channels', label: 'Channels' }, { key: 'v-inventory', label: 'Inventory' }, { key: 'v-fulfill', label: 'Fulfillment' }, { key: 'v-image', label: 'Image' }, { key: 'v-info', label: 'Info' }, { key: 'v-attributes', label: 'Attributes' }];
        function pane(key, html, active) { return '<div class="mu-pane" data-pane="' + key + '"' + (active ? '' : ' hidden') + '>' + html + '</div>'; }
        var ctx = '<div class="pv2-pnote">A variant uses the Default’s values for anything it doesn’t set itself. It has no lifecycle of its own — it follows the product.</div>';
        // Header strip: variant image (its own binding if set, else the product's
        // primary) + the variant switcher pill (current = this variant).
        var vimg = variantImageSrc(p, v);
        return headerStrip(p, vimg, (p.name || 'Variant') + ' — ' + variantLabel(v), v.id) + UU.stickyHead(tiles, UU.paneTabsBar(tabs, 'v-pricing')) +
          pane('v-pricing', variantPricingPane(UU, p, v) + ctx, true) +
          pane('v-recipe', variantRecipePane(UU, p, v)) +
          pane('v-channels', variantChannelsPane(UU, p, v)) +
          pane('v-inventory', variantInventoryPane(UU, p, v)) +
          pane('v-fulfill', variantFulfillmentPane(UU, p, v)) +
          pane('v-image', variantImagePane(UU, p, v)) +
          pane('v-info', variantInfoPane(UU, p, v)) +
          pane('v-attributes', variantAttributesPane(UU, p, v));
      }
    }
  });
  // Variant Info pane: a variant is a first-class object (stable unique id), so it
  // can carry a custom display name distinct from its option-combo label. Light
  // inline edit of variant.name; blank reverts to the auto option label.
  function variantInfoPane(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    if (V2.editVarInfo === (pid + '::' + vid)) return variantInfoEditForm(UU, p, v);
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantInfo(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Edit</button>' : '';
    var comboStr = Object.keys(v.combo || {}).map(function (k) { return esc(k) + ': ' + esc(v.combo[k]); }).join(', ') || '—';
    return UU.card('Info · this variant', UU.kv([
      { k: 'Name', v: v.name ? esc(v.name) : '<span class="from">uses the option label</span>' },
      { k: 'Options', v: comboStr },
      { k: 'SKU', v: v.sku ? esc(v.sku) : '<span class="from">uses the Default · set on Pricing</span>' },
      { k: 'Variant id', v: '<span class="from" style="font-size:0.72rem;">' + esc(vid) + '</span>' }
    ]), { headerRight: editBtn });
  }
  function variantInfoEditForm(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    var comboLabel = Object.keys(v.combo || {}).map(function (k) { return v.combo[k]; }).filter(Boolean).join(' / ') || 'this variant';
    var body =
      '<label style="display:block;margin-bottom:6px;font-size:0.85rem;color:var(--warm-gray);">Name' +
      '<input id="pv2VarName" type="text" value="' + esc(v.name || '') + '" placeholder="' + esc(comboLabel) + '" style="display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;">' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);">A custom display name for this variant. Leave blank to use the option label (' + esc(comboLabel) + ').</span></label>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveVariantInfo(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelVariantInfo(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Cancel</button>' +
      '</div>';
    return UU.card('Edit info · this variant', body);
  }
  function rerenderVariantInfoPane(pid, vid) {
    var rec = buildVariantRecord(pid + '::' + vid); if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="v-info"]');
    if (pane) pane.innerHTML = variantInfoPane(U, rec.product, rec.variant);
  }
  // Variant Pricing pane: a variant uses the Default's price unless it sets its
  // own (variant.priceCents override). Light inline edit of price override + SKU;
  // clearing the price reverts the variant to "same as Default".
  function variantPricingPane(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    if (V2.editVarPricing === (pid + '::' + vid)) return variantPricingEditForm(UU, p, v);
    var ov = variantOverridden(p, v);
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantPricing(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Edit</button>' : '';
    var priceVal = (N.money(variantPrice(p, v)) || '—') + (ov
      ? ' <span style="color:var(--amber,goldenrod);font-weight:600;">· custom</span>'
      : ' <span class="from">· same as Default</span>');
    var whVal = (typeof v.wholesalePriceCents === 'number' && v.wholesalePriceCents > 0)
      ? N.money(v.wholesalePriceCents / 100)
      : '<span class="from">none</span>';
    var rows = [
      { k: 'Retail price', v: priceVal },
      { k: 'Wholesale price', v: whVal },
      { k: 'SKU', v: v.sku ? esc(v.sku) : '<span class="from">uses the Default</span>' }
    ];
    return UU.card('Pricing · this variant', UU.kv(rows), { headerRight: editBtn });
  }
  function variantPricingEditForm(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    var ov = variantOverridden(p, v);
    var curPrice = ov ? (v.priceCents / 100) : '';
    var defPrice = N.money(price(p)) || '—';
    var priceField = '<label style="display:block;margin-bottom:6px;font-size:0.85rem;color:var(--warm-gray);">Retail price' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;"><span style="font-size:0.9rem;">$</span>' +
      '<input id="pv2VarPrice" type="number" step="0.01" min="0" value="' + esc(curPrice === '' ? '' : String(curPrice)) +
      '" placeholder="' + esc(String(price(p) || '')) + '" style="flex:1;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;"></div>' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);">Leave blank to use the Default (' + esc(defPrice) + ').</span></label>';
    var curWh = (typeof v.wholesalePriceCents === 'number' && v.wholesalePriceCents > 0) ? (v.wholesalePriceCents / 100) : '';
    var defWh = (typeof p.wholesalePriceCents === 'number' && p.wholesalePriceCents > 0) ? (p.wholesalePriceCents / 100) : null;
    var whField = '<label style="display:block;margin:12px 0 6px;font-size:0.85rem;color:var(--warm-gray);">Wholesale price' +
      '<div style="display:flex;align-items:center;gap:6px;margin-top:4px;"><span style="font-size:0.9rem;">$</span>' +
      '<input id="pv2VarWholesale" type="number" step="0.01" min="0" value="' + esc(curWh === '' ? '' : String(curWh)) +
      '" placeholder="' + esc(defWh != null ? String(defWh) : 'none') + '" style="flex:1;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;"></div>' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);">' + (defWh != null ? 'Leave blank to use the Default ($' + defWh + ').' : 'Leave blank if this variant isn’t sold wholesale.') + '</span></label>';
    var skuField = '<label style="display:block;margin:12px 0 12px;font-size:0.85rem;color:var(--warm-gray);">SKU' +
      '<input id="pv2VarSku" type="text" value="' + esc(v.sku || '') + '" placeholder="uses the Default" style="display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;"></label>';
    var body = priceField + whField + skuField +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveVariantPricing(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelVariantPricing(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Cancel</button>' +
      (ov ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.saveVariantPricing(\'' + esc(pid) + '\',\'' + esc(vid) + '\',true)">Use Default price</button>' : '') +
      '</div>';
    return UU.card('Edit pricing · this variant', body);
  }
  function rerenderVariantPricingPane(pid, vid) {
    var rec = buildVariantRecord(pid + '::' + vid); if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="v-pricing"]');
    if (pane) pane.innerHTML = variantPricingPane(U, rec.product, rec.variant) +
      '<div class="pv2-pnote">A variant uses the Default’s values for anything it doesn’t set itself. It has no lifecycle of its own — it follows the product.</div>';
  }
  // Variant Inventory pane: each variant has its OWN stock (admin/inventory keyed
  // by variant id; surfaced via product.stockInfo.variants[id]). Inline on-hand edit.
  function variantStockInfo(p, v) { return (p.stockInfo && p.stockInfo.variants && p.stockInfo.variants[v.id]) || {}; }
  function variantInventoryPane(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    if (V2.editVarInv === (pid + '::' + vid)) return variantInventoryEditForm(UU, p, v);
    var vsi = variantStockInfo(p, v);
    var editBtn = canEditStock() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantInventory(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Set stock</button>' : '';
    return UU.card('Inventory · this variant', UU.kv([
      { k: 'On hand', v: (vsi.onHand != null ? String(vsi.onHand) : '—') },
      { k: 'Available', v: (vsi.available != null ? String(vsi.available) : '—') },
      { k: 'Committed', v: (vsi.committed != null ? String(vsi.committed) : '—') },
      { k: 'Held', v: (vsi.held != null ? String(vsi.held) : '—') },
      { k: 'Damaged', v: (vsi.damaged != null ? String(vsi.damaged) : '—') },
      { k: 'Incoming', v: (vsi.incoming != null ? String(vsi.incoming) : '—') }
    ]), { headerRight: editBtn }) +
      '<div class="pv2-pnote">Each variant tracks its <strong>own</strong> stock — never shared with or inherited from the Default.</div>';
  }
  function variantInventoryEditForm(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    var body = '<div style="display:flex;flex-wrap:wrap;">' + stockCountInputs('pv2VarInv_', variantStockInfo(p, v)) + '</div>' +
      '<div class="pv2-pnote">All stock counts for this variant. <strong>Available</strong> is derived (on hand − committed − held).</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveVariantInventory(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelVariantInventory(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Cancel</button>' +
      '</div>';
    return UU.card('Set variant stock', body);
  }
  function rerenderVariantInventoryPane(pid, vid) {
    var rec = buildVariantRecord(pid + '::' + vid); if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="v-inventory"]');
    if (pane) pane.innerHTML = variantInventoryPane(U, rec.product, rec.variant);
  }
  // ── Variant Fulfillment (per-variant OVERRIDE of the product's fulfillment) ──
  // A variant inherits the product's stock mode / lead time / fulfillment days
  // unless it sets its own. Stored as overrides on the variant stock record
  // (inventoryModeOverride / productionLeadTimeDaysOverride /
  // stockFulfillmentDaysOverride) — the same fields syncStockInfoToPublic already
  // denormalizes and the storefront/order paths honor. Blank = inherit.
  function productFulfillDefaults(p) {
    var si = p.stockInfo || {};
    return {
      mode: si.stockType || 'made-to-order',
      lead: (typeof si.productionLeadTimeDays === 'number' ? si.productionLeadTimeDays : null),
      fulfill: (typeof si.stockFulfillmentDays === 'number' ? si.stockFulfillmentDays : 2)
    };
  }
  function variantFulfillmentPane(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    if (V2.editVarFulfill === (pid + '::' + vid)) return variantFulfillmentEditForm(UU, p, v);
    var def = productFulfillDefaults(p);
    var vsi = variantStockInfo(p, v);
    var modeOv = vsi.inventoryModeOverride || null;
    var leadOv = (vsi.productionLeadTimeDaysOverride != null ? vsi.productionLeadTimeDaysOverride : null);
    var fulfillOv = (vsi.stockFulfillmentDaysOverride != null ? vsi.stockFulfillmentDaysOverride : null);
    var ovBadge = ' ' + UU.badge('override', 'amber');
    var inh = ' <span class="from">· inherits product</span>';
    function eff(ov, base, suffix) {
      var isOv = ov != null;
      var val = isOv ? ov : base;
      return '<span' + (isOv ? ' style="color:var(--amber);font-weight:600;"' : '') + '>' + esc(String(val == null ? '—' : val)) + (suffix || '') + '</span>' + (isOv ? ovBadge : inh);
    }
    var editBtn = canEditProduct() ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.editVariantFulfillment(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Edit</button>' : '';
    return UU.card('Fulfillment · this variant', UU.kv([
      { k: 'Stock mode', v: eff(modeOv ? stockModeLabel(modeOv) : null, stockModeLabel(def.mode)) },
      { k: 'Lead time to build', v: eff(leadOv, def.lead, ' day' + ((leadOv != null ? leadOv : def.lead) === 1 ? '' : 's')) },
      { k: 'Fulfillment time', v: eff(fulfillOv, def.fulfill, ' day' + ((fulfillOv != null ? fulfillOv : def.fulfill) === 1 ? '' : 's')) }
    ]), { headerRight: editBtn }) +
      '<div class="pv2-pnote">A variant inherits the product’s fulfillment unless it overrides it here — e.g. one variant made-to-order with a longer lead while the rest ship from stock. Blank a field to go back to inheriting.</div>';
  }
  function variantFulfillmentEditForm(UU, p, v) {
    var pid = p._key || p.pid, vid = v.id;
    var def = productFulfillDefaults(p);
    var vsi = variantStockInfo(p, v);
    var modeOv = vsi.inventoryModeOverride || '';
    var leadOv = (vsi.productionLeadTimeDaysOverride != null ? vsi.productionLeadTimeDaysOverride : '');
    var fulfillOv = (vsi.stockFulfillmentDaysOverride != null ? vsi.stockFulfillmentDaysOverride : '');
    var fieldStyle = 'display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;';
    var modeOpts = '<option value="">Inherit product (' + esc(stockModeLabel(def.mode)) + ')</option>' +
      STOCK_MODES.map(function (m) { return '<option value="' + esc(m.v) + '"' + (m.v === modeOv ? ' selected' : '') + '>' + esc(m.l) + '</option>'; }).join('');
    var body =
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Stock mode override' +
      '<select id="pv2VarFulMode" style="' + fieldStyle + '">' + modeOpts + '</select>' +
      '<span style="font-size:0.72rem;color:var(--warm-gray);">Leave on “Inherit” to follow the product’s mode.</span></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Lead time to build (days)' +
      '<input id="pv2VarFulLead" type="number" min="0" step="1" value="' + esc(leadOv === '' ? '' : String(leadOv)) + '" placeholder="inherits ' + esc(def.lead == null ? '—' : String(def.lead)) + '" style="' + fieldStyle + 'width:180px;"></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Fulfillment time (days)' +
      '<input id="pv2VarFulFulfill" type="number" min="0" step="1" value="' + esc(fulfillOv === '' ? '' : String(fulfillOv)) + '" placeholder="inherits ' + esc(def.fulfill == null ? '—' : String(def.fulfill)) + '" style="' + fieldStyle + 'width:180px;"></label>' +
      '<div class="pv2-pnote">Blank a field to clear the override and inherit the product default.</div>' +
      '<div style="display:flex;gap:8px;margin-top:8px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.saveVariantFulfillment(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelVariantFulfillment(\'' + esc(pid) + '\',\'' + esc(vid) + '\')">Cancel</button>' +
      '</div>';
    return UU.card('Edit variant fulfillment', body);
  }
  function rerenderVariantFulfillmentPane(pid, vid) {
    var rec = buildVariantRecord(pid + '::' + vid); if (!rec) return;
    var body = document.getElementById('mastSlideOutBody');
    var pane = body && body.querySelector('.mu-pane[data-pane="v-fulfill"]');
    if (pane) pane.innerHTML = variantFulfillmentPane(U, rec.product, rec.variant);
  }
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
    var canEd = canEditProduct();
    // Status line up top makes the current assignment unmistakable.
    var status = own
      ? '<div style="font-size:0.9rem;margin-bottom:10px;">Using <strong>image #' + (curIdx + 1) + '</strong> for this variant.' + (canEd ? ' <button class="btn btn-secondary btn-small" onclick="ProductsV2.setVariantImage(\'' + esc(pid) + '\',\'' + esc(v.id) + '\',-1)">Use product default</button>' : '') + '</div>'
      : '<div style="font-size:0.9rem;margin-bottom:10px;color:var(--warm-gray);">Using the <strong>product’s primary</strong> image.' + (canEd ? ' Tap one below to give this variant its own.' : '') + '</div>';
    var grid = '<div class="pv2-imggrid' + (own ? ' pv2-imggrid-sel' : '') + '">' + imgs.map(function (im, i) {
      var url = resolve(im); if (!url) return '';
      var sel = i === curIdx;
      var badge = sel ? '<span class="pv2-imgbadge">✓ This variant</span>'
        : (i === 0 && !own ? '<span class="pv2-imgbadge pv2-imgbadge-muted">Product default</span>' : '');
      var cap = sel ? '<div style="font-size:0.72rem;color:var(--amber,goldenrod);text-align:center;font-weight:600;">✓ Selected</div>'
        : '<div style="font-size:0.72rem;color:var(--warm-gray);text-align:center;">Image #' + (i + 1) + '</div>';
      var cell = canEd
        ? '<button class="pv2-imgcell pv2-imgpick' + (sel ? ' on' : '') + '" style="background-image:url(' + esc(url) + ');" title="Use image ' + (i + 1) + ' for this variant" onclick="ProductsV2.setVariantImage(\'' + esc(pid) + '\',\'' + esc(v.id) + '\',' + i + ')">' + badge + '</button>'
        : '<div class="pv2-imgcell' + (sel ? ' on' : '') + '" style="background-image:url(' + esc(url) + ');">' + badge + '</div>';
      return '<div class="pv2-imgcellwrap">' + cell + cap + '</div>';
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
        // R2: the BOM is editable here (inline qty/waste + add/remove). Labor/markups
        // still go through the legacy builder (R3 brings them into v2). Cache the open
        // recipe so edit handlers can re-render in place.
        V2._recipeEdit = { recipeId: rc.recipeId || rc._key, rc: rc }; V2._recipeAdding = false;
        V2._recipeEditLabor = false; V2._recipeEditPricing = false;
        // R5: a caller can preselect a variant scope (the variant Recipe tab opens
        // the recipe focused on that variant). Consumed once on open.
        V2._recipeVariantKey = V2._recipeOpenVariant || null; V2._recipeOpenVariant = null;
        return '<div id="pv2RecipeBody">' + recipeEditBody(rc) + '</div>';
      }
    }
  });
  // The editable recipe SO body (R2). Re-rendered in place after each BOM edit.
  // The BOM table for the active slice (root or a variant slot). Editable inputs
  // dispatch to root vs variant bridge methods via the active V2._recipeVariantKey.
  function recipeBomTableHtml(li, canEd) {
    var keys = Object.keys(li || {});
    var rows;
    if (canEd) {
      var inp = 'width:62px;padding:4px 6px;border:1px solid var(--cream-dark);border-radius:5px;font-size:0.85rem;background:var(--cream);color:inherit;box-sizing:border-box;text-align:right;';
      rows = keys.map(function (k) {
        var m = li[k] || {}; var isRec = m.kind === 'recipe';
        return '<tr><td>' + esc(m.materialName || '—') + (isRec ? ' <span class="pv2-ov">sub</span>' : '') + '</td>' +
          '<td class="r"><input type="number" min="0" step="0.01" value="' + esc(m.quantity != null ? String(m.quantity) : '') + '" onchange="ProductsV2.recipeSetLineQty(\'' + esc(k) + '\',this.value)" style="' + inp + '"> <span style="color:var(--warm-gray);font-size:0.78rem;">' + esc(m.unitOfMeasure || '') + '</span></td>' +
          '<td class="r">' + (isRec ? '—' : '<input type="number" min="0" step="1" value="' + esc(m.scrapPercent != null ? String(m.scrapPercent) : '0') + '" onchange="ProductsV2.recipeSetLineWaste(\'' + esc(k) + '\',this.value)" style="' + inp + '">%') + '</td>' +
          '<td class="r">' + (N.money(m.unitCost) || '—') + '</td><td class="r">' + (N.money(m.extendedCost) || '—') + '</td>' +
          '<td class="r"><button class="btn btn-secondary btn-small" title="Remove" onclick="ProductsV2.recipeRemoveLine(\'' + esc(k) + '\')" style="padding:2px 9px;">✕</button></td></tr>';
      }).join('');
      if (!keys.length) rows = '<tr><td colspan="6" style="color:var(--warm-gray);padding:12px 0;font-size:0.85rem;">No materials yet — add the first part.</td></tr>';
    } else {
      rows = keys.map(function (k) {
        var m = li[k] || {};
        var qty = (m.quantity != null ? m.quantity : '') + (m.unitOfMeasure ? (' ' + m.unitOfMeasure) : '');
        return '<tr><td>' + esc(m.materialName || '—') + '</td><td class="r">' + esc(qty) + '</td><td class="r">' + (N.money(m.unitCost) || '—') + '</td><td class="r">' + (N.money(m.extendedCost) || '—') + '</td></tr>';
      }).join('');
      if (!keys.length) rows = '<tr><td colspan="4" style="color:var(--warm-gray);padding:12px 0;font-size:0.85rem;">No materials.</td></tr>';
    }
    var head = canEd
      ? '<tr><th>Material</th><th class="r">Qty</th><th class="r">Waste</th><th class="r">Unit</th><th class="r">Ext</th><th></th></tr>'
      : '<tr><th>Material</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Ext</th></tr>';
    return '<table class="pv2-bom"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
  }
  function recipeVariantLabelFor(vars, vkey) {
    for (var i = 0; i < vars.length; i++) if (vars[i].id === vkey) return variantLabel(vars[i]) || 'Variant';
    return 'Variant';
  }
  function recipeEditBody(rc) {
    // R4: the recipe SO can be scoped to the product default (root) or a single
    // product variant. A variant either OVERRIDES the recipe (its own slot) or
    // INHERITS it (no slot). The selector pills below switch the scope.
    var prod = rc.productId ? V2.byId[rc.productId] : null;
    var vars = prod ? realVariants(prod) : [];
    var hasVars = vars.length > 0;
    var vkey = V2._recipeVariantKey || null;
    if (vkey && !vars.some(function (v) { return v.id === vkey; })) { vkey = null; V2._recipeVariantKey = null; }
    var canEdAll = recipeCanEdit(rc);
    var onVariant = !!vkey;
    var slot = (onVariant && rc.variants) ? rc.variants[vkey] : null;
    var overridden = !!(slot && slot.lineItems);
    var sliceLi = overridden ? slot.lineItems : (rc.lineItems || {});
    var sliceTotalCost = overridden ? slot.totalCost : rc.totalCost;
    var bomEditable = canEdAll && (!onVariant || overridden);
    var keys = Object.keys(sliceLi);
    var addBtn = (bomEditable && !V2._recipeAdding) ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeAddPart()">+ Add part</button>' : '';
    var addForm = (bomEditable && V2._recipeAdding) ? recipeAddPartFormHtml() : '';
    var bom = recipeBomTableHtml(sliceLi, bomEditable);
    var tiles = U.tiles([
      { k: (onVariant ? 'Variant cost' : 'Unit cost'), v: N.money(sliceTotalCost) || '—', hero: true },
      { k: 'Status', v: rc.status || '—' },
      { k: 'Materials', v: keys.length },
      { k: 'Active tier', v: rc.activePriceTier || '—' }
    ]);
    var selector = hasVars ? recipeVariantSelector(rc, vars, vkey) : '';
    var cards;
    if (!onVariant) {
      cards = U.card('Bill of materials', addForm + bom, { headerRight: addBtn }) +
        recipeLaborCard(rc) + recipeCostCard(rc) + recipePricingCard(rc) +
        '<div class="pv2-pnote">Edit the bill of materials, labor &amp; overhead, and pricing tiers right here. Saving recalculates the recipe and updates the linked product’s cost.' +
        (hasVars ? ' Pick a variant above to give it its own cost.' : '') + '</div>';
    } else if (!overridden) {
      var label = recipeVariantLabelFor(vars, vkey);
      var cta = canEdAll ? '<button class="btn btn-primary btn-small" onclick="ProductsV2.recipeVariantOverride()">Override for this variant</button>' : '';
      cards = '<div class="pv2-pnote" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><span>' + esc(label) + ' <strong>inherits the product recipe</strong>. Override it to give this variant its own materials, labor time, or other cost.</span>' + cta + '</div>' +
        U.card('Bill of materials · inherited', bom) +
        recipeInheritedLaborCard(rc) + recipeCostCard(rc) +
        '<div class="pv2-pnote">Pricing tiers are set on the product recipe — pick “Product default” to edit them.</div>';
    } else {
      var label2 = recipeVariantLabelFor(vars, vkey);
      var resetBtn = canEdAll ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeVariantInherit()">Reset to inherit</button>' : '';
      cards = '<div class="pv2-pnote" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;"><span><strong>' + esc(label2) + '</strong> overrides the product recipe.</span>' + resetBtn + '</div>' +
        U.card('Bill of materials · ' + label2, addForm + bom, { headerRight: addBtn }) +
        recipeVariantLaborCard(rc, slot) + recipeVariantCostCard(slot, rc) +
        '<div class="pv2-pnote">This variant has its own materials, labor time &amp; other cost. Labor rate, setup, batch &amp; pricing tiers come from the product recipe.</div>';
    }
    return U.stickyHead(tiles, '') + '<div>' + selector + cards + '</div>';
  }
  // ── R4: variant selector pills + per-variant cards ────────────────────
  function recipeVariantSelector(rc, vars, vkey) {
    function pill(active, label, vid, isOverride) {
      return '<button type="button" onclick="ProductsV2.recipeSelectVariant(\'' + esc(vid) + '\')" style="padding:5px 12px;border:1px solid ' + (active ? 'var(--amber)' : 'var(--cream-dark)') + ';border-radius:999px;font-size:0.85rem;cursor:pointer;background:' + (active ? 'color-mix(in srgb,var(--amber) 16%,transparent)' : 'transparent') + ';color:' + (active ? 'var(--text-primary)' : 'var(--warm-gray)') + ';font-weight:' + (active ? '600' : '400') + ';white-space:nowrap;">' + esc(label) + (isOverride ? ' <span class="pv2-ov">override</span>' : '') + '</button>';
    }
    var pills = [pill(!vkey, 'Product default', '', false)];
    vars.forEach(function (v) {
      var ov = !!(rc.variants && rc.variants[v.id] && rc.variants[v.id].lineItems);
      pills.push(pill(vkey === v.id, variantLabel(v) || 'Variant', v.id, ov));
    });
    return '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center;">' + pills.join('') + '</div>';
  }
  // Read-only labor/overhead for an INHERITED variant (shows the product recipe).
  function recipeInheritedLaborCard(rc) {
    var rate = Number(rc.laborRatePerHour) || 0, min = Number(rc.laborMinutes) || 0;
    var setup = Number(rc.setupCost) || 0, batch = Math.max(1, Number(rc.batchSize) || 1);
    var laborCost = (rc.laborCost != null) ? Number(rc.laborCost) : (min / 60) * rate;
    var other = Number(rc.otherCost) || 0;
    return U.card('Labor & overhead · inherited', U.kv([
      { k: 'Labor rate', v: rate ? (N.money(rate) + ' / hr') : '—' },
      { k: 'Labor time', v: min ? (min + ' min <span class="from">· ' + (N.money(laborCost) || '$0.00') + '</span>') : '—' },
      { k: 'Other cost', v: other ? N.money(other) : '—' },
      { k: 'Setup cost', v: setup ? (N.money(setup) + ' <span class="from">· over ' + batch + ' / batch</span>') : '—' },
      { k: 'Batch size', v: batch + ' / build' }
    ]));
  }
  // Per-variant labor/overhead (laborMinutes + otherCost editable; rate/setup/batch
  // from the product recipe). Reuses V2._recipeEditLabor; the save dispatches to
  // recipeVariantSetFields when a variant is active.
  function recipeVariantLaborCard(rc, slot) {
    if (V2._recipeEditLabor) return recipeVariantLaborForm(rc, slot);
    var editBtn = recipeCanEdit(rc) ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeEditLabor()">Edit</button>' : '';
    var rate = Number(rc.laborRatePerHour) || 0, min = Number(slot.laborMinutes) || 0;
    var setup = Number(rc.setupCost) || 0, batch = Math.max(1, Number(rc.batchSize) || 1);
    var laborCost = (min / 60) * rate, other = Number(slot.otherCost) || 0;
    return U.card('Labor & overhead · this variant', U.kv([
      { k: 'Labor rate', v: (rate ? N.money(rate) + ' / hr' : '—') + ' <span class="from">· from product</span>' },
      { k: 'Labor time', v: '<span style="color:var(--amber);font-weight:600;">' + min + ' min</span> <span class="from">· ' + (N.money(laborCost) || '$0.00') + '</span>' },
      { k: 'Other cost', v: '<span style="color:var(--amber);font-weight:600;">' + (N.money(other) || '$0.00') + '</span>' },
      { k: 'Setup cost', v: (setup ? N.money(setup) : '—') + ' <span class="from">· from product</span>' },
      { k: 'Batch size', v: batch + ' / build <span class="from">· from product</span>' }
    ]), { headerRight: editBtn });
  }
  function recipeVariantLaborForm(rc, slot) {
    var fs = recipeFieldStyle();
    var body =
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Labor time (min) · this variant' +
      '<input id="rcLaborMin" type="number" min="0" step="1" value="' + esc(String(Number(slot.laborMinutes) || 0)) + '" style="' + fs + 'width:180px;"></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Other cost ($) · this variant' +
      '<input id="rcOther" type="number" min="0" step="0.01" value="' + esc(String(Number(slot.otherCost) || 0)) + '" style="' + fs + 'width:180px;"></label>' +
      '<div class="pv2-pnote">Labor rate, setup &amp; batch come from the product recipe.</div>' +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.recipeSaveLabor()">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeCancelLabor()">Cancel</button>' +
      '</div>';
    return U.card('Edit variant labor & overhead', body);
  }
  function recipeVariantCostCard(slot, rc) {
    var rate = Number(rc.laborRatePerHour) || 0, min = Number(slot.laborMinutes) || 0;
    var laborCost = (min / 60) * rate;
    var setup = Number(rc.setupCost) || 0, batch = Math.max(1, Number(rc.batchSize) || 1);
    var overhead = (Number(slot.otherCost) || 0) + (setup / batch);
    return U.card('Cost breakdown · this variant', U.kv([
      { k: 'Materials', v: N.money(slot.totalMaterialCost) || '$0.00' },
      { k: 'Labor', v: N.money(laborCost) || '$0.00' },
      { k: 'Overhead', v: N.money(overhead) || '$0.00' },
      { k: 'Variant cost', v: '<strong>' + (N.money(slot.totalCost) || '$0.00') + '</strong>' }
    ]));
  }
  // ── R3: Labor & overhead (read-first + inline edit) ───────────────────
  // laborRatePerHour / laborMinutes / otherCost(+note) / setupCost / batchSize
  // → MakerProductBridge.recipeSetFields. Save runs one full recalc so
  // marginHistory + product cost propagation happen once (not per keystroke).
  function recipeFieldStyle() { return 'display:block;width:100%;margin-top:4px;padding:7px 9px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;'; }
  function recipeCanEdit(rc) { return canEditProduct() && !!rc.productId; }
  function recipeLaborCard(rc) {
    if (V2._recipeEditLabor) return recipeLaborForm(rc);
    var editBtn = recipeCanEdit(rc) ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeEditLabor()">Edit</button>' : '';
    var rate = Number(rc.laborRatePerHour) || 0, min = Number(rc.laborMinutes) || 0;
    var setup = Number(rc.setupCost) || 0, batch = Math.max(1, Number(rc.batchSize) || 1);
    var laborCost = (rc.laborCost != null) ? Number(rc.laborCost) : (min / 60) * rate;
    var perUnitSetup = setup / batch;
    var other = Number(rc.otherCost) || 0;
    return U.card('Labor & overhead', U.kv([
      { k: 'Labor rate', v: rate ? (N.money(rate) + ' / hr') : '—' },
      { k: 'Labor time', v: min ? (min + ' min <span class="from">· ' + (N.money(laborCost) || '$0.00') + '</span>') : '—' },
      { k: 'Other cost', v: other ? (N.money(other) + (rc.otherCostNote ? ' <span class="from">· ' + esc(rc.otherCostNote) + '</span>' : '')) : '—' },
      { k: 'Setup cost', v: setup ? (N.money(setup) + ' <span class="from">· over ' + batch + ' / batch → ' + (N.money(perUnitSetup) || '$0.00') + ' per unit</span>') : '—' },
      { k: 'Batch size', v: batch + ' / build' }
    ]), { headerRight: editBtn });
  }
  function recipeLaborForm(rc) {
    var fs = recipeFieldStyle();
    function fld(label, id, val, step, extra) {
      return '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">' + label +
        '<input id="' + id + '" type="number" min="0" step="' + step + '" value="' + esc(val === '' || val == null ? '' : String(val)) + '" style="' + fs + (extra || '') + '"></label>';
    }
    var body =
      '<div style="display:flex;gap:10px;">' +
      '<div style="flex:1;">' + fld('Labor rate ($/hr)', 'rcLaborRate', Number(rc.laborRatePerHour) || 0, '0.01') + '</div>' +
      '<div style="flex:1;">' + fld('Labor time (min)', 'rcLaborMin', Number(rc.laborMinutes) || 0, '1') + '</div>' +
      '</div>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Other cost ($)' +
      '<input id="rcOther" type="number" min="0" step="0.01" value="' + esc(String(Number(rc.otherCost) || 0)) + '" style="' + fs + 'width:180px;"></label>' +
      '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Other cost note' +
      '<input id="rcOtherNote" type="text" value="' + esc(rc.otherCostNote || '') + '" placeholder="e.g. packaging, plating" style="' + fs + '"></label>' +
      '<div style="display:flex;gap:10px;">' +
      '<div style="flex:1;">' + fld('Setup cost ($) · amortized', 'rcSetup', Number(rc.setupCost) || 0, '0.01') + '</div>' +
      '<div style="flex:1;">' + fld('Batch size · units per setup', 'rcBatch', Math.max(1, Number(rc.batchSize) || 1), '1') + '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.recipeSaveLabor()">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeCancelLabor()">Cancel</button>' +
      '</div>';
    return U.card('Edit labor & overhead', body);
  }
  // ── Cost breakdown (read-only — derived from the engine recompute) ────
  function recipeCostCard(rc) {
    var setup = Number(rc.setupCost) || 0, batch = Math.max(1, Number(rc.batchSize) || 1);
    var overhead = (Number(rc.otherCost) || 0) + (setup / batch);
    return U.card('Cost breakdown', U.kv([
      { k: 'Materials', v: N.money(rc.totalMaterialCost) || '$0.00' },
      { k: 'Labor', v: N.money(rc.laborCost) || '$0.00' },
      { k: 'Overhead', v: N.money(overhead) || '$0.00' },
      { k: 'Unit cost', v: '<strong>' + (N.money(rc.totalCost) || '$0.00') + '</strong>' }
    ]));
  }
  // ── R3: Pricing & tiers (read-first + inline edit) ────────────────────
  // markups → prices + margins; active-tier selector (live, recipeSetActiveTier);
  // min-margin floor. Markups + floor → recipeSetFields (recalc on save).
  var RECIPE_TIERS = [{ k: 'wholesale', l: 'Wholesale' }, { k: 'direct', l: 'Direct' }, { k: 'retail', l: 'Retail' }];
  function recipeTierMargin(price, total) { return (price > 0) ? Math.round(((price - total) / price) * 1000) / 10 : null; }
  function recipeActiveTierSelect(rc) {
    var cur = rc.activePriceTier || '';
    var opts = RECIPE_TIERS.map(function (t) { return '<option value="' + t.k + '"' + (t.k === cur ? ' selected' : '') + '>' + t.l + '</option>'; }).join('');
    if (!cur || ['wholesale', 'direct', 'retail'].indexOf(cur) < 0) opts = '<option value="" selected>—</option>' + opts;
    return '<select onchange="ProductsV2.recipeSetTier(this.value)" style="padding:3px 8px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.85rem;background:var(--cream);color:inherit;">' + opts + '</select>';
  }
  // Read-only tier rows (markup× price · margin) — the single source for both
  // the recipe "Pricing & tiers" card and the product Pricing tab's recipe
  // summary, so both render the identical format. markActiveTier (a tier key)
  // appends a "· active" marker; omit it where an active-tier selector already
  // shows which tier is live.
  function recipeTierPriceRows(rc, markActiveTier) {
    var total = Number(rc.totalCost) || 0;
    return RECIPE_TIERS.map(function (t) {
      var markup = Number(rc[t.k + 'Markup']) || 0;
      var price = Number(rc[t.k + 'Price']) || 0;
      var margin = recipeTierMargin(price, total);
      var v = (markup ? markup.toFixed(2) + '× ' : '') + (N.money(price) || '—') +
        (margin != null ? ' <span class="from">· ' + margin + '% margin</span>' : '') +
        (markActiveTier && t.k === markActiveTier ? ' <span class="from">· active</span>' : '');
      return { k: t.l, v: v };
    });
  }
  function recipePricingCard(rc) {
    if (V2._recipeEditPricing) return recipePricingForm(rc);
    var canEd = recipeCanEdit(rc);
    var editBtn = canEd ? '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeEditPricing()">Edit</button>' : '';
    var rows = [{ k: 'Active tier', v: canEd ? recipeActiveTierSelect(rc) : '<span class="from">' + esc(rc.activePriceTier || '—') + '</span>' }];
    recipeTierPriceRows(rc).forEach(function (r) { rows.push(r); });
    rows.push({ k: 'Min margin floor', v: (rc.minMarginPercent != null && rc.minMarginPercent !== '') ? (rc.minMarginPercent + '%') : '—' });
    return U.card('Pricing & tiers', U.kv(rows), { headerRight: editBtn });
  }
  function recipePricingForm(rc) {
    var fs = recipeFieldStyle();
    var rowsHtml = RECIPE_TIERS.map(function (t) {
      return '<div style="flex:1;"><label style="display:block;font-size:0.85rem;color:var(--warm-gray);">' + t.l + ' markup ×' +
        '<input id="rc' + t.k + 'Mk" type="number" min="0" step="0.01" value="' + esc(String(Number(rc[t.k + 'Markup']) || 0)) + '" style="' + fs + '"></label></div>';
    }).join('');
    var body =
      '<div style="display:flex;gap:10px;">' + rowsHtml + '</div>' +
      '<label style="display:block;margin:4px 0 12px;font-size:0.85rem;color:var(--warm-gray);">Min margin floor (%)' +
      '<input id="rcMinMargin" type="number" min="0" step="1" value="' + esc(rc.minMarginPercent != null && rc.minMarginPercent !== '' ? String(rc.minMarginPercent) : '') + '" placeholder="none" style="' + fs + 'width:180px;"></label>' +
      '<div class="pv2-pnote">Markups multiply the unit cost to set each tier’s price. Pick the active tier above the form.</div>' +
      '<div style="display:flex;gap:8px;margin-top:4px;">' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.recipeSavePricing()">Save</button>' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.recipeCancelPricing()">Cancel</button>' +
      '</div>';
    return U.card('Edit pricing & tiers', body);
  }
  function rerenderRecipeBody() {
    var el = document.getElementById('pv2RecipeBody');
    if (el && V2._recipeEdit && V2._recipeEdit.rc) el.innerHTML = recipeEditBody(V2._recipeEdit.rc);
  }
  // Apply a single line-item edit (qty / waste%) via the R1 bridge, then re-render.
  function _applyRecipeLine(liId, patch) {
    if (!canEditProduct()) return;
    var rid = V2._recipeEdit && V2._recipeEdit.recipeId; if (!rid) return;
    var vkey = V2._recipeVariantKey;
    ensureMaker(function () {
      var B = window.MakerProductBridge;
      var p = vkey ? B.recipeVariantSetLineItem(rid, vkey, liId, patch) : B.recipeSetLineItem(rid, liId, patch);
      Promise.resolve(p).then(function (res) {
        if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
        V2._recipeEdit.rc = res.recipe; rerenderRecipeBody();
      }, function (e) { console.error('[products-v2] recipeSetLine', e); MastAdmin.showToast('Failed', true); });
    });
  }
  // R4: commit per-variant overhead overrides (laborMinutes / otherCost). Variant
  // cost doesn't propagate to the product, so no full recalc — the bridge's light
  // variant recompute is enough.
  function _recipeCommitVariantFields(vid, patch, after) {
    if (!canEditProduct()) return;
    var rid = V2._recipeEdit && V2._recipeEdit.recipeId; if (!rid) return;
    ensureMaker(function () {
      Promise.resolve(window.MakerProductBridge.recipeVariantSetFields(rid, vid, patch)).then(function (res) {
        if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
        V2._recipeEdit.rc = res.recipe; if (after) after(); rerenderRecipeBody(); MastAdmin.showToast('Saved');
      }, function (e) { console.error('[products-v2] recipeVariantFields', e); MastAdmin.showToast('Failed', true); });
    });
  }
  // R3: commit labor/pricing field edits via recipeSetFields (light recompute),
  // then ONE full recipeRecalc so marginHistory + product cost propagation run
  // exactly once per Save (not per keystroke). `after` clears the edit flag.
  function _recipeCommitFields(patch, after) {
    if (!canEditProduct()) return;
    var rid = V2._recipeEdit && V2._recipeEdit.recipeId; if (!rid) return;
    ensureMaker(function () {
      Promise.resolve(window.MakerProductBridge.recipeSetFields(rid, patch)).then(function (res) {
        if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
        return Promise.resolve(window.MakerProductBridge.recipeRecalc(rid)).then(function (rr) {
          var rc = (rr && rr.ok && rr.recipe) || res.recipe;
          V2._recipeEdit.rc = rc; if (after) after(); rerenderRecipeBody(); MastAdmin.showToast('Saved');
        });
      }, function (e) { console.error('[products-v2] recipeCommitFields', e); MastAdmin.showToast('Failed', true); });
    });
  }
  // "+ Add part" picker (material or sub-assembly), via the shared openModal.
  // Inline "+ Add part" form, rendered INSIDE the recipe SO body (not a modal —
  // openModal layers below the drilled slide-out). Reads V2._recipeAddData.
  function recipeAddPartFormHtml() {
    var d = V2._recipeAddData || { materials: [], recipes: [] };
    var kind = V2._rpKind || 'material';
    var fieldStyle = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;';
    var matOpts = (d.materials || []).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + ' (' + esc(m.unitOfMeasure || '') + ' · ' + (N.money(m.unitCost) || '$0') + ')</option>'; }).join('');
    var recOpts = (d.recipes || []).map(function (r) { return '<option value="' + esc(r.id) + '">' + esc(r.name || '(recipe)') + ' (' + (N.money(r.totalCost) || '$0') + ')</option>'; }).join('');
    function tab(k, label) { var on = (kind === k); return '<button type="button" onclick="ProductsV2.recipeAddPartKind(\'' + k + '\')" style="flex:1;padding:8px;border:0;cursor:pointer;font-size:0.85rem;' + (k === 'recipe' ? 'border-left:1px solid var(--border);' : '') + 'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';font-weight:' + (on ? '600' : '400') + ';">' + label + '</button>'; }
    return '<div style="border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:14px;background:color-mix(in srgb,var(--amber) 6%,transparent);">' +
      '<div style="display:flex;border:1px solid var(--border);border-radius:7px;overflow:hidden;margin-bottom:12px;">' + tab('material', 'Material') + tab('recipe', 'Sub-assembly') + '</div>' +
      (kind === 'material'
        ? '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Material<select id="pv2RpMatSel" style="' + fieldStyle + '">' + (matOpts || '<option value="">No materials</option>') + '</select></label>'
        : '<label style="display:block;margin-bottom:12px;font-size:0.85rem;color:var(--warm-gray);">Sub-assembly recipe<select id="pv2RpRecSel" style="' + fieldStyle + '">' + (recOpts || '<option value="">No recipes</option>') + '</select></label>') +
      '<div style="display:flex;gap:10px;">' +
      '<label style="flex:1;font-size:0.85rem;color:var(--warm-gray);">Quantity<input id="pv2RpQty" type="number" min="0" step="0.01" value="1" style="' + fieldStyle + '"></label>' +
      (kind === 'material' ? '<label style="flex:1;font-size:0.85rem;color:var(--warm-gray);">Waste %<input id="pv2RpScrap" type="number" min="0" step="1" value="0" style="' + fieldStyle + '"></label>' : '') +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
      '<button class="btn btn-secondary btn-small" onclick="ProductsV2.cancelRecipeAddPart()">Cancel</button>' +
      '<button class="btn btn-primary btn-small" onclick="ProductsV2.recipeAddPartConfirm()">Add part</button>' +
      '</div></div>';
  }

  // ════════════════ Entity: variants & options editor (drilled) ════════════════
  // The standard heavy-edit surface for defining options + adding variants —
  // a stacked slide-out (Back returns to the product, whose tree re-renders).
  MastEntity.define('product-variants-v2', {
    label: 'Variants & options', labelPlural: 'Variants', size: 'lg', route: null,
    recordId: function (r) { return r._key || r.pid; },
    fields: [{ name: '_title', label: 'Product', type: 'text', list: true, group: 'Product', readOnly: true }],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return Promise.resolve(MastDB.products.get(id)).then(function (p) { if (!p) return null; var rec = stamp(Object.assign({}, p), id); V2.byId[id] = rec; return rec; });
    },
    detail: { render: function (UU, p) { return variantsEditorBody(p); } }
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
        var canEd = canEditProduct();
        var uploadBtn = canEd ? '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin:0;"><input type="file" accept="image/*" style="display:none;" onchange="ProductsV2.imgUpload(\'' + esc(key) + '\',this)">Upload image</label>' : '';
        if (!imgs.length) return UU.card('Images', '<div style="text-align:center;padding:22px 16px;color:var(--warm-gray);font-size:0.9rem;">No images yet.' + (canEd ? ' Upload one — the first becomes the primary.' : '') + '</div>', { headerRight: uploadBtn });
        var focusSrc = imgs[r.focus] || imgs[0];
        var isPrimary = focusSrc === imgs[0];
        var large = '<div class="pv2-imgfocus"><img id="pv2ImgLarge" src="' + esc(focusSrc) + '" alt=""></div>';
        var heroActions = !canEd ? '' : '<div style="display:flex;gap:8px;justify-content:center;align-items:center;margin-top:12px;flex-wrap:wrap;">' +
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
    markListDirty();
  }
  // List "dirty" refresh: an SO write already updated the shared V2.byId record,
  // so re-render the (hidden, behind the SO) list body FROM MEMORY — no DB re-read.
  // Called only after a write, so the list refreshes exactly when new data is ready
  // and is current the moment the SO closes. (e.g. a new/primary image thumbnail.)
  function markListDirty() {
    var lb = document.getElementById('pv2ListBody');
    if (lb) lb.innerHTML = renderListBody();
  }

  function buildVariantRecord(id) {
    var parts = String(id || '').split('::'); var pid = parts[0], vid = parts[1];
    var p = V2.byId[pid]; if (!p) return null;
    var v = realVariants(p).filter(function (x) { return x.id === vid; })[0] || { id: vid, combo: {} };
    return { _key: id, _title: (p.name || 'Product') + ' — ' + variantLabel(v), product: p, variant: v };
  }

  // ── State + data ────────────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, sortKey: '_title', sortDir: 'asc', filter: 'all', lens: 'general', expanded: {}, editInfo: null, editFulfill: null, editPricing: null, editVarPricing: null, editInv: null, editVarInv: null, editVarInfo: null, editVarFulfill: null, editAttrs: null, editVarAttrs: null, q: '', tagFacets: [], _npMode: 'scratch', _recipeEdit: null, _rpKind: 'material', _recipeAdding: false, _recipeAddData: null, _recipeEditLabor: false, _recipeEditPricing: false, _recipeVariantKey: null, _recipeOpenVariant: null };

  function toRows(map) {
    var out = []; map = map || {};
    Object.keys(map).forEach(function (k) { var p = map[k]; if (!p || typeof p !== 'object') return; out.push(stamp(Object.assign({}, p), p.pid || k)); });
    return out;
  }
  function load() {
    if (!window.MastDB || !MastDB.products || typeof MastDB.products.list !== 'function') return;
    // Use list() (the canonical get-all), NOT get() with no arg — get() reads a
    // cache that's empty on a cold first load (the list showed 0 rows until a
    // manual refresh warmed it). list() queries reliably, like every other v2 list.
    Promise.resolve(MastDB.products.list()).then(function (res) {
      var arr = Array.isArray(res) ? res : Object.values(res || {});
      V2.rows = arr.map(function (p) { return stamp(Object.assign({}, p), p.pid || p._key || p.id); });
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    }).catch(function (e) { console.error('[products-v2] load', e); render(); });
  }
  function statusCounts() {
    var c = { all: V2.rows.length };
    V2.rows.forEach(function (r) { var s = String(r.status || 'draft').toLowerCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }
  // Status + search filter only (pre-tag-facet). Facet counts are computed off this
  // set so they reflect the current status/search context.
  function statusSearchRows() {
    var rows = V2.rows;
    if (V2.filter && V2.filter !== 'all') rows = rows.filter(function (r) { return String(r.status || 'draft').toLowerCase() === V2.filter; });
    var q = (V2.q || '').trim().toLowerCase();
    if (q) rows = rows.filter(function (r) {
      return String(r.name || '').toLowerCase().indexOf(q) >= 0
        || String(categoryLabel(r) || '').toLowerCase().indexOf(q) >= 0
        || String(r.sku || '').toLowerCase().indexOf(q) >= 0;
    });
    return rows;
  }
  // A product's filterable facet tags = authored tags + derived badge labels
  // (both lowercased for matching). The tag-facet bar filters on these.
  function productFacetTags(p) {
    var out = productAttributes(p).tags.map(function (t) { return String(t).toLowerCase(); });
    derivedBadges(p).forEach(function (b) { out.push(String(b.label).toLowerCase()); });
    return out;
  }
  // Distinct facet tags across the status/search set → [{key, label, count}],
  // sorted by count desc then alpha. Active facets are always included (count 0 if
  // they no longer match) so a selected chip never vanishes mid-filter.
  function facetTagEntries() {
    var rows = statusSearchRows();
    var counts = {}, label = {};
    rows.forEach(function (p) {
      var seen = {};
      productAttributes(p).tags.forEach(function (t) { var k = String(t).toLowerCase(); if (!seen[k]) { seen[k] = 1; counts[k] = (counts[k] || 0) + 1; if (!label[k]) label[k] = String(t); } });
      derivedBadges(p).forEach(function (b) { var k = String(b.label).toLowerCase(); if (!seen[k]) { seen[k] = 1; counts[k] = (counts[k] || 0) + 1; label[k] = b.label; } });
    });
    (V2.tagFacets || []).forEach(function (k) { if (counts[k] == null) { counts[k] = 0; if (!label[k]) label[k] = k; } });
    return Object.keys(counts).map(function (k) { return { key: k, label: label[k] || k, count: counts[k] }; })
      .sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
  }
  function visibleRows() {
    var rows = statusSearchRows();
    var facets = V2.tagFacets || [];
    if (facets.length) rows = rows.filter(function (p) {
      var have = productFacetTags(p);
      return facets.every(function (f) { return have.indexOf(f) >= 0; });
    });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, listSortValue);
  }
  // Sorting is PRODUCT-LEVEL (the top row), not the expanded variant rows. Range
  // and count columns sort by a sensible scalar: Price → lowest price, Variants →
  // count. Ascending shows lowest-priced / fewest-variant products first.
  var _STATUS_RANK = { draft: 0, review: 1, ready: 2, active: 3, archived: 4 };
  function priceMin(p) {
    var ps = [price(p)]; realVariants(p).forEach(function (v) { ps.push(variantPrice(p, v)); });
    ps = ps.filter(function (x) { return typeof x === 'number' && !isNaN(x); });
    return ps.length ? Math.min.apply(null, ps) : 0;
  }
  function listSortValue(r, k) {
    var si = r.stockInfo || {};
    switch (k) {
      case 'name': case '_title': return String(r.name || '').toLowerCase();
      case 'category': return String(categoryLabel(r) || '').toLowerCase();
      case 'status': return _STATUS_RANK[String(r.status || 'draft').toLowerCase()] != null ? _STATUS_RANK[String(r.status || 'draft').toLowerCase()] : 9;
      case 'price': return priceMin(r);
      case 'variants': return variantCount(r);
      case 'onhand': return si.totalOnHand || 0;
      case 'avail': return si.totalAvailable || 0;
      case 'committed': return si.totalCommitted || 0;
      case 'mode': return String(si.stockType || '');
      case 'u30': return (_salesEntry(r._key || r.pid) || {}).last30 || 0;
      case 'r30': return (_salesEntry(r._key || r.pid) || {}).revenue30 || 0;
      case 'rall': return (_salesEntry(r._key || r.pid) || {}).revenueAll || 0;
      case 'last': return (_salesEntry(r._key || r.pid) || {}).lastOrdered || '';
      case 'rate': return (_forecastEntry(r._key || r.pid) || {}).monthlyRate || 0;
      case 'cov': { var f = _forecastEntry(r._key || r.pid) || {}; return isFinite(f.weeksCoverage) ? f.weeksCoverage : 1e9; }
      default: var fld = MastEntity.get('products-v2').fields.filter(function (x) { return x.name === k; })[0]; return (fld && fld.get) ? fld.get(r) : r[k];
    }
  }
  // The list body only (rows or empty-state) — re-rendered on its own during
  // search so the search input keeps focus while you type.
  // Product list columns — rendered through the shared engine list (MastUI.list)
  // so it has the same look-and-feel as every other v2 list. The thumbnail is just
  // a column whose render() returns raw HTML; the variant tree rides the engine's
  // opt-in expandable-rows (childRowsHtml below).
  // Thumbnail + name live in ONE cell (the Product column) so the gap between the
  // image and the name is constant regardless of expand state — a separate thumb
  // column reflows under table-auto-layout when child rows are added.
  function _thumbHtml(p) {
    var img = firstImage(p);
    return img
      ? '<img src="' + esc(img) + '" alt="" style="width:40px;height:40px;border-radius:7px;object-fit:cover;border:1px solid var(--border);flex:0 0 40px;">'
      : '<div style="width:40px;height:40px;border-radius:7px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;color:var(--warm-gray);font-size:0.85rem;flex:0 0 40px;">' + esc((p.name || 'P').slice(0, 1)) + '</div>';
  }
  function _prodCol() {
    return { key: 'name', label: 'Product', sortable: true, render: function (p) {
      return '<div style="display:flex;align-items:center;gap:11px;">' + _thumbHtml(p) +
        '<span>' + esc(p.name || '(unnamed)') + ' <span style="color:var(--warm-gray);">· ' + esc(categoryLabel(p) || '—') + '</span></span></div>';
    } };
  }
  function pv2ListColumns() {
    return [_prodCol(),
      { key: 'status', label: 'Status', sortable: true, render: function (p) { return U.badge(statusLabel(p.status), statusTone(p.status)); } },
      { key: 'price', label: 'Price', align: 'right', sortable: true, render: function (p) { return esc(priceRange(p) || '—'); } },
      { key: 'variants', label: 'Variants', align: 'right', sortable: true, render: function (p) { return esc(variantsLabel(p)); } }
    ];
  }
  function lensColumns(lens) {
    if (lens === 'inventory') {
      return [_prodCol(),
        { key: 'onhand', label: 'On hand', align: 'right', sortable: true, render: function (p) { var si = p.stockInfo || {}; return si.totalOnHand != null ? String(si.totalOnHand) : '—'; } },
        { key: 'avail', label: 'Available', align: 'right', sortable: true, render: function (p) { var si = p.stockInfo || {}, a = si.totalAvailable; var low = a != null && si.lowStockThreshold != null && a <= si.lowStockThreshold; return a != null ? ('<span' + (low ? ' style="color:var(--amber,goldenrod);font-weight:600;"' : '') + '>' + a + '</span>') : '—'; } },
        { key: 'committed', label: 'Committed', align: 'right', sortable: true, render: function (p) { var si = p.stockInfo || {}; return si.totalCommitted != null ? String(si.totalCommitted) : '—'; } },
        { key: 'mode', label: 'Stock mode', sortable: true, render: function (p) { var si = p.stockInfo || {}; return si.stockType ? esc(si.stockType) : '—'; } }];
    }
    if (lens === 'sales') {
      return [_prodCol(),
        { key: 'u30', label: 'Units 30d', align: 'right', sortable: true, render: function (p) { var s = _salesEntry(p._key || p.pid) || {}; return String(s.last30 || 0); } },
        { key: 'r30', label: 'Revenue 30d', align: 'right', sortable: true, render: function (p) { var s = _salesEntry(p._key || p.pid) || {}; return _money(s.revenue30); } },
        { key: 'rall', label: 'Revenue all', align: 'right', sortable: true, render: function (p) { var s = _salesEntry(p._key || p.pid) || {}; return _money(s.revenueAll); } },
        { key: 'last', label: 'Last sold', align: 'right', sortable: true, render: function (p) { var s = _salesEntry(p._key || p.pid) || {}; return s.lastOrdered ? String(s.lastOrdered).slice(0, 10) : '—'; } }];
    }
    // forecast
    return [_prodCol(),
      { key: 'rate', label: 'Monthly rate', align: 'right', sortable: true, render: function (p) { var f = _forecastEntry(p._key || p.pid); return f && f.monthlyRate != null ? (f.monthlyRate + ' /mo') : '—'; } },
      { key: 'cov', label: 'Coverage', align: 'right', sortable: true, render: function (p) { var f = _forecastEntry(p._key || p.pid); if (!f) return '—'; return isFinite(f.weeksCoverage) ? (f.weeksCoverage + 'w') : (f.isMTO ? 'MTO' : '—'); } },
      { key: 'trend', label: 'Trend', render: function (p) { var f = _forecastEntry(p._key || p.pid); if (!f) return '—'; return f.trending ? '↑ up' : (f.declining ? '↓ down' : 'steady'); } },
      { key: 'suggest', label: 'Suggested', render: function (p) { var f = _forecastEntry(p._key || p.pid); if (f && f.suggestBuild) return '<span style="color:var(--amber,goldenrod);font-weight:600;">build ' + esc(String(f.suggestedQty || '')) + '</span>'; return (f && f.considerStocking) ? '<span style="color:var(--warm-gray);">consider</span>' : '—'; } }];
  }
  // The variant expand-tree, lens-aware — every facet expands to the same
  // Default + variants + Add-variant structure, with data cells matching the
  // active lens's columns. Variant names indent to sit under the product name.
  function buildChildRows(p, lens) {
    var pid = p._key || p.pid;
    lens = lens || 'general';
    if (lens === 'inventory') ensureInvForProduct(pid);
    function cell(html, align) {
      return '<td style="padding:14px 12px;font-size:0.9rem;color:var(--text-primary);border-bottom:1px solid var(--border,rgba(255,255,255,0.06));' +
        (align === 'right' ? 'text-align:right;font-variant-numeric:tabular-nums;' : '') + '">' + (html || '') + '</td>';
    }
    function nameCell(html) {
      return '<td style="padding:14px 12px;font-size:0.9rem;color:var(--text-primary);border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">' +
        '<span style="display:inline-block;padding-left:51px;">' + html + '</span></td>';
    }
    function row(fn, arg, nameHtml, dataCellsHtml) {
      return '<tr class="mast-row mast-subrow" onclick="' + fn + '(\'' + esc(arg) + '\')" ' +
        'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + fn + '(\'' + esc(arg) + '\')}" ' +
        'tabindex="0" role="button" style="cursor:pointer;">' + cell('') + nameCell(nameHtml) + dataCellsHtml + '</tr>';
    }
    // Data cells for the Default (v=null = product roll-up) or a variant.
    function dataCells(v) {
      if (lens === 'general') {
        if (!v) return cell('') + cell(esc(N.money(price(p)) || '—'), 'right') + cell('<span style="color:var(--warm-gray);">' + variantCount(p) + ' inherit</span>', 'right');
        var ov = variantOverridden(p, v);
        return cell('<span style="color:var(--warm-gray);font-size:0.78rem;">follows product</span>') +
          cell('<span' + (ov ? ' style="color:var(--amber,goldenrod);"' : '') + '>' + esc(N.money(variantPrice(p, v)) || '—') + '</span>', 'right') +
          cell('<span style="color:var(--warm-gray);">' + (ov ? 'override' : 'inherits') + '</span>', 'right');
      }
      if (lens === 'inventory') {
        if (!v) { var si = p.stockInfo || {}; return cell(si.totalOnHand != null ? String(si.totalOnHand) : '—', 'right') + cell(si.totalAvailable != null ? String(si.totalAvailable) : '—', 'right') + cell(si.totalCommitted != null ? String(si.totalCommitted) : '—', 'right') + cell(si.stockType ? esc(si.stockType) : '—'); }
        var inv = V2._invCache && V2._invCache[pid];
        if (!inv) return cell('<span style="color:var(--warm-gray);">…</span>', 'right') + cell('', 'right') + cell('', 'right') + cell('');
        var st = (inv.stock && inv.stock[v.id]) || {};
        var oh = st.onHand || 0, av = oh - (st.committed || 0) - (st.held || 0);
        return cell(String(oh), 'right') + cell(String(av), 'right') + cell(String(st.committed || 0), 'right') + cell('<span style="color:var(--warm-gray);">inherits mode</span>');
      }
      if (lens === 'sales') {
        if (!v) { var s = _salesEntry(pid) || {}; return cell(String(s.last30 || 0), 'right') + cell(_money(s.revenue30), 'right') + cell(_money(s.revenueAll), 'right') + cell(s.lastOrdered ? String(s.lastOrdered).slice(0, 10) : '—', 'right'); }
        return cell('<span style="color:var(--warm-gray);">shares product</span>') + cell('', 'right') + cell('', 'right') + cell('', 'right');
      }
      // forecast
      if (!v) { var f = _forecastEntry(pid); if (!f) return cell('—', 'right') + cell('—', 'right') + cell('—') + cell('—'); return cell((f.monthlyRate != null ? f.monthlyRate + ' /mo' : '—'), 'right') + cell(isFinite(f.weeksCoverage) ? f.weeksCoverage + 'w' : (f.isMTO ? 'MTO' : '—'), 'right') + cell(f.trending ? '↑ up' : (f.declining ? '↓ down' : 'steady')) + cell(f.suggestBuild ? ('build ' + esc(String(f.suggestedQty || ''))) : '—'); }
      return cell('<span style="color:var(--warm-gray);">shares product</span>') + cell('') + cell('') + cell('');
    }
    function emptyCells() { var n = lens === 'general' ? 3 : 4, s = ''; for (var i = 0; i < n; i++) s += cell(''); return s; }
    var defClick = lens === 'general' ? 'ProductsV2.open' : (lens === 'inventory' ? 'ProductsV2.openInventory' : (lens === 'sales' ? 'ProductsV2.openSales' : 'ProductsV2.openForecast'));
    var varClick = lens === 'inventory' ? 'ProductsV2.openVarInvEdit' : 'ProductsV2.openVariant';
    var out = row(defClick, pid, '<span style="color:var(--info);font-weight:600;">◆ Default</span> <span style="color:var(--warm-gray);">· base for all variants</span>', dataCells(null));
    realVariants(p).forEach(function (v) {
      var ov = variantOverridden(p, v);
      out += row(varClick, pid + '::' + v.id, esc(variantLabel(v)) + (lens === 'general' && ov ? ' <span class="pv2-ov">override</span>' : ''), dataCells(v));
    });
    if (canEditProduct()) out += row('ProductsV2.addVariant', pid, '<span style="color:var(--teal,teal);">+ Add variant</span> <span style="color:var(--warm-gray);">· inherits the Default</span>', emptyCells());
    return out;
  }
  // Load a product's inventory record (per-variant stock) for the Inventory lens
  // expand-tree; cache + re-render once.
  function ensureInvForProduct(pid) {
    V2._invCache = V2._invCache || {}; V2._invLoading = V2._invLoading || {};
    if (V2._invCache[pid] || V2._invLoading[pid]) return;
    V2._invLoading[pid] = true;
    Promise.resolve(MastDB.inventory.get(pid)).then(function (inv) { V2._invCache[pid] = inv || {}; V2._invLoading[pid] = false; rerenderPv2List(); }, function () { V2._invLoading[pid] = false; });
  }
  function renderListBody() {
    return (V2.lens && V2.lens !== 'general') ? renderLensList(V2.lens) : renderGeneralList();
  }
  function _emptyCfg() {
    var q = (V2.q || '').trim();
    return { title: 'No products', message: 'No products match ' + (q ? '“' + q + '”' : 'these filters') + '.' };
  }
  function rerenderPv2List() { var el = document.getElementById('pv2ListBody'); if (el) el.innerHTML = renderListBody(); else render(); }
  // General lens: the canonical product list (thumbnail + expandable variant tree).
  function renderGeneralList() {
    return window.MastEntity.renderList('products-v2', {
      rows: visibleRows(),
      columns: pv2ListColumns(),
      rowId: function (p) { return p._key || p.pid; },
      onRowClickFnName: 'ProductsV2.rowClick',
      sortKey: V2.sortKey, sortDir: V2.sortDir, onSortFnName: 'ProductsV2.sortBy',
      expandable: true,
      hasChildren: function (p) { return variantCount(p) > 0; },
      expandedIds: V2.expanded,
      onToggleFnName: 'ProductsV2.toggle',
      childRowsHtml: function (p) { return buildChildRows(p, 'general'); },
      empty: _emptyCfg()
    });
  }
  // Lazy-load the data a lens needs, then re-render the list in place.
  function lensEnsure(lens) {
    if (lens === 'sales') {
      if (window._mastProductSalesMap || V2._lensSalesLoading) return;
      V2._lensSalesLoading = true;
      Promise.resolve(window._ensureProductSalesMap ? window._ensureProductSalesMap() : null)
        .then(function () { V2._lensSalesLoading = false; rerenderPv2List(); }, function () { V2._lensSalesLoading = false; });
    } else if (lens === 'forecast') {
      if ((Array.isArray(window.forecastData) && window.forecastData.length) || V2._lensForecastLoading) return;
      V2._lensForecastLoading = true;
      Promise.resolve((window.productsData && window.productsData.length) ? null : MastDB.products.list())
        .then(function (all) { if (all) window.productsData = Array.isArray(all) ? all : Object.values(all || {}); window.productsLoaded = true; return window._ensureProductSalesMap ? window._ensureProductSalesMap() : null; })
        .then(function () {
          try { if (window.computeAndRenderForecast) window.computeAndRenderForecast(); } catch (e) { console.error('[products-v2] forecast', e); }
          var t = 0; (function poll() { if (Array.isArray(window.forecastData) && window.forecastData.length) { V2._lensForecastLoading = false; rerenderPv2List(); return; } if (t++ < 25) setTimeout(poll, 150); else { V2._lensForecastLoading = false; rerenderPv2List(); } })();
        }, function () { V2._lensForecastLoading = false; });
    }
  }
  function renderLensList(lens) {
    lensEnsure(lens);
    return window.MastEntity.renderList('products-v2', {
      rows: visibleRows(),
      columns: lensColumns(lens),
      rowId: function (p) { return p._key || p.pid; },
      onRowClickFnName: 'ProductsV2.lensRowClick',
      sortKey: V2.sortKey, sortDir: V2.sortDir, onSortFnName: 'ProductsV2.sortBy',
      expandable: true,
      hasChildren: function (p) { return variantCount(p) > 0; },
      expandedIds: V2.expanded,
      onToggleFnName: 'ProductsV2.toggle',
      childRowsHtml: function (p) { return buildChildRows(p, lens); },
      empty: _emptyCfg()
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
      '.pv2-hthumb:hover{box-shadow:0 0 0 2px var(--amber,goldenrod);} .pv2-hthumb .mu-zoom{position:absolute;right:3px;bottom:3px;width:16px;height:16px;border-radius:4px;background:rgba(0,0,0,.55);color:white;font-size:0.72rem;display:flex;align-items:center;justify-content:center;opacity:0;} .pv2-hthumb:hover .mu-zoom{opacity:1;}',
      '.pv2-imgfocus{display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,black 22%,transparent);border-radius:10px;padding:12px;}',
      '.pv2-imgfocus img{max-width:100%;max-height:min(58vh,440px);object-fit:contain;border-radius:8px;}',
      '.pv2-imgstrip{display:flex;flex-wrap:wrap;gap:8px;}',
      '.pv2-imgthumb{width:62px;height:62px;border-radius:8px;overflow:hidden;border:2px solid transparent;background:none;padding:0;cursor:pointer;}',
      '.pv2-imgthumb.on{border-color:var(--amber,goldenrod);} .pv2-imgthumb img{width:100%;height:100%;object-fit:cover;}',
      // (Old hand-rolled list CSS — .pv2-list/.pv2-row/.pv2-exp/.pv2-nm/.pv2-sub/
      //  .pv2-def/.pv2-add/.pv2-branch/.pv2-r — removed: the list re-platformed onto
      //  the engine (MastEntity.renderList → MastUI.list) in PR 247. Only .pv2-meta
      //  (list meta text) and .pv2-ov (variant override badge) are still used.)
      '.pv2-meta{color:var(--warm-gray);}',
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

  function render() {
    var tab = ensureTab(); ensureStyles();
    // A retired-route redirect (inventory / sales-by-product / forecast) can ask
    // us to open on a specific facet. Consume-once.
    if (window._pv2InitialLens) { V2.lens = window._pv2InitialLens; window._pv2InitialLens = null; }
    var counts = statusCounts();
    var pills = ['all', 'draft', 'ready', 'active', 'archived'].map(function (s) {
      var on = V2.filter === s; var label = s === 'all' ? 'All' : statusLabel(s);
      return '<button onclick="ProductsV2.setFilter(\'' + s + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        label + ' <span style="color:var(--warm-gray);">' + (counts[s] || 0) + '</span></button>';
    }).join('');
    var hasQ = !!(V2.q || '').trim();
    var search = '<div style="margin-left:auto;position:relative;width:230px;max-width:100%;">' +
      '<input id="pv2Search" type="text" value="' + esc(V2.q || '') + '" oninput="ProductsV2.setSearch(this.value)" placeholder="Search products…" ' +
      'style="width:100%;padding:7px 30px 7px 11px;border:1px solid var(--border);border-radius:999px;font-size:0.9rem;background:var(--cream,transparent);color:inherit;box-sizing:border-box;">' +
      '<button id="pv2SearchClear" onclick="ProductsV2.clearSearch()" aria-label="Clear search" title="Clear" ' +
      'style="position:absolute;right:6px;top:50%;transform:translateY(-50%);display:' + (hasQ ? 'flex' : 'none') + ';align-items:center;justify-content:center;width:20px;height:20px;border:0;border-radius:50%;background:color-mix(in srgb,var(--text-primary) 12%,transparent);color:var(--warm-gray);font-size:0.9rem;line-height:1;cursor:pointer;">×</button>' +
      '</div>';
    // Lens (facet) selector — same product list, different columns + click-through.
    // Only show facets the role can view; if the current lens isn't permitted
    // (e.g. arrived via a retired-route redirect), fall back to General.
    if (!canViewLens(V2.lens || 'general')) V2.lens = 'general';
    var curLens = V2.lens || 'general';
    var lensPills = [['general', 'General'], ['inventory', 'Inventory'], ['sales', 'Sales'], ['forecast', 'Forecast']].filter(function (l) { return canViewLens(l[0]); }).map(function (l) {
      var on = curLens === l[0];
      return '<button onclick="ProductsV2.setLens(\'' + l[0] + '\')" style="border:1px solid ' + (on ? 'var(--amber,goldenrod)' : 'var(--border)') + ';' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;padding:6px 15px;font-size:0.85rem;font-weight:' + (on ? '600' : '400') + ';cursor:pointer;margin-right:8px;">' + l[1] + '</button>';
    }).join('');
    // Tag-facet bar — filter the list by authored tags + derived badges. Narrows
    // (AND) and composes with status/search. Hidden when the catalog has no tags.
    var active = V2.tagFacets || [];
    var entries = facetTagEntries();
    var facetBar = '';
    if (entries.length) {
      var chips = entries.map(function (e) {
        var on = active.indexOf(e.key) >= 0;
        return '<button data-tag="' + esc(e.key) + '" onclick="ProductsV2.toggleTagFacet(this.dataset.tag)" ' +
          'style="border:1px solid ' + (on ? 'var(--teal,teal)' : 'var(--border)') + ';' +
          'background:' + (on ? 'color-mix(in srgb,var(--teal) 16%,transparent)' : 'transparent') + ';' +
          'color:' + (on ? 'var(--teal,teal)' : 'var(--warm-gray)') + ';border-radius:999px;padding:4px 11px;font-size:0.78rem;cursor:pointer;margin:0 6px 6px 0;">' +
          esc(e.label) + ' <span style="opacity:0.7;">' + e.count + '</span></button>';
      }).join('');
      var clear = active.length ? '<button onclick="ProductsV2.clearTagFacets()" style="border:0;background:transparent;color:var(--warm-gray);font-size:0.78rem;cursor:pointer;text-decoration:underline;margin-left:4px;">clear</button>' : '';
      facetBar = '<div style="margin:0 0 14px;display:flex;align-items:center;gap:0;flex-wrap:wrap;">' +
        '<span style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--warm-gray);margin-right:10px;">Tags</span>' + chips + clear + '</div>';
    }
    var canEd = canEditProduct();
    var toolsHtml = canEd
      ? '<button class="btn btn-secondary" title="Simulate metal spot-price shifts and preview the impact on recipe-costed products" onclick="ProductsV2.openWhatIf()">What-if pricing</button> ' +
        '<button class="btn btn-secondary" title="Recompute &amp; write every recipe-linked product price from its recipe" onclick="ProductsV2.openReprice()">Bulk reprice</button> ' +
        '<button class="btn btn-secondary" onclick="ProductsV2.importCsv()">↑ Import CSV</button> '
      : '';
    tab.innerHTML =
      U.pageHeader({ title: 'Products', count: N.count(V2.rows.length) + ' products',
        actionsHtml: (canEd ? '<button class="btn btn-primary" onclick="ProductsV2.newProduct()">+ New product</button> ' : '') + toolsHtml + '<button class="btn btn-secondary" onclick="ProductsV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0 10px;display:flex;align-items:center;gap:8px 0;flex-wrap:wrap;">' + lensPills + '</div>' +
      '<div style="margin:0 0 14px;display:flex;align-items:center;gap:8px 0;flex-wrap:wrap;">' + pills + search + '</div>' +
      facetBar +
      '<div id="pv2ListBody">' + renderListBody() + '</div>';
  }

  // Body for the "New product" slide-out wizard (From scratch / Clone existing).
  function newProductWizardHtml() {
    var fieldStyle = 'display:block;width:100%;margin-top:4px;padding:8px 10px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.9rem;background:var(--cream);color:inherit;box-sizing:border-box;';
    function tabBtn(k, label) {
      var on = (V2._npMode || 'scratch') === k;
      return '<button id="pv2NpTab_' + k + '" type="button" onclick="ProductsV2.npSetMode(\'' + k + '\')" style="flex:1;padding:10px;border:0;cursor:pointer;font-size:0.9rem;' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';font-weight:' + (on ? '600' : '400') + ';' + (k === 'clone' ? 'border-left:1px solid var(--border);' : '') + '">' + esc(label) + '</button>';
    }
    var cats = {}; V2.rows.forEach(function (r) { (r.categories || []).forEach(function (c) { if (c) cats[c] = 1; }); });
    var dl = Object.keys(cats).sort().map(function (c) { return '<option value="' + esc(c) + '">'; }).join('');
    var modes = [['build', 'Build', 'Produce in-house — define materials, labor, and costs.'], ['var', 'VAR', 'Source components and add value (assembly, branding).'], ['resell', 'Resell', 'Source from a supplier and apply markup.']];
    var modeHtml = modes.map(function (m, i) {
      return '<label style="display:flex;gap:9px;align-items:flex-start;padding:9px 11px;border:1px solid var(--border);border-radius:7px;margin-bottom:6px;cursor:pointer;">' +
        '<input type="radio" name="pv2NpMode" value="' + m[0] + '"' + (i === 0 ? ' checked' : '') + ' style="margin-top:3px;">' +
        '<span><span style="font-weight:600;font-size:0.9rem;">' + m[1] + '</span><br><span style="font-size:0.78rem;color:var(--warm-gray);">' + m[2] + '</span></span></label>';
    }).join('');
    var srcOpts = V2.rows.slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || '')); })
      .map(function (r) { return '<option value="' + esc(r._key) + '">' + esc(r.name || '(unnamed)') + '</option>'; }).join('');
    return '<div style="padding:2px 2px 8px;">' +
      '<div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:18px;">' + tabBtn('scratch', 'From scratch') + tabBtn('clone', 'Clone existing') + '</div>' +
      '<label style="display:block;margin-bottom:14px;font-size:0.85rem;color:var(--warm-gray);">Product name' +
      '<input id="pv2NpName" type="text" placeholder="e.g. Cobalt Pendant" style="' + fieldStyle + '"></label>' +
      '<div id="pv2NpScratch"' + ((V2._npMode || 'scratch') === 'scratch' ? '' : ' hidden') + '>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:6px;">Acquisition mode</div>' + modeHtml +
      '<label style="display:block;margin:8px 0 4px;font-size:0.85rem;color:var(--warm-gray);">Category' +
      '<input id="pv2NpCat" list="pv2NpCats" placeholder="e.g. pendants" style="' + fieldStyle + '"><datalist id="pv2NpCats">' + dl + '</datalist></label>' +
      '</div>' +
      '<div id="pv2NpClone"' + ((V2._npMode || 'scratch') === 'clone' ? '' : ' hidden') + '>' +
      '<label style="display:block;margin-bottom:6px;font-size:0.85rem;color:var(--warm-gray);">Product to clone' +
      '<select id="pv2NpSource" style="' + fieldStyle + '">' + srcOpts + '</select></label>' +
      '<div class="pv2-pnote">Copies catalog, options &amp; variants, pricing, and tags. The recipe, channel listings, and stock are <strong>not</strong> copied — the clone starts as an unpublished draft.</div>' +
      '</div></div>';
  }

  // ════════════════ Power tools (retired the "Advanced ↗" V1 door) ════════════
  // Three recipe/product power-tools that used to live only in the legacy maker.js
  // builder, reached via navigateToClassic('products'). Now native here, all
  // single-sourced through window.MakerProductBridge — no pricing math or CSV
  // parse/write is reimplemented; the simulator, the bulk-reprice (THROUGH the
  // shared applyRecipeToProduct price-write core), and the CSV import/writer all
  // delegate to the bridge. All three are gated on can('products','edit').

  // ── What-if metal-price simulator (preview only — zero writes) ──────────
  var WhatIf = (function () {
    var st = null;
    function open() {
      if (!canEditProduct()) { MastAdmin.showToast('You do not have permission to do this', true); return; }
      st = { gold: 0, silver: 0, platinum: 0, spot: null, results: null, loading: true };
      render();
      withProductBridge(function () { run(); });
    }
    function close() { st = null; if (typeof closeModal === 'function') closeModal(); }
    function setShift(metal, val) {
      if (!st) return;
      st[metal] = parseFloat(val) || 0;
      run();
    }
    function run() {
      if (!st) return;
      st.loading = true;
      Promise.resolve(window.MakerProductBridge.whatIfSimulate({ gold: st.gold, silver: st.silver, platinum: st.platinum }))
        .then(function (res) {
          if (!st) return;
          st.loading = false;
          if (!res || !res.ok) { st.results = []; st.spot = null; renderResults(); return; }
          st.spot = res.spot; st.results = res.results || [];
          renderResults();
        }, function (e) { console.error('[products-v2] whatif', e); if (st) { st.loading = false; st.results = []; renderResults(); } });
    }
    function metalInputs() {
      var spot = st.spot || {};
      return ['gold', 'silver', 'platinum'].map(function (m) {
        var label = m.charAt(0).toUpperCase() + m.slice(1);
        return '<div style="flex:1;">' +
          '<label style="display:block;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">' + label + ' shift %</label>' +
          '<input type="number" step="1" value="' + esc(String(st[m] || 0)) + '" oninput="ProductsV2.whatIfSet(\'' + m + '\', this.value)" style="width:100%;padding:8px 10px;border:1px solid var(--cream-dark);border-radius:6px;font-family:monospace;background:var(--cream);color:inherit;box-sizing:border-box;">' +
          '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:2px;">spot $' + (Number(spot[m]) || 0).toFixed(2) + '/oz</div>' +
          '</div>';
      }).join('');
    }
    function resultsHtml() {
      if (st.loading && st.results == null) return '<div class="mu-sub" style="text-align:center;padding:12px;">Simulating…</div>';
      if (st.spot == null) return '<div class="mu-sub" style="text-align:center;padding:12px;">No spot prices available yet. Refresh metals pricing first.</div>';
      var results = st.results || [];
      if (!results.length) return '<div class="mu-sub" style="text-align:center;padding:12px;">No spot-linked recipes are affected by this shift.</div>';
      var h = '<div class="mu-sub" style="margin-bottom:6px;">' + MastFormat.countNoun(results.length, 'recipe') + ' affected (sorted by cost impact):</div>';
      h += '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;"><thead><tr>' +
        '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Recipe</th>' +
        '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Current</th>' +
        '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Simulated</th>' +
        '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Δ Cost</th>' +
        '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Margin → sim</th>' +
        '</tr></thead><tbody>';
      results.forEach(function (r) {
        var up = r.costDelta > 0, dn = r.costDelta < 0;
        var dc = up ? 'var(--danger)' : (dn ? 'var(--success)' : 'var(--warm-gray)');
        var floorWarn = r.breachesFloor ? ' <span title="Breaches minimum margin floor" style="color:var(--danger);">⚠</span>' : '';
        h += '<tr>' +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(r.name || '') + '</td>' +
          '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + (N.money(r.currentTotalCost) || '$0.00') + '</td>' +
          '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + (N.money(r.simulatedTotalCost) || '$0.00') + '</td>' +
          '<td style="text-align:right;font-family:monospace;color:' + dc + ';padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + (r.costDelta >= 0 ? '+' : '') + (N.money(r.costDelta) || '$0.00') + '</td>' +
          '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + (Number(r.currentMarginPct) || 0).toFixed(1) + '% → ' + (Number(r.simulatedMarginPct) || 0).toFixed(1) + '%' + floorWarn + '</td>' +
          '</tr>';
      });
      h += '</tbody></table></div>';
      return h;
    }
    function renderResults() {
      var box = document.getElementById('pv2WhatIfResults');
      if (box) box.innerHTML = resultsHtml();
    }
    function render() {
      if (!st || typeof openModal !== 'function') return;
      openModal(
        '<div style="max-width:780px;">' +
          '<h2 style="font-size:1.15rem;margin:0 0 6px;">What-if metal pricing</h2>' +
          '<div class="mu-sub" style="margin-bottom:14px;">Shift metals spot prices and preview how every recipe that uses spot-linked materials would move. Preview only — nothing is written.</div>' +
          '<div style="display:flex;gap:12px;margin-bottom:16px;">' + metalInputs() + '</div>' +
          '<div id="pv2WhatIfResults">' + resultsHtml() + '</div>' +
          '<div style="display:flex;justify-content:flex-end;margin-top:18px;">' +
            '<button class="btn btn-secondary" onclick="ProductsV2.whatIfClose()">Done</button>' +
          '</div>' +
        '</div>'
      );
    }
    return { open: open, close: close, setShift: setShift };
  })();

  // ── Bulk Reprice All (writes THROUGH the shared price core) ─────────────
  var Reprice = (function () {
    var st = null;
    function open() {
      if (!canEditProduct()) { MastAdmin.showToast('You do not have permission to do this', true); return; }
      st = { candidates: null, thresholdPct: null, running: false, done: null };
      render();
      withProductBridge(function () { loadCandidates(); });
    }
    function close() { st = null; if (typeof closeModal === 'function') closeModal(); }
    function loadCandidates() {
      Promise.resolve(window.MakerProductBridge.repriceCandidates()).then(function (res) {
        if (!st) return;
        if (!res || !res.ok) { st.candidates = []; render(); return; }
        st.candidates = res.candidates || []; st.thresholdPct = res.thresholdPct;
        st.evaluated = (typeof res.evaluated === 'number') ? res.evaluated : null;
        render();
      }, function (e) { console.error('[products-v2] reprice candidates', e); if (st) { st.candidates = []; render(); } });
    }
    function run() {
      if (!st || st.running || !st.candidates || !st.candidates.length) return;
      st.running = true;
      st.progress = { done: 0, total: st.candidates.length, name: '' };
      render();
      var ids = st.candidates.map(function (c) { return c.recipeId; });
      Promise.resolve(window.MakerProductBridge.repriceExecute(ids, function (done, total, name) {
        if (!st) return;
        st.progress = { done: done, total: total, name: name };
        var p = document.getElementById('pv2RepriceProgress');
        if (p) p.innerHTML = progressHtml();
      })).then(function (res) {
        if (!st) return;
        st.running = false; st.done = res || { succeeded: 0, failed: 0, total: 0, errors: [] };
        render();
        reloadProducts();
      }, function (e) {
        console.error('[products-v2] reprice execute', e);
        if (!st) return;
        st.running = false; st.done = { succeeded: 0, failed: (st.candidates || []).length, total: (st.candidates || []).length, errors: [] };
        render();
      });
    }
    function progressHtml() {
      var p = st.progress || { done: 0, total: 0, name: '' };
      var pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
      return '<div class="mu-sub" style="margin-bottom:8px;">Repricing ' + p.done + ' / ' + p.total + (p.name ? ' — ' + esc(p.name) : '') + '…</div>' +
        '<div style="height:8px;border-radius:4px;background:var(--cream-dark);overflow:hidden;"><div style="height:100%;width:' + pct + '%;background:var(--amber);transition:width .2s;"></div></div>';
    }
    function tableHtml() {
      var c = st.candidates || [];
      var h = '<div style="overflow-x:auto;margin-bottom:14px;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;"><thead><tr>' +
        '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Recipe</th>' +
        '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Tier</th>' +
        '<th style="text-align:left;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Why</th>' +
        '<th style="text-align:right;padding:6px 8px;border-bottom:2px solid var(--cream-dark);font-size:0.72rem;text-transform:uppercase;">Cost</th>' +
        '</tr></thead><tbody>';
      c.forEach(function (r) {
        var why = r.why || ((r.currentDriftPct > 0 ? '+' : '') + (Number(r.currentDriftPct) || 0).toFixed(1) + '%');
        var whyColor = r.belowCost ? 'var(--danger)' : 'var(--warning)';
        h += '<tr>' +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(r.name || '') + '</td>' +
          '<td style="padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(r.activePriceTier || 'direct') + '</td>' +
          '<td style="font-family:monospace;color:' + whyColor + ';padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + esc(why) + '</td>' +
          '<td style="text-align:right;font-family:monospace;padding:6px 8px;border-bottom:1px solid var(--cream-dark);">' + (N.money(r.totalCost) || '$0.00') + '</td>' +
          '</tr>';
      });
      h += '</tbody></table></div>';
      return h;
    }
    function doneHtml() {
      var d = st.done;
      var h = '<div style="text-align:center;padding:20px 10px;">' +
        '<div style="font-size:1.6rem;margin-bottom:8px;">' + (d.failed ? '⚠️' : '✅') + '</div>' +
        '<p style="font-weight:500;margin:0 0 6px;">Reprice complete</p>' +
        '<p class="mu-sub" style="margin:0;">' + MastFormat.countNoun(d.succeeded, 'product') + ' repriced' + (d.failed ? ', ' + d.failed + ' failed' : '') + '.</p>';
      if (d.errors && d.errors.length) {
        h += '<div style="text-align:left;margin-top:14px;font-size:0.78rem;color:var(--danger);">';
        d.errors.slice(0, 8).forEach(function (e) { h += '<div>• ' + esc(e.name) + ': ' + esc(e.error) + '</div>'; });
        if (d.errors.length > 8) h += '<div>… and ' + (d.errors.length - 8) + ' more</div>';
        h += '</div>';
      }
      h += '</div>';
      return h;
    }
    function render() {
      if (!st || typeof openModal !== 'function') return;
      var body, foot;
      if (st.done) {
        body = doneHtml();
        foot = '<button class="btn btn-primary" onclick="ProductsV2.repriceClose()">Done</button>';
      } else if (st.running) {
        body = '<div id="pv2RepriceProgress">' + progressHtml() + '</div>';
        foot = '<button class="btn btn-secondary" disabled>Repricing…</button>';
      } else if (st.candidates == null) {
        body = '<div class="mu-sub" style="text-align:center;padding:12px;">Checking recipes…</div>';
        foot = '<button class="btn btn-secondary" onclick="ProductsV2.repriceClose()">Cancel</button>';
      } else if (!st.candidates.length) {
        var thr = (st.thresholdPct != null ? st.thresholdPct + '%' : 'the configured');
        body = '<div class="mu-sub" style="text-align:center;padding:12px;">' +
          (st.evaluated
            ? 'Checked ' + st.evaluated + ' active recipe-linked product' + (st.evaluated === 1 ? '' : 's') + ' — none need repricing (all within the ' + thr + ' drift threshold and priced at or above cost).'
            : 'No active recipe-linked products to check.') +
          '</div>';
        foot = '<button class="btn btn-secondary" onclick="ProductsV2.repriceClose()">Close</button>';
      } else {
        body = '<div class="mu-sub" style="margin-bottom:12px;">' + MastFormat.countNoun(st.candidates.length, 'active recipe-linked product') + ' need repricing — drifted past the ' + (st.thresholdPct != null ? st.thresholdPct + '% ' : '') + 'threshold (cost or price) or priced below cost. Each recipe is recosted, then its prices are written to the linked product through the standard recipe-apply path (variant tier prices + Etsy sync).</div>' + tableHtml();
        foot = '<button class="btn btn-secondary" onclick="ProductsV2.repriceClose()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="ProductsV2.repriceRun()">Reprice all ' + st.candidates.length + '</button>';
      }
      openModal(
        '<div style="max-width:700px;">' +
          '<h2 style="font-size:1.15rem;margin:0 0 12px;">Bulk reprice</h2>' +
          body +
          '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px;">' + foot + '</div>' +
        '</div>'
      );
    }
    function reloadProducts() {
      // Refresh the legacy global product cache (recipe/product data the bridge
      // reads) AND the V2 list (module-level load) so the new prices show on close.
      Promise.resolve(window.loadProducts ? window.loadProducts() : null).then(function () { load(); });
    }
    return { open: open, close: close, run: run };
  })();

  // ── Product CSV import wizard (mirrors the materials-v2 importer, PR 566) ─
  var Import = (function () {
    var st = null;
    function fields() { return window.MakerProductBridge.productImportFields(); }
    function open() {
      if (!canEditProduct()) { MastAdmin.showToast('You do not have permission to do this', true); return; }
      st = { step: 1, parsedData: null, headers: [], mappings: {}, filename: '', defaultCategory: '' };
      withProductBridge(function () { render(); });
    }
    function close() { st = null; if (typeof closeModal === 'function') closeModal(); }
    function setMapping(key, val) { if (!st) return; if (val === '' || val == null) delete st.mappings[key]; else st.mappings[key] = parseInt(val, 10); }
    function setDefault(key, val) { if (st) st[key] = val; }
    function step(dir) {
      if (!st) return;
      if (dir > 0 && st.step === 1 && !st.parsedData) { MastAdmin.showToast('Upload a file first', true); return; }
      if (dir > 0 && st.step === 2) {
        var missing = fields().filter(function (f) {
          if (!f.required) return false;
          if (st.mappings[f.key] !== undefined) return false;
          return true;
        });
        if (missing.length) { MastAdmin.showToast('Map required fields: ' + missing.map(function (f) { return f.label; }).join(', '), true); return; }
      }
      st.step = Math.max(1, Math.min(3, st.step + dir));
      render();
    }
    async function pickFile(input) {
      if (!st) return;
      var file = input && input.files && input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) { MastAdmin.showToast('File must be under 5MB', true); return; }
      st.filename = file.name;
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      function ingest(headers, dataRows) {
        if (!dataRows || dataRows.length < 1) { MastAdmin.showToast('File has no data rows', true); return; }
        if (dataRows.length > 1000) { MastAdmin.showToast('Max 1,000 rows allowed. File has ' + dataRows.length, true); return; }
        st.headers = headers.map(function (h) { return String(h); });
        st.parsedData = dataRows.filter(function (row) { return row.some(function (c) { return c !== '' && c != null; }); });
        st.mappings = window.MakerProductBridge.productAutoDetectMappings(st.headers);
        render();
      }
      if (['xlsx', 'xls'].indexOf(ext) >= 0) {
        // SheetJS lazy-loaded on first import use (Track 3).
        try { await window.ensureXlsx(); } catch (err) { MastAdmin.showToast('Failed to load spreadsheet parser', true); return; }
        var r = new FileReader();
        r.onload = function (e) {
          try {
            var wb = XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
            if (data.length < 2) { MastAdmin.showToast('File has no data rows', true); return; }
            ingest(data[0], data.slice(1));
          } catch (err) { MastAdmin.showToast('Failed to parse file: ' + err.message, true); }
        };
        r.readAsArrayBuffer(file);
      } else {
        // PapaParse lazy-loaded on first import use (Track 3).
        try { await window.ensurePapa(); } catch (err) { MastAdmin.showToast('Failed to load CSV parser', true); return; }
        Papa.parse(file, {
          complete: function (res) {
            if (!res.data || res.data.length < 2) { MastAdmin.showToast('File has no data rows', true); return; }
            ingest(res.data[0], res.data.slice(1));
          },
          error: function (err) { MastAdmin.showToast('Failed to parse CSV: ' + err.message, true); }
        });
      }
    }
    function mappedRows() {
      var defaults = { defaultCategory: st.defaultCategory };
      return (st.parsedData || []).map(function (row) { return window.MakerProductBridge.productMapImportRow(row, st.mappings, defaults); });
    }
    function run() {
      if (!canEditProduct()) { MastAdmin.showToast('You do not have permission to import products', true); return; }
      var records = mappedRows();
      var valid = records.filter(function (r) { return r._valid !== false; });
      var btn = document.getElementById('pv2ImportBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
      Promise.resolve(window.MakerProductBridge.productImportRecords(valid, st.filename)).then(function (res) {
        if (!res || !res.ok) { MastAdmin.showToast('Import failed' + (res && res.error ? ': ' + res.error : ''), true); if (btn) { btn.disabled = false; btn.textContent = 'Import'; } return; }
        MastAdmin.showToast(MastFormat.countNoun(res.imported, 'product') + ' imported' + (res.skipped ? ', ' + res.skipped + ' skipped' : ''));
        close();
        Promise.resolve(window.loadProducts ? window.loadProducts() : null).then(function () { load(); });
      }).catch(function (e) {
        console.error('[products-v2] import', e);
        MastAdmin.showToast('Import failed', true);
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
      h += '<div class="mu-sub" style="margin-bottom:14px;">Upload a .csv or .xlsx file. Max 5MB, 1,000 rows. The first row must be column headers. Imported products land as <strong>draft</strong>.</div>';
      h += '<div style="border:2px dashed var(--cream-dark);border-radius:8px;padding:26px;text-align:center;">';
      h += '<input type="file" accept=".csv,.xlsx,.xls" onchange="ProductsV2.importPickFile(this)">';
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
      h += '<div class="mu-sub" style="margin-bottom:14px;">Match your file columns to product fields. Auto-detected matches are pre-selected. Required fields are marked *.</div>';
      fields().forEach(function (f) {
        var mapped = st.mappings[f.key];
        var auto = mapped !== undefined;
        h += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:10px;padding:6px 10px;border-radius:6px;background:' + (auto ? 'rgba(42,124,111,0.06)' : 'transparent') + ';">';
        h += '<div style="min-width:150px;font-size:0.85rem;font-weight:500;">' + esc(f.label) + (f.required ? ' *' : '') + '</div>';
        h += '<select class="form-input" onchange="ProductsV2.importSetMapping(\'' + f.key + '\', this.value)" style="flex:1;">';
        h += '<option value="">— Don\'t import —</option>';
        st.headers.forEach(function (hd, i) { h += '<option value="' + i + '"' + (mapped === i ? ' selected' : '') + '>' + esc(hd) + '</option>'; });
        h += '</select></div>';
      });
      h += '<div style="margin-top:14px;padding:10px 12px;background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;">';
      h += '<div style="font-size:0.85rem;font-weight:500;margin-bottom:6px;">Default category (when not mapped)</div>';
      h += '<input class="form-input" type="text" value="' + esc(st.defaultCategory || '') + '" placeholder="e.g. Imported" onchange="ProductsV2.importSetDefault(\'defaultCategory\', this.value)"></div>';
      return h;
    }
    function renderStep3() {
      var records = mappedRows();
      var valid = [], invalid = 0;
      records.forEach(function (r) { if (r._valid !== false) valid.push(r); else invalid++; });
      var fs = fields().filter(function (f) { return st.mappings[f.key] !== undefined || f.required; });
      var h = '<div style="font-weight:600;margin-bottom:8px;">Step 3 · Preview &amp; confirm</div>';
      h += '<div class="mu-sub" style="margin-bottom:12px;">' + MastFormat.countNoun(valid.length, 'valid row') + ' ready' + (invalid ? ', ' + invalid + ' will be skipped (missing required fields)' : '') + '. Imported products land as <strong>draft</strong>.</div>';
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
        ? '<button class="btn btn-secondary" onclick="ProductsV2.importStep(-1)">← Back</button>'
        : '<button class="btn btn-secondary" onclick="ProductsV2.importClose()">Cancel</button>';
      foot += st.step < 3
        ? '<button class="btn btn-primary" onclick="ProductsV2.importStep(1)">Continue</button>'
        : '<button class="btn btn-primary" id="pv2ImportBtn" onclick="ProductsV2.importRun()"' + (validCount ? '' : ' disabled') + '>Import ' + MastFormat.countNoun(validCount, 'product') + '</button>';
      foot += '</div>';
      openModal(
        '<div style="max-width:760px;">' +
          '<h2 style="font-size:1.15rem;margin:0 0 12px;">Import products</h2>' +
          steps(st.step) + body + foot +
        '</div>'
      );
    }
    return { open: open, close: close, render: render, step: step, pickFile: pickFile, setMapping: setMapping, setDefault: setDefault, run: run };
  })();

  window.ProductsV2 = {
    setFilter: function (s) { V2.filter = s; render(); },
    // ── Power tools (native, single-sourced via MakerProductBridge) ──
    openWhatIf: function () { WhatIf.open(); },
    whatIfSet: function (metal, val) { WhatIf.setShift(metal, val); },
    whatIfClose: function () { WhatIf.close(); },
    openReprice: function () { Reprice.open(); },
    repriceRun: function () { Reprice.run(); },
    repriceClose: function () { Reprice.close(); },
    importCsv: function () { Import.open(); },
    importClose: function () { Import.close(); },
    importStep: function (dir) { Import.step(dir); },
    importPickFile: function (input) { Import.pickFile(input); },
    importSetMapping: function (key, val) { Import.setMapping(key, val); Import.render(); },
    importSetDefault: function (key, val) { Import.setDefault(key, val); },
    importRun: function () { Import.run(); },
    // ── New product (v2 create) — a small standard dialog → creates a draft and
    // opens it in the v2 SO (no legacy builder/define bounce). ──
    // "+ New product" → a standard slide-out wizard: choose From scratch / Clone
    // existing, collect name (+ source/mode/category), then drop into the new
    // product's v2 SO with blank or cloned data.
    newProduct: function () {
      if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to create products', true); return; }
      V2._npMode = 'scratch';
      if (!window.MastUI || !MastUI.slideOut) { MastAdmin.showToast('Cannot open dialog', true); return; }
      MastUI.slideOut.open({
        title: 'New product', size: 'md', mode: 'read', deepLink: false,
        actions: [{ label: 'Cancel', onClickFnName: 'ProductsV2.cancelNewProduct' }, { label: 'Create product', primary: true, onClickFnName: 'ProductsV2.submitNewProduct' }],
        render: function () { return newProductWizardHtml(); }
      });
      setTimeout(function () { var nm = document.getElementById('pv2NpName'); if (nm) nm.focus(); }, 60);
    },
    npSetMode: function (m) {
      V2._npMode = (m === 'clone') ? 'clone' : 'scratch';
      var sc = document.getElementById('pv2NpScratch'), cl = document.getElementById('pv2NpClone');
      if (sc) sc.hidden = (V2._npMode !== 'scratch');
      if (cl) cl.hidden = (V2._npMode !== 'clone');
      ['scratch', 'clone'].forEach(function (k) {
        var b = document.getElementById('pv2NpTab_' + k); if (!b) return;
        var on = (V2._npMode === k);
        b.style.background = on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent';
        b.style.color = on ? 'var(--text-primary)' : 'var(--warm-gray)';
        b.style.fontWeight = on ? '600' : '400';
      });
    },
    cancelNewProduct: function () { if (window.MastUI && MastUI.slideOut) MastUI.slideOut.requestClose(); },
    submitNewProduct: function () {
      var nameEl = document.getElementById('pv2NpName');
      var name = nameEl ? nameEl.value.trim() : '';
      if (!name) { MastAdmin.showToast('Name is required', true); if (nameEl) nameEl.focus(); return; }
      function opened(res, verb) {
        if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
        if (window.MastUI && MastUI.slideOut) MastUI.slideOut.requestClose();
        var rec = stamp(Object.assign({}, res.product), res.pid);
        V2.rows.push(rec); V2.byId[rec._key] = rec;
        render();
        setTimeout(function () { MastEntity.openRecord('products-v2', rec, 'read'); }, 80);
        MastAdmin.showToast(verb + ' — finish setting it up');
      }
      if (V2._npMode === 'clone') {
        var srcEl = document.getElementById('pv2NpSource');
        var srcPid = srcEl ? srcEl.value : '';
        if (!srcPid) { MastAdmin.showToast('Pick a product to clone', true); return; }
        ensureMaker(function () {
          Promise.resolve(window.MakerProductBridge.cloneProduct(srcPid, name)).then(function (res) { opened(res, 'Cloned'); }, function (e) { console.error('[products-v2] cloneProduct', e); MastAdmin.showToast('Failed', true); });
        });
      } else {
        var modeR = document.querySelector('input[name="pv2NpMode"]:checked');
        var mode = modeR ? modeR.value : 'build';
        var catEl = document.getElementById('pv2NpCat');
        var category = catEl ? catEl.value.trim() : '';
        ensureMaker(function () {
          Promise.resolve(window.MakerProductBridge.createDraftProduct({ name: name, acquisitionType: mode, category: category })).then(function (res) { opened(res, 'Draft created'); }, function (e) { console.error('[products-v2] createDraftProduct', e); MastAdmin.showToast('Failed', true); });
        });
      }
    },
    // Tag facets — toggle a tag in/out of the active narrowing set (AND), then
    // re-render (chip states + counts + list all change).
    toggleTagFacet: function (tag) {
      var k = String(tag || '').toLowerCase(); if (!k) return;
      V2.tagFacets = V2.tagFacets || [];
      var i = V2.tagFacets.indexOf(k);
      if (i >= 0) V2.tagFacets.splice(i, 1); else V2.tagFacets.push(k);
      render();
    },
    clearTagFacets: function () { V2.tagFacets = []; render(); },
    // Facet selector — re-render the whole surface (columns + click-through change).
    setLens: function (l) { V2.lens = l; render(); },
    // Click a column header to sort (product-level; toggles asc/desc). Price sorts
    // by lowest price, Variants by count — so ascending = cheapest / fewest first.
    sortBy: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      var lb = document.getElementById('pv2ListBody'); if (lb) lb.innerHTML = renderListBody(); else render();
    },
    // Lens row click: open the product SO focused on the matching detail tab.
    openToTab: function (id, pane) { var rec = V2.byId[id]; if (!rec) return; ensureMaker(function () { MastEntity.openRecord('products-v2', rec, 'read'); restorePaneWhenReady(pane); }); },
    // Lens parent-row click: has-variants → expand; else open the SO on the lens
    // tab — and for Inventory, go straight into edit mode (one click to change a
    // count, no separate "Set stock" step).
    lensRowClick: function (id) {
      var p = V2.byId[id];
      if (p && variantCount(p) > 0) { ProductsV2.toggle(id); return; }
      if (V2.lens === 'inventory') ProductsV2.openInvEdit(id);
      else ProductsV2.openToTab(id, V2.lens === 'sales' ? 'sales' : 'forecast');
    },
    // Variant row in the Inventory lens → variant SO on its Inventory tab.
    openVariantInventory: function (key) { var rec = buildVariantRecord(key); if (rec) ensureMaker(function () { MastEntity.openRecord('product-variant-v2', rec, 'read'); restorePaneWhenReady('v-inventory'); }); },
    // Open straight into inventory EDIT mode (Inventory lens shortcut).
    openInvEdit: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      ensureMaker(function () { MastEntity.openRecord('products-v2', rec, 'read'); setTimeout(function () { ProductsV2.editInventory(id); restorePaneWhenReady('inventory'); }, 0); });
    },
    openVarInvEdit: function (key) {
      var parts = String(key).split('::'); var pid = parts[0], vid = parts[1];
      var rec = buildVariantRecord(key); if (!rec) return;
      ensureMaker(function () { MastEntity.openRecord('product-variant-v2', rec, 'read'); setTimeout(function () { ProductsV2.editVariantInventory(pid, vid); restorePaneWhenReady('v-inventory'); }, 0); });
    },
    openInventory: function (id) { ProductsV2.openToTab(id, 'inventory'); },
    openSales: function (id) { ProductsV2.openToTab(id, 'sales'); },
    openForecast: function (id) { ProductsV2.openToTab(id, 'forecast'); },
    // ── Channels (bind product to a channel + per-variant include/exclude) ──
    toggleChannel: function (pid, channelId) {
      if (!_guardEditP()) return;
      var p = V2.byId[pid]; var bound = !!bindingFor(p, channelId);
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setChannelBinding(pid, channelId, !bound)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec) { rec.channelBindings = res.channelBindings; rec.channelIds = res.channelIds; }
          rerenderChannelsPane(pid); refreshProductSummary(pid);
          MastAdmin.showToast(!bound ? 'Now selling on this channel' : 'Removed from channel');
        }, function (e) { console.error('[products-v2] toggleChannel', e); MastAdmin.showToast('Failed', true); });
      });
    },
    toggleVariantChannel: function (pid, channelId, vid) {
      if (!_guardEditP()) return;
      var p = V2.byId[pid]; var ex = variantExcluded(p, channelId, vid);
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setVariantChannelExcluded(pid, channelId, vid, !ex)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec) { rec.channelBindings = res.channelBindings; rec.channelIds = res.channelIds; }
          // Refresh whichever pane is open — the product Channels tab (chips) or
          // the variant's own Channels tab (rows). Each no-ops if absent.
          rerenderChannelsPane(pid);
          rerenderVariantChannelsPane(pid, vid);
        }, function (e) { console.error('[products-v2] toggleVariantChannel', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // Type-to-filter the list by name / category / SKU. Re-render only the list
    // body so the input keeps focus (no full re-render mid-keystroke).
    setSearch: function (v) {
      V2.q = v;
      var x = document.getElementById('pv2SearchClear'); if (x) x.style.display = (v && v.trim()) ? 'flex' : 'none';
      var el = document.getElementById('pv2ListBody');
      if (el) el.innerHTML = renderListBody(); else render();
    },
    // One-click clear of the search box (vs backspacing the whole entry).
    clearSearch: function () {
      V2.q = '';
      var inp = document.getElementById('pv2Search'); if (inp) inp.value = '';
      var x = document.getElementById('pv2SearchClear'); if (x) x.style.display = 'none';
      var el = document.getElementById('pv2ListBody'); if (el) el.innerHTML = renderListBody(); else render();
      if (inp) inp.focus();
    },
    // Row click: a product WITH variants expands (pick the Default or a variant);
    // a variant-less product opens directly. (The toggle column also expands.)
    rowClick: function (id) { var p = V2.byId[id]; if (p && variantCount(p) > 0) ProductsV2.toggle(id); else ProductsV2.open(id); },
    toggle: function (id) {
      V2.expanded[id] = !V2.expanded[id];
      var el = document.getElementById('pv2ListBody');
      if (el) el.innerHTML = renderListBody(); else render();
    },
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
    // Forecast tab → create a production job for the suggested build (reuses the
    // legacy forecast job modal + its delegated create handler).
    createForecastJob: function (pid, qty) {
      if (!_can('jobs', 'edit')) { MastAdmin.showToast('You don’t have permission to create production jobs', true); return; }
      if (window.openForecastJobModal) window.openForecastJobModal(pid, qty);
      else MastAdmin.showToast('Job creation unavailable', true);
    },
    // Preload maker too, so the first image/edit click in a variant SO works
    // (no cold "still loading" — the variant's writes also delegate to the bridge).
    openVariant: function (key) { var rec = buildVariantRecord(key); if (rec) ensureMaker(function () { MastEntity.openRecord('product-variant-v2', rec, 'read'); }); },
    // Add a variant: pick one of the not-yet-created option combinations. Only
    // valid combos (cartesian of product.options minus existing) are offered, so
    // we can't create a malformed/duplicate variant.
    // Variants & options editor — drill into the standard slide-out (define
    // options + add variants). Drills (stacked, Back→product) when an SO is open;
    // opens a fresh SO from the list. Works for a no-options product too.
    addVariant: function (id) {
      if (!_guardEditP()) return;
      var rec = V2.byId[id]; if (!rec) return;
      var soOpen = !!document.getElementById('mastSlideOutTitle');
      ensureMaker(function () { if (soOpen) MastEntity.drill('product-variants-v2', id); else MastEntity.openRecord('product-variants-v2', rec, 'read'); });
    },
    addOption: function (id) {
      if (!_guardEditP()) return;
      var l = ((document.getElementById('pv2OptLabel') || {}).value || '').trim();
      var c = ((document.getElementById('pv2OptChoice') || {}).value || '').trim();
      if (!l) { MastAdmin.showToast('Enter an option name', true); return; }
      var p = V2.byId[id] || {}; var opts = (Array.isArray(p.options) ? p.options.slice() : []);
      if (opts.some(function (o) { return String(o.label).toLowerCase() === l.toLowerCase(); })) { MastAdmin.showToast('That option already exists', true); return; }
      opts.push({ label: l, choices: c ? [c] : [] });
      _saveOptions(id, opts);
    },
    addChoice: function (id, i) {
      if (!_guardEditP()) return;
      var el = document.getElementById('pv2OptChoice_' + i); var c = el ? el.value.trim() : '';
      if (!c) return;
      var p = V2.byId[id] || {};
      var opts = (p.options || []).map(function (o, idx) { if (idx !== i) return o; var ch = (o.choices || []).slice(); if (ch.indexOf(c) < 0) ch.push(c); return Object.assign({}, o, { choices: ch }); });
      _saveOptions(id, opts);
    },
    removeOption: function (id, i) {
      if (!_guardEditP()) return;
      var p = V2.byId[id] || {}; var opts = (p.options || []).filter(function (o, idx) { return idx !== i; });
      _saveOptions(id, opts);
    },
    confirmAddVariant: function (id, sig) {
      if (!_guardEditP()) return;
      var p = V2.byId[id]; if (!p) return;
      var combo = missingCombos(p).filter(function (c) { return comboSig(c) === sig; })[0];
      if (!combo) { MastAdmin.showToast('That combination is no longer available', true); return; }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.addVariant(id, combo)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[id]; if (rec) rec.variants = res.variants;
          MastAdmin.showToast('Added: ' + comboLabel(combo));
          rerenderVariantsEditor(id); // stay in the editor so you can add more
          markListDirty();
        }, function (e) { console.error('[products-v2] addVariant', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // Quick-add an attribute from a preset (Step 1). Pre-fills name + starter
    // choices; reuses _saveOptions so the reconciliation guard fires for free.
    quickAddAttr: function (id, label) {
      if (!_guardEditP()) return;
      var preset = VARIANT_PRESETS.filter(function (pr) { return pr.label === label; })[0];
      if (!preset) return;
      var p = V2.byId[id] || {};
      var opts = Array.isArray(p.options) ? p.options.slice() : [];
      if (opts.some(function (o) { return String(o.label).toLowerCase() === String(label).toLowerCase(); })) { MastAdmin.showToast('“' + label + '” is already added', true); return; }
      opts.push({ label: preset.label, choices: preset.choices.slice() });
      _saveOptions(id, opts);
    },
    // Reveal the manual name/first-choice inputs ("Custom…") and focus the name.
    veCustom: function (id) {
      _veState().custom[id] = true;
      rerenderVariantsEditor(id);
      setTimeout(function () { var el = document.getElementById('pv2OptLabel'); if (el) el.focus(); }, 0);
    },
    // Jump the editor between Step 1 and Step 2 (ephemeral local state). Step 2 is
    // gated: refuse without ≥1 attribute carrying a choice.
    veStep: function (id, n) {
      n = Number(n) === 2 ? 2 : 1;
      if (n === 2) {
        var p = V2.byId[id];
        var ok = p && (p.options || []).filter(function (o) { return o.label && o.choices && o.choices.length; }).length;
        if (!ok) { MastAdmin.showToast('Add an attribute with at least one choice first', true); return; }
      }
      _veState().step[id] = n;
      rerenderVariantsEditor(id);
    },
    // Remove one variant (Step 2 list), keyed by id. Danger-confirm names it, since
    // any per-variant price/stock/image overrides on it are lost with it.
    removeVariantConfirm: function (id, vid) {
      if (!_guardEditP()) return;
      var p = V2.byId[id]; if (!p) return;
      var v = realVariants(p).filter(function (x) { return x.id === vid; })[0];
      var label = v ? comboLabel(v.combo) : 'this variant';
      if (typeof window.mastConfirm !== 'function') return;
      Promise.resolve(window.mastConfirm('Remove the variant “' + label + '”? Any price, stock, or image overrides set on it are lost.', { title: 'Remove variant?', confirmLabel: 'Remove', danger: true })).then(function (ok) {
        if (!ok) return;
        withProductBridge(function () {
          Promise.resolve(window.MakerProductBridge.removeVariant(id, vid)).then(function (res) {
            if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
            var rec = V2.byId[id]; if (rec) rec.variants = res.variants;
            MastAdmin.showToast('Removed: ' + label);
            rerenderVariantsEditor(id); markListDirty();
          }, function (e) { console.error('[products-v2] removeVariant', e); MastAdmin.showToast('Failed', true); });
        });
      });
    },
    // Add every missing combination in one batched write. Cap+confirm above a
    // threshold so a big Cartesian matrix isn't generated silently.
    addAllVariants: function (id) {
      if (!_guardEditP()) return;
      var p = V2.byId[id]; if (!p) return;
      var missing = missingCombos(p);
      if (!missing.length) { MastAdmin.showToast('Every combination already exists'); return; }
      var CAP = 24;
      function go() {
        withProductBridge(function () {
          Promise.resolve(window.MakerProductBridge.addVariants(id, missing)).then(function (res) {
            if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
            var rec = V2.byId[id]; if (rec) rec.variants = res.variants;
            var n = res.addedCount || missing.length;
            MastAdmin.showToast('Added ' + MastFormat.countNoun(n, 'variant'));
            rerenderVariantsEditor(id); markListDirty();
          }, function (e) { console.error('[products-v2] addVariants', e); MastAdmin.showToast('Failed', true); });
        });
      }
      if (missing.length > CAP && typeof window.mastConfirm === 'function') {
        Promise.resolve(window.mastConfirm('This creates ' + missing.length + ' variants at once. You can remove any you don’t sell afterward. Continue?', { title: 'Add ' + missing.length + ' variants?', confirmLabel: 'Add all' })).then(function (ok) { if (ok) go(); });
      } else { go(); }
    },
    editVariantTodo: function () { MastAdmin.showToast('Per-variant override editing lands in P4.'); },
    // Bind a variant to product.images[idx] (idx<0 → clear, use product default).
    setVariantImage: function (pid, variantId, idx) {
      if (!_guardEditP()) return;
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
    // Variant price override + SKU (replaces the old editVariantTodo stub).
    editVariantPricing: function (pid, vid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editVarPricing = pid + '::' + vid; rerenderVariantPricingPane(pid, vid); },
    cancelVariantPricing: function (pid, vid) { V2.editVarPricing = null; rerenderVariantPricingPane(pid, vid); },
    saveVariantPricing: function (pid, vid, useDefault) {
      var patch;
      if (useDefault) {
        patch = { priceCents: null };
      } else {
        var pe = document.getElementById('pv2VarPrice'), we = document.getElementById('pv2VarWholesale'), se = document.getElementById('pv2VarSku');
        var ps = pe ? pe.value.trim() : '', priceCents = null;
        if (ps !== '') { var n = Number(ps); if (!isFinite(n) || n < 0) { MastAdmin.showToast('Enter a valid price', true); return; } priceCents = Math.round(n * 100); }
        var ws = we ? we.value.trim() : '', wholesaleCents = null;
        if (ws !== '') { var wn = Number(ws); if (!isFinite(wn) || wn < 0) { MastAdmin.showToast('Enter a valid wholesale price', true); return; } wholesaleCents = Math.round(wn * 100); }
        var sku = se ? se.value.trim() : '';
        patch = { priceCents: priceCents, wholesalePriceCents: wholesaleCents, sku: sku === '' ? null : sku };
      }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setVariantFields(pid, vid, patch)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec) rec.variants = res.variants;
          V2.editVarPricing = null;
          // Re-open the variant SO — lands on v-pricing (its default tab) and
          // refreshes the Price hero tile + pane together.
          var vr = buildVariantRecord(pid + '::' + vid);
          if (vr) MastEntity.openRecord('product-variant-v2', vr, 'read', true);
          MastAdmin.showToast(useDefault ? 'Using Default price' : 'Variant pricing saved');
        }, function (e) { console.error('[products-v2] saveVariantPricing', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── Variant Info (custom name; first-class variant identity) ──────
    editVariantInfo: function (pid, vid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editVarInfo = pid + '::' + vid; rerenderVariantInfoPane(pid, vid); },
    cancelVariantInfo: function (pid, vid) { V2.editVarInfo = null; rerenderVariantInfoPane(pid, vid); },
    saveVariantInfo: function (pid, vid) {
      var ne = document.getElementById('pv2VarName');
      var name = ne ? ne.value.trim() : '';
      var prevRec = buildVariantRecord(pid + '::' + vid);
      var prevLabel = prevRec ? variantLabel(prevRec.variant) : '';
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setVariantFields(pid, vid, { name: name === '' ? null : name })).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec) rec.variants = res.variants;
          V2.editVarInfo = null;
          rerenderVariantInfoPane(pid, vid);
          // The name drives the variant label everywhere — refresh the header strip
          // + SO title in place (re-rendering the whole SO would bounce to Pricing).
          var nr = buildVariantRecord(pid + '::' + vid);
          if (nr) {
            var newLabel = variantLabel(nr.variant);
            var hs = document.getElementById('pv2HeaderStrip');
            if (hs) hs.outerHTML = headerStrip(nr.product, variantImageSrc(nr.product, nr.variant), (nr.product.name || 'Variant') + ' — ' + newLabel, nr.variant.id);
            var tEl = document.getElementById('mastSlideOutTitle');
            if (tEl && prevLabel && tEl.textContent.indexOf(' — ' + prevLabel) >= 0) tEl.textContent = tEl.textContent.replace(' — ' + prevLabel, ' — ' + newLabel);
          }
          MastAdmin.showToast('Saved');
        }, function (e) { console.error('[products-v2] saveVariantInfo', e); MastAdmin.showToast('Save failed', true); });
      });
    },
    // ── Inventory (on-hand; separate collection + stockInfo resync) ────
    editInventory: function (pid) { if (!canEditStock()) { MastAdmin.showToast('You don’t have permission to edit stock', true); return; } V2.editInv = pid; rerenderInventoryPane(pid); },
    cancelInventory: function (pid) { V2.editInv = null; rerenderInventoryPane(pid); },
    saveInventory: function (pid) {
      var counts = readStockCounts('pv2Inv_');
      var bad = Object.keys(counts).some(function (k) { return !isFinite(counts[k]) || counts[k] < 0; });
      if (bad) { MastAdmin.showToast('Enter valid counts (0 or more)', true); return; }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setStockCounts(pid, '_default', counts)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec && res.stockInfo) rec.stockInfo = res.stockInfo;
          V2.editInv = null; rerenderInventoryPane(pid); refreshProductSummary(pid); markListDirty();
          MastAdmin.showToast('Stock updated');
        }, function (e) { console.error('[products-v2] saveInventory', e); MastAdmin.showToast('Failed', true); });
      });
    },
    editVariantInventory: function (pid, vid) { if (!canEditStock()) { MastAdmin.showToast('You don’t have permission to edit stock', true); return; } V2.editVarInv = pid + '::' + vid; rerenderVariantInventoryPane(pid, vid); },
    cancelVariantInventory: function (pid, vid) { V2.editVarInv = null; rerenderVariantInventoryPane(pid, vid); },
    saveVariantInventory: function (pid, vid) {
      var counts = readStockCounts('pv2VarInv_');
      var bad = Object.keys(counts).some(function (k) { return !isFinite(counts[k]) || counts[k] < 0; });
      if (bad) { MastAdmin.showToast('Enter valid counts (0 or more)', true); return; }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setStockCounts(pid, vid, counts)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec && res.stockInfo) rec.stockInfo = res.stockInfo;
          V2.editVarInv = null; rerenderVariantInventoryPane(pid, vid); refreshProductSummary(pid);
          MastAdmin.showToast('Variant stock updated');
        }, function (e) { console.error('[products-v2] saveVariantInventory', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── Variant Fulfillment override (mode / lead / fulfill days; null = inherit) ──
    editVariantFulfillment: function (pid, vid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editVarFulfill = pid + '::' + vid; rerenderVariantFulfillmentPane(pid, vid); },
    cancelVariantFulfillment: function (pid, vid) { V2.editVarFulfill = null; rerenderVariantFulfillmentPane(pid, vid); },
    saveVariantFulfillment: function (pid, vid) {
      if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; }
      var modeEl = document.getElementById('pv2VarFulMode');
      var leadEl = document.getElementById('pv2VarFulLead');
      var fulfillEl = document.getElementById('pv2VarFulFulfill');
      // '' value = clear the override (inherit). null in the patch → bridge removes the field.
      function numOrClear(el) { if (!el) return null; var s = el.value.trim(); if (s === '') return null; var n = Number(s); if (!isFinite(n) || n < 0) return undefined; return Math.round(n); }
      var lead = numOrClear(leadEl), fulfill = numOrClear(fulfillEl);
      if (lead === undefined) { MastAdmin.showToast('Enter a valid lead time (0 or more), or blank to inherit', true); return; }
      if (fulfill === undefined) { MastAdmin.showToast('Enter a valid fulfillment time (0 or more), or blank to inherit', true); return; }
      var patch = {
        inventoryModeOverride: (modeEl && modeEl.value) ? modeEl.value : null,
        productionLeadTimeDaysOverride: lead,
        stockFulfillmentDaysOverride: fulfill
      };
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setVariantInventoryConfig(pid, vid, patch)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec && res.stockInfo) rec.stockInfo = res.stockInfo;
          V2.editVarFulfill = null; rerenderVariantFulfillmentPane(pid, vid);
          MastAdmin.showToast('Variant fulfillment updated');
        }, function (e) { console.error('[products-v2] saveVariantFulfillment', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── Pricing tab edit (direct price; revision-aware via setFields) ──
    editPricing: function (pid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editPricing = pid; rerenderPricingPane(pid); },
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
          V2.editPricing = null; rerenderPricingPane(pid); refreshProductSummary(pid); markListDirty();
          MastAdmin.showToast(res.staged ? 'Staged ' + MastFormat.countNoun(res.changed, 'change') + ' (Apply to go live)' : 'Saved');
        }, function (e) { console.error('[products-v2] savePricing', e); MastAdmin.showToast('Save failed', true); });
      });
    },
    // Live below-cost check while editing the retail price — toggles the inline
    // warning (negative margin vs the recipe unit cost). Display only; Save is
    // never blocked (operators may deliberately price below cost).
    checkBelowCost: function (pid) {
      var warnEl = document.getElementById('pv2BelowCost'); if (!warnEl) return;
      var rec = V2.byId[pid] || {};
      var rc = rec.recipeId ? _recipeCache[rec.recipeId] : null;
      var inp = document.getElementById('pv2PriceRetail');
      warnEl.innerHTML = rc ? belowCostWarningHtml(inp ? inp.value : '', rc) : '';
    },
    // Apply recipe pricing — writes the recipe's ACTIVE-tier price to the
    // product's customer-facing price, REUSING the existing product-price write
    // (MakerProductBridge.setFields — the same revision-aware path Save uses, so
    // it stages on Active products and syncs Etsy). No new pricing mechanism and
    // no recost/publish: the source of truth for the value is the recipe tier.
    applyRecipePrice: function (pid) {
      if (!_guardEditP()) return;
      var rec = V2.byId[pid] || {};
      var recipeId = rec.recipeId;
      if (!recipeId) { MastAdmin.showToast('No recipe linked to price from', true); return; }
      var rc = _recipeCache[recipeId];
      if (!rc) { MastAdmin.showToast('Recipe not loaded yet — try again in a moment', true); loadRecipeThenRerender(recipeId, pid); return; }
      var tier = (['wholesale', 'direct', 'retail'].indexOf(rc.activePriceTier) >= 0) ? rc.activePriceTier : 'direct';
      var tierPrice = Number(rc[tier + 'Price']) || 0;
      if (!(tierPrice > 0)) { MastAdmin.showToast('Recipe has no ' + tier + ' price set — set markups on the Recipe tab', true); return; }
      var newCents = Math.round(tierPrice * 100);
      var curCents = (typeof rec.priceCents === 'number') ? rec.priceCents : (typeof rec.price === 'number' ? Math.round(rec.price * 100) : null);
      if (newCents === curCents) { MastAdmin.showToast('Already at the recipe ' + tier + ' price'); return; }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setFields(pid, { priceCents: newCents })).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Apply failed: ' + ((res && res.error) || 'unknown'), true); return; }
          if (!res.staged) Object.assign(rec, { priceCents: newCents });
          rerenderPricingPane(pid); markListDirty();
          MastAdmin.showToast(res.staged ? 'Staged recipe ' + tier + ' price (Apply to go live)' : 'Applied recipe ' + tier + ' price');
        }, function (e) { console.error('[products-v2] applyRecipePrice', e); MastAdmin.showToast('Apply failed', true); });
      });
    },
    // ── Recipe tab (link/create; editing is the v2 recipe SO — R5) ─────
    recipeCreate: function (pid) {
      if (!_guardEditP()) return;
      withProductBridge(function () {
        var rec = V2.byId[pid] || {};
        MastAdmin.showToast('Creating recipe…');
        Promise.resolve(window.MakerProductBridge.createRecipeForProduct(pid, rec.name || 'Recipe')).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          if (rec) rec.recipeId = res.recipeId;
          rerenderRecipePane(pid);
          MastEntity.drill('recipe-v2', res.recipeId); // open the v2 recipe editor to fill it in
        }, function (e) { console.error('[products-v2] recipeCreate', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── R2: editable BOM in the recipe-v2 drill ──
    recipeSetLineQty: function (liId, value) { _applyRecipeLine(liId, { quantity: value }); },
    recipeSetLineWaste: function (liId, value) { _applyRecipeLine(liId, { scrapPercent: value }); },
    recipeRemoveLine: function (liId) {
      if (!canEditProduct()) return;
      var rid = V2._recipeEdit && V2._recipeEdit.recipeId; if (!rid) return;
      var vkey = V2._recipeVariantKey;
      ensureMaker(function () {
        var B = window.MakerProductBridge;
        var p = vkey ? B.recipeVariantRemoveLineItem(rid, vkey, liId) : B.recipeRemoveLineItem(rid, liId);
        Promise.resolve(p).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          V2._recipeEdit.rc = res.recipe; rerenderRecipeBody(); MastAdmin.showToast('Removed');
        }, function (e) { console.error('[products-v2] recipeRemoveLine', e); MastAdmin.showToast('Failed', true); });
      });
    },
    recipeAddPart: function () {
      if (!canEditProduct()) return;
      var rid = V2._recipeEdit && V2._recipeEdit.recipeId; if (!rid) return;
      ensureMaker(function () {
        Promise.resolve(window.MakerProductBridge.recipeMaterials(rid)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          V2._recipeAddData = { materials: res.materials || [], recipes: res.recipes || [] };
          V2._rpKind = 'material'; V2._recipeAdding = true; rerenderRecipeBody();
        }, function (e) { console.error('[products-v2] recipeMaterials', e); MastAdmin.showToast('Failed', true); });
      });
    },
    recipeAddPartKind: function (k) { V2._rpKind = (k === 'recipe') ? 'recipe' : 'material'; rerenderRecipeBody(); },
    cancelRecipeAddPart: function () { V2._recipeAdding = false; rerenderRecipeBody(); },
    recipeAddPartConfirm: function () {
      if (!canEditProduct()) return;
      var rid = V2._recipeEdit && V2._recipeEdit.recipeId; if (!rid) return;
      var kind = V2._rpKind === 'recipe' ? 'recipe' : 'material';
      var sel = document.getElementById(kind === 'recipe' ? 'pv2RpRecSel' : 'pv2RpMatSel');
      var matId = sel ? sel.value : '';
      if (!matId) { MastAdmin.showToast(kind === 'recipe' ? 'Pick a sub-assembly' : 'Pick a material', true); return; }
      var qEl = document.getElementById('pv2RpQty'); var q = qEl ? Number(qEl.value) : 1;
      if (!isFinite(q) || q < 0) { MastAdmin.showToast('Enter a valid quantity', true); return; }
      var scEl = document.getElementById('pv2RpScrap'); var sc = (kind === 'material' && scEl) ? Number(scEl.value) || 0 : 0;
      var vkey = V2._recipeVariantKey;
      ensureMaker(function () {
        var B = window.MakerProductBridge;
        var opts = { kind: kind, materialId: matId, quantity: q, scrapPercent: sc };
        var p = vkey ? B.recipeVariantAddLineItem(rid, vkey, opts) : B.recipeAddLineItem(rid, opts);
        Promise.resolve(p).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          V2._recipeAdding = false; V2._recipeEdit.rc = res.recipe; rerenderRecipeBody(); MastAdmin.showToast('Part added');
        }, function (e) { console.error('[products-v2] recipeAddLineItem', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── R4: variant cost-shape (selector + override / inherit) ──
    recipeSelectVariant: function (vid) {
      V2._recipeVariantKey = vid || null;
      V2._recipeAdding = false; V2._recipeEditLabor = false; V2._recipeEditPricing = false;
      rerenderRecipeBody();
    },
    recipeVariantOverride: function () {
      if (!_guardEditP()) return;
      var rid = V2._recipeEdit && V2._recipeEdit.recipeId, vkey = V2._recipeVariantKey; if (!rid || !vkey) return;
      ensureMaker(function () {
        Promise.resolve(window.MakerProductBridge.recipeVariantOverride(rid, vkey)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          V2._recipeEdit.rc = res.recipe; rerenderRecipeBody(); MastAdmin.showToast('Override created');
        }, function (e) { console.error('[products-v2] recipeVariantOverride', e); MastAdmin.showToast('Failed', true); });
      });
    },
    recipeVariantInherit: function () {
      if (!_guardEditP()) return;
      var rid = V2._recipeEdit && V2._recipeEdit.recipeId, vkey = V2._recipeVariantKey; if (!rid || !vkey) return;
      ensureMaker(function () {
        Promise.resolve(window.MakerProductBridge.recipeVariantInherit(rid, vkey)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          V2._recipeEdit.rc = res.recipe; V2._recipeEditLabor = false; rerenderRecipeBody(); MastAdmin.showToast('Reverted to inherit');
        }, function (e) { console.error('[products-v2] recipeVariantInherit', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── R3: Labor & overhead + Pricing & tiers ──
    recipeEditLabor: function () { if (!_guardEditP()) return; V2._recipeEditLabor = true; rerenderRecipeBody(); },
    recipeCancelLabor: function () { V2._recipeEditLabor = false; rerenderRecipeBody(); },
    recipeSaveLabor: function () {
      if (!_guardEditP()) return;
      function val(id) { var el = document.getElementById(id); return el ? el.value : undefined; }
      var vkey = V2._recipeVariantKey;
      if (vkey) {
        // Per-variant: only laborMinutes + otherCost (rate/setup/batch are recipe-level).
        _recipeCommitVariantFields(vkey, { laborMinutes: val('rcLaborMin'), otherCost: val('rcOther') }, function () { V2._recipeEditLabor = false; });
        return;
      }
      _recipeCommitFields({
        laborRatePerHour: val('rcLaborRate'), laborMinutes: val('rcLaborMin'),
        otherCost: val('rcOther'), otherCostNote: val('rcOtherNote'),
        setupCost: val('rcSetup'), batchSize: val('rcBatch')
      }, function () { V2._recipeEditLabor = false; });
    },
    recipeEditPricing: function () { if (!_guardEditP()) return; V2._recipeEditPricing = true; rerenderRecipeBody(); },
    recipeCancelPricing: function () { V2._recipeEditPricing = false; rerenderRecipeBody(); },
    recipeSavePricing: function () {
      if (!_guardEditP()) return;
      function val(id) { var el = document.getElementById(id); return el ? el.value : undefined; }
      _recipeCommitFields({
        wholesaleMarkup: val('rcwholesaleMk'), directMarkup: val('rcdirectMk'), retailMarkup: val('rcretailMk'),
        minMarginPercent: val('rcMinMargin')
      }, function () { V2._recipeEditPricing = false; });
    },
    // Active-tier selector — live, no recalc (it's a display preference).
    recipeSetTier: function (tier) {
      if (!_guardEditP()) return;
      var rid = V2._recipeEdit && V2._recipeEdit.recipeId; if (!rid) return;
      ensureMaker(function () {
        Promise.resolve(window.MakerProductBridge.recipeSetActiveTier(rid, tier)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          V2._recipeEdit.rc = res.recipe; rerenderRecipeBody();
        }, function (e) { console.error('[products-v2] recipeSetTier', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // Variant "Give it its own recipe" → open the builder focused on this variant
    // (creating the product recipe first if needed). Replaces the editVariantTodo stub.
    // R5: open the v2 recipe SO scoped to this variant (override-or-inherit there),
    // creating the product recipe first if there isn't one yet. (Was: legacy builder.)
    variantOwnRecipe: function (pid, vid) {
      if (!_guardEditP()) return;
      withProductBridge(function () {
        var rec = V2.byId[pid] || {};
        if (rec.recipeId) { V2._recipeOpenVariant = vid; MastEntity.drill('recipe-v2', rec.recipeId); return; }
        MastAdmin.showToast('Creating recipe…');
        Promise.resolve(window.MakerProductBridge.createRecipeForProduct(pid, rec.name || 'Recipe')).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          if (rec) rec.recipeId = res.recipeId;
          V2._recipeOpenVariant = vid; MastEntity.drill('recipe-v2', res.recipeId);
        }, function (e) { console.error('[products-v2] variantOwnRecipe', e); MastAdmin.showToast('Failed', true); });
      });
    },
    recipeUnlink: function (pid) {
      if (!_guardEditP()) return;
      function go() {
        withProductBridge(function () {
          Promise.resolve(window.MakerProductBridge.unlinkRecipe(pid)).then(function (res) {
            if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
            var rec = V2.byId[pid]; if (rec) rec.recipeId = null;
            rerenderRecipePane(pid); refreshProductSummary(pid); MastAdmin.showToast('Recipe unlinked');
          }, function (e) { console.error('[products-v2] recipeUnlink', e); MastAdmin.showToast('Failed', true); });
        });
      }
      if (window.mastConfirm) Promise.resolve(window.mastConfirm('Unlink this recipe from the product? The recipe itself isn’t deleted.', { title: 'Unlink recipe', confirmText: 'Unlink' })).then(function (ok) { if (ok) go(); });
      else go();
    },
    // ── Fulfillment (its own tab: stock mode + lead time + availability +
    //    dimensions + weight + 'second') ──
    editFulfillment: function (pid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editFulfill = pid; rerenderFulfillmentPane(pid); },
    cancelFulfillment: function (pid) { V2.editFulfill = null; rerenderFulfillmentPane(pid); },
    saveFulfillment: function (pid) {
      var rec = V2.byId[pid] || {};
      var modeEl = document.getElementById('pv2FulStockMode'), leadEl = document.getElementById('pv2FulLead'), secEl = document.getElementById('pv2FulSecond');
      var availEl = document.getElementById('pv2FulAvailability'), dimsEl = document.getElementById('pv2FulDimensions'), wtEl = document.getElementById('pv2FulWeightOz');
      var stockType = modeEl ? modeEl.value : null;
      var ls = leadEl ? leadEl.value.trim() : '';
      var lead = (ls === '') ? null : Number(ls);
      if (lead !== null && (!isFinite(lead) || lead < 0)) { MastAdmin.showToast('Enter a valid lead time', true); return; }
      var ws = wtEl ? wtEl.value.trim() : '';
      var weightOz = (ws === '') ? null : Number(ws);
      if (weightOz !== null && (!isFinite(weightOz) || weightOz < 0)) { MastAdmin.showToast('Enter a valid weight', true); return; }
      var bsEl = document.getElementById('pv2FulBatchSize');
      var bss = bsEl ? bsEl.value.trim() : '';
      var batchSize = (bss === '') ? null : Math.round(Number(bss));
      if (batchSize !== null && (!isFinite(batchSize) || batchSize < 0)) { MastAdmin.showToast('Enter a valid batch size', true); return; }
      // Build the setFields patch (catalog fields — revision-aware): only changed keys.
      var changed = {};
      var curBatch = (rec.batchSize != null ? rec.batchSize : null);
      if (batchSize !== curBatch) changed.batchSize = batchSize;
      var wantAvail = availEl ? availEl.value : 'available';
      var curAvail = String(rec.availability || '').toLowerCase() === 'discontinued' ? 'discontinued' : 'available';
      if (wantAvail !== curAvail) {
        changed.availability = wantAvail;
        // Mirror legacy: stamp discontinuedAt when discontinuing (date-only).
        if (wantAvail === 'discontinued' && !rec.discontinuedAt) changed.discontinuedAt = new Date().toISOString().split('T')[0];
      }
      var wantDims = dimsEl ? dimsEl.value.trim() : '';
      if (wantDims !== (productDimensions(rec) || '')) {
        changed.makerAttributes = Object.assign({}, rec.makerAttributes || {}, { dimensions: wantDims });
        if (!wantDims) delete changed.makerAttributes.dimensions;
      }
      var curWeight = (rec.weightOz != null ? rec.weightOz : null);
      if (weightOz !== curWeight) changed.weightOz = weightOz;
      var wantSecond = !!(secEl && secEl.checked);
      var isSecond = Array.isArray(rec.categories) && rec.categories.indexOf('seconds') >= 0;
      var newCats = null;
      if (wantSecond !== isSecond) {
        var cats = Array.isArray(rec.categories) ? rec.categories.slice() : [];
        if (wantSecond) { if (cats.indexOf('seconds') < 0) cats.push('seconds'); }
        else { cats = cats.filter(function (c) { return c !== 'seconds'; }); }
        changed.categories = cats; newCats = cats;
      }
      withProductBridge(function () {
        // 1) inventory config (stock mode + lead time) — written live
        Promise.resolve(window.MakerProductBridge.setInventoryConfig(pid, { stockType: stockType, productionLeadTimeDays: lead })).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          if (rec && res.stockInfo) rec.stockInfo = res.stockInfo;
          // Also refresh the Inventory pane: it shows the same Stock mode (read
          // from the shared stockInfo), so a fulfillment save must re-render it or
          // the two tabs visibly disagree until the drawer is reopened.
          function finish(extra) { V2.editFulfill = null; rerenderFulfillmentPane(pid); rerenderInventoryPane(pid); refreshProductSummary(pid); MastAdmin.showToast('Fulfillment updated' + (extra || '')); }
          // 2) catalog fields (availability / dimensions / weight / second) — one
          //    revision-aware setFields call (stages on Active, live otherwise).
          if (Object.keys(changed).length) {
            Promise.resolve(window.MakerProductBridge.setFields(pid, changed)).then(function (r2) {
              if (r2 && r2.ok && !r2.staged) {
                if (changed.availability != null) rec.availability = changed.availability;
                if (changed.discontinuedAt != null) rec.discontinuedAt = changed.discontinuedAt;
                if (changed.makerAttributes != null) rec.makerAttributes = changed.makerAttributes;
                if (changed.weightOz !== undefined) rec.weightOz = changed.weightOz;
                if (changed.batchSize !== undefined) rec.batchSize = changed.batchSize;
                if (newCats) rec.categories = newCats;
              }
              finish(r2 && r2.staged ? ' (catalog edits staged — Apply to go live)' : '');
            }, function () { finish(); });
          } else { finish(); }
        }, function (e) { console.error('[products-v2] saveFulfillment', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── Info tab edit (P4 pilot) ──────────────────────────────────────
    editInfo: function (pid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editInfo = pid; rerenderInfoPane(pid); },
    cancelInfo: function (pid) { V2.editInfo = null; rerenderInfoPane(pid); },
    // ── Attributes (authored tags/materials) ──
    editAttributes: function (pid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editAttrs = pid; rerenderAttributesPane(pid); },
    cancelAttributes: function (pid) { V2.editAttrs = null; rerenderAttributesPane(pid); },
    saveAttributes: function (pid) {
      if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; }
      function parseCsv(id) {
        var el = document.getElementById(id); if (!el) return [];
        var seen = {}, out = [];
        el.value.split(',').forEach(function (s) { var t = s.trim(); if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; out.push(t); } });
        return out;
      }
      var rec = V2.byId[pid] || {};
      var prev = productAttributes(rec);
      // Preserve any existing custom bag; only tags + materials are edited here.
      var authored = Object.assign({}, prev.authored, { tags: parseCsv('pv2AttrTags'), materials: parseCsv('pv2AttrMaterials') });
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setAttributes(pid, authored)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var r = V2.byId[pid]; if (r && res.attributes) r.attributes = res.attributes;
          V2.editAttrs = null; rerenderAttributesPane(pid);
          MastAdmin.showToast('Attributes saved');
        }, function (e) { console.error('[products-v2] saveAttributes', e); MastAdmin.showToast('Failed', true); });
      });
    },
    // ── Variant Attributes (override-or-inherit) ──
    editVariantAttributes: function (pid, vid) { if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; } V2.editVarAttrs = pid + '::' + vid; rerenderVariantAttributesPane(pid, vid); },
    cancelVariantAttributes: function (pid, vid) { V2.editVarAttrs = null; rerenderVariantAttributesPane(pid, vid); },
    saveVariantAttributes: function (pid, vid) {
      if (!canEditProduct()) { MastAdmin.showToast('You don’t have permission to edit products', true); return; }
      function parseCsv(id) {
        var el = document.getElementById(id); if (!el) return [];
        var seen = {}, out = [];
        el.value.split(',').forEach(function (s) { var t = s.trim(); if (t && !seen[t.toLowerCase()]) { seen[t.toLowerCase()] = 1; out.push(t); } });
        return out;
      }
      var rec = V2.byId[pid] || {};
      var v = realVariants(rec).filter(function (x) { return x.id === vid; })[0] || {};
      var existing = (v && v.attributes) || {};
      // Blank field = clear the override (inherit the product's); non-blank = override.
      var authored = Object.assign({}, existing.authored || {});
      var t = parseCsv('pv2VarAttrTags'); if (t.length) authored.tags = t; else delete authored.tags;
      var m = parseCsv('pv2VarAttrMaterials'); if (m.length) authored.materials = m; else delete authored.materials;
      var attributes = Object.assign({}, existing, { authored: authored }); // preserve imported
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setVariantFields(pid, vid, { attributes: attributes })).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var r = V2.byId[pid]; if (r && res.variants) r.variants = res.variants;
          V2.editVarAttrs = null; rerenderVariantAttributesPane(pid, vid);
          MastAdmin.showToast('Variant attributes saved');
        }, function (e) { console.error('[products-v2] saveVariantAttributes', e); MastAdmin.showToast('Failed', true); });
      });
    },
    saveInfo: function (pid) {
      function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ''; }
      var rec = V2.byId[pid] || {};
      var prevName = rec.name || '';
      var patch = {
        name: val('pv2InfoName'),
        category: val('pv2InfoCategory'),
        businessLine: val('pv2InfoBizLine'),
        slug: val('pv2InfoSlug'),
        sku: val('pv2InfoSku'),
        shortDescription: val('pv2InfoShortDesc'),
        description: val('pv2InfoDescription')
      };
      // Only send fields that actually changed (cheaper writes, smaller revisions).
      var changed = {};
      if (patch.name !== (rec.name || '')) changed.name = patch.name;
      if (patch.category !== (categoryLabel(rec) || '')) changed.category = patch.category;
      if (patch.businessLine !== (rec.businessLine || '')) changed.businessLine = patch.businessLine;
      if (patch.slug !== (rec.slug || '')) changed.slug = patch.slug;
      if (patch.sku !== (rec.sku || '')) changed.sku = patch.sku;
      if (patch.shortDescription !== (rec.shortDescription || '')) changed.shortDescription = patch.shortDescription;
      if (patch.description !== (rec.description || '')) changed.description = patch.description;
      if (!Object.keys(changed).length) { V2.editInfo = null; rerenderInfoPane(pid); MastAdmin.showToast('No changes'); return; }
      withProductBridge(function () {
        Promise.resolve(window.MakerProductBridge.setFields(pid, changed)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Save failed: ' + ((res && res.error) || 'unknown'), true); return; }
          // Mirror the live cache so the read pane shows the edit immediately.
          if (!res.staged) Object.assign(rec, changed);
          V2.editInfo = null;
          rerenderInfoPane(pid); refreshProductSummary(pid); if (!res.staged) markListDirty();
          // A live name edit also changes the SO title bar ("Product: <name>").
          // The header strip is image-only, so refresh the title element directly
          // (swap the old name in place — robust to the "Product: " label prefix).
          if (!res.staged && changed.name != null) {
            var tEl = document.getElementById('mastSlideOutTitle');
            if (tEl && prevName && tEl.textContent.indexOf(prevName) >= 0) {
              tEl.textContent = tEl.textContent.replace(prevName, changed.name);
            }
          }
          MastAdmin.showToast(res.staged ? 'Staged ' + MastFormat.countNoun(res.changed, 'change') + ' (Apply to go live)' : 'Saved');
        }, function (e) { console.error('[products-v2] saveInfo', e); MastAdmin.showToast('Save failed', true); });
      });
    },
    // ── Image tab edit (P4) ───────────────────────────────────────────
    uploadImage: function (pid, inputEl) {
      if (!_guardEditP()) { if (inputEl) inputEl.value = ''; return; }
      var file = inputEl && inputEl.files && inputEl.files[0];
      if (inputEl) inputEl.value = ''; // allow re-selecting the same file later
      if (!file) return;
      withProductBridge(function () {
        MastAdmin.showToast('Uploading image…');
        Promise.resolve(window.MakerProductBridge.addImage(pid, file)).then(function (res) {
          if (!res || !res.ok) { MastAdmin.showToast('Upload failed: ' + ((res && res.error) || 'unknown'), true); return; }
          var rec = V2.byId[pid]; if (rec) { rec.images = res.images; rec.imageIds = res.imageIds; }
          rerenderImagePane(pid); rerenderHeaderStrip(pid); refreshProductSummary(pid); markListDirty();
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
      if (!_guardEditP()) { if (inputEl) inputEl.value = ''; return; }
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
      if (!_guardEditP()) return;
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
      if (!_guardEditP()) return;
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

  // ── Ask AI: hydrate the open product record ──────────────────────────────────
  // When the ✨ Ask AI button fires on a product slide-out, send the structured
  // product record — not scraped DOM — plus its inventory, recipe and recent
  // sales, wrapped in a `scope` block that declares exactly what was captured.
  // The scope is what lets Claude tell "this product has no price" apart from
  // "price wasn't included", and decline cleanly on out-of-scope questions
  // (competitor / external-market pricing). See MastAskAi.registerEntity.
  if (window.MastAskAi && window.MastAskAi.registerEntity) {
    function _num(x) { return (typeof x === 'number' && !isNaN(x)) ? x : null; }
    function _money2(x) { return x == null ? null : +(+x).toFixed(2); }

    function buildProductContext(p) {
      if (!p) return {};
      var pid = p._key || p.pid;
      var rec = (V2.byId && V2.byId[pid]) || p;
      var attrs = productAttributes(rec);
      var si = rec.stockInfo || {};
      var priceUSD = _money2(price(rec));                 // base retail (dollars)
      var hasRecipe = !!rec.recipeId;
      var rc = hasRecipe ? _recipeCache[rec.recipeId] : null;
      var costUSD = rc ? _money2(rc.totalCost) : null;     // recipe unit cost (dollars)
      var marginPct = (priceUSD != null && costUSD != null && priceUSD > 0)
        ? +(((priceUSD - costUSD) / priceUSD) * 100).toFixed(1) : null;

      // Variants: id + label + price + own-SKU flag — identifiers, not heavy data.
      var variants = realVariants(rec).map(function (v) {
        return { id: v.id, label: variantLabel(v), priceUSD: _money2(variantPrice(rec, v)),
          overridden: variantOverridden(rec, v), sku: v.sku || null };
      });

      // Bound channels (where this product sells) — names if the channel cache
      // warmed, else bare ids. Lean: just where it sells, not listing payloads.
      var chById = V2._channelsCache || {};
      var channels = productBindings(rec).map(function (b) {
        var c = chById[b.channelId] || {};
        return c.name || c.displayName || c.platform || b.channelId;
      });

      var sections = ['product', 'inventory'];
      var product = {
        id: pid,
        title: rec.name || rec._title || null,
        sku: rec.sku || null,
        status: String(rec.status || 'draft').toLowerCase(),
        statusLabel: statusLabel(rec.status),
        mode: rec.mode || null,
        price: priceUSD == null ? null : { amount: priceUSD, currency: 'USD' },
        wholesalePrice: (_num(rec.wholesalePriceCents) && rec.wholesalePriceCents > 0)
          ? { amount: _money2(rec.wholesalePriceCents / 100), currency: 'USD' } : null,
        cost: costUSD == null ? null : { amount: costUSD, currency: 'USD', source: 'recipe' },
        marginPct: marginPct,
        category: categoryLabel(rec) || null,
        tags: Array.isArray(attrs.tags) ? attrs.tags : [],
        materials: Array.isArray(attrs.materials) ? attrs.materials : [],
        channels: channels,
        variantCount: variantCount(rec),
        variants: variants,
        imageCount: Array.isArray(rec.images) ? rec.images.length : 0,
        createdAt: rec.createdAt || null,
        updatedAt: rec.updatedAt || null
      };

      var inventory = {
        stockType: si.stockType || null,
        tracked: !!(si.stockType && !/order|build/.test(si.stockType)),
        onHand: _num(si.totalOnHand),
        committed: _num(si.totalCommitted),
        available: _num(si.totalAvailable),
        lowStockThreshold: _num(si.lowStockThreshold),
        fulfillmentDays: _num(si.stockFulfillmentDays),
        moq: _num(rec.moq),
        casePack: _num(rec.casePack),
        perVariant: variantCount(rec) > 0
      };

      var ctx = { page: { title: product.title || 'Product', route: 'products-v2', viewing: 'product-detail' },
        product: product, inventory: inventory };

      // recipe — only declared captured when we actually have the recipe loaded;
      // hasRecipe is always meaningful (from the product), but materials/cost are
      // only present once the recipe doc resolved (prepare() warms it).
      if (rc) {
        var mats = rc.lineItems && typeof rc.lineItems === 'object'
          ? Object.keys(rc.lineItems).map(function (k) { var li = rc.lineItems[k] || {}; return li.name || li.materialName || k; })
          : [];
        ctx.recipe = { hasRecipe: true, name: rc.name || null, status: rc.status || null,
          materialCount: mats.length, materials: mats.slice(0, 40), computedUnitCost: costUSD };
        sections.push('recipe');
      } else {
        ctx.recipe = { hasRecipe: hasRecipe, note: hasRecipe ? 'recipe not loaded in this capture' : 'no recipe linked' };
        if (!hasRecipe) sections.push('recipe'); // "no recipe" IS a captured fact
      }

      // salesPerformance — from the shared product sales map (last 500 orders).
      var s = (window._mastProductSalesMap && window._mastProductSalesMap[pid]) || null;
      if (s) {
        ctx.salesPerformance = {
          window: 'last_500_orders',
          last30: { unitsSold: s.last30 || 0, revenue: _money2((s.revenue30 || 0) / 100) },
          last90: { unitsSold: s.last90 || 0, revenue: _money2((s.revenue90 || 0) / 100) },
          allTime: { unitsSold: s.allTime || 0, revenue: _money2((s.revenueAll || 0) / 100) },
          lastSoldAt: s.lastOrdered ? String(s.lastOrdered).slice(0, 10) : null
        };
        sections.push('salesPerformance');
      }

      ctx.scope = {
        describes: 'a single product record (plus its inventory, recipe and recent sales) for this tenant',
        sectionsIncluded: sections,
        // Not captured here — answer these from your own knowledge / web research,
        // clearly labeled as external context (e.g. "for comparable handmade
        // pieces, market price is typically …"), never as this tenant's own data.
        notInThisPayload: ['external market / competitor pricing', 'industry benchmarks or trends', 'channel listing IDs / live sync status', 'orders beyond the salesPerformance summary'],
        neverInfer: ['other tenants’ products']
      };
      return ctx;
    }

    window.MastAskAi.registerEntity('products-v2', {
      title: 'Ask AI about this product',
      placeholder: 'e.g. What is the margin? Is this priced right? Which variant sells best? What is sitting in stock?',
      notes: [
        'Money is in dollars. marginPct = (price − cost) / price, where cost is the recipe unit cost (null if no recipe/cost coverage).',
        'If scope.sectionsIncluded lists a section, an empty/zero value there is real (genuinely empty), not omitted.',
        'salesPerformance is drawn from the last 500 orders for THIS product only.'
      ],
      // Warm the recipe + sales caches (and channel names) before capture so a
      // cold Ask AI still includes cost/margin and recent sales. Best-effort.
      prepare: function (p) {
        var pid = p && (p._key || p.pid);
        var jobs = [];
        if (window._ensureProductSalesMap && !window._mastProductSalesMap) {
          jobs.push(Promise.resolve(window._ensureProductSalesMap()).catch(function () {}));
        }
        if (p && p.recipeId && !_recipeCache[p.recipeId]) {
          jobs.push(Promise.resolve(MastDB.recipes.get(p.recipeId))
            .then(function (rc) { if (rc) _recipeCache[p.recipeId] = rc; }).catch(function () {}));
        }
        if (!V2._channelsCache) {
          jobs.push(new Promise(function (resolve) {
            try { ensureChannels(pid, resolve); setTimeout(resolve, 1500); } catch (e) { resolve(); }
          }));
        }
        return Promise.all(jobs);
      },
      buildContext: buildProductContext
    });
  }
})();
