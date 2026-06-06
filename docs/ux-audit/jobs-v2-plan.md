# Jobs (Production) → V2 — Review, MVP Verdict & Build Plan

**Status:** Plan / proposal (set 2026-06-06; revised after architect-review + scope confirmation). Phased build pending operator go.
**Scope:** Phase B is a **FULL rewrite of the Jobs UI to V2 with retirement of legacy `production.js`** — parity
checklist at §6a is the cutover gate; two Jobs UIs must not coexist after cutover.
**Decisions baked in:** (1) write the plan before code; (2) **adopt MastFlow to *render* the job-status
lifecycle client-side**, per [commissions-v2.js](../../app/modules/commissions-v2.js) — but the transition
table itself becomes a **serializable, function-free definition** that UI + MCP + CF each consume, with a
**snapshot test** enforcing agreement (see §3a — MastFlow is browser-only and cannot itself be the shared
source of truth).

> "Jobs" is the operator-facing name for the **production** subsystem. Three surfaces back it:
> UI [production.js](../../app/modules/production.js) (~3,553 lines, legacy v1), the tenant-MCP
> [production.ts](../../../../Developer/mast-tenant-mcp-server/src/shared/tools/production.ts) (24 tools),
> and the `completeBuildJob` Phase-5 keystone Cloud Function in `mast-architecture/functions/tenant-functions.js`.
> Same hard rules as the cornerstone work: UI-only in this repo, delegate writes through a bridge,
> flag-gate `?ui=1`, bump `MAST_MODULES_V`, regen the admin-inventory doc, verify live on sgtest15.

---

## 1. The intent (operator's words)

Jobs is the surface for tracking the creation of new product end-to-end:

- **Define what you intend to build**, then **track actual output**.
- **Understand what's in flight.**
- **Integrate into inventory.**
- **Link back to the operations process that says *when* product is needed** — forecast, custom order,
  planned events, online orders.
- **Integrated story process** — capture/document the build in words/pictures/videos to show prospective
  buyers the development of the piece.
- **Costing/margin from *actual* labor + production cost.**

---

## 2. Scorecard — what exists today

| Pillar | Verdict | Evidence |
|---|---|---|
| Define intent → track output | ✅ Solid | line-items `targetQuantity` vs `completedQuantity`/`lossQuantity`; per-session `builds` (production.js:644–751) |
| Understand what's in flight | ✅ Solid | list view + status/purpose/work-type/date filters; progress bars (production.js:391–548) |
| Inventory integration | ✅ Solid | auto-push on build completion, D47 purpose matrix, idempotent (`completeBuildJob` CF; production.js:857–950) |
| Integrated story process | ✅ Strong | in-build photo capture, milestones, captions, QR codes, publish, product-link (production.js:1457–1512, 2304–3200) |
| Costing/margin on actuals | ✅ Strong | frozen `bomForecast` snapshot, budget-vs-actual cost table, manual overrides, observed-cost rolling avg (D45/46), drift alerts (production.js:1100–1293) |
| **Link back to "when needed"** | ⚠️ **1 of 4 wired** | **online orders** only, via `productionRequests`. Commissions, planned events, forecast **not** auto-linked |
| End-to-end as a modern surface | ⚠️ Legacy v1 | imperative jQuery + string-HTML + `openModal()`; not on `MastEntity` like every other mature module |

**Two real weaknesses:** (a) demand-signal integration is one-quarter done; (b) the UI is the last big
legacy holdout while orders/products/customers/commissions are all on the Entity Engine.

No missing *data-model concept* surfaced — the job / line-item / build / cost / story model is well-formed.

---

## 3. What comparison to sibling modules surfaced

Against products-v2, orders-v2, customers-v2, commissions-v2:

- **Not on `MastEntity`.** Every comparable surface uses the declarative schema → list + faceted
  slide-out + tabbed record. Jobs swaps views with `style.display` and authors HTML by hand. Biggest debt.
- **No process engine.** [commissions-v2.js](../../app/modules/commissions-v2.js) drives its lifecycle
  through **MastFlow**; Jobs hand-codes `PROD_JOB_TRANSITIONS` in *two* places (production.js:55–61 and
  production.ts:40–44) — they can drift. → **adopt MastFlow** (decided).
- **No tag-facet bar / attributes pane** (both now standard on products-v2) despite Jobs having rich
  facets (purpose, work-type, priority, deadline-risk).
- **`stories-v2.js` is read-only** — all authoring is still trapped in legacy `#stories` inside
  production.js. A half-migrated surface to finish.

---

## 3a. MastFlow & the transition source-of-truth (LOAD-BEARING — read before building)

The original draft said "adopt MastFlow as one transition source shared by UI + MCP." That is **not
achievable** and would make things worse. Corrected design:

- **MastFlow is a browser-only module** (`window.MastFlow`, IIFE; `app/modules/workflows/workflow-engine.js:1168`).
  Its transition write path uses `window.MastDB` and `window.MastAdmin.currentUser`; workflow *specs* embed
  live JS predicate closures + DOM target ids. None of that can be imported by the **TS MCP** or the **CF**.
  Wiring the UI to MastFlow while the MCP keeps its own `JOB_TRANSITIONS` would add a **third** encoding, not
  unify the two — strictly worse than today.
- **There are THREE write authorities, not two:**
  1. UI `production.js:55` (`PROD_JOB_TRANSITIONS`)
  2. MCP `production.ts:40` (`JOB_TRANSITIONS` + `VALID_JOB_STATUSES`; terminal states encoded by omission — already divergent from the UI's explicit-empty-array form)
  3. CF `completeBuildJob` — owns **build** completion/lock (`locked:true`) + the inventory/material/cost cascades + idempotency. This is a *different* state machine (build-completion) that interacts with job-status.
- **Corrected source-of-truth design:**
  1. Extract the **job-status** transition rules to a plain serializable structure — `{ states, transitions, terminalStates, entryStatus }`, **no functions, no DOM ids**.
  2. Enforce agreement across the three runtimes with a **snapshot/equality test** (matches the repo's existing gate-script posture, e.g. `lint-cache-bust.js`). Drift becomes a CI failure, not a silent bug. (A shared package is cleaner but higher plumbing cost across the 3-repo split; the snapshot test is the pragmatic first move.)
  3. MastFlow's legitimate role: **render** the job-status stepper/guided-rail client-side and **route transitions through the bridge** (which calls the server, mirroring how `record_build_completion` → `completeBuildJob` already works). The requirement *predicates* ("is this field filled in") are correctly client concerns.
- **Hard boundary:** MastFlow governs **job status only** (definition→in-progress→completed…). It must **never** drive **build completion** — that stays the idempotent server CF. MastFlow's optimistic client `transition()` (record-write then best-effort audit) is unsafe for the inventory/material cascade.
- **Migration artifact (required):** the MastFlow job spec needs a `derivePhaseFromLegacy(job)`
  (`workflow-engine.js:150`) or every existing `admin/jobs/*` record renders at phase[0]. Unit-test it over all current job statuses.

> Why commissions could "just adopt MastFlow" but jobs can't blindly copy it: commissions have **no**
> MCP-side transition enforcement and **no** CF lock cascade. Jobs are co-owned by a CF — the lifecycle is
> genuinely multi-runtime, so the shared *data* + snapshot test is the part that matters, not the renderer.

## 4. MVP verdict

**Current Jobs meets MVP** for the core loop: define → build → cost → inventory → story. Do **not** gate
a V2 effort on new capabilities.

Three items complete the operator's explicit "link back to operations" requirement:

1. **Commission → production request** auto-bridge (custom orders are first-class demand; today manual).
2. **Event → production request** auto-bridge (`inventory-event` purpose tag exists; nothing emits it from
   `salesEvents.allocations`).
3. **Forecast / demand** — genuinely **not built anywhere**. Largest net-new scope; stage *after* V2 UI,
   don't gate MVP on it. (Materials carry `reorderThreshold`/`reorderQty`, but there is no
   sales-velocity / lead-time model.)

---

## 5. Tenant-MCP CRUD parity gaps

MCP exposes 24 production tools but is **not at UI parity**. Confirmed gaps (UI can, MCP can't):

| Capability | UI | MCP |
|---|---|---|
| Delete job / line-item / build / request / story | ✅ | ❌ none |
| Story **read / list** | ✅ | ❌ (only `create_story`, `publish_story`) |
| Story **edit entries** (add photo/caption/milestone, reorder) | ✅ | ❌ |
| Build photo / milestone / note capture | ✅ | ❌ (session record only, no media) |
| Product-link on completion (`linkProductToBuild`) | ✅ | ❌ |
| Operator CRUD | ✅ (auto-populated) | ❌ read-only `list_operators` |
| Update line-item `targetQuantity` | ✅ | ❌ immutable post-create |

≈ **8–10 new/expanded tools.** Registration path: implement in `shared/tools/production.ts` → declare in
`skills/production.skill.ts` `tools[]` → add `execute()` case → it's flattened into `TOOL_REGISTRY` via
`tenant/meta-tools.ts`. Keep entity-level RBAC (`jobs`/`buildJobs`); add a `stories` perm if absent.

---

## 6. Build plan (phased)

### Phase A1 — MCP additive parity (FIRST; safe; unblocks automation + V2 test-data seeding)
Add to [production.ts](../../../../Developer/mast-tenant-mcp-server/src/shared/tools/production.ts) — read/create
only, no destructive cascades:
- `get_story`, `list_stories`, `update_story` (entry add / edit / reorder / remove).
- `link_product_to_build`.
- Extend `update_production_line_item` to allow `targetQuantity` **before** any locked build exists.
- Per-tool `requiredPermission` in `production.skill.ts` for every new tool; register the `stories` entity in
  the RBAC skill (today production tools gate on `jobs`/`buildJobs` — story create/publish inherit the skill
  default; assign deliberately, don't leave new tools ungoverned). Enforcement is in `meta-tools.ts`.

### Phase A2 — MCP destructive tools (DEFERRED — gate on the cascade contract)
Do **not** build until the cancel/delete cascade-and-lock contract is written as a shared decision (interleave
with early Phase B design). Reason: delete semantics (inventory reversal, `productionRequests` re-open, locked-
build protection per `production.ts:463`) aren't specified anywhere yet; building them blind just re-creates the
drift one layer down, and risks bypassing the CF idempotency (`production-double-push-idempotency.test.ts`).
- `delete_production_job`, `delete_line_item`, `delete_story` — soft-delete/cancel; never orphan a locked build.
- (Optional) operator upsert/delete if the UI grows explicit operator management.

### Phase B — Jobs V2 UI — **FULL rewrite to parity, then retire legacy** (`jobs-v2.js`)

**Scope is total.** This is not a partial twin: every capability in legacy `production.js` (~3,553 lines)
is ported to the Entity Engine, verified at parity on sgtest15, and then **`production.js` + its `#jobs`
route + the legacy `#stories` surface are deleted.** Two Jobs UIs must not persist. products-v2 is the
pattern reference. Build side-by-side behind the route-map flag so it ships incrementally without breaking
the live legacy surface; flip the flag and remove legacy only after the parity checklist (§6a) is green.

**B1 — Scaffold + routing + list/detail read surface**
- **Routing/gating (the real mechanism — not `?ui=1`):** add `jobs: 'jobs-v2'` to `MAST_V2_ROUTE_MAP`
  (`index.html:20529`); add a `MODULE_MANIFEST` entry (~`index.html:21338`); the module self-registers gated on
  `mastUiRedesign`. Routes remap only when `mastUseV2Routes()` is true (`mastLegacyUI !== '0'` inverted;
  `index.html:20544,20589`). `jobs` is **not** in the route map today — concrete step.
- `MastEntity.define('jobs-v2', …)` — list with **status + purpose tag-facets**; faceted slide-out.
- Tabs: **Overview · Line Items · Builds · Costs · Story · Links** (read + light inline edit in-pane).
- **MastFlow renders job-status** per §3a (serializable table + snapshot test + `derivePhaseFromLegacy`);
  build-completion stays the CF.
- All writes through a `MakerProductBridge`-style bridge (no direct MastDB writes from V2 UI).

**B2 — Heavy workflows (drilled slide-outs)** — the parts most likely to be skipped; explicitly in-scope:
- **Production-request queue** — the banner + "assign to job / create job" flow from the top of the legacy list.
- **Build lifecycle** — Start Build (operator + work-type), **live Active-Build view** (elapsed timer,
  in-session photo capture, milestones, notes), Complete Build (qty recap → CF `completeBuildJob`).
- **Story authoring** — build-photo picker/reorder, captions, freeform upload, QR-code generation on publish,
  operator capture, product-story link. (Folds in the read-only `stories-v2.js`.)
- **Inventory push controls** — manual push surfaces for inventory-general / inventory-event purposes.
- **Cost tracking** — budget-vs-actual table with per-cell actual overrides; product-link-on-completion.

**B3 — Cutover + legacy retirement (definition of done)**
- Run the §6a parity checklist live on sgtest15; every row green.
- **Stories retirement — 3 ordered steps** (stories-v2 already ships as a route-map twin at
  `index.html:20539` that bounces authoring to `#stories` via `navigateToClassic`, `stories-v2.js:237`):
  1. Build Story authoring inside jobs-v2 (Story tab/drill).
  2. Repoint stories-v2's `navigateToClassic` target at the new jobs-v2 authoring.
  3. *Then* retire legacy `#stories`. Skipping the order breaks the shipped stories-v2 deep-link.
- **Delete `app/modules/production.js`**, its `MODULE_MANIFEST` entry, and the legacy `#jobs`/`#stories`
  routes. Flip the default so V2 is the only Jobs UI. Bump `MAST_MODULES_V`; regen
  `docs/generated/admin-inventory.md`; verify live on sgtest15 (`<tenant>.runmast.com`, hard-reload).

### 6a. Parity checklist — every legacy `production.js` capability → V2 home (cutover gate)

No row may be dropped without an explicit operator decision logged here. Flag flips only when all are ✅.

| Legacy capability (production.js) | V2 home | Phase |
|---|---|---|
| Job list cards (status/purpose/priority/progress bar) | jobs-v2 list + tag-facets | B1 |
| Filters: status / purpose / work-type / date-range / URL job-id list | list filter bar | B1 |
| Job detail: line items grouped by product, variant rows | Line Items tab | B1 |
| Line-item add / remove / target-completed-loss edit | Line Items tab (inline) | B1 |
| Status transitions (definition→in-progress→on-hold→completed→cancelled) | MastFlow stepper (§3a) | B1 |
| Cost tracking table (budget vs actual, per-cell override) | Costs tab | B2 |
| Pipeline status (request/order link) | Overview/Links tab | B1 |
| Product-links section (link build → product) | Links tab | B2 |
| Production-request queue banner + assign/create-job | drilled queue surface | B2 |
| Start Build (operator select, work-type) | Build drill | B2 |
| Active-Build live view: elapsed timer | Build drill | B2 |
| Active-Build: in-session photo capture | Build drill | B2 |
| Active-Build: milestones | Build drill | B2 |
| Active-Build: notes | Build drill | B2 |
| Complete Build (qty recap → CF, inventory push, auto-transition, fulfill request) | Build drill → `completeBuildJob` | B2 |
| Story curation: build-photo picker + reorder + captions | Story drill | B2 |
| Story: freeform photo upload | Story drill | B2 |
| Story: video entries | **DECISION pending (§9)** — in or out of MVP | B2 |
| Story publish / unpublish | Story drill | B2 |
| Story: QR-code generation | Story drill | B2 |
| Story: operator capture on publish | Story drill | B2 |
| Story → product link on publish | Story drill / Links tab | B2 |
| Manual inventory push (inventory-general / event) | Inventory push controls | B2 |

### Phase C — Demand-signal integration (completes "link back to operations")
- Commission `accepted` / `deposit-paid` → emit `productionRequest` (mirror the order→request path).
- `salesEvents.status='planning'` + `allocations` → spawn an `inventory-event` job seeded from allocations.
- **Then** forecast / demand as a discrete design (net-new; biggest unknown).

---

## 7. Sequencing notes / footguns

- **Status machine is duplicated across THREE runtimes** (UI `production.js:55`, MCP `production.ts:40`, CF
  build-completion). Per §3a, land the serializable transition table + snapshot test *before* wiring any
  surface to it — MastFlow cannot itself be the shared authority.
- **Build locks are sacred.** `completeBuildJob` sets `build.locked=true` and owns inventory/material/cost
  cascades (D44–D47). MCP deletes and UI edits must respect locks (specifications-only edits post-lock,
  as `updateProductionLineItem` already enforces).
- **Inventory double-push.** Existing idempotency test (`production-double-push-idempotency.test.ts`) — any
  new completion/inventory path **and every Phase-A2 delete tool** must preserve it (deletes that touch
  inventory must not bypass the CF idempotency).
- **Cache-bust gate** (`scripts/lint-cache-bust.js`) fails the PR if `app/modules/*.js` changes without a
  `MAST_MODULES_V` bump. Run `./scripts/install-hooks.sh` once.
- **docs-inventory gate** goes stale on admin line-count changes — regen `docs/generated/admin-inventory.md`
  in the same PR.

---

## 8. Testing strategy

- **Transition snapshot test (the §3a anti-drift mechanism):** assert the job-status transition table is
  byte-identical across UI / MCP / CF (or generated from one serialized artifact). This is the gate that
  makes "shared source of truth" real rather than aspirational.
- **`derivePhaseFromLegacy(job)` unit tests** over every existing job status, so legacy `admin/jobs/*` records
  render at the correct MastFlow phase, not phase[0].
- **Preserve `production-double-push-idempotency.test.ts`** for any new completion/delete path.
- **RBAC tests** for each new story tool (`requiredPermission` resolves, `stories` entity governed).
- Live-verify on sgtest15 via `<tenant>.runmast.com` (hard-reload) per repo rule.

---

## 9. Open questions / decisions

- **Video in stories — DECIDE, don't defer.** Legacy stories are **image-only** (no video/mp4 anywhere); the
  entry model stores a single `mediaUrl` (`stories-v2.js:29`). "Words/pictures/videos" is net-new capture +
  storage + playback (upload limits, poster/transcode, storage path), **not** a tab toggle. Recommendation:
  scope a minimal video-entry (upload + inline `<video>` playback, no transcode) into Phase B *or* explicitly
  mark video out-of-MVP. Pick one before Phase B starts.
- Forecast/demand model: sales-velocity + lead-time, or simpler reorder-threshold rollup to start?
- Event→job: one job per event, or per-product jobs grouped by event? (purpose tag is per-job today.)
- Operator management: keep auto-populated-from-builds, or promote to a first-class managed entity?
