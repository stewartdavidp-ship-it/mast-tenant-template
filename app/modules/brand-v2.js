/**
 * brand-v2.js — Brand, the read-on-page model (read-focused twin).
 *
 * Global model (operator, 2026-06-01): NAV → a READ-ONLY view of the current
 * settings. For brand both edit paths are storefront-coupled, so editing stays on
 * legacy (read-focused twin, like trips/team/procurement):
 *   • Logo upload writes public/config/nav/logoUrl + public/config/brand/logo/* and
 *     uses the uploadImage Cloud Function + Storage + variant generation.
 *   • Voice save mirrors tagline + positioning to public/config/brand/* for the
 *     storefront <title>/OG/meta — a public side effect.
 * Neither write is side-effect-free, so per policy we PRESENT the brand config
 * read-on-page and route every edit to the classic Brand view; brand.js untouched.
 *
 * Flag-gated (?ui=1) at #brand-v2, side-by-side with legacy #brand.
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
  var VARIANTS = [
    { key: 'hero', label: 'Hero banner' }, { key: 'footer', label: 'Footer' },
    { key: 'email', label: 'Email header' }, { key: 'favicon', label: 'Favicon' }
  ];

  var V2 = { logo: null, legacyLogoUrl: null, voice: null, loaded: false };

  function primaryUrl() { return (V2.logo && V2.logo.primary && V2.logo.primary.url) || V2.legacyLogoUrl || null; }
  function variantsSet() { var v = (V2.logo && V2.logo.variants) || {}; return VARIANTS.filter(function (x) { return v[x.key] && v[x.key].url; }); }
  function placementsSet() { var p = (V2.logo && V2.logo.placements) || {}; return Object.keys(p).filter(function (k) { return p[k]; }); }

  function ensureTab() {
    var el = document.getElementById('brandV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'brandV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function logoCard() {
    var url = primaryUrl();
    var preview = url
      ? '<div style="background:var(--surface-dark);border-radius:8px;padding:16px;display:flex;align-items:center;justify-content:center;min-height:96px;"><img src="' + esc(url) + '" alt="Brand logo" style="max-height:72px;max-width:100%;object-fit:contain;"></div>'
      : '<div style="background:var(--surface-dark);border-radius:8px;padding:24px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">No logo uploaded yet.</div>';
    var vs = variantsSet();
    var rows = U.kv([
      { k: 'Primary logo', v: url ? 'Set' : 'Not set' },
      { k: 'Variants', v: vs.length ? esc(vs.map(function (x) { return x.label; }).join(', ')) : 'None' },
      { k: 'Placements', v: placementsSet().length ? (placementsSet().length + ' set') : 'None' }
    ]);
    return U.card('Logo', preview + '<div style="margin-top:12px;">' + rows + '</div>' +
      '<div class="mu-sub" style="margin-top:12px;"><button class="btn btn-secondary" onclick="BrandV2.classic()">Manage logos &amp; placements (classic view) →</button></div>', { fill: true });
  }

  function voiceCard() {
    var v = V2.voice || {};
    function block(label, text, mono) {
      return '<div style="margin-bottom:12px;"><div class="mu-sub" style="margin-bottom:3px;">' + esc(label) + '</div>' +
        (text ? '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));line-height:1.5;white-space:pre-wrap;">' + esc(text) + '</div>' : '<span class="mu-sub">Not set.</span>') + '</div>';
    }
    return U.card('Brand voice',
      '<div class="mu-sub" style="margin-bottom:12px;">Words &amp; tone used across storefront SEO, newsletter, and social drafts.</div>' +
      block('Tagline', v.tagline) + block('Positioning one-liner', v.positioningOneLiner) + block('Voice rules', v.voiceRules) +
      '<div class="mu-sub" style="margin-top:4px;"><button class="btn btn-secondary" onclick="BrandV2.classic(\'voice\')">Edit brand voice (classic view) →</button></div>', { fill: true });
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) { tab.innerHTML = U.pageHeader({ title: 'Brand', subtitle: 'Logo & brand voice' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>'; return; }
    tab.innerHTML = U.pageHeader({ title: 'Brand', subtitle: 'Logo & brand voice' }) + U.cardGrid([logoCard(), voiceCard()]);
  }

  window.BrandV2 = {
    // Storefront-coupled edits → classic Brand view (read-focused twin).
    classic: function () { if (typeof navigateTo === 'function') navigateTo('brand'); },
    refresh: function () { render(); }
  };

  function load() {
    Promise.all([
      Promise.resolve(MastDB.get('config/brand/logo')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/nav/logoUrl')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('config/brand/voice')).catch(function () { return null; })
    ]).then(function (r) {
      V2.logo = r[0] || null; V2.legacyLogoUrl = r[1] || null; V2.voice = r[2] || null;
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[brand-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('brand-v2', {
    routes: { 'brand-v2': { tab: 'brandV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
