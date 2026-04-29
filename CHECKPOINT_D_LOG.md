# Checkpoint D — Acquisition Mode Branching

**Branch:** `develop/D-acquisition-modes`
**Worktree:** `/Users/davidstewart/Downloads/mast-tenant-template-wt-D-modes`
**Branched from:** `origin/main` (NOT from C — keeps checkpoints independently mergeable per spawn discipline). When C merges first, the interim "VAR-specific Define UI ships next release" banner from C is naturally replaced by D's real branched UI: D adds `makerOpenDefineForProduct(pid)` plus row-click routing, so any caller code that lands the user on the recipe builder for a VAR/Resell product is superseded.

## Goal

Define tab branches by `acquisitionType` (`build` / `var` / `resell`). All three modes feed a uniform downstream **costShape** (`materialCost`, `laborCost`, `otherCost`, `totalCost` in cents) on the Product record so the Costs tab and pricing logic remain mode-agnostic.

## Scope changes

All changes in `app/modules/maker.js`. Single-file admin module; no new files (per template architecture rule).

### 1. computeCostShape(product, recipe) — uniform interface

- **Build:** decomposes the linked recipe's `totalCost` / `totalMaterialCost` / `laborCost` / `perUnitSetup` and rounds to cents. `otherCost = (totalCost - material - labor - setup)` (clamped ≥0) plus `setupCost`.
- **VAR:** sums `defineSpec.var.components[*]` (qty × (1+scrap%) × unitCost) → materialCost. Sums `valueAddSteps[*].laborMinutes` × labor rate → laborCost. Sums `valueAddSteps[*].otherCost` → otherCost.
- **Resell:** `materialCost = supplier.unitCost × 100`. `laborCost = 0`. `otherCost = freight + duty + storage + other` (cents). Duty supports both per-unit ($) and percent-of-unit-cost modes via `landedCost.dutyMode`.

Output is always 4 integer-cent fields.

### 2. persistCostShape(productId, costShape)

Writes `materialCost`, `laborCost`, `otherCost`, `totalCost`, `costShapeUpdatedAt` onto the Product record at `public/products/{pid}/`. Also patches `window.productsData` in-memory.

### 3. Define-tab dispatch

- New entry point `openDefineForProduct(pid)` reads `product.acquisitionType` and dispatches:
  - `build` → existing `openRecipeBuilder` / `createRecipeForProduct`
  - `var` → new VAR Define view
  - `resell` → new Resell Define view
- Module-private state: `defineState`, `defineMode`, `defineProductId`. `piecesView === 'define'` is the new render mode.
- `renderPieces()` dispatcher updated to honor the new view.

### 4. VAR Define view

- **Components** table: per-row source picker (Material link via existing materialsData OR free-text), unit cost ($), quantity, scrap %, computed subtotal. Material-linked rows auto-populate name + unitCost from materialsData.
- **Value-Add Steps** table: description, labor minutes, other cost.
- Cost Shape Summary card at top shows materialCost / laborCost / otherCost / totalCost.
- Save and Recalculate Cost buttons.

### 5. Resell Define view

- **Supplier** card: supplierName, supplierSku, unitCost ($), MOQ.
- **Landed cost** card (per unit): freight, duty (with per-unit $ vs % toggle), storage, other.
- **Lead time (days)** card.
- Same Cost Shape Summary + Save + Recalculate.

### 6. New Product modal — acquisitionType picker

Radio group at top of modal: Build (default) / VAR / Resell. `submitNewPiece()` reads the chosen mode and:
- Stores `acquisitionType` on the Product.
- Initializes `defineSpec.var` or `defineSpec.resell` skeleton when applicable.
- Sets `materialCost / laborCost / otherCost / totalCost = 0` (defaults).
- For Build: still calls `createRecipeForProduct` (legacy flow).
- For VAR/Resell: routes to `openDefineForProduct(pid)`.

Title also relabeled "New Piece" → "New Product".

### 7. Pieces list — row routing + mode badges

- Whole-row click checks `acquisitionType` and routes to `makerOpenDefineForProduct(pid)` for VAR/Resell, else legacy recipe builder.
- VAR/Resell rows show a small mode badge (`VAR` amber / `Resell` teal) next to the recipe column.
- Action button: "Edit Define" / "Define VAR" / "Define Resell" instead of "Edit Recipe" / "+ Add Recipe" for non-Build products.

### 8. Build mode — uniform costShape sync

`recalculateRecipe()` now also calls `computeCostShape(product, freshRecipe)` + `persistCostShape(productId, ...)` after writing the recipe updates, but only when the linked product is `acquisitionType === 'build'` (or unset, treated as build). VAR/Resell recipes are unaffected. Wrapped in try/catch so any failure logs but does not break the recipe save flow.

## Cost-shape extraction summary

- **Where computed:** `computeCostShape(product, recipe)` — single pure function; inputs are the Product record (for `acquisitionType` + `defineSpec`) and an optional Recipe (only used in Build mode).
- **Where persisted:** four cents fields directly on `public/products/{pid}/`: `materialCost`, `laborCost`, `otherCost`, `totalCost` + `costShapeUpdatedAt`.
- **Where read downstream:** This checkpoint does NOT modify the existing Costs/Channels tabs. They continue to read from the recipe (Build's source-of-truth) — see OPEN below.

## Schema additions on Product

New (or expected) fields on `public/products/{pid}`:

```
acquisitionType: 'build' | 'var' | 'resell'    // already present from Checkpoint A
defineSpec: {
  var?:    { components: [...], valueAddSteps: [...] },
  resell?: { supplier: {...}, landedCost: {...}, leadTimeDays: N }
}
materialCost: integer (cents)
laborCost:    integer (cents)
otherCost:    integer (cents)
totalCost:    integer (cents)
costShapeUpdatedAt: ISO timestamp
```

## OPENs hit

- **O-D1 — Costs tab does NOT yet read costShape.** Today the existing Costs/Channels logic reads `recipe.totalCost` and pricing tiers from the Recipe. For Build that's fine. For VAR/Resell there is no recipe, so downstream consumers will see no price/margin until the Costs tab is refactored to read `product.totalCost` (cents) when `acquisitionType !== 'build'`. Per checkpoint instructions this is surfaced rather than fixed in D — flagged for Checkpoint E or a follow-up. The Cost Shape Summary card on the Define view is the user-visible signal in the meantime.
- **O-D2 — VAR/Resell pricing tiers.** Build's wholesale/direct/retail multipliers live on the recipe. VAR/Resell products have no recipe by default. Either VAR/Resell needs its own markup config, or the Costs tab needs a markup config that lives on the product. Defer to E.
- **O-D3 — Build product without a recipe.** When a Build product is created via Checkpoint C's import path or pre-D rows, `recalculateRecipe` only fires after a recipe exists. Existing Build rows will not have `costShape` populated until their recipe is recalculated. Acceptable — they already work via the legacy recipe-driven Costs tab.
- **O-D4 — Material picker for VAR.** I reused `materialsData` directly (a flat list dropdown) rather than the Recipe Builder's richer `renderAddPartModal`. Sufficient for functional, not pixel-perfect.

## Test plan executed

Pre-deploy code checks:
- `node --check app/modules/maker.js` — clean.
- Hoisting verified: `computeCostShape` and `persistCostShape` are `function` declarations, called from `recalculateRecipe` (defined earlier in source); strict-mode IIFE hoisting handles this.

Post-deploy smoke test (sgtest15) — see Verification section below.

## Commits

- `e778129` — Checkpoint D — Acquisition mode branching (Build / VAR / Resell)
  - Single consolidated commit — all changes in `app/modules/maker.js` (+639 LoC, 4468 → 5107) plus `CHECKPOINT_D_LOG.md`. Logical sub-units (cost-shape extraction, VAR view, Resell view, route wiring) are interdependent within a single IIFE so commit splitting would only churn the diff.

## Deploy

- **2026-04-29T03:15:38Z** — `mast_hosting deploy` to sgtest15.
- Site: `https://mast-sgtest15.web.app`
- Version: `sites/mast-sgtest15/versions/bb2d7830e54d3b24` (FINALIZED).
- Branch: `develop/D-acquisition-modes`.
- 158 files total, 2 uploaded, 156 cached.

## Verification

- Deployed `maker.js` returns 200 and contains 16 occurrences of the new symbols (`Checkpoint D` header, `computeCostShape`, `openDefineForProduct`, `renderVarDefineView`, `renderResellDefineView`).
- App route `/app/` returns 200.
- `node --check` clean before push.
- Chrome MCP UI verification deferred (per spawn discipline note: control session may run interactive UI smoke separately) — entry path is: open Develop → Pieces → "+ New Product" → mode picker → choose VAR or Resell → submit → routes directly to the new Define view. Existing Build flow is unchanged for products with `acquisitionType === 'build'` or unset.

## Ready for Checkpoint E

Yes. No blockers. OPENs surfaced (O-D1 / O-D2 / O-D3 / O-D4) are not blocking and are the natural seams for E (Readiness Checklist) to absorb the costShape uniformly into Costs / Promote-to-Ready logic.
