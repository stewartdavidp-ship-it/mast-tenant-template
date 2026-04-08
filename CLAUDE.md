# CLAUDE.md — Mast Tenant Template

## Claude Code Bootstrap

**Before making any changes, do the following:**

1. **Read ARCHITECTURE.md** in this repo — it documents the Mast three-app architecture, deployment procedures, data model, and key patterns. Do NOT assume hosting strategy, deploy process, or auth flow.
2. **Read memory files** — Check `~/.claude/projects/-Users-davidstewart-Downloads/memory/MEMORY.md` for cross-project context, active jobs, and deployment procedures.
3. **If touching admin UI, load the Admin Design System.** Read `/Users/davidstewart/Developer/mast-architecture/docs/admin-design-system.md` and load the `mast-ux-style-guide` skill first, then relevant sub-skills (`mast-ux-tokens`, `mast-ux-screen-types`, `mast-ux-interaction`, `mast-ux-widgets`, `mast-ux-navigation-toasts`, `mast-ux-accessibility`). Customer and product detail screens are the reference implementations of Paradigm A. Do NOT copy patterns from non-retrofitted modules.
4. **Deploy via `mast_hosting`** — Tenants deploy via the Mast MCP tool, NOT Firebase CLI. Standard command: `mast_hosting(action: "deploy", tenantId: "{tenantId}")`. If MCP tools aren't in your tool list, use the HTTP fallback documented in memory.
5. **After context compaction** — Re-read this bootstrap section, ARCHITECTURE.md, and memory files. Never improvise from summary alone.

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
- AI discoverability required. When adding or redesigning a public page that displays tenant data, you must: (1) add Schema.org JSON-LD using the `MastSchema` utility in `schema-org.js`, and (2) update the `serveLlmsTxt` Cloud Function in `mast-architecture/functions/tenant-functions.js` if a new data type is surfaced. See the AI Interface section in Technical Notes for details.

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
- **Script loading order:** `storefront-tenant.js` → `storefront-theme.js` → `storefront-nav.js` → `tenant-brand.js` → `cart.js`
- `storefront.css` provides all shared CSS (`:root` vars + semantic surface tokens, nav, footer, buttons, etc.) — page-specific styles remain inline
- **CSS token architecture:** Theme tokens (`--primary`, `--bg`, `--text`) invert in dark mode. Surface tokens (`--surface-dark`, `--surface-card`, `--on-dark`) do NOT invert. Use surface tokens for elements that should stay dark/light regardless of mode.
- `storefront-theme.js` reads `public/config/theme`, loads template manifests, applies color schemes, runs homepage flow engine. Supports `?preview_template=` for live preview
- `storefront-nav.js` reads `public/config/nav` + `promoBanner` and builds nav/mobile menu dynamically
- `tenant-brand.js` applies brand customization via `data-tenant` attributes after tenant resolution
- All public pages are fully generic — no tenant-specific hardcodes. Content comes from Firebase config or shows appropriate placeholders
- `MastDB` is the data access layer — all Firebase reads/writes go through it
- Deploy all tenants at once: `mast_hosting(action: "deploy_all")` — deploys sequentially to all active tenants
- Follow existing code patterns for new features: function components, hooks for state, consistent with current UI styling (dark mode, existing color palette)

### AI Interface (Schema.org + llms.txt)

All public pages that display tenant data must include structured data for AI and search engine discoverability.

**Schema.org JSON-LD** — `schema-org.js` is a shared utility loaded on public pages via `<script src="schema-org.js"></script>` (before `cart.js`). After page data loads from Firebase, call the appropriate generator and inject:
```
if (window.MastSchema) MastSchema.inject(MastSchema.organization());
```

Available generators: `organization()`, `product(p, saleInfo)`, `productList(products, pageName)`, `event(e)`, `eventList(events)`, `course(cls)`, `courseWithSessions(cls, sessions)`, `courseList(classes)`, `breadcrumbList(items)`, `blogPosting(post)`, `blogList(posts)`, `giftCardList(config)`, `membership(config)`, `service(name, desc)`.

The `blogPosting()` generator expects these fields on the post object: `_id` (or `id`), `title`, `publishedAt`, `updatedAt`, `author`, `bodyHtml`, `excerpt`, `image`/`coverImage`, `tags` (array). If post field names change during a redesign, update the generator to match.

**llms.txt** — Served by the `serveLlmsTxt` Cloud Function in `mast-architecture/functions/tenant-functions.js`. Reads products, events, classes, blog posts (`{tenantId}/blog/published`), wallet config, and membership config in parallel, then generates a plain-text summary per the llmstxt.org spec. If the Firebase path for published data changes, update the function to match.

**Pages currently covered (13):** index, about, shop, product, schedule, classes, class-detail, blog/index, blog/post, gift-cards, membership, show/index, commission.
**Pages correctly excluded (auth-gated/transactional):** my-classes, my-passes, my-wallet, cancel-booking, manage-seats, waiver, return-shipped, orders, redeem-gift-card, claim-coupon, wholesale.
