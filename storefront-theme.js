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
    Object.keys(COLOR_MAP).forEach(function (key) {
      if (config[key]) {
        root.style.setProperty(COLOR_MAP[key], config[key]);
      }
    });

    // Auto-generate variants if only primary/accent provided
    if (config.primaryColor) {
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

    if (config.accentColor) {
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
   * Fetch tenant theme config from Firebase RTDB (REST API).
   */
  function fetchThemeConfig() {
    if (!window.TENANT_READY) return;

    window.TENANT_READY.then(function () {
      if (!TENANT_ID || !TENANT_FIREBASE_CONFIG || !TENANT_FIREBASE_CONFIG.databaseURL) return;

      // Read from public/config/theme — anonymously readable per RTDB rules
      var url = TENANT_FIREBASE_CONFIG.databaseURL + '/' + TENANT_ID + '/public/config/theme.json';

      fetch(url)
        .then(function (resp) {
          if (!resp.ok) return null;
          return resp.json();
        })
        .then(function (config) {
          if (!config) {
            window.dispatchEvent(new CustomEvent('storefront-theme-ready', { detail: {} }));
            return;
          }

          // Load template manifest if templateId is set
          var manifestPromise = loadManifest(config.templateId);

          manifestPromise.then(function (manifest) {
            // If a colorSchemeId is set and we have a manifest, apply the scheme
            // Otherwise fall back to direct color config
            var schemeApplied = false;
            if (config.colorSchemeId && manifest) {
              schemeApplied = applyColorScheme(manifest, config.colorSchemeId);
            }

            // Apply direct theme config (colors, fontPair) — these override scheme colors
            // if explicitly set, or provide the theme when no scheme is used
            if (!schemeApplied) {
              applyTheme(config);
            } else {
              // Even with a scheme, apply fontPair if set in config
              if (config.fontPair) {
                applyTheme({ fontPair: config.fontPair });
              }
            }

            // Dispatch event so downstream code knows theme is applied
            window.dispatchEvent(new CustomEvent('storefront-theme-ready', {
              detail: {
                config: config,
                manifest: manifest,
                templateId: config.templateId || null,
                colorSchemeId: config.colorSchemeId || null
              }
            }));
          });
        })
        .catch(function (err) {
          console.warn('[storefront-theme] Failed to load theme config:', err.message);
          // Still dispatch event with empty config so pages don't wait forever
          window.dispatchEvent(new CustomEvent('storefront-theme-ready', { detail: {} }));
        });
    });
  }

  // Start fetching theme config
  fetchThemeConfig();

})();
