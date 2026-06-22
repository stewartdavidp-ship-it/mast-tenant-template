# Capability × Importance × Coverage Matrix — Lens 3 (business value)

> **The Lens-3 "where to invest" artifact.** The next-gen testing program surfaced business
> value only as *gaps*; this turns it into a ranked, value-weighted matrix: every real
> capability × its business importance × how well it's covered on each of the three test
> surfaces (human **UI** · AI-agent **MCP** · **automated-test**). It makes *"where is high
> value weakly covered"* legible at a glance.
>
> **Kind:** periodic — refresh on any surface change (new MCP tool, new test, new module).
> Not a per-run gate. **Authored 2026-06-22**, verified against `origin/main` @ `f0c7b426`
> + the **live** mast-mcp tool surface (read-only, `golden-auric`/`sgtest15`). Machine-readable
> twin: [`value-coverage-matrix.json`](value-coverage-matrix.json).
>
> ⚠️ **Coverage is LIVE-verified, not copied from the ledger.** The re-verification found
> *positive drift* the 2026-06-20 scorecard missed — `mast_procurement` (W4) and
> `mast_production` (W2) now exist. See [§4 Coverage refresh](#4-coverage-refresh-the-ledger-was-stale).

---

## 1. How to read this

**Importance** (RICE-lite, value-weighted — anchors in [discovery §5E](../testing-program-discovery.md):
JTBD/ODI, RICE, outcomes-over-outputs). Three transparent signals, money weighted ×2:

`importanceScore = 2·money + frequency + revenueLine`  (0–11)

| Signal | 3 | 2 | 1 | 0 |
|---|---|---|---|---|
| **money** | moves money / books / compliance (`moneyCritical`) | margin- or cost-affecting | revenue-enabling (indirect) | non-money |
| **frequency** | daily | weekly | seasonal / pay-period | one-time |
| **revenueLine** | — | a whole revenue line / channel | revenue-enabling | supporting / back-office |

→ **Tiers:** 🔴 Critical ≥9 · 🟠 High 7–8 · 🟡 Med 4–6 · ⚪ Low ≤3.

**Coverage**, per surface: ✅ full · ✅✅ richer-than-UI · ◑ partial/oracle · ⚠️ gap (wrong/thin
data, or boot-render only — no behavioral assertion) · ➖ none.

The **⚠️ VAR** flag marks a value-at-risk cell: a Critical/High capability weakly covered on a
money/revenue surface. Those are pulled out and ranked in [§3](#3-value-at-risk--ranked).

---

## 2. The matrix (by module — the 9-module catalog)

| Module | Capability (workflow) | Importance | UI | Agent / MCP | Automated-test | VAR |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **Sell** | List a product for sale (W1) | 🟠 High (7) | ✅ | ✅ | ◑ partial | |
| **Sell** | In-person POS sale → books (W3) | 🔴 **Crit (10)** | ✅ | ◑ oracle¹ | 🟢 proven | |
| **Sell** | Online storefront purchase (W2-front) | 🔴 **Crit (10)** | ✅ | ◑ partial² | ◑ partial | |
| **Sell** | Manage customer / wholesale acct (W9) | 🟡 Med (6) | ✅ | ⚠️ **gap (F9)** | 🟢 proven | ⚠️ |
| **Make** | Recipe / BOM costing & price-from-cost (W1/W5) | 🟠 High (7) | ◑ | ✅✅ richer | ◑ partial | |
| **Make** | Reprice on material cost change (W5) | 🟠 High (7) | ◑ partial | ✅✅ richer | ➖ **none** | ⚠️ |
| **Make** | Production / build job (W2-mid) | 🟠 High (7) | ✅ | ✅ **⬆️ new** | ◑ partial | |
| **Ship** | Fulfill → pack → ship → delivered (W2) | 🔴 **Crit (10)** | ✅ | ◑ partial³ | ◑ partial | ⚠️ |
| **Ship** | Restock from low inventory / PO (W4) | 🟠 High (8) | ✅ | ✅ **⬆️ new** | ➖ **none** | ⚠️ |
| **Ship** | Resolve a return / refund (W7) | 🟠 High (8) | ✅ | ◑ partial | ➖ **none** | ⚠️ |
| **Market** | Campaign / newsletter / social authoring | 🟡 Med (5) | ✅ | ➖ none⁴ | ➖ none⁴ | ⚠️ |
| **Show** | Events / craft-fair (shows, booths, vendors) | 🟡 Med (6) | ✅ | ◑ partial⁵ | ➖ none | |
| **Run** | Understand the financial truth (W6) | 🟠 High (8) | ✅ | ✅✅ richer | 🟢 proven | |
| **Run** | Run payroll & labor (W8) | 🟠 High (7) | ✅ | ✅ | ◑ partial | |
| **Run** | Expenses & bookkeeping | 🟠 High (8) | ✅ | ✅ | ◑ partial | |
| **Web** | Storefront / website / brand builder | 🟠 High (7) | ✅ | ➖ none⁴ | ⚠️ structural⁴ | ⚠️ |
| **Book** | **Run a class / booking program (W10)** | 🔴 **Crit (10)** | ✅ | ➖ **none (F11)** | ⚠️ structural | ⚠️🔴 |
| **Manage** | Product lifecycle & inventory accuracy (W1/W4) | 🟠 High (7) | ✅ | ✅ | ◑ partial | |
| **Manage** | Tenant onboarding / channel & payment connect | 🟡 Med (5) | ✅ | ◑ partial | ◑ partial | |
| **Manage** | Settings / users / RBAC governance | ⚪ Low (3) | ✅ | ◑ partial | ◑ partial | |

¹ POS create is UI-only **by design**; the agent is the cross-surface **oracle** (finance + inventory before/after).
² Storefront-gated by design; agent uses `mast_orders create_test` on test tenants; order reads protected (F2 handshake).
³ Production now agent-covered (⬆️), but **pack/ship has no MCP tool** — the agent can't close the loop to *delivered*.
⁴ **By design** outside the dual spine — creative/aesthetic surfaces; the right instrument is **visual-regression + human review** (not task-success). `theme-sanity.html` is an unreferenced rotting copy.
⁵ `mast_events` full CRUD **exists** (shows/booths/vendors) but every read triggers the **protected handshake** (agent friction). NB: the **Show** module (markets) ≠ the **Book** module (classes) — distinct domains.

**Test legend:** 🟢 proven = behavioral/value regression net · ◑ partial = engine/parity-pinned ·
⚠️ structural = boot-smoke route render only · ➖ none. Backbone = 35 `test/*.test.js` + 20
`lint-*.js` (incl. 3 SHA-pinned UI↔MCP parity guards) + `money-canary.test.js` + the 67-route
fail-closed Playwright boot-smoke.

---

## 3. Value-at-risk — ranked

The cells where a **Critical/High** capability is **weakly covered** on a money/revenue surface.
This is the Lens-3 "where to invest" list.

| # | Capability | Importance | Weak surface | Why it's at risk |
|---|---|---|---|---|
| **1** | **Book · classes/booking (W10)** | 🔴 Crit (10) | agent ➖ + test ⚠️ | **F11** — a whole second revenue line is invisible to the agent **and** has zero behavioral test. Highest importance × lowest coverage in the matrix. |
| **2** | Ship · return/refund (W7) | 🟠 High (8) | agent ◑ + test ➖ | Money-**out** with a real double/over-refund adversarial risk, entirely untested; the agent likely can't drive the refund CF. |
| **3** | Ship · restock/PO (W4) | 🟠 High (8) | test ➖ (agent now ✅) | Agent write power was **just added** (`receive`→CF restock + cost-basis), but the PO→receive→restock→cost-basis money path has **no regression net**. New write power, zero guard. |
| **4** | Make · reprice (W5) | 🟠 High (7) | test ➖ + UI ◑ | Margin-critical; agent-strong but no drift/reprice regression and the weakest human surface of the Make flows — *locks-respected* correctness is unguarded. |
| **5** | Web · storefront/brand + Market · authoring | 🟠 High (7) / 🟡 Med (5) | agent ➖ + test ⚠️/➖ | Revenue-enabling front-of-house, but **by design** outside the task-success spine — the correct instrument is **visual-regression + human review**, which doesn't exist yet. |
| **6** | Sell · customer value metrics (W9) | 🟡 Med (6) | agent ⚠️ gap | **F9** — the customer base and every value metric (LTV/wholesale/segment/lapse) is invisible to the agent; `mast_contacts` is a different thin collection. |
| **7** | Ship · fulfillment tail — pack/ship (W2) | 🔴 Crit (10) | agent ◑ | Production now agent-covered, but pack/ship has no tool — the agent can't reach *delivered*. Lower priority (fulfillment is legitimately hands-on) but a real residual gap on a Critical flow. |

### Prioritized recommendations ("where to invest")

> Building any tool below is a **separate product decision** — the matrix *recommends*, it does not build (out of scope per the mission).

1. **Add a `mast_classes` / `mast_book` MCP tool** *(VAR-1 · F11 · C17)* — unblocks a whole revenue line for the agent; the single highest importance × lowest coverage cell.
2. **Build a refund oracle with an over/double-refund collateral check** *(VAR-2 · W7)*; verify the agent can *drive* the refund CF, not just observe — the AppWorld-style collateral check the spine flagged.
3. **Extend the money-canary to a procurement/restock canary** (PO→receive→on-hand + cost-basis, to the cent) *(VAR-3 · W4)* — pin the newly agent-writable money path before it drifts.
4. **Add a `mast_customers` MCP tool** (LTV/wholesale/segment/spend), distinct from the thin `mast_contacts` *(VAR-6 · F9 · C4)* — surfaces the customer-value layer the agent is blind to.
5. **Add a reprice regression** (drift → reprice → locks respected) + close the UI parity gap *(VAR-4 · W5)*.
6. **Stand up a visual-regression layer** (Playwright snapshot / Chromatic) for Web/Market *(VAR-5)* — the correct instrument for the by-design creative gap; keep it separate from the task-success spine.
7. **Make "re-verify the live MCP tool surface" a step of every matrix refresh** *(§4)* — W4/W2 drifted *positive* in two days and the ledger went stale. Coverage is a moving target; verify against the live registry, never memory.

---

## 4. Coverage refresh — the ledger was stale

Live re-verification (2026-06-22) found the matrix is **more covered** than the 2026-06-20
scorecard claimed. Logged so the ledger is *corrected*, not just the gaps — and as evidence
for recommendation #7. (Logged as **F20** in the findings ledger.)

| Capability | Ledger said (2026-06-20) | Live truth (2026-06-22) |
|---|---|---|
| **W4 restock/PO** | agent ◑ — *"PO write UI-only (no clear tool)"* | agent ✅ — `mast_procurement` full lifecycle incl. `receive`→CF restock; `mast_vendors`; `materials_cost_history`. Tool works live (empty PO list on `golden-auric`, not an error). |
| **W2 production** | agent ➖ — *"no production/pack MCP tools"* | agent ✅ (production) — `mast_production` job/line-item/request lifecycle; **3 live jobs** on `golden-auric`. *(Pack/ship still UI-only — see VAR-7.)* |
| **W6 financials** | agent returned gross/net with no caveat (**F14**) | agent now returns `marginReliable` / `cogsLineMissingCount` / `cogsMissing` (F14 **closed**, mcp #141; verified live `golden-auric`: `marginReliable:false, missing 10`). |

**F9 and F11 still hold** (live-confirmed): no `mast_customers` (contacts is a thin 50-record
`name/email/phone/category` collection — no value metrics); no classes/booking tool
(`mast_events`=shows/booths, `mast_missions`=QA scenarios, `trips`=mileage — none cover the
booking sub-app).

---

## 5. Headline

Of **4 Critical + 11 High** capabilities, the sharpest value-at-risk cells are: **Book/classes**
(agent + test blind — a whole revenue line), **returns/refund** (untested money-out),
**restock/PO** (new agent write power, no regression net), and **reprice** (margin-critical,
untested + weak UI). The agent's **Make/Ship operability materially improved** (W4/W2) since the
spine was first scored — so the standing instruction is: **re-verify the live surface each refresh.**

*Companion docs: [testing-workflows-spine.md](../testing-workflows-spine.md) (W1–W10 specs) ·
[suite-scorecard.json](suite-scorecard.json) (per-workflow rollup) ·
[oracle-templates.md](oracle-templates.md) (findings ledger F1–F20) ·
[usability-runbook.md](usability-runbook.md) (the Lens-2 human instrument).*
