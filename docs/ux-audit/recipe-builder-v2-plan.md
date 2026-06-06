# Recipe Builder → V2 — Implementation Plan

**Status:** Design plan for operator review (no code yet). The recipe builder is the **last legacy surface** on the product object; everything else (record, variants, lifecycle/process-flow, creation, capacity) is v2.
**Date:** 2026-06-06.

> Goal: replace the legacy full-page recipe builder (`renderRecipeBuilder`, ~maker.js:4805) — reached today via the "Edit in builder ↗" bounce (`openRecipeBuilderGated`, products-v2.js:370) — with a v2 drilled slide-out that follows the cornerstone standard ([standard-record-ui.md](standard-record-ui.md)).

---

## 1. The key finding that shapes this plan

**The cost engine is pure client-side JS already in `maker.js` — we reuse it, we don't reimplement it.**

- `calculateRecipe(input)` (maker.js:149–214) — pure function: lineItems + labor + costs + markups → material/labor/total cost + per-tier prices + margins. Rounds to cents.
- `recalculateRecipe(recipeId)` (maker.js:530–699) — the heavy refresh: re-resolves each line's `unitCost` from the live material (fixed or spot-linked), resolves nested sub-assembly costs (`resolveSubAssemblyCosts`, depth-3 + cycle detection), runs `calculateRecipe`, updates drift baseline + margin history, writes back, **and propagates the cost shape to the linked product + recomputes readiness**.
- Materials (`materialsData` from `admin/materials`), spot prices (`admin/spotPrices/current`), and price locks are all loaded + resolved client-side.

**Implication:** the v2 port is a **UI + thin-bridge** job. We must NOT re-derive cost/pricing/drift/propagation logic — we call the existing functions. This keeps the intricate parts (spot pricing, sub-assemblies, drift, margin history, product propagation) authoritative in one place.

## 2. Data model (recipe doc — `admin/recipes/{recipeId}`)

```
lineItems: { [liId]: { lineItemId, kind:'material'|'recipe', materialId, materialName,
                       quantity, scrapPercent, unitOfMeasure, unitCost, extendedCost } }
laborRatePerHour, laborMinutes, otherCost, otherCostNote, setupCost, batchSize
wholesaleMarkup, directMarkup, retailMarkup            // tier multipliers
wholesalePrice/directPrice/retailPrice + *GrossProfit  // computed
activePriceTier, overridePrice:{wholesale,direct,retail}, minMarginPercent
totalMaterialCost, totalCost, laborCost                 // computed
costsDirty, currentDriftPct, driftBaseline, marginHistory[], lastCalculatedAt
spotSnapshot:{gold,silver,platinum}, spotSnapshotAt
status, channels, notes, name, productId
// Variant cost shape (Phase 2d):
variantsShape:'cost', variants:{ [variantId|'default']: { lineItems, laborMinutes?, otherCost?, totalCost… } }
```
- **Variant inheritance:** the `default` slot is the root; a variant slot that omits a field inherits the default's. The builder has per-variant tabs; the v2 SO opens in a product- or variant-scoped context.
- **Sub-assemblies:** a line item with `kind:'recipe'` stores the sub-recipe id in `materialId`; cost = sub-recipe `totalCost` (no markup compounding), depth-limited to 3, cycle-checked.

## 3. Architecture — extend the existing read entity into an editable SO

V2 already has the **read** surface: `recipe-v2` drilled entity (products-v2.js:1488) renders BOM/cost/pricing, opened from `recipePane`/`variantRecipePane` via `MastEntity.drill('recipe-v2', recipeId)`. The "Edit in builder ↗" button is the only thing that leaves v2.

**Plan: turn the `recipe-v2` drill into a read-first, inline-edit SO** (the cornerstone pattern), and point "Edit" at its own panes instead of `openRecipeBuilderGated`. Tabs:

| Pane | Contents | Edit |
|---|---|---|
| **Bill of materials** | line-item list (material/sub-assembly · qty · waste% · unit cost · ext cost), "+ Add part" picker, remove | inline qty/waste edit; add/remove via bridge |
| **Labor & overhead** | labor rate + minutes, other cost + note, setup cost, batch size | inline edit form (read→edit→save, cancel-on-leave) |
| **Pricing & tiers** | tier markups (wholesale/direct/retail) → prices + margins, active-tier selector, min-margin floor | inline edit form |
| **(sticky head tiles)** | Total cost (hero) + Materials / Labor / Overhead breakdown, drift badge | read-only, recomputed on save |

"+ Add part" reuses the existing material/sub-assembly picker logic + `materialsData`, rendered via the shared `openModal` (not a rogue overlay). Variant cost-shape: the SO carries the active variant slot (default or a specific variant id) — same override-or-inherit framing already used by the variant Attributes/Fulfillment panes.

## 4. Bridge API (new `MakerProductBridge.recipe*` — wrap the persisted doc + reuse the engine)

The legacy mutators (`updateLineItemQty`, `confirmAddPart`, …) operate on the in-memory `builderState` and require the full legacy builder to be open. For v2 we add bridge methods that **read-modify-write `admin/recipes/{recipeId}` directly and then call the existing `recalculateRecipe`** (so cost/tiers/drift/propagation stay authoritative):

- `recipeGet(recipeId)` → recipe doc (rendering)
- `recipeAddLineItem(recipeId, variantKey, { kind, materialId, quantity, scrapPercent })`
- `recipeRemoveLineItem(recipeId, variantKey, liId)`
- `recipeSetLineItem(recipeId, variantKey, liId, { quantity, scrapPercent })`
- `recipeSetFields(recipeId, { laborRatePerHour, laborMinutes, otherCost, otherCostNote, setupCost, batchSize, wholesaleMarkup, directMarkup, retailMarkup, minMarginPercent, name, notes })`
- `recipeSetActiveTier(recipeId, tier)`
- `recipeRecalc(recipeId)` → `{ totalCost, tiers, marginPct… }` (wraps `recalculateRecipe`)
- `materialsForPicker()` → active materials (name, uom, unitCost) + eligible sub-recipes (cycle-filtered)

Each write ends by invoking the existing recalc so the product price propagation + readiness recompute happen exactly as they do today. (`mast_recipes` MCP — create/update/recalculate/set_active_tier/reprice — exists too, but it's out-of-app; the admin UI uses the bridge.)

## 5. Sequencing (core-first, each a shippable PR + live-verified on sgtest15)

1. **R1 — Bridge recipe-edit methods** (maker.js): the `recipe*` API above, each read-modify-write + `recalculateRecipe`. Unit-testable (cost math already covered by the pure `calculateRecipe`).
2. **R2 — BOM pane** (the heart): editable line items + "+ Add part" picker (material + sub-assembly) in the `recipe-v2` SO. This alone removes most of the legacy dependence.
3. **R3 — Labor & overhead + Pricing & tiers panes** + cost-summary tiles + drift badge.
4. **R4 — Variant cost-shape** in the SO (default slot + per-variant override-or-inherit), matching the builder's variant tabs.
5. **R5 — Flip the entry point**: `recipePane`/`variantRecipePane` "Edit" + `recipeEditInBuilder`/`variantOwnRecipe` open the v2 recipe SO; retire `openRecipeBuilderGated` + the `navigateToClassic` bounce.

## 6. Power tools — deferred (stay legacy, or later)

Out of the core port; these remain reachable via a small "Advanced ↗" legacy drill until/unless prioritized:
- **What-if metal-shift simulator** (`runMetalShiftSimulation`/`openWhatIfSimulator`) — pure-preview; a natural later v2 add.
- **Reprice-all** (`openRepriceAllModal`) — bulk op across recipes; arguably belongs on a recipes *list*, not the per-product SO.
- **Margin sparklines** (`makerSparklineSvg`) — could drop into the Pricing pane cheaply (read-only SVG) — optional R3 add-on.
- **CSV import wizard** — bulk/onboarding tool, not per-recipe edit; leave in legacy.

## 7. Risks / watch-items
- **Don't reimplement the engine.** All cost/tier/drift/propagation/readiness must go through `recalculateRecipe`. The bridge writes the inputs, then calls recalc.
- **Variant cost-shape inheritance** (default-slot fallback) is subtle — mirror the builder's `ensureVariantSlot` + materialize logic; reuse, don't reinvent.
- **Materials must be loaded** (`materialsData`) before the picker renders — gate via `ensureMaker`/loadMaterials like other v2 maker-dependent panes.
- **Spot-linked costs + price locks** resolve inside `recalculateRecipe` — reusing it gets these for free.
- **Sub-assembly recipes** (nested, depth-3, cycle-checked) are in the data model — keep them in the BOM picker; don't drop the `kind:'recipe'` path.
- **RBAC**: recipe edits gate on `products:edit` (consistent with the rest of the SO); the recipe pane already hides edit affordances when not permitted.
- **No rogue overlays / hardcoded hex / off-scale fonts** — use `openModal` + tokens (the `lint-ux-standards` gate caught a hand-rolled overlay during the creation PR).

## 8. New-surface checklist ([standard-record-ui.md](standard-record-ui.md) §9)
Entity on MastEntity ✓ (extend `recipe-v2`) · read-first panes + inline edit + cancel-on-leave · heavy picker via `openModal` · writes through the bridge (read-modify-write + recalc), not direct DB · RBAC edit-gating · no vestigial fields · bump cache-bust + regen inventory · verify on runmast.com.

## 9. Recommendation
Build **core-first** (R1–R5); defer the power tools behind a single legacy "Advanced ↗" drill. That removes the last V1 surface from the everyday recipe workflow with bounded, sequenced PRs, while the rarely-used bulk/simulation tools stay available until they earn their own v2 pass.

---

## 10. HANDOFF — status + what's left (R3, R4). READ THE CODE, not just this doc.

> ⚠️ This doc is a map, not the territory. Before writing R3/R4, **do a full code walk** of the functions cited below in the live source — they have evolved and the details matter (variant cost-shape, recompute side-effects, the cost engine). Confirm signatures/shapes against the actual files; do not trust this summary alone.

### Done + deployed (live on sgtest15)
- **R1 — bridge** (`app/modules/maker.js`): `MakerProductBridge.recipe{Get,Materials,AddLineItem,RemoveLineItem,SetLineItem,SetFields,SetActiveTier,Recalc}`. Reuses the pure cost engine. **Light-vs-full recompute split:** mutators call `_recipeLightRecompute` (totals+tier prices, NO marginHistory/drift/product-propagation); `recipeRecalc` = full `recalculateRecipe` (history + costShape→product). `ensureRecipeCtx` one-shot-loads materials+recipe.
- **R2 — editable BOM** (`app/modules/products-v2.js`): the `recipe-v2` drilled SO. `recipeEditBody(rc)` (rendered inside `#pv2RecipeBody`), `recipeAddPartFormHtml()` (INLINE picker), `rerenderRecipeBody()`, `_applyRecipeLine()`; handlers `recipeSetLineQty/Waste`, `recipeRemoveLine`, `recipeAddPart`, `recipeAddPartKind`, `recipeAddPartConfirm`, `cancelRecipeAddPart`; state `V2._recipeEdit`/`_recipeAdding`/`_recipeAddData`/`_rpKind`.

### R3 — Labor & overhead + Pricing & tiers (mostly UI; bridge already exists)
Make these editable in the same `recipe-v2` SO (currently they're read-only cards + a "Labor & pricing in builder ↗" bounce):
- **Labor & overhead**: `laborRatePerHour`, `laborMinutes`, `otherCost`, `otherCostNote`, `setupCost`, `batchSize` → `recipeSetFields`.
- **Pricing & tiers**: `wholesaleMarkup`/`directMarkup`/`retailMarkup`, `minMarginPercent` → `recipeSetFields`; active-tier selector → `recipeSetActiveTier`. Show computed tier prices + margins.
- Pattern: read-first card + inline edit (like the product Fulfillment/Info panes), re-render via `rerenderRecipeBody()`. On commit use `recipeSetFields` (light recompute); consider a final `recipeRecalc` on close/save so marginHistory + product propagation run once.
- Remove/replace the "Labor & pricing in builder ↗" button as these land.
- **Code-walk:** `recipeSetFields`/`recipeRecalc` in maker.js; `recipeEditBody` in products-v2.js; the legacy builder's labor/overhead/pricing sections `renderRecipeBuilder` (~maker.js:4805–5116) for the exact field semantics + tier display.

### R4 — Variant cost-shape (the harder one — code-walk required)
The recipe carries per-variant cost overrides: `recipe.variants[variantId] = { lineItems, laborMinutes?, otherCost?, … }` with the **default slot as inheritance root** (a variant slot omitting a field inherits default). `recalculateRecipe` only recomputes variants when `recipe.isVariantEnabled && recipe.variants` (note: there may be two variant models — `isVariantEnabled` vs `variantsShape:'cost'` — RECONCILE by reading the code).
- **R1's bridge is TOP-LEVEL only** (operates on `recipe.lineItems`). R4 must add variant-slot mutation: either extend the `recipe*` bridge methods with a `variantKey` param that writes `recipe.variants[vid].lineItems` (+ laborMinutes/otherCost), or add `recipeVariant*` methods. Ensure the recompute path covers the variant slots.
- **Code-walk (do this before coding R4):** `recalculateRecipe` variant branch (maker.js ~620–672); the legacy builder variant helpers — `hydrateVariantsIndependent`, `ensureVariantSlot`, the variant-tab rendering + push-to-all in `renderRecipeBuilder`; how the product's variants map to recipe variant slots (variant ids).
- UI: variant selector/tabs in the recipe SO mirroring how `product-variant-v2` does override-or-inherit (see the variant Attributes/Fulfillment panes for the pattern).

### R5 (after R3/R4) — retire the bounce
Flip `recipePane`/`variantRecipePane` "Edit" + `recipeEditInBuilder`/`variantOwnRecipe` to open the v2 recipe SO; retire `openRecipeBuilderGated` + the `navigateToClassic` legacy bounce. Power tools (what-if/reprice-all/import/sparklines) stay behind a single legacy "Advanced ↗" until separately prioritized.

### Gotchas learned in R1/R2 (don't rediscover the hard way)
- **`MastDB.recipes.subRef` does NOT exist** — the legacy `addLineItem`/`removeLineItem` (~maker.js:704/727) use it and are BROKEN; don't reuse them. Write the whole `lineItems` map via `MastDB.recipes.update` (Firestore **replaces** map fields on update → removals drop cleanly) — `_recipeLightRecompute` already does this.
- **`openModal` is OCCLUDED behind a drilled slide-out** (z-index). Inside the recipe SO, render pickers/forms **inline** (R2's `recipeAddPartFormHtml`), never `openModal`.
- **Recipes are in Firestore** (`MastDB.recipes.*` → Firestore). `update({field: map})` replaces the field.
- Don't spam `marginHistory` — keep the light/full recompute split.

### Workflow (every change)
- Own git worktree + feature branch off **freshly-fetched** `origin/main` (it moves between PRs; rebase if you fall behind — GitHub skips PR checks while `CONFLICTING/DIRTY`). Never the shared checkout; never `git push origin main`.
- Any `app/index.html` or `app/modules/*.js` change → **bump** `MAST_MODULES_V` (`./scripts/bump-modules-version.sh`) and **regen** `docs/generated/admin-inventory.md` (`node scripts/gen-inventory.mjs`).
- `node --check` + lints (esp. `lint-ux-standards`: no rogue overlays, no hardcoded hex — incl. `#abc` in comments, font-sizes only in the 7-scale 0.72/0.78/0.85/0.9/1.0/1.15/1.6).
- PR → merge on green (lint + docs-inventory checks) → CI auto-deploys dev → **verify on `https://sgtest15.runmast.com/app/?cb=<n>#products-v2`** (a fresh `?cb=` busts the CF/SW-masked `index.html`; hard-reload alone is NOT enough).
- **e2e verify in the admin** (Chrome, already logged in): Glass Pumpkin `pid -Ooa73tvVjatyMVxv6RG`, `recipeId VaDiWzppHUF9bQmev8K0` → product SO → Recipe tab → "Open recipe →" → the recipe-v2 SO. Test reversibly; leave data clean. RBAC: editing gates on `products:edit`.
- Tenant MCP (`mast_recipes`, `mast_products`, tenantId `sgtest15`) is available to inspect/seed; recipe writes in-app go through the bridge, not the MCP.
