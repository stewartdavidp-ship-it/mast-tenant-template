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
  var V2 = { wp: null, meta: null, status: 'draft', loaded: false };

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
    var pip = '<span class="wv2-pip" title="Changes save automatically and appear on your live site.">' +
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

  function ensureStyles() {
    if (document.getElementById('wv2-styles')) return;
    var css =
      '.wv2-header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;' +
        'padding:12px 16px;margin:0 0 16px;background:var(--surface-card,var(--charcoal-light));border:1px solid var(--border);border-radius:10px;}' +
      '.wv2-header-main{min-width:0;display:flex;flex-direction:column;gap:4px;}' +
      '.wv2-sitename{font-size:1.05rem;font-weight:700;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48vw;}' +
      '.wv2-urlrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}' +
      '.wv2-url{font-size:0.85rem;color:var(--teal);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:42vw;}' +
      '.wv2-url:hover{text-decoration:underline;}' +
      '.wv2-url-ext{font-size:0.8em;opacity:0.8;}' +
      '.wv2-copy{font-size:0.74rem;padding:2px 9px;border:1px solid var(--border);border-radius:999px;background:transparent;color:var(--text-secondary,var(--warm-gray));cursor:pointer;}' +
      '.wv2-copy:hover{color:var(--text-primary);border-color:var(--teal);}' +
      '.wv2-header-side{flex-shrink:0;}' +
      '.wv2-pip{display:inline-flex;align-items:center;gap:7px;font-size:0.78rem;font-weight:600;color:var(--text-secondary,var(--warm-gray));' +
        'padding:5px 11px;border-radius:999px;background:color-mix(in srgb,var(--success) 14%,transparent);}' +
      '.wv2-pip-dot{width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 0 3px color-mix(in srgb,var(--success) 22%,transparent);}' +
      '.wv2-stack{display:flex;flex-direction:column;gap:16px;}' +
      '.wv2-coming{font-style:italic;opacity:0.75;padding:6px 0;}';
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
  }

  // ── public API ─────────────────────────────────────────────────────
  window.WebsiteV2 = {
    refresh: function () { render(); },
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

  // ── load ───────────────────────────────────────────────────────────
  // Cold-safe: read the storefront config defensively for the header (site name +
  // status). Header renders even if the read fails. PR3–PR6 extend this with the
  // theme + section reads their cards need.
  function load() {
    Promise.resolve(MastDB.get('webPresence/config')).catch(function () { return null; })
      .then(function (wp) {
        V2.wp = wp || {};
        V2.meta = (wp && wp.meta) || {};
        V2.status = (wp && wp.status) || 'draft';
        V2.loaded = true;
        render();
      })
      .catch(function (e) { console.error('[website-v2] load', e); V2.loaded = true; render(); });
  }

  MastAdmin.registerModule('website-v2', {
    routes: { 'website-v2': { tab: 'websiteV2Tab', setup: function () {
      ensureTab();
      render();   // paint the shell immediately (header + placeholders) — cold-safe
      load();     // then hydrate the header from config
    } } }
  });
})();
