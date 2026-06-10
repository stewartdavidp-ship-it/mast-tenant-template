# V2 Module-Conversion Playbook

**Status:** Canonical process, distilled from the Sales conversion (2026-06-10, PRs #360–#378).
Run this end-to-end for each remaining section (Marketing, Site, Retention, Shows, Bookings,
Finance, Operations, Customer Service, Admin). The Sales artifacts are the worked example:
`sales-v2-build-plan.md` (plan shape) and `standard-record-ui.md` §10 (the four archetypes).

## 0 · Ground rules

- **Worktree off `origin/main`, always.** Never read OR write via the shared checkout — it sits
  on a stale feature branch and will mislead you (it hid the nav-v2 code and guided-header
  adoption during the Sales round). `git worktree add .claude/worktrees/<n> -b <branch> origin/main`.
- **Sequential PRs.** Every PR bumps `MAST_MODULES_V` on the same line; parallel branches conflict.
  Merge → then branch the next.
- **PRs auto-merge on green; CI deploys `main` to the dev pod.** Your job ends at verified-on-dev.
- **Engine-first (operator directive).** Any standard pattern goes into `shared/mast-ui.js` /
  `shared/mast-entity.js` WITH a unit test, immediately — never a per-module copy. Existing
  primitives: `pageHeader` (every page header, no exceptions), `repeatRows`, `validate.email/.phone`,
  `tiles`, `relatedTable`, `badge`, `slideOut`; `MastEntity.define/renderList/openRecord/drill`;
  guided process header is the default for any `detail.flow`.
- **Demo-data rules (sgtest15 / Shir Glassworks).** Realistic names/content only — no
  test/demo/harness strings anywhere customer-visible, including `source`-type fields. Seed via
  paths that stamp production-shaped values (the platform MCP's `create_test` stamps
  `source:'test'` — use the tenant router's create tools with explicit source instead). Hard
  deletes are fine on sgtest15 (standing authorization; self-confirm MCP tokens) but report them.

## 1 · Recon (Explore agent, very thorough)

Map: sidebar items ↔ `MODE_ROUTE_VISIBILITY` ↔ `app/data/mode-module-info.js` (find orphans —
Sales had `commission-terms` in the sidebar but not the registry); each sub-item's V1 file, size,
data sources (MastDB accessors + Firestore paths), CF dependencies; which V2 twins already exist
(`MODULE_MANIFEST`) and whether they meet the standard.

## 2 · Plan doc PR

`docs/ux-audit/<section>-v2-build-plan.md` mirroring the sales plan: scorecard table (route /
label / V1 / V2 / status), archetype per sub-item (record / transaction / queue / composer — a
screen that fits none is a design discussion, not a build ticket), waves sequenced by
**end-to-end demo value**, temp-link debt register. Watch for sub-items that are actually ONE
process split across screens (Pack+Ship were one queue) and for module pairs that need
consolidation around a hub object (galleries ↔ placements).

## 3 · Demo data

Audit and scrub BEFORE building (verification against junk data hides real issues and demos
read false). Seed realistic content for every surface you'll build.

## 4 · Build waves (one PR per wave)

Scaffold new modules with `node scripts/scaffold-v2-module.mjs <route> <archetype>` — it emits
the skeleton and wires `MODULE_MANIFEST` + tab div + `MAST_V2_ROUTE_MAP`. Then:

- Registry entry in `mode-module-info.js` (outcome ≤120ch, tagline ≤90ch, must exist in
  `MODE_ROUTE_VISIBILITY` or lint fails).
- RBAC: `can('<route>','edit'|'delete')` on every write — lint-rbac blocks new ungated modules.
- Workflows: load `workflowEngine` THEN the spec module, sequentially — `Promise.all` races and
  the spec silently no-ops ("Unknown workflow").
- `onSave` on an entity surfaces an Edit button on every read slide-out. For create-only intake
  on read-only records, define a separate create-only entity (`commission-intake-v2` pattern).
- Cross-record links use `MastEntity.drill`; give `fetch()` a MastDB cache-miss fallback so cold
  drills work.
- Ship with `bash scripts/ship-check.sh` (bump → inventory → all lints full-output → all tests).

## 5 · Verify every deployed wave (browser, sgtest15)

- After reload, confirm `window.MAST_MODULES_V` matches the deployed bundle BEFORE judging
  anything (same-URL navigation is hash-only and does NOT reload).
- **Read the console every time** (`read_console_messages`, error pattern). A button that does
  nothing is a bug until proven otherwise — the Sales queue buttons "not clicking" were a real
  module-load race throwing on every click.
- Check light AND dark mode. Screenshot proof.

## 6 · Holistic pass (final PR of the section)

- **Operator walk:** click every nav item, open every record, try create/edit/delete, follow
  every link. This catches what static review can't.
- Reorder the section's sidebar items around the operator's process (Sales: sell → orders →
  fulfill → returns → B2B → close → configure).
- CRUD parity table; add delete where appropriate (confirm + `writeAudit` + RBAC; respect
  immutability — published/accepted records never delete; cascade storage artifacts or you leak).
- `node scripts/lint-v2-standard.js` enforces the look-and-feel floor (pageHeader, flag gate,
  manifest wiring) — keep it green, it runs in CI.

## 7 · Gotcha registry (each cost a debugging cycle)

| Gotcha | Rule |
|---|---|
| Shared checkout is stale | Only read from an origin/main worktree |
| `gen-inventory` vs pre-commit re-bump | bump → regen → commit (ship-check.sh does the order) |
| Truncated lint output | Never `tail` lint output; read it all |
| Same-URL "navigation" | It's a hash change; `location.reload()` + re-check `MAST_MODULES_V` |
| `Promise.all` module loads | Engine before spec, sequentially |
| `onSave` ⇒ Edit button | Separate create-only intake entity |
| `create_test` stamps `source:'test'` | Router create tools with explicit source |
| Weak FK + name-match fallbacks | Stamp real FKs at create; audited one-click backfill for legacy rows |
| statusHistory shape varies (array vs object) | Engine mirrors only arrays; don't assume |

## 8 · Helper scripts

- `scripts/scaffold-v2-module.mjs <route> <archetype>` — skeleton + index.html wiring.
- `scripts/ship-check.sh` — the whole pre-PR gauntlet in the right order.
- `scripts/lint-v2-standard.js` — born-0 ratchet for the V2 surface standard (in CI).
