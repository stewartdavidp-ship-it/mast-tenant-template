/**
 * Product & inventory render engine (Track 1 coupled-cluster tier, recipe B).
 *
 * Extracted VERBATIM from app/index.html's inline block: the four large
 * SIDE-EFFECTING route/view renderers
 *   - renderProducts()            (the #products catalog list + filter pills)
 *   - renderInventoryOverview()   (the #inventory overview table)
 *   - switchProductTab(tab)       (product-detail tab switch + inventory-history load)
 *   - renderProductDetail(pid)    (the full product-detail page)
 * Each is fronted by a tiny eager shim in index.html (loadModule('productsEngine')
 * then call window.<name>Impl), so every existing eager/onclick/lazy-module
 * reference to the bare name keeps resolving (shim is always defined).
 *
 * Deliberately NOT moved (they stay eager in the shell because they are
 * value-returning helpers consumed SYNCHRONOUSLY by eager code AND by already-
 * lazy sibling modules — a shim cannot synchronously return an async-loaded
 * value): buildVariantTable, getInventoryTotals, getProductVariantCombos,
 * comboKey, getProductDisplayPriceCents/getProductVariantsForRender, the
 * variant* cost/label helpers, the drift severity helpers
 * (phase4SeverityVisual/getFieldSeverity/maxSeverity), getProductChannelBindings,
 * the readiness/lifecycle helpers (_evaluateProductReadiness /
 * _renderProductLifecycleStepper / _renderProductStagePanel), and the pd* form
 * helpers. The four renderers read all of those as eager window globals.
 *
 * Reads eager shell globals (all defined before a user can reach these views):
 * productsData, inventory, selectedProductPid, inlineAdjustPid, productEditTab,
 * gallery, MastDB, esc, navigateTo, showToast, openModal/closeModal, and the
 * helper functions listed above. All are top-level `var`/`function` decls in the
 * shell (proven window-reachable — same pattern as the other extracted modules).
 *
 * Lazy-loaded via the eager renderProducts / renderInventoryOverview /
 * switchProductTab / renderProductDetail shims in index.html.
 */
(function () {
  'use strict';


  // ---- renderProducts (verbatim from index.html) ----
function renderProducts() {
  // If a product detail is currently open, skip the entire list re-render —
  // it has no visible target (grid is hidden) and re-revealing the unnamed
  // notice / inventory summary bar leaks list chrome onto the detail page.
  var _detailEl = document.getElementById('productDetailView');
  if (_detailEl && _detailEl.style.display !== 'none' && selectedProductPid) {
    return;
  }
  var cat = document.getElementById('productsCategory').value;
  // Unified product filter: 'develop' | 'catalog' | 'sell'. Sidebar entry
  // presets it; user can flip pills without leaving the section.
  if (!window.productsStatusFilter) {
    window.productsStatusFilter = 'catalog';
  }
  var statusFilter = window.productsStatusFilter;

  // W1.2: eagerly kick off the shared sales-map load on first paint so
  // the demand chips (No demand 90d / Trending up) become discoverable
  // even on tenants with no stock alerts. Subsequent renders are a no-op
  // because the map is cached.
  if (!window._mastProductSalesMap && !window._mastProductSalesMapLoading) {
    window._mastProductSalesMapLoading = true;
    _ensureProductSalesMap(function() {
      window._mastProductSalesMapLoading = false;
      renderProducts();
    });
  }

  // URL-driven filters from MCP admin links: status, category, dateFrom,
  // dateTo, productIds (#products?...). When any URL filter is present it
  // overrides pill state for this render — the orange banner surfaces it
  // and Clear restores pill-driven view.
  var routeParams = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var urlStatus = routeParams && typeof routeParams.status === 'string' ? routeParams.status : '';
  var urlCategory = routeParams && typeof routeParams.category === 'string' ? routeParams.category : '';
  var urlDateFrom = routeParams && typeof routeParams.dateFrom === 'string' ? routeParams.dateFrom.slice(0, 10) : '';
  var urlDateTo = routeParams && typeof routeParams.dateTo === 'string' ? routeParams.dateTo.slice(0, 10) : '';
  var urlIdsParam = routeParams && typeof routeParams.productIds === 'string' ? routeParams.productIds : '';
  var urlIdSet = urlIdsParam
    ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
    : [];
  var urlIdLookup = urlIdSet.length > 0 ? Object.create(null) : null;
  if (urlIdLookup) urlIdSet.forEach(function(id) { urlIdLookup[id] = true; });
  var hasUrlFilter = !!(urlStatus || urlCategory || urlDateFrom || urlDateTo || urlIdSet.length);
  if (hasUrlFilter && (urlDateFrom || urlDateTo) && window._productsTenantTz === null) {
    // TZ not yet loaded — first render uses browser TZ; re-render once it resolves.
    ensureProductsTenantTz().then(function() { renderProducts(); });
  }

  function _statusOf(p) { return (p && p.status) || 'draft'; }
  function _isOnAnyChannel(p) {
    if (!p || !p.externalRefs || typeof p.externalRefs !== 'object') return false;
    return Object.keys(p.externalRefs).some(function(k) {
      var e = p.externalRefs[k];
      return e && e.externalId;
    });
  }
  function _matchesFilter(p, filter) {
    var st = _statusOf(p);
    if (filter === 'develop')  return st === 'draft';
    if (filter === 'review')   return st === 'ready';
    if (filter === 'sell')     return st === 'active' && _isOnAnyChannel(p);
    if (filter === 'archived') return st === 'archived';
    // 'catalog' = all non-archived products
    return st !== 'archived';
  }

  // Counts per filter (respect category filter so pill counts are honest)
  var counts = { develop: 0, review: 0, catalog: 0, sell: 0, archived: 0 };
  productsData.forEach(function(p) {
    if (cat !== 'all' && (!p.categories || p.categories.indexOf(cat) === -1)) return;
    var st = _statusOf(p);
    if (st !== 'archived') counts.catalog++;
    if (st === 'draft')  counts.develop++;
    if (st === 'ready')  counts.review++;
    if (st === 'active' && _isOnAnyChannel(p)) counts.sell++;
    if (st === 'archived') counts.archived++;
  });

  // Map legacy filter values onto the new shape so existing entry points keep working.
  if (statusFilter === 'developing') statusFilter = 'develop';
  if (statusFilter === 'active') statusFilter = 'catalog';
  window.productsStatusFilter = statusFilter;

  // Stock filter: 'all' (default) | 'low' | 'out'. Drives the inventory pill
  // bar that replaces the old "N products · X low · Y out of stock" banner.
  if (!window.productsStockFilter) window.productsStockFilter = 'all';
  var stockFilter = window.productsStockFilter;
  function _stockBucket(p) {
    var inv = inventory[p.pid];
    if (!inv) return 'untracked';
    var st = inv.stockType;
    if (st === 'made-to-order' || st === 'build-to-order') return 'untracked';
    var totals = (typeof getInventoryTotals === 'function') ? getInventoryTotals(inv) : null;
    if (!totals) return 'untracked';
    var threshold = inv.lowStockThreshold || 2;
    if (totals.available <= 0) return 'out';
    if (totals.available <= threshold) return 'low';
    return 'in';
  }

  var filtered = productsData.filter(function(p) {
    if (hasUrlFilter) {
      // URL-driven filters from an MCP admin link override pill state.
      if (urlStatus && (p.status || 'draft') !== urlStatus) return false;
      if (urlCategory && (!p.categories || p.categories.indexOf(urlCategory) === -1)) return false;
      if (urlIdLookup && !urlIdLookup[p.pid]) return false;
      if (urlDateFrom || urlDateTo) {
        var d = productsTzDateStr(p.createdAt || '');
        if (!d) return false;
        if (urlDateFrom && d < urlDateFrom) return false;
        if (urlDateTo && d > urlDateTo) return false;
      }
      return true;
    }
    if (!_matchesFilter(p, statusFilter)) return false;
    if (cat !== 'all' && (!p.categories || p.categories.indexOf(cat) === -1)) return false;
    if (stockFilter === 'low' && _stockBucket(p) !== 'low') return false;
    if (stockFilter === 'out' && _stockBucket(p) !== 'out') return false;
    // W1.6: when the "unnamed products" notice is clicked, restrict the list
    // to products with missing/empty `name`. AND-composed with other filters.
    if (window.productsUnnamedOnly === true && (p.name && String(p.name).trim() !== '')) return false;
    // W1.2: demand-based filters. Use the shared productSales map (or
    // skip the row if the map isn't loaded yet — chips render with "?"
    // counts until data arrives, then a re-render fires).
    if (window.productsDemandFilter) {
      var _salesMap = window._mastProductSalesMap;
      if (!_salesMap) return false; // pending load, don't show stale matches
      var _ps = _salesMap[p.pid] || { last30: 0, last90: 0, prior60of30: 0 };
      if (window.productsDemandFilter === 'noDemand90d' && _ps.last90 !== 0) return false;
      if (window.productsDemandFilter === 'trendingUp') {
        // 30d sold > 30d-prior-30d sold (per spec). prior60of30 covers
        // days 31–90, so the comparable prior 30d is prior60of30 / 2.
        var _prior30 = _ps.prior60of30 / 2;
        if (!(_ps.last30 > _prior30 && _ps.last30 > 0)) return false;
      }
    }
    return true;
  });

  // URL-filter banner — surfaces active MCP-link filters with a Clear button.
  // Inserted just above #productsGrid; created lazily so it doesn't appear
  // in the DOM during normal pill-driven use.
  (function renderProductsUrlFilterBanner() {
    var bannerEl = document.getElementById('productsUrlFilterBanner');
    if (!bannerEl && hasUrlFilter) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'productsUrlFilterBanner';
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      var grid = document.getElementById('productsGrid');
      if (grid && grid.parentNode) grid.parentNode.insertBefore(bannerEl, grid);
    }
    if (!bannerEl) return;
    if (hasUrlFilter) {
      var parts = [];
      if (urlIdSet.length) parts.push(MastFormat.countNoun(urlIdSet.length, 'selected product'));
      if (urlStatus) parts.push('status: ' + String(urlStatus).replace(/_/g, ' '));
      if (urlCategory) parts.push('category: ' + urlCategory);
      if (urlDateFrom && urlDateTo) parts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
      else if (urlDateFrom) parts.push('from ' + urlDateFrom + ' onward');
      else if (urlDateTo) parts.push('through ' + urlDateTo);
      bannerEl.innerHTML = '<span>📅 Showing ' + parts.join(', ') + '</span>' +
        '<button type="button" onclick="clearProductsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
      bannerEl.style.display = 'flex';
    } else {
      bannerEl.style.display = 'none';
    }
  })();

  // Total / count
  // productsCount text was the old "N products" header. Now redundant with
  // the All-products pill in the inventory summary bar; clear it.
  var countEl = document.getElementById('productsCount');
  if (countEl) countEl.textContent = '';

  // Filter pills with counts. Each is a real semantic slice:
  //   Catalog  = all non-archived products
  //   Draft    = status draft — products being assembled
  //   Review   = status ready — QC gate before publishing
  //   Active   = active products published on at least one channel
  //   Archived = status archived
  var chipBar = document.getElementById('catalogStatusBar');
  if (chipBar) {
    function pill(value, label, n) {
      var active = statusFilter === value;
      var bg = active ? 'rgba(42,124,111,0.15)' : 'transparent';
      var fg = active ? 'var(--teal,#2a7c6f)' : 'var(--warm-gray,#777)';
      var bd = active ? 'var(--teal,#2a7c6f)' : 'rgba(0,0,0,0.18)';
      return '<button onclick="setProductsStatusFilter(\'' + value + '\')" ' +
        'style="padding:6px 14px;border:1px solid ' + bd + ';border-radius:16px;background:' + bg + ';color:' + fg +
        ';font-size:0.85rem;cursor:pointer;font-weight:600;">' +
        label + ' <span style="opacity:0.7;font-weight:400;">(' + n + ')</span></button>';
    }
    chipBar.innerHTML =
      pill('catalog',  'All Products',    counts.catalog) +
      pill('develop',  'Draft',           counts.develop) +
      pill('review',   'Review',          counts.review) +
      pill('sell',     'Active Products', counts.sell) +
      pill('archived', 'Archived',        counts.archived);
  }

  // W1.6: backstage notice for products with missing/empty `name`. These
  // SKUs leak into "Often Bought Together" lists and the catalog as unhelpful
  // placeholders. One-click filter takes the user to the list of unnamed
  // products so they can fix them.
  (function renderProductsUnnamedNotice() {
    var prior = document.getElementById('productsUnnamedNotice');
    if (prior) prior.remove();
    var unnamed = (productsData || []).filter(function(p) {
      return !p || !p.name || String(p.name).trim() === '';
    });
    var host = document.getElementById('catalogStatusBar');
    if (!host || !host.parentNode) return;
    if (unnamed.length === 0 && window.productsUnnamedOnly !== true) return;
    var notice = document.createElement('div');
    notice.id = 'productsUnnamedNotice';
    notice.style.cssText = 'margin:6px 0 10px 0;padding:8px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.35);border-radius:6px;font-size:0.85rem;color:var(--text-primary);display:flex;justify-content:space-between;align-items:center;gap:12px;';
    if (window.productsUnnamedOnly === true) {
      notice.innerHTML =
        '<span>Showing <strong>' + unnamed.length + '</strong> unnamed product' + (unnamed.length === 1 ? '' : 's') + ' — give each a name to remove placeholders from co-buy lists.</span>' +
        '<button type="button" onclick="window.productsUnnamedOnly=false;renderProducts();" style="background:transparent;border:1px solid var(--warm-gray,#888);color:var(--text,inherit);padding:3px 10px;border-radius:999px;font-size:0.78rem;cursor:pointer;">Show all</button>';
    } else {
      notice.innerHTML =
        '<span><strong>' + unnamed.length + '</strong> unnamed product' + (unnamed.length === 1 ? '' : 's') + ' detected — these are hidden from customer-signal co-buy lists until named.</span>' +
        '<button type="button" onclick="window.productsUnnamedOnly=true;renderProducts();" style="background:transparent;border:1px solid #f59e0b;color:#f59e0b;padding:3px 10px;border-radius:999px;font-size:0.78rem;cursor:pointer;font-weight:600;">Fix names</button>';
    }
    host.parentNode.insertBefore(notice, host.nextSibling);
  })();

  // List layout (replaces card grid). One row per product: thumb + name/category + status + variants + recipe + price.
  rebuildProductCategoryFilter();
  var allRecipes = (typeof window.makerListRecipes === 'function') ? window.makerListRecipes() : {};

  // W1.1: apply active sort (if any) before rendering.
  (function applyProductsSort() {
    var s = window.productsSort;
    if (!s || !s.key) return;
    var ctx = { allRecipes: allRecipes, inventory: inventory };
    var dir = s.dir === 'desc' ? -1 : 1;
    filtered = filtered.slice().sort(function(a, b) {
      var av = _productSortValue(a, s.key, ctx);
      var bv = _productSortValue(b, s.key, ctx);
      var cmp;
      if (typeof av === 'number' && typeof bv === 'number') {
        cmp = av - bv;
      } else {
        cmp = String(av || '').localeCompare(String(bv || ''));
      }
      return dir * cmp;
    });
  })();

  // W1.1: clickable sortable headers with ▲/▼ glyph on the active column.
  var _sortState = window.productsSort || { key: null, dir: 'asc' };
  function _sortHeader(key, label, align) {
    var active = _sortState.key === key;
    var glyph = active ? (_sortState.dir === 'desc' ? ' ▼' : ' ▲') : '';
    var color = active ? 'var(--teal,#2a7c6f)' : 'inherit';
    var style = 'cursor:pointer;user-select:none;color:' + color + ';' + (align ? 'text-align:' + align + ';' : '');
    return '<th style="' + style + '" onclick="setProductsSort(\'' + key + '\')">' + label + glyph + '</th>';
  }
  var html = '<div class="data-table"><table><thead>' +
    '<tr>' +
      '<th style="width:68px;"></th>' +
      _sortHeader('name',      'Product') +
      _sortHeader('status',    'Status') +
      _sortHeader('variants',  'Variants') +
      _sortHeader('recipe',    'Recipe') +
      _sortHeader('price',     'Price',     'right') +
      _sortHeader('cost',      'Cost',      'right') +
      _sortHeader('margin',    'Margin',    'right') +
      _sortHeader('inventory', 'Inventory', 'right') +
    '</tr></thead><tbody>';

  filtered.forEach(function(p) {
    var thumb = firstProductImage(p);
    var variantCount = (p.variants && p.variants.length) ? p.variants.length : 1;
    var recipe = (p.recipeId && allRecipes[p.recipeId] && allRecipes[p.recipeId].status !== 'archived')
      ? allRecipes[p.recipeId] : null;
    var recipeBadge = recipe
      ? '<span style="background:rgba(42,124,111,0.12);color:var(--teal,#2a7c6f);padding:2px 8px;border-radius:10px;font-size:0.78rem;">linked</span>'
      : '<span style="color:var(--warm-gray-light);font-size:0.78rem;">—</span>';

    var priceTxt = '—';
    var _synthDefault = { _isSynthetic: true, id: 'default' };
    var _pricing = variantCostAndPrice(p, _synthDefault, recipe);
    var _activeTier = _pricing.activeTier || (recipe && recipe.activePriceTier) || 'retail';
    var _activePrice = _pricing[_activeTier] != null ? _pricing[_activeTier]
      : (_pricing.retail != null ? _pricing.retail : (_pricing.direct || _pricing.wholesale));
    if (_activePrice != null && _activePrice > 0) priceTxt = '$' + _activePrice.toFixed(2);

    var statusBadge = (typeof window.productStatusBadgeHtml === 'function')
      ? window.productStatusBadgeHtml(p.status)
      : '<span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(p.status || 'draft') + '</span>';

    var inv = inventory[p.pid];
    var totals = getInventoryTotals(inv);
    var stockType = (inv && inv.stockType) ? inv.stockType : 'made-to-order';
    var invTxt;
    if (stockType === 'build-to-order' || stockType === 'made-to-order') {
      invTxt = '<span style="color:var(--warm-gray);font-size:0.78rem;">Build to Order</span>';
    } else if (totals.available <= 0) {
      invTxt = '<span style="color:var(--danger,#dc2626);font-size:0.85rem;font-family:monospace;">0</span>';
    } else {
      invTxt = '<span style="font-size:0.85rem;font-family:monospace;">' + totals.onHand + '</span>';
    }

    var catTxt = (p.categories && p.categories.length) ? p.categories.join(', ') : '';

    // W1-followup: data-attr + delegated listener (see top of file). Same
    // behavior as the prior inline onclick; closes the W1-side esc-into-JS gap.
    // Unnamed-only mode: swap the row into an inline name editor so the user
    // can fix names without bouncing through the detail view.
    var isUnnamedRow = window.productsUnnamedOnly === true && (!p.name || String(p.name).trim() === '');
    html += '<tr ' + (isUnnamedRow ? '' : 'style="cursor:pointer;" data-view-pid="' + esc(p.pid) + '"') + '>';
    html += '<td>' +
      (thumb
        ? '<img src="' + esc(thumb) + '" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:6px;display:block;">'
        : '<div style="width:56px;height:56px;border-radius:6px;background:var(--cream-dark,#e8e0d4);display:flex;align-items:center;justify-content:center;font-size:1.15rem;">📦</div>') +
      '</td>';
    if (isUnnamedRow) {
      html += '<td>' +
        '<div style="display:flex;gap:6px;align-items:center;">' +
          '<input type="text" data-unnamed-name-pid="' + esc(p.pid) + '" placeholder="Name this product…" ' +
            'style="flex:1;padding:6px 10px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;font-size:0.85rem;background:var(--cream);color:var(--text-primary);">' +
          '<button type="button" data-unnamed-save-pid="' + esc(p.pid) + '" class="btn btn-primary btn-small" style="font-size:0.78rem;padding:6px 12px;">Save</button>' +
        '</div>' +
        (catTxt ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">' + esc(catTxt) + '</div>' : '') +
        '</td>';
    } else {
      html += '<td>' +
        '<div style="font-weight:600;color:var(--text,#2a2a2a);">' + esc(p.name || '') + '</div>' +
        (catTxt ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(catTxt) + '</div>' : '') +
        '</td>';
    }
    html += '<td>' + statusBadge + '</td>';
    html += '<td>' + variantCount + '</td>';
    html += '<td>' + recipeBadge + '</td>';
    var costTxt = (_pricing.cost != null && _pricing.cost > 0) ? '$' + _pricing.cost.toFixed(2) : '—';
    var marginTxt = '—';
    if (_activePrice != null && _activePrice > 0 && _pricing.cost != null && _pricing.cost > 0) {
      var _margin = ((_activePrice - _pricing.cost) / _activePrice) * 100;
      var _mc = _margin < 20 ? 'var(--danger,#dc2626)' : (_margin < 40 ? 'var(--amber-light,#b45309)' : 'var(--teal,#2a7c6f)');
      marginTxt = '<span style="color:' + _mc + ';font-weight:600;">' + _margin.toFixed(0) + '%</span>';
    }
    html += '<td style="text-align:right;font-family:monospace;">' + priceTxt + '</td>';
    html += '<td style="text-align:right;font-family:monospace;">' + costTxt + '</td>';
    html += '<td style="text-align:right;">' + marginTxt + '</td>';
    html += '<td style="text-align:right;">' + invTxt + '</td>';
    html += '</tr>';
  });
  html += '</tbody></table></div>';

  // develop/review kept bespoke: two-paragraph layout (a styled second <p>, and
  // develop's contains inline <strong> HTML) the single-hint emptyState engine can't reproduce.
  var emptyHtml = (statusFilter === 'develop')
    ? '<div class="empty-state"><div class="empty-icon">&#128736;&#65039;</div><p>No draft products.</p><p style="font-size:0.85rem;color:var(--warm-gray);">Click <strong>+ New Product</strong> to start one.</p></div>'
    : (statusFilter === 'review')
      ? '<div class="empty-state"><div class="empty-icon">&#128270;</div><p>No products in review.</p><p style="font-size:0.85rem;color:var(--warm-gray);">Promote a draft product when it\'s ready for QC.</p></div>'
      : (statusFilter === 'archived')
        ? MastUI.emptyState({ icon: '📦', hint: 'No archived products.' })
        : MastUI.emptyState({ icon: '🎨', hint: 'No active products.' });
  var _productsGridEl = document.getElementById('productsGrid');
  _productsGridEl.innerHTML = filtered.length ? html : emptyHtml;
  // DK3P6XFS — apply persisted density preference + sync the toggle button label.
  var _denseOn = false;
  try { _denseOn = localStorage.getItem('mast.productsDense') === 'true'; } catch (e) {}
  if (_denseOn) _productsGridEl.classList.add('products-dense');
  else _productsGridEl.classList.remove('products-dense');
  var _denseBtn = document.getElementById('productsDensityToggle');
  if (_denseBtn) {
    _denseBtn.textContent = _denseOn ? '▤ Comfortable' : '▦ Compact';
    _denseBtn.title = _denseOn ? 'Switch to comfortable view (larger thumbnails + category subtitles)' : 'Switch to compact view (smaller thumbnails, more rows per screen)';
  }

  // Inventory pill bar — replaces the old "N products · low · out of stock"
  // banner. Pills filter the list. Counts respect the active category +
  // status filters so the user sees what they'll actually get.
  var summaryBar = document.getElementById('inventorySummaryBar');
  if (summaryBar) {
    var allCount = 0, lowCount = 0, outCount = 0, noDemandCount = 0, trendingUpCount = 0;
    // W1.2: shared sales map. May be null on first paint — chips show
    // "?" counts until _ensureProductSalesMap resolves.
    var _salesMapForCounts = window._mastProductSalesMap;
    var _salesReady = !!_salesMapForCounts;
    productsData.forEach(function(p) {
      if (!_matchesFilter(p, statusFilter)) return;
      if (cat !== 'all' && (!p.categories || p.categories.indexOf(cat) === -1)) return;
      allCount++;
      var b = _stockBucket(p);
      if (b === 'low') lowCount++;
      else if (b === 'out') outCount++;
      if (_salesReady) {
        var ps = _salesMapForCounts[p.pid] || { last30: 0, last90: 0, prior60of30: 0 };
        if (ps.last90 === 0) noDemandCount++;
        var prior30 = ps.prior60of30 / 2;
        if (ps.last30 > prior30 && ps.last30 > 0) trendingUpCount++;
      }
    });
    var demandFilter = window.productsDemandFilter || null;
    // Hide entirely when there's truly nothing to track: no stock alerts,
    // no demand signals (or data not yet loaded), no active filters.
    // Otherwise show — the demand chips need to be discoverable if a
    // tenant has dead SKUs (noDemandCount > 0) or upward movers.
    var hasInventoryAlerts = lowCount > 0 || outCount > 0;
    var hasDemandSignal = _salesReady && (noDemandCount > 0 || trendingUpCount > 0);
    if (!hasInventoryAlerts && !hasDemandSignal && stockFilter === 'all' && !demandFilter) {
      summaryBar.style.display = 'none';
    } else {
      summaryBar.style.display = '';
      function stockPill(value, label, n, alertColor) {
        var active = stockFilter === value;
        var bg = active ? 'rgba(42,124,111,0.15)' : 'transparent';
        var fg = active ? 'var(--teal)' : (alertColor || 'var(--text)');
        var bd = active ? 'var(--teal)' : 'var(--cream-dark)';
        return '<button onclick="setProductsStockFilter(\'' + value + '\')" ' +
          'style="padding:6px 14px;border:1px solid ' + bd + ';border-radius:16px;background:' + bg + ';color:' + fg +
          ';font-size:0.85rem;cursor:pointer;font-weight:' + (active ? '600' : '500') + ';margin-right:6px;font-family:\'DM Sans\',sans-serif;">' +
          label + ' <span style="opacity:0.7;font-weight:400;">(' + n + ')</span></button>';
      }
      // W1.2: demand chips. Click cycles same-key off; clicking a
      // different key switches. Counts show "?" until the shared sales
      // map loads (kicked off below via _ensureProductSalesMap).
      function demandPill(value, label, n, alertColor) {
        var active = demandFilter === value;
        var nextValue = active ? '' : value;
        var bg = active ? 'rgba(42,124,111,0.15)' : 'transparent';
        var fg = active ? 'var(--teal)' : (alertColor || 'var(--text)');
        var bd = active ? 'var(--teal)' : 'var(--cream-dark)';
        var countTxt = _salesReady ? String(n) : '?';
        return '<button onclick="setProductsDemandFilter(\'' + nextValue + '\')" ' +
          'style="padding:6px 14px;border:1px solid ' + bd + ';border-radius:16px;background:' + bg + ';color:' + fg +
          ';font-size:0.85rem;cursor:pointer;font-weight:' + (active ? '600' : '500') + ';margin-right:6px;font-family:\'DM Sans\',sans-serif;">' +
          label + ' <span style="opacity:0.7;font-weight:400;">(' + countTxt + ')</span></button>';
      }
      summaryBar.innerHTML =
        stockPill('all', 'All products', allCount) +
        stockPill('low', 'Low stock',    lowCount, 'var(--amber-light)') +
        stockPill('out', 'Out of stock', outCount, 'var(--danger)') +
        '<span style="display:inline-block;width:1px;height:18px;background:var(--cream-dark,#e8e0d4);margin:0 4px 0 2px;vertical-align:middle;"></span>' +
        demandPill('noDemand90d', 'No demand 90d', noDemandCount, 'var(--warm-gray)') +
        demandPill('trendingUp',  'Trending up',   trendingUpCount, 'var(--teal)');
      // Kick off sales-map load if not yet loaded. Re-renders once data
      // arrives so chip counts move from "?" to real numbers.
      if (!_salesReady && typeof _ensureProductSalesMap === 'function') {
        _ensureProductSalesMap(function() { renderProducts(); });
      }
    }
  }
}

  // ---- renderInventoryOverview (verbatim from index.html) ----
function renderInventoryOverview() {
  var el = document.getElementById('inventoryOverviewContent');
  if (!el) return;

  // Make sure products data is loaded
  if (!productsData || !productsData.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--warm-gray);">Loading product data...</div>';
    if (!productsLoaded) {
      loadProducts().then(function() { renderInventoryOverview(); });
    }
    return;
  }

  // URL-driven filters from MCP admin links: stockType, lowStock, category,
  // productIds (#inventory?...). URL-overrides-pill — when any URL filter
  // is present we narrow the row set after the standard build/sort and
  // surface an orange banner with a Clear button. The summary stat bar
  // still reflects the whole tenant (informative even when filtered).
  var _invRouteParams = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
  var _invUrlStockType = (_invRouteParams && typeof _invRouteParams.stockType === 'string') ? _invRouteParams.stockType : '';
  var _invUrlLowStock = !!(_invRouteParams && (_invRouteParams.lowStock === 'true' || _invRouteParams.lowStock === true));
  var _invUrlCategory = (_invRouteParams && typeof _invRouteParams.category === 'string') ? _invRouteParams.category : '';
  var _invUrlIdsParam = (_invRouteParams && typeof _invRouteParams.productIds === 'string') ? _invRouteParams.productIds : '';
  var _invUrlIds = _invUrlIdsParam ? _invUrlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
  var _invUrlIdLookup = _invUrlIds.length > 0 ? Object.create(null) : null;
  if (_invUrlIdLookup) _invUrlIds.forEach(function(id) { _invUrlIdLookup[id] = true; });
  // W2.4: chip-driven filters. "$ at risk" = no-demand-90d rows in the top
  // 20% by inventory $ (so the chip surfaces the high-value tail, not every
  // stale SKU). "Aging >60d" = days since last unit moved > 60. Both flow
  // through the same URL filter mechanism as lowStock so the existing banner
  // + Clear button machinery works unchanged.
  var _invUrlAtRisk = !!(_invRouteParams && (_invRouteParams.atRisk === 'true' || _invRouteParams.atRisk === true));
  var _invUrlAging60 = !!(_invRouteParams && (_invRouteParams.aging60 === 'true' || _invRouteParams.aging60 === true));
  var _invHasUrlFilter = !!(_invUrlStockType || _invUrlLowStock || _invUrlCategory || _invUrlIds.length || _invUrlAtRisk || _invUrlAging60);

  // Build summary stats
  var totalProducts = productsData.length;
  var totalOnHand = 0;
  var totalCommitted = 0;
  var outOfStockCount = 0;
  var lowStockCount = 0;
  var strictCount = 0;
  var stockToBuildCount = 0;
  var buildToOrderCount = 0;
  var healthGreen = 0, healthYellow = 0, healthRed = 0, neverCounted = 0;
  // W2.4: $-value + aging signals (resolves OPEN -OtEOcB4xeTk-wxyHYjK).
  // Reuses the recipe-cost map + product-sales map already lazy-loaded by the
  // W2.1 Forecast path. If the user lands on Inventory before Forecast we
  // trigger the loads here too. Cells render "—" until they resolve.
  if (!window._mastRecipeCostByProduct && !window._mastRecipeCostLoading) {
    window._mastRecipeCostLoading = true;
    MastDB.recipes.list(200).then(function(recipeMap) {
      var costByProduct = {};
      Object.keys(recipeMap || {}).forEach(function(rid) {
        var r = recipeMap[rid];
        if (!r || !r.productId || r.status === 'archived') return;
        if (typeof costByProduct[r.productId] === 'undefined' && typeof r.unitCost === 'number') {
          costByProduct[r.productId] = r.unitCost;
        }
      });
      window._mastRecipeCostByProduct = costByProduct;
      window._mastRecipeCostLoading = false;
      // Re-render once the recipe map arrives so Inventory $ / $ at risk
      // populate without requiring a manual refresh.
      if (document.getElementById('inventoryOverviewContent')) renderInventoryOverview();
    }).catch(function() {
      window._mastRecipeCostByProduct = {};
      window._mastRecipeCostLoading = false;
    });
  }
  if (!window._mastProductSalesMap && typeof _ensureProductSalesMap === 'function') {
    _ensureProductSalesMap(function() {
      if (document.getElementById('inventoryOverviewContent')) renderInventoryOverview();
    });
  }
  var recipeCostByProduct = window._mastRecipeCostByProduct || {};
  var productSalesMap = window._mastProductSalesMap || {};
  var totalInventoryDollarsCents = 0;
  var dollarsAtRiskCents = 0; // sum of inv$ for products with last90 === 0
  var agingOver60Count = 0; // count of products with agingDays > 60 (no-BTO)

  // Build rows data
  var rows = productsData.map(function(p) {
    var inv = inventory[p.pid] || {};
    var totals = getInventoryTotals(inv);
    var stockType = inv.stockType || 'made-to-order';
    var threshold = inv.lowStockThreshold || 2;
    var variantInfo = getProductVariantCombos(p);
    var stock = (inv && inv.stock) ? inv.stock : {};

    totalOnHand += totals.onHand;
    totalCommitted += totals.committed;
    if (stockType === 'build-to-order' || stockType === 'made-to-order') buildToOrderCount++;
    else if (stockType === 'stock-to-build') { stockToBuildCount++; if (totals.available > 0 && totals.available <= threshold) lowStockCount++; }
    else if (stockType === 'strict' || stockType === 'in-stock' || stockType === 'limited') { strictCount++; if (totals.available <= 0) outOfStockCount++; else if (totals.available <= threshold) lowStockCount++; }
    else if (totals.available <= 0) outOfStockCount++;
    else if (totals.available <= threshold) lowStockCount++;

    // Build attribute summary for this product
    var attrSummary = '';
    if (variantInfo.combos.length > 0) {
      variantInfo.labels.forEach(function(label, labelIdx) {
        var valueCounts = {};
        variantInfo.combos.forEach(function(combo) {
          var val = combo[labelIdx];
          var key = comboKey(combo);
          var s = stock[key] || { onHand: 0 };
          if (!valueCounts[val]) valueCounts[val] = 0;
          valueCounts[val] += (s.onHand || 0);
        });
        var tags = '';
        Object.keys(valueCounts).forEach(function(val) {
          var count = valueCounts[val];
          var style = count > 0
            ? 'background:rgba(42,124,111,0.1);color:var(--teal);'
            : 'background:var(--cream-dark);color:var(--warm-gray);opacity:0.6;';
          tags += '<span style="display:inline-block;padding:2px 7px;border-radius:10px;font-size:0.72rem;margin:1px 2px;' + style + '">' +
            esc(val) + (count > 0 ? ' (' + count + ')' : '') + '</span>';
        });
        attrSummary += '<div style="margin-bottom:2px;">' +
          '<span style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray-light);margin-right:4px;">' + esc(label) + ':</span>' +
          tags + '</div>';
      });
    }

    // Health score: green/yellow/red based on lastCountedAt
    var isBTO = (stockType === 'build-to-order' || stockType === 'made-to-order');
    var health = 'none'; // BTO products don't need counting
    if (!isBTO) {
      var lastCounted = (stock._default && stock._default.lastCountedAt) ? new Date(stock._default.lastCountedAt) : null;
      if (!lastCounted) {
        health = 'red';
        neverCounted++;
      } else {
        var daysSinceCount = Math.floor((Date.now() - lastCounted.getTime()) / 86400000);
        if (daysSinceCount <= 30) { health = 'green'; healthGreen++; }
        else if (daysSinceCount <= 60) { health = 'yellow'; healthYellow++; }
        else { health = 'red'; healthRed++; }
      }
    }

    // W2.4: Inventory $ value (onHand × current recipe unit cost). null when
    // no recipe — UI renders "—". Aging = days since last unit moved
    // (currently last-sold via ps.lastOrdered; job-consumption not yet
    // tracked per-unit, see follow-up note below). Both signals feed the
    // "$ at risk" + "Aging >60d" filter chips and the Count Health row.
    var recipeUnitCost = (typeof recipeCostByProduct[p.pid] === 'number') ? recipeCostByProduct[p.pid] : null;
    var inventoryDollarsCents = recipeUnitCost == null ? null : Math.round(totals.onHand * recipeUnitCost * 100);
    var ps = productSalesMap[p.pid] || null;
    var last90 = ps ? ps.last90 : 0;
    var agingDays = null;
    if (ps && ps.lastOrdered) {
      var t = new Date(ps.lastOrdered).getTime();
      if (!isNaN(t)) agingDays = Math.floor((Date.now() - t) / 86400000);
    } else if (ps) {
      // Never sold but tracked — treat as very old for sorting/filter purposes.
      agingDays = 999;
    }
    var isBTOforTotals = (stockType === 'build-to-order' || stockType === 'made-to-order');
    if (inventoryDollarsCents != null && !isBTOforTotals) {
      totalInventoryDollarsCents += inventoryDollarsCents;
      if (last90 === 0) dollarsAtRiskCents += inventoryDollarsCents;
    }
    if (agingDays != null && agingDays > 60 && !isBTOforTotals && totals.onHand > 0) {
      agingOver60Count += 1;
    }

    return {
      pid: p.pid,
      name: p.name,
      price: p.priceCents ? formatPriceCents(p.priceCents) : '',
      imgSrc: firstProductImage(p),
      categories: p.categories || [],
      stockType: stockType,
      threshold: threshold,
      onHand: totals.onHand,
      available: totals.available,
      committed: totals.committed,
      hasVariants: variantInfo.combos.length > 0,
      attrSummary: attrSummary,
      productionLeadTimeDays: inv.productionLeadTimeDays || null,
      stockFulfillmentDays: inv.stockFulfillmentDays || null,
      availability: p.availability || '',
      health: health,
      // W2.4
      inventoryDollarsCents: inventoryDollarsCents,
      agingDays: agingDays,
      last90: last90
    };
  });

  // Sort: out of stock first, then low stock, then by available desc
  var isBTO = function(t) { return t === 'build-to-order' || t === 'made-to-order'; };
  rows.sort(function(a, b) {
    // Build-to-order goes last
    if (isBTO(a.stockType) && !isBTO(b.stockType)) return 1;
    if (isBTO(b.stockType) && !isBTO(a.stockType)) return -1;
    // Out of stock first (urgent)
    var aOOS = (!isBTO(a.stockType) && a.available <= 0) ? 1 : 0;
    var bOOS = (!isBTO(b.stockType) && b.available <= 0) ? 1 : 0;
    if (aOOS !== bOOS) return bOOS - aOOS;
    // Low stock next
    var aLow = (!isBTO(a.stockType) && a.available > 0 && a.available <= a.threshold) ? 1 : 0;
    var bLow = (!isBTO(b.stockType) && b.available > 0 && b.available <= b.threshold) ? 1 : 0;
    if (aLow !== bLow) return bLow - aLow;
    // Then by available descending
    return b.available - a.available;
  });

  // Apply URL-driven filters after sorting (so the banner-narrowed table
  // still shows the same urgency ordering as the full view).
  if (_invHasUrlFilter) {
    var _invCategoryLower = _invUrlCategory ? _invUrlCategory.toLowerCase() : '';
    rows = rows.filter(function(r) {
      if (_invUrlIdLookup && !_invUrlIdLookup[r.pid]) return false;
      if (_invCategoryLower) {
        if (!Array.isArray(r.categories) || !r.categories.some(function(c) {
          return typeof c === 'string' && c.toLowerCase() === _invCategoryLower;
        })) return false;
      }
      if (_invUrlStockType && r.stockType !== _invUrlStockType) return false;
      if (_invUrlLowStock) {
        // "Low stock" matches strict/STB rows at-or-below threshold (not BTO).
        if (isBTO(r.stockType)) return false;
        if (r.available > r.threshold) return false;
      }
      // W2.4: "Aging >60d" — exclude BTO + zero-stock rows.
      if (_invUrlAging60) {
        if (isBTO(r.stockType)) return false;
        if (r.onHand <= 0) return false;
        if (!(typeof r.agingDays === 'number' && r.agingDays > 60)) return false;
      }
      return true;
    });
    // W2.4: "$ at risk" — applied AFTER other filters so the top-20%-by-$
    // calculation operates on the already-narrowed set (avoids the chip
    // surfacing a single high-$ outlier in an unrelated category).
    if (_invUrlAtRisk) {
      var atRiskCandidates = rows.filter(function(r) {
        return !isBTO(r.stockType) && r.last90 === 0 && typeof r.inventoryDollarsCents === 'number' && r.inventoryDollarsCents > 0;
      }).sort(function(a, b) { return b.inventoryDollarsCents - a.inventoryDollarsCents; });
      var topN = Math.max(1, Math.ceil(atRiskCandidates.length * 0.2));
      var atRiskPids = Object.create(null);
      atRiskCandidates.slice(0, topN).forEach(function(r) { atRiskPids[r.pid] = true; });
      rows = rows.filter(function(r) { return atRiskPids[r.pid]; });
    }
  }

  // Summary bar
  var summaryHtml = '<div class="inv-overview-summary">' +
    '<div class="inv-overview-stat">' +
      '<div class="inv-overview-stat-value">' + totalProducts + '</div>' +
      '<div class="inv-overview-stat-label">Products</div>' +
    '</div>' +
    '<div class="inv-overview-stat">' +
      '<div class="inv-overview-stat-value">' + totalOnHand + '</div>' +
      '<div class="inv-overview-stat-label">Total On Hand</div>' +
    '</div>' +
    // W2.4: total inventory $ value (sum of onHand × recipe unit cost across
    // non-BTO products). "—" while the recipe-cost map is still loading.
    '<div class="inv-overview-stat">' +
      '<div class="inv-overview-stat-value">' + (window._mastRecipeCostByProduct ? '$' + Math.round(totalInventoryDollarsCents / 100).toLocaleString() : '—') + '</div>' +
      '<div class="inv-overview-stat-label">Inventory $</div>' +
    '</div>' +
    '<div class="inv-overview-stat">' +
      '<div class="inv-overview-stat-value">' + totalCommitted + '</div>' +
      '<div class="inv-overview-stat-label">Committed</div>' +
    '</div>' +
    (outOfStockCount > 0 ? '<div class="inv-overview-stat inv-overview-stat-alert">' +
      '<div class="inv-overview-stat-value">' + outOfStockCount + '</div>' +
      '<div class="inv-overview-stat-label">Out of Stock</div>' +
    '</div>' : '') +
    (lowStockCount > 0 ? '<div class="inv-overview-stat inv-overview-stat-warn">' +
      '<div class="inv-overview-stat-value">' + lowStockCount + '</div>' +
      '<div class="inv-overview-stat-label">Low Stock</div>' +
    '</div>' : '') +
    (strictCount > 0 ? '<div class="inv-overview-stat">' +
      '<div class="inv-overview-stat-value" style="opacity:0.5;">' + strictCount + '</div>' +
      '<div class="inv-overview-stat-label">Strict</div>' +
    '</div>' : '') +
    (stockToBuildCount > 0 ? '<div class="inv-overview-stat">' +
      '<div class="inv-overview-stat-value" style="opacity:0.5;">' + stockToBuildCount + '</div>' +
      '<div class="inv-overview-stat-label">Stock to Build</div>' +
    '</div>' : '') +
    (buildToOrderCount > 0 ? '<div class="inv-overview-stat">' +
      '<div class="inv-overview-stat-value" style="opacity:0.5;">' + buildToOrderCount + '</div>' +
      '<div class="inv-overview-stat-label">Build to Order</div>' +
    '</div>' : '') +
  '</div>' +
  ((healthGreen + healthYellow + healthRed + neverCounted > 0) ? '<div style="display:flex;gap:12px;align-items:center;padding:6px 12px;font-size:0.78rem;color:var(--warm-gray);border-top:1px solid var(--cream-dark);margin-top:4px;">' +
    '<span style="font-weight:500;">Count Health:</span>' +
    (healthGreen > 0 ? '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#4CAF50;margin-right:3px;vertical-align:middle;"></span>' + healthGreen + ' good</span>' : '') +
    (healthYellow > 0 ? '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#FF9800;margin-right:3px;vertical-align:middle;"></span>' + healthYellow + ' aging</span>' : '') +
    (healthRed > 0 ? '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#F44336;margin-right:3px;vertical-align:middle;"></span>' + healthRed + ' overdue</span>' : '') +
    (neverCounted > 0 ? '<span style="opacity:0.7;">' + neverCounted + ' never counted</span>' : '') +
    // W2.4: "$ at risk" chip — total inv$ tied up in no-demand-90d products.
    // Renders only when meaningful (>0) and the recipe-cost map is loaded.
    (window._mastRecipeCostByProduct && dollarsAtRiskCents > 0
      ? '<span style="margin-left:auto;display:flex;gap:8px;align-items:center;">' +
        '<a href="#inventory?atRisk=true" onclick="event.preventDefault();window.location.hash=\'#inventory?atRisk=true\';" style="color:var(--danger,#dc2626);text-decoration:underline;font-weight:500;">$' + Math.round(dollarsAtRiskCents / 100).toLocaleString() + ' at risk</a>' +
        (agingOver60Count > 0 ? '<a href="#inventory?aging60=true" onclick="event.preventDefault();window.location.hash=\'#inventory?aging60=true\';" style="color:#E65100;text-decoration:underline;">' + agingOver60Count + ' aging &gt;60d</a>' : '') +
      '</span>'
      : (agingOver60Count > 0
        ? '<span style="margin-left:auto;"><a href="#inventory?aging60=true" onclick="event.preventDefault();window.location.hash=\'#inventory?aging60=true\';" style="color:#E65100;text-decoration:underline;">' + agingOver60Count + ' aging &gt;60d</a></span>'
        : ''
      )
    ) +
  '</div>' : '');

  // Table
  // W2.4: +1 column for Inventory $ (between Committed and Lead Time). Aging
  // signal is folded into the Inventory $ cell as a small subscript on rows
  // with onHand>0 and no demand-90d, to avoid widening the table further on
  // small screens. colspan calls below bump from 8 → 9 to match.
  var tableHtml = '<div class="inv-overview-table data-table"><table>' +
    '<thead><tr>' +
      '<th style="width:40px;"></th>' +
      '<th>Product</th>' +
      '<th style="text-align:center;">Type</th>' +
      '<th style="text-align:center;">On Hand</th>' +
      '<th style="text-align:center;">Committed</th>' +
      '<th style="text-align:center;">Inventory $</th>' +
      '<th style="text-align:center;">Lead Time</th>' +
      '<th>Attributes</th>' +
      '<th style="width:70px;"></th>' +
    '</tr></thead><tbody>';

  rows.forEach(function(r) {
    var statusBadge = '';
    var isBTORow = (r.stockType === 'build-to-order' || r.stockType === 'made-to-order');
    var isSTBRow = (r.stockType === 'stock-to-build');
    if (isBTORow) {
      statusBadge = '<span class="status-badge stock-badge made-to-order" style="font-size:0.72rem;">Build to Order</span>';
    } else if (isSTBRow && r.available <= 0) {
      statusBadge = '<span class="status-badge stock-badge made-to-order" style="font-size:0.72rem;">Made to Order</span>';
    } else if (r.available <= 0) {
      statusBadge = '<span class="status-badge stock-badge out-of-stock" style="font-size:0.72rem;">Out of Stock</span>';
    } else if (r.available <= r.threshold) {
      statusBadge = '<span class="status-badge stock-badge low-stock" style="font-size:0.72rem;">Low Stock</span>';
    } else {
      statusBadge = '<span class="status-badge stock-badge in-stock" style="font-size:0.72rem;">In Stock</span>';
    }

    var imgHtml = r.imgSrc
      ? '<img src="' + esc(r.imgSrc) + '" alt="" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">'
      : '<div style="width:36px;height:36px;border-radius:6px;background:var(--cream-dark);"></div>';

    var qtyStyle = '';
    if (!isBTORow && !isSTBRow) {
      // Only strict/in-stock/limited show danger/warning — STB falls back to made-to-order
      if (r.available <= 0) qtyStyle = 'color:var(--danger);font-weight:600;';
      else if (r.available <= r.threshold) qtyStyle = 'color:#E65100;font-weight:600;';
    } else if (isSTBRow && r.available > 0 && r.available <= r.threshold) {
      qtyStyle = 'color:#E65100;font-weight:600;';
    }

    var discontinuedBadge = r.availability === 'discontinued'
      ? ' <span class="status-badge stock-badge out-of-stock" style="font-size:0.72rem;padding:1px 6px;vertical-align:middle;">Discontinued</span>'
      : '';
    var rowOpacity = r.availability === 'discontinued' ? 'opacity:0.6;' : '';
    var leadTimeStr = '';
    if (isBTORow || isSTBRow) {
      leadTimeStr = typeof r.productionLeadTimeDays === 'number' ? r.productionLeadTimeDays + 'd' : '<span style="color:var(--warm-gray-light);">—</span>';
    } else {
      leadTimeStr = typeof r.stockFulfillmentDays === 'number' ? r.stockFulfillmentDays + 'd' : '<span style="color:var(--warm-gray-light);">—</span>';
    }

    var healthDot = '';
    if (r.health === 'green') healthDot = '<span title="Counted recently" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#4CAF50;margin-left:5px;vertical-align:middle;"></span>';
    else if (r.health === 'yellow') healthDot = '<span title="Count aging (30-60 days)" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#FF9800;margin-left:5px;vertical-align:middle;"></span>';
    else if (r.health === 'red') healthDot = '<span title="Needs recount (60+ days or never counted)" style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#F44336;margin-left:5px;vertical-align:middle;"></span>';

    var isExpanded = expandedInventoryPid === r.pid;
    var expandIcon = r.hasVariants ? '<span style="font-size:0.72rem;color:var(--warm-gray-light);margin-right:4px;">' + (isExpanded ? '▼' : '▶') + '</span>' : '';
    tableHtml += '<tr class="inv-overview-row' + (isExpanded ? ' expanded' : '') + '" data-pid="' + esc(r.pid) + '" onclick="toggleInventoryExpand(this.dataset.pid)" style="cursor:pointer;' + rowOpacity + '">' +
      '<td>' + imgHtml + '</td>' +
      '<td>' +
        '<div style="font-weight:500;font-size:0.85rem;">' + expandIcon + esc(r.name) + healthDot + discontinuedBadge + '</div>' +
        (r.price ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(r.price) + '</div>' : '') +
        '<a href="#" data-pid="' + esc(r.pid) + '" onclick="event.stopPropagation();viewProductFromInventory(this.dataset.pid);return false;" style="font-size:0.72rem;color:var(--teal);">View Detail →</a>' +
      '</td>' +
      '<td style="text-align:center;">' + statusBadge + '</td>' +
      '<td style="text-align:center;' + qtyStyle + '">' + (isBTORow ? '<span style="color:var(--warm-gray-light);">—</span>' : r.onHand) + '</td>' +
      '<td style="text-align:center;color:var(--warm-gray);">' + (r.committed > 0 ? r.committed : (isBTORow ? '<span style="color:var(--warm-gray-light);">—</span>' : '0')) + '</td>' +
      // W2.4: Inventory $ cell with optional aging subscript. "—" when BTO,
      // no recipe, or onHand=0. Aging shown only on rows with stock and
      // agingDays > 60 (so the cell stays clean for healthy rows).
      '<td style="text-align:center;color:var(--warm-gray);font-size:0.85rem;">' +
        (isBTORow || r.inventoryDollarsCents == null
          ? '<span style="color:var(--warm-gray-light);">—</span>'
          : (r.inventoryDollarsCents === 0
            ? '<span style="color:var(--warm-gray-light);">$0</span>'
            : ('$' + Math.round(r.inventoryDollarsCents / 100).toLocaleString())
          )
        ) +
        (!isBTORow && r.onHand > 0 && typeof r.agingDays === 'number' && r.agingDays > 60
          ? '<div style="font-size:0.72rem;color:#E65100;margin-top:1px;">' + (r.agingDays >= 999 ? 'never sold' : r.agingDays + 'd since sold') + '</div>'
          : ''
        ) +
      '</td>' +
      '<td style="text-align:center;color:var(--warm-gray);font-size:0.85rem;">' + leadTimeStr + '</td>' +
      '<td>' + (r.attrSummary || '<span style="color:var(--warm-gray-light);font-size:0.78rem;">No variants</span>') + '</td>' +
      '<td style="text-align:center;">' + (!isBTORow ? '<button class="btn btn-secondary btn-small" style="font-size:0.72rem;padding:3px 8px;" data-pid="' + esc(r.pid) + '" onclick="event.stopPropagation();toggleInlineAdjust(this.dataset.pid);" aria-label="Adjust stock for ' + esc(r.name) + '">Adjust</button>' : '') + '</td>' +
    '</tr>';
    if (inlineAdjustPid === r.pid) {
      tableHtml += '<tr class="inv-adjust-row"><td colspan="9">' + renderInlineAdjustRow(r.pid) + '</td></tr>';
    }
    if (isExpanded && r.hasVariants) {
      // renderVariantDrillDown lives in the lazy modules/variant-detail-tabs.js
      // (decomposition Track 1). Emit a mount; _fillVariantDrillMount fills it
      // after el.innerHTML. Only one row can be expanded at a time.
      tableHtml += '<tr class="inv-expand-row"><td colspan="9" id="invVariantDrillMount" data-pid="' + esc(r.pid) + '"></td></tr>';
    }
  });

  tableHtml += '</tbody></table></div>';

  // URL-filter banner — built inline so it lives inside #inventoryOverviewContent
  // and gets re-rendered every pass (avoids stale-DOM problems when the user
  // clicks Clear and the whole content gets re-painted).
  var bannerHtml = '';
  if (_invHasUrlFilter) {
    var bParts = [];
    if (_invUrlIds.length) bParts.push(MastFormat.countNoun(_invUrlIds.length, 'selected product'));
    if (_invUrlLowStock) bParts.push('low stock only');
    if (_invUrlAtRisk) bParts.push('$ at risk (top 20% of no-demand-90d)');
    if (_invUrlAging60) bParts.push('aging >60d');
    if (_invUrlStockType) bParts.push('stockType: ' + _invUrlStockType);
    if (_invUrlCategory) bParts.push('category: ' + _invUrlCategory);
    bannerHtml = '<div id="inventoryUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
      '<span>📦 Showing ' + bParts.join(', ') + '</span>' +
      '<button type="button" onclick="clearInventoryFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
    '</div>';
  }

  el.innerHTML = summaryHtml + bannerHtml + tableHtml;
  // Lazy-fill the expanded-row variant drill-down (extracted to
  // modules/variant-detail-tabs.js). No-op when no row is expanded.
  _fillVariantDrillMount();
}

  // ---- switchProductTab (verbatim from index.html) ----
function switchProductTab(tab) {
  productEditTab = tab;
  document.querySelectorAll('.pd-tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.pd-tab-content').forEach(function(c) {
    c.style.display = c.dataset.tab === tab ? '' : 'none';
  });
  if (tab === 'inventory' && selectedProductPid) {
    loadProductInventoryHistory(selectedProductPid);
  }
}

  // ---- renderProductDetail (verbatim from index.html) ----
function renderProductDetail(pid) {
  var el = document.getElementById('productDetailView');
  var product = pid ? productsData.find(function(p) { return p.pid === pid; }) : null;
  var isCreate = productCreateMode && !product;

  if (!isCreate && !product) { el.innerHTML = '<p>Product not found.</p>'; return; }

  // Defaults for new product
  if (isCreate) {
    product = {
      pid: '', name: '', description: '', shortDescription: '', priceCents: null,
      slug: '', categories: [], availability: 'available', sortOrder: null,
      options: [], images: [], imageIds: [],
      buildTime: null, costToBuild: null, materials: [],
      sku: null, processingDays: null, personalization: null, seoTitle: null, seoDescription: null,
      introducedAt: null, discontinuedAt: null, etsyListingId: null,
      priceHistory: [], buildTimeHistory: [], costToBuildHistory: [],
      isWholesale: false, wholesalePriceCents: null, recipeId: null
    };
  }

  var inv = pid ? (inventory[pid] || {}) : {};
  var isEditing = productEditMode;
  var tab = productEditTab;

  // Header with name and edit toggle
  var imgSrc = firstProductImage(product);
  // Checkpoint G — composite status badge (base + archive sub-state)
  var statusBadgeRender = (typeof window.makerProductStatusBadgeWithSubStateHtml === 'function')
    ? window.makerProductStatusBadgeWithSubStateHtml(product)
    : (typeof window.productStatusBadgeHtml === 'function' ? window.productStatusBadgeHtml(product.status) : '');
  // Checkpoint G — lens toggle pill (Develop / Catalog)
  // The View-as toggle is gone from product detail — that decision lives
  // on the list page (filter pills). On a single product, you're past the
  // "what am I looking at" question, so the detail shows everything.
  // productSection still drives the action bar via the sidebar entry point,
  // but it's invisible context now, not a user-facing toggle.
  var lensToggleHtml = '';
  // Core product info inlined into the header: image left, name/desc/category
  // beside it, manage-images button under the image. This replaces the
  // separate Core Product card and the Details/Images tab bar.
  // Show the count of inline product images to match what the Manage Images
  // panel renders (it iterates product.images[]). Library reverse-linked
  // images are not included here to avoid the count/render mismatch.
  var _coreImgCount = Array.isArray(product.images) ? product.images.length : 0;
  var _coreInv = inventory[pid] || {};
  var _coreStockType = (_coreInv && _coreInv.stockType) ? _coreInv.stockType : 'made-to-order';
  var _coreProduction = (_coreStockType === 'build-to-order' || _coreStockType === 'made-to-order')
    ? 'Build to order'
    : (_coreStockType === 'stock-to-build' ? 'Stock to build' : 'Strict stock');
  if (product.processingDays && (product.processingDays.min || product.processingDays.max)) {
    var _pd = product.processingDays;
    _coreProduction += ' · ' + (_pd.min || 0) + (_pd.max && _pd.max !== _pd.min ? '–' + _pd.max : '') + ' day lead';
  }
  var _categoryText = (product.categories && product.categories.length) ? product.categories.join(', ') : '';
  var _imgPanelOpen = false;
  try { _imgPanelOpen = sessionStorage.getItem('mastImgPanel_' + pid) === '1'; } catch (e) {}

  var headerHtml = '<div style="display:grid;grid-template-columns:240px 1fr;gap:24px;margin-bottom:24px;align-items:start;">';
  // ── Left column: hero + Manage Images
  headerHtml += '<div>';
  headerHtml += imgSrc
    ? '<img src="' + esc(imgSrc) + '" alt="' + esc(product.name || '') + '" style="width:240px;height:240px;object-fit:cover;border-radius:12px;display:block;border:1px solid var(--cream-dark,#e8e0d4);">'
    : '<div style="width:240px;height:240px;border-radius:12px;background:var(--cream-dark,#e8e0d4);display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:var(--warm-gray,#888);">📦</div>';
  if (!isCreate && pid) {
    headerHtml += '<button class="btn btn-secondary btn-small" style="margin-top:10px;width:240px;" onclick="toggleProductImagesPanel(\'' + esc(pid) + '\')">' +
      (_imgPanelOpen ? '▲ Hide images' : '📷 Manage images (' + _coreImgCount + ')') +
      '</button>';
  }
  headerHtml += '</div>';

  // ── Right column: name, status, view-as toggle, action bar, then core fields
  headerHtml += '<div style="min-width:0;">';
  headerHtml += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:8px;">';
  headerHtml += '<h2 class="product-detail-name" style="margin:0;flex:1;min-width:200px;">' +
    esc(product.name || 'New Product') + ' ' + statusBadgeRender + '</h2>';
  // Action bar inline at top right
  headerHtml += (!isCreate && !isEditing ? '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">' +
      // Section-aware action bar. Section is preset by sidebar entry point
      // (Develop/Manage/Sell/Inventory) and drives which actions surface here.
      (function() {
        var section = (typeof productSection === 'string') ? productSection : 'catalog';
        var isActive = product.status === 'active';
        var isArchived = product.status === 'archived';
        var canViewOnSite = pid && isActive && product.availability !== 'discontinued';
        var viewOnSiteBtn = canViewOnSite
          ? '<a href="' + window.location.origin + '/product.html?id=' + encodeURIComponent(pid) + '" target="_blank" rel="noopener" class="btn btn-secondary btn-small" style="text-decoration:none;font-size:0.78rem;">View on site ↗</a>'
          : '';
        var editInfoBtn = '<button class="btn btn-secondary btn-small" onclick="editProduct(\'' + esc(pid) + '\')">Edit Info</button>';
        var dupBtn = '<button class="btn btn-secondary btn-small" onclick="openCloneDialog(\'' + esc(pid) + '\')">Duplicate</button>';
        var archiveBtn = isActive
          ? '<button class="btn btn-secondary btn-small" onclick="window.makerOpenArchiveModal && window.makerOpenArchiveModal(\'' + esc(pid) + '\')">Archive</button>'
          : '';
        var recipeBtn = product.recipeId
          ? '<button class="btn btn-primary btn-small" onclick="window.makerOpenRecipeBuilder && window.makerOpenRecipeBuilder(\'' + esc(product.recipeId) + '\')">Edit Recipe →</button>'
          : '<button class="btn btn-primary btn-small" onclick="addRecipeForProduct(\'' + esc(pid) + '\')">+ Create Recipe</button>';
        var saleBtn = isActive ? '<button class="btn btn-secondary btn-small" onclick="openAddToSaleDialog(\'' + esc(pid) + '\')">Add to Sale</button>' : '';
        // Publish to Channel always shows in Sell view — dialog handles draft/ready guards.
        var publishBtn = renderPublishToChannelButton(product);

        // Archived products keep the sub-state action bar (restore / discontinue / etc.) regardless of section.
        if (isArchived && typeof window.makerRenderArchivedProductActionBar === 'function') {
          return window.makerRenderArchivedProductActionBar(product);
        }

        if (section === 'develop') {
          // Develop: building/repricing focus. Recipe is primary action; product info is secondary.
          return recipeBtn + editInfoBtn + dupBtn;
        }
        if (section === 'sell') {
          // Sell: customer-facing actions (active products only meaningful here).
          return viewOnSiteBtn + saleBtn + publishBtn + editInfoBtn;
        }
        if (section === 'inventory') {
          // Inventory: stock-focused. Editing info is secondary.
          return editInfoBtn + dupBtn;
        }
        // catalog (Manage > Products): governance — info, lifecycle, view-on-site.
        // Active products with the revision-aware action bar use it; otherwise plain.
        if (isActive && typeof window.makerRenderActiveProductActionBar === 'function') {
          return viewOnSiteBtn + window.makerRenderActiveProductActionBar(product) + archiveBtn;
        }
        return viewOnSiteBtn + editInfoBtn + dupBtn + archiveBtn;
      })() +
    '</div>' : '') +
    (isEditing && !isCreate ? '<div style="display:flex;align-items:center;gap:8px;">' +
      '<span style="font-size:0.72rem;color:var(--amber);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Editing</span>' +
    '</div>' : '');
  headerHtml += '</div>'; // close top row (name + actions)

  // Mode selector — section context as a small dropdown below the action bar.
  // Same four values as the sidebar slices (develop / catalog / sell / inventory),
  // but rendered as a passive control that reflects entry point and lets the
  // user override per-pid without leaving the page.
  if (!isCreate && !isEditing) {
    var _curSection = (typeof productSection === 'string') ? productSection : 'catalog';
    headerHtml += '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin:-2px 0 14px 0;font-size:0.85rem;color:var(--warm-gray,#888);">' +
      '<label for="pdSectionSelect" style="font-weight:500;letter-spacing:0.02em;">Mode:</label>' +
      '<select id="pdSectionSelect" onchange="setProductSection(this.value)" ' +
        'style="padding:4px 8px;border:1px solid var(--cream-dark,#e8e0d4);border-radius:6px;background:var(--surface-card,#fff);color:var(--text,#2a2a2a);font-size:0.85rem;font-family:\'DM Sans\',sans-serif;cursor:pointer;">' +
        '<option value="develop"' + (_curSection === 'develop' ? ' selected' : '') + '>Develop</option>' +
        '<option value="catalog"' + (_curSection === 'catalog' ? ' selected' : '') + '>Catalog</option>' +
        '<option value="sell"' + (_curSection === 'sell' ? ' selected' : '') + '>Sell</option>' +
        '<option value="inventory"' + (_curSection === 'inventory' ? ' selected' : '') + '>Inventory</option>' +
      '</select>' +
    '</div>';
  }

  // View-as toggle below name/actions row
  if (lensToggleHtml) {
    headerHtml += '<div style="margin:0 0 14px 0;">' + lensToggleHtml + '</div>';
  }

  // D7 — lifecycle stepper. Show the four-state product flow (Draft → Active →
  // Revising → Archived) so operators can see at a glance where they are.
  // Read-mode only — during edit/create, the inline form already implies state.
  if (!isCreate && !isEditing) {
    headerHtml += _renderProductLifecycleStepper(product);
  }

  // Stage panel — read mode only (not editing, not creating)
  if (!isCreate && !isEditing) {
    headerHtml += _renderProductStagePanel(product);
  }

  // Core product fields next to hero. Mirrors the Edit Info form so every
  // editable product-level value is visible on the detail page. Rows render
  // only when they have a value to keep the header tidy. Noisy fields
  // (Sort Order, Personalization, SEO) are tucked into a "More details"
  // disclosure below the always-on rows.
  if (product.description) {
    headerHtml += '<div style="font-size:0.9rem;color:var(--text,#2a2a2a);line-height:1.55;margin-bottom:14px;">' +
      esc(product.description) + '</div>';
  }
  headerHtml += '<dl style="display:grid;grid-template-columns:120px 1fr;gap:8px 20px;margin:0;font-size:0.9rem;">';
  function _coreRow(label, value) {
    return '<dt style="font-size:0.72rem;color:var(--warm-gray,#888);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">' + label + '</dt>' +
      '<dd style="margin:0;color:var(--text,#2a2a2a);">' + value + '</dd>';
  }
  headerHtml += _coreRow('Category', _categoryText ? esc(_categoryText) : '<span style="color:var(--warm-gray-light,#aaa);">—</span>');
  headerHtml += _coreRow('Production', esc(_coreProduction));
  if (product.shortDescription) {
    headerHtml += _coreRow('Short Desc', esc(product.shortDescription));
  }
  if (product.sku) {
    headerHtml += _coreRow('SKU', '<span style="font-family:monospace;">' + esc(product.sku) + '</span>');
  }
  if (product.slug) {
    headerHtml += _coreRow('Slug', '<span style="font-family:monospace;">' + esc(product.slug) + '</span>');
  }
  if (product.etsyListingId) {
    headerHtml += _coreRow('Etsy ID', '<span style="font-family:monospace;">' + esc(product.etsyListingId) + '</span>');
  }
  if (product.introducedAt) {
    headerHtml += _coreRow('Introduced', esc(product.introducedAt));
  }
  if (product.availability === 'discontinued') {
    headerHtml += _coreRow('Availability', '<span style="color:var(--danger,#c2410c);font-weight:600;">Discontinued</span>');
  }
  if (product.businessLine) {
    var _blEntry = BUSINESS_LINES.find(function(b) { return b.id === product.businessLine; });
    var _blLabel = _blEntry ? _blEntry.label : product.businessLine.charAt(0).toUpperCase() + product.businessLine.slice(1);
    headerHtml += _coreRow('Business Line', '<span style="display:inline-block;background:var(--teal,#2a7c6f);color:white;font-size:0.72rem;padding:3px 10px;border-radius:10px;">' + esc(_blLabel) + '</span>');
  }
  headerHtml += '</dl>';

  // "More details" disclosure — Sort Order, Personalization, SEO. These
  // are editable in the Edit Info form but rarely consulted on the detail
  // page, so collapse them by default.
  var _moreParts = [];
  if (product.sortOrder !== null && product.sortOrder !== undefined) {
    _moreParts.push(['Sort Order', String(product.sortOrder)]);
  }
  if (product.personalization && product.personalization.enabled) {
    var _pers = (product.personalization.required ? 'Required' : 'Optional');
    if (product.personalization.instructions) _pers += ' — ' + product.personalization.instructions;
    _moreParts.push(['Personalization', esc(_pers)]);
  }
  if (product.seoTitle) _moreParts.push(['SEO Title', esc(product.seoTitle)]);
  if (product.seoDescription) _moreParts.push(['SEO Description', esc(product.seoDescription)]);
  if (_moreParts.length) {
    headerHtml += '<details style="margin-top:10px;font-size:0.85rem;">' +
      '<summary style="cursor:pointer;color:var(--warm-gray,#888);font-weight:500;list-style:none;user-select:none;">More details</summary>' +
      '<dl style="display:grid;grid-template-columns:120px 1fr;gap:6px 20px;margin:8px 0 0 0;font-size:0.85rem;">' +
      _moreParts.map(function(r) {
        return '<dt style="font-size:0.72rem;color:var(--warm-gray,#888);font-weight:600;letter-spacing:0.06em;text-transform:uppercase;">' + r[0] + '</dt>' +
          '<dd style="margin:0;color:var(--text,#2a2a2a);">' + r[1] + '</dd>';
      }).join('') +
      '</dl>' +
    '</details>';
  }

  headerHtml += '</div>'; // close right column
  headerHtml += '</div>'; // close header grid

  // Inline images panel — visible when toggled. Replaces the Images tab.
  if (!isCreate && pid && _imgPanelOpen) {
    headerHtml += '<div id="productImagesPanel" style="margin-bottom:24px;">' +
      renderInlineImagesPanel(product) +
      '</div>';
  }

  // Channel sync badges (small status pills) below header.
  var _syncBadges = renderChannelSyncBadges(product, { size: 'normal' });
  if (_syncBadges) {
    headerHtml += '<div style="margin-bottom:16px;">' + _syncBadges + '</div>';
  }
  // Discontinued banner
  if (product.availability === 'discontinued') {
    headerHtml += '<div style="margin-bottom:16px;"><span class="status-badge stock-badge out-of-stock">Discontinued</span></div>';
  }

  // Channel-First Phase 2d (D24) — Recipe Publish handshake banner.
  // Renders only when recipe.version > product.recipeVersion.
  var recipeReadyHtml = renderRecipeReadyBanner(product);

  // Checkpoint F — Revision banner (when in revision mode) + version-link banner
  // (parent ↔ child v2 cross-link). Both render before tabs.
  var revisionBannerHtml = (!isCreate && typeof window.makerRenderRevisionBanner === 'function')
    ? window.makerRenderRevisionBanner(product) : '';
  var versionLinkBannerHtml = (!isCreate && typeof window.makerRenderVersionLinkBanner === 'function')
    ? window.makerRenderVersionLinkBanner(product) : '';
  // Checkpoint G — read-only sub-state banner shown on archived products.
  var archivedBannerHtml = (!isCreate && product && product.status === 'archived' && typeof window.makerRenderArchivedProductBanner === 'function')
    ? window.makerRenderArchivedProductBanner(product) : '';

  // Tab bar — hide irrelevant tabs unless editing (so user can add data)
  var hasVariants = product.options && product.options.length > 0;
  var hasProduction = product.buildTime || product.costToBuild || (product.materials && product.materials.length) ||
    product.shippingCategory || product.weightOz || product.dimensions;
  // No top-level tabs at all. View mode shows the variant-centric layout
  // (header + variants + variant detail panel with its own tab strip).
  // Edit Info opens just the Core Product fields — everything else is
  // edited inline at the variant level (prices, channels, inventory, image
  // binding) or via the Manage Images panel (product image library).
  var tabs = [{ id: 'details', label: 'Details' }];
  // Force the active tab to 'details' in editing mode so the form renders.
  if (isEditing) tab = 'details';
  var tabBarHtml = '';

  // ---- Details Tab ----
  var catOptions = CATEGORIES.length > 0 ? CATEGORIES : ['other'];
  var currentPrice = product.priceCents !== null && product.priceCents !== undefined
    ? (product.priceCents / 100).toFixed(2)
    : '';

  var currentRetailPrice = product.retailPriceCents != null
    ? (product.retailPriceCents / 100).toFixed(2) : '';
  var currentDirectPrice = product.directPriceCents != null
    ? (product.directPriceCents / 100).toFixed(2) : '';

  var detailsHtml = '<div class="pd-tab-content" data-tab="details" style="' + (tab !== 'details' ? 'display:none;' : '') + 'padding:16px 0;">';
  if (isEditing) {
    detailsHtml +=
      '<div class="form-group"><label>Name</label><input type="text" id="pdName" value="' + esc(product.name) + '" onchange="if(productCreateMode){document.getElementById(\'pdSlug\').value=generateSlug(this.value);}"></div>' +
      '<div class="form-group"><label>Description</label><textarea id="pdDescription" rows="3">' + esc(product.description || '') + '</textarea>' +
        ((window.MastAskAi && window.MastAskAi.isEnabled()) ? '<div style="margin-top:6px;"><button type="button" class="btn btn-outline" style="font-size:0.78rem;padding:4px 10px;" onclick="pdDescribeInClaude()" title="Opens Claude Desktop">✨ Draft in Claude</button></div>' : '') +
      '</div>' +
      '<div class="form-group"><label>Short Description</label><input type="text" id="pdShortDesc" value="' + esc(product.shortDescription || '') + '"></div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
        '<div class="form-group" style="min-width:150px;"><label>Category</label><select id="pdCategory" onchange="handlePdCategoryChange(this)">' +
          catOptions.map(function(c) { return '<option value="' + c + '"' + (product.categories && product.categories.indexOf(c) !== -1 ? ' selected' : '') + '>' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>'; }).join('') +
          '<option value="__manage__" style="color:var(--teal,#2a7c6f);">⚙ Manage Categories…</option>' +
        '</select></div>' +
        '<div class="form-group" style="min-width:120px;"><label>Availability</label><select id="pdAvailability">' +
          '<option value="available"' + (product.availability !== 'discontinued' ? ' selected' : '') + '>Available</option>' +
          '<option value="discontinued"' + (product.availability === 'discontinued' ? ' selected' : '') + '>Discontinued</option>' +
        '</select></div>' +
        (function() {
          var blOpts = BUSINESS_LINES.length > 0
            ? BUSINESS_LINES.map(function(bl) {
                return '<option value="' + bl.id + '"' + (product.businessLine === bl.id ? ' selected' : '') + '>' + bl.label + '</option>';
              }).join('')
            : '<option value="production"' + ((product.businessLine || 'production') === 'production' ? ' selected' : '') + '>Production</option>';
          return '<div class="form-group" style="min-width:140px;"><label>Business Line</label><select id="pdBusinessLine" onchange="handlePdBusinessLineChange(this)">' +
            blOpts +
            '<option value="__manage_bl__" style="color:var(--teal,#2a7c6f);border-top:1px solid var(--charcoal-light,#333);">&#9881; Manage Business Lines…</option>' +
          '</select></div>';
        })() +
      '</div>';

    // Pricing (retail / direct / wholesale) is edited in the Variants area
    // (default variant + per-variant overrides). The Edit Info form holds
    // product-level fields only.

    // ── Channel Bindings (Phase 2c — D26, D28, D29) ──
    detailsHtml += renderProductChannelBindings(product, true, isCreate);

    // ── Advanced Settings (collapsible) ──
    var advCollapsed = sessionStorage.getItem('productAdvancedCollapsed') !== 'false';
    detailsHtml +=
      '<div style="margin-top:16px;border:1px solid var(--cream-dark);border-radius:8px;overflow:hidden;">' +
        '<div onclick="toggleProductAdvanced()" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;background:var(--cream);user-select:none;" role="button" aria-expanded="' + (!advCollapsed) + '" aria-controls="productAdvancedPanel">' +
          '<span style="font-size:0.85rem;font-weight:600;color:var(--warm-gray);">Advanced Settings</span>' +
          '<span id="productAdvancedChevron" style="font-size:0.72rem;color:var(--warm-gray);transition:transform 0.2s;">' + (advCollapsed ? '▶' : '▼') + '</span>' +
        '</div>' +
        '<div id="productAdvancedPanel" style="padding:12px 14px;' + (advCollapsed ? 'display:none;' : '') + '">' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
        '<div class="form-group" style="min-width:200px;"><label>Slug (URL-safe)</label><input type="text" id="pdSlug" value="' + esc(product.slug || '') + '"></div>' +
        '<div class="form-group" style="min-width:100px;"><label>Sort Order</label><input type="number" id="pdSortOrder" value="' + (product.sortOrder !== null && product.sortOrder !== undefined ? product.sortOrder : '') + '" placeholder="auto"></div>' +
        '<div class="form-group" style="min-width:150px;"><label>Etsy Listing ID</label><input type="text" id="pdEtsyId" value="' + esc(product.etsyListingId || '') + '"></div>' +
      '</div>' +
      '<div class="form-group"><label>Introduced Date</label><input type="date" id="pdIntroducedAt" value="' + esc(product.introducedAt || '') + '"></div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;">' +
        '<div class="form-group" style="min-width:200px;"><label>SKU</label><input type="text" id="pdSku" value="' + esc(product.sku || '') + '" placeholder="e.g., BV-12OZ-BLUE"></div>' +
        '<div class="form-group" style="min-width:100px;"><label>Processing Min (days)</label><input type="number" id="pdProcessingMin" value="' + ((product.processingDays && product.processingDays.min) || '') + '" placeholder="e.g., 3" min="0"></div>' +
        '<div class="form-group" style="min-width:100px;"><label>Processing Max (days)</label><input type="number" id="pdProcessingMax" value="' + ((product.processingDays && product.processingDays.max) || '') + '" placeholder="e.g., 7" min="0"></div>' +
      '</div>' +
      // W2b — wholesale MOQ + case pack. Sets the floor + multiple enforced on
      // the wholesale storefront's qty input and add-to-cart. Empty values mean
      // "no constraint" so retail-only products are unaffected.
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;">' +
        '<div class="form-group" style="min-width:140px;"><label>Wholesale MOQ</label><input type="number" id="pdMoq" value="' + esc(product.moq != null ? product.moq : '') + '" placeholder="e.g., 12" min="1"></div>' +
        '<div class="form-group" style="min-width:140px;"><label>Case pack</label><input type="number" id="pdCasePack" value="' + esc(product.casePack != null ? product.casePack : '') + '" placeholder="e.g., 12" min="1"></div>' +
        '<div class="form-group" style="flex:1;min-width:200px;"><label style="visibility:hidden;">.</label><div style="font-size:0.78rem;color:var(--warm-gray);padding-top:8px;">Minimum order quantity and units-per-case for wholesale orders. Storefront enforces qty &ge; MOQ and qty as a multiple of case pack.</div></div>' +
      '</div>';

    // Personalization section
    var persEnabled = product.personalization && product.personalization.enabled;
    var persRequired = product.personalization && product.personalization.required;
    var persInstructions = (product.personalization && product.personalization.instructions) || '';
    detailsHtml +=
      '<div style="margin-top:12px;padding:12px;background:var(--cream);border-radius:8px;">' +
        '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">' +
          '<input type="checkbox" id="pdPersonalizationEnabled"' + (persEnabled ? ' checked' : '') + ' onchange="document.getElementById(\'pdPersonalizationFields\').style.display=this.checked?\'\':\'none\'">' +
          'Enable Personalization' +
        '</label>' +
        '<div id="pdPersonalizationFields" style="' + (persEnabled ? '' : 'display:none;') + 'margin-top:8px;">' +
          '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.85rem;margin-bottom:8px;">' +
            '<input type="checkbox" id="pdPersonalizationRequired"' + (persRequired ? ' checked' : '') + '>' +
            'Required (block add-to-cart without input)' +
          '</label>' +
          '<div class="form-group" style="margin:0;"><label style="font-size:0.72rem;">Instructions for customer</label><input type="text" id="pdPersonalizationInstructions" value="' + esc(persInstructions) + '" placeholder="e.g., Enter name for engraving (max 20 chars)"></div>' +
        '</div>' +
      '</div>';

    // SEO section
    detailsHtml +=
      '<div style="margin-top:12px;">' +
        '<div style="font-size:0.85rem;font-weight:600;color:var(--warm-gray);margin-bottom:8px;">SEO Settings</div>' +
        '<div class="form-group"><label>SEO Title</label><input type="text" id="pdSeoTitle" value="' + esc(product.seoTitle || '') + '" placeholder="Leave blank to use product name"></div>' +
        '<div class="form-group"><label>SEO Description</label><textarea id="pdSeoDescription" rows="2" placeholder="Leave blank to use product description">' + esc(product.seoDescription || '') + '</textarea></div>' +
      '</div>' +
        '</div>' +
      '</div>';
  } else {
    // ─── Variant-centric Details ───
    // Core Product info is in the header; just render variants here. The
    // heavy variant master-detail renderer (renderVariantsSection + tab
    // renderers) lives in the lazy modules/variant-detail-tabs.js; emit a
    // mount here and fill it after el.innerHTML via _fillVariantSectionMount.
    detailsHtml += '<div id="pdVariantSectionMount"></div>';
  }
  detailsHtml += '</div>';

  // ---- Variants Tab ----
  var variantsHtml = '<div class="pd-tab-content" data-tab="variants" style="' + (tab !== 'variants' ? 'display:none;' : '') + 'padding:16px 0;">';
  var options = product.options || [];
  if (isEditing) {
    variantsHtml += '<div class="product-detail-section"><div class="product-detail-section-title">Variant Attributes</div>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 12px 0;">Define attributes like Color, Size, etc. Each combination gets its own price and optional image binding in the grid below — updates live as you type.</p>' +
      '<div id="pdOptionsContainer">';
    options.forEach(function(opt, idx) {
      var optLabel = opt.label || '';
      var optChoices = opt.choices || [];
      variantsHtml += '<div class="pd-option-row" style="display:flex;gap:8px;align-items:flex-start;margin-bottom:12px;padding:12px;background:var(--cream);border-radius:8px;">' +
        '<div class="form-group" style="margin:0;min-width:120px;"><label style="font-size:0.72rem;">Label</label><input type="text" class="pd-opt-label" value="' + esc(optLabel) + '" oninput="pdRebuildVariantGrid()"></div>' +
        '<div class="form-group" style="margin:0;flex:1;"><label style="font-size:0.72rem;">Choices (comma-separated)</label><input type="text" class="pd-opt-choices" value="' + esc(optChoices.join(', ')) + '" oninput="pdRebuildVariantGrid()"></div>' +
        '<button class="btn btn-secondary" style="margin-top:18px;padding:4px 10px;font-size:0.78rem;" onclick="this.closest(\'.pd-option-row\').remove();pdRebuildVariantGrid()">Remove</button>' +
      '</div>';
    });
    variantsHtml += '</div>' +
      '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="addVariantOption()">+ Add Attribute</button>' +
    '</div>';
    // Variant Pricing grid (edit mode) — lives in a container and regenerates from live DOM
    var pImagesEdit = product.images || [];
    var existingVariantsEdit = product.variants || [];
    var vcEdit = getProductVariantCombos(product);
    variantsHtml += '<div id="pdVariantGridContainer">' +
      pdBuildVariantGridHtml(vcEdit.labels, vcEdit.combos, pImagesEdit, existingVariantsEdit) +
      '</div>';
  } else {
    if (options.length) {
      variantsHtml += '<div class="product-detail-section"><div class="product-detail-section-title">Variant Attributes</div>';
      options.forEach(function(opt) {
        var optLabel = opt.label || 'Option';
        var optChoices = opt.choices || [];
        variantsHtml += '<div style="margin-bottom:8px;"><strong style="font-size:0.85rem;">' + esc(optLabel) + ':</strong> ' +
          '<span style="font-size:0.85rem;">' + optChoices.map(function(c) { return esc(c); }).join(', ') + '</span></div>';
      });
      variantsHtml += '</div>';
      // Variant Pricing grid (view mode)
      var vcView = getProductVariantCombos(product);
      if (vcView.combos.length > 0) {
        var existingVariants = product.variants || [];
        variantsHtml += '<div class="product-detail-section" style="margin-top:16px;"><div class="product-detail-section-title">Variant Pricing</div>' +
          '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
          '<thead><tr style="border-bottom:2px solid var(--cream-dark);">';
        vcView.labels.forEach(function(l) { variantsHtml += '<th style="text-align:left;padding:8px 12px;color:var(--warm-gray);font-weight:600;">' + esc(l) + '</th>'; });
        variantsHtml += '<th style="text-align:right;padding:8px 12px;color:var(--warm-gray);font-weight:600;">Price</th></tr></thead><tbody>';
        vcView.combos.forEach(function(combo) {
          var comboObj = {};
          vcView.labels.forEach(function(l, i) { comboObj[l] = combo[i]; });
          var match = existingVariants.find(function(v) {
            return v.combo && vcView.labels.every(function(l) { return v.combo[l] === comboObj[l]; });
          });
          variantsHtml += '<tr style="border-bottom:1px solid var(--cream-dark);">';
          combo.forEach(function(val) { variantsHtml += '<td style="padding:8px 12px;">' + esc(val) + '</td>'; });
          variantsHtml += '<td style="text-align:right;padding:8px 12px;">' + (match && match.priceCents ? formatPriceCents(match.priceCents) : '<span style="color:var(--warm-gray);font-style:italic;">Not set</span>') + '</td>';
          variantsHtml += '</tr>';
        });
        variantsHtml += '</tbody></table></div></div>';
      }
    } else {
      variantsHtml += '<div style="text-align:center;padding:40px;color:var(--warm-gray);">No variant attributes defined.</div>';
    }
  }
  variantsHtml += '</div>';

  // ---- Images Tab ----
  var imagesHtml = '<div class="pd-tab-content" data-tab="images" style="' + (tab !== 'images' ? 'display:none;' : '') + 'padding:16px 0;">';
  var productImages = product.images || [];
  imagesHtml += '<div class="product-detail-section"><div class="product-detail-section-title">Product Images (' + productImages.length + ')</div>';
  if (productImages.length > 0) {
    imagesHtml += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;">';
    productImages.forEach(function(img, idx) {
      var url = resolveImageUrl(img);
      imagesHtml += '<div style="position:relative;border-radius:8px;overflow:hidden;aspect-ratio:1;background:var(--cream);">' +
        '<img src="' + esc(url) + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">' +
        (idx === 0 ? '<span style="position:absolute;top:4px;left:4px;background:var(--teal);color:white;font-size:0.72rem;padding:2px 6px;border-radius:4px;">Primary</span>' : '') +
      '</div>';
    });
    imagesHtml += '</div>';
  } else {
    imagesHtml += '<div style="text-align:center;padding:30px;color:var(--warm-gray);">No images yet.</div>';
  }
  if (isEditing && !isCreate) {
    imagesHtml += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="selectProductImageFromLibrary(\'' + esc(pid) + '\')">Select from Library</button>' +
      '<label class="btn btn-secondary" style="font-size:0.78rem;cursor:pointer;">' +
        '<input type="file" accept="image/*" style="display:none;" onchange="uploadProductImage(\'' + esc(pid) + '\', this)">' +
        'Upload New' +
      '</label>' +
    '</div>';
  }
  imagesHtml += '</div></div>';

  // ---- Production Tab ----
  var prodHtml = '<div class="pd-tab-content" data-tab="production" style="' + (tab !== 'production' ? 'display:none;' : '') + 'padding:16px 0;">';
  if (isEditing) {
    var currentBuildTime = product.buildTime !== null && product.buildTime !== undefined ? product.buildTime : '';
    // Cost to Build is edited in the Variants area (default variant pricing tab)
    // — recipe + variant pricing is the source of truth for cost.
    prodHtml += '<div class="product-detail-section"><div class="product-detail-section-title">Production Details</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
        '<div class="form-group" style="min-width:150px;"><label>Build Time (minutes)</label><input type="number" id="pdBuildTime" min="0" value="' + currentBuildTime + '" placeholder="e.g. 120"></div>' +
      '</div>' +
      '<div class="form-group"><label>Materials</label>' +
        '<div id="pdMaterialsTags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;">' +
          (Array.isArray(product.materials) ? product.materials : (product.materials ? [product.materials] : [])).map(function(m) {
            return '<span class="pd-material-tag" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--accent-light);border-radius:12px;font-size:0.78rem;">' +
              esc(m) + '<span onclick="this.parentElement.remove()" style="cursor:pointer;font-size:0.9rem;opacity:0.6;">&times;</span></span>';
          }).join('') +
        '</div>' +
        '<input type="text" id="pdMaterialsInput" placeholder="Type material name, press Enter to add" onkeydown="if(event.key===\'Enter\'){event.preventDefault();var v=this.value.trim();if(v){var tag=document.createElement(\'span\');tag.className=\'pd-material-tag\';tag.style.cssText=\'display:inline-flex;align-items:center;gap:4px;padding:4px 8px;background:var(--accent-light);border-radius:12px;font-size:0.78rem;\';tag.innerHTML=esc(v)+\'<span onclick=&quot;this.parentElement.remove()&quot; style=&quot;cursor:pointer;font-size:0.9rem;opacity:0.6;&quot;>&times;</span>\';document.getElementById(\'pdMaterialsTags\').appendChild(tag);this.value=\'\';}}">' +
      '</div>' +
      '<div class="product-detail-section-title" style="margin-top:16px;">Shipping</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;">' +
        '<div class="form-group" style="min-width:150px;"><label>Shipping Category</label>' +
          '<select id="pdShippingCategory">' +
            '<option value=""' + (!product.shippingCategory ? ' selected' : '') + '>Not set (defaults to Small)</option>' +
            '<option value="small"' + (product.shippingCategory === 'small' ? ' selected' : '') + '>Small</option>' +
            '<option value="medium"' + (product.shippingCategory === 'medium' ? ' selected' : '') + '>Medium</option>' +
            '<option value="large"' + (product.shippingCategory === 'large' ? ' selected' : '') + '>Large</option>' +
            '<option value="oversized"' + (product.shippingCategory === 'oversized' ? ' selected' : '') + '>Oversized</option>' +
          '</select></div>' +
        '<div class="form-group" style="min-width:150px;"><label>Weight (oz)</label><input type="number" id="pdWeightOz" min="0" step="0.1" value="' + (product.weightOz != null ? product.weightOz : '') + '" placeholder="e.g. 12"></div>' +
      '</div>' +
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;">' +
        '<div class="form-group" style="min-width:120px;"><label>Length (in)</label><input type="number" id="pdLengthIn" min="0" step="0.1" value="' + (product.lengthIn != null ? product.lengthIn : '') + '" placeholder="e.g. 6"></div>' +
        '<div class="form-group" style="min-width:120px;"><label>Width (in)</label><input type="number" id="pdWidthIn" min="0" step="0.1" value="' + (product.widthIn != null ? product.widthIn : '') + '" placeholder="e.g. 4"></div>' +
        '<div class="form-group" style="min-width:120px;"><label>Height (in)</label><input type="number" id="pdHeightIn" min="0" step="0.1" value="' + (product.heightIn != null ? product.heightIn : '') + '" placeholder="e.g. 3"></div>' +
      '</div>' +
    '</div>';

    // Maker Attributes (jewelry-specific, shown conditionally)
    var ma = product.makerAttributes || {};
    prodHtml += '<div id="pdMakerAttributesSection" style="display:none;">' +
      '<div class="product-detail-section">' +
        '<div class="product-detail-section-title" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onclick="toggleMakerDetails()">' +
          '<span>Maker Details</span><span id="pdMakerToggle" style="font-size:0.78rem;color:var(--warm-gray);">▼</span>' +
        '</div>' +
        '<div id="pdMakerDetailsBody">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            '<div class="form-group"><label>Metal Type</label>' +
              '<select id="pdMetalType" onchange="toggleMetalPurity()">' +
                '<option value="">—</option>' +
                '<option value="gold"' + (ma.metalType === 'gold' ? ' selected' : '') + '>Gold</option>' +
                '<option value="silver"' + (ma.metalType === 'silver' ? ' selected' : '') + '>Silver</option>' +
                '<option value="copper"' + (ma.metalType === 'copper' ? ' selected' : '') + '>Copper</option>' +
                '<option value="brass"' + (ma.metalType === 'brass' ? ' selected' : '') + '>Brass</option>' +
                '<option value="bronze"' + (ma.metalType === 'bronze' ? ' selected' : '') + '>Bronze</option>' +
                '<option value="mixed"' + (ma.metalType === 'mixed' ? ' selected' : '') + '>Mixed</option>' +
              '</select></div>' +
            '<div class="form-group" id="pdPurityGroup" style="' + (!ma.metalType || ma.metalType === '' ? 'display:none;' : '') + '"><label>Metal Purity</label>' +
              '<select id="pdMetalPurity">' +
                '<option value="">—</option>' +
                '<option value="24K"' + (ma.metalPurity === '24K' ? ' selected' : '') + '>24K</option>' +
                '<option value="18K"' + (ma.metalPurity === '18K' ? ' selected' : '') + '>18K</option>' +
                '<option value="14K"' + (ma.metalPurity === '14K' ? ' selected' : '') + '>14K</option>' +
                '<option value="10K"' + (ma.metalPurity === '10K' ? ' selected' : '') + '>10K</option>' +
                '<option value="sterling"' + (ma.metalPurity === 'sterling' ? ' selected' : '') + '>Sterling</option>' +
                '<option value="gold-filled"' + (ma.metalPurity === 'gold-filled' ? ' selected' : '') + '>Gold-Filled</option>' +
                '<option value="gold-plated"' + (ma.metalPurity === 'gold-plated' ? ' selected' : '') + '>Gold-Plated</option>' +
              '</select></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            '<div class="form-group"><label>Stone Type</label><input type="text" id="pdStoneType" value="' + esc(ma.stoneType || '') + '" placeholder="e.g. amethyst, turquoise" list="stoneSuggestions">' +
              '<datalist id="stoneSuggestions"><option value="amethyst"><option value="turquoise"><option value="labradorite"><option value="moonstone"><option value="garnet"><option value="opal"><option value="citrine"><option value="topaz"><option value="peridot"><option value="sapphire"><option value="ruby"><option value="diamond"><option value="pearl"><option value="agate"></datalist></div>' +
            '<div class="form-group"><label>Stone Cut</label>' +
              '<select id="pdStoneCut">' +
                '<option value="">—</option>' +
                '<option value="faceted"' + (ma.stoneCut === 'faceted' ? ' selected' : '') + '>Faceted</option>' +
                '<option value="cabochon"' + (ma.stoneCut === 'cabochon' ? ' selected' : '') + '>Cabochon</option>' +
                '<option value="raw"' + (ma.stoneCut === 'raw' ? ' selected' : '') + '>Raw</option>' +
                '<option value="drilled"' + (ma.stoneCut === 'drilled' ? ' selected' : '') + '>Drilled</option>' +
                '<option value="tumbled"' + (ma.stoneCut === 'tumbled' ? ' selected' : '') + '>Tumbled</option>' +
              '</select></div>' +
          '</div>' +
          '<div class="form-group"><label>Finish</label>' +
            '<select id="pdFinish">' +
              '<option value="">—</option>' +
              '<option value="polished"' + (ma.finish === 'polished' ? ' selected' : '') + '>Polished</option>' +
              '<option value="oxidized"' + (ma.finish === 'oxidized' ? ' selected' : '') + '>Oxidized</option>' +
              '<option value="brushed"' + (ma.finish === 'brushed' ? ' selected' : '') + '>Brushed</option>' +
              '<option value="hammered"' + (ma.finish === 'hammered' ? ' selected' : '') + '>Hammered</option>' +
              '<option value="matte"' + (ma.finish === 'matte' ? ' selected' : '') + '>Matte</option>' +
            '</select></div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            '<div class="form-group"><label>Length</label><input type="text" id="pdMakerLength" value="' + esc(ma.length || '') + '" placeholder="e.g. 18 inches"></div>' +
            '<div class="form-group"><label>Dimensions</label><input type="text" id="pdMakerDimensions" value="' + esc(ma.dimensions || '') + '" placeholder="e.g. 1.5&quot; x 0.75&quot;"></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            '<div class="form-group"><label>Weight</label><input type="text" id="pdMakerWeight" value="' + esc(ma.weight || '') + '" placeholder="e.g. 4.2g"></div>' +
            '<div class="form-group"><label>Ring Size</label><input type="text" id="pdMakerRingSize" value="' + esc(ma.ringSize || '') + '" placeholder="e.g. size 7 or adjustable"></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="pdOneOfAKind"' + (ma.isOneOfAKind ? ' checked' : '') + '> One of a Kind</label></div>' +
            '<div class="form-group"><label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" id="pdCustomizable"' + (ma.isCustomizable ? ' checked' : '') + '> Customizable</label></div>' +
          '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">' +
            '<div class="form-group"><label>Production Time</label><input type="text" id="pdProductionTime" value="' + esc(ma.productionTime || '') + '" placeholder="e.g. 2–3 weeks"></div>' +
            '<div class="form-group"><label>Edition</label><input type="text" id="pdEdition" value="' + esc(ma.edition || '') + '" placeholder="e.g. Limited Edition — 10 pieces"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Audit & Coaching Wedge V1 — structured dimensions/weight + technique/subtype +
    // intent-declared channels + canonicalSource placeholder (J03). Structured
    // fields live alongside the legacy flat ones above; readers prefer structured
    // and fall back to legacy weightOz/lengthIn/widthIn/heightIn.
    var dims = product.dimensions || {};
    var pw = product.weight || {};
    var intended = Array.isArray(product.intendedChannels) ? product.intendedChannels : [];
    var subtypeGated = (typeof window.playbookSubtypeRequired === 'function')
      ? !!window.playbookSubtypeRequired((window.identity && window.identity.archetype) || null)
      : false;
    prodHtml += '<div class="product-detail-section">' +
      '<div class="product-detail-section-title">Audit Schema (Wedge V1)</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">Structured fields the audit rules read. Legacy fields above stay as a fallback.</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end;">' +
        '<div class="form-group"><label>Length</label><input type="number" id="pdDimL" min="0" step="0.1" value="' + (dims.l != null ? dims.l : '') + '"></div>' +
        '<div class="form-group"><label>Width</label><input type="number" id="pdDimW" min="0" step="0.1" value="' + (dims.w != null ? dims.w : '') + '"></div>' +
        '<div class="form-group"><label>Height</label><input type="number" id="pdDimH" min="0" step="0.1" value="' + (dims.h != null ? dims.h : '') + '"></div>' +
        '<div class="form-group"><label>Unit</label><select id="pdDimUnit">' +
          '<option value="in"' + ((dims.unit || 'in') === 'in' ? ' selected' : '') + '>in</option>' +
          '<option value="cm"' + (dims.unit === 'cm' ? ' selected' : '') + '>cm</option>' +
        '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">' +
        '<div class="form-group"><label>Weight</label><input type="number" id="pdWeightValue" min="0" step="0.01" value="' + (pw.value != null ? pw.value : '') + '"></div>' +
        '<div class="form-group"><label>Weight Unit</label><select id="pdWeightUnit">' +
          '<option value="g"' + ((pw.unit || 'g') === 'g' ? ' selected' : '') + '>g</option>' +
          '<option value="oz"' + (pw.unit === 'oz' ? ' selected' : '') + '>oz</option>' +
          '<option value="lb"' + (pw.unit === 'lb' ? ' selected' : '') + '>lb</option>' +
          '<option value="kg"' + (pw.unit === 'kg' ? ' selected' : '') + '>kg</option>' +
        '</select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px;">' +
        '<div class="form-group"><label>Technique</label>' +
          '<input type="text" id="pdTechnique" value="' + esc(product.technique || '') + '" placeholder="free-text until playbook ships (J09)">' +
        '</div>' +
        '<div class="form-group"><label>Product Subtype' + (subtypeGated ? ' <span style="color:var(--accent);">*required</span>' : '') + '</label>' +
          '<input type="text" id="pdProductSubtype" value="' + esc(product.productSubtype || '') + '" placeholder="free-text until playbook ships (J09)"' + (subtypeGated ? ' data-required="true"' : '') + '>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:12px;">' +
        '<label style="display:block;margin-bottom:4px;font-size:0.85rem;">Intended Channels</label>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">Each row declares your intent for one channel. DR-06 reads these.</div>' +
        '<div id="pdIntendedChannelsList">' +
          (intended.length ? intended.map(window.pdIntendedChannelRowHtml).join('') : '') +
        '</div>' +
        '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;margin-top:4px;" onclick="pdAddIntendedChannelRow()">+ Add channel intent</button>' +
      '</div>' +
      '<div style="margin-top:12px;font-size:0.78rem;color:var(--warm-gray);">' +
        '<label>Canonical Source</label>' +
        '<div style="padding:6px 0;">V1: managed by system (always null). V2 master-of-truth graduation will populate.</div>' +
      '</div>' +
    '</div>';

    // Price history (read-only display)
    var priceHistory = product.priceHistory || [];
    if (priceHistory.length > 0) {
      prodHtml += '<div class="product-detail-section"><div class="product-detail-section-title">Price History</div>';
      priceHistory.slice().reverse().forEach(function(h) {
        prodHtml += '<div style="font-size:0.85rem;margin-bottom:4px;">' + formatPriceCents(h.value) + ' &mdash; ' + esc(h.effectiveDate) + ' <span style="color:var(--warm-gray);">(' + esc(h.changedBy || '') + ')</span></div>';
      });
      prodHtml += '</div>';
    }
  } else {
    prodHtml += '<div class="product-detail-section"><div class="product-detail-section-title">Production Details</div>' +
      '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">' +
        '<span style="color:var(--warm-gray);">Build Time</span><span>' + (product.buildTime ? product.buildTime + ' min' : '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Cost to Build</span><span>' + (product.costToBuild ? formatPriceCents(product.costToBuild) : '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Materials</span><span>' + esc(product.materials || '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Shipping Category</span><span>' + esc(product.shippingCategory || '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Weight</span><span>' + (product.weightOz ? product.weightOz + ' oz' : '—') + '</span>' +
        '<span style="color:var(--warm-gray);">Dimensions (in)</span><span>' + (product.lengthIn ? product.lengthIn + ' × ' + (product.widthIn || '—') + ' × ' + (product.heightIn || '—') : '—') + '</span>' +
      '</div></div>';

    // Maker attributes read-only (jewelry only, shown conditionally)
    var maRo = product.makerAttributes || {};
    var hasMakerAttrs = maRo.metalType || maRo.stoneType || maRo.finish || maRo.length || maRo.dimensions;
    if (hasMakerAttrs) {
      prodHtml += '<div id="pdMakerAttributesReadOnly" style="display:none;">' +
        '<div class="product-detail-section"><div class="product-detail-section-title">Maker Details</div>' +
        '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
      if (maRo.metalType) prodHtml += '<span style="color:var(--warm-gray);">Metal</span><span>' + esc((maRo.metalPurity ? maRo.metalPurity + ' ' : '') + maRo.metalType) + '</span>';
      if (maRo.stoneType) prodHtml += '<span style="color:var(--warm-gray);">Stone</span><span>' + esc(maRo.stoneType + (maRo.stoneCut ? ' (' + maRo.stoneCut + ')' : '')) + '</span>';
      if (maRo.finish) prodHtml += '<span style="color:var(--warm-gray);">Finish</span><span>' + esc(maRo.finish) + '</span>';
      if (maRo.length) prodHtml += '<span style="color:var(--warm-gray);">Length</span><span>' + esc(maRo.length) + '</span>';
      if (maRo.dimensions) prodHtml += '<span style="color:var(--warm-gray);">Dimensions</span><span>' + esc(maRo.dimensions) + '</span>';
      if (maRo.weight) prodHtml += '<span style="color:var(--warm-gray);">Weight</span><span>' + esc(maRo.weight) + '</span>';
      if (maRo.ringSize) prodHtml += '<span style="color:var(--warm-gray);">Ring Size</span><span>' + esc(maRo.ringSize) + '</span>';
      if (maRo.isOneOfAKind) prodHtml += '<span style="color:var(--warm-gray);">One of a Kind</span><span>Yes</span>';
      if (maRo.isCustomizable) prodHtml += '<span style="color:var(--warm-gray);">Customizable</span><span>Yes</span>';
      if (maRo.productionTime) prodHtml += '<span style="color:var(--warm-gray);">Production Time</span><span>' + esc(maRo.productionTime) + '</span>';
      if (maRo.edition) prodHtml += '<span style="color:var(--warm-gray);">Edition</span><span>' + esc(maRo.edition) + '</span>';
      prodHtml += '</div></div></div>';
    }

    // J03 wedge fields — read-only display when any are populated.
    var dimsRo = product.dimensions || null;
    var pwRo = product.weight || null;
    var icRo = Array.isArray(product.intendedChannels) ? product.intendedChannels : [];
    var hasWedge = dimsRo || pwRo || product.technique || product.productSubtype || icRo.length;
    if (hasWedge) {
      prodHtml += '<div class="product-detail-section"><div class="product-detail-section-title">Audit Schema (Wedge V1)</div>' +
        '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">';
      if (dimsRo) {
        var dimsStr = [dimsRo.l, dimsRo.w, dimsRo.h].map(function(n) { return n != null ? n : '—'; }).join(' × ') + ' ' + (dimsRo.unit || 'in');
        prodHtml += '<span style="color:var(--warm-gray);">Dimensions</span><span>' + esc(dimsStr) + '</span>';
      }
      if (pwRo) prodHtml += '<span style="color:var(--warm-gray);">Weight</span><span>' + esc(pwRo.value + ' ' + (pwRo.unit || 'g')) + '</span>';
      if (product.technique) prodHtml += '<span style="color:var(--warm-gray);">Technique</span><span>' + esc(product.technique) + '</span>';
      if (product.productSubtype) prodHtml += '<span style="color:var(--warm-gray);">Subtype</span><span>' + esc(product.productSubtype) + '</span>';
      if (icRo.length) {
        var icStr = icRo.map(function(r) { return r.channelKey + ': ' + r.intent; }).join(', ');
        prodHtml += '<span style="color:var(--warm-gray);">Intended Channels</span><span>' + esc(icStr) + '</span>';
      }
      prodHtml += '</div></div>';
    }
  }
  prodHtml += '</div>';

  // ---- Inventory Tab (existing, only for saved products) ----
  var invTabHtml = '';
  if (!isCreate) {
    invTabHtml = '<div class="pd-tab-content" data-tab="inventory" style="' + (tab !== 'inventory' ? 'display:none;' : '') + 'padding:16px 0;">';
    var stockType = inv.stockType || 'made-to-order';
    var threshold = inv.lowStockThreshold || 2;
    var leadTime = inv.leadTimeDays || 3;
    var notes = inv.notes || '';
    var variantInfo = getProductVariantCombos(product);
    var hasVariants = variantInfo.combos.length > 0;
    var totals = getInventoryTotals(inv);

    // ─── Per-variant inventory rows ───
    var variantsForInv = (typeof getProductVariantsForRender === 'function') ? getProductVariantsForRender(product) : [];
    var stock = (inv && inv.stock) ? inv.stock : {};

    invTabHtml += '<div style="' + _PD_STYLES.card + '">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;">' +
        '<h3 style="' + _PD_STYLES.sectionTitle + '">Stock by Variant ' +
          '<span style="font-family:\'DM Sans\',sans-serif;font-size:0.85rem;color:var(--warm-gray,#888);font-weight:400;margin-left:4px;">' + variantsForInv.length + '</span>' +
        '</h3>' +
        '<div style="display:flex;gap:6px;">' +
          '<button class="btn btn-secondary btn-small" onclick="openAdjustStockModal(\'' + esc(pid) + '\')">Adjust Stock</button>' +
          '<button class="btn btn-secondary btn-small" onclick="openHoldStockModal(\'' + esc(pid) + '\')">Hold Stock</button>' +
          (totals.held > 0 ? '<button class="btn btn-secondary btn-small" onclick="openReleaseHoldModal(\'' + esc(pid) + '\')">Release Hold (' + totals.held + ')</button>' : '') +
        '</div>' +
      '</div>';

    // Roll-up summary
    invTabHtml += '<div style="display:flex;gap:24px;align-items:baseline;margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid var(--cream-dark,#e8e0d4);flex-wrap:wrap;">' +
      '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Total on hand</div>' +
        '<div style="font-size:1.6rem;font-weight:600;color:var(--text,#2a2a2a);">' + totals.onHand + '</div></div>' +
      '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Available</div>' +
        '<div style="font-size:1.6rem;font-weight:600;color:var(--teal,#2a7c6f);">' + totals.available + '</div></div>' +
      (totals.committed > 0 ? '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Committed</div>' +
        '<div style="font-size:1.6rem;font-weight:500;color:var(--warm-gray,#888);">' + totals.committed + '</div></div>' : '') +
      (totals.held > 0 ? '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Held</div>' +
        '<div style="font-size:1.6rem;font-weight:500;color:#b45309;">' + totals.held + '</div></div>' : '') +
      (totals.damaged > 0 ? '<div><div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:2px;">Damaged</div>' +
        '<div style="font-size:1.6rem;font-weight:500;color:var(--danger,#dc2626);">' + totals.damaged + '</div></div>' : '') +
    '</div>';

    // Per-variant rows
    invTabHtml += '<div style="border:1px solid var(--cream-dark,#e8e0d4);border-radius:10px;overflow:hidden;">';
    invTabHtml += '<div style="display:grid;grid-template-columns:1.5fr repeat(4,1fr);gap:16px;padding:10px 18px;background:var(--cream,#f5f0e8);font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.06em;font-weight:600;">' +
      '<div>Variant</div>' +
      '<div style="text-align:right;">On Hand</div>' +
      '<div style="text-align:right;">Available</div>' +
      '<div style="text-align:right;">Committed</div>' +
      '<div style="text-align:right;">Held / Damaged</div>' +
    '</div>';

    variantsForInv.forEach(function(variant, vi) {
      var stockKey = variant._isSynthetic ? '_default' : variant.id;
      var entry = stock[stockKey];
      if (!entry && variant._isSynthetic && typeof inv.stock === 'number') {
        entry = { onHand: inv.stock, committed: 0, held: 0, damaged: 0 };
      }
      var onH = (entry && entry.onHand) || 0;
      var com = (entry && entry.committed) || 0;
      var hel = (entry && entry.held) || 0;
      var dam = (entry && entry.damaged) || 0;
      var avail = Math.max(0, onH - com - hel - dam);
      var label = (typeof variantComboLabel === 'function') ? variantComboLabel(variant) : (variant.id || 'Variant');

      var rowBg = vi % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)';
      var availColor = avail <= 0 ? 'var(--danger,#dc2626)' : (avail <= threshold ? '#b45309' : 'var(--text,#2a2a2a)');
      var heldDamaged = (hel > 0 || dam > 0)
        ? (hel > 0 ? hel + ' held' : '') + (hel > 0 && dam > 0 ? ' · ' : '') + (dam > 0 ? dam + ' damaged' : '')
        : '<span style="color:var(--warm-gray-light,#aaa);">—</span>';

      invTabHtml += '<div style="display:grid;grid-template-columns:1.5fr repeat(4,1fr);gap:16px;padding:14px 18px;align-items:center;background:' + rowBg + ';' + (vi < variantsForInv.length - 1 ? 'border-bottom:1px solid var(--cream-dark,#e8e0d4);' : '') + '">' +
        '<div style="font-weight:500;color:var(--text,#2a2a2a);">' + esc(label) + '</div>' +
        '<div style="text-align:right;font-family:monospace;font-size:1rem;font-weight:500;color:var(--text,#2a2a2a);">' + onH + '</div>' +
        '<div style="text-align:right;font-family:monospace;font-size:1rem;font-weight:600;color:' + availColor + ';">' + avail + '</div>' +
        '<div style="text-align:right;font-family:monospace;color:var(--warm-gray);">' + (com > 0 ? com : '<span style="color:var(--warm-gray-light,#aaa);">—</span>') + '</div>' +
        '<div style="text-align:right;font-size:0.85rem;color:var(--warm-gray);">' + heldDamaged + '</div>' +
      '</div>';
    });

    invTabHtml += '</div>';
    invTabHtml += '</div>';

    // Inventory History
    invTabHtml += '<div class="product-detail-section">' +
      '<div class="product-detail-section-title">Inventory History</div>' +
      '<div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:10px;">' +
        '<div class="form-group" style="margin:0;min-width:120px;"><label style="font-size:0.72rem;">Action</label>' +
          '<select id="invHistActionFilter" onchange="renderInventoryHistory()" style="font-size:0.78rem;padding:5px 8px;">' +
            '<option value="all">All</option>' +
            '<option value="reserved">Reserved</option>' +
            '<option value="shipped">Shipped</option>' +
            '<option value="released">Released</option>' +
            '<option value="adjusted">Adjusted</option>' +
            '<option value="restocked">Restocked</option>' +
            '<option value="recount">Recount</option>' +
            '<option value="sale">Sold</option>' +
          '</select></div>' +
        '<div class="form-group" style="margin:0;"><label style="font-size:0.72rem;">From</label>' +
          '<input type="date" id="invHistDateStart" onchange="renderInventoryHistory()" style="font-size:0.78rem;padding:5px 8px;"></div>' +
        '<div class="form-group" style="margin:0;"><label style="font-size:0.72rem;">To</label>' +
          '<input type="date" id="invHistDateEnd" onchange="renderInventoryHistory()" style="font-size:0.78rem;padding:5px 8px;"></div>' +
      '</div>' +
      '<div id="pdInventoryHistory" style="font-size:0.85rem;color:var(--warm-gray);">Loading...</div>' +
    '</div>';

    // Stock settings (AFTER inventory)
    var productionLead = inv.productionLeadTimeDays || '';
    var fulfillmentDays = inv.stockFulfillmentDays || 2;
    var isStockTracked = (stockType === 'strict' || stockType === 'stock-to-build' || stockType === 'in-stock' || stockType === 'limited');
    invTabHtml += '<div class="product-detail-section">' +
      '<div class="product-detail-section-title">Stock Settings</div>' +
      '<div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;">' +
        '<div class="form-group" style="margin:0;min-width:170px;"><label style="font-size:0.78rem;">Inventory Mode</label>' +
          '<select id="pdStockType" onchange="pdStockTypeChanged(\'' + esc(pid) + '\')">' +
            '<option value="build-to-order"' + (stockType === 'build-to-order' || stockType === 'made-to-order' ? ' selected' : '') + '>Build to Order</option>' +
            '<option value="strict"' + (stockType === 'strict' || stockType === 'in-stock' || stockType === 'limited' ? ' selected' : '') + '>Strict (stock only)</option>' +
            '<option value="stock-to-build"' + (stockType === 'stock-to-build' ? ' selected' : '') + '>Stock to Build</option>' +
          '</select></div>' +
        '<div class="form-group" style="margin:0;" id="pdThresholdGroup"' + (!isStockTracked ? ' hidden' : '') + '>' +
          '<label style="font-size:0.78rem;">Low Stock Alert At</label>' +
          '<input type="number" id="pdThreshold" min="0" value="' + threshold + '" style="width:80px;"></div>' +
        '<div class="form-group" style="margin:0;" id="pdFulfillmentGroup"' + (!isStockTracked ? ' hidden' : '') + '>' +
          '<label style="font-size:0.78rem;">Fulfillment Days</label>' +
          '<input type="number" id="pdFulfillmentDays" min="0" value="' + fulfillmentDays + '" style="width:80px;" title="Days to ship in-stock items"></div>' +
      '</div>' +
      '<div style="display:flex;gap:16px;align-items:flex-end;flex-wrap:wrap;margin-top:12px;">' +
        '<div class="form-group" style="margin:0;" id="pdProductionLeadGroup"' + (stockType === 'strict' || stockType === 'in-stock' || stockType === 'limited' ? ' hidden' : '') + '>' +
          '<label style="font-size:0.78rem;">Production Lead Time (days)</label>' +
          '<input type="number" id="pdProductionLeadTime" min="0" value="' + productionLead + '" style="width:100px;" placeholder="e.g. 14" title="Days to produce when built to order"></div>' +
        '<div class="form-group" style="margin:0;"><label style="font-size:0.78rem;">Lead Time (days, legacy)</label>' +
          '<input type="number" id="pdLeadTime" min="0" value="' + leadTime + '" style="width:80px;"></div>' +
      '</div>' +
      '<div class="form-group" style="margin-top:12px;"><label style="font-size:0.78rem;">Notes</label>' +
        '<textarea id="pdNotes" rows="2" placeholder="e.g. Need more cobalt glass rods">' + esc(notes) + '</textarea></div>' +
      '<button class="btn btn-primary" style="font-size:0.78rem;margin-top:8px;" onclick="saveProductSettings(\'' + esc(pid) + '\')">Save Stock Settings</button>' +
    '</div>';

    invTabHtml += '</div>';
  }

  // Action buttons (save/cancel when editing, nothing when viewing — back arrow at top handles navigation)
  var actionHtml = '';
  if (isEditing) {
    var saveLabel = isCreate ? 'Create Product' : 'Save';
    var cancelAction = isCreate ? 'backToProducts()' : 'cancelProductEdit(\'' + esc(pid) + '\')';
    var saveAction = 'saveProduct(\'' + esc(pid || '') + '\')';
    actionHtml = '<div id="pdSaveButtons" style="display:flex;gap:8px;margin-top:20px;padding-top:16px;border-top:1px solid var(--cream-dark);">' +
      '<button class="btn btn-primary" onclick="' + saveAction + '">' + saveLabel + '</button>' +
      '<button class="btn btn-secondary" onclick="' + cancelAction + '">Cancel</button>' +
    '</div>' +
    '<div id="pdStickySaveBar" style="display:none;position:fixed;bottom:0;left:0;right:0;z-index:999;background:var(--surface-dark);border-top:2px solid var(--primary);padding:10px 24px;box-shadow:0 -2px 8px rgba(0,0,0,0.3);">' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;max-width:1200px;margin:0 auto;">' +
        '<button class="btn btn-primary" onclick="' + saveAction + '">' + saveLabel + '</button>' +
        '<button class="btn btn-secondary" onclick="' + cancelAction + '">Cancel</button>' +
      '</div>' +
    '</div>';
  }

  // Back-label resolution priority:
  //   1. MastNavStack top (the route that spawned this detail — Forecast,
  //      Sales-by-Product, Customer detail, etc.). This is the user-facing
  //      promise: "the return link goes back to the page that spawned it."
  //   2. productViewOrigin === 'inventory' for the legacy inventory drill-in
  //      (which uses viewProductFromInventory's own push).
  //   3. Default to the catalog list.
  var backLabel;
  if (window.MastNavStack && MastNavStack.size && MastNavStack.size() > 0 && MastNavStack.label) {
    var _navLbl = MastNavStack.label();
    backLabel = _navLbl ? ('Back to ' + _navLbl) : 'Back to Products';
  } else if (productViewOrigin === 'inventory') {
    backLabel = 'Back to Inventory';
  } else {
    backLabel = 'Back to Products';
  }
  var publishUndoHtml = (!isCreate && pid) ? renderPublishUndoBanner(pid) : '';
  var driftAlertHtml = (!isCreate && pid) ? renderDriftAlertBanner(pid) : '';
  // Build 6c — Customer Signal card. Lazy-loads tickets/reviews/orders
  // and computes a per-SKU rollup mirroring the server-side
  // cs_get_product_signal + get_sku_repurchase tools. Renders only on
  // existing products (skip during create).
  // Customer Signal is on-demand — the underlying load fans out to ~3,500
  // Firestore docs (cs_reviews + cs_tickets + orders + admin/rma). The card is
  // a collapse/expand toggle; expansion state is tracked per-pid in
  // _pdCustomerSignalExpanded (USER INTENT — not cache presence) so tab clicks
  // re-render with whatever state the user last set. Defaults to collapsed.
  window._pdCustomerSignalExpanded = window._pdCustomerSignalExpanded || Object.create(null);
  var isExpanded = window._pdCustomerSignalExpanded[pid] === true;
  var hasCachedSignal = !!(window._pdCustomerSignalCache && window._pdCustomerSignalCache[pid]);
  var expandedAttr = isExpanded ? ' data-expanded="true"' : ' data-expanded="false"';
  var chevronInitial = isExpanded ? '&#9662;' : '&#9656;'; // ▾ vs ▸
  // If user wants it expanded AND we have cache, inline the content (no flash).
  // If expanded but no cache yet, content stays empty — toggle fn fetches on render.
  var contentInitial = (isExpanded && hasCachedSignal) ? window._pdCustomerSignalCache[pid].html : '';
  var customerSignalHtml = (!isCreate && pid && !isEditing)
    ? '<div id="pdCustomerSignal" data-pid="' + esc(pid) + '"' + expandedAttr + ' style="padding:16px 0;">' +
        '<div onclick="toggleProductCustomerSignal(\'' + esc(pid) + '\')" role="button" tabindex="0" aria-expanded="' + (isExpanded ? 'true' : 'false') + '" aria-label="Toggle customer signal" style="border:1px solid var(--border,#e5e0d8);border-radius:8px;padding:14px 18px;display:flex;align-items:center;justify-content:space-between;gap:16px;background:var(--surface-card,#fff);cursor:pointer;user-select:none;">' +
          '<div>' +
            '<div style="font-size:0.85rem;font-weight:600;color:var(--text-primary);text-transform:uppercase;letter-spacing:0.04em;">Customer Signal</div>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Reviews, repurchase rate, return reasons, and often-bought-together &mdash; per this product.</div>' +
          '</div>' +
          '<span id="pdCustomerSignalChevron" aria-hidden="true" style="font-size:1.0rem;color:var(--warm-gray);flex-shrink:0;transition:transform 0.15s;">' + chevronInitial + '</span>' +
        '</div>' +
        '<div id="pdCustomerSignalContent" style="' + (isExpanded ? '' : 'display:none;') + '">' + contentInitial + '</div>' +
      '</div>'
    : '';
  el.innerHTML = '<button class="detail-back" onclick="backToProducts()">&larr; ' + backLabel + '</button>' +
    publishUndoHtml + driftAlertHtml + recipeReadyHtml + headerHtml + versionLinkBannerHtml + revisionBannerHtml + archivedBannerHtml + tabBarHtml + detailsHtml + variantsHtml + imagesHtml + prodHtml + invTabHtml + customerSignalHtml + actionHtml;
  // Lazy-fill the variant master-detail section (extracted to
  // modules/variant-detail-tabs.js). The #pdVariantSectionMount placeholder was
  // emitted above; load the module then inject the rendered section.
  _fillVariantSectionMount(product);
  // Edge case: user wants it expanded (tracked above), but cache expired
  // or got cleared between renders → kick off a fresh load to populate.
  if (customerSignalHtml && isExpanded && !contentInitial) {
    loadProductCustomerSignal(pid);
  }

  // Channel-First Phase 2d (D24) — async-load recipe meta when product has a
  // linked recipe but we haven't read it yet. Re-render to paint the banner.
  if (!isCreate && pid && product.recipeId && !window.__mastRecipeMetaCache[product.recipeId]) {
    loadRecipeMeta(product.recipeId).then(function(meta) {
      // Only re-render if the freshly-loaded meta would change banner visibility
      if (meta && meta.publishedPrices) {
        var ackVersion = (typeof product.recipeVersion === 'number') ? product.recipeVersion : 0;
        if (meta.version > ackVersion) renderProductDetail(pid);
      }
    });
  }

  // Load drift alerts asynchronously on first render
  if (!isCreate && pid && !window.__mastDriftAlerts[pid]) {
    loadDriftAlerts(pid).then(function(alerts) {
      if (alerts && alerts.length > 0) renderProductDetail(pid);
    });
  }

  // Load recipe drift data asynchronously for drift badges
  if (!isCreate && product.recipeId && !window.__mastRecipeDrift[product.recipeId]) {
    loadRecipeDrift(product.recipeId).then(function(drift) {
      if (drift) renderProductDetail(pid);
    });
  }

  // Load inventory history if starting on inventory tab
  if (tab === 'inventory' && pid) {
    loadProductInventoryHistory(pid);
  }

  // Sticky save bar — show when original save buttons scroll out of view
  if (isEditing) {
    var saveBtns = document.getElementById('pdSaveButtons');
    var stickyBar = document.getElementById('pdStickySaveBar');
    if (saveBtns && stickyBar && window.IntersectionObserver) {
      if (window._pdStickyObserver) window._pdStickyObserver.disconnect();
      window._pdStickyObserver = new IntersectionObserver(function(entries) {
        stickyBar.style.display = entries[0].isIntersecting ? 'none' : 'block';
      }, { threshold: 0.1 });
      window._pdStickyObserver.observe(saveBtns);
    }
  } else if (window._pdStickyObserver) {
    window._pdStickyObserver.disconnect();
    window._pdStickyObserver = null;
  }
}

  window.renderProductsImpl = renderProducts;
  window.renderInventoryOverviewImpl = renderInventoryOverview;
  window.switchProductTabImpl = switchProductTab;
  window.renderProductDetailImpl = renderProductDetail;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('productsEngine', {});
  }
})();
