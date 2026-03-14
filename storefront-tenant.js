/**
 * Storefront Tenant Resolution + Firebase Config
 *
 * Resolves the current tenant from the domain. All storefront files
 * include this script before other JS to make TENANT_ID and
 * TENANT_FIREBASE_CONFIG available.
 *
 * Cloud Functions receive tenantId via data.tenantId (onCall) or
 * X-Tenant-ID header (onRequest). Without it they fall back to
 * DEFAULT_TENANT.
 *
 * DEPLOY: Each tenant repo has its own copy of this file with the
 * correct domain→tenantId mapping and Firebase config. Update both
 * when cloning for a new tenant.
 */
var TENANT_ID = (function() {
  // 1. URL param override (local dev only): ?tenant=other_tenant
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    var p = new URLSearchParams(window.location.search).get('tenant');
    if (p) return p;
  }

  // 2. Domain → tenant mapping
  //    DEPLOY: Update this map for each tenant deployment.
  var map = {
    'shirglassworks.com':                'shirglassworks',
    'www.shirglassworks.com':            'shirglassworks',
    'shir-glassworks.web.app':           'shirglassworks',
    'stewartdavidp-ship-it.github.io':   'shirglassworks',
    'localhost':                         'shirglassworks'  // local dev
  };

  return map[window.location.hostname] || 'unknown';
})();

/**
 * DEPLOY: Update these values for each tenant's Firebase project.
 */
var TENANT_FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDZevV_F87F1AKGqUPKuNIrHMybOc61D7s',
  authDomain: 'shir-glassworks.firebaseapp.com',
  databaseURL: 'https://shir-glassworks-default-rtdb.firebaseio.com',
  projectId: 'shir-glassworks',
  storageBucket: 'shir-glassworks.firebasestorage.app',
  cloudFunctionsBase: 'https://us-central1-shir-glassworks.cloudfunctions.net'
};

/**
 * DEPLOY: Update brand strings for each tenant.
 * JS files reference these instead of hardcoding the brand name.
 * HTML files use <!-- TENANT: brand --> markers for clone-time sed replacement.
 */
var TENANT_BRAND = {
  name: 'Shir Glassworks',
  tagline: 'Handmade Glass Art',
  location: 'Western Massachusetts',
  instagram: 'https://www.instagram.com/shirglassworks/',
  etsy: 'https://www.etsy.com/shop/ShirGlassworks',
  domain: 'shirglassworks.com'
};
