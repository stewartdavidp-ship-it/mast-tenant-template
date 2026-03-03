# Shir Glassworks — End-to-End Product Lifecycle

**Last Updated:** 2026-03-03
**Purpose:** Living reference document covering the full product lifecycle, production system, and what's next.

---

## Lifecycle Overview

```
CATALOG → BROWSE → DETAIL → CART → CHECKOUT → PAYMENT → ORDER → CONFIRM → [BUILD] → PACK → SHIP → DELIVER
                                                                             ↕
                                                          PRODUCTION SYSTEM (Jobs → Builds → Stories)
```

**Dual-channel model:** Orders enter from two sources — the custom website (direct) and Etsy. Both feed into a single unified admin pipeline.

**Production system:** Independent production tracking for all glasswork — order fulfillment, inventory building, custom pieces, and experimental work. Includes photo capture, story curation, and customer-facing "How It Was Made" narratives.

---

## Stage 1: Product Catalog (BUILT)

**What exists:**
- 31 products across 6 categories (Figurines, Jewelry, Drinkware, Vases, Decoration, Sculpture)
- Product data at `shirglassworks/public/products/{pid}` with name, price, images, options (color, opacity, size), description
- Admin Products tab for managing catalog: add/edit/delete products, option management, image uploads, variant inventory management
- Filter pills on public shop page for category browsing
- Product images migrated to local repo (no longer dependent on Weebly)

**Key decision:** Product-centric data model replaced the original image-centric gallery model for shop items.

---

## Stage 2: Browse & Product Detail (BUILT)

**What exists:**
- Public shop page (`shop.html`) with product grid, category filters, responsive cards
- Product detail pages with option selectors (color, opacity, size dropdowns)
- Image gallery per product on detail pages
- Price display, Add to Cart button

---

## Stage 3: Cart (BUILT)

**What exists:**
- Firebase cart per authenticated user at `shirglassworks/users/{uid}/cart`
- Cart drawer/page showing line items with selected options
- Quantity controls, remove item
- Cart persists across sessions (Firebase-backed)

---

## Stage 4: Checkout (BUILT)

**What exists:**
- Multi-step checkout flow: Shipping Address → Review → Payment
- Shipping options: Standard ($8.99), Express ($14.99), Local Pickup (free)
- Tax calculation by US state (MA 6.25%, CA 7.25%, etc.)
- Coupon code application (percentage, fixed, free-shipping types)
- Order summary with subtotal, tax, shipping, coupon discount, total
- Coupon system at `shirglassworks/admin/coupons/{code}` with admin CRUD, validation, max uses, expiry

---

## Stage 5: Payment — Square Integration (BUILT)

**What exists:**
- Square Hosted Checkout via Payment Links API
- `shirSubmitOrder` Cloud Function creates order as `pending_payment`, generates Square Payment Link, returns checkout URL
- Customer redirected to Square's hosted checkout page for payment
- `shirSquareWebhook` receives `payment.completed` event, transitions order to `placed`
- Coupon claiming deferred until payment confirmed (prevents coupon consumption on abandoned checkouts)
- Square config managed in admin Settings UI (environment, access token, location ID, webhook signature key)
- Config stored in Firebase RTDB at `shirglassworks/config/square` (read by Cloud Functions at runtime)
- Supports sandbox and production environments

**Order statuses added for payment:**
- `pending_payment` — order created, awaiting Square checkout completion
- `payment_failed` — Square API error during checkout creation

---

## Stage 6: Order Placed → Confirmed (BUILT)

**What exists:**
- Order written with status `placed`, full customer data, items, pricing
- Admin Orders tab with list view, filter pills (by status), source filter (All/Direct/Etsy), search
- Order detail view with complete information including payment info and source badges
- "Confirm Order" action checks inventory:
  - In-stock items: reserved immediately (available--, reserved++)
  - Made-to-order items: build jobs auto-created
  - All in-stock → status goes to `ready` (skip building)
  - Any made-to-order → status goes to `building`

---

## Stage 7: Build Jobs (BUILT)

**What exists:**
- Build jobs at `shirglassworks/admin/buildJobs/{jobId}`
- Auto-created on order confirmation for made-to-order/out-of-stock items
- Lifecycle: pending → in-progress → completed (or cancelled)
- Each job tracks order reference, product, options, quantity
- Admin view within order detail: status badges, Start/Complete/Cancel actions
- When ALL build jobs for an order complete → order auto-transitions to `ready`
- Cancelling an order cancels all open build jobs

---

## Stage 8: Pack → Ship → Deliver (BUILT)

**What exists:**
- Ready → Packing: "Start Packing" button
- Packing → Shipped: Shipping modal with carrier selection (USPS, UPS, FedEx, Other) + tracking number
- Tracking URL auto-generated from carrier + number
- Shipped → Delivered: "Mark Delivered" button
- Tracking info in order detail with clickable "Track Package" link
- Full status timeline showing all transitions with timestamps
- For Etsy orders: tracking automatically pushed to Etsy via `createReceiptShipment` API

---

## Stage 9: Cancellation (BUILT)

**What exists:**
- Cancel from any non-terminal state
- Cancel modal with optional reason
- Inventory release on cancel: reserved--, available++
- Open build jobs cancelled on order cancel
- Cancel reason and timestamp recorded in status history
- No cancellation email for `pending_payment` or `payment_failed` orders (customer never completed payment)

---

## Inventory Management — Phase 1: Product-Level Quantity (BUILT)

**What exists:**
- Inventory at `shirglassworks/admin/inventory/{pid}`
- Stock types: in-stock, made-to-order (default), limited
- Available/reserved quantity tracking at product level (`stock._default.available`, `stock._default.reserved`)
- Fulfillment operations: reserve (on order confirm), pull (on ship), release (on cancel)
- Admin Products tab shows stock badges (IN STOCK / MADE TO ORDER)
- Low stock threshold configuration with lead time and notes
- Inventory is soft/flexible — not strict count-based. Discrepancies handled at confirmation.

**Key decision:** Inventory is a separate data object from the product (`admin/inventory/{pid}` vs `public/products/{pid}`). Products are public-facing catalog data; inventory is admin-only operational data.

---

## Inventory Management — Phase 2: Attribute-Based Variant Inventory (BUILT)

**The attribute model:**
- An **attribute** is a product dimension that defines inventory pools — color, size, thickness, opacity, etc.
- Attributes map to the existing product `options[]` array (e.g., `{label: "Size", choices: ["Short", "Tall"]}`)
- If a variant doesn't change the price, it lives under the same product (e.g., Short and Tall glasses at same price = one product with a Size attribute)
- If a variant has a different price, it's a separate product card (different pid entirely)
- Multiple attributes per product are supported — a product with Size (Short/Tall) and Color (Blue/Yellow/Clear) produces 6 inventory pools

**How it works:**
- All attribute combinations are auto-generated as the **cartesian product** of a product's `options[].choices`
- Each combination becomes a **variant** with its own stock count, keyed by a pipe-delimited combo key (e.g., `"Short|Blue"`)
- Stock stored at `admin/inventory/{pid}/stock/{comboKey}` with `available` and `reserved` per variant
- `stock._default` is maintained as the aggregate total across all variants (backward compatible with Phase 1 fulfillment functions)

**Product Detail — Read-Only Inventory Dashboard:**
- Click any product card to open full detail with back navigation
- **Inventory on Hand** section shows total available as a big number, plus reserved count
- For products with attributes: tags show each attribute value with its count (e.g., `Blue (3)`, `Red (0)`)
  - Tags with stock are highlighted in teal; zero-stock tags are greyed out
  - Attribute values grouped by label (Color, Size, etc.)
- For products without attributes: shows single total count
- **"Adjust Stock" button** opens a modal for manual corrections (the exception case, not the normal flow)
  - Modal shows variant table with +/- inputs per combination, or single quantity input for non-variant products
  - Total row auto-calculated from variant inputs
  - Saves to Firebase, updates local state, re-renders detail
- **Stock Settings** section (separate from inventory counts): stock type, threshold, lead time, notes
- **Key design principle:** Inventory is behind-the-scenes operational data. The product detail page is for *viewing* stock, not inputting it. Stock flows in from production builds and out from orders. Manual adjustment is the exception.

**Product Card Badges:**
- All product cards show stock type badge + on-hand count (e.g., "In Stock · 5 on hand")
- Badge colors: green (in stock), orange (low stock), red (out of stock), purple (made to order)
- Zero-count products suppress the quantity display

**Inventory Overview (Production → Inventory sub-view):**
- All-products-at-a-glance table in the Production tab alongside Queue and Jobs
- Summary stat cards: total products, total on hand, reserved, out of stock, low stock, made to order
- Table columns: thumbnail, product name/price, stock type badge, on hand, reserved, attribute breakdown tags
- Smart sort: out of stock first (urgent), low stock next, then by quantity descending, made-to-order last
- Click any row to navigate to that product's detail page
- Dark mode fully supported
- Foundation for future forecasting module (purchase history vs on-hand → production recommendations)

**Example:** Spiral Cup has options Size (Short, Tall, Wide) and Color (Blue, Yellow). Product detail shows:

| Size | Color | Available |
|------|-------|-----------|
| Short | Blue | 3 |
| Short | Yellow | 2 |
| Tall | Blue | 5 |
| Tall | Yellow | 0 |
| Wide | Blue | 1 |
| Wide | Yellow | 4 |
| **Total** | | **15** |

---

## Customer Notifications — Gmail (BUILT)

**What exists:**
- `shirOrderEmailNotification` DB trigger fires on order status changes
- Email types: confirmed, shipped (with tracking link), delivered, cancelled
- Gmail sent via Nodemailer with app password
- Only fires for direct orders (`source !== 'etsy'`)
- Etsy orders skip Gmail entirely — Etsy handles all buyer communications
- No email on `pending_payment → placed` (internal payment transition)
- No email on cancel from `pending_payment` or `payment_failed`
- `shirTestOrderEmail` callable for admin testing of any email type

---

## Etsy Integration (BUILT)

**What exists:**
- **OAuth 2.0 + PKCE:** `shirEtsyOAuthStart` (callable) + `shirEtsyOAuthCallback` (HTTP) Cloud Functions
- **Inbound sync:** `shirEtsyOrderSync` callable pulls Etsy receipts, maps to order schema, deduplicates via `etsyReceiptId`
- **Outbound tracking:** On ship, `shirOrderEmailNotification` pushes tracking to Etsy via `createReceiptShipment` API
- **Admin Settings:** Connect/disconnect Etsy shop, connection status, last sync timestamp
- **Admin Orders:** "Sync Etsy" button, source filter (All/Direct/Etsy), orange "ETSY" source badges
- **Order detail:** Etsy info section (receipt ID linked to Etsy, buyer username, tracking push status)
- **Shipping modal:** Note for Etsy orders about automatic tracking push

**Etsy order flow:**
1. Admin clicks "Sync Etsy" → `shirEtsyOrderSync` pulls paid receipts from Etsy API
2. New receipts mapped to order schema with `source: 'etsy'`, `status: 'placed'`
3. From `placed` onward, workflow is identical to direct orders
4. On ship: tracking pushed to Etsy automatically (no Gmail sent)

**Config:** Tokens stored at `shirglassworks/config/etsy` in Firebase RTDB. Auto-refresh on token expiry.

---

## Production System — Phase 1: Jobs & Builds (BUILT)

**What exists:**
- Production jobs at `shirglassworks/admin/jobs/{jobId}` — independent from order build jobs
- 6 job purposes: `fulfillment`, `custom`, `inventory-general`, `wholesale`, `experimental`, `inventory-event`
- Work types: `flamework`, `fusing`, `coldwork`, `mixed`
- Priority levels: `urgent`, `high`, `normal`, `low`
- Job lifecycle: `draft` → `active` → `completed` (or `cancelled`)
- Multi-build tracking: each job has multiple builds (production sessions) at `jobs/{jobId}/builds/{buildId}`
- Build lifecycle: `in-progress` → `completed`, with start/end timestamps, duration, operators
- Line items with `targetQuantity` and per-build tally tracking (`completedQuantity`, `lossQuantity`)
- Aggregate tallies computed across all builds per line item
- Production requests at `shirglassworks/admin/productionRequests/{requestId}` — messages from Orders system
- Production requests link orders to jobs via `orderId`, `orderItemKey`, `jobId`
- Admin Production section with jobs list (filter by status/purpose), job detail, build management
- "Start Build" / "Complete Build" modals with operator selection and per-item quantity entry

**Key decision:** Production jobs are separate from order build jobs. Order confirmation creates production requests, not jobs directly. Jobs can exist independently for inventory or experimental work.

---

## Production System — Phase 2: Photo Capture & Story Curation (BUILT)

**What exists:**
- Photo capture during builds: operators take photos, images compressed to 1600px max, uploaded to Firebase Storage
- Build photos stored at `jobs/{jobId}/builds/{buildId}/photos/{photoId}` with `url`, `caption`, `timestamp`
- Story curation UI: select photos from builds, add captions, create milestone text entries
- Stories at `shirglassworks/public/stories/{storyId}` with `jobId`, `status` (draft/published), entries array
- Story entries: `type` (milestone/photo), `content`/`url`, `caption`, `order` for sequencing
- Publish/unpublish stories with status tracking
- Story status visible in job detail view
- Operators tracked per build (name list) — copied to published story record for credit

---

## Production System — Phase 3: Customer Stories & Pipeline Automation (BUILT)

**What exists:**

**Customer-facing "How It Was Made":**
- Product pages (`product.html`) display stories when product has a `storyId`
- `loadProductStory()` reads from `shirglassworks/public/stories/{storyId}`
- Renders milestone text, photos with lazy-loaded images, captions, operator credit
- Dark mode support, responsive layout
- storyId synced across 3 code paths: `publishStory()`, `unpublishStory()`, `linkProductToBuild()`

**Fulfillment auto-advance:**
- When completing a build on `fulfillment` or `custom` jobs, linked production requests auto-fulfill
- Calls existing `fulfillProductionRequest(requestId, orderId, operatorName)`
- `requestFulfilled` guard flag on line item prevents double-push

**Inventory auto-push:**
- When completing a build on `inventory-general` jobs, stock auto-increments
- Firebase transaction for atomic `available` stock increment
- `inventoryPushed` guard flag on build prevents double-push

**Completion feedback:**
- `showCompletionSummary()` displays pipeline results after build completion
- Shows target-met items, fulfillment actions, inventory pushes
- Single item = toast, multiple = modal

**Pipeline indicators in job detail:**
- Fulfillment/custom jobs: order status badge per line item
- Inventory-general: push state per completed build
- Other purposes: "Manual handling required" note

---

## Order Status Lifecycle

```
pending_payment → placed → confirmed → [building] → ready → packing → shipped → delivered
       |
       +→ cancelled (abandoned/admin cancel)

payment_failed → cancelled
```

| Status | Meaning | Trigger |
|--------|---------|---------|
| `pending_payment` | Awaiting Square checkout (direct orders only) | `shirSubmitOrder` function |
| `payment_failed` | Square API error | `shirSubmitOrder` on Square failure |
| `placed` | Payment confirmed (direct) or imported (Etsy) | Square webhook or Etsy sync |
| `confirmed` | Admin reviewed, inventory checked | Admin clicks "Confirm" |
| `building` | Item(s) need to be made | Auto when confirm finds made-to-order items |
| `ready` | All items available | Auto when last build job completes, or immediate if all in stock |
| `packing` | Being packed | Admin clicks "Start Packing" |
| `shipped` | Handed to carrier | Admin enters tracking + clicks "Mark Shipped" |
| `delivered` | Delivery confirmed | Admin clicks "Mark Delivered" |
| `cancelled` | Cancelled | Admin from any non-terminal state |

---

## Active Constraints

1. **GitHub Pages hosting** — static files only, no server-side code. All dynamic behavior via client-side JS + Firebase.
2. **Etsy shop coexistence** — existing ShirGlassworks Etsy shop as a parallel sales channel, integrated via API.
3. **Product images migrated** — images now stored locally in the repo (migrated from Weebly).

---

## Active Rules

1. **No unbounded Firebase listeners** — all reads must use `limitToLast(N)` or `.once('value')` to prevent billing spikes.
2. **Admin writes go through auth check** — Firebase rules enforce `auth.uid` check for admin operations. Public pages have anonymous read access.

---

## Deployment Map

| Component | Location | Status |
|-----------|----------|--------|
| Public site (landing, about, shop, schedule) | GitHub Pages: `shirglassworks` repo | Live |
| Admin app | GitHub Pages: `shirglassworks/app/` | Live |
| Product data | Firebase RTDB: `shirglassworks/public/products/` | Live |
| Order data | Firebase RTDB: `shirglassworks/orders/` | Live |
| Inventory data | Firebase RTDB: `shirglassworks/admin/inventory/` | Live |
| Build jobs | Firebase RTDB: `shirglassworks/admin/buildJobs/` | Live |
| Coupons | Firebase RTDB: `shirglassworks/admin/coupons/` | Live |
| Order counter | Firebase RTDB: `shirglassworks/admin/orderCounter` | Live |
| Square config | Firebase RTDB: `shirglassworks/config/square` | Live |
| Etsy config + tokens | Firebase RTDB: `shirglassworks/config/etsy` | Live |
| `shirSubmitOrder` | Firebase Functions (Node.js 20, 1st Gen) | Deployed |
| `shirSquareWebhook` | Firebase Functions (HTTP) | Deployed |
| `shirOrderEmailNotification` | Firebase Functions (DB trigger) | Deployed |
| `shirTestOrderEmail` | Firebase Functions (callable) | Deployed |
| `shirEtsyOAuthStart` | Firebase Functions (callable) | Deployed |
| `shirEtsyOAuthCallback` | Firebase Functions (HTTP) | Deployed |
| `shirEtsyOrderSync` | Firebase Functions (callable) | Deployed |
| `shirValidateCoupon` | Firebase Functions (callable) | Deployed |
| Production jobs | Firebase RTDB: `shirglassworks/admin/jobs/` | Live |
| Production requests | Firebase RTDB: `shirglassworks/admin/productionRequests/` | Live |
| Stories (public) | Firebase RTDB: `shirglassworks/public/stories/` | Live |
| Build photos | Firebase Storage | Live |
| Firebase rules | `database.rules.json` | Deployed |

---

## Decisions Log (Built)

| Decision | Scope | Status |
|----------|-------|--------|
| Site architecture: single-page HTML per section + admin app | Architecture | Built |
| Admin app sections: hero, about, gallery, shop (6 categories), schedule | Admin | Built |
| Analytics via Firebase RTDB append-only writes | Analytics | Built |
| 6 flat shop categories (31 products) | Catalog | Built |
| Product-centric data model (pid, name, price, options, images) | Data Model | Built |
| Full custom checkout (cart, multi-step flow, Square Hosted Checkout) | Checkout | Built |
| Square payment integration (Payment Links API, webhook, config in Settings) | Payments | Built |
| Order fulfillment lifecycle (10 statuses, sequential order numbers) | Orders | Built |
| Inventory tracking (stock types, reserve/release/pull, soft model) | Inventory | Built |
| Build jobs (auto-create on confirm, auto-ready on complete) | Fulfillment | Built |
| Coupon system (percentage, fixed, free-shipping) | Checkout | Built |
| Shipping tracking (USPS, UPS, FedEx, auto URLs) | Shipping | Built |
| Gmail notifications for direct orders (confirmed, shipped, delivered, cancelled) | Notifications | Built |
| Dual-channel strategy (Etsy + direct, unified order pipeline) | Strategy | Built |
| Etsy OAuth 2.0 + PKCE via Cloud Functions | Etsy | Built |
| Etsy bidirectional sync (inbound orders, outbound tracking) | Etsy | Built |
| Etsy orders enter as prepaid at `placed` status | Etsy | Built |
| Image migration from Weebly to local repo | Images | Built |
| Production job data model (6 purposes, multi-build, line items with targets) | Production | Built |
| Build data model (sequential builds, operator tracking, tallies) | Production | Built |
| Expected vs Actual tracking (per-build counts at line item level) | Production | Built |
| Build-to-inventory/order pipeline (auto-push vs manual by purpose) | Production | Built |
| Build media and storytelling (capture private, curate selectively) | Production | Built |
| Firebase RTDB structure for production system | Production | Built |
| Admin UI for Production (own top-level section in admin nav) | Production | Built |
| Production Request model (messages from Orders to Production) | Production | Built |
| Attribute-based variant inventory (auto-generated combos from product options) | Inventory | Built |
| Product detail view replaces modal-based stock editing | Inventory | Built |
| Per-variant combo keys (`_default` aggregate for backward compat) | Data Model | Built |
| CSS variables for dark mode (`--cream` flips to `#2a2a2a`) | UI | Built |
| Gallery section group headers (Site Pages vs Product Categories) | UI | Built |
| Product detail inventory is read-only dashboard (not input form) | Inventory UX | Built |
| Manual stock adjustment via separate modal (exception case, not primary flow) | Inventory UX | Built |
| Product cards always show on-hand count alongside stock type badge | Inventory UX | Built |
| Inventory overview lives in Production tab (foundation for forecasting) | Inventory | Built |

---

## Deferred / Future Work

- **Studio Companion App:** Camera-first PWA for in-studio production management — QR scanning, photo recognition, contextual actions based on job state
- **Photo Recognition:** Hybrid TensorFlow.js + Claude Vision model for identifying products from photos
- **QR Code System:** URL-based QR codes for jobs, products, and shelves with LabelKeeper printing
- **Abandoned checkout cleanup:** Scheduled function to auto-cancel `pending_payment` orders older than 48h
- **Auto Etsy sync:** Scheduled function to pull Etsy orders every 15 minutes (currently manual trigger)
- **Etsy refund/cancellation sync:** Pull cancellation events from Etsy back into Firebase
- **Payment received email:** Lightweight "we got your payment" email on `pending_payment → placed`
- **Refund integration:** Square Refunds API for order cancellations after payment
- **Customer order lookup:** Public page for customers to check order status by email + order number
- **Inventory display on public site:** Show In Stock / Made to Order badges on public product cards (admin already shows badges)
- **Variant-level fulfillment:** Extend `reserveInventory`/`releaseInventory`/`pullFromStock` to operate on specific combo keys rather than `_default` only
- **Production Forecasting:** Cross-reference order/purchase history against current on-hand inventory to surface production recommendations — what to build next, trending products, restock alerts. Builds on the Inventory Overview in the Production tab.
