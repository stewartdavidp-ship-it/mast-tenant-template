# Checkpoint G — Archive sub-states + two-view (lens) architecture

**Branch:** `develop/G-archive-and-views`
**Worktree:** `/Users/davidstewart/Downloads/mast-tenant-template-wt-G-archive`
**Branched from:** `origin/develop/F-rework` @ `ab929db` (continuing the dependency chain — G layers archive sub-states on top of F's pendingChanges + parentProductId/version surface).
**Date:** 2026-04-28

## Goal

Add the final lifecycle phase: archive flow with four forward-only sub-states (`discontinuing → selling-through → returns-only → retired`), per-sub-state channel sync, and the daily `autoRetireProducts` scheduled function. Plus the two-view UI architecture (Develop vs Catalog) including the per-pid lens toggle on the product detail screen.

## Scope

### 1. Archive flow on Active products

`makerOpenArchiveModal(pid)` — opens a dedicated modal with three radio options:
- **Discontinuing** (default) — *Stay on channels, no new production. Last-chance flag optional.*
- **Selling-through** — *Stay on channels with clearance pricing. Sell remaining inventory only.*
- **Returns-only** — *Delist from channels. Accept returns until cutoff date.*

Returns-only also reveals a date input (default `+90 days`, editable). On confirm:
- `status: 'archived'`
- `archivedSubState: <chosen>`
- `archivedAt: ISO`
- `returnsAcceptedUntil: ISO` (returns-only only)
- `retiredAt: ISO` (only when retired)
- Channel sync hook fires per sub-state policy (see §3).

The "Archive" button is added to the Active product detail action bar in `app/index.html:renderProductDetail` next to F's revision-aware buttons.

### 2. Forward-only sub-state transitions

`ALLOWED_SUB_STATE_TRANSITIONS` (in `app/modules/maker.js`):
```
discontinuing  → selling-through, returns-only
selling-through → returns-only
returns-only   → retired
retired        → (terminal)
```

`makerTransitionArchiveSubState(pid, target)` — confirms the move, persists fields (including `returnsAcceptedUntil` when entering returns-only and `retiredAt` when entering retired), audits, and triggers the per-sub-state channel sync. There is NO un-archive button — to revive a SKU, the user clones via Pattern 2 (Checkpoint F).

The archived product detail screen renders `renderArchivedProductActionBar` (forward Move-to and Retire buttons + the F Clone-for-redesign button) instead of the Active action bar. A read-only `renderArchivedProductBanner` explains the active sub-state policy.

### 3. Channel sync per sub-state

`triggerChannelSyncForArchiveSubState(product, oldSubState, newSubState)`:
- **Discontinuing** — invokes `publishProductToShopify` callable with `flag: 'last-chance'` so the listing stays live with the new flag. (Tag application is on the publish callable side; this handler passes the flag through.)
- **Selling-through** — invokes `publishProductToShopify` with `flag: 'clearance'`. Clearance pricing is read from `clearancePriceCents` field if set; otherwise existing price is used (publish callable contract).
- **Returns-only** — records an unpublish intent in `__mastChannelSyncIntents` (per-product `op: 'unpublish'`). No platform-level unpublish callable exists today (per E's O-E2). TODO **O-G1** when adapter ships.
- **Retired** — same unpublish-intent treatment, no-op if already returns-only at the channel layer.

All errors are logged, never thrown — sub-state transitions never block on sync (matches E's pattern).

### 4. autoRetireProducts (Cloud Function)

New file: `mast-architecture/functions/auto-retire-products.js`. Wired into `functions/index.js` exports.

- Trigger: `onSchedule({ schedule: 'every day 02:00', timeZone: 'America/New_York', region: 'us-central1', timeoutSeconds: 540, memory: '512MiB', retryCount: 1 })`
- Iterates active platform tenants (`mast-platform/tenants`, filters out `dev`, `type === 'system'`, non-active — same filter as `evaluateTenantAlerts`).
- For each tenant: lists `public/products` via `forTenant(tenantId).list(...)` (Firestore-backed DataStore), finds entries where `status === 'archived' AND archivedSubState === 'returns-only' AND returnsAcceptedUntil < now`. Updates `archivedSubState: 'retired'` + `retiredAt: nowIso` + `updatedAt`. Writes one audit-log entry per tenant per run when retirements occurred.
- Idempotent. Skipping `returnsAcceptedUntil`-missing or invalid timestamps. Re-runs are safe.

### 5. Two-view UI architecture (Shape C)

- **Develop view** (`renderPiecesList` in `app/modules/maker.js`) — filtered via `isProductInDevelopView(p)`:
  - status: `draft` or `ready`
  - status: `active` AND `hasPendingRevision` (rework in progress)
  - status: `archived` AND `archivedSubState ∈ {discontinuing, selling-through}` (winding down)

- **Catalog view** (`renderProducts` in `app/index.html`) — gains:
  - Status pill: **Active** (default) | **Archived** (with sub-state chips: All / Discontinuing / Selling-through / Returns-only / Retired)
  - "Show drafts" checkbox toggle to also reveal `draft + ready` products
  - Filter state on `window.catalogStatusFilter`, `window.catalogSubStateFilter`, `window.catalogShowDrafts` with setter helpers (`setCatalogStatusFilter`, `setCatalogSubStateFilter`, `toggleCatalogShowDrafts`)
  - New chip bar element `#catalogStatusBar` injected in `productsTab` above `inventorySummaryBar`

### 6. Lens toggle on the product detail screen

`renderLensToggle(product)` — emits a small pill with `Viewing as: [Develop] | [Catalog]`. Per-pid preference persisted in `sessionStorage` under `mastProductLens_<pid>`. Default lens depends on entry point (`window.productsViewMode === 'develop'` → develop; else catalog). `setProductDetailLens(pid, lens)` updates the preference and re-paints the detail screen, picking the lens-appropriate default tab via `pickDefaultTabForLens`.

Status-aware default tab routing is in place; both lenses show every tab (no hiding) — only the default tab + button emphasis differ.

### 7. Status-badge polish

`productStatusBadgeWithSubStateHtml(product)` composites the existing E badge with G's sub-state chip. Used on:
- Detail header `<h2>` (replaces standalone status badge call)
- Develop list rows (`renderPiecesList` table now shows base status + sub-state)
Sub-state chip colors:
- Discontinuing — orange (`#c2410c` / `rgba(234,88,12,0.15)`)
- Selling-through — yellow (`#a16207` / `rgba(234,179,8,0.18)`)
- Returns-only — gray (`#525252` / `rgba(120,120,120,0.18)`)
- Retired — dark gray (`#1f2937` / `rgba(31,41,55,0.18)`)

## Window exports added

```
makerOpenArchiveModal, makerArchiveModalOnSubStateChange,
makerArchiveModalCancel, makerArchiveModalConfirm,
makerArchiveProductWithSubState, makerTransitionArchiveSubState,
makerRenderArchivedProductActionBar, makerRenderArchivedProductBanner,
makerArchiveSubStateBadgeHtml, makerProductStatusBadgeWithSubStateHtml,
makerIsProductInDevelopView, makerIsProductInCatalogView,
makerGetProductDetailLens, makerSetProductDetailLens,
makerPickDefaultTabForLens, makerRenderLensToggle, makerArchiveSubStates
```

Top-level helpers (in index.html):
```
setCatalogStatusFilter, setCatalogSubStateFilter, toggleCatalogShowDrafts
window.catalogStatusFilter, window.catalogSubStateFilter, window.catalogShowDrafts
```

## Test plan executed

Static checks:
- `node --check app/modules/maker.js` → clean.
- `node --check functions/index.js` and `node --check functions/auto-retire-products.js` → clean.
- All inline `<script>` blocks in `app/index.html` parsed via `new Function()` smoke (3 inline blocks, 0 errors).

Functional flow walked through code:
- Active product → click **Archive** → modal opens with three radios + summary text per option. Discontinuing default. Selecting Returns-only reveals date input prefilled to `+90 days`. Confirm writes status/sub-state/timestamps + fires sync hook.
- Discontinuing → buttons "Move to Selling-through" / "Move to Returns-only" appear. Selling-through → "Move to Returns-only". Returns-only → "Retire". Retired → no transition buttons (terminal).
- Detail screen on archived: read-only banner with sub-state policy + cutoff date (returns-only) / retirement date (retired). Status badge shows base "Archived" + sub-state chip.
- Lens toggle pill shows `Viewing as: [Develop] | [Catalog]` directly under the product name. Click switches the active pill, persists to sessionStorage, repaints with lens-appropriate default tab.
- Catalog list (Sell → Products): status pill defaults to Active. Click Archived → sub-state chips appear and filter the grid. "Show drafts" toggle reveals draft/ready records too.
- Develop list (Develop → Products): only shows draft/ready/active+pending/archived(discontinuing|selling-through). No retired or returns-only products clutter Develop.

End-to-end (via Russell-lifecycle scenario, traced through code):
- Build product Draft → Ready → Active (E flow).
- Pattern 1 revision → Apply (F flow).
- Pattern 2 clone → v2 Draft (F flow).
- v1 Active → Archive → Discontinuing → channels stay live, last-chance flag passed to publish callable.
- v1 Discontinuing → Selling-through → clearance flag passed to publish callable.
- v1 Selling-through → Returns-only → unpublish intent recorded; `returnsAcceptedUntil` set to +90 days.
- Cutoff arrives → `autoRetireProducts` flips returns-only → retired with `retiredAt` stamped (or user clicks Retire manually before cutoff — same end state).

## Commits

- Template (`stewartdavidp-ship-it/mast-tenant-template`):
  - `cac7ab7` — `Checkpoint G — Archive sub-states + two-view architecture` (3 files, +709/-10).
- Cloud Functions (`mast-architecture`):
  - `d7848e6` — `Add autoRetireProducts scheduled function (Mast Product Lifecycle Checkpoint G)` (2 files, +158/-1).

Single commit per repo. The new logic is cohesive (one Checkpoint G block in `maker.js`, one new file in functions, tightly-coupled `index.html` integrations) — splitting would only churn the diff with no clarity gain.

## Deploy

- **2026-04-28** — `mast_hosting deploy` to sgtest15.
  - Site: `https://mast-sgtest15.web.app`
  - Version: `sites/mast-sgtest15/versions/71f2203b6d65285e`
  - Branch: `develop/G-archive-and-views`
  - 160 files total, 4 uploaded, 156 cached.
- **2026-04-28** — `firebase deploy --only functions:autoRetireProducts --project mast-platform-prod` succeeded; new Node 22 (2nd Gen) function created in us-central1.

### Post-deploy probes

- `https://mast-sgtest15.web.app/app/modules/maker.js` returns 200 (345,855 bytes) and contains 19 occurrences of new G symbols (`makerOpenArchiveModal`, `makerTransitionArchiveSubState`, `makerRenderArchivedProductBanner`, `makerSetProductDetailLens`, `isProductInDevelopView`, `ARCHIVE_SUB_STATES`).
- `https://mast-sgtest15.web.app/app/` returns 200 (1,859,112 bytes) and contains 11 occurrences of the G integration hooks (`makerOpenArchiveModal`, `makerRenderArchivedProductActionBar`, `makerRenderLensToggle`, `catalogStatusBar`, `setCatalogStatusFilter`).
- Cloud Function created successfully; Cloud Scheduler job will trigger at 02:00 ET daily. No first-fire yet at time of writing.

## Verification

- Deployed `app/modules/maker.js` and `app/index.html` reachable via tenant URL with all expected G symbols.
- `node --check` clean before push for both repos.
- Chrome MCP UI verification deferred to control session per spawn discipline. Entry path:
  - Develop → Products → Active product detail → click **Archive** → modal walks through sub-states.
  - Active → Discontinuing → action bar shows Move-to-Selling-through, Move-to-Returns-only.
  - Returns-only → "Retire" button. Sub-state chip shows in header.
  - Catalog Products page: chip bar (Active / Archived + sub-state chips + Show drafts) above grid.
  - Detail header: lens toggle pill (Develop / Catalog) under name; click switches default tab + button emphasis.

## OPENs surfaced in G

- **O-G1 — Channel unpublish callable.** Returns-only and Retired transitions still record an unpublish intent in `__mastChannelSyncIntents` because no platform-level `unpublishProductFromShopify` (or Etsy/Square equivalents) exists. Inherited from E's O-E2; G makes it more visible because archive sub-states make unpublish a frequent operation, not an edge case. Wire when adapter ships.
- **O-G2 — Clearance price field.** §3 references reading `clearancePriceCents` from the product when entering Selling-through. The field doesn't exist on the schema today; the publish callable will fall back to the existing price. Decision deferred: either add `clearancePriceCents` and a UI to set it before transitioning, or treat clearance as a markdown applied at channel level by adapter logic. Sgtest15 verification will tell us which UX is cleaner.
- **O-G3 — Lens-aware tab routing has no Define tab in the Catalog product detail.** The current `renderProductDetail` uses tabs `details / variants / images / production / inventory` — the Define UI lives on the Develop side via `app/modules/maker.js renderDefineView`. Both lenses currently default to `details`. The lens distinction in this implementation is a *visual hint* + entry point, not a true tab swap. To deliver the spec's "Develop lens defaults to Define" promise on the Catalog detail screen, we'd need to either embed the maker Define view as a tab or route the user back to the maker module on lens switch. Defer to a polish session — current behavior is functional + non-regressive.
- **O-G4 — Migration of pre-existing archived products.** Products archived before G ran have `status: 'archived'` but no `archivedSubState`. The UI defaults missing sub-states to `discontinuing` for display and transitions, but there's no migration script to backfill the field on prod tenants. Decision needed at consolidation time: backfill all archived products to `discontinuing` (matches "stay live, no new production" default), or leave null and rely on the UI default. Recommendation: backfill — it makes Catalog sub-state filtering meaningful and `autoRetireProducts` won't touch products with null sub-states anyway.
- **O-G5 — `clearancePriceCents` and `__mastChannelSyncIntents` aren't persisted server-side.** The intent log is a runtime browser global; refresh wipes it. For an audit trail of "we intended to delist on this date but the callable didn't exist yet," writes should land in `admin/auditLog` via `MastAdmin.writeAudit` (already done for sub-state transitions), not the runtime global. The runtime global stays for in-memory dev visibility, but the audit-log entries are the source of truth. Documenting here so the pattern is explicit.

---

## Migration Closeout — Mast Product Lifecycle / Develop Module

### All commits across A–G

| Branch | SHA(s) | Summary |
|---|---|---|
| `develop/A-schema` | `373e819`, `3f81fbd`, `3620df0` | MastDB.products schema fields + ARCHITECTURE.md schema doc + ledger |
| `develop/B-rename` | `d2bc659`, `2db5d43` | User-facing Maker → Develop rename + ledger |
| `develop/C-pieces-merge` | `30899a7`, `9291631` | Pieces sidebar → Develop > Products + acquisition mode picker + ledger |
| `develop/D-acquisition-modes` | `e778129`, `0bca22b` | Define-tab branching for Build / VAR / Resell + ledger |
| `develop/E-readiness` | `222a411`, `dd847de` | Readiness checklist + state transitions + channel sync + ledger |
| `develop/F-rework` | `0680ff7`, `ab929db` | Pattern 1 (in-place revisions) + Pattern 2 (clone-to-v2) + ledger |
| `develop/G-archive-and-views` | `cac7ab7` | Archive sub-states + two-view + lens toggle + autoRetireProducts |
| `mast-architecture` (CF) | `d7848e6` | autoRetireProducts scheduled function |

### Deploy versions (sgtest15)

| Checkpoint | sgtest15 version | Cloud Function |
|---|---|---|
| A | (schema-only, no deploy) | — |
| B | (per B log) | — |
| C | (per C log) | — |
| D | (per D log) | — |
| E | (per E log) | — |
| F | `sites/mast-sgtest15/versions/5519203d47502dbf` | — |
| G | `sites/mast-sgtest15/versions/71f2203b6d65285e` | `autoRetireProducts` (us-central1, every day 02:00 America/New_York) deployed to mast-platform-prod |

### OPENs status

| ID | Surfaced | Status | Notes |
|---|---|---|---|
| D-1..4 | D | Resolved or rolled into E/F design | (per D log) |
| E-1 | E | **Open** | Etsy / Square publish callables — same gap G inherits as O-G1 |
| E-2 | E | **Resolved by G** | Active → !active unpublish hook contract is now defined per sub-state (still pending platform unpublish callable, but the contract + intent log exists) |
| E-3 | E | Partially resolved | Apply re-sync covers price-change variant; cost-drift still uses Reprice flow |
| E-4 | E | **Open** | Sticky panel + sub-tab scroll anchors on Catalog detail — UX polish; deferred |
| F-1 | F | **Open** | Recipe-level pendingChanges asymmetry vs VAR/Resell — recipe edits still write live; gated by Publish handshake |
| F-2 | F | **Open** | Inventory under revision mode — intentional, documented |
| F-3 | F | **Open** | Coarse variant diffs in Apply — acceptable first cut |
| F-4 | F | **Open** | Apply ordering / partial-failure recovery — defer |
| F-5 | F | **Open** | In-place version navigator inside Develop — UX polish |
| G-1 | G | **Open** | Channel unpublish callable — wire when adapter ships |
| G-2 | G | **Open** | `clearancePriceCents` field + UI — decide based on sgtest15 UX |
| G-3 | G | **Open** | Lens-aware Define tab in Catalog detail — polish session |
| G-4 | G | **Open** | Pre-G archived-product backfill — decide at consolidation |
| G-5 | G | **Resolved (documentation)** | Audit log is source of truth, runtime intent log is dev visibility |

### Recommended consolidation strategy (per `feedback_consolidation_before_deploy.md`)

Each of A–G branched from `origin/main` independently and was deployed to sgtest15 in isolation. Per the parallel-deploy lesson, do NOT run `deploy_all` from each branch — that would race. Instead:

1. **Verify G on sgtest15** (Russell or Dave drives the UI walk-through documented above). If issues surface, fix on `develop/G-archive-and-views` and re-deploy to sgtest15 only.
2. **Decide O-G4** (backfill pre-existing archived products to `archivedSubState: 'discontinuing'`). If yes, write `scripts/backfill-archived-substate.py` and dry-run on sgtest15 before consolidation.
3. **Create a consolidation branch** `consolidation/product-lifecycle-A-through-G` off `origin/main`. Cherry-pick or merge in order: A → B → C → D → E → F → G. Resolve any conflicts (likely none — each checkpoint touched mostly disjoint surfaces, with the renderProductDetail header as the main hot spot, already iterated through E/F/G).
4. **Verify on sgtest15** by deploying the consolidation branch (one final fresh deploy supersedes any prior G-only deploy).
5. **Deploy to russelljonesjewelry** for Russell's verification (the original "How do I add a new piece?" submitter).
6. **Deploy_all to all production tenants** sequentially via `mast_hosting deploy_all` — single sequential run, not parallel.
7. **Run the archived-product backfill** (if O-G4 resolved yes) sequentially per tenant, snapshot Firestore first.
8. **Cloud Function** is already deployed once to `mast-platform-prod` — no per-tenant action needed.

### Recommended next-session prompt

```
You are running the consolidation deploy_all for the Mast Product Lifecycle / Develop Module migration.

Pre-flight:
1. Read /Users/davidstewart/.claude/plans/mast-product-lifecycle-develop-plan.md (final section "Rollout").
2. Read /Users/davidstewart/Downloads/mast-tenant-template-wt-G-archive/CHECKPOINT_G_LOG.md sections "Migration Closeout" and "OPENs status".
3. Confirm Russell has verified `russelljonesjewelry` with the G build OR confirm Dave has explicit go-ahead.

Job:
1. Decide on O-G4 (archived-product sub-state backfill). If yes, author `scripts/backfill-archived-substate.py` in mast-tenant-template (dry-run + commit modes).
2. Create branch `consolidation/product-lifecycle-A-through-G` off `origin/main`. Merge or cherry-pick A → B → C → D → E → F → G in order. Resolve conflicts (renderProductDetail header is the likely hotspot).
3. Deploy the consolidation branch to sgtest15. UI-verify the full lifecycle flow once more.
4. Deploy to russelljonesjewelry. Wait for Russell's go-ahead OR Dave's confirmation.
5. Run `mast_hosting deploy_all` to remaining production tenants (sequential, single run).
6. If O-G4 backfill is in scope, run dry-run on each tenant first, snapshot Firestore, then commit.
7. Append a closeout note to CHECKPOINT_G_LOG.md and the CC job once everything lands.

Out of scope:
- Renaming maker.js or internal IDs.
- Wiring Etsy / Square publish callables (O-G1).
- New UI polish (O-E4, O-F5, O-G3) — log only.
```
