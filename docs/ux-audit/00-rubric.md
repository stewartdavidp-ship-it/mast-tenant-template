# Mast Operator Dashboard — UX Consistency Rubric (v1)

**Surface under review:** the operator dashboard SPA at `app/` (45 modules in `app/modules/*.js`, shell in `app/index.html`).
**Goal:** measure how consistently each module follows a single common look, language, and interaction model — then define the "best common standard" and a plan to converge on it.
**Out of scope (v1):** the customer storefront (`/*.html`) and the platform-admin React app.

This rubric is **grounded in the standards the shell already ships.** The app is not a blank slate — `index.html` provides shared helpers and CSS classes that *are* the de-facto standard. A module "diverges" when it rolls its own version of something the platform already provides. The reference vocabulary:

| Concern | Platform-provided standard | "Divergence" looks like |
|---|---|---|
| Confirm/alert/prompt | `mastConfirm()`, `mastAlert()`, `mastPrompt()` | `window.confirm()`, `alert()`, custom yes/no overlay |
| Modal | `openModal(html)` / `closeModal()` | hand-rolled `position:fixed` overlay div |
| Slide-out | *(no shared helper — ad-hoc `translateX` panels)* | each module reinvents the drawer |
| Toast | `showToast(msg, isError)` | inline status text, `alert()` |
| Back / return | `MastNavStack`, `MastDirty`, `MastOverlayNav`, `.detail-back` | browser back only, hash hops, dead-end modals |
| List | `.data-table` | bespoke `<div>` grid with inline styles |
| Sort | `mastSortRows()` + sort-key state | no sort, or non-interactive pre-sort only |
| Filters | `mastRenderFilterPills()` + hidden `<select>` | raw `<select>` only, or no filtering |
| Status | `.status-badge` | inline-colored `<span>` |
| Empty | `.empty-state` / `.empty-icon` / `.empty-title` | inline "nothing here" text |
| Loading | `.loading` (spinner) | nothing, or "Loading…" text |
| Forms | `.form-group` / `.form-label` / `.form-input` | inline-styled inputs, module-prefixed variants (`ev-`, `sl-`) |
| Buttons | `.btn` + `.btn-primary/-secondary/-danger/-success` | inline-styled buttons |
| Color | CSS tokens `var(--amber)`, `var(--card-bg)`, `var(--charcoal)`… | hardcoded `#hex` (also breaks dark mode) |
| Type | DM Sans (body), Cormorant Garamond (headings), Archivo (brand) | ad-hoc font/size |

---

## Scoring scale (applied per criterion)

| Score | Meaning |
|---|---|
| **4** | Exemplary — a reference implementation other modules should copy. |
| **3** | Conforms — uses the platform standard correctly. |
| **2** | Mixed — partly standard, partly custom. |
| **1** | Ad-hoc — rolls its own, ignoring the platform standard. |
| **0** | Absent or actively harmful (dead-end nav, `window.confirm`, no feedback). |
| **N/A** | Criterion genuinely doesn't apply (e.g., a read-only report has no edit flow). Excluded from the denominator. |

---

## Dimensions & weights (sum = 100)

Weights reflect the priorities called out for this review (navigation/back-button, terminology, color, list controls, sort, modal-vs-slideout, inline-edit-vs-detail→edit) plus the gaps surfaced during grounding.

### A. Navigation & Flow — 30
| # | Criterion | Wt | What "3 (conforms)" means |
|---|---|---|---|
| A1 | **Back & return-to-origin** | 10 | Uses `MastNavStack` (and `MastDirty` for unsaved edits); a Back control returns to the *exact* screen that launched the view, including cross-module entry. |
| A2 | **Detail/edit flow paradigm** | 8 | Follows one consistent list → detail → edit model (see standard in 02). Edit affordance is predictable, not a mix of inline/modal/page within the module. |
| A3 | **Modal vs slide-out discipline** | 7 | Uses shared `openModal`/`mastConfirm` for transient tasks; any slide-out is intentional and consistent — no rogue `position:fixed` overlays. |
| A4 | **Deep-link / URL state** | 5 | Filters/selection/sub-view reflected in hash params and restorable on reload/back. |

### B. Lists & Data Display — 22
| # | Criterion | Wt | "3" means |
|---|---|---|---|
| B1 | **List/table standard** | 6 | Uses `.data-table` (or a deliberate, consistent card pattern) rather than ad-hoc inline-styled grids. |
| B2 | **Sort capability** | 6 | Interactive, indicated column sort via `mastSortRows` (or documented N/A for non-tabular views). |
| B3 | **Filter & search** | 5 | Standard filter pills + search where the dataset warrants it. |
| B4 | **Status badges** | 5 | Uses `.status-badge` with the shared status-color constants. |

### C. Interaction & States — 20
| # | Criterion | Wt | "3" means |
|---|---|---|---|
| C1 | **Confirmation dialogs** | 6 | `mastConfirm/Alert/Prompt` only; destructive actions gated. Any `window.confirm/alert/prompt` caps this at ≤1. |
| C2 | **Toast feedback** | 4 | Success/error surfaced via `showToast`. |
| C3 | **Form fields** | 4 | Shared `.form-group/.form-label/.form-input`. |
| C4 | **Empty states** | 3 | `.empty-state` with icon + message (+ CTA where useful). |
| C5 | **Loading states** | 3 | `.loading` spinner during async fetches. |

### D. Visual & Language — 22
| # | Criterion | Wt | "3" means |
|---|---|---|---|
| D1 | **Design tokens / color & mode parity** | 8 | Colors come from `var(--…)` token pairs defined for **both** themes; near-zero hardcoded hex; renders correctly **and legibly in BOTH dark and light mode** — nothing disappears when the theme flips (see 02 §4b). Hardcoded hex / mode-coupled foreground caps this at ≤2. |
| D2 | **Buttons** | 4 | `.btn` + semantic variants; no inline-styled buttons. |
| D3 | **Typography** | 3 | Standard font stack & heading hierarchy; no rogue sizes. |
| D4 | **Terminology / action verbs** | 7 | Action labels match the shared lexicon (see 02): **Save / Create / Add / Cancel** used consistently; no Save-vs-Update-vs-Submit drift. |

### E. Quality — 6
| # | Criterion | Wt | "3" means |
|---|---|---|---|
| E1 | **Accessibility** | 3 | Labels tied to inputs, focusable controls, keyboard-dismissible overlays, semantic markup. |
| E2 | **Responsive / density** | 3 | Usable below tablet width; consistent spacing/density. |

---

## Computing the module score

```
applicable = criteria where score ≠ N/A
raw     = Σ (score/4 × weight)        over applicable
maxposs = Σ (weight)                  over applicable
SCORE   = round(100 × raw / maxposs)  → 0–100
```

### Grade bands
| Band | Score | Reading |
|---|---|---|
| **A** | 85–100 | Reference module — mine it for the standard. |
| **B** | 70–84 | Solid; small gaps. |
| **C** | 55–69 | Inconsistent; meaningful drift. |
| **D** | 40–54 | Largely bespoke; high reconciliation cost. |
| **F** | 0–39 | Off-standard; rebuild against the standard. |

A module can also carry **flags** (independent of score) for high-severity, user-visible issues: `🚩 window.confirm`, `🚩 dead-end nav`, `🚩 breaks in light mode`, `🚩 no sort on large list`. **Note:** light mode is currently broken at the *shell* level (sidebar nav invisible) — a platform blocker above per-module scoring; see 02 §4b and 03.

---

## Evidence sources
1. **Objective signal matrices** (`01-signal-matrix.md`) — grep counts across all 45 modules for every shared helper/class and for hardcoded hex, inline styles, and rogue overlays. Anchors B, C, D1–D2, A3.
2. **Qualitative module reads** — sampled screens per module for the judgment criteria (A1, A2, A4, B-applicability, D4, E). Recorded in each scorecard.
