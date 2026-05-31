# UI Redesign — Control Plane (backlog + live state)

The orchestrator for the engine-first, strangler redesign. Plan: `~/.claude/plans/mossy-humming-snowglobe.md`. Standard (canonical spec, read-only): `docs/ux-audit/00–15`.

- **Branch model:** foundation on `feat/ui-redesign-foundation` (worktree `/tmp/mast-tt-ui-redesign`, off `main`); each module conversion on its own `feat/redesign-<module>` branch + PR. Never push `main`.
- **Flag:** `uiRedesign` (`config/featureFlags/uiRedesign` + `localStorage.mastUiRedesign='1'`). `MODULE_MANIFEST` routes to `<module>-v2.js` when on, else the legacy module. Old + new coexist; per-module rollback = flip flag.
- **Audit docs PR:** stewartdavidp-ship-it/mast-tenant-template#75 (docs only).

## Agent contract (standard input → output)
- **Input:** scope (engine | module); current file path; governing standard docs; engine API; target schema template; acceptance checklist; flag name.
- **Output:** feature branch + PR; self-verification report (lints, tests, both-mode screenshots, rubric re-grade, deep-link/dirty/round-trip); one-line `COORDINATION.md` handoff.
- **Isolation:** own worktree; module agents add `app/modules/<module>-v2.js` + one `MODULE_MANIFEST` entry; they do NOT edit shell internals.

## Verification gate (every PR)
```
node scripts/lint-design-tokens.js && node scripts/lint-rbac.js && node scripts/lint-mastdb.js
node test/*.test.js
node scripts/capture-modes.js   # both-mode screenshots, attach to PR
```
Plus: rubric re-grade ≥ B; deep-link `?id=`; dirty-guard on close/backdrop/Esc/Back/nav; export↔import round-trip; signal-grep (doc 01) → 0 new `window.confirm`/`position:fixed`/`translateX`/hardcoded hex in the converted module. Deploy dev pod → smoke a dev tenant before prod cutover (operator).

## Foundation (Phase 0 — engines, `shared/*.js`)
| Item | File | Builds on | Status |
|---|---|---|---|
| 0a Tokens & light-mode fix | index.html | — | ✅ done (`feat/admin-light-dark-foundation`; supersession later) |
| 0b mastSlideOut v2 + tabs/list/form/filter/badge/number-fmt | `shared/mast-ui.js` | `mastSlideOut`(L16905), `MastDirty`(L11554), `MastOverlayNav`(L16477), `mastSortRows`(L17012), `mastConfirm`(L16725) | ⬜ next |
| 0b Image/file/OS controls | `shared/mast-media.js` | `camera.js`, PapaParse/SheetJS | ⬜ |
| 0b Exporter + import wizard | `shared/mast-io.js` | PapaParse/SheetJS | ⬜ |
| 0c Entity Engine | `shared/mast-entity.js` | 0b | ⬜ keystone |
| 0d Report Engine | `shared/mast-report.js` | 0b | ⬜ fast-follow |

## Proof (Phase 1 — HARD GATE)
| Module | Target | Status |
|---|---|---|
| orders → `orders-v2.js` | mastEntity schema (lg/expand) | ⬜ |
| customers → `customers-v2.js` | mastEntity schema (md, read→edit) | ⬜ |
**→ Human gate: review proof, finalize engine API + look, before fan-out.**

## Fan-out backlog (Phase 2 — after gate; seeded from doc 09)
Status legend: ⬜ queued · 🟡 doing · 🔁 review · ✅ merged.

| Wave | Modules | Surface notes | Status |
|---|---|---|---|
| early | wholesale | custom translateX drawer → shared slide-out (fast win) | ⬜ |
| 1 (S) | campaigns, promotions, studio, contacts, cart, brand, students, homepage, commission-terms, advisor, audit-feedback, engagement-inbox | mechanical CRUD schemas | ⬜ |
| 2 (M) | procurement, channels, production, social, sales, fulfillment, consignment, website, team, trips, accounting, audit | + de-nest detail tabs, card→table, retire in-row edit | ⬜ |
| 3 (L) | maker, shows, events, customer-service, book | overlay-heavy; most rogue `position:fixed` to migrate | ⬜ |

## Reports / wizards / exceptions (Phase 3)
| Group | Modules | Engine | Status |
|---|---|---|---|
| Reports | finance, financials, advisor(dash), sales/AR/AP aging | mastReport | ⬜ |
| Wizards | mapping setup, import flows, onboarding, day-close | mastWizard | ⬜ |
| Builders (stay bespoke) | blog, newsletter, lookbooks, composer | adopt shared components only | ⬜ |

## Cutover (Phase 4)
Per module: flag default on → monitor → remove legacy module + flag. Then platform polish sweep (doc 06) + drive doc-01 grep counts to 0.

## Live log
- 2026-05-30 — Control plane initialized. Light/dark foundation committed. Audit docs → PR #75. Worktree `feat/ui-redesign-foundation` created off main. Primitives located. **Next: author `shared/mast-ui.js` (0b).**
