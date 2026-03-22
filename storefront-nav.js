/**
 * Storefront Nav — Dynamic Navigation Builder
 *
 * Loaded after storefront-theme.js, before tenant-brand.js.
 * Reads nav config from {TENANT_ID}/public/config/nav via Firebase RTDB REST API.
 * Builds <nav> and mobile menu dynamically, supporting section show/hide.
 *
 * HTML pages provide empty placeholders:
 *   <nav id="mainNav"></nav>
 *   <div class="nav-mobile-menu" id="mobileMenu"></div>
 *
 * Pages that want a transparent nav (homepage, blog hero pages) add:
 *   <nav id="mainNav" data-nav-transparent></nav>
 *
 * Falls back to default nav structure if no config exists.
 * Dispatches 'storefront-nav-ready' event when nav is built.
 */

(function () {
  'use strict';

  // Default nav sections when no config exists in Firebase
  var DEFAULT_SECTIONS = {
    shop:       { label: 'Shop',        href: 'shop.html',       enabled: true,  highlight: true, order: 1 },
    orders:     { label: 'Orders',      href: 'orders.html',      enabled: true,  order: 2 },
    about:      { label: 'About',       href: 'about.html',      enabled: true,  order: 3 },
    commission: { label: 'Commissions', href: 'commission.html',  enabled: false, order: 4 },
    wholesale:  { label: 'Wholesale',   href: 'wholesale.html',   enabled: false, order: 5 },
    schedule:   { label: 'Schedule',    href: 'schedule.html',    enabled: false, order: 6 },
    blog:       { label: 'From the Studio', href: 'blog/',        enabled: true,  order: 7 }
  };

  /**
   * Detect the base path for relative URLs.
   * Pages in subdirectories (blog/, events/) need ../ prefix.
   */
  function getBasePath() {
    var path = window.location.pathname;
    // Remove trailing filename if present
    var dir = path.substring(0, path.lastIndexOf('/') + 1);
    // Count depth: root is /, one-level subdir is /blog/, etc.
    var parts = dir.split('/').filter(Boolean);
    if (parts.length === 0) return '';
    // Build relative path back to root
    var prefix = '';
    for (var i = 0; i < parts.length; i++) prefix += '../';
    return prefix;
  }

  /**
   * Detect if current page is the homepage.
   */
  function isHomepage() {
    var path = window.location.pathname;
    return path === '/' || path === '/index.html';
  }

  /**
   * Convert Firebase sections object to sorted array of enabled sections.
   */
  function toSortedArray(sections) {
    var result = [];
    if (!sections) return result;

    // Handle both object and array formats
    if (Array.isArray(sections)) {
      for (var i = 0; i < sections.length; i++) {
        if (sections[i] && sections[i].enabled) result.push(sections[i]);
      }
    } else {
      var keys = Object.keys(sections);
      for (var j = 0; j < keys.length; j++) {
        var s = sections[keys[j]];
        if (s && s.enabled) {
          s.key = s.key || keys[j];
          result.push(s);
        }
      }
    }

    result.sort(function (a, b) { return (a.order || 99) - (b.order || 99); });
    return result;
  }

  /**
   * Inject promo banner above nav if config exists.
   * Config path: {TENANT_ID}/public/config/promoBanner
   * Expected shape: { text: "Free Shipping on Orders $100+", enabled: true }
   */
  function injectPromoBanner(bannerConfig) {
    if (!bannerConfig || !bannerConfig.enabled || !bannerConfig.text) return;
    var nav = document.getElementById('mainNav');
    if (!nav) return;
    // Remove any existing hardcoded banner
    var existing = document.querySelector('.free-ship-banner');
    if (existing) existing.remove();
    // Create dynamic banner
    var banner = document.createElement('div');
    banner.className = 'free-ship-banner';
    banner.textContent = bannerConfig.text;
    nav.parentNode.insertBefore(banner, nav);
  }

  /**
   * Build the nav and mobile menu HTML, insert into DOM, wire up behaviors.
   */
  // Sections that belong under Shop context (shown only on shop pages)
  var SHOP_CONTEXT_SECTIONS = ['commission', 'orders', 'wholesale'];
  // Sections that belong to content context (hidden on shop pages)
  var CONTENT_CONTEXT_SECTIONS = ['about', 'blog', 'schedule'];
  // Shop is always shown in both contexts
  // Shop context page basenames (without .html — Firebase Hosting uses clean URLs)
  var SHOP_CONTEXT_PAGES = ['shop', 'orders', 'wholesale', 'commission'];

  /**
   * Detect if current page is in shop context.
   */
  function isShopContext() {
    var path = window.location.pathname.toLowerCase().replace(/\.html$/, '');
    for (var i = 0; i < SHOP_CONTEXT_PAGES.length; i++) {
      if (path === '/' + SHOP_CONTEXT_PAGES[i] || path.endsWith('/' + SHOP_CONTEXT_PAGES[i])) return true;
    }
    return false;
  }

  /**
   * Detect if a nav section matches the current page.
   */
  function isActivePage(sectionHref) {
    if (!sectionHref) return false;
    var path = window.location.pathname;
    // Normalize: strip .html and base path for comparison (Firebase Hosting uses clean URLs)
    var hrefBase = sectionHref.replace(/^(\.\.\/)+/, '').replace(/\.html$/, '').replace(/\/$/, '');
    var pathBase = path.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
    if (!pathBase) pathBase = 'index';
    if (!hrefBase) hrefBase = 'index';
    return pathBase === hrefBase || pathBase.endsWith('/' + hrefBase);
  }

  function buildNav(sections, config) {
    var nav = document.getElementById('mainNav');
    var mobileMenu = document.getElementById('mobileMenu');
    if (!nav) return;

    var basePath = getBasePath();
    var homepage = isHomepage();
    var showSignIn = (config && config.showSignIn === false) ? false : true;
    var rawLogo = (config && config.logoUrl) || '';
    var logoUrl = (rawLogo && (rawLogo.indexOf('https://') === 0 || rawLogo.indexOf('/') === 0 || rawLogo.indexOf('../') === 0)) ? rawLogo : (basePath + 'favicon.svg');
    var brandName = (window.TENANT_BRAND && window.TENANT_BRAND.name) || 'My Shop';

    // Transparent nav — either data attribute on the element or homepage
    if (nav.hasAttribute('data-nav-transparent') || homepage) {
      nav.classList.add('nav-transparent');
    }

    var sorted = toSortedArray(sections);
    var inShopContext = isShopContext();

    // In shop context, ensure orders and wholesale are present even if not in Firebase config
    if (inShopContext) {
      var hasOrders = sorted.some(function(s) { return s.key === 'orders'; });
      var hasWholesale = sorted.some(function(s) { return s.key === 'wholesale'; });
      if (!hasOrders) sorted.push({ key: 'orders', label: 'Orders', href: 'orders.html', order: 2 });
      if (!hasWholesale) sorted.push({ key: 'wholesale', label: 'Wholesale', href: 'wholesale.html', order: 5 });
      sorted.sort(function(a, b) { return (a.order || 99) - (b.order || 99); });
    }

    // Context-aware filtering: shop pages show shop sections, content pages show content sections
    var topLevel = sorted.filter(function(s) {
      var key = s.key || '';
      if (inShopContext) {
        // In shop context: hide content-only sections (about, blog, schedule)
        return CONTENT_CONTEXT_SECTIONS.indexOf(key) === -1;
      } else {
        // In content context: hide shop-only sections (commission, orders, wholesale)
        return SHOP_CONTEXT_SECTIONS.indexOf(key) === -1;
      }
    });
    var homeHref = homepage ? '#' : (basePath + 'index.html');
    var homeActive = homepage ? ' nav-active' : '';

    // ── Desktop nav ──
    var html = '';
    html += '<a href="' + homeHref + '" class="nav-logo">';
    html += '<img src="' + esc(logoUrl) + '" data-tenant-alt="brand" alt="' + esc(brandName) + '">';
    html += '</a>';
    html += '<ul class="nav-links">';
    html += '<li><a href="' + homeHref + '" class="' + homeActive + '">Home</a></li>';
    for (var i = 0; i < topLevel.length; i++) {
      var s = topLevel[i];
      if (!s.href || !s.label) continue; // Skip sections without href/label (e.g. newsletter, contact)
      var href = basePath + s.href;
      var classes = [];
      if (s.highlight) classes.push('nav-shop');
      if (isActivePage(s.href)) classes.push('nav-active');
      var cls = classes.length > 0 ? ' class="' + classes.join(' ') + '"' : '';
      html += '<li><a href="' + href + '"' + cls + '>' + esc(s.label) + '</a></li>';
    }
    if (showSignIn) {
      html += '<li><a href="#" onclick="event.preventDefault(); siteSignIn();">Sign In</a></li>';
    }
    html += '</ul>';
    html += '<button class="nav-toggle" aria-label="Menu"><span></span><span></span><span></span></button>';
    nav.innerHTML = html;

    // ── Mobile menu ──
    if (mobileMenu) {
      var mhtml = '';
      mhtml += '<a href="' + homeHref + '"' + (homeActive ? ' class="nav-active"' : '') + ' onclick="closeMobileMenu()">Home</a>';
      if (showSignIn) {
        mhtml += '<a href="#" onclick="event.preventDefault(); siteSignIn(); closeMobileMenu();">Sign In</a>';
      }
      for (var j = 0; j < topLevel.length; j++) {
        var ms = topLevel[j];
        if (!ms.href || !ms.label) continue;
        var mhref = basePath + ms.href;
        var mclasses = [];
        if (ms.highlight) mclasses.push('btn-shop');
        if (isActivePage(ms.href)) mclasses.push('nav-active');
        var mcls = mclasses.length > 0 ? ' class="' + mclasses.join(' ') + '"' : '';
        mhtml += '<a href="' + mhref + '"' + mcls + ' onclick="closeMobileMenu()">' + esc(ms.label) + '</a>';
      }
      mobileMenu.innerHTML = mhtml;
    }

    setupMobileToggle();
    setupScrollBehavior(nav);

    window.dispatchEvent(new CustomEvent('storefront-nav-ready'));
  }

  /**
   * Minimal HTML escaping for user-provided label text.
   */
  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /**
   * Wire up hamburger toggle and mobile menu close behaviors.
   */
  function setupMobileToggle() {
    var toggle = document.querySelector('.nav-toggle');
    var menu = document.getElementById('mobileMenu');
    if (!toggle || !menu) return;

    window.closeMobileMenu = function () {
      menu.classList.remove('active');
      toggle.classList.remove('active');
    };

    toggle.addEventListener('click', function () {
      this.classList.toggle('active');
      menu.classList.toggle('active');
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 768) {
        window.closeMobileMenu();
      }
    });
  }

  /**
   * Shrink nav on scroll. Transparent navs get a dark background when scrolled.
   */
  function setupScrollBehavior(nav) {
    window.addEventListener('scroll', function () {
      nav.classList.toggle('scrolled', window.scrollY > 80);
    });
  }

  /**
   * Main init — wait for TENANT_READY, fetch nav config, build nav.
   */
  function init() {
    // Ensure DOM elements exist
    var domReady = new Promise(function (resolve) {
      if (document.readyState !== 'loading') resolve();
      else document.addEventListener('DOMContentLoaded', resolve);
    });

    if (!window.TENANT_READY) {
      domReady.then(function () { buildNav(DEFAULT_SECTIONS, {}); });
      return;
    }

    Promise.all([window.TENANT_READY, domReady]).then(function () {
      if (!window.TENANT_ID || !window.TENANT_FIREBASE_CONFIG || !window.TENANT_FIREBASE_CONFIG.databaseURL) {
        buildNav(DEFAULT_SECTIONS, {});
        return;
      }

      var baseUrl = window.TENANT_FIREBASE_CONFIG.databaseURL + '/' + window.TENANT_ID + '/public/config/';
      var navUrl = baseUrl + 'nav.json';
      var bannerUrl = baseUrl + 'promoBanner.json';

      // Fetch nav config and promo banner in parallel
      var navPromise = fetch(navUrl)
        .then(function (resp) { return resp.ok ? resp.json() : null; })
        .catch(function () { return null; });
      var bannerPromise = fetch(bannerUrl)
        .then(function (resp) { return resp.ok ? resp.json() : null; })
        .catch(function () { return null; });

      Promise.all([navPromise, bannerPromise]).then(function (results) {
        var config = results[0];
        var bannerConfig = results[1];
        // Remove any hardcoded free-ship-banner from HTML
        var existing = document.querySelector('.free-ship-banner');
        if (existing) existing.remove();
        // Build nav
        if (config && config.sections) {
          // Merge Firebase sections with defaults to fill in label/href
          var merged = {};
          var keys = Object.keys(DEFAULT_SECTIONS);
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var def = DEFAULT_SECTIONS[key];
            var fb = config.sections[key];
            if (fb) {
              merged[key] = {
                label: fb.label || def.label,
                href: fb.href || def.href,
                enabled: fb.enabled !== undefined ? fb.enabled : def.enabled,
                highlight: fb.highlight !== undefined ? fb.highlight : def.highlight,
                order: fb.order !== undefined ? fb.order : def.order
              };
            } else {
              merged[key] = def;
            }
          }
          // Include any custom sections not in defaults
          var fbKeys = Object.keys(config.sections);
          for (var m = 0; m < fbKeys.length; m++) {
            if (!merged[fbKeys[m]]) merged[fbKeys[m]] = config.sections[fbKeys[m]];
          }
          buildNav(merged, config);
        } else {
          buildNav(DEFAULT_SECTIONS, config || {});
        }
        // Populate hero logo on homepage if element exists
        populateHeroLogo(config);
        // Inject promo banner if configured
        injectPromoBanner(bannerConfig);
      }).catch(function (err) {
        console.warn('[storefront-nav] Failed to load nav config:', err.message);
        buildNav(DEFAULT_SECTIONS, {});
      });
    });
  }

  /**
   * Populate the hero logo on the homepage when a logo URL is configured.
   * The #heroLogo element is hidden by default in index.html.
   */
  function populateHeroLogo(config) {
    var heroLogoEl = document.getElementById('heroLogo');
    if (!heroLogoEl) return; // Not on homepage

    var rawLogo = (config && config.logoUrl) || '';
    if (!rawLogo) return; // No logo configured

    var basePath = getBasePath();
    var logoUrl = (rawLogo.indexOf('https://') === 0 || rawLogo.indexOf('/') === 0 || rawLogo.indexOf('../') === 0)
      ? rawLogo : (basePath + 'favicon.svg');
    var brandName = (window.TENANT_BRAND && window.TENANT_BRAND.name) || 'My Shop';

    heroLogoEl.innerHTML = '<img src="' + esc(logoUrl) + '" alt="' + esc(brandName) + '">';
    heroLogoEl.style.display = '';
  }

  init();

})();
