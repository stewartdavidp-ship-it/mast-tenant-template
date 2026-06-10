# finance-v2 — Build Plan

Status: **SHIPPED** (2026-06-10 — plan #399, Wave 1 #400, Wave 2 #401, SO-fix #402,
Wave 3 #403, Wave 4 #404, holistic this PR; all merged & verified on dev). Runs `v2-conversion-playbook.md` end-to-end for the
Finance section (sidebar `data-section="finance"`, 12 sub-items). Companion to
`sales-v2-build-plan.md` / `marketing-v2-build-plan.md` / `operations-v2-build-plan.md`
(worked examples) and `standard-record-ui.md` §10 (archetypes) — ratified decisions are
applied here, not re-litigated.

**Operator directive — CONSOLIDATE.** Finance has 12 sidebar items but the code says it
is ~5 surfaces. This plan consolidates at the *module* level using the Pack+Ship
mechanism (one module serves several routes; the route only picks the entry lens) and
*proposes* sidebar merges for the operator to ratify in the holistic PR. QBO Sync →
Settings/Integrations is the trimming precedent.

**Recon amendments (verified against live code before planning):**
1. `app/modules/financials.js` (350L, Square sales ledger) is **orphaned dead code** —
   not in `MODULE_MANIFEST`; finance.js:6291 says so explicitly. Route `financials` is
   served by `renderFinanceOverview()` in finance.js (W2.1 dashboard). The dead file is
   a deletion candidate (debt register), not a conversion target.
2. `finance-period-close` / `finance-amendments` are intentionally absent from
   `mode-module-info.js` (admin-managed Close-v3 surfaces, not Add-to-Mast cards) but
   ARE in `MODE_ROUTE_VISIBILITY` (index.html:20670) — **no orphan fix needed**, but new
   V2 route ids must be added to `MODE_ROUTE_VISIBILITY` or lint fails.

## The V1 reality

Everything below lives in **one 8,052-line `app/modules/finance.js`** (plus the
existing 301-line `finance-expenses-v2.js` twin). Zero MastUI/MastEntity usage in
finance.js — every surface is hand-rolled. A global period selector
(`window._finPeriod`, resolved by `_finResolvePeriod()`) anchors Revenue, P&L,
Cash Flow, Tax, and Reports. Shared private helpers that V2 must NOT re-implement:
`_orderRevenueCents()` (finance.js:62 — `totalCents` preferred, legacy `total` is
DOLLARS ×100), `_loadRevenueAggregate()` (:526), `computePnlLocal()` (:1749, with the
W3.5 burden enrichment and the R-FIN-2 missing-COGS sentinel), the aging-bucket math
(AR :3236 / AP :3811, identical), `isTestOrder()` (:176). These get exposed on a
**`window.FinanceBridge`** (state-free cores on the legacy module — Mapping/Studio/
Channels precedent) rather than copied.

## Scorecard — the 12 Finance routes

| # | Route | Sidebar label | V1 source (finance.js) | V2 home (SHIPPED) | Status |
|---|-------|---------------|------------------------|-------------------|--------|
| 1 | `financials` | Overview | `renderFinanceOverview()` | finance-statements-v2 — Overview lens | ✅ W1 |
| 2 | `finance-revenue` | Revenue | `setupRevenueTab()` | finance-statements-v2 — Revenue lens | ✅ W1 |
| 3 | `finance-expenses` | Expenses | `setupExpensesTab()` | finance-expenses-v2 (pre-existing) + period window | ✅ W4 deepened |
| 4 | `finance-pl` | P&L | `setupPlTab()` (admin-only) | finance-statements-v2 — P&L lens (RBAC-filtered pill) | ✅ W1 |
| 5 | `finance-cash-flow` | Cash Flow | `setupCashFlowTab()` | finance-statements-v2 — Cash lens; Day Close → close hub | ✅ W1 |
| 6 | `finance-ar` | AR | `setupArTab()` | finance-openitems-v2 — Receivables lens | ✅ W2 |
| 7 | `finance-ap` | AP | `setupApTab()` | finance-openitems-v2 — Payables (+Vendors) lens | ✅ W2 |
| 8 | `finance-tax` | Tax | `setupTaxTab()` | finance-statements-v2 — Tax lens (nexus/1099 stay classic) | ✅ W1 |
| 9 | `finance-reports` | Reports | `setupReportsTab()` | finance-reports-v2 launcher (generators classic) | ✅ W4 |
| 10 | `customer-portfolio` | Customer Portfolio | `renderCustomerPortfolio()` | customer-portfolio-v2 (drills to customers-v2) | ✅ W4 |
| 11 | `finance-period-close` | Period Close | `renderPeriodClose()` | finance-close-v2 — Periods lens | ✅ W3 |
| 12 | `finance-amendments` | Amendments | `renderAmendments()` | finance-close-v2 — Amendments lens | ✅ W3 |

**Operator-walk findings (2026-06-10, all 12 routes + every CRUD verb incl. CREATE):**
1. **Live CF bug found by the approve walk** — `approveAmendment`/`rejectAmendment`'s
   no-hint collection-group lookup throws INTERNAL (`FieldPath.documentId()` rejects bare
   ids). Template-side fix shipped in this PR: clients always pass `periodId` (the CF's
   working fast path); the server-side fix is filed against mast-architecture.
2. Walk exercised: statements lenses ×5 + per-lens export; expense open/edit/approve/
   delete + period pills; AR remind (idempotent queue write) / mark-paid / cold drill to
   the orders-v2 SO; AP bill create/edit/partial-payment/mark-paid/delete + vendor
   create + vendor drill; April period CLOSED through the real `writePeriodClose` CF;
   June close correctly blocked with the 30-day unclosed-days guard; amendment submitted
   against closed April and APPROVED (counter-entry minted) with the periodId fix.
3. The earlier wave-2 verify caught the engine's `detail.render(MastUI, record)`
   signature (blank bill SO) — fixed in #402 and registered for the playbook.

## CONSOLIDATION (the heart of this round)

Three hub modules absorb 9 of 12 routes. Routes stay alive (deep links, RBAC axes,
`MAST_V2_ROUTE_MAP` entries per route → same module); the route picks the entry lens.

### Hub 1 — `finance-statements-v2` (5 routes: financials, finance-revenue, finance-pl, finance-cash-flow, finance-tax)
*Evidence:* all five are read-only, all anchored on the same `_finPeriod` selector, all
read the same orders/sales/expenses aggregates through shared loaders
(`_loadRevenueAggregate`, `computePnlLocal`); Revenue is literally a sub-lens of P&L
(its revenue section). Cash Flow differs only in basis (cash timing + Plaid balance vs
accrual). Tax reads the same orders (`taxCents`-by-state) on the same period anchor;
its Nexus + 1099 sections become secondary panes within the lens.
*Shape:* one page, `pageHeader` + period selector + lens pills
(**Overview · Revenue · P&L · Cash · Tax**), tiles + tables per lens, CSV export per
lens via the existing `_finExporters` registry. Closest archetype is the calendar
*index control* (read-only, no SO records) — extended engine-first, not forked.
All aggregation stays in FinanceBridge (P&L admin-only RBAC preserved per lens).
*Day Close v3* (`?subView=dayclose` under cash-flow) is **process, not statement** — it
moves to the close hub; the Cash lens links to it.

### Hub 2 — `finance-openitems-v2` (2 routes: finance-ar, finance-ap)
*Evidence:* identical aging-bucket math and identical summary-card layout over two
collections (AR = `orders` with `invoiceStatus∈{sent,overdue}`; AP =
`admin/purchaseReceipts` with `paymentStatus∈{unpaid,partial}`). Same "what do I chase
next" job.
*Shape:* **Queue** archetype, lens pills (**Receivables · Payables**), bucket count
pills (current/1–30/31–60/61–90/90+). Row click opens the underlying record SO
(AR row → order SO via `MastEntity.drill`; AP row → bill SO native to this module).
AR actions (send reminder → emailQueue, customer statement) and AP writes (mark paid,
partial payment, new bill, new vendor) delegate to FinanceBridge cores extracted from
the DOM-coupled V1 handlers. AR dunning settings + audit-log sub-views stay legacy
(linked escape hatches).

### Hub 3 — `finance-close-v2` (2 routes: finance-period-close, finance-amendments, + day-close entry)
*Evidence:* one feature — "Close v3" (sidebar comment, shared Idea id at finance.js:8047)
— shared `closes/day/*` + `closes/period/*` versioned subcollections, shared
immutability model (closed = immutable; corrections = amendment → counter-entry in the
next open period), all writes through CFs (`writeDayClose`, `writePeriodClose`,
`approveAmendment`, `rejectAmendment`) which are **already state-free** — no bridge
extraction needed (mapping-v2 precedent: thin queue UI over CFs).
*Shape:* **Queue/process**, lens pills (**Periods · Day Closes · Amendments**). Periods
lens = 12-month status table + Close action (guard surfaces the unclosed-days list with
links to the Day-Close lens). Amendments lens = pending-first approval queue with
before/after diff, Approve gated on the existing `approveAmendment` RBAC action
(index.html:16389). **Immutability is design**: closed periods and decided amendments
render read-only — no edit/delete affordances, ever; re-close creates a new version.

### Evaluated, decided AGAINST consolidating
- **Overview vs Reports:** no overlap — Overview is an as-of-today dashboard; Reports
  is an export curator. Reports stays its own (thin) surface.
- **Expenses into open-items:** expenses are reviewed transactions, not aging
  obligations; different job, and a shipped V2 twin already exists.
- **Customer Portfolio into Retention:** it's a *finance* lens on customers
  (margin/contribution/concentration). Stays in Finance; drills to customers-v2.

### Sidebar proposal — ✅ RATIFIED + SHIPPED (2026-06-10)
Operator ratified the merge AND a plain-language naming rule: "Finance" as a bucket is
fine, but financial *terms* lose the small-business owner. Under the V2 nav the 12
items collapse to **7**: **Overview · Expenses · Invoices & Bills · Close the Books ·
Tax · Reports · Customer Portfolio** ("Invoices & Bills" over "Open Items"/"AR/AP" —
QuickBooks' nouns, validated against QBO/Xero IA; "Close the Books" over "Period
Close"; the P&L lens pill reads "Profit & Loss"). Legacy UI keeps the original 12
byte-identical (`.fin-merged-v1`/`.fin-merged-v2` + `body.nav-v2` CSS gate). All 12
routes stay live as deep links; merged entries claim their absorbed routes via
`data-route-alt` so the active highlight follows.

## Money-field semantics (finance data is money — normalize on READ, in the bridge)

| Collection.field | Unit | Rule |
|---|---|---|
| `orders.totalCents` / `.total` | CENTS / DOLLARS | `FinanceBridge.orderRevenueCents()` only; never raw |
| `orders.taxCents` / `.tax` | CENTS / DOLLARS | same dual-field pattern |
| `orders.invoicePaidAmount` | CENTS | due = totalCents − invoicePaidAmount |
| `admin/sales.amount` | CENTS | processor-native |
| `admin/expenses.amount` | CENTS | |
| `admin/purchaseReceipts.amountCents` / `.paidAmount` | CENTS | |
| `products.costCents`, `orders.items[].cogsCents` | CENTS | COGS chain: snapshot → product → R-FIN-2 sentinel (`—`, never fake 99.9% margins) |
| `closes/*.{opening,closing,variance}CashCents` | CENTS | |
| Plaid `accounts[].currentBalance` | **DOLLARS (float)** | convert at the bridge boundary |

## Waves (sequenced by end-to-end demo value)

### Wave 0 — demo-data audit + scrub (sgtest15, before building)
Audit: orders w/ invoice fields, `admin/sales`, `admin/expenses`,
`admin/purchaseReceipts`, `admin/vendors`, `closes/day` + `closes/period`,
`amendments/*/items`, `admin/customers` trailing-12m fields, nexus/dunning config.
No test/demo/harness strings (incl. `source` fields); hard deletes reported.
Key fixtures: open AR invoices across aging buckets, unpaid/partial AP bills with
vendors, a closable month of day closes + one open month, a pending amendment,
expenses across categories/review states.

### Wave 1 — `finance-statements-v2` (the picture)
Biggest visual demo; zero write risk (read-only). FinanceBridge exposure of the
aggregation cores + the five lenses + per-lens CSV export + period selector.
*Demo:* MTD revenue → flip to P&L → margin with burden → Cash horizon → tax by state.

### Wave 2 — `finance-openitems-v2` (chase the money)
Queue + bridge-extracted AR/AP write cores. Bill SO (create/edit/mark-paid/partial/
delete-unpaid), vendor create, AR reminder + statement actions, drill AR row → order SO.
*Demo:* see 90+ bucket → open overdue invoice → send reminder → flip to Payables →
record a partial payment → new bill.

### Wave 3 — `finance-close-v2` (close the books)
Thin queue UI over the Close-v3 CFs; immutability rendered, not re-argued.
*Demo:* close May (guard lists an unclosed day → open it → close it → close the month)
→ submit an amendment against the closed month → approve it → counter-entry reference.

### Wave 4 — depth + the long tail
- `finance-expenses-v2` deepening: period window (read `_finPeriod`), bank-sync status
  link-out; bulk approve stays legacy (engine has no row-checkbox yet — debt).
- `customer-portfolio-v2`: read-only Record list (concentration tiles + quadrant list),
  rows drill to customers-v2 SO (cold-drill safe).
- `finance-reports-v2`: thin pageHeader wrapper over the export launcher.
- Cross-links: statements Cash lens → close hub; statements tiles → open-items lenses;
  portfolio → customers-v2; close guard → day-close lens.

### Wave 5 — holistic (walk FIRST, then PR) — ✅ DONE
Walk ran before this PR (findings above). This PR: sidebar reordered around the
operator's process (statements → expenses → open items → close → reports → portfolio),
orphaned `app/modules/financials.js` deleted, amendment periodId fix, plan doc closed
out. Sidebar 12→7 item merge remains a PROPOSAL for operator ratification (routes
already collapse into 3 hubs at the module level regardless).

## CRUD parity — target end-state

| Surface | C | R | U | D | Notes |
|---|---|---|---|---|---|
| statements (5 lenses) | n/a | ✅ | n/a | n/a | read-only by design; export per lens |
| expenses | classic (import/Plaid) | ✅ | ✅ | ✅ | exists; approve/personal/delete; QBO push kept |
| open-items: AR | n/a | ✅ | ✅ (reminder/statement) | n/a | invoices are orders — lifecycle lives there |
| open-items: AP bills | ✅ | ✅ | ✅ (payments) | ✅ unpaid-only | paid bills immutable (audit trail) |
| open-items: vendors | ✅ | ✅ | ✅ | ⬜ | delete blocked while bills reference vendor |
| close: periods/days | ✅ (close action) | ✅ | re-close = new version | **never** | CF-enforced immutability |
| close: amendments | ✅ | ✅ | approve/reject only | **never** | decided amendments immutable |
| customer-portfolio | n/a | ✅ | n/a | n/a | analytics; writes live on customers-v2 |
| reports | n/a | ✅ | n/a | n/a | export launcher |

Every delete: `mastConfirm` + `writeAudit` + RBAC `can(route,'delete')`.

## Debt / known leftovers (tracked, not blocking)

- [x] **mast-architecture CF fix SHIPPED** (arch #185, merged `c864ac7`, dev-deployed
      2026-06-10): the no-periodId fallback now enumerates period parents via
      `listDocuments()` + a single `getAll` probe, with a hermetic test suite whose fake
      Firestore has no `collectionGroup` (regression fails loudly). Live-verified on
      sgtest15: `rejectAmendment` without periodId returns `not-found`, not INTERNAL.
      Prod rides the normal release pipeline (dirty bit set). The template's periodId
      threading stays as the fast path.
- [ ] Amendments lens refresh after classic-modal submit is manual (Refresh button) —
      the classic modal's success callback re-renders the legacy tab, not the hub.

- [x] `app/modules/financials.js` deleted (holistic PR).
- [ ] Bulk approve / multi-select on expenses stays legacy (engine lacks row checkboxes).
- [ ] AR dunning-settings + AR audit-log sub-views stay legacy (linked).
- [ ] Bank-sync (Plaid) status cards + Reconnect/Retry stay legacy (infrastructure UI).
- [ ] Tax Nexus registration *editing* stays legacy; V2 lens is read-only.
- [ ] Report *generation* internals (loan report, tax package) stay legacy behind the
      thin V2 launcher.
- [ ] No `shared/finance-*.js` — helpers exposed via FinanceBridge on finance.js; if a
      second consumer outside the admin app appears, promote to shared/ with tests.
- [ ] `paidAmount` on purchaseReceipts lacks a `Cents` suffix though it holds cents —
      naming-convention violation to clean up server-side someday.
- [ ] Period selector remains `window._finPeriod` global — V2 reads it through the
      bridge; a proper engine-level period control is a future engine ticket.
