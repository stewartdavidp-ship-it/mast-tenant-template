# Shir Glassworks — End-to-End Product Lifecycle

**Last Updated:** 2026-03-03 (post Phase D)
**Purpose:** Living reference document covering the full product lifecycle, production system, studio companion features, and what's next.

---

## Lifecycle Overview

```
ONLINE CHANNEL:
CATALOG → BROWSE → DETAIL → CART → CHECKOUT → PAYMENT → ORDER → CONFIRM → [BUILD] → PACK → SHIP → DELIVER
                                                                             ↕
                                                          PRODUCTION SYSTEM (Jobs → Builds → Stories)

IN-PERSON CHANNEL (PoS):
CAMERA/PICKER → ITEMS → PAYMENT (Cash/Square) → SALE → RECEIPT → [SQUARE RECONCILIATION]
                                                    ↓
                                              INVENTORY DECREMENT

PRODUCTION → INTAKE:
BUILD COMPLETE → CAMERA INTAKE (per piece) → VISION ID + CONFIRM → INVENTORY +1 → TRAINING PHOTO
                                                                                      ↓
                                                                               LOCATION ASSIGNMENT
```

**Dual-channel model:** Orders enter from three sources — the custom website (direct), Etsy, and in-person PoS sales. All feed into a single unified admin pipeline.

**Production system:** Independent production tracking for all glasswork — order fulfillment, inventory building, custom pieces, and experimental work. Includes photo capture, story curation, and customer-facing "How It Was Made" narratives.

**Studio companion features:** Camera-first inventory intake, GPS-aware mode switching, inventory location tracking with QR codes, and event-integrated packing/selling/return flows.

---

## Stage 1: Product Catalog (BUILT)

**What exists:**
- 31 products across 6 categories (Figurines, Jewelry, Drinkware, Vases, Decoration, Sculpture)
- Product data at `shirglassworks/public/products/{pid}` with name, price, images, options (color, opacity, size), description
- Admin Products tab for managing catalog: add/edit/delete products, option management, image uploads, variant inventory management
- Filter pills on public shop page for category browsing
- Product images migrated from Weebly to Firebase Storage via `shirMigrateImagesToStorage`

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

**Phase D extension:** `shirSquareWebhook` now also stores ALL completed payments to `shirglassworks/admin/square-payments/{paymentId}` for PoS reconciliation. Payments without a `squareOrderId` (i.e., PoS terminal payments) are stored for timestamp-based matching to PoS sales.

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
- Foundation for future forecasting module

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

## Inventory Management — Phase 3: Location-Tracked Inventory (BUILT — Phase D)

**What exists:**
- Inventory locations at `shirglassworks/admin/locations/{locationId}`
- Location types: `home` (permanent, auto-created, cannot archive), `event` (auto-created with sales events), `container` (portable boxes), `other`
- Each location has: `name`, `type`, `status` (active/archived), `createdAt`, optional `eventId` link
- QR code URL format: `https://shirglassworks.com/scan/location/{locationId}`
- LabelKeeper export for printing QR labels (Avery 5160 format)

**Location-tracked inventory model:**
- Extended stock structure: `inventory/{pid}/stock/{variantCombo}/locations/{locationId}: count`
- `_default.available` remains the sum total (backward compatible)
- Atomic multi-path Firebase updates for moving items between locations
- `addToLocation(pid, variant, locationId, qty)` — increments available + location count
- `decrementFromLocation(pid, variant, locationId, qty)` — decrements from specific location
- `moveInventory(pid, variant, fromLocId, toLocId, qty)` — atomic transfer

**Move Items modal:**
- Product picker, variant selector, from/to location dropdowns, quantity input
- Max quantity enforced from source location count
- Accessible from inventory overview action bar

**Admin Settings UI:**
- Inventory Locations section with status filter (all/active/archived)
- Location list with item counts, QR copy, LabelKeeper export, rename, archive/reactivate
- Create form with name input and type selector
- "Home" location auto-ensured on first load

---

## Inventory Management — Phase 4: Camera-First Intake (BUILT — Phase D)

**What exists:**
- Full-screen intake overlay (`intakeOverlay`) for piece-by-piece inventory logging
- Camera capture sends photo to `shirClassifyImage` with `intake` context
- Vision API returns: `productId`, `confidence`, `color`, `attributes` (colorFamily, form, size, texture), `visualDescription`
- Confirm/reject flow: matched product shown with confidence, manual picker as fallback
- First photo per piece = inventory increment (+1 to stock + location assignment)
- Subsequent photos = training-only (no inventory increment, stored as reference images)
- Dynamic training suggestion based on existing photo count:
  - < 5 photos: "Suggest 3 angles — this helps future recognition"
  - < 15 photos: "Additional angles help with unusual lighting/backgrounds"
  - 15+: skip training prompt unless unusual piece
- Running tally of logged items with session summary
- Accessible from: build completion summary ("Camera Intake" button) and inventory overview ("Inventory Intake" button)

**Vision API prompt tuning (Phase D):**
- `intake` context extracts structured attributes: `colorFamily`, `form`, `size`, `texture`, `distinguishing`
- `training` context focuses on maximum visual description detail for reference
- Auto-saves `visualDescription` to `shirglassworks/admin/visual-descriptions/{pid}` for improving future classifications
- Visual descriptions included in catalog text sent to Claude for better matching

---

## Image Library (BUILT — Phase A)

**What exists:**
- Image library at `shirglassworks/images/{imageId}` with Firebase Storage backing
- `shirUploadImage` Cloud Function: receives base64, compresses via sharp (1600px max), generates thumbnail, uploads to Storage, creates RTDB record
- Image records: `url`, `thumbnailUrl`, `tags`, `source`, `uploadedAt`, `sizeBytes`
- Training images at `shirglassworks/admin/training-images/{productId}/{imageId}` for Vision API learning
- `shirUploadTrainingImage` Cloud Function for storing product reference photos
- `shirBootstrapImageLibrary` seeded 119 entries from legacy Weebly URLs
- `shirMigrateImagesToStorage` batch-migrated all product images to Firebase Storage (2GB memory, 540s timeout)

---

## Point-of-Sale App (BUILT — Phase B)

**What exists:**
- Standalone mobile-first app at `shirglassworks/pos/index.html`
- Camera-first workflow: photo → `shirClassifyImage` → product match → confirm/edit → payment → save
- Manual product picker with search as fallback
- Payment type selection: cash or Square
- Amount auto-calculated from identified items, manually editable
- Sale record at `shirglassworks/admin/sales/{saleId}` with items, amount, payment type, timestamp, event link
- Inventory auto-decremented on sale
- Event-aware: accepts `?eventId=` URL parameter, shows event banner, auto-links sales, updates event allocations

**Receipt flow (Phase D):**
- Success screen shows receipt form: email input, phone input, opt-in checkbox
- `sendReceipt()` calls `shirSendReceipt` (SendGrid email) and/or `shirSendSMS` (Twilio SMS)
- Branded HTML email receipt with items, total, date, thank you message
- Plain text SMS receipt summary
- `autoReconcileSquare()` called after Square payment sales — matches to webhook-received payments
- Sale record updated with `receiptSent`, `customerContact` (email, phone, optIn)

**Admin Sales tab:**
- Sales list with date filter, status filter (all/captured/reconciled/voided)
- Daily summary stats (total sales, cash, square, average)
- Sale detail view with items, payment info, notes
- Reconcile and void actions
- Square Payments view (toggle from sales list):
  - Summary cards: total, matched, unmatched, unmatched amount
  - Filter: unmatched only, matched only, all
  - Manual match modal: shows candidate sales sorted by time proximity, amount match highlighting
  - `executeManualMatch()` atomic update: sale gets squarePaymentId + authoritative amount, payment gets matchedSaleId

---

## Sales Events System (BUILT — Phase C)

**What exists:**
- Sales events at `shirglassworks/admin/salesEvents/{eventId}` for craft fair management
- Event lifecycle: `planning` → `packed` → `active` → `closed`
- Per-event allocations: `allocations/{pid}` with `quantity` (packed), `sold`, `sourceLocationId`
- Admin Events tab with event list, status badges, create/edit modal

**Packing mode:**
- Camera-based product scanning during packing
- Manual product picker fallback
- Items confirmed against master inventory, allocated to event
- Phase D: packing moves inventory from Home location to event location
- Tracks `sourceLocationId` per allocation for return routing

**Fair mode (PoS integration):**
- PoS app accepts `?eventId=` parameter
- Green banner shows event name, packed vs sold vs remaining stats
- Sales auto-linked to event, allocations.sold auto-incremented

**Event close:**
- Freezes event data as historical snapshot
- Sell-through rates calculated per product
- Phase D: unsold items auto-returned to source locations, event location archived

**Event location lifecycle (Phase D):**
- `createEventLocation(eventId, name)` auto-called when saving a new event
- Location type `event`, linked via `eventId`
- Packing moves items: Home → Event Location
- Close moves unsold items: Event Location → Source Location (or Home)
- Event location auto-archived on close

---

## GPS-Aware Mode Switching (BUILT — Phase C)

**What exists:**
- Studio Locations configuration in Settings: latitude, longitude, detection radius (default 500m)
- `detectStudioProximity()` uses Geolocation API to check distance from studio
- Automatic mode switching based on location:
  - Within studio radius: production-focused UI
  - Outside studio: event/selling-focused UI
- Visual indicator showing current detected mode
- Graceful fallback when GPS unavailable or denied

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

## Receipt System — PoS (BUILT — Phase D)

**What exists:**
- `shirSendReceipt` Cloud Function: branded HTML email via SendGrid
  - Shir Glassworks logo, itemized list, total, date, thank you message
  - Auth: Firebase ID token required
  - Config: `sendgrid.api_key`, `shir.from_email` in Firebase Functions config
- `shirSendSMS` Cloud Function: plain text SMS via Twilio HTTP API (no SDK)
  - Format: "Shir Glassworks — {items}, ${amount}, {date}. Thank you!"
  - Config: `twilio.account_sid`, `twilio.auth_token`, `twilio.from_number`
- `shirReconcileSquarePayment` Cloud Function: timestamp-based auto-matching
  - Takes `saleId`, `saleTimestamp`, `toleranceMinutes` (default 5)
  - Finds closest unmatched Square payment within tolerance window
  - Updates both records atomically: sale gets `squarePaymentId`, payment gets `matchedSaleId`
  - Square amount is authoritative (overwrites sale amount)

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
- Build completion summary now offers "Camera Intake" button for piece-by-piece logging (Phase D)

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
3. **Product images in Firebase Storage** — migrated from Weebly, served via Storage URLs.
4. **Orders don't track variant-level combo keys** — fulfillment operates on `stock._default` only. Variant-level fulfillment requires future work.
5. **No historical inventory snapshots** — Firebase stores current state only, no time-series.
6. **Artisan-scale volume** — 2-5 units per product per month limits statistical significance for forecasting.
7. **Etsy order history partial** — only exists from when sync was first enabled.
8. **No cost/margin data** — products have selling price but no cost-of-materials or labor time fields.

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
| PoS app | GitHub Pages: `shirglassworks/pos/` | Live |
| Product data | Firebase RTDB: `shirglassworks/public/products/` | Live |
| Order data | Firebase RTDB: `shirglassworks/orders/` | Live |
| Inventory data | Firebase RTDB: `shirglassworks/admin/inventory/` | Live |
| Inventory locations | Firebase RTDB: `shirglassworks/admin/locations/` | Live |
| Sales data | Firebase RTDB: `shirglassworks/admin/sales/` | Live |
| Sales events | Firebase RTDB: `shirglassworks/admin/salesEvents/` | Live |
| Square payments | Firebase RTDB: `shirglassworks/admin/square-payments/` | Live |
| Visual descriptions | Firebase RTDB: `shirglassworks/admin/visual-descriptions/` | Live |
| Training images | Firebase RTDB: `shirglassworks/admin/training-images/` | Live |
| Build jobs (order) | Firebase RTDB: `shirglassworks/admin/buildJobs/` | Live |
| Production jobs | Firebase RTDB: `shirglassworks/admin/jobs/` | Live |
| Production requests | Firebase RTDB: `shirglassworks/admin/productionRequests/` | Live |
| Coupons | Firebase RTDB: `shirglassworks/admin/coupons/` | Live |
| Order counter | Firebase RTDB: `shirglassworks/admin/orderCounter` | Live |
| Stories (public) | Firebase RTDB: `shirglassworks/public/stories/` | Live |
| Image library | Firebase RTDB: `shirglassworks/images/` + Firebase Storage | Live |
| Square config | Firebase RTDB: `shirglassworks/config/square` | Live |
| Etsy config + tokens | Firebase RTDB: `shirglassworks/config/etsy` | Live |
| `shirSubmitOrder` | Cloud Functions (callable) | Deployed |
| `shirSquareWebhook` | Cloud Functions (HTTP) | Deployed |
| `shirOrderEmailNotification` | Cloud Functions (DB trigger) | Deployed |
| `shirTestOrderEmail` | Cloud Functions (callable) | Deployed |
| `shirValidateCoupon` | Cloud Functions (callable) | Deployed |
| `shirEtsyOAuthStart` | Cloud Functions (callable) | Deployed |
| `shirEtsyOAuthCallback` | Cloud Functions (HTTP) | Deployed |
| `shirEtsyOrderSync` | Cloud Functions (callable) | Deployed |
| `shirClassifyImage` | Cloud Functions (HTTP) | Deployed |
| `shirUploadImage` | Cloud Functions (HTTP, 512MB) | Deployed |
| `shirUploadTrainingImage` | Cloud Functions (HTTP) | Deployed |
| `shirScanCatalog` | Cloud Functions (HTTP, 300s timeout) | Deployed |
| `shirMigrateProducts` | Cloud Functions (HTTP, one-time) | Deployed |
| `shirBootstrapImageLibrary` | Cloud Functions (HTTP, one-time) | Deployed |
| `shirMigrateImagesToStorage` | Cloud Functions (HTTP, 2GB, 540s) | Deployed |
| `shirSendReceipt` | Cloud Functions (HTTP) | Deployed |
| `shirSendSMS` | Cloud Functions (HTTP) | Deployed |
| `shirReconcileSquarePayment` | Cloud Functions (HTTP) | Deployed |
| Firebase rules | `database.rules.json` | Deployed |

---

## Decisions Log (Built)

| Decision | Scope | Phase |
|----------|-------|-------|
| Site architecture: single-page HTML per section + admin app | Architecture | Original |
| Admin app sections: hero, about, gallery, shop (6 categories), schedule | Admin | Original |
| Analytics via Firebase RTDB append-only writes | Analytics | Original |
| 6 flat shop categories (31 products) | Catalog | Original |
| Product-centric data model (pid, name, price, options, images) | Data Model | Original |
| Full custom checkout (cart, multi-step flow, Square Hosted Checkout) | Checkout | Original |
| Square payment integration (Payment Links API, webhook, config in Settings) | Payments | Original |
| Order fulfillment lifecycle (10 statuses, sequential order numbers) | Orders | Original |
| Inventory tracking (stock types, reserve/release/pull, soft model) | Inventory | Original |
| Build jobs (auto-create on confirm, auto-ready on complete) | Fulfillment | Original |
| Coupon system (percentage, fixed, free-shipping) | Checkout | Original |
| Shipping tracking (USPS, UPS, FedEx, auto URLs) | Shipping | Original |
| Gmail notifications for direct orders (confirmed, shipped, delivered, cancelled) | Notifications | Original |
| Dual-channel strategy (Etsy + direct, unified order pipeline) | Strategy | Original |
| Etsy OAuth 2.0 + PKCE via Cloud Functions | Etsy | Original |
| Etsy bidirectional sync (inbound orders, outbound tracking) | Etsy | Original |
| Etsy orders enter as prepaid at `placed` status | Etsy | Original |
| Production job data model (6 purposes, multi-build, line items with targets) | Production | Original |
| Build data model (sequential builds, operator tracking, tallies) | Production | Original |
| Expected vs Actual tracking (per-build counts at line item level) | Production | Original |
| Build-to-inventory/order pipeline (auto-push vs manual by purpose) | Production | Original |
| Build media and storytelling (capture private, curate selectively) | Production | Original |
| Firebase RTDB structure for production system | Production | Original |
| Admin UI for Production (own top-level section in admin nav) | Production | Original |
| Production Request model (messages from Orders to Production) | Production | Original |
| Attribute-based variant inventory (auto-generated combos from product options) | Inventory | Original |
| Product detail view replaces modal-based stock editing | Inventory | Original |
| Per-variant combo keys (`_default` aggregate for backward compat) | Data Model | Original |
| CSS variables for dark mode (`--cream` flips to `#2a2a2a`) | UI | Original |
| Gallery section group headers (Site Pages vs Product Categories) | UI | Original |
| Product detail inventory is read-only dashboard (not input form) | Inventory UX | Original |
| Manual stock adjustment via separate modal (exception case, not primary flow) | Inventory UX | Original |
| Product cards always show on-hand count alongside stock type badge | Inventory UX | Original |
| Inventory overview lives in Production tab (foundation for forecasting) | Inventory | Original |
| Image migration from Weebly to Firebase Storage | Images | Phase A |
| Full product CRUD in admin (create, edit, delete with tabbed detail form) | Admin | Phase A |
| Shop migrated from gallery path to products path | Shop | Phase A |
| Camera-first PoS workflow (photo → Vision ID → confirm → sale) | PoS | Phase B |
| Reusable camera component for cross-app use | Architecture | Phase B |
| Sales admin tab with daily summary, filters, detail view | Admin | Phase B |
| Sales events for craft fair management (plan → pack → sell → close) | Events | Phase C |
| Packing mode with camera scanning and manual picker | Events | Phase C |
| Fair mode: PoS event linking via URL parameter | Events | Phase C |
| GPS-aware mode switching based on studio proximity | Studio | Phase C |
| Camera-first inventory intake (piece-by-piece with Vision API) | Inventory | Phase D |
| Multi-photo training during intake (first = +1 stock, rest = training) | Vision | Phase D |
| Inventory locations with QR codes and LabelKeeper export | Inventory | Phase D |
| Location-tracked inventory (nested under variant stock structure) | Data Model | Phase D |
| Event location lifecycle (auto-create, pack into, return, archive) | Events | Phase D |
| Square PoS reconciliation (timestamp-based auto-match + manual match UI) | Payments | Phase D |
| Receipt delivery via SendGrid email + Twilio SMS | Receipts | Phase D |
| Vision API attribute extraction for intake/training contexts | Vision | Phase D |
| Auto-save visual descriptions for progressive classification improvement | Vision | Phase D |

---

## E2E Simulation Findings (2026-03-03)

Full end-to-end "day in the life" walkthrough covering: Production → Inventory → Orders → Fulfillment → Product Catalog → Public Shop.

### Bugs Fixed

| Bug | Severity | Fix |
|-----|----------|-----|
| Product picker in Add Line Item modal always empty | **Critical** | `openAddLineItemModal()` referenced undefined `products` variable instead of `productsData` array. Fixed to iterate `productsData.forEach()`. Also fixed `onLineItemProductSelect()` to use `productsData.find()`. Without this fix, all freeform line items get `productId: null`, which breaks `autoUpdateInventory()` (skips items without productId). |
| Variant-blind inventory check on order confirmation | **Critical** | `transitionOrder('confirmed')` now checks variant-specific stock via `getItemComboKey()` before falling back to `_default`. |
| Variant-blind inventory reservation | **Critical** | `reserveInventory()` now accepts optional combo key and updates both variant-specific and `_default` counts atomically via multi-path update. |
| Variant-blind `pullFromStock()` | **High** | Now accepts optional combo key, decrements reserved on both variant and `_default`. |
| Variant-blind `releaseInventory()` | **High** | Now accepts optional combo key, releases on both variant and `_default`. |
| `saveAdjustStock()` uses `set()` not transaction | **Medium** | Changed from `.set()` on entire stock object to `.update()` with specific `available` paths. Reserved counts are no longer overwritten — managed atomically by reserve/release/pull. Local cache refreshed from Firebase after save. |
| Freeform line items silently break `autoUpdateInventory()` | **Medium** | Now shows warning feedback instead of silent skip. |

### Known Bugs (Not Yet Fixed)

| Bug | Severity | Description |
|-----|----------|-------------|
| `autoUpdateInventory()` only pushes to `_default` | **Medium** | Production line items don't carry variant info, so auto-push still only increments `_default.available`. Variant distribution must be done manually via stock adjust. Camera intake (Phase D) handles this better — individual pieces go to specific variants. |

### Pipeline Verification

| Pipeline | Status | Notes |
|----------|--------|-------|
| Job creation → line items → build → complete | ✅ Works | Full lifecycle tested live. |
| Build completion → inventory auto-push | ✅ Works | Auto-push works for `_default`; camera intake handles per-variant. |
| Build completion → completion summary | ✅ Works | Shows target met, duration, pipeline status, camera intake button. |
| Build completion → fulfillment auto-advance | ✅ Works | Linked production requests auto-fulfill on build complete. |
| Order confirm → reserve/build routing | ✅ Works | In-stock items reserved (variant-aware), out-of-stock creates production requests. |
| Production queue → assign → job creation | ✅ Works | Both "new job" and "existing job" assignment paths functional. |
| Shipping → pull from stock | ✅ Works | Correctly decrements reserved (variant-aware). |
| PoS sale → inventory decrement | ✅ Works | Camera ID or manual pick, auto-decrements on save. |
| PoS sale → Square reconciliation | ✅ Works | Auto-reconcile on Square sales, manual match for misses. |
| PoS sale → receipt delivery | ✅ Works | Email (SendGrid) and SMS (Twilio) from success screen. |
| Event packing → location move | ✅ Works | Items move from Home to event location on pack confirm. |
| Event close → inventory return | ✅ Works | Unsold items returned to source locations, event location archived. |
| Camera intake → inventory + training | ✅ Works | First photo = +1 stock, subsequent = training reference. |

---

## Deferred / Future Work

- **Studio Companion PWA:** Full standalone camera-first PWA for in-studio production management — QR scanning, photo recognition, contextual actions based on job state. Currently features are embedded in admin app; future is a dedicated mobile-optimized PWA.
- **QR Scan Routing:** URL-based QR codes for jobs, products, and locations (`studio.shirglassworks.com/scan/{type}/{id}`) with contextual action resolution. Location QR codes exist (Phase D), job/product QR codes planned.
- **Product Reference Grid Sheet:** Printable grid of all products (or filtered) for studio wall display — product photo, name, QR code per cell.
- **New Product Discovery via Camera:** When Vision API doesn't recognize a piece, onboard it as a new product — photo becomes first reference, guided product creation.
- **Production Forecasting:** Cross-reference order/sales history against current inventory to surface production recommendations. Data model decisions made, OPENs remain on time horizon, trending metrics, event-awareness, and auto-job creation.
- **Abandoned checkout cleanup:** Scheduled function to auto-cancel `pending_payment` orders older than 48h.
- **Auto Etsy sync:** Scheduled function to pull Etsy orders every 15 minutes (currently manual trigger).
- **Etsy refund/cancellation sync:** Pull cancellation events from Etsy back into Firebase.
- **Payment received email:** Lightweight "we got your payment" email on `pending_payment → placed`.
- **Refund integration:** Square Refunds API for order cancellations after payment.
- **Customer order lookup:** Public page for customers to check order status by email + order number.
- **Inventory display on public site:** Show In Stock / Made to Order badges on public product cards.
- **Inventory audit trail:** History of stock changes beyond current guard flags.
- **SendGrid/Twilio configuration:** Store API keys in Firebase Functions config; admin UI for from-email and phone number settings.
