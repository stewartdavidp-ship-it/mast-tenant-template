/**
 * homepage-v2.js — Homepage, the read-on-page model (read-focused twin).
 *
 * Global model (operator, 2026-06-01): NAV → a READ-ONLY view of the current
 * settings. Homepage editing is storefront-coupled (section toggles write
 * the public nav-sections config, theme writes the public theme config, testimonial
 * visibility writes the public testimonials — all paint the live homepage),
 * so editing stays on legacy (read-focused twin, like brand/trips/team). This twin
 * PRESENTS the homepage configuration read-on-page and routes every edit to the
 * classic Homepage view; homepage.js untouched.
 *
 * Flag-gated (?ui=1) at #homepage-v2, side-by-side with legacy #homepage.
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
  // Mirrors homepage.js SECTION_DEFS (id/label/required) — read-only here.
  var SECTIONS = [
    { id: 'hero', label: 'Hero', required: true, peek: 'headline' },
    { id: 'gallery', label: 'Products / Gallery', peek: 'heading' },
    { id: 'about', label: 'About', peek: 'heading' },
    { id: 'contact', label: 'Contact', peek: 'heading' },
    { id: 'newsletter', label: 'Newsletter', peek: 'heading' },
    { id: 'members', label: 'Members', peek: null }
  ];

  var V2 = { wp: null, theme: null, nav: null, testimonials: null, loaded: false };

  function onPill(on) { return U.badge(on ? 'On' : 'Off', on ? 'success' : 'neutral'); }
  function titleCase(s) { return s ? String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : ''; }

  function sectionEnabled(id, required) {
    if (required) return true;
    var navData = (V2.nav && V2.nav[id]) || {};
    var wpData = (V2.wp && V2.wp.sections && V2.wp.sections[id]) || {};
    return navData.enabled !== false && wpData.enabled !== false;   // mirrors homepage.js:283
  }
  function sectionPeek(sec) {
    if (!sec.peek) return '';
    var wpData = (V2.wp && V2.wp.sections && V2.wp.sections[sec.id]) || {};
    return wpData[sec.peek] || '';
  }

  function ensureTab() {
    var el = document.getElementById('homepageV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'homepageV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function sectionsCard() {
    var rows = SECTIONS.map(function (sec) {
      var on = sectionEnabled(sec.id, sec.required);
      var peek = sectionPeek(sec);
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--surface-card,rgba(255,255,255,0.06));">' +
        '<div style="min-width:0;"><div style="font-size:0.9rem;color:var(--charcoal,var(--text));">' + esc(sec.label) + (sec.required ? ' <span class="mu-sub">(always on)</span>' : '') + '</div>' +
        (peek ? '<div class="mu-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;">' + esc(peek) + '</div>' : '') + '</div>' +
        onPill(on) + '</div>';
    }).join('');
    return '<div class="mu-card" style="margin:0;height:100%;">' +
        '<h3 style="margin:0 0 6px;">Homepage sections</h3>' +
        '<div class="mu-cc">' + rows +
          '<div class="mu-sub" style="margin-top:12px;"><button class="btn btn-secondary" onclick="HomepageV2.classic()">Edit sections (classic view) →</button></div>' +
        '</div>' +
      '</div>';
  }

  function themeCard() {
    var t = V2.theme || {};
    var scheme = t.colorSchemeId ? titleCase(t.colorSchemeId) : (t.primaryColor ? 'Custom colors' : 'Default');
    var rows = U.kv([
      { k: 'Template', v: esc(titleCase(t.templateId || 'artisan')) },
      { k: 'Color scheme', v: esc(scheme) },
      { k: 'Font pair', v: t.fontPair ? esc(titleCase(t.fontPair)) : 'Default' }
    ]);
    return '<div class="mu-card" style="margin:0;height:100%;">' +
        '<h3 style="margin:0 0 6px;">Theme</h3>' +
        '<div class="mu-cc">' + rows +
          '<div class="mu-sub" style="margin-top:12px;"><button class="btn btn-secondary" onclick="HomepageV2.classic()">Edit theme (classic view) →</button></div>' +
        '</div>' +
      '</div>';
  }

  function testimonialsCard() {
    var data = V2.testimonials || {};
    var all = Object.keys(data).map(function (k) { return data[k]; }).filter(Boolean);
    var visible = all.filter(function (t) { return t.visible !== false; }).length;
    return '<div class="mu-card" style="margin:0;height:100%;">' +
        '<h3 style="margin:0 0 6px;">Testimonials</h3>' +
        '<div class="mu-cc">' + U.kv([
          { k: 'Total', v: String(all.length) },
          { k: 'Visible on homepage', v: String(visible) }
        ]) +
          '<div class="mu-sub" style="margin-top:12px;"><button class="btn btn-secondary" onclick="HomepageV2.classic()">Manage testimonials (classic view) →</button></div>' +
        '</div>' +
      '</div>';
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) { tab.innerHTML = U.pageHeader({ title: 'Homepage', subtitle: 'Sections, theme & testimonials' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>'; return; }
    var grid = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:14px;align-items:start;">' +
      sectionsCard() + themeCard() + testimonialsCard() + '</div>';
    tab.innerHTML = U.pageHeader({ title: 'Homepage', subtitle: 'Sections, theme & testimonials' }) + grid;
  }

  window.HomepageV2 = {
    // Storefront-coupled edits → classic Homepage view (read-focused twin).
    classic: function () { if (typeof navigateTo === 'function') navigateTo('homepage'); },
    refresh: function () { render(); }
  };

  function load() {
    Promise.all([
      Promise.resolve(MastDB.get('webPresence/config')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/theme')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/nav/sections')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/testimonials')).catch(function () { return null; })
    ]).then(function (r) {
      V2.wp = r[0] || {}; V2.theme = r[1] || {}; V2.nav = r[2] || {}; V2.testimonials = r[3] || {};
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[homepage-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('homepage-v2', {
    routes: { 'homepage-v2': { tab: 'homepageV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
