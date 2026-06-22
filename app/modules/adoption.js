/**
 * adoption.js — "Your Mast value score" (adoption gamification · Stage 1 / G1).
 *
 * Surfaces how much of Mast a merchant is actually using, to drive value
 * realization + retention ("you're using the full value of the product"). This
 * is the in-tenant half (Stage 1); the anonymized cross-customer cohort benchmark
 * (Stage 2 / G3) is a separate platform surface and is NOT here.
 *
 * Loaded EAGERLY (a plain <script src> near the end of app/index.html, NOT a lazy
 * MODULE_MANIFEST entry) because it paints a Dashboard card on boot. It is a
 * module, not inline shell JS, per the shell-size ratchet
 * (scripts/lint-shell-size.js): the shell keeps only the #dashCardAdoption div
 * and this <script> tag; all behaviour lives here.
 *
 * G1 = the data-model core. Three concepts:
 *   - CATALOG: the capabilities we score (mapped to the 9 product domains), each
 *     with the cheapest reliable "adopted" signal read from state the app already
 *     stores (the onboarding NEXT_STEP cache, storefront feature pages, channel
 *     connections, lifetime-orders count).
 *   - mode-scoped denominator: only capabilities relevant to THIS merchant's
 *     business mode count, so a bookings shop isn't scored on wholesale.
 *   - tri-state credit: adopted (1) / not (0) / unknown (excluded) — a signal that
 *     hasn't resolved yet is left out of both numerator and denominator rather
 *     than counted against the merchant.
 *
 * Anti-vanity: for record-type capabilities "adopted" means real activity (a
 * product exists, an order was placed); for config-type capabilities the
 * meaningful action IS the configuration (connecting a channel, choosing a
 * template) — so enabling counts, but only because enabling is itself the value.
 *
 * Read-only. No schema change, no Cloud Function. Spec:
 * docs/ux-audit/adoption-gamification-build-spec.md.
 */
(function () {
  'use strict';
  if (!window.MastDB) return; // shell not ready; nothing to score.

  // Self-contained esc — don't depend on the shell's esc() being defined yet.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // ── domains (the 9-domain north star; v1 catalog covers six of them) ─────────
  var DOMAIN_ORDER = ['sell', 'make', 'ship', 'market', 'show', 'run', 'web', 'book', 'manage'];
  var DOMAIN_LABEL = {
    sell: 'Selling', make: 'Making', ship: 'Shipping', market: 'Marketing',
    show: 'Shows', run: 'Running', web: 'Website', book: 'Booking', manage: 'Managing'
  };

  // ── shared state, filled once by loadState() ─────────────────────────────────
  // Each field defaults to a "not yet known" value; adopted() predicates read it.
  var S = {
    loaded: false,
    modes: [],          // tenant business modes (maker/retail/bookings/standard)
    cache: {},          // window._nextStepsCache snapshot
    orders: null,       // lifetime order count, or null if not yet known
    featurePages: [],   // storefront enabledFeaturePages
    channelConnected: false,
    band: null,         // G3: this tenant's anonymized cohort percentile band, or null
    cohortN: 0          // G3: # of similar shops in the cohort (anonymity context)
  };

  function nsc(key) { return !!(S.cache && S.cache[key]); }
  function hasFeaturePage(p) { return S.featurePages.indexOf(p) >= 0; }

  // ── the capability catalog ───────────────────────────────────────────────────
  // modes:null = relevant to every business; otherwise relevant only when the
  // tenant has one of the listed modes. adopted() returns true / false / null
  // (null = signal unknown → excluded from the score this pass).
  var CATALOG = [
    // WEB — relevant to everyone with a storefront (always, for v1).
    { id: 'web-published', domain: 'web', label: 'Storefront is live', modes: null, route: 'website',
      adopted: function () { return nsc('hasWebsite'); } },
    { id: 'web-template', domain: 'web', label: 'Picked a template', modes: null, route: 'website',
      adopted: function () { return nsc('hasTemplate'); } },
    { id: 'web-content', domain: 'web', label: 'Customized your content', modes: null, route: 'website',
      adopted: function () { return nsc('hasContent'); } },

    // MAKE
    { id: 'make-products', domain: 'make', label: 'Built your product catalog', modes: ['maker', 'retail', 'standard'], route: 'products',
      adopted: function () { return nsc('hasProducts'); } },

    // SELL
    { id: 'sell-orders', domain: 'sell', label: 'Taken your first order', modes: null, route: 'orders',
      adopted: function () { return (typeof S.orders === 'number') ? S.orders > 0 : null; } },
    { id: 'sell-giftcards', domain: 'sell', label: 'Gift cards', modes: ['retail', 'bookings'], route: 'gift-cards',
      adopted: function () { return hasFeaturePage('gift-cards'); } },
    { id: 'sell-loyalty', domain: 'sell', label: 'Loyalty rewards', modes: ['retail', 'bookings'], route: 'loyalty',
      adopted: function () { return hasFeaturePage('loyalty'); } },
    { id: 'sell-commissions', domain: 'sell', label: 'Custom orders', modes: ['maker', 'bookings'], route: 'commissions',
      adopted: function () { return hasFeaturePage('commissions'); } },

    // MARKET
    { id: 'market-blog', domain: 'market', label: 'Blog', modes: null, route: 'blog',
      adopted: function () { return hasFeaturePage('blog'); } },

    // BOOK
    { id: 'book-classes', domain: 'book', label: 'Classes & booking', modes: ['bookings'], route: 'book',
      adopted: function () { return hasFeaturePage('booking'); } },

    // MANAGE
    { id: 'manage-biztype', domain: 'manage', label: 'Set your business type', modes: null, route: 'settings',
      adopted: function () { return nsc('hasBusinessType'); } },
    { id: 'manage-tax', domain: 'manage', label: 'Configured tax', modes: null, route: 'settings',
      adopted: function () { return nsc('hasTaxConfig'); } },
    { id: 'manage-pricing', domain: 'manage', label: 'Set pricing defaults', modes: ['maker', 'retail'], route: 'settings',
      adopted: function () { return nsc('hasPricingDefaults'); } },
    { id: 'manage-modules', domain: 'manage', label: 'Tailored your sidebar', modes: null, route: 'settings',
      adopted: function () { return nsc('hasModulesShown'); } },
    { id: 'manage-ai', domain: 'manage', label: 'Connected an AI assistant', modes: null, route: 'settings',
      adopted: function () { return nsc('hasAiApiKey'); } },
    { id: 'manage-surveys', domain: 'manage', label: 'Customer surveys', modes: ['retail', 'bookings', 'maker'], route: 'cs-surveys',
      adopted: function () { return hasFeaturePage('surveys'); } },
    { id: 'manage-channels', domain: 'manage', label: 'Connected a sales channel', modes: ['retail', 'maker'], route: 'channels',
      adopted: function () { return S.channelConnected; } },
    { id: 'manage-mapping', domain: 'manage', label: 'Matched channel listings', modes: ['retail', 'maker'], route: 'mapping',
      adopted: function () { return nsc('mappingComplete'); } }
  ];

  // A capability counts for this tenant if it's mode-relevant. Unknown modes →
  // include everything (don't over-filter and make every score look low).
  function relevant(cap) {
    if (!cap.modes) return true;
    if (!S.modes.length) return true;
    return cap.modes.some(function (m) { return S.modes.indexOf(m) >= 0; });
  }

  // ── scoring ──────────────────────────────────────────────────────────────────
  function computeScores() {
    var byDomain = {}; // domain -> { total, done, todo:[caps] }
    var total = 0, done = 0;
    CATALOG.forEach(function (cap) {
      if (!relevant(cap)) return;
      var a = cap.adopted();
      if (a === null) return; // unknown this pass — exclude from both sides
      var d = byDomain[cap.domain] || (byDomain[cap.domain] = { total: 0, done: 0, todo: [], doneCaps: [] });
      d.total++; total++;
      if (a) { d.done++; done++; d.doneCaps.push(cap); } else { d.todo.push(cap); }
    });
    var pct = total > 0 ? Math.round(done / total * 100) : 0;
    return { pct: pct, done: done, total: total, byDomain: byDomain };
  }

  // The single best "next thing to turn on": a not-yet-adopted capability from the
  // domain with the lowest completion, so the nudge spreads the merchant's usage.
  function topOpportunity(scores) {
    var best = null, bestPct = 2;
    DOMAIN_ORDER.forEach(function (dom) {
      var d = scores.byDomain[dom];
      if (!d || !d.todo.length) return;
      var p = d.total > 0 ? d.done / d.total : 1;
      if (p < bestPct) { bestPct = p; best = d.todo[0]; }
    });
    return best;
  }

  // ── data load (cheap reads / already-cached state) ───────────────────────────
  function pget(fn) { try { return Promise.resolve(fn()); } catch (_e) { return Promise.resolve(null); } }

  function loadState() {
    var jobs = [];
    // Onboarding cache — populated by the shell's loadNextStepsCache(); refresh it
    // so our read is current, then snapshot.
    jobs.push(pget(function () {
      return (typeof window.loadNextStepsCache === 'function') ? window.loadNextStepsCache() : null;
    }).then(function () { S.cache = window._nextStepsCache || {}; }));

    // Storefront feature pages + business modes (one businessEntity read each).
    jobs.push(pget(function () { return MastDB.businessEntity.get('presence'); }).then(function (p) {
      S.featurePages = (p && p.enabledFeaturePages) || [];
    }));
    jobs.push(pget(function () { return MastDB.businessEntity.get('modeSet'); }).then(function (m) {
      S.modes = (m && m.modes) || [];
    }));

    // Any live sales-channel connection.
    if (window.ChannelConnection && typeof window.ChannelConnection.isChannelConnected === 'function') {
      ['square', 'shopify', 'etsy'].forEach(function (ch) {
        jobs.push(pget(function () { return window.ChannelConnection.isChannelConnected(ch); }).then(function (ok) {
          if (ok) S.channelConnected = true;
        }));
      });
    }

    // Lifetime orders — reuse the count the Set-Up-Your-Shop card already loads;
    // leave null (excluded) until it resolves rather than count zero against them.
    if (typeof window._lifetimeOrdersCount === 'number') S.orders = window._lifetimeOrdersCount;

    return Promise.all(jobs).then(function () { S.loaded = true; });
  }

  // ── the Dashboard card ───────────────────────────────────────────────────────
  function bar(pct) {
    return '<div style="background:var(--hover-bg, var(--cream-dark));border-radius:6px;height:6px;margin:4px 0 14px;overflow:hidden;">' +
      '<div style="background:var(--teal);height:100%;width:' + pct + '%;border-radius:6px;transition:width 0.3s;"></div>' +
      '</div>';
  }

  function cardBody(scores) {
    var opp = topOpportunity(scores);
    var h = '';
    h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 2px;">' +
      'You\'re using <strong style="color:var(--text);">' + scores.done + ' of ' + scores.total + '</strong> ' +
      'capabilities available to your business.</p>';
    h += bar(scores.pct);
    if (opp) {
      h += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;background:var(--hover-bg, var(--cream-dark));">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--warm-gray);">Biggest opportunity · ' + esc(DOMAIN_LABEL[opp.domain] || opp.domain) + '</div>' +
          '<div style="font-size:0.9rem;font-weight:600;color:var(--text);">' + esc(opp.label) + '</div>' +
        '</div>' +
        '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'' + esc(opp.route) + '\')">Set it up</button>' +
      '</div>';
    } else {
      h += '<p style="font-size:0.85rem;color:var(--teal);font-weight:600;margin:0;">You\'re using everything Mast offers for your business. 🎉</p>';
    }
    if (S.band) {
      h += '<div style="margin-top:12px;font-size:0.85rem;color:var(--text);">🏅 You\'re in the <strong style="color:var(--teal);">' + esc(bandLabel(S.band)) + '</strong> of makers your size.</div>';
    }
    h += '<div style="margin-top:12px;"><a onclick="navigateTo(\'adoption\')" style="font-size:0.85rem;color:var(--teal);cursor:pointer;font-weight:600;">View full breakdown →</a></div>';
    h += '<p style="font-size:0.72rem;color:var(--warm-gray);margin:10px 0 0;">Reflects the features you\'ve set up and are using.</p>';
    return h;
  }

  function renderCard() {
    var container = document.getElementById('dashCardAdoption');
    if (!container) return;
    if (!S.loaded) {
      container.innerHTML =
        '<div class="dash-card" id="dashCard_adoption"><div class="dash-card-header" style="cursor:default;">' +
        '<div class="dash-card-title"><h3>Your Mast value score</h3></div></div>' +
        '<div class="dash-card-body"><p style="font-size:0.85rem;color:var(--warm-gray);margin:0;">Calculating…</p></div></div>';
      return;
    }
    var scores = computeScores();
    if (scores.total === 0) { container.innerHTML = ''; return; }
    container.innerHTML =
      '<div class="dash-card" id="dashCard_adoption">' +
        '<div class="dash-card-header" style="cursor:default;">' +
          '<div class="dash-card-title"><h3>Your Mast value score</h3></div>' +
          '<div class="dash-card-actions"><span class="dash-card-count">' + scores.pct + '%</span></div>' +
        '</div>' +
        '<div class="dash-card-body">' + cardBody(scores) + '</div>' +
      '</div>';
  }

  // ── the full breakdown view (#adoption route) ────────────────────────────────
  function viewVisible() {
    var t = document.getElementById('adoptionTab');
    return !!(t && t.style.display !== 'none');
  }
  function repaint() { renderCard(); renderView(); }

  function capRow(cap, adopted) {
    var U = window.MastUI;
    var right = adopted
      ? (U ? U.badge('✓ In use', 'success') : '<span style="color:var(--teal);font-size:0.85rem;">✓ In use</span>')
      : '<a onclick="navigateTo(\'' + esc(cap.route) + '\')" style="font-size:0.85rem;color:var(--teal);cursor:pointer;">Set up →</a>';
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--cream-dark);">' +
      '<span style="font-size:0.9rem;color:var(--text);">' + esc(cap.label) + '</span>' + right + '</div>';
  }

  // Renders into #adoptionTab. No-ops while the tab is hidden so the dashboard-side
  // refresh hooks don't build it needlessly; the route setup shows the tab first.
  function renderView() {
    if (!viewVisible()) return;
    var tab = document.getElementById('adoptionTab');
    if (!tab) return;
    var U = window.MastUI;
    var head = U ? U.pageHeader({
      title: 'Your Mast value score',
      count: S.loaded ? (computeScores().pct + '% in use') : '',
      actionsHtml: '<button class="btn btn-secondary" onclick="AdoptionV2.refresh()">↻ Refresh</button>'
    }) : '<h1>Your Mast value score</h1>';
    if (!S.loaded) { tab.innerHTML = head + '<div style="margin-top:14px;color:var(--warm-gray);">Calculating…</div>'; return; }
    var scores = computeScores();
    if (scores.total === 0) {
      tab.innerHTML = head + '<div style="margin-top:14px;color:var(--warm-gray);">Nothing to score yet — set up your shop to start building your value score.</div>';
      return;
    }
    var masteryCount = 0, cards = '';
    DOMAIN_ORDER.forEach(function (dom) {
      var d = scores.byDomain[dom];
      if (!d || !d.total) return;
      var domPct = Math.round(d.done / d.total * 100);
      var mastered = d.done === d.total;
      if (mastered) masteryCount++;
      var rows = '';
      d.doneCaps.forEach(function (c) { rows += capRow(c, true); });
      d.todo.forEach(function (c) { rows += capRow(c, false); });
      var title = (DOMAIN_LABEL[dom] || dom) + ' · ' + domPct + '%' + (mastered ? ' ⭐' : '');
      cards += U ? U.card(title, rows) : ('<h3>' + esc(title) + '</h3>' + rows);
    });
    var intro = '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 14px;max-width:560px;">' +
      'How much of Mast you\'re putting to work. A capability counts once you\'ve set it up and are using it — turn on more to get the full value of your subscription.</p>';
    var tiles = U ? U.tiles([
      { k: 'Value score', v: scores.pct + '%', hero: true },
      { k: 'Capabilities in use', v: scores.done + ' / ' + scores.total },
      { k: 'Domains mastered', v: String(masteryCount) }
    ]) : '';
    var bench = S.band ? '<p style="font-size:0.9rem;color:var(--text);margin:14px 0 0;">🏅 You\'re in the <strong style="color:var(--teal);">' + esc(bandLabel(S.band)) + '</strong> of makers your size' + (S.cohortN ? ' (compared with ' + S.cohortN + ' similar shops)' : '') + '.</p>' : '';
    var foot = '<p style="font-size:0.72rem;color:var(--warm-gray);margin:14px 0 0;">Scoped to your business type — you\'re only scored on capabilities that fit how you operate.</p>';
    tab.innerHTML = head + intro + tiles + bench + cards + foot;
  }

  // (Re)load signals then repaint. Single-flighted with a trailing coalesce so the
  // burst of boot-time triggers (TENANT_READY, the two dashboard-render hooks, and
  // the safety-net poll) collapse into at most one in-flight load plus one trailing
  // re-sync — never a read storm.
  var _loading = false, _reloadAgain = false;
  function reloadAndRender() {
    if (!document.getElementById('dashCardAdoption') && !viewVisible()) return;
    if (_loading) { _reloadAgain = true; return; }
    _loading = true;
    loadState().then(function () {
      _loading = false; repaint();
      try { var _sc = computeScores(); if (_sc.total > 0) reportAndBenchmark(_sc); } catch (_e) {}
      if (_reloadAgain) { _reloadAgain = false; reloadAndRender(); }
    }).catch(function (e) {
      _loading = false;
      if (window.MastError) MastError.capture(e, { where: 'adoption.loadState' });
      if (_reloadAgain) { _reloadAgain = false; reloadAndRender(); }
    });
  }

  function refreshCard() {
    if (!document.getElementById('dashCardAdoption')) return;
    // Paint instantly (the "Calculating…" placeholder on first paint, or the
    // last-known score on a repeat view — no flicker), then (re)load and repaint.
    // We ALWAYS reload rather than trust a single cached load: the onboarding
    // signals we read (_nextStepsCache's fields, the lifetime-orders count)
    // initialise all-false/undefined and are filled in asynchronously by the shell
    // over the first few seconds, so a one-shot load can lock in a bogus 0%.
    renderCard();
    reloadAndRender();
  }

  // ── G3: anonymized cohort benchmark (gated CF; dormant until [ARCH] deploys) ──
  // Emits THIS tenant's own value-score to the platform aggregator and reads back
  // ONLY its own cohort percentile band — the tenant app never reads another
  // tenant's data. Stays invisible until reportAdoptionScore is deployed AND the
  // cohort clears the anonymity floor (band stays null → nothing renders).
  var BAND_LABEL = { 'top-10': 'top 10%', 'top-25': 'top 25%', 'top-50': 'top half', 'top-75': 'top 75%' };
  function bandLabel(b) { return BAND_LABEL[b] || b; }
  function cohortOf() {
    var n = (typeof S.orders === 'number') ? S.orders : 0;
    var sizeBucket = n < 10 ? 'new' : n < 100 ? 'small' : n < 1000 ? 'growing' : 'established';
    return { mode: (S.modes && S.modes[0]) || 'standard', sizeBucket: sizeBucket };
  }
  function domainPcts(scores) {
    var out = {};
    Object.keys(scores.byDomain).forEach(function (dom) {
      var d = scores.byDomain[dom];
      out[dom] = d.total ? Math.round(d.done / d.total * 100) : 0;
    });
    return out;
  }
  var _reportTried = false; // at most one attempt per page load
  function reportAndBenchmark(scores) {
    if (_reportTried) return;
    // Throttle to ~once/day across loads — the score barely moves intra-day and this is a write.
    try {
      var last = +(localStorage.getItem('__mast_adoption_reported') || 0);
      if (last && (Date.now() - last) < 20 * 3600 * 1000) { _reportTried = true; return; }
    } catch (_e) {}
    if (typeof firebase === 'undefined' || !firebase.functions) return;
    // The deployed reportAdoptionScore is gated via assertTenantMember(tenantId) — it
    // requires tenantId in the body (validated against the caller's membership), so we
    // send it explicitly. No tenant context → skip (can't report).
    var tid = (window.MastDB && typeof MastDB.tenantId === 'function' && MastDB.tenantId()) ||
      window.TENANT_ID || (window.TENANT_CONFIG && window.TENANT_CONFIG.tenantId) || null;
    if (!tid) return;
    var fn;
    try { fn = firebase.functions().httpsCallable('reportAdoptionScore'); } catch (_e) { return; }
    _reportTried = true;
    fn({ tenantId: tid, overall: scores.pct, byDomain: domainPcts(scores), cohort: cohortOf() }).then(function (res) {
      var d = (res && res.data) || {};
      S.band = d.band || null;
      S.cohortN = d.cohortN || 0;
      try { localStorage.setItem('__mast_adoption_reported', String(Date.now())); } catch (_e) {}
      repaint();
    }).catch(function () { /* reportAdoptionScore not deployed yet — stay dormant */ });
  }

  // ── wire into the dashboard render (wrap, don't edit the shell) ───────────────
  function patch(name, wrapper) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__adoptionPatched) return;
    var wrapped = wrapper(orig);
    wrapped.__adoptionPatched = true;
    window[name] = wrapped;
  }
  function installPatches() {
    // renderAllDashboardCards runs on every Dashboard view (route setup); paint our
    // card alongside the shell's.
    patch('renderAllDashboardCards', function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        try { refreshCard(); } catch (_e) {}
        return r;
      };
    });
    // The shell re-renders the Set-Up-Your-Shop card EXACTLY when the onboarding
    // signals we read finish loading: once after loadNextStepsCache() resolves and
    // again after the lifetime-orders count query returns (see app/index.html). Re-
    // sync off that same trigger so our score converges to the real value as the
    // data lands, instead of sticking at the initial all-false 0%.
    patch('renderDashCardSetupShop', function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        try { reloadAndRender(); } catch (_e) {}
        return r;
      };
    });
  }

  function start() {
    installPatches();
    // If the dashboard is already on screen at load, paint immediately.
    if (window.TENANT_READY && typeof window.TENANT_READY.then === 'function') {
      window.TENANT_READY.then(refreshCard, function () {});
    } else {
      refreshCard();
    }
    // Safety net, independent of the shell re-render hooks above (in case those
    // call sites change): re-sync a few times over the first few seconds so a first
    // paint that snapshotted the still-loading signals converges to the real score.
    // Single-flighting in reloadAndRender keeps this from piling up reads.
    var ticks = 0;
    var iv = setInterval(function () {
      if (++ticks > 4) { clearInterval(iv); return; }
      if (document.getElementById('dashCardAdoption')) reloadAndRender();
    }, 1500);
  }

  // ── the dedicated #adoption route (reached from the Dashboard card link) ──────
  // Registered via MastAdmin so applyRoute() renders #adoptionTab. No sidebar item
  // (that would need a MODE_ROUTE_VISIBILITY rule + risks a silent mode-hide);
  // discovery is the card's "View full breakdown" link.
  function openView() { renderView(); reloadAndRender(); }
  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('adoption', { routes: { adoption: { tab: 'adoptionTab', setup: openView } } });
  }

  window.AdoptionV2 = {
    refresh: function () { reloadAndRender(); },
    open: function () { if (typeof navigateTo === 'function') navigateTo('adoption'); }
  };
  start();
})();
