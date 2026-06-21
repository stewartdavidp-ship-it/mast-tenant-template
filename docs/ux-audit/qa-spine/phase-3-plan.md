# Phase 3 — Next-Gen Testing Program (v2, re-baselined on a verified code scan)

> v2 supersedes the v1 draft. It is re-baselined on a **deep ground-truth code scan** (2026-06-21)
> against **canonical refs** (`origin/main` of all 3 repos + live runtime), after v1 and its
> adversarial review were both found to be working off a **stale local checkout (496 commits behind
> origin/main)**. Every claim here is verified against origin/main, not the local tree.
> Prior phases: [discovery](../testing-program-discovery.md) · [spine](../testing-workflows-spine.md) · [scorecard](suite-scorecard.json).

## 0. Verified ground truth (what is actually real)
Three independent deep scans (one per question), each against freshly-fetched `origin/main` + live runtime:

**What's already built (template origin/main) — far more than v1 assumed:**
- **34 unit/engine tests**, all CI-wired; ~12 load real `shared/*.js` and assert on writes to a fake Firestore (OrdersBridge reserve/release/transition, customer-resolver dedup, mastdb family).
- **20 lint gates**, incl. **3 cross-surface parity guards** (readiness, channel-normalization, labor) that SHA-pin vendored cores byte-identical to the MCP repo → "UI gate == MCP gate" already enforced for those three.
- **Fail-closed Playwright boot-smoke** (`scripts/smoke-boot.mjs`), **67 routes + 3 deep cases**, required CI job. It boots the real shell via `?testmode=1` and fails on any uncaught route error.

**What's actually fixed:** all 6 spine fixes are **merged to main + deployed**: F1 (#769 +mcp parity), F7 (mcp #136), F12 (arch #330 / mcp #139 / template #773), F15 (mcp #140 — runtime-confirmed live), F18 (arch #334), plus the task_6a770cff cleanup. The earlier "F15 not on main" claim was a stale-clone artifact.

**What's actually a bug:** **7 genuine product bugs** (F1, F5, F7, F12, F14, F15, F18) — **1 high-sev (F15, fixed)**, the rest med — **6 fixed, 1 open (F14)**. Not "~5 / oversold 9×"; the real raw-to-genuine ratio is ~2.6×. **3 of 7 (F1, F5, F14) required cross-surface discovery** a single-surface suite would miss.

**Caveat that bit everyone:** the local checkout is 496 commits behind; even the "neutral" arbiter mis-read a stale mcp clone on F15. **Canonical-ref discipline (git fetch origin + origin/main + live runtime) is mandatory** — and must be enforced in any standing process. Also: the qa-spine harness/docs are **local-only, not on main** — they don't persist unless committed.

## 1. Objective (unchanged)
Continuously assess the product on three lenses: functional completeness · ease of use (human AND AI agent) · business-value focus.

## 2. What already exists — DO NOT rebuild
| Layer | Status on origin/main |
|---|---|
| Static gates | ✅ 20 lint scripts (10 blocking, 8 ratchet, 2 mixed), CI + edit-time |
| Unit / engine | ✅ 34 tests, write round-trips vs fake Firestore |
| Route-boot E2E | ✅ fail-closed 67-route Playwright smoke, required gate |
| Cross-surface (code parity) | ✅ 3 SHA-pinned parity guards (UI core == MCP core) |
| Deploy verify | ✅ post-deploy sha256(index.html) vs live origin |

v1's headline first step ("make boot-smoke a fail-closed gate") is **already done**. The program is ~70% built.

## 3. The REAL remaining gaps (narrow + specific)
1. **No golden seed / fixture-reset on main.** Prerequisite for everything below; today the smoke runs against a permission-denied preview user (no deterministic data). *(Blocker.)*
2. **No live cross-surface VALUE assertion ("money canary").** The parity guards prove the *code* is byte-identical; nothing asserts a **rendered UI dollar value == the same MCP tool's value** on a seeded tenant. This is exactly the class that found F1/F5/F14.
3. **No end-to-end workflow test** (cart→checkout, admin CRUD round-trip) beyond route-boot. *(Optional/higher-cost.)*
4. **No visual regression.** *(Optional.)*
5. **F14 is an open bug** (P&L UI↔MCP divergence) — should be chipped.

## 4. The three decisions — revised recommendations (verified basis)
**Runner model → deterministic backbone for the gaps; agent as a *periodic cross-surface discovery* tool.** The backbone exists; extend it deterministically (golden seed + money-canary value assertion). The agent's durable, evidenced value is **cross-surface divergence discovery** — 3 of 7 genuine bugs (F1, F5, F14) needed it, and F14 (still open) proves a single-surface suite misses this class. Run it **periodically (per major surface change), supervised** — not nightly infra. When it confirms a finding, graduate it to a deterministic test (as F15→`orders-timestamp-sort.test.ts` already did in the mcp repo).

**Gate placement → tiered (mostly already in place).** PR-required: the existing lint + fail-closed smoke (done) + the new money-canary value assertions once seeded. Pre-prod: the cross-surface money oracle. The agent never gates (non-deterministic) — it discovers + drafts tests for human ratification.

**Human lens → occasional real SUS on top flows; CUT the LLM-judge "human proxy."** The agent-proxy measures *agent* friction (the tab/toggle "failures" were agent-click artifacts, not human pain); an LLM-judge UX score would be uncalibrated pseudo-rigor. Measure the **agent** lens authentically (pass^k, tokens/steps/cost — it *is* the agent user); spot-check **humans** with real SUS, don't manufacture a number.

## 5. Sequencing
1. **Chip F14** — the one open genuine bug (well-characterized: UI `finance-statements-v2.js:128/217`, MCP `mast-finance.ts:154-165`).
2. **Golden seed + reset** on main (unblocks #2/#3; also kills the test-data cruft = F10).
3. **Money-canary cross-surface value assertions** — deterministic checks: rendered UI total == MCP tool value, to the cent (revenue, P&L, AR) on the seeded tenant. This is the genuinely-missing layer.
4. **Commit the qa-spine harness/docs to main** if the program is to persist (today they're local-only).
5. **(Optional) E2E workflow + visual-regression** for the top money flows.
6. **(Optional) Periodic agent cross-surface sweep** — gated by a pre-registered falsification bar (below).

## 6. The agent flywheel — as a falsifiable hypothesis, not a faith-build
Narrowed to the only capability the evidence supports: *"can a supervised agent harvest cross-surface UI↔MCP divergences that single-surface deterministic authors miss?"* Pre-registered bar before institutionalizing: over N supervised runs on changed surfaces, ≥1 genuine, still-open, NOT-conventionally-catchable bug per run, at a token cost below human-equivalent triage. **Current evidence partially supports it** (F14 is exactly such a bug; F1/F5 were too) — but realize it as *periodic supervised runs*, not standing nightly infra. Don't dignify "agent grows the whole suite" as architecture; keep the *practice* (find-a-bug → write-the-regression-test).

## 7. Costs, risks, lessons (verified)
- **Stale-checkout is the dominant failure mode** — it produced false conclusions at v1, the adversarial review, AND the neutral arbiter (F15). Any standing agent process MUST `git fetch origin` + read `origin/main` + check live runtime; never the working tree. Bake this into the agent's instructions.
- **Token cost:** keep the agent periodic (per surface-change), not nightly. The deterministic backbone is the cheap high-frequency gate.
- **Agent reliability:** it erred (F12 first root-cause; F13 stale-JS) — so it *proposes*; deterministic tests + humans ratify before anything gates.
- **Don't over-build:** the backbone is ~70% there. Phase 3 is small: seed + money-canary + chip F14 + (optional) E2E.

## 8. What changed from v1 (corrections the scan forced)
- v1 said "build a fail-closed smoke gate" → **already built** (67-route, required).
- v1 said "nothing in CI loads the app" → **false** (the smoke does).
- v1/adversary over/under-counted the evidence → verified: **7 genuine bugs, 1 high, 6 fixed, 1 open**; "oversold 9×" was overstated (~2.6×).
- v1 proposed an LLM-judge human proxy → **cut** (measures agent friction, not humans).
- v1 framed the agent as standing nightly infra → **demoted** to periodic supervised cross-surface discovery (now better justified: 3/7 bugs needed it).
- New: golden seed + the **money-canary value assertion** is the real missing layer (parity guards check code-equality, not value-equality).
