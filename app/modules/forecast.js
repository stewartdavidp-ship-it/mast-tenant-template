// app/modules/forecast.js  (T1 extraction)
//
// Demand Forecast + Sales-by-Product surfaces, extracted byte-identical from the
// inline block in index.html. Top-level functions remain window globals (the
// inline block is not an IIFE), so route-dispatch setup() handlers and the
// Products list filter chips still resolve _ensureProductSalesMap et al.
//
// Eager (defer) module: route handlers run post-load, after this script executes.

var forecastData = null;       // Cached computation result
var forecastOrdersLoaded = false;
var forecastOrders = {};       // Separate read with limitToLast(500)
var forecastTimeHorizon = 'adaptive'; // 'adaptive' | '30d' | '90d' | 'all'
var forecastDemandSort = { col: 'trending', asc: false };
var forecastSlowExpanded = false;

// W1.2: shared demand-data helpers. The same productSales map computed by
// the Forecast Demand Overview is reused by the Products list filter
// chips ("No demand 90d", "Trending up") so both surfaces stay in sync.
function _buildProductSalesMap(orderMap) {
  var now = Date.now();
  var DAY_MS = 86400000;
  var d30 = now - 30 * DAY_MS;
  var d60 = now - 60 * DAY_MS;
  var d90 = now - 90 * DAY_MS;
  var d150 = now - 150 * DAY_MS;
  var d180 = now - 180 * DAY_MS;
  // W2.1: real prior-window buckets (prior30 = days 31-60, prior90 = days 91-180)
  // for accurate Δ% on Demand Overview. Legacy prior60of30/prior60of90 fields
  // remain populated so existing chip math (Products list "Trending up" at
  // line ~32252, count-row at ~32486) keeps working — new code should read
  // prior30 / prior90 directly. Revenue tracked in cents, per window, via
  // item.priceCents (matches sales.js:307 pattern). hasPriceData flag lets
  // the UI render "—" rather than misleading $0 when an order is missing
  // priceCents (legacy seed data).
  var productSales = {};
  Object.keys(orderMap || {}).forEach(function(ordKey) {
    var ord = orderMap[ordKey];
    if (!ord || !ord.items || !ord.items.length) return;
    var ts = new Date(ord.placedAt || ord.createdAt || '').getTime();
    if (isNaN(ts)) return;
    ord.items.forEach(function(item) {
      if (!item.pid) return;
      var qty = item.qty || 1;
      var lineCents = (typeof item.priceCents === 'number') ? (item.priceCents * qty) : 0;
      if (!productSales[item.pid]) {
        productSales[item.pid] = {
          last30: 0, last90: 0, allTime: 0,
          prior60of30: 0, prior60of90: 0,
          prior30: 0, prior90: 0,
          revenue30: 0, revenue90: 0, revenueAll: 0,
          revenuePrior30: 0, revenuePrior90: 0,
          hasPriceData: false,
          lastOrdered: null
        };
      }
      var ps = productSales[item.pid];
      ps.allTime += qty;
      ps.revenueAll += lineCents;
      if (lineCents > 0) ps.hasPriceData = true;
      if (ts >= d90) { ps.last90 += qty; ps.revenue90 += lineCents; }
      if (ts >= d30) { ps.last30 += qty; ps.revenue30 += lineCents; }
      if (ts >= d90 && ts < d30) ps.prior60of30 += qty;
      if (ts >= d150 && ts < d90) ps.prior60of90 += qty;
      if (ts >= d60 && ts < d30) { ps.prior30 += qty; ps.revenuePrior30 += lineCents; }
      if (ts >= d180 && ts < d90) { ps.prior90 += qty; ps.revenuePrior90 += lineCents; }
      if (!ps.lastOrdered || (ord.placedAt || ord.createdAt) > ps.lastOrdered) {
        ps.lastOrdered = ord.placedAt || ord.createdAt;
      }
    });
  });
  return productSales;
}

// Returns the current cached productSales map (or null if not yet loaded)
// and triggers a load if missing. Callers should re-check after the
// returned promise resolves. Cached on window._mastProductSalesMap so
// repeated calls don't re-scan the order history.
function _ensureProductSalesMap(cb) {
  if (window._mastProductSalesMap) {
    if (cb) cb(window._mastProductSalesMap);
    return Promise.resolve(window._mastProductSalesMap);
  }
  if (forecastOrdersLoaded) {
    window._mastProductSalesMap = _buildProductSalesMap(forecastOrders);
    if (cb) cb(window._mastProductSalesMap);
    return Promise.resolve(window._mastProductSalesMap);
  }
  return MastDB.orders.query().limitToLast(500).once('value').then(function(snap) {
    forecastOrders = snap.val() || {};
    forecastOrdersLoaded = true;
    window._mastProductSalesMap = _buildProductSalesMap(forecastOrders);
    if (cb) cb(window._mastProductSalesMap);
    return window._mastProductSalesMap;
  }).catch(function() { if (cb) cb(null); return null; });
}

function loadAndRenderForecast() {
  // Ensure products and inventory are loaded
  if (!productsLoaded) loadProducts();
  if (!salesEventsLoaded) loadSalesEvents();
  // Load orders with limitToLast(500) for forecast (separate from main orders listener)
  if (!forecastOrdersLoaded) {
    MastDB.orders.query().limitToLast(500).once('value').then(function(snap) {
      forecastOrders = snap.val() || {};
      forecastOrdersLoaded = true;
      computeAndRenderForecast();
    }).catch(function(err) {
      showToast('Error loading order history for forecast: ' + err.message, true);
    });
  } else {
    computeAndRenderForecast();
  }
}

function computeAndRenderForecast() {
  if (!productsLoaded || !forecastOrdersLoaded) return;

  // W1.2: single source of truth — same map the Products-list filter
  // chips read. _buildProductSalesMap was extracted from this loop and
  // produces identical output, so behavior is unchanged.
  var productSales = _buildProductSalesMap(forecastOrders);
  window._mastProductSalesMap = productSales;

  // W2.1: per-product unit-cost lookup from recipes (productId -> unitCost).
  // recipesData is encapsulated in the maker module; we lazy-load a parallel
  // cache here so Forecast can render Margin without requiring the user to
  // visit Maker first. If the cache is missing, trigger a one-time load and
  // re-fire computeAndRenderForecast on resolution. Subsequent renders use
  // the cached map. Margin renders "—" for products with no active recipe.
  if (!window._mastRecipeCostByProduct) {
    if (!window._mastRecipeCostLoading) {
      window._mastRecipeCostLoading = true;
      MastDB.recipes.list(200).then(function(recipeMap) {
        var costByProduct = {};
        Object.keys(recipeMap || {}).forEach(function(rid) {
          var r = recipeMap[rid];
          if (!r || !r.productId || r.status === 'archived') return;
          // First active recipe wins; in practice most products have one.
          if (typeof costByProduct[r.productId] === 'undefined' && typeof r.unitCost === 'number') {
            costByProduct[r.productId] = r.unitCost;
          }
        });
        window._mastRecipeCostByProduct = costByProduct;
        window._mastRecipeCostLoading = false;
        computeAndRenderForecast();
      }).catch(function() {
        // Failed lookup — set empty map so Margin renders "—" instead of
        // blocking the Forecast view forever.
        window._mastRecipeCostByProduct = {};
        window._mastRecipeCostLoading = false;
        computeAndRenderForecast();
      });
    }
    // Render-with-placeholder approach: continue rendering this pass; recipe
    // costs will arrive on the next compute call. Margin column will show "—"
    // on the first paint and update on the second.
  }
  var recipeCostByProduct = window._mastRecipeCostByProduct || {};

  // Build forecast per production product
  var forecasts = [];
  productsData.forEach(function(p) {
    // Filter: production line only (production or missing businessLine)
    if (p.businessLine === 'sculpture') return;

    var pid = p.pid;
    var inv = inventory[pid] || {};
    var stock = (inv.stock && inv.stock._default) ? (inv.stock._default.available || 0) : 0;
    var ps = productSales[pid] || {
      last30: 0, last90: 0, allTime: 0,
      prior60of30: 0, prior60of90: 0,
      prior30: 0, prior90: 0,
      revenue30: 0, revenue90: 0, revenueAll: 0,
      revenuePrior30: 0, revenuePrior90: 0,
      hasPriceData: false,
      lastOrdered: null
    };

    // Adaptive windowing: classify velocity
    var avgPerMonth90 = ps.last90 / 3;
    var isFastMover = avgPerMonth90 >= 10;
    var windowDays = isFastMover ? 30 : 90;
    var windowWeeks = windowDays / 7;
    var recentSold = isFastMover ? ps.last30 : ps.last90;
    var priorAvgMonthly = isFastMover ? (ps.prior60of30 / 2) : (ps.prior60of90 / 2);
    var weeksCoverage = recentSold > 0 ? Math.round((stock / (recentSold / windowWeeks)) * 10) / 10 : (stock > 0 ? 999 : 0);

    // W2.1: real prior-period counts per horizon (resolves OPEN -OtEO_4RncYB1m7hCbiZ).
    // prior30 = days 31-60, prior90 = days 91-180. allTime/adaptive horizons
    // expose `priorPeriodSold` so the renderer can show "—" vs an Δ% chip.
    var priorAdaptive = isFastMover ? ps.prior30 : ps.prior90;
    var deltaPct30 = ps.prior30 > 0 ? ((ps.last30 - ps.prior30) / ps.prior30) * 100 : null;
    var deltaPct90 = ps.prior90 > 0 ? ((ps.last90 - ps.prior90) / ps.prior90) * 100 : null;
    var deltaPctAdaptive = isFastMover ? deltaPct30 : deltaPct90;

    // Trending detection
    var prior30Avg = ps.prior60of30 / 2; // avg per 30d from prior 60d
    var trending = ps.last30 >= 3 && prior30Avg > 0 && ps.last30 >= 1.5 * prior30Avg;
    var declining = prior30Avg > 0 && ps.last30 < 0.67 * prior30Avg;

    // Stock type
    var isStocked = !p.madeToOrder;
    var isMTO = !!p.madeToOrder;

    // Suggested build trigger
    var suggestBuild = isStocked && stock < recentSold && recentSold > 0;
    var suggestedQty = suggestBuild ? Math.ceil((recentSold - stock) / 5) * 5 : 0;
    if (suggestedQty < 5 && suggestBuild) suggestedQty = 5;

    // MTO "consider stocking" — trending threshold >=10 in 90d
    var considerStocking = isMTO && ps.last90 >= 10;

    // Slow/no movement
    var noMovement = stock > 0 && recentSold === 0;

    // Monthly rate for display
    var monthlyRate = recentSold / (windowDays / 30);

    // W2.1: Margin = revenue − units × current recipe unit cost.
    // recipeUnitCost is the recipe's totalCost (per-unit). null if no active
    // recipe — UI renders "—" for Margin in that case. Per W2 spec this is
    // gross margin (current cost basis), NOT contribution margin — that's W3.
    var recipeUnitCost = (typeof recipeCostByProduct[pid] === 'number') ? recipeCostByProduct[pid] : null;
    function _marginCents(revCents, units) {
      if (recipeUnitCost === null) return null;
      return revCents - Math.round(units * recipeUnitCost * 100);
    }

    forecasts.push({
      pid: pid,
      name: p.name,
      categories: p.categories || [],
      images: p.images || [],
      stock: stock,
      recentSold: recentSold,
      priorAvgMonthly: priorAvgMonthly,
      monthlyRate: Math.round(monthlyRate * 10) / 10,
      weeksCoverage: weeksCoverage,
      trending: trending,
      declining: declining,
      isStocked: isStocked,
      isMTO: isMTO,
      suggestBuild: suggestBuild,
      suggestedQty: suggestedQty,
      considerStocking: considerStocking,
      noMovement: noMovement,
      lastOrdered: ps.lastOrdered,
      allTimeSold: ps.allTime,
      windowDays: windowDays,
      isFastMover: isFastMover,
      // Raw data for time horizon override display
      last30: ps.last30,
      last90: ps.last90,
      // W2.1: prior-period counts (real, not normalized)
      prior30: ps.prior30,
      prior90: ps.prior90,
      priorAdaptive: priorAdaptive,
      // W2.1: per-horizon Δ% (null when prior=0 → UI renders "—")
      deltaPct30: deltaPct30,
      deltaPct90: deltaPct90,
      deltaPctAdaptive: deltaPctAdaptive,
      // W2.1: revenue in cents, per horizon
      revenue30Cents: ps.revenue30,
      revenue90Cents: ps.revenue90,
      revenueAllCents: ps.revenueAll,
      revenuePrior30Cents: ps.revenuePrior30,
      revenuePrior90Cents: ps.revenuePrior90,
      hasPriceData: ps.hasPriceData,
      // W2.1: margin in cents per horizon; null if no recipe
      recipeUnitCost: recipeUnitCost,
      margin30Cents: _marginCents(ps.revenue30, ps.last30),
      margin90Cents: _marginCents(ps.revenue90, ps.last90),
      marginAllCents: _marginCents(ps.revenueAll, ps.allTime)
    });
  });

  forecastData = forecasts;

  // Render all sections
  renderForecastEventBanner();
  renderForecastSuggestedBuilds();
  // W1.8: fan-out so #salesByProductOverview gets the same table on
  // the Sales-by-Product tab when that's the active surface.
  _renderAllDemandOverviewSurfaces();
  renderForecastSlowMovement();
}

// ---- Event Banner ----
function renderForecastEventBanner() {
  var el = document.getElementById('forecastEventBanner');
  if (!el) return;
  el.innerHTML = '';

  var now = Date.now();
  var DAY_MS = 86400000;
  var cutoff60 = now + 60 * DAY_MS;

  // Find upcoming events within 60 days
  var upcoming = [];
  Object.keys(salesEventsData).forEach(function(k) {
    var ev = salesEventsData[k];
    if (ev.status === 'complete' || ev.status === 'completed') return;
    var evDate = new Date(ev.date).getTime();
    if (isNaN(evDate)) return;
    if (evDate > now && evDate <= cutoff60) {
      var daysAway = Math.ceil((evDate - now) / DAY_MS);
      upcoming.push({ key: k, name: ev.name || ev.eventName || 'Unnamed Event', date: ev.date, daysAway: daysAway });
    }
  });

  if (upcoming.length === 0) return;

  // Check for seasonal products (trending now, also sold well in same month prior year)
  var seasonalProducts = [];
  if (forecastData) {
    var currentMonth = new Date().getMonth();
    var priorYearStart = new Date();
    priorYearStart.setFullYear(priorYearStart.getFullYear() - 1);
    priorYearStart.setDate(1);
    var priorYearEnd = new Date(priorYearStart);
    priorYearEnd.setMonth(priorYearEnd.getMonth() + 1);

    forecastData.forEach(function(f) {
      if (!f.trending) return;
      // Check prior year same month orders
      var priorMonthSales = 0;
      Object.keys(forecastOrders).forEach(function(ordKey) {
        var ord = forecastOrders[ordKey];
        if (!ord.items) return;
        var ts = new Date(ord.placedAt || ord.createdAt || '').getTime();
        var ordDate = new Date(ts);
        if (ordDate.getMonth() === currentMonth && ordDate.getFullYear() === new Date().getFullYear() - 1) {
          ord.items.forEach(function(item) {
            if (item.pid === f.pid) priorMonthSales += (item.qty || 1);
          });
        }
      });
      // "Above average" = prior year same month had > priorAvgMonthly
      if (priorMonthSales > f.priorAvgMonthly && priorMonthSales > 0) {
        seasonalProducts.push(f.name);
      }
    });
  }

  var html = '';
  upcoming.sort(function(a, b) { return a.daysAway - b.daysAway; });
  upcoming.forEach(function(ev) {
    var isUrgent = ev.daysAway <= 14;
    var bgColor = isUrgent ? 'rgba(230,81,0,0.15)' : 'rgba(249,168,37,0.15)';
    var borderColor = isUrgent ? 'rgba(230,81,0,1)' : 'rgba(249,168,37,1)';
    var textColor = isUrgent ? 'rgba(255,152,0,1)' : 'rgba(251,192,45,1)';
    html += '<div style="background:' + bgColor + ';border:1px solid ' + borderColor + ';border-radius:8px;padding:12px 16px;margin-bottom:12px;cursor:pointer;" onclick="navigateTo(\'events\')">' +
      '<div style="font-weight:600;color:' + textColor + ';">&#x1F4C5; ' + esc(ev.name) + ' in ' + ev.daysAway + ' days &mdash; review your inventory before building.</div>' +
    '</div>';
  });

  if (seasonalProducts.length > 0) {
    html += '<div style="background:rgba(76,175,80,0.15);border:1px solid rgba(76,175,80,1);border-radius:8px;padding:12px 16px;margin-bottom:12px;">' +
      '<div style="font-weight:600;color:rgba(76,175,80,1);">Trending products that spiked before past events: ' + seasonalProducts.map(function(n) { return esc(n); }).join(', ') + '</div>' +
    '</div>';
  }

  el.innerHTML = html;
}

// ---- Suggested Builds ----
function renderForecastSuggestedBuilds() {
  var el = document.getElementById('forecastSuggestedBuilds');
  if (!el || !forecastData) return;

  // Check for upcoming events
  var now = Date.now();
  var DAY_MS = 86400000;
  var hasUpcomingEvent = Object.keys(salesEventsData).some(function(k) {
    var ev = salesEventsData[k];
    if (ev.status === 'complete' || ev.status === 'completed') return false;
    var evDate = new Date(ev.date).getTime();
    return !isNaN(evDate) && evDate > now && evDate <= now + 60 * DAY_MS;
  });

  var stocked = forecastData.filter(function(f) { return f.suggestBuild; });
  var mtoConsider = forecastData.filter(function(f) { return f.considerStocking; });

  if (stocked.length === 0 && mtoConsider.length === 0) {
    el.innerHTML = '';
    return;
  }

  // Sort: trending first, then by weeksCoverage ascending
  stocked.sort(function(a, b) {
    if (a.trending !== b.trending) return a.trending ? -1 : 1;
    return a.weeksCoverage - b.weeksCoverage;
  });

  var html = '<h3 style="margin:24px 0 12px 0;font-size:1.15rem;">Suggested Builds</h3>';
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">';

  stocked.forEach(function(f) {
    var imgUrl = firstProductImage(f);
    var catBadge = (f.categories && f.categories.length) ? f.categories[0] : '';
    var reasons = [];
    if (f.stock < f.recentSold) reasons.push('Low Stock');
    if (f.trending) reasons.push('Trending &#x2191;');
    if (hasUpcomingEvent) reasons.push('Upcoming Event');

    // W1.4: title + image area is a link to product detail. Create Job
    // button below stays unaffected since the click handler is on the
    // header div only, not the whole card.
    html += '<div style="background:var(--cream,rgba(245,240,232,1));border:1px solid var(--cream-dark,rgba(232,224,212,1));border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px;">' +
      // W1-followup: same data-view-pid + global delegated handler pattern.
      '<div role="link" tabindex="0" data-view-pid="' + esc(f.pid) + '" style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;border-radius:6px;padding:2px;" onmouseover="this.style.background=\'rgba(127,127,127,0.12)\';" onmouseout="this.style.background=\'transparent\';">' +
        (imgUrl ? '<img src="' + esc(imgUrl) + '" style="width:56px;height:56px;border-radius:8px;object-fit:cover;" loading="lazy">' : '<div style="width:56px;height:56px;border-radius:8px;background:var(--cream-dark,rgba(232,224,212,1));display:flex;align-items:center;justify-content:center;font-size:1.6rem;">&#x1F3A8;</div>') +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:600;font-size:0.9rem;">' + esc(f.name) + '</div>' +
          (catBadge ? '<span style="background:var(--cream-dark,rgba(232,224,212,1));padding:2px 8px;border-radius:4px;font-size:0.72rem;color:var(--warm-gray);">' + esc(catBadge) + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">' +
        f.stock + ' in stock &middot; Selling ' + f.monthlyRate + '/mo &middot; ~' + (f.weeksCoverage < 999 ? f.weeksCoverage + ' weeks' : '&#x221E;') + ' of stock' +
      '</div>' +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        reasons.map(function(r) {
          var bg = r.indexOf('Trending') >= 0 ? 'rgba(46,125,50,0.15)' : r.indexOf('Event') >= 0 ? 'rgba(230,81,0,0.15)' : 'rgba(245,127,23,0.15)';
          var color = r.indexOf('Trending') >= 0 ? 'rgba(76,175,80,1)' : r.indexOf('Event') >= 0 ? 'rgba(255,152,0,1)' : 'rgba(251,192,45,1)';
          return '<span style="background:' + bg + ';color:' + color + ';padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">' + r + '</span>';
        }).join('') +
      '</div>' +
      // W1-followup OPEN -OtEkpFjIRwH_z-1CJuB: data-attrs + delegated handler
      // instead of inline onclick with esc(pid) interpolated into a JS string.
      // esc() is HTML-safe, not JS-string-safe — defense-in-depth.
      '<button class="btn btn-primary" style="font-size:0.85rem;padding:6px 14px;align-self:flex-start;margin-top:4px;" data-create-job-pid="' + esc(f.pid) + '" data-create-job-qty="' + f.suggestedQty + '">Create Job (' + f.suggestedQty + ' pcs)</button>' +
    '</div>';
  });

  html += '</div>';

  // MTO "Consider Stocking" section
  if (mtoConsider.length > 0) {
    html += '<h4 style="margin:24px 0 8px 0;font-size:0.9rem;color:var(--warm-gray);">Consider Stocking</h4>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">';
    mtoConsider.forEach(function(f) {
      var imgUrl = firstProductImage(f);
      // W1.4: title + image area is a link to product detail. The Update
      // Product Type button below stays as its own action.
      html += '<div style="background:var(--cream,rgba(245,240,232,1));border:1px solid var(--cream-dark,rgba(232,224,212,1));border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:8px;">' +
        // W1-followup: same pattern as the sibling Forecast card above.
        '<div role="link" tabindex="0" data-view-pid="' + esc(f.pid) + '" style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;border-radius:6px;padding:2px;" onmouseover="this.style.background=\'rgba(127,127,127,0.12)\';" onmouseout="this.style.background=\'transparent\';">' +
          (imgUrl ? '<img src="' + esc(imgUrl) + '" style="width:56px;height:56px;border-radius:8px;object-fit:cover;" loading="lazy">' : '<div style="width:56px;height:56px;border-radius:8px;background:var(--cream-dark,rgba(232,224,212,1));display:flex;align-items:center;justify-content:center;font-size:1.6rem;">&#x1F3A8;</div>') +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:600;font-size:0.9rem;">' + esc(f.name) + '</div>' +
            '<span style="background:rgba(21,101,192,0.15);padding:2px 8px;border-radius:4px;font-size:0.72rem;color:rgba(66,165,245,1);">MTO</span>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">' + f.last90 + ' ordered in 90 days &middot; Selling ' + f.monthlyRate + '/mo</div>' +
        // W1-followup: button inside Forecast card — data-view-pid on the
        // button itself so the inner-button-skip guard in the delegated
        // listener doesn't block it (buttons opt in via data-view-pid).
        '<button class="btn btn-secondary" style="font-size:0.85rem;padding:6px 14px;align-self:flex-start;" data-view-pid="' + esc(f.pid) + '">Update Product Type &#x2192;</button>' +
      '</div>';
    });
    html += '</div>';
  }

  el.innerHTML = html;
}

// Forecast "New Production Job" modal (openForecastJobModal / doCreateForecastJob)
// extracted to app/modules/forecast-job-modal.js — lazy-loaded via these eager
// shims. Reachable only from the Forecast/Jobs surfaces (the delegated
// [data-create-job-pid] handler below + products-v2's createForecastJob), where
// production.js (PURPOSE_LABELS / viewProductionJob) is already route-loaded. (Track 1.)
function openForecastJobModal(pid, suggestedQty) {
  MastAdmin.loadModule('forecastJobModal').then(function() {
    if (typeof window.openForecastJobModalImpl === 'function') window.openForecastJobModalImpl(pid, suggestedQty);
  }).catch(function() {});
}
function doCreateForecastJob(pid, suggestedQty, purpose) {
  MastAdmin.loadModule('forecastJobModal').then(function() {
    if (typeof window.doCreateForecastJobImpl === 'function') window.doCreateForecastJobImpl(pid, suggestedQty, purpose);
  }).catch(function() {});
}

// ---- Demand Overview Table ----
// W1.8: parameterized target so the same table can render into Forecast
// (#forecastDemandOverview) and the new Sales-by-Product doorway
// (#salesByProductOverview). _renderAllDemandOverviewSurfaces() below is
// the fan-out caller used by sort/horizon controls; computeAndRenderForecast
// still calls this with no args (defaults to the Forecast element).
function renderForecastDemandTable(targetId) {
  var el = document.getElementById(targetId || 'forecastDemandOverview');
  if (!el || !forecastData) return;

  // Filter: production products with at least 1 all-time order
  var rows = forecastData.filter(function(f) { return f.allTimeSold > 0; });

  // W2.1: per-horizon accessors so sort, render, and headers all read from
  // the same source of truth. 'all' has no prior window — sold/revenue/margin
  // still resolve, but prior + Δ% render "—".
  var horizon = forecastTimeHorizon;
  function _soldFor(f) {
    return horizon === '30d' ? f.last30
      : horizon === '90d' ? f.last90
      : horizon === 'all' ? f.allTimeSold
      : f.recentSold;
  }
  function _priorFor(f) {
    if (horizon === '30d') return f.prior30;
    if (horizon === '90d') return f.prior90;
    if (horizon === 'all') return null;
    return f.priorAdaptive;
  }
  function _deltaFor(f) {
    if (horizon === '30d') return f.deltaPct30;
    if (horizon === '90d') return f.deltaPct90;
    if (horizon === 'all') return null;
    return f.deltaPctAdaptive;
  }
  function _revenueCentsFor(f) {
    if (horizon === '30d') return f.revenue30Cents;
    if (horizon === '90d') return f.revenue90Cents;
    if (horizon === 'all') return f.revenueAllCents;
    return f.isFastMover ? f.revenue30Cents : f.revenue90Cents;
  }
  function _marginCentsFor(f) {
    if (horizon === '30d') return f.margin30Cents;
    if (horizon === '90d') return f.margin90Cents;
    if (horizon === 'all') return f.marginAllCents;
    return f.isFastMover ? f.margin30Cents : f.margin90Cents;
  }

  // Sort
  rows.sort(function(a, b) {
    var col = forecastDemandSort.col;
    var dir = forecastDemandSort.asc ? 1 : -1;
    if (col === 'name') return dir * (a.name || '').localeCompare(b.name || '');
    if (col === 'stock') return dir * (a.stock - b.stock);
    if (col === 'sold') return dir * (_soldFor(a) - _soldFor(b));
    if (col === 'prior') {
      // null prior (e.g. 'all' horizon) sorts to the end regardless of direction
      var aP = _priorFor(a), bP = _priorFor(b);
      if (aP == null && bP == null) return 0;
      if (aP == null) return 1;
      if (bP == null) return -1;
      return dir * (aP - bP);
    }
    if (col === 'revenue') return dir * ((_revenueCentsFor(a) || 0) - (_revenueCentsFor(b) || 0));
    if (col === 'margin') {
      // No-recipe (null) rows sort to the end regardless of direction so the
      // ranked actionable rows stay visible.
      var aM = _marginCentsFor(a), bM = _marginCentsFor(b);
      if (aM == null && bM == null) return 0;
      if (aM == null) return 1;
      if (bM == null) return -1;
      return dir * (aM - bM);
    }
    if (col === 'trending') {
      var aT = a.trending ? 2 : a.declining ? 0 : 1;
      var bT = b.trending ? 2 : b.declining ? 0 : 1;
      if (aT !== bT) return dir * (aT - bT);
      return dir * (a.recentSold - b.recentSold);
    }
    if (col === 'type') return dir * ((a.isStocked ? 0 : 1) - (b.isStocked ? 0 : 1));
    if (col === 'lastOrdered') return dir * ((a.lastOrdered || '').localeCompare(b.lastOrdered || ''));
    return 0;
  });

  var sortArrow = function(col) {
    if (forecastDemandSort.col !== col) return '';
    return forecastDemandSort.asc ? ' &#x25B2;' : ' &#x25BC;';
  };

  var horizonLabel = horizon === '30d' ? '30d' : horizon === '90d' ? '90d' : horizon === 'all' ? 'All' : 'Adaptive';
  var priorLabel = horizon === '30d' ? 'Prior 30d'
    : horizon === '90d' ? 'Prior 90d'
    : horizon === 'all' ? 'Prior'
    : 'Prior';

  var html = '<div style="display:flex;justify-content:space-between;align-items:center;margin:24px 0 12px 0;">' +
    '<h3 style="margin:0;font-size:1.15rem;">Demand Overview</h3>' +
    '<div style="display:flex;gap:4px;">' +
      ['adaptive','30d','90d','all'].map(function(h) {
        var label = h === 'adaptive' ? 'Adaptive' : h === 'all' ? 'All' : h;
        var active = horizon === h;
        return '<button class="btn ' + (active ? 'btn-primary' : 'btn-secondary') + '" style="font-size:0.72rem;padding:4px 10px;" onclick="setForecastHorizon(\'' + h + '\')">' + label + '</button>';
      }).join('') +
    '</div>' +
  '</div>';

  html += '<div style="overflow-x:auto;">' +
    '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">' +
    '<thead><tr style="border-bottom:2px solid var(--cream-dark,rgba(232,224,212,1));text-align:left;">' +
      '<th style="padding:8px;cursor:pointer;white-space:nowrap;" onclick="sortForecastDemand(\'name\')">Product' + sortArrow('name') + '</th>' +
      '<th style="padding:8px;cursor:pointer;text-align:right;" onclick="sortForecastDemand(\'stock\')">In Stock' + sortArrow('stock') + '</th>' +
      '<th style="padding:8px;cursor:pointer;text-align:right;white-space:nowrap;" onclick="sortForecastDemand(\'sold\')">Sold (' + horizonLabel + ')' + sortArrow('sold') + '</th>' +
      '<th style="padding:8px;cursor:pointer;text-align:right;white-space:nowrap;" onclick="sortForecastDemand(\'prior\')">' + priorLabel + sortArrow('prior') + '</th>' +
      '<th style="padding:8px;cursor:pointer;text-align:right;white-space:nowrap;" onclick="sortForecastDemand(\'revenue\')">Revenue' + sortArrow('revenue') + '</th>' +
      '<th style="padding:8px;cursor:pointer;text-align:right;white-space:nowrap;" onclick="sortForecastDemand(\'margin\')">Margin' + sortArrow('margin') + '</th>' +
      '<th style="padding:8px;cursor:pointer;text-align:center;" onclick="sortForecastDemand(\'trending\')">Trending' + sortArrow('trending') + '</th>' +
      '<th style="padding:8px;cursor:pointer;text-align:center;" onclick="sortForecastDemand(\'type\')">Type' + sortArrow('type') + '</th>' +
      '<th style="padding:8px;cursor:pointer;" onclick="sortForecastDemand(\'lastOrdered\')">Last Ordered' + sortArrow('lastOrdered') + '</th>' +
    '</tr></thead><tbody>';

  rows.forEach(function(f) {
    var soldVal = _soldFor(f);
    var priorVal = _priorFor(f);
    var deltaPct = _deltaFor(f);
    var revCents = _revenueCentsFor(f);
    var marCents = _marginCentsFor(f);
    var imgUrl = firstProductImage(f);

    // W2.1: Δ% chip next to Sold cell. Threshold ±5% to avoid visual noise on
    // single-unit swings. null prior → "—" (no comparison available).
    var deltaChip = '';
    if (deltaPct == null) {
      deltaChip = '';
    } else if (deltaPct >= 5) {
      deltaChip = ' <span style="background:rgba(46,125,50,0.15);color:rgba(76,175,80,1);padding:1px 6px;border-radius:4px;font-size:0.72rem;font-weight:600;white-space:nowrap;">+' + Math.round(deltaPct) + '%</span>';
    } else if (deltaPct <= -5) {
      deltaChip = ' <span style="background:rgba(198,40,40,0.15);color:rgba(239,83,80,1);padding:1px 6px;border-radius:4px;font-size:0.72rem;font-weight:600;white-space:nowrap;">' + Math.round(deltaPct) + '%</span>';
    } else {
      deltaChip = ' <span style="color:var(--warm-gray);font-size:0.72rem;">' + (deltaPct >= 0 ? '+' : '') + Math.round(deltaPct) + '%</span>';
    }

    var trendBadge = f.trending
      ? '<span style="background:rgba(46,125,50,0.15);color:rgba(76,175,80,1);padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">&#x2191;</span>'
      : f.declining
        ? '<span style="background:rgba(198,40,40,0.15);color:rgba(239,83,80,1);padding:2px 8px;border-radius:4px;font-size:0.72rem;font-weight:600;">&#x2193;</span>'
        : '<span style="color:var(--warm-gray);">&mdash;</span>';
    var typeBadge = f.isStocked
      ? '<span style="background:rgba(46,125,50,0.15);color:rgba(76,175,80,1);padding:2px 8px;border-radius:4px;font-size:0.72rem;">Stocked</span>'
      : '<span style="background:rgba(21,101,192,0.15);color:rgba(66,165,245,1);padding:2px 8px;border-radius:4px;font-size:0.72rem;">MTO</span>';

    var priorCell = (priorVal == null) ? '<span style="color:var(--warm-gray);">&mdash;</span>' : priorVal;
    // W2.1: Revenue cell shows "—" when no order in this product had
    // priceCents (legacy seed) — revenue would be a misleading $0.
    var revCell = (!f.hasPriceData && (revCents == null || revCents === 0))
      ? '<span style="color:var(--warm-gray);">&mdash;</span>'
      : _fmtMoneyFromCents(revCents);
    var marCell = (marCents == null)
      ? '<span style="color:var(--warm-gray);" title="No active recipe — margin not computable">&mdash;</span>'
      : _fmtMoneyFromCents(marCents);

    // W1.8: row drills into the specific product, not back to the list.
    // Same viewProduct() flow as the W1.4 Forecast card links.
    // W1-followup: Demand Overview row click (originally W1.8 surface flagged
    // in W1-SEC; tracked under OPEN -OtEkpFjIRwH_z-1CJuB).
    html += '<tr style="border-bottom:1px solid var(--cream-dark,rgba(232,224,212,1));cursor:pointer;" data-view-pid="' + esc(f.pid) + '">' +
      '<td style="padding:8px;">' +
        '<div style="display:flex;gap:8px;align-items:center;">' +
          (imgUrl ? '<img src="' + esc(imgUrl) + '" style="width:32px;height:32px;border-radius:6px;object-fit:cover;" loading="lazy">' : '') +
          '<span>' + esc(f.name) + '</span>' +
        '</div>' +
      '</td>' +
      '<td style="padding:8px;text-align:right;">' + f.stock + '</td>' +
      '<td style="padding:8px;text-align:right;white-space:nowrap;">' + soldVal + deltaChip + '</td>' +
      '<td style="padding:8px;text-align:right;">' + priorCell + '</td>' +
      '<td style="padding:8px;text-align:right;white-space:nowrap;">' + revCell + '</td>' +
      '<td style="padding:8px;text-align:right;white-space:nowrap;">' + marCell + '</td>' +
      '<td style="padding:8px;text-align:center;">' + trendBadge + '</td>' +
      '<td style="padding:8px;text-align:center;">' + typeBadge + '</td>' +
      '<td style="padding:8px;">' + (f.lastOrdered ? (typeof formatOrderDate === 'function' ? formatOrderDate(f.lastOrdered) : (typeof window.formatOrderDate === 'function' ? window.formatOrderDate(f.lastOrdered) : esc(String(f.lastOrdered).slice(0, 10)))) : '<span style="color:var(--warm-gray);font-style:italic;">Never</span>') + '</td>' +
    '</tr>';
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

// W1.8: render the demand table into every mounted surface. Keeps Forecast
// and Sales-by-Product in lock-step when sort or horizon controls fire.
function _renderAllDemandOverviewSurfaces() {
  ['forecastDemandOverview', 'salesByProductOverview'].forEach(function(id) {
    if (document.getElementById(id)) renderForecastDemandTable(id);
  });
}

function sortForecastDemand(col) {
  if (forecastDemandSort.col === col) {
    forecastDemandSort.asc = !forecastDemandSort.asc;
  } else {
    forecastDemandSort.col = col;
    forecastDemandSort.asc = col === 'name';
  }
  _renderAllDemandOverviewSurfaces();
}

function setForecastHorizon(h) {
  forecastTimeHorizon = h;
  _renderAllDemandOverviewSurfaces();
}

// ---- Slow/No Movement ----
function renderForecastSlowMovement() {
  var el = document.getElementById('forecastSlowMovement');
  if (!el || !forecastData) return;

  var slow = forecastData.filter(function(f) { return f.noMovement; });
  if (slow.length === 0) {
    el.innerHTML = '';
    return;
  }

  var html = '<div style="margin-top:24px;border:1px solid var(--cream-dark,rgba(232,224,212,1));border-radius:8px;overflow:hidden;">';
  html += '<div style="padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;background:var(--cream,rgba(245,240,232,1));" onclick="toggleForecastSlow()">' +
    '<span style="font-weight:600;font-size:0.9rem;">' + slow.length + ' product' + (slow.length !== 1 ? 's' : '') + ' with no recent orders</span>' +
    '<span id="forecastSlowArrow" style="font-size:0.78rem;">' + (forecastSlowExpanded ? '&#x25BC;' : '&#x25B6;') + '</span>' +
  '</div>';

  html += '<div id="forecastSlowList" style="display:' + (forecastSlowExpanded ? '' : 'none') + ';padding:8px 16px;">';
  slow.forEach(function(f) {
    html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--cream-dark,rgba(232,224,212,1));font-size:0.85rem;">' +
      '<span>' + esc(f.name) + '</span>' +
      '<span style="color:var(--warm-gray);">' + f.stock + ' in stock &middot; ' + (f.lastOrdered ? 'Last: ' + formatOrderDate(f.lastOrdered) : 'Never ordered') + '</span>' +
    '</div>';
  });
  html += '</div></div>';

  el.innerHTML = html;
}

function toggleForecastSlow() {
  forecastSlowExpanded = !forecastSlowExpanded;
  var list = document.getElementById('forecastSlowList');
  var arrow = document.getElementById('forecastSlowArrow');
  if (list) list.style.display = forecastSlowExpanded ? '' : 'none';
  if (arrow) arrow.innerHTML = forecastSlowExpanded ? '&#x25BC;' : '&#x25B6;';
}
