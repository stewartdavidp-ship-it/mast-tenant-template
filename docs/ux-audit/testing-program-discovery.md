# Testing Program — Discovery & Industry Benchmark (Phase 1: Discover)

> **Mode:** Discovery only. This document inventories what testing/QA capability exists
> today, how it has actually been used across past sessions, and how it compares to
> 2025–26 industry standards — scored against three lenses: **(1) functional completeness,
> (2) ease of use (human *and* AI agent), (3) business-value focus.** It deliberately
> does **not** design the next-gen program; it produces the raw material for that next
> phase (§9). Authored 2026-06-20.

---

## 0. TL;DR — the five headline findings

1. **We have a *quality-gate* program, not a *quality-measurement* program.** Today's
   testing is world-class at one thing: preventing known defect **classes** by
   construction (12 lint gates + 69 unit tests, run as both CI checks *and* edit-time
   hooks). It is near-absent at *measuring* whether the product actually works, is usable,
   or is valuable.

2. **Two of the three lenses have essentially no instrument.** Functional completeness is
   covered only *structurally* ("does it boot / is the data shaped right"). **Ease of use
   (human or AI) and business-value alignment have zero systematic measurement** — they
   live entirely in per-session human judgment.

3. **The middle and top of the test pyramid are missing.** Strong static-analysis base +
   thin unit cap over 7 pure helpers, then **nothing**: no integration tests, no in-repo
   E2E, no visual regression. Nothing in CI ever *loads the app*. The only thing that
   boots it (the Playwright route-smoke) is **not a merge gate** and is **fail-open**.

4. **Real verification is a manual, per-session ritual that is re-invented every time.**
   The workhorse is hand-driven Chrome automation against test tenant `sgtest15`
   ("live-verify"), cross-checked against the tenant MCP as a numeric oracle. It is
   powerful but human-paced, single-load, write-limited on the test tenant, and the same
   gotchas are re-learned every session (isolated-world bridge, unawaited-promise `{}`,
   hash-nav-serves-stale-code, two caches).

5. **The product is operated by two users — a human (UI) and an AI agent (MCP) — and the
   testing program treats neither as a measurable surface.** This is the single biggest
   strategic gap and the clearest place a "next-gen" program differentiates: the industry
   now has a vocabulary and benchmarks for *both* (SUS/task-success for humans; pass^k /
   tokens-per-task for agents). We use none of them.

---

## 1. Scope & method

**What we reviewed:** the in-repo test/lint harness (`test/`, `scripts/lint-*.js`,
`.github/workflows/`), the Playwright boot-smoke, the live verification methods
(Chrome MCP + tenant MCP), the hand-built use-case artifacts, the product's functional
surface (91 lazy modules + storefront), and the tenant MCP tool API (~73 tenant tools).

**Evidence base:** direct repo read; 254 past session transcripts (grepped on disk) +
~130 memory files for *lived* usage; live read-only calls to the `sgtest15` tenant MCP for
token-cost characterization; and a 2025–26 industry-standards web sweep (§6, citations in
appendix). Four parallel research agents produced the underlying findings.

**The reframe that drives everything below.** The request mixes two distinct things that
the next phase must keep separate:

| | What it is | Who it judges |
|---|---|---|
| **(A) Product quality** | Is the product complete / usable / valuable on the 3 lenses | The *thing measured* |
| **(B) Testing program** | The capability that *measures* (A) and gates change | The *instrument* |

A "next-gen testing program" is an upgrade to **(B)** so it can reliably assess **(A)
across all three lenses**. Today, program (B) only measures a slice of lens 1.

---

## 2. Inventory — what testing capability exists today

### 2.1 By layer (the test-pyramid view)

| Layer | Present? | What we have | Gate? |
|---|---|---|---|
| **Static analysis** | ✅ **Very strong** | 12 `lint-*.js` invariants (RBAC, MastDB-only access, cache-bust, design-tokens, no-PII-console, no-hardcoded-ids, unbounded-read, ux-standards, customer-writes, module-info, readiness-parity, no-local-fmt) + `gen-inventory --check`. Several are **ratchets** (baselined, only improve); two read **live source** so the gate fails the instant prod drifts. | ✅ CI **+** PostToolUse hooks (block at authoring time) |
| **Unit** | ✅ **Strong but narrow** | 69 tests over **7 pure `shared/` engines only** (`mast-io`, `mast-ui`, `mast-entity`, `customer-filters`, `variant-reconcile`, the finance money normalizer, lint-ratchet self-test). Two are clever regressions that extract the live function under test. | ✅ CI `lint` job |
| **Component** | ❌ None | — | — |
| **Integration** | ❌ **None** | No test wires a module to MastDB, renders into a DOM, or exercises a Bridge / `onSave` / fetch path. | — |
| **E2E (in-repo)** | ❌ **None** | No cart→checkout, no admin CRUD round-trip. ~40 storefront HTML pages + 91 modules have zero behavioral coverage. | — |
| **Smoke** | ⚠️ **External, not a gate** | Playwright `smoke-boot.mjs` (on branches / via `mast_platform_smoke_run`): boots `?testmode=1&tenant=sgtest15`, navigates ~52→96 routes, asserts zero uncaught errors. **Fail-open**, filters expected permission noise, **route-render only**. | ❌ Not a merge gate; operator-run |
| **Visual regression** | ❌ **Near-zero** | `theme-sanity.html` is an unreferenced manual copy that silently rots; `capture-modes.js` is a **marketing screenshot generator** (Playwright, but no assertions). | — |
| **Contract** | ⚠️ **One file** | `lint-readiness-parity.js` SHA-pins `product-readiness.core.js` byte-for-byte against the MCP-server repo. Every *other* UI↔MCP contract can drift silently. | ✅ CI (if the other repo re-blesses) |
| **Deploy verify** | ✅ Narrow | `deploy.yml` SHA-checks the deployed `index.html` vs committed (catches stale-tarball deploys). `index.html` only; modules not hashed. | ✅ post-merge |

**Shape:** a wide, rigorous static base + a thin unit cap over pure helpers — and a
**missing middle and top**. This is the "inverted-pyramid-minus-the-top" anti-shape: the
project substitutes *lint invariants* for the integration/E2E layers. That is unusually
disciplined for catching known defect *classes*, but it cannot catch *behavioral* failure.

### 2.2 Live / manual verification (not in CI, but the real workhorse)

| Method | What it is | Strength | Limit |
|---|---|---|---|
| **Chrome MCP live-verify** | Hand-driven browser automation on `sgtest15` ("`live-verified`" appears ~945× across sessions; `Claude_in_Chrome` ~18,100×). Drives real UI state machines, asserts DOM/localStorage/dataset state. | Catches real interaction/behavioral bugs nothing else can | Manual, per-session, single-load, re-built each time; `testmode` is **write-denied** so destructive writes can't be verified |
| **Tenant MCP as oracle** | `finance_get_*` etc. used as an independent **numeric cross-check** | Caught money bugs code review missed (100× cents inflation; POS double-count, confirmed as `finance_get_revenue = 6000000¢` vs true $600) | Read-only corroboration, not a gate |
| **Hand-built use cases** | One-off worktree docs: `test-results.md` (7 E2E journeys, **found 10 bugs** incl. 2 high-sev product-creation blockers + the chronic date off-by-one); `FINANCE_TEST_CASES.md` (~50 MCP-tool cases w/ seed data + expected JSON) | The most rigorous testing the project ever produced | **Not maintained** — point-in-time artifacts; `test-results.md` even targets an old site |
| **Adversarial multi-agent review** | 3 independent agents (architecture/security/scope) reviewed a design *against the code* | Found a design built on a stale mental model (missed ~10 live secret-paste sites) | Design-time, not runtime |

---

## 3. How it's actually been used (past sessions)

**Verdict: disciplined but ad-hoc, and visibly maturing.** The per-PR ritual was
"`dev-verify on sgtest15`" — a manual Chrome walkthrough plus MCP cross-check, gated at the
bottom by the unit/lint floor. Evidence it is *systematized*: 69 unit tests + 12 lints run
as **both** required CI checks **and** PostToolUse hooks; a documented
`<tenant>.runmast.com` verify protocol; Tier-0 (2026-06-01) deliberately moved ~1,180
fleet tests behind merge gates and then self-reviewed to close "hollow gate" holes.
Evidence it is *ad-hoc*: the dominant method is re-built every session, the richest test
artifacts are one-off worktree files, and big-feature confidence rests on manual
walkthroughs, not regression tests.

**Recurring friction (re-learned so often they're standing memory entries):**
- **Isolated-world browser bridge.** `execute_javascript`/`javascript_tool` run in an
  isolated world — page globals (`MastDB`, `currentUser`) are invisible → the standard
  workaround is a `<script>`-injection **main-world bridge** reporting via `document.title`.
- **`javascript_tool` returns `{}` for an unawaited Promise** (burned twice).
- **hash-only nav ≠ reload** → serves **stale code**; must confirm `window.MAST_MODULES_V`
  matches the deployed bundle *before* judging anything.
- **Two caches mask a fresh deploy** (Cloudflare edge + the PWA service worker; `?v=` does
  not bypass the SW).
- **`testmode` is write-denied** → real write-paths repeatedly logged as "POST-MERGE owed."
- **Token cost of sweeps** → sessions built a "stateful pipelined sweep (1 call/route)."

**What was repeatedly missed / found late** (the recurring failure modes a next-gen program
must target):
- **Boot-interaction islands** the route-smoke structurally cannot catch — e.g. a
  byte-boundary slip that "silently breaks the account menu + dark mode for all users at
  boot" (the smoke navigates routes, it doesn't exercise interaction surfaces).
- **Admin boot was intermittently dead** (no retry on 5 gstatic `<script>` tags) — a flake
  class no single-load check reproduces (fixed PR #491).
- **Date off-by-one** — chronic; `YYYY-MM-DD`→local-midnight parsing kept slipping through
  (drove the whole `mast-format.js` effort, PRs #752/#754).
- **Silently-swallowed Firestore errors** — `MastDB.get().val()` defaulting; slash-keyed
  field paths throwing and being swallowed (inventory ops silently no-oped).
- **Money math** (cents/×100) caught by the MCP *oracle*, not by code review.

---

## 4. The two surfaces under test — and why both matter

The product has **two users**: a human (admin UI) and an AI agent (tenant MCP). A
next-gen program must measure *both* operating experiences.

- **Human UI:** ~91 lazy modules, **V2 is the live default**, mid a "V1 retire-and-absorb"
  migration — ~42 V1 modules still live behind ~30 `*Bridge` globals (so a V1 file is
  often still the source-of-truth behind a V2 surface). **Migration debt, not missing
  features, is the headline functional risk.**
- **AI agent / MCP:** ~73 tenant tools. **Token-efficient by design** (list calls return
  *projections* — `mast_products` list = 849 B; `finance_get_revenue` = 184 B; values in
  integer cents, dates `YYYY-MM-DD`), with two real agent-safety controls worth explicitly
  testing: a **two-call confirmation handshake** on mutating actions and
  **`<untrusted-user-content>` prompt-injection wrapping** of tenant strings.

**Dual-interface parity (sampled):** the MCP is a strong *back-office operator* (catalog →
costing/BOM → inventory → order triage/fulfillment → procurement → finance reporting →
HR/time → expenses); in **costing it exceeds the UI** (`simulate_metal_shift`, `reprice`,
`list_needing_reprice`). But it is **UI-only** for the website/storefront builder,
classes/booking (an 11-route sub-app), marketing authoring, and POS — and production
sale/order *creation* is deliberately storefront-gated for the agent. These are
coverage gaps to weigh in lens 1 and lens 3.

---

## 5. Industry baseline (2025–26) — condensed

*(Full citations in the appendix.)*

**A. Testing program (table-stakes).** Modern web SaaS = **Testing Trophy** (static base →
unit → **integration-heavy** → few E2E). Default stack: **Vitest + Playwright + Testing
Library + axe-core**. Gates: lint/typecheck → unit/integration → build → **E2E on a
preview/ephemeral env (required check)** → security scan → coverage. Coverage norm is
moving from a global threshold to **diff-coverage ~80–90% on changed lines** (Google's
bands: 60% acceptable / 75% commendable / 90% exemplary; "coverage measures execution, not
quality"). Flaky tests are managed by **quarantine with fix-or-remove in ~2 weeks**.

**B. AI/agentic testing (what's real vs hype).** **REAL:** Microsoft's **Playwright Test
Agents (Planner/Generator/Healer)**, v1.56 — drives the browser via the **accessibility
tree** (~200–400 tokens/snapshot), generates real deterministic test files, auto-heals.
Selector/wait self-healing covers ~28–30% of real breakages each (one mechanism ≠ all
failure classes). **LLM-as-judge** reaches **>80% agreement with humans** on
*constrained/rubric-bound* tasks (good for validating MCP output structure) but carries
position/verbosity/self-preference bias on open-ended ones. **NOT a gate yet:** computer-use
agents — strong on exploratory QA but strict-success ~17% with ~1.4× step overhead.

**C. Agent Experience (AX) — the new discipline.** Coined Jan 2025 (Biilmann/Netlify): the
holistic experience an AI agent has *as a user*. Anthropic's **"Writing effective tools for
AI agents"** gives the eval-backed principles directly applicable to our MCP: *consolidate
tools* (more tools ≠ better), namespacing, descriptions-as-prompt-engineering, errors that
guide, return semantic context not raw IDs. Token wins are large and measured: a concise
`response_format` used **~⅓ the tokens**; code-execution-with-MCP cut one workflow
**150k → 2k tokens (98.7%)**. Borrowable eval method: score a tool surface on **accuracy,
tool-call count, tokens, runtime, error rate** over real multi-tool tasks.

**D. Agent-operability benchmarks (borrowable methodology).** **τ-bench** (customer-service
tool-use) introduced **pass^k** — all k attempts succeed — exposing that a 90% single-shot
agent drops to **~57% at k=8** (reliability ≠ headline accuracy). **AppWorld** (9 apps / 457
APIs) adds **side-effect / collateral-damage checks** — directly relevant to a *mutating*
business-tool API. **WebArena / VisualWebArena / OSWorld** measure task success vs a human
baseline.

**E. Product-quality frameworks for the 3 lenses.**
- **Functional completeness →** ISO 25010 *Functional Suitability* (completeness /
  correctness / appropriateness); operationalized via **Requirements Traceability Matrix +
  Definition of Done** (target: 100% of requirements traced to a passing test).
- **Ease of use →** **SUS** (avg **68**; "good" **80+**), **task-completion rate** (avg
  **78%**; serious problems <70%; top quartile >92%), **SEQ** (avg **~5.5/7**), error rate
  (~0.7/task). **AI-agent analog:** task success (pass@1) + **pass^k** + **tokens/steps/cost
  per task**, reported as an **accuracy–cost trade-off** (Holistic Agent Leaderboard).
- **Right things →** **Outcomes over outputs**, a **North Star metric** + input metrics,
  **RICE / opportunity-scoring** for prioritization, **Sean Ellis 40% PMF** signal,
  **JTBD/ODI** (invest where importance is high and satisfaction is low).

---

## 6. The comparison — scorecard against the three lenses

Maturity scale: 🟥 absent · 🟧 ad-hoc/manual · 🟨 partial/structural · 🟩 strong/systematic.

### Lens 1 — Functional completeness (does it work, without errors?)

| Sub-question | Our state | Industry standard | Gap |
|---|---|---|---|
| Known defect *classes* prevented | 🟩 12 lints + 2 live-source regressions | ESLint/TS base | **At/above** standard |
| Pure-logic correctness | 🟨 69 tests, 7 helpers only | unit on all logic | Most of 91 modules have no regression net |
| Module boots without runtime error | 🟧 external smoke, fail-open, not a gate | preview-env E2E as required check | **No CI ever loads the app** |
| Workflow correctness (CRUD round-trips, checkout, booking) | 🟥 manual Chrome only | integration + E2E on critical journeys | **The biggest hole** |
| MCP↔UI contract integrity | 🟨 1 file SHA-pinned | contract tests at boundaries | Only readiness is pinned |
| Mutating-API side-effects | 🟥 none | AppWorld-style collateral checks | Untested on a money-moving API |
| Visual/theme/responsive | 🟥 1 rotting manual copy | Playwright snapshots / Chromatic | No visual regression |
| **Traceability (req→test)** | 🟥 none | RTM + DoD, ~100% traced | No coverage *map* of capabilities |

### Lens 2 — Ease of use (human *and* AI agent)

| Sub-question | Our state | Industry standard | Gap |
|---|---|---|---|
| **Human** task success / time / effort | 🟥 none | SUS ≥68 (aim 80+), completion ≥78%, SEQ ≥5.5 | **No usability instrument at all** |
| **Human** accessibility | 🟥 none | axe-core (~57% WCAG auto), required | No a11y testing |
| **AI agent** task success | 🟧 implicit (the agent ran the session) | pass@1 / TGC on real task set | Not measured |
| **AI agent** reliability | 🟥 none | **pass^k** (repeatable success) | Not measured |
| **AI agent** efficiency | 🟨 surface *is* token-efficient by design | tokens/steps/cost per task, tracked | Efficiency designed, never *scored* |
| **AI agent** safety controls work | 🟧 handshake + injection-wrap exist | adversarial eval of both | Built, not fuzz-tested |

### Lens 3 — Business value (the right things?)

| Sub-question | Our state | Industry standard | Gap |
|---|---|---|---|
| Capabilities mapped to jobs/outcomes | 🟧 rich UX-audit docs, no value model | JTBD/ODI, outcomes-over-outputs | No outcome metric per capability |
| Prioritization rigor | 🟨 roadmap + memory, implicit | RICE / opportunity score | No explicit scoring |
| PMF / value signal | 🟥 none surfaced | Sean Ellis 40%, North Star + inputs | No value-signal loop |
| Parity vs. need (UI-only gaps) | 🟨 known (website/booking/POS MCP gaps) | coverage-vs-importance matrix | Gaps known, not value-ranked |

### Testing-program maturity, one line per lens

| Lens | Today | Target shape (next-gen) |
|---|---|---|
| **1 Functional** | 🟨 strong *structural*, 🟥 behavioral | integration + critical-journey E2E + smoke-as-gate + contract + visual |
| **2 Ease of use** | 🟥 (human) / 🟧 (agent) | SUS/task-success harness + axe; agent-operability scorecard (pass^k, tokens/task) |
| **3 Business value** | 🟧 | outcome metric per capability + value-ranked coverage matrix |

---

## 7. Concrete findings worth acting on now (independent of program design)

These surfaced during discovery and stand on their own:

1. **`docs/generated/admin-inventory.md` is stale in the working tree right now.**
   `node scripts/gen-inventory.mjs --check` exits **1**; the `docs-inventory` CI gate runs
   exactly that, so a PR would be red until regenerated. (The gate is *working* — this is a
   freshness reminder, not a hollow gate. But the doc shouldn't be trusted for module
   counts at any given moment; real count is **91 modules / 49 V2**, not the 119 it claims.)
2. **The boot-smoke should arguably be a (fail-*closed*) merge gate.** Today nothing in CI
   loads the app; a `ReferenceError` on any of 91 lazy modules merges green. Making the
   route-smoke a required check is the single highest-leverage, lowest-cost upgrade.
3. **`theme-sanity.html` is a verbatim copy that will silently rot** — either delete it or
   convert it to a real assertion against the live token block.
4. **The MCP safety controls (confirmation handshake + injection-wrap) are untested.** They
   are genuine differentiators; they deserve an adversarial test (injection payloads in
   product names / reviews; handshake-bypass attempts).
5. **`capture-modes.js` looks like visual-regression but isn't** (no assertions) — worth a
   note so it's not mistaken for coverage.

---

## 8. What the next phase (Evaluate → Design) must decide

Open questions to resolve before designing the next-gen program. *(Candidates listed are
raw material, not recommendations.)*

1. **Scope of lens 2.** Do we instrument human usability (SUS/task-success/axe), AI-agent
   operability (a pass^k + tokens-per-task scorecard over a fixed task set), or **both**?
   The dual-user nature of this product makes the **agent-operability scorecard** an
   unusually high-value, on-brand differentiator — but it's net-new.
2. **How much behavioral testing, and where on the pyramid?** Options: (a) make the
   route-smoke a gate (cheapest), (b) add a small **critical-journey E2E** suite on a
   preview env (checkout, product-create, order pipeline, money math), (c) add
   **integration** tests around the Bridges/`onSave` paths. Likely a staged mix.
3. **AI-in-the-loop, and how far?** Playwright Planner/Generator/Healer for test *authoring*
   and **LLM-as-judge** for narrow MCP-output correctness are the low-risk on-ramps;
   computer-use as a *gate* is not ready (~17% strict success). Where's our line?
4. **Who runs it, and when?** Reconcile with the dev-frictionless / prod-gated model — what
   becomes a required PR check vs. a nightly/operator sweep vs. a pre-prod gate.
5. **The oracle problem.** The MCP-as-numeric-oracle pattern already caught the bugs code
   review missed. Should cross-checking the UI against the MCP (and vice-versa) become a
   *first-class, automated* dual-source assertion rather than a manual habit?
6. **Business-value loop.** Is lens 3 in scope for a *testing* program at all, or does it
   belong to product analytics (North Star + outcome metrics)? If in scope, the artifact is
   a **capability × importance × test-coverage** matrix.

---

## Appendix — source citations (industry baseline)

- Kent C. Dodds, *Write tests. Not too many. Mostly integration.* — https://kentcdodds.com/blog/write-tests
- Martin Fowler / Ham Vocke, *The Practical Test Pyramid* — https://martinfowler.com/articles/practical-test-pyramid.html
- *State of JavaScript 2025: Testing* — https://2025.stateofjs.com/en-US/libraries/testing/
- ThoughtWorks Technology Radar — *Playwright*, *Component testing (browser-based)* — https://www.thoughtworks.com/radar
- Deque, *axe-core* (~57% WCAG auto) — https://www.deque.com/axe/axe-core/
- Google Testing Blog, *Code Coverage Best Practices* (60/75/90) — https://testing.googleblog.com/2020/08/code-coverage-best-practices.html
- Microsoft, *playwright-mcp* — https://github.com/microsoft/playwright-mcp · Playwright *Test Agents* — https://playwright.dev/docs/test-agents
- Zheng et al., *Judging LLM-as-a-Judge with MT-Bench* (>80% human agreement) — https://arxiv.org/abs/2306.05685
- Anthropic, *Introducing computer use* (OSWorld 14.9/22.0%; "error-prone") — https://www.anthropic.com/news/3-5-models-and-computer-use
- Anthropic Engineering, *Writing effective tools for AI agents* — https://www.anthropic.com/engineering/writing-tools-for-agents
- Anthropic Engineering, *Code execution with MCP* (98.7% token reduction) — https://www.anthropic.com/engineering/code-execution-with-mcp
- Mathias Biilmann, *Introducing AX: Why Agent Experience Matters* — https://biilmann.blog/articles/introducing-ax/
- Sierra, *τ-Bench* (pass^k) — https://sierra.ai/blog/benchmarking-ai-agents
- CMU, *WebArena* — https://webarena.dev/ · *VisualWebArena* — https://jykoh.com/vwa
- *AppWorld* (collateral-damage checks) — https://arxiv.org/abs/2407.18901 · *OSWorld* — https://os-world.github.io/
- ISO 25000 Portal, *ISO/IEC 25010* — https://iso25000.com/index.php/en/iso-25000-standards/iso-25010
- MeasuringU, *SUS* (avg 68) — https://measuringu.com/sus/ · *Task-completion* (78%) — https://measuringu.com/task-completion/
- NN/g, *Measuring Perceived Usability (SUS/SEQ/NASA-TLX)* — https://www.nngroup.com/articles/measuring-perceived-usability/
- Holistic Agent Leaderboard (accuracy–cost) — https://arxiv.org/pdf/2510.11977
- Amplitude, *North Star Metric* — https://amplitude.com/blog/product-north-star-metric · SVPG, *Outcomes Over Output* — https://www.svpg.com/
- Learning Loop, *Sean Ellis Score* (40% PMF) — https://learningloop.io/glossary/sean-ellis-score
