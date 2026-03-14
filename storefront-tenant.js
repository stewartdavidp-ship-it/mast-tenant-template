/**
 * Storefront Tenant Resolution
 *
 * Resolves the current tenant from the domain. All storefront files
 * include this script before other JS to make TENANT_ID available.
 *
 * Cloud Functions receive tenantId via data.tenantId (onCall) or
 * X-Tenant-ID header (onRequest). Without it they fall back to
 * DEFAULT_TENANT.
 *
 * DEPLOY: Each tenant repo has its own copy of this file with the
 * correct domain→tenantId mapping. Update the map when cloning for
 * a new tenant.
 */
var TENANT_ID = (function() {
  // 1. URL param override (for testing): ?tenant=other_tenant
  var p = new URLSearchParams(window.location.search).get('tenant');
  if (p) return p;

  // 2. Domain → tenant mapping
  //    DEPLOY: Update this map for each tenant deployment.
  var map = {
    'shirglassworks.com':                'shirglassworks',
    'www.shirglassworks.com':            'shirglassworks',
    'shir-glassworks.web.app':           'shirglassworks',
    'stewartdavidp-ship-it.github.io':   'shirglassworks'
  };

  return map[window.location.hostname] || 'unknown';
})();
