# Shir Glassworks — End-to-End Product Lifecycle

**Last Updated:** 2026-03-02
**Purpose:** Living reference document covering the full product lifecycle, what's built, and what's next.

---

## Lifecycle Overview

```
CATALOG → BROWSE → DETAIL → CART → CHECKOUT → PAYMENT → ORDER → CONFIRM → [BUILD] → PACK → SHIP → DELIVER
```

**Dual-channel model:** Orders enter from two sources — the custom website (direct) and Etsy. Both feed into a single unified admin pipeline.

---

## Stage 1: Product Catalog (BUILT)

**What exists:**
- 31 products across 6 categories (Figurines, Jewelry, Drinkware, Vases, Decoration, Sculpture)
- Product data at `shirglassworks/public/products/{pid}` with name, price, images, options (color, opacity, size), description
- Admin Products tab for managing catalog: add/edit/delete products, option management, image uploads
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

## Inventory Management (BUILT)

- Inventory at `shirglassworks/admin/inventory/{pid}`
- Stock types: in-stock, made-to-order (default), limited
- Available/reserved tracking at product level
- Operations: reserve (confirm), pull (ship), release (cancel)
- Admin Products tab shows stock badges (IN STOCK / MADE TO ORDER) and "Set Stock" links
- Low stock threshold configuration
- Inventory is soft/flexible — not strict count-based. Discrepancies handled at confirmation.

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

---

## Deferred / Future Work

- **Abandoned checkout cleanup:** Scheduled function to auto-cancel `pending_payment` orders older than 48h
- **Auto Etsy sync:** Scheduled function to pull Etsy orders every 15 minutes (currently manual trigger)
- **Etsy refund/cancellation sync:** Pull cancellation events from Etsy back into Firebase
- **Payment received email:** Lightweight "we got your payment" email on `pending_payment → placed`
- **Refund integration:** Square Refunds API for order cancellations after payment
- **Customer order lookup:** Public page for customers to check order status by email + order number
- **Inventory display on public site:** Show In Stock / Made to Order badges on product cards
