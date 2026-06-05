/**
 * settings-v2.js — the Settings producer surface (doc 17 §14c step 2).
 *
 * The capstone over the config surfaces. A producer is just a control that yields
 * an object the presenter handles; for config areas the producer is a launcher
 * grid. Under the ratified read-on-page model each config area is now its OWN
 * read-only page (wallet-v2 / terms-v2 / brand-v2 / homepage-v2), so Settings is a
 * NAV index: a compact grid of cards, each showing that area's live status at a
 * glance and navigating to its read page. Four areas — well under the ~6-8 where
 * §14b says to group with page-level tabs — so a flat grid (no tabs).
 *
 * Flag-gated (?ui=1) at #settings-v2, side-by-side with the legacy settings/admin
 * surfaces; touches no legacy module.
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

  var U = window.MastUI, esc = U._esc;

  var V2 = { wallet: null, terms: null, brandLogo: null, brandLogoUrl: null, brandVoice: null, nav: null, wp: null, theme: null, loaded: false };

  // The config areas this producer launches into. Each summary is read-only.
  var AREAS = [
    { route: 'wallet-v2', title: 'Wallet & instruments', desc: 'Gift cards, loyalty & store credit', summary: function () {
        var c = V2.wallet || {}; var on = [];
        if (c.giftCardsEnabled) on.push('Gift cards'); if (c.loyaltyEnabled) on.push('Loyalty');
        if (c.creditsEnabled !== false) on.push('Store credit');
        return on.length ? (on.join(' · ') + ' on') : 'No instruments enabled';
      } },
    { route: 'terms-v2', title: 'Policies', desc: 'Returns, terms & conditions', summary: function () {
        var c = V2.terms || {}; var win = (c.returnWindowDays != null ? c.returnWindowDays : 30) + '-day returns';
        return win + ' · ' + (c.lastPublishedAt ? 'published' : 'not published');
      } },
    { route: 'brand-v2', title: 'Brand', desc: 'Logo & brand voice', summary: function () {
        var hasLogo = !!((V2.brandLogo && V2.brandLogo.primary && V2.brandLogo.primary.url) || V2.brandLogoUrl);
        var hasVoice = !!(V2.brandVoice && (V2.brandVoice.tagline || V2.brandVoice.voiceRules));
        return 'Logo ' + (hasLogo ? 'set' : 'not set') + ' · Voice ' + (hasVoice ? 'set' : 'not set');
      } },
    { route: 'homepage-v2', title: 'Homepage', desc: 'Sections, theme & testimonials', summary: function () {
        var defs = [{ id: 'hero', req: true }, { id: 'gallery' }, { id: 'about' }, { id: 'contact' }, { id: 'newsletter' }, { id: 'members' }];
        var on = defs.filter(function (s) {
          if (s.req) return true;
          var nav = (V2.nav && V2.nav[s.id]) || {}; var wp = (V2.wp && V2.wp.sections && V2.wp.sections[s.id]) || {};
          return nav.enabled !== false && wp.enabled !== false;
        }).length;
        var tpl = (V2.theme && V2.theme.templateId) ? String(V2.theme.templateId).replace(/[-_]/g, ' ') : 'artisan';
        return on + ' of ' + defs.length + ' sections on · ' + tpl;
      } }
  ];

  function ensureTab() {
    var el = document.getElementById('settingsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'settingsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function launcher(area) {
    var sub = V2.loaded ? esc(area.summary()) : 'Loading…';
    var body = '<div style="font-size:0.9rem;color:var(--text-primary);">' + esc(area.desc) + '</div>' +
      '<div class="mu-sub" style="margin-top:8px;">' + sub + '</div>';
    return U.launchCard({ title: area.title, body: body, onClickFnName: 'SettingsV2.open', arg: area.route, arrow: 'Open →' });
  }

  function render() {
    var tab = ensureTab();
    tab.innerHTML = U.pageHeader({ title: 'Settings', subtitle: 'Store configuration' }) + U.cardGrid(AREAS.map(launcher));
  }

  window.SettingsV2 = {
    open: function (route) { if (typeof navigateTo === 'function') navigateTo(route); },
    refresh: function () { render(); }
  };

  function load() {
    Promise.all([
      Promise.resolve(MastDB.walletConfig.get()).catch(function () { return null; }),
      Promise.resolve(MastDB.termsConfig.get()).catch(function () { return null; }),
      Promise.resolve(MastDB.get('config/brand/logo')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/nav/logoUrl')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('config/brand/voice')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/nav/sections')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('webPresence/config')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/theme')).catch(function () { return null; })
    ]).then(function (r) {
      V2.wallet = r[0]; V2.terms = r[1]; V2.brandLogo = r[2]; V2.brandLogoUrl = r[3];
      V2.brandVoice = r[4]; V2.nav = r[5]; V2.wp = r[6]; V2.theme = r[7];
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[settings-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('settings-v2', {
    routes: { 'settings-v2': { tab: 'settingsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
