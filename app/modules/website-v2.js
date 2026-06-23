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
 * The legacy homepage-v2.js / brand-v2.js are NOT touched here — they stay as the
 * fallback behind the "Advanced (classic)" door until their surface is absorbed.
 * (website.js itself has since been RETIRED — T6 rip-and-replace PR3 — see below.)
 *
 * Cold-safe: every config read is lazy + guarded (Promise.resolve(...).catch),
 * so the route boots correctly even as the FIRST route visited (no assumption that
 * another route warmed a cache). After the website.js rip-and-replace (T6 PR3)
 * this builder owns the bare #website route for ALL users — un-gated, no longer
 * flag-gated or side-by-side with a legacy fallback (which is now deleted).
 *
 * RBAC: editing the live site is gated via can('homepage','edit') — the same area
 * homepage-v2 uses (brand writes will later route through BrandBridge under the
 * brand area). This shell does no MastDB writes yet; canEdit() is wired now so the
 * card PRs inherit the gate and the RBAC lint stays satisfied.
 */
(function () {
  'use strict';
  // T6 rip-and-replace PR3: website.js (V1) is RETIRED and this builder now owns
  // the bare #website route directly (manifest routes: ['website-v2','website']),
  // so it must render for ALL users — the old `if (!flagOn()) return;` flag gate
  // is dropped (rma-admin/team-v2 precedent). Keeping it would blank-screen an
  // explicit-Legacy user at #website now that the legacy fallback is deleted.
  if (!window.MastAdmin || !window.MastUI) return;

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
    // Card 2 (Your words & pictures): featured testimonials map (public/testimonials);
    // the builder toggles per-entry homepage visibility only (add/remove = CS › Reviews).
    testimonials: null,
    // Card 1 (Look & feel) · the "Looks" gallery — the full template registry
    // (WebsiteBridge.getTemplates). null until loaded (loaded lazily after the
    // first paint via loadLooks, like productCatCounts). switchBusy guards the
    // double-tap during the migration cascade; lastUndo holds the pre-switch
    // snapshot so the inline Undo affordance can restore it.
    looks: null, switchBusy: false, lastUndo: null,
    // Card 3 (Your shop): the live storefront categories array (each
    // { id, label, wholesaleGroup? }) + a per-slug product count (for the
    // delete-safety warning + product-derived "stray category" suggestions).
    cats: null, productCatCounts: null, productsByCat: null, suggestions: null,
    // Card 4 (See it live & share): the live-preview iframe. previewVP is the
    // active viewport (desktop/tablet/mobile); previewNonce is bumped on each
    // reload to force the iframe to refetch (the storefront-side ?mastpreview=1
    // param skips its own localStorage cache so the refetch shows fresh config).
    previewVP: 'desktop', previewNonce: 0 };

  // Card 2 · which section ids expose a layout VARIANT picker (closing
  // homepage-v2's variant hatch). The picker options + manifest defaults come
  // from HomepageBridge.getThemeOptions().variants/variantDefaults; the key the
  // theme write uses mirrors homepage.js renderVariantPicker (product-grid →
  // productGridVariant, otherwise <id>Variant).
  function variantKeyFor(secId) { return secId === 'product-grid' ? 'productGridVariant' : secId + 'Variant'; }

  // Card 2 · which section ids render storefront gallery images — these get the
  // native "Edit images" slide-out. Static mirror of homepage.js
  // IMAGE_CAPABLE_SECTIONS; secHasImages() prefers the bridge's isCapable (which
  // also covers dynamic shop-category sections) and falls back to this list.
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
  // Card 4 · the iframe preview URL: the live site with ?mastpreview=1 (the
  // storefront honors this to skip its localStorage cache + force light mode so
  // edits — including colors — reflect within ~1s). A cache-busting _pv nonce on
  // each reload makes the browser refetch the document; the storefront-side param
  // handles its OWN cache. Empty string if the live host is unknown (no iframe).
  function previewUrl() {
    var base = liveUrl();
    if (!base) return '';
    return base + '/?mastpreview=1&_pv=' + V2.previewNonce;
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
      // Tier-1 live reflect: nudge the Card 4 preview iframe to refetch (debounced)
      // so the edit shows in the live preview within ~1s. Centralized here so every
      // card write inherits it. Skipped only when an opt opts out (opts.preview false).
      if (opts.preview !== false) schedulePreviewReload();
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

  // ── Looks gallery ───────────────────────────────────────────────────
  // The high-level entry to Card 1: a swatchGrid of every template ("Look").
  // Each tile shows the Look's name + a thumbnail/mini-preview (its bundled
  // palette swatches when no thumbnail), and the CURRENT Look is checked.
  // Tapping a DIFFERENT Look runs the migration cascade (friendly confirm +
  // Undo, all in WebsiteV2.pickLook); the current Look is a no-op tap. The
  // template list comes from WebsiteBridge.getTemplates() (the legacy registry).
  function looksSection() {
    var looks = V2.looks;
    if (looks == null) {
      return '<div id="wv2LooksGrid"><div class="mu-sub">Loading your Looks…</div></div>';
    }
    if (!looks.length) {
      return '<div id="wv2LooksGrid"><div class="mu-sub">No Looks available yet — your template library will appear here.</div></div>';
    }
    var currentId = (V2.theme && V2.theme.templateId) || (looks.filter(function (l) { return l.current; })[0] || {}).id || '';
    var items = looks.map(function (l) {
      return { value: l.id, label: l.name || l.id, _look: l };
    });
    var grid = U.swatchGrid({
      items: items, selected: currentId, onSelectFnName: 'wv2PickLook',
      renderItem: function (it) {
        var l = it._look || {};
        var thumb;
        if (l.thumbnail) {
          // background-image is DATA (the manifest's own preview URL), painted
          // inline on the tile — not baked into the stylesheet.
          thumb = '<span class="wv2-look-thumb" style="background-image:url(' + esc(l.thumbnail) + ');"></span>';
        } else {
          // No thumbnail → paint the Look's bundled palette as a mini-preview.
          var c = l.schemeColors || {};
          thumb = '<span class="wv2-look-thumb wv2-look-thumb-mini">' +
            '<span class="wv2-look-band" style="background:' + esc(c.bgColor || 'var(--surface-card)') + ';"></span>' +
            '<span class="wv2-look-band" style="background:' + esc(c.primaryColor || 'var(--text-primary)') + ';"></span>' +
            '<span class="wv2-look-band" style="background:' + esc(c.accentColor || 'var(--warm-gray)') + ';"></span>' +
            '</span>';
        }
        return thumb + '<span class="wv2-look-name mu-sw-label">' + esc(l.name || l.id) + '</span>';
      }
    });
    var undo = V2.lastUndo
      ? '<div class="wv2-undo" id="wv2LooksUndo">' +
          '<span class="wv2-undo-msg">Switched to <strong>' + esc(V2.lastUndo.toName || 'your new Look') + '</strong>.' +
          (V2.lastUndo.caveat ? ' <span class="wv2-undo-caveat">' + esc(V2.lastUndo.caveat) + '</span>' : '') + '</span>' +
          '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.undoLook()">Undo</button>' +
        '</div>'
      : '';
    return '<div id="wv2LooksGrid">' +
      '<div class="mu-sub" style="margin-bottom:8px;">Pick a Look to set your whole site’s layout, colors, and fonts at once. Fine-tune below.</div>' +
      grid + undo + '</div>';
  }
  // Re-render only the Looks grid (after a switch / undo) so the rest of Card 1
  // (scheme/font/logo) doesn't rebuild + lose focus.
  function refreshLooksGrid() {
    var host = document.getElementById('wv2LooksGrid');
    if (host) host.outerHTML = looksSection();
  }

  // Friendly switch confirm — NOT the legacy keep/lose-sections dialog. Plain
  // language: text + products stay; N gallery images fit the new layout, M get
  // hidden (not deleted — reversible). [Apply Look] / [Cancel]. Apply →
  // doLookSwitch. preview = WebsiteBridge.previewSwitch(...) result.
  function showLookSwitchConfirm(look, preview) {
    var keep = preview.keepCount || 0;
    var hide = preview.hideCount || 0;
    var restore = preview.restoreCount || 0;
    var total = preview.totalImages || 0;
    // plain-language gallery line(s)
    var galleryLines = '';
    if (total === 0) {
      galleryLines = '<li>You have no gallery images yet — nothing to move.</li>';
    } else {
      galleryLines += '<li><strong>' + keep + '</strong> gallery image' + (keep === 1 ? '' : 's') + ' fit the new layout and stay visible.</li>';
      if (hide > 0) {
        galleryLines += '<li><strong>' + hide + '</strong> image' + (hide === 1 ? '' : 's') + ' won’t fit the new layout, so ' +
          (hide === 1 ? 'it' : 'they') + '’ll be <strong>hidden</strong> — not deleted, and you can switch back to bring ' +
          (hide === 1 ? 'it' : 'them') + ' right back.</li>';
      }
      if (restore > 0) {
        galleryLines += '<li><strong>' + restore + '</strong> previously hidden image' + (restore === 1 ? '' : 's') +
          ' will reappear in this Look.</li>';
      }
    }
    var body =
      '<div class="wv2-lookdlg-lead">Switch to <strong>' + esc(look.name || look.id) + '</strong>?</div>' +
      (preview.description ? '<div class="wv2-lookdlg-desc">' + esc(preview.description) + '</div>' : '') +
      '<ul class="wv2-lookdlg-list">' +
        '<li>Your text, products, and shop settings stay exactly as they are.</li>' +
        '<li>Colors and fonts switch to this Look’s defaults (you can fine-tune them after).</li>' +
        galleryLines +
      '</ul>';
    // Stash the chosen Look so the modal's Apply button (a stable inline
    // handler) can run the switch without serializing the Look into the DOM.
    V2.pendingLook = look;
    var html = '<div class="wv2-lookdlg">' +
      '<div class="wv2-modal-title">Switch your Look</div>' +
      '<div class="wv2-modal-body">' + body + '</div>' +
      '<div class="wv2-modal-actions">' +
        '<button type="button" class="btn btn-secondary" onclick="WebsiteV2.cancelLook()">Cancel</button>' +
        '<button type="button" class="btn btn-primary" onclick="WebsiteV2.applyLook()">Apply Look</button>' +
      '</div></div>';
    if (typeof window.openModal === 'function') openModal(html);
    else doLookSwitch(look); // last-resort: no modal shell available
  }

  // Run the switch: snapshot (for Undo) → delegate the full cascade to
  // WebsiteBridge.switchTemplate (legacy wpConfirmSwitch). On success, stash the
  // snapshot so the inline Undo can restore it, push the new scheme/font to the
  // live preview, and re-read. NEVER reimplements the cascade — this only
  // orchestrates snapshot → switch → Undo + preview nudge.
  function doLookSwitch(look) {
    if (V2.switchBusy) return;
    V2.switchBusy = true;
    refreshLooksGrid();
    pipSaving();
    // 1) snapshot the pre-switch theme + gallery-hidden state (stage-before-commit)
    Promise.resolve(window.WebsiteBridge.captureThemeState()).then(function (snapshot) {
      // 2) delegate the entire cascade (theme reset + gallery migration + markUnpublished)
      return Promise.resolve(window.WebsiteBridge.switchTemplate(look.id)).then(function () {
        return snapshot;
      });
    }).then(function (snapshot) {
      V2.switchBusy = false;
      // 3) Tier-2 instant preview: push the Look's default scheme + font so the
      //    live preview repaints immediately (the canonical writes already
      //    happened inside switchTemplate). Scheme delta clears custom colors.
      var delta = {};
      if (look.defaultSchemeId) { delta.colorSchemeId = look.defaultSchemeId; delta.primaryColor = null; delta.accentColor = null; }
      if (look.defaultFontId) delta.fontPair = look.defaultFontId;
      if (Object.keys(delta).length) wv2PostTheme(delta);
      schedulePreviewReload();
      // 4) stash the Undo snapshot + show the inline Undo affordance
      V2.lastUndo = { snapshot: snapshot, toName: look.name || look.id, caveat: '' };
      pipSaved();
      if (window.showToast) showToast('Your site now uses the ' + (look.name || look.id) + ' Look.');
      // 5) re-read (updates the "current" flag → checks the new tile) + repaint Card 1
      loadLooks();
      reloadSoon();
    }).catch(function (e) {
      V2.switchBusy = false;
      pipSaved();
      console.error('[website-v2] switchTemplate', e);
      if (window.showToast) showToast('Couldn’t switch Look: ' + (e && e.message || e), true);
      refreshLooksGrid();
    });
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

  // Logo variants + brand voice (name / tagline). Each logo (primary + light /
  // dark / transparent for contrasting backgrounds) is a compact tile with
  // library/upload, instant-apply through BrandBridge.setLogoFromUrl(key) /
  // deleteVariant(key). Name + tagline bound instant to MastBrandSync.
  var LOGO_TILES = [
    { key: 'primary', label: 'Primary', desc: 'Your main logo', bg: 'card' },
    { key: 'light', label: 'Light', desc: 'For dark backgrounds', bg: 'dark' },
    { key: 'dark', label: 'Dark', desc: 'For light backgrounds', bg: 'light' },
    { key: 'transparent', label: 'Transparent', desc: 'No background', bg: 'check' }
  ];
  function logoVoiceSection() {
    var b = V2.brand || {};
    var logo = V2.logo || {};
    var variants = logo.variants || {};
    function urlFor(key) {
      if (key === 'primary') return (logo.primary && logo.primary.url) || V2.legacyLogoUrl || '';
      return (variants[key] && variants[key].url) || '';
    }
    var tiles = LOGO_TILES.map(function (t) {
      var url = urlFor(t.key);
      var prev = url
        ? '<div class="wv2-logo-tile-prev bg-' + t.bg + '"><img src="' + esc(url) + '" alt=""></div>'
        : '<div class="wv2-logo-tile-prev bg-' + t.bg + ' empty"><span class="mu-sub">Not set</span></div>';
      var acts = '<div class="wv2-logo-tile-acts">' +
        '<button type="button" class="btn btn-secondary btn-small" title="From library" onclick="WebsiteV2.logoFromLibrary(\'' + t.key + '\')">📚</button>' +
        '<button type="button" class="btn btn-secondary btn-small" title="From computer" onclick="WebsiteV2.logoUpload(\'' + t.key + '\')">💻</button>' +
        ((t.key !== 'primary' && url) ? '<button type="button" class="btn btn-secondary btn-small" title="Remove" onclick="WebsiteV2.logoRemoveVariant(\'' + t.key + '\')">✕</button>' : '') +
        '</div>';
      return '<div class="wv2-logo-tile"><div class="wv2-logo-tile-head">' + esc(t.label) +
        '<span class="mu-sub">' + esc(t.desc) + '</span></div>' + prev + acts + '</div>';
    }).join('');
    var nameInput = '<input class="form-input" id="wv2BrandName" type="text" value="' + esc(b.name || '') + '" placeholder="Your business name" style="width:100%;">';
    var taglineInput = '<input class="form-input" id="wv2BrandTagline" type="text" maxlength="80" value="' + esc(b.tagline || '') + '" placeholder="A short phrase about what you make" style="width:100%;">';
    function fg(label, inner, hint) {
      return '<div class="form-group"><label class="form-label">' + esc(label) + '</label>' + inner +
        (hint ? '<div class="mu-sub" style="margin-top:2px;">' + esc(hint) + '</div>' : '') + '</div>';
    }
    return '<div class="wv2-logo-grid">' + tiles + '</div>' +
      '<div class="wv2-voice-grid" style="margin-top:14px;">' +
        fg('Business name', nameInput) +
        fg('Tagline', taglineInput, 'Shown in your browser tab title and link previews.') +
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
    return sub('Looks', looksSection()) +
      sub('Color scheme', colorSchemeSection() + customColorsSection()) +
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
            // Tier-2 instant preview: push just the edited custom color so the
            // preview repaints that token immediately (no scheme id → direct color).
            wv2PostTheme(update);
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
  // Guarded WebsiteBridge call — WebsiteBridge lives in the lazy website-core
  // (loaded on demand). If a write fires before it's ready, kick a load + toast and
  // reject so withSave surfaces it (never a silent no-op).
  function WebsiteBridgeCall(method) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (window.WebsiteBridge && typeof window.WebsiteBridge[method] === 'function') {
      return window.WebsiteBridge[method].apply(window.WebsiteBridge, args);
    }
    try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('website-core'); } catch (e) {}
    return Promise.reject(new Error('Site editor still loading — try again'));
  }

  // Write a chosen/uploaded logo URL through the single-source BrandBridge.
  // setLogoFromUrl (primary → MastBrandSync.setLogo + storefront placement
  // fan-out). Instant-apply with the pip; reloadSoon refreshes the preview.
  var LOGO_KEYS = { primary: 1, light: 1, dark: 1, transparent: 1 };
  function applyLogoUrl(url, key) {
    if (!url) return;
    key = LOGO_KEYS[key] ? key : 'primary';
    if (window.BrandBridge && typeof window.BrandBridge.setLogoFromUrl === 'function') {
      withSave(window.BrandBridge.setLogoFromUrl(key, url).then(function (ok) {
        if (!ok) throw new Error('logo write failed');
        return ok;
      }));
    } else {
      // BrandBridge is eager (absorbed into this file) — this branch is now
      // effectively unreachable; keep a toast rather than a silent no-op.
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

  // One section LIST row: the section name opens the record; On/Off + reorder
  // stay inline (list-level affordances). No inline expand — editing happens in
  // the standard slide-out record (sectionDetailHtml below).
  function wordsRow(sec, idx, total) {
    var ed = canEdit();
    var on = sectionEnabled(sec.id, sec.required);
    var sid = esc(sec.id);
    var pill = '<span class="wv2-sec-pill ' + (on ? 'on' : 'off') + '">' + (on ? 'On' : 'Off') + '</span>';
    var upDis = idx === 0 ? ' disabled' : '';
    var dnDis = idx === total - 1 ? ' disabled' : '';
    var reorder = ed
      ? '<span class="wv2-sec-move">' +
          '<button type="button" class="wv2-mv"' + upDis + ' title="Move up" onclick="event.stopPropagation();WebsiteV2.moveSection(\'' + sid + '\',-1)">▲</button>' +
          '<button type="button" class="wv2-mv"' + dnDis + ' title="Move down" onclick="event.stopPropagation();WebsiteV2.moveSection(\'' + sid + '\',1)">▼</button>' +
        '</span>'
      : '';
    var toggle = ed
      ? (sec.required
          ? '<span class="mu-sub">Always on</span>'
          : '<button type="button" class="wv2-sec-toggle" onclick="event.stopPropagation();WebsiteV2.toggleSection(\'' + sid + '\',' + (on ? 'false' : 'true') + ')">' + (on ? 'Turn off' : 'Turn on') + '</button>')
      : '';
    var open = ed ? 'WebsiteV2.openSection(\'' + sid + '\')' : '';
    // photo-count badge (parity with the legacy section card's image badge).
    var b = window.HomepageBridge;
    var nImg = (b && b.images && b.images.isCapable && b.images.isCapable(sec.id) && b.images.count) ? b.images.count(sec.id) : 0;
    var badge = nImg > 0 ? '<span class="wv2-sec-count">' + nImg + ' photo' + (nImg === 1 ? '' : 's') + '</span>' : '';
    return '<div class="wv2-sec-row"' + (ed ? ' role="button" tabindex="0" onclick="' + open + '" onkeydown="if(event.key===\'Enter\'){' + open + '}"' : '') + '>' +
        '<div class="wv2-sec-id"><span class="wv2-sec-name">' + esc(sec.label || sec.id) + '</span> ' + pill + badge + '</div>' +
        '<div class="wv2-sec-actions">' + reorder + toggle + (ed ? '<span class="wv2-sec-go">Edit ›</span>' : '') + '</div>' +
      '</div>';
  }

  // Build a section record from the live caches — the entity fetch + openSection
  // both use this so the record always reflects current config.
  function sectionRecord(id) {
    var b = window.HomepageBridge;
    var list = (b && b.getSectionList && b.getSectionList()) || [];
    var sec = list.find(function (s) { return s.id === id; });
    if (!sec) return null;
    var opts = themeOptions();
    var variants = (opts.variants && opts.variants[id]) || null;
    var vkey = variantKeyFor(id);
    var vsel = ((V2.theme || {})[vkey]) || (opts.variantDefaults && opts.variantDefaults[id]) || (variants && variants[0] && variants[0].id) || '';
    return {
      id: id, _title: sec.label || id, label: sec.label || id, required: !!sec.required,
      enabled: sectionEnabled(id, sec.required),
      fields: (wordsFields()[id] || []), data: sectionData(id), isContact: id === 'contact',
      hasImages: secHasImages(id),
      imageCount: (b && b.images && b.images.count) ? b.images.count(id) : 0,
      fieldImageDefs: (b && b.images && b.images.fieldDefs) ? b.images.fieldDefs(id) : [],
      variants: variants, variantKey: vkey, variantSelected: vsel
    };
  }

  // The section record INTERIOR — composed entirely from MastUI primitives, so it
  // carries the same shell as every other record: sticky head (status/photo/layout
  // tiles) + Content / Photos / Layout tabs + cards. No bespoke layout.
  function sectionDetailHtml(UU, r) {
    var ed = canEdit();
    var contentFields = (r.fields || []).filter(function (f) { return f.type !== 'image'; });
    var hasPhotos = r.hasImages || (r.fieldImageDefs && r.fieldImageDefs.length);
    var hasLayout = r.variants && r.variants.length;
    var tabs = [{ key: 'content', label: 'Content' }];
    if (hasPhotos) tabs.push({ key: 'photos', label: 'Photos' });
    if (hasLayout) tabs.push({ key: 'layout', label: 'Layout' });
    var active = 'content';
    var tiles = [{ k: 'Status', v: r.enabled ? '<span style="color:var(--success);">On</span>' : '<span class="mu-sub">Off</span>' }];
    if (r.hasImages) tiles.push({ k: 'Photos', v: String(r.imageCount) });
    if (hasLayout) { var vl = (r.variants.find(function (v) { return v.id === r.variantSelected; }) || {}).label; tiles.push({ k: 'Layout', v: esc(vl || r.variantSelected || '—') }); }
    var out = UU.stickyHead(UU.tiles(tiles), UU.paneTabsBar(tabs, active));
    out += secPane('content', active, contentPaneHtml(UU, r, ed, contentFields));
    if (hasPhotos) out += secPane('photos', active, photosPaneHtml(UU, r, ed));
    if (hasLayout) out += secPane('layout', active, UU.card('Layout', ed ? layoutInnerHtml(r) : '<span class="mu-sub">Read only.</span>'));
    return out;
  }
  function secPane(key, active, inner) { return '<div class="mu-pane" data-pane="' + key + '"' + (key === active ? '' : ' hidden') + '>' + inner + '</div>'; }

  // Content pane: instant-apply text fields (+ social for contact), inside cards.
  function contentPaneHtml(UU, r, ed, fields) {
    if (!ed) return UU.card('Content', '<span class="mu-sub">You do not have permission to edit this section.</span>');
    var inner = fields.length ? fields.map(function (f) { return fieldRowHtml(r.id, f, r.data); }).join('') : '<span class="mu-sub">No text content for this section.</span>';
    var out = UU.card('Text', inner);
    if (r.isContact) out += UU.card('Social links', socialInnerHtml(r));
    return out;
  }
  // One instant-apply field row. Inline handlers write through
  // WebsiteV2.contentInput → hpUpdateField (self-debounced).
  function fieldRowHtml(secId, f, data) {
    var val = data[f.id] !== undefined ? data[f.id] : '';
    var sid = esc(secId), fid = esc(f.id);
    var ctl;
    if (f.type === 'textarea') ctl = '<textarea class="form-input" rows="4" style="width:100%;resize:vertical;" oninput="WebsiteV2.contentInput(\'' + sid + '\',\'' + fid + '\',\'textarea\',this.value)">' + esc(String(val)) + '</textarea>';
    else if (f.type === 'number') ctl = '<input class="form-input" type="number" style="width:100%;" value="' + esc(String(val)) + '" oninput="WebsiteV2.contentInput(\'' + sid + '\',\'' + fid + '\',\'number\',this.value)">';
    else if (f.type === 'select') ctl = '<select class="form-input" style="width:100%;" onchange="WebsiteV2.contentInput(\'' + sid + '\',\'' + fid + '\',\'select\',this.value)">' + (f.options || []).map(function (o) { var ov = o.v != null ? o.v : o.value, ol = o.l != null ? o.l : o.label; return '<option value="' + esc(ov) + '"' + (String(val) === String(ov) ? ' selected' : '') + '>' + esc(ol) + '</option>'; }).join('') + '</select>';
    else if (f.type === 'toggle') ctl = '<label class="toggle-switch"><input type="checkbox"' + (val ? ' checked' : '') + ' onchange="WebsiteV2.contentInput(\'' + sid + '\',\'' + fid + '\',\'toggle\',this.checked)"><span class="toggle-slider"></span></label>';
    else ctl = '<input class="form-input" type="text" style="width:100%;" value="' + esc(String(val)) + '" oninput="WebsiteV2.contentInput(\'' + sid + '\',\'' + fid + '\',\'text\',this.value)">';
    return '<div class="form-group"><label class="form-label">' + esc(f.label) + '</label>' + ctl + '</div>';
  }
  function socialInnerHtml(r) {
    var links = (r.data && r.data.socialLinks) || {};
    return '<div class="wv2-social-grid">' + SOCIAL_PLATFORMS.map(function (p) {
      return '<div class="form-group"><label class="form-label">' + esc(titleCase(p)) + '</label>' +
        '<input class="form-input" type="url" value="' + esc(links[p] || '') + '" placeholder="https://" style="width:100%;" oninput="WebsiteV2.socialInput(\'' + esc(p) + '\',this.value)"></div>';
    }).join('') + '</div>';
  }
  // Layout pane inner: the manifest variant options as a MastUI swatchGrid.
  function layoutInnerHtml(r) {
    var items = (r.variants || []).map(function (v) { return { value: v.id, label: v.label || v.id, _desc: v.desc || '' }; });
    var grid = U.swatchGrid({
      items: items, selected: r.variantSelected, onSelectFnName: 'wv2PickVariant', idKey: 'value',
      renderItem: function (it) { return '<span class="wv2-var-name">' + esc(it.label) + '</span>' + (it._desc ? '<span class="wv2-var-desc mu-sw-label">' + esc(it._desc) + '</span>' : ''); }
    });
    var forwarder = 'wv2PickVariant_' + r.id.replace(/-/g, '_');
    grid = grid.replace(/data-sw="wv2PickVariant"/g, 'data-sw="' + forwarder + '"');
    window[forwarder] = (function (sid) { return function (variantId) { WebsiteV2.pickVariant(sid, variantId); }; })(r.id);
    return grid;
  }
  // The Photos pane = (about) feature-image field card(s) + the inline photo
  // MANAGER (add bar + grid + selected-photo editor, mounted in #wv2PhotosMgr,
  // filled async by fillPhotosManager) + (hero) the slideshow-speed slider.
  function photosPaneHtml(UU, r, ed) {
    var out = '';
    (r.fieldImageDefs || []).forEach(function (f) { out += featureImageCardHtml(UU, r, f, ed); });
    if (r.hasImages) {
      out += '<div id="wv2PhotosMgr"><div class="mu-sub" style="padding:8px 0;">Loading photos…</div></div>';
    }
    if (r.id === 'hero' && ed) {
      out += UU.card('Slideshow', '<div class="form-group"><label class="form-label">How long each photo shows</label>' +
        '<input type="range" id="heroRotationSlider" min="2" max="20" step="1" value="6" style="width:100%;accent-color:var(--teal,var(--amber));" oninput="WebsiteV2.heroRotationInput(this.value)" onchange="WebsiteV2.heroRotationCommit(this.value)">' +
        '<div class="mu-sub" id="heroRotationLabel" style="margin-top:4px;">Each photo shows for 6 seconds</div></div>');
    }
    return out;
  }
  // Fetch the section's photos + categories, render the inline manager into
  // #wv2PhotosMgr, refresh the Photos count tile, and (hero) load the slider.
  // Called on every section render (open / tab-switch / Back) and after any
  // photo mutation. Caches items+cats so thumbnail selection is instant.
  function fillPhotosManager(secId) {
    if (secId === 'hero') loadHeroRotation();
    if (!document.getElementById('wv2PhotosMgr')) return;
    var b = window.HomepageBridge; if (!b || !b.images || !b.images.list) return;
    Promise.all([b.images.list(secId), photosCategories()]).then(function (res) {
      var items = res[0], cats = res[1] || [];
      var mount = document.getElementById('wv2PhotosMgr'); if (!mount) return;
      var ids = items.map(function (e) { return e[0]; });
      var visIds = items.filter(function (e) { return e[1].visible !== false; }).map(function (e) { return e[0]; });
      // keep the current focus if still present, else default to the first
      // VISIBLE photo (don't open the editor on a hidden one).
      var focus = (WV2_PHOTOS.focus && ids.indexOf(WV2_PHOTOS.focus) !== -1) ? WV2_PHOTOS.focus : (visIds[0] || ids[0] || null);
      WV2_PHOTOS = { sec: secId, focus: focus, items: items, cats: cats, showHidden: !!WV2_PHOTOS.showHidden };
      mount.innerHTML = photosManagerHtml(secId, items, cats, focus, canEdit());
      updatePhotoCount(items.length);
    }).catch(function (e) { console.error('[website-v2] fillPhotosManager', e); });
  }
  // Re-render the manager from the cached items (no refetch) — used when picking
  // a thumbnail so selection is instant.
  function renderPhotosFromCache() {
    var mount = document.getElementById('wv2PhotosMgr'); if (!mount || !WV2_PHOTOS.items) return;
    mount.innerHTML = photosManagerHtml(WV2_PHOTOS.sec, WV2_PHOTOS.items, WV2_PHOTOS.cats || [], WV2_PHOTOS.focus, canEdit());
  }
  // Sync the sticky "Photos" tile to a fresh count (the stacked record is stale).
  function updatePhotoCount(n) {
    var body = document.getElementById('mastSlideOutBody'); if (!body) return;
    Array.prototype.forEach.call(body.querySelectorAll('.mu-tile'), function (t) {
      var k = t.querySelector('.mu-tk'), v = t.querySelector('.mu-tv');
      if (k && v && k.textContent === 'Photos') v.textContent = String(n);
    });
  }
  // The Photos card (add bar + bounded grid) + the Selected-photo editor card.
  // Hidden photos are kept OUT of the selectable grid by default — a "Show N
  // hidden photos" toggle reveals them (so you can still un-hide one).
  function photosManagerHtml(secId, items, cats, focus, ed) {
    var b = window.HomepageBridge;
    var tplHidden = (b && b.images && b.images.hiddenCount) ? b.images.hiddenCount(secId) : 0;
    var tplNote = tplHidden > 0 ? '<div class="mu-sub" style="margin-top:8px;">' + tplHidden + ' photo' + (tplHidden === 1 ? '' : 's') + ' hidden by a template switch.</div>' : '';
    var showHidden = !!WV2_PHOTOS.showHidden;
    var hiddenItems = items.filter(function (e) { return e[1].visible === false; });
    var displayItems = showHidden ? items : items.filter(function (e) { return e[1].visible !== false; });
    var displayIds = displayItems.map(function (e) { return e[0]; });
    // keep the editor's focus on something that's actually shown
    if (displayIds.indexOf(focus) === -1) focus = displayIds[0] || null;
    WV2_PHOTOS.focus = focus;
    var addBar = ed ? '<div class="wv2-photo-addbar">' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.imgdAdd(\'' + esc(secId) + '\')">📚 From library</button>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.imgdUpload(\'' + esc(secId) + '\')">💻 Upload</button>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.imgdPasteUrl(\'' + esc(secId) + '\')">🔗 Paste URL</button>' +
      '</div>' : '';
    var grid;
    if (!items.length) grid = '<div class="mu-sub" style="padding:14px 0;">No photos yet.' + (ed ? ' Add one above.' : '') + '</div>';
    else if (!displayItems.length) grid = '<div class="mu-sub" style="padding:14px 0;">All photos are hidden from your site.</div>';
    else grid = '<div class="wv2-photogrid">' + displayItems.map(function (e) {
        var k = e[0], d = e[1];
        var isVid = d.videoUrl || /\.(mp4|mov|webm)/i.test(d.url || '');
        return '<button type="button" class="wv2-phototile' + (k === focus ? ' on' : '') + (d.visible === false ? ' off' : '') + '" onclick="WebsiteV2.photoSelect(\'' + esc(k) + '\')" style="background-image:url(' + esc(d.url || '') + ');" title="' + esc(d.alt || d.caption || '') + '">' +
          (isVid ? '<span class="wv2-phototile-vid">▶</span>' : '') + '</button>';
      }).join('') + '</div>';
    var hiddenToggle = (ed && hiddenItems.length) ? '<div style="margin-top:10px;"><button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.photoToggleHidden()">' +
      (showHidden ? 'Hide hidden photos' : ('Show ' + hiddenItems.length + ' hidden photo' + (hiddenItems.length === 1 ? '' : 's'))) + '</button></div>' : '';
    var photosCard = U.card('Photos (' + items.length + ')', addBar + grid + hiddenToggle + tplNote);
    return photosCard + (focus ? photoSelectedCardHtml(secId, items, cats, focus, ed) : '');
  }
  // The "Selected photo" editor card: preview + alt/caption + the section's
  // conditional fields (imgMetaFieldsHtml) + reorder/visibility/remove actions.
  function photoSelectedCardHtml(secId, items, cats, focus, ed) {
    var entry = items.find(function (e) { return e[0] === focus; }) || items[0];
    var fid = entry[0], img = entry[1];
    var idx = items.findIndex(function (e) { return e[0] === fid; });
    var isVid = img.videoUrl || /\.(mp4|mov|webm)/i.test(img.url || '');
    var prev = isVid
      ? '<div class="wv2-photo-prev wv2-photo-prev-vid"><span>▶</span></div>'
      : '<div class="wv2-photo-prev" style="background-image:url(' + esc(img.url || '') + ');"></div>';
    if (!ed) return U.card('Selected photo', prev);
    var top = '<div class="wv2-photo-edit-top">' + prev +
      '<div class="wv2-photo-edit-fields">' +
        '<div class="form-group"><label class="form-label">Alt text</label><input class="form-input" type="text" style="width:100%;" value="' + esc(img.alt || '') + '" oninput="WebsiteV2.imgdMeta(\'' + esc(fid) + '\',\'alt\',this.value)"></div>' +
        '<div class="form-group"><label class="form-label">Caption</label><input class="form-input" type="text" style="width:100%;" value="' + esc(img.caption || '') + '" oninput="WebsiteV2.imgdMeta(\'' + esc(fid) + '\',\'caption\',this.value)"></div>' +
      '</div></div>';
    var actions = '<div class="wv2-photo-actions">' +
      '<button type="button" class="btn btn-secondary btn-small"' + (idx <= 0 ? ' disabled' : '') + ' onclick="WebsiteV2.imgdMove(\'' + esc(fid) + '\',\'up\')">← Earlier</button>' +
      '<button type="button" class="btn btn-secondary btn-small"' + (idx >= items.length - 1 ? ' disabled' : '') + ' onclick="WebsiteV2.imgdMove(\'' + esc(fid) + '\',\'down\')">Later →</button>' +
      '<button type="button" class="btn btn-secondary btn-small"' + (idx <= 0 ? ' disabled' : '') + ' onclick="WebsiteV2.imgdMakeFirst(\'' + esc(fid) + '\')">Make first</button>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.imgdToggleVis(\'' + esc(fid) + '\')">' + (img.visible === false ? 'Show on site' : 'Hide from site') + '</button>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.imgdRemove(\'' + esc(fid) + '\')">Remove</button>' +
      '</div>';
    return U.card(img.visible === false ? 'Selected photo · hidden' : 'Selected photo', top + imgMetaFieldsHtml(secId, cats, fid, img) + actions);
  }
  // Plain-language label for the hero slideshow slider.
  function heroRotationLabel(v) { return 'Each photo shows for ' + v + ' second' + (String(v) === '1' ? '' : 's'); }
  // Load the current hero rotation seconds into the slider + label (clamped to
  // the slider range; defaults to 6 when unset).
  function loadHeroRotation() {
    var sl = document.getElementById('heroRotationSlider'); if (!sl) return;
    Promise.resolve(MastDB.get('public/config/hero/rotationSeconds')).then(function (val) {
      var s = document.getElementById('heroRotationSlider'); if (!s) return;
      var n = parseInt(val, 10); if (!n || isNaN(n)) n = 6;
      n = Math.max(2, Math.min(20, n));
      s.value = String(n);
      var lbl = document.getElementById('heroRotationLabel'); if (lbl) lbl.textContent = heroRotationLabel(n);
    }).catch(function () {});
  }
  function featureImageCardHtml(UU, r, f, ed) {
    var val = (r.data && r.data[f.id]) || '';
    var sid = esc(r.id), fid = esc(f.id);
    var prev = val
      ? '<div class="wv2-imgcell wv2-imgcell-lg" style="background-image:url(' + esc(String(val)) + ');"></div>'
      : '<div class="wv2-imgcell wv2-imgcell-lg wv2-imgcell-empty"><span class="mu-sub">No image set</span></div>';
    var btns = ed ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.pickFieldImage(\'' + sid + '\',\'' + fid + '\')">📚 From library</button>' +
      '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.uploadFieldImage(\'' + sid + '\',\'' + fid + '\')">💻 Upload</button>' +
      (val ? '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.clearFieldImage(\'' + sid + '\',\'' + fid + '\')">Remove</button>' : '') +
      '</div>' : '';
    return UU.card(f.label || 'Image', prev + btns);
  }
  // Re-render ONE pane of the open section record in place (cornerstone
  // rerenderXPane pattern — never a full SO re-render, which bounces to tab 1).
  function rerenderSecPane(paneKey) {
    var id = WV2_SEC.id; if (!id) return;
    var body = document.getElementById('mastSlideOutBody'); if (!body) return;
    var paneEl = body.querySelector('.mu-pane[data-pane="' + paneKey + '"]'); if (!paneEl) return;
    var r = sectionRecord(id); if (!r) return;
    var ed = canEdit();
    if (paneKey === 'photos') { paneEl.innerHTML = photosPaneHtml(U, r, ed); setTimeout(function () { fillPhotosManager(id); }, 0); }
    else if (paneKey === 'layout') { paneEl.innerHTML = U.card('Layout', ed ? layoutInnerHtml(r) : '<span class="mu-sub">Read only.</span>'); }
  }

  // ── Card 2 · Section image editing ─────────────────────────────────
  // The Photos pane hosts the full photo manager inline (add bar + grid +
  // selected-photo editor); writes go through HomepageBridge.images, and the
  // single-image field (about.imageUrl) via HomepageBridge.images.setField.
  // The twin holds NO raw MastDB.gallery writes.

  // Which sections expose storefront images (bridge-aware → also dynamic shop
  // categories; falls back to the static mirror before the bridge warms).
  function secHasImages(secId) {
    var b = window.HomepageBridge;
    if (b && b.images && b.images.isCapable) { try { return b.images.isCapable(secId); } catch (e) {} }
    return IMAGE_SECTIONS.indexOf(secId) !== -1;
  }

  // Optimistically stash a single-image field value in the wp cache so the
  // photos pane reflects it before the re-read lands.
  function optimisticField(secId, fieldId, url) {
    if (!V2.wp) V2.wp = {};
    if (!V2.wp.sections) V2.wp.sections = {};
    if (!V2.wp.sections[secId]) V2.wp.sections[secId] = {};
    V2.wp.sections[secId][fieldId] = url;
  }

  // Upload a file from the user's computer to the shared image library via the
  // /uploadImage CF, then hand back the resulting URL. Mirrors logoUpload.
  function pickAndUploadImage(tags, onUrl) {
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
            return window.callCF('/uploadImage', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, body: JSON.stringify({ image: base64, tags: tags || [], source: 'website-section-image' }) });
          }).then(function (resp) { return resp.json(); }).then(function (result) {
            if (!result || !result.success) throw new Error((result && result.error) || 'Upload failed');
            var lib = window.imageLibrary || {}; var d = lib[result.imageId] || {};
            var url = d.url || result.url;
            if (!url) throw new Error('Upload returned no URL');
            onUrl(url);
          }).catch(function (err) { if (window.showToast) showToast('Upload failed: ' + (err && err.message ? err.message : 'error'), true); });
        } catch (err) { if (window.showToast) showToast('Upload failed.', true); }
      };
      reader.readAsDataURL(input.files[0]);
    };
    input.click();
  }

  // The open section record (id) — so a pane re-render can rebuild from the
  // current section. The image drill tracks its section + focused image.
  var WV2_SEC = { id: null };
  // The open photo manager's state: section + focused photo + cached items/cats
  // (so picking a thumbnail re-renders instantly, with no refetch).
  var WV2_PHOTOS = { sec: null, focus: null, items: null, cats: null, showHidden: false };
  var WV2_CATIMG = { cat: null, coverId: '' }; // the open category's cover-image doc
  var _imgdMetaT = {}; // debounce timers for per-photo metadata text inputs
  var _catDetailT = {}; // debounce timers for category Details inputs (name / wholesale)

  // Resolve the storefront categories for the per-photo Category field. Prefer
  // the twin's loaded list; else read the raw doc and normalize BOTH shapes (a
  // plain array OR the object-with-numeric-keys-plus-_v form some tenants store).
  function photosCategories() {
    if (V2.cats && V2.cats.length) return Promise.resolve(V2.cats.slice());
    return Promise.resolve(MastDB.get('public/config/categories')).then(function (raw) {
      if (!raw) return [];
      if (Array.isArray(raw)) return raw.filter(function (c) { return c && c.id; });
      return Object.keys(raw).filter(function (k) { return k !== '_v' && raw[k] && raw[k].id; })
        .map(function (k) { return { id: raw[k].id, label: raw[k].label || raw[k].name || raw[k].id }; });
    }).catch(function () { return []; });
  }
  // The conditional per-photo metadata fields, matching the legacy openImageModal:
  // category (gallery/shop), image fit (non-hero), hero video (url/speed/start/
  // end, grouped), product (shop, grouped). Instant-apply via WebsiteV2.imgdMeta.
  function imgMetaFieldsHtml(secId, cats, fid, img) {
    cats = cats || [];
    var f = esc(fid), out = '';
    var isHero = secId === 'hero';
    var showCategory = secId === 'gallery' || secId === 'shop';
    var shopIds = ['shop'].concat(cats.map(function (c) { return c.id; }));
    var showProduct = shopIds.indexOf(secId) !== -1;
    if (showCategory) {
      var copts = '<option value="">— none —</option>' + cats.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (img.category === c.id ? ' selected' : '') + '>' + esc(c.label || c.id) + '</option>';
      }).join('');
      out += '<div class="form-group"><label class="form-label">Category</label>' +
        '<select class="form-input" style="width:100%;" onchange="WebsiteV2.imgdMeta(\'' + f + '\',\'category\',this.value)">' + copts + '</select></div>';
    }
    if (isHero) {
      var sps = String(img.playbackSpeed || 1);
      var speeds = [['0.25', '0.25× (very slow)'], ['0.5', '0.5× (slow)'], ['0.75', '0.75×'], ['1', '1× (normal)'], ['1.25', '1.25×'], ['1.5', '1.5×'], ['2', '2× (fast)']];
      out += '<div class="wv2-photo-fgroup"><div class="wv2-sub-h">Background video</div>' +
        '<div class="form-group"><label class="form-label">Video URL</label><input class="form-input" type="text" style="width:100%;" value="' + esc(img.videoUrl || '') + '" placeholder="https://…video.mp4" oninput="WebsiteV2.imgdMeta(\'' + f + '\',\'videoUrl\',this.value)"></div>' +
        '<div class="wv2-photo-fgrid3">' +
          '<div class="form-group"><label class="form-label">Speed</label><select class="form-input" style="width:100%;" onchange="WebsiteV2.imgdMeta(\'' + f + '\',\'playbackSpeed\',this.value)">' + speeds.map(function (s) { return '<option value="' + s[0] + '"' + (sps === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select></div>' +
          '<div class="form-group"><label class="form-label">Start (s)</label><input class="form-input" type="number" min="0" step="0.5" style="width:100%;" value="' + (img.videoStart != null ? esc(String(img.videoStart)) : '') + '" placeholder="0" oninput="WebsiteV2.imgdMeta(\'' + f + '\',\'videoStart\',this.value)"></div>' +
          '<div class="form-group"><label class="form-label">End (s)</label><input class="form-input" type="number" min="0" step="0.5" style="width:100%;" value="' + (img.videoEnd != null ? esc(String(img.videoEnd)) : '') + '" placeholder="end" oninput="WebsiteV2.imgdMeta(\'' + f + '\',\'videoEnd\',this.value)"></div>' +
        '</div></div>';
    } else {
      out += '<div class="form-group"><label class="form-label">Image display</label>' +
        '<select class="form-input" style="width:100%;" onchange="WebsiteV2.imgdMeta(\'' + f + '\',\'imageFit\',this.value)">' +
        '<option value="contain"' + (img.imageFit !== 'cover' ? ' selected' : '') + '>Fit inside frame (no cropping)</option>' +
        '<option value="cover"' + (img.imageFit === 'cover' ? ' selected' : '') + '>Fill frame (may crop edges)</option>' +
        '</select></div>';
    }
    if (showProduct) {
      out += '<div class="wv2-photo-fgroup"><div class="wv2-sub-h">Product</div>' +
        '<div class="form-group"><label class="form-label">Product name</label><input class="form-input" type="text" style="width:100%;" value="' + esc(img.productName || '') + '" oninput="WebsiteV2.imgdMeta(\'' + f + '\',\'productName\',this.value)"></div>' +
        '<div class="form-group"><label class="form-label">Product link</label><input class="form-input" type="url" style="width:100%;" value="' + esc(img.productLink || '') + '" placeholder="https://…" oninput="WebsiteV2.imgdMeta(\'' + f + '\',\'productLink\',this.value)"></div>' +
        '<div class="form-group"><label class="form-label">Price</label><input class="form-input" type="text" style="width:100%;" value="' + esc(img.price || '') + '" placeholder="$45" oninput="WebsiteV2.imgdMeta(\'' + f + '\',\'price\',this.value)"></div></div>';
    }
    return out;
  }

  // Register the section + image-manager records on the engine. Both render via
  // MastUI primitives (no bespoke shell); opened from the Card 2 list / Photos
  // pane respectively. route:null → drill/open-only, never a top-level route.
  if (window.MastEntity && typeof MastEntity.define === 'function') {
    MastEntity.define('homepage-section-v2', {
      label: 'Section', labelPlural: 'Sections', size: 'lg', route: null,
      recordId: function (r) { return r.id; },
      fields: [{ name: '_title', label: 'Section', type: 'text', list: true, readOnly: true }],
      fetch: function (id) { return sectionRecord(id); },
      // Fill the inline photo manager after EVERY render (open, setMode, and any
      // re-render) so the Photos tab always shows the live grid + editor.
      detail: { render: function (UU, r) { WV2_SEC.id = r.id; setTimeout(function () { fillPhotosManager(r.id); }, 0); return sectionDetailHtml(UU, r); } }
    });
    // Shop CATEGORY record — Details / Photos / Products tabs. Opened from the
    // Card 3 list; Photos reuses the same inline manager (scoped to the category's
    // images); Products drills to the product record. route:null → open-only.
    MastEntity.define('shop-category-v2', {
      label: 'Category', labelPlural: 'Categories', size: 'lg', route: null,
      recordId: function (r) { return r.id; },
      fields: [{ name: '_title', label: 'Category', type: 'text', list: true, readOnly: true }],
      fetch: function (id) { return catRecord(id); },
      detail: { render: function (UU, r) { setTimeout(function () { fillCategoryImage(r.id); }, 0); return catDetailHtml(UU, r); } }
    });
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
    return wordsImportHtml() + sectionsHtml + wordsTestimonialsHtml();
  }

  // ── Featured testimonials (homepage visibility) ─────────────────────
  // Absorbed from homepage-v2's testimonials card. Add/remove a testimonial =
  // the Customer Service › Reviews "Feature on site" flow (that's the only place
  // that creates/deletes public/testimonials/{key}). Here the builder only TOGGLES
  // a featured entry's homepage VISIBILITY (show/hide WITHOUT un-featuring) — the
  // one capability with no other home. Single-sourced through the SAME legacy
  // writer the homepage page builder uses: window.hpToggleTestimonialVisible(key,
  // vis) → public/testimonials/{key}/visible (storefront filters visible !== false).
  function wordsTestimonialsHtml() {
    var data = V2.testimonials || {};
    var ed = canEdit();
    var all = Object.keys(data).map(function (k) {
      var t = data[k] || {};
      return { _key: k, quote: t.quote, author: t.customerName || t.author || t.authorName || '', visible: t.visible !== false, rating: t.rating || 0, productName: t.productName || '' };
    }).filter(function (t) { return t.quote; })
      .sort(function (a, b) { return (a._key < b._key ? 1 : -1); });
    // No featured testimonials yet → a single muted line that points at the only
    // surface that can add one (CS › Reviews). No empty toggle UI.
    if (!all.length) {
      return '<div class="wv2-testimonials">' +
        '<div class="wv2-sub-h" style="margin-top:18px;border-top:1px solid var(--border);padding-top:16px;">Featured testimonials</div>' +
        '<div class="mu-sub">No testimonials featured yet. Approve a review in Customer Service › Reviews and click “Feature on site” to add one here.</div>' +
        '</div>';
    }
    var visible = all.filter(function (t) { return t.visible; }).length;
    var rows = all.map(function (t) {
      var k = esc(t._key);
      var control = ed
        ? '<button type="button" class="wv2-sec-toggle" onclick="WebsiteV2.toggleTestimonial(\'' + k + '\',' + (t.visible ? 'false' : 'true') + ')">' + (t.visible ? 'Hide' : 'Show') + '</button>'
        : '<span class="wv2-sec-pill ' + (t.visible ? 'on' : 'off') + '">' + (t.visible ? 'Shown' : 'Hidden') + '</span>';
      var stars = (t.rating > 0) ? '<span class="wv2-test-stars" title="' + t.rating + ' of 5">' + '★'.repeat(Math.min(5, Math.round(t.rating))) + '</span>' : '';
      var meta = [t.author ? '— ' + t.author : '', t.productName ? 'on ' + t.productName : ''].filter(Boolean).join(' · ');
      return '<div class="wv2-test-row">' +
        '<div class="wv2-test-main">' +
          (stars ? '<div class="wv2-test-stars-row">' + stars + '</div>' : '') +
          '<div class="wv2-test-quote">' + esc(t.quote) + '</div>' +
          (meta ? '<div class="mu-sub">' + esc(meta) + '</div>' : '') +
        '</div>' + control +
      '</div>';
    }).join('');
    return '<div class="wv2-testimonials">' +
      '<div class="wv2-sub-h" style="margin-top:18px;border-top:1px solid var(--border);padding-top:16px;">' +
        'Featured testimonials <span class="wv2-test-count">' + visible + ' of ' + all.length + ' shown</span></div>' +
      '<div class="wv2-test-list">' + rows + '</div>' +
      '<div class="mu-sub" style="margin-top:10px;">Add or remove testimonials from Customer Service › Reviews (“Feature on site”).</div>' +
    '</div>';
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
  // Section content + social inputs now live in the slide-out record (Content
  // pane) and write via inline WebsiteV2.contentInput / socialInput handlers, so
  // the Card 2 list itself has no inputs left to wire. Kept as a no-op so
  // mountWords' call site is stable.
  function wireWords() {}

  // Guard: the homepage host writers (window.hp*) live in homepage.js. If a
  // delegated write isn't loaded yet, kick a load + toast and bail (never a
  // silent no-op). Mirrors homepage-v2's hostReady.
  function hpReady(fnName) {
    if (typeof window[fnName] === 'function') return true;
    // hp* writers are eager (absorbed into this file) — the guard above always
    // passes now; keep the defensive toast rather than a silent no-op.
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
    // HomepageBridge is eager (absorbed into this file) — the guard above always
    // resolves now; the reject is a defensive fallback, never a silent no-op.
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

  // One category LIST row: name + product count + reorder + delete; the row opens
  // the category record (Details / Photos / Products tabs). Rename + wholesale +
  // photos + products all live in that record now.
  function shopCatRow(cat, idx, total) {
    var ed = canEdit();
    var cid = esc(cat.id);
    var count = (V2.productCatCounts && V2.productCatCounts[String(cat.id).toLowerCase()]) || 0;
    var countPill = count > 0
      ? '<span class="wv2-cat-count" title="' + count + ' product' + (count === 1 ? '' : 's') + ' in this category">' + count + '</span>'
      : '';
    var upDis = idx === 0 ? ' disabled' : '';
    var dnDis = idx === total - 1 ? ' disabled' : '';
    var reorder = ed
      ? '<span class="wv2-cat-move">' +
          '<button type="button" class="wv2-mv"' + upDis + ' title="Move up" onclick="event.stopPropagation();WebsiteV2.moveCat(\'' + cid + '\',-1)">▲</button>' +
          '<button type="button" class="wv2-mv"' + dnDis + ' title="Move down" onclick="event.stopPropagation();WebsiteV2.moveCat(\'' + cid + '\',1)">▼</button>' +
        '</span>'
      : '';
    var del = ed ? '<button type="button" class="wv2-cat-btn danger" title="Delete" onclick="event.stopPropagation();WebsiteV2.deleteCat(\'' + cid + '\')">Delete</button>' : '';
    var open = ed ? 'WebsiteV2.openCategory(\'' + cid + '\')' : '';
    return '<div class="wv2-cat-row" data-cat="' + cid + '"' + (ed ? ' role="button" tabindex="0" onclick="' + open + '" onkeydown="if(event.key===\'Enter\'){' + open + '}"' : '') + '>' +
        '<div class="wv2-cat-main"><span class="wv2-cat-label">' + esc(cat.label) + '</span>' + countPill + '<span class="wv2-cat-slug">' + cid + '</span></div>' +
        '<div class="wv2-cat-actions">' + reorder + del + (ed ? '<span class="wv2-cat-go">Edit ›</span>' : '') + '</div>' +
      '</div>';
  }

  // Build a category record from the live caches — the entity fetch + openCategory.
  function catRecord(id) {
    var cat = (V2.cats || []).filter(function (c) { return c.id === id; })[0];
    if (!cat) return null;
    var products = (V2.productsByCat && V2.productsByCat[String(id).toLowerCase()]) || [];
    var b = window.HomepageBridge;
    var imageCount = (b && b.images && b.images.count) ? b.images.count(id) : 0;
    return { id: id, _title: cat.label || id, label: cat.label || id, wholesaleGroup: cat.wholesaleGroup || '', products: products, imageCount: imageCount };
  }
  // The category record interior — Details (rename + wholesale) · Photos (the
  // reused inline photo manager, scoped to this category's images) · Products
  // (read-only list → drill to the product record). MastUI primitives throughout.
  function catDetailHtml(UU, r) {
    var ed = canEdit();
    var tabs = [{ key: 'details', label: 'Details' }, { key: 'photos', label: 'Photos' }, { key: 'products', label: 'Products' }];
    var tiles = [
      { k: 'Products', v: String(r.products.length) },
      { k: 'Photos', v: String(r.imageCount) },
      { k: 'Wholesale', v: r.wholesaleGroup ? esc(r.wholesaleGroup) : '<span class="mu-sub">—</span>' }
    ];
    var sid = esc(r.id);
    var detailsInner = ed
      ? '<div class="form-group"><label class="form-label">Category name</label><input class="form-input" type="text" style="width:100%;" value="' + esc(r.label) + '" oninput="WebsiteV2.catDetail(\'' + sid + '\',\'label\',this.value)"></div>' +
        '<div class="form-group"><label class="form-label">Wholesale group <span class="mu-sub">(optional — groups categories for wholesale)</span></label><input class="form-input" type="text" style="width:100%;" value="' + esc(r.wholesaleGroup) + '" placeholder="e.g. Decorative" oninput="WebsiteV2.catDetail(\'' + sid + '\',\'wholesaleGroup\',this.value)"></div>' +
        '<div class="mu-sub" style="margin-top:2px;">Filter ID: ' + sid + ' · shown as a filter pill on your shop.</div>'
      : '<span class="mu-sub">Read only.</span>';
    var out = UU.stickyHead(UU.tiles(tiles), UU.paneTabsBar(tabs, 'details'));
    out += secPane('details', 'details', UU.card('Details', detailsInner));
    out += secPane('photos', 'details', UU.card('Category image', '<div class="mu-sub" style="margin-bottom:10px;">The photo shown for this category on your shop.</div><div id="wv2CatImg"><div class="mu-sub" style="padding:8px 0;">Loading…</div></div>'));
    out += secPane('products', 'details', UU.card('Products in ' + esc(r.label) + ' (' + r.products.length + ')', catProductsListHtml(r)));
    return out;
  }
  function catProductsListHtml(r) {
    if (!r.products.length) return '<div class="mu-sub" style="padding:8px 0;">No products in this category yet. Add this category to a product and it shows up here.</div>';
    var rows = r.products.map(function (p) {
      var price = (typeof p.priceCents === 'number') ? ('$' + (p.priceCents / 100).toFixed(2)) : '';
      var sub = [price, (p.status && p.status !== 'active') ? p.status : ''].filter(Boolean).join(' · ');
      var thumb = p.image
        ? '<div class="wv2-prod-thumb" style="background-image:url(' + esc(p.image) + ');"></div>'
        : '<div class="wv2-prod-thumb wv2-prod-thumb-empty"></div>';
      return '<button type="button" class="wv2-prod-row" onclick="WebsiteV2.openProduct(\'' + esc(p.pid) + '\')">' +
        thumb + '<div class="wv2-prod-main"><div class="wv2-prod-name">' + esc(p.name) + '</div>' + (sub ? '<div class="mu-sub">' + esc(sub) + '</div>' : '') + '</div>' +
        '<span class="wv2-cat-go">Edit ›</span></button>';
    }).join('');
    return '<div class="mu-sub" style="margin-bottom:10px;">Click a product to open and edit it. To move a product in or out of a category, change it on the product.</div>' +
      '<div class="wv2-prod-list">' + rows + '</div>';
  }
  // The category's single cover image = the first photo tagged to the category.
  // Render a simple preview + From library / Upload / Remove (no per-photo
  // metadata — a category just needs its one representative photo).
  function fillCategoryImage(catId) {
    if (!document.getElementById('wv2CatImg')) return;
    var b = window.HomepageBridge; if (!b || !b.images || !b.images.list) return;
    Promise.resolve(b.images.list(catId)).then(function (items) {
      var el = document.getElementById('wv2CatImg'); if (!el) return;
      var cover = items[0] ? items[0][1] : null;
      WV2_CATIMG = { cat: catId, coverId: items[0] ? items[0][0] : '' };
      var ed = canEdit();
      var prev = (cover && cover.url)
        ? '<div class="wv2-imgcell wv2-imgcell-lg" style="background-image:url(' + esc(cover.url) + ');"></div>'
        : '<div class="wv2-imgcell wv2-imgcell-lg wv2-imgcell-empty"><span class="mu-sub">No image yet</span></div>';
      var btns = ed ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.catImageFromLibrary(\'' + esc(catId) + '\')">📚 From library</button>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.catImageUpload(\'' + esc(catId) + '\')">💻 Upload</button>' +
        ((cover && cover.url) ? '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.catImageRemove(\'' + esc(catId) + '\')">Remove</button>' : '') +
        '</div>' : '';
      el.innerHTML = prev + btns;
      updatePhotoCount(items.length);
    }).catch(function () {});
  }
  // Set the category cover: replace the existing photo's url if one exists, else
  // create a single gallery doc tagged to the category. Then re-render.
  function setCatImage(catId, url) {
    if (!url) return;
    var b = window.HomepageBridge; if (!b || !b.images) return;
    var coverId = (WV2_CATIMG && WV2_CATIMG.cat === catId) ? WV2_CATIMG.coverId : '';
    var p = coverId
      ? b.images.updateImageMeta(coverId, { url: url })
      : b.images.addFromLibraryDirect(catId, { url: url });
    Promise.resolve(p).then(function () { fillCategoryImage(catId); });
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
  // subsystem stays behind THIS single "Advanced (classic)" door → the dedicated
  // import module (deep-linked via navigateTo('website-import'); see openImport).
  function shopImportDoorHtml() {
    if (!canEdit()) return '';
    return '<div class="wv2-importdoor">' +
      '<div class="wv2-importdoor-main">' +
        '<div class="wv2-sub-h">Bring in my whole catalog</div>' +
        '<div class="mu-sub">Have an existing store on Shopify, Etsy, Square, or your own site? Import your full product catalog — we will crawl it and let you cherry-pick what to bring in.</div>' +
      '</div>' +
      '<button type="button" class="btn btn-secondary" onclick="WebsiteV2.openImport()">Import →</button>' +
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

  // ── Card 4 · See it live & share ────────────────────────────────────
  // An always-on live preview of the real storefront. There is NO publish gate —
  // the storefront direct-reads config, so an admin edit IS already live; this card
  // is just an iframe of <tenant>.runmast.com (with ?mastpreview=1 so the storefront
  // skips its localStorage cache + forces light mode → edits reflect within ~1s).
  // Desktop/tablet/mobile viewport toggle (widths mirror the legacy website.js
  // template preview), a manual Refresh, and the live URL with Open/Copy.
  var PREVIEW_WIDTHS = { desktop: '100%', tablet: '768px', mobile: '375px' };
  function previewIframeHtml() {
    var url = previewUrl();
    if (!url) {
      return '<div class="wv2-prev-empty mu-sub">Live preview unavailable — your site address hasn’t resolved yet.</div>';
    }
    var vp = PREVIEW_WIDTHS[V2.previewVP] ? V2.previewVP : 'desktop';
    var w = PREVIEW_WIDTHS[vp];
    var h = vp === 'mobile' ? '720px' : '600px';
    // sandbox mirrors the legacy preview shell (scripts + same-origin so the
    // storefront boots + reads config; popups so in-iframe links can open).
    return '<iframe id="wv2PreviewFrame" class="wv2-prev-frame" title="Live preview of your website" ' +
        'src="' + esc(url) + '" loading="lazy" ' +
        'style="width:' + w + ';height:' + h + ';" ' +
        'sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>';
  }
  function liveHtml() {
    var url = liveUrl();
    var host = liveHost();
    var vpBtns = ['desktop', 'tablet', 'mobile'].map(function (vp) {
      var on = (V2.previewVP === vp);
      var label = vp.charAt(0).toUpperCase() + vp.slice(1);
      return '<button type="button" class="wv2-vp' + (on ? ' on' : '') + '" aria-pressed="' + on + '" ' +
        'onclick="WebsiteV2.setPreviewViewport(\'' + vp + '\')">' + label + '</button>';
    }).join('');

    var actions = url
      ? '<a class="btn btn-primary btn-small" href="' + esc(url) + '" target="_blank" rel="noopener">Open my site ↗</a>' +
        '<button type="button" class="btn btn-secondary btn-small" onclick="WebsiteV2.copyLink()">Copy link</button>'
      : '<span class="mu-sub">Live URL unavailable</span>';

    var toolbar =
      '<div class="wv2-prev-bar">' +
        '<div class="wv2-vp-group" role="group" aria-label="Preview size">' + vpBtns + '</div>' +
        '<button type="button" class="wv2-prev-refresh" title="Reload the preview" onclick="WebsiteV2.refreshPreview()">↻ Refresh preview</button>' +
      '</div>';

    return '<div class="wv2-live">' +
        '<div class="mu-sub" style="margin-bottom:10px;">Every change here is already live. This is your real storefront.</div>' +
        '<div class="wv2-live-actions">' + actions + '</div>' +
        toolbar +
        '<div class="wv2-prev-stage" id="wv2PreviewStage">' + previewIframeHtml() + '</div>' +
      '</div>';
  }
  // Mount Card 4 into its scaffold body (wv2LiveBody) — replaces the PR2
  // "Coming in this builder" placeholder. Re-called by reloadSoon() after edits;
  // to avoid flashing the iframe on every settle, if a preview frame already
  // exists we only refresh the chrome (URL/actions/toolbar) and RE-ADOPT the live
  // frame node — its reload is driven separately by reloadPreviewNow (debounced).
  function mountLive() {
    var host = document.getElementById('wv2LiveBody');
    if (!host) return;
    var existing = document.getElementById('wv2PreviewFrame');
    host.innerHTML = liveHtml();
    if (existing) {
      // Preserve the already-loaded frame (don't trigger a fresh navigation just
      // because the chrome re-rendered). Move the existing node into the new stage,
      // keeping its current viewport width in sync with the active toggle.
      var stage = document.getElementById('wv2PreviewStage');
      var fresh = document.getElementById('wv2PreviewFrame');
      if (stage && fresh) {
        var vp = PREVIEW_WIDTHS[V2.previewVP] ? V2.previewVP : 'desktop';
        existing.style.width = PREVIEW_WIDTHS[vp];
        existing.style.height = vp === 'mobile' ? '720px' : '600px';
        stage.replaceChild(existing, fresh);
      }
    }
  }
  // Swap only the iframe src (bump the nonce → browser refetches). Avoids tearing
  // down/rebuilding the <iframe> element so the reload is a single navigation, not
  // a flash. If the frame element is gone (card not mounted), no-op.
  function reloadPreviewNow() {
    V2.previewNonce++;
    var frame = document.getElementById('wv2PreviewFrame');
    if (frame) { try { frame.src = previewUrl(); } catch (e) {} }
  }
  // Tier-2 instant live theme preview (PR7): post a COLOR/FONT delta straight to
  // the Card 4 preview iframe via postMessage so the storefront repaints in
  // <100ms — no reload, no flash. The storefront-side listener (storefront-
  // theme.js) is same-origin guarded + only acts in ?mastpreview=1 mode. This is
  // an in-memory preview push ONLY; the canonical persist still happens through
  // the bridges, and schedulePreviewReload() stays as the eventual full-refetch
  // fallback (and the only path for structural edits Tier-2 doesn't cover).
  // Defensive: if the frame is missing/not ready or postMessage throws, we no-op
  // and the Tier-1 reload still reflects the edit.
  function wv2PostTheme(delta) {
    if (!delta || typeof delta !== 'object') return;
    try {
      var frame = document.getElementById('wv2PreviewFrame');
      if (!frame || !frame.contentWindow) return;
      frame.contentWindow.postMessage({ type: 'mast-theme-preview', config: delta }, location.origin);
    } catch (e) { /* fall back to the Tier-1 reload */ }
  }

  // Tier-1 live reflect: after a builder edit settles, debounce (~800ms) a preview
  // reload. Cards 1–3 writes flow through withSave → reloadSoon; we hook here so any
  // edit visibly updates the preview within ~1s without spamming reloads on rapid
  // keystrokes. Centralized so every card handler inherits it for free. For COLOR/
  // FONT edits this is the FALLBACK behind the instant wv2PostTheme push above.
  var _previewTimer = null;
  function schedulePreviewReload() {
    if (_previewTimer) clearTimeout(_previewTimer);
    _previewTimer = setTimeout(function () { _previewTimer = null; reloadPreviewNow(); }, 800);
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
      // ── Looks gallery tiles (wider than scheme/font tiles for the thumbnail) ──
      '#wv2LooksGrid .mu-swgrid{grid-template-columns:repeat(auto-fill,minmax(132px,1fr));}' +
      '#wv2LooksGrid .mu-sw{min-height:auto;padding:8px;gap:8px;}' +
      '.wv2-look-thumb{display:block;width:100%;height:74px;border-radius:8px;border:1px solid color-mix(in srgb,var(--text-primary) 14%,transparent);background-size:cover;background-position:center;background-repeat:no-repeat;overflow:hidden;}' +
      // mini-preview (no thumbnail): three stacked palette bands
      '.wv2-look-thumb-mini{display:flex;flex-direction:column;}' +
      '.wv2-look-band{flex:1;width:100%;}' +
      '.wv2-look-name{font-size:0.78rem;color:var(--text-primary);line-height:1.2;}' +
      // inline Undo affordance under the Looks grid
      '.wv2-undo{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;' +
        'margin-top:4px;padding:9px 12px;border-radius:8px;border:1px solid color-mix(in srgb,var(--teal) 30%,transparent);' +
        'background:color-mix(in srgb,var(--teal) 8%,transparent);}' +
      '.wv2-undo-msg{font-size:0.78rem;color:var(--text-primary);}' +
      '.wv2-undo-caveat{color:var(--warning,var(--amber));}' +
      // friendly switch-confirm modal (rendered inside the shared openModal
      // shell — these style only the INNER content; the shell owns the overlay)
      '.wv2-lookdlg{max-width:440px;}' +
      '.wv2-modal-title{font-size:1.15rem;font-weight:700;color:var(--text-primary);margin-bottom:10px;}' +
      '.wv2-modal-body{font-size:0.85rem;color:var(--text-secondary,var(--warm-gray));line-height:1.5;}' +
      '.wv2-lookdlg-lead{font-size:0.9rem;color:var(--text-primary);margin-bottom:6px;}' +
      '.wv2-lookdlg-desc{font-size:0.78rem;color:var(--warm-gray);margin-bottom:10px;}' +
      '.wv2-lookdlg-list{margin:6px 0 2px;padding-left:18px;display:flex;flex-direction:column;gap:6px;}' +
      '.wv2-lookdlg-list li{font-size:0.78rem;color:var(--text-secondary,var(--warm-gray));}' +
      '.wv2-lookdlg-list strong{color:var(--text-primary);}' +
      '.wv2-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px;}' +
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
      // Logo variants — a compact tile per logo (primary + light/dark/transparent),
      // each previewed on a contrasting background so the variant makes sense.
      '.wv2-logo-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}' +
      '.wv2-logo-tile{border:1px solid var(--border);border-radius:10px;padding:10px;display:flex;flex-direction:column;gap:8px;}' +
      '.wv2-logo-tile-head{font-size:0.85rem;font-weight:600;color:var(--text-primary);display:flex;flex-direction:column;line-height:1.3;}' +
      '.wv2-logo-tile-head .mu-sub{font-weight:400;}' +
      '.wv2-logo-tile-prev{height:80px;border-radius:8px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;}' +
      '.wv2-logo-tile-prev img{max-width:88%;max-height:64px;object-fit:contain;}' +
      '.wv2-logo-tile-prev.bg-card{background:var(--surface-card);}' +
      '.wv2-logo-tile-prev.bg-dark{background:var(--charcoal,var(--surface-dark));}' +
      '.wv2-logo-tile-prev.bg-light{background:var(--cream,var(--surface-light));}' +
      '.wv2-logo-tile-prev.bg-check{background-image:repeating-conic-gradient(color-mix(in srgb,var(--text-primary) 8%,transparent) 0% 25%,transparent 0% 50%);background-size:16px 16px;}' +
      '.wv2-logo-tile-acts{display:flex;gap:6px;flex-wrap:wrap;}' +
      '.wv2-voice-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;}' +
      // layout & scale grid + conflict warnings
      '.wv2-layoutgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;}' +
      '.wv2-layoutwarn{margin-top:12px;padding:10px 12px;border-radius:8px;background:color-mix(in srgb,var(--warning,var(--amber)) 12%,transparent);border:1px solid color-mix(in srgb,var(--warning,var(--amber)) 26%,transparent);}' +
      '.wv2-warn-line{font-size:0.78rem;color:var(--warning,var(--amber));margin-bottom:4px;}.wv2-warn-line:last-child{margin-bottom:0;}' +
      // ── Card 2 · Your words & pictures ──
      '.wv2-seclist{display:flex;flex-direction:column;}' +
      // Section LIST rows — each opens the section record (slide-out).
      '.wv2-sec-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 10px;border-top:1px solid var(--border);border-radius:8px;cursor:pointer;}' +
      '.wv2-sec-row:first-child{border-top:none;}' +
      '.wv2-sec-row:hover{background:color-mix(in srgb,var(--text-primary) 4%,transparent);}' +
      '.wv2-sec-id{display:flex;align-items:center;gap:8px;min-width:0;}' +
      '.wv2-sec-name{font-size:0.9rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.wv2-sec-pill{font-size:0.72rem;font-weight:600;padding:1px 8px;border-radius:999px;}' +
      '.wv2-sec-pill.on{color:var(--success);background:color-mix(in srgb,var(--success) 14%,transparent);}' +
      '.wv2-sec-pill.off{color:var(--text-secondary,var(--warm-gray));background:color-mix(in srgb,var(--text-primary) 8%,transparent);}' +
      '.wv2-sec-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;}' +
      '.wv2-sec-go{font-size:0.78rem;color:var(--teal);font-weight:600;}' +
      '.wv2-sec-count{font-size:0.72rem;color:var(--text-secondary,var(--warm-gray));}' +
      '.wv2-test-stars-row{margin-bottom:2px;}' +
      '.wv2-test-stars{color:var(--amber,var(--teal));font-size:0.78rem;letter-spacing:1px;}' +
      '.wv2-sec-move{display:inline-flex;gap:2px;}' +
      '.wv2-mv{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.72rem;width:22px;height:22px;line-height:1;padding:0;}' +
      '.wv2-mv:hover:not(:disabled){color:var(--text-primary);border-color:var(--teal);}.wv2-mv:disabled{opacity:0.35;cursor:default;}' +
      '.wv2-sec-toggle{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.72rem;padding:3px 10px;}' +
      '.wv2-sec-toggle:hover{color:var(--text-primary);border-color:var(--teal);}' +
      '.wv2-social-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;}' +
      '.wv2-var-name{font-size:0.85rem;color:var(--text-primary);}' +
      '.wv2-var-desc{font-size:0.72rem;margin-top:2px;}' +
      // Section images (inline "Edit images" row + the slide-out controls)
      // Photos — the inline manager: feature-image cell (about) + add bar +
      // bounded thumbnail grid + the selected-photo editor. Tiles/cells use
      // background-image so they crop cleanly; the engine cards own the shell.
      '.wv2-imgcell{width:64px;height:64px;border-radius:8px;border:1px solid var(--border);background-size:cover;background-position:center;}' +
      '.wv2-imgcell-lg{width:100%;max-width:280px;height:170px;}' +
      '.wv2-imgcell-empty{display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,var(--text-primary) 4%,transparent);}' +
      '.wv2-photo-addbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;}' +
      '.wv2-photogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;max-height:240px;overflow-y:auto;padding:2px;}' +
      '.wv2-phototile{position:relative;aspect-ratio:1;border-radius:8px;border:2px solid transparent;background-size:cover;background-position:center;background-color:color-mix(in srgb,var(--text-primary) 6%,transparent);cursor:pointer;padding:0;}' +
      '.wv2-phototile.on{border-color:var(--teal);}' +
      '.wv2-phototile.off{opacity:0.4;}' +
      '.wv2-phototile-vid{position:absolute;bottom:2px;right:3px;font-size:0.72rem;line-height:1;padding:1px 3px;border-radius:4px;background:color-mix(in srgb,var(--surface-card) 78%,transparent);color:var(--text-primary);}' +
      '.wv2-photo-prev{flex-shrink:0;width:108px;height:108px;border-radius:8px;border:1px solid var(--border);background-size:cover;background-position:center;}' +
      '.wv2-photo-prev-vid{display:flex;align-items:center;justify-content:center;color:var(--warm-gray);font-size:1.6rem;background:color-mix(in srgb,var(--text-primary) 6%,transparent);}' +
      '.wv2-photo-edit-top{display:flex;gap:14px;}' +
      '.wv2-photo-edit-fields{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;}' +
      '.wv2-photo-fgroup{margin-top:12px;padding-top:10px;border-top:1px solid var(--border);}' +
      '.wv2-photo-fgrid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;}' +
      '.wv2-photo-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;}' +
      // Copy-from-site import
      '.wv2-import-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}' +
      '.wv2-import-hits{margin-top:10px;display:flex;flex-direction:column;gap:8px;}' +
      '.wv2-impchip{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:color-mix(in srgb,var(--text-primary) 3%,transparent);}' +
      '.wv2-impchip-main{min-width:0;display:flex;flex-direction:column;gap:1px;}' +
      '.wv2-impchip-label{font-size:0.72rem;font-weight:600;color:var(--text-secondary,var(--warm-gray));}' +
      '.wv2-impchip-val{font-size:0.85rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw;}' +
      // featured testimonials (homepage visibility toggles)
      '.wv2-test-count{font-size:0.72rem;font-weight:600;color:var(--text-secondary,var(--warm-gray));margin-left:6px;}' +
      '.wv2-test-list{display:flex;flex-direction:column;}' +
      '.wv2-test-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:9px 0;border-top:1px solid var(--border);}' +
      '.wv2-test-row:first-child{border-top:none;}' +
      '.wv2-test-main{min-width:0;}' +
      '.wv2-test-quote{font-size:0.85rem;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:46vw;}' +
      // ── Card 3 · Your shop (categories) ──
      '.wv2-catlist{display:flex;flex-direction:column;}' +
      // Category LIST rows — each opens the category record (Details/Photos/Products).
      '.wv2-cat-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 10px;border-top:1px solid var(--border);border-radius:8px;cursor:pointer;flex-wrap:wrap;}' +
      '.wv2-cat-row:first-child{border-top:none;}' +
      '.wv2-cat-row:hover{background:color-mix(in srgb,var(--text-primary) 4%,transparent);}' +
      '.wv2-cat-main{display:flex;align-items:center;gap:9px;min-width:0;flex:1;}' +
      '.wv2-cat-label{font-size:0.9rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.wv2-cat-slug{font-size:0.72rem;color:var(--text-secondary,var(--warm-gray));font-family:ui-monospace,monospace;opacity:0.8;}' +
      '.wv2-cat-count{font-size:0.72rem;font-weight:600;color:var(--teal);background:color-mix(in srgb,var(--teal) 14%,transparent);padding:1px 8px;border-radius:999px;flex-shrink:0;}' +
      '.wv2-cat-actions{display:flex;align-items:center;gap:8px;flex-shrink:0;flex-wrap:wrap;}' +
      '.wv2-cat-go{font-size:0.78rem;color:var(--teal);font-weight:600;}' +
      '.wv2-cat-move{display:inline-flex;gap:2px;}' +
      '.wv2-cat-btn{background:none;border:1px solid var(--border);border-radius:6px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.72rem;padding:3px 10px;}' +
      '.wv2-cat-btn:hover{color:var(--text-primary);border-color:var(--teal);}' +
      '.wv2-cat-btn.danger:hover{color:var(--danger);border-color:var(--danger);}' +
      // Category record · Products tab — read-only rows that drill to the product.
      '.wv2-prod-list{display:flex;flex-direction:column;}' +
      '.wv2-prod-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:9px 6px;border:none;border-top:1px solid var(--border);background:none;cursor:pointer;color:inherit;}' +
      '.wv2-prod-row:first-child{border-top:none;}' +
      '.wv2-prod-row:hover{background:color-mix(in srgb,var(--text-primary) 4%,transparent);}' +
      '.wv2-prod-thumb{flex-shrink:0;width:40px;height:40px;border-radius:8px;border:1px solid var(--border);background-size:cover;background-position:center;}' +
      '.wv2-prod-thumb-empty{background:color-mix(in srgb,var(--text-primary) 6%,transparent);}' +
      '.wv2-prod-main{flex:1;min-width:0;}' +
      '.wv2-prod-name{font-size:0.9rem;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
      '.wv2-cat-add{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:14px;padding-top:12px;border-top:1px solid var(--border);}' +
      // product-derived suggestion chips
      '.wv2-suggest{margin-top:18px;border-top:1px solid var(--border);padding-top:16px;}' +
      '.wv2-sug-row{display:flex;flex-wrap:wrap;gap:8px;}' +
      '.wv2-sug-chip{display:inline-flex;align-items:center;gap:6px;font-size:0.78rem;font-weight:600;color:var(--teal);background:color-mix(in srgb,var(--teal) 8%,transparent);border:1px solid color-mix(in srgb,var(--teal) 30%,transparent);border-radius:999px;padding:5px 12px;cursor:pointer;}' +
      '.wv2-sug-chip:hover{background:color-mix(in srgb,var(--teal) 16%,transparent);}' +
      '.wv2-sug-n{font-size:0.72rem;font-weight:600;opacity:0.85;}' +
      // the one retained classic import door
      '.wv2-importdoor{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;padding:12px 14px;border:1px dashed var(--border);border-radius:10px;background:color-mix(in srgb,var(--text-primary) 3%,transparent);}' +
      '.wv2-importdoor-main{min-width:0;flex:1;}' +
      // ── Card 4 · See it live & share ──
      '.wv2-live-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px;}' +
      '.wv2-prev-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:10px;}' +
      '.wv2-vp-group{display:inline-flex;gap:4px;border:1px solid var(--border);border-radius:8px;padding:3px;}' +
      '.wv2-vp{background:none;border:none;border-radius:6px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.78rem;font-weight:600;padding:4px 12px;}' +
      '.wv2-vp:hover{color:var(--text-primary);}' +
      '.wv2-vp.on{background:color-mix(in srgb,var(--teal) 16%,transparent);color:var(--teal);}' +
      '.wv2-prev-refresh{background:none;border:1px solid var(--border);border-radius:8px;color:var(--text-secondary,var(--warm-gray));cursor:pointer;font-size:0.78rem;padding:5px 12px;}' +
      '.wv2-prev-refresh:hover{color:var(--text-primary);border-color:var(--teal);}' +
      '.wv2-prev-stage{display:flex;justify-content:center;overflow:auto;background:var(--surface-dark,color-mix(in srgb,var(--text-primary) 6%,transparent));border:1px solid var(--border);border-radius:10px;padding:12px;}' +
      // Light placeholder background before the storefront paints (the preview is
      // forced light, so a white canvas matches — `white` keyword avoids the hex ratchet).
      '.wv2-prev-frame{max-width:100%;border:1px solid var(--border);border-radius:6px;background:white;transition:width 0.18s ease;}' +
      '.wv2-prev-empty{padding:32px 12px;text-align:center;}';
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
    // shop) + Card 4 (See it live & share) into their mounts now that the scaffold
    // is in the DOM.
    mountLookFeel();
    mountWords();
    mountShop();
    mountLive();
  }

  // ── public API ─────────────────────────────────────────────────────
  window.WebsiteV2 = {
    refresh: function () { render(); },

    // Card 1 · Color scheme tile → HomepageBridge.setColorScheme (clears custom
    // overrides server-side, mirrors wpSelectScheme). Instant-apply.
    pickScheme: function (schemeId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!window.HomepageBridge || !HomepageBridge.setColorScheme) {
        // HomepageBridge is eager (absorbed into this file) — defensive guard only.
        if (window.showToast) showToast('Site editor still loading — try again', true); return;
      }
      // Tier-2 instant preview: push the scheme delta (the storefront resolves it
      // through the loaded manifest). Clear any custom colors so the preview drops
      // them too, mirroring the canonical write (setColorScheme clears custom).
      wv2PostTheme({ colorSchemeId: schemeId, primaryColor: null, accentColor: null });
      withSave(HomepageBridge.setColorScheme(schemeId));
    },
    // Card 1 · Font pair tile → MastBrandSync.setFontPair (canonical theme write).
    pickFont: function (fontId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!window.MastBrandSync) { if (window.showToast) showToast('Site editor still loading — try again', true); return; }
      // Tier-2 instant preview: push the font delta so the preview repaints fonts
      // immediately (the storefront loads the Google Font + sets --font-* vars).
      wv2PostTheme({ fontPair: fontId });
      withSave(window.MastBrandSync.setFontPair(fontId));
    },

    // Card 1 · Looks gallery tile → the high-level whole-site switch. Tapping
    // the CURRENT Look is a no-op (it's already applied). Tapping a DIFFERENT
    // Look runs WebsiteBridge.previewSwitch to build a FRIENDLY confirm dialog: text +
    // products stay; N gallery images fit, M get hidden — reversible). On Apply
    // it snapshots (captureThemeState) then delegates the full cascade to
    // WebsiteBridge.switchTemplate (which calls the legacy wpConfirmSwitch — the
    // gallery migration + theme reset are NOT reimplemented here), then offers
    // an Undo. NOTE: the migration/reset live entirely behind the bridge; this
    // method only orchestrates confirm → snapshot → switch → Undo.
    pickLook: function (lookId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (V2.switchBusy) return;
      var looks = V2.looks || [];
      var look = looks.filter(function (l) { return l.id === lookId; })[0];
      if (!look) return;
      var currentId = (V2.theme && V2.theme.templateId) || (looks.filter(function (l) { return l.current; })[0] || {}).id || '';
      if (lookId === currentId) {
        // Same Look — nothing to migrate. (A future "looks bundle" that's just a
        // scheme+font re-apply on the same template would route through
        // pickScheme/pickFont; the registry has one entry per template, so the
        // current tile is simply a no-op.)
        if (window.showToast) showToast('That’s your current Look.');
        return;
      }
      if (!window.WebsiteBridge || typeof window.WebsiteBridge.previewSwitch !== 'function') {
        try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('website-core'); } catch (e) {}
        if (window.showToast) showToast('Site editor still loading — try again', true);
        return;
      }
      // Build the preview (no mutation), then show the friendly confirm.
      Promise.resolve(window.WebsiteBridge.previewSwitch(lookId)).then(function (preview) {
        if (!preview) { if (window.showToast) showToast('Look not found.', true); return; }
        showLookSwitchConfirm(look, preview);
      }).catch(function (e) {
        console.error('[website-v2] previewSwitch', e);
        if (window.showToast) showToast('Couldn’t preview that Look: ' + (e && e.message || e), true);
      });
    },
    // Reverse the most recent Look switch (stage-before-commit Undo). Restores
    // the captured theme doc + the gallery-visibility flips via
    // WebsiteBridge.restoreThemeState. Honest about a partial gallery restore.
    undoLook: function () {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var snap = V2.lastUndo && V2.lastUndo.snapshot;
      if (!snap) { if (window.showToast) showToast('Nothing to undo.', true); return; }
      if (V2.switchBusy) return;
      if (!window.WebsiteBridge || typeof window.WebsiteBridge.restoreThemeState !== 'function') {
        if (window.showToast) showToast('Site editor still loading — try again', true); return;
      }
      V2.switchBusy = true;
      withSave(Promise.resolve(window.WebsiteBridge.restoreThemeState(snap)).then(function (res) {
        V2.switchBusy = false;
        V2.lastUndo = null;
        if (window.showToast) showToast('Reverted to your previous Look.');
        return res;
      }).catch(function (e) {
        V2.switchBusy = false;
        // restoreThemeState restored the THEME even when the gallery reversal
        // failed — be honest, don't pretend it was clean.
        if (e && /gallery-partial/.test(String(e.message || e))) {
          V2.lastUndo = null;
          if (window.showToast) showToast('Look reverted — but please recheck your gallery images.', true);
          return true;
        }
        throw e;
      })).then(function () { loadLooks(); });
    },
    // The friendly-confirm modal's Apply button → close the modal + run the
    // switch on the stashed pending Look. (Split from pickLook so the confirm
    // body can be rich HTML in the sanctioned openModal shell.)
    applyLook: function () {
      var look = V2.pendingLook;
      V2.pendingLook = null;
      if (typeof window.closeModal === 'function') closeModal();
      if (look) doLookSwitch(look);
    },
    // The friendly-confirm modal's Cancel button → just close, no change.
    cancelLook: function () {
      V2.pendingLook = null;
      if (typeof window.closeModal === 'function') closeModal();
    },
    // Card 1 · Logo from the shared image library (PR-571 picker). Instant-apply:
    // the picked URL writes immediately through BrandBridge.setLogoFromUrl.
    logoFromLibrary: function (key) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable.', true); return; }
      window.openImagePicker(function (imageId, url) {
        if (!url) return;
        applyLogoUrl(url, key);
      });
    },
    // Card 1 · Logo from computer → /uploadImage CF (base64), then the returned
    // library URL writes through BrandBridge.setLogoFromUrl(key) (key = primary /
    // light / dark / transparent).
    logoUpload: function (key) {
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
              applyLogoUrl(url, key);
            }).catch(function (err) { if (window.showToast) showToast('Upload failed: ' + (err && err.message ? err.message : 'error'), true); });
          } catch (err) { if (window.showToast) showToast('Upload failed.', true); }
        };
        reader.readAsDataURL(input.files[0]);
      };
      input.click();
    },
    // Card 1 · remove a logo VARIANT (light/dark/transparent) → BrandBridge
    // .deleteVariant (clears config/brand/logo/variants/{key} + repoints any
    // placement that referenced it back to primary). Primary is replaced, never
    // removed, so it has no remove control.
    logoRemoveVariant: function (key) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!key || key === 'primary' || !LOGO_KEYS[key]) return;
      if (window.BrandBridge && typeof window.BrandBridge.deleteVariant === 'function') {
        withSave(Promise.resolve(window.BrandBridge.deleteVariant(key)));
      } else {
        // BrandBridge is eager (absorbed into this file) — defensive guard only.
        if (window.showToast) showToast('Site editor still loading — try again', true);
      }
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
    // Open a section as a record in the standard slide-out (Content / Photos /
    // Layout tabs). Replaces the old inline expand.
    openSection: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!window.MastEntity) { if (window.showToast) showToast('Editor still loading — try again', true); return; }
      var r = sectionRecord(id);
      if (!r) { if (window.showToast) showToast('Section still loading — try again', true); return; }
      WV2_SEC.id = id;
      // the section record's render hook fills the Photos strip after the body
      // lands (covers open, setMode, and Back from the drill).
      MastEntity.openRecord('homepage-section-v2', r, 'read');
    },
    // Instant-apply a section content field → hpUpdateField (self-debounced).
    contentInput: function (secId, fieldId, type, value) {
      if (!canEdit()) return;
      var v = value;
      if (type === 'number') v = parseInt(value, 10) || 0;
      else if (type === 'toggle') v = !!value;
      if (!hpReady('hpUpdateField')) return;
      if (!V2.wp.sections) V2.wp.sections = {};
      if (!V2.wp.sections[secId]) V2.wp.sections[secId] = {};
      V2.wp.sections[secId][fieldId] = v;
      withSave(Promise.resolve(window.hpUpdateField(secId, fieldId, v)), { reload: false });
    },
    // Instant-apply a contact social link → hpUpdateSocial.
    socialInput: function (platform, value) {
      if (!canEdit()) return;
      if (!hpReady('hpUpdateSocial')) return;
      if (!V2.wp.sections) V2.wp.sections = {};
      if (!V2.wp.sections.contact) V2.wp.sections.contact = {};
      if (!V2.wp.sections.contact.socialLinks) V2.wp.sections.contact.socialLinks = {};
      V2.wp.sections.contact.socialLinks[platform] = value;
      withSave(Promise.resolve(window.hpUpdateSocial(platform, value)), { reload: false });
    },
    // Hero slideshow slider — live label while dragging, write on release.
    heroRotationInput: function (v) {
      var lbl = document.getElementById('heroRotationLabel');
      if (lbl) lbl.textContent = heroRotationLabel(v);
    },
    heroRotationCommit: function (v) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (typeof window.saveHeroRotationSpeed === 'function') window.saveHeroRotationSpeed(parseInt(v, 10));
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
      if (!V2.theme) V2.theme = {};
      V2.theme[key] = variantId; // optimistic so the tile selects
      // re-render the open record's Layout pane in place (selection + tile), and
      // refresh the Card 2 list underneath for the next open.
      rerenderSecPane('layout');
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
      withSave(Promise.resolve(window.hpUpdateField(secId, fieldId, value)), { reload: false }).then(function () {
        // open the section record so the filled value is visible
        if (WebsiteV2 && WebsiteV2.openSection) WebsiteV2.openSection(secId);
      });
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
    // ── Photos pane · single-image FIELD (e.g. about.imageUrl) ──────────
    // Pick from the library → setField. Re-renders the open record's Photos pane
    // (preview) + the Card 2 list underneath. setField fires notifyGalleryChanged.
    pickFieldImage: function (secId, fieldId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable.', true); return; }
      window.openImagePicker(function (imgId, url) {
        if (!url) return;
        optimisticField(secId, fieldId, url);
        Promise.resolve(b.images.setField(secId, fieldId, url)).then(function () { rerenderSecPane('photos'); mountWords(); });
      });
    },
    // Single-image FIELD · upload from computer → /uploadImage CF → setField.
    uploadFieldImage: function (secId, fieldId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      pickAndUploadImage(['section-image', secId], function (url) {
        optimisticField(secId, fieldId, url);
        Promise.resolve(b.images.setField(secId, fieldId, url)).then(function () { rerenderSecPane('photos'); mountWords(); });
      });
    },
    // Single-image FIELD · clear it.
    clearFieldImage: function (secId, fieldId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      optimisticField(secId, fieldId, '');
      Promise.resolve(b.images.clearField(secId, fieldId)).then(function () { rerenderSecPane('photos'); mountWords(); });
    },

    // ── Photos pane · inline manager actions ────────────────────────────
    // All mutations go through HomepageBridge.images, then fillPhotosManager
    // re-fetches + re-renders the Photos pane in place (no separate surface).
    // Add a library image directly (shared picker → DOM-free write), focus it.
    imgdAdd: function (secId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable.', true); return; }
      window.openImagePicker(function (imgId, url) {
        if (!url) return;
        Promise.resolve(b.images.addFromLibraryDirect(secId, { imgId: imgId, url: url })).then(function (key) { WV2_PHOTOS.focus = key; fillPhotosManager(secId); });
      });
    },
    imgdUpload: function (secId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      pickAndUploadImage(['section-image', secId], function (url) {
        Promise.resolve(b.images.addFromLibraryDirect(secId, { url: url })).then(function (key) { WV2_PHOTOS.focus = key; fillPhotosManager(secId); });
      });
    },
    // Paste a URL to add a photo (parity with the legacy "Paste URL" source).
    imgdPasteUrl: function (secId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      if (typeof window.mastPrompt !== 'function') { if (window.showToast) showToast('Unavailable.', true); return; }
      window.mastPrompt('Paste the image or video URL:', { title: 'Add photo by URL', placeholder: 'https://…' }).then(function (url) {
        url = (url || '').trim(); if (!url) return;
        Promise.resolve(b.images.addFromLibraryDirect(secId, { url: url })).then(function (key) { WV2_PHOTOS.focus = key; fillPhotosManager(secId); });
      });
    },
    // Select a thumbnail → set focus + re-render the manager from cache (instant).
    photoSelect: function (imageId) { WV2_PHOTOS.focus = imageId; renderPhotosFromCache(); },
    // Reveal/collapse hidden photos in the grid (so they can be un-hidden).
    photoToggleHidden: function () { WV2_PHOTOS.showHidden = !WV2_PHOTOS.showHidden; renderPhotosFromCache(); },
    // Inline per-photo metadata edit (alt/caption/category/imageFit/video/
    // product) → DOM-free patch. Debounced for text/number; numbers coerced
    // (empty/0 → null) to match the legacy saveImage. No re-render (the input
    // already shows the value), so focus is preserved while typing.
    imgdMeta: function (imageId, field, value) {
      if (!canEdit()) return;
      var b = window.HomepageBridge; if (!b || !b.images || !b.images.updateImageMeta) return;
      var v = value;
      if (field === 'playbackSpeed') { v = parseFloat(value); if (!v || v === 1) v = null; }
      else if (field === 'videoStart' || field === 'videoEnd') { v = (value === '' ? null : parseFloat(value)); if (v != null && (isNaN(v) || v <= 0)) v = null; }
      var instant = (field === 'category' || field === 'imageFit' || field === 'playbackSpeed');
      var key = imageId + ':' + field;
      if (_imgdMetaT[key]) clearTimeout(_imgdMetaT[key]);
      var write = function () { var patch = {}; patch[field] = v; b.images.updateImageMeta(imageId, patch); };
      if (instant) write(); else _imgdMetaT[key] = setTimeout(write, 450);
    },
    imgdToggleVis: function (imageId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      Promise.resolve(b.images.toggleVisible(imageId)).then(function () { WV2_PHOTOS.focus = imageId; fillPhotosManager(WV2_PHOTOS.sec); });
    },
    imgdMove: function (imageId, dir) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images) return;
      Promise.resolve(b.images.reorder(imageId, dir)).then(function () { WV2_PHOTOS.focus = imageId; fillPhotosManager(WV2_PHOTOS.sec); });
    },
    // Move the selected photo to the front by giving it the lowest order (the
    // storefront sorts by order ascending, so this puts it first).
    imgdMakeFirst: function (imageId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images || !b.images.updateImageMeta) return;
      var items = WV2_PHOTOS.items || [];
      var minOrder = items.reduce(function (m, e) { var o = (e[1] && e[1].order) || 0; return o < m ? o : m; }, 0);
      Promise.resolve(b.images.updateImageMeta(imageId, { order: minOrder - 1 })).then(function () { WV2_PHOTOS.focus = imageId; fillPhotosManager(WV2_PHOTOS.sec); });
    },
    imgdRemove: function (imageId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images || !b.images.removeConfirmed) return;
      var go = function () {
        WV2_PHOTOS.focus = null; // focus falls back to first after delete
        Promise.resolve(b.images.removeConfirmed(imageId)).then(function () { fillPhotosManager(WV2_PHOTOS.sec); });
      };
      if (typeof window.mastConfirm === 'function') window.mastConfirm('Remove this photo from the section?', go);
      else go();
    },
    // Featured-testimonial visibility → window.hpToggleTestimonialVisible (the
    // SAME single-source writer the legacy page builder uses; arg-taking, no DOM)
    // → public/testimonials/{key}/visible. Toggles show/hide on the homepage
    // WITHOUT un-featuring; add/remove stays in CS › Reviews. Optimistic cache so
    // the row flips instantly, then re-mount Card 2.
    toggleTestimonial: function (key, visible) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your site.', true); return; }
      if (!hpReady('hpToggleTestimonialVisible')) return;
      if (!V2.testimonials) V2.testimonials = {};
      if (!V2.testimonials[key]) V2.testimonials[key] = {};
      V2.testimonials[key].visible = !!visible; // optimistic so the toggle flips
      withSave(Promise.resolve(window.hpToggleTestimonialVisible(key, !!visible)), { reload: false }).then(mountWords);
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
    // Open a category as a record (Details / Photos / Products tabs).
    openCategory: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      if (!window.MastEntity) { if (window.showToast) showToast('Editor still loading — try again', true); return; }
      var r = catRecord(id);
      if (!r) { if (window.showToast) showToast('Category still loading — try again', true); return; }
      MastEntity.openRecord('shop-category-v2', r, 'read');
    },
    // Instant-apply (debounced) the Details tab fields — name (label, slug
    // unchanged) and wholesale group — through the single-source category writer.
    // Skips reloadSoon (rename/wholesale don't change product counts), so typing
    // stays light; mountShop refreshes the Card 3 list label underneath.
    catDetail: function (id, field, value) {
      if (!canEdit()) return;
      var key = id + ':' + field;
      if (_catDetailT[key]) clearTimeout(_catDetailT[key]);
      _catDetailT[key] = setTimeout(function () {
        var arr = catsWorking();
        var row = arr.filter(function (c) { return c.id === id; })[0];
        if (!row) return;
        var v = (value || '').trim();
        if (field === 'label') { if (!v) return; row.label = v; }
        else if (field === 'wholesaleGroup') { if (v) row.wholesaleGroup = v; else delete row.wholesaleGroup; }
        V2.cats = arr.map(function (c) { return Object.assign({}, c); });
        withSave(WebsiteBridgeCall('saveCategories', arr), { reload: false });
        mountShop();
      }, 500);
    },
    // Products tab → open the product record (stacked SO with Back). products-v2
    // fetch reads the product fresh, so this works from here.
    openProduct: function (pid) {
      if (!pid || !window.MastEntity) return;
      MastEntity.drill('products-v2', pid);
    },
    // Category cover image (Photos tab) — pick from library / upload / remove.
    catImageFromLibrary: function (catId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable.', true); return; }
      window.openImagePicker(function (imgId, url) { if (url) setCatImage(catId, url); });
    },
    catImageUpload: function (catId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      pickAndUploadImage(['category-image', catId], function (url) { setCatImage(catId, url); });
    },
    catImageRemove: function (catId) {
      if (!canEdit()) { if (window.showToast) showToast('No permission to edit your shop.', true); return; }
      var b = window.HomepageBridge; if (!b || !b.images || !b.images.removeConfirmed) return;
      var coverId = (WV2_CATIMG && WV2_CATIMG.cat === catId) ? WV2_CATIMG.coverId : '';
      if (!coverId) return;
      Promise.resolve(b.images.removeConfirmed(coverId)).then(function () { fillCategoryImage(catId); });
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
    // The async catalog-import subsystem is NOT rebuilt natively — it lives in its
    // own dedicated lazy module (modules/website-import.js, route 'website-import'),
    // relocated out of website.js (T6 rip-and-replace PR2). This door deep-links to
    // it; the module renders the wizard + a "← Back to Your Website" link to here.
    openImport: function () {
      if (typeof navigateTo === 'function') navigateTo('website-import');
    },

    // Card 4 · viewport toggle — resize the existing frame in place (no reload,
    // no flash); just restyle width/height + update the toggle button states.
    setPreviewViewport: function (vp) {
      if (!PREVIEW_WIDTHS[vp]) return;
      V2.previewVP = vp;
      var frame = document.getElementById('wv2PreviewFrame');
      if (frame) {
        frame.style.width = PREVIEW_WIDTHS[vp];
        frame.style.height = vp === 'mobile' ? '720px' : '600px';
      }
      // Reflect the active state on the toggle buttons without reloading the frame.
      var grp = document.querySelector('.wv2-vp-group');
      if (grp) {
        var btns = grp.querySelectorAll('.wv2-vp');
        for (var i = 0; i < btns.length; i++) {
          var b = btns[i];
          var isOn = (b.getAttribute('onclick') || '').indexOf("'" + vp + "'") !== -1;
          b.classList.toggle('on', isOn);
          b.setAttribute('aria-pressed', String(isOn));
        }
      }
    },
    // Card 4 · manual refresh — force the iframe to refetch the live storefront.
    refreshPreview: function () { reloadPreviewNow(); },

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
  window.wv2PickLook = function (id) { window.WebsiteV2.pickLook(id); };

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
      Promise.resolve(MastDB.get('public/config/categories')).catch(function () { return null; }),
      // Card 2 (Your words & pictures) read: featured testimonials
      // (public/testimonials — keyed map written by the Customer Service ›
      // Reviews "Feature on site" flow). The builder only TOGGLES per-testimonial
      // visibility (show/hide on the homepage WITHOUT un-featuring) — add/remove
      // stays in CS › Reviews. Guarded/cold-safe.
      Promise.resolve(MastDB.get('public/testimonials')).catch(function () { return null; })
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
      // Card 2: featured testimonials (keyed map → public/testimonials/{key}).
      V2.testimonials = r[8] || {};
      V2.loaded = true;
      render();
      // Products power the delete-safety count + stray-category suggestions; read
      // them cold-safe AFTER the first paint (never blocks the card) and re-mount
      // Card 3 once counts land.
      loadProductCats();
      // The Looks gallery (Card 1) reads the template registry via
      // WebsiteBridge.getTemplates — cold-safe + AFTER the first paint, same as
      // products, so the card shows a "Loading your Looks…" line then fills.
      loadLooks();
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
        var counts = {}, byCat = {};
        arr.forEach(function (p) {
          var slugs = productCatSlugs(p);
          var sum = { pid: p.pid || p.id || p._key, name: p.name || '(untitled)', priceCents: (typeof p.priceCents === 'number' ? p.priceCents : null), status: p.status || 'active', image: (Array.isArray(p.images) && p.images[0]) || '' };
          slugs.forEach(function (s) { if (s) { counts[s] = (counts[s] || 0) + 1; (byCat[s] = byCat[s] || []).push(sum); } });
        });
        V2.productCatCounts = counts;
        V2.productsByCat = byCat;                 // catSlug → [product summaries] for the category record's Products tab
        V2.suggestions = computeSuggestions(counts);
        mountShop();
      }).catch(function (e) { console.warn('[website-v2] product cats', e && e.message); });
    } catch (e) { console.warn('[website-v2] product cats', e && e.message); }
  }
  // Read the template registry (the "Looks" list) cold-safe through
  // WebsiteBridge.getTemplates — the legacy registry/manifest fetch. Never
  // blocks the card: on any failure the Looks grid degrades to an empty state.
  // Re-mounts Card 1 once the list lands. Called after the first paint + after a
  // switch (so the "current" flag + checked tile reflect the new template).
  function loadLooks() {
    if (!window.WebsiteBridge || typeof window.WebsiteBridge.getTemplates !== 'function') {
      // host not ready yet — ensureHostModules warms website-core, retry shortly
      try { if (window.MastAdmin && MastAdmin.loadModule) MastAdmin.loadModule('website-core'); } catch (e) {}
      setTimeout(function () {
        if (window.WebsiteBridge && typeof window.WebsiteBridge.getTemplates === 'function') loadLooks();
      }, 400);
      return;
    }
    Promise.resolve(window.WebsiteBridge.getTemplates()).then(function (list) {
      V2.looks = Array.isArray(list) ? list : [];
      refreshLooksGrid();
    }).catch(function (e) {
      console.warn('[website-v2] looks', e && e.message);
      V2.looks = [];
      refreshLooksGrid();
    });
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

  // Host writers + the theme manifest Card 1 delegates to. HomepageBridge
  // (getThemeOptions / setColorScheme + the template-manifest load) and BrandBridge
  // (setLogoFromUrl) are now EAGER — absorbed into this file as sibling IIFEs (T6:
  // homepage.js + brand.js retired), so there is nothing to lazy-load for them.
  // MastBrandSync (brand-sync.js, eager) and WebsiteBridge (the lazy website-core,
  // this builder's host) are the other writers; website-core is still loaded at
  // route setup so the first theme/template write isn't a cold no-op.
  function ensureHostModules() {
    // Warm the homepage data caches the Card 1 swatch grids read. ensureLoaded is
    // ASYNC (fetches the template manifest), so re-render only AFTER it resolves,
    // else the scheme/font swatch grids paint empty.
    try {
      var e = (window.HomepageBridge && HomepageBridge.ensureLoaded) ? HomepageBridge.ensureLoaded() : null;
      if (e && e.then) e.then(function () { render(); }).catch(function () { render(); });
    } catch (e) {}
    // website-core owns WebsiteBridge.setThemeField + the destructive template-switch
    // cascade — a SEPARATE lazy module, load it here so the first write isn't cold.
    try { if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') MastAdmin.loadModule('website-core'); } catch (e) {}
  }

  function routeSetup() {
    ensureHostModules();
    ensureTab();
    render();   // paint the shell immediately (header + placeholders) — cold-safe
    load();     // then hydrate the header + Card 1 from config
  }
  MastAdmin.registerModule('website-v2', {
    routes: {
      'website-v2': { tab: 'websiteV2Tab', setup: routeSetup },
      // Legacy #website route ABSORBED (T6 rip-and-replace PR3): website.js is
      // deleted, so this builder owns the bare route directly (manifest routes:
      // ['website-v2','website'], no MAST_V2_ROUTE_MAP remap, un-gated for ALL
      // users). Without this key ROUTE_MAP['website'] is unset and applyRoute()
      // silently no-ops. Write layer → website-core; AI import → website-import.
      'website': { tab: 'websiteV2Tab', setup: routeSetup },
      // Bare #homepage / #brand routes ABSORBED (T6 — homepage.js + brand.js
      // RETIRED, the last bespoke V1 modules). Their HomepageBridge/BrandBridge +
      // hp*/brand* writers are now eager sibling IIFEs in THIS file. V2 users reach
      // the builder via MAST_V2_ROUTE_MAP[homepage|brand]='website-v2'; Legacy-UI
      // users (remap suppressed) need website-v2 to own the BARE routes here — else
      // applyRoute('homepage'|'brand') silently no-ops once the V1 manifest rows are
      // dropped (the #website / rma-admin precedent). All four routes paint the same
      // single-page builder (routeSetup is route-name-agnostic).
      'homepage': { tab: 'websiteV2Tab', setup: routeSetup },
      'brand': { tab: 'websiteV2Tab', setup: routeSetup }
    }
  });
})();


/* ════════════════════════════════════════════════════════════════════════
   ABSORBED FROM homepage.js (T6 — last bespoke V1 modules retired). The
   HomepageBridge + hp* window writers + page-builder render helpers used to
   live in the lazy modules/homepage.js, lazy-loaded ONLY by
   this builder. homepage.js is DELETED; its body is absorbed here VERBATIM as
   a sibling IIFE so HomepageBridge/hp* are EAGER on website-v2 load (channels-
   v2 / newsletter-v2 absorb-and-cut recipe). Only change vs the original file:
   the MastAdmin.registerModule('homepage') block is dropped — website-v2 now
   owns the bare #homepage route (manifest + registerModule below).
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Homepage Module — Unified section editing + gallery image management
 * Replaces the core Gallery tab and Website > Sections tab
 */
(function() {
  'use strict';

  // --- State ---
  var loaded = false;
  // W1.9 — default to Hero so the edit panel surfaces inline immediately
  // instead of the "Select a section below to edit" empty state. Persona walk
  // 2026-05-22 showed operators tapping the Hero card and getting no
  // visible response (it WAS selected, but the empty state didn't update
  // until they scrolled). Defaulting to 'hero' resolves the perceived
  // affordance gap for every section card, not just Hero — once one is
  // selected, clicking any other card swaps the panel as expected.
  var selectedSection = 'hero';
  var galleryData = {};
  var galleryListener = null;
  var websiteConfig = null;
  var themeConfig = null;
  var templateManifest = null;
  var navSections = null;
  // Persisted homepage section order (public/config/sectionOrder) — the array
  // the storefront reads to order its homepage slots. null until loaded; the
  // HomepageBridge.getSectionOrder/setSectionOrder accessors own it.
  var navSectionOrder = null;
  // W1.8 round-3 — testimonials surfaced in the Page Builder Testimonials
  // section so operators see review-driven entries from public/testimonials/
  // alongside any image-based legacy entries.
  var testimonialsData = {};

  // --- Sync gallery data into the core shell's object without replacing the reference ---
  function syncToGlobal(data) {
    var g = window.gallery;
    // Clear existing keys
    Object.keys(g).forEach(function(k) { delete g[k]; });
    // Copy new data in
    Object.keys(data).forEach(function(k) { g[k] = data[k]; });
  }

  // --- Mark unpublished (shared with website module) ---
  function markUnpublished() {
    if (window.markUnpublished) return window.markUnpublished();
    // Fallback if website module not loaded yet
    MastDB.set('webPresence/config/updatedAt', new Date().toISOString());
  }

  // --- Debounce helper ---
  var debounceTimers = {};
  function debounce(key, fn, delay) {
    clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(fn, delay || 600);
  }

  // --- Section definitions (from website.js SECTION_DEFS) ---
  var SECTION_DEFS = [
    { key: 'hero', name: 'Hero', locked: true, fields: [
      { id: 'headline', label: 'Headline', type: 'text' },
      { id: 'subheadline', label: 'Subheadline', type: 'text' },
      { id: 'ctaText', label: 'Button Text', type: 'text' },
      { id: 'ctaUrl', label: 'Button URL', type: 'text' },
      { id: 'headlineSize', label: 'Headline Size', type: 'select', options: [{ v: 'small', l: 'Small' }, { v: 'medium', l: 'Medium (Default)' }, { v: 'large', l: 'Large' }, { v: 'xl', l: 'Extra Large' }] },
      { id: 'textAlign', label: 'Text Position', type: 'select', options: [{ v: 'left', l: 'Left' }, { v: 'center', l: 'Center (Default)' }, { v: 'right', l: 'Right' }] }
    ]},
    { key: 'gallery', name: 'Products / Gallery', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'columns', label: 'Columns', type: 'number' }
    ]},
    { key: 'about', name: 'About', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'body', label: 'Body Text', type: 'textarea' },
      { id: 'imageUrl', label: 'Image', type: 'image' }
    ]},
    { key: 'contact', name: 'Contact', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'email', label: 'Email', type: 'text' },
      { id: 'phone', label: 'Phone', type: 'text' },
      { id: 'address', label: 'Address', type: 'text' },
      { id: 'showForm', label: 'Show Contact Form', type: 'toggle' }
    ]},
    { key: 'newsletter', name: 'Newsletter', fields: [
      { id: 'heading', label: 'Heading', type: 'text' },
      { id: 'subheadline', label: 'Subheadline', type: 'text' },
      { id: 'buttonLabel', label: 'Button Label', type: 'text' }
    ]},
    { key: 'members', name: 'Members', fields: [
      { id: 'accessModel', label: 'Access Model', type: 'select', options: [{ v: 'passcode', l: 'Passcode' }, { v: 'email', l: 'Email List' }] },
      { id: 'passcode', label: 'Passcode', type: 'text' }
    ]}
  ];

  // --- Variant options ---
  var VARIANT_OPTIONS = {
    hero: [
      { id: 'full-bleed', label: 'Full Bleed', desc: 'Full-width background' },
      { id: 'split-image', label: 'Split Image', desc: 'Image + text side by side' },
      { id: 'minimal-text', label: 'Minimal Text', desc: 'Large text, subtle background' }
    ],
    gallery: [
      { id: 'grid', label: 'Grid', desc: 'Even columns' },
      { id: 'masonry', label: 'Masonry', desc: 'Pinterest-style' },
      { id: 'carousel', label: 'Carousel', desc: 'Swipeable row' }
    ],
    'product-grid': [
      { id: 'card', label: 'Card', desc: 'Standard product cards' },
      { id: 'compact', label: 'Compact', desc: 'Dense, small images' }
    ]
  };

  // --- Data loading ---
  async function loadData() {
    if (loaded) return;

    // Load gallery images
    galleryData = (await MastDB.gallery.list(500)) || {};

    // Load webPresence/config (section content fields)
    websiteConfig = (await MastDB.get('webPresence/config')) || {};

    // Load theme config — try shared data first, then load independently
    themeConfig = MastAdmin.getData('themeConfig');
    if (!themeConfig) {
      themeConfig = (await MastDB.get('public/config/theme')) || {};
    }

    // Load nav sections (enabled states)
    navSections = (await MastDB.get('public/config/nav/sections')) || {};

    // Load persisted homepage section order (public/config/sectionOrder) so the
    // v2 builder's reorder UI seeds from the live order. Empty/absent → the
    // accessor falls back to manifest homepageFlow / section-list order.
    try {
      var _so = await MastDB.get('public/config/sectionOrder');
      navSectionOrder = Array.isArray(_so) ? _so : null;
    } catch (_e) { navSectionOrder = null; }

    // W1.8 round-3 — load review-driven testimonials so the Testimonials
    // section card can surface them with visibility toggles.
    try {
      testimonialsData = (await MastDB.get('public/testimonials')) || {};
    } catch (_e) { testimonialsData = {}; }

    // Load template manifest — try shared data first, then load independently
    templateManifest = MastAdmin.getData('templateManifest');
    if (!templateManifest) {
      var templateId = themeConfig.templateId || 'artisan';
      try {
        var tenantId = MastDB.tenantId();
        var siteUrl = 'https://mast-' + tenantId + '.web.app';
        var resp = await fetch(siteUrl + '/templates/' + templateId + '/manifest.json');
        if (resp.ok) templateManifest = await resp.json();
      } catch (e) {}
      if (!templateManifest) {
        try {
          var resp2 = await fetch('/templates/' + (themeConfig.templateId || 'artisan') + '/manifest.json');
          if (resp2.ok) templateManifest = await resp2.json();
        } catch (e2) {}
      }
    }

    // Sync gallery data into the core shell's gallery object (not replace it).
    // Core shell declares `var gallery = {}` which is also window.gallery.
    // Replacing window.gallery would break the local var reference.
    syncToGlobal(galleryData);

    loaded = true;
  }

  // --- Firebase listeners ---
  function startListeners() {
    if (!galleryListener) {
      galleryListener = MastDB.gallery.listen(500, function(snap) {
        galleryData = snap.val() || {};
        syncToGlobal(galleryData);
        autoReindexIfNeeded();
        if (window.currentRoute === 'homepage') renderHomepage();
      }, function(err) {
        showToast('Error loading gallery: ' + err.message, true);
      });
    }
  }

  function stopListeners() {
    if (galleryListener) {
      MastDB.gallery.unlisten(galleryListener);
      galleryListener = null;
    }
  }

  // --- Section list helpers ---
  function getSectionList() {
    var sections = [];

    if (templateManifest && templateManifest.slots) {
      var categories = ['universal', 'common', 'differentiators'];
      categories.forEach(function(cat) {
        var slots = templateManifest.slots[cat];
        if (!slots) return;
        slots.forEach(function(slot) {
          sections.push({
            id: slot.id,
            label: slot.label || slot.id,
            description: slot.description || '',
            required: slot.required || false,
            prominent: slot.prominent || false,
            category: cat
          });
        });
      });
    }

    // Fallback: use SECTION_DEFS if no manifest
    if (sections.length === 0) {
      SECTION_DEFS.forEach(function(def) {
        sections.push({
          id: def.key,
          label: def.name,
          description: '',
          required: def.locked || false,
          prominent: false,
          category: 'common'
        });
      });
    }

    return sections;
  }

  function getSectionById(sectionId) {
    var list = getSectionList();
    return list.find(function(s) { return s.id === sectionId; }) || null;
  }

  function countGalleryImages(sectionId) {
    return Object.values(galleryData).filter(function(g) {
      return g.section === sectionId && !g.templateHidden;
    }).length;
  }

  function getImagesForSection(sectionId) {
    return Object.entries(galleryData)
      .filter(function(entry) { return entry[1].section === sectionId && !entry[1].templateHidden; })
      .sort(function(a, b) { return (a[1].order || 0) - (b[1].order || 0); });
  }

  // Sections whose gallery images are rendered on the storefront
  var IMAGE_CAPABLE_SECTIONS = ['hero', 'gallery', 'about', 'our-story', 'shop', 'schedule'];

  function hasImageCapability(sectionId) {
    // Only show image controls for sections the storefront actually renders gallery images for
    if (IMAGE_CAPABLE_SECTIONS.indexOf(sectionId) !== -1) return true;
    // Also include any product category sections (dynamic)
    if (typeof SHOP_SECTION_IDS !== 'undefined' && SHOP_SECTION_IDS.indexOf(sectionId) !== -1) return true;
    return false;
  }

  // --- Main render ---
  window.renderHomepage = async function renderHomepage() {
    var root = document.getElementById('homepageModuleRoot');
    if (!root) return;

    if (!loaded) {
      root.innerHTML = '<div class="loading">Loading page builder...</div>';
      await loadData();
    }

    var html = '<div class="section-header"><h2>Page Builder</h2></div>';

    // Storefront capabilities (nav-level destination pages) — the single place
    // to turn storefront pages/features on or off. Writes the SAME store the
    // storefront nav reads (public/config/nav/sections). Distinct from the
    // homepage section cards below, which toggle on-page content blocks.
    html += renderCapabilitiesPanel();

    // Top: Section Cards
    html += renderSectionCards();

    // Bottom: Edit View (selected section details)
    html += '<div class="hp-edit-view" style="margin-top:12px;">';
    html += renderEditView();
    html += '</div>';

    root.innerHTML = html;

    // Post-render: load hero rotation speed if hero is selected
    if (selectedSection === 'hero' && typeof loadHeroRotationSpeed === 'function') {
      loadHeroRotationSpeed();
    }
  }

  // --- Section cards (bottom panel) ---
  function renderSectionCards() {
    var sections = getSectionList();
    var html = '<div class="hp-cards-row">';

    sections.forEach(function(sec) {
      var isSelected = selectedSection === sec.id;
      var navData = (navSections && navSections[sec.id]) || {};
      var wpData = (websiteConfig && websiteConfig.sections && websiteConfig.sections[sec.id]) || {};
      var enabled = sec.required ? true : (navData.enabled !== false && wpData.enabled !== false);
      var imageCount = countGalleryImages(sec.id);

      html += '<div class="hp-card' + (isSelected ? ' selected' : '') + (!enabled ? ' disabled' : '') + '" onclick="hpSelectSection(\'' + sec.id + '\')">';
      html += '<div class="hp-card-header">';
      html += '<span class="hp-card-name">' + esc(sec.label) + '</span>';
      if (imageCount > 0) {
        html += '<span class="hp-card-badge">' + imageCount + '</span>';
      }
      html += '</div>';
      // Toggle
      if (!sec.required) {
        html += '<label class="toggle-switch hp-card-toggle" onclick="event.stopPropagation();">';
        html += '<input type="checkbox"' + (enabled ? ' checked' : '') + ' onchange="hpToggleSection(\'' + sec.id + '\', this.checked)">';
        html += '<span class="toggle-slider"></span>';
        html += '</label>';
      }
      html += '</div>';
    });

    html += '</div>';
    return html;
  }

  // --- Storefront capabilities panel (nav-level destination pages) ---
  // Each entry toggles public/config/nav/sections/{id}/enabled via the shared
  // hpToggleSection writer (which also mirrors webPresence + markUnpublished).
  // `def` mirrors the corrected DEFAULT_SECTIONS fallback in storefront-nav.js,
  // so the panel shows the same on/off state the storefront resolves when a
  // tenant's nav/sections is sparse. about/contact/newsletter are NOT listed
  // here — they are homepage content sections owned by the section cards above.
  var STOREFRONT_CAPABILITIES = [
    { id: 'shop',       label: 'Shop',        def: true,  hint: 'Your product catalog. Needs active products to sell.' },
    { id: 'blog',       label: 'Blog',        def: true,  hint: 'Long-form posts. Shows entries once you publish posts.' },
    { id: 'schedule',   label: 'Schedule',    def: false, hint: 'Upcoming events & shows, pulled from your events.' },
    { id: 'classes',    label: 'Classes',     def: false, hint: 'Bookable classes. Needs the booking module.' },
    { id: 'wholesale',  label: 'Wholesale',   def: false, hint: 'B2B catalog. Needs wholesale pricing on products.' },
    { id: 'commission', label: 'Commissions', def: false, hint: 'Let visitors request custom commission work.' },
    { id: 'giftcards',  label: 'Gift Cards',  def: false, hint: 'Sell gift cards. Needs gift cards enabled in Wallet.' }
  ];

  function capabilityEnabled(id, def) {
    var s = navSections && navSections[id];
    if (s && typeof s.enabled !== 'undefined') return s.enabled !== false;
    return def;
  }

  function renderCapabilitiesPanel() {
    var html = '<div class="wv2-capabilities" style="margin-bottom:16px;padding:14px 16px;background:var(--surface-card);border:1px solid var(--warm-gray);border-radius:8px;">';
    html += '<h3 style="margin:0;font-size:1.0rem;color:var(--text-primary);">Storefront Pages &amp; Features</h3>';
    html += '<p style="margin:4px 0 12px;font-size:0.78rem;color:var(--warm-gray);">Turn storefront capabilities on or off. Each adds or removes its page and nav link on your live site.</p>';
    STOREFRONT_CAPABILITIES.forEach(function(cap) {
      var on = capabilityEnabled(cap.id, cap.def);
      html += '<div class="wv2-cap-row" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid color-mix(in srgb, var(--warm-gray) 30%, transparent);">';
      html += '<div style="min-width:0;">';
      html += '<div style="font-size:0.85rem;color:var(--text-primary);">' + esc(cap.label) + '</div>';
      html += '<div style="font-size:0.72rem;color:var(--warm-gray);">' + esc(cap.hint) + '</div>';
      html += '</div>';
      html += '<label class="toggle-switch" onclick="event.stopPropagation();" style="flex:0 0 auto;">';
      html += '<input type="checkbox"' + (on ? ' checked' : '') + ' onchange="hpToggleSection(\'' + cap.id + '\', this.checked)">';
      html += '<span class="toggle-slider"></span>';
      html += '</label>';
      html += '</div>';
    });
    html += '</div>';
    return html;
  }

  // --- Edit view (top panel) ---
  function renderEditView() {
    if (!selectedSection) {
      // W1.9 — fallback empty state. With default selectedSection='hero'
      // operators should rarely hit this; left in place for the case where
      // a section gets cleared programmatically.
      return '<div class="hp-edit-empty"><p>Click any section card below to edit its content and images.</p></div>';
    }

    var sec = getSectionById(selectedSection);
    if (!sec) return '';

    var html = '';

    // Header with section name + variant picker
    html += '<div class="hp-edit-header">';
    html += '<h3>' + esc(sec.label) + '</h3>';
    var variantHtml = renderVariantPicker(sec.id);
    if (variantHtml) html += '<div style="display:flex;align-items:center;gap:4px;">' + variantHtml + '</div>';
    html += '</div>';

    // Section content fields
    html += '<div class="hp-edit-fields">';
    html += renderSectionFields(sec.id);
    html += '</div>';

    // W1.8 round-3 — Testimonials section: render the review-driven list
    // (public/testimonials/) above the legacy image grid. Each row shows the
    // quote/author/rating/product with a Hide/Show toggle (visibility flag
    // on the testimonial doc). Image-grid below remains for any legacy
    // image-style entries.
    if (sec.id === 'testimonials') {
      html += renderTestimonialsList();
    }

    // Gallery images for this section
    var sectionImages = getImagesForSection(sec.id);
    if (sectionImages.length > 0 || hasImageCapability(sec.id)) {
      html += '<div class="hp-edit-gallery">';
      html += '<div class="hp-gallery-header">';
      html += '<h4>Images (' + sectionImages.length + ')</h4>';
      html += '<div style="display:flex;gap:8px;align-items:center;">';
      if (sec.id === 'hero') {
        html += '<select id="heroRotationSpeed" onchange="saveHeroRotationSpeed(this.value)" style="font-size:0.78rem;padding:3px 8px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);cursor:pointer;" title="Image rotation speed">' +
          '<option value="3">3s</option><option value="4">4s</option><option value="5">5s</option><option value="6" selected>6s</option><option value="8">8s</option><option value="10">10s</option><option value="15">15s</option><option value="20">20s</option>' +
          '</select>';
      }
      html += '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;" onclick="hpAddImage(\'' + sec.id + '\')">+ Add from Library</button>';
      html += '</div>';
      html += '</div>';
      html += renderSectionImageGrid(sec.id, sectionImages);
      html += '</div>';
    }

    return html;
  }

  // --- Variant picker ---
  function renderVariantPicker(sectionId) {
    var options = VARIANT_OPTIONS[sectionId];
    if (!options) return '';

    var tc = themeConfig || {};
    var m = templateManifest || {};
    var variantKey = sectionId === 'product-grid' ? 'productGridVariant' : sectionId + 'Variant';
    var currentVariant = tc[variantKey] || m[variantKey] || options[0].id;
    var defaultVariant = m[variantKey] || options[0].id;

    var html = '<select onclick="event.stopPropagation();" onchange="hpUpdateThemeField(\'' + variantKey + '\', this.value)" style="font-size:0.78rem;padding:3px 6px;border-radius:6px;background:var(--charcoal-light, #333);color:var(--text-primary, #e0e0e0);border:1px solid var(--charcoal-light, #444);cursor:pointer;min-width:100px;">';
    options.forEach(function(opt) {
      var selected = currentVariant === opt.id ? ' selected' : '';
      html += '<option value="' + opt.id + '"' + selected + ' title="' + esc(opt.desc) + '">' + esc(opt.label) + '</option>';
    });
    html += '</select>';

    if (currentVariant !== defaultVariant) {
      html += '<span style="font-size:0.72rem;color:var(--warm-gray);margin-left:4px;" title="Template default: ' + esc(defaultVariant) + '">&#8226; customized</span>';
    }

    return html;
  }

  // --- Section fields ---
  function renderSectionFields(sectionId) {
    var matchingDef = SECTION_DEFS.find(function(d) { return d.key === sectionId; });
    if (!matchingDef || !matchingDef.fields) return '';

    var sectionData = (websiteConfig && websiteConfig.sections && websiteConfig.sections[sectionId]) || {};
    var html = '';

    matchingDef.fields.forEach(function(field) {
      html += renderFieldInput(sectionId, field, sectionData);
    });

    if (sectionId === 'contact') {
      html += renderSocialLinks(sectionData.socialLinks || {});
    }

    return html;
  }

  function renderFieldInput(sectionKey, field, data) {
    var val = data[field.id] !== undefined ? data[field.id] : '';
    var inputId = 'hp-' + sectionKey + '-' + field.id;
    var html = '<div class="wp-field-group">';
    html += '<label for="' + inputId + '">' + esc(field.label) + '</label>';

    if (field.type === 'text') {
      html += '<input type="text" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">';
    } else if (field.type === 'textarea') {
      html += '<textarea id="' + inputId + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">' + esc(String(val)) + '</textarea>';
    } else if (field.type === 'number') {
      html += '<input type="number" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', parseInt(this.value) || 0)">';
    } else if (field.type === 'select') {
      html += '<select id="' + inputId + '" onchange="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)">';
      (field.options || []).forEach(function(opt) {
        html += '<option value="' + opt.v + '"' + (String(val) === opt.v ? ' selected' : '') + '>' + esc(opt.l) + '</option>';
      });
      html += '</select>';
    } else if (field.type === 'toggle') {
      html += '<label class="toggle-switch"><input type="checkbox"' + (val ? ' checked' : '') + ' onchange="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.checked)"><span class="toggle-slider"></span></label>';
    } else if (field.type === 'image') {
      html += '<div style="display:flex;gap:8px;align-items:center;">';
      html += '<input type="text" id="' + inputId + '" value="' + esc(String(val)) + '" oninput="hpUpdateField(\'' + sectionKey + '\', \'' + field.id + '\', this.value)" style="flex:1;">';
      html += '<button class="btn btn-secondary" onclick="hpPickImage(\'' + sectionKey + '\', \'' + field.id + '\')">Browse</button>';
      html += '</div>';
      if (val) {
        html += '<img src="' + esc(String(val)) + '" style="max-width:200px;max-height:120px;border-radius:6px;margin-top:8px;" alt="">';
      }
    }
    html += '</div>';
    return html;
  }

  // W1.8 round-3 — render the testimonials list (review-driven entries from
  // public/testimonials/). Each row: quote text, author, rating stars,
  // product link, source ("From review"), + visibility toggle. Sorted
  // newest first (matches storefront ordering).
  function renderTestimonialsList() {
    var entries = Object.keys(testimonialsData)
      .map(function(k) { var t = testimonialsData[k] || {}; return Object.assign({}, t, { _key: k }); })
      .filter(function(t) { return t.quote; })
      .sort(function(a, b) { return (b.order || 0) - (a.order || 0); });

    var html = '<div class="hp-edit-gallery"><div class="hp-gallery-header">';
    html += '<h4>Featured testimonials (' + entries.length + ')</h4>';
    html += '<span style="font-size:0.78rem;color:var(--warm-gray);">Featured from Customer Service › Reviews</span>';
    html += '</div>';

    if (entries.length === 0) {
      // Kept bespoke: the wrapper's padding:20px overrides .empty-state's default
      // 40px 20px (compact gallery context); the emptyState engine has no style hook.
      html += '<div class="empty-state" style="padding:20px;">' +
        '<p>No testimonials featured yet. Approve a review in Customer Service and click "Feature on site" to add one here.</p>' +
      '</div></div>';
      return html;
    }

    html += '<div style="display:flex;flex-direction:column;gap:8px;">';
    entries.forEach(function(t) {
      var stars = t.rating ? ('★ '.repeat(Math.max(0, Math.min(5, parseInt(t.rating, 10) || 0))).trim()) : '';
      var visible = t.visible !== false;
      var keyEsc = esc(t._key);
      html += '<div style="display:flex;gap:12px;padding:12px;background:var(--surface-card);border:1px solid var(--cream-dark);border-radius:8px;align-items:flex-start;">';
      html += '<div style="flex:1;min-width:0;">';
      if (stars) html += '<div style="color:var(--amber);letter-spacing:0.15em;font-size:0.85rem;margin-bottom:4px;">' + stars + '</div>';
      html += '<div style="font-size:0.9rem;font-style:italic;color:var(--text-primary);margin-bottom:4px;">“' + esc(t.quote) + '”</div>';
      // W1.8 round-4 — read author with proper fallback chain. Round-3 writes
      // populated `author` + `customerName`, but pre-W1.7-schema-fix entries
      // may have `author:"Anonymous"` baked in. Prefer `customerName` (admin
      // view canonical), then `author`, then raw review fields if present.
      var authorName = t.customerName || t.author || t.authorName || t.reviewerName || '';
      html += '<div style="font-size:0.78rem;color:var(--warm-gray);">';
      if (authorName) html += '— ' + esc(authorName);
      if (t.productName) html += ' · ' + esc(t.productName);
      if (t.sourceReviewId) html += ' · <span title="Featured from a review">From review</span>';
      html += '</div></div>';
      html += '<label class="toggle-switch" title="' + (visible ? 'Visible on site — click to hide' : 'Hidden — click to show') + '" style="flex-shrink:0;">';
      html += '<input type="checkbox"' + (visible ? ' checked' : '') + ' onchange="hpToggleTestimonialVisible(\'' + keyEsc + '\', this.checked)">';
      html += '<span class="toggle-slider"></span></label>';
      html += '</div>';
    });
    html += '</div></div>';
    return html;
  }

  function renderSocialLinks(links) {
    var platforms = ['instagram', 'facebook', 'etsy', 'pinterest', 'tiktok', 'twitter', 'youtube'];
    var html = '<h4 style="font-size:0.9rem;margin:16px 0 8px;">Social Links</h4>';
    platforms.forEach(function(p) {
      html += '<div class="wp-field-group">';
      html += '<label>' + p.charAt(0).toUpperCase() + p.slice(1) + '</label>';
      html += '<input type="url" value="' + esc(links[p] || '') + '" oninput="hpUpdateSocial(\'' + p + '\', this.value)" placeholder="https://">';
      html += '</div>';
    });
    return html;
  }

  // --- Image grid for a section ---
  function renderSectionImageGrid(sectionId, items) {
    if (items.length === 0) {
      // Kept bespoke: the wrapper's padding:20px overrides .empty-state's default
      // 40px 20px (compact gallery context); the emptyState engine has no style hook.
      return '<div class="empty-state" style="padding:20px;"><p>No images yet. Click "+ Add from Library" to add one.</p></div>';
    }

    var html = '<div class="gallery-grid">';
    items.forEach(function(entry, idx) {
      var id = entry[0];
      var img = entry[1];
      var isFirst = idx === 0;
      var isLast = idx === items.length - 1;
      var isVidEntry = img.videoUrl || /\.(mp4|mov|webm)/i.test(img.url || '');

      html += '<div class="gallery-card">';
      if (isVidEntry) {
        html += '<div class="gallery-card-img" style="display:flex;align-items:center;justify-content:center;background:var(--charcoal);color:var(--amber);font-size:1.6rem;min-height:120px;">&#9654;</div>';
      } else if (img.url) {
        var fitStyle = img.imageFit ? ' style="object-fit:' + img.imageFit + ';"' : '';
        html += '<img class="gallery-card-img" src="' + esc(img.url) + '" alt="' + esc(img.alt || '') + '"' + fitStyle + ' onerror="this.classList.add(\'broken\')">';
      }
      html += '<div class="gallery-card-body">';
      html += '<div class="gallery-card-caption">' + esc(img.caption || img.alt || img.productName || '') + '</div>';
      html += '<div class="gallery-card-meta">';

      // Show relevant metadata per section
      if (typeof SHOP_SECTION_IDS !== 'undefined' && SHOP_SECTION_IDS.indexOf(sectionId) !== -1 && img.productName) {
        html += '<span class="category-badge">' + esc(img.productName) + '</span>';
        if (img.price) html += '<span class="category-badge" style="background:var(--teal);color:white;">' + esc(img.price) + '</span>';
      } else if (sectionId === 'gallery') {
        html += '<span class="category-badge">' + esc(img.category || 'other') + '</span>';
      } else if (sectionId === 'hero' && img.videoUrl) {
        html += '<span class="category-badge" style="font-size:0.72rem;">video + poster</span>';
      }

      html += '<span class="order-num">#' + (img.order || 0) + '</span>';
      html += '</div>';
      html += '<div class="gallery-card-actions">';

      if (items.length > 1) {
        html += '<button class="btn-icon" onclick="moveImage(\'' + id + '\', \'up\')" title="Move up"' + (isFirst ? ' disabled' : '') + '>\u2191</button>';
        html += '<button class="btn-icon" onclick="moveImage(\'' + id + '\', \'down\')" title="Move down"' + (isLast ? ' disabled' : '') + '>\u2193</button>';
      }

      html += '<button class="visibility-toggle' + (img.visible !== false ? '' : ' hidden') + '" onclick="toggleImageVisibility(\'' + id + '\')" title="Toggle visibility">' +
        (img.visible !== false ? '\u{1F441}' : '\u{1F6AB}') + '</button>';
      html += '<button class="btn-icon" onclick="openImageModal(\'' + id + '\')" title="Edit">\u270E</button>';
      html += '<button class="btn-icon danger" onclick="confirmDeleteImage(\'' + id + '\')" title="Delete">\u2716</button>';
      html += '</div></div></div>';
    });
    html += '</div>';

    // Template-hidden images notice for this section
    var hiddenCount = Object.values(galleryData).filter(function(g) {
      return g.section === sectionId && g.templateHidden;
    }).length;
    if (hiddenCount > 0) {
      html += '<div style="margin-top:8px;padding:8px 12px;background:color-mix(in srgb, var(--amber, var(--amber)) 10%, transparent);border:1px solid color-mix(in srgb, var(--amber, var(--amber)) 25%, transparent);border-radius:6px;font-size:0.78rem;color:var(--warm-gray);">';
      html += hiddenCount + ' image' + (hiddenCount !== 1 ? 's' : '') + ' hidden by template switch';
      html += '</div>';
    }

    return html;
  }

  // --- Window handlers ---
  window.hpSelectSection = function(sectionId) {
    selectedSection = sectionId;
    renderHomepage();
  };

  window.hpToggleSection = async function(sectionId, enabled) {
    try {
      await MastDB.set('public/config/nav/sections/' + sectionId + '/enabled', enabled);
      if (!navSections) navSections = {};
      if (!navSections[sectionId]) navSections[sectionId] = {};
      navSections[sectionId].enabled = enabled;

      if (!websiteConfig.sections) websiteConfig.sections = {};
      if (!websiteConfig.sections[sectionId]) websiteConfig.sections[sectionId] = {};
      websiteConfig.sections[sectionId].enabled = enabled;
      await MastDB.set('webPresence/config/sections/' + sectionId + '/enabled', enabled);
      markUnpublished();
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
    renderHomepage();
  };

  window.hpUpdateField = function(sectionKey, fieldId, value) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections[sectionKey]) websiteConfig.sections[sectionKey] = {};
    websiteConfig.sections[sectionKey][fieldId] = value;
    debounce('hp-field-' + sectionKey + '-' + fieldId, function() {
      MastDB.set('webPresence/config/sections/' + sectionKey + '/' + fieldId, value);
      markUnpublished();
    });
  };

  window.hpUpdateThemeField = async function(field, value) {
    if (!themeConfig) themeConfig = {};
    themeConfig[field] = value;
    try {
      await MastDB.set('public/config/theme/' + field, value);
      markUnpublished();
      var labels = {
        heroVariant: 'Hero layout',
        galleryVariant: 'Gallery layout',
        productGridVariant: 'Product grid layout'
      };
      showToast((labels[field] || field) + ' updated.');
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
    renderHomepage();
  };

  window.hpUpdateSocial = function(platform, value) {
    if (!websiteConfig.sections) websiteConfig.sections = {};
    if (!websiteConfig.sections.contact) websiteConfig.sections.contact = {};
    if (!websiteConfig.sections.contact.socialLinks) websiteConfig.sections.contact.socialLinks = {};
    websiteConfig.sections.contact.socialLinks[platform] = value;
    debounce('hp-social-' + platform, function() {
      MastDB.set('webPresence/config/sections/contact/socialLinks/' + platform, value);
      markUnpublished();
    });
  };

  window.hpAddImage = function(sectionId) {
    if (typeof openImagePicker === 'function') {
      openImagePicker(function(imgId, url, thumbUrl) {
        var libImg = (window.imageLibrary || {})[imgId] || {};
        setTimeout(function() { openGalleryMetadataModal(sectionId, url, imgId, libImg); }, 200);
      });
    } else {
      showToast('Image picker not available.', true);
    }
  };

  window.hpPickImage = function(sectionKey, fieldId) {
    // Single-source the single-image-field write through HomepageBridge.images
    // (pickField → setField → webPresence/config/sections/{key}/{field}, then
    // notifyGalleryChanged re-renders the open page builder). Shared with the
    // website-v2 Card 2 inline image-field control so V1 + V2 never drift.
    window.HomepageBridge.images.pickField(sectionKey, fieldId);
  };

  // W1.8 round-3 — toggle testimonial visibility from the Page Builder
  // Testimonials card. Writes to public/testimonials/{key}/visible; the
  // storefront index.html testimonials loader filters on visible !== false.
  window.hpToggleTestimonialVisible = async function(key, visible) {
    if (!testimonialsData[key]) testimonialsData[key] = {};
    testimonialsData[key].visible = !!visible;
    try {
      await MastDB.set('public/testimonials/' + key + '/visible', !!visible);
      showToast(visible ? 'Testimonial shown on site.' : 'Testimonial hidden.');
    } catch (err) {
      showToast('Error: ' + err.message, true);
    }
    renderHomepage();
  };

  // --- HomepageBridge (additive) ---
  // Thin shim for the v2 read-on-page twin (homepage-v2.js). Every method
  // DELEGATES to the existing legacy write logic above — the twin never
  // reimplements a storefront write. The arg-taking writers (hpToggleSection,
  // hpUpdateField, hpUpdateThemeField, hpToggleTestimonialVisible, hpUpdateSocial)
  // read no DOM and are called by the twin directly; only setColorScheme needs a
  // shim because its custom-override cleanup is not exposed as a window fn (it
  // lives in website.js' wpSelectScheme, which also re-renders the website tab —
  // unsafe to call from the homepage twin). This mirrors that exact logic.
  window.HomepageBridge = {
    // Set a manifest color scheme. Mirrors website.js wpSelectScheme: write the
    // scheme id and clear any custom primary/accent overrides so the scheme wins.
    setColorScheme: async function (schemeId) {
      if (!themeConfig) themeConfig = {};
      themeConfig.colorSchemeId = schemeId;
      delete themeConfig.primaryColor;
      delete themeConfig.accentColor;
      await MastDB.set('public/config/theme/colorSchemeId', schemeId);
      await MastDB.remove('public/config/theme/primaryColor');
      await MastDB.remove('public/config/theme/accentColor');
      markUnpublished();
      return schemeId;
    },
    // Expose the loaded template manifest (color schemes + font pairs) so the
    // twin can render native scheme/font choosers without re-fetching.
    // ALSO exposes the per-section layout VARIANT options + their manifest
    // defaults (website-v2 Card 2's variant pickers — closing homepage-v2's
    // legacy variant hatch) and the canonical section list (manifest slots,
    // SECTION_DEFS fallback) so the twin doesn't re-derive either.
    getThemeOptions: function () {
      var m = templateManifest || {};
      return {
        schemes: m.colorSchemes || [],
        fonts: m.fontPairs || [],
        templateName: m.name || null,
        // variants: { hero:[{id,label,desc}], gallery:[…], 'product-grid':[…] }
        variants: VARIANT_OPTIONS,
        // variantDefaults: the manifest's heroVariant/galleryVariant/
        // productGridVariant (the "template default" the twin compares against).
        variantDefaults: {
          hero: m.heroVariant || (VARIANT_OPTIONS.hero[0] || {}).id,
          gallery: m.galleryVariant || (VARIANT_OPTIONS.gallery[0] || {}).id,
          'product-grid': m.productGridVariant || (VARIANT_OPTIONS['product-grid'][0] || {}).id
        }
      };
    },
    // The canonical homepage section list (manifest slots → SECTION_DEFS
    // fallback): [{id,label,required,…}]. Single-sources getSectionList() so the
    // twin's Card 2 list matches the page builder exactly.
    getSectionList: function () { return getSectionList(); },
    // The editable content fields per section type (mirrors SECTION_DEFS) so the
    // twin renders the same inline text inputs the page builder does, keyed by
    // section id. Returns { hero:[{id,label,type,options?}], … }.
    getSectionFields: function () {
      var out = {};
      SECTION_DEFS.forEach(function (d) { out[d.key] = d.fields || []; });
      return out;
    },
    // Current homepage section order — the persisted public/config/sectionOrder
    // array if set, else the manifest homepageFlow, else the section-list order.
    // Single-sources the order read so the twin's reorder UI seeds correctly.
    getSectionOrder: function () {
      if (Array.isArray(navSectionOrder) && navSectionOrder.length) return navSectionOrder.slice();
      var m = templateManifest || {};
      if (Array.isArray(m.homepageFlow) && m.homepageFlow.length) return m.homepageFlow.slice();
      return getSectionList().map(function (s) { return s.id; });
    },
    // Persist a reordered homepage section order → public/config/sectionOrder.
    // Single-source writer (the storefront reads this array to order its slots);
    // keeps the cache in sync + marks the site unpublished like every other
    // homepage write. orderIds: array of section ids in display order.
    setSectionOrder: async function (orderIds) {
      orderIds = (orderIds || []).filter(function (x) { return !!x; });
      navSectionOrder = orderIds.slice();
      await MastDB.set('public/config/sectionOrder', orderIds);
      markUnpublished();
      return orderIds;
    },
    // Read-through theme config so the twin can refresh after a delegated write
    // without touching this module's private caches.
    getThemeConfig: async function () {
      return (await MastDB.get('public/config/theme').catch(function () { return null; })) || {};
    },
    // Ensure section content + theme + testimonials are loaded so the twin's
    // delegated writes operate on populated caches. Idempotent.
    ensureLoaded: function () { return loadData(); },

    // ── Section image management (Card 2 native image editing) ──────────
    // The single write path for per-section images, shared by the legacy page
    // builder and the website-v2 Card 2 slide-out. Every method DELEGATES to the
    // existing shared writers (window.openImageModal / openImagePicker /
    // openGalleryMetadataModal / moveImage / toggleImageVisibility /
    // confirmDeleteImage) or to a DOM-free core here — the twin never writes
    // MastDB.gallery itself. Data shape is unchanged: a gallery doc carries
    // { section, url, alt, caption, category, order, visible, imageFit, … } and
    // the storefront reads it per section (getImagesForSection). Single-image
    // FIELDS (e.g. about.imageUrl) write webPresence/config/sections/{key}/{field}.
    images: {
      // Section ids the storefront renders gallery images for (mirrors the page
      // builder's hasImageCapability — includes dynamic shop-category sections).
      isCapable: function (sectionId) { return hasImageCapability(sectionId); },
      // The canonical section list filtered to image-capable sections.
      capableSections: function () {
        return getSectionList().filter(function (s) { return hasImageCapability(s.id); });
      },
      // Count of visible gallery images in a section (excludes template-hidden).
      count: function (sectionId) { return countGalleryImages(sectionId); },
      // Count of images this section lost to a template switch (the grid footer).
      hiddenCount: function (sectionId) {
        return Object.values(galleryData).filter(function (g) {
          return g.section === sectionId && g.templateHidden;
        }).length;
      },
      // Fresh-fetch the gallery collection, sync it into the core shell's
      // window.gallery (so the shared index.html writers — moveImage /
      // openImageModal / confirmDeleteImage / getNextOrder — operate on current
      // data even off the homepage route, where no gallery listener is armed),
      // and return this section's images sorted by order: [[id, imgDoc], …].
      list: async function (sectionId) {
        galleryData = (await MastDB.gallery.list(500)) || {};
        syncToGlobal(galleryData);
        return getImagesForSection(sectionId);
      },
      // The per-section image grid markup — the EXACT renderer the page builder
      // uses (gallery-card per image, video handling, reorder/visibility/edit/
      // delete buttons wired to the shared window.* writers). Call list() first
      // so window.gallery + galleryData are current. Single-sources the grid so
      // V1 + V2 never drift.
      gridHtml: function (sectionId, items) {
        return renderSectionImageGrid(sectionId, items || getImagesForSection(sectionId));
      },
      // Add an image from the shared library → metadata modal → a gallery doc
      // carrying { section }. Same flow hpAddImage uses; the modal's save fires
      // window.notifyGalleryChanged() so an open V2 slide-out refreshes.
      addFromLibrary: function (sectionId) {
        if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable.', true); return; }
        window.openImagePicker(function (imgId, url) {
          var libImg = (window.imageLibrary || {})[imgId] || {};
          setTimeout(function () {
            if (typeof window.openGalleryMetadataModal === 'function') window.openGalleryMetadataModal(sectionId, url, imgId, libImg);
          }, 200);
        });
      },
      // Add an image by upload (or pasted URL) → the full add modal in upload
      // mode, section preset. saveImage routes uploads through the /uploadImage
      // CF / Storage exactly like the page builder.
      addByUpload: function (sectionId) {
        if (typeof window.openImageModal !== 'function') { if (window.showToast) showToast('Image editor unavailable.', true); return; }
        window.openImageModal(null, sectionId);
      },
      // Edit one image's metadata (caption/alt/category/product/video/visibility)
      // via the shared full modal.
      edit: function (imageId) {
        if (typeof window.openImageModal === 'function') window.openImageModal(imageId);
      },
      // Remove an image (shared confirm → deleteImage → MastDB.gallery.remove).
      remove: function (imageId) {
        if (typeof window.confirmDeleteImage === 'function') window.confirmDeleteImage(imageId);
      },
      // DOM-free add of a library/uploaded image to a section (no legacy modal) —
      // for the engine image-manager drill. Writes the SAME gallery-doc shape
      // saveGalleryFromLibrary does: { section, url, alt, caption, order, visible,
      // libraryImageId }. Returns the new key. opts: { url, imgId?, alt?, caption? }.
      addFromLibraryDirect: async function (sectionId, opts) {
        opts = opts || {};
        var url = opts.url; if (!url) return null;
        var maxOrder = 0;
        Object.values(galleryData).forEach(function (g) { if (g.section === sectionId && (g.order || 0) > maxOrder) maxOrder = g.order; });
        var data = {
          url: url, alt: (opts.alt != null ? opts.alt : '') || '', caption: opts.caption || '',
          section: sectionId, visible: true, order: maxOrder + 1,
          createdAt: MastDB.serverTimestamp(), updatedAt: MastDB.serverTimestamp()
        };
        if (opts.imgId) data.libraryImageId = opts.imgId;
        var key = MastDB.gallery.newKey();
        await MastDB.gallery.set(key, data);
        if (typeof window.writeAudit === 'function') { try { await window.writeAudit('create', 'gallery', key); } catch (e) {} }
        galleryData = (await MastDB.gallery.list(500)) || {}; syncToGlobal(galleryData);
        if (typeof window.notifyGalleryChanged === 'function') window.notifyGalleryChanged();
        return key;
      },
      // DOM-free metadata patch (alt/caption/category/visible/order) for the
      // engine drill's inline editors. Mirrors saveImage's update branch.
      updateImageMeta: async function (imageId, patch) {
        patch = Object.assign({}, patch || {}); patch.updatedAt = MastDB.serverTimestamp();
        await MastDB.gallery.update(imageId, patch);
        if (typeof window.writeAudit === 'function') { try { await window.writeAudit('update', 'gallery', imageId); } catch (e) {} }
        galleryData = (await MastDB.gallery.list(500)) || {}; syncToGlobal(galleryData);
        if (typeof window.notifyGalleryChanged === 'function') window.notifyGalleryChanged();
        return true;
      },
      // DOM-free delete (no legacy confirm modal) — the engine drill guards with
      // mastConfirm. Mirrors deleteImage's write.
      removeConfirmed: async function (imageId) {
        if (typeof window.writeAudit === 'function') { try { await window.writeAudit('delete', 'gallery', imageId); } catch (e) {} }
        await MastDB.gallery.remove(imageId);
        galleryData = (await MastDB.gallery.list(500)) || {}; syncToGlobal(galleryData);
        if (typeof window.notifyGalleryChanged === 'function') window.notifyGalleryChanged();
        return true;
      },
      // Reorder an image up/down within its section. Re-syncs window.gallery
      // first so the shared moveImage swaps against current order values.
      reorder: async function (imageId, dir) {
        galleryData = (await MastDB.gallery.list(500)) || {};
        syncToGlobal(galleryData);
        if (typeof window.moveImage === 'function') return window.moveImage(imageId, (dir === 'up' || dir === -1) ? 'up' : 'down');
      },
      // Toggle an image's public visibility. Re-syncs window.gallery first.
      toggleVisible: async function (imageId) {
        galleryData = (await MastDB.gallery.list(500)) || {};
        syncToGlobal(galleryData);
        if (typeof window.toggleImageVisibility === 'function') return window.toggleImageVisibility(imageId);
      },

      // ── Single-image FIELDS (e.g. about.imageUrl) ──────────────────────
      // The image-type fields a section exposes (from SECTION_DEFS): [{id,label}].
      // These write ONE url to webPresence/config/sections/{key}/{field} — the
      // storefront reads e.g. sections.about.imageUrl — NOT a gallery doc.
      fieldDefs: function (sectionId) {
        var def = SECTION_DEFS.find(function (d) { return d.key === sectionId; });
        if (!def || !def.fields) return [];
        return def.fields.filter(function (f) { return f.type === 'image'; });
      },
      // Read the live value of a single-image field (fresh).
      getFieldValue: async function (sectionKey, fieldId) {
        var v = await MastDB.get('webPresence/config/sections/' + sectionKey + '/' + fieldId).catch(function () { return ''; });
        return v || '';
      },
      // Pick from the library → write the field (the hpPickImage flow).
      pickField: function (sectionKey, fieldId) {
        if (typeof window.openImagePicker !== 'function') { if (window.showToast) showToast('Image library unavailable.', true); return; }
        window.openImagePicker(function (imgId, url) {
          if (!url) return;
          window.HomepageBridge.images.setField(sectionKey, fieldId, url);
        });
      },
      // Write a single-image field URL (the byte-identical core hpPickImage uses).
      // Keeps the section-content cache in sync + marks the site unpublished, then
      // fires notifyGalleryChanged() so the V1 page builder + V2 surfaces refresh.
      setField: async function (sectionKey, fieldId, url) {
        if (!websiteConfig) websiteConfig = {};
        if (!websiteConfig.sections) websiteConfig.sections = {};
        if (!websiteConfig.sections[sectionKey]) websiteConfig.sections[sectionKey] = {};
        websiteConfig.sections[sectionKey][fieldId] = url;
        await MastDB.set('webPresence/config/sections/' + sectionKey + '/' + fieldId, url);
        markUnpublished();
        if (typeof window.notifyGalleryChanged === 'function') window.notifyGalleryChanged();
        return url;
      },
      // Clear a single-image field.
      clearField: function (sectionKey, fieldId) {
        return window.HomepageBridge.images.setField(sectionKey, fieldId, '');
      }
    }
  };

  // --- Module Registration DROPPED on absorb ---
  // homepage.js's registerModule('homepage', { …homepageTab…, attach/detach
  // gallery listeners }) is intentionally NOT carried over: website-v2 owns the
  // bare #homepage route now (its own registerModule + MODULE_MANIFEST routes),
  // and the V1 gallery-listener lifecycle (startListeners/stopListeners) is dead
  // with the V1 page-builder UI — HomepageBridge.images fresh-fetches per call.

})();


/* ════════════════════════════════════════════════════════════════════════
   ABSORBED FROM brand.js (T6 — last bespoke V1 modules retired). The
   BrandBridge + brand* window handlers used to live in the lazy
   modules/brand.js, lazy-loaded ONLY by this builder.
   brand.js is DELETED; its body is absorbed here VERBATIM as a sibling IIFE so
   BrandBridge is EAGER on website-v2 load. Only change vs the original file:
   the MastAdmin.registerModule('brand') block is dropped — website-v2 owns the
   bare #brand route. NOTE: shared/brand-sync.js (window.MastBrandSync) is a
   SEPARATE eager engine and is untouched.
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Brand & Logo Module — Master-Detail Layout
 * Lazy-loaded via MastAdmin module registry.
 *
 * Layout: Detail panel (top) + Logo type grid (middle) + Placements (bottom)
 * Click a logo type in the grid to focus it in the detail panel.
 */
(function() {
  'use strict';

  var brandLoaded = false;
  var logoConfig = null;
  var legacyLogoUrl = null;
  var voiceConfig = null;
  var selectedType = 'primary'; // which logo type is focused in detail panel
  var activeTab = 'logos'; // 'logos' | 'placements' | 'voice'

  // All logo types — primary + variants, treated equally in the grid
  var LOGO_TYPES = [
    { key: 'primary', label: 'Primary', desc: 'Original uploaded logo', bg: 'var(--surface-dark)', autoGen: false, isUpload: true },
    { key: 'transparent', label: 'Transparent', desc: 'White background removed', bg: 'var(--surface-dark)', autoGen: true, isUpload: false },
    { key: 'light', label: 'Light', desc: 'For dark backgrounds', bg: '#1a1a2e', autoGen: false, isUpload: true },
    { key: 'dark', label: 'Dark', desc: 'For light backgrounds', bg: '#f5f5f5', autoGen: false, isUpload: true },
    { key: 'icon', label: 'Icon', desc: 'Square 180x180 (favicon, social)', bg: 'var(--surface-card)', autoGen: true, isUpload: false },
    { key: 'email', label: 'Email', desc: 'Max 600px wide (email headers)', bg: '#ffffff', autoGen: true, isUpload: false }
  ];

  var PLACEMENTS = [
    { key: 'navBar', label: 'Navigation Bar', defaultHeight: 48 },
    { key: 'hero', label: 'Hero Banner', defaultHeight: 120 },
    { key: 'footer', label: 'Footer', defaultHeight: 60 },
    { key: 'email', label: 'Email Header', defaultHeight: 60 },
    { key: 'favicon', label: 'Favicon', defaultHeight: 32 }
  ];

  // ─── Data Loading ───

  async function loadBrandData() {
    try {
      logoConfig = (await MastDB.get('config/brand/logo')) || null;
      legacyLogoUrl = (await MastDB.get('public/config/nav/logoUrl')) || null;
      voiceConfig = (await MastDB.get('config/brand/voice')) || null;
    } catch (err) {
      console.warn('[Brand] Failed to load:', err.message);
      logoConfig = null;
      legacyLogoUrl = null;
      voiceConfig = null;
    }
    brandLoaded = true;
    renderBrand();
  }

  // ─── Helpers ───

  function esc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatDate(iso) {
    if (!iso) return '--';
    try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (_) { return iso; }
  }

  function getTypeData(key) {
    if (key === 'primary') return (logoConfig && logoConfig.primary) || null;
    return (logoConfig && logoConfig.variants && logoConfig.variants[key]) || null;
  }

  function getTypeUrl(key) {
    var data = getTypeData(key);
    return data ? data.url : null;
  }

  function getAvailableVariantKeys() {
    var keys = [];
    if (logoConfig && logoConfig.primary) keys.push('primary');
    if (logoConfig && logoConfig.variants) {
      Object.keys(logoConfig.variants).forEach(function(k) { keys.push(k); });
    }
    return keys;
  }

  // ─── Main Render ───

  function renderBrand() {
    var el = document.getElementById('brandContent');
    if (!el) return;

    if (!brandLoaded) {
      el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--warm-gray);">Loading brand configuration...</div>';
      return;
    }

    var html = '<div style="max-width:900px;margin:0 auto;padding:16px 0;">';
    html += '<div class="section-header" style="margin-bottom:16px;"><h2>Brand</h2></div>';

    // Sub-tabs
    var logosActive = activeTab === 'logos';
    var placementsActive = activeTab === 'placements';
    var tabStyle = 'padding:8px 20px;border:none;border-bottom:2px solid transparent;background:none;cursor:pointer;font-size:0.9rem;';
    var activeStyle = tabStyle + 'color:var(--teal);border-bottom-color:var(--teal);font-weight:600;';
    var inactiveStyle = tabStyle + 'color:var(--warm-gray);';

    var voiceActive = activeTab === 'voice';
    html += '<div style="display:flex;gap:4px;border-bottom:1px solid var(--warm-gray-dark);margin-bottom:20px;">' +
      '<button onclick="brandSwitchTab(\'logos\')" style="' + (logosActive ? activeStyle : inactiveStyle) + '">Logos</button>' +
      '<button onclick="brandSwitchTab(\'placements\')" style="' + (placementsActive ? activeStyle : inactiveStyle) + '">Placements</button>' +
      '<button onclick="brandSwitchTab(\'voice\')" style="' + (voiceActive ? activeStyle : inactiveStyle) + '">Voice</button>' +
    '</div>';

    if (logosActive) {
      html += renderDetailPanel();
      html += renderTypeGrid();
    } else if (placementsActive) {
      html += renderPlacementTable();
    } else {
      html += renderVoicePanel();
    }

    html += '</div>';
    el.innerHTML = html;
  }

  // ─── Detail Panel (top — shows selected type) ───

  function renderDetailPanel() {
    var typeDef = LOGO_TYPES.find(function(t) { return t.key === selectedType; }) || LOGO_TYPES[0];
    var data = getTypeData(selectedType);
    var hasData = !!data;

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;margin-bottom:20px;">';

    // Header row with type name + badge
    html += '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;">' +
      '<h3 style="margin:0;font-size:1.15rem;color:var(--text-primary);">' + esc(typeDef.label) + '</h3>' +
      '<span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(typeDef.desc) + '</span>';
    if (hasData) {
      var source = selectedType === 'primary' ? 'Uploaded' : (data.generatedFrom === 'primary' ? 'Auto-generated' : 'Manual');
      html += '<span class="status-badge pill" style="background:rgba(42,124,111,0.15);color:var(--teal);font-size:0.72rem;">' + source + '</span>';
    } else {
      html += '<span class="status-badge pill" style="background:rgba(196,133,60,0.15);color:var(--amber);font-size:0.72rem;">Not configured</span>';
    }
    html += '</div>';

    if (!hasData) {
      // Empty state with actions
      html += '<div style="display:flex;gap:16px;align-items:center;padding:32px 0;flex-wrap:wrap;">' +
        '<div style="background:' + typeDef.bg + ';border-radius:8px;width:200px;height:120px;display:flex;align-items:center;justify-content:center;">' +
          '<span style="font-size:0.78rem;color:var(--warm-gray);">No image</span>' +
        '</div>' +
        '<div>';

      if (selectedType === 'primary') {
        html += '<button class="btn btn-primary" onclick="brandUploadLogoPrompt(\'primary\')">Upload Logo</button>';
      } else if (typeDef.autoGen) {
        var hasPrimary = !!(logoConfig && logoConfig.primary);
        if (hasPrimary) {
          html += '<button class="btn btn-primary" onclick="brandGenerateVariant(\'' + selectedType + '\')">Generate from Primary</button>';
          html += '<div style="margin-top:8px;"><button class="btn btn-secondary" onclick="brandUploadLogoPrompt(\'' + selectedType + '\')" style="font-size:0.78rem;">Or upload manually</button></div>';
        } else {
          html += '<div style="color:var(--warm-gray);font-size:0.85rem;">Upload a primary logo first</div>';
        }
      } else {
        html += '<button class="btn btn-primary" onclick="brandUploadLogoPrompt(\'' + selectedType + '\')">Upload ' + esc(typeDef.label) + ' Variant</button>';
      }

      html += '</div></div>';
    } else {
      // Show image + metadata + actions
      html += '<div style="display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;">' +
        '<div style="background:' + typeDef.bg + ';border-radius:8px;padding:16px;display:flex;align-items:center;justify-content:center;min-width:200px;min-height:120px;">' +
          '<img src="' + esc(data.url) + '" alt="' + esc(typeDef.label) + '" style="max-width:300px;max-height:150px;object-fit:contain;" onerror="this.style.display=\'none\'">' +
        '</div>' +
        '<div style="flex:1;min-width:200px;">' +
          '<div style="display:grid;gap:6px;font-size:0.85rem;">';

      if (data.format) html += '<div><span style="color:var(--warm-gray);">Format:</span> ' + esc(data.format) + (data.hasTransparency ? ' <span style="color:var(--teal);">(transparent)</span>' : '') + '</div>';
      if (data.dimensions) html += '<div><span style="color:var(--warm-gray);">Dimensions:</span> ' + data.dimensions.width + ' x ' + data.dimensions.height + 'px</div>';
      if (data.uploadedAt || data.createdAt) html += '<div><span style="color:var(--warm-gray);">Created:</span> ' + formatDate(data.uploadedAt || data.createdAt) + '</div>';

      html += '</div>' +
        '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
          '<button class="btn btn-secondary" onclick="brandUploadLogoPrompt(\'' + selectedType + '\')" style="font-size:0.78rem;padding:4px 12px;">Replace</button>';

      // Generate button for auto-gen types
      if (selectedType !== 'primary' && typeDef.autoGen && logoConfig && logoConfig.primary) {
        html += '<button class="btn btn-secondary" onclick="brandGenerateVariant(\'' + selectedType + '\')" style="font-size:0.78rem;padding:4px 12px;">Regenerate</button>';
      }

      // Delete button for variants (not primary)
      if (selectedType !== 'primary') {
        html += '<button class="btn btn-secondary" onclick="brandDeleteVariant(\'' + selectedType + '\')" style="font-size:0.78rem;padding:4px 12px;color:var(--red,#ef4444);">Delete</button>';
      }

      html += '</div></div></div>';
    }

    html += '</div>';
    return html;
  }

  // ─── Logo Type Grid (all 6 types as clickable cards) ───

  function renderTypeGrid() {
    var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(130px, 1fr));gap:10px;margin-bottom:20px;">';

    LOGO_TYPES.forEach(function(lt) {
      var data = getTypeData(lt.key);
      var isSelected = lt.key === selectedType;
      var borderColor = isSelected ? 'var(--teal)' : 'var(--warm-gray-dark)';
      var borderWidth = isSelected ? '2px' : '1px';

      html += '<div onclick="brandSelectType(\'' + lt.key + '\')" style="cursor:pointer;border:' + borderWidth + ' solid ' + borderColor + ';border-radius:8px;overflow:hidden;transition:border-color 0.15s;">' +
        '<div style="background:' + lt.bg + ';height:70px;display:flex;align-items:center;justify-content:center;padding:6px;">';

      if (data) {
        html += '<img src="' + esc(data.url) + '" alt="" style="max-width:100%;max-height:58px;object-fit:contain;" onerror="this.parentElement.innerHTML=\'&#10060;\'">';
      } else {
        html += '<span style="font-size:0.72rem;color:var(--warm-gray);">Empty</span>';
      }

      html += '</div>' +
        '<div style="padding:6px 8px;text-align:center;">' +
          '<div style="font-size:0.78rem;font-weight:600;color:' + (isSelected ? 'var(--teal)' : 'var(--text-primary)') + ';">' + esc(lt.label) + '</div>' +
        '</div></div>';
    });

    html += '</div>';
    return html;
  }

  // ─── Placement Table ───

  function renderPlacementTable() {
    var placements = (logoConfig && logoConfig.placements) || {};
    var availableKeys = getAvailableVariantKeys();

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;">' +
      '<h3 style="margin:0 0 16px;font-size:1.15rem;color:var(--text-primary);">Placement Assignments</h3>';

    if (!logoConfig || !logoConfig.primary) {
      html += '<div style="color:var(--warm-gray);font-size:0.85rem;">Upload a primary logo first to configure placements.</div></div>';
      return html;
    }

    html += '<div style="display:grid;gap:10px;">';

    PLACEMENTS.forEach(function(p) {
      var config = placements[p.key] || {};
      var currentKey = config.variantKey || '';
      var currentHeight = config.maxHeight || p.defaultHeight;
      var resolvedUrl = currentKey ? getTypeUrl(currentKey) : getTypeUrl('primary');

      html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface-dark);border-radius:6px;flex-wrap:wrap;">' +
        '<div style="width:50px;height:34px;background:var(--surface-card);border-radius:4px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">';
      if (resolvedUrl) {
        html += '<img src="' + esc(resolvedUrl) + '" alt="" style="max-width:46px;max-height:30px;object-fit:contain;" onerror="this.style.display=\'none\'">';
      } else {
        html += '<span style="font-size:0.72rem;color:var(--warm-gray);">--</span>';
      }
      html += '</div>' +
        '<div style="min-width:110px;flex-shrink:0;font-size:0.85rem;font-weight:600;color:var(--text-primary);">' + esc(p.label) + '</div>' +
        '<div style="display:flex;align-items:center;gap:6px;flex:1;min-width:200px;">' +
          '<select id="brandPlacement_' + p.key + '_variant" style="flex:1;padding:4px 8px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.78rem;">';

      availableKeys.forEach(function(k) {
        var selected = (k === currentKey) ? ' selected' : '';
        var label = k === 'primary' ? 'Primary' : k.charAt(0).toUpperCase() + k.slice(1);
        html += '<option value="' + esc(k) + '"' + selected + '>' + label + '</option>';
      });

      html += '</select>' +
          '<input type="number" id="brandPlacement_' + p.key + '_height" value="' + currentHeight + '" min="16" max="200" style="width:55px;padding:4px 6px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.78rem;" title="Max height (px)">' +
          '<span style="font-size:0.72rem;color:var(--warm-gray);">px</span>' +
          '<button class="btn btn-primary" onclick="brandSavePlacement(\'' + p.key + '\')" style="font-size:0.78rem;padding:4px 10px;">Save</button>' +
        '</div></div>';
    });

    html += '</div></div>';
    return html;
  }

  // ─── Actions ───

  window.brandSwitchTab = function(tab) {
    activeTab = tab;
    renderBrand();
  };

  window.brandSelectType = function(typeKey) {
    selectedType = typeKey;
    renderBrand();
  };

  window.brandSavePlacement = async function(placementKey) {
    var variantEl = document.getElementById('brandPlacement_' + placementKey + '_variant');
    var heightEl = document.getElementById('brandPlacement_' + placementKey + '_height');
    if (!variantEl) return;
    var ok = await window.BrandBridge.savePlacement(placementKey, {
      variantKey: variantEl.value,
      maxHeight: parseInt(heightEl ? heightEl.value : '48', 10) || 48
    });
    if (ok) { showToast('Placement saved: ' + placementKey); await loadBrandData(); }
    else { showToast('Failed to save placement', true); }
  };

  window.brandGenerateVariant = async function(type) {
    showToast('Generating ' + type + ' variant...');
    // This is a placeholder — the actual generation goes through the MCP tool
    // which calls the Cloud Function. From the admin UI we just show guidance.
    showToast('Use your AI assistant to generate variants: generate_logo_variant type="' + type + '"', false);
  };

  window.brandDeleteVariant = async function(type) {
    if (!await mastConfirm('Delete the ' + type + ' variant?', { title: 'Delete Variant', danger: true })) return;
    try {
      // Delete from Storage if we have a path
      var data = getTypeData(type);
      // Remove config
      await MastDB.remove('config/brand/logo/variants/' + type);
      // Clear placements referencing this variant
      var placements = (await MastDB.get('config/brand/logo/placements')) || {};
      for (var key in placements) {
        if (placements[key] && placements[key].variantKey === type) {
          await MastDB.set('config/brand/logo/placements/' + key + '/variantKey', 'primary');
        }
      }
      await resolvePublicPlacements();
      showToast(type + ' variant deleted');
      selectedType = 'primary';
      brandLoaded = false;
      await loadBrandData();
    } catch (err) {
      showToast('Delete failed: ' + err.message, true);
    }
  };

  // ─── Upload Actions ───

  window.brandUploadLogoPrompt = function(targetType) {
    targetType = targetType || 'primary';
    var typeDef = LOGO_TYPES.find(function(t) { return t.key === targetType; }) || LOGO_TYPES[0];
    var title = targetType === 'primary' ? 'Upload Logo' : 'Upload ' + typeDef.label + ' Variant';

    var html = '<div class="modal-header"><h3 style="margin:0;">' + esc(title) + '</h3></div>' +
      '<div class="modal-body" style="display:grid;gap:16px;">' +
        '<div>' +
          '<label style="font-size:0.85rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Image URL</label>' +
          '<input type="text" id="brandLogoUrlInput" placeholder="https://example.com/logo.png" style="width:100%;padding:8px 12px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-card);color:var(--text-primary);font-size:0.9rem;">' +
          '<input type="hidden" id="brandLogoTargetType" value="' + esc(targetType) + '">' +
        '</div>' +
        '<div style="text-align:center;color:var(--warm-gray);font-size:0.78rem;">— or —</div>' +
        '<div style="text-align:center;">' +
          '<button class="btn btn-secondary" onclick="brandPickFromLibrary(\'' + esc(targetType) + '\')" style="font-size:0.85rem;">Choose from Image Library</button>' +
        '</div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="brandUploadLogoFromUrl()">Upload</button>' +
      '</div>';
    openModal(html);
    setTimeout(function() { var el = document.getElementById('brandLogoUrlInput'); if (el) el.focus(); }, 100);
  };

  window.brandUploadLogoFromUrl = async function() {
    var input = document.getElementById('brandLogoUrlInput');
    var targetInput = document.getElementById('brandLogoTargetType');
    var url = input ? input.value.trim() : '';
    var targetType = targetInput ? targetInput.value : 'primary';
    if (!url) { showToast('Please enter an image URL', true); return; }

    closeModal();
    showToast('Saving...');

    var ok = await window.BrandBridge.setLogoFromUrl(targetType, url);
    if (ok) {
      showToast('Uploaded successfully');
      selectedType = targetType;
      brandLoaded = false;
      await loadBrandData();
    } else {
      showToast('Upload failed', true);
    }
  };

  window.brandPickFromLibrary = function(targetType) {
    closeModal();
    if (typeof openImagePicker === 'function') {
      openImagePicker(async function(imgId, url) {
        showToast('Setting from library...');
        try {
          var config = {
            url: url,
            storagePath: '',
            format: url.match(/\.(\w+)(?:\?|$)/i) ? RegExp.$1 : 'png',
            hasTransparency: false,
            dimensions: null
          };

          if (targetType === 'primary') {
            if (window.MastBrandSync && typeof window.MastBrandSync.setLogo === 'function') {
              await window.MastBrandSync.setLogo(config);
            } else {
              config.uploadedAt = new Date().toISOString();
              await MastDB.set('config/brand/logo/primary', config);
              await MastDB.set('public/config/nav/logoUrl', url);
            }
          } else {
            config.generatedFrom = 'manual';
            config.createdAt = new Date().toISOString();
            await MastDB.set('config/brand/logo/variants/' + targetType, config);
          }

          await resolvePublicPlacements();
          showToast('Set from library');
          selectedType = targetType;
          brandLoaded = false;
          await loadBrandData();
        } catch (err) {
          showToast('Failed: ' + err.message, true);
        }
      });
    } else {
      showToast('Image library not available', true);
      brandUploadLogoPrompt(targetType);
    }
  };

  // ─── Placement Resolution ───

  async function resolvePublicPlacements() {
    if (!logoConfig) return;
    var primary = logoConfig.primary || {};
    var variants = logoConfig.variants || {};
    var placements = (await MastDB.get('config/brand/logo/placements')) || {};
    var updates = {};

    Object.keys(placements).forEach(function(placement) {
      var config = placements[placement];
      var vk = config && config.variantKey;
      if (!vk) return;
      var resolvedUrl = vk === 'primary' ? primary.url : (variants[vk] ? variants[vk].url : null);
      if (resolvedUrl) {
        updates['public/config/brand/logo/' + placement + '/url'] = resolvedUrl;
        updates['public/config/brand/logo/' + placement + '/maxHeight'] = config.maxHeight || null;
      }
    });

    if (placements.navBar && placements.navBar.variantKey) {
      var navKey = placements.navBar.variantKey;
      var navUrl = navKey === 'primary' ? primary.url : (variants[navKey] ? variants[navKey].url : null);
      if (navUrl) updates['public/config/nav/logoUrl'] = navUrl;
    }

    if (Object.keys(updates).length > 0) await MastDB.multiUpdate(updates);
  }

  // ─── Voice Panel ───

  function renderVoicePanel() {
    var v = voiceConfig || {};
    var voiceRules = v.voiceRules || '';
    var tagline = v.tagline || '';
    var positioning = v.positioningOneLiner || '';

    var html = '<div style="background:var(--surface-card);border-radius:8px;padding:20px;">' +
      '<h3 style="margin:0 0 4px;font-size:1.15rem;color:var(--text-primary);">Brand Voice</h3>' +
      '<div style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:20px;">Words and tone used across storefront SEO, newsletter, and social drafts.</div>';

    // Tagline
    html += '<div style="margin-bottom:16px;">' +
      '<label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Tagline</label>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">Short phrase (max 80 chars). Used in storefront &lt;title&gt; and OG tags.</div>' +
      '<input type="text" id="brandVoiceTagline" maxlength="80" value="' + esc(tagline) + '" placeholder="e.g. Handmade glass from the high desert" ' +
        'style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-dark);color:var(--text-primary);font-size:0.9rem;">' +
    '</div>';

    // Positioning one-liner
    html += '<div style="margin-bottom:16px;">' +
      '<label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Positioning one-liner</label>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">One sentence (max 160 chars). Used in meta description and OG description.</div>' +
      '<input type="text" id="brandVoicePositioning" maxlength="160" value="' + esc(positioning) + '" placeholder="e.g. Wheel-thrown and kiln-fired in Taos, shipped worldwide." ' +
        'style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-dark);color:var(--text-primary);font-size:0.9rem;">' +
    '</div>';

    // Voice rules
    html += '<div style="margin-bottom:16px;">' +
      '<label style="display:block;font-size:0.85rem;font-weight:600;color:var(--text-primary);margin-bottom:4px;">Voice rules</label>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;">Tone, do/don\'t list, signature phrases. Used by Claude when drafting newsletter or social copy.</div>' +
      '<textarea id="brandVoiceRules" rows="8" placeholder="e.g.&#10;- Warm, plainspoken, never salesy&#10;- Refer to pieces as &quot;work&quot; not &quot;products&quot;&#10;- Always credit the artist by first name" ' +
        'style="width:100%;padding:8px 10px;border-radius:4px;border:1px solid var(--warm-gray);background:var(--surface-dark);color:var(--text-primary);font-size:0.9rem;font-family:inherit;resize:vertical;">' + esc(voiceRules) + '</textarea>' +
    '</div>';

    html += '<div style="display:flex;gap:8px;align-items:center;">' +
      '<button class="btn btn-primary" onclick="brandSaveVoice()">Save Voice</button>' +
      '<span id="brandVoiceSaveMsg" style="font-size:0.78rem;color:var(--warm-gray);"></span>' +
    '</div>';

    html += '</div>';
    return html;
  }

  window.brandSaveVoice = async function() {
    var taglineEl = document.getElementById('brandVoiceTagline');
    var positioningEl = document.getElementById('brandVoicePositioning');
    var rulesEl = document.getElementById('brandVoiceRules');
    var msg = document.getElementById('brandVoiceSaveMsg');
    if (!taglineEl) return;
    var payload = await window.BrandBridge.saveVoice({
      tagline: taglineEl.value || '',
      positioningOneLiner: positioningEl ? positioningEl.value || '' : '',
      voiceRules: rulesEl ? rulesEl.value || '' : ''
    });
    if (payload) {
      if (msg) { msg.textContent = 'Saved.'; setTimeout(function() { if (msg) msg.textContent = ''; }, 2000); }
      if (typeof showToast === 'function') showToast('Brand voice saved.');
    } else {
      if (typeof showToast === 'function') showToast('Save failed', true);
      else if (msg) msg.textContent = 'Save failed.';
    }
  };

  // ─── Bridge for the brand-v2 redesign twin (flag-gated #brand-v2) ───
  // The twin delegates voice/logo/variant/placement WRITES here so the
  // MastBrandSync.setLogo fan-out (canonical config/brand/logo/primary PLUS
  // public/config/nav/logoUrl + platform publicConfig.brandLogoUrl mirrors), the
  // public-mirror writes for voice, the variant config shape, and the
  // resolvePublicPlacements re-derivation stay single-sourced — the twin never
  // reimplements that logic. These mirror the EXACT writes the legacy DOM
  // handlers (brandSaveVoice / brandUploadLogoFromUrl / brandSavePlacement /
  // brandGenerateVariant) make, parameterized by a data object (the legacy
  // handlers read the modal/panel DOM, so they can't be called directly).
  // Additive; no behavior change to the legacy #brand surface. Mirrors
  // window.ContactsBridge / window.MakerMaterialsBridge / window.GiftCardsBridge.
  //
  // NOTE on logos: the URL-paste path stores the source URL directly (no re-host
  // through the uploadImage Cloud Function — re-hosting a URL the user already
  // trusts adds no value), exactly as the legacy handler did. setLogoFromUrl is
  // the URL-only capability the legacy surface supports. The uploadImage CF /
  // Storage write is reachable only via brandPickFromLibrary's image-library
  // path, which is genuinely library-coupled and stays classic-only.
  window.BrandBridge = {
    // Mirrors brandSaveVoice: 80/160-char clamps, config/brand/voice set +
    // public/config/brand/{tagline,positioningOneLiner} mirror for the storefront
    // <title>/OG/meta. data: { tagline, positioningOneLiner, voiceRules }.
    // Returns the saved payload on success, null on failure.
    saveVoice: async function(data) {
      data = data || {};
      var payload = {
        tagline: (data.tagline || '').slice(0, 80).trim(),
        positioningOneLiner: (data.positioningOneLiner || '').slice(0, 160).trim(),
        voiceRules: (data.voiceRules || '').trim(),
        updatedAt: new Date().toISOString()
      };
      try {
        await MastDB.set('config/brand/voice', payload);
        await MastDB.multiUpdate({
          'public/config/brand/tagline': payload.tagline || null,
          'public/config/brand/positioningOneLiner': payload.positioningOneLiner || null
        });
        voiceConfig = payload;
        return payload;
      } catch (err) {
        console.error('[brand] saveVoice', err);
        return null;
      }
    },
    // Mirrors brandUploadLogoFromUrl: builds the URL-source config (format from
    // extension), routes primary through MastBrandSync.setLogo (canonical write +
    // legacy-mirror fan-out) with a stale-load fallback, variants to
    // config/brand/logo/variants/<type>, then resolvePublicPlacements.
    // targetType: 'primary' | variant-key. Returns true on success.
    setLogoFromUrl: async function(targetType, url) {
      targetType = targetType || 'primary';
      url = (url || '').trim();
      if (!url) return false;
      try {
        var formatMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
        var config = {
          url: url,
          storagePath: '',
          format: formatMatch ? formatMatch[1].toLowerCase() : 'png',
          hasTransparency: false,
          dimensions: null
        };
        if (targetType === 'primary') {
          if (window.MastBrandSync && typeof window.MastBrandSync.setLogo === 'function') {
            await window.MastBrandSync.setLogo(config);
          } else {
            config.uploadedAt = new Date().toISOString();
            await MastDB.set('config/brand/logo/primary', config);
            await MastDB.set('public/config/nav/logoUrl', url);
          }
        } else {
          config.generatedFrom = 'manual';
          config.createdAt = new Date().toISOString();
          await MastDB.set('config/brand/logo/variants/' + targetType, config);
        }
        await resolvePublicPlacements();
        return true;
      } catch (err) {
        console.error('[brand] setLogoFromUrl', err);
        return false;
      }
    },
    // Mirrors brandSavePlacement: config/brand/logo/placements/<key> set +
    // resolvePublicPlacements re-derivation. data: { variantKey, maxHeight }.
    savePlacement: async function(placementKey, data) {
      data = data || {};
      try {
        await MastDB.set('config/brand/logo/placements/' + placementKey, {
          variantKey: data.variantKey,
          maxHeight: parseInt(data.maxHeight, 10) || 48
        });
        await resolvePublicPlacements();
        return true;
      } catch (err) {
        console.error('[brand] savePlacement', err);
        return false;
      }
    },
    // Mirrors brandDeleteVariant's write half (no confirm — the caller confirms):
    // remove the variant config + repoint any placements that referenced it back
    // to primary, then resolvePublicPlacements.
    deleteVariant: async function(type) {
      try {
        await MastDB.remove('config/brand/logo/variants/' + type);
        var placements = (await MastDB.get('config/brand/logo/placements')) || {};
        for (var key in placements) {
          if (placements[key] && placements[key].variantKey === type) {
            await MastDB.set('config/brand/logo/placements/' + key + '/variantKey', 'primary');
          }
        }
        await resolvePublicPlacements();
        return true;
      } catch (err) {
        console.error('[brand] deleteVariant', err);
        return false;
      }
    },
    // Read-through so the twin can refresh after a write without re-reading the
    // module's private caches.
    getConfig: async function() {
      return {
        logo: (await MastDB.get('config/brand/logo').catch(function () { return null; })) || null,
        legacyLogoUrl: (await MastDB.get('public/config/nav/logoUrl').catch(function () { return null; })) || null,
        voice: (await MastDB.get('config/brand/voice').catch(function () { return null; })) || null
      };
    }
  };

  // ─── Module Registration DROPPED on absorb ───
  // brand.js's registerModule('brand', { …brandTab… }) is intentionally NOT
  // carried over: website-v2 owns the bare #brand route now (its own
  // registerModule + MODULE_MANIFEST routes). The V1 brand-tab UI
  // (loadBrandData/renderBrand) is dead; BrandBridge's writes stand alone.

})();
