# Slide-Out Conversion Inventory & Sequence

Every module's current record surface → the one slide-out ([05](05-surface-decision-record.md), [08](08-slideout-component-spec.md)). This is the execution backlog. **Plan only — no code yet.**

**Effort key:** S = mostly mechanical (≤~½ day) · M = focused refactor · L = large / many surfaces. **Size** = the slide-out tier the record needs.

## Wave 0 — build the component + prove on the references
| Module | Current surface | Target | Size | Effort | Notes |
|---|---|---|---|---|---|
| *(shared)* `mastSlideOut` v2 | email-log uses v1 | build per [08](08-slideout-component-spec.md) | — | L | Prereq for everything; keep email-log working via shim |
| email-log | ✅ shared slide-out (v1) | adopt v2 | sm | S | Reference for read-mode |
| orders | detail **page** + sub-action modals + `window.confirm` | slide-out `lg`/expand; sub-actions = panel actions; confirms→`mastConfirm` | lg | L | Reference; richest record — proves expand |
| customers | Paradigm-A on separate view | slide-out read+edit | md | M | Reference for read→edit |

## Wave 1 — low-effort, high-count (build momentum)
| Module | Current surface | Size | Effort |
|---|---|---|---|
| campaigns | list→inline edit + `openModal` create | md | S |
| promotions | `openModal` create/edit | md | S |
| studio | cards → inline page-replace edit form | sm | S |
| commission-terms | split-pane inline editor | md | S |
| contacts | Paradigm-A + add-modal | md | S |
| cart | wallet + `openModal` config forms | md | S |
| brand | tabs + inline edit + hand-rolled upload modal | sm | S |
| students | page-replace "New" form | md | S |
| homepage | section-card inline edit panel | md | S |
| advisor | read-only + hand-rolled capture modal | sm | S |
| audit-feedback | list + hand-rolled popovers/modals | sm | M |
| engagement-inbox | filters + UGC `position:fixed` modal | sm | S |

## Wave 2 — medium refactors (the bulk)
| Module | Current surface | Size | Effort | Notes |
|---|---|---|---|---|
| procurement | Paradigm-A vendor detail | md | M | |
| channels | Paradigm-A edit-mode (no `openModal`) | md | M | |
| production | detail page + inline edit + modals | md | M | |
| social | enhance modal + inline caption expand | md | M | unify two edit patterns |
| sales | list→detail toggle + hand-rolled modal | md | M | + tokenize status colors |
| fulfillment | hand-rolled table + buy-labels `position:fixed` | md | M | |
| consignment | separate detail/edit views + payout modal | md | M | |
| wholesale | **custom `translateX` slide-out** + `position:fixed` | md | M | already drawer-shaped → swap to shared (good early win) |
| website | sub-tabs + inline edit + confirm | md | M | category edit → panel |
| team | sub-tabs + cards + page-replace "New" form | md | M | |
| trips | cards + inline expand + custom sheets | md | M | |
| accounting | panel tabs + backfill `position:fixed` modal | md | M | + fix dead-end nav |
| audit | read-only + hand-rolled "Ask Mast" modal | md | M | |
| finance | report; expense editor rogue overlay; AR/AP detail | lg | M | + 320-hex tokenization (Phase 3) |

## Wave 3 — large / overlay-heavy
| Module | Current surface | Size | Effort | Notes |
|---|---|---|---|---|
| maker | recipes/materials + **7 rogue overlays** | lg | L | most overlays to migrate |
| shows | list→detail→custom `position:fixed` modals | lg | L | + 158-hex tokenization |
| events | card→detail→all-custom modals | lg | L | no nav stack today |
| customer-service | thread state-machine + hand-rolled bubbles/modals | lg | L | ticket detail → panel |
| book | master-detail + many `openModal` forms | lg | L | high `openModal` count to convert |

## Exceptions to review (likely NOT slide-out — log the call)
| Module | Why it may stay as-is | Proposed |
|---|---|---|
| blog | full-page rich editor (builder) | **Builder stays full-page**; use slide-out only for quick-view/create + image picker |
| newsletter | full-page compose (builder) | same as blog |
| lookbooks | full-page document builder | same; share-link panel → slide-out |
| composer | single-page draft editor (builder) | same; create/pick → slide-out |
| mapping | multi-step **setup wizard** | **Wizard stays full-screen flow** (not a record); just make it dismissible/non-blocking |
| marketing-calendar | read-only aggregator; click → source module | no own record surface → **N/A** |
| financials | read-only report (overlaps finance) | no edit surface → **N/A** (consider merging into finance) |

| *import flows* (any module) | multi-step **import wizard** ([13](13-data-import-export.md)) | **Wizard stays a flow** (template → map → validate → confirm → result), not a slide-out — same category as mapping |

*Decision rule for exceptions:* a surface stays non-slide-out only if it's a **page-sized builder**, a **multi-step wizard**, or an **import flow** (not a single record). Everything else converts. Each exception above is logged here per [02 §1](02-standard.md); add new ones to this table with a one-line reason rather than diverging silently.

## Suggested order of execution
1. **Wave 0** — component + email-log + orders + customers (locks the template + proves expand/tiers/light-mode).
2. **wholesale early** (it's already a drawer — fastest "rogue → shared" win and a good demo).
3. **Wave 1** in a batch (mechanical; big visible coverage fast).
4. **Wave 2**, then **Wave 3** (sequence the overlay-heavy ones last; pair finance/shows conversion with their color-token work).
5. Resolve **Exceptions** explicitly (builders/wizards) once the record pattern is everywhere.

## Tabs (do this during each module's conversion)
Converting a module to the slide-out is the moment to also fix its tabs per [10-tab-and-navigation-hierarchy.md](10-tab-and-navigation-hierarchy.md): move **detail (L2) tabs into the panel**, collapse module switching onto **one L1 `mastTabs`**, and convert any "filtering" tabs to pills. Heaviest detail-tab users to de-nest: customers (48), events (18), channels (14), shows (12), procurement (11), orders (7). `subView`-mechanism users to normalize: wholesale (51), book (24), shows (17), fulfillment (17), finance (16), team (12).

## Lists (do this during each module's conversion)
Apply [11-list-standard.md](11-list-standard.md) per module: pick **table vs card** by the rule (most card-for-data → table), normalize to the single-row anatomy + standard toolbar, **remove inline-expand-for-detail** (→ slide-out; keep expand only for grouping), **retire in-row field editing** (campaigns, commission-terms, brand, channels Paradigm-A-in-page → slide-out edit mode; keep only inline *actions* — status control + ⋯ menu), collapse `list→detail→edit` to read⇄edit panel modes, and fix large-list handling (no silent `limitToLast(200)` caps). Heaviest: card-for-data → table on channels (46), events (28), customer-service (27), shows (25), sales (18), procurement (15), social (14); expand-for-detail → slide-out on book (34), team (33), finance (31), consignment/contacts/maker (14), fulfillment/orders (10).

## Edit flow & dirty state (free with the slide-out)
Because the slide-out wires `MastDirty` + the discard guard centrally ([08](08-slideout-component-spec.md), [12](12-edit-flow-and-dirty-state.md)), converting a module to it **fixes its dirty handling automatically** — every edit panel gets Cancel + Save, a baseline snapshot (no lost input), and a `mastConfirm` prompt on close/backdrop/Esc/Back/nav when dirty. Per module: just confirm Cancel/Save present, ensure no full-re-render mid-edit, and drop any hand-rolled dirty flag / `window.confirm`. Modules with no dirty handling today (and the contacts lost-input bug) are resolved by the conversion.

## Tracking
- Re-run the grep passes in [01](01-signal-matrix.md): target **0** new `openModal`-for-records / `position:fixed` / `translateX` overlays outside the shared component.
- Each converted module re-graded on A2/A3 (and verified in **both** themes) before it's marked done.
