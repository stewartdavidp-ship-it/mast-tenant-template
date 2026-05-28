/**
 * Audit Feedback Module — J12.
 *
 * Tenant feedback ON Mast audit findings (Mark resolved / Mark all reviewed /
 * Suppress / Snooze). NOT the public-side feedback widget — that's
 * feedback-widget.js writing to {tid}/feedbackReports for site visitors.
 *
 * Exposes:
 *   - AuditFeedback.* primitives (markResolved, markAllReviewed, snooze,
 *     dismiss, suppressRule, suppressBatch, listSuppressions, removeSuppression)
 *   - AuditFeedbackUI.* menu/dialog openers J13 wires into violation rows
 *     (openProductRollupMenu, openRulePopulationMenu, openDriftItemMenu)
 *   - A standalone "Audit Suppressions" management page (route: suppressions)
 *
 * Data:
 *   tenants/{tid}/audit_results/{violationId}   — wedge writer owns create;
 *     this module updates state / snoozeUntil / dismissCount in place.
 *   tenants/{tid}/rule_suppressions/{suppId}    — this module is sole writer.
 *
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Constants — match shared/types/audit.ts and wedge §8
  // ============================================================

  var SUPPRESSION_REASON_TEXT_MAX = 140;

  var SUPPRESSION_SCOPES = [
    { id: 'product',  label: 'This product only' },
    { id: 'category', label: 'This category' },
    { id: 'tenant',   label: 'All my products (tenant-wide)' }
  ];

  var SUPPRESSION_REASONS = [
    { id: 'not-applicable', label: "Doesn't apply to my work" },
    { id: 'intentional',    label: 'Intentional design choice' },
    { id: 'temporary',      label: 'Temporary — will revisit' },
    { id: 'disagree',       label: 'Disagree with this rule' },
    { id: 'other',          label: 'Other (explain below)' }
  ];

  var SNOOZE_DURATIONS = [
    { id: '7d',  label: '7 days',         ms: 7  * 24 * 3600 * 1000 },
    { id: '30d', label: '30 days',        ms: 30 * 24 * 3600 * 1000 },
    { id: '90d', label: '90 days',        ms: 90 * 24 * 3600 * 1000 },
    { id: 'nq',  label: 'Next quarter',   ms: null /* computed */ }
  ];

  // Compute "next quarter" boundary (first day of next calendar quarter, 00:00 local).
  function nextQuarterIso(now) {
    var d = now || new Date();
    var month = d.getMonth();              // 0–11
    var nextQuarterMonth = (Math.floor(month / 3) + 1) * 3; // 3,6,9,12
    var year = d.getFullYear();
    if (nextQuarterMonth >= 12) { year += 1; nextQuarterMonth = 0; }
    return new Date(year, nextQuarterMonth, 1, 0, 0, 0, 0).toISOString();
  }

  function snoozeUntilIso(durationId) {
    if (durationId === 'nq') return nextQuarterIso();
    var spec = SNOOZE_DURATIONS.filter(function(s) { return s.id === durationId; })[0];
    if (!spec || !spec.ms) return null;
    return new Date(Date.now() + spec.ms).toISOString();
  }

  // ============================================================
  // Helpers
  // ============================================================

  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function currentUid() {
    try {
      if (typeof firebase !== 'undefined' && firebase.auth) {
        var u = firebase.auth().currentUser;
        if (u && u.uid) return u.uid;
      }
    } catch (e) { /* ignore */ }
    return 'unknown';
  }

  function nowIso() { return new Date().toISOString(); }

  function newBatchId() {
    // Firebase push-id-ish; we use MastDB.newKey when available for parity.
    if (window.MastDB && MastDB.newKey) {
      return MastDB.newKey('rule_suppressions');
    }
    return 'bat_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  // ============================================================
  // Data primitives — MastDB.auditResults + MastDB.ruleSuppressions
  // ============================================================

  function auditResultsRef(subpath) {
    var p = 'audit_results' + (subpath ? '/' + subpath : '');
    return MastDB.get(p);
  }

  function getAuditResult(docId) {
    return MastDB.get('audit_results/' + docId);
  }

  function setAuditResultField(docId, patch) {
    return MastDB.update('audit_results/' + docId, patch);
  }

  function listSuppressionsRaw() {
    return MastDB.get('rule_suppressions');
  }

  function setSuppression(suppId, doc) {
    return MastDB.set('rule_suppressions/' + suppId, doc);
  }

  function deleteSuppression(suppId) {
    return MastDB.remove('rule_suppressions/' + suppId);
  }

  // ============================================================
  // Public API — AuditFeedback
  // ============================================================

  /**
   * Flip a violation to 'resolved-pending-recheck'. Next audit run will
   * either re-fire (state→'open') or stay resolved.
   */
  function markResolved(violationDocId) {
    if (!violationDocId) return Promise.reject(new Error('violationDocId required'));
    return setAuditResultField(violationDocId, {
      state: 'resolved-pending-recheck',
      resolvedAt: nowIso(),
      resolvedBy: currentUid(),
      lastChangedAt: nowIso()
    });
  }

  /**
   * "I've looked at these N rows for this rule — don't tell me again until
   * something changes." Does NOT claim products are fixed and does NOT
   * stop the rule from firing. Stamps lastReviewedAt only.
   */
  function markAllReviewed(violationDocIds) {
    if (!Array.isArray(violationDocIds) || !violationDocIds.length) {
      return Promise.resolve({ count: 0 });
    }
    var stamp = nowIso();
    var by = currentUid();
    var updates = {};
    violationDocIds.forEach(function(id) {
      updates['audit_results/' + id + '/lastReviewedAt'] = stamp;
      updates['audit_results/' + id + '/lastReviewedBy'] = by;
    });
    return MastDB.multiUpdate(updates).then(function() {
      return { count: violationDocIds.length };
    });
  }

  /**
   * Snooze a single violation until durationKey's deadline. durationKey is
   * one of SNOOZE_DURATIONS ids ('7d' | '30d' | '90d' | 'nq').
   */
  function snooze(violationDocId, durationKey) {
    var until = snoozeUntilIso(durationKey);
    if (!until) return Promise.reject(new Error('invalid snooze duration'));
    return setAuditResultField(violationDocId, {
      state: 'snoozed',
      snoozeUntil: until,
      dismissCount: 0,            // wedge §8: snooze resets dismiss escalation
      lastChangedAt: nowIso()
    });
  }

  /** Increment dismissCount; escalation cron reads this. */
  function dismiss(violationDocId) {
    return getAuditResult(violationDocId).then(function(existing) {
      var n = (existing && typeof existing.dismissCount === 'number')
        ? existing.dismissCount : 0;
      return setAuditResultField(violationDocId, {
        dismissCount: n + 1,
        lastDismissedAt: nowIso()
      });
    });
  }

  function validateSuppressionInput(input) {
    if (!input || !input.ruleId)             throw new Error('ruleId required');
    var scopeOk = SUPPRESSION_SCOPES.some(function(s) { return s.id === input.scope; });
    if (!scopeOk)                            throw new Error('invalid scope');
    if (input.scope !== 'tenant' && !input.scopeId) {
      throw new Error('scopeId required for product/category scope');
    }
    var reasonOk = SUPPRESSION_REASONS.some(function(r) { return r.id === input.reason; });
    if (!reasonOk)                           throw new Error('invalid reason');
    if (input.reason === 'other') {
      if (!input.reasonText || !input.reasonText.trim()) {
        throw new Error('reasonText required when reason === "other"');
      }
      if (input.reasonText.length > SUPPRESSION_REASON_TEXT_MAX) {
        throw new Error('reasonText exceeds ' + SUPPRESSION_REASON_TEXT_MAX + ' chars');
      }
    } else if (input.reasonText) {
      throw new Error('reasonText only allowed when reason === "other"');
    }
  }

  /**
   * Write one rule_suppressions row. Pre-filter (J10) reads these on the
   * next audit run and skips matched violations entirely (zero new rows).
   * Existing audit_results rows are NOT deleted here; they stop being
   * touched (lastSeenAt freezes) and J13 hides them when matched against
   * the same suppression index.
   */
  function suppressRule(input, opts) {
    validateSuppressionInput(input);
    var suppId = (window.MastDB && MastDB.newKey)
      ? MastDB.newKey('rule_suppressions')
      : 'sup_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var doc = {
      ruleId:    input.ruleId,
      scope:     input.scope,
      scopeId:   input.scope === 'tenant' ? '*' : input.scopeId,
      reason:    input.reason,
      createdAt: nowIso(),
      createdBy: currentUid(),
      batchId:   (opts && opts.batchId) || null
    };
    if (input.reason === 'other') doc.reasonText = input.reasonText.trim();
    return setSuppression(suppId, doc).then(function() {
      return { id: suppId, doc: doc };
    });
  }

  /**
   * Suppress one ruleId across N products in one batch (shared batchId).
   * Spec: "Suppress for these N (batch per-product, shared batchId)".
   */
  function suppressBatch(input) {
    if (!input || !input.ruleId || !Array.isArray(input.productIds) || !input.productIds.length) {
      return Promise.reject(new Error('ruleId + productIds[] required'));
    }
    validateSuppressionInput({
      ruleId: input.ruleId,
      scope: 'product',
      scopeId: input.productIds[0],
      reason: input.reason,
      reasonText: input.reasonText
    });
    var batchId = newBatchId();
    var stamp = nowIso();
    var by = currentUid();
    var writes = {};
    var ids = [];
    input.productIds.forEach(function(pid) {
      var suppId = MastDB.newKey('rule_suppressions');
      ids.push(suppId);
      var doc = {
        ruleId:    input.ruleId,
        scope:     'product',
        scopeId:   pid,
        reason:    input.reason,
        createdAt: stamp,
        createdBy: by,
        batchId:   batchId
      };
      if (input.reason === 'other') doc.reasonText = input.reasonText.trim();
      writes['rule_suppressions/' + suppId] = doc;
    });
    return MastDB.multiUpdate(writes).then(function() {
      return { batchId: batchId, ids: ids, count: ids.length };
    });
  }

  function listSuppressions() {
    return listSuppressionsRaw().then(function(raw) {
      if (!raw) return [];
      return Object.keys(raw).map(function(id) {
        var d = raw[id] || {};
        return {
          id: id,
          ruleId:     d.ruleId,
          scope:      d.scope,
          scopeId:    d.scopeId,
          reason:     d.reason,
          reasonText: d.reasonText || null,
          createdAt:  d.createdAt,
          createdBy:  d.createdBy,
          batchId:    d.batchId || null
        };
      });
    });
  }

  /** Spec: un-suppress is NON-cascading. Deleting one batch row leaves siblings alone. */
  function removeSuppression(suppId) {
    if (!suppId) return Promise.reject(new Error('suppId required'));
    return deleteSuppression(suppId);
  }

  // ============================================================
  // UI primitives — popover menus
  // ============================================================

  var OPEN_POPOVER = null;
  function closeOpenPopover() {
    if (OPEN_POPOVER && OPEN_POPOVER.parentNode) {
      OPEN_POPOVER.parentNode.removeChild(OPEN_POPOVER);
    }
    OPEN_POPOVER = null;
    document.removeEventListener('click', _outsideClickClose, true);
  }
  function _outsideClickClose(e) {
    if (!OPEN_POPOVER) return;
    if (OPEN_POPOVER.contains(e.target)) return;
    closeOpenPopover();
  }

  function openPopover(anchorEl, innerHtml) {
    closeOpenPopover();
    var rect = anchorEl.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.className = 'audit-feedback-popover';
    pop.style.cssText = [
      'position:fixed',
      'top:'  + (rect.bottom + 4) + 'px',
      'left:' + Math.max(8, Math.min(window.innerWidth - 320, rect.left)) + 'px',
      'background:var(--card-bg, #fff)',
      'border:1px solid var(--border-color, #d1d5db)',
      'border-radius:8px',
      'box-shadow:0 4px 16px rgba(0,0,0,0.12)',
      'padding:6px',
      'min-width:240px',
      'max-width:320px',
      'z-index:10000',
      'font-size:0.9rem'
    ].join(';');
    pop.innerHTML = innerHtml;
    document.body.appendChild(pop);
    OPEN_POPOVER = pop;
    // Defer attach so the click that opened the popover doesn't immediately close it.
    setTimeout(function() {
      document.addEventListener('click', _outsideClickClose, true);
    }, 0);
    return pop;
  }

  function menuItem(label, onClick, opts) {
    var sub = opts && opts.sublabel ? '<div style="font-size:0.78rem;color:var(--warm-gray,#6b7280);margin-top:2px;">' + esc(opts.sublabel) + '</div>' : '';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'display:block;width:100%;text-align:left;background:transparent;border:0;padding:8px 10px;border-radius:6px;cursor:pointer;color:var(--text-color,#111);font:inherit;';
    btn.onmouseenter = function() { btn.style.background = 'var(--hover-bg, #f3f4f6)'; };
    btn.onmouseleave = function() { btn.style.background = 'transparent'; };
    btn.innerHTML = '<div style="font-weight:500;">' + esc(label) + '</div>' + sub;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      try { onClick(e); } catch (err) { console.error('[AuditFeedback] menu action failed:', err); alert('Action failed: ' + (err.message || err)); }
    });
    return btn;
  }

  function flash(msg) {
    if (window.MastToast && MastToast.show) { MastToast.show(msg); return; }
    if (window.toast) { window.toast(msg); return; }
    // Fallback — non-blocking corner notice.
    var n = document.createElement('div');
    n.textContent = msg;
    n.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#111;color:#fff;padding:10px 14px;border-radius:6px;z-index:10001;font-size:0.9rem;box-shadow:0 4px 12px rgba(0,0,0,0.2);';
    document.body.appendChild(n);
    setTimeout(function() { if (n.parentNode) n.parentNode.removeChild(n); }, 2400);
  }

  // ---- Snooze duration picker (used by single + rollup menus) -------------

  function openSnoozeDialog(anchorEl, onPick) {
    var pop = openPopover(anchorEl, '');
    var hdr = document.createElement('div');
    hdr.style.cssText = 'padding:6px 10px;font-size:0.78rem;color:var(--warm-gray,#6b7280);text-transform:uppercase;letter-spacing:0.04em;';
    hdr.textContent = 'Snooze for';
    pop.appendChild(hdr);
    SNOOZE_DURATIONS.forEach(function(d) {
      pop.appendChild(menuItem(d.label, function() {
        closeOpenPopover();
        Promise.resolve(onPick(d.id)).catch(function(e) { alert('Snooze failed: ' + e.message); });
      }));
    });
  }

  // ---- Suppress dialog (scope + reason + reasonText) ----------------------

  function openSuppressDialog(opts) {
    // opts: { title, defaultScope?, defaultScopeId?, fixedScope?, fixedScopeId?, onConfirm }
    closeOpenPopover();
    var backdrop = document.createElement('div');
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:10002;display:flex;align-items:center;justify-content:center;padding:20px;';
    var modal = document.createElement('div');
    modal.style.cssText = 'background:var(--card-bg,#fff);border-radius:12px;max-width:480px;width:100%;padding:20px;box-shadow:0 12px 32px rgba(0,0,0,0.25);';
    var defaultScope = opts.defaultScope || 'product';
    var fixedScope = !!opts.fixedScope;

    var scopeOpts = SUPPRESSION_SCOPES.map(function(s) {
      var sel = s.id === defaultScope ? ' selected' : '';
      return '<option value="' + esc(s.id) + '"' + sel + '>' + esc(s.label) + '</option>';
    }).join('');
    var reasonOpts = SUPPRESSION_REASONS.map(function(r) {
      return '<option value="' + esc(r.id) + '">' + esc(r.label) + '</option>';
    }).join('');

    modal.innerHTML = [
      '<div style="font-weight:600;font-size:1.0rem;margin-bottom:12px;">' + esc(opts.title || 'Suppress rule') + '</div>',
      '<label style="display:block;font-size:0.85rem;margin-bottom:4px;color:var(--warm-gray,#6b7280);">Scope</label>',
      '<select id="af-scope" style="width:100%;padding:8px;border:1px solid var(--border-color,#d1d5db);border-radius:6px;margin-bottom:12px;"' + (fixedScope ? ' disabled' : '') + '>' + scopeOpts + '</select>',
      '<label style="display:block;font-size:0.85rem;margin-bottom:4px;color:var(--warm-gray,#6b7280);">Reason</label>',
      '<select id="af-reason" style="width:100%;padding:8px;border:1px solid var(--border-color,#d1d5db);border-radius:6px;margin-bottom:12px;">' + reasonOpts + '</select>',
      '<div id="af-reasontext-wrap" style="display:none;margin-bottom:12px;">',
      '  <label style="display:block;font-size:0.85rem;margin-bottom:4px;color:var(--warm-gray,#6b7280);">Explain (≤' + SUPPRESSION_REASON_TEXT_MAX + ' chars)</label>',
      '  <textarea id="af-reasontext" maxlength="' + SUPPRESSION_REASON_TEXT_MAX + '" rows="3" style="width:100%;padding:8px;border:1px solid var(--border-color,#d1d5db);border-radius:6px;resize:vertical;"></textarea>',
      '  <div id="af-rt-count" style="font-size:0.72rem;color:var(--warm-gray,#6b7280);text-align:right;margin-top:2px;">0 / ' + SUPPRESSION_REASON_TEXT_MAX + '</div>',
      '</div>',
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;">',
      '  <button id="af-cancel" type="button" style="padding:8px 14px;background:transparent;border:1px solid var(--border-color,#d1d5db);border-radius:6px;cursor:pointer;color:var(--text-color,#111);">Cancel</button>',
      '  <button id="af-confirm" type="button" style="padding:8px 14px;background:var(--accent-color,#111);color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:500;">Suppress</button>',
      '</div>'
    ].join('');
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);

    var reasonSel = modal.querySelector('#af-reason');
    var rtWrap    = modal.querySelector('#af-reasontext-wrap');
    var rtArea    = modal.querySelector('#af-reasontext');
    var rtCount   = modal.querySelector('#af-rt-count');
    reasonSel.addEventListener('change', function() {
      rtWrap.style.display = (reasonSel.value === 'other') ? '' : 'none';
    });
    rtArea.addEventListener('input', function() {
      rtCount.textContent = rtArea.value.length + ' / ' + SUPPRESSION_REASON_TEXT_MAX;
    });

    function close() { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); }
    backdrop.addEventListener('click', function(e) { if (e.target === backdrop) close(); });
    modal.querySelector('#af-cancel').addEventListener('click', close);
    modal.querySelector('#af-confirm').addEventListener('click', function() {
      var scope  = modal.querySelector('#af-scope').value;
      var reason = reasonSel.value;
      var reasonText = (reason === 'other') ? rtArea.value.trim() : null;
      if (reason === 'other' && !reasonText) { alert('Please explain your reason.'); return; }
      try {
        Promise.resolve(opts.onConfirm({ scope: scope, reason: reason, reasonText: reasonText }))
          .then(function() { close(); flash('Suppression saved.'); })
          .catch(function(err) { alert('Failed: ' + (err.message || err)); });
      } catch (err) {
        alert('Failed: ' + (err.message || err));
      }
    });
  }

  // ---- Public menu factories used by J13 audit surfaces -------------------

  /**
   * Per-product rollup menu — wired into J13 product audit panel header.
   * @param {HTMLElement} anchorEl
   * @param {object} ctx
   *   { productId, ruleId, violationDocIds: [string], onViewAll?: fn }
   */
  function openProductRollupMenu(anchorEl, ctx) {
    var pop = openPopover(anchorEl, '');
    pop.appendChild(menuItem('View all (' + (ctx.violationDocIds || []).length + ')', function() {
      closeOpenPopover();
      if (ctx.onViewAll) ctx.onViewAll();
    }));
    pop.appendChild(menuItem('Mark all resolved', function() {
      closeOpenPopover();
      var ids = ctx.violationDocIds || [];
      Promise.all(ids.map(markResolved)).then(function() {
        flash('Marked ' + ids.length + ' resolved (pending recheck).');
        if (ctx.onChange) ctx.onChange();
      });
    }, { sublabel: 'Recheck on next audit run' }));
    pop.appendChild(menuItem('Suppress this rule…', function() {
      closeOpenPopover();
      openSuppressDialog({
        title: 'Suppress rule for ' + (ctx.productLabel || 'this product'),
        defaultScope: 'product',
        onConfirm: function(form) {
          return suppressRule({
            ruleId: ctx.ruleId,
            scope:  form.scope,
            scopeId: form.scope === 'product' ? ctx.productId
                   : form.scope === 'category' ? (ctx.category || ctx.productId)
                   : '*',
            reason: form.reason,
            reasonText: form.reasonText
          }).then(function() { if (ctx.onChange) ctx.onChange(); });
        }
      });
    }));
    pop.appendChild(menuItem('Snooze…', function() {
      openSnoozeDialog(anchorEl, function(dur) {
        var ids = ctx.violationDocIds || [];
        return Promise.all(ids.map(function(id) { return snooze(id, dur); })).then(function() {
          flash('Snoozed ' + ids.length + ' for ' + dur + '.');
          if (ctx.onChange) ctx.onChange();
        });
      });
    }));
  }

  /**
   * Per-rule × population rollup menu — wired into J13 "12 products have weak
   * photos" rollup header.
   * @param {HTMLElement} anchorEl
   * @param {object} ctx { ruleId, productIds: [string], violationDocIds: [string], onChange? }
   */
  function openRulePopulationMenu(anchorEl, ctx) {
    var n = (ctx.productIds || []).length;
    var pop = openPopover(anchorEl, '');
    pop.appendChild(menuItem('Mark all reviewed (' + n + ')',
      function() {
        closeOpenPopover();
        markAllReviewed(ctx.violationDocIds || []).then(function(r) {
          flash('Marked ' + r.count + ' reviewed. Rule still active.');
          if (ctx.onChange) ctx.onChange();
        });
      },
      { sublabel: "Doesn't fix anything — rule keeps firing on next pass" }
    ));
    pop.appendChild(menuItem('Suppress for these ' + n + '…', function() {
      closeOpenPopover();
      openSuppressDialog({
        title: 'Suppress rule for ' + n + ' products (batch)',
        defaultScope: 'product',
        fixedScope: true,
        onConfirm: function(form) {
          return suppressBatch({
            ruleId: ctx.ruleId,
            productIds: ctx.productIds,
            reason: form.reason,
            reasonText: form.reasonText
          }).then(function() { if (ctx.onChange) ctx.onChange(); });
        }
      });
    }, { sublabel: 'One batchId; un-suppress is non-cascading' }));
    pop.appendChild(menuItem('Snooze all…', function() {
      openSnoozeDialog(anchorEl, function(dur) {
        var ids = ctx.violationDocIds || [];
        return Promise.all(ids.map(function(id) { return snooze(id, dur); })).then(function() {
          flash('Snoozed ' + ids.length + ' for ' + dur + '.');
          if (ctx.onChange) ctx.onChange();
        });
      });
    }));
  }

  /**
   * Drift-item menu — Mark resolved / This is intentional → 3-scope picker.
   * @param {HTMLElement} anchorEl
   * @param {object} ctx { violationDocId, ruleId, productId, category?, onChange? }
   */
  function openDriftItemMenu(anchorEl, ctx) {
    var pop = openPopover(anchorEl, '');
    pop.appendChild(menuItem('Mark resolved', function() {
      closeOpenPopover();
      markResolved(ctx.violationDocId).then(function() {
        flash('Marked resolved (pending recheck).');
        if (ctx.onChange) ctx.onChange();
      });
    }));
    pop.appendChild(menuItem('This is intentional…', function() {
      closeOpenPopover();
      openSuppressDialog({
        title: 'Mark as intentional',
        defaultScope: 'product',
        onConfirm: function(form) {
          return suppressRule({
            ruleId:  ctx.ruleId,
            scope:   form.scope,
            scopeId: form.scope === 'product' ? ctx.productId
                   : form.scope === 'category' ? (ctx.category || ctx.productId)
                   : '*',
            reason:  form.reason === 'other' ? 'other' : 'intentional',
            reasonText: form.reason === 'other' ? form.reasonText : undefined
          }).then(function() { if (ctx.onChange) ctx.onChange(); });
        }
      });
    }, { sublabel: 'Pick scope: this product / category / tenant-wide' }));
    pop.appendChild(menuItem('Snooze…', function() {
      openSnoozeDialog(anchorEl, function(dur) {
        return snooze(ctx.violationDocId, dur).then(function() {
          flash('Snoozed for ' + dur + '.');
          if (ctx.onChange) ctx.onChange();
        });
      });
    }));
  }

  // ============================================================
  // Suppression management page (route: suppressions)
  // ============================================================

  var pageLoaded = false;
  var pageRows = [];

  function reasonLabel(id) {
    var r = SUPPRESSION_REASONS.filter(function(x) { return x.id === id; })[0];
    return r ? r.label : id;
  }
  function scopeLabel(id) {
    var s = SUPPRESSION_SCOPES.filter(function(x) { return x.id === id; })[0];
    return s ? s.label : id;
  }

  function renderManagementPage() {
    var host = document.getElementById('auditSuppressionsContent');
    if (!host) return;
    if (!pageLoaded) {
      host.innerHTML = '<div style="padding:24px;color:var(--warm-gray,#6b7280);">Loading suppressions…</div>';
      listSuppressions().then(function(rows) {
        pageRows = rows;
        pageLoaded = true;
        renderManagementPage();
      }).catch(function(err) {
        host.innerHTML = '<div style="padding:24px;color:#b91c1c;">Failed to load: ' + esc(err.message || err) + '</div>';
      });
      return;
    }

    if (!pageRows.length) {
      host.innerHTML = [
        '<div style="padding:32px 24px;">',
        '  <h2 style="margin:0 0 8px;font-size:1.6rem;">Audit Suppressions</h2>',
        '  <p style="color:var(--warm-gray,#6b7280);margin:0 0 16px;">When you suppress an audit finding, it shows up here. Suppressions are layered — a product-level suppression hides a tenant-level one if both exist.</p>',
        '  <div style="background:var(--card-bg,#fff);border:1px dashed var(--border-color,#d1d5db);border-radius:8px;padding:32px;text-align:center;color:var(--warm-gray,#6b7280);">No suppressions yet.</div>',
        '</div>'
      ].join('');
      return;
    }

    // Group by ruleId, then by batchId within rule.
    var byRule = {};
    pageRows.forEach(function(r) {
      if (!byRule[r.ruleId]) byRule[r.ruleId] = [];
      byRule[r.ruleId].push(r);
    });

    var html = [];
    html.push('<div style="padding:24px;">');
    html.push('<h2 style="margin:0 0 8px;font-size:1.6rem;">Audit Suppressions</h2>');
    html.push('<p style="color:var(--warm-gray,#6b7280);margin:0 0 20px;">Rules and scopes you\'ve told Mast to stop flagging. Grouped by rule. Un-suppress is per-row — removing one batch row does not affect siblings.</p>');

    Object.keys(byRule).sort().forEach(function(ruleId) {
      var rows = byRule[ruleId];
      // Sub-group by batchId; null batchId = one-off.
      var batches = {};
      var loose = [];
      rows.forEach(function(r) {
        if (r.batchId) {
          if (!batches[r.batchId]) batches[r.batchId] = [];
          batches[r.batchId].push(r);
        } else loose.push(r);
      });

      html.push('<div style="background:var(--card-bg,#fff);border:1px solid var(--border-color,#d1d5db);border-radius:8px;margin-bottom:16px;overflow:hidden;">');
      html.push('  <div style="padding:12px 16px;background:var(--hover-bg,#f9fafb);border-bottom:1px solid var(--border-color,#d1d5db);font-weight:600;">');
      html.push(    esc(ruleId) + ' <span style="color:var(--warm-gray,#6b7280);font-weight:400;font-size:0.85rem;">(' + rows.length + ' suppression' + (rows.length === 1 ? '' : 's') + ')</span>');
      html.push('  </div>');

      Object.keys(batches).forEach(function(bid) {
        var b = batches[bid];
        html.push('  <div style="padding:10px 16px;border-bottom:1px solid var(--border-color,#eee);background:rgba(0,0,0,0.02);">');
        html.push('    <div style="font-size:0.78rem;color:var(--warm-gray,#6b7280);margin-bottom:6px;">Batch ' + esc(bid.slice(-8)) + ' — ' + b.length + ' product' + (b.length === 1 ? '' : 's') + ', ' + esc(reasonLabel(b[0].reason)) + '</div>');
        b.forEach(function(r) { html.push(renderRowHtml(r)); });
        html.push('  </div>');
      });

      loose.forEach(function(r) {
        html.push('  <div style="padding:0 16px;border-bottom:1px solid var(--border-color,#eee);">');
        html.push(renderRowHtml(r));
        html.push('  </div>');
      });

      html.push('</div>');
    });

    html.push('</div>');
    host.innerHTML = html.join('');

    // Wire un-suppress buttons.
    host.querySelectorAll('[data-suppid]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-suppid');
        if (!confirm('Remove this suppression? (Non-cascading — sibling batch rows stay.)')) return;
        removeSuppression(id).then(function() {
          pageLoaded = false;
          renderManagementPage();
          flash('Suppression removed.');
        }).catch(function(err) { alert('Failed: ' + err.message); });
      });
    });
  }

  function renderRowHtml(r) {
    var when = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '';
    var reasonChip = '<span style="display:inline-block;padding:2px 8px;background:var(--hover-bg,#f3f4f6);border-radius:10px;font-size:0.78rem;margin-right:6px;">' + esc(reasonLabel(r.reason)) + '</span>';
    var scopeStr = (r.scope === 'tenant') ? scopeLabel(r.scope)
                 : (scopeLabel(r.scope) + ': ' + (r.scopeId || ''));
    var reasonText = r.reasonText ? '<div style="font-size:0.85rem;color:var(--text-color,#111);margin-top:4px;font-style:italic;">"' + esc(r.reasonText) + '"</div>' : '';
    return [
      '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-top:1px solid var(--border-color,#f3f4f6);">',
      '  <div style="flex:1;min-width:0;">',
      '    <div style="font-size:0.9rem;">' + reasonChip + '<span style="color:var(--warm-gray,#6b7280);font-size:0.85rem;">' + esc(scopeStr) + '</span></div>',
           reasonText,
      '    <div style="font-size:0.72rem;color:var(--warm-gray,#6b7280);margin-top:2px;">Added ' + esc(when) + (r.createdBy ? ' by ' + esc(r.createdBy.slice(0, 8)) : '') + '</div>',
      '  </div>',
      '  <button type="button" data-suppid="' + esc(r.id) + '" style="padding:6px 12px;background:transparent;border:1px solid var(--border-color,#d1d5db);border-radius:6px;cursor:pointer;font-size:0.85rem;color:var(--text-color,#111);">Un-suppress</button>',
      '</div>'
    ].join('');
  }

  // ============================================================
  // Module registration
  // ============================================================

  // Export public API on window for J13 + console debugging.
  window.AuditFeedback = {
    SUPPRESSION_SCOPES:  SUPPRESSION_SCOPES,
    SUPPRESSION_REASONS: SUPPRESSION_REASONS,
    SNOOZE_DURATIONS:    SNOOZE_DURATIONS,
    SUPPRESSION_REASON_TEXT_MAX: SUPPRESSION_REASON_TEXT_MAX,
    markResolved:        markResolved,
    markAllReviewed:     markAllReviewed,
    snooze:              snooze,
    dismiss:             dismiss,
    suppressRule:        suppressRule,
    suppressBatch:       suppressBatch,
    listSuppressions:    listSuppressions,
    removeSuppression:   removeSuppression,
    snoozeUntilIso:      snoozeUntilIso
  };
  window.AuditFeedbackUI = {
    openProductRollupMenu:    openProductRollupMenu,
    openRulePopulationMenu:   openRulePopulationMenu,
    openDriftItemMenu:        openDriftItemMenu,
    openSnoozeDialog:         openSnoozeDialog,
    openSuppressDialog:       openSuppressDialog,
    closeOpenPopover:         closeOpenPopover
  };

  if (window.MastAdmin && MastAdmin.registerModule) {
    MastAdmin.registerModule('auditFeedback', {
      routes: {
        'suppressions': {
          tab: 'auditSuppressionsTab',
          setup: function() { pageLoaded = false; renderManagementPage(); }
        }
      }
    });
  }

})();
