/**
 * Storefront Theme — Dynamic Color Injection
 *
 * Loaded after storefront-tenant.js, before tenant-brand.js.
 * Reads webPresence/config from the tenant's RTDB and injects
 * CSS custom properties onto :root to override storefront.css defaults.
 *
 * Also dynamically loads Google Fonts based on the tenant's fontPair config.
 *
 * Falls back gracefully to storefront.css defaults if no config exists.
 */

(function () {
  'use strict';

  // Font pair presets — each pair has a heading font and a body font
  var FONT_PAIRS = {
    'classic': {
      heading: 'Cormorant Garamond',
      body: 'DM Sans',
      weights: { heading: '300;400;500;600', body: '300;400;500' }
    },
    'modern': {
      heading: 'Inter',
      body: 'Inter',
      weights: { heading: '300;400;600;700', body: '300;400;500' }
    },
    'editorial': {
      heading: 'Playfair Display',
      body: 'Source Sans 3',
      weights: { heading: '400;500;600', body: '300;400;500' }
    },
    'clean': {
      heading: 'Outfit',
      body: 'Outfit',
      weights: { heading: '300;400;600', body: '300;400;500' }
    },
    'artisan': {
      heading: 'Libre Baskerville',
      body: 'Nunito Sans',
      weights: { heading: '400;700', body: '300;400;600' }
    },
    'geometric': {
      heading: 'Space Grotesk',
      body: 'Space Grotesk',
      weights: { heading: '300;400;500;600;700', body: '300;400;500' }
    }
  };

  // Color mapping: Firebase config key → CSS custom property
  var COLOR_MAP = {
    primaryColor: '--primary',
    primaryLightColor: '--primary-light',
    primaryGlowColor: '--primary-glow',
    accentColor: '--accent',
    accentDeepColor: '--accent-deep',
    accentLightColor: '--accent-light',
    bgColor: '--bg',
    bgDarkColor: '--bg-dark',
    textColor: '--text',
    textMutedColor: '--text-muted',
    textLightColor: '--text-light'
  };

  /**
   * Generate a lighter/darker variant of a hex color.
   * factor > 1 = lighter, factor < 1 = darker
   */
  function adjustColor(hex, factor) {
    hex = hex.replace('#', '');
    if (hex.length === 3) {
      hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    }
    var r = Math.min(255, Math.round(parseInt(hex.substring(0, 2), 16) * factor));
    var g = Math.min(255, Math.round(parseInt(hex.substring(2, 4), 16) * factor));
    var b = Math.min(255, Math.round(parseInt(hex.substring(4, 6), 16) * factor));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /**
   * Load a Google Fonts stylesheet dynamically.
   */
  function loadGoogleFont(family, weights) {
    var encoded = family.replace(/ /g, '+');
    var url = 'https://fonts.googleapis.com/css2?family=' + encoded + ':wght@' + weights + '&display=swap';

    // Don't add duplicate links
    var existing = document.querySelectorAll('link[href*="fonts.googleapis.com"]');
    for (var i = 0; i < existing.length; i++) {
      if (existing[i].href.indexOf(encoded) !== -1) return;
    }

    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url;
    document.head.appendChild(link);
  }

  /**
   * Apply theme config to CSS custom properties on :root.
   */
  function applyTheme(config) {
    if (!config) return;

    var root = document.documentElement;

    // Apply explicit color overrides
    // In dark mode, skip bg/text overrides — let storefront.css dark mode values win
    var isDark = root.classList.contains('dark') || window.matchMedia('(prefers-color-scheme: dark)').matches;
    var DARK_MODE_SKIP = isDark ? { bgColor: 1, bgDarkColor: 1, textColor: 1, textMutedColor: 1, textLightColor: 1, primaryColor: 1, accentColor: 1 } : {};
    Object.keys(COLOR_MAP).forEach(function (key) {
      if (config[key] && !DARK_MODE_SKIP[key]) {
        root.style.setProperty(COLOR_MAP[key], config[key]);
      }
    });

    // Auto-generate variants if only primary/accent provided (skip in dark mode)
    if (config.primaryColor && !isDark) {
      if (!config.primaryLightColor) {
        root.style.setProperty('--primary-light', adjustColor(config.primaryColor, 1.25));
      }
      if (!config.primaryGlowColor) {
        root.style.setProperty('--primary-glow', adjustColor(config.primaryColor, 1.5));
      }

      // Update brand gradient
      var pl = getComputedStyle(root).getPropertyValue('--primary-light').trim();
      var al = getComputedStyle(root).getPropertyValue('--accent-light').trim();
      var accent = getComputedStyle(root).getPropertyValue('--accent').trim();
      root.style.setProperty('--brand-gradient',
        'linear-gradient(135deg, ' + config.primaryColor + ' 0%, ' + pl + ' 30%, ' + al + ' 70%, ' + accent + ' 100%)');
    }

    if (config.accentColor && !isDark) {
      if (!config.accentDeepColor) {
        root.style.setProperty('--accent-deep', adjustColor(config.accentColor, 0.7));
      }
      if (!config.accentLightColor) {
        root.style.setProperty('--accent-light', adjustColor(config.accentColor, 1.6));
      }
    }

    // Font pair
    if (config.fontPair && FONT_PAIRS[config.fontPair]) {
      var pair = FONT_PAIRS[config.fontPair];
      loadGoogleFont(pair.heading, pair.weights.heading);
      if (pair.heading !== pair.body) {
        loadGoogleFont(pair.body, pair.weights.body);
      }
      root.style.setProperty('--font-heading', "'" + pair.heading + "', serif");
      root.style.setProperty('--font-body', "'" + pair.body + "', sans-serif");
      // Update body and heading font families
      document.body.style.fontFamily = "'" + pair.body + "', sans-serif";
    }
  }

  /**
   * Resolve the base path for loading template manifests.
   * Handles subdirectory pages (blog/, events/, etc.).
   */
  function getBasePath() {
    var path = window.location.pathname;
    var depth = (path.match(/\//g) || []).length - 1;
    // If served from a subdirectory like /blog/post.html, go up
    if (depth > 0) {
      var prefix = '';
      for (var i = 0; i < depth; i++) prefix += '../';
      return prefix;
    }
    return '';
  }

  /**
   * Load the template manifest and expose it globally.
   * Returns a promise that resolves with the manifest or null.
   */
  function loadManifest(templateId) {
    if (!templateId) return Promise.resolve(null);

    var url = getBasePath() + 'templates/' + templateId + '/manifest.json';

    return fetch(url)
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (manifest) {
        if (manifest) {
          window.MAST_TEMPLATE_MANIFEST = manifest;
        }
        return manifest;
      })
      .catch(function (err) {
        console.warn('[storefront-theme] Failed to load template manifest:', err.message);
        return null;
      });
  }

  /**
   * Apply a color scheme from the manifest.
   * Looks up colorSchemeId in manifest.colorSchemes and applies the colors.
   */
  function applyColorScheme(manifest, colorSchemeId) {
    if (!manifest || !manifest.colorSchemes || !colorSchemeId) return false;

    var scheme = null;
    for (var i = 0; i < manifest.colorSchemes.length; i++) {
      if (manifest.colorSchemes[i].id === colorSchemeId) {
        scheme = manifest.colorSchemes[i];
        break;
      }
    }
    if (!scheme || !scheme.colors) return false;

    // Apply the color scheme as if it were a theme config
    applyTheme(scheme.colors);
    return true;
  }

  /**
   * Apply homepage flow from manifest.
   * Shows/hides and reorders sections based on manifest.homepageFlow.
   * Sections with data-slot NOT in the flow are hidden.
   * Sections IN the flow are shown and reordered.
   */
  function applyHomepageFlow(manifest) {
    if (!manifest || !manifest.homepageFlow) return;

    // Only apply on the homepage
    var path = window.location.pathname;
    if (path !== '/' && path !== '/index.html') return;

    var flow = manifest.homepageFlow;

    // Find all slotted sections
    var slotElements = document.querySelectorAll('[data-slot]');
    var slotMap = {};
    for (var i = 0; i < slotElements.length; i++) {
      var el = slotElements[i];
      slotMap[el.getAttribute('data-slot')] = el;
    }

    // Mark <body> so we can verify flow engine ran
    document.body.setAttribute('data-flow-applied', manifest.id || 'true');

    // Hide sections not in the flow
    Object.keys(slotMap).forEach(function (slotId) {
      if (flow.indexOf(slotId) === -1) {
        slotMap[slotId].style.display = 'none';
        slotMap[slotId].setAttribute('data-flow-hidden', 'true');
      }
    });

    // Show and reorder sections in the flow
    // Find the parent container (the main content area after nav)
    var firstSlot = slotMap[flow[0]];
    if (!firstSlot) return;
    var container = firstSlot.parentNode;

    // Collect non-slot elements (dividers, etc.) to preserve
    // We'll insert flow sections in order, collecting any glass-dividers to remove
    var dividers = container.querySelectorAll('.glass-divider');
    for (var d = 0; d < dividers.length; d++) {
      dividers[d].style.display = 'none';
    }

    // Reorder: append flow sections in order (moves them in DOM)
    for (var j = 0; j < flow.length; j++) {
      var slotEl = slotMap[flow[j]];
      if (slotEl) {
        // Mark as flow-active so JS data loaders know this section is wanted
        slotEl.removeAttribute('data-flow-hidden');
        slotEl.setAttribute('data-flow-active', 'true');
        // Show immediately if not waiting on JS data loading
        if (slotEl.style.display === 'none' && !slotEl.hasAttribute('data-default-hidden')) {
          slotEl.style.display = '';
        }
        container.appendChild(slotEl);
      }
    }

    // Re-append any remaining content (footer, scripts) that should stay at the end
    var footer = container.querySelector('footer, .site-footer');
    if (footer) container.appendChild(footer);
  }

  /**
   * Check for ?preview_template= query param.
   * Returns the preview template ID or null.
   */
  function getPreviewTemplateId() {
    try {
      var params = new URLSearchParams(window.location.search);
      return params.get('preview_template') || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Inject a preview banner at the top of the page.
   * Shows template name and a close link to remove the preview param.
   */
  function injectPreviewBanner(templateName) {
    if (document.getElementById('mast-preview-banner')) return;
    var banner = document.createElement('div');
    banner.id = 'mast-preview-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:10000;background:rgba(42,124,111,0.92);color:#fff;text-align:center;padding:10px 16px;font-family:var(--font-body,"DM Sans",sans-serif);font-size:0.85rem;backdrop-filter:blur(4px);';
    var esc = function(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; };
    var cleanUrl = window.location.pathname + window.location.hash;
    banner.innerHTML = 'Previewing <strong>' + esc(templateName) + '</strong>. Your published site has not changed. <a href="' + cleanUrl + '" style="color:#fff;text-decoration:underline;margin-left:8px;">Close Preview</a>';
    document.body.insertBefore(banner, document.body.firstChild);
    // Push body content down so banner doesn't overlay
    document.body.style.paddingTop = (banner.offsetHeight) + 'px';
  }

  /**
   * Load tenant theme config — from prefetched STOREFRONT_DATA if available,
   * otherwise falls back to direct Firebase RTDB fetch.
   */
  function fetchThemeConfig() {
    if (!window.TENANT_READY) return;

    var previewTemplateId = getPreviewTemplateId();
    if (previewTemplateId) {
      window.MAST_PREVIEW_MODE = true;
    }

    // Use prefetched data from storefront-tenant.js if available
    var configPromise;
    if (window.STOREFRONT_DATA) {
      configPromise = window.STOREFRONT_DATA.then(function(data) {
        return data ? data.theme : null;
      });
    } else {
      // Fallback: fetch directly (shouldn't happen in normal flow)
      configPromise = window.TENANT_READY.then(function() {
        if (!TENANT_ID || !TENANT_FIREBASE_CONFIG || !TENANT_FIREBASE_CONFIG.databaseURL) return null;
        var url = TENANT_FIREBASE_CONFIG.databaseURL + '/' + TENANT_ID + '/public/config/theme.json';
        return fetch(url).then(function(resp) { return resp.ok ? resp.json() : null; }).catch(function() { return null; });
      });
    }

    configPromise.then(function (config) {
          if (!config) config = {};

          // If preview mode, override templateId WITHOUT writing to Firebase
          var effectiveTemplateId = previewTemplateId || config.templateId;

          // Load template manifest if templateId is set
          var manifestPromise = loadManifest(effectiveTemplateId);

          manifestPromise.then(function (manifest) {
            // In preview mode, use the preview template's default color scheme
            var effectiveSchemeId = config.colorSchemeId;
            if (previewTemplateId && manifest) {
              var defaultScheme = (manifest.colorSchemes || []).find(function(s) { return s.default; });
              effectiveSchemeId = defaultScheme ? defaultScheme.id : (manifest.colorSchemes && manifest.colorSchemes[0] ? manifest.colorSchemes[0].id : null);
            }

            // If a colorSchemeId is set and we have a manifest, apply the scheme
            // Otherwise fall back to direct color config
            var schemeApplied = false;
            if (effectiveSchemeId && manifest) {
              schemeApplied = applyColorScheme(manifest, effectiveSchemeId);
            }

            // Apply direct theme config (colors, fontPair) — these override scheme colors
            // if explicitly set, or provide the theme when no scheme is used
            if (!schemeApplied && !previewTemplateId) {
              applyTheme(config);
            } else if (schemeApplied) {
              // Even with a scheme, apply fontPair
              var effectiveFontPair = config.fontPair;
              if (previewTemplateId && manifest) {
                var defaultFont = (manifest.fontPairs || []).find(function(f) { return f.default; });
                effectiveFontPair = defaultFont ? defaultFont.id : (manifest.fontPairs && manifest.fontPairs[0] ? manifest.fontPairs[0].id : null);
              }
              if (effectiveFontPair) {
                applyTheme({ fontPair: effectiveFontPair });
              }
            }

            // Apply homepage section flow from manifest (show/hide + reorder)
            if (manifest && manifest.homepageFlow) {
              // Wait for DOM to be ready before manipulating sections
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', function () {
                  applyHomepageFlow(manifest);
                });
              } else {
                applyHomepageFlow(manifest);
              }
            }

            // Inject preview banner after DOM is ready
            if (previewTemplateId && manifest) {
              var showBanner = function() { injectPreviewBanner(manifest.name || previewTemplateId); };
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', showBanner);
              } else {
                showBanner();
              }
            }

            // Apply default theme from manifest if no user preference is stored
            if (manifest && manifest.defaultTheme && !localStorage.getItem('mast-theme')) {
              var h = document.documentElement;
              if (manifest.defaultTheme === 'dark' && !h.classList.contains('dark')) {
                h.classList.remove('light');
                h.classList.add('dark');
              } else if (manifest.defaultTheme === 'light' && !h.classList.contains('light')) {
                h.classList.remove('dark');
                h.classList.add('light');
              }
            }

            // Inject theme toggle button (shared across all pages)
            var injectToggle = function () {
              if (document.getElementById('themeToggle')) return;
              var btn = document.createElement('button');
              btn.id = 'themeToggle';
              btn.title = 'Toggle dark mode';
              btn.setAttribute('style', 'position:fixed;top:12px;right:12px;z-index:9999;width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:var(--card);cursor:pointer;font-size:16px;box-shadow:var(--shadow);color:var(--text);display:flex;align-items:center;justify-content:center;padding:0;');
              btn.textContent = document.documentElement.classList.contains('dark') ? '\u2600' : '\uD83C\uDF19';
              btn.addEventListener('click', function () {
                var el = document.documentElement;
                var isDark = el.classList.contains('dark');
                if (isDark) { el.classList.remove('dark'); el.classList.add('light'); localStorage.setItem('mast-theme', 'light'); }
                else { el.classList.remove('light'); el.classList.add('dark'); localStorage.setItem('mast-theme', 'dark'); }
                btn.textContent = el.classList.contains('dark') ? '\u2600' : '\uD83C\uDF19';
              });
              document.body.appendChild(btn);
            };
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', injectToggle);
            } else {
              injectToggle();
            }

            // Resolve the theme-ready promise so data loaders know flow is applied
            if (window._resolveThemeReady) window._resolveThemeReady();

            // Dispatch event so downstream code knows theme is applied
            window.dispatchEvent(new CustomEvent('storefront-theme-ready', {
              detail: {
                config: config,
                manifest: manifest,
                templateId: effectiveTemplateId || null,
                colorSchemeId: effectiveSchemeId || null,
                previewMode: !!previewTemplateId
              }
            }));
          });
        })
        .catch(function (err) {
          console.warn('[storefront-theme] Failed to load theme config:', err.message);
          // Inject toggle even on error
          var injectToggleFallback = function () {
            if (document.getElementById('themeToggle')) return;
            var btn = document.createElement('button');
            btn.id = 'themeToggle';
            btn.title = 'Toggle dark mode';
            btn.setAttribute('style', 'position:fixed;top:12px;right:12px;z-index:9999;width:36px;height:36px;border-radius:50%;border:1px solid var(--border);background:var(--card);cursor:pointer;font-size:16px;box-shadow:var(--shadow);color:var(--text);display:flex;align-items:center;justify-content:center;padding:0;');
            btn.textContent = document.documentElement.classList.contains('dark') ? '\u2600' : '\uD83C\uDF19';
            btn.addEventListener('click', function () {
              var el = document.documentElement;
              var isDark = el.classList.contains('dark');
              if (isDark) { el.classList.remove('dark'); el.classList.add('light'); localStorage.setItem('mast-theme', 'light'); }
              else { el.classList.remove('light'); el.classList.add('dark'); localStorage.setItem('mast-theme', 'dark'); }
              btn.textContent = el.classList.contains('dark') ? '\u2600' : '\uD83C\uDF19';
            });
            document.body.appendChild(btn);
          };
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', injectToggleFallback);
          } else {
            injectToggleFallback();
          }
          if (window._resolveThemeReady) window._resolveThemeReady();
          // Still dispatch event with empty config so pages don't wait forever
          window.dispatchEvent(new CustomEvent('storefront-theme-ready', { detail: {} }));
        });
  }

  // Start fetching theme config
  // Expose a promise that resolves when flow engine has run (or skipped)
  // so downstream scripts can wait before showing sections
  window.MAST_THEME_READY = new Promise(function (resolve) {
    window._resolveThemeReady = resolve;
  });

  fetchThemeConfig();

})();
