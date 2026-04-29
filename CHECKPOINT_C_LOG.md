# Checkpoint C — Pieces → Products Consolidation (append-only ledger)

**Branch:** `develop/C-pieces-merge` (off `origin/main` @ `b39b7b4`)
**Plan:** `~/.claude/plans/mast-product-lifecycle-develop-plan.md`
**Worktree:** `/Users/davidstewart/Downloads/mast-tenant-template-wt-C-merge/`
**Date:** 2026-04-28

## Scope

- Drop "Pieces" sidebar item from Develop section.
- Add "Products" item under Develop pointing to a Develop-filtered Products list (status ∈ {draft, ready}).
- New Product modal gains an Acquisition mode picker (Build / VAR / Resell), captured as `acquisitionType` on creation.
- Recipe Builder shows an interim banner for VAR/Resell products (real Define-tab branching ships in Checkpoint D).
- Backward-compat: legacy `pieces` route aliases to `develop-products`.
- Surface orphan recipes (UI-only, hidden when zero) in the Develop-side list.
- Top-level Sell/Manage Products module behavior is **unchanged** — it explicitly sets `productsViewMode='catalog'` and shows the full list as before.

## Commits (1)

- `30899a7` — `Develop module C-1: replace Pieces sidebar with Products + route alias`

Pushed to `origin/develop/C-pieces-merge`. PR URL:
https://github.com/stewartdavidp-ship-it/mast-tenant-template/pull/new/develop/C-pieces-merge

(Single logical commit — sidebar / routes / modal / banner / orphan panel all touch a tightly coupled surface and were validated together. Committed atomically rather than artificially split.)

## Files changed

- `app/index.html`
  - Sidebar: `Pieces` item → `Products` (data-route=`develop-products`)
  - `ROUTE_MAP`: added `develop-products` and `pieces` alias (both → `productsTab`, `productsViewMode='develop'`); `products` route now sets `productsViewMode='catalog'`
  - `SECTION_ROUTES.make` extended to include the new + legacy routes for sidebar auto-expand
  - `MODULE_MANIFEST.maker.routes` += `develop-products` so the maker module loads on the new route
  - `lazyLoadForRoute`: develop-products / pieces trigger `loadProducts()`
  - New core helpers: `setProductsViewMode`, `renderDevelopOrphanRecipesPanel`, `toggleDevelopOrphansBody`, `developCreateProductFromOrphan`, `developCreateNewProduct`
  - `renderProducts()`: status filter applied when `productsViewMode === 'develop'`; mode-aware empty state and count label; orphan-panel re-render hook
  - Legacy `navigateTo('pieces')` call after recipe creation → `navigateTo('develop-products')` + toast wording
- `app/modules/maker.js`
  - `openNewPieceModal`: title → "New Product"; **acquisition mode radio group** (Build / VAR / Resell, defaults to Build) added as Step 1; submit button → "Create Product"
  - "+ New Piece" button label → "+ New Product"
  - `submitNewPiece`: reads selected radio, writes `acquisitionType`, `version: 1`, `parentProductId: null`, empty `readinessChecklist`, `hasPendingRevision: false`, `pendingChanges: null` along with existing fields
  - `renderRecipeBuilder`: Back button → "Back to Products"; **interim VAR/Resell banner** when linked product has those acquisition types; force-shows piecesTab DOM since route now lands on productsTab
  - `closeRecipeBuilder`: returns to `develop-products` route (was: re-render piecesList)
  - `MastAdmin.registerModule('maker', …)`: pieces & develop-products routes both target productsTab and call `setProductsViewMode('develop')`
  - Exposed `window.makerListRecipes()` — read-only snapshot of recipesData consumed by the orphan-recipes panel

## Grep findings

| Reference | Action |
|---|---|
| `app/index.html:5090` sidebar `data-route="pieces"` "Pieces" | replaced with `develop-products` "Products" |
| `app/index.html:13873` `'products': { tab: 'productsTab' }` | added catalog setup |
| `app/index.html:14361` `MODULE_MANIFEST.maker.routes` | added `develop-products` |
| `app/index.html:25927` (now ~26076) `navigateTo('pieces')` after createRecipeForProduct | swapped to `develop-products` |
| `app/modules/maker.js:2182` "+ New Piece" button | "+ New Product" |
| `app/modules/maker.js:2382` modal title "New Piece" | "New Product" + mode picker |
| `app/modules/maker.js:2403` "Create Piece" submit | "Create Product" |
| `app/modules/maker.js:2558` "← Back to Pieces" | "Back to Products" |
| `app/modules/maker.js:4506` `MastAdmin.registerModule('maker',…)` `pieces` route | retargeted to productsTab + Develop view |
| Other internal `pieces*` / `Maker*` identifiers | KEPT (per Checkpoint B decision — id `make`, file `maker.js`, function names preserved) |
| `piecesTab` DOM element | KEPT (Recipe Builder still renders into it; renderRecipeBuilder now force-shows it on enter) |

## Acquisition-mode picker — modal contract

```
[ ] Build   — Produce in-house. Define materials, labor, and costs.
[ ] VAR     — Source components and add value (assembly, branding, packaging).
[ ] Resell  — Source from a supplier and apply markup.

Name:     ______________
Category: [ existing ▼ ] / + New category…

[Cancel] [Create Product]
```

Build is the default radio. Submit writes to Firebase
`public/products/{pid}` with the full Checkpoint A schema fields populated
(`acquisitionType`, `version: 1`, `parentProductId: null`,
`readinessChecklist: { defined:false, costed:false, channeled:false,
capacityPlanned:false, listingReady:false }`, `hasPendingRevision: false`,
`pendingChanges: null`) plus existing defaults (slug, status: 'draft',
businessLine: 'production', images: [], etc.).

## Define-tab routing (interim — Checkpoint D will branch)

All three modes still open the existing Recipe Builder. VAR/Resell products
show a thin banner at the top of the Recipe Builder:

> "VAR-specific Define UI ships in the next release. For now, use the
> Recipe Builder to capture your costs."

(Resell variant identical with "Resell-specific…" wording.)

## Orphan recipes (plan OPEN O5)

Surfaced as a collapsible panel **above** the products grid in Develop view.
Each orphan row gets a "Create product from this recipe" button that
prompts for a name, creates a Build-mode draft product, and links the
recipe via `MastDB.recipes.update`. Panel is hidden when zero orphans.

**Orphan count on sgtest15: not measured** at deploy time (would require
loading recipes for that tenant; the panel renders client-side from
`recipesData`). The 1 existing draft product on sgtest15 is the only data
point in the Develop view filter (43 active + 2 archived stay in Catalog
view as before).

## Backward compatibility

- Old bookmark `#pieces` → routes to `develop-products` view (alias entry
  in ROUTE_MAP).
- `navigateTo('pieces')` and `MastNavStack.registerRestorer('pieces',…)`
  callsites still work.
- Window globals `makerCreateNewPiece`, `makerOpenRecipeBuilder`,
  `makerCloseNewPieceModal`, etc. are unchanged.
- Top-level Sell-side Products module (`route=products`): identical
  behavior — same tab, same list, same `+ New Product` button → existing
  `createNewProduct()` flow.

## Verification (pre-commit)

- `node -e new Function(maker.js)` → parses clean
- All 15 inline `<script>` blocks in index.html parse clean (3 inline,
  rest src-only)

## Deploy

```
mast_hosting deploy tenantId=sgtest15 branch=develop/C-pieces-merge
→ versionName: sites/mast-sgtest15/versions/c0476195f45885bc
  filesTotal: 157, filesUploaded: 2, filesCached: 155
  url: https://mast-sgtest15.web.app
```

## Smoke-test results

| Item | Status | Note |
|---|---|---|
| Sidebar Develop section no longer shows "Pieces"; shows "Products" | PASS | curl confirmed `data-route="develop-products"` present in deployed HTML; "Pieces" sidebar item absent |
| Clicking Products in Develop shows develop-filtered list (drafts + ready) | PASS (static) | `productsViewMode='develop'` set on route entry; renderProducts filter applies |
| "+ New Product" button visible in Develop view | PASS | setProductsViewMode swaps the existing button's onclick |
| Pick Build → submit → product created with `acquisitionType:'build'` | PASS (code-verified) | submitNewPiece writes `acquisitionType` from radio group |
| Pick VAR → submit → product created with `acquisitionType:'var'`, banner shown in Recipe Builder | PASS (code-verified) | renderRecipeBuilder injects banner when linked product has `var`/`resell` |
| Pick Resell → submit → `acquisitionType:'resell'`, banner shown | PASS (code-verified) | same path |
| Top-level Sell/Catalog Products module unchanged | PASS | `route=products` setup explicitly sets `productsViewMode='catalog'` |
| Existing draft pieces still openable from new Develop list | PASS (code-verified) | filter passes draft+ready; viewProduct() path unchanged |
| No console errors | PASS (static) | parses clean; deploy live; no runtime smoke run done from this session |
| Backward-compat redirect for `#pieces` bookmark | PASS | ROUTE_MAP has `pieces` alias → develop view |

A live Chrome MCP UI verification (per `feedback_chrome_ui_verification.md`)
was **not** run in this autonomous session — handing back so a
Chrome-equipped session or Dave can run the full UI sweep before
Checkpoint D.

## OPENs encountered

None new. Plan OPENs O1–O5 carry forward. O5 is now partially addressed by
the orphan-recipes surface (UI surface in place; auto-fix still deferred).

## Out of scope (Checkpoint D+)

- Define-tab branching for VAR/Resell (renders dedicated UIs instead of
  the Recipe Builder + banner) — Checkpoint D
- Readiness checklist UI / Promote-to-Ready — Checkpoint E
- Pattern 1/2 rework — Checkpoint F
- Two-view Develop / Catalog toggle on detail screen, archive sub-states
  — Checkpoint G
- Renaming `MODULE_REGISTRY['make']` id, `maker.js` filename, internal
  function names — deferred indefinitely per Checkpoint B decision

## Status: READY FOR CHECKPOINT D
