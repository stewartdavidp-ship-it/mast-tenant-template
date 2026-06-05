# products-v2 — P4 Continuation Handoff

**Status as of 2026-06-05** · deployed `MAST_MODULES_V = 20260605-184715-514501d` (PR #235) ·
verify on **https://sgtest15.runmast.com/app/** (Legacy-UI OFF → `#products` routes to products-v2).
⚠️ The admin is a **PWA** — hard-reload / Empty Caches (or unregister the service worker) to clear the stale shell after a deploy.

> Continues `products-v2-P4-HANDOFF.md`. The original P4 (edit phase) is largely shipped; this
> doc captures **what's done, what's left, and the full field-coverage audit** the operator asked for.
> Same hard rules as before: **UI only, delegate to `window.MakerProductBridge`; loadModule+guard;
> build-and-discuss (pilot → deploy dev → live-verify on sgtest15 → show); born-0 lints; bump
> `MAST_MODULES_V` + regen `docs/generated/admin-inventory.md` on any app/index.html or app/modules edit.**
> Work in your own worktree + branch off `origin/main`; PR auto-merges on green (~12s lint), then
> **manually `gh pr merge --squash`** (auto-merge isn't actually wired) → CI auto-deploys dev.
> ⚠️ Deploy did NOT auto-trigger for one merge this session — if the served version doesn't update,
> `gh workflow run Deploy --ref main`.

---

## 1. What shipped this session (all merged + deployed + live-verified)

| PR | What |
|----|------|
| #213 | `window.MakerProductBridge` stood up + **Info tab** edit (category/businessLine/slug/SKU); revision-aware |
| #214 | **Image tab** upload + "+ Upload image" placeholder |
| #216 | **Image management drill SO** (set-primary/remove via product-images-v2, large hero) + index-safe fresh-read bridge ops |
| #218 | **Variant image binding** (`variant.imageIndex`) + fixed the read bug (v2 read v.image/imageUrl which the model never sets) |
| #220/#221/#222 | Variant image picker UX: stay on tab + clear selected highlight + keyword-fallback colors |
| #223 | **Products search box** (name/category/SKU) + **cold first-click fix** (`withProductBridge` load-then-act; preload maker on `openVariant`) |
| #227 | **Pricing tab** — direct retail/wholesale price (markupConfig is vestigial; products use direct priceCents) |
| #228 | **Light/dark token foundation** — the `--charcoal` split (separate `--text-primary` that flips; restored `:root` hexes; light `--surface-card`). Done in a parallel session. #234 finished it in shared engines. |
| #230 | **Variant price override + SKU** |
| #231 | **Inventory tab** — on-hand (Default variant-less + per-variant); separate `admin/inventory` collection + `syncStockInfoToPublic` |
| #232 | **Variant wholesale price** (new — not in V1) |
| #233 | **Variant Recipe** "Give it its own recipe" → opens builder focused on variant |
| #235 | **Fulfillment group in Info** — stock mode + lead-time-to-build + "is a second" |

Memory: `~/.claude/projects/-Users-davidstewart-Downloads-mast-tenant-template/memory/project_products_v2_p4_edit.md` has per-feature detail + gotchas.

---

## 2. THE REMAINING WORK (operator: "we need to do all these things")

### ⭐ FIELD PLACEMENT (operator-ratified 2026-06-05 — follow this)
| Tab | Fields |
|-----|--------|
| **Info** | Name, **Description**, **Short description** (+ existing Category, Business line, Slug, SKU; Acquisition read-only) |
| **Fulfillment** (NEW own tab) | Stock mode, Lead time to build, Is a second, **Availability**, **Dimensions** (likely Weight too — confirm) |
| **Tags** (NEW own tab) | Tags |
| **Channels** (already a tab) | make the existing Channels tab editable (see D) |

### A. Move **Fulfillment to its own tab** (operator: "it does not work inside info") + add Availability/Dimensions
Currently Fulfillment is a 2nd card in the Info pane (`infoPaneFull = infoPane + fulfillmentPane`).
Make it its **own top-level tab**:
- Add `{ key: 'fulfillment', label: 'Fulfillment' }` to the Default product `tabs` array; add `pane('fulfillment', fulfillmentPane(p))`.
- Revert the Info pane to just `infoPane(p)` (drop `infoPaneFull`); point `rerenderInfoPane` back to `infoPane`.
- Give `fulfillmentPane` its own `rerenderFulfillmentPane` targeting `.mu-pane[data-pane="fulfillment"]` (stop piggybacking `rerenderInfoPane`).
- **Add to the Fulfillment tab:** **Availability** (`availability` — `pdAvailability` select, options from legacy ~46582) and **Dimensions** (`pdMakerDimensions` — maker attribute; check the storage path). Likely **Weight** too (`pdWeightOz` / value+unit model — reconcile which the data uses) — confirm with operator.
- ⚠️ "is a second" (category toggle) writes via `setFields` (revision-aware → STAGES on Active) while stockType/leadtime write live via `setInventoryConfig`. The split confused on Active products. Consider making the second-flag live, or clearly note the staging.

### B. **Info tab** — add Name + Description + Short description (simple top-level `setFields`, revision-aware)
Legacy edit form is in `app/index.html` (~line 46572, the `pd*` ids):
- **Name** (`name`) — `pdName`. CRITICAL — currently only shown in the SO header, not editable.
- **Description** (`description`) — `pdDescription` (textarea). Read-only in Image tab today.
- **Short description** (`shortDescription`) — `pdShortDesc`.
These extend the Info tab edit form (`infoEditForm`) the same way category/slug/sku do → `MakerProductBridge.setFields(pid, {...})`.

### B2. **Tags** — its own tab
- Add `{ key: 'tags', label: 'Tags' }` tab + a `tagsPane` (chips/comma-separated edit). `tags` is a top-level product field (array or comma string — check the data) → `setFields({tags})`. Legacy stores comma-separated; confirm read/write shape.

### C. **Add-variant / options** (bigger)
`ProductsV2.addVariant` is still a stub ("write flow lands in P4"). Defining variant **attributes** (`product.options` = e.g. [{label:'size', choices:['small','medium','large']}]) and **adding variants** (push to `product.variants` with a combo) is unbuilt in v2. Legacy: `openAddVariantDialog` / `addVariantToProduct` (app/index.html ~45349/45400) — combo from options, `_comboSig`/`_allCombos`. Bridge could expose `addVariant`/`setOptions` writing `product.variants`/`product.options` (the variant slot model). Consider a drill SO for attribute definition (heavy edit rule).

### D. **Channels editing** (integration-coupled)
v2 Channels tab is read-only (Shopify/Etsy/Square mapped/off + internal storefront). Variant Channels = "Map separately" stub (`editVariantTodo`). Realistic edit = per-channel **sync on/off** toggle + surfacing mapped status — NOT manual listing IDs (those come from OAuth + publish flows). Fields: `externalRefs.{shopify,etsy,square}` (`.externalId`, `.syncEnabled`), `channelBindings`, `channelIds`. These are NON_REVISIONABLE (sync metadata) → write live. Confirm the publish/connect flow before wiring (don't reimplement OAuth).

### E. **Fix Recipe "Back" → V1 legacy page**
"Edit in builder" / "Give it its own recipe" / "Create a recipe" route into the **legacy recipe builder** (`navigateToClassic('products')` + `makerOpenRecipeBuilder(recipeId, variantId)`, in `openRecipeBuilderGated`). The builder's "← Back to Products" is legacy → dumps the user on the **V1 product page**, not back to the v2 slide-out. Options: (1) intercept/override the legacy builder's back to return to `#products` + reopen the v2 SO; (2) build a **v2 recipe builder** surface (big — the original handoff said don't reimplement it, but the operator is anti-legacy, so revisit). At minimum, after the builder, returning should land in v2, not V1.

---

## 3. Full product field model (from live data + legacy edit form)

**`public/products/{pid}` keys:** acquisitionType, archivedAt, archivedSubState, availability, businessLine, categories, channelBindings, channelIds, description, externalRefs, hasPendingRevision, imageIds, images, isWholesale, name, options, originalBasePriceCents, parentProductId, pendingChanges, pendingChangesUpdatedAt, pid, priceCents, priceHistory, priceType, promotedToActiveAt, promotedToReadyAt, readinessChecklist, recipeId, retailPriceCents, retiredAt, returnsAcceptedUntil, shortDescription, slug, status, stockInfo, updatedAt, url, variants, version. (+ legacy-only: weightOz/weight, tags, maker dimensions.)

**`admin/inventory/{pid}`:** stockType, productionLeadTimeDays, lowStockThreshold, stockFulfillmentDays, stock{ _default|<variantId>: {onHand, committed, ...} }, history. (Denormalized → `product.stockInfo` via `window.syncStockInfoToPublic`.)

**variant object:** id, combo, priceCents (override), wholesalePriceCents, sku, imageIndex. (Stock is in admin/inventory, not on the variant.)

---

## 4. Key technical context (the bridge + patterns)

`window.MakerProductBridge` (in `app/modules/maker.js`, ~line 6940+ exposure):
- `setFields(pid, patch)` / `setField` — top-level product fields. **Revision-aware**: Draft/Ready write live; Active stages into `pendingChanges` (enters revision mode first). Returns `{ok, staged, changed}`.
- `addImage(pid, file)` / `setImages` / `makeImagePrimary(pid,url)` / `removeImage(pid,url)` — images, LIVE, fresh-read + URL-keyed (index-safe).
- `setVariantImageIndex(pid,vid,idx)` / `setVariantFields(pid,vid,patch)` — variant fields (null clears), LIVE.
- `createRecipeForProduct` / `linkRecipe` / `unlinkRecipe` — recipe LINK only (`applyRecipeToProduct` is a different price-applying op — don't use for linking).
- `setStock(pid,variantKey,onHand)` / `setInventoryConfig(pid,patch)` — inventory (separate collection); both prime `window.inventory[pid]` from a fresh read then call `window.syncStockInfoToPublic`, return fresh `stockInfo`.

products-v2 patterns: `withProductBridge(cb)` (load-then-act, NOT bail); in-place pane re-render (`rerenderXPane`) to keep the active tab (full SO re-open resets to the first tab); `V2.byId[pid]` is the shared record the SO renders + Back re-renders from (keep it synced after writes); `esc()` everything; lints forbid `#hex` and `class="…mu-(card|cc|kv|tiles|tile|tl|rel|ptabs|stickyhead)"` in app/modules (use U.card/U.kv; mu-pane/mu-thumb OK); allowed rem font sizes: 0.72/0.78/0.85/0.9/1.0/1.15/1.6.

⚠️ Token gotcha: `--amber`/`--teal` historically empty in the slide-out scope — pv2 image-highlight uses keyword fallbacks `var(--amber,goldenrod)` etc. #228 defined the real tokens; revisit the fallbacks if desired.

⚠️ Test hygiene: products/inventory/recipes are real writes on the test tenant — **capture originals, restore after**; don't mutate module-private `V2.byId` out-of-band; recipe create leaves an orphan recipe (unlink + `MastDB.remove('admin/recipes/'+rid)`); `makerDiscardPendingChanges` opens a confirm MODAL (don't await in a loop). All real bugs this phase were caught by LIVE sgtest15 testing, never code audit.

---

## 5. Suggested order for the next session
1. **Fulfillment → own tab** + add Availability/Dimensions (operator-flagged; unblocks the in-Info confusion).
2. **Info tab**: add Name + Description + Short description (Name/Description are the glaring gaps).
3. **Tags** → own tab.
4. **Fix Recipe Back → v2** (UX correctness).
5. **Channels** sync-toggle editing (in the existing Channels tab).
6. **Add-variant / options** (largest).

Per-tab placement is operator-ratified — see the FIELD PLACEMENT table in §2. Build-and-discuss: one item → deploy dev → live-verify on sgtest15 → show → iterate.

Build-and-discuss: one item → deploy dev → live-verify on sgtest15 → show the operator → iterate.
