# ARCHITECTURE.md — Mast Tenant Template

## Required Skills for UI Development

Before writing or modifying any UI code in this repo, load these MCP skills:

| Skill | Purpose | Load via |
|-------|---------|----------|
| `mast-ux-style-guide` | Design system, color palette, components, dark mode, typography | `skill(get, "mast-ux-style-guide")` |
| `mast-security-checklist` | XSS prevention, CSP compliance, input validation, token handling | `skill(get, "mast-security-checklist")` |

Both skills are mandatory for any session that creates or modifies HTML, JS, or CSS in the tenant template. The UX skill ensures visual consistency; the security skill prevents XSS, injection, and data exposure vulnerabilities.

---

## Mast Platform Context

This repo is the **Mast Tenant Template** — the master source code deployed to every Mast tenant's Firebase Hosting site. It exists within the **Mast three-app architecture**:

1. **Mast** (the platform) — The SaaS product customers subscribe to. When a customer subscribes, a tenant is spun up for them. Think: Shopify (the platform), not a Shopify store.
2. **Tenants** (this repo) — Each tenant is a self-contained business app (storefront, admin, POS, inventory, orders). This template code is deployed to every tenant. Tenant-specific behavior comes from data (Firebase config, brand config, feature flags), not code branches.
3. **Mast Events** — Application for show/event organizers. Integrates back to Mast tenants — a tenant can also be a vendor at a show managed by Mast Events.

**Key relationship:** Mast Events vendors ARE Mast tenants.

## Overview

The Mast Tenant Template is a multi-tenant storefront deployed to Firebase Hosting with a Firebase Firestore backend (post-B.5/B.7 cutover; legacy RTDB retained for lockdown only). The public site (product catalog, gallery, checkout) uses vanilla JS with no framework. The admin app (`/app/index.html`) is a single-file React 18 app with multi-tenant auth and RBAC.

**Repo:** `stewartdavidp-ship-it/mast-tenant-template`
**GCP project (platform):** `mast-platform-prod`
**Platform Firestore:** `mast-platform-prod` (Firestore database; legacy RTDB at `https://mast-platform-prod-default-rtdb.firebaseio.com` retained for lockdown only)
**Storage:** `gs://mast-platform-prod.firebasestorage.app` (tenant assets under `{tenantId}/`)
**Cloud Functions:** `mast-architecture/functions/` (shared platform functions)

## Environments

There are two distinct environments. Both serve the same code from this repo but point to different Firebase projects and data.

### Dev Environment — `mast-platform-prod` project (hosting site `mast-dev-env`)

- **GCP/Firebase project:** `mast-platform-prod` (same project as production — no cross-project IAM)
- **Hosting site:** `mast-dev-env` → `mast-dev-env.web.app`
- **Firestore:** `mast-platform-prod` (tenant data under `tenants/dev/...` collections)
- **Tenant ID:** `dev`
- **Purpose:** Development and testing. Contains Shir Glassworks test data (products, gallery, config) under tenant scope `tenants/dev/...` in the platform Firestore. Runs the same code and tenant resolution as production tenants.
- **Deploy:** `mast_hosting(action: "deploy", tenantId: "dev")` — same as any production tenant. No Firebase CLI required.
- **Tenant resolution:** `tenantsByDomain/mast-dev-env_web_app` → `dev` → `mast-platform/tenants/dev/publicConfig`
- **Legacy dev site:** `shir-glassworks.web.app` (`shir-glassworks` GCP project) — deprecated, kept live as backup until Shir Glassworks production cutover. Do not use for new development.

### Production Environment — `mast-platform-prod` project

- **GCP/Firebase project:** `mast-platform-prod`
- **Hosting sites:** One per tenant (e.g., `mast-shirglassworks`, `mast-meadowpottery`) → `mast-{tenantId}.web.app`
- **Firestore:** `mast-platform-prod` (tenant data under `tenants/{tenantId}/...` collections)
- **Storage:** `gs://mast-platform-prod.firebasestorage.app` (tenant assets under `{tenantId}/`)
- **Purpose:** Production tenants. Contains curated production data (subset of dev data — test data excluded).
- **Deploy:** `mast_hosting(action: "deploy", tenantId: "{tenantId}")` via MCP tool. Downloads this repo's tarball from GitHub, uploads to the tenant's Firebase Hosting site.
- **Custom domains:** Production tenants will get custom domains (e.g., `shirglassworks.com` → `mast-shirglassworks.web.app`). Managed via `mast_domains` MCP tool.

### Deploy Flow — Code Push

When code is pushed to this repo, it needs to be deployed to all environments:

- **Dev site:** `mast_hosting(action: "deploy", tenantId: "dev")`
- **Specific tenant:** `mast_hosting(action: "deploy", tenantId: "{tenantId}")`
- **All active tenants:** `mast_hosting(action: "deploy_all")` — deploys sequentially to all active tenants including dev

All deploys use the `mast_hosting` MCP tool — no Firebase CLI required.

## Deployment Details (Production)

Deployed programmatically via the `mast_hosting` MCP tool on the Mast MCP server (`mast-platform-prod` GCP project). The tool downloads this repo's tarball from GitHub, gzips files, and uploads via the Firebase Hosting REST API.

- **Deploy command:** `mast_hosting(action: "deploy", tenantId: "{tenantId}")`
- **Deploy all:** `mast_hosting(action: "deploy_all")` — deploys to all active tenants
- **Hosting config:** `platform_tenants/{tenantId}` document → `hosting` field in `mast-platform-prod` Firestore
- **Rewrite rule:** `/app/**` → `/app/index.html` (SPA routing for admin app)
- Each tenant has its own Firebase Hosting site (e.g., `mast-shirglassworks.web.app`, `mast-meadowpottery.web.app`)

## Public Site

Static HTML pages. No build system, no bundler.

| File | Purpose |
|------|---------|
| `index.html` | Homepage / landing |
| `shop.html` | Product catalog grid |
| `product.html` | Single product detail + add-to-cart |
| `about.html` | About page |
| `schedule.html` | Events / schedule |
| `commission.html` | Commission request page |
| `orders.html` | Customer order lookup |
| `wholesale.html` | Wholesale catalog (auth-gated, Google Sign-In required) |
| `checkout.html` | Multi-step checkout flow |
| `checkout.js` | Checkout logic (IIFE `MastCheckout`, ~1140 lines) |
| `checkout.css` | Checkout-specific styles |

### Shared JS Modules

| File | Purpose |
|------|---------|
| `storefront.css` | Shared CSS for all public pages. `:root` vars (generic tokens: `--primary`, `--accent`, `--bg`, etc. + semantic surface tokens: `--surface-dark`, `--surface-card`, `--on-dark`, etc.), dark mode via `@media (prefers-color-scheme: dark)` + `html.dark`, reset, nav, buttons, section labels, page header, forms, footer, newsletter bar, powered-by-mast, mobile menu, scroll animations, responsive base. Legacy aliases (`--amber: var(--primary)`, etc.) for backward compat |
| `storefront-tenant.js` | Tenant resolution from domain. Sets global `TENANT_ID`. Loaded first on all pages |
| `storefront-theme.js` | Reads `tenants/{TENANT_ID}/public/config/theme` from Firestore. Injects CSS custom properties on `:root`. Auto-generates color variants. Supports 6 font pair presets (classic, modern, editorial, clean, artisan, geometric). Loads template manifests, applies color schemes and homepage flow. Supports `?preview_template=` for live preview without Firebase writes. Dispatches `storefront-theme-ready` event. Exposes `MAST_THEME_READY` promise |
| `storefront-nav.js` | Reads `tenants/{TENANT_ID}/public/config/nav` from Firestore. Builds `<nav>` and mobile menu dynamically. Supports section show/hide via `enabled` flag. Reads `promoBanner` config for data-driven promo banner. Dispatches `storefront-nav-ready` event |
| `tenant-brand.js` | Brand injection via `data-tenant` attributes. Reads platform registry for business name, tagline, contact info |
| `cart.js` | Cart drawer, toast notifications, auth (Sign In/Out via Google), shared across all public pages |
| `cart.css` | Cart drawer and toast styles (uses CSS var tokens with fallbacks) |
| `feedback-widget.js` | Floating feedback button. Uses CSS var tokens (`--accent`, `--primary`). Reads `feedbackSettings/publicEnabled` |
| `share-widget.js` | Floating share button. Uses CSS var tokens. `navigator.share()` on mobile, copy-link fallback on desktop |

### Firebase SDK

Uses Firebase compat SDK (v9.22.0) loaded via CDN. All public reads are anonymous — no auth required. Pattern:
```js
// TENANT_ID is set by storefront-tenant.js (e.g., "shirglassworks", "meadowpottery")
firebase.database().ref(TENANT_ID + '/public/...').once('value', snap => { ... });
```

### Auth on Public Pages

Google Sign-In is available on all public pages via the nav "Sign In" link. Auth is handled by `cart.js`:
- `siteSignIn()` — triggers `signInWithPopup(GoogleAuthProvider)`
- `updateNavAuth(user)` — transforms nav links between signed-in/signed-out states
- Finds elements with `onclick*="siteSignIn"` and dynamically updates them
- Auth state enables order lookup on `orders.html` and persists cart across sessions

### Toast Notifications (Public)

Bottom-center stacking toasts matching the admin app pattern. Implemented in `cart.js` + `cart.css`:
- Container: `.cart-toast-container` — fixed bottom-center, flex column, stacking
- Toasts: `.cart-toast` — slide-up animation, auto-fade after 5s
- Error variant: `.cart-toast.error` — red background with shake animation
- API: `showToast(message, isError)` — creates a new DOM element per toast

## Template System

Tenants can choose from multiple design templates that control homepage layout, section visibility, color schemes, and font pairs.

### Templates

| Template | ID | Flow | Description |
|----------|------|------|------------|
| The Studio | `the-studio` | Story-first | Solo artist, founder-is-brand. Hero → About → Gallery → Contact |
| The Shop | `the-shop` | Product-first | Broad catalog. Hero → Category Grid → Featured Products → About Blurb |

### Key Files

| File | Purpose |
|------|---------|
| `templates/registry.json` | Static array of available template IDs |
| `templates/{id}/manifest.json` | Template definition: slots, colorSchemes, fontPairs, homepageFlow, navStructure, slotMapping |
| `storefront-theme.js` | Runtime flow engine: loads manifest, applies color scheme, reorders/hides homepage sections via `data-slot` attributes |
| `app/modules/website.js` | Admin UI: Template tab (picker + preview + switch), Style tab (manifest-driven schemes/fonts), Sections tab (manifest-driven toggles) |

### How It Works

1. **Template selection:** `public/config/theme/templateId` in Firebase Firestore (under `tenants/{tenantId}/...`)
2. **Manifest loading:** `storefront-theme.js` fetches `templates/{templateId}/manifest.json` at runtime
3. **Color scheme:** `public/config/theme/colorSchemeId` maps to a manifest color scheme. Colors applied as CSS custom properties
4. **Homepage flow:** `applyHomepageFlow()` reorders DOM sections, hides sections not in the flow via `data-flow-hidden`, shows flow sections via `data-flow-active`
5. **Section show/hide guard:** `MAST_THEME_READY` promise prevents data loaders from showing sections before flow engine runs
6. **Template switching:** Admin picks new template → section compatibility analysis (slotMapping) → gallery image migration (hide/restore) → write templateId to Firebase
7. **Gallery migration:** Images in incompatible sections get `templateHidden` flag. Restored automatically on switch-back.
8. **Live preview:** `?preview_template=` query param overrides templateId without writing to Firebase. Shows preview banner.
9. **Deploy pipeline:** `mast_hosting` reads templateId per tenant, validates manifest, applies template page overlays if present, then runs the template compiler if `compile: true` in the manifest

### CSS Token Architecture

```
Theme tokens (inverted by dark mode):     Surface tokens (NOT inverted):
  --primary, --accent, --bg, --text         --surface-dark (always dark)
  --charcoal: var(--text)                   --surface-card (white/dark card)
  --cream: var(--bg)                        --on-dark (white text on dark bg)
```

Use `--surface-dark` for dark backgrounds (page headers, footer, newsletter). Use `--surface-card` for card backgrounds (product cards, filter pills). Use `--on-dark` for text on dark backgrounds.

## Section Catalog

The `sections/` directory contains a structured extraction of all homepage sections. The template compiler in the `mast_hosting` deploy pipeline reads this catalog to assemble `index.html` at deploy time, replacing the runtime flow engine's DOM reordering with build-time HTML assembly.

### Directory Structure

```
sections/
  registry.json                     # Lists all available section IDs
  {sectionId}/
    definition.json                 # Metadata: id, name, category, data attributes, variants
    template.html                   # Raw HTML with data-slot, data-content, data-tenant attributes
    styles.css                      # Section-specific CSS (excludes shared styles)
```

### Sections (11 total)

| ID | Name | Category | Default Hidden | Dynamic Content |
|----|------|----------|----------------|-----------------|
| hero | Hero | universal | no | Video/poster from gallery |
| about | About | universal | no | Image, stats from config |
| gallery | Gallery | universal | no | Grid items from gallery collection |
| category-grid | Category Grid | differentiator | yes | Categories from config |
| featured-products | Featured Products | differentiator | yes | Products from catalog |
| about-blurb | About Blurb | differentiator | yes | No (uses data-tenant) |
| events | Events | differentiator | yes | Events from Firebase |
| testimonials | Testimonials | common | yes | Testimonials from Firebase |
| process | Process | differentiator | yes | Cards from config |
| contact | Contact | universal | no | No (uses data-content + data-tenant) |
| newsletter | Newsletter | common | no | No (form with data-content) |

### definition.json Schema

- **id** — Matches `data-slot` value and directory name
- **name** — Human-readable label
- **description** — What the section does
- **category** — `universal` (required across templates), `common` (optional, shared), or `differentiator` (template-specific)
- **version** — SemVer (currently all `1.0.0`)
- **defaultHidden** — Whether the section starts hidden (`data-default-hidden` + `display:none`)
- **outerTag** — HTML tag (`section` or `div`)
- **outerClasses** / **outerId** — CSS classes and id on the outer element
- **dataContentKeys** — All `data-content` attribute values (for storefront-content.js injection)
- **dataTenantKeys** — All `data-tenant` attribute values (for tenant-brand.js injection)
- **dynamicContent** — Whether JS populates content beyond static injection
- **variants** — Reserved for future section variants (empty arrays for now)

### How Sections Relate to Templates

Template manifests (`templates/{id}/manifest.json`) reference section IDs in their `homepageFlow` arrays and `slots` objects. Every slot ID in a manifest must correspond to a section in the catalog.

### Template Compiler

The template compiler runs in the `mast_hosting` deploy pipeline on Cloud Run (`mast-mcp-server`). It is activated per-template via the `"compile": true` flag in the manifest. Both the-studio and the-shop manifests have this flag enabled.

**Implementation:** `mast-mcp-server/src/tools/template-compiler.ts`

**How it works:**
1. After tarball download, reads the manifest's `homepageFlow` from the file set
2. Splits `index.html` at section markers (`<!-- ============ HERO` / `<!-- ============ FOOTER`)
3. Assembles sections from `sections/{id}/template.html` — flow sections visible (in order), non-flow sections hidden (`data-default-hidden` + `display:none`)
4. Inserts glass dividers after sections with `dividerAfter: true` in their definition.json
5. Replaces the sections zone in index.html, preserving head/CSS/footer/scripts
6. Re-gzips and replaces the FileEntry before Firebase Hosting upload

**Compile step in deploy pipeline:**
```
downloadAndExtract → getTemplateId → validateManifest → applyOverlay → compileHomepage → createVersion → upload
```

**Deploy response includes:** `compiled: true/false`, `sectionsCompiled: N`

**Cost implications:** Essentially zero. The compile step adds ~100-200ms of CPU per deploy (decompressing ~13 gzipped files, string manipulation, re-gzipping one file). No additional Firebase reads — everything comes from the tarball. No additional GitHub API calls. No runtime cost change on tenant sites.

**Runtime note:** `storefront-theme.js` still runs the flow engine at page load, but it is effectively a no-op on compiled pages (sections are already in the correct order and visibility state). A future optimization could skip `applyHomepageFlow()` when the page was pre-compiled, but the flow engine is ~5ms of DOM reordering — negligible.

**Backward compatibility:** Templates without `"compile": true` skip compilation entirely and use the hand-built index.html with the runtime flow engine, same as before.

## Wholesale Catalog

Auth-gated wholesale page at `wholesale.html`. Requires Google Sign-In + admin approval.

### Auth Flow

1. **Google Sign-In** — Same Firebase Auth as rest of site
2. **Access Check** — Reads `{TENANT_ID}/admin/wholesaleAuthorized/{emailKey}` (email with `.` replaced by `,`)
3. **Access Request** — If not authorized, user can submit a request (writes to `admin/wholesaleRequests/{requestId}`)
4. **Denied Screen** — If not authorized and no pending request, shows "not authorized" message

### Product Display

- Products loaded from `{TENANT_ID}/public/products/` — only products with a `wpid` field are shown
- Organized by category (Drinkware, Dispensers, Vases, etc.)
- Each card shows: product image (`object-fit: contain`), wholesale price, option selectors (Color, Size chips)
- Wholesale pricing: `wholesalePriceCents` (flat) or `wholesalePriceVariants` (size-dependent, e.g., Small/Large)
- Add to Cart button disabled until all required options selected — amber hint text shows which options to pick

### Cart

Wholesale cart is separate from the retail cart. Stored in `sessionStorage`. Cart drawer shows selected items with variant details and quantity.

### Admin Features

- **Wholesale PDF generation** — Admin app has a wholesale section to generate PDF catalogs
- **QR code** — Generated QR links to `wholesale.html`, image can be copied to clipboard via `copyQRImage()`
- **Access management** — Admin approves/denies wholesale access requests

### Firebase Paths

| Path | Purpose |
|------|---------|
| `admin/wholesaleAuthorized/{emailKey}` | Approved buyer lookup |
| `admin/wholesaleRequests/{requestId}` | Pending access requests |
| `admin/materials/{materialId}` | Raw materials library (admin-only read/write) |
| `admin/recipes/{recipeId}` | BOM recipes with pricing engine (admin-only read/write) |
| `admin/consignments/{placementId}` | Consignment placements at galleries (admin-only read/write) |
| `admin/lookbooks/{documentId}` | Look book / line sheet document records (admin-only read/write) |
| `admin/config/makerSettings` | Maker module config: craft profile, default markups, labor rate (admin-only) |
| `admin/importLog/{importId}` | CSV import history log |

## Checkout Flow

Multi-step checkout implemented in `checkout.js` as an IIFE (`MastCheckout`).

### Steps

1. **Address** — Customer enters shipping address. Google Places Autocomplete provides type-ahead on the street address field. Soft validation: first attempt warns if not Places-validated, second attempt allows through.

2. **Shipping** — Flat-rate calculation based on product `shippingCategory`. Fetches shipping config from `{tenantId}/public/config/shippingRates` and product shipping data (`weightOz`, `shippingCategory`) for each cart item. Single calculated shipping line displayed (no options to choose from).

3. **Review** — Shows line items, address, shipping, estimated tax, total. Edit links return to prior steps.

4. **Payment** — Calls `submitOrder` cloud function which creates a Square Payment Link. Customer is redirected to Square's hosted checkout. On completion, Square redirects back to the confirmation page.

5. **Confirmation** — Reads `pendingOrder` from sessionStorage (survives the Square redirect). Firebase listener watches `{tenantId}/orders/{orderId}/status` for transition from `pending_payment` to `placed` (triggered by Square webhook → `squareWebhook` cloud function). On detection, auto-generates and downloads Pirate Ship CSV.

### Shipping Calculation (Storefront)

**Algorithm** (identical on client and server):
- Subtotal ≥ `freeThreshold` → free shipping
- Otherwise: `max(category rate across items) + (additionalItems × surcharge)`
- Categories: `small` ($6), `medium` ($10), `large` ($15), `oversized` ($22)
- Default config hardcoded as fallback if Firebase config missing

**Config path:** `{tenantId}/public/config/shippingRates`
```json
{
  "small": { "rate": 6, "boxL": 6, "boxW": 6, "boxH": 6 },
  "medium": { "rate": 10, "boxL": 10, "boxW": 8, "boxH": 6 },
  "large": { "rate": 15, "boxL": 14, "boxW": 12, "boxH": 8 },
  "oversized": { "rate": 22, "boxL": 20, "boxW": 16, "boxH": 12 },
  "additionalItemSurcharge": 2,
  "freeThreshold": 100,
  "packingBufferOz": 8
}
```

### Shipping Label Provider (Admin)

**Generic abstraction layer** mirroring payment-abstraction.js. Shippo is the first adapter; Pirate Ship/CSV is the manual fallback.

**Provider config path:** `{tenantId}/config/shipping/`
```json
{
  "provider": "shippo | manual",
  "defaultFromLocationKey": "studio-key",
  "packagePresets": [
    { "name": "Small Box", "lengthIn": 6, "widthIn": 6, "heightIn": 6 }
  ],
  "updatedAt": "ISO timestamp"
}
```

**API key:** Stored in GCP Secret Manager as `{secretPrefix}-shippo-api-token`. Managed via `secretsManager` Cloud Function from Settings UI.

**Cloud Functions (mast-platform-prod):**
- `shippingValidateAddress` — validate a shipping address
- `shippingGetRates` — get carrier rates for a parcel (from/to/dims)
- `shippingBuyLabel` — purchase a shipping label, writes tracking to order
- `shippingVoidLabel` — void a label, clears tracking on order

**Backend:** `mast-architecture/functions/shipping-abstraction.js` — provider detection chain: explicit config → auto-detect secret → platform fallback. Caching: provider type 30s, client instances 5min.

**Admin UI flow (orders.js):**
1. `openShippingModal()` detects provider from `config/shipping/provider`
2. API mode: ship-from picker → package config → get rates → buy label → print
3. Manual mode: carrier + tracking number form (backward compat)
4. Void: button in tracking section, reverts order to confirmed

**Ship-from addresses:** Stored on `studioLocations` (`config/studioLocations/{id}/`). Fields: `address1, address2, city, state, zip, phone, isDefaultShipFrom`.

**Product dimensions:** `lengthIn, widthIn, heightIn` on product record (alongside `weightOz, shippingCategory`).

**Label printing:** LabelKeeper integration via API sessions. `printShippingLabel()` POSTs `{ type: 'shipping-label', labelImageUrl, orderId, carrier }` to LK API → LK opens 4×6 full-bleed print. Mobile falls back to direct label URL open.

### Google Places Integration

- API key stored at `{tenantId}/public/config/googleMapsApiKey`
- Script loaded lazily at checkout start (not on page load)
- Graceful fallback: if no key or script fails, checkout works without autocomplete
- Restricted to US addresses: `{ types: ['address'], componentRestrictions: { country: 'us' } }`
- `.pac-container` styled to match tenant aesthetic

### Pirate Ship CSV

Generated client-side from sessionStorage data after payment confirmation.

**Columns:** Name, Company, Address1, Address2, City, State, Zip, Country, Phone, Weight_oz, Length, Width, Height, Description, Order_ID

- Weight = Σ(item.weightOz × qty) + (packingBufferOz × totalItems)
- Box dimensions from highest shippingCategory item's config defaults
- Auto-downloads when Firebase listener detects `placed` status
- Manual "Download Shipping CSV" button as fallback
- Listener auto-detaches after 60s safety timeout

### Test Mode

- Config at `{tenantId}/public/config/testMode` (boolean)
- Set automatically when Square environment = sandbox in admin Settings
- Shows orange banner: "TEST MODE — No real charges will be made"
- Square's own sandbox page shows test card numbers

## Cloud Functions

Cloud Functions are deployed on `mast-platform-prod` via `mast-architecture/functions/`. Key tenant functions:

### `submitOrder`

HTTP callable function. Receives order data from checkout, creates Square Payment Link.

1. Validates order items against product catalog in Firebase
2. Calculates subtotal from authoritative product prices (ignores client-sent prices)
3. **Calculates shipping server-side** (authoritative — same algorithm as client)
4. Estimates tax based on state
5. Creates Square Payment Link via API with line items
6. Writes order to `{tenantId}/orders/{orderId}` with status `pending_payment`
7. Returns `{ success, orderId, orderNumber, checkoutUrl }`

### `squareWebhook`

HTTP endpoint receiving Square webhook notifications.

1. Verifies Square webhook signature
2. On `payment.completed`: updates order status to `placed`, writes payment details
3. Triggers downstream: Firebase listener on confirmation page detects status change → CSV download

### `generateLookbook`

HTTP endpoint. Generates PDF catalogs (line sheets or look books) from product/recipe data.

1. Verifies admin auth via Bearer token
2. Reads document config from `admin/lookbooks/{documentId}`
3. Loads products, filters by category/exclusions, loads recipes for tier pricing
4. Builds styled HTML (two layouts: line sheet = compact table, look book = editorial photos)
5. Renders PDF via Puppeteer + Chromium (server-side, consistent rendering)
6. Uploads to Firebase Storage as `{tenantId}/lookbooks/{documentId}.pdf` (public: true for sharing)
7. Updates document record with `generatedUrl` and `generatedAt`

### `etsyUpdateListingPrice`

Callable function. Updates an Etsy listing's price when `activePriceTier` changes on a recipe.

1. Validates admin auth (onCall with `verifyTenantAdmin`)
2. Receives `listingId` and `priceCents`
3. Converts to dollars, calls Etsy PUT API via `etsyApiFetch()` helper
4. Etsy credentials (OAuth tokens) stay server-side in GCP Secret Manager — never exposed to client

Called fire-and-forget from `setActivePriceTier()` in maker.js. Etsy failure does not roll back local price.

## Product Lifecycle (Checkpoints A–G)

The Mast Product entity has a four-state lifecycle plus four archive sub-states. State drives list filtering, channel sync, default tab on the detail screen, returns acceptance, and reorder logic.

### State Machine

```
            ┌──────────┐
            │  Draft   │
            └────┬─────┘
                 │ promoteToReady (gated by readinessChecklist)
                 ▼
            ┌──────────┐
            │  Ready   │
            └────┬─────┘
                 │ launchToActive (channels + inventory check)
                 ▼
            ┌──────────┐
            │  Active  │ ◄─── pendingChanges (Pattern 1, in-place revision)
            └────┬─────┘ ◄─── child v2 Drafts (Pattern 2, clone-to-redesign)
                 │
                 │ openArchiveModal (sub-state picker)
                 ▼
            ┌────────────────────────────────┐
            │           Archived             │
            │ ──────────────────────────────│
            │ discontinuing → selling-through│
            │   ↓                ↓           │
            │   └──→ returns-only ──→ retired│
            │ (auto-flip via autoRetireProducts after returnsAcceptedUntil)
            └────────────────────────────────┘
```

Forward-only sub-state transitions. Revival = Pattern 2 Clone-to-v2.

### Schema Fields (`{tenantId}/public/products/{pid}`)

```
status: 'draft' | 'ready' | 'active' | 'archived'
acquisitionType: 'build' | 'var' | 'resell'   // locked at creation
archivedSubState: 'discontinuing' | 'selling-through' | 'returns-only' | 'retired' | null
hasPendingRevision: boolean
pendingChanges: { [fieldPath]: value } | null
pendingChangesUpdatedAt: ISO
pendingChangesAppliedAt: ISO
parentProductId: string | null              // Pattern 2 source
version: number                             // 1 for originals, 2+ for clones
readinessChecklist: { defined, costed, channeled, capacityPlanned, listingReady }
promotedToReadyAt: ISO | null
promotedToActiveAt: ISO | null
archivedAt: ISO | null
returnsAcceptedUntil: ISO | null            // auto-set on returns-only entry
retiredAt: ISO | null
```

### Archive Sub-state Policies (Checkpoint G)

| Sub-state | Listings | Inventory action | Returns | Reorder | Channel flag |
|---|---|---|---|---|---|
| `discontinuing` | On (optional "Last chance") | No new production/sourcing | Full window | Suppressed | `last-chance` |
| `selling-through` | On (clearance pricing optional) | Existing inventory only | Full window | Suppressed | `clearance` |
| `returns-only` | Off (delisted) | Zero | Until cutoff date | Suppressed | — |
| `retired` | Off | N/A | No | N/A | — |

`autoRetireProducts` (Cloud Function, `every day 02:00 America/New_York`) iterates active tenants and flips returns-only products to retired when `returnsAcceptedUntil < now`.

### Two-View Architecture (Lens Toggle)

The same Product record renders under two lenses:

- **Develop view** — at `develop-products` route. Shows the slice in-progress: `draft`, `ready`, `active+hasPendingRevision`, `archived: {discontinuing, selling-through}` (winding down). Default tab: Define.
- **Catalog view** — at top-level Products. Shows: `active` (default), `archived` (with sub-state chip filter). "Show drafts" toggle reveals `draft+ready`. Default tab: Listing/Details.

Both views are backed by the same `productsData` array; filter membership is determined by `isProductInDevelopView(p)` and `isProductInCatalogView(p, opts)` in `app/modules/maker.js`.

The product detail screen has a **lens toggle pill** ("Viewing as: Develop | Catalog"). Default lens depends on entry point (Develop list → develop, Catalog list → catalog) and is persisted per-pid in `sessionStorage`. The lens controls default tab + button emphasis; both lenses show all tabs (no hiding).

### Status-aware Default Tab

| Status | Develop lens | Catalog lens |
|---|---|---|
| draft / ready | Define | Define |
| active | Define | Listing |
| archived | Listing (read-only banner) | Listing (read-only banner) |

### Scheduled Function: autoRetireProducts

- File: `mast-architecture/functions/auto-retire-products.js`
- Trigger: `onSchedule({ schedule: 'every day 02:00', timeZone: 'America/New_York' })`
- Behavior: For each active tenant (skips `dev`, system tenants, non-active), lists products, finds `archivedSubState === 'returns-only'` with `returnsAcceptedUntil < now`, sets `archivedSubState: 'retired'` and `retiredAt`. Writes one audit log entry per tenant per run when retirements occurred.
- Idempotent — products already retired are skipped. Re-runs are safe.
- Deploys to `mast-platform-prod` like other platform-level scheduled functions.

## Product Data Model

Path: `{tenantId}/public/products/{pid}`

Key shipping-related fields:
- `weightOz: number` — actual product weight in ounces (default: 16 if unset)
- `shippingCategory: "small" | "medium" | "large" | "oversized"` — drives rate and box dimensions (default: "small" if unset)

These fields are editable in the admin app's product edit form (Production tab).

### Product Lifecycle Schema (added 2026-04-28 — Checkpoint A of Develop Module migration)

Lifecycle state machine + acquisition mode + rework + readiness fields. All declared on the same `public/products/{pid}` document; no separate Piece record. Schema lands in Checkpoint A; UI lands in Checkpoints B–G. State-machine validation lands in E.

- `status: 'draft' | 'ready' | 'active' | 'archived'` — gates list filtering, channel sync, returns acceptance, default detail tab. Existing rows are backfilled to `'active'` unless they already carry a valid status (`'draft'` from `submitNewPiece` is preserved).
- `archivedSubState: 'discontinuing' | 'selling-through' | 'returns-only' | 'retired' | null` — set only when `status === 'archived'`. Forward-only transitions; channel sync respects each value (Active + Discontinuing + Selling-through → on; Returns-only + Retired → delisted).
- `acquisitionType: 'build' | 'var' | 'resell'` — locked at creation. Today only `'build'` is shipped; the migration script defaults all existing products to `'build'`. Mode switches require Pattern 2 clone (see below).
- `hasPendingRevision: boolean`, `pendingChanges: object | null`, `pendingChangesUpdatedAt: ISO | null` — Pattern 1 rework. Edits to an Active product write to `pendingChanges` instead of mutating live fields. Apply commits + clears; Discard nukes.
- `parentProductId: string | null`, `version: number` — Pattern 2 rework (clone-to-v2). Originals are `version: 1, parentProductId: null`. Clones bump `version` and reference the parent.
- `readinessChecklist: { defined, costed, channeled, capacityPlanned, listingReady }` — gates Draft → Ready promotion. Migration derives `defined` from BOM/recipe presence, `costed` from `priceCents > 0`, `listingReady` from `images.length > 0`; `channeled` and `capacityPlanned` start `false`.
- `promotedToReadyAt`, `promotedToActiveAt`, `archivedAt`, `returnsAcceptedUntil`, `retiredAt` — ISO timestamps stamped on each transition. `returnsAcceptedUntil` defaults to `+90d` on `returns-only` entry; a scheduled job auto-flips to `retired` after cutoff.

Valid `status` values: `draft | ready | active | archived` (enum exposed as `MastDB.products.LIFECYCLE_STATUSES`). Sub-state values: `discontinuing | selling-through | returns-only | retired` (`MastDB.products.ARCHIVED_SUB_STATES`). Acquisition types: `build | var | resell` (`MastDB.products.ACQUISITION_TYPES`).

Backfill via `scripts/migrate-products-to-lifecycle.py` in the `mast-architecture` repo (writes to Firestore `tenants/{tenantId}/products/*` via REST). See `~/.claude/plans/mast-product-lifecycle-develop-plan.md` for the full plan.

### PIM / Outbound Publishing Fields (added 2026-04-09 — Build 1)

Canonical product shape for the Outbound PIM play (Mast as source of truth, publish to external storefronts). Both fields default to empty objects and are non-breaking for legacy products — reads treat missing fields as empty. Backfill via the `runProductSchemaBackfill` callable in `tenant-functions.js`.

- `attributes: { [attrKey]: { value, sourceChannel, mappedChannels[], dataType, label } }` — flexible extended attributes map for channel-native fields that don't fit the core schema. Keys are FLAT, not dot-namespaced by channel. Same logical attribute across multiple channels is ONE entry with multiple `mappedChannels`. Disambiguate colliding semantics via distinct key names (`materialEtsy`, `materialShopify`). Default: `{}`.
- `externalRefs: { [channelId]: { externalId, externalUrl, lastSyncedAt } }` — external-channel identity mapping. Paired with the reverse index at `{tenantId}/channelMappings/{channelId}/{externalId} = mastId` (written by adapters on publish). Default: `{}`.

Publish safety: adapter mutations run through `withRollbackPoint` (`tenant-functions.js`), which persists pre-state under `{tenantId}/admin/publishRollback/{operationId}` for session-bound undo via `rollbackPublishOperation`.

## Admin App

React app with a core shell (`/app/index.html`, ~17.6K lines) and 14 lazy-loaded feature modules (`/app/modules/*.js`, ~18.2K lines combined). Uses React 18 via CDN (no JSX — `React.createElement` / htm tagged templates), Tailwind CSS via CDN, Firebase compat SDK.

### Authentication & Tenant Resolution

1. **Google Sign-In** — `firebase.auth().signInWithPopup(GoogleAuthProvider)` via the tenant's Firebase Auth (resolved by `storefront-tenant.js`)
2. **Tenant Resolution** — `resolveTenant(uid)` reads `platform_userTenantMap/{uid}` from Firestore. Returns tenant ID (e.g., `"shirglassworks"`) or `null`
3. **Bootstrap** — If no tenant mapping exists but user has an existing admin record in tenant data, `seedPlatformRegistry()` writes the full platform registry (`platform_tenants`, `platform_userTenantMap`, `platform_platformAdmins`)
4. **MastDB Init** — `MastDB.init({ tenantId, db })` configures all data accessors to read/write under tenant scope (`tenants/{tenantId}/...`)
5. **RBAC** — `loadUserRole(uid)` reads `{tenantId}/admin/users/{uid}/role`. Roles: `admin`, `user`, `guest`. Auto-provisions new users as `guest`
6. **Access Denied** — If no tenant membership found, shows "Access Denied" screen

### MastDB Data Access Layer

`MastDB` is a centralized data access object. Each entity (e.g., `MastDB.orders`, `MastDB.products`) provides:
- `.ref(subpath)` — returns a Firebase ref under `{tenantId}/{entityPath}/{subpath}`
- `.listen(limit, onValue, onError)` — attaches a `limitToLast(N)` listener
- `.unlisten(handle)` — detaches listener
- `.newKey()` — generates a push key

Entities include: events, gallery, images, products, inventory, orders, sales, squarePayments, coupons, salesEvents, bundles, productionRequests, productionJobs, operators, buildMedia, stories, contacts, commissions, locations, studioLocations, newsletter, blog, market, adminUsers, roles, invites, auditLog, auditIndex, feedback, feedbackSettings, materials, recipes, consignments, lookbooks, importLog, and more.

### Order Status Flow

Orders follow a state machine with valid transitions:

```
placed → confirmed, cancelled
confirmed → building, ready, cancelled
building → ready, cancelled
ready → packing, cancelled
packing → packed, shipped, cancelled
packed → handed_to_carrier, shipped
handed_to_carrier → shipped
shipped → delivered
```

Status pills are color-coded throughout the app (CSS classes `.order-status.{status}`).

### Dashboard

The dashboard (`#dashboard` route) shows:
1. **Quick Actions** — Top 3 most-used actions, personalized per user from frequency data
2. **New Orders Queue** — Grid of orders with status `"placed"` (unreviewed). Each card shows order number, status pill, customer, items, total, date. Click navigates to order detail. Shows "No new orders." when empty
3. **Active Trip Banner** — If a delivery trip is in progress, shows destination and elapsed time

### Toast Notifications (Admin)

Bottom-center stacking toasts. Container `#toastContainer` with `.toast` elements:
- `showToast(message, isError)` — creates toast, auto-removes after 5s
- Normal: dark charcoal background, slide-up animation, fade-out
- Error: red background (`var(--danger)`), shake animation
- Dark mode: adjusted backgrounds

### Settings Tab — Shipping Config

Inputs for all shipping rate/dimension values, save/load to `{tenantId}/public/config/shippingRates`.

### Settings Tab — Google Maps API Key

Text input, saves to `{tenantId}/public/config/googleMapsApiKey`.

### Settings Tab — Square Config

Environment toggle (sandbox/production), Application ID, Location ID per environment. Saves to `{tenantId}/admin/config/squareEnv`. When sandbox selected, also writes `testMode: true` to public config.

### Modular Architecture

The admin app uses a core shell + lazy-loaded module pattern to optimize deploy size and load time.

#### Core Shell (`app/index.html`, ~17.6K lines)

Retains: all CSS (~4.3K lines), HTML skeleton (sidebar, tab containers, modals), and core JS:
- Firebase init, MastDB data access layer
- Tenant config, subscription model, module gating
- Auth (Google Sign-In, RBAC, user management, invite flow, permission matrix)
- Routing (`ROUTE_MAP`, `navigateTo`, `applyRoute`, lazy module loading)
- Shared utilities (`showToast`, `esc`, `formatDate`, `formatCurrency`, `compressImage`, `auditLog`)
- Dashboard (quick actions, new orders queue, active trip banner)
- Settings (domains, GitHub, Square, shipping, Google Maps, email provider config, email domain verification, Etsy, setup wizard)
- Products & Inventory (catalog, product detail, variant inventory, forecast, location tracking)
- Gallery, events, images, coupons, analytics
- Image library and image picker (shared across modules)
- Testing/missions mode

#### Feature Modules (`app/modules/`, 14 files, ~19.4K lines combined)

| Module | File | Lines | Routes |
|--------|------|-------|--------|
| Blog | `blog.js` | ~1,150 | `blog` |
| Newsletter | `newsletter.js` | ~1,270 | `newsletter` |
| Social Media | `social.js` | ~1,095 | `social` |
| Trips & Mileage | `trips.js` | ~1,980 | `trips` |
| Wholesale | `wholesale.js` | ~770 | `wholesale` |
| Financials | `financials.js` | ~270 | `financials` |
| Shows | `shows.js` | ~2,595 | `show`, `show-find`, `show-apply`, `show-prep`, `show-execute`, `show-history` |
| Production | `production.js` | ~2,735 | `jobs`, `production`, `stories` |
| Contacts | `contacts.js` | ~530 | `contacts` |
| Orders | `orders.js` | ~2,005 | `orders`, `commissions` |
| Sales (POS) | `sales.js` | ~1,470 | `pos`, `receipts`, `events`, `salesEvents` |
| Fulfillment | `fulfillment.js` | ~1,030 | `pack`, `ship`, `fulfillment` |
| Events (Organizer) | `events.js` | ~1,900 | `events-shows`, `events-settings` |
| Website | `website.js` | ~1,330 | `website` |
| Develop (file: `maker.js`) | `maker.js` | ~2,100 | `materials`, `pieces` |
| Consignment | `consignment.js` | ~570 | `galleries` |
| Look Books | `lookbooks.js` | ~400 | `lookbooks` |

#### Module Loading Pattern

1. Each module is an **IIFE** with `'use strict'` — all module state is private
2. On load, the module calls `MastAdmin.registerModule(moduleId, { routes, lazyLoad, attachListeners, detachListeners })`
3. Functions referenced in HTML templates via `onclick` must be exported to `window` at the bottom of the IIFE
4. Core's `navigateTo()` checks `MODULE_MANIFEST` — if the route belongs to an unloaded module, `loadModule()` inserts a `<script>` tag and waits for registration
5. On subsequent visits, the module is already loaded — no re-fetch

#### Key Conventions

- **CSS stays in core** — all module-specific styles remain in `index.html`'s `<style>` block to prevent FOUC
- **HTML skeleton stays in core** — tab containers (`<div id="xxxTab">`) and sidebar items stay in `index.html`
- **MastDB entity definitions stay in core** — entity refs are shared infrastructure
- **Globals accessed directly** — `showToast`, `esc`, `escapeHtml`, `MastDB`, `TENANT_CONFIG`, `openModal`, `closeModal`, `openImagePicker`, `imageLibrary`, `currentUser`, `callCF`, `auth`, `firebase`, `formatDateRange`, `emitTestingEvent` are all on `window`
- **Firebase listeners stay in core** — `attachListeners()` owns all listeners, callbacks guarded with `typeof` checks (e.g., `if (typeof renderOrders === 'function') renderOrders()`)
- **Cross-module data** — `MastAdmin.getData(key)` / `MastAdmin.setData(key, value)` for shared state (e.g., orders data, products data)

### Develop Module Architecture

The Develop Module (formerly "Maker"; file still `maker.js` for stability — see Checkpoint B rename log) along with `consignment.js` and `lookbooks.js` provides materials management, BOM/recipe pricing, consignment tracking, and catalog generation. Three modules, two Cloud Functions.

#### Data Model Relationships

```
admin/config/makerSettings
  └── craftProfile → drives seedMaterials() + makerAttributes visibility

admin/materials/{materialId}
  └── unitCost snapshot denormalized into recipe lineItems
  └── unitCost change triggers costsDirty on all referencing recipes

admin/recipes/{recipeId}
  ├── lineItems/{lineItemId} → materialId (keyed objects, not arrays)
  ├── activePriceTier → propagates to product.priceCents + Etsy listing
  ├── variants/{variantId} → independent lineItems, labor, costs (shared markups)
  └── productId → links to public/products/{pid}

public/products/{pid}
  ├── priceCents ← set by setActivePriceTier()
  ├── etsyListingId → triggers etsyUpdateListingPrice Cloud Function
  └── makerAttributes → jewelry-specific metadata (conditional on craftProfile)

admin/consignments/{placementId}
  └── lineItems/{lineItemId} → productId, qtySold, qtyReturned, onHand

admin/lookbooks/{documentId}
  └── generatedUrl → Firebase Storage PDF
```

#### Key Architectural Patterns

- **costsDirty flag:** Set when a material's `unitCost` changes (client-side scan of recipes referencing that material). Cleared on `recalculateRecipe()`. Lazy pattern — costs recalc when recipe is opened, not eagerly.
- **activePriceTier propagation:** `setActivePriceTier(recipeId, tier)` does an atomic multi-path write: `recipe.activePriceTier` + `product.priceCents` + fire-and-forget Etsy sync. Etsy failure never blocks local update.
- **Calculation engine:** `calculateRecipe()` is pure math — no Firebase calls. Takes lineItems, labor, markups → returns all costs and tier prices. `calculateAllVariants()` runs it per-variant with shared markups.
- **Variant recipes:** `isVariantEnabled` flag (default false). Up to 3 variants with independent lineItems/labor/otherCost but shared markups at recipe level. First variant's price used for `product.priceCents` propagation.
- **Pre-seed system:** Craft profile selection triggers `seedMaterials()` — creates draft materials with category structure and default markups. `materialsSeeded` flag prevents re-seeding.
- **lineItems as objects:** Keyed by lineItemId, not arrays — legacy RTDB compatibility (preserved post-Firestore cutover so the data shape stays stable).
- **CSV Import:** Client-side parsing (PapaParse for CSV, SheetJS for XLSX). 3-step wizard: upload → column mapping with auto-detection → preview & confirm. All imports land as `status: draft` with `importedFrom: 'csv'` tag. Import history logged to `admin/importLog`.
- **Consignment math:** Commission rate is per-placement (flat %). `onHand = qty - qtySold - qtyReturned`. Bounds-checked on sale/return. Running totals recalculated on each transaction.
- **Look book PDFs:** Server-side Puppeteer rendering via `generateLookbook` Cloud Function. Stored in Firebase Storage as public files for sharing. Two layouts: line sheet (compact table) and look book (editorial photos).

#### Product Model Extension (makerAttributes)

Optional `makerAttributes` object on products, shown only when `craftProfile === 'jewelry'`:
```
metalType, metalPurity, stoneType, stoneCut, finish,
length, dimensions, weight, ringSize,
isOneOfAKind, isCustomizable, productionTime, edition
```
Collapsible "Maker Details" section in product edit form. Async `MastDB.config.makerSettings()` check determines visibility.

#### Firebase Rules

All maker paths have explicit admin-only read/write rules in `platform.rules.json`:
- `admin/materials/` — admin-only + validation (materialId, name, unitOfMeasure, unitCost, status required)
- `admin/recipes/` — admin-only + validation (recipeId, productId, status required)
- `admin/consignments/` — admin-only
- `admin/lookbooks/` — admin-only

### Events Pages (Public)

Three public-facing event pages with JS extracted to separate files:

| Page | HTML Shell | JS File | Purpose |
|------|-----------|---------|---------|
| Events listing | `events/index.html` | `events/events.js` (~1,400 lines) | Browse upcoming events/shows |
| Vendor portal | `vendor/index.html` | `vendor/vendor.js` (~400 lines) | Vendor registration and management |
| Show detail | `show/index.html` | `show/show.js` (~400 lines) | Individual show/event detail page |

HTML files are thin shells (CSS + HTML + `<script src="...">`). JS files use the same IIFE pattern as admin modules.

## Firebase Firestore — Tenant Data Model

All tenant data lives under `tenants/{tenantId}/...` in the platform Firestore. The DataStore / `MastDB` adapter translates legacy-style path strings (e.g. `admin/foo/bar`) to the corresponding Firestore collection paths.

### Tenant Data (under `{tenantId}/`)

| Path | Access | Purpose |
|------|--------|---------|
| `{tenantId}/public/products/` | Anonymous read | Product catalog |
| `{tenantId}/public/gallery/` | Anonymous read | Gallery images |
| `{tenantId}/public/config/theme` | Anonymous read | Storefront theme: `primaryColor`, `accentColor`, `fontPair` (classic/modern/editorial/clean/artisan). Read by `storefront-theme.js` |
| `{tenantId}/public/config/nav` | Anonymous read | Nav config: `sections` (object keyed by section ID, each with `label`, `href`, `enabled`, `highlight`, `order`), `showSignIn`, `logoUrl`. Read by `storefront-nav.js` |
| `{tenantId}/public/config/promoBanner` | Anonymous read | Promo banner: `text`, `enabled`. Read by `storefront-nav.js` |
| `{tenantId}/public/config/categories` | Anonymous read | Product categories array: `[{ id, label, wholesaleGroup? }]`. Drives shop filter pills, wholesale groups, admin gallery sections |
| `{tenantId}/public/config/homepage/about` | Anonymous read | Homepage about section: `label`, `title`, `stats[]` |
| `{tenantId}/public/config/homepage/gallery` | Anonymous read | Homepage gallery section: `label`, `title`, `subtitle` |
| `{tenantId}/public/config/homepage/process` | Anonymous read | Homepage process section: `label`, `title`, `subtitle`, `cards[]` |
| `{tenantId}/public/config/about` | Anonymous read | About page config: `label`, `heading`, `techniquesLabel`, `techniques[]` |
| `{tenantId}/public/testimonials` | Anonymous read | Testimonials: `{ quote, author, rating, order, visible }` |
| `{tenantId}/public/config/shippingRates` | Anonymous read | Shipping calculation config |
| `{tenantId}/public/config/googleMapsApiKey` | Anonymous read | Places API key |
| `{tenantId}/public/config/testMode` | Anonymous read | Sandbox mode flag |
| `{tenantId}/admin/config/squareEnv` | Admin only | Square credentials |
| `{tenantId}/admin/inventory/` | Staff+ | Inventory records |
| `{tenantId}/admin/users/` | Admin only | RBAC user records (role per UID) |
| `{tenantId}/admin/roles/` | Staff+ | Role definitions |
| `{tenantId}/admin/auditLog/` | Staff+ | Audit trail entries |
| `{tenantId}/admin/feedbackSettings/` | Admin only | Feedback widget config |
| `{tenantId}/admin/wholesaleAuthorized/` | Admin only | Approved wholesale buyer lookup (keyed by email) |
| `{tenantId}/admin/wholesaleRequests/` | Authenticated write | Wholesale access requests from buyers |
| `{tenantId}/orders/` | Mixed | Order records (write: cloud function + admin, read: status field public for confirmation listener) |
| `{tenantId}/feedbackReports/` | Public write | Customer feedback submissions |
| `{tenantId}/webPresence/config/` | Admin only | Website builder config (style, colors, fonts, sections) |
| `{tenantId}/webPresence/importJobs/` | Admin only | Website import job queue (status, discovered, imported counts) |
| `{tenantId}/webPresence/siteAnalysis/` | Admin only | Site analysis results + crawl manifest from `analyzeExistingSite` |
| `{tenantId}/webPresence/imageHashes/` | Admin only | MD5 hashes of imported images for deduplication |
| `{tenantId}/webPresence/draftTemplates/` | Admin only | Draft template manifests generated from site analysis |
| `{tenantId}/public/config/draftTemplate` | Anonymous read | Saved draft template override (custom homepageFlow) |

### Platform Registry (Firestore collections under `mast-platform-prod`)

Stored in `mast-platform-prod` Firestore for client-side auth. Rules allow users to read their own `platform_userTenantMap/{uid}` entry.

| Collection | Access | Purpose |
|------------|--------|---------|
| `platform_userTenantMap/{uid}` | Own UID read/write | Tenant membership per user |
| `platform_platformAdmins/{uid}` | Own UID read | Platform admin flag |
| `platform_tenants/` | Authenticated read | Tenant registry (config, subscription, status) |
| `platform_tenantsByDomain/` | Authenticated read | Domain → tenant ID lookup |

### Firestore Security Rules

Rules deployed from `mast-architecture/rules/firestore.rules`. Legacy RTDB rules at `mast-architecture/rules/platform.rules.json` are retained only for the locked-down legacy RTDB instance.

Key sections:
- `mast-platform/` — platform registry (per-uid reads for tenant resolution)
- `$tenantId/` — wildcard for tenant data. Write gate: `admin/users/{uid}/role === 'admin'`. Sub-path rules for public (anonymous read), admin (RBAC-gated), orders, etc.

## Key Patterns

- **No framework on public pages.** Vanilla JS, IIFE pattern, Firebase compat SDK.
- **Dynamic tenant resolution.** `storefront-tenant.js` resolves tenant from hostname → platform Firestore. `tenant-brand.js` injects brand content. No hardcoded tenant references.
- **SessionStorage for redirect persistence.** Cart and order data stored in sessionStorage before Square redirect, retrieved on return.
- **Server-side is authoritative.** Client calculates shipping/tax for display; server recalculates from source data before creating payment.
- **Graceful degradation.** Google Places, test mode banner, and shipping config all have fallback defaults if Firebase reads fail.
- **Firebase listeners with safety bounds.** All `.on('value')` listeners use `limitToLast(N)` to prevent unbounded billing.
- **Multi-tenant data isolation.** All tenant data under `{tenantId}/` prefix. MastDB enforces prefix on all reads/writes.
- **Toast consistency.** Both public and admin apps use the same bottom-center stacking toast pattern with slide-up entrance, auto-fade, and error shake variant.

## Website Import Architecture

Job-based polling model for importing products, images, and content from a tenant's existing website during onboarding.

### Flow

1. **Analyze** — Tenant enters URL in admin. `analyzeExistingSite` Cloud Function fetches the page, calls Claude API to extract branding (business name, colors, style, hero content, contact info, social links), classifies observed homepage sections against the 11-section catalog, and builds a **crawl manifest** (platform type, content types found, pagination style, image hosting). Also generates a **draft template manifest** from section classification, extracted colors, and font suggestions — stored at `{tenantId}/webPresence/draftTemplates/{draftId}` for admin review.
2. **Create Job** — Admin UI creates an import job at `{tenantId}/webPresence/importJobs/{jobId}` with status `pending` and the crawl manifest.
3. **Crawl & Extract** — `processImportJob` Cloud Function (Firestore document-write trigger on `tenants/{tenantId}/webPresence_importJobs/{jobId}`) fires instantly when the job is written. Crawls product listing and category pages, discovers products, extracts data, creates products in Firebase, uploads images to Storage. Runs within a single 540-second function execution — no scheduled task needed.
4. **Cherry-pick** — Admin UI shows discovered items as a checklist. Tenant can toggle individual products on/off. Excluded URLs saved to `cherryPickExclude` on the job.
5. **Extract** — Scheduled task picks up crawled/importing jobs, fetches each product page, extracts descriptions/images, creates products via MCP (`mast_products`), uploads images to Firebase Storage, writes image hashes for dedup. Updates job to `complete`.
6. **Review** — Admin UI shows all imported products as drafts with Publish/Delete actions.

### Job Status State Machine

`pending` → `processing` → `crawled` → `importing` → `complete`
Any state → `failed` (on error or 2h timeout auto-fail)

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Website module | `app/modules/website.js` | Admin UI: 6 tabs (Overview, Template, Style, Sections, Categories, Import). Import tab shows draft template banner + review modal |
| Import MCP tool | `mast-mcp-server/src/tools/mast-import.ts` | Job CRUD: create, claim, update, complete, fail. Auto-fails stale jobs. |
| processImportJob | `mast-architecture/functions/tenant-functions.js` | Firestore document-write trigger — crawls site and imports products/images instantly when job is created |
| analyzeExistingSite | `mast-architecture/functions/tenant-functions.js` | Claude API analysis + crawl manifest generation |
| notifyImportComplete | `mast-architecture/functions/tenant-functions.js` | Email notification on import completion |

### Draft Template Generation

When `analyzeExistingSite` runs, it now also generates a draft template manifest:

1. **Section classification** — Claude API classifies observed homepage sections against the 11-section catalog (hero, about, gallery, etc.) with confidence scores (high/medium/low)
2. **Draft manifest** — `buildDraftManifest()` assembles: `homepageFlow` from classified sections, `colorSchemes` from extracted colors, `fontPairId` from font suggestion, `baseTemplateId` from template match
3. **Storage** — Draft stored at `{tenantId}/webPresence/draftTemplates/{draftId}` with `status: draft`
4. **Admin review UI** — Website module Import tab shows a banner when a draft exists. Admin can review section order (reorder/remove), view color scheme and classification details, preview on storefront (opens base template with `?preview_template=`), then "Save as My Template" to apply. Review modal includes disabled "Promote to Library" button (future) and section variant placeholder (future)
5. **Compiler integration** — `compileHomepage()` in the template compiler accepts an optional `homepageFlowOverride` parameter. When a tenant has a saved draft template at `public/config/draftTemplate`, the deploy pipeline reads the custom `homepageFlow` and passes it to the compiler, overriding the manifest's default flow. Both single-tenant and deploy_all paths support this

Draft manifest schema:
```
webPresence/draftTemplates/{draftId}/
├── status: "draft" | "saved" | "dismissed"
├── baseTemplateId: string (matched template ID)
├── homepageFlow: string[] (ordered section IDs)
├── classifiedSections: [{ catalogId, observedLabel, confidence, reason }]
├── colorSchemes: [{ id, name, default, colors: { primaryColor, accentColor, ... } }]
├── fontPairId: string (classic, modern, editorial, clean, artisan)
├── sourceUrl: string
├── businessName: string
├── createdAt / updatedAt: ISO timestamps
```

### Production Hardening

- **robots.txt** — Checked before crawling; disallowed paths skipped
- **User-Agent** — Identifies as `MastBot/1.0 (+https://runmast.com/bot)`
- **Rate limiting** — 1 second between fetches, max 50 pages per crawl, max 100 products / 200 images per import
- **Image deduplication** — MD5 hash check against `webPresence/imageHashes/` before upload
- **JS-rendered detection** — Flags sites with minimal HTML + heavy scripts; warns admin
- **Timeout auto-fail** — Jobs stuck in processing/importing > 2 hours are auto-failed by MCP `list_jobs`
- **All imported content starts as draft** — Never published automatically

### Platform Capability Matrix

A data-driven system that tracks what can be extracted from each e-commerce platform and how well it works in practice.

**Firebase path:** `mast-platform/importCapabilities/{platformId}/`

**Structure per platform:**
```
{platformId}/
├── platformName: string
├── status: "active"
├── lastUpdated: ISO timestamp
├── capabilities/
│   ├── products/
│   │   ├── label, icon, priority, supported: boolean
│   │   ├── methods/
│   │   │   └── [{ method, cost: "free"|"paid", tier: "primary"|"fallback", fields: {...}, estimatedTokensPerItem }]
│   │   └── stats/
│   │       └── { totalAttempts, totalSuccesses, successRate, lastImportAt, avgFieldCoverage }
│   ├── blog/, events/, variants/, categories/, tags/, images/, descriptions/, sku/, pricing/
```

**11 capabilities tracked:** products, blog, events, eventUrls, variants, categories, tags, images, descriptions, sku, pricing

**10 platforms seeded:** squarespace, shopify, wix, wordpress, etsy, magento, bigcartel, godaddy, weebly, unknown

**How it's used:**

1. **Customer preview** — `analyzeExistingSite` reads the matrix after platform detection. `renderCapabilityPreview()` in the admin wizard shows capability cards with "INCLUDED" (free) or "AI" (paid) badges. If `stats.successRate > 80%` with 2+ imports, shows confidence percentage.
2. **Extraction routing** — `probeExtractionReadiness()` reads the matrix to determine the recommended extraction method instead of hardcoded if/else blocks. Runtime probe can override: if matrix says `claude-api` but the probe finds JSON-LD on the page, it uses the free method.
3. **Feedback loop** — `recordImportFeedback()` runs after every completed import, writing actual results back to the matrix stats using Firebase transactions. This closes the loop: real import data improves customer preview accuracy over time.

**Key files:**
- `mast-architecture/functions/adaptive-import.js` — `CAPABILITY_DEFINITIONS`, `PLATFORM_CAPABILITIES`, `seedCapabilityMatrix()`, `getCapabilityMatrix()`, `recordImportFeedback()`, matrix-driven `probeExtractionReadiness()`
- `mast-mcp-server/src/tools/mast-import.ts` — MCP actions: `get_matrix`, `seed_matrix`, `update_capability`
- `app/index.html` — `renderCapabilityPreview()` in onboarding wizard step 3
