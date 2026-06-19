# orders.js retirement — assessment + cut plan (T6)

**Verdict: ABORT the single-PR cut.** `app/modules/orders.js` (6,789 lines) is the most
deeply-coupled V1 module in the repo. A clean delete is **not** safely doable in one pass.
This document is the precise, actionable replacement: the full dependency map and the
recommended ordered PR sequence. Driven by the cross-module graph, not memory.

Assessed 2026-06-19 against `origin/main` @ 1d13cae6.

---

## 1. Why it's not a clean cut

orders.js is really **five sub-domains** fused into one file, and its logic is consumed by
modules that are **explicitly staying** (fulfillment.js, wholesale.js) and by the **live
dashboard** — not just by deletable V1 UI.

| Sub-domain (orders.js) | Approx lines | V2 twin | Twin status |
|---|---|---|---|
| Orders core + list/detail UI + lifecycle state machine | L1–1435 (~1.4K) | orders-v2 | full UI, delegates writes → `OrdersBridge` |
| Invoice management | L1630–1937 (~300) | — (consumed by wholesale.js) | no twin |
| Shipping modal flow | L2369–2973 (~600) | fulfillment-v2 (own picker #529) | V1 fulfillment.js still uses orders.js's |
| Commissions | L3348–5011 (~1.6K) | commissions-v2 | full UI, delegates writes → `CommissionsBridge` |
| Dashboard cards (New Orders / Ready to Ship) | L5011–5104 (~100) | — (shell dashboard) | live on every dashboard load |
| RMA / Returns admin | L5105–6010 (~900) | rma-v2 (**self-contained**) | orders-v2 refund still calls `transitionRma` |
| `CommissionsBridge` / `OrdersBridge` / RMA-AI reg | L6125–6789 | — | write-delegation surfaces |

### Routing facts (the cut gate)
- orders.js manifest entry owns `routes: ['orders', 'commissions', 'rma']`.
- `MAST_V2_ROUTE_MAP` already remaps `orders→orders-v2`, `commissions→commissions-v2`,
  `rma→rma-v2`. So in V2 mode (default) **the V1 UI is fully superseded** — the blocker is
  purely the **shared logic**, not the screens.

### The genuine cross-module consumers (word-boundary verified)

**V2 twins delegating writes back to orders.js** (absorb-first, shows/social precedent):
- **orders-v2** → `window.OrdersBridge` (14 sites: triageConfirm/cancelOrder/addNote/sendEmail/
  listEmails/bulkMarkShipped/bulkCancel/issueRefund) + optional `getItemInventoryStatus`
  (guarded). `loadModule('orders')` at :542. *(The `renderOrderDetail`/`transitionRma`/
  `bulkOrdersExportCsv` grep hits in orders-v2 are all in **comments** — not live calls.)*
- **commissions-v2** → `window.CommissionsBridge` (all writes). `loadModule('orders')` at :369,:628.
- **rma-v2** → **nothing** (self-contained own write logic). ✓ already clean.

**Staying V1 modules consuming orders.js globals — the HARD blockers:**
- **fulfillment.js (staying)** → `transitionOrder` (bare, 6 sites — the order lifecycle state
  machine), `getOrdersArray`, `loadOrders`, `viewOrder` (onclick), `openShippingModal`
  (onclick), `renderOrderProgress`, `orderStatusBadgeStyle`, `getOrderDisplayNumber`.
  **⚠️ It does NOT `loadModule('orders')`** — it relies on bare globals already being present.
  This is the single biggest reason orders.js can't just be deleted.
- **wholesale.js (staying)** → `generateInvoice` (does `loadModule('orders')` first at :1741 ✓),
  `getOrderDisplayNumber`.
- **wholesale-v2.js** → `getOrderDisplayNumber` (guarded).
- **sales.js** → `getOrderDisplayNumber` (window-guarded).
- **customers.js (V1)** → `viewOrder` (does `loadModule('orders')` first at :2927 ✓).

**Shell (index.html):**
- **`renderDashCardNewOrders` / `renderDashCardReadyToShip`** — **live dashboard cards** loaded
  via `loadModule('orders')` at :46207 on every dashboard render (V2 *and* legacy). Genuine
  permanent consumer.
- `formatOrderDate` — 4 eager shell table sites (procurement/inventory), all `typeof`-guarded
  with a `.slice(0,10)` fallback. Genuine display-helper consumer.
- `renderOrders` / `renderOrderDetail` / `renderCommissions` / `setCommissionSort` / bulk* /
  `openNewRmaModal` / `viewRma` — legacy `#orders`/`#commissions`/`#rma` tab chrome + the orders
  real-time-listener refresh path. Reached **only** when orders.js renders (legacy mode).

**False positives ruled out (word-boundary):** `channels.js` and `wholesale.js` define their own
local `loadOrders`; `shows-v2.js`'s `OrdersBridge` is a comment.

---

## 2. Recommended PR sequence

The keystone is **extracting the shared logic floor first** so the remainder of orders.js
becomes pure dead-V1-UI whose only live consumers are the V2 twins (via Bridges).

### PR1 — Extract `shared/orders-core.js` (refactor, **zero deletion, zero behavior change**)
Move the genuinely cross-module-shared, non-UI logic out of orders.js into a new module that all
consumers can reach. Keep the exact `window.*` names so existing call sites are untouched.
Contents:
- **Display helpers** (near-pure): `getOrderDisplayNumber`, `formatOrderDate`,
  `formatOrderDateTime`, `orderStatusBadgeStyle`, `etsySourceBadgeStyle`, `getOrderItemsLabel`,
  `renderOrderProgress`.
- **Order cache + lifecycle**: `getOrdersArray`, `loadOrders`, `transitionOrder`,
  `reserveInventory`, `releaseInventory`, `pullFromStock`, `createProductionRequests`.
- **The order-write cores** that `OrdersBridge` wraps (triage/cancel/note/email/bulk/refund cores).
- **Invoice surface**: `generateInvoice` + `sendInvoice`/`markOrderInvoicePaid`/`resendInvoice`/
  `buildInvoiceSection`/`isOrderInvoiceable`/`getEffectiveInvoiceStatus`/`invoiceStatusBadgeStyle`.

orders.js (UI) and orders-v2/commissions-v2/fulfillment.js/wholesale.js all now call orders-core.
Decision needed: **eager head tag** (simplest, fixes the fulfillment.js bare-global fragility, but
adds to eager load) **vs lazy module** (consumers `await loadModule('orders-core')`; fulfillment.js
gains an explicit ensure-load it currently lacks). Recommend **lazy + ensure-load**, consistent
with the decomposition program, since wholesale/customers/orders-v2/commissions-v2/dashboard
already `loadModule('orders')` — they just repoint to `'orders-core'`. fulfillment.js gets a new
ensure-load at the top of its pack/ship handlers (closing today's latent fragility).
*Optionally split:* PR1a = display helpers (trivial, ~7 pure fns), PR1b = lifecycle + cores + invoice.
Fully smoke- + dev-verifiable (no UI change).

### PR2 — Absorb `CommissionsBridge` + commission write cores into commissions-v2 (verbatim)
Mirror the ShowsBridge→shows-v2 / SocialBridge→social-v2 precedent (#714/#715). commissions-v2
stops `loadModule('orders')` and owns its writes (calling orders-core where needed). Delete the
commission UI + bridge from orders.js (~1.6K lines). Drop the `commissions` route from the
orders.js manifest entry; remove `MAST_V2_ROUTE_MAP['commissions']` pair (commissions-v2 entry
registers the bare `commissions` route). The shell's legacy `#commissions` tab onclicks
(`setCommissionSort`/`renderCommissions`/`openNewCommissionModal`) die with legacy — verify no
non-legacy caller first.

### PR3 — Absorb `OrdersBridge` (+ RMA refund cores) into orders-v2 (verbatim)
ShowsBridge precedent again. orders-v2 stops `loadModule('orders')`; OrdersBridge now calls the
orders-core cores from PR1. The native-refund path (`issueRefund` → `transitionRma` CF delegator)
needs `transitionRma` + RMA cores — absorb into orders-v2 (it's orders-v2 that drives refunds).
Move the optional `getItemInventoryStatus` too. Delete the orders list/detail UI from orders.js.

### PR4 — Dashboard cards + RMA UI + final delete
- Re-home `renderDashCardNewOrders`/`renderDashCardReadyToShip` (~100 lines) — they read
  orders-core; either fold into a small dashboard-cards module or co-locate with orders-core.
- The legacy shell RMA tab (`loadRmaData`/`renderRma`/`viewRma`/`openNewRmaModal`) dies with
  legacy (rma-v2 is the live surface); confirm no non-legacy consumer.
- Reassign `orders`/`rma` routes, drop the orders.js manifest row + remaining
  `MAST_V2_ROUTE_MAP` pairs (`orders`, `rma`), `git rm app/modules/orders.js`.
- Add `orders-v2`/`commissions-v2`/`rma-v2`/`orders-core` to `scripts/smoke-boot.mjs` ROUTES.

---

## 3. Why this order
- PR1 removes the only **hard** blocker (staying modules consuming non-UI globals) without
  touching any UI — lowest risk, fully verifiable, and it makes orders.js's remainder *purely*
  dead V1 UI reachable only through the Bridges + legacy tabs.
- PR2/PR3 are the proven absorb-first pattern (#714 shows, #715 social) applied to the two
  delegating twins.
- PR4 is then a mechanical delete + route reassignment, gated by `lint-manifest-integrity.js`.

## 4. Risks / notes
- **Revenue core** — every step needs dev-verify on sgtest15 (order triage→pack→ship→invoice,
  commission lifecycle, refund) + green CI smoke. Correctness over speed.
- fulfillment.js's missing `loadModule` is a **latent bug today** (bare `transitionOrder`); PR1's
  ensure-load fixes it as a side benefit.
- Invoice (`generateInvoice`) has **no V2 twin** — it must live in orders-core (or move into
  wholesale.js, its only real consumer). orders-core is cleaner.
- T5/T7 ratchets: any module that gains relocated code needs its ux/no-local-fmt/sink baselines
  hand-extended with the **relocated** debt (verbatim, never `--update`).
- Cache-bust + gen-inventory + lint-shell-size `--update` on every PR; merge-train if DIRTY.
