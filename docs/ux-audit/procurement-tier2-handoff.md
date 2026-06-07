# Procurement rebuild + Tier 2 — handoff (what's done, what's left)

**Date:** 2026-06-07. **Read this, then DO A FULL CODE REVIEW before changing anything**
(see §6). Live tenant: **sgtest15 / Shir Glassworks** (`https://sgtest15.runmast.com`,
admin at `/app`). Companion memory: `~/.claude/projects/-Users-davidstewart-Downloads-mast-tenant-template/memory/project_procurement_flow_rebuild.md`,
`reference_procurement_deep_research.md`. Research: `docs/ux-audit/procurement-deep-research.md`.
Scope: `docs/ux-audit/procurement-tier2-shipsby-scope.md`.

The operator's 7 founding criteria (verbatim in the memory) are met through criterion 6;
criterion 7 (storefront "ships by" / backorder) is Tier 2 — **partially built (data +
storefront), order/fulfillment side remains.**

---

## 1. What shipped (all merged to main + deployed to dev)

**Admin procurement (flow-first rebuild):**
- **#303** flow-shaped home: `procurement-v2.js` is the procurement HOME with journey-ordered
  facet pills (Needs reorder · Draft · On order · Received · Cancelled · All). The **reorder
  worklist was folded in as the "Needs reorder" lens** (standard `MastEntity` list, new
  read-only `reorder-need` entity); a row-click drafts a PO and **opens it in the process
  slide-out**; bulk "Create draft POs" groups by vendor. **`reorder-v2.js` (the hand-rolled
  offender) was DELETED** — route, manifest, tab div all removed.
- **#304** pill/header parity — uses the canonical rounded facet pill + `MastUI.pageHeader`
  (not `btn-small`); search moved onto the pills row right-aligned (**#307**).
- **#306** the PO **process spine**: receipt line → **lot provenance drill**
  (`MastEntity.drill('lots-v2', lotId)`); `lots-v2.fetch` made lazy; **loop-close** — a full
  receipt returns to the home on the Received lens. *(The receipt→lot drill button was later
  REMOVED in #315 — see below — a PO and a lot are different domains; provenance flows lot→PO.)*
- **#315** **clickable step rail**: `procurement-v2` + `orders-v2` set `detail.guidedHeader:true`
  → the MastFlow GUIDED header (clickable horizontal rail, **no Advance/Back buttons**). Clicking
  the next step advances (same capture intercepts); clicking a **completed** step = **review-only**
  (no backward transition). **Dropped the PO→lot drill** (lot # is now plain text). Shared engine
  change (`workflow-engine.js`) — affects orders too.
- **#316** guided review works on terminal (received/cancelled) records too (always emit the
  hidden checklist container).
- **#310** `shared/mast-ui.js` `Num.date` fixes: `null` → '' (no more "Dec 31, 1969"), and
  midnight-UTC dates render as the calendar date (receipt/lot off-by-one).

**Tier 2 backend (data):**
- **arch #159** `functions/procurement-incoming-cf.js` — `onPurchaseOrderWritten` Firestore
  trigger projects **open-committed** POs (status `submitted`|`partially_received`) → each
  product's inventory `incoming` bucket + `incomingEta` (earliest covering ETA), recompute-from-
  scratch per touched (pid,variantKey), **skips `acquisitionType==='build'`**. `syncStockInfoToPublic`
  (`functions/tenant-functions.js`) threads `incomingEta` to public `stockInfo`. **Deployed to dev**
  (`onPurchaseOrderWritten` + `onPurchaseReceiptCreated`). Decrement-on-receipt falls out for free
  (the receipt updates the PO → re-fires the trigger). Live-verified.

**Tier 2 storefront (T2-3):**
- **#318** `product.html` (`checkAddToCartReady`) — a strict **resold** out-of-stock product with
  `stockInfo.totalIncoming>0` + `incomingEta`, gated by `shopDisplay.allowBackorder`, becomes a
  **backorder**: button "Backorder · Ships by <date>" + a note, **capped at the incoming qty**.
  `cart.js` carries `backorder`/`shipsByDate`/`shipsByText` on the line and shows "Ships by … ·
  backorder". Gate **default-OFF**.
- **#320** storefront bug fix (unrelated, but it blocked T2-3 testing): product detail pages were
  throwing "Product Not Found" because the reviews-policy read used SDK
  `db.doc('tenants/{tid}/public/config/reviews')` — a 5-segment (odd) path that `db.doc()` throws
  on synchronously (the `.catch()` can't catch it), aborting the product render. Wrapped in try/catch.

**Verified live (real data) on sgtest15:** the full admin loop (low-stock → reorder lens → draft
PO → send → receive → CF restocks → item clears from reorder → lot provenance) AND the storefront
backorder (real product `zz-backorder-test`: published/strict/resell/onHand 0 + open PO `BO-E2E`
incoming 5 ETA 2026-10-15 + `allowBackorder` on → product page shows "Backorder · Ships by Oct 15,
2026" → real add-to-cart carries the flag, qty-capped).

---

## 2. What's LEFT

### T2-4 — order + fulfillment side (PRIMARY remaining work)
The cart line already carries `backorder`/`shipsByDate`/`shipsByText`. The order side does NOT:
1. **Checkout accepts the backorder.** A backordered item is out of stock (`totalAvailable<=0`).
   `checkout.js` / the order-submission Cloud Function (`submitOrder` in
   `functions/tenant-functions.js`) likely **re-validate stock and may REJECT the item**. T2-4 must
   let an explicitly-flagged backorder line through (don't reject for out-of-stock), and **carry
   `backorder`/`shipsByDate` onto the order line items** (checkout.js builds the order payload — find
   where it whitelists line fields; it currently drops these).
2. **Flag the order "awaiting stock."** When any line is a backorder, mark the order (e.g.
   `order.hasBackorder` / a status badge) so the operator knows it can't ship yet.
3. **Block fulfillment until restocked.** Orders use the **`pickship` MastFlow**
   (`app/modules/workflows/pickship.workflow.js`, hosted by `orders-v2.js`/`orders.js`). Add an
   **exit-requirement** (or guard) on the relevant phase so an order with backorder lines **cannot
   advance to fulfillment until stock ≥ committed** (i.e. the covering PO has been received and the
   receiving CF restocked it). Decide the exact phase (likely `confirmed`→`picked`/ready).
4. **Verify the full loop E2E through a real Square sandbox checkout** (see §4 — the card-entry step
   must be done by the OPERATOR per the financial-credentials rule).

### T2-2 — admin surfacing (minor)
Surface incoming + ETA on the product Inventory pane (`products-v2.js`) and/or a "covered by PO"
indicator. Data is already on `stockInfo.totalIncoming`/`incomingEta` (+ per-variant
`stockInfo.variants[*].incoming`/`incomingEta`). Procurement already shows PO `expectedDate`.

### T2-3 polish (small)
On the storefront product page, the **"SOLD OUT" availability badge still renders alongside the
"Backorder · Ships by" button** (`product.html` availability block ~line 1391, `resolveBadge`).
When backordering, suppress/replace that badge so it reads backorder/ships-by, not "Sold Out."

---

## 3. Key files (review these)

**Admin (app/):**
- `app/modules/procurement-v2.js` — HOME + lenses + folded reorder (`reorder-need` entity +
  `computeSuggestions`/`draftOne`/`createDrafts`/`createDraftGroups`) + PO **process record**
  (`detail.flow:'procurement'`, `guidedHeader:true`, `onFlowAdvance` intercepts Send/Receive) +
  receive/send/cancel/print/apply-landed + reconcile-on-open. Writes delegate to the Bridges.
- `app/modules/procurement.js` — **V1** (legacy, default when "Legacy UI" on) + **hosts the
  Bridges**: `window.ProcurementBridge` (`createPO`, `createDraftPOs`, `send`, `receive`, `cancel`,
  `applyLandedCosts`) and `window.VendorsBridge` (`create`, `update`, `setVendorActive`,
  `createSupply` + supplier-link siblings). The ONLY write path.
- `app/modules/lots-v2.js` (inventory lots, Faceted Record, lazy fetch), `app/modules/vendors-v2.js`
  (vendors + supplier CRUD), `app/modules/workflows/procurement.workflow.js` (MastFlow spec:
  Draft→Ordered→Received+Cancelled; `recordPath` = `admin/purchaseOrders/{id}` camelCase).
- `app/modules/workflows/workflow-engine.js` — **MastFlow** (`renderHeader` vs `renderGuidedHeader`;
  the clickable rail + `phaseStep` + review-only logic live here). Shared with orders.
- `shared/mast-entity.js` (`define`/`openRecord`/`renderList`/`drill`/`_flowRender`),
  `shared/mast-ui.js` (primitives, `Num.date`, `pageHeader`, facet pill style).
- The two-switch toggle + remap in `app/index.html` (`MAST_V2_ROUTE_MAP`, `mastLegacyUI`,
  `mastUiRedesign`, `navigateTo` remap — note: procurement is force-pinned to V2 on main via a
  `||route==='procurement'` special-case + `flagOn` removed from the v2 modules).

**Storefront (root):**
- `product.html` — `checkAddToCartReady` (the backorder detection + button + note + `formatShipsBy`),
  the availability badge block (~1391, the SOLD-OUT polish), the add-to-cart handler (tags the line).
  **Storefront product object is closure-scoped, NOT `window._productData`** — but
  `checkAddToCartReady` reads `window._productData`.
- `cart.js` — `addItem` field whitelist (carries `backorder`/`shipsByDate`/`shipsByText`) + the
  drawer line render + the `Checkout` button → `MastCheckout.start()`.
- `checkout.js` — **T2-4 target**: `MastCheckout.start()`, the order payload build, `submitOrder`
  call. Find where line fields are whitelisted (backorder/shipsByDate dropped today) + the stock
  validation.
- `storefront-tenant.js` — `fetchFsDoc('config/shopDisplay')` (reads `public/config/shopDisplay`;
  `allowBackorder` lives here).

**Cloud Functions (mast-architecture, `~/Developer/mast-architecture/functions/`):**
- `procurement-incoming-cf.js` (the projector), `procurement-receiving-cf.js` (receiving→stock;
  `applyReceiptToStock` + idempotency claim), `tenant-functions.js` (`syncStockInfoToPublic`,
  `submitOrder`, `onOrderShipped`, pickship-adjacent), `index.js` (exports).

---

## 4. Gotchas (these cost real time)

- **Deploy — template:** PR off `origin/main` in your OWN worktree (never the shared checkout,
  never push to main). Auto-merge on green (`lint` + `docs-inventory`). CI deploys dev on merge.
  **Bump `MAST_MODULES_V`** (`./scripts/bump-modules-version.sh`) for `app/index.html` or
  `app/modules/*.js` changes — `lint-cache-bust` fails otherwise. **Storefront files
  (`product.html`/`cart.js`/`checkout.js`) do NOT need a bump** (not admin-scoped) and `cart.js`
  has no `?v=` suffix. Regen `docs/generated/admin-inventory.md` if admin line counts change.
- **Deploy — arch (Cloud Functions):** PR-to-main (full hermetic test gate: `cd functions &&
  bash scripts/run-hermetic-tests.sh` — needs `npm ci` first or you get MODULE_NOT_FOUND noise).
  Deploy to **dev**: `firebase deploy --only functions:<NAME> --project mast-platform-prod`
  (**mast-platform-prod IS the dev pod — the name lies; operator-confirmed**). **Targeted only**,
  never full (`firebase deploy --only functions` deploys ~66 = quota trap). **Deploy from the
  SHARED checkout, not a fresh npm-ci'd worktree** (a gen-2 source-discovery quirk made it try to
  DELETE `onPurchaseReceiptCreated`). A freshly-created 2nd-gen CF **misses events for ~1 min**
  post-deploy (eventarc activation) — re-trigger to verify. If you touch `syncStockInfoToPublic`,
  **redeploy `onPurchaseReceiptCreated` too** (its stale copy strips `incomingEta` in a race).
- **Storefront caching:** `product.html`/`cart.js` are behind CF edge + PWA SW cache — live
  re-navigation serves **stale** intermittently. Use `?cb=<n>` + hard-reload. (See
  `reference_sgtest15_serving_path_cf_cache`.)
- **Square checkout:** sandbox/test. **You (the agent) must NOT enter card/payment numbers into any
  field — even sandbox test cards (safety rule). The operator does the card-entry + pay step.**
- **Verification tooling:** drive the live UI with **claude-in-chrome** (the operator's signed-in
  browser; the admin session logs out intermittently — agent must not enter credentials). Use the
  **tenant MCP** (`mast_products`/`mast_materials`/`mast_orders create_test`/`mast_config` — note
  `mast_config` is a protected two-call action; config can also be set via admin `MastDB.set` in the
  browser). `mast_orders create_test` makes a test order without Square (TEST tenants only).

---

## 5. Test data left on sgtest15 (for the T2-4 Square E2E)
- Product **`zz-backorder-test`** (published, strict, resell, onHand 0).
- Open PO **`BO-E2E`** for it (incoming 5, ETA 2026-10-15, status submitted).
- `config/shopDisplay` AND `public/config/shopDisplay` = `{allowBackorder:true}`.
- Plus accumulated test POs + the `TEST — cobalt paperweight` product at onHand 14 / incoming 2.
- **Decide:** reuse for the T2-4 checkout E2E, or reset (the next session can recreate cleanly).

---

## 6. MANDATE: full code review before any change
The operator requires the next session to **do a real code review of the procurement module — not
just read docs — before making changes.** At minimum, read end-to-end: `procurement-v2.js`,
`procurement.js` (the Bridges), `workflow-engine.js` (`renderGuidedHeader`/`phaseStep`),
`procurement.workflow.js`, `shared/mast-entity.js` (`_flowRender`), `product.html`
(`checkAddToCartReady` + availability), `cart.js` (`addItem`), `checkout.js` (order build +
`submitOrder` path), and the three CFs (`procurement-incoming-cf.js`, `procurement-receiving-cf.js`,
`tenant-functions.js` `syncStockInfoToPublic` + `submitOrder`). Verify the current behavior against
this doc (things drift). THEN plan T2-4 and get the flow ratified before coding (the operator wants
flow-first; no hand-rolled surfaces — everything on `MastEntity`/`MastFlow`/`MastUI`/Bridges).
