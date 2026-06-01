# 17 — The Process slide-out variant (record + lifecycle)

**Status:** ratified design (2026-05-31), engine not yet built. Supersedes the
orders-v2 status-dropdown model and the obsolete `editform-mock.html` ("Option C").
Reference subject: order **SGTE-0164** on sgtest15. Reference workflow:
`app/modules/workflows/pickship.workflow.js`.

This doc is the source of truth for the Process variant. It was agreed with the
operator through three live mocks (kept in this folder as the design record):

| File | Variant | Verdict |
|---|---|---|
| `process-slideout-mock.html` | tabs-only (data-domain tabs) | exploration |
| `process-slideout-mock-book.html` | book-only (collapsible cover + pages) | exploration |
| **`process-slideout-mock-hybrid.html`** | **tabs + book (LOCKED)** | **the target** |

---

## 1. The framing: one shell, swappable interiors

The slide-out is a **shell**; the interior is a swappable **variant**. The shell
never changes — it is everything already in `MastUI.slideOut`: the slide-in
animation, the scrim, the header (back-crumb · title · status badge · expand ·
close), the `?id=` deep-link, the dirty-guard, the focus-trap, the design tokens,
and the 7-step type scale. **What "feels like the same app" is the shell.** Only
the interior renderer differs per object type.

Variants:
- **Record** — flat grouped fields, read/edit (`_formHtml`, exists today). For
  the ~30 CRUD objects: customers, contacts, products, promotions, …
- **Process** — record **+ lifecycle** (this doc). For objects that move through
  a governed workflow: orders, commissions, RMAs, enrollments, production jobs.
- **Calendar / Schedule** — queued. Time/agenda as the spine: events, classes,
  shows, bookings, day-close.
- **Ledger / Timeline**, **Gallery / Media** — likely later, catalogued as we
  hit objects that don't fit the above.

Adding a variant is cheap and **safe by construction**: it inherits the shell and
can't drift. A new variant is "write an interior renderer + let a schema opt into
it," not "design a new screen."

This keeps the "few templates" thesis alive — as a **small set of composable
interiors**, not one flattened full-screen template.

## 2. Why Process exists (the lesson)

The Record interior renders **grouped fields + one status badge + read/edit**. It
has **no slot for a lifecycle** (stepper / phase checklist / guarded transition)
and **no slot for rich related collections** (line items, timeline, email). An
order needs all three. Modelling order *status as an editable dropdown field*
(orders-v2) threw away the `MastFlow` workflow that legacy `#orders` uses and
violated the CLAUDE.md rule *"Process-step surfaces: use the MastFlow engine, NOT
ad-hoc steppers + status dropdowns."* Process composes the engines instead of
flattening one into the other:

> **Compose `MastEntity` (the record) + `MastFlow` (the lifecycle). Do not flatten
> lifecycle into a field.**

## 3. Anatomy of the Process interior (LOCKED)

```
┌─ shell header ──────────────────────────────────────────────┐
│  ← Back to Orders   SGTE-0164  ●Confirmed          ⤢   ✕     │
├─ PINNED region (always visible, every tab) ─────────────────┤
│  Customer · Total · Items · Placed        (identity bar)     │
│  PROCESS · STEP 2 OF 4 · tap a done step to review it        │
│  ◉─Received──●Confirmed──○Ready to fulfill──○Delivered  (stepper) │
│  [Process ●Confirmed] [Items 1] [Customer] [History]  (tabs) │
├─ tab body ──────────────────────────────────────────────────┤
│  (Process tab = the book; other tabs = record facets)        │
└─────────────────────────────────────────────────────────────┘
```

**Width:** wide-but-margined (~1140px) so the scrim still frames it as a panel;
the shell's expand control (`⤢`) toggles to 100%.

### 3a. Pinned header — *process first, step in the header*
The **identity bar** (record headline: customer · total · items · placed) and the
**step indicator** (the `MastFlow` stepper) are **both pinned** and visible on
**every tab**. The stepper is the spine — it belongs in the header, not buried in
one tab. Tapping a completed step jumps to the Process tab showing that step's
page. The Process tab also carries its current phase as a sublabel + dot, so the
process is legible even at a glance from another tab.

### 3b. Tabs = the record (the container)
Tabs are the record's facets. **Process is the default tab.** Per-object set; for
orders: **Process · Items · Customer · History**. Each facet (line items + money,
customer + addresses, timeline + email + notes) gets a real home — nothing is
crammed into one cover. (Email/notes → History; items/money → Items;
customer/addresses → Customer.)

### 3c. Process tab = the book (pages)
A process is a sequence of moments; the stepper is the page index. Each phase owns
what was captured at that moment.
- **Current page (default landing)** — **lean and actionable only**: this gate's
  checklist (`MastFlow` exit requirements, hard vs. soft) + the **one guarded
  action** (`Advance to <next> →` / `Back to <prev>`). Nothing else competes.
- **Back pages (completed phases)** — flip back to read what was valid there
  (read-only history + captured values + timestamps). You *can* look; you usually
  don't. "Push the page" reuses `MastNavStack` semantics (a back-crumb returns).
- **Forward pages** — dimmed preview of what the next step will ask (incl. the
  branch choice at `picked` / "Ready to fulfill").

`onAdvance` intercepts the relevant transitions to open the **existing rich-capture
dialogs** (triage, shipping, label) exactly as legacy `_initOrderWorkflowHeader`
does — the dialogs write their fields; the record subscription re-renders. Lifecycle
logic stays in the workflow spec; the Process interior is just the consistent shell
around it.

## 4. Progressive disclosure (the operator's actual point)

> "Hide complexity at first glance with the ability to expand to find the details
> when needed. We can't dumb it down so the screen loses the details."

Three tiers, all without leaving the panel:
1. **Glance** — pinned identity + step indicator (where it is, whose, how much).
2. **Act** — the lean current page (what's blocking, the one next move).
3. **Dig** — flip to a history page, or switch to a record-facet tab.

Information is never removed — it's tucked behind a step-flip or a tab.

## 5. Engine plan (next; not yet built)

- New interior renderer `MastEntity.renderProcess` (alongside `_formHtml`).
- Schema opts in via two optional declarations:
  - `flow: '<MastFlowKey>'` — the lifecycle spec (e.g. `'pickship'`).
  - `regions: [...]` — the record-facet tabs (which related collections to render
    and how), beyond the schema's own fields.
- Composes `MastFlow.renderHeader/transition` for the stepper + guarded actions,
  and the existing field/list/badge primitives for the facets.
- Ships **flag-gated** (`?ui=1` / `localStorage.mastUiRedesign`) **side-by-side**
  with legacy `#orders`, per the strangler rollout. Born at **0** ratchet
  violations (`scripts/lint-ux-standards.js`).
- Order is the test case for whether the Process variant generalizes; once proven,
  commissions/RMAs/enrollments adopt it by declaring `flow` + `regions`.

## 6. What this supersedes
- orders-v2's status `<select>` edit form — **dead end.**
- `editform-mock.html` ("Option C") — **obsolete artifact**, not a target.
