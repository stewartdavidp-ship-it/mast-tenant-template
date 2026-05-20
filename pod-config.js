/**
 * Pod-specific runtime config — substituted per pod at deploy time.
 *
 * Sets window.MAST_POD_PLATFORM_PROJECT so storefront-tenant.js and
 * tenant-brand.js know which GCP project's Firestore hosts the
 * platform_tenants / platform_tenantsByDomain / platform_tenantPublicConfigs
 * collections for this hosting site's tenants.
 *
 * Source default: 'mast-platform-prod' (legacy). Per-pod deploys must rewrite
 * this value via the deploy-pod.sh helper before `firebase deploy`. Without
 * the rewrite, brand-new tenants on east-1/west-1 fail to bootstrap because
 * their domain registry doc lives on the home pod, not legacy.
 *
 * Surfaced via E2E test 2026-05-19 — see CC OPEN
 * O-east1-mast-tenant-shared-platform-project-id-not-substituted.
 */
window.MAST_POD_PLATFORM_PROJECT = 'mast-platform-prod';
