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
    var reqs = phase.exitRequirements || [];
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
        return { req: r, satisfied: !!ok, value: undefined };
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
        if (!def.canForce(actor, window.currentUserRole)) {
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
          var extra = def.recordExtraPatch(record, targetPhase, opts) || {};
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
    var u = window.currentUser;
    if (u && u.uid) {
      return { uid: u.uid, displayName: u.displayName || u.email || u.uid };
    }
    return { system: 'unknown' };
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
    }
  };

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

    if (ev.isTerminal && ev.terminalKind === 'failure') {
      return '<div style="margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(220,38,38,0.08);color:var(--danger,#b81d1d);font-size:0.85rem;font-weight:600;display:inline-flex;align-items:center;gap:6px;">' +
        '✕ ' + _esc(ev.currentPhase.label) +
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
      html += '<div role="listitem" style="display:flex;align-items:center;gap:6px;flex-shrink:0;" title="' + _esc(p.label) + '">' +
        '<div style="width:22px;height:22px;border-radius:50%;background:' + dotBg + ';color:' + dotColor + ';border:2px solid ' + dotBorder + ';display:inline-flex;align-items:center;justify-content:center;font-size:0.72rem;font-weight:700;flex-shrink:0;">' + glyph + '</div>' +
        '<span style="font-size:0.78rem;color:' + labelColor + ';font-weight:' + labelWeight + ';white-space:nowrap;">' + _esc(p.label) + chip + '</span>' +
      '</div>' + connector;
    });
    html += '</div>';
    return html;
  }

  /**
   * Build the linear visible chain of phases. If currentBranch is set, the
   * branch's phases get spliced between the branch point and convergesAt.
   */
  function _resolveDisplayChain(def, currentBranch) {
    if (!def.branches || !currentBranch) {
      // Filter out phases that belong to non-default branches (entry phases
      // of branch choices) so the default backbone shows by itself.
      var branchedPhases = _allBranchedPhaseKeys(def);
      return def.phases.filter(function(p) { return !branchedPhases[p.key]; });
    }
    // Find the branch point + the matching choice; splice its phases in.
    var bpKey, choice;
    Object.keys(def.branches).forEach(function(k) {
      var b = def.branches[k];
      var ch = (b.choices || []).filter(function(c) { return c.key === currentBranch; })[0];
      if (ch) { bpKey = k; choice = ch; }
    });
    if (!bpKey || !choice) return def.phases.slice();
    var branchedPhases = _allBranchedPhaseKeys(def);
    var bpIdx = _phaseIndex(def, bpKey);
    var convKey = def.branches[bpKey].convergesAt;
    var convIdx = _phaseIndex(def, convKey);

    var head = def.phases.slice(0, bpIdx + 1).filter(function(p) { return !branchedPhases[p.key]; });
    var tail = def.phases.slice(convIdx).filter(function(p) { return !branchedPhases[p.key]; });
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
    // Internal UI bridge — referenced by rendered HTML's inline onclick handlers.
    // Not part of the documented API surface; do not call from surface code.
    __ui: ui
  };

  console.log('[MastFlow] engine loaded');
})();
