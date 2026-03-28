/**
 * Storefront Tenant Resolution + Firebase Config + Parallel Data Prefetch
 *
 * Resolves the current tenant dynamically from the Mast platform RTDB.
 * All storefront files include this script before other JS to make
 * TENANT_ID, TENANT_FIREBASE_CONFIG, and TENANT_BRAND available.
 *
 * Resolution flow:
 *   1. Extract hostname from window.location
 *   2. Check localStorage cache (5-minute TTL)
 *   3. On cache miss: fetch tenantsByDomain → tenantId → publicConfig
 *   4. Set globals and resolve window.TENANT_READY
 *   5. Immediately fire parallel prefetch of theme, nav, promoBanner
 *      → exposed as window.STOREFRONT_DATA (Promise)
 *
 * Downstream pages should await window.TENANT_READY before using
 * TENANT_ID, TENANT_FIREBASE_CONFIG, or TENANT_BRAND.
 * storefront-theme.js and storefront-nav.js await STOREFRONT_DATA
 * instead of making their own Firebase calls.
 */

var TENANT_ID = null;
var TENANT_FIREBASE_CONFIG = null;
var TENANT_BRAND = null;

var PLATFORM_RTDB_BASE = 'https://mast-platform-prod-default-rtdb.firebaseio.com/mast-platform';
var CACHE_TTL_MS = 60 * 1000; // 1 minute

window.TENANT_READY = new Promise(function(resolve, reject) {
  // --- helpers ---

  function escapeHostname(hostname) {
    // Firebase keys cannot contain . so we replace with _
    return hostname.replace(/\./g, '_');
  }

  function getCachedTenant(hostname) {
    try {
      var raw = localStorage.getItem('mast_tenant_' + hostname);
      if (!raw) return null;
      var cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
        localStorage.removeItem('mast_tenant_' + hostname);
        return null;
      }
      return cached.data;
    } catch (e) {
      return null;
    }
  }

  function setCachedTenant(hostname, data) {
    try {
      localStorage.setItem('mast_tenant_' + hostname, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) {
      // localStorage full or unavailable — non-fatal
    }
  }

  function setGlobals(tenantId, publicConfig) {
    TENANT_ID = tenantId;

    TENANT_FIREBASE_CONFIG = {
      apiKey: publicConfig.apiKey || '',
      authDomain: publicConfig.authDomain || '',
      databaseURL: publicConfig.databaseURL,
      projectId: publicConfig.projectId || '',
      storageBucket: publicConfig.storageBucket,
      cloudFunctionsBase: publicConfig.cloudFunctionsBase
    };

    TENANT_BRAND = {
      name: publicConfig.brandName || publicConfig.name,
      tagline: publicConfig.brandTagline || '',
      domain: publicConfig.domain || ''
    };

    // Platform-level Google Maps API key for checkout address autocomplete
    // Client-side key, restricted by HTTP referrer (*.web.app, *.runmast.com)
    window.MAST_GOOGLE_MAPS_KEY = publicConfig.googleMapsApiKey || 'AIzaSyBVvmq3xHDnSHFY8KrypURwwYC4Th69P3U';

    // Block search engines unless tenant has explicitly opted in
    if (!publicConfig.searchable) {
      var meta = document.createElement('meta');
      meta.name = 'robots';
      meta.content = 'noindex, nofollow';
      document.head.appendChild(meta);
    }
  }

  function showError() {
    document.addEventListener('DOMContentLoaded', function() {
      document.body.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:center;height:100vh;' +
        'font-family:system-ui,sans-serif;background:#0a0a1a;color:#e0e0e0;text-align:center;padding:2rem;">' +
        '<div><h1 style="font-size:2rem;margin-bottom:1rem;">Shop Not Found</h1>' +
        '<p style="color:#888;font-size:1.1rem;">We couldn\u2019t find a shop at this address.</p>' +
        '<p style="color:#666;margin-top:1rem;font-size:0.9rem;">If you believe this is an error, please contact support.</p></div></div>';
    });
  }

  // --- resolution ---

  var hostname = window.location.hostname;

  // Local dev override: ?tenant=other_tenant
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    var urlParams = new URLSearchParams(window.location.search);
    var override = urlParams.get('tenant');
    if (override) {
      // For local dev, resolve tenant from platform RTDB same as production.
      // The override just sets the tenantId — config comes from publicConfig.
      TENANT_ID = override;
      var devConfigUrl = PLATFORM_RTDB_BASE + '/tenants/' + override + '/publicConfig.json';
      fetch(devConfigUrl)
        .then(function(resp) { return resp.ok ? resp.json() : null; })
        .then(function(publicConfig) {
          if (publicConfig) {
            setGlobals(override, publicConfig);
          } else {
            // Minimal fallback for truly local dev
            TENANT_FIREBASE_CONFIG = {
              apiKey: '',
              authDomain: 'mast-platform-prod.firebaseapp.com',
              databaseURL: 'https://mast-platform-prod-default-rtdb.firebaseio.com',
              projectId: 'mast-platform-prod',
              storageBucket: 'mast-platform-prod.firebasestorage.app',
              cloudFunctionsBase: 'https://us-central1-mast-platform-prod.cloudfunctions.net'
            };
            TENANT_BRAND = { name: 'Dev Tenant', tagline: '', domain: 'localhost' };
          }
          resolve({ tenantId: override, source: 'url-override' });
        })
        .catch(function() {
          TENANT_FIREBASE_CONFIG = {
            apiKey: '',
            authDomain: 'mast-platform-prod.firebaseapp.com',
            databaseURL: 'https://mast-platform-prod-default-rtdb.firebaseio.com',
            projectId: 'mast-platform-prod',
            storageBucket: 'mast-platform-prod.firebasestorage.app',
            cloudFunctionsBase: 'https://us-central1-mast-platform-prod.cloudfunctions.net'
          };
          TENANT_BRAND = { name: 'Dev Tenant', tagline: '', domain: 'localhost' };
          resolve({ tenantId: override, source: 'url-override' });
        });
      return;
    }
  }

  // Check cache first
  var cached = getCachedTenant(hostname);
  if (cached) {
    setGlobals(cached.tenantId, cached.publicConfig);
    resolve({ tenantId: cached.tenantId, source: 'cache' });
    return;
  }

  // Use early prefetch from inline <head> script if available.
  // This fetch started during HTML parsing — before this script downloaded.
  var tenantPromise;
  if (window.__earlyTenant) {
    tenantPromise = window.__earlyTenant.then(function(result) {
      if (!result) throw new Error('No tenant found for hostname: ' + hostname);
      return result;
    });
  } else {
    // Fallback: fetch directly (pages without the inline prefetch)
    var escapedHost = escapeHostname(hostname);
    var domainUrl = PLATFORM_RTDB_BASE + '/tenantsByDomain/' + escapedHost + '.json';
    tenantPromise = fetch(domainUrl)
      .then(function(resp) {
        if (!resp.ok) throw new Error('Domain lookup failed: ' + resp.status);
        return resp.json();
      })
      .then(function(tenantId) {
        if (!tenantId) throw new Error('No tenant found for hostname: ' + hostname);
        var configUrl = PLATFORM_RTDB_BASE + '/tenants/' + tenantId + '/publicConfig.json';
        return fetch(configUrl).then(function(resp) {
          if (!resp.ok) throw new Error('Config lookup failed: ' + resp.status);
          return resp.json();
        }).then(function(publicConfig) {
          if (!publicConfig) throw new Error('No publicConfig for tenant: ' + tenantId);
          return { tenantId: tenantId, publicConfig: publicConfig };
        });
      });
  }

  tenantPromise
    .then(function(result) {
      setCachedTenant(hostname, result);
      setGlobals(result.tenantId, result.publicConfig);
      resolve({ tenantId: result.tenantId, source: window.__earlyTenant ? 'early-prefetch' : 'network' });
    })
    .catch(function(err) {
      console.error('[storefront-tenant] Resolution failed:', err.message);
      showError();
      reject(err);
    });
});

/**
 * Parallel prefetch of storefront config data.
 * Fires theme, nav, and promoBanner reads simultaneously once tenant is resolved.
 * Also prefetches page-specific data based on current pathname.
 *
 * Downstream scripts (storefront-theme.js, storefront-nav.js) consume
 * this promise instead of making their own Firebase calls.
 *
 * Caches in localStorage alongside tenant data (same 5-min TTL).
 */
window.STOREFRONT_DATA = window.TENANT_READY.then(function() {
  if (!TENANT_ID || !TENANT_FIREBASE_CONFIG || !TENANT_FIREBASE_CONFIG.databaseURL) {
    return { theme: null, nav: null, promo: null, pageData: null };
  }

  var hostname = window.location.hostname;
  var cacheKey = 'mast_storefront_' + hostname;

  // Check cache
  try {
    var raw = localStorage.getItem(cacheKey);
    if (raw) {
      var cached = JSON.parse(raw);
      if (Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
      }
      localStorage.removeItem(cacheKey);
    }
  } catch (e) { /* ignore */ }

  var baseUrl = TENANT_FIREBASE_CONFIG.databaseURL + '/' + TENANT_ID + '/public/';

  function safeFetch(url) {
    return fetch(url)
      .then(function(resp) { return resp.ok ? resp.json() : null; })
      .catch(function() { return null; });
  }

  // Core config fetches — always needed
  var fetches = [
    safeFetch(baseUrl + 'config/theme.json'),
    safeFetch(baseUrl + 'config/nav.json'),
    safeFetch(baseUrl + 'config/promoBanner.json'),
    safeFetch(baseUrl + 'config/brand/logo.json')
  ];

  // Page-specific data prefetch
  var path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  var pageDataKey = null;
  if (path === '/' || path === '/index') {
    fetches.push(safeFetch(baseUrl + 'gallery.json'));
    pageDataKey = 'gallery';
  } else if (path === '/shop' || path.endsWith('/shop')) {
    fetches.push(Promise.all([
      safeFetch(baseUrl + 'products.json'),
      safeFetch(baseUrl + 'config/categories.json')
    ]).then(function(r) { return { products: r[0], categories: r[1] }; }));
    pageDataKey = 'shop';
  } else if (path === '/about' || path.endsWith('/about')) {
    fetches.push(safeFetch(baseUrl + 'config/about.json'));
    pageDataKey = 'about';
  } else if (path === '/schedule' || path.endsWith('/schedule')) {
    fetches.push(safeFetch(baseUrl + 'events.json'));
    pageDataKey = 'schedule';
  }

  return Promise.all(fetches).then(function(results) {
    var brandLogo = results[3];
    var data = {
      theme: results[0],
      nav: results[1],
      promo: results[2],
      brandLogo: brandLogo || null,
      pageData: pageDataKey ? { type: pageDataKey, data: results[4] } : null
    };

    // Cache the result
    try {
      localStorage.setItem(cacheKey, JSON.stringify({
        timestamp: Date.now(),
        data: data
      }));
    } catch (e) { /* localStorage full — non-fatal */ }

    return data;
  });
}).catch(function() {
  // Tenant resolution failed — return empty data so downstream doesn't hang
  return { theme: null, nav: null, promo: null, pageData: null };
});
