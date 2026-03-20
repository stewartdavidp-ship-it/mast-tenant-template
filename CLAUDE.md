# CLAUDE.md — Mast Tenant Template

## Claude Code Bootstrap

**Before making any changes, do the following:**

1. **Read ARCHITECTURE.md** in this repo — it documents the Mast three-app architecture, deployment procedures, data model, and key patterns. Do NOT assume hosting strategy, deploy process, or auth flow.
2. **Read memory files** — Check `~/.claude/projects/-Users-davidstewart-Downloads/memory/MEMORY.md` for cross-project context, active jobs, and deployment procedures.
3. **Deploy via `mast_hosting`** — Tenants deploy via the Mast MCP tool, NOT Firebase CLI. Standard command: `mast_hosting(action: "deploy", tenantId: "{tenantId}")`. If MCP tools aren't in your tool list, use the HTTP fallback documented in memory.
4. **After context compaction** — Re-read this bootstrap section, ARCHITECTURE.md, and memory files. Never improvise from summary alone.

## What This Repo Is

This is the **Mast Tenant Template** (formerly "Tenant 0" / shirglassworks). It is the master development repo from which all Mast tenant sites are deployed. It is NOT a production tenant — it is the source code that `mast_hosting` deploys to every tenant's Firebase Hosting site.

Features: public storefront (shop, commissions, blog), admin app (Studio Companion PWA — camera-first POS, production management, inventory, QR scanning, Market tools). Firebase RTDB + Storage + Cloud Functions. Firebase Hosting (deployed via `mast_hosting` MCP tool).

## How Tenants Work

- Each tenant gets their own Firebase Hosting site (e.g., `mast-shirglassworks.web.app`, `mast-meadowpottery.web.app`)
- `mast_hosting deploy` downloads this repo's tarball from GitHub and uploads it to the tenant's site
- `storefront-tenant.js` resolves the tenant dynamically from the hostname via platform RTDB (`tenantsByDomain` → `publicConfig`)
- `tenant-brand.js` injects brand-specific content (name, tagline, colors, contact info) into DOM elements via `data-tenant` attributes
- The admin app reads `TENANT_FIREBASE_CONFIG` (set by `storefront-tenant.js`) and `TENANT_CONFIG` (from platform registry) — no hardcoded tenant references
- All tenant data lives under `{tenantId}/` paths in RTDB. `MastDB` enforces this prefix.

## RULEs — Do not violate these.

- No unbounded Firebase listeners. All reads must use limitToLast(N) or .once('value'). Prevents billing spikes.
- No hardcoded tenant IDs, Firebase configs, or domain names in the template code. Everything resolves dynamically from `storefront-tenant.js` and `tenant-brand.js`.
- Admin writes go to `{tenantId}/public/` paths (directly public). Firebase rules enforce admin-only writes (auth.uid check) and anonymous read access for public pages.
- generate_claude_md runs on job creation only when stale. Chat must call generate_claude_md(action="get") to check staleness before creating a draft job.
- After every major build job, Claude Code must create a follow-on Security Posture Review maintenance job.
- UI Design System — all views must conform to documented standards. Dark mode compliance required.
- docs/workflows.md is owned by Claude Code. Claude Chat must not push updates directly.
- Provisioning review required. Any change that adds new Firebase paths, Cloud Function calls, CSP domains, API integrations, or tenant config must be reviewed against the 13-step provisioning pipeline in `mast-architecture/functions/platform-functions.js` (`runProvisioningPipeline`) and the MCP `createTenant` flow in `mast-mcp-server/src/tools/mast-tenants.ts`. Both deploy paths (Stripe-triggered and MCP manual) must produce identical results.

## CONSTRAINTs — External realities. Work within these.

- Firebase Hosting — deployed via `mast_hosting` MCP tool. No GitHub Pages.
- Firebase Realtime Database is the persistence layer. All tenant data under `{tenantId}/` paths.
- Platform registry lives in `mast-platform-prod` RTDB under `mast-platform/`.
- Cloud Functions deployed on `mast-platform-prod`. Tenant-specific secrets in GCP Secret Manager with `{secretPrefix}_` prefix.
- RBAC is role-level only — no row-level or attribute-level data filtering.
- This repo is the single source of truth for all tenant UI code. Tenant-specific behavior comes from data (Firebase config, brand config, feature flags), not code branches.

## Technical Notes

- Admin app: core shell at `app/index.html` (~17.8K lines) + 13 lazy-loaded modules in `app/modules/` (~18.1K lines combined). See ARCHITECTURE.md for module list and loading pattern.
- Admin app uses React 18 via CDN (no JSX — `React.createElement` / htm tagged templates), Tailwind CSS via CDN, Firebase compat SDK
- Modules are IIFEs that register via `MastAdmin.registerModule()`. CSS stays in core. Globals accessed directly from `window`.
- Public storefront pages use vanilla JS, IIFE pattern, Firebase compat SDK
- Events pages (`events/`, `vendor/`, `show/`) have JS extracted to separate `.js` files — HTML is a thin shell
- `storefront-tenant.js` must be loaded before all other JS on every page
- `tenant-brand.js` applies brand customization after tenant resolution
- `MastDB` is the data access layer — all Firebase reads/writes go through it
- Deploy all tenants at once: `mast_hosting(action: "deploy_all")` — deploys sequentially to all active tenants
- Follow existing code patterns for new features: function components, hooks for state, consistent with current UI styling (dark mode, existing color palette)
