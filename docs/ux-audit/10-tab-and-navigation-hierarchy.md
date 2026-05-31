# Tabs & the Navigation Hierarchy (standard)

Companion to [02-standard.md](02-standard.md). Tabs have drifted: ≥5 implementations (`switchXxxTab`, `subView`, `detailTab`, `activeTab`, `.view-tabs`/`.tab-btn`, plus separate hash routes), and nested tabs (module-level + detail-level on the same page) appear in many modules. This defines one hierarchy, one tab component, and a hard depth limit.

## The 4-level navigation hierarchy — each level has ONE mechanism

| Level | Mechanism | Purpose | Example |
|---|---|---|---|
| **L0 — Sidebar** | left rail (sections + items) | the primary IA; switch *modules / destinations* | Dashboard · Products · Sales › Retail Orders |
| **L1 — Module tabs** | one tab bar at the top of the module | switch between *facets/lenses of the same workspace* | Customers · Duplicates · Team's Roster/Time Clock/PTO… · Finance AR/AP/P&L |
| **L2 — Detail tabs** | one tab bar **inside the slide-out panel** | sections of a single record | an order's Overview · Items · Activity |
| *(not tabs)* | **filter pills** / **segmented control** | filter or scope a list — *not* switch content | Orders status pills; All/Direct/Etsy source toggle |

**The depth rule: at most TWO tab bars in view at once — L1 (module) and L2 (detail).** Never a third. And because detail tabs (L2) now live **inside the slide-out** ([05](05-surface-decision-record.md)), they sit on a different plane from L1 — so the old "module sub-tabs *and* detail sub-tabs stacked on one page" nesting **dissolves**. That's the main fix: moving record detail into the slide-out de-nests tabs automatically.

## Rules
1. **One tab component, one style** everywhere (L1 and L2): same height, same active treatment (underline + weight), same hover, theme-correct in both modes. Retire `.view-tabs` / `.tab-btn` / `nav-tab` / ad-hoc variants in favor of a single `mastTabs`.
2. **Max two tab levels** (L1 + L2). No tabs-inside-tabs-inside-tabs. If a record's L2 tabs themselves need sub-sections, use in-panel sections/accordion, not a third tab bar.
3. **Tabs reflect in the URL** — L1 as `#route?tab=…` (restorable on reload/back); L2 as panel state in the slide-out's deep-link.
4. **Pick the mechanism by intent** (stop mixing them for the same job):
   - Switching **destinations** a user thinks of as separate places → **sidebar** (L0).
   - Switching **facets of one workspace** (same toolbar/header context) → **L1 tabs**. *This is where finance's separate `#finance-*` routes and team's tabs and any sidebar-sub-item-that's-really-a-facet should converge.*
   - Switching **sections of one record** → **L2 tabs inside the slide-out**.
   - **Filtering/scoping a list** → **filter pills** (`mastRenderFilterPills`); **mutually-exclusive scope toggle** → **segmented control**. Neither is a tab.
   - **Sequential steps** (setup, multi-step create) → a **wizard/stepper**, not tabs.
5. **Count sanity:** if L1 exceeds ~6 tabs, reconsider — promote some to sidebar items or group. (Team's 6 is the practical ceiling.)
6. **No tab is a dead-end:** switching tabs must not lose unsaved edits without a `MastDirty` prompt, and must not reset filters/scroll unexpectedly.

## Current-state inventory (from grep; for conversion)
- **Heaviest detail-tab users → move L2 into the slide-out:** customers (48), events (18), channels (14), shows (12), procurement (11), orders (7).
- **`subView` mechanism (should become L1 tabs or stay as deep-link facets):** wholesale (51), book (24), shows (17), fulfillment (17), finance (16), team (12), show-light* (deprecated).
- **Five different tab implementations in play** — unify on one `mastTabs`.
- **Mechanism mismatch to resolve:** Sales (Retail/Custom Orders/Returns) are **sidebar sub-items**, while Customers (Customers/Duplicates) and Team (6 areas) are **L1 tabs**, while Finance areas are **separate hash routes**. Decide each against rule #4 and apply consistently.

## How this interacts with the slide-out plan
- L2 (detail) tabs are part of the slide-out content spec ([08](08-slideout-component-spec.md)) — a record panel may show an L2 `mastTabs` bar; same component, inside the panel.
- Converting a module to the slide-out is the natural moment to (a) move its detail tabs into the panel and (b) collapse its module-level switching onto one L1 `mastTabs`. Fold this into each module's row in [09-conversion-inventory.md](09-conversion-inventory.md).

## Conformance (add to the per-screen checklist)
- Module switching uses **one** mechanism, chosen per rule #4 — not a mix.
- At most **two** tab bars visible (L1 + L2); L2 lives in the slide-out.
- Tabs use the shared `mastTabs` component; active state + both-mode legibility verified.
- Tab state is in the URL; switching tabs guards unsaved edits.
- Filtering uses pills/segmented, **not** tabs.
