# The Mast Common Standard (proposed v1)

The "best common standard" the audit is meant to converge on. It is **not invented** — it is harvested from the modules that already score highest (`orders`, `customers`, `book`, `procurement`, `email-log`) and from the shared helpers the shell already ships. Adopting it is mostly *deleting bespoke code in favor of platform helpers*, not net-new design.

Each rule cites the rubric criterion it satisfies and the module to copy from.

---

## 1. Opening a record — ONE surface: the slide-out (A1, A2, A3)

**Decision ([05-surface-decision-record.md](05-surface-decision-record.md), accepted 2026-05-30): every record opens in ONE shared slide-out.** View, edit, and create all use the same right-side panel. Center modals, inline cards/expand, page-replace "New" forms, custom `translateX` panels, and rogue `position:fixed` overlays are **all retired** in its favor. Full component spec: [08-slideout-component-spec.md](08-slideout-component-spec.md).

The slide-out is **responsive so it fits everything** — that's what lets it be the *only* method:

| Aspect | Rule |
|---|---|
| **Modes** | `read` (view), `edit` (form), `create` (form) — one panel, mode swaps in place; `MastDirty` guards unsaved edits |
| **Width tiers** | `sm` ≈420px (quick view / short form), `md` ≈640px (standard record), `lg` ≈900px (rich, multi-section). Declared per screen — a fixed set, not ad-hoc widths |
| **Expand** | a **⤢ Expand-to-full** control maximizes the *same* panel for the richest records (orders-class) — no separate page pattern |
| **Mobile** | becomes a full-screen sheet automatically below tablet width |
| **Deep drill** | navigate *within* the panel (panel-local back); **never** stack drawer-on-drawer |
| **Deep-link** | `#route?id=…` opens the list with the panel open; reload/share works |
| **Chrome** | one open/close/animation contract; Esc to close, `MastOverlayNav` Back-button support, focus trap, dims (not hides) the list |

**Carve-out (not a record surface):** `mastConfirm` / `mastAlert` / `mastPrompt` stay — they are confirmations/messages, not records. Everything that *is* a record goes through the slide-out.

**`list → detail → edit` collapses to modes, not screens.** Row click opens the panel in **read**; an **Edit** button swaps the *same panel* to **edit**; Save→read, close→list. Create opens directly in create mode. One navigation, two/three modes — not separate detail and edit destinations. **No inline *field* editing in lists** (typing in a cell); field editing is the panel's edit mode. Inline *actions* (a status control, the row ⋯ menu) are allowed — see [11 §Inline editing](11-list-standard.md).

**Hard rules:**
- **Never hand-roll `position:fixed` overlays or `translateX` panels.** Every rogue overlay (shows ×7, maker ×7, finance, events, trips, wholesale, accounting backfill, advisor capture, audit "Ask Mast") moves to the shared slide-out. This is the most common A3 violation.
- **No more "open in a modal" for records, no inline card/expand, no page-replace "New" forms** (team/studio/students/brand). All → slide-out modes.
- **Every panel has a clear close + the list stays in context behind it.** Cross-module entry still returns correctly via `MastNavStack`/`MastOverlayNav` — no dead-ends. (Worst current offenders: accounting, brand, advisor, mapping, trips, studio.)
- **No blocking interstitials that can't be dismissed** (the `mapping` "Set up your audit" screen).
- **Exceptions are allowed but must be logged.** Page-sized *builders* (blog/newsletter/lookbook/composer editors) and multi-step *wizards* (mapping setup) are candidate exceptions — record each in [09](09-conversion-inventory.md) with a reason rather than silently diverging.

### 1a. Tabs & the navigation hierarchy
Full rule: [10-tab-and-navigation-hierarchy.md](10-tab-and-navigation-hierarchy.md). In short: **four nav levels, each one mechanism** — L0 sidebar (destinations) · L1 module tabs (facets of a workspace) · L2 detail tabs (sections of a record, *inside the slide-out*) · filter pills/segmented (scoping a list — **not** tabs). **At most two tab bars in view (L1 + L2); never a third.** Moving record detail into the slide-out de-nests L1/L2 automatically. One shared `mastTabs` component (retire `.view-tabs`/`.tab-btn`/`subView`/route-per-facet sprawl); tab state in the URL; pick sidebar-vs-tabs-vs-pills by intent, consistently.

---

## 2. Lists & data display (B1–B4)

> Full list design rule (table-vs-card, single-row anatomy, expand/collapse rule, standard toolbar, large-list handling): [11-list-standard.md](11-list-standard.md). The table below is the summary.

| Rule | Standard | Copy from |
|---|---|---|
| **B1 Tabular data uses `.data-table`** | Not bespoke inline-styled `<div>`/`<table>` grids. Cards are allowed *only* for genuinely non-tabular, visual content (and should still be consistent). | `customers`, `orders`, `email-log` |
| **B2 Lists are sortable** | Interactive column headers via `mastSortableTh` + `mastSortRows`, with a visible sort indicator. Any list >~10 rows must sort. | `customers`, `orders`, `email-log` |
| **B3 Filtering uses the shared pills** | `mastRenderFilterPills()` + hidden `<select>` as the single source of truth (don't render pills *and* a separate control). Search box where the set is large. Reflect filters in the URL (see A4). | `orders`, `procurement` |
| **B4 Status uses `.status-badge`** | One badge component + the shared status-color constants. No inline-styled colored `<span>`, and **no mixing styles within a screen** (the Finance AR "plain text vs pill" case). | `orders`, `customers` |

**A4 deep-link/URL state:** filters, selected sub-view, and selected record belong in the hash (`#route?status=…&id=…`) so reload/back/share works. `orders`, `customers`, `procurement`, `production` already do this — make it universal.

---

## 3. Interaction & states (C1–C5)

| Rule | Standard | Notes |
|---|---|---|
| **C1 Dialogs** | `mastConfirm` / `mastAlert` / `mastPrompt` only. **Zero `window.confirm/alert/prompt`.** | Still live in ~15 modules: customer-service, advisor, orders, accounting, finance, audit-feedback, channels, maker, team, campaigns, composer, engagement-inbox, lookbooks, newsletter, sales, brand. Destructive actions must be gated. |
| **C2 Feedback** | `showToast(msg, isError)` for every success/failure. | Already near-universal — keep. |
| **C3 Form fields** | `.form-group` / `.form-label` / `.form-input`. No inline-styled inputs; no module-prefixed variants (`ev-`, `sl-`). | Copy `book`, `events` (137–151 uses). |
| **C4 Empty states** | `.empty-state` (icon + message + optional CTA). | Almost unused platform-wide — biggest C-gap. |
| **C5 Loading states** | `.loading` spinner during every async fetch / long op (incl. PDF/CSV gen — lookbooks/finance don't). | |

---

## 4. Visual & language (D1–D4)

- **D1 Color = tokens, never hex.** All color via `var(--amber)`, `var(--teal)`, `var(--card-bg)`, `var(--charcoal)`, `var(--danger)`, etc. Status colors come from the shared status-color constants, not per-module hex maps (`SHOW_STATUS_COLORS`, `EVENT_STATUS_COLORS`, `ORDER_STATUS_BADGE_COLORS`, `STATUS_COLORS`). *Visual note:* hardcoded hex doesn't always look broken on dark today, but it (a) **diverges between modules** — each picks its own blue/green — and (b) is a dark-mode landmine. Worst debt: finance (320), shows (158), orders (108), wholesale (68), advisor (64), channels (59). Gold standard: `studio` (2 hex / 100 tokens).
- **D2 Buttons** = `.btn` + semantic variant (`-primary` amber, `-secondary`, `-danger`, `-success`). No inline-styled buttons.
- **D3 Typography** = inherit the shell (Cormorant headings, DM Sans body, Archivo brand). No rogue sizes. *This is already consistent — protect it.*
- **D4 Terminology lexicon** — one verb per action, everywhere:

  | Action | Use | Don't use |
  |---|---|---|
  | Persist edits to existing record | **Save** | Update, Submit, Apply |
  | Make a new record | **Create** | Add (for entities), New + inconsistent |
  | Add a child/line to a parent | **Add** (e.g. "Add line", "Add note") | Create (for sub-items) |
  | Abandon an edit/modal | **Cancel** | Close, Back (for forms) |
  | Leave a read view | **← Back to {List}** | Close, generic Back |
  | Remove permanently | **Delete** (always `mastConfirm`-gated) | Remove (reserve for de-linking) |

  Worst drift: `finance` (Save/Submit/Apply/Post mixed), `maker` (Submit/Publish/Apply), `team` (Add Entry/Save Entry/Record Usage). Domain verbs (Publish, Reconcile, Void, Advance) are fine where they carry real meaning — just use them consistently.

---

## 4b. Dark + Light parity (D-mode) — **first-class requirement**

The dashboard ships **both** themes (defaults dark; honors `localStorage['mast-admin-dark']`, toggles a `dark-mode` class). **Every screen must be fully usable and on-brand in BOTH modes.** This is not optional polish — it is a correctness requirement, and it is the real reason hardcoded color is a defect.

**Live finding (2026-05-30, tenant `sgtest15`): light mode is currently broken at the shell level.** With the light preference applied, the **sidebar navigation labels become invisible** (light text on a light background — only the emoji icons render), and active filter/period pills go white-on-white. Because the app defaults to dark, this has been masked. *This is a platform blocker, above any single module's score.*

**Rules:**
- **Color comes from tokens that are defined for both modes.** `:root` sets light values; `body.dark-mode` overrides. A hardcoded hex (or a foreground color that doesn't pair with its background token) is exactly what breaks one mode — a value tuned for dark fails on light and vice-versa.
- **Foreground/background always move together.** Never hardcode text color (e.g. `#fff`/`--on-dark`) on an element whose background is a mode-switched token. The sidebar regression is this bug.
- **Status/semantic colors** must have both-mode-safe token pairs (the shared status-color map), not per-module hex.
- **Every change is verified in both modes before merge** — flip the theme and confirm legibility, contrast, and that nothing disappears. The reference modules (orders/customers) should be the both-mode baseline.
- **Fix order:** the shell sidebar/pills light-mode regression first (it blocks the whole light theme), then the per-module hardcoded-hex debt (finance, shows, wholesale, channels, accounting, team, maker).

---

## 5. Quality (E1, E2)
- **E1 Accessibility:** labels tied to inputs, focusable controls, Escape-dismissible overlays (`MastOverlayNav` gives Back-button support — extend to keyboard), semantic markup. Weak nearly everywhere; raise the floor as modules are touched.
- **E2 Responsive/density:** verify no right-edge clipping at common laptop widths (seen on Orders/Finance/Dashboard at ~1475px). Consistent spacing scale.

---

## "Definition of consistent" — the one-screen checklist
A screen is on-standard when:
1. Tabular data → `.data-table`, sortable, `.status-badge`, filter pills, URL-reflected.
2. Opening a record uses the **right** surface (page / Paradigm-A / slide-out / modal) per §1 — never a hand-rolled overlay.
3. There is a **Back affordance that returns to the launching screen** via `MastNavStack`.
4. Dialogs are `mastConfirm/Alert/Prompt`; feedback is `showToast`; empty/loading use `.empty-state`/`.loading`.
5. Inputs use `.form-group`; buttons use `.btn-*`.
6. Color is `var(--…)`; action labels follow the §4 lexicon.
7. **Verified legible and on-brand in BOTH dark and light mode** (§4b) — nothing disappears when the theme flips.
8. **Tabs follow the hierarchy** (§1a): one `mastTabs` component, at most two tab bars (L1 module + L2 detail-in-slide-out), URL-reflected; filtering uses pills, not tabs.
9. **List follows the list standard** ([11](11-list-standard.md)): table-vs-card by the rule, single-row anatomy, expand only for grouping (detail → slide-out), standard toolbar, large lists paginate/load-more with no silent caps.
10. **List controls + edit model** ([11](11-list-standard.md)): row click → slide-out (read); line actions in one ⋯ menu; **no inline field editing**; `list → detail → edit` is read⇄edit modes of the one panel, not separate screens.
11. **Edit flow + dirty state** ([12](12-edit-flow-and-dirty-state.md)): Cancel + Save always present; baseline snapshot, no mid-edit re-render; **`mastConfirm` discard guard on every exit path (incl. clicking outside the panel) when dirty**, silent when clean; one `MastDirty` mechanism, wired by the slide-out.
12. **Data import/export** ([13](13-data-import-export.md)): `↓ Export` header action (shared Papa/SheetJS exporter, scope = filtered/selected, canonical formats, injection-safe); imports use the one wizard (template → map → validate → confirm → result); export/import symmetric.
13. **Media / file / OS controls** ([14](14-media-file-and-os-controls.md)): one `mastImagePicker` (library/upload/camera/paste/drag + alt-text), one `mastFileUpload` dropzone, shared copy/print/camera helpers; type/size validation, safe URLs, progress + result toast; both modes.
