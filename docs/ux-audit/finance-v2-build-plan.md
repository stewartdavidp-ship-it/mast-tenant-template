# finance-v2 — Build Plan

Status: **PLANNED** (2026-06-10). Runs `v2-conversion-playbook.md` end-to-end for the
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

| # | Route | Sidebar label | V1 source (finance.js) | Surface type | V2 target |
|---|-------|---------------|------------------------|--------------|-----------|
| 1 | `financials` | Overview | `renderFinanceOverview()` :6294 | read-only 6-tile dashboard | **statements hub** — Overview lens |
| 2 | `finance-revenue` | Revenue | `setupRevenueTab()` :486 | read-only period report | **statements hub** — Revenue lens |
| 3 | `finance-expenses` | Expenses | `setupExpensesTab()` :849 | CRUD list + review | ✅ exists (`finance-expenses-v2.js`) — deepen |
| 4 | `finance-pl` | P&L | `setupPlTab()` :1701 (admin-only) | read-only period report | **statements hub** — P&L lens |
| 5 | `finance-cash-flow` | Cash Flow | `setupCashFlowTab()` :2125 | read-only projection + Day-Close sub-view | **statements hub** — Cash lens; Day Close → close hub |
| 6 | `finance-ar` | AR | `setupArTab()` :3163 | aging queue + actions | **open-items hub** — Receivables lens |
| 7 | `finance-ap` | AP | `setupApTab()` :3755 | aging queue + bill/vendor CRUD | **open-items hub** — Payables lens |
| 8 | `finance-tax` | Tax | `setupTaxTab()` :4455 | read-only compliance report (sales tax / nexus / 1099) | **statements hub** — Tax lens (nexus+1099 panes) |
| 9 | `finance-reports` | Reports | `setupReportsTab()` :4920 | export launcher (6 CSV/PDF exports) | thin V2 wrapper, late wave |
| 10 | `customer-portfolio` | Customer Portfolio | `renderCustomerPortfolio()` :5943 | read-only analytics (HHI, quadrants) | read-only Record list + drill, late wave |
| 11 | `finance-period-close` | Period Close | `renderPeriodClose()` :6629 | process queue (Close v3) | **close hub** — Periods lens |
| 12 | `finance-amendments` | Amendments | `renderAmendments()` :6827 | approval queue (Close v3) | **close hub** — Amendments lens |

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

### Sidebar proposal (operator decision — module consolidation proceeds regardless)
12 items → **7**: Overview (statements hub) · Expenses · Open Items (AR/AP) ·
Period Close (close hub incl. Amendments) · Reports · Customer Portfolio · Tax
(or fold Tax's sidebar item into Overview's hub too → 6). Old routes keep working as
deep links into the right lens. Order = operator's process: *see the picture →
review expenses → chase money → close the books → export → analyze customers*.

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

### Wave 5 — holistic (walk FIRST, then PR)
Operator walk: every nav item, every record, **every CRUD verb incl. CREATE on a fresh
record** (new bill, new vendor, new amendment, new expense via legacy intake), every
link incl. cold cross-drills (order SO ← AR row from a fresh session). Then: sidebar
reorder + consolidation ratification, CRUD parity table, `lint-v2-standard` green.

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

- [ ] `app/modules/financials.js` is orphaned dead code — delete in holistic PR.
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
