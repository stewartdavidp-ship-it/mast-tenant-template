# Agent/MCP Oracle Templates — W1, W2, W4–W10

> The **agent-surface oracle** for the nine non-pilot workflows (W3 is the pilot:
> [`W3-pilot.md`](W3-pilot.md)). Each defines the MCP read sequence, the assertions, the
> runnable status, and the **live `sgtest15` baseline + findings** captured 2026-06-20. The
> oracle = read-only verification; it's fully runnable today (no auth) wherever an MCP tool
> exists. Coverage gaps (no tool) are themselves results. Data rolls up to
> [`suite-scorecard.json`](suite-scorecard.json); findings ledger at the bottom.

Coverage: ✅ full · ◑ partial · ➖ none · ✅✅ richer than UI.

---

### W1 — List a new product  · Agent ✅
- **Oracle:** `mast_materials get` (cost) → `mast_recipes get` (unitCost ties to materials) →
  `mast_products get` (price/variants/`readinessChecklist`). Cross-surface: MCP get == UI detail.
- **Assertions:** product readable both surfaces; price+variant set correct; recipe `unitCost`
  derives from material costs; readiness gate (`defined/costed/channeled/listingReady`) consistent.
- **Live:** materials list OK (5; **3 `ZZ-TEST` archived = fixture pollution → F10**); recipes
  carry cost tiers; W3 fixture confirmed `readinessChecklist` is exposed. Writes (create) ran in
  the W3 proxy. **Status:** 🟢 oracle runnable; UI create needs auth.

### W2 — Online order → delivered  · Agent ◑
- **Oracle:** `mast_orders get`/`list` (**protected → handshake, F2**) + `finance_get_revenue`.
- **Assertions:** order reaches `complete`; inventory −N; revenue += order total once.
- **Live:** create is storefront-gated (agent uses `create_test` on test tenants — exercised in
  W3); order **reads cost the two-call handshake**. **Status:** ◑ triage/status only; production
  sale-create UI-only by design.

### W4 — Restock from low inventory (PO)  · Agent ◑
- **Oracle:** `mast_materials get` (onHand vs reorderThreshold) → `materials_cost_history`
  (cost basis after receive). PO lifecycle write = **no clear dedicated MCP tool (coverage gap)**.
- **Assertions:** PO draft→sent→received; inventory += received; cost basis updated.
- **Live:** materials expose `onHandQty`/`reorderThreshold` (e.g. Green Rod 120/30). PO
  create/receive appears UI-only via MastFlow. **Status:** ◑ read side runnable; PO write UI-only.

### W5 — Reprice on material cost change  · Agent ✅✅
- **Oracle (zero-write):** `mast_recipes list_needing_reprice` / `get_drift` /
  `simulate_metal_shift` / `get_cost_basis_diff`; `mast_spot_prices get` (**protected, F2-class**).
- **Assertions:** drifted set identified; simulation matches post-reprice prices; locks respected.
- **Live:** `list_needing_reprice` → **0 recipes over 15% drift** (margins stable). `simulate_metal_shift`
  is gold/silver/platinum — **this glass tenant has no spot-linked metal materials, so the
  showcase is N/A here → F8** (vertical-specific; needs a jewelry tenant or a fixed-cost-shift
  variant). **Status:** 🟢 runnable; richer than the UI, but not demonstrable on a glass tenant.

### W6 — Understand the financial truth  · Agent ✅✅
- **Oracle:** `finance_get_revenue` · `_pnl` · `_ar_aging` · `_tax_summary` · `_cashflow`
  (+ `_1099_prep`, `_nexus_status`, `_expenses`). 5-call core ≈ **2 KB total** — very cheap.
- **Assertions (reconciliation matrix — all PASS live):**
  - revenue.total `9,285,856` == pnl.revenue ✓
  - AR-aging Σ buckets `6,275,553` == cashflow.arOutstanding ✓
  - cashflow.dueWithin30 `4,200,000` == AR current + 1–30 ✓
  - netCashPosition `5,836,903` == AR − AP ✓
- **Live findings:** bank balance `0` — **stale Plaid `item-001` → F4** (so netCashPosition is
  AR−AP, not true cash); tax **`missingState: 5`** orders untracked → **F5** (nexus/compliance).
  **Status:** 🟢 strongest agent surface — full read parity, token-cheap, self-reconciling.

### W7 — Resolve a return / refund  · Agent ◑
- **Oracle:** `mast_cs_tickets` (read) + `mast_orders get` (**protected, F2**) + `finance_get_ar_aging`
  / `_revenue` (reversal reflects once). Refund itself = server CF.
- **Assertions:** refund == returned value (to cent); order→`returned`; inventory restocked;
  reversal counted once; **adversarial:** no double/over-refund.
- **Live:** not run (avoids order handshake ceremony). **Status:** ◑ read side runnable; refund
  write driven by CF (verify agent can drive vs only observe).

### W8 — Run payroll & labor  · Agent ✅
- **Oracle:** `team_get_labor_cost` · `team_get_time_entries` · `team_get_pto_balance`.
- **Assertions:** labor == Σ(hours×rate)+loaded; cross-surface: labor total == P&L payroll.
- **Live:** labor `437,300` (emp-002 salary 350,000 + emp-001 48.5h×$18 = 87,300). **Cross-check
  FAILS:** P&L payroll `435,000` ≠ labor `437,300` ($23 gap) → **F6**. And salary labor returns a
  **flat monthly rate regardless of period** (full-year query counted one month) → **F7**.
  **Status:** 🟢 runnable; surfaced two real reconciliation/correctness findings.

### W9 — Manage a customer / wholesale account  · Agent ◑
- **Oracle:** `mast_contacts list`/`get`/`search_by_email`. Segment/wholesale = **no MCP tool**.
- **Assertions:** record matches across surfaces; segment cohort correct (D4-005 class);
  wholesale pricing resolves.
- **Live:** contacts readable (Tom Whitfield appears in both contacts and AR INV-0006 ✓ linkage),
  but the **projection is thin — no LTV / wholesale tier / segment → F9**; test-contact pollution
  (`_review_throwaway`, `QA Tester`) → F10. **Status:** ◑ basic read only; the customer-value
  surface is UI-only.

### W10 — Run a class / booking program  · Agent ➖
- **Oracle:** **none.** Tool search for classes/booking/enrollments/sessions/passes → no tenant
  tool exists. The agent **cannot operate this domain at all → F11**.
- **Assertions:** n/a on the agent surface (task-success = 0 by construction).
- **Live:** confirmed absent. **Status:** 🔴 the largest agent coverage gap; a whole revenue
  line (an 11-route booking sub-app) with zero agent access.

---

## Findings ledger (from instrumenting the spine, 2026-06-20)

| ID | WF | Sev | Finding |
|---|---|---|---|
| **F1** | W3 | med | Revenue `byChannel` fragmented (`pos`/`direct-pos`, `online`/`Online Store`); no canonical normalization → **task_f0d1c0e4** |
| **F2** | W3,W2,W7 | low | `mast_orders` reads (`get`/`list`) are protected → 2× calls/tokens for an agent (ease-of-use friction) |
| **F3** | W3 | info | `create_test` correctly segregates revenue to a `test` channel (positive) |
| **F4** | W6 | low | Cashflow bank balance `0` (stale Plaid `item-001`); `netCashPosition` is AR−AP, not true cash — flagged but mis-readable |
| **F5** | W6 | med | Tax summary `missingState: 5` — POS/manual/phone orders don't capture `taxState` (only online checkout does, checkout.js:893); aggregators drop stateless orders (finance.js:4529/4650/5450). Nexus/compliance gap → **task_673dfb81** |
| **F6** | W8 | med | Computed labor `437,300¢` ≠ P&L payroll `435,000¢` ($23) — different sources (time×rate vs journal entries) → folded into **task_aad9b8d1** · ✅ DOCUMENTED ([mcp-server#136](https://github.com/stewartdavidp-ship-it/mast-mcp-server/pull/136): `team_get_labor_cost` desc now states computed labor ≠ P&L payroll line) |
| **F7** | W8 | med | Salary labor flat **monthly** regardless of period (UI prorates correctly at team.js:1171 `payRate*days/30.4375`; MCP `team_get_labor_cost` doesn't — UI↔MCP divergence) → **task_aad9b8d1** · ✅ FIXED ([mcp-server#136](https://github.com/stewartdavidp-ship-it/mast-mcp-server/pull/136): MCP now prorates by query window; cross-repo parity guard added) |
| **F8** | W5 | info | Metal-shift reprice showcase is precious-metal-specific; glass tenant has no spot-linked materials (spine-design: needs a jewelry tenant) |
| **F9** | W9 | gap | MCP contacts projection thin (no LTV/wholesale/segment); customer-value surface is UI-only |
| **F10** | W1,W9 | low | Test-data pollution on `sgtest15` (`ZZ-TEST` materials, `_review_throwaway`/`QA` contacts) — fixture hygiene |
| **F11** | W10 | gap | No classes/booking MCP tool — agent cannot operate a whole revenue line |
| **F14** | W6 | med | P&L UI withholds gross/net margin when COGS is incomplete; MCP `finance_get_pnl` returned them with no caveat → agent got numbers the UI deemed unreliable → **task_14a258f4** · ✅ **FIXED + DEPLOYED** ([mcp-server#141](https://github.com/stewartdavidp-ship-it/mast-mcp-server/pull/141): `finance_get_pnl` now returns `marginReliable`/`cogsLineMissingCount`/`cogsMissing`, same formula as UI `computePnlLocal`). Live-verified `sgtest15` 2026-06-22: `marginReliable:false, cogsLineMissingCount:22`. Pinned by `test/money-canary.test.js`. |
| **F19** | W6 | low | MCP order revenue reads `(o.total||0)*100` while UI reads `_orderRevenueCents` (prefers `totalCents`) — latent **100×** divergence on the cents-in-the-dollar-field bad-data shape (SGTE-0187/0188). Doesn't move `sgtest15`'s aggregate today. Fix: adopt `orderRevenueCents` in `mast-finance.ts` (cross-repo MCP chip). Surfaced by the money canary's cross-surface contract review. |

**Chipped:** F1 → `task_f0d1c0e4` (channel normalization, FIXED); F6+F7 → `task_aad9b8d1` (labor proration /
payroll, FIXED); F5 → `task_673dfb81` (tax-state capture); **F14 → `task_14a258f4` (P&L margin parity) — FIXED+DEPLOYED+CLOSED.**
F9/F11 are agent-coverage decisions for Lens 3, not bugs (carry into the Lens-3 review). F4/F8/F10 are low/info —
logged, not chipped. **F19** (order-`totalCents`) is a new cross-repo MCP chip from the money-canary contract review.
The W6 revenue↔P&L reconciliation matrix is now codified + executable in `scripts/qa-spine/money-canary.mjs`.
