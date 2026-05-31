# Edit Flow & Dirty-State Control (standard)

Companion to [02-standard.md](02-standard.md), [08-slideout-component-spec.md](08-slideout-component-spec.md), [11-list-standard.md](11-list-standard.md). Today dirty handling is inconsistent: `MastDirty` exists in the shell but isn't used everywhere, some edit views have **no Cancel**, some give **no unsaved-changes warning**, and some **lose in-flight input on re-render** (e.g., contacts). This makes it consistent and *automatic* — the slide-out wires it so modules can't diverge.

## The edit-flow contract (every edit / create panel)
- **Footer is always present:** `Cancel` (secondary) + primary `Save` (edit) / `Create` (new), per the terminology lexicon ([02 §4](02-standard.md)). **Never** "Close"/"Back" as the form-abandon control — that's `Cancel`.
- **On entering edit:** take a **baseline snapshot** of all field values. Dirty = any field differs from baseline; Cancel reverts to baseline cleanly.
- **Do not full-re-render the panel while editing** — re-rendering wipes in-flight input (the contacts bug). Update in place; re-render only on Save/Cancel.
- **Save:** validate → persist → `showToast` success → return to **read** mode (edit) or close + return to list (create). On error: **stay in edit, keep entered data, show inline error** (don't lose the user's work).
- **Cancel:** if clean → revert to read / close immediately. If dirty → fire the discard guard (below).

## Dirty guard — fires on EVERY exit path
When the panel is in `edit`/`create` mode **and dirty**, intercept the exit and prompt with **`mastConfirm`** — *"Discard unsaved changes?"* · **Discard** / **Keep editing**. Exit paths that must be guarded:

| Exit path | Guard |
|---|---|
| Footer **Cancel** | ✅ |
| **× close** button | ✅ |
| **Backdrop click** (clicking the dimmed list / outside the panel) | ✅ ← *this is the "moved focus out of the slide-out while dirty" case* |
| **Esc** key | ✅ |
| Browser **Back** (`MastOverlayNav`) | ✅ |
| Switching to **another record / mode** within the panel | ✅ |
| **Route change / sidebar nav / tab switch** (`MastDirty.checkAndExit`) | ✅ |
| Window/tab close | ✅ optional `beforeunload` |

**Clean (not dirty) → exit silently, no prompt.** Never prompt when there's nothing to lose.

## Visual dirty signal
- The `Save` button reflects dirty state (the existing `.btn.dirty::before` bullet) and/or is enabled only when dirty.
- Optional subtle **"Unsaved changes"** label in the footer next to the buttons.

## One mechanism — wired by the slide-out (don't hand-roll)
- The slide-out ([08](08-slideout-component-spec.md)) **registers `MastDirty` on entering edit/create and clears it on exit**, and routes **all** exit paths above through the single `mastConfirm` guard. A module supplies `onSave` (and optionally an `isDirty`/baseline hook) — it does **not** write its own dirty flag, its own Cancel wiring, or its own confirm.
- **`window.confirm` for discard is banned** (it's banned platform-wide, [02 §3](02-standard.md)) — the guard is always `mastConfirm`.
- This retires the per-module dirty flags and the modules with **no** dirty handling at all.

## Conformance (per-screen checklist additions)
- Edit/create panel has **Cancel + Save/Create**, lexicon-correct, in the footer.
- **Baseline snapshot** on edit-enter; **no full re-render** mid-edit (input never lost).
- **Dirty guard fires on close / backdrop / Esc / Back / nav / tab-switch / record-switch**; clean exits are silent.
- Discard prompt is **`mastConfirm`**, never `window.confirm`.
- Save error keeps the user's entered data and shows an inline error.
- **Manual test:** open edit → change a field → click outside the panel → expect the discard prompt; Save → toast + read mode; Cancel-while-dirty → prompt.
