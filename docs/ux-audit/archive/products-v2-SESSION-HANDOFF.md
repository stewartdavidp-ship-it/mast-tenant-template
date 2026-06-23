# products-v2 — SESSION HANDOFF & RESET (2026-06-05)

> **Operator directive (verbatim intent):** *"The basic model is sound — the list, the
> slide-out, the types of surfaces. But the implementation below that needs to be vetted
> more. Start a new session with a full code review so I can have a conversation on the
> current design and what's missing from my expectations."*

## ⛔ FOR THE NEXT SESSION — START HERE

1. **Do NOT build anything.** The previous run rushed from design into building before the
   engine's process model was actually nailed, then patched surfaces instead of fixing the
   foundation. Reset: **work the engine out properly, ratify it, *then* build.**
2. **Start with a FULL CODE REVIEW** of the engine + process model + reference surfaces
   (file map in §4). Present the *current* design and implementation **honestly** — what it
   actually does today, not what the mock intended.
3. **Then let the operator drive a design conversation** ("current design vs my
   expectations"). Don't propose fixes until they've told you what they're looking for.
4. The product surface (`#products-v2`) is **flag-gated and off the default path** — it costs
   nothing parked. No real users see it. Leave it; don't rip it out.

---

## 1. What's RATIFIED (sound — keep)

- **Producer → presenter:** a **list** (or other producer) produces objects; a **slide-out**
  presents ONE object. (doc 17 §13)
- **Surface-type gradient:** Flat Record → Faceted Record → Process. Pick per the §1a test
  (governed gated lifecycle = Process; derived/tagged status = Faceted).
- **Products IA (operator-ratified, mock `products-v2-mock.html`):**
  - Products is the most complex object = **process × variants × sub-objects**.
  - **Variants live in the LIST** (expand a product → synthetic **Default** + variants +
    "Add variant"). SO presents ONE object: the Default/product OR a single variant.
  - **Default = base values; variants inherit/override** (legacy `getProductVariantsForRender`
    + `variantCostAndPrice` resolution order; overrides recipe-keyed for cost).
  - **Default/product SO = process + the tab flow** (pricing/recipe/inventory/channels/image/
    info); **variant SO = the same tabs, inherit/override, NO process** (follows the product).
  - **Complex sub-objects (recipe, inventory) edit in their OWN stacked SO** — tab summary →
    drill → Back collapses to the calling tab (engine `MastEntity.drill`/`back`).
  - **Lifecycle = MastFlow `productsWorkflow`** (hard gates); retire the divergent core-shell
    soft-warning stage panel.
  - **Goal = REPLACEMENT.** Everything → V2; legacy retires. Temp legacy deep-links = tracked
    debt, hard-gated before publish ("going half in looks unprofessional").

## 2. What's NOT vetted — THE OPEN ISSUES (the implementation below the model)

This is the heart of the reset. The model is fine; **these implementation details are what the
operator wants vetted at the engine level** (they affect orders + commissions too, not just products):

1. **The engine process header (`MastFlow.renderHeader`) is crude vs the ratified mock.**
   - File: `app/modules/workflows/workflow-engine.js` (`renderHeader`, ~L558–885).
   - It renders: stepper + a redundant **"CURRENT PHASE: X"** label + readiness checklist +
     an **Advance/Back BUTTON**. Heavy, takes a lot of real estate, low context.
   - Operator's explicit asks: **"the process is a click — you don't need a button to
     progress"** (click a step to advance, not a button), and **"don't take up this much real
     estate with no context"** (lean it down).
   - This is the same header on orders + commissions (live since Phase 2, #107/#140). It
     **never matched the polished mock** (`process-slideout-mock-hybrid.html`) — documented
     polish debt, never closed. The operator remembers the *mock*; the engine never got there.
2. **Process placement inconsistency.** orders/commissions put the header *inside a "Process"
   tab* (transaction template, `renderTransaction` in `shared/mast-entity.js` ~L266–305).
   products-v2 P3 put it as an *always-visible band above the tabs* — heavier, worst on an
   Active product (no checklist → mostly-empty band). **Decide: tab vs band vs a lean pinned
   stepper** — at the engine level, consistently.
3. **Dark-mode `.btn-primary` contrast bug (GLOBAL, pre-existing, real).**
   - `app/index.html:3269` → `body.dark-mode .btn-primary { background:#d4a053; color:var(--charcoal); }`
   - In dark mode `--charcoal` resolves to **gray `#888`** → **gray text on the amber
     button** everywhere in dark mode (incl. orders' Advance button). One-line fix (a genuinely
     dark text color), but it's global → light+dark visual review. NOT a products regression.
4. **The products-v2 LIST is hand-rolled, not the engine list.** It uses a custom `pv2-*`
   grid + a module-local `<style>` block instead of `MastUI.list`/`MastEntity.renderList`
   (the table every other surface uses). **Right fix = extend `MastUI.list` to support the
   variant expansion** (Default + variants + add-variant sub-rows), backward-compatible +
   tested — build-plan decision #3, done properly. Also a couple of slide-out bits (the
   inherit/override rows `pv2-inh`, the BOM table `pv2-bom`) are custom and should use engine
   primitives (`relatedTable`/`cardTable`, maybe a new `inheritRow` primitive).

## 3. What's BUILT & LIVE on sgtest15 (don't lose this — all merged to `main`)

Flag-gated `#products-v2` (+ `MAST_V2_ROUTE_MAP` Legacy-UI-off preview). All born-0, live-verified.
| PR | What |
|----|------|
| #180/#181 | P0a — `app/modules/products-v2.js` list + read SO. **Data: `MastDB.products.get()` is a keyed map**, not an array (the #181 fix). |
| #182 | route-map wire (Legacy-UI-off preview; GA flip still deferred). |
| #183 | P0b — variant-expanding list (Default+variants+Add-variant) + `product-variant-v2` entity. |
| #184 | P1 — Default SO read stepper + Process readiness + 7-tab flow. *(Superseded by P3.)* |
| #185 | P2 — tabbed variant SO + **`recipe-v2` stacked drill SO** (real BOM/cost from `admin/recipes`). |
| #187 | P3 — switched Default SO to the **engine MastFlow process model** (`detail.flow='products'` + `flowModule='productsWorkflow'`); removed the hand-rolled stepper; added the additive engine hook **`detail.onFlowAdvance`** in `shared/mast-entity.js` `_flowRender` (mirrors `detail.onFlowTarget`) so a schema can route Advance to the side-effect-bearing legacy promote/launch (incl. Shopify publish). orders/commissions unaffected (no hook). |

**Still TODO (the WRITE phase — not started):** real Advance is wired but untested (needs a
draft product / supervised publish); variant overrides, add-variant, native recipe editing are
toasts/temp-links. The recipe builder + image manager are the remaining temp-link debt.

## 4. FULL CODE REVIEW — what to read (for the next session)

**The engine (the foundation to vet):**
- `shared/mast-ui.js` — primitives: `list` (the flat table — no expansion), `tiles`, `card`,
  `kv`, `badge`, `paneTabsBar`/`panelTab` (tab switching), `stickyHead`, `relatedTable`,
  `cardTable`, `slideOut`. (This is what "engine-first" means — surfaces compose these.)
- `shared/mast-entity.js` — `MastEntity.define`, list rendering, `renderDetail`, the
  `transaction`/`party` templates, the custom `detail.render`/`editRender` hooks (#114), the
  MastFlow integration (`_initEntityFlow`/`_flowRender`/`_flowTransition`, the new
  `onFlowAdvance`/existing `onFlowTarget` hooks), `drill`/`back` (the stacked-SO mechanism),
  `openRecord`, `recordTitle`.
- `app/modules/workflows/workflow-engine.js` — **`MastFlow.renderHeader`** (THE process
  header — the contentious piece), `evaluate`, `transition`, the spec model.
- `app/modules/workflows/products.workflow.js` / `pickship.workflow.js` / `commissions.workflow.js`
  — the MastFlow specs (phases, exit requirements/gates).

**Reference surfaces (how the model is used today):**
- `app/modules/orders-v2.js` (transaction template + `detail.flow='pickship'` — process in a tab)
- `app/modules/commissions-v2.js` (same pattern, capture deep-links)
- `app/modules/products-v2.js` (the new surface — custom list + `detail.render` + `detail.flow`)
- Legacy for parity: `app/modules/maker.js` (`renderProductDetail` is core-shell in
  `app/index.html` ~L45870; `renderVariantsSection`/`getProductVariantsForRender` ~L43859/44063;
  the readiness/promote/launch handlers ~L2990/3156/3205; the two divergent lifecycle UIs).

**Design record:** `docs/ux-audit/products-v2-mock.html` (ratified IA),
`process-slideout-mock-hybrid.html` (the process design the engine never matched),
`products-v2-build-plan.md`, `17-process-slideout-variant.md` (§1a/§2/§3/§8/§13).

## 5. Key facts & gotchas (so they aren't re-learned)

- **Data shapes:** products = keyed map at `public/products` (`MastDB.products.get()`); recipes
  `admin/recipes` (`MastDB.recipes.get(id)`); inventory `admin/inventory/{pid}/stock/{variant|_default}`.
- **Engine mechanics:** `detail.flow` set → `_initEntityFlow` fires → `MastFlow.renderHeader`
  injected into `#muFlowHost`; `panelTab` toggles `.mu-pane[data-pane]`; a lone `mu-pane`
  without the tab pair is hidden by default (use a plain `<div>`); `drill` calls the target
  entity's `fetch(id)` + pushes a back frame.
- **Lint gotchas:** `lint-ux-standards` `hardcodedHex` matches `&#9660;` numeric entities (use
  literal unicode) AND `#180` PR refs (write "PR 180"). `lint-design-tokens` gates on the
  **font 7-step scale** (0.72/0.78/0.85/0.9/1.0/1.15/1.6) — not hex (advisory there). `#000` in
  a module trips hex (use `color-mix(...,black ...)`). app/modules/* is scanned; index.html +
  shared/ are exempt.
- **Ops:** dev is frictionless (merge → CI deploys `mast-tenant-shared`/sgtest15 in ~1 min).
  `gh run list --limit 1` races the deploy-trigger after merge — poll the worker for the
  expected `MAST_MODULES_V`. Control-Chrome `execute_javascript` is content-script isolated
  (inspect the DOM, can't call page globals). sgtest15 admin session logs out / serves stale
  cache intermittently — hard-reload with a fresh `&cb=`.
