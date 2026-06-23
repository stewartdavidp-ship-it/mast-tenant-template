# sales-v2 — Build Plan

Status: **PLANNED** (2026-06-10). 5 of 12 Sales sub-items already have a V2 surface; this plan
covers the remaining 7 + standard-compliance for the existing 5. Companion to
`archive/products-v2-build-plan.md` (the ratified engine/SO model; archived — shipped) — this doc does not re-litigate
those decisions, it applies them to Sales.

## Scorecard — the 12 Sales routes (sidebar `data-section="sales"`)

| # | Route | Sidebar label | V1 source | V2 file | Status |
|---|-------|---------------|-----------|---------|--------|
| 1 | `orders` | Retail Orders | orders.js (6,262L) | orders-v2.js | ✅ proof, flag-gated `#orders-v2` |
| 2 | `commissions` | Custom Orders | orders.js | commissions-v2.js | ✅ |
| 3 | `wholesale` | Wholesale | wholesale.js (1,873L) | wholesale-v2.js | ✅ |
| 4 | `galleries` | Galleries & Consignment | — | galleries-v2.js | ✅ |
| 5 | `terms` | Policies | sales.js | terms-v2.js | ✅ |
| 6 | `pack` | Pack | fulfillment.js (1,524L) | — | ⬜ Wave 1 |
| 7 | `ship` | Ship | fulfillment.js | — | ⬜ Wave 1 |
| 8 | `rma` | Returns | orders.js | — | ⬜ Wave 1 |
| 9 | `commission-terms` | Commission Terms | commission-terms.js | — | ⬜ Wave 2 |
| 10 | `pos` | Sales Ledger | sales.js (3,257L) | — | ⬜ Wave 2 |
| 11 | `receipts` | Day Close | sales.js | — | ⬜ Wave 3 |
| 12 | `lookbooks` | Look Books | lookbooks.js (822L) | — | ⬜ Wave 3 |

Notes that shaped the plan:
- The **POS checkout is NOT the `pos` route** — checkout is the standalone `/pos/` app
  (already redesigned: catalog-first cart #352, grid+variant drill #354). The `pos` admin
  route is the **Sales Ledger** (record of in-person sales) — a transaction-list screen,
  near-clone of orders-v2 with a simpler flow. `submitOrder` POS mode (`channel:'pos'`)
  already shipped (arch #171/#173).
- `commission-terms` exists in the router + sidebar but is **missing from
  `app/data/mode-module-info.js`** (registry shows 11, sidebar has 12). Wave 0 fixes this.
- `receipts` ("Day Close") is payout/receipt reconciliation — the strongest
  "this runs my business" pitch moment of the unconverted set.

## One standard: one engine, four surface archetypes

Every Sales screen is `MastEntity.define()` + `MastUI` primitives + CSS tokens. What varies
is the **archetype**, and each archetype is named so a screen can't half-invent its own:

1. **Record** — list + slide-out detail (the Products pattern).
   → terms ✅, galleries ✅, wholesale ✅, **commission-terms** (mirror terms-v2).
2. **Transaction** — `detail.template:'transaction'` (hero tiles, line items, totals,
   timeline) + a MastFlow stepper as the Process pane.
   → orders ✅ (`flow:'pickship'`), commissions ✅, **rma** (`flow:'return'`),
   **Sales Ledger** (`flow` minimal: recorded → closed).
3. **Queue / worklist** — "what do I do next": today's actionable items, batch actions,
   keyboard-fast, count badges. NEW — the main design work of this plan.
   → **pack** (pick/pack queue), **ship** (label queue). One shared engine surface
   (`MastUI.queue` or an `MastEntity.renderQueue` mode), two configurations.
4. **Composer** — a full-screen working surface that *produces* an artifact.
   → **lookbooks** (select products → preview → generate PDF → send). The PDF engine in
   lookbooks.js carries over; only selection/preview UI is rebuilt.

**Day Close (`receipts`)** is a Record variant with a two-sided match action
(payout rows ↔ order rows), not a fifth archetype. If the match interaction grows past a
slide-out, revisit — don't pre-build.

## Light/dark — a rule with a gate, not a per-screen checklist

- V2 modules use **only** `var(--token)` colors and `color-mix(...)` tints; no hex/rgb
  literals. `--text-primary` / `--surface-card` flip under `body.dark-mode`.
- **Wave 0 adds a born-0 lint**: grep gate over `app/modules/*-v2.js` rejecting
  `#[0-9a-fA-F]{3,8}\b` and `rgb(` outside an allowlist. Baseline must be 0 (audit the 5
  existing files first; fix any hits in the same PR).
- Every wave's verify step includes one light + one dark screenshot of the new surface.

## Demo-per-sub-item validation loop (the point of all this)

Each wave ships with an **end-to-end demo script** runnable on sgtest15 (Shir Glassworks):
a 5-minute "you are the seller" walkthrough proving the sub-item stands on its own. Test
subjects run the script; feedback is filed **against the standard** (MastUI/MastEntity/
archetype) wherever possible, not the individual screen, so fixes propagate to all twelve.

Demo data ground rules (operator-ratified 2026-06-10): realistic names/prices only — no
"test"/"demo"/harness strings anywhere customer-visible, including the **`source` field**
(use `phone`/`manual`/`pos`/`online`; never `test`). The sgtest15 dataset was scrubbed and
re-seeded to these rules on 2026-06-10; keep it that way — seed via the router's
`create_test_order` with an explicit non-test `source`.

## Waves

### Wave 0 — standards + housekeeping (small, parallel)
- Hex/rgb lint gate over `*-v2.js` (born-0) + fix any hits in the existing 5.
- Add `commission-terms` to `mode-module-info.js` (registry/sidebar parity).
- Name the archetypes in `standard-record-ui.md` (record/transaction/queue/composer) so
  reviews can say "that's not the archetype" instead of re-arguing layout.

### Wave 1 — complete the order lifecycle: Pack → Ship → Returns
Cheapest wins (extend orders-v2's transaction/flow machinery) and they make the Orders
demo honest — today it stops at "confirmed".
- **pack-v2**: queue archetype over orders in `building/ready/packing`; pick list,
  packing-slip print, advance to `packed`.
- **ship-v2**: queue over `packed`; buy label (shipping CFs exist: `shippingGetRates`,
  `shippingBuyLabel`), tracking write-back, advance to `shipped` (fires customer email).
- **rma-v2**: transaction archetype, `flow:'return'`
  (requested → approved → received → refunded/restocked).
- *Demo:* paid order → pick → pack → label → shipped email → customer returns it →
  refund + restock. Pipeline data for this is staged on sgtest15 (orders SGTE-0200–0203 +
  return_requested SGTE-0093).

### Wave 2 — quick wins: Commission Terms, Sales Ledger
- **commission-terms-v2**: record archetype, mirror terms-v2.js almost 1:1.
- **pos-v2 (Sales Ledger)**: transaction-list archetype, near-clone of orders-v2 filtered
  to `source:'pos'`/in-person channels; simple flow; links each ledger row to its order.
- *Demo:* ring up an in-person sale on the `/pos/` checkout → it lands in the Sales
  Ledger and in Retail Orders like any other channel (POS demo data: SGTE-0195).

### Wave 3 — Day Close, then Look Books
- **receipts-v2 (Day Close)**: record-variant with match action — payouts (Square/Stripe)
  ↔ orders; surface + resolve discrepancies; day-close summary tiles.
- **lookbooks-v2**: composer archetype — pick products (wholesale prices) → branded line
  sheet preview → generate PDF (existing engine) → send to a wholesale buyer; demo ties
  into wholesale-v2 (buyer places the wholesale order).
- *Demos:* "match yesterday's payout, find the missing $36" · "build a line sheet, send
  it, take the wholesale order".

### Promotion (after Wave 1)
orders-v2 is still a flag-gated proof. Once pack/ship land (the flow's later stages are
real), flip the `orders` route to v2 via `MAST_V2_ROUTE_MAP` and start the legacy-retire
clock on orders.js, following the products P5 discipline: **no temp legacy deep-links in a
promoted surface**.

## Debt / known leftovers (tracked, not blocking)
- [ ] `zz-backorder-test` + `test-wine-glass-set` product **pids** (names are clean;
      renaming breaks order links / Shopify externalRefs + inventory history — fix only
      if pids ever surface in a demo).
- [ ] ~26 archived `harness-*`/`E2E*`/`ZZ*` **materials** on sgtest15 — no hard-delete in
      the materials tool; archived (hidden from active views) is as clean as it gets today.
- [ ] `mast_orders` MCP `create_test` hardcodes `source:'test'` — the router's
      `create_test_order` with explicit `source` is the sanctioned seeding path.
