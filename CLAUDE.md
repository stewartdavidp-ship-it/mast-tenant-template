# CLAUDE.md — Mast Tenant Template

## Claude Code Bootstrap

**Before making any changes, do the following:**

1. **Read ARCHITECTURE.md** in this repo — it documents the Mast three-app architecture, deployment procedures, data model, and key patterns. Do NOT assume hosting strategy, deploy process, or auth flow.
2. **Read memory files** — Check `~/.claude/projects/-Users-davidstewart-Downloads/memory/MEMORY.md` for cross-project context, active jobs, and deployment procedures.
3. **If touching admin UI, load the Admin Design System.** Read `/Users/davidstewart/Developer/mast-architecture/docs/admin-design-system.md` and load the `mast-ux-style-guide` skill first, then relevant sub-skills (`mast-ux-tokens`, `mast-ux-screen-types`, `mast-ux-interaction`, `mast-ux-widgets`, `mast-ux-navigation-toasts`, `mast-ux-accessibility`). Customer and product detail screens are the reference implementations of Paradigm A. Do NOT copy patterns from non-retrofitted modules.
4. **Deploy via `mast-deploy storefront` (canonical) or `mast_hosting` MCP tool (underlying mechanism).** A deploy uploads code to a Firebase Hosting site. The Cloudflare worker (`runmast-tenant-proxy`) decides whether any given tenant hostname reads from that site — based on the `podRouting` KV entry for the hostname (or the fallback `mast-tenant-shared.web.app`). **Deploying alone does not switch what a tenant serves; you also need the right KV entry.** Job 2b Stage 3b added a pod-aware wrapper:
   - **Canonical path:** `npx mast-deploy storefront --pod=<id> [--tenant=<id>]` — pod-aware (target project resolved from `pods/<id>.yaml`), R17-audited (`deploy_events` row per tenant + summary), and dry-run capable (`--dry-run` writes a T2 audit row without invoking the MCP tool). The wrapper delegates to `mast_hosting deploy` per tenant — `mast_hosting` remains the single source of truth for deploy mechanics (skip-list, sequential ordering, pre-paint config writes — see `feedback_platform_hosting_deploy_all.md`).
   - **Pod-shared path:** `npx mast-deploy storefront-shared --pod=<id>` — should target the per-pod shared site (`mast-tenant-shared` or `mast-tenant-shared-<pod>`), which is what most tenants serve from via the KV fallback or explicit KV entry. ⚠️ Currently silently no-ops (see sibling fix-task); until fixed, deploy with `mast_hosting(action: "deploy", tenantId: "shared")` directly.
   - **Direct MCP path (still supported):** `mast_hosting(action: "deploy", tenantId: "{tenantId}")` — `tenantId: "shared"` lands on the shared site; a specific tenantId lands on that tenant's legacy per-tenant site (only meaningful if KV routes them there). Use when you need fine-grained control or are mid-incident. If MCP tools aren't in your tool list, use the HTTP fallback documented in memory.
   - **`declared-state.schema.yaml`** at the repo root declares the system-tenant skip-list and the build-version contract. Reconciler (Job 2b Stage 1) reads this file to surface drift.

   **How to test your changes on a tenant:**
   1. Deploy to the shared site (or per-pod shared site if working on a non-default pod): `mast_hosting(action: "deploy", tenantId: "shared")` (or `npx mast-deploy storefront-shared --pod=<id>` once fixed).
   2. Hard refresh `<tenant>.runmast.com` (cache-bust: ⌘⇧R, or append `?v=<timestamp>`). The worker will proxy to the shared origin and serve the new code.
   3. **If the KV entry for that tenant points to a per-tenant site** (legacy/pinned), the shared deploy will not show up — you must also deploy to that tenant's specific site with `mast_hosting(action: "deploy", tenantId: "<tenantId>")`, or update the KV entry to fall back to shared. Check the KV in the Cloudflare dashboard (KV namespace `podRouting`) when in doubt.
5. **Module cache-bust auto-bump (one-time setup per clone).** The admin app lazy-loads `app/modules/*.js` with a `?v=<MAST_MODULES_V>` query suffix (declared in `app/index.html`). Browsers cache by URL — if the suffix doesn't change, customers with the admin tab already open will keep serving stale JS even after a no-cache-headered redeploy (see [feedback_mast_cache_bust_process_gap.md](~/.claude/projects/-Users-davidstewart-Downloads/memory/feedback_mast_cache_bust_process_gap.md)). To prevent this, install the version-controlled pre-commit hook once per clone:

   ```bash
   ./scripts/install-hooks.sh
   ```

   This wires `core.hooksPath` to `.githooks/`. From then on, any commit that touches `app/index.html` or `app/modules/*.js` auto-bumps `MAST_MODULES_V` to `YYYYMMDD-<short-sha>` and re-stages the file. If you ever need to bump manually (e.g. CI deploy from a non-hooked env), run `./scripts/bump-modules-version.sh` directly — it's idempotent.

6. **After context compaction** — Re-read this bootstrap section, ARCHITECTURE.md, and memory files. Never improvise from summary alone.

## What This Repo Is

This is the **Mast Tenant Template** (formerly "Tenant 0" / shirglassworks). It is the master development repo for all Mast tenant sites. It is NOT a production tenant — it is the source code that `mast_hosting` deploys to Firebase Hosting sites that a Cloudflare worker then routes tenant traffic to.

Features: public storefront (shop, commissions, blog), admin app (Studio Companion PWA — camera-first POS, production management, inventory, QR scanning, Market tools). Firebase Firestore + Storage + Cloud Functions. Firebase Hosting origins, fronted by Cloudflare worker `runmast-tenant-proxy`.

## How Tenants Work (current serving + deploy model — verified 2026-05-22)

**Serving path (request flow):**

1. **DNS:** `*.runmast.com` delegates to Cloudflare nameservers. All hostnames hit the Cloudflare worker `runmast-tenant-proxy` (source at `/Users/davidstewart/Downloads/runmast-tenant-proxy/worker.js`).
2. **Worker routing:**
   - Apex `runmast.com` → proxied to `mast-platform-prod.web.app` (marketing site).
   - All other hostnames → KV lookup in namespace `podRouting` (CF KV id `254fd9d0ee8142328dfb72b15d51d5f5`) keyed by hostname. The value is JSON `{ podId, originHost }` — the worker proxies the request to `originHost` (a Firebase Hosting site).
   - **Fallback:** if the hostname has no KV entry, the worker proxies to `mast-tenant-shared.web.app` (the default pod-shared site).
3. **Origin:** Firebase Hosting serves this repo's code. `storefront-tenant.js` resolves the tenant ID from the incoming hostname via the platform Firestore registry (`tenantsByDomain` → `publicConfig`).
4. **Tenant data:** `tenant-brand.js` injects brand content via `data-tenant` attributes. Admin reads `TENANT_FIREBASE_CONFIG` + `TENANT_CONFIG`. All tenant data lives under `tenants/{tenantId}/` in Firestore — `MastDB` enforces tenant scope.

**Site model:**

- **Per-pod shared site** (e.g. `mast-tenant-shared.web.app`, `mast-tenant-shared-<pod>.web.app`) — the primary origin for almost every tenant. One deploy serves many tenants. This is what the KV fallback and most KV entries point to.
- **Per-tenant sites** (e.g. `mast-shirglassworks.web.app`) — legacy / rollback-only. Still deployable for tenants that need a pinned version or a hot-patch, but the default tenant is served from the shared site.

**KV `podRouting` is the authoritative serving map.** A Firebase deploy lands code on a hosting site, but the worker decides whether any given tenant hostname actually reads from that site. Updating `podRouting` is a separate flow from `mast_hosting deploy` (currently a Cloud Function reconciler — undocumented; see sibling task tracking).

**Deploying admin changes per pod (gotcha — verified 2026-05-24):** `mast-tenant-shared.web.app` is the *default-pod* shared site. East-pod tenants (e.g. `e2estarter-ny-005`) route via `podRouting` KV to `mast-tenant-shared-east-1.web.app` (a separate Firebase Hosting site under `mast-platform-prod-us-east-1`). A deploy to the default shared site is a no-op for non-default-pod tenants. To deploy admin to a specific tenant:

1. Resolve the pod: `mast_platform_tenant_search` for the tenantId, read `pod` (or check `platform_tenantsByDomain/{hostname}.podId`).
2. Deploy to that pod's shared site:
   - default pod → `mast-tenant-shared.web.app`
   - `prod-us-east-1` → `mast-tenant-shared-east-1.web.app`
   - `prod-us-west-1` → `mast-tenant-shared-west-1.web.app` (confirmed 2026-05-24 via mast_hosting deploy)
3. Verify via `curl -sI https://<tenant>.runmast.com/app/ | grep last-modified` (or fetch any sentinel file) before declaring the deploy live.

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
- Admin UI font-sizes MUST use the 7-step rem scale: `0.72`, `0.78`, `0.85`, `0.9`, `1.0`, `1.15`, `1.6`. No off-scale values (no `0.875`, `0.95`, `1.4`, etc.) — snap to the nearest step. Enforced two ways: (1) `scripts/lint-design-tokens.js` exits non-zero on font-size violations and is wired as a PostToolUse hook on Edit/Write in `.claude/settings.json`, so the lint runs after every file modification in this repo and blocks Claude until violations are fixed; (2) GitHub Actions `CI lint` workflow runs the same script on every push to `main` and PRs. If the hook reports a violation, fix it before continuing — do not push violations and rely on CI to catch them.
- Filter UI: **pills are the standard** for primary list filters. Use `<div class="order-filter-pills" data-filter-for="<selectId>"></div>` with a hidden `<select id="<selectId>" style="display:none">…</select>` for state. The `mastFilterPills` helper in `app/index.html` (auto-init on DOMContentLoaded; call `mastInitFilterPills(container)` after dynamic `innerHTML` writes) renders the pills, syncs `select.value`, and dispatches the change event so existing handlers keep working. **Use dropdowns instead when:** (a) the view has 3+ stacked filter dimensions (e.g. CS survey responses, finance expenses, production jobs, audit log) — pills would wrap into multiple rows; (b) the option set is unbounded (one option per row of dynamic data — e.g. enrollment class list, email types, employees, contact categories); (c) the filter exceeds ~8 bounded options, especially if a sibling filter shares the row (e.g. Shows status has 10 options — both shows status + type stay as dropdowns for row symmetry); (d) the select is a page-size selector or lives inside a tight form/modal (e.g. promotions product picker). When in doubt, count options + count sibling filters in the row.
- List tables: **columns must be sortable** unless the view explicitly is not a list (e.g. single-form Day Close). Use `window.mastSortableTh(label, key, currentKey, currentDir, 'window._<view>Sort')` for each clickable `<th>`, keep per-view `<view>SortKey` + `<view>SortDir` state (default `'createdAt' / 'desc'` for time-based lists), and sort filtered rows with `window.mastSortRows(rows, key, dir, optionalGetter)` before render. Clicking the same key toggles direction; clicking a new key uses asc by default (desc for date fields). When a column needs a non-trivial sort value (e.g. a label lookup), pass a `getter(row, key)` to `mastSortRows`. Sortable headers are the **default expectation** — when adding a new list view, wire it up at first build, not as a retrofit.
- List-detail surfaces: **use the `mastSlideOut` right-side panel** (~560px) for row details, NOT inline row-expansion. Call `window.mastSlideOut.open({ title, subtitle, bodyHtml, footerHtml, onClose })` from the row click handler. The slide-out handles scrim + Esc + scroll-lock + focus restoration. Inline expansion mixes detail and list scan modes and is being phased out across the admin; email-log was the first conversion (see commit history). Reuse this helper for new detail surfaces instead of cooking a one-off drawer.
- Process-step surfaces (gated workflows): **use the MastFlow engine** at `app/modules/workflows/workflow-engine.js`, NOT ad-hoc steppers + status dropdowns. New process-step surfaces (RMA, fulfillment, returns, enrollments, etc.) must ship a spec file at `app/modules/workflows/<key>.workflow.js` that calls `MastFlow.define(<key>, { phases, branches, derivePhaseFromLegacy, canForce, recordPath })` and a detail-view init that calls `MastFlow.renderHeader(<key>, record, { onAdvance, onBack, onBranch, onForce })` + `MastFlow.transition(<key>, record, targetPhase, { recordId, expectedFromPhase })`. The skeleton at `app/modules/workflows/workflow-template.workflow.js` is the canonical starting point — copy it, don't copy from `commissions.workflow.js` or `pickship.workflow.js` (each has surface-specific quirks). Branches must declare per-choice `phases: [...]` arrays explicitly — never rely on `phases[]` declaration order. Always pass `expectedFromPhase` on transition for optimistic-lock concurrency; detail views must subscribe to their record (via `MastDB.subscribe`) and unsubscribe on close. Design doc: `docs/workflow-engine-design.md`. Reference implementations: `commissions.workflow.js` (linear, 7 phases) and `pickship.workflow.js` (branching with re-converge, 3-way branch at the `picked` phase).

## CONSTRAINTs — External realities. Work within these.

- Firebase Hosting is the origin layer (deployed via `mast_hosting` MCP tool). Cloudflare worker `runmast-tenant-proxy` is the edge/routing layer — tenant hostnames are mapped to origin hosting sites via the `podRouting` KV namespace. No GitHub Pages.
- Firebase Firestore is the persistence layer. All tenant data under `tenants/{tenantId}/...` (DataStore translates legacy `{tenantId}/...` path strings).
- Platform registry lives in `mast-platform-prod` Firestore (collections prefixed `platform_*`, e.g. `platform_tenants`, `platform_userTenantMap`).
- Cloud Functions deployed on `mast-platform-prod`. Tenant-specific secrets in GCP Secret Manager with `{secretPrefix}_` prefix.
- RBAC is role-level only — no row-level or attribute-level data filtering.
- This repo is the single source of truth for all tenant UI code. Tenant-specific behavior comes from data (Firebase config, brand config, feature flags), not code branches.
- **Mast may run as a secondary surface to an external primary site** (Shopify, Squarespace, Wix, Weebly, Etsy, etc.). Setup wizard captures this as `engagement.mode`: `storefront` (Mast primary) | `sync-channels` (external primary, Mast back-office) | `back-office` (no online storefront). UI and IA decisions that touch primary-site editing or checkout-coupled features MUST check the engagement mode and adapt — the secondary mode is a first-class supported configuration, not a degraded one. Features split into three layers by checkout coupling:
  - **Layer 1 — Standalone:** works in any mode without touching primary checkout. Blog, Newsletter, Surveys, Stories, Brand, Images, Classes, Enrollments, Passes, Customer DB, Contacts, Team, Finance reporting, Tax.
  - **Layer 2 — Read-from-primary:** aggregates webhook/import data from the primary site. Orders, Inventory sync, Customer-portfolio.
  - **Layer 3 — Write-back-to-primary:** must inject into primary checkout (codes, balances, member pricing). Coupons, Loyalty redemption, Gift Cards, Membership pricing, Wallet credit, Promotions, Cart-abandonment recovery. **Each Layer-3 route MUST declare `secondaryViability` in [mode-module-info.js](app/data/mode-module-info.js)** (per-platform: `full` | `partial` | `blocked` | `tbd`). Until the Secondary-Mode Viability Matrix lands per-platform adapters, Layer-3 routes are hidden in `sync-channels`/`back-office` via `MODE_ROUTE_VISIBILITY[route].engagementHidden` in [business-entity-constants.js](shared/business-entity-constants.js).
  - **Public-side gating:** when `engagement.mode === 'sync-channels' || 'back-office'`, the Mast subdomain MUST NOT serve a public `/shop` / `/product/*` surface (the primary site owns commerce). The `/cart` surface remains active only for Layer-1 line items (class enrollments, pass purchases). New public surfaces that touch a checkout must check the mode and route to the primary site for product-shopping use.

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

## Customer Success Module — Known Gaps

The `cs-*` routes (Inbox, Tickets, Surveys, Reviews, FAQs, Members) are implemented in `app/modules/customer-service.js`. Persona-testing on 2026-05-21 surfaced multiple latent gaps. Do not treat these as bugs to fix in passing — they're scoped work tracked in `~/Downloads/sessions/cs-persona-testing-2026-05-21/`. But knowing they exist will save you from re-discovering them.

**Data-layer gaps (real, need build work):**
- **Tickets** (`cs_tickets/{ticketId}`) carry `contactEmail` + `contactName` only. **No `customerId`, no `productId`.** A ticket about a glass pumpkin has zero product attribution and is not linked back to the matching customer record.
- **Survey responses** are written to `cs_survey_responses/{responseId}` by Cloud Functions (`generateSurveyLink`, `_fireSingleSurveyTrigger`). They include `contactId`, `contactEmail`, `answers[]`, `wantsFollowup`, `followupTicketId`, `status`. **The admin UI never reads this path.** No response viewer surface exists in `customer-service.js`.
- **Surveys can only be sent to one recipient at a time.** "Send Survey" modal collects `Contact Email` + `Contact Name`. Triggers fire on events (`order_placed`, `cart_abandoned`, `class_attended`). There is no segment-targeted bulk send.
- **`recomputeCustomerStats` does not compute `medianIntervalDays` or `expectedNextOrderBy`.** Per-customer cadence — required for product-sales "lapsed-buyer" detection — is not yet a denormalized field.
- **Order line items do not snapshot `cogsCents`.** Per-customer gross margin and per-SKU repurchase analytics cannot be computed without this.
- **No `customer-service` skill in tenant-MCP** — `cs_*` writes bypass MCP entirely (direct `MastDB.set` from the admin module), violating the `mast-mcp-coverage` rule. Coverage closure requires a new skill module on the MCP server. See `mast-tenant-mcp-server/CLAUDE.md` → "Known coverage gaps".

**UI-layer gaps (data exists, surface missing):**
- **Reviews list shows raw Firebase product IDs.** The data already carries `productName` (snapshot at write time by the `submitReview` CF) — the admin reviews list at `customer-service.js → renderReviews()` just doesn't read it. ~30-min fix.
- **Customer detail has 6 tabs** (Overview / Orders / Contacts / Classes / Interactions / Wallet) — design system caps detail-complex at 5. Consolidation needed before adding Tickets/Surveys/Reviews tabs. Suggested target: collapse Contacts + Interactions + future CS surfaces into a unified `Activity` timeline tab (5 total: Overview / Orders / Activity / Classes / Wallet).
- **No "lapsed" or "at-risk" segment** in the customer segment picker. `listLapsedCustomers` exists in MCP with a flat days-cutoff; UI does not expose it and the cutoff isn't per-customer-cadence aware yet.
- ~~No Frequency column on the customer list.~~ Shipped — `Frequency` column + `Orders (most → least)` sort option were added 2026-05-21.
- **`Interactions` button collides with a global `Interactions` view of the same name.** Clicking the customer-detail tab can navigate away to a sibling surface. Rename one before the consolidation refactor.

**Wholesale-specific:**
- `getWholesaleActivity` (in `wholesale` MCP skill) already computes per-account `daysSinceLastOrder` and an overdue list, but with a hardcoded 42-day threshold and indexed by email — no learned per-account reorder cadence, no UI surface in the admin app.

## Customer record schema (canonical)

`{tenantId}/admin/customers/{customerId}` — see `mast-tenant-mcp-server/src/shared/tools/customers.ts` for the authoritative shape:

```
{ id, displayName, primaryEmail, emails[], phones[], source, status,
  tags[],                                              ← first-class
  linkedIds: {uids[], contactIds[], studentIds[], squareCustomerId},
  marketing: {newsletterOptIn, smsOptIn},
  notes, createdAt, updatedAt,
  stats: { lifetimeSpendCents, orderCount,             ← persisted
           firstOrderAt, lastOrderAt,
           enrollmentCount, lastEnrollmentAt, statsUpdatedAt } }
```

Email→id lookup: `{tenantId}/admin/customerIndexes/byEmail/{key}` (where `{key}` is the email with `.` replaced by `,`).
