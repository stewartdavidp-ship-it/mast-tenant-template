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

  // ── Schema: the whole Jobs surface, declaratively ───────────────────
  MastEntity.define('jobs-v2', {
    label: 'Job', labelPlural: 'Jobs', size: 'xl',
    recordId: function (j) { return j._key || j.id; },
    fields: [
      { name: 'name', label: 'Job', type: 'text', list: true, required: true, group: 'Job', readOnly: true },
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
        var prog = progressOf(j);
        var tiles = UU.tiles([
          { k: 'Purpose', v: esc(purposeLabel(j.purpose)) },
          { k: 'Priority', v: j.priority ? statusLabel(j.priority) : '—' },
          { k: 'Progress', v: prog.target ? (prog.done + '/' + prog.target + ' · ' + prog.pct + '%') : '—' },
          { k: 'Items', v: String(lineItemsArr(j).length) }
        ]);
        var tabs = [
          { key: 'overview', label: 'Overview' }, { key: 'items', label: 'Line Items' },
          { key: 'builds', label: 'Builds' }, { key: 'costs', label: 'Costs' },
          { key: 'story', label: 'Story' }, { key: 'links', label: 'Links' }
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
          pane('story', storyPane(UU, j)) +
          pane('links', linksPane(UU, j));
      }
    }
    // No onSave in Layer 1 — read-only panes. Bridge-routed writes land next.
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
      { k: 'Deadline', v: fmtDate(j.deadline) },
      { k: 'Event', v: esc(j.eventName) },
      { k: 'Order', v: esc(j.orderId) }
    ]));
    return details + lifecyclePane(UU, j);
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
    var lis = lineItemsArr(j);
    if (!lis.length) return UU.card('Line Items', '<p style="color:var(--warm-gray);">No line items.</p>');
    var cols = [
      { label: 'Product', render: function (li) { return esc(li.productName || li.productId || '—') + (li.variantLabel ? ' <span class="mu-sub">(' + esc(li.variantLabel) + ')</span>' : ''); } },
      { label: 'Target', align: 'right', render: function (li) { return String(li.targetQuantity || 0); } },
      { label: 'Completed', align: 'right', render: function (li) { return String(li.completedQuantity || 0); } },
      { label: 'Loss', align: 'right', render: function (li) { return String(li.lossQuantity || 0); } },
      { label: 'Product link', render: function (li) { return li.productLinked ? UU.badge('Linked', 'success') : ''; } }
    ];
    return UU.cardTable('Line Items', UU.relatedTable(cols, lis));
  }

  function buildsPane(UU, j) {
    var builds = buildsArr(j);
    if (!builds.length) return UU.card('Builds', '<p style="color:var(--warm-gray);">No build sessions yet.</p>');
    var cols = [
      { label: 'Build', render: function (b) { return '#' + (b.buildNumber || '?'); } },
      { label: 'Date', render: function (b) { return fmtDate(b.sessionDate || b.createdAt); } },
      { label: 'Duration', align: 'right', render: function (b) { return b.durationMinutes != null ? b.durationMinutes + ' min' : ''; } },
      { label: 'Operators', render: function (b) { return esc(Array.isArray(b.operators) ? b.operators.join(', ') : (b.operators ? Object.values(b.operators).join(', ') : '')); } },
      { label: 'Status', render: function (b) { return b.locked ? UU.badge('Locked', 'teal') : UU.badge(statusLabel(b.status || 'in-progress'), 'amber'); } }
    ];
    return UU.cardTable('Builds', UU.relatedTable(cols, builds));
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
    // B1 is read-only; full story authoring (picker, captions, QR, publish) is
    // the B2 Story drill. Until then, link to the classic stories surface.
    return UU.card('Story',
      '<p style="color:var(--warm-gray);">Story authoring (build-photo picker, captions, QR, publish) lands in Phase B2. For now, manage stories in the classic Stories view.</p>' +
      '<button class="btn btn-secondary" onclick="JobsV2.openClassicStories()">Open Stories (classic)</button>');
  }

  function linksPane(UU, j) {
    var lis = lineItemsArr(j);
    var linked = lis.filter(function (li) { return li.productLinked; });
    return UU.card('Links', UU.kv([
      { k: 'Builds on job', v: String(buildsArr(j).length) },
      { k: 'Line items linked to product', v: linked.length + ' / ' + lis.length },
      { k: 'Order', v: esc(j.orderId) },
      { k: 'Customer', v: esc(j.customerId) }
    ]) + '<p style="color:var(--warm-gray);margin-top:8px;">Product-linking actions arrive in B2 (read-only here).</p>');
  }

  // ── State + data (same source as legacy: admin/jobs) ────────────────
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc', status: 'active', purpose: 'all', off: null };

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

  function render() {
    var tab = ensureTab();
    tab.innerHTML =
      U.pageHeader({
        title: 'Jobs',
        count: U.Num.count(V2.rows.length) + ' jobs',
        actionsHtml: '<button class="btn btn-secondary" onclick="JobsV2.exportCsv()">&darr; Export</button>'
      }) +
      '<div style="margin:12px 0 6px;">' + statusPills() + '</div>' +
      '<div style="margin:0 0 14px;">' + purposePills() + '</div>' +
      window.MastEntity.renderList('jobs-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'JobsV2.sort', onRowClickFnName: 'JobsV2.open',
        empty: { title: 'No jobs match these filters', message: 'Try a different status or purpose.' }
      });
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
    openClassicStories: function () { if (typeof navigateToClassic === 'function') navigateToClassic('stories'); else if (typeof navigateTo === 'function') navigateTo('stories'); },
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
      if (typeof window.mastConfirm === 'function') { window.mastConfirm('Cancel this job? Committed incoming stock will be reversed.', go); } else { go(); }
    }
  };

  // ── Register the side-by-side route ─────────────────────────────────
  MastAdmin.registerModule('jobs-v2', {
    routes: { 'jobs-v2': { tab: 'jobsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
