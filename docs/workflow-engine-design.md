# Workflow Engine — Design Doc

**Status:** Draft for review. No code written. Not committed.
**Goal:** A reusable, gated workflow primitive for surfaces where the operator
moves a record through phases and the system enforces what's required at
each step. First two surfaces: Custom Orders (commissions) and Pick/Ship.
**Triggering feedback:** `29f68yS9Pqh40yZZUjEY` (sgtest15, screen
"commissions"). Left open until this design ships.

---

## 1. Principles

1. **Ease of use is primary.** The operator should never have to ask "what do
   I do next?" — the screen tells them. They should never be able to silently
   skip a required step.
2. **One source of truth for "is this phase satisfied."** UI rendering, the
   advance button, and the writer all call the same predicate. No drift.
3. **Flexible but bounded.** Linear backbone + optional 2–4-way branches that
   re-converge. No nested branches. No arbitrary DAG. If a real case needs
   more, that's the signal to revisit, not the signal to pre-build.
4. **Engine is dumb; specs are smart.** All workflow-specific knowledge lives
   in declarative phase specs. The engine knows nothing about commissions,
   shipments, or RMA — it walks specs and evaluates predicates.

---

## 2. Engine API

Six functions. That's the entire surface area.

```js
// Register a workflow definition. Called once at module load.
// Engine eagerly loads all known workflow specs at app boot — no lazy
// race when a deep link lands on a record whose module hasn't loaded.
MastWorkflow.define(workflowKey, definition)

// Evaluate the current state of a record against its workflow.
// Returns { currentPhase, currentPhaseSource, missing[], canAdvance,
//           nextPhases[], isTerminal, specVersion, specMismatch }
// currentPhaseSource: 'record' | 'legacy-status' — tells the UI whether
// phase was read from the trusted record.phase field or derived from the
// legacy status enum (back-compat path).
// specMismatch: true if the record's recorded specVersion doesn't match
// the current spec, or if the record's phase no longer exists in the spec.
MastWorkflow.evaluate(workflowKey, record)

// Render the operator surface: stepper + requirements checklist + buttons.
// Async — may need to read child collections (line items, milestones)
// before predicates can run. Returns a Promise<string> of HTML. Caller
// renders a skeleton first, then swaps in the resolved HTML.
MastWorkflow.renderHeader(workflowKey, record, { onAdvance, onBack, onBranch, onForce })

// Attempt a transition. Runs evaluate(); refuses if requirements unmet
// unless { force: true, reason: '...' } is passed (writes override to audit).
// Requires { expectedFromPhase } for optimistic concurrency — refuses with
// a stale-state error if the record's current phase no longer matches,
// caller refreshes and retries. Same path used by UI clicks AND by
// webhooks / system events.
// Special opt: { switchBranchTo: 'pickup' } at a branch point exits the
// current branch and re-enters the branch point with a new choice.
MastWorkflow.transition(workflowKey, record, targetPhaseKey, opts)

// Predicate-trace debugger. Returns the result of every requirement test
// against the record, plus the record values each predicate read. Used
// when a record is mysteriously stuck. Available in the operator surface
// via a debug menu (role-gated by the caller).
MastWorkflow.diagnose(workflowKey, record)

// Lookup hook — single point that returns a definition by key. Today reads
// from in-memory registry populated by define(). Tomorrow can read from
// Firebase. Callers never know which.
MastWorkflow.getDefinition(workflowKey)
```

That's it. Surfaces consume `renderHeader` + `transition`. The engine
internally uses `evaluate` + `getDefinition`. `define` is module-init only.
`diagnose` is operator-facing but role-gated.

---

## 3. Phase definition format

```js
MastWorkflow.define('commissions', {
  recordKind: 'commission',
  phases: [
    {
      key: 'inquiry',
      label: 'Inquiry',
      // Statuses (legacy enum values) that map to this phase. Used for the
      // back-compat migration shim — engine reads c.status, identifies phase.
      statuses: ['new', 'in-discussion'],
      // Canonical status written when this phase is entered.
      entryStatus: 'new',
      // What must be true to advance OUT of this phase. Each requirement is
      // a predicate over the record + a target the UI can navigate to.
      exitRequirements: [
        {
          key: 'contact',
          label: 'Customer contact captured',
          hard: true,
          test: (c) => !!c.customerContact,
          target: { tab: 'spec', field: 'customerContact' }
          // optional: action: { label: 'Add contact', handler: 'openContactModal' }
        },
        {
          key: 'spec-notes',
          label: 'Initial spec notes',
          hard: false,  // soft — Advance still enabled without it
          test: (c) => !!(c.notes && c.notes.length > 20),
          target: { tab: 'spec', field: 'notes' }
        }
      ]
    },
    // ... more phases
  ],
  // OPTIONAL: branches off a phase. Each branch is a named alternative path
  // that re-converges at convergesAt. Operator picks the branch via the
  // header UI when the current phase declares branches.
  branches: {
    // No branches in commissions today.
  }
})
```

### Phase-level fields

| Field             | Required | Meaning |
|-------------------|----------|---------|
| `key`             | yes      | Stable id. Used in audit + URL state. |
| `label`           | yes      | Operator-visible name. |
| `statuses`        | yes      | Legacy enum values that map to this phase (back-compat). |
| `entryStatus`     | yes      | Status written when phase is entered via `transition`. |
| `exitRequirements`| no       | List of requirements. Empty = no gate. |
| `terminal`        | no       | `'success' \| 'failure'` — marks an absorbing state (delivered, declined). |

### Requirement fields

| Field   | Required | Meaning |
|---------|----------|---------|
| `key`   | yes      | Stable id for the requirement (for checklist `key=` props + audit). |
| `label` | yes      | What the operator sees in the checklist. |
| `hard`  | yes      | `true` blocks Advance; `false` shows yellow but allows Advance. |
| `test`  | yes      | `(record) => boolean`. Pure. May be async (`Promise<boolean>`) — engine awaits, that's why `renderHeader` is async. |
| `target`| no       | Opaque target id (string). The consuming module registers `(targetId) => focusBehavior` handlers via `MastWorkflow.registerTargetResolver(workflowKey, fn)`. Engine never knows about tabs, fields, or DOM. If a target id has no resolver, the checklist row is shown without a link (logged as a warning in dev). |
| `action`| no       | Optional inline button: `{ label, handler }`. Handler is a callback name resolved by the consuming module — engine never invokes module code directly. |

### Branch definition (per-phase)

```js
branches: {
  'picked': {  // branch point — the phase key where the choice happens
    label: 'How is this order fulfilling?',
    choices: [
      { key: 'pack-ship', label: 'Pack & ship', entryPhase: 'packing' },
      { key: 'pickup',    label: 'Customer pickup', entryPhase: 'pickup-ready' },
      { key: 'dropship',  label: 'Dropship handoff', entryPhase: 'dropship-pending' }
    ],
    convergesAt: 'delivered'
  }
}
```

Operator picks one choice; engine writes `record.__workflow.branch = 'pack-ship'`
and transitions to that branch's `entryPhase`. Subsequent advancement walks
the branch's own phase chain (defined as normal phases keyed by the branch's
sub-keys) until it hits `convergesAt`. Branch choice is itself audited.

**Branch escape hatch:** `transition(workflowKey, record, branchPointPhase, { switchBranchTo: 'pickup', reason: '...' })` exits the current branch, clears any in-branch state that's invalidated, and re-enters the branch point with a fresh choice. Audited as a single transition with `branchSwitched: true`. Required for the real-world RMA case where customer chose pickup, no-showed, and the team switches to dropship.

**Rule we're committing to:** branches can't nest. A branch can't declare its
own branches. If we hit that, we redesign.

**Engine-managed record fields.** All engine state lives under `record.__workflow` to avoid collisions with surface fields:

```
record.__workflow = {
  phase: 'quoted',                // authoritative current phase
  branch: 'pack-ship' | null,     // current branch, if at/past a branch point
  phaseEnteredAt: ISO timestamp,  // denormalized for stuck-record queries + SLA
  specVersion: 'commissions@3',   // spec version at last transition
  lockToken: '...' | null         // optional optimistic-lock token, see §7a
}
```

These are written by `transition()` only — surfaces must never touch them directly.

---

## 4. Aggregation (pick/ship's stress test)

Pick/ship has per-line-item state: an order is "picked" only when every line
item is picked. A requirement needs to walk children.

Two ways to handle this:

**Option A** — requirements are arbitrary predicates over the full record
including children. Engine doesn't care.

```js
{ key: 'all-picked', label: 'All items picked', hard: true,
  test: (order) => order.lineItems.every(li => li.pickedAt),
  // No simple target — multiple items. Action navigates to the pick view.
  action: { label: 'Open pick list', handler: 'openPickList' } }
```

**Option B** — add a first-class `aggregate` field that the engine
understands and renders specially (e.g. "3 of 7 picked").

```js
{ key: 'all-picked', hard: true,
  aggregate: {
    collection: (order) => order.lineItems,
    perItemTest: (li) => !!li.pickedAt,
    progressLabel: (done, total) => done + ' of ' + total + ' items picked'
  } }
```

**Recommendation: Option A.** Aggregate is sugar that adds engine complexity
for one UI affordance. Option A handles every aggregation case as a plain
predicate; the consuming module renders "3 of 7" inside its own action
target if it wants to. The engine stays small. If we end up writing the same
progress-counter five times we promote it to a helper, not an engine feature.

---

## 4a. Concurrency, offline, and the optimistic lock

Studio operators work on phones. Two operators can open the same record at
the same time. The PWA can queue writes while offline. Both produce the
same failure mode: two transitions land for the same record.

**The mechanism (single rule, covers both cases):**

`transition()` requires `{ expectedFromPhase }`. If the record's
`__workflow.phase` at write time doesn't match, the transition is rejected
with a `stale-state` error. The UI catches that error, re-reads the record,
re-renders the header (which now shows whatever the other operator did),
and the operator decides again.

This makes a duplicate offline-queued advance a no-op the second time it
flushes (the first one already changed the phase) instead of a silent
double-write.

**Live updates while a record is open.** Detail views must subscribe to
the record (existing `MastDB.commissions.on` pattern) and re-render the
header on every change. The reviewer's "both operators see Quoted and both
hit Advance" case becomes: A advances, B's screen updates to Accepted
before B clicks, or B clicks and gets a stale-state error and refreshes.

**Offline UI affordance.** When `navigator.onLine === false`, the Advance
button shows "Offline — will sync" instead of "Advance to Quoted →", and
the transition is queued via Firebase's existing offline persistence. The
optimistic lock makes a duplicate flush safe; the label tells the operator
why their click didn't immediately move the stepper.

**Force-advance is also gated by `expectedFromPhase`.** Force bypasses
requirement checks, not concurrency checks.

## 5. External triggers

Pick/ship advances via Shippo webhooks ("label created" → advance to
"shipped"). The engine must support programmatic transitions, not just UI.

`MastWorkflow.transition` is the same code path. A webhook handler calls
`MastWorkflow.transition('pickship', order, 'shipped', { actor: 'shippo-webhook' })`.
Requirements are evaluated exactly as for an operator click. If they don't
pass, the webhook handler chooses: skip and log, or force-advance with a
reason ("system: label confirmed"). No separate "system override" code path —
just the standard `{ force, reason }` opt.

---

## 6. Operator UI

What `renderHeader` produces:

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Stepper: Inquiry ─✓─ Quoted ─●─ Accepted ── Making ── … ]         │
│                                                                       │
│  CURRENT PHASE: Quoted                                                │
│  ┌─ 2 still to do ─────────────────────────────────────────┐          │
│  │ ✗  Proposal price set            → Open Spec tab        │          │
│  │ ✗  Proposal sent to customer     → Send proposal        │ ← action │
│  │ ✓  Customer contact captured                            │          │
│  └─────────────────────────────────────────────────────────┘          │
│                                                                       │
│  [← Back to Inquiry]              [Advance to Accepted →] (disabled) │
└─────────────────────────────────────────────────────────────────────┘
```

- **Stepper** — done/current/upcoming as today; current phase shows count
  of unmet hard requirements as a small chip ("2 to do").
- **Checklist** — every requirement for the current phase. Hard unmet = red.
  Soft unmet = amber. Met = green check. Each row clickable to its `target`;
  rows with an `action` also show an inline button.
- **Advance** disabled until `missing.filter(r => r.hard).length === 0`.
- **Back** always enabled; confirm modal if going back would invalidate
  downstream data (caller-supplied predicate, optional).
- **Branch point** — at a phase with `branches`, instead of one Advance
  button the bar shows "Choose next step:" + a button per branch choice.
  Requirements must still be satisfied first.
- **Terminal phase** — Advance hidden; only Back (if reversible) and
  optional terminal actions (e.g. "Reopen").
- **Force advance** — small "⋯" menu offers "Advance anyway (requires
  reason)". Writes audit. Surfaces this control only to operators with the
  right role (engine accepts an `allowForce` flag from caller).

---

## 7. Audit / transition record

Every successful `transition` writes **two** things atomically (Firebase
multi-path update):

1. **Audit row** at `{tenantId}/admin/workflowTransitions/{recordKind}/{recordId}/{txId}`:

```
{
  txId, from, to,
  workflowKey, recordKind, recordId,
  specVersion,                          // spec version at time of transition
  by: { uid, displayName } | { system: 'shippo-webhook' },
  at: ISO timestamp,
  durationInPreviousPhaseMs: number,    // denormalized; powers SLA queries
  branchChoice: string | null,          // if this transition entered a branch
  branchSwitched: bool,                 // true if this was a switchBranchTo
  satisfiedRequirements: [               // hard reqs that were green, with values
    { key, valueAtAdvance }              // valueAtAdvance lets us answer
  ],                                     // "what was the proposalPrice when they passed?"
  unmetSoftRequirements: [reqKey, ...], // amber ones at time of advance
  forced: bool,
  forceReason: string | null
}
```

2. **Denormalized current state on the record** at `record.__workflow`:
   - `phase`, `branch`, `phaseEnteredAt`, `specVersion`

The denormalized state is what makes "every record currently stuck in Quoted
>7 days" answerable as a single index query on `__workflow.phase` +
`__workflow.phaseEnteredAt`, not a collection-group scan over transitions.

**Collection-group queries we explicitly support.** Firestore composite
indexes shipped with the engine:
- `workflowTransitions/{recordKind}/**` by `forced=true` + `at` desc — "every override in the last 30 days"
- `workflowTransitions/{recordKind}/**` by `by.uid` + `at` desc — "every transition this operator did"
- per-recordKind collection: `__workflow.phase` + `__workflow.phaseEnteredAt` asc — "stuck records by phase"

**Terminal failures go through `transition()` too.** `declined` and
`canceled` on commissions are transitions into the `closed-no-completion`
terminal phase, written through the same audit path. No silent dropdown
exit from the workflow.

---

## 8. Definition lookup — code-only with swappable shim

```js
// In the engine:
function getDefinition(workflowKey) {
  return _registry[workflowKey] || null;
}
```

Today: `_registry` is populated by `MastWorkflow.define(...)` calls at module
load. Definitions live in JS, one file per workflow:
`app/modules/workflows/commissions.workflow.js`,
`app/modules/workflows/pickship.workflow.js`.

Tomorrow, if a tenant needs to customize: replace `getDefinition` body with
a Firebase read (with the code default as the fallback). No caller changes,
because every caller already routes through `getDefinition`. The door is
left open, but we don't build the door today.

---

## 9. Concrete spec — Commissions

Linear, no branches. Maps the current 16-value `c.status` enum into 7 phases.

| Phase | Entry status | Hard requirements | Soft requirements |
|-------|--------------|-------------------|-------------------|
| Inquiry | `new` | Customer contact | Spec notes ≥20 chars; ≥1 reference image |
| Quoted | `quoted` | Proposal price set; Proposal spec set; Proposal sent to customer | Timeline set |
| Accepted | `accepted` | Customer acceptance recorded (`acceptedAt` ISO) | Deposit collected (becomes hard if studio charges deposits — tenant-config flag deferred) |
| In progress | `design-locked` | Production job linked (`productionJobId`) | At least one milestone posted |
| Invoiced | `balance-invoiced` | Balance invoice sent | Balance paid |
| Shipped | `shipped` | Tracking number OR pickup confirmed | Customer notified |
| Delivered (terminal: success) | `delivered` | — | Follow-up sent |

Fine-grained sub-statuses (`deposit-paid`, `in-fabrication`, `cold-shop`,
`built`, `followed-up`, `completed`) still set via the existing dropdown —
they live *within* a phase, they don't change which phase the record is in.
The phase derived from `statuses[]` doesn't move; only the displayed
sub-status changes.

Terminal failure statuses (`declined`, `canceled`) are modeled as a separate
terminal phase `closed-no-completion` with `terminal: 'failure'`, set via
the dropdown without going through Advance.

---

## 10. Concrete spec — Pick/Ship

Branching. Stress-tests aggregation + branches + external triggers.

**Backbone:**

| Phase | Entry status | Hard requirements |
|-------|--------------|-------------------|
| Received | `received` | Customer + ship-to address present |
| Picked | `picked` | All line items have `pickedAt` (aggregation) |
| *(branch point)* | | Operator chooses: Pack & Ship / Pickup / Dropship |

**Branch: Pack & Ship**

| Phase | Hard requirements |
|-------|-------------------|
| Packing | All line items have `packedAt`; package dimensions set |
| Labeled | Shipping label purchased (`labelUrl` present) |
| Shipped | Tracking number present (advanced by Shippo webhook) |

**Branch: Pickup**

| Phase | Hard requirements |
|-------|-------------------|
| Pickup ready | Customer pickup notification sent |
| Picked up | Pickup signature OR staff confirmation recorded |

**Branch: Dropship**

| Phase | Hard requirements |
|-------|-------------------|
| Dropship pending | Vendor PO sent |
| Dropship confirmed | Vendor tracking received |

All three branches converge at **Delivered** (terminal success).

This spec catches three things the engine has to support:
- **Aggregation:** "all line items picked" / "all packed."
- **External advancement:** Shippo webhook advances Labeled → Shipped.
- **Branch UI:** three-button choice replacing the Advance button at the
  branch point.

---

## 11. Migration plan (commissions)

The current 16-value `c.status` enum is the source of truth in Firebase. We
do not migrate Firebase data. We do not introduce a new `phase` field.

**The shim — corrected from the v1 design after independent review.**

The naive "derive phase from status via `statuses[]` lookup" is unsafe
because the legacy 16-value enum encodes both progression *and* sub-state
on the same axis. `built` lives in Shipped but real-world precedes
shipping; `deposit-paid` lives in Accepted but already satisfies the
"deposit collected" requirement that the predicate can't see.

The corrected approach:

1. **`record.__workflow.phase` is authoritative when present.** Every
   `transition()` writes it. Once a record has been through the engine
   once, the engine never derives phase from `status` again.

2. **For legacy records (no `__workflow.phase`)**, the engine calls the
   workflow's `derivePhaseFromLegacy(record)` function — a per-workflow
   function the spec author writes. Not a flat statuses lookup. It can
   inspect any fields, handle ambiguous cases explicitly, and return
   `{ phase, satisfiedRequirementOverrides: [reqKey, ...] }` so legacy
   records can claim "already satisfied" for requirements whose evidence
   is implicit in the old enum (e.g. `deposit-paid` → satisfies the
   `deposit-collected` requirement even though the predicate would say
   otherwise without explicit deposit data).

3. **The first transition migrates the record.** On a legacy record's
   first `transition()` call, the engine writes `__workflow.phase`,
   `phaseEnteredAt: now`, and `specVersion`. From then on, status is
   read-only metadata; phase is canonical. We never silently re-derive.

4. **`evaluate()` reports `currentPhaseSource: 'legacy-status'`** when
   the record hasn't been migrated, so debug tooling and the diagnose
   command can distinguish.

This is the minimum that's safe. Same approach for pick/ship.

**Spec versioning.** Each workflow spec declares a monotonic
`specVersion` (e.g. `'commissions@3'`). Every transition stamps the
record. `evaluate()` returns `specMismatch: true` if the record's phase
is no longer present in the current spec. The UI on `specMismatch`
shows a "this record needs review — its workflow was updated" banner
and refuses to advance until the spec author writes a migration shim
or an operator with admin role uses the diagnose tool to remap.

This is the load-bearing piece that lets pick/ship's spec evolve while
records are mid-branch.

---

## 12. What lands in what order

1. **Engine module** — `app/modules/workflows/workflow-engine.js`. The five
   functions, in-memory registry, default `getDefinition`. ~300 lines.
2. **Commissions spec** — `app/modules/workflows/commissions.workflow.js`.
3. **Commissions detail view migration** — `viewCommissionDetail` calls
   `MastWorkflow.renderHeader('commissions', c, ...)` instead of today's
   ad-hoc stepper. Behavior changes (checklist + gated Advance), data layer
   doesn't.
4. **Verify behaviorally on sgtest15**, close feedback `29f68yS9Pqh40yZZUjEY`
   with note pointing to the engine + commissions spec.
5. **Pick/ship spec + detail view migration** — second surface that
   validates the abstraction. Done as a follow-up job, not jammed into the
   commissions feedback close. **SHIPPED** (orders.js + pickship.workflow.js).
   Surfaced branches, line-item aggregation, and external (webhook-style)
   advancement. Also drove the full pick/ship UI replacement + routing
   cancellation through the engine.
5b. **Products spec + detail view migration** — third surface (feedback
   6wOENiU3rfuBj3H5nwXq). **SHIPPED** (maker.js + products.workflow.js).
   Converged two pre-existing hand-rolled surfaces (renderReadinessChecklistPanel
   + the D7 stepper) onto one MastFlow header. Validated: acquisition mode
   as a phase ATTRIBUTE (not a branch), reuse of an external predicate source
   (computeReadinessChecklist), and the off-backbone "retired" terminal kind.
6. **Doc this as the new pattern** in `mast-tenant-template/CLAUDE.md` so
   future workflow surfaces (RMA, returns, fulfillment) use the engine
   instead of inventing their own steppers.

---

## 13. Decisions ratified vs. still open

**Ratified (from this thread + the v1 review pass):**
- Linear backbone + 2–4-way branches that converge. No nesting.
- Branch escape hatch via `transition({ switchBranchTo, reason })`.
- Ease of use > expressiveness.
- Pick/ship as the second surface.
- Code-only definitions with swappable lookup, eager-loaded at boot.
- Branch UI: pick branch first, then satisfy requirements.
- Read-only checklist as the default; per-requirement opt-in inline actions.
- Feedback `29f68yS9Pqh40yZZUjEY` stays open until engine + commissions
  migration ship.
- Revert of `9fa91b6` — done (`d185565`).
- **Phase is canonical, not derived.** `record.__workflow.phase` is the
  source of truth after first transition. Legacy records use a per-spec
  `derivePhaseFromLegacy()` function, not a flat `statuses[]` lookup.
- **Spec versioning is in scope.** `specVersion` stamped on every
  transition; `specMismatch` is an explicit `evaluate()` output.
- **Concurrency via `expectedFromPhase` optimistic lock.** Same mechanism
  covers offline-queued duplicate writes.
- **Detail views subscribe to the record** and re-render on change.
- **Denormalized `__workflow` block on the record** powers stuck-record
  queries and SLA without scanning the audit log.
- **Audit row records `valueAtAdvance` for each satisfied requirement** —
  answers "what was the price when they passed the gate?"
- **Terminal failures (`declined`, `canceled`) route through `transition()`**
  into terminal phases. No silent dropdown exit.
- **`MastWorkflow.diagnose()` ships day one** for stuck-record debugging.
- **Targets are opaque IDs the consuming module resolves**, not
  `{ tab, field }` strings.
- **Aggregation handled as plain predicates (Option A in §4)**, not first-class.
- **Force-advance gated by a `canForce: (user) => bool` predicate** in
  the spec, not a caller-passed `allowForce` flag. Central definition,
  central audit.
- New top-level Firebase path `admin/workflowTransitions/{recordKind}/...`
  for audit (separate from existing `audit` path because shape is different
  and queryability matters).
- Workflow specs live under `app/modules/workflows/*.workflow.js`.
- Engine global renamed **`MastFlow`** to avoid collision with the existing
  `mast_workflows` MCP tool.

**Shipped (were "still open" in the v1 review, ratified + built):**
- Deep-linking to a phase (`?focus=<phaseKey>`) — shipped. Each stepper
  step carries `data-mf-phase`; `MastFlow.focusPhase(hostElOrId, phaseKey)`
  scrolls the header into view and pulses the target step. Commissions and
  orders detail inits read `getRouteParams().focus` after renderHeader
  resolves and call it. Enables dashboard links like "orders stuck in
  Picked >7d" → opens the order with that step highlighted.
- A `workflow-template.workflow.js` skeleton + author checklist — shipped
  alongside the engine, so the next workflow surface doesn't copy quirks.

---

## 14. What this design does NOT do

Calling these out explicitly so we don't accidentally expand scope:

- No visual workflow editor for tenants.
- **Time-in-phase data is captured** (`phaseEnteredAt`, `durationInPreviousPhaseMs`),
  but no SLA UI / alerting / "show me everything overdue" surface ships in
  the engine. The data's there; build the dashboard later.
- No assignment / ownership per phase ("this is on Sarah now"). Adjacent
  to the concurrency mechanism but a separate concern.
- No notifications on phase transitions beyond what individual surfaces
  already do (CS thread message on commissions, etc.).
- No automatic spec migration. `specMismatch` surfaces the problem; an
  operator-driven remap is the resolution path. Engine doesn't try to
  auto-fix.
- No tenant-level workflow customization. Code-only definitions; the
  swappable `getDefinition` lookup leaves the door open for later.

All of the above are reasonable future additions. None are needed to ship
the commissions feedback resolution or the pick/ship migration.
