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
 *
 * UX conformance (mast-ux-style-guide v10):
 *   - .btn / .btn-primary / .btn-secondary / .btn-danger (no module classes)
 *   - .modal-overlay + .modal + .modal-header + .modal-body
 *   - .status-badge for reason chips
 *   - CSS vars only (no hardcoded hex); fonts in rem
 *   - window.showToast() for success; mastConfirm() for destructive prompts;
 *     no native confirm/alert/prompt
 *   - Action terminology: Cancel / Save / Remove / Done
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
    { id: '7d',  label: '7 days',       ms: 7  * 24 * 3600 * 1000 },
    { id: '30d', label: '30 days',      ms: 30 * 24 * 3600 * 1000 },
    { id: '90d', label: '90 days',      ms: 90 * 24 * 3600 * 1000 },
    { id: 'nq',  label: 'Next quarter', ms: null /* computed */ }
  ];

  function nextQuarterIso(now) {
    var d = now || new Date();
    var month = d.getMonth();
    var nextQuarterMonth = (Math.floor(month / 3) + 1) * 3;
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

  function toast(msg, isError) {
    if (typeof window.showToast === 'function') {
      window.showToast(msg, !!isError);
    } else {
      console[isError ? 'error' : 'log']('[AuditFeedback] ' + msg);
    }
  }

  function confirmDialog(message, opts) {
    if (typeof window.mastConfirm === 'function') return window.mastConfirm(message, opts || {});
    return Promise.resolve(window.confirm(message));
  }

  function alertDialog(message, opts) {
    if (typeof window.mastAlert === 'function') return window.mastAlert(message, opts || {});
    window.alert(message);
    return Promise.resolve();
  }

  function newBatchId() {
    if (window.MastDB && MastDB.newKey) return MastDB.newKey('rule_suppressions');
    return MastUtil.genId('bat_');
  }

  // ============================================================
  // Data primitives (Firestore via MastDB)
  // ============================================================

  function getAuditResult(docId)            { return MastDB.get('audit_results/' + docId); }
  function setAuditResultField(docId, patch){ return MastDB.update('audit_results/' + docId, patch); }
  function listSuppressionsRaw()            { return MastDB.get('rule_suppressions'); }
  function setSuppression(suppId, doc)      { return MastDB.set('rule_suppressions/' + suppId, doc); }
  function deleteSuppression(suppId)        { return MastDB.remove('rule_suppressions/' + suppId); }

  // ============================================================
  // Public API — AuditFeedback
  // ============================================================

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
   * Stamps lastReviewedAt on each row. Does NOT claim products are fixed and
   * does NOT stop the rule from firing — spec §J12 acceptance.
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

  function snooze(violationDocId, durationKey) {
    var until = snoozeUntilIso(durationKey);
    if (!until) return Promise.reject(new Error('invalid snooze duration'));
    return setAuditResultField(violationDocId, {
      state: 'snoozed',
      snoozeUntil: until,
      dismissCount: 0,
      lastChangedAt: nowIso()
    });
  }

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
    if (!SUPPRESSION_SCOPES.some(function(s) { return s.id === input.scope; })) {
      throw new Error('invalid scope');
    }
    if (input.scope !== 'tenant' && !input.scopeId) {
      throw new Error('scopeId required for product/category scope');
    }
    if (!SUPPRESSION_REASONS.some(function(r) { return r.id === input.reason; })) {
      throw new Error('invalid reason');
    }
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

  function suppressRule(input, opts) {
    validateSuppressionInput(input);
    var suppId = (window.MastDB && MastDB.newKey)
      ? MastDB.newKey('rule_suppressions')
      : MastUtil.genId('sup_');
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

  /** Spec: "Suppress for these N (batch per-product, shared batchId)". */
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
  // Suppression matcher — SHARED core (audit.js home view + audit-v2 queue).
  // A violation is suppressed when any active rule_suppression doc matches:
  // ruleId AND (scope 'tenant' | 'product'+scopeId===productId |
  // 'category'+scopeId===violation category). Category inference mirrors the
  // wedge rule-id prefixes (LQ-* / DR-* / PP-*).
  // ============================================================

  function violationCategoryOf(v) {
    var known = { lq: 1, drift: 1, pricing: 1 };
    if (v && v.category && known[v.category]) return v.category;
    var rid = (v && v.ruleId) ? String(v.ruleId) : '';
    if (/^lq/i.test(rid)) return 'lq';
    if (/^dr/i.test(rid)) return 'drift';
    if (/^pp/i.test(rid)) return 'pricing';
    return 'lq';
  }

  function matchesSuppression(v, suppressionRows) {
    if (!v || !v.ruleId || !Array.isArray(suppressionRows)) return false;
    var cat = violationCategoryOf(v);
    for (var i = 0; i < suppressionRows.length; i++) {
      var s = suppressionRows[i];
      if (!s || s.ruleId !== v.ruleId) continue;
      if (s.scope === 'tenant') return true;
      if (s.scope === 'product'  && s.scopeId === v.productId) return true;
      if (s.scope === 'category' && s.scopeId === cat) return true;
    }
    return false;
  }

  // ============================================================
  // Popover menu primitive (lightweight; used by all 3 menus)
  // ============================================================

  var OPEN_POPOVER = null;

  function closeOpenPopover() {
    if (OPEN_POPOVER && OPEN_POPOVER.parentNode) {
      OPEN_POPOVER.parentNode.removeChild(OPEN_POPOVER);
    }
    OPEN_POPOVER = null;
    document.removeEventListener('click', _outsideClickClose, true);
    document.removeEventListener('keydown', _escClosePopover, true);
  }

  function _outsideClickClose(e) {
    if (!OPEN_POPOVER || OPEN_POPOVER.contains(e.target)) return;
    closeOpenPopover();
  }

  function _escClosePopover(e) {
    if (e.key === 'Escape') closeOpenPopover();
  }

  function openPopover(anchorEl) {
    closeOpenPopover();
    var rect = anchorEl.getBoundingClientRect();
    var pop = document.createElement('div');
    pop.className = 'af-popover';
    pop.setAttribute('role', 'menu');
    pop.style.position = 'fixed';
    pop.style.top  = (rect.bottom + 4) + 'px';
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 320, rect.left)) + 'px';
    pop.style.background = 'var(--cream)';
    pop.style.color = 'var(--text-primary)';
    pop.style.border = '1px solid var(--cream-dark)';
    pop.style.borderRadius = '8px';
    pop.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
    pop.style.padding = '6px';
    pop.style.minWidth = '240px';
    pop.style.maxWidth = '320px';
    pop.style.zIndex = '300';
    pop.style.fontSize = '0.9rem';
    document.body.appendChild(pop);
    OPEN_POPOVER = pop;
    setTimeout(function() {
      document.addEventListener('click', _outsideClickClose, true);
      document.addEventListener('keydown', _escClosePopover, true);
    }, 0);
    return pop;
  }

  function menuItem(label, onClick, opts) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.style.display = 'block';
    btn.style.width = '100%';
    btn.style.textAlign = 'left';
    btn.style.background = 'transparent';
    btn.style.border = '0';
    btn.style.padding = '8px 10px';
    btn.style.borderRadius = '6px';
    btn.style.cursor = 'pointer';
    btn.style.color = 'var(--text-primary)';
    btn.style.font = 'inherit';
    btn.onmouseenter = function() { btn.style.background = 'var(--cream-dark)'; };
    btn.onmouseleave = function() { btn.style.background = 'transparent'; };
    var sub = opts && opts.sublabel
      ? '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(opts.sublabel) + '</div>'
      : '';
    btn.innerHTML = '<div style="font-weight:500;">' + esc(label) + '</div>' + sub;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      try { onClick(e); }
      catch (err) {
        console.error('[AuditFeedback] menu action failed:', err);
        alertDialog('Action failed: ' + (err.message || err), { title: 'Error' });
      }
    });
    return btn;
  }

  // ============================================================
  // Snooze duration picker (popover)
  // ============================================================

  function openSnoozeDialog(anchorEl, onPick) {
    var pop = openPopover(anchorEl);
    var hdr = document.createElement('div');
    hdr.style.padding = '6px 10px';
    hdr.style.fontSize = '0.78rem';
    hdr.style.color = 'var(--warm-gray)';
    hdr.style.textTransform = 'uppercase';
    hdr.style.letterSpacing = '0.04em';
    hdr.textContent = 'Snooze for';
    pop.appendChild(hdr);
    SNOOZE_DURATIONS.forEach(function(d) {
      pop.appendChild(menuItem(d.label, function() {
        closeOpenPopover();
        Promise.resolve(onPick(d.id)).catch(function(e) {
          alertDialog('Snooze failed: ' + (e.message || e), { title: 'Error' });
        });
      }));
    });
  }

  // ============================================================
  // Suppress dialog (scope + reason + optional reasonText) — .modal pattern
  // ============================================================

  function openSuppressDialog(opts) {
    closeOpenPopover();

    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'afSuppressTitle');

    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.maxWidth = '480px';

    var fixedScope = !!opts.fixedScope;
    var defaultScope = opts.defaultScope || 'product';

    var scopeOpts = SUPPRESSION_SCOPES.map(function(s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === defaultScope ? ' selected' : '') + '>' + esc(s.label) + '</option>';
    }).join('');
    var reasonOpts = SUPPRESSION_REASONS.map(function(r) {
      return '<option value="' + esc(r.id) + '">' + esc(r.label) + '</option>';
    }).join('');

    var inputCss = 'width:100%;padding:9px 12px;border:1px solid var(--cream-dark);border-radius:6px;'
                 + 'background:var(--cream);color:var(--text-primary);font-family:\'DM Sans\';font-size:0.9rem;';

    modal.innerHTML = [
      '<div class="modal-header">',
      '  <h3 id="afSuppressTitle">' + esc(opts.title || 'Suppress rule') + '</h3>',
      '  <button type="button" class="modal-close" aria-label="Cancel" data-af-close>&times;</button>',
      '</div>',
      '<div class="modal-body">',
      '  <label style="display:block;font-size:0.85rem;margin-bottom:4px;color:var(--warm-gray);">Scope</label>',
      '  <select id="afScope" style="' + inputCss + 'margin-bottom:12px;"' + (fixedScope ? ' disabled' : '') + '>' + scopeOpts + '</select>',
      '  <label style="display:block;font-size:0.85rem;margin-bottom:4px;color:var(--warm-gray);">Reason</label>',
      '  <select id="afReason" style="' + inputCss + 'margin-bottom:12px;">' + reasonOpts + '</select>',
      '  <div id="afRTWrap" style="display:none;margin-bottom:12px;">',
      '    <label style="display:block;font-size:0.85rem;margin-bottom:4px;color:var(--warm-gray);">Explain (≤' + SUPPRESSION_REASON_TEXT_MAX + ' chars)</label>',
      '    <textarea id="afReasonText" maxlength="' + SUPPRESSION_REASON_TEXT_MAX + '" rows="3" style="' + inputCss + 'resize:vertical;min-height:90px;"></textarea>',
      '    <div id="afRTCount" style="font-size:0.78rem;color:var(--warm-gray);text-align:right;margin-top:4px;">0 / ' + SUPPRESSION_REASON_TEXT_MAX + '</div>',
      '  </div>',
      '  <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:20px;">',
      '    <button type="button" class="btn btn-secondary" data-af-close>Cancel</button>',
      '    <button type="button" class="btn btn-primary" id="afSave">Save</button>',
      '  </div>',
      '</div>'
    ].join('');

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    var reasonSel = modal.querySelector('#afReason');
    var rtWrap    = modal.querySelector('#afRTWrap');
    var rtArea    = modal.querySelector('#afReasonText');
    var rtCount   = modal.querySelector('#afRTCount');

    reasonSel.addEventListener('change', function() {
      rtWrap.style.display = (reasonSel.value === 'other') ? '' : 'none';
    });
    rtArea.addEventListener('input', function() {
      rtCount.textContent = rtArea.value.length + ' / ' + SUPPRESSION_REASON_TEXT_MAX;
    });

    function close() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      document.removeEventListener('keydown', onEsc, true);
    }
    function onEsc(e) { if (e.key === 'Escape') close(); }

    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    Array.prototype.forEach.call(modal.querySelectorAll('[data-af-close]'), function(el) {
      el.addEventListener('click', close);
    });
    document.addEventListener('keydown', onEsc, true);

    modal.querySelector('#afSave').addEventListener('click', function() {
      var scope  = modal.querySelector('#afScope').value;
      var reason = reasonSel.value;
      var reasonText = (reason === 'other') ? rtArea.value.trim() : null;
      if (reason === 'other' && !reasonText) {
        alertDialog('Please explain your reason.', { title: 'Reason required' });
        return;
      }
      Promise.resolve(opts.onConfirm({ scope: scope, reason: reason, reasonText: reasonText }))
        .then(function() { close(); toast('Suppression saved.'); })
        .catch(function(err) { alertDialog('Failed: ' + (err.message || err), { title: 'Error' }); });
    });

    // Auto-focus the first interactive control.
    setTimeout(function() { modal.querySelector(fixedScope ? '#afReason' : '#afScope').focus(); }, 0);
  }

  // ============================================================
  // Public menu factories (wired from J13 surfaces)
  // ============================================================

  function openProductRollupMenu(anchorEl, ctx) {
    var pop = openPopover(anchorEl);
    var ids = ctx.violationDocIds || [];
    pop.appendChild(menuItem('View all (' + ids.length + ')', function() {
      closeOpenPopover();
      if (ctx.onViewAll) ctx.onViewAll();
    }));
    pop.appendChild(menuItem('Mark all resolved', function() {
      closeOpenPopover();
      Promise.all(ids.map(markResolved)).then(function() {
        toast('Marked ' + ids.length + ' resolved (pending recheck).');
        if (ctx.onChange) ctx.onChange();
      }).catch(function(err) {
        alertDialog('Failed: ' + (err.message || err), { title: 'Error' });
      });
    }, { sublabel: 'Recheck on next audit run' }));
    pop.appendChild(menuItem('Suppress this rule…', function() {
      closeOpenPopover();
      openSuppressDialog({
        title: 'Suppress rule for ' + (ctx.productLabel || 'this product'),
        defaultScope: 'product',
        onConfirm: function(form) {
          return suppressRule({
            ruleId:  ctx.ruleId,
            scope:   form.scope,
            scopeId: form.scope === 'product'  ? ctx.productId
                   : form.scope === 'category' ? (ctx.category || ctx.productId)
                   : '*',
            reason:     form.reason,
            reasonText: form.reasonText
          }).then(function() { if (ctx.onChange) ctx.onChange(); });
        }
      });
    }));
    pop.appendChild(menuItem('Snooze…', function() {
      openSnoozeDialog(anchorEl, function(dur) {
        return Promise.all(ids.map(function(id) { return snooze(id, dur); })).then(function() {
          toast('Snoozed ' + ids.length + ' for ' + dur + '.');
          if (ctx.onChange) ctx.onChange();
        });
      });
    }));
  }

  function openRulePopulationMenu(anchorEl, ctx) {
    var n = (ctx.productIds || []).length;
    var ids = ctx.violationDocIds || [];
    var pop = openPopover(anchorEl);
    pop.appendChild(menuItem('Mark all reviewed (' + n + ')',
      function() {
        closeOpenPopover();
        markAllReviewed(ids).then(function(r) {
          toast('Marked ' + r.count + ' reviewed. Rule still active.');
          if (ctx.onChange) ctx.onChange();
        }).catch(function(err) {
          alertDialog('Failed: ' + (err.message || err), { title: 'Error' });
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
            ruleId:     ctx.ruleId,
            productIds: ctx.productIds,
            reason:     form.reason,
            reasonText: form.reasonText
          }).then(function() { if (ctx.onChange) ctx.onChange(); });
        }
      });
    }, { sublabel: 'One batchId; remove is non-cascading' }));
    pop.appendChild(menuItem('Snooze all…', function() {
      openSnoozeDialog(anchorEl, function(dur) {
        return Promise.all(ids.map(function(id) { return snooze(id, dur); })).then(function() {
          toast('Snoozed ' + ids.length + ' for ' + dur + '.');
          if (ctx.onChange) ctx.onChange();
        });
      });
    }));
  }

  function openDriftItemMenu(anchorEl, ctx) {
    var pop = openPopover(anchorEl);
    pop.appendChild(menuItem('Mark resolved', function() {
      closeOpenPopover();
      markResolved(ctx.violationDocId).then(function() {
        toast('Marked resolved (pending recheck).');
        if (ctx.onChange) ctx.onChange();
      }).catch(function(err) {
        alertDialog('Failed: ' + (err.message || err), { title: 'Error' });
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
            scopeId: form.scope === 'product'  ? ctx.productId
                   : form.scope === 'category' ? (ctx.category || ctx.productId)
                   : '*',
            reason:     form.reason === 'other' ? 'other' : 'intentional',
            reasonText: form.reason === 'other' ? form.reasonText : undefined
          }).then(function() { if (ctx.onChange) ctx.onChange(); });
        }
      });
    }, { sublabel: 'Pick scope: this product / category / tenant-wide' }));
    pop.appendChild(menuItem('Snooze…', function() {
      openSnoozeDialog(anchorEl, function(dur) {
        return snooze(ctx.violationDocId, dur).then(function() {
          toast('Snoozed for ' + dur + '.');
          if (ctx.onChange) ctx.onChange();
        });
      });
    }));
  }

  // ============================================================
  // Suppression management page (route: suppressions)
  // List-type screen: grouped by ruleId then batchId, layered display.
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
      host.innerHTML = '<div class="loading">Loading suppressions…</div>';
      listSuppressions().then(function(rows) {
        pageRows = rows;
        pageLoaded = true;
        renderManagementPage();
      }).catch(function(err) {
        host.innerHTML =
          '<div style="padding:20px;color:var(--danger);font-size:0.9rem;">Failed to load: ' +
          esc(err.message || err) + '</div>';
      });
      return;
    }

    var header = [
      '<div class="section-header">',
      '  <h2>Audit Suppressions</h2>',
      '</div>',
      '<p style="color:var(--warm-gray);margin:0 0 20px;padding:0 24px;font-size:0.9rem;">',
      "  When you tell Mast to stop flagging a rule for a product, category, or tenant-wide, it shows up here. ",
      '  Suppressions are layered — a product-scoped row sits alongside any category or tenant-wide rows. ',
      '  Remove is per-row; sibling batch rows stay in place.',
      '</p>'
    ].join('');

    if (!pageRows.length) {
      host.innerHTML = header + [
        '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">',
        '  <div style="font-size:1.6rem;margin-bottom:12px;">🤫</div>',
        '  <p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No suppressions yet</p>',
        '  <p style="font-size:0.85rem;color:var(--warm-gray-light);">Suppressed findings from your audit will appear here.</p>',
        '</div>'
      ].join('');
      return;
    }

    var byRule = {};
    pageRows.forEach(function(r) {
      if (!byRule[r.ruleId]) byRule[r.ruleId] = [];
      byRule[r.ruleId].push(r);
    });

    var html = [header, '<div style="padding:0 24px 24px;">'];

    Object.keys(byRule).sort().forEach(function(ruleId) {
      var rows = byRule[ruleId];
      var batches = {};
      var loose = [];
      rows.forEach(function(r) {
        if (r.batchId) {
          if (!batches[r.batchId]) batches[r.batchId] = [];
          batches[r.batchId].push(r);
        } else loose.push(r);
      });

      html.push('<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;margin-bottom:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">');
      html.push('  <div style="padding:12px 16px;border-bottom:1px solid var(--cream-dark);font-weight:600;color:var(--text-primary);">');
      html.push(    esc(ruleId) +
                    ' <span style="color:var(--warm-gray);font-weight:400;font-size:0.85rem;">(' +
                    MastFormat.countNoun(rows.length, 'suppression') + ')</span>');
      html.push('  </div>');

      Object.keys(batches).forEach(function(bid) {
        var b = batches[bid];
        html.push('  <div style="padding:10px 16px;border-bottom:1px solid var(--cream-dark);background:rgba(0,0,0,0.02);">');
        html.push('    <div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.04em;">');
        html.push(      'Batch ' + esc(bid.slice(-8)) + ' — ' + MastFormat.countNoun(b.length, 'product') + ', ' + esc(reasonLabel(b[0].reason)));
        html.push('    </div>');
        b.forEach(function(r) { html.push(renderRowHtml(r)); });
        html.push('  </div>');
      });

      loose.forEach(function(r) {
        html.push('  <div style="padding:0 16px;">');
        html.push(renderRowHtml(r));
        html.push('  </div>');
      });

      html.push('</div>');
    });

    html.push('</div>');
    host.innerHTML = html.join('');

    // Wire Remove buttons.
    Array.prototype.forEach.call(host.querySelectorAll('[data-suppid]'), function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-suppid');
        confirmDialog('Remove this suppression? Sibling batch rows are not affected.', {
          title:        'Remove suppression',
          confirmLabel: 'Remove',
          danger:       true
        }).then(function(ok) {
          if (!ok) return;
          return removeSuppression(id).then(function() {
            pageLoaded = false;
            renderManagementPage();
            toast('Suppression removed.');
          });
        }).catch(function(err) {
          alertDialog('Failed: ' + (err.message || err), { title: 'Error' });
        });
      });
    });
  }

  function renderRowHtml(r) {
    var when = r.createdAt ? MastFormat.date(r.createdAt) : '';
    var reasonChip = '<span class="status-badge" style="background:rgba(196,133,60,0.30);color:var(--amber);margin-right:8px;">' + esc(reasonLabel(r.reason)) + '</span>';
    var scopeStr = (r.scope === 'tenant')
      ? scopeLabel(r.scope)
      : (scopeLabel(r.scope) + ': ' + (r.scopeId || ''));
    var reasonText = r.reasonText
      ? '<div style="font-size:0.85rem;color:var(--text-primary);margin-top:4px;font-style:italic;">&ldquo;' + esc(r.reasonText) + '&rdquo;</div>'
      : '';
    return [
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--cream-dark);">',
      '  <div style="flex:1;min-width:0;">',
      '    <div style="font-size:0.9rem;">' + reasonChip + '<span style="color:var(--warm-gray);font-size:0.85rem;">' + esc(scopeStr) + '</span></div>',
           reasonText,
      '    <div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:4px;">Added ' + esc(when) +
             (r.createdBy ? ' by ' + esc(r.createdBy.slice(0, 8)) : '') + '</div>',
      '  </div>',
      '  <button type="button" class="btn btn-secondary btn-small" data-suppid="' + esc(r.id) + '">Remove</button>',
      '</div>'
    ].join('');
  }

  // ============================================================
  // Module registration
  // ============================================================

  window.AuditFeedback = {
    SUPPRESSION_SCOPES:          SUPPRESSION_SCOPES,
    SUPPRESSION_REASONS:         SUPPRESSION_REASONS,
    SNOOZE_DURATIONS:            SNOOZE_DURATIONS,
    SUPPRESSION_REASON_TEXT_MAX: SUPPRESSION_REASON_TEXT_MAX,
    markResolved:        markResolved,
    markAllReviewed:     markAllReviewed,
    snooze:              snooze,
    dismiss:             dismiss,
    suppressRule:        suppressRule,
    suppressBatch:       suppressBatch,
    listSuppressions:    listSuppressions,
    removeSuppression:   removeSuppression,
    snoozeUntilIso:      snoozeUntilIso,
    violationCategoryOf: violationCategoryOf,
    matchesSuppression:  matchesSuppression
  };
  window.AuditFeedbackUI = {
    openProductRollupMenu:  openProductRollupMenu,
    openRulePopulationMenu: openRulePopulationMenu,
    openDriftItemMenu:      openDriftItemMenu,
    openSnoozeDialog:       openSnoozeDialog,
    openSuppressDialog:     openSuppressDialog,
    closeOpenPopover:       closeOpenPopover
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
