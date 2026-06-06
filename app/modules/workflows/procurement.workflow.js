/**
 * Procurement (purchase order) workflow spec — Tier 1 Work Item E.
 *
 * Models the PO lifecycle as a MastFlow process record (like pickship for orders):
 *
 *   Draft ──(send to vendor)──▶ Ordered ──(record receipt, full)──▶ Received ✓
 *     └ vendor + lines required        └ partial stays here          (terminal)
 *                                                    Cancel ▶ Cancelled ✗ (terminal)
 *
 * The procurement-v2 surface intercepts the two forward advances (Draft→Ordered =
 * send PO + email; Ordered→Received = the receive-capture slide-out) via
 * detail.onFlowAdvance, and lets the data drive the phase: sending stamps
 * sentAt + status='submitted', receiving rolls status to received/
 * partially_received, cancel sets cancelled. The surface's reconcile-on-open then
 * promotes __workflow.phase to match status — so an MCP-recorded receipt, a
 * partial that completes, or a cancel all land on the right phase even though
 * __workflow.phase had become canonical. This keeps ONE transition path
 * (reconcile) and avoids phase/status divergence.
 *
 * Legacy status mapping (procurement.js derives received/partially_received from
 * received quantities; draft/cancelled are explicit):
 *   draft                          → draft
 *   submitted, partially_received  → ordered
 *   received, closed               → received (terminal success)
 *   cancelled                      → cancelled (terminal failure)
 */
(function () {
  'use strict';
  if (!window.MastFlow) {
    console.error('[procurement.workflow] MastFlow not loaded — load workflow-engine.js first');
    return;
  }

  function hasVendor(po) { return !!(po && po.vendorId); }
  function hasLines(po) { return !!(po && po.lines && po.lines.length); }
  function isSent(po) { return !!(po && po.sentAt); }

  var phases = [
    {
      key: 'draft',
      label: 'Draft',
      statuses: ['draft'],
      entryStatus: 'draft',
      exitRequirements: [
        { key: 'vendor', label: 'Vendor selected', hard: true, test: hasVendor, target: 'detail-overview' },
        { key: 'lines', label: 'At least one line item', hard: true, test: hasLines, target: 'detail-lines' }
      ]
    },
    {
      key: 'ordered',
      label: 'Ordered',
      statuses: ['submitted', 'partially_received'],
      entryStatus: 'submitted',
      exitRequirements: [
        // Soft: sending is the intended path to Ordered, but a PO can be marked
        // ordered without an emailed document (phone/portal orders).
        { key: 'sent', label: 'PO sent to vendor', hard: false, test: isSent, target: 'detail-overview' }
      ]
    },
    {
      key: 'received',
      label: 'Received',
      statuses: ['received', 'closed'],
      entryStatus: 'received',
      terminal: 'success',
      exitRequirements: []
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      statuses: ['cancelled'],
      entryStatus: 'cancelled',
      terminal: 'failure',
      exitRequirements: []
    }
  ];

  function derivePhaseFromLegacy(po) {
    var s = po && po.status;
    if (!s) return { phase: 'draft', satisfiedRequirementOverrides: [] };
    for (var i = 0; i < phases.length; i++) {
      if ((phases[i].statuses || []).indexOf(s) !== -1) {
        return { phase: phases[i].key, satisfiedRequirementOverrides: [] };
      }
    }
    return { phase: 'draft', satisfiedRequirementOverrides: [] };
  }

  function canForce(actor, role) { return role === 'admin' || role === 'manager'; }

  // POs live at admin/purchaseOrders/{poId} (camelCase) — matches the legacy
  // procurement.js writes (admin/purchaseOrders/<id>/status etc.). A hyphenated
  // guess would silently land MastFlow's __workflow/status writes at the wrong
  // path (pickship hit this exact bug with orders → root, not admin/orders).
  function recordPath(poId) { return 'admin/purchaseOrders/' + poId; }

  function recordExtraPatch(record, targetPhase) {
    if (!targetPhase || !targetPhase.entryStatus) return {};
    return { updatedAt: new Date().toISOString() };
  }

  window.MastFlow.define('procurement', {
    recordKind: 'purchase-order',
    specVersion: 'procurement@1',
    phases: phases,
    derivePhaseFromLegacy: derivePhaseFromLegacy,
    canForce: canForce,
    recordPath: recordPath,
    recordExtraPatch: recordExtraPatch
  });
})();
