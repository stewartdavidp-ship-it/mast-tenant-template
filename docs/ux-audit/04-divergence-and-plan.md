# Divergence Analysis & Migration Plan

Reads off [`03-scorecards.md`](03-scorecards.md) against the standard in [`02-standard.md`](02-standard.md). The goal: move from **avg 42/100** toward a tight band in the 70s+ by unifying *patterns*, with the least churn.

## Where the inconsistency actually lives

Ranked by how many modules diverge × user-visibility:

| Rank | Dimension | Severity | Spread |
|---|---|---|---|
| 1 | **A3 — hand-rolled overlays** (rogue `position:fixed` / custom slide-outs instead of `openModal`/`mastSlideOut`) | High | shows, maker, finance, events, trips, wholesale, accounting, advisor, audit, blog, engagement-inbox, fulfillment, sales, audit-feedback |
| 2 | **A1 — broken/absent back-to-origin** (no `MastNavStack`; dead-ends; hardcoded returns) | High | accounting, brand, advisor, mapping, trips, studio, team, financials, marketing-calendar, events, homepage |
| 3 | **B2 — no interactive sort** | High | ~30 of 41; only orders/customers/book/email-log/finance(partial)/sales(partial)/fulfillment(partial) sort |
| 4 | **B1 — no `.data-table`** (bespoke grids) | Medium-High | majority; ~12 modules use it, often partially |
| 5 | **C1 — `window.confirm/alert/prompt`** | High (jarring) | ~15 modules (see 02 §3) |
| 6 | **D1 — hardcoded hex / per-module color maps** | Medium (debt + dark-mode) | finance 320, shows 158, orders 108, wholesale 68, advisor 64, channels 59, accounting 54, team 53, maker 52 |
| 7 | **C4/C5 — missing empty/loading states** | Medium | empty-state nearly unused platform-wide |
| 8 | **A2 — create/edit paradigm chaos** (modal vs inline-page vs slide-out) | Medium | team/studio/students/brand inline; others modal; no rule |
| 9 | **D4 — terminology drift** | Low-Medium | finance, maker, team worst |
| 10 | **C3 — non-standard form fields** | Medium | many modules inline-style inputs |

**Takeaway:** the top two are *navigation/overlay* problems — exactly the rubric's heaviest weights — and they're also the most user-felt (dead-ends, inconsistent back behavior, overlays that don't behave like the rest of the app). Fix those first.

---

## Migration plan (phased, by leverage)

### Phase 0 — Lock the standard & guardrails (no module rewrites)
- Ratify [`02-standard.md`](02-standard.md) as the canonical UX standard; link it from `CLAUDE.md`/`ARCHITECTURE.md`.
- Add **lint/CI guardrails** so the floor stops dropping:
  - grep-fail the build on new `window.confirm(`/`alert(`/`prompt(` in `app/modules/`.
  - grep-fail on new `position:fixed` overlay literals outside the shared helpers.
  - warn on new `#rrggbb` literals in module JS (nudge toward tokens).
- Publish the **reference set** (orders, customers, book, procurement, email-log) as the copy-from examples.
- *Effort: low. Impact: stops regression immediately.*

### Phase 1 — Quick, high-visibility wins (mechanical, low-risk)
0. **Fix light mode at the shell level (BLOCKER).** Sidebar nav labels and active filter/period pills are invisible in light mode (mode-coupled foreground colors that don't switch with the background token). Make the shell legible in both themes, then keep it green with a both-mode visual check. This gates the whole light theme and must land before per-module color work. *(See 02 §4b.)*
1. **Kill `window.confirm/alert/prompt`** → `mastConfirm/Alert/Prompt` across the ~15 modules. Pure find-replace + arg shape. Removes the most jarring inconsistency.
2. **Fix the `mapping` blocking interstitial** — make Skip/X reliably dismiss; don't block app load. (Highest-severity single defect.)
3. **De-dead-end navigation** — add a working Back/return (`MastNavStack`) to accounting, brand, advisor, studio, trips, mapping detail views.
4. **Status badges** → swap inline-colored spans for `.status-badge` + shared color constants (fixes the Finance "two badge styles" class of issue).
- *Effort: low–medium. Impact: high, immediately visible.*

### Phase 2 — Overlay & list unification (the heavy hitters)
1. **Migrate every hand-rolled overlay** to `openModal`/`mastSlideOut` (Rank-1 list). Biggest A3 lift; also fixes Back-button behavior via `MastOverlayNav`.
2. **Adopt `.data-table` + `mastSortableTh`/`mastSortRows`** on all tabular lists (Rank-3/4). Start with the highest-traffic: orders-adjacent, finance, team, contacts, customer-service, wholesale, events.
3. **Standardize filtering** on `mastRenderFilterPills` + URL state; retire reinvented pills (channels) and raw selects.
- *Effort: medium–high. Impact: high; this is where the score band tightens.*

### Phase 3 — Color tokens & forms
1. **Tokenize color**: replace per-module hex maps with shared status-color constants + `var(--…)`. Sequence by debt: finance → shows → wholesale → channels → accounting → team → maker. Verify dark mode each.
2. **Forms** → `.form-group/.form-label/.form-input` everywhere; retire `ev-`/`sl-` variants and inline-styled inputs.
3. **Empty/loading** → `.empty-state` and `.loading` wherever missing (incl. async gen in lookbooks/finance).
- *Effort: medium. Impact: maintainability + dark-mode safety + polish.*

### Phase 4 — Paradigm & terminology convergence
1. **Create/edit paradigm**: apply the §1 decision tree — move inline-page-replace create forms (team/studio/students/brand) to modal-or-Paradigm-A as appropriate.
2. **Terminology pass**: enforce the §4 lexicon (finance/maker/team first).
3. **Routing convention**: decide single-route vs namespaced-family and apply consistently; keep the graceful 404.
4. **Lowest scorers as candidates for rebuild-on-standard rather than patch**: marketing-calendar (18), advisor (22), mapping (23), maker (24), financials (25 — consider merging into finance), team (26), brand (26).
- *Effort: higher / per-module judgment. Impact: closes the long tail.*

---

## Suggested sequencing by module (effort × impact)

- **Protect & document (don't touch the UX):** orders, customers, book, procurement, email-log.
- **Cheap upgrades to B/A-grade:** campaigns, composer, homepage, production, students, commission-terms, social (mostly add sort/`.data-table`/`mastConfirm`).
- **Worth a focused refactor (high traffic, mid score):** finance, team, wholesale, shows, contacts, customer-service, events, sales.
- **Consider rebuild-on-standard (low score, bespoke):** marketing-calendar, advisor, mapping, maker, financials, brand.

## How to measure progress
Re-run the two grep passes in `01-signal-matrix.md` after each phase. Targets:
- **Light mode usable** — flip theme on reference modules + shell; sidebar/pills legible, nothing disappears (after Phase 1, step 0). Add a both-mode visual check to the pre-merge checklist.
- `window.confirm` count → **0** (after Phase 1).
- rogue `position:fixed` overlays → **0** outside shared helpers (after Phase 2).
- `.data-table` + sort adopted by all tabular modules (after Phase 2).
- hardcoded hex in top-debt modules → trending to single digits (after Phase 3).
- platform average score → **70+** with no module below C.

The signal matrix doubles as the regression dashboard; the scorecards re-grade against the same rubric so movement is comparable over time.
