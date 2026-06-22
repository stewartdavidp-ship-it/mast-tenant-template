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
    channelConnected: false
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
      var d = byDomain[cap.domain] || (byDomain[cap.domain] = { total: 0, done: 0, todo: [] });
      d.total++; total++;
      if (a) { d.done++; done++; } else { d.todo.push(cap); }
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
    h += '<p style="font-size:0.72rem;color:var(--warm-gray);margin:12px 0 0;">Reflects the features you\'ve set up and are using.</p>';
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

  function refreshCard() {
    if (!document.getElementById('dashCardAdoption')) return;
    if (S.loaded) { renderCard(); return; }
    renderCard();                       // paint the "Calculating…" placeholder
    loadState().then(renderCard).catch(function (e) {
      if (window.MastError) MastError.capture(e, { where: 'adoption.loadState' });
    });
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
    // card alongside the shell's. S is cached after the first load, so repeat views
    // are synchronous.
    patch('renderAllDashboardCards', function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        try { refreshCard(); } catch (_e) {}
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
  }

  window.AdoptionV2 = { refresh: function () { S.loaded = false; refreshCard(); } };
  start();
})();
