/**
 * subscription-v2.js — Plan & billing, V2 (report + CTA hub).
 *
 * CONSOLIDATION: legacy #subscription and #coins are two sidebar items over
 * ONE object (admin/subscription + the platform tenant doc + the token
 * wallet). This hub serves both as lenses — Plan (tier / usage / revenue
 * ramp / manage) and Top-ups (coin balance / packs / recent purchases) —
 * plus an About lens (build & tenant info, absorbed from static #about,
 * pending Q3 ratification in the plan doc).
 *
 * Read-only + CTA passthrough: every money action delegates to the existing
 * global cores (upgradeFreeTenant, dismissUpgradeOfferBanner, buyCoinPack,
 * openBillingPortal — all Stripe-checkout redirects or CF calls in
 * index.html). This module re-implements NO write and never exercises
 * checkout in tests/walks.
 *
 * Data (same reads as legacy): getTenantSubscription(), v1LoadPlatformTenant()
 * (platform tenant doc: tier, wallet, pendingUpgradeOffer), getTokenWallet(),
 * _revenueMeterFetchMonth (trailing 3 closed months), tokenLog (coin
 * purchases), V1_TIERS table.
 *
 * Routes: #subscription-v2 (Plan lens) and #plan-billing-coins-v2 (Top-ups
 * lens) — both legacy routes remap here under the flag; one module, one tab.
 * Flag-gated (?ui=1), side-by-side with legacy; never touches it.
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
  if (!window.MastAdmin || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;

  var V2 = {
    lens: 'plan',
    tenant: null,      // platform tenant doc
    revenue: null,     // { avgCents, present }
    recent: null,      // recent coin purchases
    loaded: false
  };

  function tierOf(platformTenant) {
    var v1sub = (typeof v1PickActiveSub === 'function') ? v1PickActiveSub(platformTenant) : null;
    var key = v1ResolveTierKey(v1sub ? v1sub.plan : (platformTenant && platformTenant.currentTier));
    return { key: key, tier: V1_TIER_BY_KEY[key], interval: (v1sub && v1sub.billingInterval) || 'month' };
  }

  // ── cards (read-only compositions of the legacy data) ───────────────
  function offerBanner() {
    var offer = V2.tenant && V2.tenant.pendingUpgradeOffer;
    if (!offer || offer.dismissed || !offer.targetTier) return '';
    var tier = V1_TIER_BY_KEY[offer.targetTier];
    if (!tier) return '';
    var avg = offer.avgCents ? ('$' + Math.round(offer.avgCents / 100)) : '';
    return U.card('You qualified for the ' + esc(tier.label) + ' tier',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Trailing 3-month average revenue ' +
      (avg ? '(' + esc(avg) + '/mo) ' : '') + 'crossed the ' + esc(tier.label) + ' threshold. Connect a payment method to upgrade and unlock ' +
      tier.tokens.toLocaleString() + ' tokens/mo + ' + tier.bonusPct + '% coin bonus.</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn btn-primary" onclick="upgradeFreeTenant(\'' + esc(offer.targetTier) + '\', \'month\')">Upgrade (monthly)</button>' +
      '<button class="btn btn-secondary" onclick="upgradeFreeTenant(\'' + esc(offer.targetTier) + '\', \'year\')">Annual (2 months free)</button>' +
      '<button class="btn btn-secondary" onclick="PlanBillingV2.dismissOffer()">Dismiss</button>' +
      '<span id="upgradeOfferStatus" style="font-size:0.85rem;color:var(--warm-gray);"></span>' +
      '</div>');
  }

  function planCards() {
    var t = tierOf(V2.tenant), tier = t.tier;
    var w = (V2.tenant && V2.tenant.tokenWallet) || getTokenWallet() || {};
    var priceText = v1FormatCents(tier.priceMonthly) + '/mo';
    if (t.interval === 'year') priceText = v1FormatCents(tier.priceMonthly * 10) + '/yr (2 months free)';
    var alloc = tier.tokens;
    var current = w.currentBalance || 0;
    var used = Math.max(0, alloc - current);
    var pct = alloc > 0 ? Math.min(100, Math.round((used / alloc) * 100)) : 0;

    var tiles = U.tiles([
      { k: 'Plan', v: esc(tier.label), hero: true },
      { k: 'Price', v: esc(priceText) },
      { k: 'Monthly tokens', v: tier.tokens.toLocaleString() },
      { k: 'Coin bonus', v: '+' + tier.bonusPct + '%' }
    ]);

    var usage = U.card('This month\'s usage',
      '<div style="font-size:0.85rem;margin-bottom:6px;"><strong>' + used.toLocaleString() + '</strong> / ' + alloc.toLocaleString() + ' tokens used (' + pct + '%)</div>' +
      '<div style="background:var(--cream-dark);border-radius:6px;height:10px;overflow:hidden;margin-bottom:10px;">' +
      '<div style="background:var(--amber);height:100%;width:' + pct + '%;"></div></div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);">Resets on the 1st of each month at 00:00 UTC. Coins on hand: <strong style="color:var(--text-primary);">' + (w.coinBalance || 0) + '</strong>' +
      ((w.coinTokenSurplus || 0) > 0 ? ' · surplus tokens: <strong style="color:var(--text-primary);">' + w.coinTokenSurplus.toLocaleString() + '</strong>' : '') + '</div>');

    var revenue = '';
    if (V2.revenue) {
      var avgCents = V2.revenue.avgCents, present = V2.revenue.present;
      var idx = V1_TIERS.findIndex(function (x) { return x.key === t.key; });
      var nextTier = (idx >= 0 && idx < V1_TIERS.length - 1) ? V1_TIERS[idx + 1] : null;
      var inner = '<div style="display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:6px;">' +
        '<div style="font-size:1.6rem;font-weight:700;color:var(--amber);">' + esc(v1FormatCents(avgCents)) + '/mo</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + (present < 3 ? present + ' of 3 closed months available' : 'avg of the last 3 closed months') + '</div></div>';
      if (nextTier && nextTier.revenueFloor > 0) {
        var ma = (typeof v1MonthsActive === 'function') ? v1MonthsActive(V2.tenant) : 3;
        var mult = (typeof v1RampMultiplier === 'function') ? v1RampMultiplier(ma) : 1;
        var floor = Math.round(nextTier.revenueFloor * mult);
        var p2 = Math.min(100, Math.round((avgCents / floor) * 100));
        inner += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:6px;">Next tier: <strong style="color:var(--text-primary);">' + esc(nextTier.label) + '</strong> at ' + esc(v1FormatCents(floor)) + '/mo trailing avg (' + p2 + '%). Tier moves run automatically on the 1st.</div>' +
          '<div style="background:var(--cream-dark);border-radius:6px;height:8px;overflow:hidden;"><div style="background:var(--amber);height:100%;width:' + p2 + '%;"></div></div>';
      } else if (!nextTier) {
        inner += '<div style="font-size:0.85rem;color:var(--warm-gray);">You\'re on the top tier.</div>';
      }
      revenue = U.card('Trailing revenue', inner);
    }

    var manage = U.card('Manage subscription',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Open the Stripe Customer Portal to change plan, update your card, or download invoices.</div>' +
      '<button class="btn btn-primary" id="billingPortalBtn" onclick="openBillingPortal()">Manage subscription</button>' +
      '<span id="billingPortalStatus" style="margin-left:12px;font-size:0.85rem;"></span>');

    return offerBanner() + tiles + usage + revenue + manage;
  }

  function topupCards() {
    var t = tierOf(V2.tenant), tier = t.tier;
    var w = (V2.tenant && V2.tenant.tokenWallet) || getTokenWallet() || {};
    var coinBalance = w.coinBalance || 0;
    var coinSurplus = w.coinTokenSurplus || 0;
    var tiles = U.tiles([
      { k: 'Coins', v: String(coinBalance), hero: true },
      { k: 'Surplus tokens', v: coinSurplus.toLocaleString() },
      { k: 'Total token value', v: ((coinBalance * 100) + coinSurplus).toLocaleString() },
      { k: 'Your bonus', v: '+' + tier.bonusPct + '%' }
    ]);

    var packs = (window.V1_COIN_PACKS || []).map(function (p) {
      var base = p.coins * 100;
      var bonus = Math.floor(base * (tier.bonusPct / 100));
      return '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:14px;display:flex;flex-direction:column;gap:6px;">' +
        '<div style="font-size:1.15rem;font-weight:700;">' + esc(p.label) + '</div>' +
        '<div style="font-size:0.85rem;">' + (base + bonus).toLocaleString() + ' tokens</div>' +
        '<div style="font-size:0.78rem;color:' + (bonus > 0 ? 'var(--teal)' : 'var(--warm-gray)') + ';">' +
        (bonus > 0 ? base.toLocaleString() + ' base + ' + bonus.toLocaleString() + ' bonus' : 'no bonus on this tier') + '</div>' +
        '<button class="btn btn-primary" style="margin-top:6px;" onclick="buyCoinPack(' + p.coins + ', this)">Buy ' + esc(p.label) + '</button>' +
        '</div>';
    }).join('');
    var buy = U.card('Buy coins',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">1 coin = $1 = 100 tokens, plus your <strong>+' + tier.bonusPct + '%</strong> ' + esc(tier.label) + '-tier bonus, locked at purchase time.</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;">' + packs + '</div>' +
      '<div id="coinsPurchaseStatus" style="margin-top:12px;font-size:0.85rem;"></div>');

    var recentRows = (V2.recent || []).map(function (r) {
      var d = r.timestamp ? new Date(r.timestamp) : null;
      var dateStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
      var coins = r.coinsPurchased || r.coins || 0;
      var multi = (typeof r.bonusMultiplier === 'number') ? r.bonusMultiplier : 1;
      return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">' +
        '<span>' + esc(dateStr) + '</span><span style="font-weight:600;">' + coins + ' coins</span>' +
        '<span style="color:var(--teal);">+' + Math.round((multi - 1) * 100) + '%</span>' +
        '<span style="color:var(--warm-gray);">' + esc(r.tierAtPurchase || '—') + '</span></div>';
    }).join('');
    var recent = U.card('Recent purchases', recentRows || '<div style="font-size:0.85rem;color:var(--warm-gray);">No coin purchases yet.</div>');

    return tiles + buy + recent;
  }

  function aboutCards() {
    var sub = getTenantSubscription();
    var tenantId = (window.MastDB && MastDB.tenantId ? MastDB.tenantId() : null) || '—';
    var modules = (sub.modules || []).filter(function (m) { return m !== 'web'; }).join(', ') || 'none';
    var kv = U.kv([
      { k: 'Build', v: '<span style="font-family:monospace;font-size:0.78rem;">' + esc(window.MAST_BUILD_V || '—') + '</span>' },
      { k: 'Modules bundle', v: '<span style="font-family:monospace;font-size:0.78rem;">' + esc(window.MAST_MODULES_V || '—') + '</span>' },
      { k: 'Tenant', v: esc(tenantId) },
      { k: 'Tier', v: '<span style="text-transform:capitalize;">' + esc(sub.tier || '—') + '</span>' },
      { k: 'Active modules', v: '<span style="text-transform:capitalize;">' + esc(modules) + '</span>' }
    ]);
    return U.card('About Mast', kv) +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">Powered by Mast — runmast.com</div>';
  }

  // ── shell ────────────────────────────────────────────────────────────
  function ensureTab() {
    var el = document.getElementById('subscriptionV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'subscriptionV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function lensPill(key, label) {
    var on = V2.lens === key;
    return '<button onclick="PlanBillingV2.setLens(\'' + key + '\')" style="border:1px solid var(--border);' +
      'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
      'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
      'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + label + '</button>';
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Plan & billing' }) + '<div style="margin-top:14px;color:var(--warm-gray);">Loading…</div>';
      return;
    }
    var body = V2.lens === 'topups' ? topupCards() : (V2.lens === 'about' ? aboutCards() : planCards());
    tab.innerHTML =
      U.pageHeader({ title: 'Plan & billing', subtitle: 'Your Mast plan, token usage and top-ups' }) +
      '<div style="margin:14px 0;">' + lensPill('plan', 'Plan') + lensPill('topups', 'Top-ups') + lensPill('about', 'About') + '</div>' +
      body;
  }

  function load() {
    if (typeof _v1PlatformTenantCache !== 'undefined') _v1PlatformTenantCache = null; // fresh, like legacy
    var tenantP = Promise.resolve(v1LoadPlatformTenant()).catch(function () { return null; });

    // Trailing 3 closed months (same read as legacy revenue card).
    var monthKeys = [];
    var now = new Date();
    for (var i = 1; i <= 3; i++) {
      var d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      monthKeys.push(d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'));
    }
    var revenueP = Promise.all(monthKeys.map(function (k) {
      return Promise.resolve(_revenueMeterFetchMonth(k)).catch(function () { return null; });
    })).then(function (docs) {
      var total = 0, present = 0;
      docs.forEach(function (doc) { if (doc && typeof doc.netCents === 'number') { total += doc.netCents; present++; } });
      return { avgCents: present > 0 ? Math.round(total / present) : 0, present: present };
    }).catch(function () { return null; });

    // Recent coin purchases (same data as legacy: tokenLog, coin_purchase).
    // NOTE: the compat query exposes .once(), NOT .get() — legacy
    // renderCoinsRecentList calls .get() inside a try/catch and has been
    // silently falling back to "Could not load" since the Firestore
    // migration (debt-registered in the plan doc).
    var recentP = Promise.resolve(MastDB.query('tokenLog').orderByChild('timestamp').limitToLast(50).once()).then(function (snap) {
      var log = (snap && typeof snap.val === 'function') ? snap.val() : snap;
      var rows = [];
      Object.keys(log || {}).forEach(function (k) {
        var r = log[k];
        if (r && r.category === 'coin_purchase') rows.push(r);
      });
      rows.sort(function (a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
      return rows.slice(0, 10);
    }).catch(function () { return []; });

    Promise.all([tenantP, revenueP, recentP]).then(function (res) {
      V2.tenant = res[0]; V2.revenue = res[1]; V2.recent = res[2];
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[subscription-v2] load', e); V2.loaded = true; render(); });
  }

  window.PlanBillingV2 = {
    setLens: function (l) { V2.lens = l; render(); },
    refresh: function () { V2.loaded = false; render(); load(); },
    // Delegates to the legacy core (CF dismissUpgradeOffer), then refreshes
    // THIS surface (the legacy one re-renders itself when visited).
    dismissOffer: function () {
      Promise.resolve(mastConfirm('Dismiss the upgrade offer? We won\'t show it again until you cross a new tier threshold.', { title: 'Dismiss offer' })).then(function (ok) {
        if (!ok) return;
        firebase.functions().httpsCallable('dismissUpgradeOffer')({ tenantId: MastDB.tenantId() }).then(function () {
          if (window.showToast) showToast('Upgrade offer dismissed.');
          window.PlanBillingV2.refresh();
        }).catch(function (err) {
          if (window.showToast) showToast('Could not dismiss: ' + ((err && err.message) || err), true);
        });
      });
    }
  };

  // Two routes, one tab: #subscription-v2 lands on Plan, the coins remap
  // lands on Top-ups (mirrors the finance-hub entry-lens pattern).
  MastAdmin.registerModule('subscription-v2', {
    routes: {
      'subscription-v2': { tab: 'subscriptionV2Tab', setup: function () { V2.lens = 'plan'; ensureTab(); render(); load(); } },
      'plan-billing-coins-v2': { tab: 'subscriptionV2Tab', setup: function () { V2.lens = 'topups'; ensureTab(); render(); load(); } }
    }
  });
})();
