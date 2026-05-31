# Shared Slide-Out Component — Spec (`mastSlideOut` v2)

The single surface for opening any record (view / edit / create), per [05](05-surface-decision-record.md) + [02 §1](02-standard.md). Extends the existing `mastSlideOut` (already used by `email-log.js`) rather than starting fresh. **Spec only — no code in this session.**

## Goal
One component, one contract, used everywhere. A developer should never decide *how* a record opens — only *what content* and *what size*.

## Public API (proposed)
```js
const panel = mastSlideOut.open({
  id:        'order:SGTE-0188',     // stable key; drives deep-link ?id= and de-dupe
  title:     'Order SGTE-0188',     // header title
  subtitle:  'Placed · May 1',      // optional
  size:      'lg',                  // 'sm' | 'md' | 'lg'  (default 'md')
  mode:      'read',                // 'read' | 'edit' | 'create'
  expandable:true,                  // show ⤢ expand-to-full control (default true for 'lg')
  badges:    [{label:'Placed', tone:'amber'}],   // optional header status badges
  actions:   [{label:'Edit', primary:false, onClick}], // header/footer action buttons
  render:    (ctx) => htmlOrNode,   // body; ctx exposes setMode, setDirty, close, navigate
  onSave:    async (ctx) => {...},  // edit/create submit; resolves → toast + close/return to read
  onClose:   () => {...},           // cleanup
});
```
Mode transitions happen **in place**: `ctx.setMode('edit')` swaps the body without closing/reopening. `create` and `edit` share the form renderer.

## Width tiers (fixed set — not ad-hoc)
| Tier | Width | For |
|---|---|---|
| `sm` | ~420px | quick view, short form, single action |
| `md` | ~640px | standard record (default) |
| `lg` | ~900px | rich, multi-section record |
| *expanded* | full-screen | `lg` records that need it (orders-class), via ⤢ |
| *mobile* | full-screen sheet | auto, below ~768px |

Widths are tokens; no per-module pixel values.

## Behavior contract (centralized — every panel gets these free)
- **Open/close animation:** one easing + duration (~180ms ease-out) for slide + dim. Centralized so motion is uniform (06-C14).
- **Backdrop:** dims the list (does **not** hide it); click-backdrop closes (with dirty-guard).
- **Esc** closes (dirty-guard); **focus trap** inside the panel; focus returns to the trigger row on close (A11y, 06-B16/E1).
- **Back button:** registers with `MastOverlayNav` so browser-Back closes the panel instead of changing route.
- **Dirty guard (full spec: [12-edit-flow-and-dirty-state.md](12-edit-flow-and-dirty-state.md)):** entering `edit`/`create` snapshots a baseline and registers `MastDirty`; the panel routes **every** exit path — Cancel, ×, **backdrop click**, Esc, browser Back, mode/record switch, route/nav/tab change — through one `mastConfirm` discard prompt when dirty, and exits silently when clean. Clears `MastDirty` on exit. The panel never full-re-renders mid-edit (no lost input). Module supplies `onSave`; it does **not** hand-roll a dirty flag or its own confirm.
- **Footer (edit/create):** always `Cancel` (secondary) + primary `Save`/`Create`; `Save` reflects dirty state.
- **Deep-link:** open writes `#route?id=<id>`; close clears it. On load, a present `?id=` opens the list with the panel open. Reload/share reproduces state.
- **Panel-local navigation:** `ctx.navigate(nextPanelConfig)` pushes within the same panel (its own ‹ back); **never** spawn a second drawer.
- **Header:** title/subtitle + status badges (`.status-badge`) + close (×) + optional ⤢ expand.

## Content rules (so panels look consistent)
- Read mode: definition-list / sectioned layout; `.status-badge` for status; numbers right-aligned, formatted (06-B7).
- Edit/create mode: `.form-group` / `.form-label` / `.form-input` only; sectioned for `lg`.
- Loading: `.loading` skeleton inside the panel; Empty (sub-lists): `.empty-state`.
- Color from tokens (both modes); verify the panel in dark **and** light (02 §4b).

## Migration helpers (ease conversion)
- `mastSlideOut.fromModal(openModalHtml, opts)` — wrap existing modal markup into a panel during conversion.
- A thin shim so existing `email-log` calls keep working while the v2 API lands.

## Acceptance criteria
1. One component renders read/edit/create at all tiers + expanded + mobile sheet, both themes.
2. Esc/Back/backdrop/focus-trap/dirty-guard all centralized and consistent.
3. Deep-link round-trips (`?id=`).
4. No module needs its own overlay/`position:fixed`/`translateX` code.
5. `email-log` (current `mastSlideOut` user) and the two reference modules (orders, customers) run on it as the template.
