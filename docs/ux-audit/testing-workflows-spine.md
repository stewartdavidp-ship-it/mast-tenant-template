# The Workflow Spine — 10 Business Workflows for the Next-Gen Testing Program

> **Purpose.** A fixed, curated set of real business workflows that becomes the *shared
> spine* of the testing program. Each workflow is run through **both** surfaces — the human
> admin **UI** and the AI-agent **MCP** API — and scored. One artifact instruments
> **Lens 1 (functional completeness)** and **Lens 2 (ease of use, human + agent)** at once,
> and each workflow is tagged to a business job for **Lens 3 (business value)**.
>
> This is the *definition* phase (the "what"). Instrumentation (the runnable scripts, seed
> fixtures, and scorecard harness) is the next step. See [discovery](testing-program-discovery.md).
> Authored 2026-06-20.

---

## Why these ten

**Selection principles:**
1. **Span the maker value chain** — make → list → sell → fulfill → restock → price → get
   paid → understand → retain → diversify. A tenant's whole operating loop.
2. **Concentrate on money & compliance paths** — that's where bugs hurt most and where they
   historically lived (the 100× cents inflation, POS double-count, date off-by-one, swallowed
   Firestore writes were all on these paths).
3. **Deliberately sample the surface-coverage spectrum** — some workflows are strong on
   **both** surfaces, some are **MCP-stronger** (the agent can do things the UI can't), and
   some are **UI-only** (a real parity gap). The spine should *reveal* parity, not hide it.
4. **Cover the V1→V2 migration risk** — at least one workflow runs through a surface that is
   still a V2 lens over a live V1 source-of-truth Bridge.
5. **Map to distinct Jobs-To-Be-Done** so Lens 3 coverage is legible.

**The set at a glance:**

| ID | Workflow (business job) | Human UI | AI agent (MCP) | Money | Hist. bug hotspot | Role in the spine |
|---|---|:---:|:---:|:---:|:---:|---|
| **W1** | List a new product for sale | ✅ | ✅ (richer cost) | ➖ | — | value-chain core |
| **W2** | Online order → delivered | ✅ | ◑ triage/status | ✅ | ✅ | value-chain core |
| **W3** | In-person POS sale → books | ✅ | ➖ (read-only oracle) | ✅ | ✅✅ | **money canary** + UI-only |
| **W4** | Restock from low inventory (PO) | ✅ | ◑ | ✅ | ✅ | value-chain core |
| **W5** | Reprice on material cost change | ◑ | ✅✅ (exceeds UI) | ✅ | — | **agent-operability showcase** |
| **W6** | Understand the financial truth | ✅ | ✅✅ | ✅ | ✅✅ | **money canary** + agent-strong |
| **W7** | Resolve a return / refund | ✅ | ◑ | ✅ | ✅ | money-touching, both |
| **W8** | Run payroll & labor | ✅ | ✅ (fine-grained) | ✅ | ✅ | agent-strong, both |
| **W9** | Manage a customer / wholesale acct | ✅ | ◑ | ➖ | — | **V1→V2 migration probe** |
| **W10** | Run a class / booking program | ✅ | ➖ none | ✅ | — | **parity-gap probe** (UI-only) |

Legend: ✅ full · ◑ partial · ➖ none · ✅✅ notably stronger than the other surface.

**If trimming to 8:** drop W10 and fold W9 into W2's customer step. But W10's *value* is
precisely that it has **no MCP coverage** — it makes the agent's blind spot measurable, which
is a Lens-2/Lens-3 finding the other nine can't surface. Recommend keeping all ten.

---

## The ten workflows

Each spec is surface-agnostic in its **Steps**, then gives the concrete **UI path** and
**MCP path**, the **Oracle** (how we know it worked, including a cross-surface check), the
**Functional coverage** (Lens 1 — what it exercises + known risk), and **What we measure**
(Lens 2). The business job line up top is Lens 3.

---

### W1 — List a new product for sale
**Job:** *When I've made a new item, I want to get it priced and live on my storefront, so I
can sell it.* · **Persona:** owner/maker · **Frequency:** weekly · **Criticality:** revenue-enabling.

- **Preconditions/seed:** clean tenant; one material exists (or create it as step 0).
- **Steps:** (1) create/confirm a material with a unit cost → (2) create a recipe/BOM that
  consumes it → (3) create a product linked to the recipe, with 2 variants (e.g. size) →
  (4) set price from cost (target margin) → (5) set initial inventory → (6) publish → (7)
  confirm it appears on the storefront and is purchasable.
- **UI path:** `materials`/`products-v2` (maker.js) → recipe builder → product editor
  (variants, price, images) → publish gate → storefront `product.html`.
- **MCP path:** `mast_materials` create → `mast_recipes` create → `mast_products`
  action=create → `materialize_variants` → `update_inventory` → `set_status`(active).
- **Oracle:** product readable on both surfaces with correct price & variant set;
  **cross-surface:** `mast_products` get == UI detail; storefront renders it.
- **Functional coverage:** product/recipe/material engines, variant reconcile, the
  **publish-readiness gate** (the one SHA-pinned UI↔MCP contract), storefront read.
- **Measure:** human — steps/clicks, SEQ, errors; agent — tool-calls, tokens, pass^k(5),
  **collateral:** no other product's inventory/price changed.

---

### W2 — Online order → delivered
**Job:** *When a customer orders online, I want to fulfill and ship it, so they get their
goods and I get paid.* · **Persona:** owner/fulfillment staff · **Frequency:** daily · **Criticality:** core revenue + CX.

- **Preconditions/seed:** W1's product live; a placed storefront order (test-tenant) in the queue.
- **Steps:** (1) order arrives → (2) triage/accept → (3) if made-to-order, create a
  production/build job → (4) mark built → (5) pack → (6) ship (capture tracking) → (7) mark
  complete → (8) confirm inventory decremented and order in revenue.
- **UI path:** storefront `checkout.js` (sale creation) → `orders-v2` (triage) →
  `production.js`/jobs (build) → `fulfillment.js` (pack/ship) → finance reflects.
- **MCP path:** *sale creation is storefront-gated* (agent uses `create_test` only on test
  tenants) → `mast_orders` triage/update status → (no production/pack MCP tools) → confirm
  via `mast_orders` get + `finance_get_revenue`.
- **Oracle:** order reaches `complete`; inventory −N; **cross-surface:** `finance_get_revenue`
  increments by exactly the order total (no ×100, no double count).
- **Functional coverage:** order pipeline, OrdersBridge, ProductionBridge, inventory
  reserve/release/ship (the swallowed-field-path bug class), order→revenue money math.
- **Measure:** human — steps, time, errors; agent — tool-calls, tokens, pass^k; **collateral:**
  only the target order/inventory moved. **Note the asymmetry:** agent cannot create a
  production sale (by design) — that *is* the finding.

---

### W3 — In-person POS sale → books  *(money canary)*
**Job:** *When I sell at the counter or a fair, I want it recorded so my inventory and
revenue are right.* · **Persona:** owner/retail staff · **Frequency:** daily/seasonal · **Criticality:** revenue accuracy.

- **Preconditions/seed:** W1 product with stock.
- **Steps:** (1) start a POS sale → (2) add item(s) → (3) take payment (cash/test) → (4)
  complete → (5) confirm receipt → (6) confirm inventory decremented → (7) confirm revenue
  reflects the **exact** amount once.
- **UI path:** `pos` (sales.js) → receipt → inventory + finance.
- **MCP path:** **none for creation (UI-only).** Agent's role = **oracle**: read
  `finance_get_revenue` (byChannel: direct-pos) and `mast_products` inventory before/after.
- **Oracle:** revenue delta == sale total, **to the cent, counted once** (this is exactly
  where the 100× inflation and Square/POS double-count lived). Inventory −qty.
- **Functional coverage:** POS path, `_salesCents`/`direct-pos` revenue aggregation, the
  cents/dollars boundary, the dual-source UI↔MCP reconciliation.
- **Measure:** human — steps, SEQ; **this workflow's headline metric is the cross-surface
  money assertion**, not agent task-success. Demonstrates the MCP-as-oracle pattern as a
  *first-class automated check* rather than a manual habit.

---

### W4 — Restock from low inventory (PO lifecycle)
**Job:** *When stock runs low, I want to reorder from my vendor, so I don't run out.* ·
**Persona:** owner/ops · **Frequency:** weekly · **Criticality:** continuity + cost control.

- **Preconditions/seed:** a product/material below reorder point; a vendor on file.
- **Steps:** (1) detect needs-reorder → (2) generate a draft PO → (3) review/adjust lines →
  (4) send to vendor → (5) receive (full or partial) → (6) confirm inventory increases and
  cost basis updates.
- **UI path:** `reorder-v2` → `procurement-v2` (PO as MastFlow process) → vendors-v2 →
  receive → inventory/cost-basis.
- **MCP path:** partial — read via `mast_products`/`mast_materials`; PO write coverage is
  thin (confirm what `mast_workflows`/procurement tools expose vs UI-only).
- **Oracle:** PO transitions draft→sent→received; inventory += received qty; cost basis
  reflects PO unit cost; **cross-surface:** `materials_cost_history` shows the new basis.
- **Functional coverage:** procurement (the most-complete V2 migration), MastFlow process
  engine, variant-aware PO lines, cost-basis write.
- **Measure:** human — steps, SEQ; agent — coverage gaps explicitly logged; pass^k on the
  read/verify path; **collateral:** only target SKUs' inventory/cost changed.

---

### W5 — Reprice on material cost change  *(agent-operability showcase)*
**Job:** *When my metal/material price moves, I want to reprice affected products before my
margin erodes.* · **Persona:** owner · **Frequency:** as markets move · **Criticality:** margin protection.

- **Preconditions/seed:** products built from a spot-priced material; a price-lock or two.
- **Steps:** (1) record/observe a material spot-price shift → (2) list products whose margin
  now drifts → (3) simulate the impact → (4) reprice the affected set → (5) confirm new
  prices and that locked items were respected.
- **UI path:** studio/maker recipe + spot-price surfaces (◑ — the UI exposes less of this).
- **MCP path:** **richer than UI** — `mast_spot_prices` → `mast_recipes` action=`get_drift`
  / `list_needing_reprice` / `simulate_metal_shift` → `reprice`; `mast_price_locks` to verify
  locked items skipped.
- **Oracle:** repriced set == drifted set minus locked; new prices match simulation; locks
  untouched.
- **Functional coverage:** spot-price linkage, cost engine, price-lock guard, reprice write.
- **Measure:** **the standout Lens-2 finding** — agent task-success here with *low* token
  cost while the human path is multi-step/partial. Report the accuracy–cost gap between
  surfaces. pass^k(5); **collateral:** locked & non-drifted items unchanged.

---

### W6 — Understand the financial truth  *(money canary, agent-strong)*
**Job:** *When I need to know how the business is doing (or file taxes), I want accurate
financials.* · **Persona:** owner/bookkeeper · **Frequency:** weekly + period-end · **Criticality:** decisions + compliance.

- **Preconditions/seed:** a tenant with a quarter of orders/expenses (W2/W3 contribute).
- **Steps:** (1) check revenue (by channel) → (2) P&L → (3) AR aging → (4) sales-tax /
  nexus status → (5) run period close → (6) confirm numbers reconcile across reports.
- **UI path:** finance-v2 hubs (revenue, P&L, AR/AP, tax, period-close).
- **MCP path:** **strong, token-efficient** — `finance_get_revenue` / `_pnl` / `_ar_aging` /
  `_tax_summary` / `_nexus_status` / `_1099_prep` (10 read tools; ~184 B–1 KB each).
- **Oracle:** UI hub totals == MCP aggregate totals (the dual-source reconciliation);
  internal consistency (revenue − COGS − expenses == P&L net); cents-correct.
- **Functional coverage:** finance.js readers/aggregation, the cents boundary, P&L math,
  tax/nexus, period-close pipeline.
- **Measure:** human — can a non-accountant reach the right number (SEQ, errors); agent —
  tokens/task (should be tiny), pass^k; **the cross-surface number match is the key assertion.**

---

### W7 — Resolve a return / refund
**Job:** *When a customer wants to return an item, I want to process it and refund them
correctly.* · **Persona:** CS/owner · **Frequency:** weekly · **Criticality:** CX + money-out.

- **Preconditions/seed:** a completed order from W2.
- **Steps:** (1) customer/staff opens an RMA → (2) approve → (3) issue refund → (4) restock
  if applicable → (5) confirm refund recorded and order/finance reflect it.
- **UI path:** `rma` (orders.js/rma-admin) → return.workflow (MastFlow) → refund
  (transitionRma CF) → inventory/finance.
- **MCP path:** partial — `mast_orders`/`mast_cs_tickets` read + status; refund is a
  server-side CF (verify the agent can drive or only observe it).
- **Oracle:** refund amount == returned value (to the cent); order state == returned;
  inventory restocked; **cross-surface:** `finance_get_revenue`/AR reflect the reversal once.
- **Functional coverage:** RMA lifecycle, refund money path (client never writes money —
  CF delegator), restock, the two-call MCP confirmation handshake (if agent-driven).
- **Measure:** human — steps, SEQ; agent — pass^k, **and an adversarial check:** can the
  refund be over-issued or double-issued? **collateral:** only the target order moved.

---

### W8 — Run payroll & labor
**Job:** *When the pay period closes, I want hours, PTO, and labor cost right so I can pay my
team.* · **Persona:** owner/manager · **Frequency:** pay-period · **Criticality:** people + cost.

- **Preconditions/seed:** 1–2 employees on file.
- **Steps:** (1) clock in/out (or import hours) → (2) record PTO → (3) compute labor cost →
  (4) review commissions → (5) confirm totals.
- **UI path:** team.js (timeclock, PTO, payroll, commissions) via team-v2/employees-v2.
- **MCP path:** **fine-grained, good agent coverage** — `team_clock_in`/`_out`,
  `team_record_pto`, `team_set_pto_policy`, `team_get_labor_cost`, `team_get_time_entries`.
- **Oracle:** labor cost == Σ(hours × rate) + loaded costs; PTO balance correct;
  **cross-surface:** UI payroll total == `team_get_labor_cost`.
- **Functional coverage:** timeclock, PTO accrual, labor-cost rollup (the laborCost math
  left un-migrated in the MastFormat work), commissions.
- **Measure:** human — steps, SEQ; agent — granular-verb ergonomics (does fine-grained =
  more tool-calls/tokens than a coarse tool would?), pass^k; **collateral:** other employees
  untouched.

---

### W9 — Manage a customer / wholesale account  *(V1→V2 migration probe)*
**Job:** *When I work with a customer (esp. wholesale), I want their full picture and the
right pricing.* · **Persona:** owner/sales · **Frequency:** daily · **Criticality:** retention + AOV.

- **Preconditions/seed:** a customer with order history; a wholesale account with terms.
- **Steps:** (1) open the customer record → (2) review order history & lifetime value → (3)
  confirm wholesale status/pricing tier → (4) apply a segment filter to find a cohort → (5)
  take an action (e.g. tag / note / start an email).
- **UI path:** `customers-v2` (a V2 lens over the **still-live V1 customers.js** behind
  CustomersBridge — mid rip-and-replace) → contacts-v2 → segment filter
  (`MastCustomerFilters`).
- **MCP path:** partial — `mast_contacts` read; segment/wholesale logic may be UI-only.
- **Oracle:** record matches across surfaces; segment filter returns the correct cohort
  (the D4-005 over-inclusion bug class — already unit-pinned, here exercised end-to-end);
  wholesale pricing resolves correctly.
- **Functional coverage:** customers V1/V2 dual surface + Bridge single-sourcing, customer
  filters, wholesale pricing resolver. **Explicitly tests that the V2 default and Legacy
  opt-in both work.**
- **Measure:** human — steps, SEQ; agent — coverage gaps logged; **migration-correctness:**
  same result via V2 surface and (if reachable) the V1 path.

---

### W10 — Run a class / booking program  *(parity-gap probe — UI-only)*
**Job:** *When I teach classes, I want to schedule them and enroll students, so I can sell my
time.* · **Persona:** owner/instructor · **Frequency:** seasonal/weekly · **Criticality:** a whole second revenue line.

- **Preconditions/seed:** clean booking area.
- **Steps:** (1) create a class → (2) schedule session(s) → (3) enroll a student / sell a
  pass → (4) take attendance / redeem a pass → (5) confirm capacity & revenue.
- **UI path:** `classes-v2` + book.js (an 11-route sub-app: enrollments, instructors,
  passes, sessions, resources, calendar).
- **MCP path:** **none** — there is no `mast_classes`/`mast_book` tool. The agent **cannot
  operate this domain at all.**
- **Oracle:** class created, session scheduled, enrollment counted, capacity enforced,
  revenue booked.
- **Functional coverage:** the entire booking sub-app — a large, real domain with zero MCP
  coverage and zero automated test coverage today.
- **Measure:** human — steps, SEQ, errors (this is a complex sub-app — expect the lowest
  human SEQ of the ten); agent — **task-success = 0 by construction; that is the finding.**
  Quantifies the single largest agent-operability gap and feeds the Lens-3 "is the agent
  missing a whole revenue line?" decision.

---

## How the spine scores the three lenses

**Per workflow, per surface:**

| | Human UI | AI agent (MCP) |
|---|---|---|
| **Lens 1 — functional** | completed without error + oracle satisfied (pass/fail) | pass@1 **and pass^k** (k=5; all pass = reliable); **collateral-damage check** (AppWorld-style) on every mutating flow |
| **Lens 2 — ease of use** | task-success rate · # steps/clicks · time-on-task · error count · **SEQ** (post-task, 1–7) | **tool-calls · tokens · wall-clock · $ cost** — reported as an **accuracy–cost trade-off**, not headline success alone |

**Suite level:** SUS (human, post-suite) · a **workflow × surface × lens heatmap** · and a
**Lens-3 view** = the matrix above re-weighted by business criticality (which money-critical
or revenue-line workflows are weakly covered on either surface).

**What "good" looks like (industry anchors):** human SUS ≥ 68 (aim 80+), task-completion
≥ 78%, SEQ ≥ 5.5; agent pass@1 high *and* pass^k not collapsing (a 90% single-shot agent is
~57% at k=8 — reliability is the real bar); tokens-per-task tracked as the time-on-task analog.

---

## Deliberately excluded (and why)

- **Storefront/website builder, brand, lookbooks** — UI-only and **visual/aesthetic**; the
  right instrument is visual-regression + human review, not the dual UI/MCP task-success
  spine. Track separately.
- **Marketing authoring (newsletter/social/campaigns)** — UI-only authoring (MCP only sends
  transactional email); creative-quality is an LLM-as-judge/human problem, not task-success.
- **Tenant onboarding / channel & payment connect (OAuth, secret vault)** — important but a
  one-time setup job with external dependencies; better as a dedicated integration/contract
  suite (and several secrets can't be live-verified on `sgtest15`).

These exclusions are themselves Lens-3 signals: the agent surface is a **back-office
operator**, blind to the storefront/marketing/booking front-of-house.

---

## Next step (instrumentation — for approval)

1. **Seed fixtures + reset** — a deterministic `sgtest15`-style fixture so pass^k is
   repeatable and collateral checks have a known baseline.
2. **Pilot one workflow end-to-end on both surfaces** to prove the harness and the scorecard
   format before building all ten. **Recommended pilot: W3 (POS → books)** — smallest, but it
   exercises the money-canary cross-surface oracle that has caught the most real bugs.
3. **Decide the runner** — agent side via the MCP task set (token/cost capture built in); UI
   side via Playwright (the accessibility-tree route → also token-cheap and reusable for the
   future Planner/Generator/Healer on-ramp).
4. **Wire the scorecard** and decide what becomes a required gate vs. a nightly/operator sweep.
