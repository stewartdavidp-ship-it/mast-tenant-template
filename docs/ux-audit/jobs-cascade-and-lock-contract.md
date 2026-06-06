# Jobs — Cancel / Delete Cascade-and-Lock Contract

**Status:** Contract (set 2026-06-06). Blocks Phase **A2** (MCP destructive tools) and Phase **B2** (UI
heavy edits/deletes) in [jobs-v2-plan.md](jobs-v2-plan.md). No code lands against deletes until this is
ratified.

> Purpose: define exactly what "cancel" and "delete" mean for every Jobs entity, what inventory/material/
> cost side-effects must be reversed, and what is **immutable** because a server cascade already owns it.
> This is the spec the MCP delete tools and the V2 UI both implement — one contract, two surfaces, so they
> can't drift.

---

## 1. The three write authorities (recap)

1. **UI** (`production.js` → `jobs-v2.js`) — operator actions, routed through a bridge.
2. **MCP** (`production.ts`) — programmatic; owns job-status transition validation + the legacy
   (non-locked) inventory reversal branches.
3. **CF `completeBuildJob`** — the **only** writer of build locks and the D44–D47 cascades. Idempotent.

**Rule 0:** No surface may write inventory/material/observedCost for a **locked build**. Those numbers are
the CF's, recorded against the audit log; re-touching them is the "double-push" the idempotency test guards.

---

## 2. Lock + inventory side-effects that any delete/cancel must respect

From `production.ts updateProductionJob` and the CF:

| Transition | Inventory effect today | Owner |
|---|---|---|
| `definition → in-progress` | `incoming += targetQuantity` (per line item w/ productId) | MCP/UI |
| `in-progress → completed` (no locked build) | `incoming -= targetQuantity`; `onHand += (completed − loss)` | MCP/UI (legacy path) |
| `in-progress → completed` (any locked build) | **skipped** — CF already applied it | CF (D47) |
| `in-progress → cancelled` | `incoming -= targetQuantity` | MCP/UI |
| build completion | `build.locked=true`; D44 material deduct; D45/46 observedCost; D47 onHand auto-push (inventory-general/event); `inventoryPushed` idempotency flag | CF only |

**Invariant to preserve on every destructive op:** the sum of `incoming` adjustments must net to zero once a
job reaches a terminal state. A delete that skips the reversal leaks phantom `incoming` stock.

---

## 3. Cancel vs Delete — definitions

- **Cancel** = lifecycle terminal transition (`status='cancelled'`). Record is retained for audit; inventory
  reversed per §2. This is the **default** for anything that has started or committed inventory.
- **Delete** = record removal. Permitted **only** for records that never started and never committed any
  side-effect (no builds, no `incoming` committed, not referenced by a published story/product). Otherwise
  use Cancel. Prefer **soft-delete** (`deleted=true` + `deletedAt/By`) over hard removal wherever an audit
  trail or foreign key exists.

---

## 4. Decision matrix (entity × state → allowed op + cascade)

### Job (`admin/jobs/{jobId}`)
| State | Op | Cascade required |
|---|---|---|
| `definition`, no builds, no `incoming` committed | **Hard delete** OK | Re-open any linked `productionRequest` (status→`pending`, clear `jobId`/`lineItemId`); delete child lineItems; no inventory. |
| `in-progress`/`on-hold`, no locked build | **Cancel only** | `incoming -= targetQuantity` per line item (existing cancel branch); re-open linked requests. |
| any state **with a locked build** | **Cancel only**; never delete | Do **not** touch the locked build's inventory/material. Cancel reverses only the *non-locked* `incoming`. Log that locked output remains in `onHand` (real product exists). |
| `completed`/`cancelled` (terminal) | **No delete**; soft-delete/archive only | None — terminal records are history. |

### Line item (`admin/jobs/{jobId}/lineItems/{liId}`)
| Condition | Op | Cascade |
|---|---|---|
| Job in `definition` (no `incoming` committed) | **Hard delete** OK | Re-open its `productionRequest` if any; remove `bomForecast` with it. |
| Job past `definition`, no locked build referencing it | **Cancel/remove** w/ inventory reversal | `incoming -= targetQuantity` for this item. |
| Referenced by a locked build | **Blocked** | Mirror existing `updateProductionLineItem` guard — corrections require a new reverse build. |

### Build (`admin/jobs/{jobId}/builds/{buildId}`)
| Condition | Op | Cascade |
|---|---|---|
| `status='in-progress'` (unlocked, draft) | **Hard delete** OK | Remove its media/milestones/output; no inventory committed yet. |
| `locked=true` | **NEVER delete or edit** | Reversal = a new build with negative/reverse line items, completed through the CF so D44–D47 net out idempotently. |

### Story (`public/stories/{storyId}`)
| State | Op | Cascade |
|---|---|---|
| `draft` | **Hard delete** OK | If a product points `storyId` at it, clear that pointer first. |
| `published` | **Unpublish then delete**, or soft-delete | Clear `product.storyId` on any product referencing it; retain QR/audit trail. Never silently orphan a buyer-facing link. |

### Production request (`admin/buildJobs/{requestId}`)
| State | Op | Cascade |
|---|---|---|
| `pending` | Cancel/dismiss OK | None. |
| `assigned` (linked to a job line item) | **Unassign first** | Set `jobId`/`lineItemId` null, status→`pending` (or `cancelled`); only then remove. Deleting an assigned request orphans the job line item's back-link. |

---

## 5. Idempotency + audit requirements (non-negotiable)

- Every destructive op calls `writeTenantAudit(tenantId, "delete"|"update", entity, id, uid)`.
- Inventory reversals are **bounded and symmetric** — reverse exactly what was committed (track via the
  `incoming` history entries already written with `reason: "production_started"/"production_cancelled"`).
- Any path that could touch a locked build's inventory must be covered by — and must not break —
  `production-double-push-idempotency.test.ts` (tenant-mcp).
- Hard deletes are **last resort**; default to Cancel/soft-delete when any foreign key or committed effect
  exists.

---

## 6. What A2 / B2 implement against this

- **A2 (MCP):** `delete_production_job`, `delete_line_item`, `delete_story` (+ request unassign) — each
  encodes the matrix above; reject (don't silently no-op) when the state forbids the op, returning the
  reason + the blocking lock/reference.
- **B2 (UI):** Cancel/delete affordances surface the same rules — disabled with a tooltip reason when
  blocked; "cancel" vs "delete" labelled per state; reversal-by-new-build is the only correction path for
  locked output.

## 7. Open question for ratification

- Soft-delete vs hard-delete default for **completed** jobs/stories: archive-with-`deleted` flag (keeps
  reporting history) vs true removal. This contract assumes **soft-delete/archive** for terminal records —
  confirm before A2 builds the terminal-state path.
