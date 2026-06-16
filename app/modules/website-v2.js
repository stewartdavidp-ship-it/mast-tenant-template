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
  var V2 = { wp: null, meta: null, status: 'draft', theme: null, brand: null, logo: null,
    nav: null, sectionOrder: null, expanded: {}, importHits: null, loaded: false,
    // Card 3 (Your shop): the live storefront categories array (each
    // { id, label, wholesaleGroup? }) + a per-slug product count (for the
    // delete-safety warning + product-derived "stray category" suggestions).
    cats: null, catEditId: null, catMore: {}, productCatCounts: null, suggestions: null };

  // Card 2 · which section ids expose a layout VARIANT picker (closing
  // homepage-v2's variant hatch). The picker options + manifest defaults come
  // from HomepageBridge.getThemeOptions().variants/variantDefaults; the key the
  // theme write uses mirrors homepage.js renderVariantPicker (product-grid →
  // productGridVariant, otherwise <id>Variant).
  function variantKeyFor(secId) { return secId === 'product-grid' ? 'productGridVariant' : secId + 'Variant'; }

  // Card 2 · which section ids render storefront gallery images (the classic
  // "Edit images" punt stays for these — native image-grid editing is out of
  // scope per the build plan). Mirrors homepage.js IMAGE_CAPABLE_SECTIONS.
  var IMAGE_SECTIONS = ['hero', 'gallery', 'about', 'our-story', 'shop', 'schedule'];

  // Card 2 · contact social-link platforms (mirrors homepage-v2 SOCIAL_PLATFORMS).
  var SOCIAL_PLATFORMS = ['instagram', 'facebook', 'etsy', 'pinterest', 'tiktok', 'twitter', 'youtube'];

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

  // ── Card 2 · Your words & pictures ──────────────────────────────────
  // The homepage section editor, absorbed from homepage-v2: per-section enable
  // toggle + up/down reorder + inline text editing + layout-variant picker, all
  // INSTANT-APPLY through the single-source homepage writers (hp* / HomepageBridge)
  // and WebsiteBridge. Section IMAGE grids stay behind the existing classic link.
  //
  // Single-source writers:
  //   • text fields  → window.hpUpdateField(secId, fieldId, value)   → webPresence/config/sections/{key}/{field}
  //   • social links → window.hpUpdateSocial(platform, value)        → …/sections/contact/socialLinks/{platform}
  //   • enable       → window.hpToggleSection(secId, enabled)        → public/config/nav/sections/{id}/enabled (+ wp mirror)
  //   • reorder      → HomepageBridge.setSectionOrder(orderIds)       → public/config/sectionOrder (read-modify-write)
  //   • variant      → WebsiteBridge.setThemeField(variantKey, value) → public/config/theme/{heroVariant|galleryVariant|productGridVariant}

  // The canonical section list + per-section content fields, sourced from the
  // homepage host (manifest slots → SECTION_DEFS fallback). Cold-safe: empty
  // until HomepageBridge is loaded (ensureHostModules warms it, then re-renders).
  function wordsSectionList() {
    var b = window.HomepageBridge;
    var list = (b && b.getSectionList && b.getSectionList()) || [];
    if (!list.length) return [];
    // Order by the persisted/manifest order; unknown ids fall to the end.
    var order = wordsOrder();
    var byId = {}; list.forEach(function (s) { byId[s.id] = s; });
    var ordered = [];
    order.forEach(function (id) { if (byId[id]) { ordered.push(byId[id]); delete byId[id]; } });
    list.forEach(function (s) { if (byId[s.id]) ordered.push(s); });
    return ordered;
  }
  function wordsFields() {
    var b = window.HomepageBridge;
    return (b && b.getSectionFields && b.getSectionFields()) || {};
  }
  function wordsOrder() {
    if (Array.isArray(V2.sectionOrder) && V2.sectionOrder.length) return V2.sectionOrder.slice();
    var b = window.HomepageBridge;
    if (b && b.getSectionOrder) { try { return b.getSectionOrder(); } catch (e) {} }
    return [];
  }
  function sectionEnabled(id, required) {
    if (required) return true;
    var navData = (V2.nav && V2.nav[id]) || {};
    var wpData = (V2.wp && V2.wp.sections && V2.wp.sections[id]) || {};
    return navData.enabled !== false && wpData.enabled !== false; // mirrors homepage.js:283
  }
  function sectionData(id) { return (V2.wp && V2.wp.sections && V2.wp.sections[id]) || {}; }

  // One section row: name + On/Off + reorder + expand chevron, with an
  // expand-to-edit body (text fields + variant + image punt).
  function wordsRow(sec, idx, total) {
    var ed = canEdit();
    var on = sectionEnabled(sec.id, sec.required);
    var open = !!V2.expanded[sec.id];
    var sid = esc(sec.id);
    var pill = '<span class="wv2-sec-pill ' + (on ? 'on' : 'off') + '">' + (on ? 'On' : 'Off') + '</span>';
    // reorder controls (disabled at the ends)
    var upDis = idx === 0 ? ' disabled' : '';
    var dnDis = idx === total - 1 ? ' disabled' : '';
    var reorder = ed
      ? '<span class="wv2-sec-move">' +
          '<button type="button" class="wv2-mv"' + upDis + ' title="Move up" onclick="WebsiteV2.moveSection(\'' + sid + '\',-1)">▲</button>' +
          '<button type="button" class="wv2-mv"' + dnDis + ' title="Move down" onclick="WebsiteV2.moveSection(\'' + sid + '\',1)">▼</button>' +
        '</span>'
      : '';
    var toggle = '';
    if (ed) {
      toggle = sec.required
        ? '<span class="mu-sub">Always on</span>'
        : '<button type="button" class="wv2-sec-toggle" onclick="WebsiteV2.toggleSection(\'' + sid + '\',' + (on ? 'false' : 'true') + ')">' + (on ? 'Turn off' : 'Turn on') + '</button>';
    }
    var chevron = '<button type="button" class="wv2-sec-expand" aria-expanded="' + open + '" onclick="WebsiteV2.toggleExpand(\'' + sid + '\')">' + (open ? '▾' : '▸') + '</button>';
    var head =
      '<div class="wv2-sec-head">' +
        '<div class="wv2-sec-id">' + chevron + '<span class="wv2-sec-name">' + esc(sec.label || sec.id) + '</span> ' + pill + '</div>' +
        '<div class="wv2-sec-actions">' + reorder + toggle + '</div>' +
      '</div>';
    var body = open ? '<div class="wv2-sec-body">' + wordsSectionEditor(sec) + '</div>' : '';
    return '<div class="wv2-sec" data-sec="' + sid + '">' + head + body + '</div>';
  }

  // The expanded editor for one section: inline text fields (instant-apply via
  // hpUpdateField), social links for contact, the layout-variant picker (where
  // supported), and the classic image-edit punt.
  function wordsSectionEditor(sec) {
    var ed = canEdit();
    if (!ed) return '<div class="mu-sub">You do not have permission to edit this section.</div>';
    var fields = wordsFields()[sec.id] || [];
    var data = sectionData(sec.id);
    var out = '';
    if (fields.length) {
      out += fields.map(function (f) { return wordsFieldGroup(sec.id, f, data); }).join('');
    } else {
      out += '<div class="mu-sub">No text content for this section.</div>';
    }
    // Contact social links (mirrors homepage editor's contact section).
    if (sec.id === 'contact') {
      var links = data.socialLinks || {};
      out += '<div class="wv2-sub-h" style="margin-top:12px;">Social links</div>' +
        '<div class="wv2-social-grid">' + SOCIAL_PLATFORMS.map(function (p) {
          return '<div class="form-group"><label class="form-label">' + esc(titleCase(p)) + '</label>' +
            '<input class="form-input" type="url" id="wv2soc-' + esc(p) + '" value="' + esc(links[p] || '') + '" placeholder="https://" style="width:100%;"></div>';
        }).join('') + '</div>';
    }
    // Layout variant picker (hero / gallery / product-grid) — closes the
    // homepage-v2 variant hatch. swatchGrid of manifest variant options.
    out += wordsVariantSection(sec.id);
    // Section images stay classic (no native image-grid editing here).
    if (IMAGE_SECTIONS.indexOf(sec.id) !== -1) {
      out += '<div class="mu-sub" style="margin-top:12px;">Photos for this section live in the page builder.<br>' +
        '<button type="button" class="btn btn-secondary btn-small" style="margin-top:6px;" onclick="WebsiteV2.classicImages()">Edit images (classic) →</button></div>';
    }
    return out;
  }

  // One section text field → an instant-apply input wired in wireWords().
  function wordsFieldGroup(secId, f, data) {
    var val = data[f.id] !== undefined ? data[f.id] : '';
    var iid = 'wv2fld-' + secId + '-' + f.id;
    var inner;
    if (f.type === 'textarea') {
      inner = '<textarea class="form-input" id="' + esc(iid) + '" rows="4" style="width:100%;resize:vertical;">' + esc(String(val)) + '</textarea>';
    } else if (f.type === 'number') {
      inner = '<input class="form-input" type="number" id="' + esc(iid) + '" value="' + esc(String(val)) + '" style="width:100%;">';
    } else if (f.type === 'select') {
      var opts = (f.options || []).map(function (o) {
        var ov = o.v != null ? o.v : o.value, ol = o.l != null ? o.l : o.label;
        return '<option value="' + esc(ov) + '"' + (String(val) === String(ov) ? ' selected' : '') + '>' + esc(ol) + '</option>';
      }).join('');
      inner = '<select class="form-input" id="' + esc(iid) + '" style="width:100%;">' + opts + '</select>';
    } else if (f.type === 'toggle') {
      inner = '<label class="toggle-switch"><input type="checkbox" id="' + esc(iid) + '"' + (val ? ' checked' : '') + '><span class="toggle-slider"></span></label>';
    } else if (f.type === 'image') {
      // image fields edit on classic (no native image-grid editing here).
      return '<div class="form-group"><label class="form-label">' + esc(f.label) + '</label>' +
        '<div class="mu-sub">Set in the page builder.</div></div>';
    } else {
      inner = '<input class="form-input" type="text" id="' + esc(iid) + '" value="' + esc(String(val)) + '" style="width:100%;">';
    }
    return '<div class="form-group"><label class="form-label">' + esc(f.label) + '</label>' + inner + '</div>';
  }

  // Layout-variant picker for a section (hero/gallery/product-grid). swatchGrid
  // of the manifest's variant options; the selected tile is the live theme value
  // (else the manifest default). Picking writes WebsiteBridge.setThemeField.
  function wordsVariantSection(secId) {
    var opts = themeOptions();
    var variants = (opts.variants && opts.variants[secId]) || null;
    if (!variants || !variants.length) return '';
    var t = V2.theme || {};
    var key = variantKeyFor(secId);
    var def = (opts.variantDefaults && opts.variantDefaults[secId]) || (variants[0] && variants[0].id) || '';
    var selected = t[key] || def;
    var items = variants.map(function (v) { return { value: v.id, label: v.label || v.id, _desc: v.desc || '' }; });
    var grid = U.swatchGrid({
      items: items, selected: selected, onSelectFnName: 'wv2PickVariant',
      idKey: 'value',
      renderItem: function (it) {
        return '<span class="wv2-var-name">' + esc(it.label) + '</span>' +
          (it._desc ? '<span class="wv2-var-desc mu-sw-label">' + esc(it._desc) + '</span>' : '');
      }
    });
    // The variant id is encoded into the fn name via a per-section forwarder so
    // the flat swatchGrid delegate (window[fnName]) routes to the right section.
    var forwarder = 'wv2PickVariant_' + secId.replace(/-/g, '_');
    grid = grid.replace(/data-sw="wv2PickVariant"/g, 'data-sw="' + forwarder + '"');
    window[forwarder] = (function (sid) { return function (variantId) { WebsiteV2.pickVariant(sid, variantId); }; })(secId);
    return '<div class="wv2-sub-h" style="margin-top:12px;">Layout</div>' + grid;
  }

  // Mount Card 2 into its scaffold body (wv2WordsBody) — replaces the PR2
  // "Coming in this builder" placeholder. Re-called by reloadSoon() to refresh.
  function mountWords() {
    var host = document.getElementById('wv2WordsBody');
    if (!host) return;
    host.innerHTML = wordsHtml();
    wireWords();
  }
  function wordsHtml() {
    if (!canEdit()) {
      return '<div class="mu-sub">You do not have permission to edit your homepage content.</div>';
    }
    var list = wordsSectionList();
    var sectionsHtml = list.length
      ? '<div class="wv2-seclist">' + list.map(function (s, i) { return wordsRow(s, i, list.length); }).join('') + '</div>'
      : '<div class="mu-sub">Your homepage sections load with your template…</div>';
    return wordsImportHtml() + sectionsHtml;
  }

  // "Copy from my old site" — one URL → analyzeExistingSite (the brand/content
  // half only; NO catalog crawl). Suggested values surface as "Use this" chips
  // that write into the section fields above (never auto-applied).
  function wordsImportHtml() {
    var hits = V2.importHits;
    var resultHtml = '';
    if (hits) {
      var chips = [];
      if (hits.heroHeadline) chips.push(importChip('Hero headline', hits.heroHeadline, 'hero', 'headline'));
      if (hits.heroSub) chips.push(importChip('Hero subheadline', hits.heroSub, 'hero', 'subheadline'));
      if (hits.aboutText) chips.push(importChip('About text', hits.aboutText, 'about', 'body'));
      if (hits.contactEmail) chips.push(importChip('Contact email', hits.contactEmail, 'contact', 'email'));
      if (hits.contactPhone) chips.push(importChip('Contact phone', hits.contactPhone, 'contact', 'phone'));
      resultHtml = chips.length
        ? '<div class="wv2-import-hits">' + chips.join('') + '</div>'
        : '<div class="mu-sub" style="margin-top:8px;">No reusable text found on that page.</div>';
    }
    return '<details class="wv2-finetune wv2-import">' +
      '<summary>Copy from my old site</summary>' +
      '<div class="wv2-finetune-body">' +
        '<div class="mu-sub" style="margin-bottom:8px;">Paste your existing site\'s address. We\'ll read its words (not its products) and offer them as one-tap fills.</div>' +
        '<div class="wv2-import-row">' +
          '<input class="form-input" id="wv2ImportUrl" type="url" placeholder="https://your-old-site.com" style="flex:1;min-width:200px;">' +
          '<button type="button" class="btn btn-primary btn-small" id="wv2ImportBtn" onclick="WebsiteV2.copyFromSite()">Read it</button>' +
        '</div>' +
        '<div id="wv2ImportStatus" class="mu-sub" style="margin-top:6px;"></div>' +
        resultHtml +
      '</div></details>';
  }
  // A single "Use this" chip — clicking writes the suggested value into the
  // target section field (hpUpdateField) and re-renders so the field shows it.
  function importChip(label, value, secId, fieldId) {
    var preview = String(value).length > 60 ? String(value).slice(0, 60) + '…' : String(value);
    var token = 'wv2imp_' + secId + '_' + fieldId;
    window['_' + token] = value; // stash the full value (avoids inline-quote escaping)
    return '<div class="wv2-impchip">' +
      '<div class="wv2-impchip-main"><span class="wv2-impchip-label">' + esc(label) + '</span>' +
        '<span class="wv2-impchip-val">' + esc(preview) + '</span></div>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.useImport(\'' + esc(token) + '\',\'' + esc(secId) + '\',\'' + esc(fieldId) + '\')">Use this</button>' +
    '</div>';
  }

  // Wire the instant-apply bindings Card 2 can't do inline (text fields, social
  // links, select/toggle, the import URL). swatch tiles fire via the shared
  // delegate (data-sw → the per-section variant forwarder).
  function wireWords() {
    if (!canEdit()) return;
    var list = wordsSectionList();
    var fieldsBySec = wordsFields();
    list.forEach(function (sec) {
      if (!V2.expanded[sec.id]) return; // only the open editor has inputs
      (fieldsBySec[sec.id] || []).forEach(function (f) {
        if (f.type === 'image') return;
        var el = document.getElementById('wv2fld-' + sec.id + '-' + f.id);
        if (!el) return;
        U.bindInstant(el, {
          key: 'wv2fld:' + sec.id + ':' + f.id,
          delay: f.type === 'select' || f.type === 'toggle' ? 0 : 500,
          writer: (function (secId, field) {
            return function (raw) {
              var value = raw;
              if (field.type === 'number') value = parseInt(raw, 10) || 0;
              else if (field.type === 'toggle') value = !!raw;
              if (!hpReady('hpUpdateField')) return;
              // optimistic cache so a re-render keeps the typed value
              if (!V2.wp.sections) V2.wp.sections = {};
              if (!V2.wp.sections[secId]) V2.wp.sections[secId] = {};
              V2.wp.sections[secId][field.id] = value;
              withSave(Promise.resolve(window.hpUpdateField(secId, field.id, value)), { reload: false });
            };
          })(sec.id, f)
        });
      });
      if (sec.id === 'contact') {
        SOCIAL_PLATFORMS.forEach(function (p) {
          var el = document.getElementById('wv2soc-' + p);
          if (!el) return;
          U.bindInstant(el, {
            key: 'wv2soc:' + p, delay: 500,
            writer: (function (plat) {
              return function (v) {
                if (!hpReady('hpUpdateSocial')) return;
                if (!V2.wp.sections) V2.wp.sections = {};
                if (!V2.wp.sections.contact) V2.wp.sections.contact = {};
                if (!V2.wp.sections.contact.socialLinks) V2.wp.sections.contact.socialLinks = {};
                V2.wp.sections.contact.socialLinks[plat] = v;
                withSave(Promise.resolve(window.hpUpdateSocial(plat, v)), { reload: false });
              };
            })(p)
          });
        });
      }
    });
  }

  // Guard: the homepage host writers (window.hp*) live in homepage.js. If a
  // delegated write isn't loaded yet, kick a load + toast and bail (never a
  // silent no-op). Mirrors homepage-v2's hostReady.
  function hpReady(fnName) {
    if (typeof window[fnName] === 'function') return true;
    try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('homepage'); } catch (e) {}
    if (window.showToast) showToast('Site editor still loading — try again', true);
    return false;
  }

  // Guarded HomepageBridge call (for setSectionOrder). Same pattern as
  // WebsiteBridgeCall — reject (never silently no-op) if the host isn't ready.
  function HomepageBridgeCall(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (window.HomepageBridge && typeof window.HomepageBridge[method] === 'function') {
      return window.HomepageBridge[method].apply(window.HomepageBridge, args);
    }
    try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('homepage'); } catch (e) {}
    return Promise.reject(new Error('Site editor still loading — try again'));
  }

  // ── Card 3 · Your shop ──────────────────────────────────────────────
  // Storefront categories CRUD + the single retained "Advanced (classic)" import
  // door. Categories (public/config/categories — a plain ARRAY of
  // { id, label, wholesaleGroup? }) drive the shop filter pills, gallery sections,
  // and wholesale grouping. Every write is SINGLE-SOURCED through
  // WebsiteBridge.saveCategories(arr) — which sets the WHOLE array (last-write-wins),
  // refreshes the global CATEGORIES (loadTenantCategories), and stamps the draft
  // signal (markUnpublished). The twin does read-modify-write in ONE place
  // (catsWorking → mutate → save) so there's never a raw MastDB.set here.
  //
  // The whole async catalog-import subsystem stays behind the ONE classic link
  // (Advanced → the legacy Import tab); it is NOT rebuilt natively.

  // The working categories array the twin mutates — always a fresh copy of the
  // loaded state so a failed write doesn't half-apply (we re-read on reload).
  function catsWorking() { return (V2.cats || []).map(function (c) { return Object.assign({}, c); }); }

  // Commit the whole working array through the single-sourced bridge writer.
  // Optimistically updates V2.cats so the list re-renders instantly, flips the
  // Saved pip, and re-tallies suggestions against the new list. reload re-reads
  // the canonical state (cats + product counts) after the write settles.
  function commitCats(arr) {
    V2.cats = arr.map(function (c) { return Object.assign({}, c); });   // optimistic
    if (V2.productCatCounts) V2.suggestions = computeSuggestions(V2.productCatCounts);
    mountShop();
    return withSave(WebsiteBridgeCall('saveCategories', arr), { reload: false }).then(function (res) {
      if (res === false) return false;       // withSave already toasted + reset pip
      reloadSoon();                          // re-read canonical cats + recount products
      return res;
    });
  }
  // Derive a unique slug for a label via the bridge (mirrors the legacy
  // slugify + numeric de-dupe) so v2-created ids match legacy ones. Falls back to
  // a local slugify if the bridge isn't loaded yet.
  function slugFor(label, list, excludeIdx) {
    if (window.WebsiteBridge && typeof window.WebsiteBridge.slugForCategory === 'function') {
      return window.WebsiteBridge.slugForCategory(label, list, excludeIdx);
    }
    var base = String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!base) return '';
    var slug = base, n = 2;
    while ((list || []).some(function (c, i) { return i !== excludeIdx && c && c.id === slug; })) { slug = base + '-' + n; n++; }
    return slug;
  }

  function titleSlug(slug) { return titleCase(String(slug || '')); }

  // One category row: inline-editable label, slug chip, optional wholesaleGroup
  // under a row-level "More ▾", reorder ▲▼, delete. Edit mode swaps the label for
  // a text input committed on the row's Save.
  function shopCatRow(cat, idx, total) {
    var ed = canEdit();
    var editing = V2.catEditId === cat.id;
    var more = !!V2.catMore[cat.id];
    var cid = esc(cat.id);
    var count = (V2.productCatCounts && V2.productCatCounts[String(cat.id).toLowerCase()]) || 0;
    var countPill = count > 0
      ? '<span class="wv2-cat-count" title="' + count + ' product' + (count === 1 ? '' : 's') + ' in this category">' + count + '</span>'
      : '';
    // reorder controls (disabled at the ends)
    var upDis = idx === 0 ? ' disabled' : '';
    var dnDis = idx === total - 1 ? ' disabled' : '';
    var reorder = ed
      ? '<span class="wv2-cat-move">' +
          '<button type="button" class="wv2-mv"' + upDis + ' title="Move up" onclick="WebsiteV2.moveCat(\'' + cid + '\',-1)">▲</button>' +
          '<button type="button" class="wv2-mv"' + dnDis + ' title="Move down" onclick="WebsiteV2.moveCat(\'' + cid + '\',1)">▼</button>' +
        '</span>'
      : '';
    var main;
    if (editing && ed) {
      main = '<div class="wv2-cat-edit">' +
        '<input class="form-input" id="wv2CatLabel-' + cid + '" type="text" value="' + esc(cat.label) + '" style="width:100%;">' +
        '<div class="wv2-cat-edit-actions">' +
          '<button type="button" class="btn btn-primary btn-small" onclick="WebsiteV2.saveCatLabel(\'' + cid + '\')">Save</button>' +
          '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.cancelCatEdit()">Cancel</button>' +
        '</div>' +
      '</div>';
    } else {
      main = '<div class="wv2-cat-main">' +
        '<span class="wv2-cat-label">' + esc(cat.label) + '</span>' + countPill +
        '<span class="wv2-cat-slug">' + cid + '</span>' +
      '</div>';
    }
    var actions = '';
    if (ed && !editing) {
      actions = '<div class="wv2-cat-actions">' + reorder +
        '<button type="button" class="wv2-cat-btn" title="Rename" onclick="WebsiteV2.editCat(\'' + cid + '\')">Rename</button>' +
        '<button type="button" class="wv2-cat-btn wv2-cat-more" title="More options" onclick="WebsiteV2.toggleCatMore(\'' + cid + '\')">More ' + (more ? '▴' : '▾') + '</button>' +
        '<button type="button" class="wv2-cat-btn danger" title="Delete" onclick="WebsiteV2.deleteCat(\'' + cid + '\')">Delete</button>' +
      '</div>';
    }
    // Row-level "More" — the de-emphasized wholesaleGroup parity field.
    var moreBody = (more && ed && !editing)
      ? '<div class="wv2-cat-morebody">' +
          '<label class="form-label">Wholesale group <span class="mu-sub">(optional — groups categories for wholesale)</span></label>' +
          '<input class="form-input" id="wv2CatWholesale-' + cid + '" type="text" value="' + esc(cat.wholesaleGroup || '') + '" placeholder="e.g. Decorative" style="width:100%;max-width:280px;">' +
        '</div>'
      : '';
    return '<div class="wv2-cat" data-cat="' + cid + '">' +
        '<div class="wv2-cat-head">' + main + actions + '</div>' + moreBody +
      '</div>';
  }

  // The product-derived suggestion chip-row: slugs found on products but missing
  // from the list. One tap appends the category (label = title-cased slug).
  function shopSuggestionsHtml() {
    var sug = V2.suggestions;
    if (!Array.isArray(sug) || !sug.length || !canEdit()) return '';
    var chips = sug.slice(0, 8).map(function (s) {
      return '<button type="button" class="wv2-sug-chip" onclick="WebsiteV2.addSuggestedCat(\'' + esc(s.slug) + '\')" title="' + s.count + ' product' + (s.count === 1 ? '' : 's') + ' use this category">' +
        '+ ' + esc(titleSlug(s.slug)) + ' <span class="wv2-sug-n">' + s.count + '</span></button>';
    }).join('');
    return '<div class="wv2-suggest">' +
      '<div class="wv2-sub-h">Found in your products</div>' +
      '<div class="mu-sub" style="margin-bottom:8px;">These categories are on your products but not in your shop yet. Tap to add.</div>' +
      '<div class="wv2-sug-row">' + chips + '</div>' +
    '</div>';
  }

  // The add-new-category row (label only — the slug is auto-derived on add).
  function shopAddHtml() {
    if (!canEdit()) return '';
    return '<div class="wv2-cat-add">' +
      '<input class="form-input" id="wv2CatNew" type="text" placeholder="New category name (e.g. Drinkware)" style="flex:1;min-width:180px;" onkeydown="if(event.key===\'Enter\'){WebsiteV2.addCat();}">' +
      '<button type="button" class="btn btn-primary btn-small" onclick="WebsiteV2.addCat()">Add category</button>' +
    '</div>' +
    '<div id="wv2CatAddErr" class="mu-sub" style="color:var(--danger);margin-top:4px;display:none;"></div>';
  }

  // The one retained classic hatch in the whole builder: the async catalog-import
  // subsystem stays behind THIS single "Advanced (classic)" door → the legacy
  // Import tab (deep-linked via navigateToClassic('website', { tab:'import' })).
  function shopImportDoorHtml() {
    if (!canEdit()) return '';
    return '<div class="wv2-importdoor">' +
      '<div class="wv2-importdoor-main">' +
        '<div class="wv2-sub-h">Bring in my whole catalog</div>' +
        '<div class="mu-sub">Have an existing store on Shopify, Etsy, Square, or your own site? Import your full product catalog in the advanced tools.</div>' +
      '</div>' +
      '<button type="button" class="btn btn-secondary" onclick="WebsiteV2.openImport()">Advanced (classic) →</button>' +
    '</div>';
  }

  function shopHtml() {
    if (!canEdit()) {
      return '<div class="mu-sub">You do not have permission to edit your shop categories.</div>';
    }
    var cats = V2.cats || [];
    var listHtml = cats.length
      ? '<div class="wv2-catlist">' + cats.map(function (c, i) { return shopCatRow(c, i, cats.length); }).join('') + '</div>'
      : '<div class="mu-sub" style="padding:6px 0;">No categories yet. Add your first product category below — it becomes a filter pill on your shop.</div>';
    return '<div class="wv2-sub"><div class="wv2-sub-h">Shop categories</div>' +
        '<div class="mu-sub" style="margin-bottom:8px;">Categories become the filter pills customers tap on your shop page. Drag order is display order.</div>' +
        listHtml + shopAddHtml() +
      '</div>' +
      shopSuggestionsHtml() +
      '<div class="wv2-sub">' + shopImportDoorHtml() + '</div>';
  }

  // Mount Card 3 into its scaffold body (wv2ShopBody) — replaces the PR2
  // "Coming in this builder" placeholder. Re-called by reloadSoon()/optimistic
  // updates to refresh state.
  function mountShop() {
    var host = document.getElementById('wv2ShopBody');
    if (!host) return;
    host.innerHTML = shopHtml();
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
      '.wv2-warn-line{font-size:0.78rem;color:var(--warning,var(--amber));margin-bottom:4px;}.wv2-warn-line:last-child{margin-bottom:0;}' +
      // ── Card 2 · Your words & pictures ──
      '.wv2-seclist{display:flex;flex-direction:column;}' +
      '.wv2-sec{border-top:1px solid var(--border);}.wv2-sec:first-child{border-top:none;}' +
      '.wv2-sec-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;}' +
      '.wv2-sec-id{display:flex;align-items:center;gap:6px;min-width:0;}' +
      '.wv2-sec-name{font-size:0.9rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.wv2-sec-pill{font-size:0.72rem;font-weight:600;padding:1px 8px;border-radius:999px;}' +
      '.wv2-sec-pill.on{color:var(--success);background:color-mix(in srgb,var(--success) 14%,transparent);}' +
      '.wv2-sec-pill.off{color:var(--text-secondary,var(--warm-gray));background:color-mix(in srgb,var(--text-primary) 8%,transparent);}' +
      '.wv2-sec-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;}' +
      '.wv2-sec-expand{background:none;border:none;color:var(--warm-gray);cursor:pointer;font-size:0.85rem;padding:0 2px;line-height:1;}' +
      '.wv2-sec-expand:hover{color:var(--text-primary);}' +
      '.wv2-sec-move{display:inline-flex;gap:2px;}' +
      '.wv2-mv{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.72rem;width:22px;height:22px;line-height:1;padding:0;}' +
      '.wv2-mv:hover:not(:disabled){color:var(--text-primary);border-color:var(--teal);}.wv2-mv:disabled{opacity:0.35;cursor:default;}' +
      '.wv2-sec-toggle{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.72rem;padding:3px 10px;}' +
      '.wv2-sec-toggle:hover{color:var(--text-primary);border-color:var(--teal);}' +
      '.wv2-sec-body{padding:4px 0 14px 22px;}' +
      '.wv2-social-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}' +
      '.wv2-var-name{font-size:0.85rem;color:var(--text-primary);}' +
      '.wv2-var-desc{font-size:0.72rem;margin-top:2px;}' +
      // Copy-from-site import
      '.wv2-import-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}' +
      '.wv2-import-hits{margin-top:10px;display:flex;flex-direction:column;gap:8px;}' +
      '.wv2-impchip{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:color-mix(in srgb,var(--text-primary) 3%,transparent);}' +
      '.wv2-impchip-main{min-width:0;display:flex;flex-direction:column;gap:1px;}' +
      '.wv2-impchip-label{font-size:0.72rem;font-weight:600;color:var(--text-secondary,var(--warm-gray));}' +
      '.wv2-impchip-val{font-size:0.85rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw;}' +
      // ── Card 3 · Your shop (categories) ──
      '.wv2-catlist{display:flex;flex-direction:column;}' +
      '.wv2-cat{border-top:1px solid var(--border);}.wv2-cat:first-child{border-top:none;}' +
      '.wv2-cat-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:9px 0;flex-wrap:wrap;}' +
      '.wv2-cat-main{display:flex;align-items:center;gap:9px;min-width:0;flex:1;}' +
      '.wv2-cat-label{font-size:0.9rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.wv2-cat-slug{font-size:0.72rem;color:var(--text-secondary,var(--warm-gray));font-family:ui-monospace,monospace;opacity:0.8;}' +
      '.wv2-cat-count{font-size:0.72rem;font-weight:600;color:var(--teal);background:color-mix(in srgb,var(--teal) 14%,transparent);padding:1px 8px;border-radius:999px;flex-shrink:0;}' +
      '.wv2-cat-actions{display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;}' +
      '.wv2-cat-move{display:inline-flex;gap:2px;}' +
      '.wv2-cat-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.72rem;padding:3px 10px;}' +
      '.wv2-cat-btn:hover{color:var(--text-primary);border-color:var(--teal);}' +
      '.wv2-cat-btn.danger:hover{color:var(--danger);border-color:var(--danger);}' +
      '.wv2-cat-more{opacity:0.85;}' +
      '.wv2-cat-edit{display:flex;flex-direction:column;gap:8px;flex:1;min-width:0;}' +
      '.wv2-cat-edit-actions{display:flex;gap:8px;}' +
      '.wv2-cat-morebody{padding:2px 0 12px;}' +
      '.wv2-cat-morebody .form-label{display:block;font-size:0.78rem;margin-bottom:4px;}' +
      '.wv2-cat-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--border);}' +
      // product-derived suggestion chips
      '.wv2-suggest{margin-top:18px;border-top:1px solid var(--border);padding-top:16px;}' +
      '.wv2-sug-row{display:flex;flex-wrap:wrap;gap:8px;}' +
      '.wv2-sug-chip{display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;font-weight:600;color:var(--teal);background:color-mix(in srgb,var(--teal) 8%,transparent);border:1px solid color-mix(in srgb,var(--teal) 30%,transparent);border-radius:999px;padding:5px 12px;cursor:pointer;}' +
      '.wv2-sug-chip:hover{background:color-mix(in srgb,var(--teal) 16%,transparent);}' +
      '.wv2-sug-n{font-size:0.72rem;font-weight:600;opacity:0.85;}' +
      // the one retained classic import door
      '.wv2-importdoor{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:12px 14px;border:1px dashed var(--border);border-radius:10px;background:color-mix(in srgb,var(--text-primary) 3%,transparent);}' +
      '.wv2-importdoor-main{min-width:0;flex:1;}';
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
    // Fill Card 1 (Look & feel) + Card 2 (Your words & pictures) + Card 3 (Your
    // shop) into their mounts now that the scaffold is in the DOM. Card 4 remains
    // the PR6 placeholder.
    mountLookFeel();
    mountWords();
    mountShop();
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

    // ── Card 2 · Your words & pictures ──────────────────────────────────
    // Section enable/disable → hpToggleSection (writes nav/sections enabled +
    // webPresence mirror). Instant-apply.
    toggleSection: function (id, enabled) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!hpReady('hpToggleSection')) return;
      // optimistic cache so the pill flips without waiting for the re-read
      if (!V2.nav) V2.nav = {}; if (!V2.nav[id]) V2.nav[id] = {}; V2.nav[id].enabled = !!enabled;
      if (!V2.wp.sections) V2.wp.sections = {}; if (!V2.wp.sections[id]) V2.wp.sections[id] = {}; V2.wp.sections[id].enabled = !!enabled;
      withSave(Promise.resolve(window.hpToggleSection(id, !!enabled)), { reload: false }).then(mountWords);
    },
    // Expand/collapse a section's inline editor. Pure UI — re-mount Card 2.
    toggleExpand: function (id) {
      V2.expanded[id] = !V2.expanded[id];
      mountWords();
    },
    // Up/down reorder → HomepageBridge.setSectionOrder (read-modify-write the
    // public/config/sectionOrder array in ONE writer). dir: -1 up / +1 down.
    moveSection: function (id, dir) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var list = wordsSectionList();
      var order = list.map(function (s) { return s.id; });
      var i = order.indexOf(id);
      var j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return;
      order.splice(j, 0, order.splice(i, 1)[0]);
      V2.sectionOrder = order.slice(); // optimistic so the re-render shows the new order
      mountWords();
      withSave(HomepageBridgeCall('setSectionOrder', order), { reload: false });
    },
    // Layout variant tile → WebsiteBridge.setThemeField (public/config/theme/
    // {heroVariant|galleryVariant|productGridVariant}). Closes homepage-v2's
    // variant hatch. Instant-apply.
    pickVariant: function (secId, variantId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var key = variantKeyFor(secId);
      if (V2.theme) V2.theme[key] = variantId; // optimistic so the tile selects
      withSave(WebsiteBridgeCall('setThemeField', key, variantId), { reload: false }).then(mountWords);
    },
    // "Use this" import chip → write the suggested value into a section field via
    // hpUpdateField, then re-render so the field shows it. Never auto-applied.
    useImport: function (token, secId, fieldId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var value = window['_' + token];
      if (value == null) return;
      if (!hpReady('hpUpdateField')) return;
      if (!V2.wp.sections) V2.wp.sections = {};
      if (!V2.wp.sections[secId]) V2.wp.sections[secId] = {};
      V2.wp.sections[secId][fieldId] = value;
      V2.expanded[secId] = true; // open the section so the filled value is visible
      withSave(Promise.resolve(window.hpUpdateField(secId, fieldId, value)), { reload: false }).then(mountWords);
      if (window.showToast) showToast('Added to your homepage.');
    },
    // "Copy from my old site" — analyzeExistingSite CF (brand/content half only,
    // NO catalog crawl). Maps the analysis to reusable section-field suggestions
    // surfaced as "Use this" chips. Never auto-applied.
    copyFromSite: function () {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var input = document.getElementById('wv2ImportUrl');
      var statusEl = document.getElementById('wv2ImportStatus');
      var btn = document.getElementById('wv2ImportBtn');
      var url = (input && input.value || '').trim();
      if (!url) { if (statusEl) statusEl.textContent = 'Enter your old site\'s address first.'; return; }
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      if (!window.firebase || !firebase.functions) { if (statusEl) statusEl.textContent = 'Site reader unavailable right now.'; return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }
      if (statusEl) statusEl.textContent = 'Reading your old site… this can take up to a minute.';
      var tid = ''; try { tid = MastDB.tenantId(); } catch (e) {}
      firebase.functions().httpsCallable('analyzeExistingSite', { timeout: 120000 })({ url: url, tenantId: tid })
        .then(function (res) {
          var a = (res && res.data && res.data.analysis) || {};
          // brand/content half ONLY — ignore template-match / catalog crawl fields
          V2.importHits = {
            heroHeadline: a.hero && a.hero.headline,
            heroSub: a.hero && a.hero.subheadline,
            aboutText: a.aboutText,
            contactEmail: a.contactInfo && a.contactInfo.email,
            contactPhone: a.contactInfo && a.contactInfo.phone
          };
          mountWords();
          // re-open the import disclosure + show the result (mountWords rebuilds it collapsed)
          var det = document.querySelector('.wv2-import'); if (det) det.open = true;
        })
        .catch(function (err) {
          console.error('[website-v2] copyFromSite', err);
          var s = document.getElementById('wv2ImportStatus');
          if (s) s.textContent = 'Could not read that site: ' + (err && err.message ? err.message : 'try another address.');
          var b = document.getElementById('wv2ImportBtn'); if (b) { b.disabled = false; b.textContent = 'Read it'; }
        });
    },
    // Section images stay classic — open the page builder (the existing punt).
    classicImages: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('homepage');
      else if (typeof navigateTo === 'function') navigateTo('homepage');
    },

    // ── Card 3 · Your shop ──────────────────────────────────────────────
    // Add a category from the new-category input. Slug auto-derived (unique);
    // appends to the working array and commits the whole array via the bridge.
    addCat: function () {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      var input = document.getElementById('wv2CatNew');
      var errEl = document.getElementById('wv2CatAddErr');
      var label = (input && input.value || '').trim();
      function err(msg) { if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } }
      if (errEl) errEl.style.display = 'none';
      if (!label) { err('Enter a category name first.'); if (input) input.focus(); return; }
      var arr = catsWorking();
      var slug = slugFor(label, arr, -1);
      if (!slug) { err('Could not make a valid ID from that name — try letters and numbers.'); return; }
      arr.push({ id: slug, label: label });
      commitCats(arr);
      if (window.showToast) showToast('Category “' + label + '” added.');
    },
    // Append a product-derived suggestion (label = title-cased slug, id = the slug
    // as-is so existing products stay filed under it). One tap → commit.
    addSuggestedCat: function (slug) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      slug = String(slug || '').toLowerCase();
      if (!slug) return;
      var arr = catsWorking();
      if (arr.some(function (c) { return String(c.id).toLowerCase() === slug; })) return; // already present
      arr.push({ id: slug, label: titleSlug(slug) });
      commitCats(arr);
      if (window.showToast) showToast('Added “' + titleSlug(slug) + '” to your shop.');
    },
    // Enter inline rename for a category row.
    editCat: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      V2.catEditId = id;
      mountShop();
      var el = document.getElementById('wv2CatLabel-' + id);
      if (el) { el.focus(); el.select && el.select(); }
    },
    cancelCatEdit: function () { V2.catEditId = null; mountShop(); },
    // Save a renamed label (slug unchanged — parity with V1: we do NOT remap slugs
    // this PR so existing products stay filed under the same id).
    saveCatLabel: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      var el = document.getElementById('wv2CatLabel-' + id);
      var label = (el && el.value || '').trim();
      if (!label) { if (window.showToast) showToast('Category name can’t be empty.', true); return; }
      var arr = catsWorking();
      var row = arr.filter(function (c) { return c.id === id; })[0];
      if (!row) return;
      row.label = label;
      V2.catEditId = null;
      commitCats(arr);
    },
    // Toggle the row-level "More" disclosure (wholesaleGroup). Editing the field
    // commits on blur (wired by an inline change handler below).
    toggleCatMore: function (id) {
      V2.catMore[id] = !V2.catMore[id];
      mountShop();
      if (V2.catMore[id]) {
        var el = document.getElementById('wv2CatWholesale-' + id);
        if (el) {
          el.addEventListener('change', function () {
            var arr = catsWorking();
            var row = arr.filter(function (c) { return c.id === id; })[0];
            if (!row) return;
            var v = (el.value || '').trim();
            if (v) row.wholesaleGroup = v; else delete row.wholesaleGroup;
            commitCats(arr);
          });
        }
      }
    },
    // Reorder a category up/down — read-modify-write the whole array (instant).
    moveCat: function (id, dir) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      var arr = catsWorking();
      var i = -1; arr.forEach(function (c, k) { if (c.id === id) i = k; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= arr.length) return;
      arr.splice(j, 0, arr.splice(i, 1)[0]);
      commitCats(arr);
    },
    // Delete a category — but first WARN with the product count if any products are
    // filed under its slug (read-only check). Removes the whole-array entry on
    // confirm and commits through the bridge.
    deleteCat: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      var arr = catsWorking();
      var row = arr.filter(function (c) { return c.id === id; })[0];
      if (!row) return;
      var count = (V2.productCatCounts && V2.productCatCounts[String(id).toLowerCase()]) || 0;
      var doDelete = function () {
        var next = arr.filter(function (c) { return c.id !== id; });
        commitCats(next);
        if (window.showToast) showToast('Category “' + row.label + '” deleted.');
      };
      var msg = count > 0
        ? count + ' product' + (count === 1 ? ' is' : 's are') + ' in “' + row.label + '”. Those products stay, but lose this category. Remove it anyway?'
        : 'Delete the “' + row.label + '” category? It will be removed from your shop filter pills.';
      if (typeof window.showConfirmDialog === 'function') {
        window.showConfirmDialog('Delete category', msg, doDelete, { confirmLabel: 'Delete', cancelLabel: 'Keep' });
      } else if (typeof window.mastConfirm === 'function') {
        window.mastConfirm(msg, { title: 'Delete category', confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true })
          .then(function (ok) { if (ok) doDelete(); });
      } else { doDelete(); }
    },
    // The ONE retained classic hatch in the whole builder: deep-link the legacy
    // website route to its Import tab (the async catalog-import subsystem is NOT
    // rebuilt natively — it lives behind this single door). navigateToClassic
    // bypasses the V2 remap so it lands on the legacy Import surface, not the twin.
    openImport: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('website', { tab: 'import' });
      else if (typeof navigateTo === 'function') navigateTo('website', { tab: 'import' });
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
      Promise.resolve(MastDB.get('public/config/nav/logoUrl')).catch(function () { return null; }),
      // Card 2 (Your words & pictures) reads: per-section enabled states live
      // under nav/sections (mirrored on webPresence sections); the persisted
      // homepage section order lives under sectionOrder. Both guarded/cold-safe.
      Promise.resolve(MastDB.get('public/config/nav/sections')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/config/sectionOrder')).catch(function () { return null; }),
      // Card 3 (Your shop) read: storefront categories (plain ARRAY at
      // public/config/categories). Guarded/cold-safe; normalized in getCategories
      // when the bridge is present, else this raw read is filtered below.
      Promise.resolve(MastDB.get('public/config/categories')).catch(function () { return null; })
    ]).then(function (r) {
      var wp = r[0];
      V2.wp = wp || {};
      V2.meta = (wp && wp.meta) || {};
      V2.status = (wp && wp.status) || 'draft';
      V2.theme = r[1] || {};
      V2.brand = r[2] || {};
      V2.logo = r[3] || {};
      V2.legacyLogoUrl = r[4] || null;
      V2.nav = r[5] || {};                                  // section enabled states
      V2.sectionOrder = Array.isArray(r[6]) ? r[6] : null;  // persisted order (else manifest/list order)
      // Card 3 (Your shop): categories. Read through WebsiteBridge.getCategories
      // (the single-sourced read; normalizes RTDB object→array + filters to valid
      // {id,label}). If the bridge isn't loaded yet, fall back to a guarded direct
      // read so the card still paints; the bridge warms via ensureHostModules.
      V2.cats = Array.isArray(r[7]) ? r[7].filter(function (c) { return c && c.id && c.label; }) : [];
      V2.loaded = true;
      render();
      // Products power the delete-safety count + stray-category suggestions; read
      // them cold-safe AFTER the first paint (never blocks the card) and re-mount
      // Card 3 once counts land.
      loadProductCats();
    }).catch(function (e) { console.error('[website-v2] load', e); V2.loaded = true; render(); });
  }

  // Read products defensively (cold-safe) and tally how many sit under each
  // category slug — a product files via `category` (string slug) or `categories`
  // (array of slugs). Powers the delete-safety warning + the product-derived
  // "stray category" suggestion chips. Never throws; on any failure the counts
  // stay null and the card degrades gracefully (no warning count, no chips).
  function loadProductCats() {
    try {
      if (!window.MastDB || !MastDB.products || typeof MastDB.products.list !== 'function') return;
      Promise.resolve(MastDB.products.list()).then(function (res) {
        var arr = Array.isArray(res) ? res : Object.values(res || {});
        var counts = {};
        arr.forEach(function (p) {
          var slugs = productCatSlugs(p);
          slugs.forEach(function (s) { if (s) counts[s] = (counts[s] || 0) + 1; });
        });
        V2.productCatCounts = counts;
        V2.suggestions = computeSuggestions(counts);
        mountShop();
      }).catch(function (e) { console.warn('[website-v2] product cats', e && e.message); });
    } catch (e) { console.warn('[website-v2] product cats', e && e.message); }
  }
  // The category slugs a product is filed under (deduped). Tolerant of either the
  // singular `category` (which in the live data holds the LABEL, e.g. "Home
  // Decor") or the plural `categories` array (which holds slug ids, e.g.
  // "home-decor"). Both forms are normalized through the same slugify the category
  // ids use, so a label and its slug collapse to one key that matches the cat.id.
  function catSlugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function productCatSlugs(p) {
    if (!p) return [];
    var out = {};
    if (p.category) out[catSlugify(p.category)] = 1;
    if (Array.isArray(p.categories)) p.categories.forEach(function (c) { if (c) out[catSlugify(c)] = 1; });
    delete out['']; // drop empties
    return Object.keys(out);
  }
  // Slugs that appear on products but are NOT yet in the categories list →
  // one-tap "Add" suggestions. The chip label title-cases the slug (the product
  // carries only the slug, not a friendly label).
  function computeSuggestions(counts) {
    var have = {}; (V2.cats || []).forEach(function (c) { have[String(c.id).toLowerCase()] = 1; });
    var sug = [];
    Object.keys(counts || {}).forEach(function (slug) {
      if (slug === 'shop') return;           // 'shop' is the storefront header, not a real category
      if (!have[slug]) sug.push({ slug: slug, count: counts[slug] });
    });
    sug.sort(function (a, b) { return b.count - a.count; });
    return sug;
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
