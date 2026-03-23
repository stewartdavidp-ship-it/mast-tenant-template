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

  // Wait for both TENANT_READY and DOM before applying brand
  window.TENANT_READY.then(function() {
    var brand = window.TENANT_BRAND || {};
    var config = window.TENANT_FIREBASE_CONFIG || {};
    var tenantId = window.TENANT_ID;

    // Fetch extended brand config from platform publicConfig (world-readable)
    var PLATFORM_BASE = 'https://mast-platform-prod-default-rtdb.firebaseio.com/mast-platform';
    var brandReady;
    if (tenantId) {
      var publicConfigUrl = PLATFORM_BASE + '/tenants/' + tenantId + '/publicConfig.json';
      brandReady = fetch(publicConfigUrl)
        .then(function(resp) { return resp.ok ? resp.json() : null; })
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


    // Update document.title
    document.title = document.title.replace(/My Shop/g, name);

    // Update data-tenant elements
    var elements = document.querySelectorAll('[data-tenant]');
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var type = el.getAttribute('data-tenant');

      switch (type) {
        case 'brand':
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

    // Update footer logo and gate logos from nav config logoUrl
    var tid = window.TENANT_ID;
    if (tid) {
      var tenantDb = firebase.database();
      tenantDb.ref(tid + '/public/config/nav/logoUrl').once('value').then(function(snap) {
        var logoUrl = snap.val();
        if (logoUrl) {
          var logoEls = document.querySelectorAll('.footer-logo img, .ws-gate-logo');
          for (var fi = 0; fi < logoEls.length; fi++) {
            logoEls[fi].src = logoUrl;
            logoEls[fi].alt = name;
          }
        } else {
          // No logo — hide the placeholder images
          var logoEls = document.querySelectorAll('.footer-logo img, .ws-gate-logo');
          for (var fi = 0; fi < logoEls.length; fi++) {
            logoEls[fi].style.display = 'none';
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
})();
