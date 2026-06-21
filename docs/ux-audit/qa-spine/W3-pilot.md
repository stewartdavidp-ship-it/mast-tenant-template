# W3 Pilot — In-person POS sale → books  (the money canary)

> The first instrumented workflow of the spine. Goal: prove the harness + scorecard format
> on the highest-signal path before templating the other nine. **Status:** agent/MCP oracle
> half **executed live** against `sgtest15` (baseline below); the scorecard mechanics were
> **validated with a proxy sale** (§2b); and the **true UI POS sale was then driven end-to-end**
> on a real authenticated session (Track B — §3b). Result: **A1/A2 PASS, A3 FAILS** (POS doesn't
> decrement inventory → finding F12, chipped). Bonus: **F1 re-verified fixed live**. Authored 2026-06-20.

**Job (Lens 3):** *When I sell at the counter or a fair, I want it recorded so my inventory
and revenue are right.* Daily/seasonal; revenue-accuracy-critical.

---

## 1. Fixture (deterministic + resettable — required for pass^k)

The candidate real product (Mini Glass Swan, `priceCents 4500`) is **`build-to-order` with 0
on-hand**, so a sale won't produce a clean stock decrement. The pilot needs a dedicated
**finished-goods** fixture so the inventory assertion is real and can be reset to a known
baseline before each repeat.

**Seed (one MCP call — ready to run on approval):**
```
mast_products action=create  tenantId=sgtest15  pid=qa-w3-widget
  fields={"name":"QA Spine W3 Widget","priceCents":2500,"status":"active",
          "stockType":"strict","stock":100,"categories":["qa-fixture"]}
```
`stock` routes to canonical `admin/inventory/qa-w3-widget` so it's immediately sellable.
⚠️ Use a **canonical** `stockType` (`strict`/`in-stock`/`limited`/`stock-to-build`). The original
pilot seeded the **non-canonical `"finished-goods"`**, which `submitOrder`'s inventory gate did not
recognize → the sale never drew down stock (that was F12, see below). `create` now rejects it.
**Reset between runs:** `update_inventory` stock→100. **Teardown:** `delete pid=qa-w3-widget`.
Namespaced `qa-*` so it never collides with the real catalog.

Fixture constants: `PRICE_CENTS = 2500`, `QTY = 1`, `SALE_TOTAL_CENTS = 2500`,
`START_STOCK = 100`.

---

## 2. Surface A — Agent / MCP oracle  (executed live ✅)

The agent can't *create* a POS sale (no MCP tool — that's the UI-only finding), so its role
is the **oracle**: snapshot before, snapshot after, assert the deltas.

**Procedure** (period = the sale's date range; here full-year to capture the channel):
1. `finance_get_revenue(sgtest15, 2026-01-01, 2026-12-31)` → record `total` + `byChannel`.
2. `finance_get_pnl(sgtest15, …)` → record `revenue` (must equal the revenue tool's total).
3. `mast_products action=get pid=qa-w3-widget` → record `stockInfo.totalOnHand`.
4. *(UI sale happens — §3)*
5. Repeat 1–3 as the **after** snapshot.

### Live BEFORE baseline (captured 2026-06-20, real `sgtest15`)

| Metric | Value (cents) | $ |
|---|---|---|
| `revenue.total` | **9,285,856** | $92,858.56 |
| `pnl.revenue` | **9,285,856** | $92,858.56 |
| byChannel `pos` | 460,000 | $4,600 |
| byChannel `direct-pos` | 60,000 | $600 |
| byChannel `online` | 202,256 | $2,022.56 |
| byChannel `Online Store` | 13,600 | $136 |
| byChannel `phone` | 4,800,000 | $48,000 |
| byChannel `manual` | 3,750,000 | $37,500 |
| P&L: cogs / grossProfit / opEx / netProfit | 116,930 / 9,168,926 / 741,048 / 8,427,878 | — |
| fixture `qa-w3-widget` onHand | *(100 after seed)* | — |

### Assertions (run on after-snapshot)

| # | Assertion | Expected |
|---|---|---|
| A1 | `after.revenue.total − before.revenue.total` | `== 2500` (exact, no ×100) |
| A2 | the **POS channel key** increments by `2500`, **and only one** POS key changes | `pos` +2500, `direct-pos` unchanged (or vice-versa — pin which) |
| A3 | `before.onHand − after.onHand` | `== 1` |
| A4 | `after.pnl.revenue == after.revenue.total` | reconciliation holds |
| A5 | **collateral:** no other `byChannel` key, no other product's stock changed | unchanged |

### Lens-2 (agent efficiency) — measured live

| Call | Response bytes |
|---|---|
| `finance_get_revenue` | 184 |
| `finance_get_pnl` | 489 |
| `mast_products get` | 2,079 |
| **One oracle snapshot (3 calls)** | **~2.75 KB (~700 output tokens)** |

Full before+after oracle ≈ **6 tool calls, ~5.5 KB, ~1.4k tokens** — trivially cheap. This
is the agent-side ease-of-use baseline: the MCP is an excellent, low-cost oracle.

---

## 2b. Proxy-loop validation — executed live ✅ (then torn down)

The UI write was blocked, so we validated the *scorecard mechanics* end-to-end with a proxy:
seed `qa-w3-widget` (onHand 100) → drive a $25 sale via `mast_orders create_test` (protected
handshake) → re-snapshot → tear down (delete order + product). `sgtest15` revenue returned to
the exact baseline (`9,285,856¢`), catalog restored.

| Assertion | Result |
|---|---|
| A1 revenue +exact | ✅ **+2,500** (9,285,856 → 9,288,356) |
| A2 single channel | ✅ new `test` bucket +2,500; **every real channel unchanged** (test orders are segregated — no pollution) |
| A4 revenue == P&L | ✅ 9,288,356 == 9,288,356; subtotals tie |
| A5 no collateral | ✅ only `test` added; fixture + all other products unchanged |
| A3 inventory −1 | ⚪ **not exercised** — `create_test` skips the inventory side-effect pipeline; the decrement needs the real UI POS path |

**Proved:** the before/after oracle + assertion engine + teardown work on real data; the
scorecard format holds. **Can't prove via proxy:** true `direct-pos` channel attribution and
the inventory decrement (A3) — those need the UI POS write (§3/§6). **Two findings from the
run:** (1) `create_test` routes test revenue to a `test` channel — good hygiene (positive);
(2) **`mast_orders` reads are protected** — even `get`/`list` trigger the handshake, doubling
an agent's calls/tokens for order reads (Lens-2 friction).

---

## 3. Surface B — Human UI  (runner spec; executed live in §3b)

**Procedure (POS):** (1) open POS → (2) add `qa-w3-widget` → (3) take cash/test payment →
(4) complete → (5) view receipt → (6) confirm inventory −1 → (7) confirm revenue +$25.00.

**UI path:** `#pos` (sales.js) → receipt → inventory + finance hubs.

**Runner:** [`scripts/qa-spine/w3-pos-ui.mjs`](../../../scripts/qa-spine/w3-pos-ui.mjs) — a
Playwright script that loads an authed session, runs the step sequence, and records per-step
`{ok, ms, error}`, console/page errors, and a screenshot per step → emits the UI half of the
scorecard. The POS selectors are marked `TODO` to fill from the live DOM on the first authed
run (can't be read in `testmode`, which is write-denied).

**Lens-2 (human) captured by the runner:** task success, # steps, time-on-task, error count.
**SEQ** (1–7) is collected from the human tester post-run; **SUS** at the suite level.

---

## 3b. Surface B — EXECUTED live (Track B, 2026-06-20)

Drove a real POS cash sale on `sgtest15` via browser automation on the operator's
**authenticated, writable** session (the "🧪 Testing Mode" banner is a test-tenant marker,
not the write-denying `?testmode=1`).

**Actual flow (corrects the spec):** admin `#pos-v2` is the **Sales Ledger**; the POS register
is a **separate page at `/pos/`** opened via "Open POS checkout ↗" (new tab). Flow: open POS →
Open POS checkout (new tab) → find product → Charge → select Cash → Complete Sale →
"Sale Recorded! Order **SGTE-0220** · $25.00 cash". ~6 interaction steps + a tab context-switch.

**Oracle (before → after):**
| Assertion | Result |
|---|---|
| A1 revenue +exact | ✅ 9,285,856 → 9,288,356 (**+2,500**) |
| A2 single canonical channel | ✅ **`in_person` 520,000 → 522,500**; dtc_online/phone/manual unchanged |
| A3 inventory −1 | ❌ **FAIL** — fixture onHand stayed 100, inventory doc untouched (2 reads) → **F12** |
| A4 revenue == P&L | ✅ revenue total moved correctly |
| A5 no collateral | ✅ only `in_person` moved |

**F12 (chipped `task_5db7f36c`) — RESOLVED; root cause corrected on investigation.** The repro was
real (revenue posted, fixture `onHand` stayed 100), but the cause was **not** `pos/index.html`
`decrementInventory()` as first chipped — that function is **dead code** (zero callers; the live POS
path routes through the `submitOrder` Cloud Function in POS mode, which owns the drawdown). True
cause: this fixture was seeded with the **non-canonical `stockType:"finished-goods"`**, and
`submitOrder`'s inventory gate only drew down a hard-coded allowlist of recognized stock types — so
it silently skipped the sale (revenue is a separate path). Fix landed across 3 repos: (1) the gate
now normalizes an *unrecognized-but-stocked* type to `strict` so any on-hand item always draws down
(mast-architecture `lib/stock-tracking.js` + `submitOrder`); (2) `mast_products create` now rejects
an invalid `stockType`, matching `update_inventory` (mast-mcp-server); (3) the dead
`decrementInventory()` was removed (template). Seed recipe above corrected to `strict`.
**Lesson holds: closing A3 on the real UI surface found a genuine (server-side) inventory bug the
proxy could not reach.**

**Bonus — F1 re-verified FIXED:** revenue `byChannel` now uses canonical keys (`dtc_online`,
`in_person`) instead of the fragmented `online`/`Online Store`/`pos`/`direct-pos`. The F1 fix
(`task_f0d1c0e4`) is deployed — detect→chip→fix→**re-verify** loop closed live.

**Lens-2 (human):** task-success ✅; ~6 steps; register is a **separate-tab surface** (context
switch); minor quirk — a no-variant product shows "6 options ›" in the dense grid. **SEQ/SUS not
collected** (subjective — needs a human tester; this run measured objective task-success + flow).

**Lens-2 (agent-operability, automated driver as proxy):** an agent CAN drive the POS but with
friction — product-tile ref-clicks didn't register (needed search + coordinate click),
screenshot-vs-CSS coordinate scaling caused a mis-click, the cart panel clipped in screenshots,
and "Open POS checkout" opened a tab outside automation control. **Automatable-with-effort, not
cleanly agent-operable.**

**Residual on `sgtest15`:** fixture `qa-w3-widget` deleted; POS sale **SGTE-0220 ($25, in_person)
left** (no MCP delete path for POS sales) → `in_person` baseline now 522,500. Operator can void
via the Sales Ledger UI.

---

## 4. The cross-surface money assertion (why W3 is the canary)

W3's headline is **A1+A2+A4**: a single $25 POS sale must move the books by exactly $25,
into exactly one POS channel, with the revenue tool and the P&L still agreeing to the cent.
This is the automated form of the manual MCP cross-check that historically caught the 100×
cents inflation and the POS double-count. Running it as a gate turns a per-session habit into
a standing assertion.

---

## 5. Live finding (from the baseline read)

**⚠️ Channel-key fragmentation (data-quality, not a money error).** `byChannel` carries
**`pos` *and* `direct-pos`**, and **`online` *and* `Online Store`** — POS revenue is split
$4,600/$600 and online $2,022.56/$136 across inconsistently-normalized keys (the capitalized
`"Online Store"` looks like a raw Shopify channel label leaking through). The **total still
reconciles** with the P&L, so it's a taxonomy/normalization issue, not lost money — but
per-channel reporting is unreliable, and it directly shapes assertion **A2** (we must pin
which key a Mast POS sale lands in).

**Root cause (confirmed):** revenue is grouped on the raw `source` string with ad-hoc defaults
and no canonical normalization — [`finance.js:541`](../../../app/modules/finance.js) `o.source || 'direct'`
and `:551` `s.source || 'pos'` (also 603/621/1783/1795); [`channels.js:2466`](../../../app/modules/channels.js)
defaults POS to `'direct-pos'`; the `dtc_online` label `'Online Store'` (channels.js:51/156)
leaks in as a source key. The canonical taxonomy (channels.js:51–58) is a *different*
vocabulary than the stored source strings. **Flagged for fix → `task_f0d1c0e4`** (canonical
channel-normalization map in finance.js + the mirrored MCP-server aggregator).
*(Severity: medium — reporting correctness.)*

---

## 6. Executable boundary & next actions

- ✅ **Done now:** agent/MCP oracle executed live; baseline + token cost captured; assertions
  defined; finding surfaced. Scorecard: [`scorecard-W3.json`](scorecard-W3.json).
- 🟡 **Needs a decision to proceed (the #1 harness blocker):** the UI-write half needs a
  **writable automated session**. `testmode` is write-denied and there's no stored auth.
  Options: (a) a seeded test-user storage-state for Playwright on `sgtest15`; (b) a dedicated
  writable QA tenant; (c) accept UI-write as operator-run and automate only the oracle as a
  gate. **Recommend (a).**
- **To close the loop end-to-end now** (optional, with go-ahead): seed `qa-w3-widget`, then
  either run the Playwright sale (needs auth) **or** use `mast_orders create_test` as a
  *proxy* sale to validate the before/after scorecard mechanics on real data (note: that
  exercises the W2 online-order path + the protected-action confirmation handshake, not the
  `direct-pos` channel — a mechanics check, not a true W3 run).

**Decisions for the operator:** (1) which writable-session option; (2) seed the fixture & run
the proxy loop now to validate the scorecard, or wait for real UI auth; (3) is the
channel-fragmentation finding worth a fix chip now.
