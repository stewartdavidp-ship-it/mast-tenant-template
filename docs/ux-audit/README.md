# Mast Operator Dashboard — UX Consistency Audit

A rating system + evaluation + standard + migration plan for the operator dashboard SPA (`app/`, 41 active modules). **Review/document only — no code was changed.**

Scope: the operator dashboard at `app/` (modules in `app/modules/*.js`). Out of scope: the customer storefront (`/*.html`) and the platform-admin React app. `show-light.js` is excluded (deprecated).

Method: an objective **code-signal pass** (grep across all 41 modules for shared-helper / token adoption) + **qualitative scoring** against a weighted rubric + a **live visual pass** in Chrome (tenant `sgtest15`, dark mode) to calibrate look-and-feel vs. structure.

## Documents
1. **[00-rubric.md](00-rubric.md)** — the rating system: dimensions A1–E2, weights (sum 100), 0–4 scale, scoring formula, grade bands. Grounded in the standards the shell already ships.
2. **[01-signal-matrix.md](01-signal-matrix.md)** — objective grep counts per module (shared-helper adoption, hardcoded hex, inline styles, rogue overlays). Doubles as the regression dashboard.
3. **[03-scorecards.md](03-scorecards.md)** — the ranking table + a condensed scorecard for every module, plus live visual observations.
4. **[02-standard.md](02-standard.md)** — the proposed **best common standard**, harvested from the top-scoring modules and shell helpers, incl. the detail/edit decision tree and terminology lexicon.
5. **[04-divergence-and-plan.md](04-divergence-and-plan.md)** — where inconsistency lives and a phased migration plan (with CI guardrails) to converge on the standard.
6. **[06-professional-polish.md](06-professional-polish.md)** — beyond consistency: concrete ways to make the UI more *professional/crafted* (icons vs emoji, number formatting, badge refinement, motion, a11y), with a highest-leverage shortlist.
7. **[07-orders-north-star.md](07-orders-north-star.md)** + **[orders-north-star.html](orders-north-star.html)** — a before→after spec and a live, openable mock of the Orders list (dark + light toggle) as the visual north star for the polish pass.

### Plan in motion — surface standardization
8. **[05-surface-decision-record.md](05-surface-decision-record.md)** — ✅ decision: every record opens in **one shared slide-out** (responsive: width tiers + expand-to-full + mobile sheet). Replaces today's modal/inline-card/slide-out/page-replace mix.
9. **[08-slideout-component-spec.md](08-slideout-component-spec.md)** — the `mastSlideOut` v2 component spec (API, tiers, modes, deep-link, a11y, dirty-guard).
10. **[09-conversion-inventory.md](09-conversion-inventory.md)** — every module's current surface → slide-out, with effort, size, waves, and logged exceptions (builders/wizards).
11. **[10-tab-and-navigation-hierarchy.md](10-tab-and-navigation-hierarchy.md)** — the tab standard: four nav levels (sidebar / module tabs / detail tabs / pills), one `mastTabs` component, max two tab bars, no nested tabs.
12. **[11-list-standard.md](11-list-standard.md)** — the list standard: table-vs-card rule, one row anatomy, expand/collapse only for grouping (detail → slide-out), the standard toolbar, large-list handling, the controls contract, inline-editing policy, and the list→detail→edit collapse.
13. **[12-edit-flow-and-dirty-state.md](12-edit-flow-and-dirty-state.md)** — the edit-flow contract: always-present Cancel/Save, baseline snapshot, and one `mastConfirm` dirty guard that fires on every exit path (including clicking outside the panel) when dirty.
14. **[13-data-import-export.md](13-data-import-export.md)** — *tabular* data in/out: one `↓ Export` control (shared Papa/SheetJS exporter, scope-aware, injection-safe), one import wizard (template → map → validate → confirm → result), canonical file formats, and round-trip symmetry.
15. **[14-media-file-and-os-controls.md](14-media-file-and-os-controls.md)** — images, files & OS-level interactions: one `mastImagePicker` + `mastFileUpload`, shared copy/print/camera helpers, drag-drop, downloads & external-link safety, validation, both modes.

### Architecture — make the standard self-enforcing
16. **[15-standard-engines.md](15-standard-engines.md)** — strategy: extend the MastFlow (workflow-engine) pattern into a schema-driven UI layer. A keystone **Entity Engine** (+ Form/List/Filter) generates on-standard list + slide-out + import/export from one schema, plus Report/Action/Permission/Wizard/Dashboard engines — so the standards become the *output of an engine*, not 41 modules' discipline.

## Headlines
- **Platform average ≈ 42/100 (Grade D).** Distribution: 0 A · 4 B · 5 C · 13 D · 19 F.
- **Brand/visual layer is consistent** (shared fonts, dark theme, accent, sidebar). The pain is in **interaction & structure**: navigation/back, hand-rolled overlays, sort, `.data-table`, dialogs, color tokens.
- **Reference modules to copy:** orders (navigation), customers (lists + read→edit), book (master-detail + modal forms), procurement (filters + KPI), email-log (slide-out).
- **🚩 Light mode is broken at the shell level** — sidebar nav labels go invisible in light mode (the app defaults to dark, masking it). Every screen must work in **both** dark and light; this is a Phase-1 blocker. See [02 §4b](02-standard.md).
- **Top fixes, in order:** fix light mode in the shell, kill hand-rolled overlays, fix broken back-navigation, kill `window.confirm`, add sort/`.data-table`, tokenize color for both modes. Phase 1 is mostly mechanical and high-visibility.

*Audit run 2026-05-30.*
