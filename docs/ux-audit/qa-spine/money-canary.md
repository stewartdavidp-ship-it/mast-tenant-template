# Money Canary — cross-surface VALUE assertion

> The genuinely-missing testing layer (QA spine Phase 3, item 3). Built 2026-06-22.
> Companion: [phase-3-plan.md](phase-3-plan.md) · [README.md](README.md) · [oracle-templates.md](oracle-templates.md).

## Why it exists

The three existing **parity guards** (`lint-channel-normalization-parity`,
`lint-readiness-parity`, `lint-labor-parity`) SHA-pin vendored cores so the admin UI
and the tenant MCP run **byte-identical code**. That proves the *code* is equal. It does
**not** prove the two surfaces produce the **same number** from the same data — a reader
can drift in a path the pinned core doesn't cover (cents-vs-dollars, a missing dedup, an
un-normalized group key, a withheld-vs-returned margin).

The money canary closes that gap: it asserts that **the same money figure agrees across
surfaces — storefront ↔ admin ↔ MCP ↔ finance — and fails loudly on divergence.** It
targets the exact recurring bug class:

| Bug class | Example caught |
|---|---|
| cents-vs-dollars | `order.total` is **dollars**, `order.totalCents` is **cents**; the SGTE-0187 "cents-in-the-dollar-field" shape ($1,020 read as $102,000) |
| 100× | `admin/sales.amount` is already cents; a stray `*100` inflated POS rows 100× (#134/#537) |
| POS double-count | a POS-square sale writes a canonical `orders` row **and** an `admin/sales` mirror; summing both double-counts (F-dedup) |
| channel-key fragmentation | `pos`+`direct-pos`, `online`+`Online Store` splitting one real channel (**F1**) |
| Timestamp coercion | a Firestore `Timestamp` `createdAt` breaking a money read/sort (F15 family) |
| P&L margin withholding | UI withholds gross/net when COGS is incomplete; MCP must signal the same (**F14**) |

These are precisely the findings that needed **cross-surface** discovery — a single-surface
suite misses them (F1, F5, F14 each required comparing two surfaces).

## The two pieces

### 1. Deterministic backbone — `test/money-canary.test.js` (CI-gated)
A **committed golden fixture** — `test/fixtures/money-canary.golden.json` (orders, POS sales,
expenses, journal entries, products, AR invoices carrying **every** trap shape above) — grounded
in and cross-checked against the live **"Auric & Oak"** demo golden tenant (`golden-auric`, captured
2026-06-22 via the mast-mcp finance tools; provenance in the fixture header) plus hand-authored
edge records for the bad-data traps the clean tenant lacks. It is run through the **REAL shipped UI
aggregators**: the pure helpers (`_orderRevenueCents`, `_salesCents`, `_salesRowCounts`,
`isTestOrder`, `_agingBucket`) and `finance-statements-v2.js`'s `marginText` are regex-extracted
and eval'd, while the four entangled async aggregators (`_loadRevenueAggregate`, `computePnlLocal`,
`_arAgingSnapshotCore`, `_computeTaxByState`) are extracted **whole** and run against a **fake
MastDB** (the engine-hardening vm pattern), so a regression in the real loop body — not just a
helper — turns the test RED. The `shared/channel-normalization.core.js` core (`MastChannels`, the
same code the MCP aggregates on) does the channel grouping. Every figure + reliability flag is
asserted against the committed **expected manifest** (`test/fixtures/money-canary.expected.json`) to
the cent. Coverage: revenue + by-channel canonicality (**F1**), cents-vs-dollars / 100× (**SGTE-0187**),
POS double-count, Timestamp coercion, P&L + the **F14** margin-withhold gate, **F5** tax-by-state
(stateless-order surfacing), and AR aging buckets (incl. partial payment). A `divergence demonstration`
block proves the fixture *discriminates*, and the **F14 + F1 negative controls are demonstrated**
(neutralize the withhold gate or the `pos→in_person` mapping in the real source → the canary goes
RED). Wired into the `lint.yml` `&&`-chain next to the other finance tests; no network, runs in CI.

### 2. Live probe — `scripts/qa-spine/money-canary.mjs` (supervised)
The live half, in the `w3-pos-ui.mjs` harness style. Two layered modes:

- **(A) Oracle self-check** — runnable today, **no auth, no browser**. The agent runs the MCP
  sequence (`finance_get_revenue`, `finance_get_pnl`) and saves each payload as JSON; the probe
  codifies the **W6 reconciliation matrix** as an executable gate: `revenue.total==pnl.revenue`,
  `gross==revenue-cogs`, `net==gross-opex`, `marginReliable==!(cogsLineMissingCount>0||cogsMissing)`,
  `Σ byChannel==total`, and **every channel key is canonical** (would catch F1 live).
- **(B) UI cross-check** — needs a **writable authed** Playwright `storageState` (testmode is
  read-only DOM). Drives the admin finance hub, reads the UI's own computed revenue + the margin
  cell, and asserts **UI total == MCP total** (to the cent) and **UI margin-withheld ⟺ MCP
  `marginReliable:false`**. Playwright is imported lazily so (A) runs in plain node.

Exit 0 = all surfaces agree; 1 = divergence (a money bug — or a stale cached bundle: hard-reload
and re-run); 2 = bad invocation.

```bash
# (A) oracle self-check — supply the two MCP payloads for the SAME period:
MONEY_REVENUE_JSON=rev.json MONEY_PNL_JSON=pnl.json node scripts/qa-spine/money-canary.mjs
# (B) + the rendered admin surface:
MONEY_REVENUE_JSON=… MONEY_PNL_JSON=… MAST_BASE_URL=https://<tenant>.<host> \
  MAST_STORAGE_STATE=storageState.json node scripts/qa-spine/money-canary.mjs
```

## Cross-surface contract (verified 2026-06-22 against canonical refs)

| Figure | UI (`app/modules/finance.js`) | MCP (`mast-mcp-server` origin/main `78e3089`, `src/tools/mast-finance.ts`) |
|---|---|---|
| order revenue | `_orderRevenueCents(o)` — prefer `totalCents`, else `total*100` | `(o.total||0)*100` — **residual divergence**, see below |
| POS-sale revenue | `_salesCents(s)` (never `*100`) | `salesCents(s)` ✓ matches |
| dedup / void | `_salesRowCounts(s)` (skip voided + `orderId` mirror) | `salesRowCounts(s)` ✓ matches |
| channel group | `_chan` → `MastChannels.normalize` | `normalizeChannel` (same shared core) ✓ matches |
| P&L margin gate | `marginText`: withhold `'—'` ⟺ `cogsLineMissingCount>0 || cogsMissing` | `marginReliable = !(cogsLineMissingCount>0 || cogsMissing)` ✓ matches (#141) |

### F14 — RESOLVED + deployed
The UI's admin P&L withholds gross/net margin when COGS is incomplete; the MCP `finance_get_pnl`
used to return gross/net with no such signal, so an agent got numbers the UI deemed unreliable.
mast-mcp-server **#141** added `marginReliable` / `cogsLineMissingCount` / `cogsLineCoveredCount`
/ `cogsMissing` to the tool, computed by the **same formula** as the UI
(`finance.js` `computePnlLocal`). **Live-verified on `sgtest15` 2026-06-22:** `finance_get_pnl`
→ `marginReliable:false, cogsLineMissingCount:22, cogsLineCoveredCount:31, cogsMissing:false`.
The divergence is closed; the contract is pinned by the F14 cases in `money-canary.test.js` so it
cannot silently re-diverge. **Chip `task_14a258f4` → CLOSED.**

### F19 — residual order-`totalCents` divergence (open, latent)
The MCP order loop reads `(o.total||0)*100`, while the UI reads `_orderRevenueCents` (which
prefers `totalCents`). They agree for well-formed orders but diverge **100×** on the
"cents-in-the-dollar-field" bad-data shape (SGTE-0187/0188: `total:102000` **and**
`totalCents:102000` → UI $1,020, MCP $102,000). It does **not** currently move `sgtest15`'s
aggregate (those rows aren't inflating the live $93,168.51 total), but it is a real latent
divergence. **Fix:** adopt an `orderRevenueCents` helper in `mast-finance.ts` (prefer `totalCents`),
mirroring the UI — a cross-repo MCP chip. Pinned by the `cents-vs-dollars` case in the test.

## Maintenance
- Changing the channel taxonomy: edit **both** copies of `channel-normalization.core.js`,
  re-bless the SHA in both parity checks, bump `MAST_MODULES_V` (per the core's header).
- Changing the money math (cents rules, dedup, margin gate): update the helper in `finance.js`
  **and** its MCP twin, then update the canonical oracle in `money-canary.test.js` (the
  extraction makes the test fail until you do — by design).
- New money surface (storefront cart total, a new finance reader): add it to the contract table
  and a case to the test.
