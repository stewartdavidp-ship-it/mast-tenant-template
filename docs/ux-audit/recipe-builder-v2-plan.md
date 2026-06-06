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
