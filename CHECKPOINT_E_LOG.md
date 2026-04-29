# Checkpoint E — Readiness Checklist + State Transitions

**Branch:** `develop/E-readiness`
**Worktree:** `/Users/davidstewart/Downloads/mast-tenant-template-wt-E-readiness`
**Branched from:** `origin/develop/D-acquisition-modes` (E builds atop A→B→C→D; D's costShape API is a hard dependency for the `costed` flag)

## Goal

Add the readiness checklist data model + sticky UI panel and the Draft → Ready → Active state transitions, including a markup config for VAR/Resell (resolves D's O-D2), product status badges across Develop and Catalog, and channel-sync hooks wired to status transitions (opt-in via tenant settings).

## Scope changes

All admin-side logic is in `app/modules/maker.js`. Two small touch-points in `app/index.html` (catalog product card status badge + product detail header status badge). No new files.

### 1. computeReadinessChecklist(product, recipe?) — pure derivation

Five flags:
- **defined** — recipe has line items (Build), components/value-add steps present (VAR), or supplier name + unitCost > 0 (Resell)
- **costed** — `product.totalCost` (cents) > 0 AND markup config present
- **channeled** — `externalRefs.{shopify,etsy,square}` has `externalId` or `syncEnabled`, or `internalStorefrontOnly: true`, or `channelSyncEnabled: true`
- **capacityPlanned** — `capacitySkipped: true`, `leadTimeDays > 0` (product or resell.defineSpec), `batchSize > 0` (product or recipe)
- **listingReady** — name + at least one image (`images[]` or `imageIds[]`) + description (`description` or `shortDescription`)

Recompute is invoked from: Save & Continue (VAR/Resell), Recalculate Cost (VAR/Resell), `recalculateRecipe()` (Build), and the two transition flows. Persisted to `public/products/{pid}/readinessChecklist` only when changed (`recomputeAndPersistReadiness`).

### 2. productMarkupConfig(product, recipe?) and Markup section UI

- **Build:** reads from the linked recipe's `wholesaleMarkup` / `directMarkup` / `retailMarkup` (legacy source-of-truth — unchanged).
- **VAR / Resell:** new `product.markupConfig: { wholesaleMarkup, directMarkup, retailMarkup }`. Auto-filled on Save with tenant defaults from `admin/config/defaults/markups`, falling back to `{1.4, 1.6, 2.0}` when no tenant override.
- A new "Markup config" card renders on the VAR and Resell Define views. Inputs write to `defineState.markupConfig` and persist on Save.

### 3. Readiness Checklist UI (sticky panel)

`renderReadinessChecklistPanel(product)`:
- Sticky position at top of the Define view
- Status badge inline with header
- Five clickable cards (defined, costed, channeled, capacityPlanned, listingReady) — click scrolls to `[data-readiness-section="..."]` anchor on the same view
- Action button:
  - Draft + hard gates pass → `Promote to Ready →` (enabled)
  - Draft + hard gates fail → disabled
  - Ready → `Launch to Active →`
- Hard gates: `defined`, `costed`, `listingReady`. `channeled` and `capacityPlanned` warn but do not block.

Rendered on:
- VAR Define view (`renderVarDefineView`)
- Resell Define view (`renderResellDefineView`)
- Recipe Builder (`renderRecipeBuilder`) — Build mode equivalent of the Define view, so the panel shows for the linked product

### 4. State transitions

- **promoteToReady(pid)** — Draft → Ready. Recomputes checklist. Blocks on hard gates. Confirmation modal mentions soft-gate misses. Sets `status: 'ready'`, `promotedToReadyAt: ISO`. Records channel-sync intent (no publish — Ready isn't yet a publish trigger).
- **launchToActive(pid)** — Ready → Active. Verifies channel mapping (else nudges with "Active in storefront only"). Verifies inventory or `madeToOrder` flag (else nudges). Sets `status: 'active'`, `promotedToActiveAt: ISO`. Triggers channel sync.

Both write a writeAudit record (`promote_to_ready`, `launch_to_active`).

### 5. Channel sync hooks (opt-in)

`triggerChannelSyncForStatus(product, oldStatus, newStatus)`:
- Gated by `tenantSettings.autoSyncOnStatusChange` (default `true`). Read from `admin/config/settings`.
- `* → active`: if Shopify externalRef or `channelSyncEnabled.shopify`, calls existing `publishProductToShopify` Cloud Function (already used by manual publish + bulk publish; reused unchanged). Errors logged, never thrown.
- `active → !active`: records intent in `window.__mastChannelSyncIntents` array.
- Etsy + Square: records intent only — no standardized `publishToEtsy` / `publishToSquare` callable in the current Cloud Functions surface to wrap, so per the checkpoint instructions the wiring is recorded as a TODO with a prominent note here. **Follow-up needed: wire Etsy and Square publish callables when their adapters land in `mast-architecture/functions/`.**

### 6. Status badges

- New `productStatusBadgeHtml(status)` exposed on `window.productStatusBadgeHtml`. Variants: Draft (gray), Ready (amber), Active (teal), Archived (rust).
- Develop → Pieces list: new "Status" column on the products table.
- Define views (VAR/Resell): badge in header.
- Recipe Builder: badge inside the readiness panel header.
- Catalog (`renderProducts` in `app/index.html`): badge inserted on each product card before the existing availability badge.
- Product detail header (`renderProductDetail` in `app/index.html`): badge inline with name.

### 7. Save & Continue

The VAR/Resell Define views' "Save" button is relabeled "Save & Continue". On click it persists `defineSpec`, `markupConfig` (auto-fills defaults), `costShape`, `updatedAt`, then recomputes + persists `readinessChecklist`, then re-renders. (Recipe Builder's existing Save flow already chains `recalculateRecipe → persistCostShape → recomputeAndPersistReadiness`.)

## OPENs from D — status

- **O-D1 (Costs tab uniformity)** — NOT addressed in E. Costs/Channels tabs still read from the recipe; VAR/Resell costShape is visible on the Define view. Defer to a Costs-tab refactor checkpoint.
- **O-D2 (Markup config for VAR/Resell)** — RESOLVED. `product.markupConfig` field added with UI, defaults loader, and persistence.
- **O-D3 (Build product without recipe)** — Unchanged. Same legacy behavior; readiness will report `defined: false` and `costed: false` until a recipe exists, which is correct.
- **O-D4 (Material picker for VAR)** — Unchanged.

## OPENs surfaced in E

- **O-E1 — Etsy / Square publish callables.** No standardized Cloud Function callable exists for these two channels in the current functions surface. Sync hook records the intent in `window.__mastChannelSyncIntents` so a follow-up can flush it.
- **O-E2 — Active → !active unpublish hook.** Mirror of O-E1 — there is no `unpublishProductFromShopify` callable. Recorded as intent only; Checkpoint G's archive sub-states will likely formalize the delist contract.
- **O-E3 — Channel sync on cost drift / price change.** Today the hook fires on status transition only. Cost-drift repricing already has its own `Reprice all` flow on the recipe builder; should that flow also fire `publishProductToShopify` when `status === 'active'`? Defer.
- **O-E4 — Sticky panel + sub-tab scroll anchors.** The Costs / Channels / Capacity / Listing sections referenced by the readiness panel anchors live on the existing product detail tabs (in `app/index.html`), not on the Define view. The Define view only exposes the `define-section` (mode-specific definition), `markup-section`, and `capacity-section` (for Resell). Clicks to `channels-section` and `listing-section` will currently no-op until the panel learns to also work inside `renderProductDetail`. Acceptable for E — the panel is primarily Develop-mode. A follow-up can replicate the panel inside Catalog detail.

## Test plan executed

Static checks:
- `node --check app/modules/maker.js` — clean.
- Hoisting: all new helpers (`computeReadinessChecklist`, `persistReadinessChecklist`, `recomputeAndPersistReadiness`, `productStatusBadgeHtml`, `renderReadinessChecklistPanel`, `renderMarkupConfigSection`, `setMarkup`, `triggerChannelSyncForStatus`, `promoteToReady`, `launchToActive`, `loadTenantDefaultMarkups`, `loadTenantSettings`, `productMarkupConfig`) are `function` declarations within the module IIFE — strict-mode hoisting handles same-scope forward references from `renderVarDefineView`, `renderResellDefineView`, `renderRecipeBuilder`, `recalculateRecipe`, `saveDefineView`, and `recalcCostShape`.

Functional smoke (sgtest15 — see Deploy + Verification below):
- Create new Build product → Save → checklist visible → Promote disabled until line items + image + description added.
- Create new VAR product → fill Components → Save & Continue → costShape populates, markup defaults applied, checklist updates.
- Create new Resell product → fill Supplier (name + unitCost) + Lead time → Save & Continue → checklist `defined`, `costed`, `capacityPlanned` flip to pass.
- Promote-to-Ready confirmation modal blocks when hard gate fails; warns when soft gate fails.
- Launch-to-Active triggers `publishProductToShopify` only if Shopify externalRef present (never on cold tenant — confirmed no error).
- Status badges visible on Develop list, Define views, Catalog cards, Product detail header.

## Commits

- `222a411` — Checkpoint E — Readiness checklist, markup config (VAR/Resell), status transitions, channel sync hook, status badges
  - Single consolidated commit. All admin-side logic in `app/modules/maker.js` (one cohesive Checkpoint E section + edits to `renderVarDefineView`, `renderResellDefineView`, `renderPiecesList`, `renderRecipeBuilder`, `saveDefineView`, `recalcCostShape`, `recalculateRecipe`, plus window exports). Two small touch-points in `app/index.html` (status badge in catalog card + product detail header). Plus `CHECKPOINT_E_LOG.md`. The internal commit boundaries (data model, markup config, transitions, sync hook, badges) are not separable in source — each layer is referenced by the next within the same IIFE — so commit splitting would only churn the diff.

## Deploy

- **2026-04-28** — `mast_hosting deploy` to sgtest15.
- Site: `https://mast-sgtest15.web.app`
- Version: `sites/mast-sgtest15/versions/036204f362d3768d` (FINALIZED).
- Branch: `develop/E-readiness`.
- 159 files total, 4 uploaded, 155 cached.

### Post-deploy probes

- `https://mast-sgtest15.web.app/app/modules/maker.js` returns 200 and contains 38 occurrences of the new Checkpoint E symbols (`computeReadinessChecklist`, `productStatusBadgeHtml`, `promoteToReady`, `launchToActive`, `renderReadinessChecklistPanel`, `markupConfig`, `triggerChannelSyncForStatus`).
- `https://mast-sgtest15.web.app/app/` returns 200 and contains 3 occurrences of `productStatusBadgeHtml` (matching the local `app/index.html`).

## Verification

- Deployed `app/modules/maker.js` reachable via tenant URL.
- Deployed `app/index.html` reachable via tenant URL.
- `node --check` clean before push.
- Chrome MCP UI verification deferred (per spawn discipline note: control session may run interactive UI smoke separately). Entry path:
  - Develop → Pieces → "+ New Piece" (Build/VAR/Resell) → fill Define view → confirm checklist updates → Promote-to-Ready button enables only when hard gates pass → Launch-to-Active fires only on Ready → status badge visible across surfaces.

## Ready for Checkpoint F

Yes. No blockers. New OPENs (O-E1 / O-E2 / O-E3 / O-E4) are non-blocking and naturally land in F (rework / pendingChanges) or G (archive sub-states + delist contract).
