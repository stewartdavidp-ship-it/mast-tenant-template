# ARCHITECTURE.md — Shir Glassworks

## Mast Platform Context

Shir Glassworks exists within the **Mast three-app architecture**:

1. **Mast** (the platform) — The SaaS product customers subscribe to. The "hosting app" shown to potential customers. When a customer subscribes, a tenant is spun up for them. Think: Shopify (the platform), not a Shopify store.
2. **Tenants** (e.g., Shir Glassworks) — Each tenant is a self-contained business app (storefront, admin, POS, inventory, orders). Shir Glassworks is tenant #1 (Madeline and Ori's instance). The architecture supports tenant 2, 3... 200, 201.
3. **Mast Events** — Separate application for show/event organizers (organizers, attendees, vendors). Integrates back to Mast tenants — a Mast tenant (e.g., Shir Glassworks) can also be a vendor at a show managed by Mast Events.

**Key relationship:** Mast Events vendors ARE Mast tenants. A glass artist who subscribes to Mast for their storefront is also a vendor who does craft fairs managed through Mast Events.

**Current state (Mar 2026):** Shir Glassworks (tenant #1) is close to complete. The Mast MCP server was built specifically to onboard customer #2 — `mast_tenants`, `mast_hosting`, `mast_config`, `mast_users` are the tenant provisioning tools. The MastDB abstraction layer in the admin app needs generalization so it works for ANY tenant, not just Shir Glassworks.

## Overview

Shir Glassworks is a multi-tenant storefront deployed to Firebase Hosting with a Firebase Realtime Database backend. The public site (product catalog, gallery, checkout) uses vanilla JS with no framework. The admin app (`/app/index.html`) is a single-file React 18 app with multi-tenant auth and RBAC.

**Repo:** `stewartdavidp-ship-it/shirglassworks`
**Firebase project:** `shir-glassworks`
**Hosting:** `https://shir-glassworks.web.app` (Firebase Hosting, deployed via `mast_hosting` MCP tool)
**GitHub Pages:** `stewartdavidp-ship-it.github.io/shirglassworks` (legacy, still active)
**RTDB:** `https://shir-glassworks-default-rtdb.firebaseio.com`
**Storage:** `gs://shir-glassworks.firebasestorage.app` (product images at `shirglassworks/images/{pid}/main.jpg`)
**Cloud Functions:** `shirglassworks-functions/functions/` (Shir-specific) + `gameshelf-functions/functions/index.js` (shared)

## Deployment

### Firebase Hosting (Primary)

Deployed programmatically via the `mast_hosting` MCP tool on the Mast MCP server (`mast-platform-prod` GCP project). The tool downloads the repo tarball from GitHub, gzips files, and uploads via the Firebase Hosting REST API.

- **Site ID:** `shir-glassworks`
- **URL:** `https://shir-glassworks.web.app`
- **Rewrite rule:** `/app/**` → `/app/index.html` (SPA routing for admin app)
- **Deploy command:** `mast_hosting(action: "deploy", tenantId: "shirglassworks")`
- **Hosting config:** `mast-platform/tenants/shirglassworks/hosting` in `mast-platform-prod` RTDB

### GitHub Pages (Legacy)

Still active at `stewartdavidp-ship-it.github.io/shirglassworks`. Serves directly from the repo's `main` branch.

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
| `checkout.js` | Checkout logic (IIFE `ShirCheckout`, ~1140 lines) |
| `checkout.css` | Checkout-specific styles |

### Shared JS Modules

| File | Purpose |
|------|---------|
| `cart.js` | Cart drawer, toast notifications, auth (Sign In/Out via Google), shared across all public pages |
| `cart.css` | Cart drawer and toast styles |
| `storefront-tenant.js` | Tenant resolution from domain. Sets global `TENANT_ID`. Loaded before other JS on all pages |
| `feedback-widget.js` | Floating feedback button. Reads `feedbackSettings/publicEnabled`, submits to `{TENANT_ID}/feedbackReports` |
| `share-widget.js` | Floating share button. Uses `navigator.share()` on mobile, copy-link fallback on desktop |

### Firebase SDK

Uses Firebase compat SDK (v9.22.0) loaded via CDN. All public reads are anonymous — no auth required. Pattern:
```js
firebase.database().ref('shirglassworks/public/...').once('value', snap => { ... });
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

Multi-step checkout implemented in `checkout.js` as an IIFE (`ShirCheckout`).

### Steps

1. **Address** — Customer enters shipping address. Google Places Autocomplete provides type-ahead on the street address field. Soft validation: first attempt warns if not Places-validated, second attempt allows through.

2. **Shipping** — Flat-rate calculation based on product `shippingCategory`. Fetches shipping config from `shirglassworks/public/config/shippingRates` and product shipping data (`weightOz`, `shippingCategory`) for each cart item. Single calculated shipping line displayed (no options to choose from).

3. **Review** — Shows line items, address, shipping, estimated tax, total. Edit links return to prior steps.

4. **Payment** — Calls `submitOrder` cloud function which creates a Square Payment Link. Customer is redirected to Square's hosted checkout. On completion, Square redirects back to the confirmation page.

5. **Confirmation** — Reads `pendingOrder` from sessionStorage (survives the Square redirect). Firebase listener watches `shirglassworks/orders/{orderId}/status` for transition from `pending_payment` to `placed` (triggered by Square webhook → `squareWebhook` cloud function). On detection, auto-generates and downloads Pirate Ship CSV.

### Shipping Calculation

**Algorithm** (identical on client and server):
- Subtotal ≥ `freeThreshold` → free shipping
- Otherwise: `max(category rate across items) + (additionalItems × surcharge)`
- Categories: `small` ($6), `medium` ($10), `large` ($15), `oversized` ($22)
- Default config hardcoded as fallback if Firebase config missing

**Config path:** `shirglassworks/public/config/shippingRates`
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

- API key stored at `shirglassworks/public/config/googleMapsApiKey`
- Script loaded lazily at checkout start (not on page load)
- Graceful fallback: if no key or script fails, checkout works without autocomplete
- Restricted to US addresses: `{ types: ['address'], componentRestrictions: { country: 'us' } }`
- `.pac-container` styled to match Shir aesthetic (gold accents, cream background)

### Pirate Ship CSV

Generated client-side from sessionStorage data after payment confirmation.

**Columns:** Name, Company, Address1, Address2, City, State, Zip, Country, Phone, Weight_oz, Length, Width, Height, Description, Order_ID

- Weight = Σ(item.weightOz × qty) + (packingBufferOz × totalItems)
- Box dimensions from highest shippingCategory item's config defaults
- Auto-downloads when Firebase listener detects `placed` status
- Manual "Download Shipping CSV" button as fallback
- Listener auto-detaches after 60s safety timeout

### Test Mode

- Config at `shirglassworks/public/config/testMode` (boolean)
- Set automatically when Square environment = sandbox in admin Settings
- Shows orange banner: "TEST MODE — No real charges will be made"
- Square's own sandbox page shows test card numbers

## Cloud Functions

### Shir-Specific (`shirglassworks-functions/`)

Located in a dedicated Firebase Functions project for Shir Glassworks.

### `submitOrder`

HTTP callable function. Receives order data from checkout, creates Square Payment Link.

1. Validates order items against product catalog in Firebase
2. Calculates subtotal from authoritative product prices (ignores client-sent prices)
3. **Calculates shipping server-side** (authoritative — same algorithm as client)
4. Estimates tax based on state
5. Creates Square Payment Link via API with line items
6. Writes order to `shirglassworks/orders/{orderId}` with status `pending_payment`
7. Returns `{ success, orderId, orderNumber, checkoutUrl }`

### `squareWebhook`

HTTP endpoint receiving Square webhook notifications.

1. Verifies Square webhook signature
2. On `payment.completed`: updates order status to `placed`, writes payment details
3. Triggers downstream: Firebase listener on confirmation page detects status change → CSV download

## Product Data Model

Path: `shirglassworks/public/products/{pid}`

Key shipping-related fields:
- `weightOz: number` — actual product weight in ounces (default: 16 if unset)
- `shippingCategory: "small" | "medium" | "large" | "oversized"` — drives rate and box dimensions (default: "small" if unset)

These fields are editable in the admin app's product edit form (Production tab).

## Admin App

Single-file React app at `/app/index.html` (~26K+ lines). Uses React 18 via CDN (no JSX — `React.createElement` / htm tagged templates), Tailwind CSS via CDN, Firebase compat SDK.

### Authentication & Tenant Resolution

1. **Google Sign-In** — `firebase.auth().signInWithPopup(GoogleAuthProvider)` via `shir-glassworks` Firebase Auth
2. **Tenant Resolution** — `resolveTenant(uid)` reads `mast-platform/userTenantMap/{uid}` from the `shir-glassworks` RTDB. Returns tenant ID (e.g., `"shirglassworks"`) or `null`
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

Inputs for all shipping rate/dimension values, save/load to `shirglassworks/public/config/shippingRates`.

### Settings Tab — Google Maps API Key

Text input, saves to `shirglassworks/public/config/googleMapsApiKey`.

### Settings Tab — Square Config

Environment toggle (sandbox/production), Application ID, Location ID per environment. Saves to `shirglassworks/admin/config/squareEnv`. When sandbox selected, also writes `testMode: true` to public config.

## Firebase RTDB — Shir Glassworks

Database: `shir-glassworks-default-rtdb`

### Tenant Data (under `shirglassworks/`)

| Path | Access | Purpose |
|------|--------|---------|
| `shirglassworks/public/products/` | Anonymous read | Product catalog |
| `shirglassworks/public/gallery/` | Anonymous read | Gallery images |
| `shirglassworks/public/config/shippingRates` | Anonymous read | Shipping calculation config |
| `shirglassworks/public/config/googleMapsApiKey` | Anonymous read | Places API key |
| `shirglassworks/public/config/testMode` | Anonymous read | Sandbox mode flag |
| `shirglassworks/admin/config/squareEnv` | Admin only | Square credentials |
| `shirglassworks/admin/inventory/` | Staff+ | Inventory records |
| `shirglassworks/admin/users/` | Admin only | RBAC user records (role per UID) |
| `shirglassworks/admin/roles/` | Staff+ | Role definitions |
| `shirglassworks/admin/auditLog/` | Staff+ | Audit trail entries |
| `shirglassworks/admin/feedbackSettings/` | Admin only | Feedback widget config |
| `shirglassworks/admin/wholesaleAuthorized/` | Admin only | Approved wholesale buyer lookup (keyed by email) |
| `shirglassworks/admin/wholesaleRequests/` | Authenticated write | Wholesale access requests from buyers |
| `shirglassworks/orders/` | Mixed | Order records (write: cloud function + admin, read: status field public for confirmation listener) |
| `shirglassworks/feedbackReports/` | Public write | Customer feedback submissions |

### Platform Registry (under `mast-platform/`)

Replicated from `mast-platform-prod` RTDB for client-side auth. Rules allow users to read their own `userTenantMap/$uid` entry.

| Path | Access | Purpose |
|------|--------|---------|
| `mast-platform/userTenantMap/{uid}` | Own UID read/write | Tenant membership per user |
| `mast-platform/platformAdmins/{uid}` | Own UID read | Platform admin flag |
| `mast-platform/tenants/` | Authenticated read | Tenant registry (config, subscription, status) |
| `mast-platform/tenantsByDomain/` | Authenticated read | Domain → tenant ID lookup |

### RTDB Security Rules

Rules deployed from `shirglassworks-functions/database.rules.json` via Firebase CLI.

Key sections:
- `users/$uid` — user data (own UID only)
- `command-center/$uid` — CC data (own UID read, writes via MCP server)
- `mast-platform/` — platform registry (per-uid reads for tenant resolution)
- `$tenantId/` — wildcard for tenant data. Write gate: `admin/users/{uid}/role === 'admin'`. Sub-path rules for public (anonymous read), admin (RBAC-gated), orders, etc.

## Mast MCP Server

Platform management server deployed on `mast-platform-prod` GCP project. Provides programmatic tools for tenant operations.

**Prod:** `https://mast-mcp-server-4oaag6iarq-uc.a.run.app`
**Test:** `https://mast-mcp-server-test-4oaag6iarq-uc.a.run.app`

### `mast_hosting` Tool

Deploys tenant sites to Firebase Hosting. Actions: `deploy`, `status`, `list_versions`.

Deploy flow:
1. Reads hosting config from `mast-platform/tenants/{tenantId}/hosting` (siteId, repo, branch, excludePatterns)
2. Downloads repo tarball from GitHub API
3. Extracts via `tar-stream`, gzips each file, computes SHA256 of gzipped content
4. Creates Firebase Hosting version with rewrite rules
5. `populateFiles` with hash manifest — Firebase returns only hashes needing upload (unchanged files cached)
6. Uploads new files, finalizes version, creates release

## Key Patterns

- **No framework on public pages.** Vanilla JS, IIFE pattern, Firebase compat SDK.
- **SessionStorage for redirect persistence.** Cart and order data stored in sessionStorage before Square redirect, retrieved on return.
- **Server-side is authoritative.** Client calculates shipping/tax for display; server recalculates from source data before creating payment.
- **Graceful degradation.** Google Places, test mode banner, and shipping config all have fallback defaults if Firebase reads fail.
- **Firebase listeners with safety bounds.** All `.on('value')` listeners use `limitToLast(N)` to prevent unbounded billing.
- **Multi-tenant data isolation.** All tenant data under `{tenantId}/` prefix. MastDB enforces prefix on all reads/writes.
- **Platform registry replication.** `mast-platform/userTenantMap` is replicated from `mast-platform-prod` RTDB to `shir-glassworks` RTDB so the admin app can resolve tenants client-side without cross-project database reads.
- **Toast consistency.** Both public and admin apps use the same bottom-center stacking toast pattern with slide-up entrance, auto-fade, and error shake variant.
