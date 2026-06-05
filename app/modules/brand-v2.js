/**
 * brand-v2.js — Brand, native-edit twin (Logo + Brand voice).
 *
 * NATIVE EDITING (operator, 2026-06-05): the classic-view crutches are gone.
 * Voice and logo are edited in-place here; both WRITES delegate to
 * window.BrandBridge (exposed in brand.js) so the storefront-coupled fan-out
 * stays single-sourced:
 *   • Voice save → BrandBridge.saveVoice → config/brand/voice + public mirror
 *     (tagline/positioningOneLiner for the storefront <title>/OG/meta).
 *   • Logo (primary + variants) → BrandBridge.setLogoFromUrl → MastBrandSync
 *     fan-out (canonical config/brand/logo/* + public/config/nav/logoUrl +
 *     platform mirrors) + resolvePublicPlacements.
 *   • Placement assignment → BrandBridge.savePlacement → resolvePublicPlacements.
 *   • Variant delete → BrandBridge.deleteVariant.
 * Logos are set FROM A URL (no file picker) — that's what the legacy surface
 * supports without library coupling. The image-library picker (uploadImage CF
 * path) is genuinely library-only and stays reachable via classic Brand.
 *
 * The host module (brand.js, which owns BrandBridge) is loaded at route setup;
 * every delegated call guards on window.BrandBridge and kicks a reload + toast
 * if it isn't ready yet (a pure-v2 load would otherwise no-op silently).
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
  // Variant + placement vocab mirrors brand.js (LOGO_TYPES variants + PLACEMENTS).
  var VARIANTS = [
    { key: 'transparent', label: 'Transparent' }, { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' }, { key: 'icon', label: 'Icon' }, { key: 'email', label: 'Email' }
  ];
  var PLACEMENTS = [
    { key: 'navBar', label: 'Navigation bar', defaultHeight: 48 },
    { key: 'hero', label: 'Hero banner', defaultHeight: 120 },
    { key: 'footer', label: 'Footer', defaultHeight: 60 },
    { key: 'email', label: 'Email header', defaultHeight: 60 },
    { key: 'favicon', label: 'Favicon', defaultHeight: 32 }
  ];

  var V2 = { logo: null, legacyLogoUrl: null, voice: null, loaded: false };

  // -- Host-module guard --
  // BrandBridge lives in brand.js. Ensure it is loaded; if a delegated call fires
  // before it exists, kick a reload and tell the operator to retry.
  function ensureBrandModule() {
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
      try { MastAdmin.loadModule('brand'); } catch (e) {}
    }
  }
  function bridgeReady() {
    if (window.BrandBridge) return true;
    ensureBrandModule();
    if (window.showToast) showToast('Brand engine still loading — try again', true);
    return false;
  }

  function primaryUrl() { return (V2.logo && V2.logo.primary && V2.logo.primary.url) || V2.legacyLogoUrl || null; }
  function variantUrl(key) { var v = (V2.logo && V2.logo.variants) || {}; return (v[key] && v[key].url) || null; }
  function variantsSet() { return VARIANTS.filter(function (x) { return variantUrl(x.key); }); }
  function placementMap() { return (V2.logo && V2.logo.placements) || {}; }
  function placementsSet() { var p = placementMap(); return Object.keys(p).filter(function (k) { return p[k] && p[k].variantKey; }); }
  function availableLogoKeys() {
    var keys = [];
    if (primaryUrl()) keys.push('primary');
    VARIANTS.forEach(function (x) { if (variantUrl(x.key)) keys.push(x.key); });
    return keys;
  }
  function logoKeyLabel(k) { if (k === 'primary') return 'Primary'; var f = VARIANTS.filter(function (x) { return x.key === k; })[0]; return f ? f.label : k; }

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
    var actions = '<div class="mu-sub" style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn btn-primary" onclick="BrandV2.editLogo(\'primary\')">' + (url ? 'Replace primary logo' : 'Set primary logo') + '</button>' +
      '<button class="btn btn-secondary" onclick="BrandV2.manageVariants()">Variants &amp; placements</button>' +
      '</div>';
    return U.card('Logo', preview + '<div style="margin-top:12px;">' + rows + '</div>' + actions, { fill: true });
  }

  function voiceCard() {
    var v = V2.voice || {};
    function block(label, text) {
      return '<div style="margin-bottom:12px;"><div class="mu-sub" style="margin-bottom:3px;">' + esc(label) + '</div>' +
        (text ? '<div style="font-size:0.9rem;color:var(--text-primary);line-height:1.5;white-space:pre-wrap;">' + esc(text) + '</div>' : '<span class="mu-sub">Not set.</span>') + '</div>';
    }
    return U.card('Brand voice',
      '<div class="mu-sub" style="margin-bottom:12px;">Words &amp; tone used across storefront SEO, newsletter, and social drafts.</div>' +
      block('Tagline', v.tagline) + block('Positioning one-liner', v.positioningOneLiner) + block('Voice rules', v.voiceRules) +
      '<div class="mu-sub" style="margin-top:4px;"><button class="btn btn-primary" onclick="BrandV2.editVoice()">Edit brand voice</button></div>', { fill: true });
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) { tab.innerHTML = U.pageHeader({ title: 'Brand', subtitle: 'Logo & brand voice' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>'; return; }
    tab.innerHTML = U.pageHeader({ title: 'Brand', subtitle: 'Logo & brand voice' }) + U.cardGrid([logoCard(), voiceCard()]);
  }

  // -- Edit forms (engine form primitives: form-group/-label/-input, mu-editbar/-editpill, mu-sub) --

  function fg(label, inner, hint) {
    return '<div class="form-group"><label class="form-label">' + esc(label) + '</label>' + inner +
      (hint ? '<div class="mu-sub" style="margin-top:2px;">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function voiceFormHtml() {
    var v = V2.voice || {};
    return '<div class="mu-editbar"><span class="mu-editpill">EDIT</span>Brand voice</div>' +
      fg('Tagline', '<input class="form-input" id="brandV2Tagline" maxlength="80" value="' + esc(v.tagline || '') + '" placeholder="e.g. Handmade glass from the high desert" style="width:100%;">', 'Short phrase (max 80 chars). Storefront title and OG tags.') +
      fg('Positioning one-liner', '<input class="form-input" id="brandV2Positioning" maxlength="160" value="' + esc(v.positioningOneLiner || '') + '" placeholder="e.g. Wheel-thrown and kiln-fired in Taos, shipped worldwide." style="width:100%;">', 'One sentence (max 160 chars). Meta description and OG description.') +
      fg('Voice rules', '<textarea class="form-input" id="brandV2VoiceRules" rows="8" placeholder="- Warm, plainspoken, never salesy&#10;- Refer to pieces as work not products" style="width:100%;resize:vertical;font-family:inherit;">' + esc(v.voiceRules || '') + '</textarea>', 'Tone, do/don\'t list, signature phrases. Used by Claude when drafting copy.');
  }

  function logoFormHtml(targetType) {
    var label = logoKeyLabel(targetType);
    var current = targetType === 'primary' ? primaryUrl() : variantUrl(targetType);
    var preview = current
      ? '<div style="background:var(--surface-dark);border-radius:8px;padding:12px;display:flex;align-items:center;justify-content:center;min-height:72px;margin-bottom:8px;"><img src="' + esc(current) + '" alt="" style="max-height:56px;max-width:100%;object-fit:contain;"></div>'
      : '';
    return '<div class="mu-editbar"><span class="mu-editpill">' + (current ? 'EDIT' : 'NEW') + '</span>' + esc(label) + ' logo</div>' +
      preview +
      fg('Image URL', '<input class="form-input" id="brandV2LogoUrl" type="text" value="' + esc(current || '') + '" placeholder="https://example.com/logo.png" style="width:100%;">', 'Paste a hosted image URL. The image stays at that URL (no re-host). To pick from the image library, use classic Brand.') +
      '<input type="hidden" id="brandV2LogoTarget" value="' + esc(targetType) + '">';
  }

  function variantsManageHtml() {
    var keys = availableLogoKeys();
    var rows = '';
    VARIANTS.forEach(function (vt) {
      var u = variantUrl(vt.key);
      rows += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--cream-dark,var(--warm-gray-dark));">' +
        '<div style="width:46px;height:32px;background:var(--surface-dark);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
          (u ? '<img src="' + esc(u) + '" alt="" style="max-width:42px;max-height:28px;object-fit:contain;">' : '<span class="mu-sub">--</span>') +
        '</div>' +
        '<div style="flex:1;min-width:90px;font-size:0.85rem;">' + esc(vt.label) + '</div>' +
        '<button class="btn btn-secondary" onclick="BrandV2.editLogo(\'' + esc(vt.key) + '\')" style="font-size:0.78rem;">' + (u ? 'Replace' : 'Set from URL') + '</button>' +
        (u ? '<button class="btn btn-secondary" onclick="BrandV2.deleteVariant(\'' + esc(vt.key) + '\')" style="font-size:0.78rem;color:var(--danger);">Delete</button>' : '') +
      '</div>';
    });
    var placeRows = '';
    if (!primaryUrl()) {
      placeRows = '<div class="mu-sub" style="padding:8px 0;">Set a primary logo first to configure placements.</div>';
    } else {
      var pm = placementMap();
      PLACEMENTS.forEach(function (p) {
        var cfg = pm[p.key] || {};
        var curKey = cfg.variantKey || 'primary';
        var curH = cfg.maxHeight || p.defaultHeight;
        var sel = keys.map(function (k) {
          return '<option value="' + esc(k) + '"' + (k === curKey ? ' selected' : '') + '>' + esc(logoKeyLabel(k)) + '</option>';
        }).join('');
        placeRows += '<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--cream-dark,var(--warm-gray-dark));flex-wrap:wrap;">' +
          '<div style="min-width:110px;font-size:0.85rem;font-weight:600;">' + esc(p.label) + '</div>' +
          '<select class="form-input" id="brandV2Place_' + p.key + '_variant" style="flex:1;min-width:120px;font-size:0.78rem;">' + sel + '</select>' +
          '<input class="form-input" type="number" id="brandV2Place_' + p.key + '_height" value="' + curH + '" min="16" max="200" style="width:64px;font-size:0.78rem;" title="Max height (px)">' +
          '<span class="mu-sub">px</span>' +
          '<button class="btn btn-primary" onclick="BrandV2.savePlacement(\'' + p.key + '\')" style="font-size:0.78rem;">Save</button>' +
        '</div>';
      });
    }
    return U.card('Variants', (variantsSet().length ? '' : '<div class="mu-sub" style="margin-bottom:6px;">No variants yet — set one from a URL.</div>') + rows) +
      U.card('Placements', placeRows);
  }

  window.BrandV2 = {
    refresh: function () { render(); },

    editVoice: function () {
      if (!bridgeReady()) return;
      U.slideOut.open({
        id: 'brand-voice', deepLink: false, title: 'Edit brand voice', size: 'md', mode: 'create', createLabel: 'Save voice',
        render: function () { return voiceFormHtml(); },
        isDirty: function () { return true; },
        onSave: function () {
          if (!bridgeReady()) return false;
          function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
          return Promise.resolve(window.BrandBridge.saveVoice({
            tagline: val('brandV2Tagline'), positioningOneLiner: val('brandV2Positioning'), voiceRules: val('brandV2VoiceRules')
          })).then(function (payload) {
            if (!payload) { if (window.showToast) showToast('Save failed', true); return false; }
            if (window.showToast) showToast('Brand voice saved.');
            reloadSoon();
            return true;
          }).catch(function (e) { console.error('[brand-v2] saveVoice', e); if (window.showToast) showToast('Save failed', true); return false; });
        }
      });
    },

    editLogo: function (targetType) {
      if (!bridgeReady()) return;
      targetType = targetType || 'primary';
      U.slideOut.open({
        id: 'brand-logo-' + targetType, deepLink: false, title: (targetType === 'primary' ? 'Primary logo' : logoKeyLabel(targetType) + ' variant'),
        size: 'md', mode: 'create', createLabel: 'Save logo',
        render: function () { return logoFormHtml(targetType); },
        isDirty: function () { var el = document.getElementById('brandV2LogoUrl'); return !!(el && el.value && el.value.trim()); },
        onSave: function () {
          if (!bridgeReady()) return false;
          var urlEl = document.getElementById('brandV2LogoUrl');
          var tEl = document.getElementById('brandV2LogoTarget');
          var url = urlEl ? urlEl.value.trim() : '';
          var t = tEl ? tEl.value : 'primary';
          if (!url) { if (window.showToast) showToast('Enter an image URL', true); return false; }
          return Promise.resolve(window.BrandBridge.setLogoFromUrl(t, url)).then(function (ok) {
            if (!ok) { if (window.showToast) showToast('Save failed', true); return false; }
            if (window.showToast) showToast('Logo saved.');
            reloadSoon();
            return true;
          }).catch(function (e) { console.error('[brand-v2] setLogoFromUrl', e); if (window.showToast) showToast('Save failed', true); return false; });
        }
      });
    },

    manageVariants: function () {
      if (!bridgeReady()) return;
      U.slideOut.open({
        id: 'brand-variants', deepLink: false, title: 'Variants & placements', size: 'lg', mode: 'read',
        render: function () { return variantsManageHtml(); }
      });
    },

    savePlacement: function (placementKey) {
      if (!bridgeReady()) return;
      var vEl = document.getElementById('brandV2Place_' + placementKey + '_variant');
      var hEl = document.getElementById('brandV2Place_' + placementKey + '_height');
      if (!vEl) return;
      Promise.resolve(window.BrandBridge.savePlacement(placementKey, { variantKey: vEl.value, maxHeight: hEl ? hEl.value : 48 })).then(function (ok) {
        if (window.showToast) showToast(ok ? ('Placement saved: ' + placementKey) : 'Failed to save placement', !ok);
        if (ok) reloadSoon(true);
      }).catch(function (e) { console.error('[brand-v2] savePlacement', e); if (window.showToast) showToast('Failed to save placement', true); });
    },

    deleteVariant: function (type) {
      if (!bridgeReady()) return;
      var doDelete = function () {
        Promise.resolve(window.BrandBridge.deleteVariant(type)).then(function (ok) {
          if (window.showToast) showToast(ok ? (type + ' variant deleted') : 'Delete failed', !ok);
          if (ok) reloadSoon(true);
        }).catch(function (e) { console.error('[brand-v2] deleteVariant', e); if (window.showToast) showToast('Delete failed', true); });
      };
      if (typeof mastConfirm === 'function') {
        mastConfirm('Delete the ' + type + ' variant?', { title: 'Delete variant', confirmLabel: 'Delete', danger: true }).then(function (ok) { if (ok) doDelete(); });
      } else { doDelete(); }
    }
  };

  // After a delegated write, re-read config (BrandBridge.getConfig single-sources
  // the read) and re-render. If a variants/placements slide-out is open, re-render it.
  function reloadSoon(keepSlideOut) {
    setTimeout(function () {
      if (!window.BrandBridge) { load(); return; }
      Promise.resolve(window.BrandBridge.getConfig()).then(function (c) {
        V2.logo = c.logo; V2.legacyLogoUrl = c.legacyLogoUrl; V2.voice = c.voice; V2.loaded = true;
        render();
        if (keepSlideOut && U.slideOut && U.slideOut.isOpen && U.slideOut.isOpen()) {
          try { U.slideOut.open({ id: 'brand-variants', deepLink: false, title: 'Variants & placements', size: 'lg', mode: 'read', render: function () { return variantsManageHtml(); } }); } catch (e) {}
        }
      }).catch(function () { load(); });
    }, 250);
  }

  function load() {
    ensureBrandModule();
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
    routes: { 'brand-v2': { tab: 'brandV2Tab', setup: function () {
      // Load the host module (brand.js) so window.BrandBridge exists before any
      // delegated voice/logo/variant/placement write.
      ensureBrandModule();
      ensureTab(); render(); load();
    } } }
  });
})();
