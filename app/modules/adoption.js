/**
 * adoption.js — "Your Mast value score" (adoption gamification · Stage 1 / G1 + G2).
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
 *   - CATALOG: the ~35 capabilities we score (mapped to the 9 product domains),
 *     each with the cheapest reliable signal read from state the app already
 *     stores (the onboarding NEXT_STEP cache, storefront feature pages, channel
 *     connections, the lifetime-orders count, bounded record-count probes, and
 *     recent-route usage from analytics/hits).
 *   - mode-scoped denominator: only capabilities relevant to THIS merchant's
 *     business mode count, so a bookings shop isn't scored on wholesale.
 *   - THREE-TIER credit (the anti-vanity core): each capability resolves to
 *       Available (in the denominator, not adopted)            -> 0.0
 *       Enabled   (switched on / configured, but no real use)  -> 0.4
 *       Used      (real activity: a record exists, or the       -> 1.0
 *                  feature route was used in the last 30 days)
 *     A signal that hasn't resolved yet is UNKNOWN and is excluded from BOTH the
 *     numerator and the denominator rather than counted against the merchant.
 *
 * Anti-vanity: a feature toggle alone earns only partial credit (0.4); full
 * credit needs real use. For config-type capabilities where the configuration IS
 * the value (connecting a channel, choosing a template, setting tax) there is no
 * separate "used" tier - enabling earns full credit, but only because enabling is
 * itself the realized value.
 *
 * Read-only. No schema change, no Cloud Function. Spec:
 * docs/ux-audit/adoption-gamification-build-spec.md (sections 1-3, the 3-tier model).
 */
(function () {
  'use strict';
  if (!window.MastDB) return; // shell not ready; nothing to score.

  // Tuning knobs (spec section 5 - start equal-weighted; tune after real data).
  var ENABLED_CREDIT = 0.4;          // partial credit for "switched on, not yet used"
  var USED_WINDOW_MS = 30 * 24 * 3600 * 1000; // a route counts as "used" if hit in 30d
  var HITS_SCAN = 2000;              // bounded analytics/hits read (matches analytics-v2)

  // Self-contained esc - don't depend on the shell's esc() being defined yet.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  // -- domains (the 9-domain north star) ----------------------------------------
  var DOMAIN_ORDER = ['sell', 'make', 'ship', 'market', 'show', 'run', 'web', 'book', 'manage'];
  var DOMAIN_LABEL = {
    sell: 'Selling', make: 'Making', ship: 'Shipping', market: 'Marketing',
    show: 'Shows', run: 'Running', web: 'Website', book: 'Booking', manage: 'Managing'
  };

  // -- shared state, filled by loadState() --------------------------------------
  var S = {
    loaded: false,
    modes: [],          // tenant business modes (maker/retail/bookings/standard)
    overlays: [],       // overlay modes (e.g. 'event')
    cache: {},          // window._nextStepsCache snapshot
    orders: null,       // lifetime order count, or null if not yet known
    featurePages: [],   // storefront enabledFeaturePages
    channelConnected: false,
    counts: {},         // path -> bool (>=1 record); absent key = not probed yet
    countsLoaded: false,// record-count probes + analytics scan run once per session
    usedRoutes: null,   // Set of route ids hit in the last 30d, or null if unknown
    band: null,         // G3: this tenant's anonymized cohort percentile band, or null
    cohortN: 0          // G3: number of similar shops in the cohort (anonymity context)
  };

  function nsc(key) { return !!(S.cache && S.cache[key]); }
  function hasFeaturePage(p) { return S.featurePages.indexOf(p) >= 0; }
  function hasOverlay(o) { return S.overlays.indexOf(o) >= 0; }
  // Record-count probe result: true/false once probed, null until then.
  function recUsed(path) { return S.countsLoaded ? !!S.counts[path] : null; }
  // Route-recency result: true/false once scanned, null until then.
  function routeUsed(routes) {
    if (!S.usedRoutes) return null;
    for (var i = 0; i < routes.length; i++) { if (S.usedRoutes.has(routes[i])) return true; }
    return false;
  }

  // -- the capability catalog ----------------------------------------------------
  // Per entry:
  //   modes:null      -> relevant to every business; otherwise an array gating it
  //                      to tenants with one of those modes. `overlay` gates on an
  //                      overlay mode (e.g. 'event' for Shows).
  //   enabled: fn     -> Tier-1 signal (switched on / configured). true/false/null.
  //   probe: 'path'   -> Tier-2 "used" via a bounded >=1-record probe.
  //   usedRoutes:[..] -> Tier-2 "used" via a route hit in the last 30 days.
  //   used: fn        -> Tier-2 "used" custom predicate (true/false/null).
  // A config-type capability has ONLY `enabled` (no used tier) -> enabling = full
  // credit. A capability with a used tier earns 0.4 for enabled, 1.0 for used.
  // route = where "Set up ->" / "Use it ->" links go (verified-resolvable ids only).
  var CATALOG = [
    // -- WEB - config-type: choosing/customizing the storefront IS the value -----
    { id: 'web-published', domain: 'web', label: 'Storefront is live', modes: null, route: 'website',
      enabled: function () { return nsc('hasWebsite'); } },
    { id: 'web-template', domain: 'web', label: 'Picked a template', modes: null, route: 'website',
      enabled: function () { return nsc('hasTemplate'); } },
    { id: 'web-content', domain: 'web', label: 'Customized your content', modes: null, route: 'website',
      enabled: function () { return nsc('hasContent'); } },

    // -- MAKE ---------------------------------------------------------------------
    { id: 'make-products', domain: 'make', label: 'Built your product catalog', modes: ['maker', 'retail', 'standard'], route: 'products',
      used: function () { return nsc('hasProducts') ? true : recUsed('public/products'); } },
    { id: 'make-materials', domain: 'make', label: 'Tracked your materials', modes: ['maker'], route: 'materials',
      probe: 'admin/materials' },
    { id: 'make-recipes', domain: 'make', label: 'Built recipes / BOMs', modes: ['maker'], route: 'materials',
      probe: 'admin/recipes' },
    { id: 'make-procurement', domain: 'make', label: 'Purchase orders', modes: ['maker', 'retail'], route: 'procurement',
      usedRoutes: ['procurement', 'procurement-v2', 'vendors-v2', 'lots-v2'] },
    { id: 'make-lookbooks', domain: 'make', label: 'Lookbooks', modes: ['maker'], route: 'lookbooks',
      probe: 'admin/lookbooks' },

    // -- SELL ---------------------------------------------------------------------
    { id: 'sell-orders', domain: 'sell', label: 'Taken your first order', modes: null, route: 'orders',
      used: function () { return (typeof S.orders === 'number') ? S.orders > 0 : null; } },
    { id: 'sell-pos', domain: 'sell', label: 'Point of Sale', modes: ['retail', 'maker'], route: 'pos',
      usedRoutes: ['pos', 'pos-v2', 'sales'] },
    { id: 'sell-commissions', domain: 'sell', label: 'Custom orders', modes: ['maker', 'bookings'], route: 'commissions',
      enabled: function () { return hasFeaturePage('commissions'); }, probe: 'admin/commissions' },
    { id: 'sell-wholesale', domain: 'sell', label: 'Wholesale', modes: ['maker', 'retail'], route: 'wholesale',
      usedRoutes: ['wholesale', 'wholesale-v2'] },
    { id: 'sell-coupons', domain: 'sell', label: 'Coupons', modes: ['retail', 'maker', 'standard'], route: 'coupons',
      probe: 'admin/coupons' },
    { id: 'sell-promotions', domain: 'sell', label: 'Sale promotions', modes: ['retail', 'maker', 'standard'], route: 'coupons',
      probe: 'public/sales-promotions' },
    { id: 'sell-giftcards', domain: 'sell', label: 'Gift cards', modes: ['retail', 'bookings'], route: 'gift-cards',
      enabled: function () { return hasFeaturePage('gift-cards'); }, probe: 'admin/giftCards' },
    { id: 'sell-loyalty', domain: 'sell', label: 'Loyalty rewards', modes: ['retail', 'bookings'], route: 'loyalty',
      enabled: function () { return hasFeaturePage('loyalty'); } },
    { id: 'sell-rma', domain: 'sell', label: 'Returns (RMA)', modes: ['retail', 'maker'], route: 'rma',
      probe: 'admin/rma' },
    { id: 'sell-consignment', domain: 'sell', label: 'Consignment galleries', modes: ['maker'], route: 'galleries',
      probe: 'admin/consignments' },

    // -- SHIP - usage-only (no toggle; the value is fulfilling orders) -----------
    { id: 'ship-fulfill', domain: 'ship', label: 'Pack & fulfill orders', modes: ['maker', 'retail', 'standard'], route: 'fulfillment',
      usedRoutes: ['fulfillment', 'fulfillment-v2', 'pack', 'pack-v2', 'ship', 'ship-v2'] },

    // -- MARKET -------------------------------------------------------------------
    { id: 'market-blog', domain: 'market', label: 'Blog', modes: null, route: 'blog',
      enabled: function () { return hasFeaturePage('blog'); }, probe: 'blog/posts' },
    { id: 'market-newsletter', domain: 'market', label: 'Email newsletter', modes: null, route: 'newsletter',
      enabled: function () { return recUsed('newsletter/subscribers'); }, probe: 'newsletter/issues' },
    { id: 'market-campaigns', domain: 'market', label: 'Marketing campaigns', modes: null, route: 'campaigns',
      usedRoutes: ['campaigns', 'campaigns-v2'] },
    { id: 'market-social', domain: 'market', label: 'Social media', modes: null, route: 'social',
      usedRoutes: ['social', 'social-v2'] },

    // -- SHOW - gated on the 'event' overlay -------------------------------------
    { id: 'show-events', domain: 'show', label: 'Shows & markets', overlay: 'event', route: 'events-shows',
      probe: 'events/shows' },

    // -- RUN ----------------------------------------------------------------------
    { id: 'run-reports', domain: 'run', label: 'Financial reports', modes: null, route: 'financials',
      usedRoutes: ['financials', 'financials-v2', 'finance-reports', 'finance-reports-v2', 'finance-pl', 'finance-pl-v2', 'finance-revenue', 'reports'] },
    { id: 'run-expenses', domain: 'run', label: 'Expense tracking', modes: null, route: 'finance-expenses',
      probe: 'admin/expenses' },
    { id: 'run-trips', domain: 'run', label: 'Trips / mileage', modes: ['maker', 'standard'], route: 'trips',
      probe: 'trips' },
    { id: 'run-customers', domain: 'run', label: 'Customer records', modes: null, route: 'customers',
      probe: 'admin/contacts' },
    { id: 'run-studio', domain: 'run', label: 'Studio (overhead/equipment)', modes: ['maker'], route: 'studio',
      usedRoutes: ['studio', 'studio-v2'] },

    // -- BOOK ---------------------------------------------------------------------
    { id: 'book-classes', domain: 'book', label: 'Classes & booking', modes: ['bookings'], route: 'book',
      enabled: function () { return hasFeaturePage('booking'); }, probe: 'public/classes' },
    { id: 'book-enrollments', domain: 'book', label: 'Enrollments', modes: ['bookings'], route: 'book',
      probe: 'admin/enrollments' },

    // -- MANAGE - mostly config-type (the configuration is the value) ------------
    { id: 'manage-biztype', domain: 'manage', label: 'Set your business type', modes: null, route: 'settings',
      enabled: function () { return nsc('hasBusinessType'); } },
    { id: 'manage-tax', domain: 'manage', label: 'Configured tax', modes: null, route: 'settings',
      enabled: function () { return nsc('hasTaxConfig'); } },
    { id: 'manage-pricing', domain: 'manage', label: 'Set pricing defaults', modes: ['maker', 'retail'], route: 'settings',
      enabled: function () { return nsc('hasPricingDefaults'); } },
    { id: 'manage-modules', domain: 'manage', label: 'Tailored your sidebar', modes: null, route: 'settings',
      enabled: function () { return nsc('hasModulesShown'); } },
    { id: 'manage-ai', domain: 'manage', label: 'Connected an AI assistant', modes: null, route: 'settings',
      enabled: function () { return nsc('hasAiApiKey'); } },
    { id: 'manage-surveys', domain: 'manage', label: 'Customer surveys', modes: ['retail', 'bookings', 'maker'], route: 'cs-surveys',
      enabled: function () { return hasFeaturePage('surveys'); }, usedRoutes: ['cs-surveys', 'cs-surveys-v2'] },
    { id: 'manage-channels', domain: 'manage', label: 'Connected a sales channel', modes: ['retail', 'maker'], route: 'channels',
      enabled: function () { return S.channelConnected; } },
    { id: 'manage-mapping', domain: 'manage', label: 'Matched channel listings', modes: ['retail', 'maker'], route: 'mapping',
      enabled: function () { return nsc('mappingComplete'); } },
    { id: 'manage-team', domain: 'manage', label: 'Invited a team member', modes: null, route: 'team',
      usedRoutes: ['team', 'team-v2', 'employees', 'employees-v2'] }
  ];

  // The set of probe paths a capability touches (mode-filtered before probing so
  // we never read collections this tenant's business can't use).
  function probePathsFor(cap) {
    var p = [];
    if (cap.probe) p.push(cap.probe);
    if (cap.id === 'make-products') p.push('public/products');
    if (cap.id === 'market-newsletter') p.push('newsletter/subscribers');
    return p;
  }

  // A capability counts for this tenant if mode-relevant. Unknown modes -> include
  // everything (don't over-filter and make every score look low). `overlay` caps
  // require that overlay to be present.
  function relevant(cap) {
    if (cap.overlay) return hasOverlay(cap.overlay);
    if (!cap.modes) return true;
    if (!S.modes.length) return true;
    return cap.modes.some(function (m) { return S.modes.indexOf(m) >= 0; });
  }

  // -- three-tier resolution -----------------------------------------------------
  // Returns { credit, state } where state is one of used | enabled | none | unknown.
  // 'NA' marks a tier the capability doesn't have; null marks a tier not yet
  // resolved (read in flight / failed). Unknown excludes the cap from the score.
  function capEnabled(cap) { return cap.enabled ? sig(cap.enabled) : 'NA'; }
  function capUsed(cap) {
    if (cap.used) return sig(cap.used);
    if (cap.probe) return recUsed(cap.probe);
    if (cap.usedRoutes) return routeUsed(cap.usedRoutes);
    return 'NA';
  }
  function sig(fn) { try { var v = fn(); return (v === null || v === undefined) ? null : !!v; } catch (_e) { return null; } }

  function resolve(cap) {
    var u = capUsed(cap), e = capEnabled(cap);
    if (u === true) return { credit: 1, state: 'used' };
    if (e === true) return (u === 'NA')
      ? { credit: 1, state: 'used' }            // config-type: enabling IS the value
      : { credit: ENABLED_CREDIT, state: 'enabled' };
    // no tier is true - decide none (counted 0) vs unknown (excluded).
    var present = [];
    if (u !== 'NA') present.push(u);
    if (e !== 'NA') present.push(e);
    if (!present.length) return { credit: null, state: 'unknown' };
    if (present.indexOf(null) >= 0) return { credit: null, state: 'unknown' };
    return { credit: 0, state: 'none' };
  }

  // -- scoring -------------------------------------------------------------------
  function computeScores() {
    var byDomain = {};
    var total = 0, credit = 0, used = 0;
    CATALOG.forEach(function (cap) {
      if (!relevant(cap)) return;
      var r = resolve(cap);
      if (r.state === 'unknown') return; // exclude from both sides
      var d = byDomain[cap.domain] || (byDomain[cap.domain] = { total: 0, credit: 0, used: 0, todo: [], partial: [], doneCaps: [] });
      d.total++; total++;
      d.credit += r.credit; credit += r.credit;
      if (r.state === 'used') { d.used++; used++; d.doneCaps.push(cap); }
      else if (r.state === 'enabled') { d.partial.push(cap); }
      else { d.todo.push(cap); }
    });
    var pct = total > 0 ? Math.round(credit / total * 100) : 0;
    return { pct: pct, used: used, total: total, credit: credit, byDomain: byDomain };
  }

  // The single best "next thing": prefer a not-started capability, else a half-done
  // (enabled-not-used) one, from the domain with the lowest completion - so the
  // nudge spreads the merchant's usage rather than piling onto a strong area.
  function topOpportunity(scores) {
    var best = null, bestPct = 2;
    DOMAIN_ORDER.forEach(function (dom) {
      var d = scores.byDomain[dom];
      if (!d || (!d.todo.length && !d.partial.length)) return;
      var p = d.total > 0 ? d.credit / d.total : 1;
      if (p < bestPct) {
        bestPct = p;
        best = d.todo.length ? { cap: d.todo[0], partial: false } : { cap: d.partial[0], partial: true };
      }
    });
    return best;
  }

  // -- data load (cheap reads / already-cached state + bounded probes) -----------
  function pget(fn) { try { return Promise.resolve(fn()); } catch (_e) { return Promise.resolve(null); } }

  // >=1-record existence probe. limitToFirst(1) -> at most one doc read.
  function probe(path) {
    return pget(function () { return MastDB.query(path).limitToFirst(1).once(); }).then(function (snap) {
      var data = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      return !!(data && Object.keys(data).length);
    }).catch(function () { return false; });
  }

  // One bounded analytics/hits read -> the Set of route ids hit in the last 30d.
  function scanUsage() {
    return pget(function () {
      return MastDB.query('analytics/hits').orderByChild('ts').limitToLast(HITS_SCAN).once();
    }).then(function (snap) {
      var data = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var cutoff = Date.now() - USED_WINDOW_MS;
      var set = new Set();
      Object.keys(data || {}).forEach(function (k) {
        var h = data[k];
        if (h && typeof h.ts === 'number' && h.ts >= cutoff && h.p) set.add(String(h.p));
      });
      S.usedRoutes = set;
    }).catch(function () { /* leave usedRoutes null -> usage signals stay unknown */ });
  }

  function loadState() {
    var jobs = [];
    // Onboarding cache - populated by the shell's loadNextStepsCache(); refresh it
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
      S.overlays = (m && m.overlays) || [];
    }));

    // Any live sales-channel connection.
    if (window.ChannelConnection && typeof window.ChannelConnection.isChannelConnected === 'function') {
      ['square', 'shopify', 'etsy'].forEach(function (ch) {
        jobs.push(pget(function () { return window.ChannelConnection.isChannelConnected(ch); }).then(function (ok) {
          if (ok) S.channelConnected = true;
        }));
      });
    }

    // Lifetime orders - reuse the count the Set-Up-Your-Shop card already loads;
    // leave null (excluded) until it resolves rather than count zero against them.
    if (typeof window._lifetimeOrdersCount === 'number') S.orders = window._lifetimeOrdersCount;

    // Tier-2 "used" signals - bounded record probes + the analytics scan. These
    // don't change intra-session, so run ONCE (countsLoaded gate); the cheap
    // onboarding/mode/channel reads above re-run on every re-sync as those fill in.
    // We must know the tenant's modes before probing so we only read collections
    // relevant to this business; the mode read above is in `jobs`, so chain after.
    var firstPass = !S.countsLoaded;
    var head = Promise.all(jobs);
    if (firstPass) {
      head = head.then(function () {
        var probes = {};
        CATALOG.forEach(function (cap) {
          if (!relevant(cap)) return;
          probePathsFor(cap).forEach(function (path) { probes[path] = true; });
        });
        var pjobs = Object.keys(probes).map(function (path) {
          return probe(path).then(function (has) { S.counts[path] = has; });
        });
        pjobs.push(scanUsage());
        return Promise.all(pjobs).then(function () { S.countsLoaded = true; });
      });
    }
    return head.then(function () { S.loaded = true; });
  }

  // -- the Dashboard card --------------------------------------------------------
  function bar(pct) {
    return '<div style="background:var(--hover-bg, var(--cream-dark));border-radius:6px;height:6px;margin:4px 0 14px;overflow:hidden;">' +
      '<div style="background:var(--teal);height:100%;width:' + pct + '%;border-radius:6px;transition:width 0.3s;"></div>' +
      '</div>';
  }

  function cardBody(scores) {
    var opp = topOpportunity(scores);
    var h = '';
    h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 2px;">' +
      'You\'re using <strong style="color:var(--text);">' + scores.used + ' of ' + scores.total + '</strong> ' +
      'capabilities available to your business.</p>';
    h += bar(scores.pct);
    if (opp) {
      var verb = opp.partial ? 'Finish setup' : 'Set it up';
      var tag = opp.partial ? 'Half-done' : 'Biggest opportunity';
      h += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;background:var(--hover-bg, var(--cream-dark));">' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--warm-gray);">' + tag + ' · ' + esc(DOMAIN_LABEL[opp.cap.domain] || opp.cap.domain) + '</div>' +
          '<div style="font-size:0.9rem;font-weight:600;color:var(--text);">' + esc(opp.cap.label) + '</div>' +
        '</div>' +
        '<button class="btn btn-secondary btn-small" onclick="navigateTo(\'' + esc(opp.cap.route) + '\')">' + verb + '</button>' +
      '</div>';
    } else {
      h += '<p style="font-size:0.85rem;color:var(--teal);font-weight:600;margin:0;">You\'re using everything Mast offers for your business. 🎉</p>';
    }
    if (S.band) {
      h += '<div style="margin-top:12px;font-size:0.85rem;color:var(--text);">🏅 You\'re in the <strong style="color:var(--teal);">' + esc(bandLabel(S.band)) + '</strong> of makers your size.</div>';
    }
    h += '<div style="margin-top:12px;"><a onclick="navigateTo(\'adoption\')" style="font-size:0.85rem;color:var(--teal);cursor:pointer;font-weight:600;">View full breakdown →</a></div>';
    h += '<p style="font-size:0.72rem;color:var(--warm-gray);margin:10px 0 0;">Reflects the features you\'ve set up and are actively using.</p>';
    return h;
  }

  // -- hide/show: collapse the card to a score bubble next to the dashboard gear --
  // The bubble lives in the Dashboard section-header (beside the ⚙ gear); the card
  // and the bubble are mutually exclusive. State persists per browser/tenant origin.
  var HIDE_KEY = '__mast_adoption_card_hidden';
  function isHidden() { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch (_e) { return false; } }
  function setHidden(v) {
    try { v ? localStorage.setItem(HIDE_KEY, '1') : localStorage.removeItem(HIDE_KEY); } catch (_e) {}
  }

  // Paint (or remove) the collapsed score bubble. Shown only while hidden AND we
  // have a real score; otherwise removed so a stale badge never lingers.
  function renderBubble(scores) {
    var existing = document.getElementById('adoptionScoreBubble');
    var show = isHidden() && scores && scores.total > 0;
    if (!show) { if (existing) existing.parentNode.removeChild(existing); return; }
    var gear = document.querySelector('#dashboardTab .dash-settings-gear');
    if (!gear) return; // header not on screen yet; next repaint will catch it
    var html = '<span id="adoptionScoreBubble" onclick="AdoptionV2.show()" role="button" tabindex="0" ' +
      'title="Show your Mast value score" ' +
      'style="display:inline-flex;align-items:center;gap:5px;margin-right:12px;padding:3px 11px;border-radius:999px;' +
      'background:var(--hover-bg, var(--cream-dark));color:var(--teal);font-size:0.8rem;font-weight:700;cursor:pointer;line-height:1.4;">' +
      '🏅 ' + scores.pct + '%</span>';
    if (existing) existing.outerHTML = html;
    else gear.insertAdjacentHTML('beforebegin', html);
  }

  function renderCard() {
    var container = document.getElementById('dashCardAdoption');
    if (!container) return;
    var scores = S.loaded ? computeScores() : null;
    // Hidden → empty the card slot and collapse to the gear-side bubble.
    if (isHidden()) { container.innerHTML = ''; renderBubble(scores); return; }
    renderBubble(null); // shown → ensure no leftover bubble
    if (!S.loaded) {
      container.innerHTML =
        '<div class="dash-card" id="dashCard_adoption"><div class="dash-card-header" style="cursor:default;">' +
        '<div class="dash-card-title"><h3>Your Mast value score</h3></div></div>' +
        '<div class="dash-card-body"><p style="font-size:0.85rem;color:var(--warm-gray);margin:0;">Calculating…</p></div></div>';
      return;
    }
    if (scores.total === 0) { container.innerHTML = ''; return; }
    container.innerHTML =
      '<div class="dash-card" id="dashCard_adoption">' +
        '<div class="dash-card-header" style="cursor:default;">' +
          '<div class="dash-card-title"><h3>Your Mast value score</h3></div>' +
          '<div class="dash-card-actions">' +
            '<span class="dash-card-count">' + scores.pct + '%</span>' +
            '<span onclick="event.stopPropagation();AdoptionV2.hide()" role="button" tabindex="0" ' +
              'title="Hide — collapse to a badge next to the dashboard gear" ' +
              'style="font-size:0.78rem;color:var(--warm-gray);cursor:pointer;">Hide</span>' +
          '</div>' +
        '</div>' +
        '<div class="dash-card-body">' + cardBody(scores) + '</div>' +
      '</div>';
  }

  // -- the full breakdown view (#adoption route) --------------------------------
  function viewVisible() {
    var t = document.getElementById('adoptionTab');
    return !!(t && t.style.display !== 'none');
  }
  function repaint() { renderCard(); renderView(); }

  // A capability row: In use (full) - On/not-used (partial, nudge) - Set up (none).
  function capRow(cap, state) {
    var U = window.MastUI;
    var right;
    if (state === 'used') {
      right = U ? U.badge('✓ In use', 'success') : '<span style="color:var(--teal);font-size:0.85rem;">✓ In use</span>';
    } else if (state === 'enabled') {
      right = (U ? U.badge('On — not used yet', 'amber') : '<span style="color:var(--amber);font-size:0.85rem;">On — not used yet</span>') +
        ' <a onclick="navigateTo(\'' + esc(cap.route) + '\')" style="font-size:0.85rem;color:var(--teal);cursor:pointer;">Use it →</a>';
    } else {
      right = '<a onclick="navigateTo(\'' + esc(cap.route) + '\')" style="font-size:0.85rem;color:var(--teal);cursor:pointer;">Set up →</a>';
    }
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid var(--cream-dark);">' +
      '<span style="font-size:0.9rem;color:var(--text);">' + esc(cap.label) + '</span><span style="display:flex;align-items:center;gap:8px;">' + right + '</span></div>';
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
      var domPct = Math.round(d.credit / d.total * 100);
      var mastered = d.used === d.total;
      if (mastered) masteryCount++;
      var rows = '';
      d.doneCaps.forEach(function (c) { rows += capRow(c, 'used'); });
      d.partial.forEach(function (c) { rows += capRow(c, 'enabled'); });
      d.todo.forEach(function (c) { rows += capRow(c, 'none'); });
      var title = (DOMAIN_LABEL[dom] || dom) + ' · ' + domPct + '%' + (mastered ? ' ⭐' : '');
      cards += U ? U.card(title, rows) : ('<h3>' + esc(title) + '</h3>' + rows);
    });
    var intro = '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 14px;max-width:560px;">' +
      'How much of Mast you\'re putting to work. A capability earns partial credit once it\'s switched on, and full credit once you\'re actually using it — turn on more to get the full value of your subscription.</p>';
    var tiles = U ? U.tiles([
      { k: 'Value score', v: scores.pct + '%', hero: true },
      { k: 'Capabilities in use', v: scores.used + ' / ' + scores.total },
      { k: 'Domains mastered', v: String(masteryCount) }
    ]) : '';
    var bench = S.band ? '<p style="font-size:0.9rem;color:var(--text);margin:14px 0 0;">🏅 You\'re in the <strong style="color:var(--teal);">' + esc(bandLabel(S.band)) + '</strong> of makers your size' + (S.cohortN ? ' (compared with ' + S.cohortN + ' similar shops)' : '') + '.</p>' : '';
    var foot = '<p style="font-size:0.72rem;color:var(--warm-gray);margin:14px 0 0;">Scoped to your business type — you\'re only scored on capabilities that fit how you operate.</p>';
    tab.innerHTML = head + intro + tiles + bench + cards + foot;
  }

  // (Re)load signals then repaint. Single-flighted with a trailing coalesce so the
  // burst of boot-time triggers (TENANT_READY, the two dashboard-render hooks, and
  // the safety-net poll) collapse into at most one in-flight load plus one trailing
  // re-sync - never a read storm.
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
    // Paint instantly (the "Calculating" placeholder on first paint, or the
    // last-known score on a repeat view - no flicker), then (re)load and repaint.
    // We ALWAYS reload rather than trust a single cached load: the onboarding
    // signals we read (_nextStepsCache's fields, the lifetime-orders count)
    // initialise all-false/undefined and are filled in asynchronously by the shell
    // over the first few seconds, so a one-shot load can lock in a bogus 0%.
    renderCard();
    reloadAndRender();
  }

  // -- G3: anonymized cohort benchmark (gated CF; dormant until [ARCH] deploys) --
  // Emits THIS tenant's own value-score to the platform aggregator and reads back
  // ONLY its own cohort percentile band - the tenant app never reads another
  // tenant's data. Stays invisible until reportAdoptionScore is deployed AND the
  // cohort clears the anonymity floor (band stays null -> nothing renders).
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
      out[dom] = d.total ? Math.round(d.credit / d.total * 100) : 0;
    });
    return out;
  }
  var _reportTried = false; // at most one attempt per page load
  function reportAndBenchmark(scores) {
    if (_reportTried) return;
    // Throttle to ~once/day across loads - the score barely moves intra-day and this is a write.
    try {
      var last = +(localStorage.getItem('__mast_adoption_reported') || 0);
      if (last && (Date.now() - last) < 20 * 3600 * 1000) { _reportTried = true; return; }
    } catch (_e) {}
    if (typeof firebase === 'undefined' || !firebase.functions) return;
    // The deployed reportAdoptionScore is gated via assertTenantMember(tenantId) - it
    // requires tenantId in the body (validated against the caller's membership), so we
    // send it explicitly. No tenant context -> skip (can't report).
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
    }).catch(function () { /* reportAdoptionScore not deployed yet - stay dormant */ });
  }

  // -- wire into the dashboard render (wrap, don't edit the shell) ---------------
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

  // -- the dedicated #adoption route (reached from the Dashboard card link) ------
  // Registered via MastAdmin so applyRoute() renders #adoptionTab. No sidebar item
  // (that would need a MODE_ROUTE_VISIBILITY rule + risks a silent mode-hide);
  // discovery is the card's "View full breakdown" link.
  function openView() { renderView(); reloadAndRender(); }
  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('adoption', { routes: { adoption: { tab: 'adoptionTab', setup: openView } } });
  }

  window.AdoptionV2 = {
    refresh: function () { reloadAndRender(); },
    open: function () { if (typeof navigateTo === 'function') navigateTo('adoption'); },
    hide: function () { setHidden(true); renderCard(); },
    show: function () { setHidden(false); renderCard(); }
  };
  start();
})();
