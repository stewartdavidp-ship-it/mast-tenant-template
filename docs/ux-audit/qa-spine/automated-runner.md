# Automated write-delta money canary — the unattended nightly runner

> **Supersedes the manual operator handoff in [write-delta-canary.md](write-delta-canary.md) §4.**
> That section was a step-by-step the operator ran by hand each time (mint clone →
> seed → loop k=5 → assert → purge). This replaces it with a **scheduled runner**
> that closes the loop with **zero per-run human action**: on a nightly cron,
> against a **dedicated persistent writable QA tenant**, it restocks the fixture,
> drives a real sale, snapshots the books before/after via the finance oracle,
> asserts A1–A5, repeats **k=5 (pass^k)**, and reports pass/fail. The only thing a
> human does is the **one-time setup** below. Authored 2026-06-22.
>
> ⚠️ **This is a scheduled E2E that REPORTS — not a PR gate.** It runs only on the
> nightly schedule + manual dispatch, is absent from branch-protection required
> checks, and does not touch `lint.yml`. It can never block a merge.

---

## 1. The one-time operator setup (everything else is autonomous)

Two things, once. After this the canary runs itself nightly.

### A. Provision / confirm the dedicated writable QA tenant (dev pod)

The canary needs a **persistent writable tenant** that automation owns forever. It
must be **payment-capable in test mode** so a real sale reaches a *counted* state
without real money — i.e. a **demo-envelope clone** (the demo envelope forces
Square TEST mode; same class the §4 handoff assumed), or any dev tenant whose
sale path settles without a live processor. A plain test tenant whose storefront
has no test processor will *fire* `submitOrder` but the card won't settle (see
§5 — verified live on `sgtest15`); use the POS surface there, or a demo clone.

Then **seed the deterministic fixture** (frictionless on dev — agent/MCP-callable):

```
mast_products action=create tenantId=<QA_TENANT> pid=qa-write-canary \
  fields={"name":"QA Write Canary","priceCents":2500,"status":"active",
          "stockType":"strict","stock":100,"categories":["qa-fixture"]}
```

This creates a single-SKU, strict-stock, $25 product wired straight to canonical
`admin/inventory/qa-write-canary` (stock 100) — immediately sellable. The runner
tops it back up automatically when it runs low (it asserts *deltas*, so it only
needs enough stock to outlast k sales — ~95 nightly runs at the default before a
top-up). Record the tenant id + base URL as repo **Variables**:

```
gh variable set QA_TENANT   --body "<QA_TENANT>"
gh variable set QA_BASE_URL  --body "https://<QA_TENANT>.runmast.com"
```

### B. Mint + add the ONE secret — `MAST_QA_STORAGE_STATE`

The sale itself is **anonymous** (storefront guest checkout signs in
anonymously — no credential). The **only** admin-gated piece is the finance +
inventory **oracle** (and the restock write). It needs one stored credential: an
**authed admin Playwright `storageState`**. Mint it once with the helper:

```
# Playwright >= 1.51 is required (Firebase persists auth in IndexedDB):
npm i -D playwright@^1.51 && npx playwright install chromium
MAST_BASE_URL=https://<QA_TENANT>.runmast.com \
  node scripts/qa-spine/capture-qa-storage-state.mjs
# → a browser opens; log into the admin once. It prints qa-storage-state.json.b64.
gh secret set MAST_QA_STORAGE_STATE < qa-storage-state.json.b64
rm qa-storage-state.json qa-storage-state.json.b64   # contains a live session
```

> **Agents are firewalled from setting CI secrets — that `gh secret set` is the
> single irreducible human action.** The refresh token inside is long-lived under
> nightly use; re-mint only if a run reports *"oracle not authenticated"* (session
> revoked / password changed).

That's it. The nightly workflow is already committed; it stays a no-op (a yellow
*"not configured"* annotation) until the secret + variables exist, then runs for
real.

---

## 2. Architecture — what runs, and what each piece reuses

```
.github/workflows/qa-canary-nightly.yml   cron + manual dispatch; installs PW≥1.51
   └─ scripts/qa-spine/write-delta-runner.mjs        THE UNATTENDED ORCHESTRATOR
        restock fixture if low  ── authed admin session (MastDB.update)
        loop k:
          oracle BEFORE   ── authed FinanceBridge + admin/inventory  (the credentialed read)
          REAL sale       ── spawns write-delta-sale.mjs (anonymous storefront, or POS)
          oracle AFTER
          assert A1–A5    ── write-delta-core.mjs   (pure engine, unchanged)
        aggregate → pass^k → qa-canary-scorecard.json → exit non-zero on any fail
```

| Piece | Role | New / reused |
|---|---|---|
| `write-delta-core.mjs` | pure A1–A5 assertion engine | **reused unchanged** |
| `write-delta-sale.mjs` | Playwright sale driver | reused (+ a tiny additive `checkoutTotalCents` capture) |
| `write-delta-runner.mjs` | the unattended orchestrator (oracle + restock + loop + pass^k) | **new** |
| `capture-qa-storage-state.mjs` | one-time credential mint helper | **new** |
| `qa-canary-nightly.yml` | the scheduled workflow | **new** |

**The oracle is no longer "the agent runs MCP."** It is an authed Playwright
session reading the **shipped** `FinanceBridge.loadRevenueAggregate` /
`computePnl` cores + `admin/inventory/{pid}` — the same admin surface the
read-side money canary cross-checks ([money-canary.mjs](../../../scripts/qa-spine/money-canary.mjs)
mode B). The raw bridge shapes are mapped into the engine's snapshot shape by a
**pure, unit-tested transform** (`buildSnapshot` / `computeStockTotals`, pinned in
[test/write-delta-runner.test.js](../../../test/write-delta-runner.test.js) against
the exact live shapes — including the load-bearing `opex`→`operatingExpenses` /
`totalCents`→`total` field maps that, if dropped, make A4c silently read `NaN`).

---

## 3. The schedule, the results, and the failure alert

- **When:** nightly at `09:00 UTC` (`cron: "0 9 * * *"`) + **manual dispatch**
  (Actions → *QA write-delta money canary (nightly)* → *Run workflow*; choose
  `surface` / `k` / optional base-url + tenant overrides).
- **Pass:** all k iterations green → `pass^k` PASS → job **green**.
- **Fail (the alert):** any assertion fails, or a sale never fires after retries →
  the runner exits non-zero → job **red** → GitHub's standard
  failed-workflow notification fires. Red ⇒ **a real money-flow divergence**: a
  sale did *not* move the books by exactly the sale amount, into exactly one
  canonical channel, with inventory drawn down, the P&L reconciled, and zero
  collateral — *or* a stale cached bundle (re-run to rule that out).
- **Artifact:** every run uploads `write-delta-scorecard-<run_id>` containing
  `qa-canary-scorecard.json` (the pass^k rollup + per-iteration verdicts +
  failing-assertion names + Δrevenue) and the per-iteration sale results +
  screenshots. Download from the run page to triage a red.

`qa-canary-scorecard.json` shape:

```json
{ "probe":"write-delta-runner", "tenant":"…", "surface":"storefront",
  "channel":"dtc_online", "k":5, "passes":5, "passHatK":true,
  "restock":{"restocked":false,"available":97},
  "perIteration":[{"iteration":1,"pass":true,"saleFired":true,"T":2500,
                   "revenueDelta":2500,"failures":[]}, …],
  "infra":[] }
```

---

## 4. Surfaces — storefront vs POS (pick by your QA tenant)

The runner supports both; default is `storefront`. They differ in *how a sale
reaches a counted state*:

| | `storefront` (dtc_online) | `pos` (in_person) |
|---|---|---|
| Sale auth | **anonymous** guest checkout | admin (uses the same `MAST_QA_STORAGE_STATE`) |
| Counts without real money? | only on a **payment-capable** tenant (demo-envelope/test mode) | **yes, immediately** (cash, no processor) |
| Inventory effect | reserve: `committed +qty`, onHand flat (A3b) | decrement: `onHand −qty` (A3b) |
| Driver selectors | **proven live** (golden-auric + sgtest15 dry-run) | refine on first authed run (W3-pilot §3b) |

**Recommendation:** if your QA tenant is a demo-envelope clone (test-mode
payments), `storefront` is the purest path (anonymous sale). If you want
"counts no matter what, one secret does everything," use `pos` — a cash sale
posts `in_person` revenue with no processor and reuses the oracle credential.
Set the choice via the dispatch input or a `SURFACE` repo variable.

---

## 5. Validation status — what ran live, what awaits the secret

**Proven live this session (on `sgtest15`, dev):**

- ✅ **Write access + fixture seed.** `qa-write-canary` created via MCP (strict,
  stock 100, $25) and confirmed sellable — `stockInfo` returns exactly the snapshot
  shape the canary consumes.
- ✅ **The sale driver against the real storefront.** All 8 steps drive
  product → add-to-cart (`$25.00`) → checkout → review → `[data-co="place-order"]`.
- ✅ **A real `submitOrder` write fired** (`submitObserved`) — after a **retry**
  (the shipping→review step races; the runner retries `SALE_RETRIES` times, which
  is why a driver flake ≠ a money failure).
- ✅ **Recognition-timing resolved (the doc's standing OPEN).** On a tenant with
  **no test processor**, a storefront **card** sale fires `submitOrder` but the
  order does **not** reach a counted state — revenue + inventory stayed flat. ⇒ the
  QA tenant must be **payment-capable (test mode)** for `storefront`, or use `pos`.
- ✅ **The full runner orchestration, end-to-end, in `mock` mode** — restock-check
  → oracle-before → real **dry-run** sale subprocess → assert A1–A5 (all green) →
  pass^k → scorecard → exit 0. Everything except the credentialed read + the
  counted write is exercised.
- ✅ **The oracle transform, unit-tested against live shapes** (incl. the
  `opex`→`operatingExpenses` trap and a clean-sale engine GREEN). **Offline
  self-test still green** (`write-delta-canary.mjs self-test` — regression).

**Awaiting the one secret (§1.B) — the credentialed seam:**

- 🟡 **The authed oracle read + restock write.** Reading `FinanceBridge` /
  `admin/inventory` and the top-up `MastDB.update` need the admin session. The
  *logic* is pinned by the unit test + modeled on the shipped `money-canary` mode B
  + `inventory-stock-ops.js`; the *auth restore* is the only un-run-live line, and
  it's exactly what `MAST_QA_STORAGE_STATE` unblocks. The runner fails fast and
  loud (`oracle not authenticated`) if the secret is missing/expired.
- 🟡 **The counted real sale on the QA tenant** (per §4 — demo-envelope storefront,
  or POS). The first real nightly run confirms the counted-state behavior end to
  end; nothing else is gated.

---

## 6. Operations & troubleshooting

- **Run it now:** Actions → *QA write-delta money canary (nightly)* → *Run
  workflow*. Use `k=1` for a quick smoke.
- **Validate the wiring with no credential:** `ORACLE=mock MAST_TENANT=<t>
  MAST_BASE_URL=<url> node scripts/qa-spine/write-delta-runner.mjs` (drives the
  real storefront in dry-run, asserts the synthetic delta — never an irreversible
  write).
- **Restock is automatic** but rare. If a run logs a restock error, top up by hand:
  `mast_products action=update_inventory tenantId=<t> pid=qa-write-canary fields={"stock":100}`.
- **`oracle not authenticated`** → the secret is missing/expired/anonymous.
  Re-mint with `capture-qa-storage-state.mjs` and `gh secret set` again.
- **Expected delta `T`.** A1 asserts revenue moved by *exactly* `T`. The runner
  uses the driver-captured checkout total when available, else `DELTA_CENTS`
  (default `2500` = the $25 fixture). So the sale total must be **deterministic**:
  keep the fixture at no-tax/free-or-pickup shipping (the driver ships to `OR` — no
  sales tax), or set `DELTA_CENTS` to the actual all-in total. If A1 fails by a
  shipping/tax amount, that's the cause — not a money bug.
- **A single red with `[A1]`/`[A2b]`** and a clean re-run → suspect a stale cached
  bundle first (hard-reload semantics); a *persistent* red is a real divergence —
  triage the scorecard's failing-assertion names against
  [write-delta-canary.md](write-delta-canary.md) §2.
- **Rotation / teardown:** the QA tenant is persistent (automation owns it); no
  per-run purge. Accumulating test orders are tolerated (the canary asserts
  deltas). Re-mint the secret only on session revocation.
```

This runner is the first workflow of the QA spine to run **fully unattended**; the
remaining 10-workflow spine sweep on both surfaces is the next phase, not this one.
