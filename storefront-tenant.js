/**
 * Storefront Tenant Resolution + Firebase Config
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
 *
 * Downstream pages should await window.TENANT_READY before using
 * TENANT_ID, TENANT_FIREBASE_CONFIG, or TENANT_BRAND.
 */

var TENANT_ID = null;
var TENANT_FIREBASE_CONFIG = null;
var TENANT_BRAND = null;

var PLATFORM_RTDB_BASE = 'https://mast-platform-prod-default-rtdb.firebaseio.com/mast-platform';
var CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
      // For local dev, use hardcoded Shir config as fallback
      TENANT_ID = override;
      TENANT_FIREBASE_CONFIG = {
        apiKey: '',
        authDomain: '',
        databaseURL: 'https://shir-glassworks-default-rtdb.firebaseio.com',
        projectId: 'shir-glassworks',
        storageBucket: 'shir-glassworks.appspot.com',
        cloudFunctionsBase: 'https://us-central1-shir-glassworks.cloudfunctions.net'
      };
      TENANT_BRAND = { name: 'Dev Tenant', tagline: '', domain: 'localhost' };
      resolve({ tenantId: override, source: 'url-override' });
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

  // Fetch from platform RTDB
  var escapedHost = escapeHostname(hostname);
  var domainUrl = PLATFORM_RTDB_BASE + '/tenantsByDomain/' + escapedHost + '.json';

  fetch(domainUrl)
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
    })
    .then(function(result) {
      setCachedTenant(hostname, result);
      setGlobals(result.tenantId, result.publicConfig);
      resolve({ tenantId: result.tenantId, source: 'network' });
    })
    .catch(function(err) {
      console.error('[storefront-tenant] Resolution failed:', err.message);
      showError();
      reject(err);
    });
});
