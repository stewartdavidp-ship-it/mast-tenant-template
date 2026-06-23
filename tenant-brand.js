/**
 * Tenant Brand Injection
 *
 * Runs after storefront-tenant.js resolves TENANT_READY.
 * Replaces all hardcoded brand strings in the page with values
 * from TENANT_BRAND (loaded from platform RTDB publicConfig).
 *
 * HTML elements use data attributes to mark dynamic content:
 *   data-tenant="brand"        → TENANT_BRAND.name
 *   data-tenant="tagline"      → TENANT_BRAND.tagline
 *   data-tenant="domain"       → TENANT_BRAND.domain
 *   data-tenant="location"     → TENANT_BRAND.location (from config)
 *   data-tenant="email"        → contact email (from config)
 *   data-tenant="instagram"    → Instagram URL (from config)
 *   data-tenant="year-brand"   → "© {year} {brand}"
 *   data-tenant="brand-location" → "{brand} • {location}"
 *
 * Also updates:
 *   document.title — replaces default brand placeholder with brand name
 *   [data-tenant-href]         → updates href attribute
 *   [data-tenant-alt]          → updates alt attribute
 *   [data-tenant-title]        → updates title attribute
 */

(function() {
  if (typeof window.TENANT_READY === 'undefined') return;

  // Wait for both TENANT_READY and DOM before applying brand.
  // Also await STOREFRONT_DATA so TENANT_BRAND.name/tagline have been upgraded
  // to canonical config/brand values (storefront-tenant.js mutates in place).
  // Falls through gracefully if STOREFRONT_DATA isn't present (e.g. legacy callers).
  var storefrontReady = window.STOREFRONT_DATA && typeof window.STOREFRONT_DATA.then === 'function'
    ? window.STOREFRONT_DATA.catch(function() { return null; })
    : Promise.resolve(null);
  Promise.all([window.TENANT_READY, storefrontReady]).then(function() {
    var brand = window.TENANT_BRAND || {};
    var config = window.TENANT_FIREBASE_CONFIG || {};
    var tenantId = window.TENANT_ID;

    // Fetch extended brand config from platform publicConfig (world-readable)
    var PLATFORM_PROJECT_ID = window.MAST_POD_PLATFORM_PROJECT || 'mast-platform-prod';
    var PLATFORM_FS_BASE = 'https://firestore.googleapis.com/v1/projects/' + PLATFORM_PROJECT_ID + '/databases/(default)/documents';
    var brandReady;
    if (tenantId) {
      var publicConfigUrl = PLATFORM_FS_BASE + '/platform_tenantPublicConfigs/' + tenantId;
      brandReady = fetch(publicConfigUrl)
        .then(function(resp) { return resp.ok ? resp.json() : null; })
        .then(function(doc) {
          if (!doc || !doc.fields) return null;
          // Firestore REST → JS value unwrap
          function uv(v) {
            if (v == null) return null;
            if ('stringValue' in v) return v.stringValue;
            if ('booleanValue' in v) return v.booleanValue;
            if ('integerValue' in v) return Number(v.integerValue);
            if ('doubleValue' in v) return v.doubleValue;
            if ('nullValue' in v) return null;
            if ('timestampValue' in v) return v.timestampValue;
            if ('mapValue' in v) { var o = {}; var f = v.mapValue.fields || {}; for (var k in f) o[k] = uv(f[k]); return o; }
            if ('arrayValue' in v) return (v.arrayValue.values || []).map(uv);
            return null;
          }
          var out = {};
          for (var k in doc.fields) out[k] = uv(doc.fields[k]);
          return out;
        })
        .then(function(pc) {
          if (pc) {
            brand.location = pc.brandLocation || brand.location || '';
            brand.email = pc.contactEmail || '';
            brand.instagram = pc.instagramUrl || '';
            brand.etsy = pc.etsyUrl || '';
            brand.description = pc.brandDescription || '';
            brand.ownerNames = pc.ownerNames || '';
            brand._tenantStatus = pc.tenantStatus || 'active';
          }
          return brand;
        })
        .catch(function() { return brand; });
    } else {
      brandReady = Promise.resolve(brand);
    }

    // Ensure DOM is loaded before manipulating elements
    var domReady = new Promise(function(resolve) {
      if (document.readyState !== 'loading') resolve();
      else document.addEventListener('DOMContentLoaded', resolve);
    });

    Promise.all([brandReady, domReady]).then(function(results) {
      var b = results[0];

      // If tenant hasn't set up their storefront yet, show a clean placeholder
      // instead of the template's default content.
      // Only on public pages — never replace the admin app (/app/).
      var isAdminApp = window.location.pathname.indexOf('/app') === 0;
      if (!isAdminApp && (b._tenantStatus === 'onboarding' || b._tenantStatus === 'provisioning')) {
        showComingSoon(b);
        return;
      }

      applyBrand(b);
    });
  });

  function applyBrand(brand) {

    var name = brand.name || 'Shop';
    var tagline = brand.tagline || '';
    var domain = brand.domain || '';
    var location = brand.location || '';
    var email = brand.ownerEmail || brand.email || '';
    var instagram = brand.instagram || '';
    var year = new Date().getFullYear();


    // Update document.title — replace any literal "My Shop" placeholder.
    // W1.5: also set a fallback title here using just brand name; SEO meta
    // upgrade happens in applySeoMeta() once we've loaded voice fields.
    document.title = (document.title || '').replace(/My Shop/g, name);
    if (!document.title || /My Shop/i.test(document.title)) document.title = name;

    // W1.5 — apply SEO meta + OG/Twitter tags from brand voice fields.
    // Reads tagline + positioningOneLiner from public/config/brand (mirrored
    // from config/brand/voice by the admin Voice subtab). Falls back to
    // brand.tagline (legacy registry field) and brand.description.
    applySeoMeta(brand, name);

    // Update data-tenant elements
    var elements = document.querySelectorAll('[data-tenant]');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var type = el.getAttribute('data-tenant');

      switch (type) {
        case 'brand':
          // Don't overwrite if storefront-content.js already set section-specific content
          if (el.hasAttribute('data-content') && el.getAttribute('data-content-applied')) break;
          el.textContent = name;
          break;
        case 'tagline':
          el.textContent = tagline;
          break;
        case 'domain':
          el.textContent = domain;
          break;
        case 'location':
          if (location) { el.textContent = location; }
          else { var lp = el.closest('.contact-info-item'); if (lp) lp.style.display = 'none'; }
          break;
        case 'email':
          if (email) {
            el.textContent = email;
            if (el.tagName === 'A') el.href = 'mailto:' + email;
          } else { var ep = el.closest('.contact-info-item'); if (ep) ep.style.display = 'none'; }
          break;
        case 'instagram':
          if (instagram) {
            el.textContent = '@' + instagram.replace(/.*instagram\.com\//, '').replace(/\/$/, '');
            if (el.tagName === 'A') el.href = instagram;
          } else { var ip = el.closest('.contact-info-item'); if (ip) ip.style.display = 'none'; }
          break;
        case 'year-brand':
          el.textContent = '\u00A9 ' + year + ' ' + name;
          break;
        case 'brand-location':
          el.textContent = location ? (name + ' \u2022 ' + location) : name;
          break;
        case 'description':
          // If this element is also bound to a data-content key (e.g. the About
          // body, which storefront-content.js fills from sections.about.body),
          // that source is authoritative — defer to it entirely and NEVER hide
          // here. Hiding on empty brand.description used to win an ordering race
          // against storefront-content.js, leaving a populated body display:none.
          if (el.hasAttribute('data-content')) break;
          if (brand.description) el.textContent = brand.description;
          else el.style.display = 'none';
          break;
        case 'ownerNames':
          if (brand.ownerNames) el.textContent = brand.ownerNames;
          else el.style.display = 'none';
          break;
        case 'location-description':
          if (location && brand.description) {
            el.textContent = 'Based in ' + location + ', ' + brand.description.charAt(0).toLowerCase() + brand.description.slice(1);
          } else { el.style.display = 'none'; }
          break;
      }
    }

    // Update href attributes on elements with data-tenant-href
    var hrefEls = document.querySelectorAll('[data-tenant-href]');
    for (var j = 0; j < hrefEls.length; j++) {
      var hel = hrefEls[j];
      var htype = hel.getAttribute('data-tenant-href');
      if (htype === 'instagram' && instagram) hel.href = instagram;
      if (htype === 'email' && email) hel.href = 'mailto:' + email;
      if (htype === 'etsy' && brand.etsy) hel.href = brand.etsy;
    }

    // Update alt text
    var altEls = document.querySelectorAll('[data-tenant-alt]');
    for (var k = 0; k < altEls.length; k++) {
      altEls[k].alt = name;
    }

    // Update footer logo and gate logos — read order:
    //   1. public/config/brand/logo/footer.url    (placement-specific, public mirror)
    //   2. config/brand/logo/primary.url          (canonical)
    // Phase 4: legacy public/config/nav/logoUrl fallback removed; canonical is sole source.
    var tid = window.TENANT_ID;
    if (tid && typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length > 0 && firebase.firestore) {
      // Ensure MastDB is initialized — tenant-brand.js may run before host page inits it.
      if (typeof MastDB !== 'undefined' && !MastDB.tenantId()) {
        MastDB.init({ firestore: firebase.firestore(), tenantId: tid });
      }

      var applyFooterLogo = function(url, maxHeight) {
        var logoEls = document.querySelectorAll('.footer-logo img, .ws-gate-logo');
        for (var fi = 0; fi < logoEls.length; fi++) {
          if (url) {
            logoEls[fi].src = url;
            logoEls[fi].alt = name;
            if (maxHeight) logoEls[fi].style.maxHeight = maxHeight + 'px';
          } else {
            logoEls[fi].style.display = 'none';
          }
        }
      };

      var readPrimaryLogo = function() {
        // Canonical: config/brand doc, field logo.primary.url
        return MastDB.get('config/brand').then(function(brand) {
          var primary = brand && brand.logo && brand.logo.primary;
          return primary && primary.url ? primary.url : null;
        }).catch(function() { return null; });
      };

      MastDB.get('public/config/brand/logo/footer').then(function(brandFooter) {
        if (brandFooter && brandFooter.url) {
          applyFooterLogo(brandFooter.url, brandFooter.maxHeight);
          return;
        }
        // No placement-specific footer — fall back to canonical primary.
        readPrimaryLogo().then(function(primaryUrl) {
          applyFooterLogo(primaryUrl, null);
        });
      }).catch(function() {
        // public/config/brand/logo/footer read failed — fall back to canonical primary.
        readPrimaryLogo().then(function(primaryUrl) {
          applyFooterLogo(primaryUrl, null);
        });
      });

      // Favicon — read from brand system if configured
      MastDB.get('public/config/brand/logo/favicon/url').then(function(faviconUrl) {
        if (faviconUrl) {
          var link = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
          if (link) {
            link.href = faviconUrl;
          } else {
            var newLink = document.createElement('link');
            newLink.rel = 'icon';
            newLink.href = faviconUrl;
            document.head.appendChild(newLink);
          }
        }
      }).catch(function() {});

      // Custom legal URL overrides (privacy/terms/security/ai) — legal practice-rec #11
      // If tenant has set a custom URL in public/config/privacy, rewrite footer links.
      MastDB.get('public/config/privacy').then(function(cfg) {
        if (!cfg) return;
        var overrides = {
          'runmast.com/privacy': cfg.customPrivacyUrl,
          'runmast.com/terms': cfg.customTermsUrl,
          'runmast.com/security': cfg.customSecurityUrl,
          'runmast.com/ai': cfg.customAiUrl
        };
        for (var key in overrides) {
          var customUrl = overrides[key];
          if (!customUrl || typeof customUrl !== 'string') continue;
          var trimmed = customUrl.trim();
          if (!trimmed) continue;
          // Basic http(s) validation — skip anything that isn't a plausible URL
          if (!/^https?:\/\//i.test(trimmed)) continue;
          var selector = 'a[href*="' + key + '"]';
          var links = document.querySelectorAll(selector);
          for (var li = 0; li < links.length; li++) {
            links[li].href = trimmed;
          }
        }
      }).catch(function() {});
    }

    // Dispatch event so page-specific JS can react
    window.dispatchEvent(new CustomEvent('tenant-brand-ready', { detail: brand }));
  }

  function showComingSoon(brand) {
    var name = brand.name || 'This site';
    var adminUrl = window.location.origin + '/app/';
    document.title = name + ' — Coming Soon';
    document.body.innerHTML = '' +
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;' +
      'background:var(--bg,#faf7f3);font-family:\'DM Sans\',sans-serif;padding:40px;">' +
      '<div style="text-align:center;max-width:480px;">' +
      '<div style="font-size:48px;margin-bottom:24px;">🚀</div>' +
      '<h1 style="font-family:\'Archivo\',sans-serif;font-weight:800;font-size:clamp(28px,4vw,40px);' +
      'color:var(--text,#1a1a1a);letter-spacing:-0.025em;margin-bottom:16px;">' + name + '</h1>' +
      '<p style="font-size:18px;color:var(--soft,#555);font-weight:300;line-height:1.7;margin-bottom:32px;">' +
      'We\'re setting things up. Check back soon!</p>' +
      '<a href="' + adminUrl + '" style="display:inline-block;padding:14px 32px;' +
      'background:var(--amber,#e8a84c);color:#111820;border-radius:10px;text-decoration:none;' +
      'font-weight:600;font-size:15px;">Go to Admin →</a>' +
      '</div></div>';

    // Dispatch event so downstream JS doesn't break waiting for it
    window.dispatchEvent(new CustomEvent('tenant-brand-ready', { detail: brand }));
  }

  // Export helper for JS files that set document.title dynamically
  window.TENANT_TITLE_SUFFIX = function() {
    return (window.TENANT_BRAND && window.TENANT_BRAND.name) || 'Shop';
  };

  // ─── W1.5: SEO meta + OG/Twitter from Brand Voice ───
  // Sets/upserts <title>, meta description, og:*, twitter:* on every public page.
  // Skips the /app/ admin shell.
  function applySeoMeta(brand, name) {
    if (window.location.pathname.indexOf('/app') === 0) return;

    var tagline = brand.tagline || '';
    var positioning = brand.description || '';
    var logoUrl = '';

    function upsertMeta(attrName, attrValue, contentValue) {
      var sel = 'meta[' + attrName + '="' + attrValue + '"]';
      var el = document.head.querySelector(sel);
      if (!contentValue) {
        // No value to set — remove any pre-rendered placeholder so we don't
        // ship empty `content=""` to crawlers (worse than no tag at all).
        if (el && el.parentNode) el.parentNode.removeChild(el);
        return;
      }
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attrName, attrValue);
        document.head.appendChild(el);
      }
      el.setAttribute('content', contentValue);
    }

    // F3 — upsert <link rel="canonical"> on every public page. Strip query
    // strings; preserve the path. Blog post page sets a more specific
    // canonical of its own AFTER us (post.canonical || self with ?id=) — we
    // do not overwrite a canonical that's already been pinned to a non-self
    // URL by page code.
    function upsertCanonical() {
      try {
        var href = window.location.origin + window.location.pathname;
        var link = document.head.querySelector('link[rel="canonical"]');
        if (link) {
          var existing = link.getAttribute('href') || '';
          // Honor explicit canonicals that point off-page (e.g. blog post
          // with post.canonical override). Only overwrite if it's empty or
          // points to a stale "My Shop" placeholder origin.
          if (existing && existing !== href && existing.indexOf('?') === -1) return;
        } else {
          link = document.createElement('link');
          link.setAttribute('rel', 'canonical');
          document.head.appendChild(link);
        }
        link.setAttribute('href', href);
      } catch (_e) {}
    }

    function applyAll() {
      // Title: "{name} — {tagline}" if both, else just name
      var pageTitle = tagline ? (name + ' — ' + tagline) : name;
      // Honor page-specific titles (e.g. product detail) — only overwrite
      // the generic landing-style title, not titles that already contain a
      // page-specific subject. Also catch the new "Storefront" static default
      // we ship in the HTML.
      var current = document.title || '';
      if (!current || /My Shop/i.test(current) || /^Storefront$/i.test(current) || current === name || current === pageTitle) {
        document.title = pageTitle;
      }

      var description = positioning || tagline || '';

      upsertMeta('name', 'description', description);
      upsertMeta('property', 'og:title', pageTitle);
      upsertMeta('property', 'og:description', description);
      upsertMeta('property', 'og:type', 'website');
      upsertMeta('property', 'og:site_name', name);
      try {
        upsertMeta('property', 'og:url', window.location.origin + window.location.pathname);
      } catch (_e) {}
      // F2 — only emit og:image / twitter:image when we have a real URL.
      // upsertMeta now removes pre-existing tags when content is empty.
      upsertMeta('property', 'og:image', logoUrl || '');

      upsertMeta('name', 'twitter:card', logoUrl ? 'summary_large_image' : 'summary');
      upsertMeta('name', 'twitter:title', pageTitle);
      upsertMeta('name', 'twitter:description', description);
      upsertMeta('name', 'twitter:image', logoUrl || '');

      upsertCanonical();
    }

    // F2 — resolve og:image through a fallback chain:
    //   1. public/config/brand/logo/hero/url
    //   2. public/config/brand/logo/primary/url
    //   3. public/config/brand/heroImageUrl
    //   4. first featured product image
    // First non-empty wins. Null/empty everywhere → no og:image tag at all.
    function resolveOgImage() {
      var chain = [
        MastDB.get('public/config/brand/logo/hero/url').catch(function() { return null; }),
        MastDB.get('public/config/brand/logo/primary/url').catch(function() { return null; }),
        MastDB.get('public/config/brand/heroImageUrl').catch(function() { return null; })
      ];
      return Promise.all(chain).then(function(vals) {
        for (var i = 0; i < vals.length; i++) {
          if (vals[i] && typeof vals[i] === 'string') return vals[i];
        }
        // Last resort: first featured product image. Tolerant of multiple
        // schemas: products keyed by id with imageUrl|images[0].url|thumbnailUrl.
        return MastDB.get('public/products').then(function(pm) {
          if (!pm || typeof pm !== 'object') return null;
          var keys = Object.keys(pm);
          for (var k = 0; k < keys.length; k++) {
            var p = pm[keys[k]];
            if (!p || p.featured !== true) continue;
            var url = p.imageUrl ||
              (Array.isArray(p.images) && p.images[0] && (p.images[0].url || p.images[0])) ||
              p.thumbnailUrl || null;
            if (url) return url;
          }
          // No featured product image either — return null to omit the tag.
          return null;
        }).catch(function() { return null; });
      });
    }

    // Try to enrich with voice + logo from Firestore, then apply. If
    // MastDB isn't initialized yet, apply with what we have synchronously.
    var canRead = (typeof MastDB !== 'undefined') && MastDB.tenantId && MastDB.tenantId();
    if (canRead) {
      Promise.all([
        MastDB.get('public/config/brand/tagline').catch(function() { return null; }),
        MastDB.get('public/config/brand/positioningOneLiner').catch(function() { return null; }),
        resolveOgImage()
      ]).then(function(vals) {
        if (vals[0]) tagline = vals[0];
        if (vals[1]) positioning = vals[1];
        if (vals[2]) logoUrl = vals[2];
        applyAll();
      }).catch(function() { applyAll(); });
    } else {
      applyAll();
    }
  }
})();
