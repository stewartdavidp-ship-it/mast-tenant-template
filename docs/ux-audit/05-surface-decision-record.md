# Decision Record: one surface for opening records

**Status:** ✅ Accepted (2026-05-30) — proceed with the slide-out; exceptions reviewed case-by-case as they arise (logged in [09-conversion-inventory.md](09-conversion-inventory.md)). **Date:** 2026-05-30.
**Decision driver:** today a record opens three different ways (center modal, inline card/expand, side slide-out) plus page-replace forms. Goal: **one method, used everywhere**, for view / edit / create.

## Options considered

| | Side slide-out | Modal (center) | Full detail page |
|---|---|---|---|
| Keeps list context | ✅ visible behind | ❌ blocks list | ❌ full switch |
| Rich/long records | ⚠️ cramped at narrow width | ❌ poor | ✅ best |
| Edit + create in same surface | ✅ | ⚠️ nested-modal pain | ✅ |
| Deep-linkable (`?id=`) | ✅ | ❌ awkward | ✅ |
| Deep drill chains | ⚠️ avoid drawer-on-drawer | ❌ | ✅ back-stack |
| Quick peek cost | ✅ low | ✅ low | ❌ high (loses list) |
| Reuses existing code | ✅ `mastSlideOut` | ⚠️ `openModal` | ⚠️ route + nav |
| Mobile | ✅ → full sheet | ⚠️ cramped | ✅ |
| Net "feels modern" | ✅✅ | ➖ | ➕ |

**Inline cards/expand** excluded — clutters the list, weak for rich detail, no deep-link, focus/a11y issues; this is what we're moving *away* from.

## Decision: **Side slide-out, as one responsive + expandable component**

No single *size* fits both a quick peek and a full order, so the chosen method is one slide-out component that scales — not three patterns:

1. **Default = right slide-out.** Standard **width tiers**, chosen by declared content size (fixed set, not ad-hoc):
   - `sm` ≈ 420px — quick view, short form, single action
   - `md` ≈ 640px — standard record
   - `lg` ≈ 900px — rich, multi-section record
2. **"⤢ Expand to full" control** maximizes the *same* panel to full-screen for the richest records (orders-class). Same component, no separate page pattern.
3. **Mobile/narrow → full-screen sheet** automatically.
4. **Deep drill-downs navigate *within* the panel** (panel-local back); never stack drawer-on-drawer.
5. **Deep-link**: `#route?id=…` opens the list with the panel open; reload/share works.
6. **One open/close/animation/escape contract** (centralized; `MastOverlayNav` for Back-button, Esc to close, focus trap).

### What this replaces (the mapping)
| Today | Becomes |
|---|---|
| View-in-modal | slide-out (read mode) |
| Inline card / expand-in-place | slide-out (read mode) |
| Edit-in-modal / Paradigm-A inline edit | slide-out (edit mode) |
| Create-in-modal / page-replace "New" form (team, studio, students, brand) | slide-out (create mode) |
| Custom `translateX` panel (wholesale) / rogue `position:fixed` (shows, maker, finance, events, trips…) | the one shared slide-out |
| Full detail page (orders, customers detail) | slide-out at `lg` / expanded — *or* retained as page only if review finds a record that truly needs it (decide per-module, default = convert) |

### Carve-out (not a competing surface)
`mastConfirm` / `mastAlert` / `mastPrompt` **stay** — they are confirmations/messages, not records. Anything that *is* a record (view/edit/create) goes through the slide-out.

### Why not the others
- **Modal**: blocks the list and is the worst fit for the rich records we have; nested edit-in-view is ugly. Good only for the confirm carve-out.
- **Full page everywhere**: too heavy for quick peeks, and depends on back-nav that's currently broken across many modules. The expand-to-full slide-out gives the same room without the context switch.

## Limitations we are accepting (and the mitigation)
- *Cramped rich records* → width tiers + expand-to-full.
- *Long forms* → `lg` width + sectioned/tabbed content inside the panel.
- *Side-by-side comparison* → not supported by any single surface; out of scope for v1.
- *Deep drill chains* → panel-local navigation; promote to a true page only if a specific deep flow demands it (explicit exception, logged here).

## Consequences / next artifacts (once confirmed)
1. Rewrite **02-standard §1** to collapse the four surfaces into this one component + the confirm carve-out.
2. Write the **shared slide-out component spec** (API: `open({title, size, mode, onSave})`, width tiers, expand, mobile sheet, Esc/Back/focus, deep-link contract) — extending `mastSlideOut`.
3. Build the **per-module conversion inventory**: current surface(s) → target, effort, sequence. Reference modules (orders, customers) converted first as the template.
4. Add a CI guard: no new `openModal` for *records* / no new `position:fixed` overlays outside the shared component.
