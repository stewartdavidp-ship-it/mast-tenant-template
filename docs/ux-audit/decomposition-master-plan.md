# mast-tenant-template — Decomposition & Centralization Master Plan

**Status:** Plan / proposal — **revised after 3-reviewer pass** (drafted + hardened 2026-06-18). No code changes pending operator go.
**Author:** Architecture review session.

> **Revision note (3 reviews: architecture, pragmatism, technical fact-check).** This draft
> incorporates corrections from an adversarial review where each reviewer verified claims
> against the code. Material changes from v1: **(a)** Track 2 (per-file cache-bust) is now the
> **first PR**, not an independent aside — it de-risks Track 1's merge-thrash; **(b)** Track 0
> is reframed from "gates everything" into two cheap artifacts grown inline (avoids the
> analysis-paralysis stall); **(c)** Track 6 is re-driven by the **Bridge dependency graph**,
> not memory parity — Bridges live *inside* V1 modules and 24 V2 surfaces call into them;
> **(d)** Track 7 gains a hidden prerequisite — **`sanitizeHtml` does not exist yet**;
> **(e)** Track 4 (esbuild) is **cut** — the query-string-per-entry cache-bust needs no build
> step and preserves the source=served-bytes deploy invariant; **(f)** numeric corrections
> inline (see §1). See §13 for the full review synthesis.
**Scope:** Break up the oversized admin SPA and centralize repeated logic to improve
(a) future build quality, (b) production deploy speed, and (c) runtime performance —
*without* a big-bang rewrite. All work is incremental, PR-by-PR, behind the existing
lazy-module + lint-gate machinery.

---

## 0. TL;DR

The admin app is one 3.1 MB file (`app/index.html`, 60,861 lines) whose **80% is a single
49,143-line inline `<script>`** that loads eagerly on every admin page view. The module
system that *should* hold that code already exists and works (91 lazy modules, 111K lines,
loaded by route). The fix is to **finish migrating into the pattern you already trust**, and
to **centralize the repeated logic** (money/date/CSV/badges) that the V2 component work
started but never extended to the 91 legacy modules.

**The one load-bearing constraint:** none of this is safe today because there is **no
test safety net** (7 tests, all covering *new* shared cores; zero over the inline block or
the 91 modules) and **no production error visibility** (248 silent `catch {}`, no central
reporter). Those two come first or the whole program risks turning a refactor into an outage.

The eight tracks, in dependency order:

| # | Track | Primary goal served | Sequencing |
|---|-------|---------------------|------------|
| **2** | Per-file cache-bust (query-string-per-entry) | deploy speed | **SHIP FIRST** — de-risks Track 1 |
| **0** | Smoke test + money/date goldens (+ error sink) | safety net | land in first 2 PRs, grow inline |
| 1 | Extract the 49K inline block → core + lazy modules | build quality, perf | after 0's smoke test |
| 5 | Centralize repeated logic (money/date/CSV/badge/empty) | **consistency** | rides Track 1 |
| 7 | XSS sanitizer adoption | security | rides Track 1 (needs sanitizer built first) |
| 6 | V1 retirement-and-absorb (Bridge-graph-driven) | mass reduction | opportunistic, per vertical |
| 3 | Lazy-load xlsx/papaparse; (defer CSS split) | perf, supply chain | 1-PR quick win |
| ~~4~~ | ~~esbuild build step~~ | — | **CUT** (breaks source=served-bytes) |

**The execution insight:** tracks 1, 5, 6, 7 all mean *touching the same modules*. Do them
as **one pass per module** — extract a section, de-dupe its formatters, sanitize its
`innerHTML`, and if it's a retired V1 surface, absorb-and-delete it. One edit, four wins.

---

## 1. Current-state facts (measured 2026-06-18 @ HEAD `43df11dd`)

### 1.1 The monster
| Surface | Size | Load timing |
|---------|------|-------------|
| `app/index.html` | **3.1 MB / 60,861 lines** | eager, every admin view |
| → inline JS (one `<script>`, lines 11,901–60,857) | **49,143 lines (80%)** | eager |
| → inline CSS | 6,285 lines (10%) | eager |
| → HTML markup | 5,433 lines (8%) | eager |
| `app/modules/*.js` (91 files) | 111,330 lines | **lazy, by route** ✅ |
| `shared/*.js` (~13 files) | ~340 KB | eager |

What lives in the 49K inline block (sampled): Firebase init, `MastNavStack`,
`MastDirty`, `MastCustomers` (customer hub + write-path hooks), the `MastDB` entity
factory, the Subscription/tier model + gating UI, the wallet modal, the add-to-Mast
drawer, module-selection UI, and dashboard rendering. **Mix of genuine core and
route-gated feature surfaces that have no reason to load eagerly.**

### 1.2 The module system (the pattern to finish migrating into)
- `MastAdmin.registerModule(id, config)` / `MastAdmin.loadModule(id)` (index.html ~22203).
- Module manifest: **118 entries**, of which **only 91 point to real files — 27 are dangling
  `src:` paths to never-built v2 stubs** (lots-v2, jobs-v2, fulfillment-v2, pos-v2, social-v2…).
  Free cleanup item; explains the 91-vs-118 gap.
- Loader appends `?v=' + MAST_MODULES_V` to each `<script src>` (index.html:22243); plain
  tags, **no retry** — **but it is not silent on failure**: a `window.error` listener scoped to
  the module `src` + `onerror` surface a toast (index.html:22232–22256). (Corrects v1's
  "silent blank surface" claim.)

### 1.3 Cache-busting (the deploy-speed problem)
- **One global `MAST_MODULES_V`** literal stamped on **all 91 modules + 8 shared scripts**.
- Any PR touching `index.html` or *any* module bumps it (enforced by
  `scripts/lint-cache-bust.js`). Result: **every deploy invalidates every user's entire
  cached JS set** — all 91 modules re-download even on a one-line change.
- Deploy ships a tarball at the merged SHA; the 3.1 MB `index.html` is the dominant byte.
- The single version line **re-conflicts on every parallel merge** (documented merge-thrash).

### 1.4 Third-party deps
**Truly eager (head `<script>`, render-blocking):** `firebase`, **`xlsx@0.18.5`** (SheetJS —
CVEs in this range), `papaparse@5`. **Already lazy (injected on use — corrected from v1):**
`html2canvas@1.4.1` (index.html:58168, screenshot path), `plaid link-initialize`
(index.html:31037, bank-link path). So Track 3's real target is `xlsx` + `papaparse` (only
needed on import/export, not first paint), not the whole list.

### 1.5 Duplication inventory (the consistency problem)
| Repeated work | Spread | Canonical home | Status |
|---|---|---|---|
| Money fmt (cents→`$`) | `toFixed(2)` ×36 files, `/100).toFixed` ×28, `'$'+` ×27, `toLocaleString` ×20; shared formatter ×**0** | `MastUI.money` exists | **exists, ~0 adoption** |
| Date / `Timestamp` coerce | `formatDate`/`fmtDate` ×15, `toLocaleDateString` 71 hits/29 files | `MastUI.date` exists | **exists, ~0 adoption** |
| HTML escape | local `function esc()` ×14 | `MastUI`/`sanitizeHtml` | duplicated |
| CSV export | hand-built joins ×50; PapaParse (already loaded) used ×**1** | none | **missing** |
| Status badge / pill | badge markup ×55, status→color/label maps ×56 | none | **missing** |
| Empty states | hand-rolled "no X yet" ×60 | none | **missing** |
| Confirm dialogs | `mastConfirm` ×40, **but bare `confirm()` still ~21 calls / 9 files** (~40/14 incl. `window.confirm(`) | `mastConfirm` | incomplete |
| Toasts | ×74 | (centralized) | ✅ ok |

`MastUI` already exposes `money / moneyRaw / moneyVal / date / dateRaw` — but only the V2
entity engine consumes them. **The home exists; adoption is the gap.**

### 1.6 Safety net (the gating gap)
- **Tests:** 7 files — `customer-filters`, `finance-order-money`, `lint-ratchet`,
  `mast-entity`, `mast-io`, `mast-ui`, `variant-reconcile`. **All cover new shared cores.
  Zero over the 49K inline block or the 91 modules.** Playwright is a dep; no E2E specs.
- **Error handling:** ~1,478 `catch` blocks (modules); **~249 silent/empty `catch {}`**
  (modules) / **~403 incl. index.html**; **0 central error reporter**; ~437 stray `console.*`.
  (Counts scoped to `app/modules`; the loader itself already toasts load failures — §1.2.)
- **Listeners:** 44 subscriptions vs 51 teardowns (roughly balanced in aggregate; per-module
  correctness unverified — known unlisten bugs in history).
- **XSS:** **888 `innerHTML =`** across the modules (**+~618 in the inline block** → Track 7's
  real surface is ~1,500), **0 routed through a sanitizer**. ⚠️ **Correction:** a canonical
  `sanitizeHtml` **does not exist in this tree** — only `sanitizeFilename` and a local
  `sanitizeString` (maker.js). Track 7 must **build the canonical sanitizer first**, then route
  sinks — prioritizing tenant-authored content that reaches the raw-injecting storefront.

### 1.7 Dead/duplicated V1↔V2 weight (the largest mass)
17 V1/V2 pairs. V1 halves are the biggest files in the repo:

| V1 (lines) | V2 (lines) | Memory note |
|---|---|---|
| orders.js (6,262) | orders-v2 (222) | OrdersBridge single-sources; "#orders can go dark" |
| customers.js (3,485) | customers-v2 (260) | V2 CRUD shipped |
| team.js (3,270) | team-v2 (395) | HR compliance/docs shipped |
| channels.js (2,797) | channels-v2 (382) | channels-OAuth family shipped |
| newsletter.js (2,336) | newsletter-v2 (289) | marketing-v2 native create |
| blog.js (2,333) | blog-v2 (329) | V1 editor eliminated |
| procurement.js (2,292) | procurement-v2 (651) | V2 New-PO shipped |
| students/wholesale/trips/contacts/brand/homepage/promotions/campaigns/email-log/marketing-calendar | (thin V2) | various |

**Critical nuance:** thin V2 modules (orders-v2 = 222L) **delegate into V1 logic via
Bridges** — so V1 is often still the single source of truth, not dead code. This is
**retirement-and-absorb**, not deletion. Proven precedent: `show-light.js` deleted,
blog V1 editor eliminated.

---

## 2. Track 0 — Safety net (two cheap artifacts, NOT a milestone)

**Goal:** make every later change observable and reversible. **Reframed after review:** this is
*not* a gate you complete before all other work — that framing risks weeks of test-writing with
zero shipped value. It is **two artifacts landed in the first two PRs, then grown inline** as
each piece of logic is extracted. Tests already run inside the required `lint` check
(`lint.yml` chains `node test/*.js` with `&&`), so adding one is appending ` && node
test/new.test.js` — **near-zero infra cost.**

The minimum-viable net before touching the inline block:
- **Money/date golden tests** (pairs with Track 5's `mast-format.js`) — a true `&&` clause in the
  existing `lint.yml` test chain. Cheap, ship in PR2.
- **One Playwright smoke spec:** boot admin → each top-nav route renders with no console error.
  Highest-leverage artifact — but it is **NOT** another `&& node test/x.js` line: Playwright needs
  its own CI step (`npx playwright test`, a browser install, a flake budget). Give it a separate
  job. **If schedule slips, ship the goldens and let the smoke spec land independently** rather
  than blocking M1 on Playwright CI plumbing.

Everything else (per-logic characterization tests) is written **right before** moving that
logic — that's what "characterization" means. Don't front-load it.

### 2.1 Characterization tests (not aspirational unit tests)
Pin *current observed behavior* of the highest-risk shared logic so refactors that change
it fail loudly:
- **Money & date core** — golden tests for cents→`$` and `Timestamp`/string→display across
  the formats found in §1.5 (this is the bug class behind the recurring 100× / `priceCents`
  / `Timestamp.substring` incidents).
- **MastDB access contract** — `get()` returns raw (not `.val()`), `push()` on doc-scoped
  paths, transaction semantics. Memory shows these footguns caused real revenue bugs.
- **Smoke E2E (Playwright, already a dep):** boot admin → each top nav route renders without
  console error. Cheap, catches extraction breakage immediately.

Runner: align with existing `*.test.js`. **No new CI wiring needed** — `lint.yml` already chains
`node test/*.js` with `&&` inside the required check, so a new test is one appended `&&` clause.

### 2.2 Central error sink — scoped to dev-side only (prod sink spun out)
- **In-repo scope: a ~30-line `shared/mast-telemetry.js` `MastError.capture(err, context)` that
  wraps `console.error` only.** The **batched POST to a tenant-scoped prod sink implies a backend
  endpoint + auth + tenant scoping that is out-of-repo** (this is the storefront template) — spin
  it out as a separate, separately-justified item so it can't balloon inside "grow it inline."
- **Rationale (corrected):** the justification is the **~249 empty `catch {}` + ~437 stray
  `console.*`**, NOT module-load failure — the loader *already* toasts those (§1.2). Don't scope
  the sink to the loader.
- Adopt opportunistically: each silent `catch {}` touched during extraction routes through it.
  This is a nice-to-have, not a gate — add it when a silent catch first bites during extraction.

---

## 3. Track 1 — Extract the 49K inline block

**Goal:** shrink `index.html`, stop eager-loading route-gated code, end the merge-collision hot file.

Carve the single inline `<script>` into:
- **Eager bootstrap (stays in index.html, target < 2K lines):** Firebase init, route table,
  `loadModule`/`registerModule`, top-level nav shell.
- **Eager core modules** (loaded once, needed app-wide): `core-db.js` (MastDB / MastCustomers /
  write-path hooks), `core-nav.js` (MastNavStack / MastDirty), `core-subscription.js` (tier
  model + gating UI).
- **Lazy feature modules** (route-gated, no reason to be eager): wallet modal, add-to-Mast
  drawer, module-selection UI, dashboard.

**Method:** one self-contained section per PR, using the exact `registerModule` pattern the
91 modules already use. `index.html` shrinks every PR; user-visible behavior unchanged. Each
PR is gated by the Track-0 smoke test.

**Pre-step (added after review, then bounded): a global def/read map — for the surface in flight,
NOT the whole 49K block up front.** The inline block has **load-order-sensitive top-level
execution** — e.g. `MastAdmin.loadModule('shows')` fires mid-block at index.html:18303, and ~618
inline `innerHTML` sinks read `MastAdmin`/`esc`/`navigateTo` synchronously at parse time. Before
extracting a given section, map which globals *that section* defines vs reads. Mapping the entire
block before the first PR re-imports the Track-0 stall the revision was trying to avoid — keep it
per-PR (wallet modal first).

**Risk:** "keep globals on `window` + smoke test" does **not** catch a timing-dependent
`undefined` that only fails on a cold cache or slow network. Mitigation: extract leaf surfaces
first (wallet modal, drawer), core last; the def/read manifest gates each PR; smoke test every PR.

---

## 4. Track 2 — Per-file cache-busting (SHIP FIRST)

**Goal:** returning users re-download only what changed; kill the cache-bust merge-thrash.

**Mechanism (revised after review — query-string-per-entry, NOT filename hashing):** give each
`MODULE_MANIFEST` entry an optional per-file version and change the loader's one line
(index.html:22243) from `manifest.src + '?v=' + MAST_MODULES_V` to
`manifest.src + '?v=' + (manifest.v || MAST_MODULES_V)`. A `scripts/` step writes each entry's
content hash at commit time; unchanged entries keep their old hash → the browser cache survives.

Why this variant over filename hashing (`orders.<hash>.js`):
- **No build step required** → Track 4 (esbuild) stays cut. Filename hashing would force a build
  to rewrite all 118 `src:` strings and emit hashed files, inverting the dependency (2→needs 4).
- **Preserves the source=served-bytes invariant** the deploy verify depends on — `deploy.yml`
  compares the SHA-256 of the *committed* `app/index.html` against the live origin
  (deploy.yml:111). Query-string versions live in the committed manifest; nothing about served
  bytes changes shape.
- Removes the single re-conflicting `MAST_MODULES_V` line → ends the documented merge race.

**Scope honestly — the loader change is a one-liner, but PR #1 is not (review finding).** The
supporting tooling is real work (~1–2 days), with edge cases the loader line hides:
- A **new hash-writer script** must hash each `modules/*.js` and rewrite its `v:` field inside the
  `MODULE_MANIFEST` JS-object literal — string-surgery on a 3.1 MB file (the manifest is a JS
  literal, not JSON), run at commit time via a **git-hook change** (`install-hooks.sh`).
- **`lint-cache-bust.js` must be rewritten.** Today it greps for a changed `^var MAST_MODULES_V`
  (lint-cache-bust.js:41,123) and would **red-X a per-file PR** that doesn't bump the global. The
  gate's logic has to move to per-entry hash diffing — i.e. Track 2 *replaces* the gate, not just
  clears it.
- **Reconcile the 8 un-manifested shared `<head>` tags** (`product-readiness.core.js?v=…` etc.,
  index.html:205+) — they carry `?v=` but live in raw `<head>`, not `MODULE_MANIFEST`, and the
  current bumper keeps them in lockstep via a dedicated branch. Either fold them into the per-file
  scheme or they keep needing the global bump (running both schemes in parallel). **Explicit
  checklist item or it ships broken.**

**Sequencing:** still **PR #1.** It's independent, fixes pain felt today, and — the key insight
from review — it removes one of the two gate-conflict sources *before* the Track 1 extraction
campaign that trips it on every PR. Just estimate it as a tooling PR, not a one-liner.

---

## 5. Track 3 — Eager-load diet (1-PR quick win; CSS split deferred)

**Goal:** cut first-paint bytes. **Descoped after review:** the 3.1 MB of JS is the bottleneck,
not the 6,285 CSS lines — CSS extraction is a render-blocking micro-opt dressed as architecture.

- **Do now (the quick win): lazy-load `xlsx` + `papaparse`** on first use (import/export), not
  at boot. Pin and CVE-audit `xlsx@0.18.5` (consider a maintained fork). (`html2canvas`/`plaid`
  are already lazy — §1.4.)
- **Defer:** CSS extraction and eager-`shared/` trimming (e.g. `business-entity-constants.js`
  88 KB) until after the extraction campaign shows they're actually on the hot path.

---

## 6. Track 4 — esbuild build step — **CUT**

Removed after review. The deploy model assumes **source = served bytes** (`mast_hosting` ships
the committed tarball at the merged SHA; verify hashes committed `index.html` against the live
origin, `deploy.yml:111`). A build step breaks that invariant and forces committed build
artifacts or a pipeline rewrite. Track 2's query-string-per-entry cache-bust delivers the
deploy-speed win without it. Do **not** introduce a bundler unless a future, separately-justified
need arises.

---

## 7. Track 5 — Centralize repeated logic

**Goal:** consistency first, DRY second. Kill the recurring money/date bug class structurally.

New/extended canonical homes (small, pure, testable — same shape as `product-readiness.core.js`):
- **`shared/mast-format.js`** (or promote `MastUI.money`/`date` to a non-engine entry point):
  `money(cents)`, `moneyVal(cents)`, `date(tsOrStr)`, `coerceDate(tsOrStr)` (the `Timestamp`
  defuser). Backed by the Track-0 golden tests.
- **`shared/mast-export.js`:** thin wrapper over the already-loaded PapaParse —
  `toCsv(rows)` / `download(name, rows)`. Replaces 49 hand-rolled CSV builders.
- **`MastUI.statusBadge(status, domain)` + `MastUI.emptyState({icon,title,hint})`** added to
  the existing mast-ui.

**Design decision needed before coding `statusBadge`:** the 56 status→color maps carry real
semantic variance (an "open" order ≠ an "open" ticket), so it needs a **per-domain registry**,
not one global map. This is the only piece requiring design thought.

**Adoption:** rides Track 1. Every module touched swaps local `esc`/money/date/CSV for the
canonical call. A `lint-no-local-fmt.js` ratchet with a baseline (existing `*-baseline.json`
pattern) prevents backsliding; the count can only go down.

---

## 8. Track 6 — V1 retirement-and-absorb (Bridge-graph-driven)

**Goal:** remove the largest mass (17 V1 files, the biggest in the repo) safely.

**Re-driven by the cross-module dependency graph, not memory parity** (the key review finding,
twice-hardened). V1 modules couple to V2 surfaces **two ways**, and a Bridge-only scan misses the
second:
1. **`*Bridge` objects defined *inside* V1 modules** — `team.js:3045` `TeamBridge`,
   `newsletter.js:2256` `NewsletterBridge`, `procurement.js:1848` `ProcurementBridge`
   (note: `procurement.js:1751` is `VendorsBridge`), `consignment.js:2090` `GalleriesBridge`…
   **25 V2 modules** consume one; `newsletter-v2.js:191` even `loadModule('newsletter')` at
   runtime to get the Bridge + its in-memory `nlSubscribers` state.
2. **Plain `window.*` exports reached cross-module via `loadModule()`** — the coupling a Bridge
   scan is *blind to*. Verified examples: `orders.js` exports `generateInvoice` (`:5922`,
   consumed by `wholesale.js`), `viewOrder` (`:5836`, consumed by `customers.js` +
   `commissions-v2.js`), and dashboard-card renderers loaded by `index.html:59236`;
   `customers.js` exports `customersMerge` (`:3249`, consumed by `duplicates-v2.js`).

So cutting a V1 file = **deleting live logic a V2 surface depends on**, whether via Bridge *or*
plain global. Memory says "V2 parity shipped"; that is a *changelog*, not proof of severability —
and note **`OrdersBridge`/`ProductionBridge` don't even exist in this tree** despite memory citing
them, which is exactly why the graph (not memory) must drive this.

**Prerequisite artifact (widened after review): a global export/consumer inventory**, of which
the Bridge graph is a *subset*. Catalog every `window.X =` in each V1 module × every cross-module
`loadModule(<v1>)` + `window.X(` call site. A Bridge-only inventory is **insufficient** and would
mislabel orders/customers as safe.

**Correction to batching:** "no-Bridge → severable" is **retired**. `orders.js`/`customers.js` are
*not* the cheapest cuts — they look cheap only because their coupling (plain `window.*` exports) is
invisible to a Bridge scan. Re-derive Batch 1 from the *full* export/consumer inventory: a vertical
is "do-first" only when **every** consumer of its globals is already migrated or absorbed.

Per-vertical cutover: (1) **fresh parity audit** — a checklist like `jobs-v2-plan.md` §6a, *not*
memory; (2) absorb every single-sourced export (Bridge *and* `window.*`) into the V2 module / a
shared core; (3) cut the V1 manifest row + delete the module + bump cache; (4) smoke + write-path
tests green. **One vertical per PR;** two UIs must not coexist post-cut.

**Explicit risk:** the track most likely to cause regressions (it removes code paths). Each cut is
gated by Track 0 + the **full export/consumer inventory** + a fresh parity audit for exactly that
reason.

> **Free adjacent cleanup:** 27 of the 118 manifest entries are dangling `src:` paths to
> never-built v2 stubs (§1.2). Delete those rows as part of this track — zero blast radius.

---

## 9. Track 7 — XSS sanitizer (descoped to provenance surfaces)

**Hidden prerequisite (review finding): the canonical `sanitizeHtml` does not exist yet** —
only `sanitizeFilename` + a local `sanitizeString` (maker.js). **Build/confirm the canonical
sanitizer first**, then route sinks. The "888 → 0 routed" gap is real, but the target function
isn't there.

**Descoped:** 888 (admin) + ~618 (inline block) sinks is an alarming number; admin is
trusted-input. The honest job is **the handful of surfaces where tenant-authored content reaches
the raw-injecting storefront** (blog body, waiver text, product copy) — most of which memory says
were already hardened (#507/#514/#519/#522). So Track 7 ≈ one PR: build the sanitizer, route the
~5 provenance surfaces, add a `lint` ratchet for *new* unsanitized sinks. Not a campaign over 888.

---

## 10. Sequencing & first PRs

```
PR1  ████  Track 2 — per-file cache-bust (loader 1-liner + scripts hash step)  ← removes a gate-conflict source
PR2  ████  Track 0 — Playwright smoke (boot → each route, no console error) + money/date goldens
PR3  ████  Track 1 proof — extract ONE leaf surface (wallet modal) end-to-end
     ░░░░  Track 3 quick win — lazy-load xlsx/papaparse (anytime; independent)
     ░░░░████  Track 1 continues — per-module pass: extract + dedupe (5) + sanitize (7) + absorb (6)
```

**Recommended first 3 PRs** (review-endorsed for momentum, not just dependency):
1. **Per-file cache-bust** — kills today's merge-thrash, touches no feature code, clears a
   gate-conflict source *before* the extraction work that trips it most.
2. **Smoke E2E + money/date goldens** — the entire safety net needed to start extracting; one
   `&&` clause in `lint.yml`. A day or two, not a phase.
3. **Extract the wallet modal** (one leaf surface) — proves the `registerModule` recipe
   end-to-end on a low-stakes change; if it fights the inventory/cache gates, you learn that here,
   not on `core-db.js`.

**Milestone gates:**
- **M1 (foundation):** PR1–3 merged; smoke test in the required check; xlsx/papaparse lazy.
- **M2 (core extracted):** `index.html` < ~15K lines; core modules out; smoke green.
- **M3 (centralized):** money/date/CSV/badge cores adopted in all touched modules; ratchets on.
- **M4 (slimmed):** Batch-1 (no-Bridge) verticals retired; ≥ 1 Bridge-coupled vertical absorbed
  + cut; tarball + cache surface measured down.

---

## 11. What this plan deliberately does NOT do
- No framework migration (stays vanilla + CDN React where present). Out of scope.
- No big-bang rewrite. Every step is a shippable PR behind existing gates.
- No prod-deploy ceremony changes. Dev-first, fix-forward, per repo rules.
- No new top-level product surfaces.

## 12. Open questions — RESOLVED by the 3-reviewer pass
1. **Track 0 depth?** → Too broad as written. **Smoke test + money/date goldens only**; grow
   characterization tests inline as each piece is extracted. (pragmatist)
2. **Track 2 before Track 1?** → **Yes** — and the real reason is it de-risks Track 1 by removing
   a gate-conflict source. It's PR #1. (all three)
3. **`statusBadge` per-domain registry?** → **Correct call** — a global status map would force
   false unification ("open" order ≠ "open" ticket). Keep it simple: a flat
   `{domain: {status: {color,label}}}`. Population is design+inventory work, not mechanical. (technical)
4. **Track 6 parity — is memory sufficient?** → **No.** Memory is a changelog, not a test. Each
   vertical needs a fresh parity audit, and retirement order must follow the **Bridge graph**
   (no-Bridge first), not memory confidence. (architect + pragmatist)
5. **esbuild worth it?** → **No — CUT.** Query-string-per-entry cache-bust + lazy CDN suffice and
   preserve the source=served-bytes deploy invariant. (all three)

---

## 13. Review synthesis (3 independent reviewers, 2026-06-18)

Three reviewers (architecture/risk, pragmatism/ROI, technical fact-check) each verified claims
against the code at HEAD `43df11dd`. Headline verdicts: **sound, needs targeted revision** /
**analysis excellent, scope ~2× too big** / **mostly accurate, 4 corrections**.

**Numeric corrections folded in:** `confirm(` 8→**27/13 files**; silent `catch {}` 248→**~249
(modules) / ~403 (with index)**; `console.*` 438→**~423**; **html2canvas/plaid already lazy** (not
eager); **`sanitizeHtml` does not exist** in-tree; **27/118 manifest rows dangle** to non-existent
files; Track 7 real sink surface ~1,500 (888 modules + ~618 inline). Hero numbers (60,860 lines;
~49K inline; 6,285 CSS; 91 modules/111,330 lines; single `MAST_MODULES_V`; 7 cores-only tests;
888 `innerHTML`; V1/V2 line table) **all confirmed exact.**

**Structural changes folded in:** Track 2 → PR #1 (de-risks Track 1); Track 0 → two cheap
artifacts, not a gate; Track 4 (esbuild) → cut; Track 6 → Bridge-graph-driven with a Bridge
inventory + no-Bridge-first batching; Track 7 → build sanitizer first, descope to provenance
surfaces; Track 1 → add a global def/read manifest pre-step; Track 3 → descoped to lazy-loading
xlsx/papaparse.

**Verified technical green-lights:** `shared/mast-ui.js` is a pure IIFE with **no** engine
dependency (the engine depends on *it*) → promoting `money`/`date` to a shared formatter is clean;
`coerceDate(tsOrStr)` is the right Firestore-`Timestamp` defuser; the per-entry `?v=` loader
change is a genuine one-liner (`manifest.v || MAST_MODULES_V`); `deploy.yml:111` pins the verify
to committed `index.html` bytes, which the query-string approach respects.

**Dissent (resolved by operator):** the pragmatist would *cut* harder. Operator chose the **full
framing** — all 8 tracks kept, with 3/6/7 marked quick-wins/chores in §0 and Track 4 cut. A
verification pass confirmed the demotions are structural, not cosmetic, so full-framing is shippable.

### 13.1 Second pass — verification round (3 fresh reviewers, 2026-06-18)

The revised spec was re-reviewed against the code. Findings folded in:

- **Track 6 prerequisite widened (blocking fix).** A Bridge-only inventory is *insufficient*: V1
  modules also export plain `window.*` globals consumed cross-module via `loadModule()`
  (`orders.js`→`generateInvoice`/`viewOrder`, `customers.js`→`customersMerge`). So **"no-Bridge =
  severable" was retired** — orders/customers only *look* cheap because that coupling is invisible
  to a Bridge scan. Prerequisite is now a **full global export/consumer inventory**. Also:
  `OrdersBridge`/`ProductionBridge` don't exist in-tree despite memory citing them (proves the
  "trust the graph, not memory" thesis); Bridge line labels corrected (`procurement.js:1848` is
  `ProcurementBridge`; `:1751` is `VendorsBridge`); 25 (not 24) V2 consumers.
- **PR #1 (Track 2) re-scoped honestly** — loader change is a one-liner, but the PR also needs a
  hash-writer script, a git-hook change, a `lint-cache-bust.js` rewrite, and reconciliation of the
  un-manifested shared `<head>` tags. ~1–2 days, not a one-liner.
- **Track 0 split** — goldens are a true `&&` clause; the Playwright smoke spec needs its own CI
  step (browser install, flake budget). Prod error-sink descoped to a dev-side `console.error`
  wrapper; the cross-repo tenant-scoped POST sink spun out.
- **Track 1 def/read map bounded** to the surface-in-flight (mapping the whole block up front was
  re-importing the stall).
- **Numeric over-corrections fixed:** bare `confirm(` is **~21 calls / 9 files** (not 27/13 — my
  first correction was itself wrong); `console.*` is **~437** (not ~423; the original 438 was
  closer). Re-confirmed exact: 249/403 empty catches, 91-of-118 manifest rows (27 dangling), 888
  `innerHTML`, `sanitizeHtml` absent, `mast-ui.js` pure-IIFE dependency direction, loader line 22243.

Net: no remaining blocking issues. Track 6 is the one to respect — its prerequisite is now a full
export/consumer inventory, and that inventory is the real gate on every V1 deletion.

---

## 14. Proven extraction playbook (from PRs #665–#669, 2026-06-18)

Five shipped, dev-verified PRs turned Track 1/2/0 from plan into a repeatable procedure.
This section is the operational reference; the tracks above are the rationale.

### 14.1 What shipped
| PR | Track | Surface | index.html |
|----|-------|---------|-----------|
| #665 | 2 | per-file content-hash cache-bust (`gen-cache-bust.mjs`, loader `manifest.v \|\| MAST_MODULES_V`) | — |
| #666 | 0 | money/date characterization goldens (`test/format-goldens.test.js`) | — |
| #667 | 1 | Add-to-Mast detail drawer → `modules/add-to-mast-drawer.js` | −249 |
| #668 | 1 | Coin/token wallet modal → `modules/coin-wallet-modal.js` | −235 |
| #669 | 1 | Create-Role modal → `modules/create-role-modal.js` | −38 |

### 14.2 The two extraction recipes
Pick by how the surface is invoked:

**A. Direct lazy-load** — when the entry point is reached through a *delegated dispatch* you
control (e.g. a `[data-*]` click handler), not an inline `onclick`. Route the dispatch through
`MastAdmin.loadModule(id).then(() => window.openX(route))`. Used by the drawer (#667), whose
only opener was the `[data-amt-action="details"]` delegate.

**B. Eager shim** (the general case) — when the entry point is called from inline `onclick`
(static markup or module-generated HTML) or cross-module via `typeof X === 'function'` guards.
Leave a tiny *eager* function in the shell that lazy-loads then calls the impl:
```js
function openX(args) {
  MastAdmin.loadModule('xModal').then(function () {
    if (typeof window.openXImpl === 'function') window.openXImpl(args);
  }).catch(function () {});
}
window.openX = openX;
```
The module sets `window.openXImpl` + any `window.*` the modal's own onclick handlers reference.
Used by the coin modal (#668: callers in shows.js/shows-v2.js) and role modal (#669: static
"+ New Role" button). **This is the recipe most surfaces need** — clean zero-caller leaves are
scarce.

### 14.3 The pre-cut checklist (the def/read map)
Before moving any code, confirm:
1. **Cross-module callers** — `grep -rl '\bopenX\b' app/modules/*.js`. Any hit → recipe B.
2. **All callers** in index.html (`grep -nE '\bopenX\b'`) — static markup, generated onclick,
   or delegated dispatch? Determines recipe + which fns need `window.*`.
3. **Reads** — every global the surface references (`esc`, `MastDB`, `openModal`, domain
   helpers…) must be *eager* and defined before the surface can open. Lazy modules load on user
   action, long after boot, so eager globals are always available — no load-order hazard.
4. **Writes/defines** — the surface must not *define* shared state other code reads. Helpers it
   shares (e.g. `isDevTestTenant`, `buildVariantTable`) stay eager in the shell; the module
   calls them as globals.
5. **registerModule** — end the module IIFE with `MastAdmin.registerModule('xModal', {})` so
   repeat opens short-circuit instead of re-fetching.

### 14.4 The per-PR mechanical steps
1. New `app/modules/<surface>.js`: IIFE, functions moved **verbatim**, `window.*` exports,
   `registerModule`.
2. Replace the shell block with the recipe-A dispatch change or the recipe-B eager shim.
3. Add the `MODULE_MANIFEST` entry (`routes: []` — on-demand).
4. `node scripts/gen-cache-bust.mjs` (stamps the new module + index.html) and
   `node scripts/gen-inventory.mjs` (regen). **Both regen on every shell/module PR** — expect it.
5. Verify locally: all 14 `lint-*` + `gen-inventory --check` + the test chain; `lint-syntax`
   confirms the shell inline JS still parses; grep that no dangling refs to the moved fns remain
   (only the shim + external callers).
6. Post-deploy: curl `<tenant>.runmast.com/app/index.html` — surface gone from the shell, shim
   present, module serves 200 at its hashed URL, served hash == `shasum -a 256 <module> | cut -c1-12`.

### 14.5 Findings that change how you scope
- **Extraction surfaces hidden UX debt.** `lint-ux-standards` exempts the shell but lints
  `app/modules/*.js`. Moving *verbatim* code into a module subjects it to the ratchet for the
  first time. Baseline it as **relocated, not new** debt (hand-add the entry to
  `ux-standards-baseline.json`; don't `--update` — that also drops stale entries). #667 surfaced
  rogue-overlay+translateX+hex; #668 only hex; **#669 added zero.**
- **Surfaces built on shared primitives extract cleanest.** A modal using the shared
  `openModal()` + `var(--…)` tokens carries little/no debt (#669); one that hand-rolls its own
  overlay/animation (#667 drawer) carries the most. Argues for the `mastSlideOut`/token
  fast-follow.
- **Clean leaves are largely exhausted.** After the self-contained modals, remaining surfaces
  are coupled: invite-user → shared password/dev-test helpers; event modal → `sales.js`/
  `sales-events-v2.js`; stock modals → shared inventory machinery (`productsData`,
  `buildVariantTable`). Next gains come from **deliberate coupled-cluster extractions** (group a
  coherent set, e.g. all inventory stock modals, accept N eager shims + shared-global reads), not
  more lone leaves.
- **The manifest is parsed by other tools.** Adding `v:` between `src` and `routes` broke the
  adjacency regex in `gen-inventory.mjs` and `lint-rbac.js` (#665 follow-up). Any manifest shape
  change → grep every `src:.*routes:` consumer.
