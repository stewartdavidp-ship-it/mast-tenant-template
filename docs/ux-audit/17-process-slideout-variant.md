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

The variants are a **gradient of the same structure**, not separate designs. They
share an **expandable headline (cover) at the top + tabs** below; each higher tier
adds one layer. Keeping the look and feel identical across them is the point — a
customer and an order should feel like the same app, differing only where they
genuinely differ.

| Variant | Shell | Expandable headline | Facet tabs | Process state + Process tab | Example objects |
|---|---|:---:|:---:|:---:|---|
| **Flat Record** | ✓ | — | — | — | tag, promotion, simple config |
| **Faceted Record** | ✓ | ✓ | ✓ | — | **customer**, product, contact |
| **Process** | ✓ | ✓ | ✓ | ✓ | **order**, commission, RMA, enrollment |

- **Flat Record** — `_formHtml`, exists today. Grouped fields, read/edit.
- **Faceted Record** — expandable headline + facet tabs (related collections),
  **no** lifecycle. The "regular slide-out." Customer is the reference (§7).
- **Process** — Faceted Record **plus** a pinned process state (stepper) and a
  default **Process tab** holding the book/pages (§3c). Order is the reference.
- Future: **Calendar / Schedule** (time/agenda spine), **Ledger / Timeline**,
  **Gallery / Media** — catalogued as we hit objects that don't fit the above.

> **The Process SO and the regular (Faceted Record) SO are deliberately near-
> identical** — same shell, same expandable headline, same tabs. The *only*
> additions in Process are the **process-state indicator** and the **Process
> tab**. Build the Faceted-Record machinery once; Process is that plus the spine.

Adding a variant is cheap and **safe by construction**: it inherits the shell and
can't drift. A new variant is "write an interior renderer + let a schema opt into
it," not "design a new screen." This keeps the "few templates" thesis alive — as a
**small set of composable interiors**, not one flattened full-screen template.

### 1a. The Process-vs-Record test (which variant does an object need?)
Ask: **is the object's status a governed lifecycle or a derived attribute?**
- *Governed* — gated transitions, exit-checklists, a guarded "advance" — ⇒
  **Process.** (Order: pickship. Commission: linear flow.)
- *Derived / assigned* — computed from behavior or set as a tag, no checklist, no
  guarded transition — ⇒ **Faceted Record.** (Customer: active/lapsed/lead/vip —
  lapsed is computed from cadence; vip/lead are segment tags.)

If it has rich related collections but no governed lifecycle, it's a Faceted
Record. If it has no meaningful related collections either, it's a Flat Record.

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
The header is the same expandable cover used by the Faceted Record (collapsed =
headline; expand inline for the vitals, without leaving the current tab — §7), and
in the Process variant it *also* carries the **step indicator** (the `MastFlow`
stepper). Both are **pinned** and visible on **every tab**. The stepper is the
spine — it belongs in the header, not buried in one tab. Tapping a completed step
jumps to the Process tab showing that step's page. The Process tab also carries its
current phase as a sublabel + dot, so the process is legible even at a glance from
another tab.

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

## 7. Faceted Record — the "regular" SO (customer is the reference)

The Faceted Record is the Process SO **minus the process state and Process tab**.
Same shell, same expandable headline, same tabs. It is the home for rich records
that have related collections but **no governed lifecycle** (per the §1a test).

**Customer** is the reference object. The legacy customer detail already expresses
the goal — a **relationship hub**, not a field form: a 5-tab surface
**Overview / Orders / Activity / Classes / Wallet** (consolidated 6→5 to fit the
detail-complex ≤5-tab rule; Activity is a merged timeline of orders, enrollments,
contacts, notes, tickets, reviews, surveys). The list itself is relationship-shaped
— segment picker, source/tags/date filters, a **Frequency** column, Spend, and a
derived **status** (active/lapsed/lead/vip).

```
┌─ shell header ──────────────────────────────────────────────┐
│  ← Back to Customers   Jane Doe   ●VIP              ⤢   ✕     │
├─ expandable headline (collapsed = vitals; ⤢ expand inline) ─┤
│  Email · Spend · Orders · Frequency · Status                │
│  [Overview] [Orders] [Activity] [Classes] [Wallet]   (tabs) │
├─ tab body (the selected facet) ─────────────────────────────┤
└─────────────────────────────────────────────────────────────┘
```

**Why the current `customers-v2` is not the target:** it modelled the customer as a
**Flat Record** (md slide-out: name/email/source/orders#/spend/status/phone/created,
edit name+phone) — a deliberate *proof of the read→edit Record paradigm*, never the
real screen. It drops Orders / Activity / Classes / Wallet — i.e. the relationship.
A 41-orders / LAPSED customer would be flattened to "41 orders · $319 · Lapsed,"
hiding the very facets that explain the lapse. **Rebuild `customers-v2` as a Faceted
Record** (expandable headline + facet tabs) when the engine work reaches it.

Open: whether the expandable headline *is* the Overview (so tabs start at Orders),
or Overview stays a tab and the headline shows a thinner vitals strip. Resolve when
mocking the customer screen.

## 8. Engine consequence

> **Correction (2026-06-01):** earlier drafts said the engine had "only a flat
> renderer" and that `renderTransaction`/`renderParty` didn't exist — that came
> from a stale read of an old branch. On `main` the engine **already** has tabbed
> detail templates: `transaction` (Overview/Items/Fulfillment/Activity, used by
> `orders-v2`) and `party` (Overview/Orders/Notes, used by `customers-v2`), plus
> cross-entity drill. So the build *evolves* these templates; it does not build a
> faceted interior from scratch.

The Process variant = the tabbed record template **+ the MastFlow lifecycle spine**.
A schema opts in with `detail.flow` (the MastFlow key) + `detail.flowModule` (the
spec module to lazy-load). When present, the engine swaps the flat "Fulfillment"
status for a **Process pane (default)** that hosts `MastFlow.renderHeader` — the
stepper + phase checklist + ONE guarded Advance — and routes Advance/Back/Branch
through `MastFlow.transition` (optimistic-locked via `expectedFromPhase`). Status is
**read-only as a field** (workflow-governed) — exactly the §2 fix.

**Shipped (Phase 2, this build):** `detail.flow` wiring in `mast-entity.js`
(`_initEntityFlow` / `_flowRender` / `_flowTransition`) + `orders-v2` on `pickship`.
**Still pending:** the expandable headline cover above the tabs (Faceted polish),
richer customer tabs (Activity/Classes/Wallet), and the Resolve + Calendar work.

## 9. List-vs-record levels — the Customers/Duplicates fix

**The IA heuristic (pairs with §1a):** *list-level concerns live on the list;
record-level concerns live in the record's slide-out.* A tab or control that
**persists from the list into a record detail** conflates the two levels — that's
the smell.

**The legacy bug:** the customers module is one pane with `currentView = list |
detail | duplicates` that always draws two view-tabs (**Customers** / **Duplicates**),
with "Customers" active for *both* list and detail. So while you're drilled into a
customer **detail**, the **Duplicates** tab sits there as a false **peer** — clicking
it destroys the detail and ejects you to a global queue. "Customers" secretly holds
two levels; "Duplicates" is a list-level admin queue. They are rendered as siblings
but are not siblings.

**The modeling correction:** *a duplicate is a relationship between two customers,
not an attribute of one.* Each flag is a pair (`customerIdA`/`customerIdB`) + reason
+ a Keep-A/Keep-B merge. So it has two homes, and "a tab on one customer" is neither:

1. **List-level queue.** Duplicates is a **queue of flag-records** reached only from
   the Customers list level (not a peer of a record). In the slide-out model the
   queue sits on the list screen, behind the scrim while a record is open — so it is
   structurally impossible to hit "Duplicates" from inside a customer.
2. **Flag = a first-class record with a focused "resolve" slide-out** (decision B,
   ratified). Narrower than a hub (~860px). Contents: reason banner; **side-by-side
   compare** of the two candidates with differences highlighted + a recommended
   winner ("keeps history"); a **merge preview** ("if you keep A: 44 orders combined,
   B's email kept as secondary, status recomputed"); a decision bar
   (**Keep A / Keep B / Not a duplicate**), reversible. The pair comparison lives in
   **one** place instead of bouncing between two customer details. Mock:
   `duplicate-flag-mock.html`.
3. **Per-customer contextual banner.** When the open customer is involved in a
   pending flag, the customer slide-out shows a banner — "⚠ Possible duplicate of
   <other> — Review" — linking to the flag's resolve SO. That is the record-level
   half, and it lives **in** the record.

**New micro-surface (not a full variant):** the **resolve / compare-and-decide**
slide-out — shell + a comparison interior + a guarded decision bar. Candidate reuse
for other reconciliation queues (drift alerts, merge conflicts, approvals). Catalogue
as it recurs; do not force it into the variant taxonomy yet.

## 10. The index layer is pluggable too (controls validated by output)

The variant taxonomy (§1) describes the **detail** layer. A whole-app sweep
(2026-06-01, all 44 modules) showed the engine also has a pluggable **index**
layer — the *control* used to browse records — and that **a control is validated by
its output**: the control is just a lens; what matters is the record a click hands
you. If that output is a record the detail layer can manage, any control drops in.

**Calendar is the proof.** It is not a detail variant — it is an alternate *index*
renderer over the same records. In `book.js`, the month grid plots **session
occurrences**; a click resolves to the parent **Class** record. So: a control
outputs a record (or an occurrence that resolves to one), and the detail layer
manages it. The only calendar-specific schema work is **generating occurrences from
a record's schedule and resolving a click to the right output** — and the legacy
flow gets that output wrong (clicking an occurrence opens the parent *template*, not
the session you clicked; the redesign should output the session, parent linked).

So the engine has two independent, composable axes:
- **Index layer (controls):** `table` · `cards` · `calendar` · `grouped/board`.
- **Detail layer (variants):** `Flat Record` · `Faceted Record` · `Process` · `Resolve`.
A control feeds a record; the variant manages it. Any (control × variant) pair is valid.

## 11. Whole-app coverage map + the engine boundary

The same sweep mapped every module. The model holds across the app — and, just as
importantly, it shows where the entity engine **stops** and three sibling engines
begin. Decide this boundary BEFORE building so a finance dashboard or a blog editor
is never forced through `renderProcess`.

### In scope — the entity engine (4 controls × 4 variants)
Covers the **majority** of modules. Index control → output record → detail variant:
- **table** → orders (Process), customers (Faceted), contacts (Flat), enrollments,
  payouts, suppressions, sales, fulfillment queue, wholesale, …
- **cards** → channels, consignment galleries, student/team rosters, shows.
- **calendar** → book classes / sessions, marketing-calendar (occurrence→record).
- **grouped/board** → audit rule-group buckets, production queue.
- Variants seen in the wild: **Flat** (contacts, instructors, payouts), **Faceted**
  (customer, wholesale account, channel, vendor ledger, student, team, audit
  product, class), **Process** (order, commission, RMA, production job, maker piece,
  session-ops, sales event, shows lifecycle), **Resolve** (duplicates, audit
  violations, mapping fuzzy-match, accounting conflicts, CS review moderation).

### Out of scope — three sibling engines (already anticipated; now scoped)
Outputs that are **not a manageable record**. Do NOT route these through the entity engine:
1. **Report / Dashboard (terminal, no drill)** → a **Report engine**. finance
   (revenue, P&L, cash-flow, tax, overview, portfolio), financials, Day Close,
   channels dashboard, wholesale AR-aging, campaigns attribution, advisor. *Largest cluster.*
2. **Builder / Canvas (content authoring)** → a **Builder** (bespoke + shared
   components). blog editor, newsletter `nl-grid-canvas`, lookbook builder,
   composer, social capture. *Author on a canvas, not manage fields.*
3. **Wizard / multi-step task** → a **Wizard engine**. mapping setup, channel
   onboarding, Day Close v2, accounting backfill, retroactive trip, show-light apply
   builder, fulfillment scan, sales packing.

### Oddballs (explicit call needed, small)
- **Map / floor plan** (events) — spatial; a pin click is an assign *action*, not a record.
- **engagement-inbox** — looks like an inbox but a row click is a bulk *action* /
  lightbox, not a record. Fold into **Resolve** (it is a moderation queue) or give it a queue pattern.
- **Form-only config singletons** (studio, homepage, website, brand, wallet
  instruments) — a record with **no index**; open directly (Flat/Faceted, no list control).

### Conversion backlog (fits the model, wrong detail surface — not engine gaps)
Record surfaces that already match the model but use a pre-slide-out detail and need
conversion: promotions (modal), procurement (inline row-expansion), maker-materials
(inline), trips (inline expansion), finance-expenses (overlay), team (in-pane swap),
commission-terms (inline editor), CS ticket-thread (full-pane swap).

**Bottom line:** nothing in the app needs a control or output the model can't place.
Entity engine = 4 controls × 4 variants; Report / Builder / Wizard are separate; two
oddballs get a deliberate call; the rest is conversion work.
