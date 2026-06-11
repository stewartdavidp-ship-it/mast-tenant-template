# V2 Module-Conversion Playbook

**Status:** Canonical process, distilled from the Sales conversion (2026-06-10, PRs #360–#378),
amended after the Marketing conversion (2026-06-10, PRs #380–#384), the Operations
conversion (2026-06-10, PRs #387–#396), the Finance conversion (2026-06-10,
PRs #399–#405 — the first CONSOLIDATION round: 12 routes → 3 hub modules + 3 twins), the Customer Service conversion (2026-06-10, PRs #413–#422), the Classes conversion (2026-06-10, PRs #426–#433 — six pre-existing twins audited-in-place rather than rebuilt), and the Admin conversion (2026-06-10, PRs #437–#446 — RBAC hub + read-only twins + two hub consolidations under a read-mostly Settings directive). Run this end-to-end for each remaining section
(Site, Retention, Shows). Worked examples: `sales-v2-build-plan.md` /
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

## 0b · Finance-round retro (2026-06-10, PRs #399–#411) — process lessons

**What worked (keep doing):** consolidation-first recon (12 routes → 3 hubs via the
Pack+Ship mechanism — plan for hub objects, not 1:1 twins); the bridge-extraction
rhythm (FinanceBridge made every wave a re-skin and gave the walk real CRUD);
verifying recon characterizations before scheduling (caught financials.js as dead
code — would have been a wasted conversion); scrubbing/seeding BEFORE building (the
walk then performed REAL CF writes — closing April live is what exposed the broken
approveAmendment CF); spawn_task for cross-repo fixes (the CF fix ran as a parallel
session; THIS session live-verified it through the operator's browser).

**What cost cycles (the §1/§5 amendments below):**
1. Built and walked an entire hub (close) that NO tenant could see — the recon's
   orphan check verified registry/visibility tables existed but never asked "is this
   route actually visible in a live sidebar?" (fixed by #410; rule added to §1).
2. Per-wave verify burned ~4 cycles on stale bundles before the SW recipe settled;
   the missing first step was confirming what the WORKER serves before touching the
   browser (rule added to §5).
3. A walk false-alarm: driving the walk via JS, a `Save`-button query matched a
   hidden legacy button and the vendor CREATE looked dead — a contacts-v2-shaped
   scare that was actually automation error (rule added to §5).
4. The light-mode check was skipped for most of the round on the strength of a
   misleading code comment — already amended in §5; the meta-lesson: UI affordances
   (the avatar menu) outrank code comments as evidence.
5. The detail.render signature bug shipped to dev before being caught — the §9
   smoke-load ticket has now been earned twice (audit-v2 define-throw, finance bill
   SO); it should be the next engine-hardening investment.


## 0c · Customer-Service-round retro (2026-06-10, PRs #413–#422) — process lessons

**What worked (keep doing):** verifying recon characterizations caught a false
"no pageHeader anywhere" claim (3 of 4 twins already had it) and surfaced that
V1 already served Inbox+Tickets from ONE renderer — the consolidation argued
itself from the code; scrub-then-build again paid off (the broken ticket-number
counter and the status-vocab divergence surfaced during seeding, not during a
demo); per-wave live verify caught every one of this round's four bugs the
same hour they shipped.

**What cost cycles (new gotchas below):**
1. Skipped the scaffold for the Wave-1 hub and hand-wired index.html — and
   missed that the scaffold also emits the STATIC tab div. `applyRoute` shows
   `config.tab` BEFORE `setup()` runs, so first in-session navigation threw
   and bounced to dashboard (#415). Use the scaffold, or copy ALL of its
   output, not the parts you remember.
2. `defineEntities()` must run at module LOAD, not first setup — once for
   cross-module drills (cs-support), once because it was simply never invoked
   (cs-surveys #419; rows/SO/create silently dead). The §9 smoke-load ticket
   would have caught both — third time it's been earned.
3. Bridge methods over a load-once bounded cache silently no-op for records
   created after load ("Review not found") — only the walk's create-then-act
   sequence exposed it (#421). Any per-record bridge action should fresh-read
   the doc into the cache on miss.
4. An applyRoute throw during boot can trip the "We couldn't load the admin"
   screen, which WIPES the DOM — every later console error is app-wide noise
   from unrelated modules. Screenshot/reload before diagnosing module errors
   on a suspect boot (extends the one-messy-boot rule).
5. Config rows created by the CF/MCP path can carry different FK fields than
   the legacy admin writes (`surveyGroupId` vs `surveyId` on triggers) —
   characterize LIVE data shapes per writer, not just the legacy writer code.

**Session-process notes (cheap wins to repeat):**
- Seed recipe that worked: tenant-router MCP `create` tools for records that
  need server-minted invariants (ticket numbers came out sequential), then
  Firestore REST `PATCH` for statuses/backdated timestamps the create tools
  don't expose. Enum caveat: the MCP ticket status enum says
  `waiting_customer`; the template UI stores `waiting` — seed UI vocab via
  REST or the row renders a raw value.
- Walk writes can BE demo data: a CREATE exercised with realistic content
  (a real customer question, a usable survey question) stays as a fixture
  instead of becoming cleanup; reserve create-then-delete for the delete verb
  itself, and report both.
- Engine-first pays inside one round, not just across rounds: the textarea
  control and status format labels added for Wave 1 were reused by Wave 3
  unchanged.

## 0d · Classes-round retro (2026-06-10, PRs #426–#433) — process lessons

**What worked (keep doing):** auditing existing twins against the CURRENT standard
instead of assuming the CS "pre-standard twin needs a rebuild" prior — all six
classes twins were post-standard in chrome (pageHeader, bridges, define-at-load,
static tab divs) and the real gaps were write-depth, so the round was bridge
extraction + lens consolidation, not rebuilds; verifying recon claims caught a
flat-wrong "MAST_V2_ROUTE_MAP doesn't exist" and surfaced a fully built ORPHAN
module (sessions-v2: manifest-wired, route-mapped nowhere, drilled-to by nothing)
that became the Schedule List lens for free; the walk again out-performed static
review — it found FOUR real bugs, two of them broken in LEGACY for months.

**What cost cycles (new gotchas below):**
1. Two legacy writes (`materializeSessions`, `renumberWaitlist`) used RTDB-style
   multi-path `MastDB.update('', {'<path>/<id>': …}})` / wrong-collection fan-out —
   silently dead since the Firestore migration ("path requires doc ID"). Session
   generation did not work in V1 AT ALL; only the walk's Generate click caught it.
   Treat any legacy multi-path MastDB.update as suspect BEFORE bridging it.
2. The required:true + name-less-editRender CREATE blocker (contacts-v2 gotcha)
   claimed its THIRD and FOURTH victims (resources-v2, instructors-v2) — dead
   CREATE since their conversion. When auditing an existing twin, grep its field
   defs for `required: true` and check the editRender inputs for `name=` attrs.
3. The Wave-0 seed wrote resources to `public/resources`; the accessor reads
   `admin/resources` — invisible docs, caught only when the assignment picker
   came up empty. Verify the accessor PATH in scripts/rewrite-entities.js before
   seeding, even when the collection name "obviously" matches the recon.
4. A calendar twin existed, was manifest-wired, and was UNREACHABLE — `calendar`
   was never added to MAST_V2_ROUTE_MAP. Twin-exists ≠ twin-reachable: check the
   route map for every twin during recon (extends the §1 visibility rule).

**Session-process notes (cheap wins to repeat):**
- Live-data status census beat code reading: enrollments carried THREE
  storefront-CF statuses (`checked-in`, `attended-pending-waiver`,
  `cancelled_by_session`) absent from the legacy module's vocab (§0c-5 again) —
  a 10-line field-shape census over the Wave-0 audit dump found them instantly.
- Walk automation: the mastConfirm dialog's confirm button is `#mastDialogOK` —
  scope delete confirmations there. The slide-out footer is
  `#mastSlideOutFooter` and its primary action calls
  `window.MastUI.slideOut._save()`.
- Identity heals can CREATE docs, not just rename: kept records referenced
  instructor/resource ids whose docs had been deleted — recreating the doc at
  the referenced id (David Stewart, Sarah Chen, Main Studio) healed 21+ dangling
  FKs without touching the referencing records.

**Session review (post-retro additions, 2026-06-10 — process findings the round's
own retro missed):**
- **Per-wave shipping as ONE background shell command** (commit → push → PR →
  poll checks → squash-merge → poll Deploy workflow) kept the merge-verify
  cadence near-zero-cost and freed the foreground for building the next wave.
  Pattern: `gh pr create … ; until checks not pending; merge; until Deploy
  completed` with `run_in_background`.
- **Ratification as an options table won same-day sign-off** — for the sidebar
  merge, presenting 4 explicit options (incl. the two NOT recommended, with the
  reasons) plus one recommendation got an immediate decision, and because the
  recommended option reused an already-proven lens pattern it shipped within
  the hour. Do this for every holistic consolidation ask: options + trade-offs
  + one recommendation, never an open question.
- **Edge can lag the Deploy-success signal** — twice the worker served the
  PREVIOUS bundle for ~30–60s after `gh run` reported the Deploy workflow
  green. Don't browser-verify on "workflow completed"; poll the worker until
  its `MAST_MODULES_V` equals the value committed on `origin/main`
  (`git show origin/main:app/index.html | grep MAST_MODULES_V`).
- **The first post-deploy boot can present an EMPTY shell** (no sidebar items,
  `window.MAST_MODULES_V` undefined) while still hydrating — that's the messy
  boot, not a regression. Gate every browser assertion on `MAST_MODULES_V`
  being defined and equal to the expected bundle before reading the DOM.
- **Claude-in-Chrome JS results redact record ids** (`[BLOCKED: Base64 encoded
  data]` / `[BLOCKED: Sensitive key]`) — returning a Firestore push-id from
  `javascript_tool` often comes back blocked. Stash ids on `window.__vars`
  inside the page and act on them in the NEXT call instead of round-tripping
  them through tool results.
- **The slide-out's primary save is callable directly**: the footer is
  `#mastSlideOutFooter` and the button invokes
  `window.MastUI.slideOut._save()` — for walk automation, fill the form fields
  by element id, then call `_save()`; a synthetic `.click()` on a stale element
  ref silently does nothing and reads like a dead CREATE.

## 0e · Admin-round retro (2026-06-10, PRs #437–#446) — process lessons

**What worked (keep doing):** line-level verification of the recon caught three
errors (a false "uses pageHeader", a false "no orphans" — settings-v2 was
manifest-wired but reachable from nowhere — and under-weighted visibility
absences: THREE admin sidebar items were soft-hidden for every tenant); the
entry-lens hub pattern (two routes → one module/tab, route picks the lens)
cleanly consolidated Subscription+Coins and absorbed the suppressions manager
into audit-v2's new Muted-rules lens; exercising every write live immediately
after each wave (create role → matrix save → role change → archive/unarchive,
suppress → unmute) — the only crash of the round was caught by navigation, not
by review; restricting RBAC-walk writes to throwaway records (a created role +
a junk test user) made the Permissions conversion safe to verify aggressively.

**What cost cycles (new gotchas below):**
1. The compat query exposes `.once()` ONLY — `.get()` throws. subscription-v2
   inherited `.get()` from legacy renderCoinsRecentList, whose own try/catch
   had silently swallowed it since the Firestore migration ("Could not load
   recent purchases" forever). A V2 twin that mirrors a legacy read can crash
   at setup on a bug legacy hides — grep the legacy read for `.get()` before
   mirroring it.
2. A foreign PR (#438) merged mid-round and the next wave's PR went
   `mergeStateStatus: DIRTY` on the MAST_MODULES_V line. Recovery cherry-pick
   worked, BUT resolving with `git checkout --ours app/index.html` discarded
   the wave's ENTIRE index.html wiring (route map + manifest + tab div), not
   just the version-suffix hunks — ship-check stayed green because the module
   simply wasn't wired. After ANY conflict resolution, grep for the wave's
   route-map/manifest/tab-div lines before pushing.
3. Recon dumps that truncate record ids (a 12-char uid prefix in a census
   table) read back later as "record missing" during the walk and burned a
   debugging cycle. Never slice ids in recon output; stash full ids on
   window.__vars in-page.
4. `MastUI.slideOut._opts` outlives requestClose() — a probe that reads the
   title/mode from _opts can report a CLOSED slide-out as open-in-edit. Gate
   walk probes on the SO body's offsetParent, then read _opts.
5. `EmployeesV2.open(id)`-style helpers that silently no-op on a cache miss
   make automation failures invisible (the stale-SO probe above compounded
   it). Prefer open() helpers that toast/throw on unknown ids.

**Session-process notes:**
- Read-mostly directives work: Settings was characterized (20 sub-views,
  singleton-doc writers, badges) and explicitly NOT converted; the orphan
  settings-v2 was deleted instead of rewired. Zero config docs touched.
- Demo seeding can be minimal in admin sections: only `emails` needed seeding
  (the twin's 30-day window had aged out); audit history needed nothing — the
  walk's own writeAudit entries ARE the demo.
- Append-only surfaces (audit log) and CTA-only surfaces (Stripe checkout)
  define their own walk boundary: read everything, click nothing financial,
  fabricate nothing historical.

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

**Check LIVE sidebar visibility per route, not just table presence.** A route with no
`MODE_ROUTE_VISIBILITY` entry is soft-hidden for EVERY tenant (`isRouteVisible`:
unknown → hidden) — the Finance round built, demoed, and walked the whole close hub
against a sidebar entry no tenant could see, because hash navigation bypasses the
sidebar and the recon recorded the missing registry entry as "intentional." Treat
"intentionally absent" claims as findings to verify in a live sidebar
(`offsetParent !== null`), and schedule the registry entry as Wave-0 work if the
surface is getting a V2 home (Finance fix: #410).

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
- Engine since the CS round: status fields take `format(v)` for plain-language
  display labels (stored values untouched), and `type:'textarea'` (+`rows`) is a
  native edit control — don't hand-roll either.
- Font sizes: only the 7-scale rem values pass lint — `0.72 / 0.78 / 0.85 / 0.9 / 1 / 1.15 / 1.6`.
- Ship with `bash scripts/ship-check.sh` (bump → inventory → all lints full-output → all tests).

## 5 · Verify every deployed wave (browser, sgtest15)

- **The PWA service worker masks fresh deploys** — `location.reload()` after a merge is
  NOT enough on sgtest15. Per-wave verify recipe: FIRST confirm what the worker serves
  (`curl -s https://<tenant>.runmast.com/app?cb=$(date +%s) | grep MAST_MODULES_V` —
  if the edge is stale, no browser dance helps); then unregister all service workers +
  clear CacheStorage, reload, and expect ONE messy mixed-cache boot (old module JS +
  new index.html → spurious applyRoute/tab-null console errors) before the next clean
  boot. Don't diagnose your module from that first boot's console.
- **Walk automation: scope clicks to the slide-out and to VISIBLE elements.** A
  `document.querySelectorAll('button')` text-match for "Save" can hit a hidden legacy
  button in another tab's DOM — the create then silently doesn't happen and reads
  exactly like the contacts-v2 dead-CREATE bug (Finance round lost a cycle to this
  false alarm, including a stray test record to clean up). Query within
  `#mastSlideOut`, filter `offsetParent !== null`, and note the SO's primary button is
  labeled **Create** in create mode, not Save. Same trap for delete flows: a generic
  "Delete" text-match can hit a list-row button instead of the mastConfirm dialog's
  confirm — scope to the dialog element (CS round lost a cycle to a delete that
  silently never confirmed).

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
| Custom `detail.render` taking `(record)` | The engine calls it as `render(MastUI, record)` — your "record" is MastUI and every tile renders blank/$0.00 (finance bill SO, fixed #402). Signature is `(U, r)`; `detail.editRender` is `(record, mode)` — they are NOT symmetric |
| A field with `get()` in an editable entity | `_isEditable()` treats get()-bearing fields as read-only context — your "editable" amount/date fields silently drop out of the edit form. Pre-map virtual edit fields onto the record before `openRecord` (prepBill pattern) and declare them get()-less |
| HTML in `pageHeader`'s `count` | `count` is escaped — links render as literal `<a href=…>` text. Links/buttons belong in `actionsHtml` |
| CF with a hint/fast-path param the client doesn't send | `approveAmendment(periodId?)`: the no-hint collection-group documentId fallback is invalid Firestore and threw INTERNAL since it shipped — only the LIVE walk caught it (the wedge-audit lesson again). Always thread the hint param; file the server fix |
| Scrubbing FK-referenced placeholder entities | Vendors were referenced by procurement POs/receipts/lots — deleting them strands FKs across modules. RENAME placeholder entities in place (identity heal); delete only unreferenced junk |
| Seeding CF-owned docs that carry canonical hashes | Close-v3 day/period closes store sha256 over a canonical projection (`lib/close-hash.js`) — seed scripts must replicate the hash (and the `public/closeState` mirror) or later CF verification/coherence breaks |
| Missing static tab div for a *-v2 route | applyRoute shows config.tab BEFORE setup(); the scaffold emits the div — hand-wiring must too |
| defineEntities() only called in setup() | Define at module load: first-nav + cold cross-drills need the registry (cs-surveys shipped with it never invoked) |
| Per-record bridge action over a load-once cache | Fresh-read the doc into the cache on miss, or actions on post-load records silently no-op |
| Boot-failure screen ("We couldn't load the admin") | It WIPES the DOM — all later console errors are unrelated noise; reload before diagnosing |
| CF/MCP-written config rows vs legacy admin rows | Same collection, different FK fields (triggers: surveyGroupId vs surveyId) — resolve both |
| Legacy multi-path `MastDB.update('' or '<coll>', {fanout})` | Silently dead on Firestore ("path requires doc ID") — session generation was broken in V1 for months. Convert to per-doc accessor writes before bridging |
| Twin exists + manifest-wired but NOT in MAST_V2_ROUTE_MAP | Unreachable under V2 (calendar-v2); recon must check the route map per twin, not just MODULE_MANIFEST |
| Accessor PATH ≠ the "obvious" collection | `MastDB.resources` reads `admin/resources`, not `public/resources` — seed via the accessor path from rewrite-entities.js or docs land invisible |
| `required:true` on a twin with custom editRender | 3rd + 4th occurrence (resources-v2, instructors-v2): CREATE dead since conversion. Audit existing twins for this pairing, don't just trust them |
| Kept records referencing DELETED docs (instructor/resource ids) | Recreate the doc AT the referenced id (identity heal works for creates too), don't rewrite the referencing records |
| Browser-verify right after "Deploy success" | The edge can serve the previous bundle for ~60s — poll the worker until MAST_MODULES_V matches origin/main's committed value, THEN touch the browser |
| Post-deploy boot with empty sidebar + undefined MAST_MODULES_V | Mid-hydration, not a regression — gate DOM assertions on the expected bundle id being live |
| Chrome-MCP javascript_tool returns "[BLOCKED: …]" for record ids | The extension redacts id-shaped strings — stash ids on window.__vars in-page; never round-trip them through tool results |
| Recon agent asserts a confident NEGATIVE ("no route map", "no twin") | Mechanically diff app/modules/*-v2.js against MAST_V2_ROUTE_MAP + MODULE_MANIFEST + sidebar routes — two orphans and a false "doesn't exist" came from trusting prose over a 3-way diff |
| Compat query `.get()` | The compat layer exposes `.once()` ONLY — `.get()` throws. Legacy callers with try/catch have been silently dead since the Firestore migration (coins Recent purchases); a V2 twin mirroring the read crashes at setup instead. Grep legacy reads for `.get()` before mirroring |
| Conflict resolution with `checkout --ours index.html` | Discards the wave's WHOLE index.html side (route map/manifest/tab div), not just the version-suffix hunks — and ship-check stays green with the module unwired. Resolve hunk-by-hunk or re-apply + grep the wiring after |
| Truncated record ids in recon dumps | A sliced uid read back as "record missing" in the walk. Keep ids whole; stash them on window.__vars in-page |
| `slideOut._opts` after requestClose() | Stale — reports a closed SO as open/edit. Gate probes on the SO body's offsetParent first |

## 8 · Helper scripts

- `scripts/scaffold-v2-module.mjs <route> <archetype>` — skeleton + index.html wiring.
- `scripts/ship-check.sh` — the whole pre-PR gauntlet in the right order.
- `scripts/lint-v2-standard.js` — born-0 ratchet for the V2 surface standard (in CI).

## 9 · Candidate hardening (build tickets, not process)

- [ ] CI smoke-load for `*-v2.js`: stub `window`/`MastAdmin`/`MastEntity`/`MastUI`, load each
      module file, assert no exception — would have caught the audit-v2 double-status-field
      define() throw (blank tab in prod) before merge.
- [ ] Engine-level `ensureLoaded()` — the run-once load-promise fetch gate was hand-copied
      into FIVE classes twins this round (and exists ad hoc elsewhere); MastEntity should own
      "fetch gates on the module's data being loaded" so cold drills are safe by default.
- [ ] Lint: flag `required:true` on an entity whose detail has a custom `editRender` —
      four twins have now shipped with dead CREATE from this exact pairing.
- [ ] Lint or smoke-test: any legacy `MastDB.update('' | '<coll>', {multi-path fanout})` —
      two such writes sat silently dead in book.js since the Firestore migration.
