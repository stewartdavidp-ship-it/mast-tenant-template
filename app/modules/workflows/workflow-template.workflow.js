/**
 * Workflow template — copy this file to start a new MastFlow surface.
 *
 *   cp app/modules/workflows/workflow-template.workflow.js \
 *      app/modules/workflows/<your-key>.workflow.js
 *
 * Then:
 *   1. Replace every `WORKFLOW_KEY` constant below with your workflow key
 *      (e.g. 'rma', 'returns', 'enrollments').
 *   2. Replace RECORD_KIND with the singular noun for your record.
 *   3. Replace RECORD_PATH_PREFIX with your Firebase path
 *      (e.g. 'admin/rmas' → records at admin/rmas/{id}).
 *   4. Replace the phase list with your real phases.
 *   5. Write derivePhaseFromLegacy for any existing records.
 *   6. Add to MODULE_MANIFEST in app/index.html so it lazy-loads.
 *   7. Add the workflow header to your detail view (see
 *      _initCommissionWorkflowHeader / _initOrderWorkflowHeader in
 *      orders.js for the integration pattern).
 *
 * AUTHOR CHECKLIST — read before declaring the spec done:
 *   [ ] specVersion is set and will be bumped on any phase change
 *   [ ] Every legacy status value maps to exactly one phase via
 *       derivePhaseFromLegacy (or a phase.statuses[] entry)
 *   [ ] Terminal failure phase exists for cancelled/declined paths and
 *       is routed through transition() — not silent dropdown writes
 *   [ ] Hard requirements actually block downstream work in the real
 *       system (not just "would be nice")
 *   [ ] Soft requirements have a hint string that explains why they're
 *       recommended, not just labeled
 *   [ ] Every requirement has either a `target` id (resolver registered
 *       in the detail view) or an `action` handler — operators should
 *       never see a checklist row with no way to act on it
 *   [ ] Branches (if any) declare per-choice `phases: [...]` arrays
 *       explicitly — never rely on phases[] declaration order
 *   [ ] canForce(actor, role) gates force-advance appropriately
 *   [ ] recordPath() returns the path MastDB.update can write to
 *   [ ] recordExtraPatch (if present) doesn't write engine-managed
 *       fields under __workflow — those are reserved
 *
 * INTEGRATION CHECKLIST — for the consuming detail view:
 *   [ ] Engine + spec loaded via MastAdmin.loadModule before first
 *       renderHeader call
 *   [ ] Detail view subscribes to the record (MastDB.subscribe) and
 *       unsubscribes on close — no listener leaks
 *   [ ] Every transition() call passes { recordId, expectedFromPhase }
 *   [ ] STALE_STATE / REQUIREMENTS_UNMET / SPEC_MISMATCH / BRANCH_CHOICE_REQUIRED
 *       error codes are handled with operator-visible toasts
 *   [ ] Target resolvers cover every target id used in the spec
 *   [ ] Deep-link: after renderHeader resolves, read getRouteParams().focus
 *       and call MastFlow.focusPhase(hostId, focus) so dashboard/queue links
 *       can land the operator on a specific phase
 *
 * GOTCHAS (learned the hard way during commissions + pickship rollout):
 *   - Load engine BEFORE spec, sequentially — parallel Promise.all races and
 *     the spec's IIFE bails if window.MastFlow isn't set yet.
 *   - recordPath() must match the record's REAL Firebase path. Check the
 *     MastDB entity's PATH constant (orders live at root 'orders/', not
 *     'admin/orders/').
 *   - Resolve the actor via MastAdmin.currentUser — the bare currentUser var
 *     is not attached to window, so window.currentUser is undefined.
 *   - Never put undefined in any field the engine writes to the audit row;
 *     Firestore's setDoc rejects undefined. Use null.
 */
(function() {
  'use strict';
  if (!window.MastFlow) {
    console.error('[workflow-template] MastFlow not loaded — load workflow-engine.js first');
    return;
  }

  // CHANGE THESE -------------------------------------------------------
  var WORKFLOW_KEY = 'template';            // e.g. 'rma'
  var RECORD_KIND = 'template-record';      // e.g. 'rma'
  var SPEC_VERSION = 'template@1';          // bump when phases change
  var RECORD_PATH_PREFIX = 'admin/templates'; // path under which records live
  // --------------------------------------------------------------------

  // Requirement-test helpers — copy/extend as needed.
  function hasText(v, min) { return !!(v && typeof v === 'string' && v.trim().length >= (min || 1)); }

  // ---- Phases ----
  // Each phase: { key, label, statuses, entryStatus, exitRequirements, terminal? }
  // Each requirement: { key, label, hard, test, target?, action? }
  var phases = [
    {
      key: 'open',
      label: 'Open',
      statuses: ['new', 'open'],          // legacy enum values mapped here
      entryStatus: 'open',                 // status written when phase is entered
      exitRequirements: [
        {
          key: 'first-thing',
          label: 'First thing captured',
          hard: true,
          test: function(r) { return hasText(r.firstThing); },
          target: 'detail-first-thing'
        }
      ]
    },
    {
      key: 'in-progress',
      label: 'In progress',
      statuses: ['in_progress'],
      entryStatus: 'in_progress',
      exitRequirements: []
    },
    {
      key: 'done',
      label: 'Done',
      statuses: ['done', 'completed'],
      entryStatus: 'done',
      terminal: 'success',
      exitRequirements: []
    },
    {
      key: 'closed-no-completion',
      label: 'Closed (cancelled)',
      statuses: ['cancelled', 'rejected'],
      entryStatus: 'cancelled',
      terminal: 'failure',
      exitRequirements: []
    }
  ];

  // ---- Branches (delete this block if your workflow is linear) ----
  // var branches = {
  //   '<branch-point-phase-key>': {
  //     label: 'Choose next step:',
  //     choices: [
  //       // phases:[...] MUST be declared explicitly per choice — the engine
  //       // does not infer from phases[] declaration order across branches.
  //       { key: 'choice-a', label: 'Path A', entryPhase: 'a-step-1',
  //         phases: ['a-step-1', 'a-step-2'] },
  //       { key: 'choice-b', label: 'Path B', entryPhase: 'b-step-1',
  //         phases: ['b-step-1'] }
  //     ],
  //     convergesAt: '<convergence-phase-key>'
  //   }
  // };
  var branches = {};

  // ---- Legacy phase derivation ----
  // Called for records that don't yet have __workflow.phase. Return
  // { phase, satisfiedRequirementOverrides }. Use overrides for cases
  // where the legacy enum already implies a requirement is satisfied
  // but the predicate can't see explicit evidence.
  function derivePhaseFromLegacy(record) {
    var s = record && record.status;
    if (!s) return { phase: phases[0].key, satisfiedRequirementOverrides: [] };
    for (var i = 0; i < phases.length; i++) {
      if ((phases[i].statuses || []).indexOf(s) !== -1) {
        return { phase: phases[i].key, satisfiedRequirementOverrides: [] };
      }
    }
    return { phase: phases[0].key, satisfiedRequirementOverrides: [] };
  }

  // ---- Force-advance permission ----
  function canForce(actor, role) {
    return role === 'admin' || role === 'manager';
  }

  // ---- Record path ----
  function recordPath(recordId) {
    return RECORD_PATH_PREFIX + '/' + recordId;
  }

  // ---- Optional: extra patch on transition ----
  // Mirror engine-set fields into surface-specific structures
  // (legacy statusHistory[], audit triggers, denormalized counts).
  // function recordExtraPatch(record, targetPhase, opts) {
  //   return { someField: 'someValue' };
  // }

  // ---- Register ----
  window.MastFlow.define(WORKFLOW_KEY, {
    recordKind: RECORD_KIND,
    specVersion: SPEC_VERSION,
    phases: phases,
    branches: branches,
    derivePhaseFromLegacy: derivePhaseFromLegacy,
    canForce: canForce,
    recordPath: recordPath
    // recordExtraPatch: recordExtraPatch
  });
})();
