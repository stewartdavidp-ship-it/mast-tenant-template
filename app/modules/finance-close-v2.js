/**
 * finance-close-v2.js — ONE close-the-books pipeline (Finance Wave 3,
 * docs/ux-audit/finance-v2-build-plan.md — consolidation hub 3 of 3).
 *
 * Period Close and Amendments were two sidebar routes over one feature
 * ("Close v3"): versioned day closes roll into an immutable period close;
 * corrections to a closed period go through the amendment → counter-entry
 * workflow. This module serves BOTH routes (#finance-period-close-v2,
 * #finance-amendments-v2) with one page; the route picks the entry lens
 * (Periods / Day closes / Amendments).
 *
 * IMMUTABILITY IS DESIGN: closed periods and decided amendments render
 * read-only — no edit/delete affordances, ever; a re-close mints a new
 * version. All writes are the Close-v3 Cloud Functions via the state-free
 * FinanceBridge cores (closePeriod / amendApprove / amendReject); the
 * day-close drawer form and the submit-amendment modal stay on the classic
 * surfaces (linked) — they are already CF-backed.
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
  if (!window.MastAdmin || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  function m(cents) { return N.money(cents || 0, { cents: true }); }
  function bridge() { return window.FinanceBridge; }
  function canClose() { return (typeof window.can === 'function') ? window.can('finance-period-close', 'edit') : true; }
  function canApprove() { return (typeof window.hasPermission === 'function') ? window.hasPermission('finance', 'approveAmendment') : false; }

  var V2 = { lens: 'periods', month: null, months: [], periods: {}, days: {}, amendments: [], openPeriod: null, busy: false };

  function ensureTab() {
    var el = document.getElementById('financeCloseV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'financeCloseV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }
  function body() { return document.getElementById('finCloseV2Body'); }
  function pills(items, activeKey, fnName) {
    return items.map(function (p) {
      var on = activeKey === p[0];
      return '<button onclick="' + fnName + '(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--teal) 16%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;margin-bottom:6px;">' +
        p[1] + (p[2] != null ? ' <span style="color:var(--warm-gray);">' + p[2] + '</span>' : '') + '</button>';
    }).join('');
  }
  function statusBadge(pc) {
    if (!pc) return U.badge('open', 'amber');
    if (pc.status === 'auto-closed') return U.badge('auto-closed', 'teal');
    return U.badge(pc.status || 'closed', pc.status === 'closed' ? 'teal' : 'neutral');
  }

  function shell() {
    var tab = ensureTab();
    var pending = V2.amendments.filter(function (a) { return a.status === 'pending'; }).length;
    tab.innerHTML =
      U.pageHeader({
        title: 'Close the Books',
        count: 'Day closes → period close → amendments (immutable once closed)',
        actionsHtml:
          '<button class="btn btn-primary" onclick="FinCloseV2.newDayClose()">Day close (classic) ↗</button>' +
          '<button class="btn btn-secondary" onclick="FinCloseV2.submitAmendment()">+ Submit amendment</button>' +
          '<button class="btn btn-secondary" onclick="FinCloseV2.refresh()">Refresh</button>'
      }) +
      '<div style="margin:14px 0;">' + pills([
        ['periods', 'Periods', null],
        ['days', 'Day closes', null],
        ['amendments', 'Amendments', pending || null]
      ], V2.lens, 'FinCloseV2.setLens') + '</div>' +
      '<div id="finCloseV2Body"><div style="color:var(--warm-gray);font-size:0.85rem;padding:20px 0;">Loading…</div></div>';
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  function load() {
    return MastAdmin.loadModule('finance').then(function () {
      V2.months = bridge().last12Months();
      if (!V2.month) V2.month = V2.months[0];
      return Promise.all([
        Promise.all(V2.months.map(function (mo) { return bridge().periodCloseForMonth(mo).catch(function () { return null; }); })),
        Promise.all(V2.months.map(function (mo) { return bridge().dayClosesForMonth(mo).catch(function () { return {}; }); })),
        bridge().recentAmendments().catch(function () { return []; })
      ]);
    }).then(function (r) {
      V2.periods = {}; V2.days = {};
      V2.months.forEach(function (mo, i) { V2.periods[mo] = r[0][i]; V2.days[mo] = r[1][i]; });
      V2.amendments = r[2] || [];
      V2.amendments.sort(function (a, b) {
        var ap = a.status === 'pending' ? 0 : 1, bp = b.status === 'pending' ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (a.submittedAt || '') < (b.submittedAt || '') ? 1 : -1;
      });
    });
  }

  // ── Lenses ────────────────────────────────────────────────────────────────
  function renderPeriods() {
    var el = body(); if (!el) return;
    var rows = V2.months.map(function (mo) {
      var pc = V2.periods[mo];
      var days = V2.days[mo] || {};
      var dayCount = Object.keys(days).length;
      var roll = pc && (pc.rollup || {});
      var opening = pc ? (roll.openingCashCentsSum || 0) : Object.values(days).reduce(function (s, d) { return s + (d.openingCashCents || 0); }, 0);
      var closing = pc ? (roll.closingCashCentsSum || 0) : Object.values(days).reduce(function (s, d) { return s + (d.closingCashCents || 0); }, 0);
      var variance = pc ? (roll.varianceCentsSum || 0) : Object.values(days).reduce(function (s, d) { return s + (d.varianceCents || 0); }, 0);
      return { month: mo, pc: pc, dayCount: dayCount, opening: opening, closing: closing, variance: variance };
    });
    var canDo = canClose();
    var h = U.relatedTable ? U.relatedTable([
      { label: 'Period', render: function (r) { return '<strong>' + esc(bridge().monthLabel(r.month)) + '</strong>'; } },
      { label: 'Status', render: function (r) { return statusBadge(r.pc); } },
      { label: 'Days closed', align: 'right', render: function (r) { return String(r.dayCount); } },
      { label: 'Opening', align: 'right', render: function (r) { return r.dayCount ? m(r.opening) : '—'; } },
      { label: 'Closing', align: 'right', render: function (r) { return r.dayCount ? m(r.closing) : '—'; } },
      { label: 'Variance', align: 'right', render: function (r) { return r.dayCount ? m(r.variance) : '—'; } },
      { label: '', align: 'right', render: function (r) {
          if (r.pc) {
            var when = (r.pc.closedAt || r.pc.autoClosedAt || '').slice(0, 10);
            return '<span style="font-size:0.72rem;color:var(--warm-gray);">v' + esc(String(r.pc.version || 1)) + (when ? ' · ' + esc(when) : '') + '</span>' +
              ' <button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 9px;" onclick="FinCloseV2.openMonth(\'' + r.month + '\')">Detail</button>';
          }
          if (!canDo) return '';
          return '<button class="btn btn-primary" style="font-size:0.72rem;padding:3px 9px;" ' + (V2.busy ? 'disabled' : '') + ' onclick="FinCloseV2.closePeriod(\'' + r.month + '\')">Close period</button>' +
            ' <button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 9px;" onclick="FinCloseV2.openMonth(\'' + r.month + '\')">Days</button>';
        } }
    ], rows) : '';
    el.innerHTML = '<div id="finCloseV2Guard"></div>' + h +
      '<div style="margin-top:10px;font-size:0.72rem;color:var(--warm-gray);">A period can close only when every calendar day in it has a day close. Closed periods are immutable; corrections go through Amendments.</div>';
  }

  function renderDays() {
    var el = body(); if (!el) return;
    var monthPills = pills(V2.months.map(function (mo) { return [mo, bridge().monthLabel(mo).split(' ')[0], null]; }), V2.month, 'FinCloseV2.setMonth');
    var days = V2.days[V2.month] || {};
    var pc = V2.periods[V2.month];
    var rows = Object.keys(days).sort().reverse().map(function (d) { return days[d]; });
    var locked = !!pc;
    var h = '<div style="margin-bottom:10px;">' + monthPills + '</div>';
    if (locked) h += '<div style="margin-bottom:10px;font-size:0.78rem;color:var(--warm-gray);">' + statusBadge(pc) + ' This period is closed — day closes are read-only; corrections go through Amendments.</div>';
    h += U.relatedTable([
      { label: 'Date', render: function (r) { return esc(r.date) + ' <span style="color:var(--warm-gray);font-size:0.72rem;">v' + esc(String(r.version || 1)) + '</span>'; } },
      { label: 'Opening', align: 'right', render: function (r) { return m(r.openingCashCents); } },
      { label: 'Closing', align: 'right', render: function (r) { return m(r.closingCashCents); } },
      { label: 'Variance', align: 'right', render: function (r) { return m(r.varianceCents); } },
      { label: 'Checks', align: 'right', render: function (r) { return String((r.checks || []).length || '—'); } },
      { label: 'Notes', render: function (r) { return r.notes ? '<span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(String(r.notes).slice(0, 60)) + '</span>' : '—'; } },
      { label: '', align: 'right', render: function (r) {
          return '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 9px;" onclick="FinCloseV2.openDay(\'' + esc(r.date) + '\')">' + (locked ? 'View' : 'Open') + ' ↗</button>';
        } }
    ], rows);
    if (!rows.length) h += '<div style="color:var(--warm-gray);font-size:0.85rem;padding:14px 0;">No day closes in ' + esc(bridge().monthLabel(V2.month)) + ' yet.</div>';
    el.innerHTML = h;
  }

  function diffTable(a) {
    var before = a.before || {}, after = a.after || {};
    var keys = Object.keys(after);
    var rows = keys.map(function (k) {
      var b = before[k]; var v = after[k];
      var fmtv = function (x) { return x == null ? '(empty)' : (typeof x === 'object' ? JSON.stringify(x).slice(0, 80) : String(x).slice(0, 80)); };
      return '<tr><td style="padding:3px 8px;color:var(--warm-gray);">' + esc(k) + '</td><td style="padding:3px 8px;">' + esc(fmtv(b)) + '</td><td style="padding:3px 8px;color:var(--teal);">' + esc(fmtv(v)) + '</td></tr>';
    }).join('');
    return '<table style="width:100%;border-collapse:collapse;font-size:0.78rem;"><thead><tr>' +
      '<th style="text-align:left;padding:3px 8px;color:var(--warm-gray);">Field</th><th style="text-align:left;padding:3px 8px;color:var(--warm-gray);">Current</th><th style="text-align:left;padding:3px 8px;color:var(--warm-gray);">Proposed</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  function renderAmendmentsLens() {
    var el = body(); if (!el) return;
    if (!V2.amendments.length) {
      el.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:14px 0;">No amendments in the last 12 months. Submit one to correct a record in a closed period.</div>';
      return;
    }
    var approver = canApprove();
    var h = approver ? '' : '<div style="margin-bottom:12px;font-size:0.78rem;color:var(--amber);">You do not have the approve-amendment permission — Approve/Reject are disabled.</div>';
    h += V2.amendments.map(function (a) {
      var tone = a.status === 'pending' ? 'amber' : (a.status === 'approved' ? 'teal' : 'neutral');
      var head = U.badge(a.status, tone) + ' <strong style="margin-left:8px;">' + esc(a.targetCollection || '?') + ' / ' + esc(a.targetId || a.id || '') + '</strong>' +
        '<span style="color:var(--warm-gray);font-size:0.78rem;margin-left:10px;">period ' + esc(a.periodId || '') + ' · ' + esc((a.submittedByName || a.submittedBy || '')) + ' · ' + esc(String(a.submittedAt || '').slice(0, 10)) + '</span>';
      var inner = (a.reason ? '<div style="font-size:0.85rem;margin-bottom:8px;">' + esc(a.reason) + '</div>' : '') + diffTable(a);
      if (a.status === 'approved') {
        inner += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">Approved by ' + esc(a.approvedByName || a.approvedBy || '') + ' · ' + esc(String(a.approvedAt || '').slice(0, 10)) + (a.counterEntryId ? ' · counter-entry ' + esc(a.counterEntryId) : '') + '</div>';
      } else if (a.status === 'rejected') {
        inner += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">Rejected' + (a.rejectReason ? ' — ' + esc(a.rejectReason) : '') + ' · ' + esc(String(a.rejectedAt || '').slice(0, 10)) + '</div>';
      } else if (approver) {
        inner += '<div style="margin-top:10px;display:flex;gap:8px;">' +
          '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinCloseV2.approve(\'' + esc(a.periodId) + '\',\'' + esc(a.id) + '\')">Approve</button>' +
          '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinCloseV2.reject(\'' + esc(a.periodId) + '\',\'' + esc(a.id) + '\')">Reject</button>' +
          '</div>';
      }
      return U.card(' ', '<div style="margin-bottom:8px;">' + head + '</div>' + inner);
    }).join('');
    el.innerHTML = h;
  }

  var LENSES = { periods: renderPeriods, days: renderDays, amendments: renderAmendmentsLens };
  function render() { shell(); LENSES[V2.lens](); }
  function refresh() {
    shell();
    load().then(render).catch(function (e) {
      console.error('[finance-close-v2] load', e);
      var el = body(); if (el) el.innerHTML = '<div style="color:var(--danger);padding:12px;">' + esc(e.message || String(e)) + '</div>';
    });
  }

  function findAmendment(id) { return V2.amendments.filter(function (a) { return a.id === id; })[0]; }

  window.FinCloseV2 = {
    setLens: function (l) { V2.lens = l; render(); },
    setMonth: function (mo) { V2.month = mo; render(); },
    refresh: refresh,
    openMonth: function (mo) { V2.month = mo; V2.lens = 'days'; render(); },
    openDay: function (date) { if (window.navigateToClassic) navigateToClassic('finance-cash-flow', { subView: 'dayclose', date: date }); },
    newDayClose: function () { if (window.navigateToClassic) navigateToClassic('finance-cash-flow', { subView: 'dayclose' }); },
    submitAmendment: function () { bridge().openSubmitAmendment(); },

    closePeriod: function (mo) {
      if (!canClose()) { showToast('Finance write access required.', true); return; }
      mastConfirm('Close ' + bridge().monthLabel(mo) + '? Day closes in this month become read-only; corrections will require an amendment.', { title: 'Close period', confirmLabel: 'Close period' }).then(function (ok) {
        if (!ok) return;
        V2.busy = true; render();
        bridge().closePeriod(mo).then(function () {
          V2.busy = false;
          showToast('Closed ' + bridge().monthLabel(mo));
          refresh();
        }).catch(function (err) {
          V2.busy = false; render();
          var dates = err && err.details && Array.isArray(err.details.dates) ? err.details.dates : null;
          if ((err && err.message === 'unclosedDays') && dates) {
            var guard = document.getElementById('finCloseV2Guard');
            if (guard) {
              guard.innerHTML = U.card('Cannot close ' + esc(bridge().monthLabel(mo)),
                '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:8px;">These dates have no day close yet (' + dates.length + '). Close each, then re-run:</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + dates.slice(0, 40).map(function (d) {
                  return '<button class="btn btn-secondary" style="font-size:0.72rem;padding:2px 8px;" onclick="FinCloseV2.openDay(\'' + esc(d) + '\')">' + esc(d) + '</button>';
                }).join('') + (dates.length > 40 ? '<span style="font-size:0.72rem;color:var(--warm-gray);">+' + (dates.length - 40) + ' more</span>' : '') + '</div>');
            }
            showToast(dates.length + ' day(s) still open in ' + mo, true);
            return;
          }
          showToast('Close failed: ' + (err.message || err), true);
        });
      });
    },

    approve: function (periodId, id) {
      if (!canApprove()) { showToast('You do not have permission to approve amendments.', true); return; }
      var a = findAmendment(id); if (!a) return;
      mastConfirm('Approve this amendment? A counter-entry posts to the next open period (the closed ' + periodId + ' record is never mutated).', { title: 'Approve amendment', confirmLabel: 'Approve' }).then(function (ok) {
        if (!ok) return;
        bridge().amendApprove(id).then(function (json) {
          showToast('Amendment approved' + (json.counterEntryId ? ' (counter-entry ' + json.counterEntryId + ')' : ''));
          refresh();
        }).catch(function (err) { showToast('Approve failed: ' + (err.message || err), true); });
      });
    },
    reject: function (periodId, id) {
      if (!canApprove()) { showToast('You do not have permission to reject amendments.', true); return; }
      var a = findAmendment(id); if (!a) return;
      (window.mastPrompt ? mastPrompt('Reject reason (optional):', { title: 'Reject amendment', confirmLabel: 'Reject' }) : Promise.resolve('')).then(function (reason) {
        if (reason === null) return;
        bridge().amendReject(id, reason).then(function () {
          showToast('Amendment rejected');
          refresh();
        }).catch(function (err) { showToast('Reject failed: ' + (err.message || err), true); });
      });
    }
  };

  // Both routes land on the SAME page; the route picks the entry lens.
  function setupFor(lens) {
    return function () {
      ensureTab();
      V2.lens = lens;
      refresh();
    };
  }
  MastAdmin.registerModule('finance-close-v2', {
    routes: {
      'finance-period-close-v2': { tab: 'financeCloseV2Tab', setup: setupFor('periods') },
      'finance-amendments-v2':   { tab: 'financeCloseV2Tab', setup: setupFor('amendments') }
    }
  });
})();
