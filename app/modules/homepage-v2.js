/**
 * homepage-v2.js — Homepage editing twin (engine-first, native edit).
 *
 * Model: NAV → the current homepage settings, edited natively here. Homepage
 * editing is storefront-coupled (section toggles write public nav-sections,
 * theme writes public theme config, testimonial visibility writes public
 * testimonials — all paint the live homepage). This twin presents the
 * configuration read-on-page and edits it natively, DELEGATING every write to
 * the existing legacy logic in homepage.js — it never reimplements a storefront
 * write. The relevant legacy writers already take args and read no DOM, so the
 * twin calls them directly:
 *   • window.hpToggleSection(id, enabled)        → public/config/nav/sections/{id}/enabled (+ webPresence mirror)
 *   • window.hpUpdateField(sectionKey, id, val)  → webPresence/config/sections/{key}/{id} (debounced)
 *   • window.hpUpdateSocial(platform, val)       → webPresence/config/sections/contact/socialLinks/{platform}
 *   • window.hpUpdateThemeField(field, val)      → public/config/theme/{field}
 *   • window.hpToggleTestimonialVisible(k, vis)  → public/testimonials/{k}/visible
 *   • window.HomepageBridge.setColorScheme(id)   → scheme id + clears custom color overrides (mirrors wpSelectScheme)
 *   • window.HomepageBridge.getThemeOptions()    → manifest color schemes + font pairs
 *
 * Genuinely legacy-only (kept on classic, the "→ classic" link): template
 * switching (manifest cascade — resets scheme/font/variants), custom color
 * pickers, section gallery images, and testimonial content add/edit (sourced
 * from the Customer Service › Reviews "Feature on site" flow, not a homepage
 * write). Section variant pickers also stay on classic (manifest-coupled).
 *
 * The host module (window.hp* + window.HomepageBridge) lives in homepage.js and
 * is loaded at route setup via MastAdmin.loadModule('homepage'); every delegated
 * call is guarded — a window fn that isn't loaded yet no-ops silently, so we
 * kick a load + toast instead. Flag-gated (?ui=1) at #homepage-v2.
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

  // Mirrors homepage.js SECTION_DEFS (id/label/required) + the editable content
  // fields per section so the native edit slide-out matches the classic editor.
  // (Variant pickers, gallery images, hero rotation stay on classic.)
  var SECTIONS = [
    { id: 'hero', label: 'Hero', required: true, peek: 'headline', fields: [
      { id: 'headline', label: 'Headline', type: 'text' },
      { id: 'subheadline', label: 'Subheadline', type: 'text' },
      { id: 'ctaText', label: 'Button text', type: 'text' },
      { id: 'ctaUrl', label: 'Button URL', type: 'text' },
      { id: 'headlineSize', label: 'Headline size', type: 'select', options: [{ v: 'small', l: 'Small' }, { v: 'medium', l: 'Medium (default)' }, { v: 'large', l: 'Large' }, { v: 'xl', l: 'Extra large' }] },
      { id: 'textAlign', label: 'Text position', type: 'select', options: [{ v: 'left', l: 'Left' }, { v: 'center', l: 'Center (default)' }, { v: 'right', l: 'Right' }] }
    ] },
    { id: 'gallery', label: 'Products / Gallery', peek: 'heading', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'columns', label: 'Columns', type: 'number' }
    ] },
    { id: 'about', label: 'About', peek: 'heading', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'body', label: 'Body text', type: 'textarea' },
      { id: 'process', label: 'Process & materials', type: 'textarea', placeholder: 'How each piece is made — your materials and technique.' },
      { id: 'established', label: 'Established', type: 'text', placeholder: 'e.g. Est. 2016' },
      { id: 'credEducation', label: 'Training / education (one per line)', type: 'textarea', placeholder: 'BFA, Rhode Island School of Design' },
      { id: 'credExhibitions', label: 'Exhibitions & shows (one per line)', type: 'textarea', placeholder: 'ACC Baltimore 2024' },
      { id: 'credAwards', label: 'Awards (one per line)', type: 'textarea', placeholder: 'Niche Award, 2019' },
      { id: 'credPress', label: 'Press (one per line)', type: 'textarea', placeholder: 'Featured in American Craft' }
    ] },
    { id: 'contact', label: 'Contact', peek: 'heading', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'email', label: 'Email', type: 'text' },
      { id: 'phone', label: 'Phone', type: 'text' },
      { id: 'address', label: 'Address', type: 'text' },
      { id: 'showForm', label: 'Show contact form', type: 'toggle' }
    ], social: true },
    { id: 'newsletter', label: 'Newsletter', peek: 'heading', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'subheadline', label: 'Subheadline', type: 'text' },
      { id: 'buttonLabel', label: 'Button label', type: 'text' }
    ] },
    { id: 'members', label: 'Members', peek: null, fields: [
      { id: 'accessModel', label: 'Access model', type: 'select', options: [{ v: 'passcode', l: 'Passcode' }, { v: 'email', l: 'Email list' }] },
      { id: 'passcode', label: 'Passcode', type: 'text' }
    ] }
  ];
  var SOCIAL_PLATFORMS = ['instagram', 'facebook', 'etsy', 'pinterest', 'tiktok', 'twitter', 'youtube'];

  var V2 = { wp: null, theme: null, nav: null, testimonials: null, loaded: false };

  function canEdit() { return typeof window.can === 'function' ? window.can('homepage', 'edit') : true; }
  function onPill(on) { return U.badge(on ? 'On' : 'Off', on ? 'success' : 'neutral'); }
  function titleCase(s) { return s ? String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : ''; }

  // Guard: the host module (window.hp* + HomepageBridge) lives in homepage.js.
  // If a delegated write isn't loaded yet, kick a load + toast and bail so the
  // call never silently no-ops.
  function hostReady(fnName) {
    if (typeof window[fnName] === 'function') return true;
    try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('homepage'); } catch (e) {}
    if (window.showToast) showToast('Homepage editor still loading — try again', true);
    return false;
  }

  function sectionEnabled(id, required) {
    if (required) return true;
    var navData = (V2.nav && V2.nav[id]) || {};
    var wpData = (V2.wp && V2.wp.sections && V2.wp.sections[id]) || {};
    return navData.enabled !== false && wpData.enabled !== false;   // mirrors homepage.js:283
  }
  function sectionData(id) { return (V2.wp && V2.wp.sections && V2.wp.sections[id]) || {}; }
  function sectionPeek(sec) {
    if (!sec.peek) return '';
    return sectionData(sec.id)[sec.peek] || '';
  }

  function ensureTab() {
    var el = document.getElementById('homepageV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'homepageV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // ── Sections card (native On/Off toggle + Edit) ─────────────────────
  function sectionsCard() {
    var ed = canEdit();
    var rows = SECTIONS.map(function (sec) {
      var on = sectionEnabled(sec.id, sec.required);
      var peek = sectionPeek(sec);
      var right;
      if (sec.required) {
        right = '<span class="mu-sub">Always on</span>' +
          (ed ? ' <button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;" onclick="HomepageV2.editSection(\'' + sec.id + '\')">Edit</button>' : '');
      } else if (ed) {
        right = '<button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;" onclick="HomepageV2.toggleSection(\'' + sec.id + '\',' + (on ? 'false' : 'true') + ')">' + (on ? 'Turn off' : 'Turn on') + '</button>' +
          ' <button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;" onclick="HomepageV2.editSection(\'' + sec.id + '\')">Edit</button>';
      } else {
        right = onPill(on);
      }
      return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:7px 0;border-top:1px solid var(--surface-card,var(--charcoal-light));">' +
        '<div style="min-width:0;"><div style="font-size:0.9rem;color:var(--text-primary);">' + esc(sec.label) + ' ' + onPill(on) + '</div>' +
        (peek ? '<div class="mu-sub" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:240px;">' + esc(peek) + '</div>' : '') + '</div>' +
        '<div style="display:flex;gap:6px;align-items:center;flex-shrink:0;">' + right + '</div></div>';
    }).join('');
    var foot = ed
      ? '<div class="mu-sub" style="margin-top:12px;">Section images &amp; layout variants stay in the page builder.<br><button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;margin-top:6px;" onclick="HomepageV2.classic()">Open page builder (classic) →</button></div>'
      : '<div class="mu-sub" style="margin-top:12px;">You do not have permission to edit homepage sections.</div>';
    return U.card('Homepage sections', rows + foot, { fill: true });
  }

  // ── Section content edit slide-out (delegates each field to hpUpdateField) ──
  function fieldInput(secId, f, data) {
    var val = data[f.id] !== undefined ? data[f.id] : '';
    var idAttr = 'id="hpv2-' + secId + '-' + f.id + '"';
    var ph = f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '';
    if (f.type === 'textarea') {
      return '<textarea class="form-input" ' + idAttr + ph + ' rows="4" style="width:100%;resize:vertical;" oninput="HomepageV2.field(\'' + secId + '\',\'' + f.id + '\',this.value)">' + esc(String(val)) + '</textarea>';
    }
    if (f.type === 'number') {
      return '<input class="form-input" type="number" ' + idAttr + ' value="' + esc(String(val)) + '" style="width:100%;" oninput="HomepageV2.field(\'' + secId + '\',\'' + f.id + '\',this.value,\'number\')">';
    }
    if (f.type === 'select') {
      var opts = (f.options || []).map(function (o) { return '<option value="' + esc(o.v) + '"' + (String(val) === o.v ? ' selected' : '') + '>' + esc(o.l) + '</option>'; }).join('');
      return '<select class="form-input" ' + idAttr + ' style="width:100%;" onchange="HomepageV2.field(\'' + secId + '\',\'' + f.id + '\',this.value)">' + opts + '</select>';
    }
    if (f.type === 'toggle') {
      return '<label class="toggle-switch"><input type="checkbox"' + (val ? ' checked' : '') + ' onchange="HomepageV2.field(\'' + secId + '\',\'' + f.id + '\',this.checked,\'bool\')"><span class="toggle-slider"></span></label>';
    }
    return '<input class="form-input" type="text" ' + idAttr + ph + ' value="' + esc(String(val)) + '" style="width:100%;" oninput="HomepageV2.field(\'' + secId + '\',\'' + f.id + '\',this.value)">';
  }

  function sectionEditHtml(sec) {
    var data = sectionData(sec.id);
    function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + esc(label) + '</label>' + inner + '</div>'; }
    var bar = '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>' + esc(sec.label) + ' section</div>';
    var body = (sec.fields || []).map(function (f) { return fg(f.label, fieldInput(sec.id, f, data)); }).join('');
    if (sec.social) {
      var links = data.socialLinks || {};
      body += '<div class="mu-editbar" style="margin-top:14px;"><span class="mu-editpill">LINKS</span>Social links</div>' +
        SOCIAL_PLATFORMS.map(function (p) {
          return fg(titleCase(p), '<input class="form-input" type="url" value="' + esc(links[p] || '') + '" placeholder="https://" style="width:100%;" oninput="HomepageV2.social(\'' + p + '\',this.value)">');
        }).join('');
    }
    body += '<div class="mu-sub" style="margin-top:12px;">Edits save as you type. Images &amp; layout variant for this section live in the page builder.<br><button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;margin-top:6px;" onclick="HomepageV2.classic()">Open page builder (classic) →</button></div>';
    return bar + body;
  }

  // ── Theme card (native color scheme + font pair; template stays classic) ──
  function themeCard() {
    var t = V2.theme || {};
    var ed = canEdit();
    var opts = (window.HomepageBridge && HomepageBridge.getThemeOptions && HomepageBridge.getThemeOptions()) || { schemes: [], fonts: [], templateName: null };
    var scheme = t.colorSchemeId ? titleCase(t.colorSchemeId) : (t.primaryColor ? 'Custom colors' : 'Default');
    var head = U.kv([
      { k: 'Template', v: esc(opts.templateName || titleCase(t.templateId || 'artisan')) },
      { k: 'Color scheme', v: esc(scheme) },
      { k: 'Font pair', v: t.fontPair ? esc(titleCase(t.fontPair)) : 'Default' }
    ]);
    var body = head;
    if (ed && opts.schemes.length) {
      var custom = !t.colorSchemeId && !!t.primaryColor;
      var schemeOpts = opts.schemes.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (!custom && t.colorSchemeId === s.id ? ' selected' : '') + '>' + esc(s.name || s.id) + (s.default ? ' (default)' : '') + '</option>';
      }).join('');
      body += '<div class="form-group" style="margin-top:12px;"><label class="form-label">Color scheme</label>' +
        '<select class="form-input" style="width:100%;" onchange="HomepageV2.scheme(this.value)">' +
        (custom ? '<option value="" selected>Custom colors</option>' : '') + schemeOpts + '</select>' +
        '<div class="mu-sub" style="margin-top:2px;">Picking a scheme clears any custom colors. Custom color pickers stay in classic.</div></div>';
    }
    if (ed && opts.fonts.length) {
      var cur = t.fontPair || 'classic';
      var fontOpts = opts.fonts.map(function (f) {
        return '<option value="' + esc(f.id) + '"' + (cur === f.id ? ' selected' : '') + '>' + esc(f.name || f.id) + (f.default ? ' (default)' : '') + '</option>';
      }).join('');
      body += '<div class="form-group"><label class="form-label">Font pair</label>' +
        '<select class="form-input" style="width:100%;" onchange="HomepageV2.font(this.value)">' + fontOpts + '</select></div>';
    }
    var foot = '<div class="mu-sub" style="margin-top:12px;">Template switching &amp; custom colors stay in the style editor.<br><button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;margin-top:6px;" onclick="HomepageV2.classic()">Open style editor (classic) →</button></div>';
    return U.card('Theme', body + foot, { fill: true });
  }

  // ── Testimonials card (native visibility toggles; content via Reviews) ──
  function testimonialsCard() {
    var data = V2.testimonials || {};
    var ed = canEdit();
    var all = Object.keys(data).map(function (k) { var t = data[k] || {}; return { _key: k, quote: t.quote, author: t.customerName || t.author || t.authorName || '', visible: t.visible !== false }; })
      .filter(function (t) { return t.quote; })
      .sort(function (a, b) { return (a._key < b._key ? 1 : -1); });
    var visible = all.filter(function (t) { return t.visible; }).length;
    var summary = U.kv([
      { k: 'Total', v: String(all.length) },
      { k: 'Visible on homepage', v: String(visible) }
    ]);
    var listHtml = '';
    if (all.length) {
      listHtml = '<div style="margin-top:10px;display:flex;flex-direction:column;gap:6px;">' + all.map(function (t) {
        var k = esc(t._key);
        var toggle = ed
          ? '<button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;flex-shrink:0;" onclick="HomepageV2.testimonial(\'' + k + '\',' + (t.visible ? 'false' : 'true') + ')">' + (t.visible ? 'Hide' : 'Show') + '</button>'
          : onPill(t.visible);
        return '<div style="display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:7px 0;border-top:1px solid var(--surface-card,var(--charcoal-light));">' +
          '<div style="min-width:0;"><div style="font-size:0.85rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px;">' + esc(t.quote) + '</div>' +
          (t.author ? '<div class="mu-sub">' + esc('— ' + t.author) + '</div>' : '') + '</div>' + toggle + '</div>';
      }).join('') + '</div>';
    } else {
      listHtml = '<div class="mu-sub" style="margin-top:10px;">No testimonials featured yet.</div>';
    }
    var foot = '<div class="mu-sub" style="margin-top:12px;">Feature new testimonials from Customer Service › Reviews.<br><button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;margin-top:6px;" onclick="HomepageV2.classic()">Open Reviews (classic) →</button></div>';
    return U.card('Testimonials', summary + listHtml + foot, { fill: true });
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) { tab.innerHTML = U.pageHeader({ title: 'Homepage', subtitle: 'Sections, theme & testimonials' }) + '<div class="loading" style="margin-top:14px;">Loading…</div>'; return; }
    tab.innerHTML = U.pageHeader({ title: 'Homepage', subtitle: 'Sections, theme & testimonials' }) + U.cardGrid([sectionsCard(), themeCard(), testimonialsCard()]);
  }

  // After a delegated write, the legacy writer mutates homepage.js' own caches
  // (and may call renderHomepage on its own tab); refresh OUR caches so the
  // read-on-page cards reflect the change without a full reload.
  function reloadSoon() { setTimeout(load, 250); }

  // Debounced publish of the About/story section to the storefront-public read
  // seam (config/about) via the admin-gated publishAboutStory CF. webPresence
  // stays the edit source; this pushes the published copy the Managed `about`
  // projection + bespoke storefronts read. One write per burst of keystrokes.
  var _aboutPubTimer = null;
  function publishAboutSoon() {
    if (_aboutPubTimer) clearTimeout(_aboutPubTimer);
    _aboutPubTimer = setTimeout(function () {
      var about = (V2.wp && V2.wp.sections && V2.wp.sections.about) || {};
      try {
        firebase.functions().httpsCallable('publishAboutStory')({ tenantId: window.TENANT_ID, about: about })
          .then(function () { if (window.showToast) showToast('About story published to your storefront'); })
          .catch(function (e) { if (window.showToast) showToast('About publish failed: ' + ((e && e.message) || e), true); });
      } catch (e) { /* functions SDK not ready yet */ }
    }, 1200);
  }

  window.HomepageV2 = {
    // Section enable/disable → hpToggleSection (arg-taking, no DOM).
    toggleSection: function (id, enabled) {
      if (!hostReady('hpToggleSection')) return;
      Promise.resolve(window.hpToggleSection(id, !!enabled)).then(function () {
        if (!V2.nav) V2.nav = {}; if (!V2.nav[id]) V2.nav[id] = {}; V2.nav[id].enabled = !!enabled;
        if (!V2.wp.sections) V2.wp.sections = {}; if (!V2.wp.sections[id]) V2.wp.sections[id] = {}; V2.wp.sections[id].enabled = !!enabled;
        render();
      });
    },
    // Open the native content-edit slide-out for a section.
    editSection: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit homepage sections.', true); return; }
      var sec = SECTIONS.filter(function (s) { return s.id === id; })[0]; if (!sec) return;
      if (!hostReady('hpUpdateField')) return;
      U.slideOut.open({
        id: 'hp-' + id, deepLink: false, title: sec.label, subtitle: 'Section content', size: 'md', mode: 'read',
        render: function () { return sectionEditHtml(sec); }
      });
      // Content edits save on input (debounced by the legacy writer); there is
      // no separate save step, so present it as a read-mode panel with live
      // inputs — closing just refreshes the cards.
      if (U.slideOut._opts) U.slideOut._opts.onClose = function () { reloadSoon(); };
    },
    // Section content field → hpUpdateField (arg-taking, no DOM, debounced write).
    field: function (secId, fieldId, raw, kind) {
      if (!hostReady('hpUpdateField')) return;
      var value = raw;
      if (kind === 'number') value = parseInt(raw, 10) || 0;
      else if (kind === 'bool') value = !!raw;
      window.hpUpdateField(secId, fieldId, value);
      // About/story ALSO publishes to the storefront-public read seam
      // (config/about) so bespoke Managed sites + the `about` projection reflect
      // edits. webPresence stays the source for Mast's own template; this is the
      // published storefront copy. Debounced so a burst of keystrokes = one write.
      if (secId === 'about') {
        if (!V2.wp) V2.wp = {};
        if (!V2.wp.sections) V2.wp.sections = {};
        if (!V2.wp.sections.about) V2.wp.sections.about = {};
        V2.wp.sections.about[fieldId] = value;
        publishAboutSoon();
      }
    },
    // Contact social link → hpUpdateSocial (arg-taking, no DOM, debounced write).
    social: function (platform, value) {
      if (!hostReady('hpUpdateSocial')) return;
      window.hpUpdateSocial(platform, value);
    },
    // Color scheme → HomepageBridge.setColorScheme (clears custom overrides);
    // empty value means "custom" which is classic-only, so route there.
    scheme: function (id) {
      if (!id) { this.classic(); return; }
      if (!window.HomepageBridge || !HomepageBridge.setColorScheme) {
        try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('homepage'); } catch (e) {}
        if (window.showToast) showToast('Homepage editor still loading — try again', true); return;
      }
      Promise.resolve(HomepageBridge.setColorScheme(id)).then(function () {
        if (window.showToast) showToast('Color scheme updated.'); reloadSoon();
      }).catch(function (e) { if (window.showToast) showToast('Error: ' + (e && e.message || e), true); });
    },
    // Font pair → hpUpdateThemeField (arg-taking, no DOM; canonical theme path).
    font: function (id) {
      if (!hostReady('hpUpdateThemeField')) return;
      Promise.resolve(window.hpUpdateThemeField('fontPair', id)).then(reloadSoon);
    },
    // Testimonial visibility → hpToggleTestimonialVisible (arg-taking, no DOM).
    testimonial: function (key, visible) {
      if (!hostReady('hpToggleTestimonialVisible')) return;
      Promise.resolve(window.hpToggleTestimonialVisible(key, !!visible)).then(function () {
        if (!V2.testimonials[key]) V2.testimonials[key] = {}; V2.testimonials[key].visible = !!visible; render();
      });
    },
    // Classic page builder / style editor / reviews for the legacy-only bits.
    classic: function () { if (typeof navigateToClassic === 'function') navigateToClassic('homepage'); else if (typeof navigateTo === 'function') navigateTo('homepage'); },
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
    routes: { 'homepage-v2': { tab: 'homepageV2Tab', setup: function () {
      // CRITICAL: the host module (window.hp* + window.HomepageBridge) lives in
      // homepage.js. Load it at route setup so the delegated writes + the theme
      // manifest (HomepageBridge.getThemeOptions) are available; ensureLoaded
      // populates homepage.js' section/theme/testimonial caches the writers use.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        try {
          var p = MastAdmin.loadModule('homepage');
          if (p && p.then) p.then(function () { if (window.HomepageBridge && HomepageBridge.ensureLoaded) HomepageBridge.ensureLoaded(); });
        } catch (e) {}
      }
      ensureTab(); render(); load();
    } } }
  });
})();
