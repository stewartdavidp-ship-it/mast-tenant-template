# V1 Removal & Rollout Plumbing — Plan

**Status:** PLANNED (2026-06-10, operator-ratified framing). Executes after V2 is
ratified (expected week of 2026-06-10). Companion to `v2-conversion-playbook.md` and
the per-section build plans.

**Framing (the order matters):** this is NOT "delete V1." It is **"extract the
rollout mechanism, then delete V1"** — the teardown doubles as the hardening pass
that leaves permanent plumbing for a future **V3 rollout to real customers**, with
the legacy-style toggle as the rollout lever. Today's toggle was built as a one-off
for an internal comparison; tomorrow's must be a staged-rollout mechanism.

Context: the template is pre-launch — V1 removal "formally impacts no one"
(operator, 2026-06-10). That makes this the cheapest possible moment to do the
extraction properly.

## Phase 1 — Extract the rollout mechanism (before any deletion)

1. **One gate resolver.** Replace the ~30 copy-pasted per-module `flagOn()` IIFEs
   with a single shared `MastFlags.uiGeneration()` (shared/, unit-tested,
   engine-first rule). Modules ask "which generation am I?" in one place. V3 gating
   becomes one function change, not a find-and-replace across modules.
2. **Server-side generation flag.** Move the source of truth from `localStorage`
   (`mastLegacyUI` / `mastUiRedesign` — per-DEVICE, invisible centrally, no remote
   rollback) to a server-side setting:
   - per-tenant default + per-user override (likely `admin/businessEntity` `ui`
     section or `admin/config/uiGeneration` — register any new singleton in
     `SINGLETON_COLLECTIONS`);
   - cohort/percentage rollout support + an instant kill switch;
   - `?ui=` URL param survives as a dev/device override only.
3. **Versioned route map.** Generalize `MAST_V2_ROUTE_MAP` from a hardcoded
   "-v2 remap" to a generation-keyed table: stable public route ids (deep links,
   MCP admin links, pins, dashboard tiles) remap to the active generation's
   implementation route. V3 = add a `v3` column, not a new mechanism.
4. **Cross-generation escape hatch.** Generalize `navigateToClassic(route, params)`
   to "navigate to route in generation N" — required mid-rollout when V3 covers
   80% of surfaces and links into the rest.
5. **Generation-tagged telemetry.** Nav usage is already recorded per route; add
   the generation tag so a staged rollout's health is measurable, not guessed.
6. **Customer-grade SW update story.** The current verify dance (unregister SWs +
   clear CacheStorage + tolerate one mixed-cache boot) is operator-grade only.
   Before any customer-facing cohort flip: deploy-driven SW refresh
   (skipWaiting + "refresh for the new version" prompt). Without this, cohort
   flips look broken for cached users.
7. **Bridge invariant (codify, don't build).** The write-delegate bridges
   (MakerProductBridge, FinanceBridge, ChannelsBridge, StudioBridge, …) are the
   generation-agnostic API layer — the reason V2 conversions were fast and the
   reason V3 will be a re-skin, not a rewrite. Make "every surface's writes live in
   a state-free bridge" an explicit architectural invariant in
   CODING-STANDARDS/the playbook, surviving V1's deletion.

## Phase 1.5 — Classic-dependency burn-down (HARD GATE for Phase 2)

Operator directive (2026-06-10): V1 retirement was always the plan; the conversion
rounds' "single-source heavy sub-surfaces on legacy with a link" pattern was never
sanctioned. Every classic link is a missing V2 feature. The full audited inventory
(43 call sites / 39 modules, classified S/M/L) lives in
**`classic-dependency-burndown.md`** — Phase 2 MUST NOT start until
`grep -c "navigateToClassic(" app/modules/*.js` returns 0 and legacy-function reuse
(e.g. the amendment submit modal) is rehomed.

## Phase 2 — Delete V1 (content, not plumbing)

- Legacy render code in the per-section modules (keep each module's bridge cores).
  By Phase-2 time the burn-down (Phase 1.5) has rebuilt every formerly-linked classic
  surface, so nothing in V1 render code is load-bearing.
  **Keep-list (operator-ratified carve-outs, 2026-06-11):** `advisor.js` (parked —
  current implementation, soft-hidden, awaiting Entity Phase 2); `mapping.js`'s
  guided-matching interstitial + MappingBridge (generation-agnostic boot overlay);
  the team sub-surface panels in `team.js` (`TeamPanels` — re-hosted INTO team-v2,
  now shared UI like AuditFeedbackUI, not dead render code); the trips flow modals
  in `trips.js` (body-level, hosted by trips-v2); the customers wallet-adjust modal
  (`customersOpenWalletAdjust`) + `duplicates-v2`'s `customersMerge` dependency.
- Dual sidebar item sets (e.g. finance `.fin-merged-v1` / `.fin-merged-v2` →
  collapse to the merged set), dual tab divs, `data-route-alt` stays (generic).
- `mastLegacyUI` flag + "Legacy UI" avatar-menu entry → superseded by the
  generation flag; the avatar toggle UX itself STAYS (it becomes "Try the new
  design / Switch back" in a V3 rollout — also the cheapest feedback channel).
- The byte-identical ceremony (#328 rule) — comparison scaffolding, retire it.
- `MODE_ROUTE_VISIBILITY` dual-audience handling stays untouched (orthogonal:
  mode curation ≠ UI generation).

## Phase 3 — Verify

- Operator walk of every section post-removal (the conversion playbook's §6 walk,
  once, against the single remaining generation).
- Grep-zero checks: `mastLegacyUI`, `navigateToClassic(` (old signature),
  per-module `flagOn(` copies.
- `lint-v2-standard` ratchet updated: the flag-gate rule inverts (modules must NOT
  carry their own gate once the shared resolver lands).

## Non-goals

- Building V3 or speculating on its design — this plan only guarantees V3 can roll
  out with mechanism that already exists.
- Prod rollout procedure (release model owns that; the dirty-bit/release pipeline
  is unchanged).

## Why now

Doing the extraction during the teardown costs days; retrofitting a rollout
mechanism after customers exist costs an incident. The toggle pattern proved itself
across Sales/Marketing/Operations/Finance — keep the pattern, lose the prototype.
