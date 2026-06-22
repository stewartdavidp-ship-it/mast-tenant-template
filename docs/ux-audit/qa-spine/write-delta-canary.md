# Write-Delta Money Canary — a real sale moves the books by exactly the sale

> The **WRITE-side** complement to the read-side money canary (`test/money-canary.test.js`
> + `scripts/qa-spine/money-canary.mjs`, PR #820). The read-side proves the **same static
> figure agrees across surfaces**. This drives a **real sale** end-to-end and asserts the
> books **move by exactly the sale amount, into exactly one canonical channel, with
> inventory −qty, the P&L still reconciled, and zero collateral damage** (AppWorld-style),
> repeated **k=5 times** on a reset baseline (**pass^k** = reliability, not one-shot luck).
>
> This is the **W3 (POS) / W2 (online) write path** the spine defined but never executed
> end-to-end ([testing-workflows-spine.md](../testing-workflows-spine.md), [W3-pilot.md](W3-pilot.md) §3b
> drove the manual sale once). It finally closes the standing **"no writable automated
> session"** harness blocker — by isolating the one operator-gated step (minting a writable
> tenant) and running **everything else autonomously**.
>
> ⚠️ **PERIODIC / OPERATOR-RUN — NOT A PR GATE.** The live run needs a writable tenant, is
> slow, and is non-deterministic. The *deterministic* backbone is the pure engine, exercised
> offline by `self-test` (no network). Authored 2026-06-22.

---

## 1. The three-piece harness

| Piece | File | Gated? | Role |
|---|---|---|---|
| **Engine** | [`scripts/qa-spine/write-delta-core.mjs`](../../../scripts/qa-spine/write-delta-core.mjs) | no | Pure A1–A5 assertion logic. No I/O, no clock, no globals (caller injects the canonical-channel set). Offline-validatable. |
| **Orchestrator** | [`scripts/qa-spine/write-delta-canary.mjs`](../../../scripts/qa-spine/write-delta-canary.mjs) | no | `self-test` (engine vs fixtures + negative controls) · `assert` (oracle snapshots → scorecard) · `aggregate` (pass^k rollup). |
| **Sale driver** | [`scripts/qa-spine/write-delta-sale.mjs`](../../../scripts/qa-spine/write-delta-sale.mjs) | **yes (the write)** | Playwright. Drives the real `submitOrder` storefront sale (or admin POS). `--dry-run` walks the whole flow but stops before the irreversible write. |

**The oracle is the AGENT.** Like the read-side, the gold-standard before/after oracle is the
frictionless, read-only MCP sequence the agent runs: `finance_get_revenue` → `finance_get_pnl`
→ `mast_products get` (fixture + witnesses). The agent snapshots **before** the sale, the
driver writes **one sale**, the agent snapshots **after**, then feeds both to `assert`.

**Flow (one iteration):**
```
agent: BEFORE = {revenue, pnl, products}  (MCP, ~6 reads)
driver: ONE real sale            (write-delta-sale.mjs — the only gated step's product)
agent: AFTER = {revenue, pnl, products}   (MCP)
orchestrator: assert(BEFORE, AFTER, expect) → write-delta-iter-NN.json
agent: reset fixture stock        (mast_products update_inventory)   ── repeat k=5 ──
orchestrator: aggregate → write-delta-passk.json   (pass^k)
```

---

## 2. The assertions (the canary)

On a known fixture (`qa-write-canary`, strict, stock 100, $25) for a sale of total `T` into
channel `C`:

| # | Assertion | Why |
|---|---|---|
| **A1** | `after.revenue.total − before.revenue.total == T` (exact cents) | the 100× cents-inflation / POS-double-count class |
| **A2a** | **exactly one** channel key moved | no collateral revenue leak |
| **A2b** | that channel == `C`, moved by exactly `T` | right bucket, right amount |
| **A2c** | `C` (and every moved key) is **canonical** | catches F1 fragmentation live (`pos`/`direct-pos`/`Online Store`) |
| **A3a** | fixture `totalAvailable` **−qty** (channel-agnostic) | a real sale always reduces sellable stock by qty |
| **A3b** | **POS** → `totalOnHand −qty`, committed flat · **storefront** → `totalCommitted +qty`, onHand flat (until ship) | the reservation lifecycle: storefront *reserves* at placement, POS *decrements* — both reduce `available` (this is why A3a is the robust invariant; the W3 pilot's naive "onHand −1" only held for POS) |
| **A4** | `after.pnl.revenue == after.revenue.total`, and gross = rev−cogs, net = gross−opex | the dual-source reconciliation still holds after the write |
| **A5a** | no other product's stock moved | AppWorld collateral check |
| **A5b** | exactly one new order (if `orderCount` captured) | no phantom order |

**pass^k(5):** all 5 iterations green. A 90%-reliable one-shot is only ~59% at k=5 — the bar
is **reliability**. Each iteration is bracketed by its own before/after, so accumulating test
orders on the clone don't break per-iteration deltas; only the fixture's stock is reset
between iterations.

**Lens-2 (agent cost):** `assert` carries an optional `--lens2` passthrough; `aggregate`
averages tool-calls / response-bytes / tokens across iterations, mirroring the read oracle's
~6 calls / ~5.5 KB / ~1.4k-token baseline ([W3-pilot.md](W3-pilot.md) §2).

---

## 3. What is VALIDATED vs. AWAITING the operator-minted tenant

### ✅ Validated now (this session)

- **Engine discrimination (offline, deterministic).** `node write-delta-canary.mjs self-test`
  → the clean sale is fully GREEN; **all 6 negative controls go RED for the named assertion**:
  100× (A1/A2b), double-count (A1/A2b), wrong/non-canonical channel (A2a/A2c), no-drawdown /
  F12 class (A3a), collateral (A5a), broken reconciliation (A4a). Proves the canary
  discriminates — it is not a tautology. Fixtures: `test/fixtures/write-delta-canary.{before,after}.json`,
  grounded in **live `golden-auric`** reads.
- **The MCP oracle (live, read-only) on `golden-auric`** (window 2025-10-01..2026-06-30,
  2026-06-22): `finance_get_revenue.total = 3787391`, `byChannel = {dtc_online 1661398,
  in_person 1616993, wholesale 509000}` (all canonical); `finance_get_pnl.revenue = 3787391`
  → **A4 reconciliation holds live**; `mast_products get` confirms the inventory read shape
  `stockInfo.{totalOnHand,totalAvailable,totalCommitted}` (e.g. `ao-crescent-ear-climbers`:
  in-stock, onHand 11). The collateral + reconciliation logic runs against real data.
- **The storefront sale driver (live, up to the write) on `golden-auric`'s public storefront.**
  `DRY_RUN=1 … write-delta-sale.mjs` walks **all 8 steps** — load → product → add-to-cart
  (cart shows `$82.00`) → cart drawer → begin checkout → address → shipping → **review** — and
  locates `[data-co="place-order"]` ("PROCEED TO PAYMENT"), then **STOPS before the
  irreversible `submitOrder`**. Every selector is proven against a live tenant. Guest/anonymous
  checkout means **no visitor storageState is needed** (`checkout.js` signs in anonymously).

### 🟡 Awaiting the operator-minted writable clone (the one gated step)

- **The actual sale write + the real delta.** Completing `submitOrder` and observing the
  books move requires a writable tenant. Minting an ephemeral demo clone is **operator/OIDC-gated
  by design** (the same gate class as smoke — see [demo-operator-convert-handoff.md](../demo-operator-convert-handoff.md));
  the agent is firewalled from it. Out of scope: building a non-gated mint path.
- **Revenue-recognition timing (the one behavior to confirm on first write).** For a
  **storefront card** sale, `submitOrder` creates the order and returns a `checkoutUrl`; whether
  `finance_get_revenue` counts the order at **placement** vs. only after **payment-success**
  can't be settled without a writable tenant (you can't complete a payment on read-only
  `golden-auric`). The harness handles both — take the AFTER snapshot once the order is in a
  counted state. **Two low-friction ways to reach a counted state without real money:** (a) the
  **admin POS cash** path (`--surface pos`) posts `in_person` revenue immediately, no processor
  (proven in W3-pilot §3b); (b) complete the **Square sandbox** payment the demo envelope forces
  (P2-1), or seed a wallet/gift-card credit for the **$0 `zeroDollar` path** (`checkout.js:2189`).

---

## 4. Operator handoff — one gated mint, then autonomous

**Goal:** *operator runs one gated mint → the harness runs the full mint-less remainder
autonomously → asserts → operator purges.*

### Step 0 — Operator: mint a writable clone of `golden-auric` (the ONE gated call)
The agent is firewalled from this (OIDC/operator gate). Mint an ephemeral demo clone:
```
startDemoForProspect({ prospectEmail: "<you>@runmast.com", ttlHours: 24 })
   → { tenantId: "<CLONE>", url: "https://<CLONE>.runmast.com", expiresAt }
```
> If `startDemoForProspect` isn't deployed yet (operator-mint is the "ahead" item in
> [demo-engine-build-spec.md](../demo-engine-build-spec.md)), mint via the underlying
> `provisionFreeTenant({ demo:true, demoEmailSink, expiresAt })` and **activate** it (flip
> `status` + `publicConfig.tenantStatus` to `active`) per [demo-operator-convert-handoff.md](../demo-operator-convert-handoff.md) W1.
> Minting/activating is [ARCH]/operator work — **not** built from this repo.

### Step 1 — Agent: seed the deterministic fixture (writable clone, frictionless)
```
mast_products action=create tenantId=<CLONE> pid=qa-write-canary
  fields={"name":"QA Write Canary","priceCents":2500,"status":"active",
          "stockType":"strict","stock":100,"categories":["qa-fixture"]}
```
(A real single-SKU in-stock product like `ao-crescent-ear-climbers` also works with no seed —
just set `FIXTURE_PID` accordingly. Strict + namespaced `qa-*` is cleaner: deterministic,
resettable, no pollution of the real catalog.)

### Step 2 — Agent: run the loop (k=5), all autonomous after the mint
For each iteration `n` in 1..5:
```
# BEFORE oracle (MCP, read-only)
finance_get_revenue(<CLONE>, <window>)  → before-rev.json
finance_get_pnl(<CLONE>, <window>)      → before-pnl.json
mast_products get(<CLONE>, qa-write-canary)  + a witness  → assemble before-NN.json

# ONE real sale (the gated step's product — runs against the writable clone)
MAST_BASE_URL=https://<CLONE>.runmast.com FIXTURE_PID=qa-write-canary \
  node scripts/qa-spine/write-delta-sale.mjs            # storefront / dtc_online
# (or  SURFACE=pos MAST_STORAGE_STATE=admin.json  for the in_person path)

# AFTER oracle (once the order is in a counted state — see §3 timing)
finance_get_revenue / _pnl / mast_products get  → assemble after-NN.json

# ASSERT this iteration
node scripts/qa-spine/write-delta-canary.mjs assert \
  --before before-NN.json --after after-NN.json \
  --channel dtc_online --fixture qa-write-canary --qty 1 --delta 2500 --iteration n

# RESET the fixture for the next iteration
mast_products action=update_inventory tenantId=<CLONE> pid=qa-write-canary fields={"stock":100}
```
Then roll up:
```
node scripts/qa-spine/write-delta-canary.mjs aggregate     # → write-delta-passk.json (pass^k)
```

### Step 3 — Operator: teardown
```
mast_tenants action=purge tenantId=<CLONE>        # destructive; confirmation-gated; operator-run
```
(Or let it expire + be reaped — the reaper floor is a manual `mast_tenants purge`, P0-3.)
The agent does **not** run purge (destructive, gated).

### Assemble-the-snapshot helper
Each `before-NN.json` / `after-NN.json` is exactly the engine's snapshot shape:
```json
{
  "revenue": { "total": <cents>, "byChannel": { "<channel>": <cents> } },
  "pnl": { "revenue": <cents>, "cogs": <cents>, "grossProfit": <cents>,
           "operatingExpenses": <cents>, "netProfit": <cents>,
           "marginReliable": <bool>, "cogsLineMissingCount": <n>, "cogsMissing": <bool> },
  "products": { "qa-write-canary": { "stockType": "strict", "totalOnHand": n,
                "totalAvailable": n, "totalCommitted": n }, "<witness>": { ... } },
  "orderCount": <n>
}
```

---

## 5. Findings / opens (logged to the ledger)

- **OPEN — revenue-recognition timing (storefront card).** Confirm on first real write whether
  `finance_get_revenue` counts a storefront order at placement or only at payment-success
  (§3). De-risked by the POS cash path + the $0/sandbox paths.
- **Assumption (well-grounded, verify on first write) — A3b storefront reserve.** Per the
  inventory reservation lifecycle, `submitOrder` *commits* (not decrements) stock at placement
  for non-POS lines; `totalAvailable` is the channel-agnostic invariant. Confirm the
  committed-vs-onHand split on the clone's first sale.
- **NOTE — benign storefront console noise.** The storefront emits CSP warnings
  (`frame-ancestors` via `<meta>`, the Cloudflare insights beacon blocked) + a couple of image
  404s. They are counted in the driver's `errorCount` but do **not** block the flow; the
  driver's `success` gates on step success + page errors only.
- **Cross-repo follow-up (NOT built here):** if a fully-automated mint+reap is wanted (so even
  Step 0/3 are unattended), that's a `mast-architecture` demo-engine change (operator-mint /
  reaper, P0-3) — log it there, per the standing cross-repo rule.

---

## 6. Quick reference

```
# Offline proof the canary discriminates (no network, runnable anywhere):
node scripts/qa-spine/write-delta-canary.mjs self-test

# Validate the storefront selectors against ANY live tenant (no write):
MAST_BASE_URL=https://golden-auric.runmast.com FIXTURE_PID=ao-crescent-ear-climbers \
  DRY_RUN=1 node scripts/qa-spine/write-delta-sale.mjs
```
