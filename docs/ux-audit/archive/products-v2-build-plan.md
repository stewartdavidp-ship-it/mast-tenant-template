# products-v2 — Build Plan

Status: **READ page built & live on sgtest15** (P0a–P2). Flag-gated `#products-v2` + Legacy-UI-off route map. Editing (P3–P5, the write phase) deliberately left for a supervised session.

### Progress (2026-06-05)
- ✅ **P0a** list + read SO (PR 180 / 181 — data reads `MastDB.products.get()` keyed map)
- ✅ route-map wire (PR 182 — Legacy-UI-off preview; GA flip still P5)
- ✅ **P0b** variant-expanding list (Default + variants + Add-variant) + `product-variant-v2` SO (PR 183)
- ✅ **P1** Default SO: read lifecycle stepper + Process readiness + 7-tab flow on real data (PR 184)
- ✅ **P2** tabbed variant SO + `recipe-v2` stacked drill SO (real BOM/cost) (PR 185)
- ⬜ **P3** edit-in-V2 via `MakerProductBridge` + real Advance (`detail.onFlowAdvance` engine hook → `makerPromoteToReady`/`makerLaunchToActive`, incl. Shopify publish) + native recipe edit (clears recipe temp-link)
- ⬜ **P4** add-variant write + per-variant overrides · ⬜ **P5** Revising loop, flip default, retire legacy

Everything in the live surface is **read**; every edit affordance is a toast or a temp legacy deep-link (debt register below). The write phase touches the shared engine + maker.js — supervised work.

## The ratified model (one paragraph)

The product is the composition of three independently-complex systems: **process** (governed lifecycle), the **variant model** (Default + per-variant inherit/override), and the **sub-objects** (recipe, pricing, inventory — each first-class, existing per variant). In the list/SO model:

- **List** = products, expandable to show their **Default** (synthetic base row) + variants inline, plus **＋ Add variant** (inherits the Default, then override).
- **Slide-out presents ONE object.**
  - **Default / no-variant product SO** = the **process** (MastFlow stepper + the current stage's to-dos, which deep-link into the tabs) **+ the tab flow** (Pricing · Recipe · Inventory · Channels · Image · Info) where the work happens.
  - **Variant SO** = the same tabs (Pricing · Recipe · Channels · Inventory · Image), each **inherited from Default with override**. **No process** — a variant follows the product's lifecycle; it's just sorting out that variant's details.

## Architectural decisions

1. **Lifecycle standardizes on MastFlow `productsWorkflow`** (the hard-gated engine path; spec + manifest already exist). **Retire the divergent soft-warning stage panel** (`_renderProductStagePanel`/`_evaluateProductReadiness`/`promoteProductStage`) over time — that duplication is exactly the "no single standard" V1 problem. Draft → Review(`ready`) → Published(`active`) → Archived; **Revising** (active + `hasPendingRevision`) is a later phase.
2. **Default = synthetic first row** (`{id:'default', _isSynthetic:true}`, `getProductVariantsForRender`), holds product-level base values; real variants inherit. Overrides are recipe-keyed (`recipe.variants[id]`) for cost, plus per-variant price/image/SKU/inventory. Resolution order: variant override → recipe base → product fallback → derived markup×cost (`variantCostAndPrice`).
3. **Everything in V2 — no bounce to legacy.** Editing happens in the SO. To avoid forking the heavy logic (recipe append, dual-basis cost, dirty-recompute, channel publish, stage transitions with their side-effects), v2 **delegates through additive `window.Maker*Bridge`s in maker.js** (the proven `MakerMaterialsBridge` pattern). This **does touch maker.js** — additively only — which is the accepted cost of retiring its screens.
4. **Engine-first, lint-enforced.** No hand-rolled chrome — call `MastUI` primitives or **extend a primitive + add a test**. The complex pieces below become reusable engine primitives, not bespoke product markup.
5. **Temp deep-links are scaffolding, NOT shippable (operator-ratified).** The big legacy editors (recipe builder, image manager) may be deep-linked during P0–P4 to ship the surface faster — but each temp link is **tracked debt**, marked "to migrate" in the UI and listed in the debt register below. **P5 publish (flip `#products` to v2, retire legacy) is HARD-BLOCKED until every temp link is converted to native V2.** A published v2 that bounces to a legacy editor is the "half-in" we're explicitly avoiding.

6. **Complex sub-objects edit in their own stacked SO (operator-ratified).** A tab shows a **summary** of its sub-object (recipe, inventory, pricing). "Edit" opens that sub-object in its **own full-size slide-out** stacked over the parent; closing **collapses back into the calling tab** (parent unchanged underneath). Each sub-object is itself object→SO, so this reuses the engine's panel-stack drill (`MastEntity.drill` / `_panelStack`). **This is the native-V2 target that retires the recipe/inventory temp deep-links** — the recipe builder becomes a `recipe-v2` stacked SO, not a legacy bounce.

### Temp-link debt register (must be empty before P5 publish)
- [ ] Recipe builder (`makerOpenRecipeBuilder`) → native V2 recipe editing in the Recipe tab
- [ ] Image / listing manager (`toggleProductImagesPanel` / inline images panel) → native V2 in the Image tab
- [ ] _(append any other deep-link added during P0–P4)_

## Engine work (shared/, each additive + unit-tested)

- **`MastUI.variantList` / expandable list rows** — the list control that renders a product with an inline, expandable Default+variants group + an "add variant" affordance. Likely an extension to `renderList` or a thin new control.
- **`MastUI.inheritRow({label, value, source, overridden, onOverrideFnName})`** — the "inherited from Default · [Override]" row used across every variant tab.
- **`detail.onFlowAdvance(targetPhaseKey, record)`** — additive hook on the entity flow (mast-entity `_flowRender`), mirroring the existing `onFlowTarget`. Lets products route Advance to the real side-effect-bearing `makerPromoteToReady`/`makerLaunchToActive` (incl. the Shopify publish) instead of the generic `MastFlow.transition`.
- **Stage→tab linkage** — extend `_flowGoTarget`/`onFlowTarget` so a readiness "Go →" switches the v2 product **tab** (not just a transaction pane). The Default SO's stage to-dos drive this.
- **Variant matrix** (multi-option Color×Size) — later; single-option list ships first.

## maker.js delegation bridge (additive, single-sourced)

`window.MakerProductBridge = { createVariant, setVariantOverride, clearVariantOverride, updateDefault, … }` plus the already-exposed `makerPromoteToReady` / `makerLaunchToActive` / `makerOpenRecipeBuilder`. v2 owns the UI; the bridge runs the proven logic. No behavior change to legacy.

## Phased build (each flag-gated `#products-v2`, born-0 lints, `node --check` inline script after any index.html edit, bump `MAST_MODULES_V`, live-verify on sgtest15)

- **P0 — List + variant IA (read).** `app/modules/products-v2.js`; list with Default+variants inline + Add-variant affordance; SO opens the right object (read-only). Proves the IA on real data.
- **P1 — Default SO: process + tab flow (read).** Compose `detail.flow='products'` MastFlow header (stepper + stage to-dos) + the six read tabs; stage→tab linkage.
- **P2 — Variant SO: inherit/override (read).** Five tabs with `inheritRow`s + override indicators; resolution order honored.
- **P3 — Editing in V2 (write) via bridges.** `MakerProductBridge`; wire Edit/Override; Advance via `onFlowAdvance` → real promote/launch (Shopify publish fires). Verify writes on a dev product.
- **P4 — Add variant from Default + per-variant overrides (write).** Create-from-Default flow; per-variant price/image/recipe/inventory overrides.
- **P5 — Parity, Revising loop, retire legacy.** The Revising staged-edit loop; flip `#products` to the v2 twin via `MAST_V2_ROUTE_MAP`; retire `renderProductDetail`/`renderVariantsSection`/stage panel.

## Guardrails

Fresh worktree off `origin/main` (`feat/products-v2-process`); unique entity key (`products-v2` confirmed free); `MAST_V2_ROUTE_MAP` (`products: 'products-v2'`); regenerate `docs/generated/admin-inventory.md`; `node test/mast-*.test.js`; verify through `sgtest15.runmast.com/app/?ui=1&cb=<tok>#products-v2`.

## Open decisions for operator

1. ~~Edit-in-SO vs deep-link during transition.~~ **RESOLVED:** temp deep-links OK to ship faster, but tracked debt — **must be converted before V2 publish** (see decision 5 + debt register).
2. **Revising loop** — P5 (after parity), or pulled earlier?
3. **List control** — extend `MastUI.renderList` for variant expansion, or a product-specific control? (Affects reuse.)
