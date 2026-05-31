# Module Scorecards & Ranking

Scored against [`00-rubric.md`](00-rubric.md), anchored on [`01-signal-matrix.md`](01-signal-matrix.md) and calibrated by a live visual pass (Chrome, tenant `sgtest15`, dark mode). **41 active modules** (`show-light.js` excluded — deprecated).

> **Visual calibration — the single most important finding.** Seen live, Mast's **brand/visual layer is far more consistent than the code signals alone suggest**: every module inherits the shell's fonts (Cormorant headings, DM Sans body), dark theme, amber accent, and sidebar, so screens *look* like one product at a glance. The inconsistency that hurts is concentrated in **interaction & structure** — list vs cards, sort, the detail/edit flow, modal-vs-slide-out-vs-inline, back-navigation, and badge/color treatment. The rubric weights already lean here (Navigation 30, Lists 22), so the scores hold — but the remediation story is "unify *patterns*," not "restyle everything."

## Ranking (high → low)

| # | Module | Score | Grade | Headline |
|---|---|---|---|---|
| 1 | customers | 79 | B | Reference: sortable `.data-table`, filter/segment bar, Paradigm-A read→edit, MastNavStack |
| 2 | book | 75 | B | Reference: master-detail + modal forms, `mastSortRows`, `.form-group`, `mastConfirm` |
| 3 | orders | 74 | B | **Reference for navigation**: sort headers, URL filters, detail page + "← Back", bulk select |
| 4 | procurement | 72 | B | Reference: filter pills, KPI band, Paradigm-A vendor edit, good token use |
| 5 | campaigns | 63 | C | Modal discipline + `.data-table`; no sort, `window.confirm` |
| 6 | composer | 63 | C | Exemplary `openModal` use; no list standard, `window.confirm` |
| 7 | homepage | 58 | C | Clean inline section-edit; no back model |
| 8 | production | 56 | C | Detail-page + form-group; needs empty/loading + tokens |
| 9 | email-log | 55 | C | **Reference for slide-out**: `mastSlideOut`, sort, filter pills, category tiles |
| 10 | social | 54 | D | MastNavStack + modal; card-only, two edit patterns |
| 11 | commission-terms | 50 | D | `.data-table` + `mastConfirm`; split-pane editor, no back |
| 12 | students | 50 | D | `.form-group`, `.detail-back`; no table/sort/badges |
| 13 | wholesale | 45 | D | 🚩 custom `translateX` slide-out + `position:fixed`; 68 hardcoded hex |
| 14 | blog | 42 | D | Strong inline editor; no `.data-table`, rogue overlay, no empty/loading |
| 15 | contacts | 42 | D | Good Paradigm-A + MastNavStack; raw table, no sort, fragile re-render |
| 16 | fulfillment | 42 | D | Filter pills + sort skeleton; hand-rolled table + overlay |
| 17 | lookbooks | 42 | D | Builder flow; no table/sort, `window.confirm`, no loading on PDF gen |
| 18 | newsletter | 41 | D | Polished compose; no form-group, `window.confirm`, weak back |
| 19 | channels | 40 | D | Strong Paradigm-A + MastNavStack(17); reinvented filter pills, no `openModal` |
| 20 | shows | 40 | D | 🚩 **158 hardcoded hex + 7 rogue overlays**; custom modals |
| 21 | studio | 40 | D | Best token use (2 hex); inline-edit only, zero back nav |
| 22 | trips | 40 | D | 🚩 no MastNavStack; custom sheet/modal `position:fixed`; card+inline-expand |
| 23 | audit | 39 | F | Good 3-bucket rollup; hand-rolled "Ask Mast" modal, no nav stack |
| 24 | consignment | 37 | F | Hand-rolled payout modal; no table/sort, no form-group |
| 25 | cart | 35 | F | `.data-table` on wallet; inline-styled modal forms, no sort |
| 26 | events | 35 | F | 🚩 all-custom modals; no nav stack, no URL state, no sort |
| 27 | finance | 35 | F | 🚩 **320 hardcoded hex**; rogue overlays; mixed verbs (Save/Submit/Apply/Post) |
| 28 | sales | 34 | F | URL filters + sort skeleton; hand-rolled modal, hardcoded status colors |
| 29 | website | 35 | F | 🚩 359 inline styles; no form-group, no back model, paradigm mismatch |
| 30 | promotions | 32 | F | Modal create OK; no back, no form-group, hardcoded status colors |
| 31 | customer-service | 31 | F | 🚩 `window.confirm`; hand-rolled bubbles/modals, no `.data-table` |
| 32 | engagement-inbox | 31 | F | 🚩 no nav stack; raw table, `window.confirm`, rogue overlay |
| 33 | audit-feedback | 30 | F | 🚩 `window.confirm`; hand-rolled popovers/modals, no nav |
| 34 | accounting | 28 | F | 🚩 dead-end panel tabs, no back; `window.confirm`; hand-rolled modal |
| 35 | brand | 26 | F | 🚩 inline-edit everywhere, no form-group; no back; `window.confirm` |
| 36 | team | 26 | F | 🚩 no shared helpers; card list, inline page-replace form, no sort |
| 37 | financials | 25 | F | 🚩 fully bespoke; no shared components at all (read-only report) |
| 38 | maker | 24 | F | 🚩 **7 rogue overlays**, `window.confirm`; no list standard, mixed labels |
| 39 | mapping | 23 | F | 🚩 **blocking interstitial on load**; zero shared-helper adoption |
| 40 | advisor | 22 | F | 🚩 no nav model; read-only dashboard, hand-rolled capture modal |
| 41 | marketing-calendar | 18 | F | 🚩 read-only aggregator; no sort/filter/detail, hardcoded colors |

**Platform average ≈ 42/100 (Grade D). Distribution: 0 A · 4 B · 5 C · 13 D · 19 F.** Half the modules sit at 40 or below.

---

## Reference modules (mine these for the standard)
- **Navigation / lists / detail-page:** `orders.js` — sortable headers (`mastSortableTh`/`mastSortRows`), URL-driven filters with banner, separate detail page with "← Back to Orders" via `MastNavStack`, bulk selection.
- **Read→edit on a detail panel (Paradigm A):** `customers.js`, `contacts.js`, `procurement.js`, `channels.js` — read-only detail with an **Edit** button that toggles edit mode + `MastDirty` dirty-tracking.
- **Master-detail + modal forms:** `book.js` — consistent `openModal` create/edit, `.form-group`, `mastConfirm` on destructive actions.
- **Slide-out for transient detail:** `email-log.js` — shared `mastSlideOut`, sort, filter pills, category tiles.

---

## Condensed scorecards (all 41)

Format: `A1 A2 A3 A4 | B1 B2 B3 B4 | C1 C2 C3 C4 C5 | D1 D2 D3 D4 | E1 E2` (0–4, N=N/A).

### customers — 79 B
`4 4 3 3 | 3 4 2 3 | 4 3 2 2 2 | 3 3 2 3 | 2 2` · Flags: none
9-column sortable `.data-table` (`mastSortRows`+`mastSortableTh`), segment pills + search + filter dropdowns. Paradigm-A read→edit with snapshot dirty-tracking. `MastNavStack` back. Verbs: Create/Save/Edit/Cancel (consistent). **Best:** the interactive sortable table + Paradigm-A. **Fix:** edit fields use inline styles not `.form-group`; some inline-rgba badges.

### book — 75 B
`3 3 3 2 | 3 3 0 0 | 3 4 4 0 0 | 2 4 3 3 | 2 2` · Flags: none
`.data-table`+`mastSortRows` on classes/instructors/resources/passes. List→detail→modal-form. `MastNavStack` + `.detail-back`. Verbs: "Save Class/Instructor/Resource", "Cancel" (consistent). **Best:** canonical master-detail + modal form + 151 `.form-group` uses. **Fix:** no filter pills; some `position:fixed` incident form; 54 hex.

### orders — 74 B
`4 3 3 4 | 0 4 0 4 | 2 3 2 1 2 | 2 3 3 3 | 2 2` · Flags: 🚩 `window.confirm` (l.231,247), 108 hardcoded hex
Sortable headers, URL filters (status/date/ids) w/ banner, `MastNavStack.popAndReturn` back with return-route fallback, bulk select, `.status-badge`. **Best:** the whole navigation + sort + URL-state stack. **Fix:** `ORDER_STATUS_BADGE_COLORS` inline hex→tokens; `window.confirm`→`mastConfirm`; adopt `.data-table` shell.

### procurement — 72 B
`3 3 3 2 | 2 1 1 3 | 3 3 2 1 2 | 2 3 3 3 | 2 2` · Flags: none
Filter pills, URL filters, KPI band, Paradigm-A vendor read→edit, good `var(--)` token use. Verbs consistent imperatives. **Best:** filter pills + KPI band + Paradigm-A. **Fix:** no `.data-table`; vendor edit form not `.form-group`.

### campaigns — 63 C
`3 2 3 1 | 2 0 0 0 | 2 3 3 1 1 | 4 4 3 2 | 2 2` · Flags: 🚩 `window.confirm` (l.314)
`.data-table` but pre-sorted (no interactive sort). List→detail inline-edit, `.detail-back`+`navigateTo`. `openModal` create with `.form-group`. **Best:** modal create discipline + token use. **Fix:** add sort; `window.confirm`→`mastConfirm`.

### composer — 63 C
`2 2 4 1 | 1 0 0 0 | 3 3 3 0 1 | 4 4 3 3 | 2 2` · Flags: 🚩 `window.confirm` (l.360)
Exemplary `openModal` (image picker, attach). Inline single-page editor, `.detail-back`. **Best:** modal discipline + tokens. **Fix:** no `.data-table`/sort; `window.confirm`→`mastConfirm`; form-group.

### homepage — 58 C
`0 3 3 0 | N N N 0 | 3 2 2 2 1 | 3 3 2 2 | 2 3` · Flags: 🚩 no back-to-origin
Section-card → inline edit panel, debounced saves, toggle switches. Not list-shaped. **Best:** clean inline section editing. **Fix:** no `MastNavStack` (loses context on route change).

### production — 56 C
`2 3 3 1 | 0 0 0 2 | 3 4 3 1 0 | 1 3 3 2 | 2 2` · Flags: 28 detailView toggles, no empty/loading
List→detail page→inline edit; `mastConfirm` on transitions; URL-filter banner. **Best:** URL-filter + status-transition guards. **Fix:** no `.data-table`/empty/loading; 16 hex inline; `backToProductionList` uses display-toggle not `MastNavStack`.

### email-log — 55 C
`0 2 2 0 | 2 3 2 2 | 3 2 0 1 0 | 2 2 2 2 | 1 2` · Flags: read-only (edit N/A)
**Reference slide-out** (`mastSlideOut`), `.data-table`+`mastSortRows`, status filter pills, color category tiles. **Best:** slide-out + sort + tiles. **Fix:** don't render hidden `<select>` *and* custom tiles (pick one source of truth).

### social — 54 D
`3 2 3 2 | 0 0 1 2 | 3 3 2 2 2 | 2 2 2 3 | 2 2` · Flags: card-only, no sort
`MastNavStack`+`.detail-back`, enhance modal. Two edit patterns (modal + inline caption). Verb "Generate" non-standard. **Best:** treatment grid / destination chips. **Fix:** unify edit pattern; no list standard.

### commission-terms — 50 D
`2 1 3 0 | 2 0 0 0 | 2 3 3 0 0 | 3 3 2 3 | 2 2` · Flags: no back, no empty
`.data-table`, split-pane inline editor. "Save Draft"/"Save & Publish" clear. **Best:** `mastConfirm` publish gate. **Fix:** no back/URL state; custom status chips→`.status-badge`.

### students — 50 D
`2 2 3 2 | 0 0 2 0 | 3 3 2 2 2 | 2 2 2 3 | 2 2` · Flags: no table/sort/badges
Roster (inline divs) → `openStudentForm` page w/ `.detail-back`; grouped sections. Save/Cancel/Delete consistent. **Best:** collapsible-section form + URL-filter banner. **Fix:** `.data-table`, sort, status badges for waiver/orientation.

### wholesale — 45 D
`1 2 2 1 | 2 1 0 2 | 3 3 1 2 2 | 1 1 2 2 | 2 2` · Flags: 🚩 custom `translateX` slide-out, `position:fixed`, 68 hex, no sort
Tabbed subviews; account row → **custom slide-out modal**; no `MastNavStack`/`.detail-back`; no explicit Cancel. **Best:** URL-driven multi-subview filter state. **Fix:** replace custom overlay w/ shared modal/slide-out; tokens; back model.

### blog — 42 D
`3 4 2 2 | 0 0 0 2 | 0 4 2 0 0 | 1 2 2 2 | 1 2` · Flags: 🚩 rogue `position:fixed` viewer, no empty/loading, no `.data-table`
`MastNavStack` back; rich inline editor w/ autosave. **Best:** inline editor + AI compare. **Fix:** `.data-table`; shared overlay; tokens; loading.

### contacts — 42 D
`3 4 2 2 | 0 0 1 2 | 2 3 2 1 1 | 2 2 1 2 | 2 2` · Flags: raw table, no sort, fragile re-render
Paradigm-A read→edit, `MastNavStack` return-route. **Best:** signals section + Paradigm-A. **Fix:** `.data-table`+sort; add-contact modal `.form-group`; snapshot form state on re-render (customers does this, contacts doesn't).

### fulfillment — 42 D
`1 0 2 0 | 1 2 1 1 | 2 4 1 2 0 | 2 1 2 1 | 1 1` · Flags: hand-rolled table + overlay, 18 hex
Pack-queue filter pills + counts; `mastSortRows` if available; buy-labels `position:fixed` modal. **Best:** filter pills w/ live counts. **Fix:** `.data-table`; shared modal; form-group; empty/loading.

### lookbooks — 41 D
`2 3 2 2 | 0 0 1 0 | 1 2 2 0 1 | 1 2 2 2 | 1 2` · Flags: 🚩 `window.confirm`, no `.data-table`, no loading on PDF gen
List→builder view, `.detail-back` (no `MastNavStack`). "Save & Generate", "Re-issue link" (non-std). **Best:** PDF gen + share-token flow. **Fix:** `mastConfirm`; loading; `.data-table`; tokens.

### newsletter — 41 D
`2 2 2 1 | 1 1 0 2 | 2 3 0 0 2 | 2 2 2 2 | 2 2` · Flags: 🚩 `window.confirm`, no form-group, 155 inline styles
Issue list w/ URL filters; compose w/ contenteditable; `.detail-back` (no stack, loses scroll/filter). **Best:** A/B `<details>`, segment selector w/ live count. **Fix:** `MastNavStack`; shared rich-text; `mastConfirm`.

### channels — 40 D
`2 2 1 2 | 1 0 2 1 | 2 3 0 0 0 | 1 2 2 2 | 2 2` · Flags: reinvented filter pills, no `openModal`, 59 hex
Strong Paradigm-A edit-mode + `MastDirty` + `MastNavStack`(17). **Best:** Paradigm-A + onboarding state machine + URL-filter banner. **Fix:** use `openModal`; `mastRenderFilterPills`; tokens; form-group.

### shows — 40 D
`2 2 1 2 | 0 0 1 3 | 2 4 2 0 0 | 0 1 2 2 | 1 1` · Flags: 🚩 **158 hex + 7 rogue overlays**, no `.data-table`
List→detail→custom `position:fixed` create/edit modal; `.detail-back` (no stack); hash sub-views. **Best:** auto-computed tab badge counts; URL-filter banner. **Fix:** D1=0 — `SHOW_STATUS_COLORS`→tokens/`.status-badge`; `openModal`; empty/loading. Renders OK on dark today but is the biggest dark-mode/token liability.

### studio — 40 D
`0 1 3 0 | 0 0 0 0 | 3 3 1 1 2 | 3 2 2 3 | 2 2` · Flags: 🚩 zero back nav, card-only, no sort
Cards → inline "Edit" form replaces list; no `.detail-back`/`MastNavStack`. "Create Founder"/"Save"/"Cancel"/"Delete" very consistent. **Best:** *best D1 token discipline* (2 hex / 100 tokens); cost helpers. **Fix:** add back model; `.data-table`/sort/badges.

### trips — 40 D
`0 2 2 1 | 0 0 2 0 | 3 3 0 1 1 | 2 1 2 3 | 1 2` · Flags: 🚩 no `MastNavStack`, custom `position:fixed` sheets, form-group=0
Cards + inline expand; start/retroactive trip modals are custom overlays. Verbs consistent (Start/End Trip, Save, Cancel). **Best:** retroactive modal w/ distance calc + nudges. **Fix:** shared modal; back model; `.form-group`; keyboard access.

### audit — 39 F
`0 3 2 0 | 0 0 0 0 | 3 3 0 2 2 | 2 3 2 2 | 2 2` · Flags: 🚩 hand-rolled "Ask Mast" modal, no nav stack (read-only)
3-bucket rollup + category browse; manual back-home toggle. **Best:** quick-wins/high-impact/worth-a-look rollup. **Fix:** `openModal`; `MastNavStack`; URL state for view.

### consignment — 37 F
`3 2 2 2 | 1 2 1 1 | 2 3 1 1 1 | 2 2 1 1 | 1 1` · Flags: hand-rolled payout modal, no table/sort/form-group
Gallery detail/edit as separate views via `currentView`; `.detail-back` (no stack). **Best:** gallery/placement rollup calc. **Fix:** shared modal; `.data-table`; `.form-group`; Paradigm-A consistency.

### cart — 35 F
`0 2 2 0 | 1 0 0 2 | 3 3 0 1 1 | 2 2 2 2 | 1 1` · Flags: inline-styled modal forms, no sort
Wallet history `.data-table` (no exposed sort); gift-card/promo config via `openModal` w/ inline-styled forms. **Best:** `gcStatusBadge` helper; filter-state mgmt. **Fix:** `.form-group`; wire `mastSortRows`; no `MastNavStack`.

### events — 35 F
`1 1 1 0 | 2 0 0 3 | 2 3 2 1 0 | 1 1 2 1 | 1 1` · Flags: 🚩 all-custom modals, no nav stack/URL state/sort, 40 hex
Card list → detail (`evNavigateTo`) → custom overlay modals; module-scoped state. **Best:** multi-tab detail view. **Fix:** `openModal`; `MastNavStack`; `evStatusColor`→tokens; `.data-table`.

### finance — 35 F
`1 N 1 2 | 1 3 0 0 | 2 3 0 0 1 | 1 3 2 1 | 1 2` · Flags: 🚩 **320 hex**, rogue overlays, mixed verbs
Reporting surface (AR/AP/P&L/etc.); AR/AP sort via `mastSortRows`; `.detail-back` to `finance-ar`; no `MastNavStack`. Verbs mixed (Save/Submit/Apply/Post). **Best:** global period bar + CSV export footer. **Fix:** verb lexicon; tokens; `openModal` for expense editor; renders OK on dark but huge token debt; **two badge styles in one AR row** (plain text vs pill) — unify.

### sales — 34 F
`2 2 1 1 | 1 1 0 1 | 2 3 1 0 1 | 1 2 2 2 | 1 2` · Flags: 🚩 hand-rolled `position:fixed` modal, hardcoded status colors
List→detail toggle, sort skeleton (`mastSortableTh`), URL-filter banner; `.detail-back` no stack. Verbs: Reconcile/Void/Create. **Best:** URL-filter banner + clear button. **Fix:** `openModal`; `.data-table`; `EVENT_STATUS_COLORS`→tokens.

### website — 35 F
`1 2 2 1 | 1 0 0 1 | 0 3 0 0 2 | 1 3 2 2 | 1 2` · Flags: 🚩 359 inline styles, no form-group, no back model, paradigm mismatch
Sub-tabs (Overview/Template/Style/…); mixed inline-edit + confirm-dialog. **Best:** color-picker UI; theme fallbacks. **Fix:** `.form-group`; shared modal for category edit; back model; consolidate inline styles.

### promotions — 32 F
`0 2 1 0 | 1 0 1 0 | 1 2 2 0 1 | 1 1 2 2 | 1 2` · Flags: no back, no form-group, hardcoded status colors
List (table + mobile cards) + status filter; `openModal` create/edit (Create/Edit/Update/End/Delete). **Best:** product picker w/ search+select-all. **Fix:** `STATUS_COLORS`→tokens; `.form-group`; no `MastNavStack`.

### customer-service — 31 F
`2 2 1 1 | 0 0 2 2 | 0 4 2 1 2 | 2 2 1 2 | 1 1` · Flags: 🚩 `window.confirm`, hand-rolled bubbles/modals, no `.data-table`
Thread state-machine; `.detail-back` (no stack); inline reply compose. **Best:** consistent `showToast`; semantic status/priority badges. **Fix:** `mastConfirm`; shared modal; `.data-table`; `.form-group`.

### engagement-inbox — 31 F
`1 2 2 0 | 0 0 2 1 | 1 2 0 0 1 | 1 2 2 2 | 1 2` · Flags: 🚩 no nav stack, raw table, `window.confirm`, rogue overlay
Filter dropdowns, bulk actions delegate to customer-service; UGC `position:fixed` modal. **Best:** sentiment chips; bulk-action delegation. **Fix:** `MastNavStack`; `.data-table`; sort; `mastConfirm`; shared overlay.

### audit-feedback — 30 F
`0 0 3 0 | 0 0 0 2 | 2 3 0 0 1 | 2 3 1 3 | 1 1` · Flags: 🚩 `window.confirm`, hand-rolled popovers/modals, no nav
Suppressions list (grouped, `.status-badge`); suppress dialog from menus. **Best:** popover menu + suppress-dialog workflow. **Fix:** shared modal/popover; `mastConfirm`; `.form-group`; nav.

### accounting — 28 F
`0 2 3 1 | 0 0 0 0 | 1 3 0 0 0 | 1 2 2 2 | 1 2` · Flags: 🚩 dead-end panel tabs (no back), `window.confirm`, hand-rolled modal
QBO integration config; panel tabs only escape; backfill `position:fixed` modal. **Best:** CoA fuzzy-match; webhook status pills. **Fix:** add back/nav; `openModal`; `.form-group`; `mastConfirm`.

### brand — 26 F
`0 1 3 0 | 0 0 0 1 | 2 2 0 1 0 | 2 2 2 2 | 1 2` · Flags: 🚩 inline-edit everywhere/no form-group, no back, `window.confirm`
Tabs (Logos/Placements/Voice); inline edit in place; URL-upload modal hand-rolled. Verbs consistent (Upload/Replace/Delete/Save/Cancel). **Best:** logo-type card grid. **Fix:** `.form-group`; back model; `openModal`; tokens.

### team — 26 F
`1 2 0 0 | 0 0 1 1 | 1 3 0 0 2 | 1 1 2 1 | 1 2` · Flags: 🚩 no shared helpers, card list, inline page-replace form, no sort, `window.confirm`
7 sub-tabs; roster as cards; "+ New" → inline full-page form (no modal); compliance as inline ✓/⚠ (not `.status-badge`). Verbs mixed (Add Entry/Save Entry/Record Usage/Edit Policy). **Best:** `showToast` use; collapsible sections. **Fix:** adopt nearly everything — `.data-table`/sort, `.status-badge`, modal-or-page consistency, `mastConfirm`, `.form-group`.

### financials — 25 F
`0 N 1 0 | 0 0 0 0 | 1 3 0 1 1 | 3 0 2 2 | 1 1` · Flags: 🚩 fully bespoke, no shared components (read-only report)
Summary cards + flex transaction list, all inline styles. **Best:** integrations health card delegation. **Fix:** adopt shared list/badge/loading/empty; tokens; (overlaps `finance.js` — consider merging).

### maker — 24 F
`1 1 0 0 | 0 0 0 1 | 1 4 0 0 2 | 1 2 2 1 | 1 1` · Flags: 🚩 **7 rogue overlays**, `window.confirm`, no list standard, mixed labels
Recipes/materials/cost; mixed inline+hand-rolled modals; no `mastSortRows`. **Best:** `mastConfirm`+`showToast` feedback loop (116 toasts). **Fix:** replace `position:fixed` overlays w/ `openModal`; list standard; consistent labels.

### mapping — 23 F
`0 0 1 1 | 0 N N N | 0 1 0 0 1 | 2 1 2 2 | 1 1` · Flags: 🚩 **blocking interstitial on load** (Skip/X didn't dismiss in test), zero shared-helper adoption
Interstitial flow (welcome/auto/fuzzy/unmatched) w/ flow-step back; hand-rolled overlay; builds own `esc()`. **Best:** heuristic ignore suggestions; Jaccard title match. **Fix:** make the "Set up your audit" overlay reliably dismissible / non-blocking; adopt shared helpers; `.btn`.

### advisor — 22 F
`0 0 2 0 | 0 0 0 2 | 1 4 0 2 1 | 1 1 2 3 | 1 1` · Flags: 🚩 no nav model, hand-rolled capture modal, `window.confirm`
Read-only dashboard (health score, KPIs, renewals, captures); inline/menu actions. **Best:** score-ring + thermometer viz; period tabs. **Fix:** `openModal`; `MastNavStack` for drill-downs; tokens; `.empty-state`.

### marketing-calendar — 18 F
`0 0 0 0 | 0 0 0 0 | 0 2 0 0 1 | 0 2 2 1 | 0 1` · Flags: 🚩 read-only aggregator, no sort/filter/detail, hardcoded colors
Month/list view of cross-module events; click → source module. **Best:** multi-source aggregation/normalization. **Fix:** either embrace "info-only card" framing or add filter/detail + tokens + `.status-badge`.

---

## Visual-pass observations (live)
- **🚩 LIGHT MODE IS BROKEN AT THE SHELL LEVEL (highest-severity finding).** With the light preference applied (`localStorage['mast-admin-dark']='0'` + reload), the **sidebar nav labels become invisible** (light text on light bg — only emoji icons render) and active filter/period pills go white-on-white. The dashboard defaults to dark, which has masked this. Light mode is not usable today. This is a platform blocker above any module score — fix in the shell before the per-module color work. The dashboard *advertises* both themes, so both must work.
- **Brand consistency (in dark) is genuinely good** — fonts, dark theme, amber accent, sidebar identical everywhere. Don't over-invest in "restyling" dark.
- **Graceful 404**: unknown routes (`#finance`, `#shows`) show a clean "Page not found" + "Did you mean…" suggestions. Good pattern — keep.
- **Route namespacing is inconsistent**: some modules are one route (`#orders`, `#customers`), others are split families (`#finance-ar/-ap/-pl`, `#find-shows`/`#show-find` alias, `#events-shows`). Bare module names 404. Worth a routing convention.
- **`mapping.js` interstitial blocks the app on load** and its own Skip/X buttons didn't dismiss it in testing → highest-severity UX defect found live.
- **Right-edge clipping** at ~1475px wide on Orders (tracking col), Finance AR (action buttons), Dashboard ("View" links) → check min-width/density (E2) on smaller laptops.
- **Badge treatment varies even within a screen** (Finance AR: "Current" plain-colored text next to "sent" pill) → the `.status-badge` standard is the fix.
