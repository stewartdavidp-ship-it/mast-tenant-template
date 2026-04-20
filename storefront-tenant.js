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

var PLATFORM_FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/mast-platform-prod/databases/(default)/documents';
var CACHE_TTL_MS = 60 * 1000; // 1 minute

// Unwrap Firestore REST field value into a plain JS value.
function unwrapFirestoreValue(v) {
  if (v == null) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) return unwrapFirestoreFields(v.mapValue.fields || {});
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(unwrapFirestoreValue);
  return null;
}

function unwrapFirestoreFields(fields) {
  var out = {};
  for (var k in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, k)) {
      out[k] = unwrapFirestoreValue(fields[k]);
    }
  }
  return out;
}

// Unwrap _v container used when a scalar is stored as a Firestore doc.
function unwrapContainerDoc(data) {
  if (data && typeof data === 'object' && !Array.isArray(data) &&
      '_v' in data && Object.keys(data).length === 1) {
    return data._v;
  }
  return data;
}

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
      projectId: publicConfig.projectId || '',
      storageBucket: publicConfig.storageBucket,
      cloudFunctionsBase: publicConfig.cloudFunctionsBase
    };

    TENANT_BRAND = {
      name: publicConfig.brandName || publicConfig.name,
      tagline: publicConfig.brandTagline || '',
      domain: publicConfig.domain || '',
      description: publicConfig.brandDescription || '',
      location: publicConfig.brandLocation || '',
      contactEmail: publicConfig.contactEmail || publicConfig.ownerEmail || '',
      instagramUrl: publicConfig.instagramUrl || '',
      etsyUrl: publicConfig.etsyUrl || ''
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
      var devConfigUrl = PLATFORM_FIRESTORE_BASE + '/platform_tenants/' + override;
      fetch(devConfigUrl)
        .then(function(resp) { return resp.ok ? resp.json() : null; })
        .then(function(doc) {
          var fields = doc && doc.fields ? unwrapFirestoreFields(doc.fields) : null;
          var publicConfig = fields && fields.publicConfig ? fields.publicConfig : null;
          if (publicConfig) {
            setGlobals(override, publicConfig);
          } else {
            // Minimal fallback for truly local dev
            TENANT_FIREBASE_CONFIG = {
              apiKey: '',
              authDomain: 'mast-platform-prod.firebaseapp.com',
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
    var domainUrl = PLATFORM_FIRESTORE_BASE + '/platform_tenantsByDomain/' + escapedHost;
    tenantPromise = fetch(domainUrl)
      .then(function(resp) {
        if (!resp.ok) throw new Error('Domain lookup failed: ' + resp.status);
        return resp.json();
      })
      .then(function(doc) {
        var fields = doc && doc.fields ? unwrapFirestoreFields(doc.fields) : null;
        var tenantId = fields ? unwrapContainerDoc(fields) : null;
        if (typeof tenantId !== 'string' || !tenantId) throw new Error('No tenant found for hostname: ' + hostname);
        var configUrl = PLATFORM_FIRESTORE_BASE + '/platform_tenants/' + tenantId;
        return fetch(configUrl).then(function(resp) {
          if (!resp.ok) throw new Error('Config lookup failed: ' + resp.status);
          return resp.json();
        }).then(function(tenantDoc) {
          var tenantFields = tenantDoc && tenantDoc.fields ? unwrapFirestoreFields(tenantDoc.fields) : null;
          var publicConfig = tenantFields && tenantFields.publicConfig ? tenantFields.publicConfig : null;
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
  if (!TENANT_ID || !TENANT_FIREBASE_CONFIG || !TENANT_FIREBASE_CONFIG.projectId) {
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

  // Firestore REST base for tenant data. Tenant data lives under
  // tenants/{tenantId}/{collection}/{docId}.
  var fsBase = 'https://firestore.googleapis.com/v1/projects/' +
    TENANT_FIREBASE_CONFIG.projectId + '/databases/(default)/documents/tenants/' +
    TENANT_ID;

  // Fetch a Firestore doc and return the unwrapped fields, or null on error.
  function fetchFsDoc(subpath) {
    return fetch(fsBase + '/' + subpath)
      .then(function(resp) { return resp.ok ? resp.json() : null; })
      .then(function(doc) {
        if (!doc || !doc.fields) return null;
        var out = unwrapFirestoreFields(doc.fields);
        return unwrapContainerDoc(out);
      })
      .catch(function() { return null; });
  }

  // Fetch a Firestore collection and return an ordered array of doc data, or [] on error.
  function fetchFsCollection(subpath) {
    return fetch(fsBase + '/' + subpath + '?pageSize=300')
      .then(function(resp) { return resp.ok ? resp.json() : null; })
      .then(function(body) {
        if (!body || !body.documents) return {};
        var map = {};
        body.documents.forEach(function(doc) {
          var parts = (doc.name || '').split('/');
          var id = parts[parts.length - 1];
          map[id] = unwrapContainerDoc(unwrapFirestoreFields(doc.fields || {}));
        });
        return map;
      })
      .catch(function() { return {}; });
  }

  // Core config fetches — always needed.
  // RTDB path → Firestore translation (via MastDB tenant map):
  //   public/config/theme        → config/theme
  //   public/config/nav          → config/nav
  //   public/config/promoBanner  → config/promoBanner
  //   public/config/brand        → config/brand (logo is a field)
  //   public/config/shopDisplay  → config/shopDisplay
  var fetches = [
    fetchFsDoc('config/theme'),
    fetchFsDoc('config/nav'),
    fetchFsDoc('config/promoBanner'),
    fetchFsDoc('config/brand').then(function(brand) { return brand && brand.logo ? brand.logo : null; }),
    fetchFsDoc('config/shopDisplay')
  ];

  // Page-specific data prefetch
  var path = window.location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
  var pageDataKey = null;
  if (path === '/' || path === '/index') {
    fetches.push(fetchFsCollection('gallery'));
    pageDataKey = 'gallery';
  } else if (path === '/shop' || path.endsWith('/shop')) {
    fetches.push(Promise.all([
      fetchFsCollection('products'),
      fetchFsDoc('config/categories')
    ]).then(function(r) { return { products: r[0], categories: r[1] }; }));
    pageDataKey = 'shop';
  } else if (path === '/about' || path.endsWith('/about')) {
    fetches.push(fetchFsDoc('config/about'));
    pageDataKey = 'about';
  } else if (path === '/schedule' || path.endsWith('/schedule')) {
    // events data — RTDB path `public/events` → Firestore `events` collection
    fetches.push(fetchFsCollection('events'));
    pageDataKey = 'schedule';
  }

  return Promise.all(fetches).then(function(results) {
    var brandLogo = results[3];
    var shopDisplay = results[4];
    var pageDataResult = results[5]; // shifted by 1 due to shopDisplay insert
    var data = {
      theme: results[0],
      nav: results[1],
      promo: results[2],
      brandLogo: brandLogo || null,
      shopDisplay: shopDisplay || null,
      pageData: pageDataKey ? { type: pageDataKey, data: pageDataResult } : null
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
