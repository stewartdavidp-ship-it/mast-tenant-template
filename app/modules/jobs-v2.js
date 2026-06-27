/**
 * jobs-v2.js — Jobs (production) surface rebuilt on the MastEntity engine.
 *
 * Phase B1 SCAFFOLD (docs/ux-audit/jobs-v2-plan.md): flag-gated and self-mounting
 * on route #jobs-v2, running SIDE-BY-SIDE with legacy production.js (#jobs). This
 * phase delivers the list + faceted READ-ONLY detail (Overview / Line Items /
 * Builds / Costs / Story / Links). Heavy workflows — build lifecycle, story
 * authoring, inline/heavy edits, MastFlow status transitions — land in B2.
 * V1 (production.js) and V2 coexist permanently; the Legacy-UI toggle picks which
 * one the operator sees. V1 is never deleted.
 *
 * The whole surface below is derived from one schema. No bespoke list/modal/CSV.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity) return;       // engines must be loaded
  if (!flagOn()) return;                                     // strangler: off by default

  var U = window.MastUI;
  // The browser MastUI exposes the escaper as `_esc` (only the Node export is
  // `esc`). Keep a local helper so surface code never reaches for the wrong name.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtDate(d) { return d ? U.Num.date(d) : ''; }
  // Past-deadline flag (F25): true when a still-open job's deadline is before
  // today. Terminal jobs (completed/cancelled) are never "overdue". Date-only
  // comparison mirrors the daysUntil pattern used elsewhere (cs-members-v2).
  function jobOverdue(j) {
    if (!j || !j.deadline) return false;
    var s = String(j.status || '').toLowerCase();
    if (s === 'completed' || s === 'cancelled') return false;
    var t = new Date(j.deadline); if (isNaN(t.getTime())) return false;
    var now = new Date(); now.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
    return t.getTime() < now.getTime();
  }

  // ── Serializable job-status transition table (jobs-v2-plan.md §3a) ───
  // Source-of-truth artifact: function-free DATA ONLY, mirroring the MCP
  // (production.ts JOB_TRANSITIONS) and the CF. A snapshot test asserts the
  // three runtimes agree; MastFlow (B2) only RENDERS this — it is not the
  // authority. Exposed on window for that test.
  var JOB_TRANSITIONS = {
    'definition': ['in-progress', 'on-hold', 'cancelled'],
    'in-progress': ['completed', 'on-hold', 'cancelled'],
    'on-hold': ['in-progress', 'cancelled'],
    'completed': [],
    'cancelled': []
  };
  window.JOBS_V2_TRANSITIONS = JOB_TRANSITIONS;

  // ── Display maps ────────────────────────────────────────────────────
  var PURPOSE_LABELS = {
    'fulfillment': 'Fulfillment', 'custom': 'Custom',
    'inventory-general': 'General Inventory', 'inventory-event': 'Event Inventory',
    'wholesale': 'Wholesale', 'experimental': 'Experimental'
  };
  var STATUS_TONE = {
    'definition': 'neutral', 'in-progress': 'amber', 'on-hold': 'info',
    'completed': 'success', 'cancelled': 'neutral'
  };
  function statusLabel(s) { s = String(s || '').toLowerCase(); return s ? s.charAt(0).toUpperCase() + s.slice(1).replace('-', ' ') : '—'; }
  function purposeLabel(p) { return PURPOSE_LABELS[String(p || '').toLowerCase()] || (p || '—'); }

  // ── Record helpers (lineItems / builds are nested maps on the job) ──
  function mapToArr(m) {
    var out = []; m = m || {};
    Object.keys(m).forEach(function (k) { var v = m[k]; if (v && typeof v === 'object') out.push(Object.assign({ _key: k }, v)); });
    return out;
  }
  function lineItemsArr(job) { return mapToArr(job && job.lineItems); }
  function buildsArr(job) {
    return mapToArr(job && job.builds).sort(function (a, b) { return (a.buildNumber || 0) - (b.buildNumber || 0); });
  }
  function progressOf(job) {
    var lis = lineItemsArr(job), target = 0, done = 0;
    lis.forEach(function (li) { target += (li.targetQuantity || 0); done += (li.completedQuantity || 0); });
    return { target: target, done: done, pct: target > 0 ? Math.round((done / target) * 100) : 0 };
  }

  // ── RBAC (edit affordances hidden + handlers guarded; standard-record-ui §6) ──
  function _can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }
  function canEditJobs() { return _can('jobs', 'edit'); }
  function _guardEdit() { if (!canEditJobs()) { if (window.MastAdmin) MastAdmin.showToast('You don’t have permission to edit jobs', true); return false; } return true; }

  // ── Write delegate (the bridge) — all DB mutations go through here. Mirrors
  // legacy transitionProductionJob's inventory side-effects using the SAME global
  // stock primitives, so V1 and V2 stay consistent on shared data. Build
  // completion's inventory stays owned by the completeBuildJob CF (see the
  // double-push guard in completeInventory).
  var JobsBridge = {
    // definition → in-progress: commit incoming for each line item.
    commitIncoming: function (jobId) {
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        if (!job) return;
        var now = new Date().toISOString();
        var lis = job.lineItems || {};
        return Promise.all(Object.keys(lis).map(function (k) {
          var li = lis[k];
          if (!li.productId || !(li.targetQuantity > 0)) return null;
          return MastDB.transaction(MastDB.inventory.stockIncomingPath(li.productId), function (cur) { return (cur || 0) + (li.targetQuantity || 0); })
            .then(function () { return MastDB.push('admin/inventory/' + li.productId + '/history', { action: 'incoming', reason: 'production_started', qty: li.targetQuantity, jobId: jobId, actor: 'maker', actorType: 'maker', timestamp: now }); })
            .then(function () { return _syncStock(li.productId); });
        }));
      });
    },
    // in-progress → completed: push onHand, UNLESS a build already pushed
    // (completeBuildJob CF owns it then — the double-push guard).
    completeInventory: function (jobId) {
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        if (!job) return;
        var anyBuildPushed = Object.keys(job.builds || {}).some(function (b) { return job.builds[b] && job.builds[b].inventoryPushed; });
        if (anyBuildPushed) return; // CF already adjusted inventory per build
        var now = new Date().toISOString();
        var lis = job.lineItems || {};
        return Promise.all(Object.keys(lis).map(function (k) {
          var li = lis[k];
          if (!li.productId) return null;
          var vk = li.variantId || null;
          var qty = (li.completedQuantity || 0) - (li.lossQuantity || 0);
          var chain = MastDB.transaction(MastDB.inventory.stockIncomingPath(li.productId, vk), function (cur) { return Math.max(0, (cur || 0) - (li.targetQuantity || 0)); });
          if (qty > 0) {
            chain = chain.then(function () { return MastDB.transaction(MastDB.inventory.stockOnHandPath(li.productId, vk), function (cur) { return (cur || 0) + qty; }); })
              .then(function () { return MastDB.push('admin/inventory/' + li.productId + '/history', { action: 'adjusted', reason: 'production_completed', qty: qty, variantId: vk, jobId: jobId, actor: 'maker', actorType: 'maker', timestamp: now }); });
          }
          return chain.then(function () { return _syncStock(li.productId); });
        }));
      });
    },
    // in-progress → cancelled: reverse the committed incoming.
    reverseIncoming: function (jobId) {
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        if (!job || job.status !== 'in-progress') return;
        var now = new Date().toISOString();
        var lis = job.lineItems || {};
        return Promise.all(Object.keys(lis).map(function (k) {
          var li = lis[k];
          if (!li.productId || !(li.targetQuantity > 0)) return null;
          return MastDB.transaction(MastDB.inventory.stockIncomingPath(li.productId), function (cur) { return Math.max(0, (cur || 0) - (li.targetQuantity || 0)); })
            .then(function () { return MastDB.push('admin/inventory/' + li.productId + '/history', { action: 'adjusted', reason: 'production_cancelled', qty: -(li.targetQuantity), jobId: jobId, actor: 'maker', actorType: 'maker', timestamp: now }); })
            .then(function () { return _syncStock(li.productId); });
        }));
      });
    },
    // on-hold sub-state: status only, no phase change, no inventory.
    setStatus: function (jobId, status) {
      return Promise.resolve(MastDB.productionJobs.update(jobId, { status: status, updatedAt: new Date().toISOString() }))
        .then(function () { return _writeAudit('update', 'jobs', jobId); });
    },

    // ── Build session ───────────────────────────────────────────────
    // Start a draft build; auto-advance a definition job to in-progress
    // (committing incoming inventory, same as the Start Work transition).
    startBuild: function (jobId) {
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        if (!job) throw new Error('Job not found');
        var now = new Date();
        var buildNumber = Object.keys(job.builds || {}).length + 1;
        // Use newKey + awaitable set (NOT push — push to a nested map path is
        // fire-and-forget and the drill would race ahead of an unpersisted write).
        var buildId = MastDB.newKey('admin/jobs/' + jobId + '/builds');
        return MastDB.set('admin/jobs/' + jobId + '/builds/' + buildId, {
          buildNumber: buildNumber, sessionDate: now.toISOString().split('T')[0], startTime: now.toISOString(),
          endTime: null, durationMinutes: null, workType: job.workType || 'flameshop', status: 'draft',
          operators: [], notes: '', createdAt: now.toISOString(), completedAt: null
        }).then(function () {
          var after = _writeAudit('update', 'jobs', jobId);
          if (job.status === 'definition') {
            after = Promise.resolve(after)
              .then(function () { return JobsBridge.commitIncoming(jobId); })
              .then(function () { return MastDB.productionJobs.update(jobId, { status: 'in-progress', startedAt: now.toISOString() }); })
              .then(function () { return window.MastFlow ? window.MastFlow.transition('jobs', Object.assign({ id: jobId, _key: jobId }, job), 'in-progress', { recordId: jobId }).catch(function () {}) : null; });
          }
          return Promise.resolve(after).then(function () { return buildId; });
        });
      });
    },
    setBuildField: function (jobId, buildId, field, value) {
      var u = {}; u[field] = value;
      return Promise.resolve(MastDB.productionJobs.updateBuild(jobId, buildId, u));
    },
    addMilestone: function (jobId, buildId, text) {
      var mId = MastDB.newKey('admin/jobs/' + jobId + '/builds/' + buildId + '/milestones');
      return Promise.resolve(MastDB.set('admin/jobs/' + jobId + '/builds/' + buildId + '/milestones/' + mId, { text: text, timestamp: new Date().toISOString() }));
    },
    // Complete a build — mirrors legacy doCompleteBuild: write output, aggregate
    // tallies across builds, then the completeBuildJob CF (material deduction,
    // observed-cost, inventory auto-push, build lock). CF owns inventory.
    completeBuild: function (jobId, buildId, output) {
      var now = new Date();
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        var build = (job.builds || {})[buildId] || {};
        var durationMinutes = build.startTime ? Math.round((now.getTime() - new Date(build.startTime).getTime()) / 60000) : null;
        return MastDB.productionJobs.updateBuild(jobId, buildId, { status: 'completed', endTime: now.toISOString(), durationMinutes: durationMinutes, completedAt: now.toISOString(), output: output })
          .then(function () { return _writeAudit('update', 'jobs', jobId); })
          .then(function () { return MastDB.productionJobs.get(jobId); })
          .then(function (fresh) {
            // aggregate completed/loss tallies across completed builds
            var lis = (fresh && fresh.lineItems) || {}; var builds = (fresh && fresh.builds) || {};
            var tallies = {}; Object.keys(lis).forEach(function (k) { tallies[k] = { c: 0, l: 0 }; });
            Object.values(builds).forEach(function (b) {
              if (b.status === 'completed' && b.output) Object.keys(b.output).forEach(function (k) {
                if (!tallies[k]) tallies[k] = { c: 0, l: 0 };
                tallies[k].c += (b.output[k].completedQuantity || 0); tallies[k].l += (b.output[k].lossQuantity || 0);
              });
            });
            // Per-line-item update — the adapter maps admin/jobs/{id}/lineItems/{liId}
            // onto the lineItems map field. A slash-path multi-update on the job doc
            // ({'lineItems/x/completedQuantity':n}) is REJECTED by Firestore ("Paths
            // must not contain '/'"), which silently broke completion.
            return Promise.all(Object.keys(tallies).map(function (k) {
              return MastDB.productionJobs.updateLineItem(jobId, k, { completedQuantity: tallies[k].c, lossQuantity: tallies[k].l });
            }));
          })
          .then(function () {
            // Server-side completion (inventory/material/observed-cost/lock).
            if (window.firebase && firebase.functions) {
              return firebase.functions().httpsCallable('completeBuildJob')({ tenantId: MastDB.tenantId(), jobId: jobId, buildId: buildId, output: output })
                .then(function (r) { return r && r.data; })
                .catch(function (e) { console.error('[jobs-v2] completeBuildJob CF', e); throw new Error('Server completion failed: ' + (e && e.message || e)); });
            }
          });
      });
    },

    // ── Story ────────────────────────────────────────────────────────
    // Find the job's story (one per job by convention) or create a draft.
    ensureStory: function (jobId) {
      return Promise.resolve(MastDB.stories.queryByJob(jobId)).then(function (map) {
        var ids = Object.keys(map || {});
        if (ids.length) return ids[0];
        return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
          var storyId = MastDB.stories.newKey();
          var now = new Date().toISOString();
          return MastDB.stories.set(storyId, { id: storyId, jobId: jobId, title: (job && job.name) || 'Build story', status: 'draft', entries: {}, createdAt: now, updatedAt: now })
            .then(function () { return storyId; });
        });
      });
    },
    addStoryEntry: function (storyId, entry) {
      var eid = MastDB.newKey('public/stories/' + storyId + '/entries');
      return Promise.resolve(MastDB.set('public/stories/' + storyId + '/entries/' + eid, entry))
        .then(function () { return MastDB.stories.update(storyId, { updatedAt: new Date().toISOString() }); });
    },
    setStoryEntryField: function (storyId, entryId, field, value) {
      var u = {}; u[field] = value;
      return Promise.resolve(MastDB.set('public/stories/' + storyId + '/entries/' + entryId + '/' + field, value))
        .then(function () { return MastDB.stories.update(storyId, { updatedAt: new Date().toISOString() }); });
    },
    removeStoryEntry: function (storyId, entryId) {
      return Promise.resolve(MastDB.remove('public/stories/' + storyId + '/entries/' + entryId))
        .then(function () { return MastDB.stories.update(storyId, { updatedAt: new Date().toISOString() }); });
    },
    setStoryTitle: function (storyId, title) {
      return Promise.resolve(MastDB.stories.update(storyId, { title: title, updatedAt: new Date().toISOString() }));
    },
    publishStory: function (storyId, jobId) {
      var now = new Date().toISOString();
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        // de-duplicated operators from all builds (the public credit line)
        var ops = {};
        Object.values((job && job.builds) || {}).forEach(function (b) { (b.operators || []).forEach(function (o) { ops[o] = true; }); });
        // Client-side QR per linked product (no LabelKeeper key needed — that's
        // only for the separate print-card feature). Mirrors legacy generateStoryQRCodes.
        return generateStoryQR(job).then(function (qrCodes) {
          var upd = { status: 'published', publishedAt: now, updatedAt: now, operators: Object.keys(ops) };
          if (qrCodes.length) upd.qrCodes = qrCodes;
          return MastDB.stories.update(storyId, upd).then(function () {
            // back-fill storyId onto the job's products (storefront build-story)
            var lis = (job && job.lineItems) || {};
            return Promise.all(Object.keys(lis).map(function (k) {
              var pid = lis[k].productId; return pid ? MastDB.set('admin/products/' + pid + '/storyId', storyId) : null;
            }));
          });
        });
      });
    },
    unpublishStory: function (storyId) {
      return Promise.resolve(MastDB.stories.update(storyId, { status: 'draft', updatedAt: new Date().toISOString() }));
    },

    // ── Line items ───────────────────────────────────────────────────
    // Mirror the MCP guards: targetQuantity editable only in 'definition';
    // completed/loss blocked once any build is locked.
    updateLineItem: function (jobId, liId, field, value) {
      var v = Math.max(0, parseInt(value, 10) || 0);
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        if (!job) throw new Error('Job not found');
        var locked = Object.keys(job.builds || {}).some(function (b) { return job.builds[b] && job.builds[b].locked; });
        if (field === 'targetQuantity' && String(job.status).toLowerCase() !== 'definition') throw new Error("Target is editable only while the job is in 'definition'");
        if ((field === 'completedQuantity' || field === 'lossQuantity') && locked) throw new Error('Locked by a completed build — correct via a new build');
        var u = {}; u[field] = v;
        return MastDB.productionJobs.updateLineItem(jobId, liId, u)
          .then(function () { return MastDB.productionJobs.update(jobId, { updatedAt: new Date().toISOString() }); })
          .then(function () { return _writeAudit('update', 'jobs', jobId); });
      });
    },
    removeLineItem: function (jobId, liId) {
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        if (!job) throw new Error('Job not found');
        if (String(job.status).toLowerCase() !== 'definition') throw new Error("Line items can be removed only while the job is in 'definition'");
        var li = (job.lineItems || {})[liId] || {};
        var chain = MastDB.productionJobs.removeLineItem(jobId, liId);
        if (li.productionRequestId) chain = chain.then(function () { return MastDB.update('admin/buildJobs/' + li.productionRequestId, { jobId: null, lineItemId: null, status: 'pending' }); });
        return chain.then(function () { return MastDB.productionJobs.update(jobId, { updatedAt: new Date().toISOString() }); }).then(function () { return _writeAudit('update', 'jobs', jobId); });
      });
    },
    // Mirror of the MCP link_product_to_build: append the job's build ids to the
    // product's buildIds (storefront build-story), mark the line item linked, and
    // stamp any published story id onto the product.
    linkProductToBuild: function (jobId, liId) {
      return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (job) {
        var li = (job.lineItems || {})[liId];
        if (!li || !li.productId) throw new Error('No product on this line item');
        var buildIds = Object.keys(job.builds || {});
        if (!buildIds.length) throw new Error('No builds to link');
        var pid = li.productId;
        return Promise.resolve(MastDB.get('admin/products/' + pid + '/buildIds')).then(function (existing) {
          if (!Array.isArray(existing)) existing = [];
          buildIds.forEach(function (b) { if (existing.indexOf(b) === -1) existing.push(b); });
          return MastDB.set('admin/products/' + pid + '/buildIds', existing);
        }).then(function () {
          return MastDB.set('admin/jobs/' + jobId + '/lineItems/' + liId + '/productLinked', true);
        }).then(function () {
          return MastDB.stories.queryByJob(jobId);
        }).then(function (stories) {
          var pub = Object.keys(stories || {}).filter(function (s) { return stories[s].status === 'published'; })[0];
          if (pub) return MastDB.set('admin/products/' + pid + '/storyId', pub);
        }).then(function () { return _writeAudit('update', 'jobs', jobId); });
      });
    }
  };
  function _syncStock(pid) { return (typeof window.syncStockInfoToPublic === 'function') ? window.syncStockInfoToPublic(pid) : null; }
  function _writeAudit(a, e, id) { return (typeof window.writeAudit === 'function') ? window.writeAudit(a, e, id) : null; }

  // Re-open the job SO fresh so the process header + all panes reflect new state.
  function reopenJob(jobId) {
    return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (fresh) {
      if (fresh) { fresh._key = jobId; fresh.id = jobId; window.MastEntity.openRecord('jobs-v2', fresh, 'read', true); }
    });
  }

  // The header summary tiles — DERIVED from the job record, so the same builder
  // backs both the initial render and the post-write refresh (no cached copy to
  // drift). Items/Progress recompute straight from j.lineItems.
  function jobTiles(UU, j) {
    var prog = progressOf(j);
    return UU.tiles([
      { k: 'Purpose', v: esc(purposeLabel(j.purpose)) },
      { k: 'Priority', v: j.priority ? statusLabel(j.priority) : '—' },
      { k: 'Progress', v: prog.target ? (prog.done + '/' + prog.target + ' · ' + prog.pct + '%') : '—' },
      { k: 'Items', v: String(lineItemsArr(j).length) }
    ]);
  }

  // Recompute the header summary (Items/Progress tiles) AND the Definition
  // readiness checklist from the SAME live record an items write just produced —
  // in place, so they update together with the Line Items pane (vs the old
  // snapshot that stayed 0 / red ❌ until a reopen).
  function refreshJobSummary(j) {
    if (!j || !window.MastEntity || !MastEntity.refreshFlowHeader) return;
    MastEntity.refreshFlowHeader(j, jobTiles(window.MastUI, j));
  }

  // ── Schema: the whole Jobs surface, declaratively ───────────────────
  MastEntity.define('jobs-v2', {
    label: 'Job', labelPlural: 'Jobs', size: 'xl',
    recordId: function (j) { return j._key || j.id; },
    fields: [
      { name: 'name', label: 'Job', type: 'text', list: true, group: 'Job', readOnly: true },
      { name: 'purpose', label: 'Purpose', type: 'tags', list: true, sortable: false, group: 'Job', readOnly: true,
        get: function (j) { return j.purpose ? [purposeLabel(j.purpose)] : []; } },
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Lifecycle', readOnly: true,
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      { name: 'priority', label: 'Priority', type: 'text', list: true, group: 'Lifecycle', readOnly: true },
      { name: 'progress', label: 'Progress', type: 'text', list: true, sortable: false, group: 'Job', readOnly: true,
        get: function (j) { var p = progressOf(j); return p.target ? (p.done + '/' + p.target + ' (' + p.pct + '%)') : '—'; } },
      { name: 'items', label: 'Items', type: 'number', list: true, group: 'Job', readOnly: true,
        get: function (j) { return lineItemsArr(j).length; } },
      { name: 'deadline', label: 'Deadline', type: 'date', list: true, group: 'Job', readOnly: true,
        get: function (j) { return j.deadline || ''; } },
      { name: 'createdAt', label: 'Created', type: 'date', list: true, group: 'Job', readOnly: true,
        get: function (j) { return j.createdAt || ''; } }
    ],
    route: 'jobs-v2',
    fetch: function (id) { return MastDB.productionJobs.get(id).then(function (j) { return j ? Object.assign({ _key: id }, j) : null; }); },

    // Process SO: the lifecycle (definition→in-progress→completed, on-hold
    // sub-state, cancelled terminal) is the MastFlow engine model — detail.flow
    // injects the stepper + guarded Advance into #muFlowHost (the pinned
    // structure, above the tabs). Status is NOT a field/badge to edit.
    detail: {
      flow: 'jobs',
      flowModule: 'jobsWorkflow',
      // Lean guided header: a clickable step rail (click the next step to advance)
      // instead of large Back/Advance buttons that eat real estate. Routes through
      // the same onAdvance below, so inventory side-effects still fire.
      guidedHeader: true,
      // Side-effects on advance: apply inventory FIRST (same primitives as legacy
      // transitionProductionJob), THEN do the MastFlow transition, then reopen —
      // so a failed inventory write doesn't advance the phase. Returning a value
      // (!== false) tells the engine we own the transition. Back/other → false.
      onFlowAdvance: function (target, record) {
        if (target !== 'in-progress' && target !== 'completed') return false;
        if (!_guardEdit()) return true; // owned (blocked) — don't let engine advance
        var jobId = record._key || record.id;
        var side = (target === 'in-progress') ? JobsBridge.commitIncoming(jobId) : JobsBridge.completeInventory(jobId);
        Promise.resolve(side)
          .then(function () { return window.MastFlow.transition('jobs', record, target, { recordId: jobId }); })
          .then(function () { if (window.MastAdmin) MastAdmin.showToast('Advanced to ' + target.replace(/-/g, ' ')); return reopenJob(jobId); })
          .catch(function (e) { console.error('[jobs-v2] advance', e); if (window.MastAdmin) MastAdmin.showToast('Could not advance: ' + (e && e.message || e), true); });
        return true;
      },
      render: function (UU, j) {
        var tiles = jobTiles(UU, j);
        var tabs = [
          { key: 'overview', label: 'Overview' }, { key: 'items', label: 'Line Items' },
          { key: 'builds', label: 'Builds' }, { key: 'costs', label: 'Costs' },
          { key: 'story', label: 'Story' }
        ];
        function pane(key, html, active) { return '<div class="mu-pane" data-pane="' + key + '"' + (active ? '' : ' hidden') + '>' + html + '</div>'; }
        // On-hold is an in-progress SUB-STATE — surface it as a banner (the
        // process header still shows the In Progress phase).
        var holdBanner = (String(j.status).toLowerCase() === 'on-hold')
          ? '<div style="margin:0 0 12px;padding:8px 13px;border-radius:8px;font-size:0.85rem;font-weight:600;background:color-mix(in srgb,var(--warning) 14%,transparent);color:var(--warning);border:1px solid color-mix(in srgb,var(--warning) 30%,transparent);">On hold — work is paused. Resume from the Overview tab.</div>'
          : '';
        // tiles cover (pinned) → MastFlow process header → tabs → panes
        return UU.stickyHead(tiles, '') +
          '<div id="muFlowHost" style="margin:-4px -4px 14px;color:var(--warm-gray);font-size:0.85rem;">Loading workflow…</div>' +
          holdBanner +
          UU.paneTabsBar(tabs, 'overview') +
          pane('overview', overviewPane(UU, j), true) +
          pane('items', itemsPane(UU, j)) +
          pane('builds', buildsPane(UU, j)) +
          pane('costs', costsPane(UU, j)) +
          pane('story', storyPane(UU, j));
      }
    }
    // No onSave on jobs-v2 — keeping the main record read-only (adding onSave
    // would surface an Edit pencil on every job; lifecycle is the MastFlow
    // process header, fields are derived). Native CREATE lives on the separate
    // job-intake-v2 entity below (the engine rule: onSave ⇒ Edit button).
  });

  // ════════════════ Entity: native job CREATE (intake) ════════════════
  // Closes the V1-only gap — a maker could not start a build in V2 without
  // flipping to Legacy UI (openNewJobModal/doCreateJob lived only in
  // production.js). A dedicated create-only entity (no read detail, no Edit
  // button) collects name + purpose and persists through ProductionBridge.createJob
  // (the SAME write doCreateJob now calls). After create we land the operator in
  // the new job's read detail so they can add line items + start work.
  var INTAKE_PURPOSES = Object.keys(PURPOSE_LABELS); // same order/labels as legacy
  MastEntity.define('job-intake-v2', {
    label: 'Job', labelPlural: 'Jobs', size: 'md', route: null,
    recordId: function (j) { return j._key || j.id || 'new'; },
    fields: [{ name: 'name', label: 'Job', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(null); },
    detail: {
      editRender: function (j, mode) {
        j = j || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var sel = j.purpose || 'custom';
        var opts = INTAKE_PURPOSES.map(function (k) {
          return '<option value="' + esc(k) + '"' + (sel === k ? ' selected' : '') + '>' + esc(purposeLabel(k)) + '</option>';
        }).join('');
        return '<div class="mu-editbar"><span class="mu-editpill">NEW</span>New production job</div>' +
          fg('Job name *', '<input class="form-input" id="jobNewName" value="' + esc(j.name || '') + '" placeholder="e.g. Spring Craft Fair Prep" style="width:100%;">') +
          fg('Purpose', '<select class="form-input" id="jobNewPurpose" style="width:100%;">' + opts + '</select>') +
          '<div class="mu-sub">The job starts in Definition — add line items and start a build from the job detail after creating.</div>';
      }
    },
    onSave: function (rec, mode) {
      if (mode !== 'create') return false;
      if (!_guardEdit()) return false;
      // Ensure legacy production.js is loaded so window.ProductionBridge exists.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
      if (!window.ProductionBridge || !window.ProductionBridge.createJob) { if (window.MastAdmin) MastAdmin.showToast('Production engine still loading — try again', true); return false; }
      var name = ((document.getElementById('jobNewName') || {}).value || '').trim();
      var purpose = ((document.getElementById('jobNewPurpose') || {}).value || 'custom');
      if (!name) { if (window.MastAdmin) MastAdmin.showToast('Job name is required', true); return false; }
      return Promise.resolve(window.ProductionBridge.createJob({ name: name, purpose: purpose })).then(function (jobId) {
        if (window.MastAdmin) MastAdmin.showToast('Job created');
        // Refresh the list (the live listener also picks it up) and land the
        // operator in the new job's read detail.
        setTimeout(function () {
          Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (fresh) {
            if (!fresh) return;
            fresh._key = jobId; fresh.id = jobId;
            V2.rows.push(fresh); V2.byId[jobId] = fresh;
            render();
            window.MastEntity.openRecord('jobs-v2', fresh, 'read');
          });
        }, 60);
        return true;
      }).catch(function (e) {
        console.error('[jobs-v2] createJob', e);
        if (window.MastAdmin) MastAdmin.showToast('Could not create job: ' + (e && e.message || e), true);
        return false;
      });
    }
  });

  // ── Read-only detail panes (standard MastUI controls only) ──────────
  function statusBadge(UU, s) { return UU.badge(statusLabel(s), STATUS_TONE[String(s || '').toLowerCase()] || 'neutral'); }

  function overviewPane(UU, j) {
    var details = UU.card('Details', UU.kv([
      { k: 'Name', v: esc(j.name) },
      { k: 'Description', v: esc(j.description) },
      { k: 'Purpose', v: esc(purposeLabel(j.purpose)) },
      { k: 'Work type', v: esc(j.workType) },
      { k: 'Status', v: statusBadge(UU, j.status) },
      { k: 'Priority', v: j.priority ? statusLabel(j.priority) : '' },
      { k: 'Created', v: fmtDate(j.createdAt) },
      { k: 'Started', v: fmtDate(j.startedAt) },
      { k: 'Completed', v: fmtDate(j.completedAt) },
      { k: 'Deadline', v: fmtDate(j.deadline) }
    ]));
    // Related (folded in from the former Links tab): what this job connects to.
    var lis = lineItemsArr(j);
    var linked = lis.filter(function (li) { return li.productLinked; });
    var related = UU.card('Related', UU.kv([
      { k: 'Order', v: esc(j.orderId) },
      { k: 'Customer', v: esc(j.customerId) },
      { k: 'Event', v: esc(j.eventName) },
      { k: 'Builds', v: String(buildsArr(j).length) },
      { k: 'Product link', v: lis.length ? (linked.length + ' / ' + lis.length + ' items') : '—' }
    ]));
    // Two-column record layout (mu-grid2: 1.4fr/1fr, collapses to 1col on narrow):
    // Details on the left, Related + Lifecycle on the right — less vertical scroll.
    return '<div class="mu-grid2"><div>' + details + '</div><div>' + related + lifecyclePane(UU, j) + '</div></div>';
  }

  // Off-backbone lifecycle actions (the backbone Start/Complete live in the
  // process header). Hold/Resume = in-progress sub-state; Cancel = terminal.
  function lifecyclePane(UU, j) {
    if (!canEditJobs()) return '';
    var s = String(j.status || '').toLowerCase();
    if (s === 'completed' || s === 'cancelled') return ''; // terminal — no actions
    var id = j._key || j.id;
    var btns = [];
    if (s === 'in-progress') btns.push('<button class="btn btn-secondary" onclick="JobsV2.hold(\'' + esc(id) + '\')">Put on hold</button>');
    if (s === 'on-hold') btns.push('<button class="btn btn-secondary" onclick="JobsV2.resume(\'' + esc(id) + '\')">Resume</button>');
    btns.push('<button class="btn btn-secondary" onclick="JobsV2.cancelJob(\'' + esc(id) + '\')">Cancel job</button>');
    return UU.card('Lifecycle', '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + btns.join('') + '</div>');
  }

  function itemsPane(UU, j) {
    var jobId = j._key || j.id;
    var lis = lineItemsArr(j);
    var st = String(j.status || '').toLowerCase();
    var isDef = st === 'definition';
    var term = st === 'completed' || st === 'cancelled';
    var hasLocked = Object.keys(j.builds || {}).some(function (b) { return j.builds[b] && j.builds[b].locked; });
    var hasBuilds = Object.keys(j.builds || {}).length > 0;
    var canEdit = canEditJobs() && !term;
    // "+ Add line item" — parity with legacy openAddLineItemModal (shown unless
    // the job is terminal). Toggles an inline native form rendered below.
    var addBtn = canEdit ? '<button class="btn btn-secondary btn-small" onclick="JobsV2.toggleAddItem(\'' + esc(jobId) + '\')">+ Add line item</button>' : '';
    var addForm = canEdit ? addLineItemForm(UU, jobId) : '';
    if (!lis.length) return UU.card('Line Items', '<p style="color:var(--warm-gray);">No line items yet.</p>' + addForm, { headerRight: addBtn });
    function numCell(li, field, editable) {
      if (canEdit && editable) return '<input type="number" min="0" class="form-input" style="width:68px;text-align:right;" value="' + (li[field] || 0) + '" onchange="JobsV2.liField(\'' + esc(jobId) + '\',\'' + esc(li._key) + '\',\'' + field + '\',this)">';
      return String(li[field] || 0);
    }
    var cols = [
      { label: 'Product', render: function (li) { return esc(li.productName || li.productId || '—') + (li.variantLabel ? ' <span class="mu-sub">(' + esc(li.variantLabel) + ')</span>' : ''); } },
      { label: 'Target', align: 'right', render: function (li) { return numCell(li, 'targetQuantity', isDef); } },
      { label: 'Completed', align: 'right', render: function (li) { return numCell(li, 'completedQuantity', !hasLocked); } },
      { label: 'Loss', align: 'right', render: function (li) { return numCell(li, 'lossQuantity', !hasLocked); } },
      { label: '', align: 'right', render: function (li) {
        var parts = [];
        if (li.productLinked) parts.push(UU.badge('Linked', 'success'));
        else if (canEdit && hasBuilds && li.productId) parts.push('<button class="mu-link" onclick="JobsV2.liLink(\'' + esc(jobId) + '\',\'' + esc(li._key) + '\')">Link product</button>');
        if (canEdit && isDef) parts.push('<button class="mu-link" onclick="JobsV2.liRemove(\'' + esc(jobId) + '\',\'' + esc(li._key) + '\')">Remove</button>');
        return parts.join(' &middot; ');
      } }
    ];
    var hint = (canEdit && hasLocked) ? '<p style="color:var(--warm-gray);margin-top:8px;font-size:0.78rem;">Completed/loss are locked by a completed build — correct via a new build.</p>' : '';
    return UU.card('Line Items', UU.relatedTable(cols, lis) + hint + addForm, { headerRight: addBtn });
  }

  // Inline native "Add line item" form (hidden until toggled). Mirrors the legacy
  // openAddLineItemModal fields: product picker (from window.productsData) →
  // auto-fills name + reveals a variant picker when the product has variants;
  // target qty; specifications. Saved through ProductionBridge.addLineItem.
  function productsList() {
    var pd = window.productsData;
    if (Array.isArray(pd)) return pd;
    if (pd && typeof pd === 'object') return Object.keys(pd).map(function (k) { return pd[k]; });
    return [];
  }
  // Lazily populate window.productsData (the add-item picker source) — products
  // may not be loaded when a job detail is opened directly. Resolves either way;
  // freeform still works if the load fails.
  function ensureProducts() {
    if (productsList().length) return Promise.resolve();
    if (!(window.MastDB && MastDB.products && MastDB.products.list)) return Promise.resolve();
    return Promise.resolve(MastDB.products.list()).then(function (all) {
      if (all) window.productsData = Array.isArray(all) ? all : Object.values(all || {});
    }).catch(function () {});
  }
  // Re-render only the product <select> inside an open add-item form (after a
  // lazy products load) without disturbing other in-progress field values.
  function refreshAddItemProductPicker() {
    var sel = document.getElementById('jobLiProduct');
    if (!sel) return;
    var prods = productsList().filter(function (p) { return p && p.pid; });
    var cur = sel.value;
    sel.innerHTML = '<option value="">— Freeform (type a name) —</option>' + prods.map(function (p) {
      return '<option value="' + esc(p.pid) + '"' + (cur === p.pid ? ' selected' : '') + '>' + esc(p.name || p.pid) + '</option>';
    }).join('');
  }
  function addLineItemForm(UU, jobId) {
    var prods = productsList().filter(function (p) { return p && p.pid; });
    var opts = '<option value="">— Freeform (type a name) —</option>' + prods.map(function (p) {
      return '<option value="' + esc(p.pid) + '">' + esc(p.name || p.pid) + '</option>';
    }).join('');
    function fg(label, inner) { return '<div class="form-group" style="margin-bottom:10px;"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
    return '<div id="jobAddLiForm" data-job="' + esc(jobId) + '" hidden style="margin-top:14px;padding:14px;border:1px solid var(--border);border-radius:10px;background:var(--cream,transparent);">' +
      '<div style="font-size:0.78rem;font-weight:600;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:10px;">Add line item</div>' +
      fg('Product', '<select id="jobLiProduct" class="form-input" style="width:100%;" onchange="JobsV2.onAddItemProduct()">' + opts + '</select>') +
      fg('Product name', '<input id="jobLiName" class="form-input" style="width:100%;" placeholder="Product name">') +
      '<div id="jobLiVariantWrap" hidden>' + fg('Variant *', '<select id="jobLiVariant" class="form-input" style="width:100%;"></select>') + '</div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        '<div class="form-group" style="margin-bottom:10px;flex:0 0 120px;"><label class="form-label">Target qty</label><input id="jobLiQty" type="number" min="1" value="1" class="form-input" style="width:100%;"></div>' +
        '<div class="form-group" style="margin-bottom:10px;flex:1;min-width:160px;"><label class="form-label">Specifications</label><input id="jobLiSpecs" class="form-input" style="width:100%;" placeholder="Color, size, notes…"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">' +
        '<button class="btn btn-secondary btn-small" onclick="JobsV2.toggleAddItem(\'' + esc(jobId) + '\')">Cancel</button>' +
        '<button class="btn btn-primary btn-small" onclick="JobsV2.addLineItem(\'' + esc(jobId) + '\')">Add</button>' +
      '</div>' +
    '</div>';
  }
  // In-place re-render of the Line Items pane (keeps the operator on the tab —
  // reopening the whole SO would bounce to Overview).
  function rerenderItemsPane(jobId) {
    return Promise.resolve(MastDB.productionJobs.get(jobId)).then(function (fresh) {
      if (!fresh) return; fresh._key = jobId; fresh.id = jobId;
      var body = document.getElementById('mastSlideOutBody');
      var pane = body && body.querySelector('.mu-pane[data-pane="items"]');
      if (pane) pane.innerHTML = itemsPane(window.MastUI, fresh);
      // Derive the header tiles + Definition checklist from the same fresh record
      // so "Items" and "At least one line item" update with the pane, not on reopen.
      refreshJobSummary(fresh);
    });
  }

  function opsLabel(b) { return Array.isArray(b.operators) ? b.operators.join(', ') : (b.operators ? Object.values(b.operators).join(', ') : ''); }
  function buildsPane(UU, j) {
    var jobId = j._key || j.id;
    var term = (String(j.status).toLowerCase() === 'completed' || String(j.status).toLowerCase() === 'cancelled');
    var startBtn = (canEditJobs() && !term) ? '<button class="btn btn-secondary btn-small" onclick="JobsV2.startBuild(\'' + esc(jobId) + '\')">Start build</button>' : '';
    var builds = buildsArr(j);
    if (!builds.length) return UU.card('Builds', '<p style="color:var(--warm-gray);">No build sessions yet.</p>', { headerRight: startBtn });
    var cols = [
      { label: 'Build', render: function (b) { return '#' + (b.buildNumber || '?'); } },
      { label: 'Date', render: function (b) { return fmtDate(b.sessionDate || b.createdAt); } },
      { label: 'Duration', align: 'right', render: function (b) { return b.durationMinutes != null ? b.durationMinutes + ' min' : ''; } },
      { label: 'Operators', render: function (b) { return esc(opsLabel(b)); } },
      { label: 'Status', render: function (b) { return b.locked ? UU.badge('Locked', 'teal') : UU.badge(statusLabel(b.status || 'in-progress'), 'amber'); } },
      { label: '', align: 'right', render: function (b) { return '<button class="mu-link" onclick="JobsV2.openBuild(\'' + esc(jobId) + '\',\'' + esc(b._key) + '\')">' + ((b.status === 'completed' || b.locked) ? 'View' : 'Continue') + ' →</button>'; } }
    ];
    return UU.card('Builds', UU.relatedTable(cols, builds), { headerRight: startBtn });
  }

  function costsPane(UU, j) {
    var lis = lineItemsArr(j).filter(function (li) { return li.bomForecast; });
    if (!lis.length) return UU.card('Costs', '<p style="color:var(--warm-gray);">No cost forecast captured on these line items.</p>');
    var tBudget = 0, tActual = 0;
    function money(c) { return UU.Num.money(c, { cents: true }); }
    function varianceCell(v) { return '<span style="color:' + (v > 0 ? 'var(--danger)' : 'var(--teal)') + ';">' + (v > 0 ? '+' : '') + money(v) + '</span>'; }
    var rows = lis.map(function (li) {
      var bf = li.bomForecast || {};
      var target = li.targetQuantity || 0, done = li.completedQuantity || 0;
      var budget = ((bf.materialCostPerUnitCents || 0) + (bf.laborCostPerUnitCents || 0)) * target;
      var actual = (li.actualMaterialCostCents != null ? li.actualMaterialCostCents : (bf.materialCostPerUnitCents || 0) * done) +
        (li.actualLaborCostCents != null ? li.actualLaborCostCents : (bf.laborCostPerUnitCents || 0) * done);
      tBudget += budget; tActual += actual;
      return { label: li.productName || li.productId || '—', cells: [money(budget), money(actual), varianceCell(actual - budget)] };
    });
    rows.push({ label: 'Total', cells: ['<strong>' + money(tBudget) + '</strong>', '<strong>' + money(tActual) + '</strong>', '<strong>' + varianceCell(tActual - tBudget) + '</strong>'] });
    return UU.cardTable('Costs — budget vs actual', UU.metricTable({ corner: 'Item', columns: ['Budget', 'Actual', 'Variance'], rows: rows }));
  }

  function storyPane(UU, j) {
    var id = j._key || j.id;
    var btn = canEditJobs()
      ? '<button class="btn btn-secondary" onclick="JobsV2.openStory(\'' + esc(id) + '\')">Curate story</button>'
      : '';
    return UU.card('Story',
      '<p style="color:var(--warm-gray);">Document the build for buyers — pick build photos, add captions, and publish. Opens in its own surface.</p>' + btn);
  }

  // ════════════════ Entity: the build session (drilled SO) ════════════
  // "Call a new SO" for the heavy in-session work — the build doesn't fit a tab.
  // recordId = jobId::buildId. Draft builds are editable (operators, output,
  // milestones, photos, notes, Complete); completed/locked builds are read-only.
  MastEntity.define('job-build-v2', {
    label: 'Build', labelPlural: 'Builds', size: 'lg', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Build', type: 'text', list: true, group: 'Build', readOnly: true }],
    fetch: function (id) {
      var p = String(id).split('::'); var jobId = p[0], buildId = p[1];
      return Promise.all([MastDB.productionJobs.get(jobId), Promise.resolve(MastDB.buildMedia.get(buildId)).catch(function () { return null; })]).then(function (res) {
        var job = res[0]; if (!job) return null; var build = (job.builds || {})[buildId]; if (!build) return null;
        // Human-readable SO title ("Build: #2 · Honey Pendant — Spring Restock") —
        // the lead field (_title) drives the engine's slide-out title; without it
        // the header falls back to the raw "jobId::buildId" record key.
        var _title = '#' + (build.buildNumber || '?') + (job.name ? ' · ' + job.name : '');
        return { _key: id, _title: _title, id: id, jobId: jobId, buildId: buildId, job: job, build: build, media: res[1] || {} };
      });
    },
    detail: { render: function (UU, r) { return buildSObody(UU, r); } }
  });

  function buildMediaArr(media) {
    return Object.keys(media || {}).map(function (k) { return Object.assign({ _key: k }, media[k]); })
      .sort(function (a, b) { return String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')); });
  }
  function milestonesArr(build) {
    var m = build.milestones || {};
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return String(a.timestamp || '').localeCompare(String(b.timestamp || '')); });
  }

  function buildSObody(UU, r) {
    var b = r.build, locked = (b.status === 'completed' || b.locked), canEdit = canEditJobs() && !locked;
    var elapsed = b.durationMinutes != null ? (b.durationMinutes + ' min')
      : (b.startTime ? Math.max(0, Math.round((Date.now() - new Date(b.startTime).getTime()) / 60000)) + ' min elapsed' : '—');
    var tiles = UU.tiles([
      { k: 'Build', v: '#' + (b.buildNumber || '?'), hero: true },
      { k: 'Status', v: locked ? UU.badge(b.locked ? 'Locked' : 'Completed', 'teal') : UU.badge('Draft', 'amber') },
      { k: 'Time', v: elapsed },
      { k: 'Operators', v: esc(opsLabel(b) || '—') }
    ]);

    // Operators (light inline: comma-separated) — draft only.
    var opsCard = UU.card('Operators', canEdit
      ? '<input id="jbOps" class="form-input" style="width:100%;" value="' + esc(opsLabel(b)) + '" placeholder="Names, comma-separated"> <button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="JobsV2.buildSaveOps(\'' + esc(r._key) + '\')">Save operators</button>'
      : (esc(opsLabel(b)) || '<span style="color:var(--warm-gray);">—</span>'));

    // Output per line item — draft only (read-only summary when locked).
    var lis = lineItemsArr(r.job);
    var outRows = lis.map(function (li) {
      var out = (b.output && b.output[li._key]) || {};
      if (canEdit) {
        return { label: li.productName || li.productId || '—', cells: [
          '<input type="number" min="0" class="form-input jbOut" data-li="' + esc(li._key) + '" data-f="completed" value="' + (out.completedQuantity || 0) + '" style="width:70px;text-align:right;">',
          '<input type="number" min="0" class="form-input jbOut" data-li="' + esc(li._key) + '" data-f="loss" value="' + (out.lossQuantity || 0) + '" style="width:70px;text-align:right;">',
          String(li.targetQuantity || 0)
        ] };
      }
      return { label: li.productName || li.productId || '—', cells: [String(out.completedQuantity || 0), String(out.lossQuantity || 0), String(li.targetQuantity || 0)] };
    });
    var outputCard = UU.card('Output', UU.metricTable({ corner: 'Item', columns: ['Completed', 'Loss', 'Target'], rows: outRows }));

    // Photos
    var media = buildMediaArr(r.media);
    var gallery = media.length ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + media.map(function (m) {
      return '<img src="' + esc(m.url) + '" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--border);">';
    }).join('') + '</div>' : '<p style="color:var(--warm-gray);">No photos yet.</p>';
    var photoUpload = canEdit ? '<label class="btn btn-secondary btn-small" style="cursor:pointer;margin-top:10px;display:inline-block;"><input type="file" accept="image/*" style="display:none;" onchange="JobsV2.buildPhoto(\'' + esc(r._key) + '\', this)">Add photo</label>' : '';
    var photosCard = UU.card('Photos', gallery + photoUpload);

    // Milestones
    var ms = milestonesArr(b);
    var msList = ms.length ? UU.timeline(ms.map(function (m) { return { label: m.text, at: fmtDate(m.timestamp), done: true }; })) : '<p style="color:var(--warm-gray);">No milestones yet.</p>';
    var msAdd = canEdit ? '<div style="display:flex;gap:8px;margin-top:10px;"><input id="jbMs" class="form-input" style="flex:1;" placeholder="Milestone (e.g. Wax model approved)"><button class="btn btn-secondary btn-small" onclick="JobsV2.buildMilestone(\'' + esc(r._key) + '\')">Add</button></div>' : '';
    var msCard = UU.card('Milestones', msList + msAdd);

    // Notes
    var notesCard = UU.card('Notes', canEdit
      ? '<textarea id="jbNotes" class="form-input" style="width:100%;min-height:70px;">' + esc(b.notes || '') + '</textarea><button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="JobsV2.buildSaveNotes(\'' + esc(r._key) + '\')">Save notes</button>'
      : (esc(b.notes || '') || '<span style="color:var(--warm-gray);">—</span>'));

    var completeBtn = canEdit ? '<div style="margin-top:16px;"><button class="btn btn-primary" onclick="JobsV2.buildComplete(\'' + esc(r._key) + '\')">Complete build</button> <span style="color:var(--warm-gray);font-size:0.85rem;">Records output, updates inventory, and locks the build.</span></div>' : '';

    // No back-crumb here — the engine renders the standard "← Job:" breadcrumb
    // for drilled SOs; adding our own duplicated it.
    return UU.stickyHead(tiles, '') + opsCard + outputCard + photosCard + msCard + notesCard + completeBtn;
  }
  function reopenBuild(id) { return Promise.resolve(MastEntity.get('job-build-v2').fetch(id)).then(function (fresh) { if (fresh) window.MastEntity.openRecord('job-build-v2', fresh, 'read', true); }); }
  // Mirror legacy uploadBuildPhoto: compress → Storage → buildMedia record.
  function _uploadBuildPhoto(file, buildId) {
    if (!window.storage || typeof window.compressImage !== 'function') return Promise.reject(new Error('Storage unavailable'));
    var mediaId = MastDB.newKey('_ids');
    return Promise.resolve(window.compressImage(file)).then(function (compressed) {
      var ref = window.storage.ref(MastDB.storagePath('builds/' + buildId + '/' + mediaId + '.jpg'));
      return ref.put(compressed).then(function (snap) { return snap.ref.getDownloadURL(); });
    }).then(function (url) {
      return MastDB.buildMedia.set(buildId, mediaId, { type: 'photo', url: url, caption: '', uploadedAt: new Date().toISOString(), originalFilename: file.name });
    });
  }

  // ════════════════ Entity: the story (drilled SO) ════════════════════
  // Document the build for buyers: pick build photos, caption, order, publish.
  // recordId = storyId. fetch loads the story + job + all the job's build photos.
  MastEntity.define('job-story-v2', {
    label: 'Story', labelPlural: 'Stories', size: 'lg', route: null,
    recordId: function (r) { return r._key; },
    fields: [{ name: '_title', label: 'Story', type: 'text', list: true, group: 'Story', readOnly: true }],
    fetch: function (storyId) {
      return Promise.resolve(MastDB.stories.get(storyId)).then(function (story) {
        if (!story) return null;
        var jobId = story.jobId;
        return Promise.resolve(jobId ? MastDB.productionJobs.get(jobId) : null).then(function (job) {
          var buildIds = Object.keys((job && job.builds) || {});
          return Promise.all(buildIds.map(function (bid) { return Promise.resolve(MastDB.buildMedia.get(bid)).then(function (m) { return { bid: bid, media: m || {} }; }).catch(function () { return { bid: bid, media: {} }; }); }))
            .then(function (mediaSets) {
              var avail = [];
              mediaSets.forEach(function (ms) { Object.keys(ms.media).forEach(function (mid) { var m = ms.media[mid]; if (m && m.url) avail.push({ url: m.url, buildId: ms.bid }); }); });
              var _title = (job && job.name) || (story && story.title) || 'Story';
              return { _key: storyId, _title: _title, id: storyId, story: story, job: job, jobId: jobId, available: avail };
            });
        });
      });
    },
    detail: { render: function (UU, r) { return storySObody(UU, r); } }
  });

  function storyEntriesArr(story) {
    var e = story.entries || {};
    return Object.keys(e).map(function (k) { return Object.assign({ _key: k }, e[k]); })
      .sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  }
  function storySObody(UU, r) {
    var story = r.story, sid = r._key, published = (story.status === 'published'), canEdit = canEditJobs() && !published;
    var tiles = UU.tiles([
      { k: 'Status', v: published ? UU.badge('Published', 'success') : UU.badge('Draft', 'amber'), hero: true },
      { k: 'Entries', v: String(storyEntriesArr(story).length) },
      { k: 'Photos available', v: String((r.available || []).length) }
    ]);
    // Title
    var titleCard = UU.card('Title', canEdit
      ? '<input id="jsTitle" class="form-input" style="width:100%;" value="' + esc(story.title || '') + '"> <button class="btn btn-secondary btn-small" style="margin-top:8px;" onclick="JobsV2.storySaveTitle(\'' + esc(sid) + '\')">Save title</button>'
      : (esc(story.title || '') || '<span style="color:var(--warm-gray);">—</span>'));
    // Curated entries (the story)
    var entries = storyEntriesArr(story);
    var entriesHtml = entries.length ? entries.map(function (e) {
      var thumb = e.mediaUrl ? '<img src="' + esc(e.mediaUrl) + '" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);flex:0 0 64px;">' : '';
      var cap = canEdit
        ? '<input class="form-input jsCap" data-e="' + esc(e._key) + '" value="' + esc(e.caption || '') + '" placeholder="Caption" style="flex:1;" onchange="JobsV2.storyCaption(\'' + esc(sid) + '\',\'' + esc(e._key) + '\',this)">'
        : '<span style="flex:1;">' + (esc(e.caption) || '<span style="color:var(--warm-gray);">No caption</span>') + '</span>';
      var rm = canEdit ? '<button class="mu-link" onclick="JobsV2.storyRemove(\'' + esc(sid) + '\',\'' + esc(e._key) + '\')">Remove</button>' : '';
      return '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">' + thumb + cap + rm + '</div>';
    }).join('') : '<p style="color:var(--warm-gray);">No entries yet — add build photos below.</p>';
    var entriesCard = UU.card('Story entries', entriesHtml);
    // Photo picker (build photos not already used)
    var usedUrls = {}; entries.forEach(function (e) { if (e.mediaUrl) usedUrls[e.mediaUrl] = true; });
    var pick = (r.available || []).filter(function (p) { return !usedUrls[p.url]; });
    var pickerCard = canEdit ? UU.card('Add build photos', pick.length
      ? '<div style="display:flex;gap:8px;flex-wrap:wrap;">' + pick.map(function (p) {
        return '<button type="button" onclick="JobsV2.storyAdd(\'' + esc(sid) + '\',\'' + encodeURIComponent(p.url) + '\',\'' + esc(p.buildId) + '\')" style="border:0;padding:0;background:none;cursor:pointer;"><img src="' + esc(p.url) + '" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid var(--border);"></button>';
      }).join('') + '</div>'
      : '<p style="color:var(--warm-gray);">No more build photos to add. Capture photos in a build session first.</p>') : '';
    // Publish / unpublish
    var actions = canEditJobs() ? UU.card('Publish', published
      ? '<p style="color:var(--warm-gray);margin-bottom:8px;">Published — visible to buyers; QR links the storefront product to this story.</p><button class="btn btn-secondary" onclick="JobsV2.storyUnpublish(\'' + esc(sid) + '\')">Unpublish</button>'
      : '<p style="color:var(--warm-gray);margin-bottom:8px;">Publishing credits the build operators and links the story to the job\'s product(s).</p><button class="btn btn-primary" onclick="JobsV2.storyPublish(\'' + esc(sid) + '\',\'' + esc(r.jobId) + '\')">Publish story</button>') : '';
    // QR codes (generated on publish) — one per product, links to the storefront story.
    var qrs = (story.qrCodes || []);
    var qrCard = (published && qrs.length) ? UU.card('QR codes', '<div style="display:flex;gap:18px;flex-wrap:wrap;">' + qrs.map(function (q) {
      return '<div style="text-align:center;"><img src="' + esc(q.dataUrl) + '" alt="" style="width:104px;height:104px;border-radius:8px;background:var(--charcoal);padding:6px;"><div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;max-width:120px;">' + esc(q.productName) + '</div></div>';
    }).join('') + '</div>') : '';
    return UU.stickyHead(tiles, '') + titleCard + entriesCard + pickerCard + actions + qrCard;
  }
  function reopenStory(sid) { return Promise.resolve(MastEntity.get('job-story-v2').fetch(sid)).then(function (fresh) { if (fresh) window.MastEntity.openRecord('job-story-v2', fresh, 'read', true); }); }
  // Client-side QR (qrcode-generator CDN) — one per job product, pointing at the
  // storefront product story page. No API key (LabelKeeper key is print-card only).
  function ensureQRLib() {
    return new Promise(function (resolve, reject) {
      if (window.qrcode) { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js';
      s.onload = resolve; s.onerror = function () { reject(new Error('Failed to load QR library')); };
      document.head.appendChild(s);
    });
  }
  function generateStoryQR(job) {
    var products = [];
    Object.values((job && job.lineItems) || {}).forEach(function (li) { if (li.productId) products.push({ productId: li.productId, productName: li.productName || 'Product' }); });
    if (!products.length) return Promise.resolve([]);
    return ensureQRLib().then(function () {
      return products.map(function (p) {
        var url = (window.GITHUB_PAGES_BASE || '') + '/product.html?id=' + p.productId + '&view=story';
        var qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
        return { productId: p.productId, productName: p.productName, url: url, dataUrl: qr.createDataURL(6, 0) };
      });
    }).catch(function (e) { console.error('[jobs-v2] QR generate', e); return []; });
  }

  // ── State + data (same source as legacy: admin/jobs) ────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc', status: 'active', purpose: 'all', off: null, requests: [], requestsExpanded: true, requestsLoaded: false };

  function toRows(tree) {
    var out = []; tree = tree || {};
    Object.keys(tree).forEach(function (k) { var j = tree[k]; if (j && typeof j === 'object') out.push(Object.assign({ _key: k }, j)); });
    return out;
  }
  function load() {
    var src = window.MastDB && MastDB.productionJobs;
    if (!src) return;
    var apply = function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    };
    if (typeof src.list === 'function') Promise.resolve(src.list()).then(apply).catch(function (e) { console.error('[jobs-v2] list', e); });
    if (typeof src.listen === 'function') { try { V2.off = src.listen(200, apply); } catch (e) {} }
  }

  var STATUS_FILTERS = [
    { key: 'active', label: 'Active', match: function (s) { return s === 'definition' || s === 'in-progress'; } },
    { key: 'in-progress', label: 'In progress', match: function (s) { return s === 'in-progress'; } },
    { key: 'on-hold', label: 'On hold', match: function (s) { return s === 'on-hold'; } },
    { key: 'completed', label: 'Completed', match: function (s) { return s === 'completed'; } },
    { key: 'cancelled', label: 'Cancelled', match: function (s) { return s === 'cancelled'; } },
    { key: 'all', label: 'All', match: function () { return true; } }
  ];

  function visibleRows() {
    var sf = STATUS_FILTERS.filter(function (f) { return f.key === V2.status; })[0] || STATUS_FILTERS[STATUS_FILTERS.length - 1];
    var rows = V2.rows.filter(function (r) { return sf.match(String(r.status || '').toLowerCase()); });
    if (V2.purpose !== 'all') rows = rows.filter(function (r) { return String(r.purpose || '').toLowerCase() === V2.purpose; });
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('jobs-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('jobsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'jobsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // One pill style for every facet group (the defined facet-pill pattern —
  // amber active tint, 0.85rem, token colors). Both status + purpose use it.
  function pill(label, on, onclick) {
    return '<button onclick="' + onclick + '" style="border:1px solid var(--border);' +
      'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
      'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
      'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + esc(label) + '</button>';
  }
  function statusPills() {
    return STATUS_FILTERS.map(function (f) { return pill(f.label, V2.status === f.key, "JobsV2.setStatus('" + f.key + "')"); }).join('');
  }
  function purposePills() {
    var opts = [{ key: 'all', label: 'All purposes' }].concat(Object.keys(PURPOSE_LABELS).map(function (k) { return { key: k, label: PURPOSE_LABELS[k] }; }));
    return opts.map(function (o) { return pill(o.label, V2.purpose === o.key, "JobsV2.setPurpose('" + o.key + "')"); }).join('');
  }

  // ── Build-requests queue (order → production pipeline) ──────────────
  // orders-v2 triage seeds pending build requests under admin/buildJobs; this is
  // where jobs-v2 CONSUMES them. All reads + writes single-source through
  // window.ProductionBridge (listRequests / convertRequestToJob /
  // assignRequestToExistingJob) — no raw buildJobs or job writes in this twin.
  function loadRequests() {
    // On a COLD load the production module (which defines window.ProductionBridge)
    // hasn't been pulled in yet, so listRequests isn't available synchronously.
    // AWAIT the host-module load before reading the queue — fire-and-forget left
    // V2.requests empty forever, so the Build-requests card never rendered on a
    // fresh URL (only after warm in-app nav). This loads async and re-renders just
    // the card once requests arrive; it does NOT gate the main jobs list (load()).
    ensureProductionBridge().then(function () {
      if (!(window.ProductionBridge && window.ProductionBridge.listRequests)) return;
      return Promise.resolve(window.ProductionBridge.listRequests({ status: 'pending' })).then(function (reqs) {
        V2.requests = Array.isArray(reqs) ? reqs : [];
        V2.requestsLoaded = true;
        render();
      });
    }).catch(function (e) { console.error('[jobs-v2] listRequests', e); });
  }

  // Resolve once window.ProductionBridge is available (loading the legacy
  // production.js host module on demand). loadModule returns a promise that
  // settles on the module script's onload, and ProductionBridge is assigned at
  // that script's top level, so it exists by the time this resolves.
  function ensureProductionBridge() {
    if (window.ProductionBridge && window.ProductionBridge.listRequests) return Promise.resolve();
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
      return Promise.resolve(MastAdmin.loadModule('production')).catch(function () {});
    }
    return Promise.resolve();
  }

  // Active jobs (definition / in-progress) for the assign-to-existing picker.
  function assignableJobs() {
    return V2.rows.filter(function (j) {
      var s = String(j.status || '').toLowerCase();
      return s === 'definition' || s === 'in-progress';
    });
  }

  function requestsQueueCard() {
    var pending = V2.requests || [];
    // Hide the whole section when there's nothing pending (keeps the list clean).
    if (!pending.length) return '';
    var canEdit = canEditJobs();
    var headerRight = '<button class="btn btn-secondary btn-small" onclick="JobsV2.toggleRequests()">' +
      (V2.requestsExpanded ? 'Hide' : 'Show') + '</button>';
    if (!V2.requestsExpanded) {
      return U.card('Build requests', '<p style="color:var(--warm-gray);margin:0;">' +
        esc(U.Num.count(pending.length)) + ' ' + MastFormat.plural(pending.length, 'pending build request') +
        ' from orders awaiting a production job.</p>', { headerRight: headerRight });
    }
    var jobs = assignableJobs();
    var jobOpts = jobs.map(function (j) {
      return '<option value="' + esc(j._key) + '">' + esc(j.name || 'Untitled') + ' (' + esc(statusLabel(j.status)) + ')</option>';
    }).join('');
    var cols = [
      { label: 'Order', render: function (pr) { return esc(pr.orderNumber || pr.orderId || '—'); } },
      { label: 'Product', render: function (pr) {
        var opts = (pr.options && typeof pr.options === 'object') ? Object.values(pr.options).filter(Boolean).join(' / ') : '';
        return esc(pr.productName || pr.productId || '—') + (opts ? ' <span class="mu-sub">(' + esc(opts) + ')</span>' : '');
      } },
      { label: 'Qty', align: 'right', render: function (pr) { return String(pr.qty || 1); } },
      { label: '', align: 'right', render: function (pr) {
        if (!canEdit) return '<span class="mu-sub">view only</span>';
        var rid = esc(pr._key);
        var convert = '<button class="btn btn-primary btn-small" onclick="JobsV2.queueConvert(\'' + rid + '\')">Convert to new job</button>';
        var assign = jobs.length
          ? ' <button class="btn btn-secondary btn-small" onclick="JobsV2.queueToggleAssign(\'' + rid + '\')">Assign to existing…</button>'
          : '';
        var assignForm = (jobs.length ? '<div id="jobReqAssign_' + rid + '" hidden style="margin-top:8px;display:flex;gap:6px;justify-content:flex-end;align-items:center;">' +
            '<select id="jobReqAssignSel_' + rid + '" class="form-input" style="width:auto;max-width:220px;">' + jobOpts + '</select>' +
            '<button class="btn btn-primary btn-small" onclick="JobsV2.queueAssign(\'' + rid + '\')">Assign</button>' +
          '</div>' : '');
        return convert + assign + assignForm;
      } }
    ];
    var hint = canEdit
      ? '<p style="color:var(--warm-gray);margin-top:8px;font-size:0.78rem;">Convert routes an order\'s build item into a production job with a frozen bill-of-materials. Assigned requests leave this queue.</p>'
      : '<p style="color:var(--warm-gray);margin-top:8px;font-size:0.78rem;">You don’t have permission to edit jobs.</p>';
    return U.card('Build requests', U.relatedTable(cols, pending) + hint, { headerRight: headerRight });
  }

  function render() {
    var tab = ensureTab();
    tab.innerHTML =
      U.pageHeader({
        title: 'Jobs',
        count: U.Num.count(V2.rows.length) + ' jobs',
        actionsHtml: (canEditJobs() ? '<button class="btn btn-primary" onclick="JobsV2.newJob()">+ New job</button> ' : '') +
          '<button class="btn btn-secondary" onclick="JobsV2.exportCsv()">&darr; Export</button>'
      }) +
      requestsQueueCard() +
      '<div style="margin:12px 0 6px;">' + statusPills() + '</div>' +
      '<div style="margin:0 0 14px;">' + purposePills() + '</div>' +
      window.MastEntity.renderList('jobs-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'JobsV2.sort', onRowClickFnName: 'JobsV2.open',
        columns: deadlineFlaggedColumns(),
        empty: { title: 'No jobs match these filters', message: 'Try a different status or purpose.' }
      });
  }
  // F25: reuse the default schema columns, but wrap the Deadline cell so a
  // past-deadline open job gets the app's existing danger badge appended. On-time
  // (and terminal) rows render exactly as before — no look-and-feel change.
  function deadlineFlaggedColumns() {
    var cols = window.MastEntity.listColumns('jobs-v2');
    cols.forEach(function (c) {
      if (c.key !== 'deadline') return;
      var base = c.render;
      c.render = function (j) {
        var html = base(j);
        if (jobOverdue(j)) html += ' ' + U.badge('Overdue', 'danger');
        return html;
      };
    });
    return cols;
  }

  // ── Public handlers (referenced by engine-rendered HTML) ────────────
  window.JobsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setStatus: function (s) { V2.status = s; render(); },
    setPurpose: function (p) { V2.purpose = p; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) window.MastEntity.openRecord('jobs-v2', rec, 'read'); },
    exportCsv: function () { return window.MastEntity.exportRows('jobs-v2', visibleRows(), V2.status); },
    // ── Build-requests queue (order → production pipeline) ──────────────
    toggleRequests: function () { V2.requestsExpanded = !V2.requestsExpanded; render(); },
    // Show/hide the inline existing-job picker for one request row.
    queueToggleAssign: function (rid) {
      var el = document.getElementById('jobReqAssign_' + rid);
      if (el) el.hidden = !el.hidden;
    },
    // Convert a pending request into a NEW job (delegates to ProductionBridge).
    queueConvert: function (rid) {
      if (!_guardEdit()) return;
      if (!window.ProductionBridge || !window.ProductionBridge.convertRequestToJob) {
        if (window.MastAdmin) MastAdmin.showToast('Production engine still loading — try again', true);
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
        return;
      }
      Promise.resolve(window.ProductionBridge.convertRequestToJob(rid)).then(function (res) {
        if (window.MastAdmin) MastAdmin.showToast('New job created from build request');
        loadRequests();
        if (res && res.jobId) {
          return Promise.resolve(MastDB.productionJobs.get(res.jobId)).then(function (fresh) {
            if (fresh) { fresh._key = res.jobId; fresh.id = res.jobId; window.MastEntity.openRecord('jobs-v2', fresh, 'read'); }
          });
        }
      }).catch(function (e) {
        console.error('[jobs-v2] queueConvert', e);
        if (window.MastAdmin) MastAdmin.showToast('Could not convert: ' + (e && e.message || e), true);
      });
    },
    // Assign a pending request to the existing job chosen in its row picker.
    queueAssign: function (rid) {
      if (!_guardEdit()) return;
      var sel = document.getElementById('jobReqAssignSel_' + rid);
      var jobId = sel ? sel.value : '';
      if (!jobId) { if (window.MastAdmin) MastAdmin.showToast('Pick a job to assign to', true); return; }
      if (!window.ProductionBridge || !window.ProductionBridge.assignRequestToExistingJob) {
        if (window.MastAdmin) MastAdmin.showToast('Production engine still loading — try again', true);
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
        return;
      }
      Promise.resolve(window.ProductionBridge.assignRequestToExistingJob(rid, jobId)).then(function () {
        if (window.MastAdmin) MastAdmin.showToast('Build request assigned to job');
        loadRequests();
      }).catch(function (e) {
        console.error('[jobs-v2] queueAssign', e);
        if (window.MastAdmin) MastAdmin.showToast('Could not assign: ' + (e && e.message || e), true);
      });
    },
    // Native "+ New job" — opens the create-only intake entity (name + purpose),
    // persisted through ProductionBridge.createJob. Closes the V1-only gap.
    newJob: function () {
      if (!_guardEdit()) return;
      // Pre-load legacy production.js so window.ProductionBridge exists at save.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
      window.MastEntity.openRecord('job-intake-v2', {}, 'create');
    },
    hold: function (id) {
      if (!_guardEdit()) return;
      JobsBridge.setStatus(id, 'on-hold').then(function () { if (window.MastAdmin) MastAdmin.showToast('Put on hold'); return reopenJob(id); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not hold: ' + (e && e.message || e), true); });
    },
    resume: function (id) {
      if (!_guardEdit()) return;
      JobsBridge.setStatus(id, 'in-progress').then(function () { if (window.MastAdmin) MastAdmin.showToast('Resumed'); return reopenJob(id); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not resume: ' + (e && e.message || e), true); });
    },
    // ── Build session ──
    startBuild: function (jobId) {
      if (!_guardEdit()) return;
      JobsBridge.startBuild(jobId).then(function (buildId) { if (window.MastAdmin) MastAdmin.showToast('Build started'); MastEntity.drill('job-build-v2', jobId + '::' + buildId); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not start build: ' + (e && e.message || e), true); });
    },
    openBuild: function (jobId, buildId) { MastEntity.drill('job-build-v2', jobId + '::' + buildId); },
    buildSaveOps: function (id) {
      if (!_guardEdit()) return;
      var p = id.split('::'); var el = document.getElementById('jbOps');
      var ops = (el ? el.value : '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      JobsBridge.setBuildField(p[0], p[1], 'operators', ops).then(function () { if (window.MastAdmin) MastAdmin.showToast('Operators saved'); return reopenBuild(id); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Save failed: ' + (e && e.message || e), true); });
    },
    buildSaveNotes: function (id) {
      if (!_guardEdit()) return;
      var p = id.split('::'); var el = document.getElementById('jbNotes');
      JobsBridge.setBuildField(p[0], p[1], 'notes', el ? el.value : '').then(function () { if (window.MastAdmin) MastAdmin.showToast('Notes saved'); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Save failed: ' + (e && e.message || e), true); });
    },
    buildMilestone: function (id) {
      if (!_guardEdit()) return;
      var p = id.split('::'); var el = document.getElementById('jbMs'); var text = el ? el.value.trim() : '';
      if (!text) return;
      JobsBridge.addMilestone(p[0], p[1], text).then(function () { return reopenBuild(id); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not add: ' + (e && e.message || e), true); });
    },
    buildPhoto: function (id, input) {
      if (!_guardEdit()) return;
      var file = input && input.files && input.files[0]; if (!file) return;
      var p = id.split('::'); var buildId = p[1];
      _uploadBuildPhoto(file, buildId).then(function () { if (window.MastAdmin) MastAdmin.showToast('Photo added'); return reopenBuild(id); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Upload failed: ' + (e && e.message || e), true); });
    },
    buildComplete: function (id) {
      if (!_guardEdit()) return;
      var p = id.split('::'); var jobId = p[0], buildId = p[1];
      var output = {};
      document.querySelectorAll('.jbOut').forEach(function (el) {
        var li = el.getAttribute('data-li'), f = el.getAttribute('data-f');
        if (!output[li]) output[li] = { completedQuantity: 0, lossQuantity: 0 };
        if (f === 'completed') output[li].completedQuantity = parseInt(el.value, 10) || 0;
        if (f === 'loss') output[li].lossQuantity = parseInt(el.value, 10) || 0;
      });
      var go = function () {
        JobsBridge.completeBuild(jobId, buildId, output)
          .then(function () { if (window.MastAdmin) MastAdmin.showToast('Build completed'); return reopenJob(jobId); })
          .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Complete failed: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') { window.mastConfirm('Complete this build? It records output, updates inventory, and locks the build.', { title: 'Complete build' }).then(function (ok) { if (ok) go(); }); } else { go(); }
    },
    // ── Line items ──
    liField: function (jobId, liId, field, el) {
      if (!_guardEdit()) return;
      JobsBridge.updateLineItem(jobId, liId, field, el ? el.value : 0)
        .then(function () { return rerenderItemsPane(jobId); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast((e && e.message) || 'Update failed', true); return rerenderItemsPane(jobId); });
    },
    liRemove: function (jobId, liId) {
      if (!_guardEdit()) return;
      var go = function () {
        JobsBridge.removeLineItem(jobId, liId).then(function () { if (window.MastAdmin) MastAdmin.showToast('Line item removed'); return rerenderItemsPane(jobId); })
          .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast((e && e.message) || 'Remove failed', true); });
      };
      if (typeof window.mastConfirm === 'function') { window.mastConfirm('Remove this line item?', { title: 'Remove line item' }).then(function (ok) { if (ok) go(); }); } else { go(); }
    },
    liLink: function (jobId, liId) {
      if (!_guardEdit()) return;
      JobsBridge.linkProductToBuild(jobId, liId).then(function () { if (window.MastAdmin) MastAdmin.showToast('Product linked to builds'); return rerenderItemsPane(jobId); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast((e && e.message) || 'Link failed', true); });
    },
    // ── Add line item (native, in-pane) ──
    toggleAddItem: function (jobId) {
      var form = document.getElementById('jobAddLiForm');
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) {
        var n = document.getElementById('jobLiName'); if (n) n.focus();
        // Populate the product picker on first open if products aren't loaded yet.
        if (!productsList().length) ensureProducts().then(refreshAddItemProductPicker);
      }
    },
    // Product picker change: auto-fill name + reveal/populate the variant picker
    // (mirrors legacy onLineItemProductSelect).
    onAddItemProduct: function () {
      var picker = document.getElementById('jobLiProduct');
      var nameEl = document.getElementById('jobLiName');
      var wrap = document.getElementById('jobLiVariantWrap');
      var vsel = document.getElementById('jobLiVariant');
      if (!picker) return;
      var prods = productsList();
      var match = picker.value ? prods.filter(function (p) { return p && p.pid === picker.value; })[0] : null;
      if (match && nameEl) nameEl.value = match.name || '';
      var variants = (match && Array.isArray(match.variants)) ? match.variants : [];
      if (variants.length) {
        var opts = '<option value="">— Pick a variant —</option>' + variants.map(function (v) {
          if (!v || !v.id) return '';
          var label = v.combo ? Object.keys(v.combo).map(function (k) { return v.combo[k]; }).filter(Boolean).join(' / ') : (v.name || v.id);
          return '<option value="' + esc(v.id) + '">' + esc(label) + '</option>';
        }).join('');
        if (vsel) vsel.innerHTML = opts;
        if (wrap) wrap.hidden = false;
      } else {
        if (vsel) vsel.innerHTML = '';
        if (wrap) wrap.hidden = true;
      }
    },
    addLineItem: function (jobId) {
      if (!_guardEdit()) return;
      // Ensure legacy production.js is loaded so window.ProductionBridge exists.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('production'); } catch (e) {} }
      if (!window.ProductionBridge || !window.ProductionBridge.addLineItem) { if (window.MastAdmin) MastAdmin.showToast('Production engine still loading — try again', true); return; }
      var pid = ((document.getElementById('jobLiProduct') || {}).value) || null;
      var name = (((document.getElementById('jobLiName') || {}).value) || '').trim();
      var qty = parseInt(((document.getElementById('jobLiQty') || {}).value), 10) || 1;
      var specs = (((document.getElementById('jobLiSpecs') || {}).value) || '').trim();
      if (!name) { if (window.MastAdmin) MastAdmin.showToast('Enter a product name', true); return; }
      // Variant required when the picked product has variants (parity with legacy).
      var variantId = null, variantLabel = null;
      if (pid) {
        var prod = productsList().filter(function (p) { return p && p.pid === pid; })[0];
        if (prod && Array.isArray(prod.variants) && prod.variants.length) {
          variantId = ((document.getElementById('jobLiVariant') || {}).value) || null;
          if (!variantId) { if (window.MastAdmin) MastAdmin.showToast('Pick a variant for this product', true); return; }
          var v = prod.variants.filter(function (x) { return x && x.id === variantId; })[0];
          if (v && v.combo) variantLabel = Object.keys(v.combo).map(function (k) { return v.combo[k]; }).filter(Boolean).join(' / ');
        }
      }
      window.ProductionBridge.addLineItem(jobId, {
        productId: pid, productName: name, variantId: variantId, variantLabel: variantLabel,
        targetQuantity: qty, specifications: specs
      }).then(function (res) {
        var bf = res && res.bomForecast;
        if (window.MastAdmin) MastAdmin.showToast(bf ? ('Line item added ($' + (bf.totalCostPerUnitCents / 100).toFixed(2) + '/unit)') : 'Line item added');
        return rerenderItemsPane(jobId);
      }).catch(function (e) {
        console.error('[jobs-v2] addLineItem', e);
        if (window.MastAdmin) MastAdmin.showToast('Could not add line item: ' + (e && e.message || e), true);
      });
    },
    // ── Story ──
    openStory: function (jobId) {
      if (!_guardEdit()) return;
      JobsBridge.ensureStory(jobId).then(function (sid) { MastEntity.drill('job-story-v2', sid); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not open story: ' + (e && e.message || e), true); });
    },
    storySaveTitle: function (sid) {
      if (!_guardEdit()) return;
      var el = document.getElementById('jsTitle');
      JobsBridge.setStoryTitle(sid, el ? el.value : '').then(function () { if (window.MastAdmin) MastAdmin.showToast('Title saved'); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Save failed: ' + (e && e.message || e), true); });
    },
    storyAdd: function (sid, urlEnc, buildId) {
      if (!_guardEdit()) return;
      var url = decodeURIComponent(urlEnc);
      JobsBridge.addStoryEntry(sid, { order: Date.now ? 0 : 0, mediaUrl: url, mediaType: 'photo', caption: '', buildId: buildId, source: 'build' })
        .then(function () { return reopenStory(sid); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not add: ' + (e && e.message || e), true); });
    },
    storyCaption: function (sid, eid, el) {
      if (!_guardEdit()) return;
      JobsBridge.setStoryEntryField(sid, eid, 'caption', el ? el.value : '')
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Save failed: ' + (e && e.message || e), true); });
    },
    storyRemove: function (sid, eid) {
      if (!_guardEdit()) return;
      JobsBridge.removeStoryEntry(sid, eid).then(function () { return reopenStory(sid); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not remove: ' + (e && e.message || e), true); });
    },
    storyPublish: function (sid, jobId) {
      if (!_guardEdit()) return;
      var go = function () {
        JobsBridge.publishStory(sid, jobId).then(function () { if (window.MastAdmin) MastAdmin.showToast('Story published'); return reopenStory(sid); })
          .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Publish failed: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') { window.mastConfirm('Publish this story? It will credit the build operators and link to the job\'s product(s).', { title: 'Publish story' }).then(function (ok) { if (ok) go(); }); } else { go(); }
    },
    storyUnpublish: function (sid) {
      if (!_guardEdit()) return;
      JobsBridge.unpublishStory(sid).then(function () { if (window.MastAdmin) MastAdmin.showToast('Unpublished'); return reopenStory(sid); })
        .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not unpublish: ' + (e && e.message || e), true); });
    },
    cancelJob: function (id) {
      if (!_guardEdit()) return;
      var go = function () {
        // Reverse committed incoming, then transition to the cancelled terminal.
        var rec = V2.byId[id] || { id: id, _key: id };
        JobsBridge.reverseIncoming(id)
          .then(function () { return window.MastFlow ? window.MastFlow.transition('jobs', rec, 'cancelled', { recordId: id }) : JobsBridge.setStatus(id, 'cancelled'); })
          .then(function () { if (window.MastAdmin) MastAdmin.showToast('Job cancelled'); return reopenJob(id); })
          .catch(function (e) { if (window.MastAdmin) MastAdmin.showToast('Could not cancel: ' + (e && e.message || e), true); });
      };
      if (typeof window.mastConfirm === 'function') { window.mastConfirm('Cancel this job? Committed incoming stock will be reversed.', { title: 'Cancel job', danger: true }).then(function (ok) { if (ok) go(); }); } else { go(); }
    }
  };

  // ── Register the side-by-side route ─────────────────────────────────
  MastAdmin.registerModule('jobs-v2', {
    routes: { 'jobs-v2': { tab: 'jobsV2Tab', setup: function () { ensureTab(); render(); load(); loadRequests(); } } }
  });
})();
