# V2 Module-Conversion Playbook

**Status:** Canonical process, distilled from the Sales conversion (2026-06-10, PRs #360–#378),
amended after the Marketing conversion (2026-06-10, PRs #380–#384) and the Operations
conversion (2026-06-10, PRs #387–#396). Run this end-to-end for each remaining section
(Site, Retention, Shows, Bookings, Finance, Customer Service, Admin). Worked examples: `sales-v2-build-plan.md` /
`marketing-v2-build-plan.md` (plan shape) and `standard-record-ui.md` §10 (the four archetypes).

## 0 · Ground rules

- **Worktree off `origin/main`, always.** Never read OR write via the shared checkout — it sits
  on a stale feature branch and will mislead you (it hid the nav-v2 code and guided-header
  adoption during the Sales round). `git worktree add .claude/worktrees/<n> -b <branch> origin/main`.
- **Sequential PRs.** Every PR bumps `MAST_MODULES_V` on the same line; parallel branches conflict.
  Merge → then branch the next **from fresh `origin/main`, never from the previous wave's
  branch** — squash-merges orphan stacked branches (`mergeStateStatus: DIRTY`); the recovery
  is cherry-picking the wave onto fresh main, so just start there.
- **Merging is MANUAL.** Despite older notes, PRs do NOT auto-merge — `gh pr merge --squash`
  once checks are green. CI then deploys `main` to the dev pod. Your job ends at
  verified-on-dev. (`gh` throws transient 401s with a valid token — wait ~60s and retry
  before re-diagnosing auth.)
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

**Verify the recon's surface characterizations before scheduling builds.** The Operations
recon called the `business` view "a thin inline form"; the live surface was a modern
10-section entity-profile hub — rebuilding it would have been churn. A surface that is
already modern joins the non-goals; record the amendment in the plan doc (plans are
amendable, silently re-planning is not).

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

- **Self-confirm MCP tokens FIRST** (raw JSON-RPC `initialize` curl against the server, not
  just "the server is configured") — they go stale. If invalid: the sanctioned fallback is
  the operator's authenticated Chrome session + in-page `MastDB` (Claude in Chrome);
  re-minting is operator-only (`mast-mcp-server/scripts/seed-admin.mjs --force`, agents are
  firewalled from it by the permission layer).
- **Seed through the accessor, then READ IT BACK through the accessor.** Path order is
  load-bearing and wrong-order writes succeed silently into phantom docs (e.g. social posts
  are `market/posts/{uid}/{postId}`, NOT `market/{uid}/posts/…` — check
  `scripts/rewrite-entities.js` for the real path).
- **Timestamps as ISO strings.** `MastDB.set` silently serializes JS `Date` objects to `{}`.
- **Match enum vocab to the legacy UI**, not to what sounds plausible (e.g. social
  `signalScore` is only 1=👍 / 2=🔥; an out-of-vocab value renders as nothing).

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
- When V2 needs a write that legacy does inline against DOM/list state, refactor legacy into a
  **state-free core** both paths share, exposed on the module's bridge (Marketing: the UGC
  approve flow `_approveUgcCore`, the composer publish fan-out `_publishRecord`) — never
  re-implement the write in the twin, and never call legacy handlers that read the DOM.
- Cross-record links use `MastEntity.drill`; give `fetch()` a MastDB cache-miss fallback so cold
  drills work.
- Computed reverse-links ("Part of: <campaign>" on artifact SOs) get ONE renderer on the owning
  module's bridge (`CampaignsBridge.renderChipInto` pattern) — placeholder div + async fill,
  not a copy per artifact module.
- Font sizes: only the 7-scale rem values pass lint — `0.72 / 0.78 / 0.85 / 0.9 / 1 / 1.15 / 1.6`.
- Ship with `bash scripts/ship-check.sh` (bump → inventory → all lints full-output → all tests).

## 5 · Verify every deployed wave (browser, sgtest15)

- **Check Deploy-workflow health at session start** (`gh run list --branch main --limit 3`)
  — a repo-wide CI failure (Operations round: stale `MAST_PLATFORM_API_KEY` secret) silently
  masks every later "is my wave live?" check, and you end up batch-verifying waves instead
  of verifying each one. Don't let an infra failure collapse the per-wave verify cadence.
- After reload, confirm `window.MAST_MODULES_V` matches the deployed bundle BEFORE judging
  anything (same-URL navigation is hash-only and does NOT reload).
- **Read the console every time** (`read_console_messages`, error pattern). A button that does
  nothing is a bug until proven otherwise — the Sales queue buttons "not clicking" were a real
  module-load race throwing on every click.
- Check light AND dark mode — the toggle is **"Dark mode" in the avatar menu** (top
  right). Ignore the index.html boot comment "Admin app is ALWAYS dark mode": that is
  only the pre-paint default, and it talked the Finance round out of the light check
  until the operator corrected it. Screenshot proof of both.

## 6 · Holistic pass (final PR of the section)

- **Run the operator walk BEFORE opening the holistic PR**, not after — the Operations round
  shipped holistic first and the walk then produced three more fix PRs (#394–#396). Walk
  findings belong in (or before) the holistic PR.
- **Operator walk:** click every nav item, open every record, **exercise every CRUD verb on
  every entity — including CREATE on a fresh record** (contacts-v2 create had been dead since
  its own conversion; two earlier walks missed it by only testing read/edit), follow every
  link **including cold cross-drills from another module's SO**. This catches what static
  review can't.
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
| Stacked wave branches go DIRTY after squash-merge | Branch every wave from fresh `origin/main`; recovery = cherry-pick |
| "Auto-merge on green" | It's manual: `gh pr merge --squash`; transient `gh` 401s self-heal in ~60s |
| `MastDB.set` + `new Date()` → `{}` | Seed timestamps as ISO strings; read seeds back through the accessor |
| Accessor path order (`market/posts/{uid}` not `market/{uid}/posts`) | Wrong order writes phantom docs that report success — check `rewrite-entities.js` |
| Stale MCP bearer tokens | Self-confirm with an `initialize` curl; fallback = operator's Chrome + in-page MastDB; re-mint is operator-only |
| Sign-in screen right after `location.reload()` | Auth-state restore lags — wait and re-check before reacting |
| Stale bundle on dev after merge | Check `gh run list --branch main` FIRST — the Deploy workflow can be broken repo-wide (stale `MAST_PLATFORM_API_KEY` secret → MCP 401). Fallback: invoke `mast_hosting` deploy at the merged SHA via the platform MCP (the same call CI makes); rotating the CI secret is operator-only |
| `gh` "not logged into any hosts" (hosts.yml wiped to `{}`) | NOT the transient 401 — source the token from git's keychain helper: `GH_TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' \| git credential fill \| awk -F= '/^password=/{print $2}')` |
| Two `type:'status'` fields on one entity | `MastEntity.define` throws → the whole module dies and the tab renders BLANK. One badge per entity; the other becomes a text label |
| `type:'number'` list field whose `get()` returns a formatted string | `displayCell` runs `Num.count()` → EMPTY cell. Formatted display strings are `type:'text'` + `align:'right'`; `number` is for raw numerics only |
| Method literally named `confirm(` | Trips the nativeDialogs UX lint — name action handlers `confirmMatch` etc. |
| `required:true` + custom `editRender` | Engine `onSave` collects only `input[name]` before `validate()` — id-only inputs leave the record empty and CREATE always fails its required check (contacts-v2 create was dead since its conversion). Give required inputs a `name=` attribute |
| Cold `MastEntity.drill` into a queue module | A bare-doc `fetch()` fallback renders the SO without sibling state (maps/products) — wrong bucket, empty pickers. `fetch()` must gate on a run-once `ensureLoaded()` when the SO render reads module collections |

## 8 · Helper scripts

- `scripts/scaffold-v2-module.mjs <route> <archetype>` — skeleton + index.html wiring.
- `scripts/ship-check.sh` — the whole pre-PR gauntlet in the right order.
- `scripts/lint-v2-standard.js` — born-0 ratchet for the V2 surface standard (in CI).

## 9 · Candidate hardening (build tickets, not process)

- [ ] CI smoke-load for `*-v2.js`: stub `window`/`MastAdmin`/`MastEntity`/`MastUI`, load each
      module file, assert no exception — would have caught the audit-v2 double-status-field
      define() throw (blank tab in prod) before merge.
