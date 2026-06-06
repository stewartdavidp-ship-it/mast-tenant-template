# The Standard Mast Record UI — Codified

**Status:** Canonical pattern, ratified by the cornerstone build. Roadmap §3 item #7.
**Date:** 2026-06-06.

> The product + variant slide-out is the **cornerstone**: the reference implementation of how every Mast record should look and behave. New V2 surfaces (customers, orders, materials, jobs, …) **derive from this** — don't design each module's record UI ad hoc. This doc is the spec to copy.

Reference implementation: `app/modules/products-v2.js` (+ its write delegate `app/modules/maker.js`) on the engines `shared/mast-entity.js`, `shared/mast-ui.js`, `shared/mast-io.js`.

---

## 1. Architecture: engine + module + write-delegate

Three layers, strict separation:

- **MastUI** (`shared/mast-ui.js`) — dumb presentational primitives: `list` (sortable, expandable child rows), `kv`, `card`, `badge`, `tiles`, `metricTable`, `slideOut` (+ `onPaneLeave` hook), `paneTabsBar`/`panelTab`, `stickyHead`. No data, no domain logic.
- **MastEntity** (`shared/mast-entity.js`) — record lifecycle: `define(type, {…})`, `openRecord`, `renderList`, `drill`/`back` (stacked SO with Back), `fetch`. Owns the SO shell + tab plumbing + cancel-on-leave wiring.
- **The module** (`products-v2.js`) — domain glue only: defines entities, renders panes, holds view state, exposes `window.X` handlers. **Renders via the engine; never hand-rolls a list or SO shell.** (The one time products-v2 hand-rolled its list, it looked different from everything else — fixed by re-platforming, PR 247. Lesson: raise the engine, don't fork it.)
- **The write-delegate / bridge** (`maker.js` → `window.MakerProductBridge`) — the UI module performs **no direct DB writes**. Every mutation goes through a bridge method that fresh-reads, writes field-scoped, re-syncs denormalized copies, writes the audit row, and returns the updated slice. Keeps writes revision-aware and index-safe in one place.

---

## 2. The record slide-out, anatomy (top → bottom)

1. **Header strip** (`headerStrip`) — thumbnail (merged into the title cell so spacing is stable) + title + a guided context line / switcher (e.g. the variant switcher pill). Drill targets (image manager) open from here.
2. **Sticky head** (`stickyHead(tiles, paneTabsBar)`) — hero **tiles** (the 3–4 numbers that matter: price, status, …) + the **pane tab bar**, both pinned while the body scrolls.
3. **Panes** (`panelTab`/`mu-pane`) — one tab = one pane. Each pane is **read-first**: a `kv`/`card` summary with an **Edit** button (when permitted). Editing swaps that pane in place for an inline form; Save/Cancel return to the summary.

A record's tab set is its contract. The product cornerstone: **Pricing · Recipe · Channels · Inventory · Fulfillment · Image · Info** (variant mirrors it with `v-` panes + per-variant overrides).

---

## 3. The edit pattern (load-bearing)

- **Read → inline edit → save**, per pane. The pane function checks an edit-state flag (`V2.editX === id`) and returns either the summary or the edit form. Handlers `editX`/`cancelX`/`saveX` flip the flag + re-render only that pane (`rerenderXPane`, an in-place `innerHTML` swap — never a full SO re-render, which would bounce you to tab 1).
- **Cancel-on-leave** (ratified behavior). Leaving a pane mid-edit **discards** the edit. Wired through the engine hook `MastUI.slideOut.onPaneLeave(fn)`; each entity registers `detail.onPaneLeave(prevPane, nextPane, rec)` to clear its edit flags. Fresh open always resets to read-only.
- **Heavy edit drills** (`MastEntity.drill` → stacked SO with **Back**). Tab panes are for read + light inline edit; anything heavy (image manager, recipe builder) drills to its own slide-out. On Back, the originating pane is restored (generic engine fix) and the tab refreshes from the shared record. (See `feedback_heavy_edit_drill_so`.)
- **Writes delegate** to the bridge and update the in-memory record on success, so the list reflects changes **from memory** (`markListDirty` / re-render the hidden list body) without a DB re-read.

---

## 4. The list (same engine, faceted)

- Rendered via `MastEntity.renderList → MastUI.list` with `opts.columns` + `rowId` — **identical look to every other list** (bordered card, header row, sortable `th`, surface).
- **Expandable child rows** for sub-records (the variant tree): `expandable`/`hasChildren`/`expandedIds`/`onToggleFnName`/`childRowsHtml`. Thumbnails are just a column whose `render()` returns raw HTML.
- **Facets/lenses** — pills that swap the *column projection* AND the *row click-through* (which SO tab it deep-links to). General / Inventory / Sales / Forecast on products. Lazy-load per lens.
- **Sorting** is product/record-level and range-aware (Price→lowest, Variants→count); header alignment matches value alignment (default `th` left, right-aligned columns get right headers).
- Search box with an **× clear** affordance; type-to-filter re-renders only the list body (keeps input focus).

---

## 5. Sub-records are first-class

A variant is not a row in its parent — it's an entity with a **stable unique id**, its own SO, its own panes, and **override-or-inherit** semantics for everything it can specialise (name, price, image, fulfillment, channel availability). The pattern: read the effective value = `override ?? productDefault`, show an **override** badge vs **· inherits product**, edit form offers **Inherit** + the choices, blank clears the override. Key strictly by id (never index — that caused the image-drop data-loss bug; assert/log if an id is ever missing).

---

## 6. RBAC (every record surface)

- **View** gated by the relevant module's `view` axis; surfaces the user can't view are filtered out (lens pills, SO tabs, panes), with a safe fallback (e.g. default to General).
- **Edit** gated by the `edit` axis: edit affordances are **hidden** when not permitted, AND the edit-entry + direct-write handlers carry **defense-in-depth guards** (`_guardEditP`/`_guardEditS` + inline `_can`), so a hidden control can't be driven via console/deep-link.
- Helpers: `window.can(route, axis)`, `canViewModule`, `canEditModule`. Pick the axis from the data's domain (stock → inventory:edit; catalog → products:edit; job creation → jobs:edit). (See PR #261.)

---

## 7. Data discipline

- **Revision-aware writes** — published/Active records stage catalog changes as a pending revision; Draft/Ready write live. Operational fields (stock mode, counts) write live even on Active. The bridge owns this split.
- **Denormalization is resynced on write** — e.g. `stockInfo` (public) is recomputed by the bridge after any inventory write; the UI updates its in-memory copy from the returned slice.
- **No vestigial fields** — before adding a field or surfacing one, confirm something *consumes* it. Writing data nobody reads is a recurring trap (product `tags`, `imageIds`, `businessLine`). If it's not consumed, either wire the consumer in the same change or don't add it.
- **Singletons** (`admin/<x>` config docs) must be registered in `shared/mastdb.js` `SINGLETON_COLLECTIONS` or get/set silently break. (See `reference_singleton_collections_trap`.)

---

## 8. Ship discipline (every PR touching `app/index.html` or `app/modules/*.js`)

1. Own git worktree + feature branch; never the shared checkout; never `git push origin main`.
2. **Bump `MAST_MODULES_V`** (`scripts/bump-modules-version.sh`) — the required `lint` check fails otherwise; the fresh suffix only reaches users when it's on `main`.
3. **Regenerate** `docs/generated/admin-inventory.md` (`gen-inventory.mjs`) if admin file line-counts changed (separate required check).
4. `node --check` + the lint suite (rbac, mastdb, customer-writes, module-info, ux-standards, design-tokens, debug-pii, hardcoded-ids, unbounded-read). New code must be clean. *(Gotcha: a `#abc` token in a code comment trips the hardcoded-hex lint — write "PR 247", not "#247".)*
5. PR → green → merge → CI auto-deploys dev → **verify on `<tenant>.runmast.com`** (the worker; covers edge + browser cache), hard-reload. Dev is frictionless; prod is gated.
6. If the branch fell behind a merge, rebase before merging — GitHub skips `pull_request` checks while a PR is `CONFLICTING/DIRTY` (looks like "no checks reported").

---

## 9. The checklist for a new V2 record surface

- [ ] Define the entity on `MastEntity` (recordId, fetch, detail.render, onPaneLeave).
- [ ] Render the list via `MastEntity.renderList` (+ facets/expansion if it has sub-records).
- [ ] Hero tiles + read-first panes with inline edit + cancel-on-leave.
- [ ] Heavy edits drill (stacked SO + Back).
- [ ] Writes go through a bridge (fresh-read, field-scoped, resync, audit), not direct DB.
- [ ] Sub-records first-class + id-keyed + override-or-inherit.
- [ ] RBAC: view filters surfaces, edit hides affordances + guards handlers.
- [ ] No vestigial fields; denormalized copies resynced.
- [ ] Bump cache-bust + regen inventory; full lint; verify on runmast.com.
