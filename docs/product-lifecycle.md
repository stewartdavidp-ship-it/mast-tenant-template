# Shir Glassworks — End-to-End Product Lifecycle

**Last Updated:** 2026-03-02
**Purpose:** Living reference document covering the full product lifecycle, what's built, and what's next.

---

## Lifecycle Overview

```
CATALOG → BROWSE → DETAIL → CART → CHECKOUT → PAYMENT → ORDER → CONFIRM → [BUILD] → PACK → SHIP → DELIVER
```

---

## Stage 1: Product Catalog (BUILT)

**What exists:**
- 31 products across 6 categories (Figurines, Jewelry, Drinkware, Vases, Decoration, Sculpture)
- Product data at `shirglassworks/public/products/{pid}` with name, price, images, options (color, opacity, size), description
- Admin Products tab for managing catalog: add/edit/delete products, option management, image uploads
- Filter pills on public shop page for category browsing

**Key decision:** Product-centric data model replaced the original image-centric gallery model for shop items.

---

## Stage 2: Browse & Product Detail (BUILT)

**What exists:**
- Public shop page (`shop.html`) with product grid, category filters, responsive cards
- Product detail pages with option selectors (color, opacity, size dropdowns)
- Image gallery per product on detail pages
- Price display, Add to Cart button

**Note:** Product images currently hosted on shirglassworks.com (Weebly). If old site goes down, images need migration.

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

## Stage 5: Payment (BUILT — with gaps)

**What exists:**
- Stripe Checkout Sessions created by `shirSubmitOrder` Cloud Function
- Customer redirected to Stripe's hosted checkout page
- On successful payment, order written to `shirglassworks/orders/{orderId}`
- Sequential order numbers (SGW-XXXX) via Firebase transaction

**Gap — Stripe Webhooks:**
- No webhook handling currently
- Risks: payment failure after redirect, no automated refunds on cancel, no chargeback handling
- At minimum need `checkout.session.completed` webhook for payment reliability

---

## Stage 6: Order Placed → Confirmed (BUILT)

**What exists:**
- Order written with status `placed`, full customer data, items, pricing
- Admin Orders tab with list view, filter pills (by status), search
- Order detail view with complete information
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

---

## Stage 9: Cancellation (BUILT)

**What exists:**
- Cancel from any non-terminal state
- Cancel modal with optional reason
- Inventory release on cancel: reserved--, available++
- Open build jobs cancelled on order cancel
- Cancel reason and timestamp recorded in status history

---

## Inventory Management (BUILT)

- Inventory at `shirglassworks/admin/inventory/{pid}`
- Stock types: in-stock, made-to-order (default), limited
- Available/reserved tracking at product level
- Operations: reserve (confirm), pull (ship), release (cancel)
- Admin Products tab shows stock badges (IN STOCK / MADE TO ORDER) and "Set Stock" links
- Low stock threshold configuration

---

## Order Status Lifecycle

```
placed → confirmed → [building] → ready → packing → shipped → delivered
                                                        |
Any non-terminal → cancelled                            |
```

| Status | Meaning | Trigger |
|--------|---------|---------|
| `placed` | Customer submitted order | `shirSubmitOrder` function |
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
2. **Etsy shop coexistence** — existing ShirGlassworks Etsy shop handles payments, shipping, inventory, buyer protection.
3. **Product images on Weebly** — currently hosted on shirglassworks.com. Need migration plan if old site sunsets.

---

## Active Rules

1. **No unbounded Firebase listeners** — all reads must use `limitToLast(N)` or `.once('value')` to prevent billing spikes.
2. **Admin writes go through auth check** — Firebase rules enforce `auth.uid` check for admin operations. Public pages have anonymous read access.

---

## Unresolved Items (OPENs)

### 1. Customer-Facing Order Status & Notifications
Currently only admin can view orders. Customers have no visibility after payment. Options:
- **(A)** Email notifications on status changes (confirmed, shipped with tracking, delivered)
- **(B)** Customer order lookup page (enter email + order number to check status)
- **(C)** Both
- Shipping confirmation email with tracking link is the highest-priority gap.

### 2. Stripe Webhook Integration
No webhook handling means payment is not fully reliable. Needs:
- `checkout.session.completed` webhook for payment confirmation
- Refund processing on order cancellation
- Chargeback/dispute handling

### 3. Inventory Sync with Public Site
Inventory is admin-only data. Should customers see availability? Options:
- **(A)** Show "In Stock" / "Made to Order" / "Out of Stock" badges on product cards
- **(B)** Hide out-of-stock products or disable add-to-cart
- **(C)** Keep shop unaware of inventory, handle stock issues at confirmation

### 4. Etsy Channel Coexistence
With full custom checkout built, how do two sales channels work together?
- **(A)** Unified inventory — Etsy sales decrement the same stock counts
- **(B)** Separate inventory — manually manage both
- **(C)** Phase out Etsy once custom site is proven

### 5. Old Site Migration
What happens to shirglassworks.com (Weebly)?
- If it stays up: new site is a parallel storefront
- If it goes away: need to migrate all product images, handle SEO redirects, fully replace checkout

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
| `shirSubmitOrder` function | Firebase Functions (Node.js 20, 1st Gen) | Deployed |
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
| Full custom checkout (cart, multi-step flow, Stripe Sessions) | Checkout | Built |
| Order fulfillment lifecycle (8 statuses, sequential order numbers) | Orders | Built |
| Inventory tracking (stock types, reserve/release/pull) | Inventory | Built |
| Build jobs (auto-create on confirm, auto-ready on complete) | Fulfillment | Built |
| Coupon system (percentage, fixed, free-shipping) | Checkout | Built |
| Shipping tracking (USPS, UPS, FedEx, auto URLs) | Shipping | Built |
