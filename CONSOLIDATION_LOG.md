# Consolidation — Product Lifecycle / Develop Module (Checkpoints A–G)

**Branch:** `consolidation/product-lifecycle-A-through-G`
**Worktree:** `/Users/davidstewart/Downloads/mast-tenant-template-wt-consolidation/`
**Base:** `origin/main` @ `b39b7b4`
**Date:** 2026-04-28

## Merge order + SHAs

Merges done in **G → C → B → A** order (G first because D-E-F-G chain to it). Each merge committed separately for clean history.

| Order | Merge SHA | Branch merged | Conflicts | Resolution summary |
|---|---|---|---|---|
| 1 | `52db3e0` | `origin/develop/G-archive-and-views` (includes D+E+F) | 0 | Clean merge — adds 2,680 lines to maker.js + 195 lines to index.html + 4 new checkpoint logs (D/E/F/G). |
| 2 | `87b473f` | `origin/develop/C-pieces-merge` | 6 (4 in maker.js, 2 in index.html) | See "C conflict resolution" below. |
| 3 | `76d0034` | `origin/develop/B-rename` | 0 | Clean merge — Maker → Develop label-only rename in index.html + ARCHITECTURE.md. |
| 4 | `1e55df3` | `origin/develop/A-schema` | 0 | Clean merge — schema enums/setters added in MastDB.products + ARCHITECTURE.md schema section. |

Total merge commits: 4. All merge commits non-fast-forward (`--no-ff`) with descriptive messages preserved. Linear, auditable history.

### C conflict resolution

C and G both edited two zones in each file. G shipped after D and is C-aware in some places (e.g. G's ROUTE_MAP already calls `setProductsViewMode('develop')`, G exposes `window.makerIsProductInCatalogView`), but C's helper functions and modal UI hadn't yet landed in G's parent chain.

**`app/index.html` (2 conflicts)**

1. *Helper functions block (~line 23782)* — HEAD (G) added `catalogStatusFilter` / `catalogSubStateFilter` / `catalogShowDrafts` state vars + setters. C added `productsViewMode`, `setProductsViewMode`, `renderDevelopOrphanRecipesPanel`, `toggleDevelopOrphansBody`, `developCreateProductFromOrphan`, `developCreateNewProduct`. **Resolution: kept BOTH** — orthogonal additions. G's catalog filter state coexists with C's view-mode + orphan-panel scaffolding. Added a clarifying comment that maker.js's `renderPiecesList` is the canonical Develop-side renderer; this top-level `renderProducts` is Catalog-only with C's filter as a defensive short-circuit.

2. *`renderProducts` filter (~line 23944)* — HEAD applied G's `inCatalog()` membership + `statusFilter`/`subStateFilter` pills. C applied a `productsViewMode === 'develop'` short-circuit returning only drafts/ready. **Resolution: branched on `productsViewMode`**: develop mode uses C's drafts/ready filter (defensive); catalog mode uses G's full Catalog membership + status filter pills.

**`app/modules/maker.js` (4 conflicts in `openNewPieceModal` / `submitNewPiece`)**

1. *Modal markup (~line 4659)* — HEAD added a compact picker with radio name `newPieceAcqType` (D's draft); C added a richer picker with radio name `newPieceAcquisitionType`. The richer C picker exists immediately AFTER the conflict markers as already-merged context, so HEAD's compact picker would have been a duplicate radio group with a divergent name. **Resolution: took C's side** — single richer picker named `newPieceAcquisitionType`. Modal width uses C's `max-width:520px`.

2. *Read radio in `submitNewPiece` (~line 4783)* — HEAD read `newPieceAcqType` into local `acqType`; C read `newPieceAcquisitionType` into local `acquisitionType`. **Resolution:** read from C's name (`newPieceAcquisitionType` — matching the picker), assigned to `acqType` (used by D's downstream Define-view dispatch), and aliased `acquisitionType = acqType` so both downstream consumers compile.

3. *`newProduct` object construction (~line 4806)* — HEAD added `defineSpec` scaffolding for VAR/Resell + uniform cost-shape fields (`materialCost`/`laborCost`/`otherCost`/`totalCost: 0`). C added `emptyChecklist` + `readinessChecklist` + `pendingChanges`/`hasPendingRevision`/`parentProductId`/`version` lifecycle fields and went via inline `MastDB.set(...)`. The auto-merger left a duplicated `acquisitionType` key. **Resolution: composed both** — single `newProduct` object built once with C's lifecycle fields + D's defineSpec + uniform cost-shape, then `await MastDB.set(...)` once (single duplicate `acquisitionType` removed).

4. *Post-create dispatch (~line 4852)* — HEAD branched: `acqType === 'build'` → `createRecipeForProduct`, else → `openDefineForProduct` (D's correct behavior). C unconditionally called `createRecipeForProduct` with an interim banner for VAR/Resell. **Resolution: took HEAD's side** — D's branched dispatch is the real implementation; C's interim banner was explicitly intended to be replaced by D (per C's own checkpoint log).

All 4 maker.js conflicts net: a single coherent `submitNewPiece` flow that reads the C-style picker name, persists C's lifecycle fields and D's defineSpec/cost-shape, and dispatches to recipe builder vs Define view by acquisition mode.

## Smoke-test results (pre-deploy, on worktree)

- `node --check app/modules/maker.js` → OK (clean, no syntax errors).
- `app/modules/maker.js` line count: 6,915 (origin/main = 4,468; B alone = 4,468 — label-only; C = 4,557; D = 5,107; E = 5,635; F = 6,325; G = 6,850; consolidated = G + C-only deltas).
- `app/index.html` line count: 37,931 (origin/main = 37,546; A added 49; B unchanged in lines; C added 149; G added 183).
- Key-symbol presence (counts across maker.js + index.html):
  - A: `LIFECYCLE_STATUSES`=1, `archivedSubState`=24, `parentProductId`=17, `readinessChecklist`=10
  - B: `name: 'Develop'`=1, sidebar `>Develop<`=1
  - C: `develop-products`=12, `productsViewMode`=11, `developCreateNewProduct`=2 (+ `renderDevelopOrphanRecipesPanel`, `developCreateProductFromOrphan` confirmed)
  - D: `computeCostShape`=9, `renderVarDefineView`=2, `renderResellDefineView`=2 (+ `acquisitionType` picker confirmed)
  - E: `computeReadinessChecklist`=7, `Promote to Ready`=3, `Launch to Active`=2, `productStatusBadgeHtml`=11
  - F: `enterRevisionMode`=2, `setPendingFieldValue`=4, `cloneProductForRedesign`=2 (+ `parentProductId`/`version` UI confirmed)
  - G: `makerOpenArchiveModal`=2, `ARCHIVE_SUB_STATES`=9, `setProductDetailLens`=2 (lens toggle)

## Push

```
git push -u origin consolidation/product-lifecycle-A-through-G
→ [new branch] consolidation/product-lifecycle-A-through-G
PR URL: https://github.com/stewartdavidp-ship-it/mast-tenant-template/pull/new/consolidation/product-lifecycle-A-through-G
```

## Deploy to sgtest15

```
mast_hosting deploy
  tenantId: sgtest15
  branch: consolidation/product-lifecycle-A-through-G
→ versionName: sites/mast-sgtest15/versions/bf55d912e9517e94
  filesTotal: 164, filesUploaded: 7, filesCached: 157
  url: https://mast-sgtest15.web.app
```

Smoke-check on deployed site:

- `curl -sI https://mast-sgtest15.web.app/app/` → HTTP 200 OK
- `curl -s https://mast-sgtest15.web.app/app/modules/maker.js | grep -c "computeCostShape\|enterRevisionMode\|makerOpenArchiveModal\|developCreateNewProduct\|computeReadinessChecklist"` → 19 (threshold > 5).

## Migration `--commit` on sgtest15

```
cd /Users/davidstewart/Developer/mast-architecture
python3 scripts/migrate-products-to-lifecycle.py --tenant-id sgtest15 --commit
```

Result (full log: `/tmp/migrate-sgtest15-commit.log`):

```
Product Lifecycle migration (COMMIT)
Project: mast-platform-prod

=== Tenant: sgtest15 ===
Collection: tenants/sgtest15/products
  Total products: 46
  Updated: 46
  Skipped (already migrated): 0
  Status before: {'active': 43, 'archived': 2, 'draft': 1}
  Status after:  {'active': 43, 'archived': 2, 'draft': 1}

=== Summary ===
  sgtest15  total=46  updated=46  skipped=0
  GRAND TOTAL  total=46  updated=46  skipped=0
```

All 46 products successfully patched. Status distribution preserved. Sample reverse-verification on `-Ooa73tAu0_Td0B35h0s` ('Solid Sculptured Cardinal') via Firestore REST:

```json
{
  "status":            "active",
  "acquisitionType":   "build",
  "version":           1,
  "parentProductId":   null,
  "archivedSubState":  null,
  "hasPendingRevision": false,
  "readinessChecklist": {
    "defined": false, "costed": true, "channeled": false,
    "capacityPlanned": false, "listingReady": true
  }
}
```

### Migration script idempotency note

A second dry-run after the commit reports `would_update=46` rather than 0. Cause is cosmetic: `build_updates()`'s `need()` predicate writes a field when `product.get(field) is None`, so fields that legitimately default to `null` (e.g., `archivedSubState`, `pendingChanges`, `parentProductId`, `promotedToReadyAt`, `archivedAt`, `returnsAcceptedUntil`, `retiredAt`, `pendingChangesUpdatedAt`) re-trigger no-op `null → null` writes. The data is migrated correctly. Recommend tightening `need()` to skip when `field IN product` (regardless of value) before re-running on production tenants — minor; not blocking.

## Smoke-test checklist (post-deploy + post-migration)

Cannot drive the UI from this control session (Chrome MCP not active; control session sweep deferred per `feedback_chrome_ui_verification.md`). Surface-level (curl/Firestore) checks:

- [x] sgtest15 deployed at version `bf55d912e9517e94`, HTTP 200.
- [x] Deployed `app/modules/maker.js` contains all key symbols from D/E/F/G (19 hits across 5 sentinel terms).
- [x] Sidebar source has `>Develop<` (B rename landed) — verified in committed `app/index.html:5083`.
- [x] `MODULE_REGISTRY.make.name === 'Develop'` — verified at `app/index.html:10484`.
- [x] `develop-products` route registered in ROUTE_MAP (verified line 13878) with `setProductsViewMode('develop')` setup hook.
- [x] All 46 sgtest15 products carry new lifecycle fields (sample-confirmed via Firestore REST).
- [ ] **DEFERRED to control session / Chrome MCP sweep:** sidebar visually shows "Develop"; "+ New Product" button shows acquisition-mode picker; product detail status badge visible; lens toggle (Develop/Catalog) functional; no console errors during a Develop+Catalog navigation pass. Per `feedback_chrome_ui_verification.md`, UI verification is a Done criterion that must be exercised before Russell receives the build.

## Outstanding OPENs (carried forward)

From plan + checkpoint logs:

- **O1** — Shopify/Etsy/Square channel sync semantics for `selling-through` (clearance flag mapping). Per-channel mapping decisions still pending.
- **O2** — Resell mode inventory tracking parity vs simpler stock-on-hand without lot tracking. Default: parity (current code).
- **O3** — When parentProduct is Active and child v2 launches, parent auto-archive vs stay Active. Default: stay Active + show "v2 available" banner (G implements).
- **O4** — VAR labor capture richness (D currently parity with Build).
- **O5** — Orphan recipes UI surface implemented (C), no auto-fix logic — manual create-stub only.
- **O-G1** — Platform-level unpublish callable for `returns-only` sub-state. Currently records intent in `__mastChannelSyncIntents` only (G).
- **O-E2** — Channel-sync hook contract (E) for status changes. Wired to existing publish callable; broader cross-channel hook still pending.
- **Migration script idempotency** (new, this consolidation) — `need()` predicate cosmetics. Not blocking; trivial fix when a maintainer is in the script next.

## Recommended next step

Russell verifies the consolidated build on `https://mast-sgtest15.web.app/app/` — full Develop + Catalog navigation pass, create-product across all three acquisition modes, take a draft → ready → active → archive walk, exercise revision + clone flows. **If clean: proceed to deploy `consolidation/product-lifecycle-A-through-G` to `russelljonesjewelry`** (single tenant, gated user signoff). **If Russell signs off there: deploy_all to remaining four production tenants** in a single sequenced session (per `feedback_consolidation_before_deploy.md`).

Do **NOT** deploy to russelljonesjewelry, do **NOT** run `deploy_all`, and do **NOT** run `--commit` on any other tenant from this session — explicit user gate required for each.

## Hard-rule compliance

- Existing branches A through G left intact on remote (history preserved).
- Did not deploy to russelljonesjewelry.
- Did not run `mast_hosting deploy_all`.
- Did not run `--commit` on any tenant other than sgtest15.
- No `--no-verify`, `--force`, no skipped pre-commit hooks.
- Worktree `/Users/davidstewart/Downloads/mast-tenant-template-wt-consolidation/` left in place for inspection.
