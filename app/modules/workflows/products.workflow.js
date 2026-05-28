/**
 * Products (Maker / product lifecycle) workflow spec.
 *
 * Third MastFlow surface. Converges two pre-existing ad-hoc surfaces that
 * independently reinvented the engine pattern:
 *   1. renderReadinessChecklistPanel (maker.js) — hand-rolled hard/soft
 *      checklist + phase-gated Promote/Launch buttons.
 *   2. The D7 lifecycle stepper — a visual-only band-aid.
 *
 * Resolves feedback 6wOENiU3rfuBj3H5nwXq: "rethink the phases of product and
 * how best to show the different buttons and functions so it is not
 * overwhelming, but flows smoothly."
 *
 * DESIGN NOTE — acquisition mode is an ATTRIBUTE, not a branch.
 * A product's acquisition mode (VAR / Resell / Build) is a fixed property
 * chosen once, not a divergent progression that re-converges. The lifecycle
 * (draft → ready → active) is identical regardless of mode. So mode is NOT a
 * MastFlow branch; instead the draft phase's "defined" requirement is
 * mode-aware (its predicate checks recipe / components / supplier depending
 * on acquisitionType), and choosing the mode is itself the first draft
 * requirement. This de-tangles the two complaints: the Mode selector becomes
 * an explicit first step, and the phase progression drives which functions
 * show.
 *
 * Lifecycle (per maker.js): draft → ready → active, with archived as an
 * off-backbone retired terminal. active + hasPendingRevision is a sub-state
 * ("revising"), surfaced by the existing revision banner, not a phase.
 *
 * Reuses maker.js's computeReadinessChecklist via window.makerComputeReadinessChecklist
 * so the requirement predicates stay in one place (the spec doesn't
 * re-implement the readiness logic).
 */
(function() {
  'use strict';
  if (!window.MastFlow) {
    console.error('[products.workflow] MastFlow not loaded — load workflow-engine.js first');
    return;
  }

  // Read the readiness checklist via maker.js's canonical computation.
  // Falls back to an all-false checklist if maker isn't loaded yet (the
  // predicates below then report unmet, which is the safe default).
  function readiness(product) {
    if (typeof window.makerComputeReadinessChecklist === 'function') {
      try { return window.makerComputeReadinessChecklist(product, null) || {}; }
      catch (e) { console.error('[products.workflow] readiness compute failed:', e); }
    }
    return {};
  }

  var phases = [
    {
      key: 'draft',
      label: 'Draft',
      statuses: ['draft'],
      entryStatus: 'draft',
      exitRequirements: [
        {
          key: 'mode-chosen',
          label: 'Acquisition mode chosen',
          hard: true,
          test: function(p) { return !!p.acquisitionType; },
          target: 'define-section',
          action: { label: 'Choose mode', handler: 'chooseMode' }
        },
        {
          key: 'defined',
          label: 'Defined (recipe / components / supplier)',
          hard: true,
          test: function(p) { return !!readiness(p).defined; },
          target: 'define-section'
        },
        {
          key: 'costed',
          label: 'Costed (cost > 0 + markup set)',
          hard: true,
          test: function(p) { return !!readiness(p).costed; },
          target: 'markup-section'
        },
        {
          key: 'listingReady',
          label: 'Listing ready (name + image + description)',
          hard: true,
          test: function(p) { return !!readiness(p).listingReady; },
          target: 'listing-section'
        },
        {
          key: 'channeled',
          label: 'Channel mapping',
          hard: false,
          test: function(p) { return !!readiness(p).channeled; },
          target: 'channels-section'
        },
        {
          key: 'capacityPlanned',
          label: 'Capacity planned',
          hard: false,
          test: function(p) { return !!readiness(p).capacityPlanned; },
          target: 'capacity-section'
        }
      ]
    },
    {
      key: 'ready',
      label: 'Ready',
      statuses: ['ready'],
      entryStatus: 'ready',
      exitRequirements: [
        {
          key: 'channeled-live',
          label: 'Channel mapping (recommended before going live)',
          hard: false,
          test: function(p) { return !!readiness(p).channeled || !!p.internalStorefrontOnly; },
          target: 'channels-section'
        }
      ]
    },
    {
      key: 'active',
      label: 'Active',
      statuses: ['active'],
      entryStatus: 'active',
      // Not terminal — active is the live state. No forward successor on the
      // backbone (archiving is a separate retire action, not "advancing"),
      // so no Advance button shows. Back to Ready remains available.
      exitRequirements: []
    },
    {
      key: 'archived',
      label: 'Archived',
      statuses: ['archived'],
      entryStatus: 'archived',
      terminal: 'retired',  // muted off-backbone pill, not a progression step
      exitRequirements: []
    }
  ];

  function derivePhaseFromLegacy(p) {
    var s = p && p.status;
    if (s === 'archived') return { phase: 'archived', satisfiedRequirementOverrides: [] };
    if (s === 'active') return { phase: 'active', satisfiedRequirementOverrides: [] };
    if (s === 'ready') return { phase: 'ready', satisfiedRequirementOverrides: [] };
    // 'draft' and anything unrecognized → draft.
    return { phase: 'draft', satisfiedRequirementOverrides: [] };
  }

  function canForce(actor, role) {
    return role === 'admin' || role === 'manager';
  }

  // Products live at public/products/{pid} (MastDB.products.PATH = 'public/products').
  function recordPath(pid) {
    return 'public/products/' + pid;
  }

  window.MastFlow.define('products', {
    recordKind: 'product',
    specVersion: 'products@1',
    phases: phases,
    branches: {},
    derivePhaseFromLegacy: derivePhaseFromLegacy,
    canForce: canForce,
    recordPath: recordPath
  });
})();
