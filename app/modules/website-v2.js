/**
 * website-v2.js — "Your Website" consolidated builder (V2 twin of #website).
 *
 * THE PLAN: this is the single scrolling builder that will absorb the legacy
 * page builder (website.js), Homepage editing (homepage-v2.js), and Brand
 * (brand-v2.js) into ONE page at #website. Instead of three separate routes +
 * a tabbed legacy builder, the operator scrolls one page top-to-bottom:
 *
 *   ┌ sticky header ─ site name · live URL (opens + copy) · "Saved · viewing live"
 *   │
 *   ├ Card 1  Look & feel          (template / colors / fonts)   → PR3
 *   ├ Card 2  Your words & pictures (homepage sections + content) → PR4
 *   ├ Card 3  Your shop            (storefront / shop settings)   → PR5
 *   └ Card 4  See it live & share  (preview + publish + share)    → PR6
 *
 * THIS PR (PR2) is the ROUTE + TWIN SHELL ONLY: register the module, remap
 * #website → website-v2 under the V2 flag, render the sticky header, and scaffold
 * the 4 empty card placeholders. The cards are filled in PR3–PR6; each lands its
 * controls inside the card body element this shell mounts (see CARD_MOUNTS below).
 *
 * The legacy website.js / homepage-v2.js / brand-v2.js are NOT touched here — they
 * stay as the fallback and behind the future "Advanced (classic)" door; later PRs
 * retire them once their surface is absorbed.
 *
 * Cold-safe: every config read is lazy + guarded (Promise.resolve(...).catch),
 * so the route boots correctly even as the FIRST route visited (no assumption that
 * another route warmed a cache). Flag-gated (?ui=1 / mastUiRedesign) like the other
 * twins, side-by-side with legacy #website.
 *
 * RBAC: editing the live site is gated via can('homepage','edit') — the same area
 * homepage-v2 uses (brand writes will later route through BrandBridge under the
 * brand area). This shell does no MastDB writes yet; canEdit() is wired now so the
 * card PRs inherit the gate and the RBAC lint stays satisfied.
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

  // RBAC: editing the live site is gated on the homepage area (same as
  // homepage-v2). Wired now so PR3–PR6 inherit it; satisfies the RBAC lint.
  function canEdit() { return typeof window.can !== 'function' || window.can('homepage', 'edit'); }

  // The 4 builder cards, in scroll order. Each card body mounts into a stable
  // element id (CARD_MOUNTS below) that the PR3–PR6 builders fill. Keep ids stable
  // — later PRs target them.
  var CARDS = [
    { key: 'lookfeel', title: 'Look & feel', mount: 'wv2LookFeelBody',
      blurb: 'Template, colors, and fonts for your whole site.', pr: 'this builder' },
    { key: 'words', title: 'Your words & pictures', mount: 'wv2WordsBody',
      blurb: 'Homepage sections — your headline, story, photos, and contact info.', pr: 'this builder' },
    { key: 'shop', title: 'Your shop', mount: 'wv2ShopBody',
      blurb: 'How your products and storefront appear to customers.', pr: 'this builder' },
    { key: 'live', title: 'See it live & share', mount: 'wv2LiveBody',
      blurb: 'Preview your site, publish changes, and share the link.', pr: 'this builder' }
  ];

  // Module config state — cold-safe defaults so the header renders before load().
  // Card 1 (Look & feel) adds the theme + brand reads it edits: theme = the live
  // public/config/theme (colorSchemeId / primaryColor / accentColor / fontPair /
  // designScale / navStyle / responsivePriority), brand = config/brand (name /
  // tagline), logo = config/brand/logo (primary url).
  var V2 = { wp: null, meta: null, status: 'draft', theme: null, brand: null, logo: null, loaded: false };

  function titleCase(s) { return s ? String(s).replace(/[-_]/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : ''; }

  // ── live URL derivation ────────────────────────────────────────────
  // Prefer the tenant's canonical <tenant>.runmast.com host (the Cloudflare
  // worker origin operators verify through — see CLAUDE.md). If we're already on
  // a *.runmast.com host, that hostname IS the live URL. Otherwise build it from
  // MastDB.tenantId(); fall back to the current origin only if tenantId is absent.
  function tenantId() {
    try { return (window.MastDB && MastDB.tenantId && MastDB.tenantId()) || ''; } catch (e) { return ''; }
  }
  function liveHost() {
    try {
      var h = window.location.hostname || '';
      if (/\.runmast\.com$/.test(h)) return h;          // already on the live host
    } catch (e) {}
    var tid = tenantId();
    if (tid) return tid + '.runmast.com';
    // last-resort fallback: the current origin (covers *.web.app dev origins)
    try { return window.location.host || ''; } catch (e) { return ''; }
  }
  function liveUrl() {
    var host = liveHost();
    if (!host) return '';
    return /^https?:\/\//.test(host) ? host : 'https://' + host;
  }

  // Site name: prefer the storefront meta siteTitle, then the platform registry
  // name, then the tenant id. All reads guarded.
  function siteName() {
    var meta = V2.meta || {};
    if (meta.siteTitle) return meta.siteTitle;
    try {
      var tc = window.TENANT_CONFIG || {};
      if (tc.registryName) return tc.registryName;
    } catch (e) {}
    var tid = tenantId();
    return tid || 'Your website';
  }

  // ── tab container ──────────────────────────────────────────────────
  // A static <div id="websiteV2Tab"> also exists in index.html so applyRoute can
  // show the tab BEFORE setup() runs (the static-tab-div gotcha — without it the
  // route boots blank). ensureTab() is the runtime fallback for cold loads.
  function ensureTab() {
    var el = document.getElementById('websiteV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'websiteV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // ── sticky header strip ────────────────────────────────────────────
  // Site name + live URL (opens in a new tab + a copy affordance) + a status pip.
  // The pip is static for now ("Saved · viewing live") — the live save-state wiring
  // lands with the cards (PR3–PR6).
  function headerHtml() {
    var name = siteName();
    var url = liveUrl();
    var host = liveHost();
    // The pip is addressable (id) so writes can flip it to "Saving…" then back to
    // "Saved · viewing live" — the instant-apply feedback (no Save button).
    var pip = '<span class="wv2-pip" id="wv2Pip" title="Changes save automatically and appear on your live site.">' +
      '<span class="wv2-pip-dot"></span>Saved · viewing live</span>';
    var urlChip = url
      ? '<a class="wv2-url" href="' + esc(url) + '" target="_blank" rel="noopener" title="Open your live site in a new tab">' +
          esc(host) + ' <span class="wv2-url-ext" aria-hidden="true">↗</span></a>' +
          '<button type="button" class="wv2-copy" title="Copy live link" onclick="WebsiteV2.copyLink()">Copy</button>'
      : '<span class="mu-sub">Live URL unavailable</span>';
    return '<div class="wv2-header">' +
      '<div class="wv2-header-main">' +
        '<div class="wv2-sitename">' + esc(name) + '</div>' +
        '<div class="wv2-urlrow">' + urlChip + '</div>' +
      '</div>' +
      '<div class="wv2-header-side">' + pip + '</div>' +
    '</div>';
  }

  // ── card placeholders ──────────────────────────────────────────────
  // Each card is a U.card shell with its title + a stable mount element + a muted
  // "Coming in this builder" placeholder line that PR3–PR6 replace.
  function cardHtml(c) {
    var body =
      '<div class="mu-sub" style="margin-bottom:8px;">' + esc(c.blurb) + '</div>' +
      '<div id="' + esc(c.mount) + '" class="wv2-cardbody">' +
        '<div class="wv2-coming mu-sub">Coming in this builder.</div>' +
      '</div>';
    return U.card(c.title, body, { fill: true });
  }

  // ── instant-apply save pip ─────────────────────────────────────────
  // Flip the header pip to "Saving…" on a write, then back to "Saved · viewing
  // live" after the write settles. No Save button anywhere — this is the only
  // feedback that a pick/keystroke persisted. saved() also re-reads so the
  // read-on-page controls reflect the change.
  var _pipTimer = null;
  function pipSaving() {
    var el = document.getElementById('wv2Pip');
    if (!el) return;
    el.classList.add('saving');
    el.innerHTML = '<span class="wv2-pip-dot"></span>Saving…';
    if (_pipTimer) { clearTimeout(_pipTimer); _pipTimer = null; }
  }
  function pipSaved() {
    var el = document.getElementById('wv2Pip');
    if (!el) return;
    el.classList.remove('saving');
    el.innerHTML = '<span class="wv2-pip-dot"></span>Saved · viewing live';
  }
  // Wrap a write promise with the pip + a deferred re-read. The pip flips to
  // "Saving…" immediately, back to "Saved" when the promise settles (min 350ms so
  // a near-instant write still flashes feedback). On failure, a toast + pip reset.
  function withSave(promise, opts) {
    opts = opts || {};
    pipSaving();
    var started = Date.now();
    return Promise.resolve(promise).then(function (res) {
      var wait = Math.max(0, 350 - (Date.now() - started));
      _pipTimer = setTimeout(function () { pipSaved(); _pipTimer = null; }, wait);
      if (opts.reload !== false) reloadSoon();
      return res;
    }).catch(function (e) {
      console.error('[website-v2] save', e);
      pipSaved();
      if (window.showToast) showToast('Save failed: ' + (e && e.message || e), true);
      return false;
    });
  }

  // ── Card 1 · Look & feel ────────────────────────────────────────────
  // Theme controls absorbed from brand-v2 + the legacy style editor, INSTANT-APPLY
  // (no Save buttons) and single-sourced: scheme→HomepageBridge.setColorScheme,
  // custom colors→WebsiteBridge.setCustomColors (MastBrandSync.setColors + clear
  // scheme), font→MastBrandSync.setFontPair, logo→BrandBridge.setLogoFromUrl,
  // name/tagline→MastBrandSync.setName/setTagline, Layout&Scale→WebsiteBridge.setThemeField.
  function themeOptions() {
    var o = (window.HomepageBridge && HomepageBridge.getThemeOptions && HomepageBridge.getThemeOptions()) || null;
    return o || { schemes: [], fonts: [], templateName: null };
  }

  // Color scheme swatch grid (renderItem paints the manifest's primary/accent/bg).
  function colorSchemeSection() {
    var opts = themeOptions();
    var t = V2.theme || {};
    var schemes = opts.schemes || [];
    if (!schemes.length) {
      return '<div class="mu-sub">Color schemes load with your template…</div>';
    }
    // selected = the active scheme id, UNLESS custom colors override it (then no
    // tile is selected and the custom swatches below carry the state).
    var custom = !t.colorSchemeId && !!t.primaryColor;
    var selected = custom ? '' : (t.colorSchemeId || '');
    var items = schemes.map(function (s) {
      var c = s.colors || {};
      return { value: s.id, label: s.name || s.id, _colors: c };
    });
    var grid = U.swatchGrid({
      items: items, selected: selected, onSelectFnName: 'wv2PickScheme',
      renderItem: function (it) {
        var c = it._colors || {};
        // The dot colors are manifest DATA (a scheme's own swatches). Fall back to
        // theme tokens (not literal hex) when a scheme omits one.
        var dots = '<span class="wv2-scheme-dots">' +
          '<span class="wv2-scheme-dot" style="background:' + esc(c.primaryColor || 'var(--text-primary)') + ';"></span>' +
          '<span class="wv2-scheme-dot" style="background:' + esc(c.accentColor || 'var(--warm-gray)') + ';"></span>' +
          '<span class="wv2-scheme-dot" style="background:' + esc(c.bgColor || 'var(--surface-card)') + ';"></span>' +
          '</span>';
        return dots + '<span class="mu-sw-label">' + esc(it.label) + '</span>';
      }
    });
    return '<div id="wv2SchemeGrid">' + grid + '</div>';
  }
  // Re-render only the scheme swatch grid so a custom-color edit deselects the
  // active scheme tile without rebuilding (and refocusing) the color inputs.
  function refreshSchemeGrid() {
    var host = document.getElementById('wv2SchemeGrid');
    if (host) host.outerHTML = colorSchemeSection();
  }

  // Custom colors — primary + accent colorInputs, debounced through WebsiteBridge
  // (which clears the scheme for exclusivity). Under a Fine-tune disclosure.
  function customColorsSection() {
    var t = V2.theme || {};
    // Seed from the live theme, else the active/default manifest scheme's colors
    // (DATA, not chrome) so the pickers open on the real palette. No literal-hex
    // fallback — an empty value just shows the colorInput placeholder.
    var primary = t.primaryColor || activeSchemeColor('primaryColor') || '';
    var accent = t.accentColor || activeSchemeColor('accentColor') || '';
    var pHtml = U.colorInput({ value: primary, id: 'wv2ColPrimary', label: 'Primary' });
    var aHtml = U.colorInput({ value: accent, id: 'wv2ColAccent', label: 'Accent' });
    return '<details class="wv2-finetune">' +
      '<summary>Fine-tune colors</summary>' +
      '<div class="wv2-finetune-body">' +
        '<div class="wv2-colorrow">' + pHtml + aHtml + '</div>' +
        '<div class="mu-sub" style="margin-top:8px;">Custom colors show in light mode; dark mode keeps its own palette.</div>' +
      '</div></details>';
  }
  // The color value from the currently-active manifest scheme (by the theme's
  // colorSchemeId), else the manifest default scheme, else the first — so the
  // custom-color pickers seed on the palette actually in effect.
  function activeSchemeColor(key) {
    var schemes = themeOptions().schemes || [];
    if (!schemes.length) return null;
    var id = V2.theme && V2.theme.colorSchemeId;
    var s = (id && schemes.filter(function (x) { return x.id === id; })[0]) ||
            schemes.filter(function (x) { return x.default; })[0] || schemes[0];
    return s && s.colors && s.colors[key];
  }

  // Font pair swatch grid — each tile's label rendered in its own heading face.
  function fontSection() {
    var opts = themeOptions();
    var t = V2.theme || {};
    var fonts = opts.fonts || [];
    if (!fonts.length) return '<div class="mu-sub">Font pairs load with your template…</div>';
    var selected = t.fontPair || 'classic';
    var items = fonts.map(function (f) { return { value: f.id, label: f.name || f.id, _heading: f.heading, _body: f.body }; });
    return U.swatchGrid({
      items: items, selected: selected, onSelectFnName: 'wv2PickFont',
      renderItem: function (it) {
        // Render the tile name in its own heading font (with a generic fallback)
        // so the operator previews the face. Font family is DATA (a manifest
        // value), not chrome — kept inline, not in the stylesheet.
        var head = it._heading ? ('font-family:\'' + esc(it._heading) + '\',serif;') : '';
        var sub = it._body ? ('font-family:\'' + esc(it._body) + '\',sans-serif;') : '';
        return '<span class="wv2-font-name" style="' + head + '">' + esc(it.label) + '</span>' +
          '<span class="wv2-font-sub mu-sw-label" style="' + sub + '">' + esc((it._heading || '') + (it._body ? ' · ' + it._body : '')) + '</span>';
      }
    });
  }

  // Logo + brand voice (name / tagline). Logo via the PR-571 picker pattern
  // (library / upload), instant-apply through BrandBridge.setLogoFromUrl. Name +
  // tagline text inputs bound instant to MastBrandSync.setName / setTagline.
  function logoVoiceSection() {
    var b = V2.brand || {};
    var logoUrl = (V2.logo && V2.logo.primary && V2.logo.primary.url) || V2.legacyLogoUrl || '';
    var preview = logoUrl
      ? '<div class="wv2-logo-prev"><img src="' + esc(logoUrl) + '" alt="Your logo"></div>'
      : '<div class="wv2-logo-prev empty">No logo yet</div>';
    var pickers = '<div class="wv2-logo-actions">' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.logoFromLibrary()">📚 From library</button>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.logoUpload()">💻 From computer</button>' +
      '</div>';
    var nameInput = '<input class="form-input" id="wv2BrandName" type="text" value="' + esc(b.name || '') + '" placeholder="Your business name" style="width:100%;">';
    var taglineInput = '<input class="form-input" id="wv2BrandTagline" type="text" maxlength="80" value="' + esc(b.tagline || '') + '" placeholder="A short phrase about what you make" style="width:100%;">';
    function fg(label, inner, hint) {
      return '<div class="form-group"><label class="form-label">' + esc(label) + '</label>' + inner +
        (hint ? '<div class="mu-sub" style="margin-top:2px;">' + esc(hint) + '</div>' : '') + '</div>';
    }
    return '<div class="wv2-logorow">' +
        '<div class="wv2-logo-col">' + preview + pickers + '</div>' +
        '<div class="wv2-voice-col">' +
          fg('Business name', nameInput) +
          fg('Tagline', taglineInput, 'Shown in your browser tab title and link previews.') +
        '</div>' +
      '</div>';
  }

  // Fine-tune · Layout & scale — designScale / navStyle / responsivePriority as
  // selects bound instant to WebsiteBridge.setThemeField, plus live conflict prose.
  var LAYOUT_FIELDS = [
    { field: 'designScale', label: 'Design scale', def: 'standard', options: [
      ['standard', 'Standard'], ['editorial', 'Editorial'], ['compact', 'Compact'] ] },
    { field: 'navStyle', label: 'Navigation', def: 'top-bar', options: [
      ['top-bar', 'Top bar'], ['minimal', 'Minimal'], ['bottom-bar', 'Bottom bar'] ] },
    { field: 'responsivePriority', label: 'Optimized for', def: 'balanced', options: [
      ['balanced', 'Balanced'], ['desktop', 'Desktop'], ['mobile', 'Mobile'] ] }
  ];
  function layoutScaleSection() {
    var t = V2.theme || {};
    var selects = LAYOUT_FIELDS.map(function (lf) {
      var cur = t[lf.field] || lf.def;
      var opts = lf.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (cur === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('');
      return '<div class="form-group"><label class="form-label">' + esc(lf.label) + '</label>' +
        '<select class="form-input" id="wv2Layout_' + esc(lf.field) + '" style="width:100%;">' + opts + '</select></div>';
    }).join('');
    return '<details class="wv2-finetune">' +
      '<summary>Layout &amp; scale</summary>' +
      '<div class="wv2-finetune-body">' +
        '<div class="wv2-layoutgrid">' + selects + '</div>' +
        '<div id="wv2LayoutWarn">' + layoutWarningsHtml() + '</div>' +
      '</div></details>';
  }
  // Recompute just the conflict-warning prose after a Layout & Scale change —
  // keeps the <details> open and the selects/focus intact.
  function refreshLayoutWarnings() {
    var host = document.getElementById('wv2LayoutWarn');
    if (host) host.innerHTML = layoutWarningsHtml();
  }
  function layoutWarningsHtml() {
    var t = V2.theme || {};
    var scale = t.designScale || 'standard';
    var nav = t.navStyle || 'top-bar';
    var resPri = t.responsivePriority || 'balanced';
    // The legacy warning logic compares against the manifest's defaults, but the
    // loaded manifest is private to homepage.js (getThemeOptions exposes its name
    // only). Pass an empty manifest so only the device-pairing warnings (scale ×
    // device, nav × device) fire; the "template was designed as X-forward" line
    // needs the manifest default (defaultResPri !== 'balanced') and is correctly
    // suppressed when unknown — no false alarms.
    var warns = (typeof window.getLayoutConflictWarnings === 'function')
      ? window.getLayoutConflictWarnings(scale, nav, resPri, {}) : [];
    if (!warns.length) return '';
    return '<div class="wv2-layoutwarn">' + warns.map(function (w) {
      return '<div class="wv2-warn-line">⚠ ' + esc(w) + '</div>';
    }).join('') + '</div>';
  }

  function lookFeelHtml() {
    var ed = canEdit();
    if (!ed) {
      return '<div class="mu-sub">You do not have permission to edit your site\'s look &amp; feel.</div>';
    }
    function sub(title, inner) {
      return '<div class="wv2-sub"><div class="wv2-sub-h">' + esc(title) + '</div>' + inner + '</div>';
    }
    return sub('Color scheme', colorSchemeSection() + customColorsSection()) +
      sub('Fonts', fontSection()) +
      sub('Logo & brand', logoVoiceSection()) +
      sub('Advanced', layoutScaleSection());
  }

  // Mount Card 1 into its scaffold body (wv2LookFeelBody) — replaces the
  // "Coming in this builder" placeholder PR2 shipped. Called after render() so
  // the mount element exists, and re-called by reloadSoon() to refresh state.
  function mountLookFeel() {
    var host = document.getElementById('wv2LookFeelBody');
    if (!host) return;
    host.innerHTML = lookFeelHtml();
    wireLookFeel();
  }
  // Wire the instant-apply bindings that can't be inline (colorInputs + name/
  // tagline text + Layout selects). swatch tiles fire via the shared delegate
  // (data-sw → WebsiteV2.pickScheme / pickFont).
  function wireLookFeel() {
    if (!canEdit()) return;
    // Custom colors → WebsiteBridge.setCustomColors (clears scheme). Both fields
    // of each colorInput share the wrapper; bind the hex input (the swatch mirrors
    // into it via the shared colorInput delegate, but bind both so a swatch-only
    // pick also writes).
    ['Primary', 'Accent'].forEach(function (which) {
      var field = which === 'Primary' ? 'primaryColor' : 'accentColor';
      ['-hex', '-color'].forEach(function (suffix) {
        var el = document.getElementById('wv2Col' + which + suffix);
        if (el) U.bindInstant(el, {
          key: 'wv2:' + field, delay: 450,
          writer: function (v) {
            v = String(v || '').trim();
            if (!/^#[0-9a-fA-F]{6}$/.test(v)) return; // ignore partial hex while typing
            var update = {}; update[field] = v;
            if (V2.theme) { V2.theme[field] = v; V2.theme.colorSchemeId = null; } // optimistic: scheme tile deselects
            // Don't full-reload (would clobber the color field the user is on);
            // refresh the scheme grid's selection inline instead.
            withSave(WebsiteBridgeCall('setCustomColors', update), { reload: false }).then(refreshSchemeGrid);
          }
        });
      });
    });
    var nameEl = document.getElementById('wv2BrandName');
    if (nameEl) U.bindInstant(nameEl, {
      key: 'wv2:name', delay: 600,
      writer: function (v) {
        if (!window.MastBrandSync) return;
        if (V2.brand) V2.brand.name = String(v || '');
        withSave(window.MastBrandSync.setName(String(v || '')), { reload: false });
      }
    });
    var tagEl = document.getElementById('wv2BrandTagline');
    if (tagEl) U.bindInstant(tagEl, {
      key: 'wv2:tagline', delay: 600,
      writer: function (v) {
        if (!window.MastBrandSync) return;
        if (V2.brand) V2.brand.tagline = String(v || '');
        withSave(window.MastBrandSync.setTagline(String(v || '')), { reload: false });
      }
    });
    LAYOUT_FIELDS.forEach(function (lf) {
      var el = document.getElementById('wv2Layout_' + lf.field);
      if (el) U.bindInstant(el, {
        key: 'wv2:' + lf.field,
        writer: function (v) {
          if (V2.theme) V2.theme[lf.field] = v; // optimistic for the warning recompute
          withSave(WebsiteBridgeCall('setThemeField', lf.field, v), { reload: false }).then(refreshLayoutWarnings);
        }
      });
    });
  }
  // Guarded WebsiteBridge call — WebsiteBridge lives in website.js (loaded at
  // setup). If a write fires before it's ready, kick a load + toast and reject so
  // withSave surfaces it (never a silent no-op).
  function WebsiteBridgeCall(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (window.WebsiteBridge && typeof window.WebsiteBridge[method] === 'function') {
      return window.WebsiteBridge[method].apply(window.WebsiteBridge, args);
    }
    try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('website'); } catch (e) {}
    return Promise.reject(new Error('Site editor still loading — try again'));
  }

  // Write a chosen/uploaded logo URL through the single-source BrandBridge.
  // setLogoFromUrl (primary → MastBrandSync.setLogo + storefront placement
  // fan-out). Instant-apply with the pip; reloadSoon refreshes the preview.
  function applyLogoUrl(url) {
    if (!url) return;
    if (window.BrandBridge && typeof window.BrandBridge.setLogoFromUrl === 'function') {
      withSave(window.BrandBridge.setLogoFromUrl('primary', url).then(function (ok) {
        if (!ok) throw new Error('logo write failed');
        return ok;
      }));
    } else {
      try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('brand'); } catch (e) {}
      if (window.showToast) showToast('Site editor still loading — try again', true);
    }
  }

  function ensureStyles() {
    if (document.getElementById('wv2-styles')) return;
    var css =
      '.wv2-header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;' +
        'padding:12px 16px;margin:0 0 16px;background:var(--surface-card,var(--charcoal-light));border:1px solid var(--border);border-radius:10px;}' +
      '.wv2-header-main{min-width:0;display:flex;flex-direction:column;gap:4px;}' +
      '.wv2-sitename{font-size:1.15rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48vw;}' +
      '.wv2-urlrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.wv2-url{font-size:0.85rem;color:var(--teal);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42vw;}' +
      '.wv2-url:hover{text-decoration:underline;}' +
      '.wv2-url-ext{font-size:0.8em;opacity:0.8;}' +
      '.wv2-copy{font-size:0.72rem;padding:2px 9px;border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--text-secondary,var(--warm-gray));cursor:pointer;}' +
      '.wv2-copy:hover{color:var(--text-primary);border-color:var(--teal);}' +
      '.wv2-header-side{flex-shrink:0;}' +
      '.wv2-pip{display:inline-flex;align-items:center;gap:7px;font-size:0.78rem;font-weight:600;color:var(--text-secondary,var(--warm-gray));' +
        'padding:5px 11px;border-radius:999px;background:color-mix(in srgb,var(--success) 14%,transparent);}' +
      '.wv2-pip-dot{width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 0 3px color-mix(in srgb,var(--success) 22%,transparent);}' +
      '.wv2-stack{display:flex;flex-direction:column;gap:16px;}' +
      '.wv2-coming{font-style:italic;opacity:0.75;padding:6px 0;}' +
      // instant-apply pip "Saving…" state (the dot pulses amber while writing)
      '.wv2-pip.saving{background:color-mix(in srgb,var(--amber,var(--teal)) 14%,transparent);color:var(--text-secondary,var(--warm-gray));}' +
      '.wv2-pip.saving .wv2-pip-dot{background:var(--amber,var(--teal));box-shadow:0 0 0 3px color-mix(in srgb,var(--amber,var(--teal)) 22%,transparent);animation:wv2pulse 0.8s ease-in-out infinite;}' +
      '@keyframes wv2pulse{0%,100%{opacity:1;}50%{opacity:0.4;}}' +
      // Card 1 sub-sections
      '.wv2-sub{padding:4px 0 2px;}.wv2-sub + .wv2-sub{margin-top:18px;border-top:1px solid var(--border);padding-top:16px;}' +
      '.wv2-sub-h{font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:8px;}' +
      // scheme tile dots (color VALUES are inline data, not in these rules)
      '.wv2-scheme-dots{display:flex;gap:4px;}' +
      '.wv2-scheme-dot{width:16px;height:16px;border-radius:50%;border:1px solid color-mix(in srgb,var(--text-primary) 18%,transparent);}' +
      // font tiles — taller so the preview face reads
      '.wv2-font-name{font-size:1.0rem;line-height:1.15;color:var(--text-primary);}' +
      '.wv2-font-sub{font-size:0.72rem;margin-top:2px;}' +
      // fine-tune disclosures (custom colors, layout & scale)
      '.wv2-finetune{margin-top:10px;border:1px solid var(--border);border-radius:8px;overflow:hidden;}' +
      '.wv2-finetune>summary{cursor:pointer;list-style:none;padding:9px 12px;font-size:0.78rem;font-weight:600;color:var(--text-secondary,var(--warm-gray));background:color-mix(in srgb,var(--text-primary) 4%,transparent);}' +
      '.wv2-finetune>summary::-webkit-details-marker{display:none;}' +
      '.wv2-finetune>summary::before{content:"▸ ";color:var(--warm-gray);}.wv2-finetune[open]>summary::before{content:"▾ ";}' +
      '.wv2-finetune-body{padding:12px;}' +
      '.wv2-colorrow{display:flex;gap:16px;flex-wrap:wrap;}.wv2-colorrow .mu-colorinput{flex:1;min-width:150px;}' +
      // logo + voice two-column
      '.wv2-logorow{display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start;}' +
      '.wv2-logo-col{flex:0 0 200px;max-width:240px;}.wv2-voice-col{flex:1;min-width:220px;}' +
      '.wv2-logo-prev{background:var(--surface-dark,color-mix(in srgb,var(--text-primary) 6%,transparent));border:1px solid var(--border);border-radius:8px;padding:14px;display:flex;align-items:center;justify-content:center;min-height:76px;margin-bottom:8px;}' +
      '.wv2-logo-prev img{max-height:60px;max-width:100%;object-fit:contain;}' +
      '.wv2-logo-prev.empty{color:var(--warm-gray);font-size:0.85rem;}' +
      '.wv2-logo-actions{display:flex;gap:8px;flex-wrap:wrap;}' +
      // layout & scale grid + conflict warnings
      '.wv2-layoutgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;}' +
      '.wv2-layoutwarn{margin-top:12px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--warning,var(--amber)) 12%,transparent);border:1px solid color-mix(in srgb,var(--warning,var(--amber)) 26%,transparent);}' +
      '.wv2-warn-line{font-size:0.78rem;color:var(--warning,var(--amber));margin-bottom:4px;}.wv2-warn-line:last-child{margin-bottom:0;}';
    var st = document.createElement('style'); st.id = 'wv2-styles'; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  function render() {
    var tab = ensureTab();
    ensureStyles();
    var header = headerHtml();
    // 4 cards in a single vertical scroll (NOT tabs — U.tabs is intentionally not
    // used; this is one scrolling page).
    var stack = '<div class="wv2-stack">' + CARDS.map(cardHtml).join('') + '</div>';
    tab.innerHTML =
      U.pageHeader({ title: 'Your website', subtitle: 'Everything your visitors see — in one place.' }) +
      header + stack;
    // Fill Card 1 (Look & feel) into its mount now that the scaffold is in the DOM.
    // The other cards remain PR4–PR6 placeholders.
    mountLookFeel();
  }

  // ── public API ─────────────────────────────────────────────────────
  window.WebsiteV2 = {
    refresh: function () { render(); },

    // Card 1 · Color scheme tile → HomepageBridge.setColorScheme (clears custom
    // overrides server-side, mirrors wpSelectScheme). Instant-apply.
    pickScheme: function (schemeId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!window.HomepageBridge || !HomepageBridge.setColorScheme) {
        try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('homepage'); } catch (e) {}
        if (window.showToast) showToast('Site editor still loading — try again', true); return;
      }
      withSave(HomepageBridge.setColorScheme(schemeId));
    },
    // Card 1 · Font pair tile → MastBrandSync.setFontPair (canonical theme write).
    pickFont: function (fontId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!window.MastBrandSync) { if (window.showToast) showToast('Site editor still loading — try again', true); return; }
      withSave(window.MastBrandSync.setFontPair(fontId));
    },
    // Card 1 · Logo from the shared image library (PR-571 picker). Instant-apply:
    // the picked URL writes immediately through BrandBridge.setLogoFromUrl.
    logoFromLibrary: function () {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable.', true); return; }
      window.openImagePicker(function (imageId, url) {
        if (!url) return;
        applyLogoUrl(url);
      });
    },
    // Card 1 · Logo from computer → /uploadImage CF (base64), then the returned
    // library URL writes through BrandBridge.setLogoFromUrl (mirrors brand-v2).
    logoUpload: function () {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
      input.onchange = function () {
        if (!input.files || !input.files[0]) return;
        if (window.showToast) showToast('Uploading image…');
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var base64 = String(e.target.result).split(',')[1];
            var au = window.auth || (window.firebase && firebase.auth && firebase.auth());
            if (!au || !au.currentUser || typeof window.callCF !== 'function') { if (window.showToast) showToast('Upload unavailable.', true); return; }
            au.currentUser.getIdToken().then(function (token) {
              return window.callCF('/uploadImage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ image: base64, tags: ['logo'], source: 'website-logo-upload' }) });
            }).then(function (resp) { return resp.json(); }).then(function (result) {
              if (!result || !result.success) throw new Error((result && result.error) || 'Upload failed');
              var lib = window.imageLibrary || {}; var d = lib[result.imageId] || {};
              var url = d.url || result.url;
              if (!url) throw new Error('Upload returned no URL');
              applyLogoUrl(url);
            }).catch(function (err) { if (window.showToast) showToast('Upload failed: ' + (err && err.message ? err.message : 'error'), true); });
          } catch (err) { if (window.showToast) showToast('Upload failed.', true); }
        };
        reader.readAsDataURL(input.files[0]);
      };
      input.click();
    },

    copyLink: function () {
      var url = liveUrl();
      if (!url) { if (window.showToast) showToast('Live URL unavailable', true); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          function () { if (window.showToast) showToast('Live link copied'); },
          function () { if (typeof window.mastCopyFallback === 'function') mastCopyFallback('Copy this link', url); }
        );
      } else if (typeof window.mastCopyFallback === 'function') {
        mastCopyFallback('Copy this link', url);
      }
    }
  };

  // Flat global handlers for the swatchGrid tile delegate. MastUI's shared click
  // delegate resolves data-sw to window[fnName] (a FLAT global name, not a dotted
  // path), so the scheme/font tiles point here and these forward to WebsiteV2.
  window.wv2PickScheme = function (id) { window.WebsiteV2.pickScheme(id); };
  window.wv2PickFont = function (id) { window.WebsiteV2.pickFont(id); };

  // ── load ───────────────────────────────────────────────────────────
  // Cold-safe: read the storefront config defensively for the header (site name +
  // status) AND Card 1's theme/brand state. Header + cards render even if a read
  // fails. PR4–PR6 extend this with the section/shop/share reads their cards need.
  function load() {
    Promise.all([
      Promise.resolve(MastDB.get('webPresence/config')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/theme')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('config/brand')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('config/brand/logo')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/nav/logoUrl')).catch(function () { return null; })
    ]).then(function (r) {
      var wp = r[0];
      V2.wp = wp || {};
      V2.meta = (wp && wp.meta) || {};
      V2.status = (wp && wp.status) || 'draft';
      V2.theme = r[1] || {};
      V2.brand = r[2] || {};
      V2.logo = r[3] || {};
      V2.legacyLogoUrl = r[4] || null;
      V2.loaded = true;
      render();
    }).catch(function (e) { console.error('[website-v2] load', e); V2.loaded = true; render(); });
  }
  // After a delegated write the host writers mutate their own caches; re-read OUR
  // caches so the read-on-page controls reflect the change without a full reload.
  function reloadSoon() { setTimeout(load, 250); }

  // Host modules that own the single-source writers + the theme manifest Card 1
  // delegates to: homepage.js (window.HomepageBridge: getThemeOptions / setColorScheme,
  // and it loads the template manifest), brand.js (window.BrandBridge: setLogoFromUrl).
  // MastBrandSync + WebsiteBridge are the other writers (brand-sync.js loads eagerly;
  // WebsiteBridge is defined in website.js, this module's own host). Load them at
  // route setup so the first write isn't a cold no-op.
  function ensureHostModules() {
    if (!window.MastAdmin || typeof MastAdmin.loadModule !== 'function') return;
    try {
      var p = MastAdmin.loadModule('homepage');
      if (p && p.then) p.then(function () {
        // ensureLoaded populates homepage.js' manifest/theme caches the bridge
        // reads — it's ASYNC (fetches the template manifest), so re-render only
        // AFTER it resolves, else the scheme/font swatch grids paint empty.
        var e = (window.HomepageBridge && HomepageBridge.ensureLoaded) ? HomepageBridge.ensureLoaded() : null;
        Promise.resolve(e).then(function () { render(); }).catch(function () { render(); });
      });
    } catch (e) {}
    try { MastAdmin.loadModule('brand'); } catch (e) {}
    try { MastAdmin.loadModule('website'); } catch (e) {} // owns WebsiteBridge.setThemeField
  }

  MastAdmin.registerModule('website-v2', {
    routes: { 'website-v2': { tab: 'websiteV2Tab', setup: function () {
      ensureHostModules();
      ensureTab();
      render();   // paint the shell immediately (header + placeholders) — cold-safe
      load();     // then hydrate the header + Card 1 from config
    } } }
  });
})();
