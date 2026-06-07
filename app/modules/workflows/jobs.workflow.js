/**
 * Jobs (production) workflow spec — the MastFlow lifecycle for the V2 Jobs SO.
 *
 * Modeled on products.workflow.js. The operator-chosen lifecycle:
 *   Definition → In Progress → Completed   (backbone, guarded Advance)
 * with two off-backbone states:
 *   - On-hold: a SUB-STATE of In Progress (not a phase). "Put on hold"/"Resume"
 *     set record.status to 'on-hold'/'in-progress' directly (via the bridge);
 *     the MastFlow phase stays 'in-progress' and a banner surfaces the hold —
 *     same approach products uses for its 'revising' sub-state.
 *   - Cancelled: an off-backbone terminal (like products' 'archived'), reached
 *     by the explicit Cancel action, not a backbone advance.
 *
 * Inventory side-effects on transition are NOT in this spec — they live in the
 * module's detail.onFlowAdvance (jobs-v2.js), which calls the same MastDB stock
 * primitives the legacy transitionProductionJob uses, with the same
 * double-push guard. Build completion stays owned by the completeBuildJob CF.
 *
 * Jobs live at admin/jobs/{jobId} (MastDB.productionJobs.PATH).
 */
(function () {
  'use strict';
  if (!window.MastFlow) {
    console.error('[jobs.workflow] MastFlow not loaded — load workflow-engine.js first');
    return;
  }

  function lineItemCount(j) {
    var li = j && j.lineItems;
    return li ? Object.keys(li).length : 0;
  }
  function allItemsHaveOutput(j) {
    var li = (j && j.lineItems) || {};
    var keys = Object.keys(li);
    if (!keys.length) return false;
    return keys.every(function (k) {
      var it = li[k] || {};
      return (it.completedQuantity || 0) >= (it.targetQuantity || 0);
    });
  }

  var phases = [
    {
      key: 'definition',
      label: 'Definition',
      statuses: ['definition'],
      entryStatus: 'definition',
      exitRequirements: [
        {
          key: 'has-line-items',
          label: 'At least one line item',
          hard: true,
          test: function (j) { return lineItemCount(j) > 0; },
          target: 'tab-items'
        }
      ]
    },
    {
      key: 'in-progress',
      label: 'In Progress',
      // on-hold maps here too — it's a sub-state, surfaced by a banner, not a phase.
      statuses: ['in-progress', 'on-hold'],
      entryStatus: 'in-progress',
      exitRequirements: [
        {
          key: 'output-recorded',
          label: 'Build output recorded for every line item',
          hard: false,
          test: function (j) { return allItemsHaveOutput(j); },
          target: 'tab-builds'
        }
      ]
    },
    {
      key: 'completed',
      label: 'Completed',
      statuses: ['completed'],
      entryStatus: 'completed',
      terminal: 'success',
      exitRequirements: []
    },
    {
      key: 'cancelled',
      label: 'Cancelled',
      statuses: ['cancelled'],
      entryStatus: 'cancelled',
      terminal: 'retired',  // muted off-backbone pill, not a progression step
      exitRequirements: []
    }
  ];

  function derivePhaseFromLegacy(j) {
    var s = j && j.status;
    if (s === 'cancelled') return { phase: 'cancelled', satisfiedRequirementOverrides: [] };
    if (s === 'completed') return { phase: 'completed', satisfiedRequirementOverrides: [] };
    // on-hold is a sub-state of in-progress
    if (s === 'in-progress' || s === 'on-hold') return { phase: 'in-progress', satisfiedRequirementOverrides: [] };
    return { phase: 'definition', satisfiedRequirementOverrides: [] };
  }

  function canForce(actor, role) {
    return role === 'admin' || role === 'manager';
  }

  function recordPath(jobId) {
    return 'admin/jobs/' + jobId;
  }

  window.MastFlow.define('jobs', {
    recordKind: 'job',
    specVersion: 'jobs@1',
    phases: phases,
    branches: {},
    derivePhaseFromLegacy: derivePhaseFromLegacy,
    canForce: canForce,
    recordPath: recordPath
  });
})();
