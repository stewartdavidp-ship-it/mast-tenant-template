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

The Mast Tenant Template is a multi-tenant storefront deployed to Firebase Hosting with a Firebase Realtime Database backend. The public site (product catalog, gallery, checkout) uses vanilla JS with no framework. The admin app (`/app/index.html`) is a single-file React 18 app with multi-tenant auth and RBAC.

**Repo:** `stewartdavidp-ship-it/mast-tenant-template`
**GCP project (platform):** `mast-platform-prod`
**Platform RTDB:** `https://mast-platform-prod-default-rtdb.firebaseio.com`
**Storage:** `gs://mast-platform-prod.firebasestorage.app` (tenant assets under `{tenantId}/`)
**Cloud Functions:** `mast-architecture/functions/` (shared platform functions)

## Environments

There are two distinct environments. Both serve the same code from this repo but point to different Firebase projects and data.

### Dev Environment — `mast-platform-prod` project (hosting site `mast-dev-env`)

- **GCP/Firebase project:** `mast-platform-prod` (same project as production — no cross-project IAM)
- **Hosting site:** `mast-dev-env` → `mast-dev-env.web.app`
- **RTDB:** `https://mast-platform-prod-default-rtdb.firebaseio.com` (tenant data under `dev/` prefix)
- **Tenant ID:** `dev`
- **Purpose:** Development and testing. Contains Shir Glassworks test data (products, gallery, config) copied to the `dev/` path in the platform RTDB. Runs the same code and tenant resolution as production tenants.
- **Deploy:** `mast_hosting(action: "deploy", tenantId: "dev")` — same as any production tenant. No Firebase CLI required.
- **Tenant resolution:** `tenantsByDomain/mast-dev-env_web_app` → `dev` → `mast-platform/tenants/dev/publicConfig`
- **Legacy dev site:** `shir-glassworks.web.app` (`shir-glassworks` GCP project) — deprecated, kept live as backup until Shir Glassworks production cutover. Do not use for new development.

### Production Environment — `mast-platform-prod` project

- **GCP/Firebase project:** `mast-platform-prod`
- **Hosting sites:** One per tenant (e.g., `mast-shirglassworks`, `mast-meadowpottery`) → `mast-{tenantId}.web.app`
- **RTDB:** `https://mast-platform-prod-default-rtdb.firebaseio.com`
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
- **Hosting config:** `mast-platform/tenants/{tenantId}/hosting` in `mast-platform-prod` RTDB
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
| `storefront-theme.js` | Reads `{TENANT_ID}/public/config/theme` from RTDB (REST API). Injects CSS custom properties on `:root`. Auto-generates color variants. Supports 6 font pair presets (classic, modern, editorial, clean, artisan, geometric). Loads template manifests, applies color schemes and homepage flow. Supports `?preview_template=` for live preview without Firebase writes. Dispatches `storefront-theme-ready` event. Exposes `MAST_THEME_READY` promise |
| `storefront-nav.js` | Reads `{TENANT_ID}/public/config/nav` from RTDB. Builds `<nav>` and mobile menu dynamically. Supports section show/hide via `enabled` flag. Reads `promoBanner` config for data-driven promo banner. Dispatches `storefront-nav-ready` event |
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

1. **Template selection:** `public/config/theme/templateId` in Firebase RTDB
2. **Manifest loading:** `storefront-theme.js` fetches `templates/{templateId}/manifest.json` at runtime
3. **Color scheme:** `public/config/theme/colorSchemeId` maps to a manifest color scheme. Colors applied as CSS custom properties
4. **Homepage flow:** `applyHomepageFlow()` reorders DOM sections, hides sections not in the flow via `data-flow-hidden`, shows flow sections via `data-flow-active`
5. **Section show/hide guard:** `MAST_THEME_READY` promise prevents data loaders from showing sections before flow engine runs
6. **Template switching:** Admin picks new template → section compatibility analysis (slotMapping) → gallery image migration (hide/restore) → write templateId to Firebase
7. **Gallery migration:** Images in incompatible sections get `templateHidden` flag. Restored automatically on switch-back.
8. **Live preview:** `?preview_template=` query param overrides templateId without writing to Firebase. Shows preview banner.
9. **Deploy pipeline:** `mast_hosting` reads templateId per tenant, validates manifest, applies template page overlays if present

### CSS Token Architecture

```
Theme tokens (inverted by dark mode):     Surface tokens (NOT inverted):
  --primary, --accent, --bg, --text         --surface-dark (always dark)
  --charcoal: var(--text)                   --surface-card (white/dark card)
  --cream: var(--bg)                        --on-dark (white text on dark bg)
```

Use `--surface-dark` for dark backgrounds (page headers, footer, newsletter). Use `--surface-card` for card backgrounds (product cards, filter pills). Use `--on-dark` for text on dark backgrounds.

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

## Checkout Flow

Multi-step checkout implemented in `checkout.js` as an IIFE (`MastCheckout`).

### Steps

1. **Address** — Customer enters shipping address. Google Places Autocomplete provides type-ahead on the street address field. Soft validation: first attempt warns if not Places-validated, second attempt allows through.

2. **Shipping** — Flat-rate calculation based on product `shippingCategory`. Fetches shipping config from `{tenantId}/public/config/shippingRates` and product shipping data (`weightOz`, `shippingCategory`) for each cart item. Single calculated shipping line displayed (no options to choose from).

3. **Review** — Shows line items, address, shipping, estimated tax, total. Edit links return to prior steps.

4. **Payment** — Calls `submitOrder` cloud function which creates a Square Payment Link. Customer is redirected to Square's hosted checkout. On completion, Square redirects back to the confirmation page.

5. **Confirmation** — Reads `pendingOrder` from sessionStorage (survives the Square redirect). Firebase listener watches `{tenantId}/orders/{orderId}/status` for transition from `pending_payment` to `placed` (triggered by Square webhook → `squareWebhook` cloud function). On detection, auto-generates and downloads Pirate Ship CSV.

### Shipping Calculation

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

## Product Data Model

Path: `{tenantId}/public/products/{pid}`

Key shipping-related fields:
- `weightOz: number` — actual product weight in ounces (default: 16 if unset)
- `shippingCategory: "small" | "medium" | "large" | "oversized"` — drives rate and box dimensions (default: "small" if unset)

These fields are editable in the admin app's product edit form (Production tab).

## Admin App

React app with a core shell (`/app/index.html`, ~17.6K lines) and 14 lazy-loaded feature modules (`/app/modules/*.js`, ~18.2K lines combined). Uses React 18 via CDN (no JSX — `React.createElement` / htm tagged templates), Tailwind CSS via CDN, Firebase compat SDK.

### Authentication & Tenant Resolution

1. **Google Sign-In** — `firebase.auth().signInWithPopup(GoogleAuthProvider)` via the tenant's Firebase Auth (resolved by `storefront-tenant.js`)
2. **Tenant Resolution** — `resolveTenant(uid)` reads `mast-platform/userTenantMap/{uid}` from RTDB. Returns tenant ID (e.g., `"shirglassworks"`) or `null`
3. **Bootstrap** — If no tenant mapping exists but user has an existing admin record in tenant data, `seedPlatformRegistry()` writes the full `mast-platform/` registry (tenants, userTenantMap, platformAdmins)
4. **MastDB Init** — `MastDB.init({ tenantId, db })` configures all data accessors to read/write under `{tenantId}/` prefix
5. **RBAC** — `loadUserRole(uid)` reads `{tenantId}/admin/users/{uid}/role`. Roles: `admin`, `user`, `guest`. Auto-provisions new users as `guest`
6. **Access Denied** — If no tenant membership found, shows "Access Denied" screen

### MastDB Data Access Layer

`MastDB` is a centralized data access object. Each entity (e.g., `MastDB.orders`, `MastDB.products`) provides:
- `.ref(subpath)` — returns a Firebase ref under `{tenantId}/{entityPath}/{subpath}`
- `.listen(limit, onValue, onError)` — attaches a `limitToLast(N)` listener
- `.unlisten(handle)` — detaches listener
- `.newKey()` — generates a push key

Entities include: events, gallery, images, products, inventory, orders, sales, squarePayments, coupons, salesEvents, bundles, productionRequests, productionJobs, operators, buildMedia, stories, contacts, commissions, locations, studioLocations, newsletter, blog, market, adminUsers, roles, invites, auditLog, auditIndex, feedback, feedbackSettings, and more.

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

### Events Pages (Public)

Three public-facing event pages with JS extracted to separate files:

| Page | HTML Shell | JS File | Purpose |
|------|-----------|---------|---------|
| Events listing | `events/index.html` | `events/events.js` (~1,400 lines) | Browse upcoming events/shows |
| Vendor portal | `vendor/index.html` | `vendor/vendor.js` (~400 lines) | Vendor registration and management |
| Show detail | `show/index.html` | `show/show.js` (~400 lines) | Individual show/event detail page |

HTML files are thin shells (CSS + HTML + `<script src="...">`). JS files use the same IIFE pattern as admin modules.

## Firebase RTDB — Tenant Data Model

All tenant data lives under `{tenantId}/` in the tenant's RTDB (configured via `publicConfig.databaseURL`).

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

### Platform Registry (under `mast-platform/`)

Replicated from `mast-platform-prod` RTDB for client-side auth. Rules allow users to read their own `userTenantMap/$uid` entry.

| Path | Access | Purpose |
|------|--------|---------|
| `mast-platform/userTenantMap/{uid}` | Own UID read/write | Tenant membership per user |
| `mast-platform/platformAdmins/{uid}` | Own UID read | Platform admin flag |
| `mast-platform/tenants/` | Authenticated read | Tenant registry (config, subscription, status) |
| `mast-platform/tenantsByDomain/` | Authenticated read | Domain → tenant ID lookup |

### RTDB Security Rules

Rules deployed from `mast-architecture/rules/platform.rules.json` (platform RTDB) or tenant-specific rules files.

Key sections:
- `mast-platform/` — platform registry (per-uid reads for tenant resolution)
- `$tenantId/` — wildcard for tenant data. Write gate: `admin/users/{uid}/role === 'admin'`. Sub-path rules for public (anonymous read), admin (RBAC-gated), orders, etc.

## Key Patterns

- **No framework on public pages.** Vanilla JS, IIFE pattern, Firebase compat SDK.
- **Dynamic tenant resolution.** `storefront-tenant.js` resolves tenant from hostname → platform RTDB. `tenant-brand.js` injects brand content. No hardcoded tenant references.
- **SessionStorage for redirect persistence.** Cart and order data stored in sessionStorage before Square redirect, retrieved on return.
- **Server-side is authoritative.** Client calculates shipping/tax for display; server recalculates from source data before creating payment.
- **Graceful degradation.** Google Places, test mode banner, and shipping config all have fallback defaults if Firebase reads fail.
- **Firebase listeners with safety bounds.** All `.on('value')` listeners use `limitToLast(N)` to prevent unbounded billing.
- **Multi-tenant data isolation.** All tenant data under `{tenantId}/` prefix. MastDB enforces prefix on all reads/writes.
- **Toast consistency.** Both public and admin apps use the same bottom-center stacking toast pattern with slide-up entrance, auto-fade, and error shake variant.

## Website Import Architecture

Job-based polling model for importing products, images, and content from a tenant's existing website during onboarding.

### Flow

1. **Analyze** — Tenant enters URL in admin. `analyzeExistingSite` Cloud Function fetches the page, calls Claude API to extract branding (business name, colors, style, hero content, contact info, social links), and builds a **crawl manifest** (platform type, content types found, pagination style, image hosting).
2. **Create Job** — Admin UI creates an import job at `{tenantId}/webPresence/importJobs/{jobId}` with status `pending` and the crawl manifest.
3. **Crawl** — Scheduled task `site-import-processor` (every 30 min) picks up pending jobs, crawls the site using WebFetch guided by the manifest, discovers products/blogs/events. Updates job to `crawled` with discovered item list.
4. **Cherry-pick** — Admin UI shows discovered items as a checklist. Tenant can toggle individual products on/off. Excluded URLs saved to `cherryPickExclude` on the job.
5. **Extract** — Scheduled task picks up crawled/importing jobs, fetches each product page, extracts descriptions/images, creates products via MCP (`mast_products`), uploads images to Firebase Storage, writes image hashes for dedup. Updates job to `complete`.
6. **Review** — Admin UI shows all imported products as drafts with Publish/Delete actions.

### Job Status State Machine

`pending` → `processing` → `crawled` → `importing` → `complete`
Any state → `failed` (on error or 2h timeout auto-fail)

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Website module | `app/modules/website.js` | Admin UI: 4 tabs (Overview, Style, Sections, Import) |
| Import MCP tool | `mast-mcp-server/src/tools/mast-import.ts` | Job CRUD: create, claim, update, complete, fail. Auto-fails stale jobs. |
| Scheduled task | `~/.claude/scheduled-tasks/site-import-processor/SKILL.md` | Crawl + extract automation (Claude Code scheduled task) |
| analyzeExistingSite | `mast-architecture/functions/tenant-functions.js` | Claude API analysis + crawl manifest generation |
| notifyImportComplete | `mast-architecture/functions/tenant-functions.js` | Email notification on import completion |

### Production Hardening

- **robots.txt** — Checked before crawling; disallowed paths skipped
- **User-Agent** — Identifies as `MastBot/1.0 (+https://runmast.com/bot)`
- **Rate limiting** — 1 second between fetches, max 50 pages per crawl, max 100 products / 200 images per import
- **Image deduplication** — MD5 hash check against `webPresence/imageHashes/` before upload
- **JS-rendered detection** — Flags sites with minimal HTML + heavy scripts; warns admin
- **Timeout auto-fail** — Jobs stuck in processing/importing > 2 hours are auto-failed by MCP `list_jobs`
- **All imported content starts as draft** — Never published automatically
