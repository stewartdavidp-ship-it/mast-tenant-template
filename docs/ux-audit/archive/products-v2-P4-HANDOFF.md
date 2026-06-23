# products-v2 — P4 (Edit/Write Phase) Handoff

**Status as of 2026-06-05** · deployed `MAST_MODULES_V = 20260605-143651-ef8034a` (PR #211) ·
verify on **https://sgtest15.runmast.com/app/** (Legacy-UI OFF → `#products` routes to products-v2).

> Read this whole doc, then **do the code homework in §6 before writing anything.**
> The operator's explicit instruction for this handoff: **review the actual CODE, not just docs.**
> The single most important fact is in **§4 (the maker architecture finding)** — it changes the shape of P4.

---

## 1. Where we are

products-v2 is a flag-gated V2 process surface in the mast-tenant-template admin. Over a long
session it went from "read-only review surface" to a polished, **read-complete** product slide-out
with a guided process header, variant model, image slide-out, and per-variant inventory. **Everything
shipped so far is READ.** P4 is the **edit/write** phase: *"all the tabs need edit ability."*

What this session delivered (all merged + deployed + live-verified on sgtest15):

### A. Classic-view debt closure (Buckets A/B/C)
Operator rule: **"We are not maintaining a classic view — those need V2 equivalents."** Replaced
every *"manage in classic view"* escape hatch with native V2 create/edit, **UI-only**, delegating
writes to existing legacy module logic via thin `window.*Bridge` shims (no new backend). ~16 surfaces
across PRs **#190–194** (A), **#196–197** (B), **#200** (C).

### B. The `*Bridge` load-order bug class (found by LIVE testing, not code review)
Three v2 modules called `window.XBridge` **without first `MastAdmin.loadModule('<host>')`** → the
bridge was `undefined` in a pure-v2 (Legacy-off) session → silent failure. Byte-for-byte write audits
**missed** it; only executing it on the tenant revealed it. Fixed **#198** (procurement, gift-cards),
**#199** (cs-reviews). **Lesson, load-bearing for P4:** any cross-module delegate MUST
`loadModule('maker')` at route/handler setup **and** guard the call
(`if (!window.MakerProductBridge) { loadModule('maker'); toast('still loading…'); return; }`).

### C. Dark-mode `.btn-primary` contrast fix — #195. Terms publish-stamp bug filed as `task_d06b92f5`.

### D. products-v2 guided header + variant model (the big iterative build)
Ratified design first (`docs/ux-audit/guided-record-mock.html`, #202), then built + iterated hard
from the running thing:

| PR | What |
|----|------|
| #203 | `MastFlow.renderGuidedHeader` — lean step rail, **click-a-step to advance** (no Advance button), opt-in via `detail.guidedHeader:true` |
| #204 | Lean checklist — **collapsed by default, pull-not-push**; unmet-only; "Show N completed" on request |
| #205 | Variant **list** expand (click product w/ variants → list of Default + variants, not jump to detail); `◆ Default` indicator |
| #206 | **Tuck-when-Active** (process bar hides once Active; click the **Active status pill** to reveal); removed Back when entering a variant from the list; variant **language** rework |
| #207 | **Per-variant inventory** (never inherited/override); header **image thumbnail**; real-image lightbox |
| #208 | **Variant switcher pill** (one pill, popover list — anti-clutter; "back to default / pick another") |
| #209 | **Image slide-out** (drill to `product-images-v2`: gallery + large focus of default/variant image) |
| #210/#211 | **Price range** (low–high when variant prices differ; plain price when uniform); inventory edit affordance stub |

---

## 2. The ratified product model (load-bearing — do not relitigate)

- **One object per slide-out.** The list *produces*; the SO *presents one object*. A product with
  variants expands **in the list** to `◆ Default` + each variant; clicking one opens that object's SO.
- **Guided header = lean rail + pull-checklist.** Rail shows phases (draft→ready→active→archived);
  the current phase's unmet requirements are a checklist that **points into the record's tabs** (`Go →`).
  Advancing is **a click on the next step** ("the process is a click"), not a button. Checklist is
  **collapsed by default** (pull, don't push). When the product is **Active**, the whole bar **tucks**;
  the **Active pill** (top-left badge) reveals it on click.
- **Variant switcher pill** — low-clutter single pill with a popover of the other variants + "back to
  default". Avoid putting "a million things on the page" (operator's recurring north star).
- **Variant language** (operator-tuned): price + recipe can be **"same as Default" / "give it its own"**
  (recipe = *uses the product recipe* / *give it its own recipe* — **not** the word "override").
  **Inventory is the exception:** every variant has **its own** inventory, never inherited. Default's
  inventory pane = **roll-up of all variants** with that noted as a footnote.
- **Image** = its own slide-out (drill), not a lightbox. No image → show an **"+ Upload image"**
  placeholder that opens the image upload control. *(This placeholder is a P4 to-do — see §3.)*

---

## 3. P4 scope — what "edit ability on all tabs" means

Wire **edit/write** on every product tab, for **Default and per-variant**, plus the cross-cutting actions:

- **Info** — category, business line, slug, SKU (top-level product fields)
- **Pricing** — price / markup
- **Recipe** — link/pick an existing recipe, **create** a recipe, open it
- **Inventory** — set stock (per-variant; Default = roll-up, not directly settable)
- **Channels** — channel mapping
- **Image** — upload (incl. the **"+ Upload image"** placeholder when none), set primary, reorder
- **Cross-cutting** — **add variant**, the real **Advance** (status transitions via the guided rail)

**Two read-phase items flagged by the operator to fold in during P4:**
1. Default inventory: make **"on hand = all variants combined"** an unmistakable footnote.
2. **No image → "+ Upload image" placeholder** in the header strip that opens the upload control.

### The hard rules (operator, non-negotiable)
- **UI only. No new backend.** Delegate every write to maker's existing logic via a
  `window.MakerProductBridge` (the pattern we used for materials/students in Buckets A/B).
- **Build-and-discuss.** Pilot ONE tab end-to-end, deploy to sgtest15, **live-verify**, show the
  operator, iterate. Do **not** fan out and wire all tabs blind — these are real product writes.
- **Born-0 lints, flag-gated, loadModule+guard** (the §1.B bug class).

---

## 4. ⚠️ THE CRITICAL FINDING — read before planning

**Product editing in maker is NOT flat field writes.** The canonical product-edit save is
`saveDefineView()` in `app/modules/maker.js` (~line **2813**). It is **stateful and entangled**:

- It reads the legacy define view's **in-memory editing state** (`defineState`, `defineProductId`) —
  it does **not** take a data object.
- It writes `public/products/{pid}/defineSpec` + `markupConfig`, then **recomputes `costShape`**
  (`computeCostShape` / `persistCostShape`) **and the readiness checklist** (`recomputeAndPersistReadiness`).
- For an **Active** product with `hasPendingRevision`, it **stages changes as a pending revision**
  (`stagePendingChanges`) instead of writing live. **Editing an Active product must respect this** —
  do not write live over an active product.

**Implication — P4 splits into two kinds of tab:**

| **Clean** (confident native write now) | **Heavy** (coupled to cost/markup/revision machinery) |
|---|---|
| **Info** — category, business line, slug, SKU (top-level fields) | **Pricing** — `markupConfig` + `costShape` recompute |
| **Image** — upload via existing `uploadImage` CF + image fields | **Recipe** — the recipe **builder** is a separate complex surface |
| simple per-variant fields | **Inventory / Channels** — own write paths + revision-awareness |

The clean tabs are direct top-level product field writes (no costShape/revision). The heavy tabs need a
**careful, behavior-preserving refactor of `saveDefineView` into a data-parameterized core** inside
maker.js (exactly the kind of refactor done for materials/students — extract the write, keep the legacy
view calling it), then expose it on `window.MakerProductBridge`. **Recipe building** stays a **gated
drill into the existing recipe builder** (`window.makerOpenRecipeBuilder` / `makerCreateRecipeForProduct`)
— that builder is genuinely a separate surface (like the website builder); do **not** reimplement it.

### The open decision for the operator (ask, or default to the first)
1. **Info + Image first** — quick, confident, fully-native; stands up `MakerProductBridge` on the clean
   writes → then take on **Pricing** (the cost-coupled refactor). *(Recommended — fast visible win.)*
2. **Straight at Recipe/Pricing** — the heavier, slower refactor the operator flagged first.

The operator was asked this at the end of the session and **had not yet chosen** (they paused on a warm
note: *"this is great work, huge improvement over V1"*). **Surface this decision before diving into the
heavy refactor.**

---

## 5. Key code map (where things live)

**`app/modules/maker.js`** (the legacy write host — your delegate target):
- `saveDefineView()` ~2813 — canonical product-edit save (see §4). `recalcCostShape` follows it.
- `createRecipeForProduct(pid, name)` ~4585 (= `window.makerCreateRecipeForProduct`) — creates a recipe + opens the builder.
- `createRecipe(data)` — writes the recipe (with `productId`) via `MastDB.recipes.set`; **does not** set `product.recipeId` (verify how the product↔recipe link is actually established — was unresolved at handoff).
- `stagePendingChanges`, `persistCostShape`, `computeCostShape`, `recomputeAndPersistReadiness` — the cost/revision/readiness machinery.
- Exposed window fns: `makerOpenRecipeBuilder`, `makerCreateRecipe`, `makerUpdateRecipe`,
  `makerOpenDefineForProduct`, `makerComputeReadinessChecklist`, `makerPromoteToReady`, `makerLaunchToActive`, `makerCreateRecipeForProduct`.
- **`window.MakerMaterialsBridge`** (and the students bridge) — the **canonical delegate precedent**. Copy this shape for `MakerProductBridge`. `MakerProductBridge` was *planned* in the P3 handoff but **not built**.
- Product write accessors: CSV import uses `MastDB.products.set` (~6505); field writes use `MastDB.set('public/products/'+pid+'/'+field, …)`. There is **no** `MastDB.products.update` in maker — confirm the accessor before writing.

**`app/modules/products-v2.js`** (the V2 surface — where you add edit affordances):
- Entities: `products-v2` (Default), `product-variant-v2`, `recipe-v2` (drill), `product-images-v2` (drill).
- Helpers: `price`, `variantPrice`, `variantOverridden`, `priceRange`, `realVariants`, `variantSwitcherHtml`, `headerStrip` (the "+ Upload image" placeholder lands here), `inventoryPane`, `rowHtml`.
- `window.ProductsV2` handlers: `open`, `toggle`, `openVariant`, `toggleSwitcher`, `focusImage`, `editVariantTodo` (stub to replace), `addVariant` (stub to wire).
- Guided header opt-in: the entity's `detail.guidedHeader === true`. `ensureMaker` already loads maker before opening a product SO (good — but still guard each bridge call).

**`shared/mast-entity.js`** (engine — exempt from lints; touch minimally):
- `openRecord`, the form/edit render + `onSave` path, `drill`/Back crumb, `_flowRender` (the
  `guidedHeader` branch picks `renderGuidedHeader` vs `renderHeader`; after inject it wires the
  status-pill → reveal-rail when `res.tucked`).

**`shared/mast-ui.js`** — primitives (`imageThumb`, `openImg` lightbox, form inputs).
**`app/modules/workflows/workflow-engine.js`** — `MastFlow`: `evaluate()`, `renderGuidedHeader`,
the guided rail/checklist, `productsWorkflow` phases + `exitRequirements` (the readiness → guided-rail mapping).

---

## 6. HOMEWORK — do this before writing any code (operator's explicit ask)

**Review the CODE, not just this doc.** Concretely, before touching anything:

1. **Read `saveDefineView()` and its helpers** in maker.js (`stagePendingChanges`, `computeCostShape`,
   `persistCostShape`, `recomputeAndPersistReadiness`). Understand the live-vs-revision branch. This is
   the heart of why P4 is non-trivial.
2. **Read `window.MakerMaterialsBridge`** (and the students bridge) end-to-end — that is the exact
   delegate shape to replicate for `MakerProductBridge`. Note how it's a *thin additive shim* over the
   legacy write, parameterized by data.
3. **Trace the product↔recipe link**: confirm how `product.recipeId` actually gets set (createRecipe
   doesn't set it). Do not build the Recipe tab until you know the real link write to delegate to.
4. **Read the products-v2.js tab panes** (`inventoryPane`, recipe pane, `headerStrip`, `rowHtml`) so
   you know exactly where each edit affordance attaches.
5. **Confirm the product write accessor** maker uses for single-field writes (`MastDB.set('public/products/…')`)
   — there's no `.products.update`.
6. **Re-read §1.B** (the loadModule+guard bug class) — it will bite again if you skip the guard.
7. **Verify on the live tenant, not by reading.** This session's three real bugs were all found by
   executing on sgtest15 — never by audit. Use the tenant MCP (`mcp__3dc94aaa-…` `discover_tools` /
   `run_tool`, e.g. `mast_products` / `mast_recipes`) to seed/inspect data, and the in-browser MCP
   (`mcp__Claude_in_Chrome__javascript_tool` runs in **page context**; `computer`/screenshot to see it)
   to drive the UI. Test tenant — you may add any data you need.

---

## 7. Working norms (how the operator likes to work)

- **Repo rules** (also injected by the SessionStart hook): work in your **own worktree + feature branch**
  off `origin/main`; **never `git push origin main`**; open a PR → **auto-merges on green** (~12s lint) →
  CI auto-deploys the dev site. Dev/sgtest15 is **frictionless & pre-authorized** — iterate, fix forward,
  don't ask permission for dev deploys. Ceremony is **prod-only**.
- After editing `app/index.html` or `app/modules/*.js`: **bump `MAST_MODULES_V`** (hook does it) and
  **regen `docs/generated/admin-inventory.md`**; `node --check` the inline script if you touch index.html.
- **Lints** must be **born-0**: hardcodedHex (no `#hex` / `#180` refs / `&#9660;` in app/modules — use
  color keywords like `white`), 7-step font scale, handRolledChrome (banned literals: `mu-card|cc|kv|tiles|tile|tl|rel|ptabs|stickyhead`; `mu-thumb`/`mu-pane` are fine). `shared/` + `index.html` are exempt.
- **Verify through `<tenant>.runmast.com`** (the worker — covers edge + browser cache), hard-reload /
  `?cb=<ts>` to bust cached module JS. Operator typically watches on **Safari with Legacy-UI off**.
- **Build-and-discuss cadence:** pilot one thing → deploy → screenshot/verify → show the operator →
  iterate from the running build. The operator gives tight, specific feedback and steers from the live
  thing. Don't over-build ahead of that loop.
- **Anti-clutter is the north star.** When in doubt, show less; let the user *pull* detail.

---

*Handoff authored at end of the read-phase session, 2026-06-05. Next: P4 edit/write, starting with the
§4 open decision.*
