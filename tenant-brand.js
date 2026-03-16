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
 *   document.title — replaces "Shir Glassworks" with brand name
 *   [data-tenant-href]         → updates href attribute
 *   [data-tenant-alt]          → updates alt attribute
 *   [data-tenant-title]        → updates title attribute
 */

(function() {
  if (typeof window.TENANT_READY === 'undefined') return;

  // Extend TENANT_BRAND with additional config from RTDB
  window.TENANT_READY.then(function() {
    var brand = window.TENANT_BRAND || {};
    var config = window.TENANT_FIREBASE_CONFIG || {};
    var tenantId = window.TENANT_ID;

    // Fetch extended brand config (location, email, social) from tenant RTDB
    if (config.databaseURL && tenantId) {
      var configUrl = config.databaseURL + '/' + tenantId + '/config.json';
      fetch(configUrl)
        .then(function(resp) { return resp.ok ? resp.json() : null; })
        .then(function(tenantConfig) {
          if (tenantConfig) {
            brand.location = (tenantConfig.brand && tenantConfig.brand.location) || brand.location || '';
            brand.email = (tenantConfig.email && tenantConfig.email.fromEmail) || '';
            brand.ownerEmail = (tenantConfig.email && tenantConfig.email.ownerEmail) || brand.email || '';
            brand.instagram = (tenantConfig.brand && tenantConfig.brand.instagram) || '';
            brand.etsy = (tenantConfig.brand && tenantConfig.brand.etsy) || '';
            brand.description = (tenantConfig.brand && tenantConfig.brand.description) || '';
            brand.ownerNames = (tenantConfig.brand && tenantConfig.brand.ownerNames) || '';
            brand.brandVoice = (tenantConfig.brand && tenantConfig.brand.brandVoice) || '';
          }
          applyBrand(brand);
        })
        .catch(function() {
          // Config fetch failed — apply what we have from publicConfig
          applyBrand(brand);
        });
    } else {
      applyBrand(brand);
    }
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
    document.title = document.title.replace(/Shir Glassworks/g, name);

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
          el.textContent = location;
          break;
        case 'email':
          el.textContent = email;
          if (el.tagName === 'A') el.href = 'mailto:' + email;
          break;
        case 'instagram':
          if (instagram) {
            el.textContent = '@' + instagram.replace(/.*instagram\.com\//, '').replace(/\/$/, '');
            if (el.tagName === 'A') el.href = instagram;
          }
          break;
        case 'year-brand':
          el.innerHTML = '&copy; ' + year + ' ' + name;
          break;
        case 'brand-location':
          el.innerHTML = name + ' &bull; ' + location;
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

    // Dispatch event so page-specific JS can react
    window.dispatchEvent(new CustomEvent('tenant-brand-ready', { detail: brand }));
  }

  // Export helper for JS files that set document.title dynamically
  window.TENANT_TITLE_SUFFIX = function() {
    return (window.TENANT_BRAND && window.TENANT_BRAND.name) || 'Shop';
  };
})();
