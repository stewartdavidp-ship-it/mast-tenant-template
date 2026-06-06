# Product Cornerstone → Standard Mast UI — Roadmap / Backlog

**Status:** 🔝 TOP PRIORITY (set 2026-06-06) · address sooner rather than later · other "move X to V2"
work continues in parallel.

> Continues the products-v2 P4 work (`products-v2-P4-CONTINUATION-HANDOFF.md`). Where that doc was a
> per-tab edit punch-list, this one frames the bigger goal the operator set: **the product object is
> the center of Mast — make its slide-out the canonical *standard* record UI, then propagate that
> standard outward.** Same hard rules: UI-only, delegate writes to `window.MakerProductBridge`,
> `loadModule('maker')` + guard, revision-aware, born-0 lints, bump `MAST_MODULES_V` + regen the
> admin inventory doc, verify live on sgtest15.

---

## 1. The thesis

The **product (Default) slide-out is the cornerstone**. Get it right — tab set, inline-edit pattern,
drill-to-heavy-edit, cancel-on-leave, guided-record header — and every other object's V2 surface
inherits the same standard instead of being designed ad hoc. Don't reinvent per module; derive from
the product.

## 2. Variants are first-class (confirmed)

Live data (2026-06-06): **130/130 variants across 27 products carry a unique, globally-unique stable
`id`** (0 missing, 0 dupes; the change shipped ~a month earlier). A variant is therefore **not** defined
by its option combo — it's a first-class entity keyed by `id`, and earns its own standard surfaces:

- **Info + custom name** — `variant.name`, distinct from the auto option-combo label, keyed by id.
- **Per-variant fulfillment** — extend the already-id-keyed inventory record
  `admin/inventory/{pid}/stock/v_<id>` (today only `{onHand,committed,held,damaged,incoming}`) with
  per-variant `stockType` / `availability` / lead-time. Additive — the id-keying already exists; it's
  not a re-architecture. (Needs a small model decision: stockType is product-level today.)
- **Per-variant tags** — folds into the deferred tags / channel-import architecture; id-keyed when built.
  Separate **derived** merchandising badges (e.g. "top seller", computed from sales) from hand-set /
  channel-imported tags.

⚠️ **Footgun:** index-based variant keying (`v.id || 'v'+i`) mis-targets writes after any reorder — the
cause of the earlier image-drop data-loss bug. Key **strictly by id**; log loudly if one's ever missing.

## 3. Sequencing (smallest-first; each shippable + live-verified on sgtest15)

1. **Variant Info pane + editable `variant.name`** + index-id hardening. ✅ DONE (PR #243).
2. **Engine-list convergence** — the product list must be the *standard* list, not a bespoke one.
   Today products-v2 hand-rolls `renderListBody`/`.pv2-row` (the ONLY module that bypasses
   `MastEntity.renderList → MastUI.list`) to get thumbnails + the variant expand-tree, so it looks
   different from every other list. Fix by raising the engine list, then re-platforming:
   - **2a (engine, additive):** `MastUI.list` gains opt-in **expandable child rows** (`expandable`,
     `hasChildren`, `expandedIds`, `onToggleFnName`, `childRowsHtml`) + `.mast-subrow`/`.mast-exp`
     styling; `renderList` accepts `opts.columns`/`rowId`. Thumbnails already work (a column's
     `render()` is raw HTML). Lists that don't opt in render byte-identical. ← *this PR*
   - **2b:** re-platform products-v2's list onto `MastEntity.renderList` (thumbnail + status/price/
     variants columns + `childRowsHtml` for the Default/variant/Add-variant tree). Drop `.pv2-row`.
     Result: same look-and-feel as Orders/Customers, thumbnails + expansion preserved.
3. **Faceted product list (lenses)** — built on the now-standard list. Pills = facets that swap the
   column projection AND the row click-through, carried through into the SO tab:
   General→default · Inventory→Inventory tab · Sales→**new Sales tab** · Forecast→**new Forecast tab
   + create-job**. Folds the legacy Inventory / Sales-by-Product / Forecast sub-items (no v2 twins
   today) into the product list instead of building separate v2 modules. Lazy-load per lens; gate
   sensitive lenses (sales/forecast) on the same RBAC as today. **Procurement-as-lens:** one PO
   object, operational view under Product/Materials + financial (AP/spend) view in Finance — don't
   duplicate or fully move it (leans Product/Operations if forced to pick one home).
4. **Per-variant fulfillment** — per-variant `stockType`/`availability` on the id-keyed stock record
   (needs the model decision: stockType is product-level today).
5. **Add-variant / options** — define `product.options` + add id'd variant combos (absorbs P4 #6).
6. **Per-variant tags** — with the channel/tags-import architecture (derived badges vs hand-set).
7. **Codify the standard** — document the canonical pattern so other V2 surfaces conform.

In parallel (not blocking): P4 item **Channels** (per-channel sync on/off, integration-coupled) and
the remaining legacy→V2 module moves.

## 4. Done already (the cornerstone substrate)

Product slide-out tabs: Pricing · Recipe · Inventory · Fulfillment · Channels · Image · Info, with
revision-aware inline edit (Draft/Ready live, Active stages), drill-to-heavy-edit for images/recipe,
**cancel-on-leave** (reusable engine hook `MastUI.slideOut.onPaneLeave`), guided-record header, and
**drill-Back restores the originating tab** (generic engine fix). See
`products-v2-P4-CONTINUATION-HANDOFF.md` §1 + the P4 memory for the per-PR detail.
