/**
 * MastFlow — Workflow Engine
 *
 * Reusable gated-workflow primitive for "process step" surfaces (custom
 * orders, pick/ship, RMA, fulfillment). Design doc:
 *   docs/workflow-engine-design.md
 *
 * Loaded eagerly at app boot (NOT lazy via MODULE_MANIFEST) because workflow
 * specs must be registered before any consuming surface tries to render.
 *
 * Engine global: window.MastFlow
 * Spec files:    app/modules/workflows/*.workflow.js
 */
(function() {
  'use strict';

  // ============================================================
  // Registry
  // ============================================================

  // workflowKey -> definition
  var _registry = Object.create(null);

  // workflowKey -> (targetId -> resolverFn)
  // Resolvers receive (record, targetId) and run the surface-specific
  // focus behavior (scroll to a tab, focus a field, open a modal, etc).
  // Engine never touches DOM directly via targets.
  var _targetResolvers = Object.create(null);

  // workflowKey -> (handlerKey -> handlerFn) for inline action buttons.
  var _actionHandlers = Object.create(null);

  // ============================================================
  // Public API
  // ============================================================

  /**
   * Register a workflow definition. Called at module load by a spec file.
   *
   * definition shape:
   *   {
   *     recordKind: 'commission',
   *     specVersion: 'commissions@1',
   *     phases: [
   *       {
   *         key, label, statuses, entryStatus,
   *         exitRequirements: [ { key, label, hard, test, target?, action? } ],
   *         terminal: 'success' | 'failure' | undefined
   *       },
   *       ...
   *     ],
   *     branches: { phaseKey: { label, choices: [{key,label,entryPhase}], convergesAt } },
   *     derivePhaseFromLegacy: (record) => ({ phase, satisfiedRequirementOverrides: [reqKey,...] }),
   *     canForce: (user, role) => boolean,
   *     recordPath: (recordId) => '{tenantId-rel path}'  // for transition writes
   *   }
   */
  function define(workflowKey, definition) {
    if (!workflowKey || typeof workflowKey !== 'string') {
      throw new Error('MastFlow.define: workflowKey required');
    }
    if (_registry[workflowKey]) {
      console.warn('[MastFlow] re-registering workflow:', workflowKey);
    }
    // Light validation — fail loudly at registration so spec bugs surface
    // before any record is rendered.
    if (!definition || !Array.isArray(definition.phases) || !definition.phases.length) {
      throw new Error('[MastFlow] ' + workflowKey + ': phases[] required');
    }
    if (!definition.specVersion) {
      throw new Error('[MastFlow] ' + workflowKey + ': specVersion required');
    }
    var seenKeys = Object.create(null);
    definition.phases.forEach(function(p, i) {
      if (!p.key) throw new Error('[MastFlow] ' + workflowKey + ': phase[' + i + '] missing key');
      if (seenKeys[p.key]) throw new Error('[MastFlow] ' + workflowKey + ': duplicate phase key ' + p.key);
      seenKeys[p.key] = true;
      (p.exitRequirements || []).forEach(function(r) {
        if (!r.key || !r.label || typeof r.test !== 'function') {
          throw new Error('[MastFlow] ' + workflowKey + ': phase ' + p.key + ' has malformed requirement');
        }
        if (typeof r.hard !== 'boolean') {
          throw new Error('[MastFlow] ' + workflowKey + ': phase ' + p.key + ' req ' + r.key + ' missing hard:bool');
        }
        // Optional `applies(record)` predicate: when present and it returns
        // false for a record, the requirement is omitted entirely (not shown,
        // not evaluated). Lets a phase carry a conditional gate (e.g. a
        // backorder-stock check that only exists for backorder orders) without
        // it appearing as a trivially-satisfied line on every record.
        if (r.applies != null && typeof r.applies !== 'function') {
          throw new Error('[MastFlow] ' + workflowKey + ': phase ' + p.key + ' req ' + r.key + ' applies must be a function');
        }
      });
    });
    if (definition.branches) {
      Object.keys(definition.branches).forEach(function(branchPointKey) {
        if (!seenKeys[branchPointKey]) {
          throw new Error('[MastFlow] ' + workflowKey + ': branch declared on unknown phase ' + branchPointKey);
        }
        var b = definition.branches[branchPointKey];
        if (!b.convergesAt || !seenKeys[b.convergesAt]) {
          throw new Error('[MastFlow] ' + workflowKey + ': branch convergesAt unknown phase ' + b.convergesAt);
        }
        (b.choices || []).forEach(function(c) {
          if (!seenKeys[c.entryPhase]) {
            throw new Error('[MastFlow] ' + workflowKey + ': branch choice entryPhase unknown ' + c.entryPhase);
          }
        });
      });
    }
    _registry[workflowKey] = definition;
    _targetResolvers[workflowKey] = _targetResolvers[workflowKey] || Object.create(null);
    _actionHandlers[workflowKey] = _actionHandlers[workflowKey] || Object.create(null);
    console.log('[MastFlow] registered:', workflowKey, definition.specVersion);
  }

  function getDefinition(workflowKey) {
    return _registry[workflowKey] || null;
  }

  function registerTargetResolver(workflowKey, targetId, resolverFn) {
    if (!_targetResolvers[workflowKey]) _targetResolvers[workflowKey] = Object.create(null);
    _targetResolvers[workflowKey][targetId] = resolverFn;
  }

  function registerActionHandler(workflowKey, handlerKey, handlerFn) {
    if (!_actionHandlers[workflowKey]) _actionHandlers[workflowKey] = Object.create(null);
    _actionHandlers[workflowKey][handlerKey] = handlerFn;
  }

  // ============================================================
  // Internal helpers
  // ============================================================

  function _phaseByKey(def, phaseKey) {
    for (var i = 0; i < def.phases.length; i++) {
      if (def.phases[i].key === phaseKey) return def.phases[i];
    }
    return null;
  }

  function _phaseIndex(def, phaseKey) {
    for (var i = 0; i < def.phases.length; i++) {
      if (def.phases[i].key === phaseKey) return i;
    }
    return -1;
  }

  /**
   * Resolve the current phase for a record.
   * Returns { phaseKey, source: 'record' | 'legacy-status' | 'unknown',
   *           legacyOverrides: [reqKey,...] }
   */
  function _resolvePhase(def, record) {
    if (record && record.__workflow && record.__workflow.phase) {
      return { phaseKey: record.__workflow.phase, source: 'record', legacyOverrides: [] };
    }
    if (typeof def.derivePhaseFromLegacy === 'function') {
      try {
        var d = def.derivePhaseFromLegacy(record) || {};
        if (d.phase && _phaseByKey(def, d.phase)) {
          return {
            phaseKey: d.phase,
            source: 'legacy-status',
            legacyOverrides: d.satisfiedRequirementOverrides || []
          };
        }
      } catch (e) {
        console.error('[MastFlow] derivePhaseFromLegacy threw:', e);
      }
    }
    // Last-resort fallback: first phase.
    return { phaseKey: def.phases[0].key, source: 'unknown', legacyOverrides: [] };
  }

  /**
   * Evaluate all exit requirements for the current phase.
   * Returns Promise<{ missing, satisfied, allHardSatisfied }>.
   * Predicates may be async; we await them all in parallel.
   */
  function _evaluateRequirements(phase, record, legacyOverrides) {
    // Drop requirements whose optional `applies(record)` gate is false — they
    // don't exist for this record (not evaluated, not rendered, don't affect
    // canAdvance). Predicate must be sync; a throw is treated as "applies".
    var reqs = (phase.exitRequirements || []).filter(function(r) {
      if (typeof r.applies !== 'function') return true;
      try { return r.applies(record) !== false; }
      catch (e) { console.error('[MastFlow] requirement applies() threw:', r.key, e); return true; }
    });
    var overrideSet = Object.create(null);
    (legacyOverrides || []).forEach(function(k) { overrideSet[k] = true; });

    var checks = reqs.map(function(r) {
      if (overrideSet[r.key]) {
        return Promise.resolve({ req: r, satisfied: true, value: '(legacy-override)' });
      }
      var result;
      try {
        result = r.test(record);
      } catch (e) {
        console.error('[MastFlow] requirement test threw:', r.key, e);
        return Promise.resolve({ req: r, satisfied: false, value: '(test-error: ' + e.message + ')' });
      }
      return Promise.resolve(result).then(function(ok) {
        // value:null (not undefined) — Firestore rejects undefined in setDoc().
        return { req: r, satisfied: !!ok, value: null };
      }, function(err) {
        console.error('[MastFlow] async requirement test rejected:', r.key, err);
        return { req: r, satisfied: false, value: '(test-error)' };
      });
    });

    return Promise.all(checks).then(function(results) {
      var missing = [], satisfied = [];
      results.forEach(function(r) {
        if (r.satisfied) satisfied.push(r);
        else missing.push(r);
      });
      var allHardSatisfied = missing.every(function(r) { return !r.req.hard; });
      return { missing: missing, satisfied: satisfied, allHardSatisfied: allHardSatisfied };
    });
  }

  /**
   * evaluate(workflowKey, record) — main read API.
   * Returns Promise<{ currentPhase, currentPhaseSource, missing, satisfied,
   *                   canAdvance, nextPhases, isTerminal, isBranchPoint,
   *                   branchChoices, specVersion, specMismatch }>.
   */
  function evaluate(workflowKey, record) {
    var def = getDefinition(workflowKey);
    if (!def) return Promise.reject(new Error('Unknown workflow: ' + workflowKey));

    var resolved = _resolvePhase(def, record);
    var phase = _phaseByKey(def, resolved.phaseKey);
    if (!phase) {
      // Record's recorded phase no longer exists in the spec.
      return Promise.resolve({
        currentPhase: null,
        currentPhaseSource: resolved.source,
        missing: [], satisfied: [],
        canAdvance: false,
        nextPhases: [],
        isTerminal: false,
        isBranchPoint: false,
        branchChoices: [],
        specVersion: def.specVersion,
        specMismatch: true,
        specMismatchReason: 'phase ' + resolved.phaseKey + ' not in spec ' + def.specVersion
      });
    }

    return _evaluateRequirements(phase, record, resolved.legacyOverrides).then(function(ev) {
      var nextPhases = [];
      var isBranchPoint = !!(def.branches && def.branches[phase.key]);
      var branchChoices = isBranchPoint ? def.branches[phase.key].choices.slice() : [];
      if (!phase.terminal && !isBranchPoint) {
        // Walk the *display chain* (not the raw phases[] declaration order)
        // so the successor accounts for which branch the record is on. If
        // __workflow.branch isn't set on a legacy record, infer it from the
        // current phase's home branch.
        var branchKey = (record && record.__workflow && record.__workflow.branch) ||
                         _inferBranchFromPhase(def, phase.key);
        var chain = _resolveDisplayChain(def, branchKey);
        for (var i = 0; i < chain.length; i++) {
          if (chain[i].key === phase.key && i + 1 < chain.length) {
            nextPhases.push(chain[i + 1].key);
            break;
          }
        }
      }
      var recordedVersion = record && record.__workflow && record.__workflow.specVersion;
      var specMismatch = !!(recordedVersion && recordedVersion !== def.specVersion);

      return {
        currentPhase: phase,
        currentPhaseSource: resolved.source,
        missing: ev.missing,
        satisfied: ev.satisfied,
        canAdvance: ev.allHardSatisfied && !phase.terminal,
        nextPhases: nextPhases,
        isTerminal: !!phase.terminal,
        terminalKind: phase.terminal || null,
        isBranchPoint: isBranchPoint,
        branchChoices: branchChoices,
        specVersion: def.specVersion,
        recordedSpecVersion: recordedVersion || null,
        specMismatch: specMismatch
      };
    });
  }

  // ============================================================
  // Transition (write path)
  // ============================================================

  /**
   * transition(workflowKey, record, targetPhaseKey, opts)
   *   opts: {
   *     recordId,           // required if record doesn't carry id
   *     expectedFromPhase,  // required for concurrency safety; pass null for legacy first-touch
   *     force: bool,        // bypass requirement checks (still audited)
   *     reason: string,     // required when force or switchBranchTo
   *     switchBranchTo,     // branch-choice key, used at a branch point to switch
   *     branchChoice,       // branch-choice key, used at a branch point to enter
   *     actor                // { uid, displayName } | { system: '...' }; defaults to currentUser
   *   }
   *
   * Returns Promise resolving to { txId, from, to, branchChoice }.
   * Throws on stale-state, requirement-unmet (when !force), or spec mismatch.
   */
  function transition(workflowKey, record, targetPhaseKey, opts) {
    opts = opts || {};
    var def = getDefinition(workflowKey);
    if (!def) return Promise.reject(new Error('Unknown workflow: ' + workflowKey));

    var recordId = opts.recordId || record.id;
    if (!recordId) return Promise.reject(new Error('[MastFlow] recordId required'));
    if (typeof def.recordPath !== 'function') {
      return Promise.reject(new Error('[MastFlow] spec ' + workflowKey + ' missing recordPath()'));
    }

    var actor = opts.actor || _defaultActor();

    return evaluate(workflowKey, record).then(function(ev) {
      // Concurrency: caller passes expectedFromPhase. If it disagrees with
      // the engine's current read, refuse. Legacy first-touch passes null
      // to opt out (because there's no recorded phase yet).
      var fromPhaseKey = ev.currentPhase ? ev.currentPhase.key : null;
      if (typeof opts.expectedFromPhase !== 'undefined' && opts.expectedFromPhase !== fromPhaseKey) {
        var err = new Error('stale-state: expected ' + opts.expectedFromPhase + ', actual ' + fromPhaseKey);
        err.code = 'STALE_STATE';
        err.expected = opts.expectedFromPhase;
        err.actual = fromPhaseKey;
        throw err;
      }

      // Spec mismatch: refuse non-force transitions if the record's phase
      // no longer exists in the current spec.
      if (ev.specMismatch && !opts.force) {
        var smErr = new Error('spec-mismatch: record on ' + ev.recordedSpecVersion + ', engine on ' + def.specVersion);
        smErr.code = 'SPEC_MISMATCH';
        throw smErr;
      }

      // Branch switch: clear branch and target the branch point itself.
      // Subsequent advance from the branch point selects the new branch via branchChoice.
      var isBranchSwitch = !!opts.switchBranchTo;
      var targetPhase;
      var branchChoiceKey = null;
      if (isBranchSwitch) {
        if (!opts.reason) throw new Error('switchBranchTo requires reason');
        // Validate the new choice exists somewhere as a branch choice on
        // the current branch point or the upstream branch point. We look up
        // the most-recent branch point at or before the current phase.
        var bp = _findBranchPointFor(def, fromPhaseKey, record);
        if (!bp) throw new Error('switchBranchTo: no branch point found upstream of ' + fromPhaseKey);
        var choice = (def.branches[bp.key].choices || []).filter(function(c) { return c.key === opts.switchBranchTo; })[0];
        if (!choice) throw new Error('switchBranchTo: unknown branch choice ' + opts.switchBranchTo);
        targetPhase = _phaseByKey(def, choice.entryPhase);
        branchChoiceKey = opts.switchBranchTo;
      } else {
        targetPhase = _phaseByKey(def, targetPhaseKey);
        if (!targetPhase) throw new Error('Unknown target phase: ' + targetPhaseKey);
        // If current phase is a branch point and caller didn't pass branchChoice,
        // require one.
        if (ev.isBranchPoint && !opts.branchChoice && !opts.force) {
          var bcErr = new Error('branchChoice required at branch point ' + fromPhaseKey);
          bcErr.code = 'BRANCH_CHOICE_REQUIRED';
          throw bcErr;
        }
        branchChoiceKey = opts.branchChoice || null;
      }

      // Requirement check (skipped when force).
      if (!opts.force && !isBranchSwitch && !ev.canAdvance) {
        var rErr = new Error('requirements-unmet: ' +
          ev.missing.filter(function(m) { return m.req.hard; }).map(function(m) { return m.req.key; }).join(', '));
        rErr.code = 'REQUIREMENTS_UNMET';
        rErr.missing = ev.missing;
        throw rErr;
      }

      if (opts.force && !opts.reason) {
        throw new Error('force transition requires reason');
      }
      if (opts.force && typeof def.canForce === 'function') {
        if (!def.canForce(actor, _currentRole())) {
          throw new Error('force not permitted for this user');
        }
      }

      // Compose the writes.
      var now = new Date().toISOString();
      var prevEnteredAt = record && record.__workflow && record.__workflow.phaseEnteredAt;
      var durationMs = prevEnteredAt ? (Date.now() - new Date(prevEnteredAt).getTime()) : null;
      var txId = 'wfx_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

      var newWorkflowBlock = {
        phase: targetPhase.key,
        branch: branchChoiceKey || (record && record.__workflow && record.__workflow.branch) || null,
        phaseEnteredAt: now,
        specVersion: def.specVersion
      };
      if (isBranchSwitch) {
        newWorkflowBlock.branch = branchChoiceKey;
      }

      var auditRow = {
        txId: txId,
        from: fromPhaseKey,
        to: targetPhase.key,
        workflowKey: workflowKey,
        recordKind: def.recordKind,
        recordId: recordId,
        specVersion: def.specVersion,
        by: actor,
        at: now,
        durationInPreviousPhaseMs: durationMs,
        branchChoice: branchChoiceKey,
        branchSwitched: isBranchSwitch,
        satisfiedRequirements: ev.satisfied.map(function(s) {
          return { key: s.req.key, valueAtAdvance: s.value };
        }),
        unmetSoftRequirements: ev.missing.filter(function(m) { return !m.req.hard; }).map(function(m) { return m.req.key; }),
        forced: !!opts.force,
        forceReason: opts.reason || null
      };

      // Record write first (source of truth); audit row second (best-effort).
      // Surfaces also typically write a status field — that's their job, not
      // the engine's, but the spec's entryStatus is the hint they should use.
      var recordPatch = { __workflow: newWorkflowBlock };
      if (targetPhase.entryStatus) {
        // Convention: the engine sets status to the new phase's entryStatus
        // so the legacy enum stays in sync. Surfaces that don't want this
        // can omit entryStatus from the phase def.
        recordPatch.status = targetPhase.entryStatus;
      }
      if (typeof def.recordExtraPatch === 'function') {
        try {
          var extra = def.recordExtraPatch(record, targetPhase, opts, actor) || {};
          Object.keys(extra).forEach(function(k) { recordPatch[k] = extra[k]; });
        } catch (e) {
          console.error('[MastFlow] recordExtraPatch threw:', e);
        }
      }

      var recordPath = def.recordPath(recordId);
      var auditPath = 'admin/workflowTransitions/' + def.recordKind + '/' + recordId + '/' + txId;

      return window.MastDB.update(recordPath, recordPatch).then(function() {
        // Mutate the in-memory record so the immediate caller sees the new state.
        record.__workflow = newWorkflowBlock;
        if (recordPatch.status) record.status = recordPatch.status;
        return window.MastDB.set(auditPath, auditRow).catch(function(err) {
          // Don't fail the transition for an audit write — log loudly.
          console.error('[MastFlow] audit write failed (record state is correct):', err);
        });
      }).then(function() {
        return { txId: txId, from: fromPhaseKey, to: targetPhase.key, branchChoice: branchChoiceKey };
      });
    });
  }

  /**
   * Given a phase key, return the branch choice key whose chain contains
   * this phase, or null if the phase is on the linear backbone (or is
   * itself a branch point / convergence). Used by evaluate() + renderHeader
   * to infer the active branch for legacy records that don't yet have
   * __workflow.branch set.
   */
  function _inferBranchFromPhase(def, phaseKey) {
    if (!def.branches) return null;
    var found = null;
    Object.keys(def.branches).forEach(function(bpKey) {
      var b = def.branches[bpKey];
      (b.choices || []).forEach(function(c) {
        var chain = _walkBranchChain(def, c, bpKey, b.convergesAt);
        for (var i = 0; i < chain.length; i++) {
          if (chain[i].key === phaseKey) { found = c.key; return; }
        }
      });
    });
    return found;
  }

  function _findBranchPointFor(def, currentPhaseKey, record) {
    if (!def.branches) return null;
    // If currentPhase IS a branch point, return it.
    if (def.branches[currentPhaseKey]) return _phaseByKey(def, currentPhaseKey);
    // Otherwise walk backwards from the current phase looking for a branch
    // point whose choices' entryPhase chains forward to currentPhase. For
    // now we use the simpler: any branch point earlier in the phases[]
    // ordering, since branches re-converge and the current spec format
    // assumes a single active branch tracked on record.__workflow.branch.
    var idx = _phaseIndex(def, currentPhaseKey);
    for (var i = idx; i >= 0; i--) {
      if (def.branches[def.phases[i].key]) return def.phases[i];
    }
    return null;
  }

  function _defaultActor() {
    // The bare `currentUser` var in app/index.html is NOT attached to window
    // (verified on sgtest15 — window.currentUser is undefined while signed
    // in). MastAdmin.currentUser is the reliable accessor; fall back to
    // window.currentUser for any context that exposes it that way.
    var u = (window.MastAdmin && window.MastAdmin.currentUser) || window.currentUser;
    if (u && u.uid) {
      return { uid: u.uid, displayName: u.displayName || u.email || u.uid };
    }
    return { system: 'unknown' };
  }

  function _currentRole() {
    // Same accessor pattern as _defaultActor — currentUserRole isn't on
    // window either.
    if (window.MastAdmin && window.MastAdmin.currentUserRole) return window.MastAdmin.currentUserRole;
    return window.currentUserRole || null;
  }

  // ============================================================
  // Diagnose (debug introspection)
  // ============================================================

  function diagnose(workflowKey, record) {
    var def = getDefinition(workflowKey);
    if (!def) return Promise.reject(new Error('Unknown workflow: ' + workflowKey));
    return evaluate(workflowKey, record).then(function(ev) {
      return {
        workflowKey: workflowKey,
        specVersion: def.specVersion,
        recordedSpecVersion: ev.recordedSpecVersion,
        specMismatch: ev.specMismatch,
        currentPhase: ev.currentPhase ? ev.currentPhase.key : null,
        currentPhaseSource: ev.currentPhaseSource,
        isBranchPoint: ev.isBranchPoint,
        branch: record && record.__workflow && record.__workflow.branch,
        requirements: ev.satisfied.concat(ev.missing).map(function(r) {
          return {
            key: r.req.key,
            label: r.req.label,
            hard: r.req.hard,
            satisfied: ev.satisfied.indexOf(r) !== -1,
            target: r.req.target || null
          };
        }),
        canAdvance: ev.canAdvance,
        nextPhases: ev.nextPhases,
        branchChoices: ev.branchChoices
      };
    });
  }

  // ============================================================
  // Header render
  // ============================================================

  /**
   * renderHeader(workflowKey, record, callbacks) → Promise<HTML string>
   *
   * callbacks: { onAdvance, onBack, onBranch, onForce, onSwitchBranch, onTarget, onAction }
   * Each callback receives the global function name as a string (engine
   * uses inline onclick=...), so callers must register their handlers on
   * window. See app/modules/workflows/README or the commissions migration
   * for the pattern.
   *
   * For now we expose engine-level inline handlers via window.MastFlow.__ui.*
   * and the caller registers their per-record callbacks against a unique
   * uiContextId returned by renderHeader.
   */
  function renderHeader(workflowKey, record, callbacks) {
    callbacks = callbacks || {};
    return evaluate(workflowKey, record).then(function(ev) {
      var def = getDefinition(workflowKey);
      var ctxId = _registerUiContext(workflowKey, record, callbacks);
      var html = '';

      if (ev.specMismatch) {
        html += _renderSpecMismatchBanner(ev);
      }

      html += _renderStepper(def, record, ev);
      html += _renderActionBar(def, record, ev, ctxId);

      return { html: html, uiContextId: ctxId, evaluation: ev };
    });
  }

  // ---- UI context registry ----
  var _uiContexts = Object.create(null);
  var _uiCounter = 0;
  function _registerUiContext(workflowKey, record, callbacks) {
    var id = 'mfctx_' + (++_uiCounter);
    _uiContexts[id] = {
      workflowKey: workflowKey,
      recordId: record.id,
      // The live record is retained so guided-rail clicks can re-evaluate
      // against current state before deciding advance/back/blocked. The
      // record is mutated in place on transition (see transition()), and the
      // host re-renders (new context) after each transition, so this stays fresh.
      record: record,
      callbacks: callbacks
    };
    return id;
  }
  function _getUiContext(ctxId) { return _uiContexts[ctxId] || null; }

  // Inline handlers (called from rendered HTML).
  var ui = {
    advance: function(ctxId, targetPhaseKey) {
      var ctx = _getUiContext(ctxId); if (!ctx || !ctx.callbacks.onAdvance) return;
      ctx.callbacks.onAdvance(targetPhaseKey);
    },
    back: function(ctxId, targetPhaseKey) {
      var ctx = _getUiContext(ctxId); if (!ctx || !ctx.callbacks.onBack) return;
      ctx.callbacks.onBack(targetPhaseKey);
    },
    branch: function(ctxId, branchChoiceKey, entryPhaseKey) {
      var ctx = _getUiContext(ctxId); if (!ctx || !ctx.callbacks.onBranch) return;
      ctx.callbacks.onBranch(branchChoiceKey, entryPhaseKey);
    },
    force: function(ctxId) {
      var ctx = _getUiContext(ctxId); if (!ctx || !ctx.callbacks.onForce) return;
      ctx.callbacks.onForce();
    },
    target: function(ctxId, targetId) {
      var ctx = _getUiContext(ctxId); if (!ctx) return;
      var res = (_targetResolvers[ctx.workflowKey] || {})[targetId];
      if (typeof res === 'function') res();
      else if (ctx.callbacks.onTarget) ctx.callbacks.onTarget(targetId);
      else console.warn('[MastFlow] no resolver for target', ctx.workflowKey, targetId);
    },
    action: function(ctxId, handlerKey) {
      var ctx = _getUiContext(ctxId); if (!ctx) return;
      var h = (_actionHandlers[ctx.workflowKey] || {})[handlerKey];
      if (typeof h === 'function') h(ctx.recordId);
      else if (ctx.callbacks.onAction) ctx.callbacks.onAction(handlerKey);
      else console.warn('[MastFlow] no handler for', ctx.workflowKey, handlerKey);
    },
    // Guided-header rail: a step was clicked. Re-evaluate live, then route:
    //   • clicked phase is BEFORE current        → Back (onBack)
    //   • clicked phase IS current               → focus its checklist
    //   • clicked phase is the reachable NEXT     → Advance (onAdvance) iff
    //     the current phase's hard reqs are met; else focus checklist + toast
    //   • any other / still-gated future phase    → blocked toast ("N left")
    phaseStep: function(ctxId, phaseKey) {
      var ctx = _getUiContext(ctxId); if (!ctx) return;
      var def = getDefinition(ctx.workflowKey); if (!def) return;
      var rec = ctx.record;
      evaluate(ctx.workflowKey, rec).then(function(ev) {
        if (ev.isTerminal || ev.specMismatch) return;
        var current = ev.currentPhase ? ev.currentPhase.key : null;
        if (!current) return;
        var branch = (rec && rec.__workflow && rec.__workflow.branch) ||
                     _inferBranchFromPhase(def, current);
        var chain = _resolveDisplayChain(def, branch);
        var curIdx = -1, clickIdx = -1;
        chain.forEach(function(p, i) {
          if (p.key === current) curIdx = i;
          if (p.key === phaseKey) clickIdx = i;
        });
        if (clickIdx === -1 || curIdx === -1) return;

        if (clickIdx === curIdx) {
          // Click the current step → toggle the "what's left" panel (pull, not push).
          _toggleGuidedChecklist(ctxId);
          return;
        }
        if (clickIdx < curIdx) {
          // Review-only (ratified 2026-06-07): clicking a COMPLETED step shows
          // what that phase captured, read-only — it does NOT move the record
          // backward. Going back a phase is a rare, explicit action, not a
          // side effect of a stray click.
          _reviewGuidedPhase(ctxId, def, rec, phaseKey);
          return;
        }
        // clickIdx > curIdx → a forward step.
        var nextKey = (ev.nextPhases && ev.nextPhases.length) ? ev.nextPhases[0] : null;
        var isImmediateNext = (clickIdx === curIdx + 1 && phaseKey === nextKey);
        if (isImmediateNext && ev.canAdvance && !ev.isBranchPoint) {
          if (ctx.callbacks.onAdvance) ctx.callbacks.onAdvance(phaseKey);
          return;
        }
        // Not reachable yet — never a silent no-op. Reveal the current phase's
        // remaining items and toast the hard-requirement count.
        _showGuidedChecklist(ctxId);
        var unmetHard = ev.missing.filter(function(m) { return m.req.hard; }).length;
        var n = unmetHard || 1;
        var msg = n + ' item' + (n === 1 ? '' : 's') + ' left in ' + (ev.currentPhase.label || 'this step');
        if (window.showToast) window.showToast(msg, true);
        else if (window.MastAdmin && typeof MastAdmin.showToast === 'function') MastAdmin.showToast(msg);
      }).catch(function(e) { console.error('[MastFlow] phaseStep', e); });
    },
    // "Show N completed" — completed setup items are history, revealed only on
    // request. Flips the hidden _done block + the link label.
    toggleDone: function(ctxId) {
      var d = document.getElementById(ctxId + '_done'); if (!d) return;
      var link = document.getElementById(ctxId + '_donetoggle');
      var show = d.style.display === 'none';
      d.style.display = show ? 'flex' : 'none';
      if (link) link.textContent = show ? 'Hide completed' : (link.getAttribute('data-show') || 'Show completed');
    },
    // Leave a completed-step review → restore the live checklist, collapse it.
    closeReview: function(ctxId) {
      var el = document.getElementById(ctxId + '_checklist'); if (!el) return;
      if (_guidedReviewLive[ctxId] != null) { el.innerHTML = _guidedReviewLive[ctxId]; _guidedReviewLive[ctxId] = null; }
      el.style.display = 'none';
    }
  };

  // While a completed step is being reviewed, the live checklist HTML is stashed
  // here (keyed by ctxId) so returning to the current step restores it verbatim.
  var _guidedReviewLive = {};

  // The checklist is collapsed by default. Clicking the current step toggles it;
  // a blocked-forward click ensures it's shown. Completed items stay hidden
  // inside until "Show N completed" is clicked (ui.toggleDone). If a completed-
  // step review is showing, clicking the current step restores the live checklist.
  function _toggleGuidedChecklist(ctxId) {
    var el = document.getElementById(ctxId + '_checklist');
    if (!el) return;
    if (_guidedReviewLive[ctxId] != null) {
      el.innerHTML = _guidedReviewLive[ctxId];
      _guidedReviewLive[ctxId] = null;
      el.style.display = 'flex';
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    el.style.display = (el.style.display === 'none') ? 'flex' : 'none';
    if (el.style.display !== 'none') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // Read-only review of a COMPLETED phase's exit requirements (no transition).
  function _reviewGuidedPhase(ctxId, def, record, phaseKey) {
    var el = document.getElementById(ctxId + '_checklist');
    if (!el) return;
    if (_guidedReviewLive[ctxId] == null) _guidedReviewLive[ctxId] = el.innerHTML;  // stash live once
    var phase = (def.phases || []).filter(function(p) { return p.key === phaseKey; })[0];
    var reqs = (phase && phase.exitRequirements) || [];
    var rows = reqs.map(function(r) {
      var ok = true; try { ok = r.test ? !!r.test(record) : true; } catch (e) { ok = true; }
      return '<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;">' +
        '<span style="display:inline-flex;width:18px;height:18px;border-radius:50%;background:color-mix(in srgb,var(--teal) 16%,transparent);color:var(--teal);align-items:center;justify-content:center;font-weight:700;font-size:0.72rem;flex-shrink:0;">' + (ok ? '✓' : '·') + '</span>' +
        '<span style="color:var(--warm-gray);">' + _esc(r.label) + '</span></div>';
    }).join('');
    if (!rows) rows = '<div style="font-size:0.82rem;color:var(--warm-gray);">Nothing was required at this step.</div>';
    el.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">' +
        '<span style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--warm-gray);">Reviewing: ' + _esc((phase && phase.label) || phaseKey) + ' · completed</span>' +
        '<a href="#" onclick="event.preventDefault();MastFlow.__ui.closeReview(\'' + ctxId + '\')" style="color:var(--teal);font-size:0.78rem;text-decoration:underline;white-space:nowrap;">Back to current step</a>' +
      '</div>' + rows;
    el.style.display = 'flex';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  function _showGuidedChecklist(ctxId) {
    var el = document.getElementById(ctxId + '_checklist');
    if (!el) return;
    el.style.display = 'flex';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---- Renderers (HTML strings) ----

  function _esc(s) {
    return (window.esc ? window.esc(s) : String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  }

  function _renderSpecMismatchBanner(ev) {
    return '<div style="margin:10px 0;padding:10px 14px;border-radius:8px;background:rgba(234,179,8,0.10);color:#a67c00;font-size:0.85rem;border:1px solid rgba(234,179,8,0.4);">' +
      '<strong>Workflow updated.</strong> This record was last advanced under <code>' + _esc(ev.recordedSpecVersion || '(none)') + '</code>; the engine is now on <code>' + _esc(ev.specVersion) + '</code>. Review needed before further transitions.' +
    '</div>';
  }

  function _renderStepper(def, record, ev) {
    // Render the linear backbone. If we're in a branch, show the chosen
    // branch's phases inline between the branch point and convergence.
    // Falls back to inferring the branch from the current phase (for legacy
    // records without __workflow.branch yet) so the stepper draws the right
    // chain even on first read.
    var current = ev.currentPhase ? ev.currentPhase.key : null;
    var currentBranch = (record && record.__workflow && record.__workflow.branch) ||
                        _inferBranchFromPhase(def, current);
    var displayPhases = _resolveDisplayChain(def, currentBranch);

    var currentIdx = -1;
    displayPhases.forEach(function(p, i) {
      if (p.key === current) currentIdx = i;
    });

    // Off-backbone terminal states render as a single pill, not a progression
    // step. 'failure' (declined/canceled) is red; 'retired' (archived) is a
    // muted gray — the progression doesn't apply once the record is retired,
    // but it isn't a failure either.
    if (ev.isTerminal && ev.terminalKind === 'failure') {
      return '<div style="margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(220,38,38,0.08);color:var(--danger,#b81d1d);font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;">' +
        '✕ ' + _esc(ev.currentPhase.label) +
      '</div>';
    }
    if (ev.isTerminal && ev.terminalKind === 'retired') {
      return '<div style="margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(0,0,0,0.05);color:var(--warm-gray,#777);font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;">' +
        '⊘ ' + _esc(ev.currentPhase.label) +
      '</div>';
    }

    var html = '<div style="margin-top:14px;display:flex;align-items:center;gap:0;overflow-x:auto;padding-bottom:4px;" aria-label="Workflow progress" role="list">';
    displayPhases.forEach(function(p, i) {
      var state = i < currentIdx ? 'done' : (i === currentIdx ? 'current' : 'upcoming');
      var dotBg, dotColor, dotBorder, labelColor, labelWeight;
      if (state === 'done') {
        dotBg = 'var(--teal)'; dotColor = '#fff'; dotBorder = 'var(--teal)';
        labelColor = 'var(--teal)'; labelWeight = '600';
      } else if (state === 'current') {
        dotBg = '#fff'; dotColor = 'var(--teal)'; dotBorder = 'var(--teal)';
        labelColor = 'var(--teal)'; labelWeight = '700';
      } else {
        dotBg = 'transparent'; dotColor = 'var(--warm-gray)'; dotBorder = 'var(--cream-dark)';
        labelColor = 'var(--warm-gray)'; labelWeight = '500';
      }
      var connector = '';
      if (i < displayPhases.length - 1) {
        var lineColor = i < currentIdx ? 'var(--teal)' : 'var(--cream-dark)';
        connector = '<div style="flex:1;height:2px;background:' + lineColor + ';min-width:18px;"></div>';
      }
      var glyph = state === 'done' ? '✓' : String(i + 1);
      // For the current phase with unmet hard reqs, show count chip.
      var chip = '';
      if (state === 'current') {
        var unmetHard = ev.missing.filter(function(m) { return m.req.hard; }).length;
        if (unmetHard > 0) {
          chip = ' <span style="background:rgba(220,38,38,0.10);color:var(--danger,#b81d1d);padding:1px 6px;border-radius:8px;font-size:0.72rem;font-weight:700;">' + unmetHard + ' to do</span>';
        }
      }
      // data-mf-phase makes each step targetable by MastFlow.focusPhase()
      // for deep-linking (e.g. a dashboard "stuck in Quoted" link → ?focus=quoted).
      html += '<div role="listitem" data-mf-phase="' + _esc(p.key) + '" style="display:flex;align-items:center;gap:6px;flex-shrink:0;border-radius:6px;transition:background 0.4s;" title="' + _esc(p.label) + '">' +
        '<div style="width:22px;height:22px;border-radius:50%;background:' + dotBg + ';color:' + dotColor + ';border:2px solid ' + dotBorder + ';display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;flex-shrink:0;">' + glyph + '</div>' +
        '<span style="font-size:0.78rem;color:' + labelColor + ';font-weight:' + labelWeight + ';white-space:nowrap;">' + _esc(p.label) + chip + '</span>' +
      '</div>' + connector;
    });
    html += '</div>';
    return html;
  }

  // Off-backbone terminals (failure/retired) render as a standalone pill when
  // the record is IN them — they must not appear as progression steps in the
  // stepper. Terminal 'success' stays on the backbone (it's the goal state).
  function _isOffBackbone(p) {
    return p.terminal === 'failure' || p.terminal === 'retired';
  }

  /**
   * Build the linear visible chain of phases. If currentBranch is set, the
   * branch's phases get spliced between the branch point and convergesAt.
   */
  function _resolveDisplayChain(def, currentBranch) {
    if (!def.branches || !currentBranch) {
      // Filter out phases that belong to non-default branches (entry phases
      // of branch choices) and off-backbone terminals so the default
      // forward backbone shows by itself.
      var branchedPhases = _allBranchedPhaseKeys(def);
      return def.phases.filter(function(p) { return !branchedPhases[p.key] && !_isOffBackbone(p); });
    }
    // Find the branch point + the matching choice; splice its phases in.
    var bpKey, choice;
    Object.keys(def.branches).forEach(function(k) {
      var b = def.branches[k];
      var ch = (b.choices || []).filter(function(c) { return c.key === currentBranch; })[0];
      if (ch) { bpKey = k; choice = ch; }
    });
    if (!bpKey || !choice) return def.phases.filter(function(p) { return !_isOffBackbone(p); });
    var branchedPhases = _allBranchedPhaseKeys(def);
    var bpIdx = _phaseIndex(def, bpKey);
    var convKey = def.branches[bpKey].convergesAt;
    var convIdx = _phaseIndex(def, convKey);

    var head = def.phases.slice(0, bpIdx + 1).filter(function(p) { return !branchedPhases[p.key] && !_isOffBackbone(p); });
    var tail = def.phases.slice(convIdx).filter(function(p) { return !branchedPhases[p.key] && !_isOffBackbone(p); });
    var branchChain = _walkBranchChain(def, choice, bpKey, convKey);
    return head.concat(branchChain).concat(tail);
  }

  function _allBranchedPhaseKeys(def) {
    var out = Object.create(null);
    if (!def.branches) return out;
    Object.keys(def.branches).forEach(function(bpKey) {
      (def.branches[bpKey].choices || []).forEach(function(c) {
        var chain = _walkBranchChain(def, c, bpKey, def.branches[bpKey].convergesAt);
        chain.forEach(function(p) { out[p.key] = true; });
      });
    });
    return out;
  }

  /**
   * Walk the phase chain for a specific branch choice. If the choice
   * declares `phases: [...]` explicitly, use those (recommended; avoids
   * declaration-order coupling). Otherwise fall back to walking phases[]
   * from entryPhase forward until stopKey, skipping phases that belong to
   * SIBLING branches (so a pack-ship walk doesn't accidentally include
   * pickup-ready phases that happen to come next in declaration order).
   */
  function _walkBranchChain(def, choice, branchPointKey, stopKey) {
    var out = [];
    if (choice && Array.isArray(choice.phases)) {
      choice.phases.forEach(function(k) {
        var p = _phaseByKey(def, k);
        if (p) out.push(p);
      });
      return out;
    }
    // Fallback: collect sibling-branch phase keys so we can skip them.
    var siblings = Object.create(null);
    if (def.branches && branchPointKey && def.branches[branchPointKey]) {
      (def.branches[branchPointKey].choices || []).forEach(function(other) {
        if (other === choice) return;
        if (Array.isArray(other.phases)) {
          other.phases.forEach(function(k) { siblings[k] = true; });
        }
      });
    }
    var idx = _phaseIndex(def, choice ? choice.entryPhase : null);
    var seen = Object.create(null);
    while (idx >= 0 && idx < def.phases.length) {
      var p = def.phases[idx];
      if (p.key === stopKey) break;
      if (siblings[p.key]) break;  // hit a sibling branch — end of our chain
      if (seen[p.key]) break;
      seen[p.key] = true;
      out.push(p);
      idx++;
    }
    return out;
  }

  function _renderActionBar(def, record, ev, ctxId) {
    if (ev.specMismatch) return '';
    if (ev.isTerminal) {
      return '<div style="margin-top:10px;background:var(--cream,#f5f0e8);border-radius:8px;padding:14px 18px;font-size:0.85rem;color:var(--warm-gray);">' +
        _esc(ev.currentPhase.label) + ' — workflow complete.' +
      '</div>';
    }
    var phase = ev.currentPhase;

    // Phase label + checklist
    var phaseLabel = '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Current phase: ' + _esc(phase.label) + '</div>';

    var checklistHtml = '';
    var allReqs = ev.satisfied.concat(ev.missing);
    if (allReqs.length) {
      checklistHtml = '<div style="display:flex;flex-direction:column;gap:6px;margin:8px 0 12px 0;">';
      allReqs.forEach(function(r) {
        var sat = ev.satisfied.indexOf(r) !== -1;
        var icon, color;
        if (sat) { icon = '✓'; color = 'var(--teal)'; }
        else if (r.req.hard) { icon = '✗'; color = 'var(--danger,#b81d1d)'; }
        else { icon = '!'; color = '#a67c00'; }
        var targetBtn = '';
        if (!sat && r.req.target) {
          targetBtn = ' <a href="#" onclick="event.preventDefault();MastFlow.__ui.target(\'' + ctxId + '\',\'' + _esc(r.req.target) + '\')" style="color:var(--teal);font-size:0.78rem;margin-left:8px;">Go &rarr;</a>';
        }
        var actionBtn = '';
        if (!sat && r.req.action) {
          actionBtn = ' <button type="button" onclick="MastFlow.__ui.action(\'' + ctxId + '\',\'' + _esc(r.req.action.handler) + '\')" style="margin-left:8px;background:var(--teal);color:#fff;border:none;border-radius:4px;padding:2px 10px;font-size:0.78rem;cursor:pointer;">' + _esc(r.req.action.label) + '</button>';
        }
        checklistHtml += '<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;">' +
          '<span style="display:inline-flex;width:18px;height:18px;border-radius:50%;background:' + (sat ? 'rgba(42,157,143,0.15)' : (r.req.hard ? 'rgba(220,38,38,0.10)' : 'rgba(234,179,8,0.10)')) + ';color:' + color + ';align-items:center;justify-content:center;font-weight:700;font-size:0.72rem;flex-shrink:0;">' + icon + '</span>' +
          '<span style="color:' + (sat ? 'var(--warm-gray)' : 'inherit') + ';' + (sat ? 'text-decoration:line-through;' : '') + '">' + _esc(r.req.label) + (r.req.hard ? '' : ' <em style="color:var(--warm-gray);font-size:0.78rem;">(recommended)</em>') + '</span>' +
          targetBtn + actionBtn +
        '</div>';
      });
      checklistHtml += '</div>';
    }

    // Buttons
    var buttonsHtml = '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;margin-top:8px;">';

    // Back button — to the previous phase in the display chain.
    var currentBranch = (record && record.__workflow && record.__workflow.branch) ||
                        _inferBranchFromPhase(def, phase.key);
    var displayChain = _resolveDisplayChain(def, currentBranch);
    var displayIdx = -1;
    displayChain.forEach(function(p, i) { if (p.key === phase.key) displayIdx = i; });
    if (displayIdx > 0) {
      var prevPhase = displayChain[displayIdx - 1];
      buttonsHtml += '<button type="button" class="btn btn-secondary" style="font-size:0.85rem;" onclick="MastFlow.__ui.back(\'' + ctxId + '\',\'' + _esc(prevPhase.key) + '\')">&larr; Back to ' + _esc(prevPhase.label) + '</button>';
    }

    if (ev.isBranchPoint) {
      // Branch choice buttons instead of Advance.
      buttonsHtml += '<span style="font-size:0.85rem;color:var(--warm-gray);margin-right:6px;">Choose next step:</span>';
      ev.branchChoices.forEach(function(c) {
        var enabled = ev.canAdvance;
        buttonsHtml += '<button type="button" class="btn btn-primary" style="font-size:0.85rem;' + (enabled ? '' : 'opacity:0.5;cursor:not-allowed;') + '" ' +
          (enabled ? '' : 'disabled ') +
          'onclick="MastFlow.__ui.branch(\'' + ctxId + '\',\'' + _esc(c.key) + '\',\'' + _esc(c.entryPhase) + '\')">' + _esc(c.label) + '</button>';
      });
    } else if (ev.nextPhases.length) {
      var nextKey = ev.nextPhases[0];
      var nextPhase = _phaseByKey(def, nextKey);
      var enabled = ev.canAdvance;
      buttonsHtml += '<button type="button" class="btn btn-primary" style="font-size:0.85rem;' + (enabled ? '' : 'opacity:0.5;cursor:not-allowed;') + '" ' +
        (enabled ? '' : 'disabled ') +
        'onclick="MastFlow.__ui.advance(\'' + ctxId + '\',\'' + _esc(nextKey) + '\')">Advance to ' + _esc(nextPhase.label) + ' &rarr;</button>';
    }

    // Force-advance menu (small, role-gated by caller via onForce callback presence)
    var ctx = _getUiContext(ctxId);
    if (ctx && ctx.callbacks.onForce) {
      buttonsHtml += '<button type="button" title="Advance anyway (requires reason)" onclick="MastFlow.__ui.force(\'' + ctxId + '\')" style="background:none;border:1px solid var(--cream-dark);border-radius:6px;padding:4px 10px;font-size:0.78rem;color:var(--warm-gray);cursor:pointer;">⋯</button>';
    }
    buttonsHtml += '</div>';

    return '<div style="margin-top:10px;background:var(--cream,#f5f0e8);border-radius:8px;padding:14px 18px;">' +
      phaseLabel + checklistHtml + buttonsHtml +
    '</div>';
  }

  // ============================================================
  // Guided header (opt-in, leaner variant of renderHeader)
  // ============================================================

  /**
   * renderGuidedHeader(workflowKey, record, callbacks) → Promise<{html, uiContextId, evaluation}>
   *
   * The ratified "guided-record" header (docs/ux-audit/guided-record-mock.html).
   * Same evaluate()/callback contract as renderHeader, but rendered leaner:
   *   • a clickable horizontal step rail (the spine) — NO band, NO "Current phase"
   *     label, NO separate Advance button;
   *   • the current phase's exit-requirements as a lean checklist beneath the rail.
   *
   * The process is a CLICK: clicking the next phase's step ADVANCES (via
   * onAdvance) iff the current phase's hard requirements are met; if not, it
   * focuses the checklist + toasts "N item(s) left" (no silent no-op). Clicking
   * a past phase = Back (onBack). Clicking the current phase focuses its
   * checklist. A future phase still gated by unmet hard reqs renders "locked"
   * with a "· N to do" reason and does not advance.
   *
   * Additive: renderHeader stays for orders/commissions. Opt in via a schema
   * flag (shared/mast-entity.js: detail.guidedHeader === true).
   */
  function renderGuidedHeader(workflowKey, record, callbacks, opts) {
    callbacks = callbacks || {};
    // Opt-in (schema detail.guidedExpandCurrent): render the CURRENT phase's
    // checklist expanded on first paint instead of collapsed. Past phases still
    // review-on-click, future phases still pull. Used by orders, whose process
    // pane otherwise opens to a bare rail with no visible steps when the current
    // phase has no unmet hard reqs (so no "· N to set up ▾" cue either).
    var expandCurrent = !!(opts && opts.expandCurrent);
    return evaluate(workflowKey, record).then(function(ev) {
      var def = getDefinition(workflowKey);
      var ctxId = _registerUiContext(workflowKey, record, callbacks);
      var html = '';

      if (ev.specMismatch) {
        html += _renderSpecMismatchBanner(ev);
      }

      // Tuck: once the record reaches its live end-state (advanced as far as it
      // goes, nothing left to set up), the lifecycle is done — you won't go
      // backwards. Hide the rail entirely; the status pill reveals it on demand.
      var unmetHard = (ev.missing || []).filter(function(m) { return m.req.hard; }).length;
      var tucked = !ev.specMismatch && !ev.isTerminal && !ev.isBranchPoint &&
                   (!ev.nextPhases || !ev.nextPhases.length) && unmetHard === 0;
      var rail = _renderGuidedRail(def, record, ev, ctxId) + _renderGuidedChecklist(def, record, ev, ctxId, expandCurrent);
      var railWrapId = ctxId + '_railwrap';
      html += tucked ? ('<div id="' + railWrapId + '" style="display:none;">' + rail + '</div>') : rail;

      return { html: html, uiContextId: ctxId, evaluation: ev, tucked: tucked, railWrapId: railWrapId };
    });
  }

  // The clickable step rail (the spine). Off-backbone terminals (failure/
  // retired) render as a standalone pill exactly like the stepper does.
  function _renderGuidedRail(def, record, ev, ctxId) {
    if (ev.isTerminal && ev.terminalKind === 'failure') {
      return '<div style="margin-top:6px;padding:8px 13px;border-radius:8px;background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger);font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;">' +
        '✕ ' + _esc(ev.currentPhase.label) +
      '</div>';
    }
    if (ev.isTerminal && ev.terminalKind === 'retired') {
      return '<div style="margin-top:6px;padding:8px 13px;border-radius:8px;background:color-mix(in srgb,var(--warm-gray) 14%,transparent);color:var(--warm-gray);font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;">' +
        '⊘ ' + _esc(ev.currentPhase.label) +
      '</div>';
    }

    var current = ev.currentPhase ? ev.currentPhase.key : null;
    var currentBranch = (record && record.__workflow && record.__workflow.branch) ||
                        _inferBranchFromPhase(def, current);
    var displayPhases = _resolveDisplayChain(def, currentBranch);
    var currentIdx = -1;
    displayPhases.forEach(function(p, i) { if (p.key === current) currentIdx = i; });

    // The next phase on the backbone is reachable-now iff the current phase's
    // hard requirements are met (ev.canAdvance) and we're not at a branch point.
    var nextKey = (ev.nextPhases && ev.nextPhases.length) ? ev.nextPhases[0] : null;
    var unmetHard = ev.missing.filter(function(m) { return m.req.hard; }).length;

    var html = '<div style="margin-top:8px;display:flex;align-items:center;gap:0;flex-wrap:wrap;" aria-label="Workflow progress" role="list">';
    displayPhases.forEach(function(p, i) {
      var state = i < currentIdx ? 'done' : (i === currentIdx ? 'current' : 'upcoming');
      // Reachability: the immediate next backbone phase is clickable when the
      // current phase's hard reqs are met; a further-out (or still-gated) future
      // phase is "locked".
      var isNext = (state === 'upcoming' && i === currentIdx + 1 && p.key === nextKey);
      var reachable = isNext && ev.canAdvance && !ev.isBranchPoint;
      var locked = (state === 'upcoming') && !reachable;

      var dotBg, dotColor, dotBorder, dotBorderStyle, labelColor, labelWeight, cursor, hoverBg;
      if (state === 'done') {
        dotBg = 'var(--teal)'; dotColor = 'var(--surface-card)'; dotBorder = 'var(--teal)'; dotBorderStyle = 'solid';
        labelColor = 'var(--teal)'; labelWeight = '600'; cursor = 'pointer'; hoverBg = 'color-mix(in srgb,var(--text) 6%,transparent)';
      } else if (state === 'current') {
        dotBg = 'transparent'; dotColor = 'var(--amber)'; dotBorder = 'var(--amber)'; dotBorderStyle = 'solid';
        labelColor = 'var(--text)'; labelWeight = '600'; cursor = 'pointer'; hoverBg = 'color-mix(in srgb,var(--text) 6%,transparent)';
      } else if (reachable) {
        dotBg = 'transparent'; dotColor = 'var(--teal)'; dotBorder = 'var(--teal)'; dotBorderStyle = 'solid';
        labelColor = 'var(--teal)'; labelWeight = '600'; cursor = 'pointer'; hoverBg = 'color-mix(in srgb,var(--teal) 10%,transparent)';
      } else {
        dotBg = 'transparent'; dotColor = 'var(--warm-gray)'; dotBorder = 'var(--border-strong,var(--border))'; dotBorderStyle = 'dashed';
        labelColor = 'var(--warm-gray)'; labelWeight = '500'; cursor = 'not-allowed'; hoverBg = 'transparent';
      }

      var activeBg = (state === 'current') ? 'color-mix(in srgb,var(--amber) 9%,transparent)' : 'transparent';
      var glyph = state === 'done' ? '✓' : (locked ? '⚠' : String(i + 1));
      // A locked future phase shows the reason (mirrors the prototype's "· needs
      // Connect" / "· N to do"). For the immediate-next phase the blocker is the
      // current phase's unmet hard reqs.
      // Default header = the rail ALONE. The setup checklist is pulled, not
      // pushed: the CURRENT phase carries a quiet "· N to set up ▾" cue; clicking
      // the step reveals only what's LEFT (completed items are history, on
      // request). Locked future steps just read as locked — no count noise.
      var reasonHtml = '';
      if (state === 'current' && unmetHard > 0) {
        reasonHtml = ' <span style="font-size:0.72rem;color:var(--warm-gray);">· ' + unmetHard + ' to set up ▾</span>';
      }

      // onclick → MastFlow.__ui.phaseStep(ctx, phaseKey). The handler decides
      // advance/back/focus/blocked-toast from the live evaluation.
      html += '<div role="listitem" data-mf-phase="' + _esc(p.key) + '" ' +
        'onclick="MastFlow.__ui.phaseStep(\'' + ctxId + '\',\'' + _esc(p.key) + '\')" ' +
        'title="' + _esc(p.label) + '" ' +
        'style="display:flex;align-items:center;gap:7px;flex-shrink:0;padding:6px 9px;border-radius:8px;cursor:' + cursor + ';background:' + activeBg + ';transition:background 0.15s;" ' +
        'onmouseover="this.style.background=\'' + hoverBg + '\'" onmouseout="this.style.background=\'' + activeBg + '\'">' +
        '<span style="width:21px;height:21px;border-radius:50%;background:' + dotBg + ';color:' + dotColor + ';border:1.5px ' + dotBorderStyle + ' ' + dotBorder + ';display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;flex-shrink:0;">' + glyph + '</span>' +
        '<span style="font-size:0.85rem;color:' + labelColor + ';font-weight:' + labelWeight + ';white-space:nowrap;">' + _esc(p.label) + reasonHtml + '</span>' +
      '</div>';
      if (i < displayPhases.length - 1) {
        var lineColor = i < currentIdx ? 'color-mix(in srgb,var(--teal) 50%,transparent)' : 'var(--border)';
        html += '<div style="flex:0 0 22px;height:1.5px;background:' + lineColor + ';margin:0 2px;"></div>';
      }
    });
    html += '</div>';
    return html;
  }

  // The lean checklist beneath the rail: the current phase's exit requirements,
  // met ✓ teal / unmet, each unmet target rendered as a "Go →" into the record.
  function _renderGuidedChecklist(def, record, ev, ctxId, expandCurrent) {
    // Always emit the (hidden) container, even when there's nothing to show —
    // a completed-step review needs this element to populate, including on
    // terminal records (received/cancelled) whose current phase has no checklist.
    var emptyEl = '<div id="' + ctxId + '_checklist" style="display:none;flex-direction:column;gap:5px;margin:11px 0 2px;"></div>';
    if (ev.specMismatch || ev.isTerminal) return emptyEl;
    var unmet = ev.missing, doneReqs = ev.satisfied;
    if (!unmet.length && !doneReqs.length) return emptyEl;

    function itemHtml(r, sat) {
      var icon, iconBg, iconColor;
      if (sat) { icon = '✓'; iconBg = 'color-mix(in srgb,var(--teal) 16%,transparent)'; iconColor = 'var(--teal)'; }
      else if (r.req.hard) { icon = '✕'; iconBg = 'color-mix(in srgb,var(--danger) 12%,transparent)'; iconColor = 'var(--danger)'; }
      else { icon = '!'; iconBg = 'color-mix(in srgb,var(--amber) 16%,transparent)'; iconColor = 'var(--amber)'; }
      var goHtml = '';
      if (!sat && r.req.target) {
        goHtml = ' <a href="#" onclick="event.preventDefault();MastFlow.__ui.target(\'' + ctxId + '\',\'' + _esc(r.req.target) + '\')" style="color:var(--teal);font-size:0.78rem;margin-left:8px;text-decoration:underline;">Go &rarr;</a>';
      }
      var actionHtml = '';
      if (!sat && r.req.action) {
        actionHtml = ' <button type="button" onclick="MastFlow.__ui.action(\'' + ctxId + '\',\'' + _esc(r.req.action.handler) + '\')" style="margin-left:8px;background:var(--teal);color:var(--surface-card);border:none;border-radius:5px;padding:2px 10px;font-size:0.78rem;cursor:pointer;">' + _esc(r.req.action.label) + '</button>';
      }
      var recHtml = r.req.hard ? '' : ' <em style="color:var(--warm-gray);font-size:0.78rem;font-style:normal;">· recommended</em>';
      return '<div style="display:flex;align-items:center;gap:8px;font-size:0.85rem;">' +
        '<span style="display:inline-flex;width:18px;height:18px;border-radius:50%;background:' + iconBg + ';color:' + iconColor + ';align-items:center;justify-content:center;font-weight:700;font-size:0.72rem;flex-shrink:0;">' + icon + '</span>' +
        '<span style="color:' + (sat ? 'var(--warm-gray)' : 'var(--text)') + ';' + (sat ? 'text-decoration:line-through;' : '') + '">' + _esc(r.req.label) + recHtml + '</span>' +
        goHtml + actionHtml +
      '</div>';
    }

    // COLLAPSED BY DEFAULT — the header is the rail alone. Clicking the current
    // step toggles this open, and it shows only what's LEFT. Completed items are
    // history: hidden behind "Show N completed", never shown unasked.
    // expandCurrent (opt-in) shows the current phase's checklist on first paint
    // instead — the toggle/review handlers still flip display from here.
    var initialDisplay = expandCurrent ? 'flex' : 'none';
    var html = '<div id="' + ctxId + '_checklist" style="display:' + initialDisplay + ';flex-direction:column;gap:5px;margin:11px 0 2px;">';
    html += unmet.length
      ? unmet.map(function(r) { return itemHtml(r, false); }).join('')
      : '<div style="font-size:0.82rem;color:var(--teal);">✓ Everything in this step is set up.</div>';
    if (doneReqs.length) {
      var showLbl = 'Show ' + doneReqs.length + ' completed';
      html += '<a href="#" id="' + ctxId + '_donetoggle" data-show="' + showLbl + '" ' +
        'onclick="event.preventDefault();MastFlow.__ui.toggleDone(\'' + ctxId + '\')" ' +
        'style="color:var(--warm-gray);font-size:0.78rem;margin-top:4px;text-decoration:underline;align-self:flex-start;">' + showLbl + '</a>' +
        '<div id="' + ctxId + '_done" style="display:none;flex-direction:column;gap:5px;margin-top:2px;">' +
          doneReqs.map(function(r) { return itemHtml(r, true); }).join('') +
        '</div>';
    }
    html += '</div>';
    return html;
  }

  // ============================================================
  // Deep-link to a phase
  // ============================================================

  /**
   * focusPhase(hostElOrId, phaseKey) — deep-link affordance. Scrolls the
   * workflow header into view and briefly pulses the target stepper step.
   * Consuming detail views call this after renderHeader resolves when the
   * route carries a ?focus=<phaseKey> param. Safe no-op if the host or the
   * step isn't found.
   */
  function focusPhase(hostElOrId, phaseKey) {
    var host = (typeof hostElOrId === 'string') ? document.getElementById(hostElOrId) : hostElOrId;
    if (!host || !phaseKey) return;
    host.scrollIntoView({ behavior: 'smooth', block: 'center' });
    var step = host.querySelector('[data-mf-phase="' + (window.CSS && CSS.escape ? CSS.escape(phaseKey) : phaseKey) + '"]');
    if (!step) return;
    // Brief highlight pulse so the operator's eye lands on the right step.
    var prevBg = step.style.background;
    step.style.background = 'rgba(42,157,143,0.18)';
    setTimeout(function() { step.style.background = prevBg || ''; }, 1400);
  }

  // ============================================================
  // Export
  // ============================================================

  window.MastFlow = {
    define: define,
    getDefinition: getDefinition,
    registerTargetResolver: registerTargetResolver,
    registerActionHandler: registerActionHandler,
    evaluate: evaluate,
    transition: transition,
    diagnose: diagnose,
    renderHeader: renderHeader,
    renderGuidedHeader: renderGuidedHeader,
    focusPhase: focusPhase,
    // Internal UI bridge — referenced by rendered HTML's inline onclick handlers.
    // Not part of the documented API surface; do not call from surface code.
    __ui: ui
  };

  console.log('[MastFlow] engine loaded');
})();
