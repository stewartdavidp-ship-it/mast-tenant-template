/**
 * Returns (RMA) workflow spec.
 *
 * Third MastFlow surface. Returns are modeled as their OWN workflow over the
 * same orders/{id} records — pickship deliberately ends at delivered and
 * lumps every return_* status into its terminal phase (see the legacy enum
 * mapping in pickship.workflow.js). This spec picks the record up from
 * return_requested and walks it to resolution.
 *
 * Legacy enum mapping (orders.js ORDER_STATUS_BADGE_COLORS):
 *   return_requested   → requested
 *   return_approved    → approved
 *   return_shipped     → in-transit
 *   return_received    → received
 *   refunded, partially_returned → resolved (terminal success)
 *   cancelled          → closed (terminal failure: return withdrawn/denied)
 */
(function() {
  'use strict';
  if (!window.MastFlow) {
    console.error('[return.workflow] MastFlow not loaded — load workflow-engine.js first');
    return;
  }

  function hasText(v) { return !!(v && typeof v === 'string' && v.trim().length); }

  var phases = [
    {
      key: 'requested',
      label: 'Requested',
      statuses: ['return_requested'],
      entryStatus: 'return_requested',
      exitRequirements: [
        {
          key: 'return-reason',
          label: 'Return reason recorded',
          hard: false,
          test: function(o) { return hasText(o.returnReason) || hasText(o.rmaReason); },
          target: 'detail-items'
        }
      ]
    },
    {
      key: 'approved',
      label: 'Approved',
      statuses: ['return_approved'],
      entryStatus: 'return_approved',
      exitRequirements: [
        {
          key: 'return-label',
          label: 'Return label / instructions sent',
          hard: false,
          test: function(o) { return !!(o.returnLabelUrl || o.returnInstructionsSentAt); },
          target: 'detail-shipping'
        }
      ]
    },
    {
      key: 'in-transit',
      label: 'In transit',
      statuses: ['return_shipped'],
      entryStatus: 'return_shipped',
      exitRequirements: [
        {
          key: 'return-tracking',
          label: 'Return tracking recorded',
          hard: false,
          test: function(o) { return hasText(o.returnTracking) || !!(o.returnShipping && o.returnShipping.trackingNumber); },
          target: 'detail-shipping'
        }
      ]
    },
    {
      key: 'received',
      label: 'Received',
      statuses: ['return_received'],
      entryStatus: 'return_received',
      exitRequirements: [
        {
          key: 'inspected',
          label: 'Items inspected (condition noted)',
          hard: false,
          test: function(o) { return !!o.returnInspectedAt || hasText(o.returnCondition); },
          target: 'detail-items'
        }
      ]
    },
    {
      key: 'resolved',
      label: 'Resolved',
      statuses: ['refunded', 'partially_returned'],
      entryStatus: 'refunded',
      terminal: 'success',
      exitRequirements: []
    },
    {
      key: 'closed',
      label: 'Closed (withdrawn / denied)',
      statuses: ['cancelled'],
      entryStatus: 'cancelled',
      terminal: 'failure',
      exitRequirements: []
    }
  ];

  function derivePhaseFromLegacy(o) {
    var s = o && o.status;
    if (s === 'cancelled') return { phase: 'closed', satisfiedRequirementOverrides: [] };
    if (s === 'refunded' || s === 'partially_returned') {
      return { phase: 'resolved', satisfiedRequirementOverrides: [] };
    }
    for (var i = 0; i < phases.length; i++) {
      if ((phases[i].statuses || []).indexOf(s) !== -1) {
        return { phase: phases[i].key, satisfiedRequirementOverrides: [] };
      }
    }
    // Anything else (a delivered order whose return is being opened) starts
    // at requested — the surface only feeds return_* records in.
    return { phase: 'requested', satisfiedRequirementOverrides: [] };
  }

  function canForce(actor, role) {
    return role === 'admin' || role === 'manager';
  }

  // Same source of truth as pickship: root orders/{id}.
  function recordPath(orderId) {
    return 'orders/' + orderId;
  }

  // Mirror entry status into legacy statusHistory[] so badges/filters used by
  // the rest of the orders surface stay accurate (same as pickship).
  function recordExtraPatch(record, targetPhase, opts) {
    if (!targetPhase.entryStatus) return {};
    var now = new Date().toISOString();
    var hist = (record.statusHistory && record.statusHistory.slice) ? record.statusHistory.slice() : [];
    hist.push({ status: targetPhase.entryStatus, at: now, by: 'mastflow', note: 'return workflow transition' });
    return { statusHistory: hist, updatedAt: now };
  }

  window.MastFlow.define('return', {
    recordKind: 'order',
    specVersion: 'return@1',
    phases: phases,
    branches: {},
    derivePhaseFromLegacy: derivePhaseFromLegacy,
    canForce: canForce,
    recordPath: recordPath,
    recordExtraPatch: recordExtraPatch
  });
})();
