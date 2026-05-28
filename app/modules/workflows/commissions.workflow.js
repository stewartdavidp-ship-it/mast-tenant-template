/**
 * Commissions (Custom Orders) workflow spec.
 *
 * Maps the legacy 16-value c.status enum into 7 visible phases. See
 * docs/workflow-engine-design.md §9 + §11 for design rationale, especially
 * the derivePhaseFromLegacy() approach: existing records read their phase
 * from a per-status function (not a flat lookup) so ambiguities like
 * `built` (which is in the Shipped column but real-world precedes shipping)
 * and `deposit-paid` (which lives in Accepted but already satisfies the
 * deposit-collected requirement) get resolved explicitly.
 *
 * Once a record transitions via MastFlow, record.__workflow.phase becomes
 * canonical and this derivation is no longer consulted.
 */
(function() {
  'use strict';
  if (!window.MastFlow) {
    console.error('[commissions.workflow] MastFlow not loaded — load workflow-engine.js first');
    return;
  }

  // ---- Requirement helpers ----

  function hasText(v, min) { return !!(v && typeof v === 'string' && v.trim().length >= (min || 1)); }
  function isISO(v) { return !!(v && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)); }

  // ---- Phases ----

  var phases = [
    {
      key: 'inquiry',
      label: 'Inquiry',
      statuses: ['new', 'in-discussion'],
      entryStatus: 'in-discussion',
      exitRequirements: [
        {
          key: 'contact',
          label: 'Customer contact captured',
          hard: true,
          test: function(c) { return hasText(c.customerContact); },
          target: 'header-contact'
        },
        {
          key: 'spec-notes',
          label: 'Initial spec notes (≥20 chars)',
          hard: false,
          test: function(c) { return hasText(c.notes, 20); },
          target: 'header-notes'
        }
      ]
    },
    {
      key: 'quoted',
      label: 'Quoted',
      statuses: ['quoted'],
      entryStatus: 'quoted',
      exitRequirements: [
        {
          key: 'price',
          label: 'Proposal price set',
          hard: true,
          test: function(c) { return hasText(c.proposalPrice); },
          target: 'spec-tab-proposal-price'
        },
        {
          key: 'spec',
          label: 'Proposal spec / design notes set',
          hard: true,
          test: function(c) { return hasText(c.proposalSpec, 10); },
          target: 'spec-tab-proposal-spec'
        },
        {
          key: 'sent',
          label: 'Proposal sent to customer',
          hard: true,
          test: function(c) { return !!c.proposalSentAt; },
          target: 'spec-tab-proposal-send'
        },
        {
          key: 'timeline',
          label: 'Timeline communicated',
          hard: false,
          test: function(c) { return hasText(c.proposalTimeline); },
          target: 'spec-tab-proposal-timeline'
        }
      ]
    },
    {
      key: 'accepted',
      label: 'Accepted',
      statuses: ['accepted', 'deposit-paid'],
      entryStatus: 'accepted',
      exitRequirements: [
        {
          key: 'production-job',
          label: 'Production job linked',
          hard: true,
          test: function(c) { return !!c.productionJobId; },
          target: 'spec-tab-create-job'
        },
        {
          key: 'deposit-collected',
          label: 'Deposit recorded',
          hard: false,  // soft until tenant config marks deposits required
          test: function(c) {
            return !!(c.depositPaidAt || c.status === 'deposit-paid');
          },
          target: 'money-tab'
        }
      ]
    },
    {
      key: 'making',
      label: 'In progress',
      statuses: ['design-locked', 'in-fabrication', 'cold-shop'],
      entryStatus: 'design-locked',
      exitRequirements: [
        {
          key: 'milestone',
          label: 'At least one milestone posted',
          hard: false,
          test: function(c) {
            // Aggregation via plain predicate — see design doc §4 Option A.
            // Milestones are a child collection at admin/commissions/{id}/milestones.
            // We can't read them sync here; surface caches them on c._milestonesCount
            // via the existing _loadCommissionMilestones() path.
            return (c._milestonesCount || 0) > 0;
          },
          target: 'milestones-tab'
        }
      ]
    },
    {
      key: 'invoiced',
      label: 'Invoiced',
      statuses: ['balance-invoiced'],
      entryStatus: 'balance-invoiced',
      exitRequirements: [
        {
          key: 'invoice-sent',
          label: 'Balance invoice sent',
          hard: true,
          test: function(c) { return !!c.balanceInvoiceSentAt; },
          target: 'money-tab-send-invoice'
        },
        {
          key: 'invoice-paid',
          label: 'Balance paid',
          hard: false,
          test: function(c) { return !!c.balancePaidAt; },
          target: 'money-tab-record-payment'
        }
      ]
    },
    {
      key: 'shipped',
      label: 'Shipped',
      statuses: ['shipped', 'built'],
      entryStatus: 'shipped',
      exitRequirements: [
        {
          key: 'tracking-or-pickup',
          label: 'Tracking # OR pickup confirmation recorded',
          hard: true,
          test: function(c) { return hasText(c.trackingNumber) || !!c.pickupConfirmedAt; },
          target: 'spec-tab-tracking'
        },
        {
          key: 'customer-notified',
          label: 'Customer notified',
          hard: false,
          test: function(c) { return !!c.shipNotifiedAt; },
          target: 'thread-tab'
        }
      ]
    },
    {
      key: 'delivered',
      label: 'Delivered',
      statuses: ['delivered', 'followed-up', 'completed'],
      entryStatus: 'delivered',
      terminal: 'success',
      exitRequirements: [
        {
          key: 'follow-up',
          label: 'Follow-up sent',
          hard: false,
          test: function(c) { return !!c.followedUpAt; },
          target: 'thread-tab'
        }
      ]
    },
    // Terminal failure phase — entered via transition() when customer
    // declines / cancels. NOT in the main backbone display (terminal
    // failures render as a single red pill, not a stepper step).
    {
      key: 'closed-no-completion',
      label: 'Closed (no completion)',
      statuses: ['declined', 'canceled'],
      entryStatus: 'canceled',
      terminal: 'failure',
      exitRequirements: []
    }
  ];

  // ---- Legacy phase derivation ----
  //
  // The flat statuses[] lookup is insufficient because:
  //   - `deposit-paid` lives in the Accepted phase but the deposit-collected
  //     requirement's predicate can't see that fact without explicit
  //     data — record the override.
  //   - `built` is grouped with `shipped` for display but real-world
  //     precedes shipping; map it to `making` so the operator isn't shown
  //     a fake "in Shipped, missing tracking" state.
  //   - `followed-up` and `completed` both end in delivered terminal.
  //
  // Returns { phase, satisfiedRequirementOverrides }.
  function derivePhaseFromLegacy(c) {
    var s = c && c.status;
    if (!s) return { phase: 'inquiry', satisfiedRequirementOverrides: [] };
    if (s === 'declined' || s === 'canceled') {
      return { phase: 'closed-no-completion', satisfiedRequirementOverrides: [] };
    }
    if (s === 'deposit-paid') {
      return { phase: 'accepted', satisfiedRequirementOverrides: ['deposit-collected'] };
    }
    if (s === 'built') {
      // Treat as `making` end-stage, not Shipped. Operator can advance
      // explicitly to Invoiced/Shipped once they confirm.
      return { phase: 'making', satisfiedRequirementOverrides: [] };
    }
    if (s === 'followed-up' || s === 'completed') {
      return { phase: 'delivered', satisfiedRequirementOverrides: ['follow-up'] };
    }
    // Fallback: walk phases looking for statuses[] membership.
    for (var i = 0; i < phases.length; i++) {
      if ((phases[i].statuses || []).indexOf(s) !== -1) {
        return { phase: phases[i].key, satisfiedRequirementOverrides: [] };
      }
    }
    return { phase: 'inquiry', satisfiedRequirementOverrides: [] };
  }

  // ---- Force-advance permission ----
  function canForce(actor, role) {
    return role === 'admin' || role === 'manager';
  }

  // ---- Record path ----
  // Commissions live at admin/commissions/{id} (per MastDB.commissions in
  // index.html — see existing MastDB.commissions.update calls).
  function recordPath(commId) {
    return 'admin/commissions/' + commId;
  }

  // ---- Register ----
  window.MastFlow.define('commissions', {
    recordKind: 'commission',
    specVersion: 'commissions@1',
    phases: phases,
    branches: {},  // no branches in commissions today
    derivePhaseFromLegacy: derivePhaseFromLegacy,
    canForce: canForce,
    recordPath: recordPath
  });
})();
