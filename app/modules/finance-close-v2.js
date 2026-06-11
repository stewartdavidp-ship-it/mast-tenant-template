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
 * FinanceBridge cores (closePeriod / amendApprove / amendReject /
 * saveDayClose). The day-close drawer-count form is native here (classic
 * burn-down 2026-06-10): opening/closing cash, checks, notes, live variance,
 * version history, and the re-close diff confirm — all through the bridge.
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
  function canSubmitAmend() { return (typeof window.can === 'function') ? window.can('finance-amendments', 'edit') : true; }

  var V2 = { lens: 'periods', month: null, months: [], periods: {}, days: {}, amendments: [], openPeriod: null, busy: false,
    // Native day-close drawer-count form (null = lens shows the list).
    dayForm: null,
    // Native submit-amendment form (null = Amendments lens shows the queue).
    amendForm: false };

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
          '<button class="btn btn-primary" onclick="FinCloseV2.newDayClose()">+ New day close</button>' +
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

  // ── Native day-close drawer-count form ────────────────────────────────────
  // Replaces the classic finance-cash-flow?subView=dayclose escape hatch.
  // All persistence goes through the state-free FinanceBridge cores
  // (dayCloseVersions / saveDayClose / dayCloseDiffHtml / dayCloseDiffConfirm).

  var INPUT_CSS = 'background:var(--bg-primary);border:1px solid var(--border);border-radius:6px;color:var(--text-primary);padding:6px 8px;font-size:0.85rem;width:100%;box-sizing:border-box;font-family:inherit;';

  function checkRowHtml(c, i) {
    c = c || {};
    var amt = (c.amountCents != null) ? (c.amountCents / 100).toFixed(2) : (c.amount != null ? c.amount : '');
    function inp(cls, ph, val, type) {
      return '<input type="' + (type || 'text') + '"' + (type === 'number' ? ' step="0.01"' : '') + ' class="' + cls + '" placeholder="' + ph + '" value="' + esc(val == null ? '' : String(val)) + '" style="' + INPUT_CSS + '"' + (cls === 'fcv2-ck-amount' ? ' oninput="FinCloseV2.dayVariance()"' : '') + '>';
    }
    return '<div class="fcv2-check-row" style="display:grid;grid-template-columns:90px 110px 1fr 1fr 90px 32px;gap:8px;align-items:center;margin-bottom:6px;">' +
      inp('fcv2-ck-number', 'Check #', c.number) +
      inp('fcv2-ck-amount', 'Amount', amt, 'number') +
      inp('fcv2-ck-payer', 'Payer name', c.payerName != null ? c.payerName : c.payor) +
      inp('fcv2-ck-memo', 'Memo', c.memo) +
      inp('fcv2-ck-invoice', 'Invoice #', c.invoiceRef) +
      '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;padding:3px 8px;" title="Remove check" onclick="FinCloseV2.removeCheck(this)">✕</button>' +
      '</div>';
  }

  function dayFormViewSource(f) {
    if (f.viewVersionId) {
      var v = (f.versions || []).filter(function (x) { return x.id === f.viewVersionId; })[0];
      if (v) return v;
    }
    return f.latest || f.legacy || null;
  }

  function renderDayForm() {
    var el = body(); if (!el) return;
    var f = V2.dayForm;
    var pc = V2.periods[(f.date || '').slice(0, 7)];
    var viewingOld = !!(f.viewVersionId && f.latest && f.viewVersionId !== f.latest.id);
    var readOnly = !!pc || viewingOld || !canClose();
    var src = dayFormViewSource(f) || {};
    var checks = Array.isArray(src.checks) ? src.checks : [];

    var h = '<div style="max-width:860px;">';
    h += '<a href="javascript:void(0)" onclick="FinCloseV2.closeDayForm()" style="color:var(--teal);font-size:0.85rem;text-decoration:none;">&larr; Back to day closes</a>';

    // Context line: version history + lock state.
    var ctx = '';
    if (f.versions && f.versions.length) {
      ctx += (f.versions.map(function (v) {
        var on = f.viewVersionId ? (v.id === f.viewVersionId) : (f.latest && v.id === f.latest.id);
        return '<button type="button" onclick="FinCloseV2.viewVersion(\'' + esc(v.id) + '\')" style="border:1px solid var(--border);border-radius:999px;padding:2px 10px;font-size:0.72rem;cursor:pointer;margin-right:6px;' +
          'background:' + (on ? 'color-mix(in srgb,var(--teal) 16%,transparent)' : 'transparent') + ';color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';">v' + esc(String(v.version || '?')) + (v.superseded ? ' (superseded)' : '') + '</button>';
      }).join(''));
      if (viewingOld) ctx += '<button type="button" onclick="FinCloseV2.viewVersion(null)" style="border:none;background:transparent;color:var(--teal);font-size:0.72rem;cursor:pointer;">Return to latest</button>';
    } else if (f.legacy && (f.legacy.openingCashCents != null || f.legacy.closingCashCents != null)) {
      ctx += '<span style="font-size:0.72rem;color:var(--warm-gray);">Legacy (pre-v3) close found — saving migrates it to v1.</span>';
    }
    if (pc) ctx += ' <span style="font-size:0.72rem;color:var(--amber);">' + statusBadge(pc) + ' Period closed — read-only; corrections go through Amendments.</span>';
    else if (viewingOld) ctx += ' <span style="font-size:0.72rem;color:var(--warm-gray);">Viewing a superseded version (read-only).</span>';

    var dis = readOnly ? ' disabled style="opacity:0.6;' + INPUT_CSS + '"' : ' style="' + INPUT_CSS + '"';
    h += U.card('Day close — drawer count',
      '<div style="margin-bottom:10px;">' + ctx + '</div>' +
      '<div style="display:grid;grid-template-columns:160px 160px 160px 1fr;gap:10px 12px;align-items:end;margin-bottom:12px;">' +
      '<div><label style="font-size:0.72rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Date</label>' +
      '<input type="date" id="fcv2DcDate" value="' + esc(f.date) + '" onchange="FinCloseV2.dayFormSetDate(this.value)" style="' + INPUT_CSS + '"></div>' +
      '<div><label style="font-size:0.72rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Opening cash ($)</label>' +
      '<input type="number" step="0.01" id="fcv2DcOpen" value="' + (src.openingCashCents != null ? (src.openingCashCents / 100).toFixed(2) : '') + '" oninput="FinCloseV2.dayVariance()"' + dis + '></div>' +
      '<div><label style="font-size:0.72rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Closing cash ($)</label>' +
      '<input type="number" step="0.01" id="fcv2DcClose" value="' + (src.closingCashCents != null ? (src.closingCashCents / 100).toFixed(2) : '') + '" oninput="FinCloseV2.dayVariance()"' + dis + '></div>' +
      '<div id="fcv2DcVariance" style="font-size:0.78rem;color:var(--warm-gray);padding-bottom:8px;">Variance: $0.00 (closing − opening − checks)</div>' +
      '</div>' +
      '<div style="font-size:0.85rem;font-weight:600;margin:14px 0 8px;">Checks received <span id="fcv2DcCheckTotal" style="font-weight:400;color:var(--warm-gray);font-size:0.78rem;"></span></div>' +
      (readOnly
        ? (checks.length
            ? '<div>' + checks.map(function (c, i) { return checkRowHtml(c, i); }).join('') + '</div>'
            : '<div style="color:var(--warm-gray);font-size:0.78rem;margin-bottom:6px;">No checks recorded.</div>')
        : U.repeatRows({ id: 'fcv2DcChecks', rows: checks, template: checkRowHtml, addLabel: '+ Add check', spares: checks.length ? 0 : 1 })) +
      '<div style="margin-top:14px;"><label style="font-size:0.72rem;color:var(--warm-gray);display:block;margin-bottom:4px;">Notes</label>' +
      '<textarea id="fcv2DcNotes" rows="2"' + dis + '>' + esc(src.notes || '') + '</textarea></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px;">' +
      (readOnly
        ? (canClose() ? '' : '<span style="font-size:0.78rem;color:var(--warm-gray);">Finance write access required to close a day.</span>')
        : '<button class="btn btn-primary" ' + (V2.busy ? 'disabled ' : '') + 'onclick="FinCloseV2.saveDayForm()">' + esc(dayFormCtaLabel(f)) + '</button>') +
      '</div>');
    h += '</div>';
    el.innerHTML = h;
    if (readOnly) {
      el.querySelectorAll('.fcv2-check-row input, .fcv2-check-row button').forEach(function (n) {
        if (n.tagName === 'BUTTON') { n.style.display = 'none'; return; }
        n.setAttribute('disabled', 'disabled'); n.style.opacity = '0.6';
      });
      // Stored values, not live recompute — the saved varianceCents is canonical.
      var vEl = document.getElementById('fcv2DcVariance');
      if (vEl && src.varianceCents != null) vEl.textContent = 'Variance: ' + (src.varianceCents >= 0 ? '+' : '−') + m(Math.abs(src.varianceCents)) + ' (closing − opening − checks)';
      var totEl = document.getElementById('fcv2DcCheckTotal');
      if (totEl && checks.length) totEl.textContent = '· total ' + m(src.checkTotalCents || checks.reduce(function (s, c) { return s + (c.amountCents || 0); }, 0));
    } else {
      dayVariance();
    }
  }

  function dayFormCtaLabel(f) {
    if (!f.latest && f.legacy && (f.legacy.openingCashCents != null || f.legacy.closingCashCents != null)) return 'Migrate to v1';
    if (!f.latest) return 'Close as v1';
    return 'Re-close (creates v' + ((f.latest.version || 1) + 1) + ')';
  }

  function gatherChecks() {
    var rows = document.querySelectorAll('#fcv2DcChecks .fcv2-check-row');
    var out = [];
    rows.forEach(function (row) {
      function val(cls) { var n = row.querySelector('.' + cls); return n ? (n.value || '').trim() : ''; }
      var amt = parseFloat(val('fcv2-ck-amount'));
      if (isNaN(amt) || !amt) return;
      out.push({
        number: val('fcv2-ck-number'),
        payerName: val('fcv2-ck-payer'),
        amountCents: Math.round(amt * 100),
        memo: val('fcv2-ck-memo'),
        invoiceRef: val('fcv2-ck-invoice')
      });
    });
    return out;
  }

  // Mirrors the classic _dcGatherPayload computation (variance = closing −
  // opening − checks, CPA convention) against THIS form's inputs.
  function gatherDayForm() {
    var date = (document.getElementById('fcv2DcDate') || {}).value || (V2.dayForm && V2.dayForm.date);
    var openVal = parseFloat((document.getElementById('fcv2DcOpen') || {}).value);
    var closeVal = parseFloat((document.getElementById('fcv2DcClose') || {}).value);
    var notes = ((document.getElementById('fcv2DcNotes') || {}).value || '').trim();
    var checks = gatherChecks();
    var checkTotalCents = checks.reduce(function (s, c) { return s + c.amountCents; }, 0);
    var variance = (isNaN(openVal) || isNaN(closeVal)) ? null : Math.round((closeVal - openVal) * 100) - checkTotalCents;
    return {
      date: date,
      openingCashCents: isNaN(openVal) ? null : Math.round(openVal * 100),
      closingCashCents: isNaN(closeVal) ? null : Math.round(closeVal * 100),
      varianceCents: variance,
      checks: checks,
      checkTotalCents: checkTotalCents,
      notes: notes || null
    };
  }

  function dayVariance() {
    var vEl = document.getElementById('fcv2DcVariance');
    if (!vEl) return;
    var open = parseFloat((document.getElementById('fcv2DcOpen') || {}).value);
    var close = parseFloat((document.getElementById('fcv2DcClose') || {}).value);
    var checks = gatherChecks();
    var checkTotal = checks.reduce(function (s, c) { return s + c.amountCents; }, 0);
    var totEl = document.getElementById('fcv2DcCheckTotal');
    if (totEl) totEl.textContent = checks.length ? '· total ' + m(checkTotal) : '';
    if (isNaN(open) || isNaN(close)) { vEl.textContent = 'Variance: $0.00 (closing − opening − checks)'; vEl.style.color = 'var(--warm-gray)'; return; }
    var diff = Math.round((close - open) * 100) - checkTotal;
    vEl.textContent = 'Variance: ' + (diff >= 0 ? '+' : '−') + m(Math.abs(diff)) + ' (closing − opening − checks)';
    vEl.style.color = diff === 0 ? 'var(--warm-gray)' : (Math.abs(diff) < 500 ? 'var(--teal)' : 'var(--amber)');
  }

  function openDayForm(date) {
    V2.lens = 'days';
    V2.dayForm = { date: date, versions: [], latest: null, legacy: null, viewVersionId: null, loading: true };
    render();
    var el = body();
    if (el) el.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:20px 0;">Loading ' + esc(date) + '…</div>';
    bridge().dayCloseVersions(date).then(function (r) {
      if (!V2.dayForm || V2.dayForm.date !== date) return;
      V2.dayForm.versions = r.versions || [];
      V2.dayForm.latest = r.latest || null;
      V2.dayForm.legacy = r.legacy || null;
      V2.dayForm.loading = false;
      renderDayForm();
    }).catch(function (e) {
      console.error('[finance-close-v2] day form load', e);
      var b = body(); if (b) b.innerHTML = '<div style="color:var(--danger);padding:12px;">' + esc(e.message || String(e)) + '</div>';
    });
  }

  function renderDays() {
    var el = body(); if (!el) return;
    if (V2.dayForm) { renderDayForm(); return; }
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
          return '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 9px;" onclick="FinCloseV2.openDay(\'' + esc(r.date) + '\')">' + (locked ? 'View' : 'Open') + '</button>';
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

  // Native submit-amendment form (classic burn-down 2026-06-10): replaces the
  // legacy window.finAmendmentOpenSubmit modal. Validation mirrors the classic
  // form (and the routeAmendment CF re-validates server-side); the write goes
  // through the state-free FinanceBridge.submitAmendment core.
  var AMEND_TARGETS = [['orders', 'Order'], ['refunds', 'Refund'], ['expenses', 'Expense'], ['vendorBills', 'Vendor bill']];

  function renderAmendForm() {
    var el = body(); if (!el) return;
    var opts = AMEND_TARGETS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + ' (' + t[0] + ')</option>'; }).join('');
    var h = '<div style="max-width:720px;">';
    h += '<a href="javascript:void(0)" onclick="FinCloseV2.amendCancel()" style="color:var(--teal);font-size:0.85rem;text-decoration:none;">&larr; Back to amendments</a>';
    h += U.card('Submit amendment',
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:14px;">Closed-period records cannot be edited directly. Submitting an amendment routes a proposed change to the approval queue; approval writes a dated counter-entry in the next open period.</div>' +
      '<div style="display:grid;grid-template-columns:150px 1fr;gap:10px 12px;align-items:center;margin-bottom:12px;">' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);">Target collection</label>' +
      '<select id="fcv2AmCol" style="' + INPUT_CSS + '">' + opts + '</select>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);">Target doc ID</label>' +
      '<input id="fcv2AmId" type="text" placeholder="Firestore document id" style="' + INPUT_CSS + '">' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);align-self:start;padding-top:6px;">Reason (&ge; 10 chars)</label>' +
      '<textarea id="fcv2AmReason" rows="2" placeholder="Why this change?" style="' + INPUT_CSS + '"></textarea>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);align-self:start;padding-top:6px;">Proposed shape (JSON)</label>' +
      '<textarea id="fcv2AmAfter" rows="6" placeholder=\'{"amountCents": 12345, "memo": "corrected"}\' style="' + INPUT_CSS + 'font-family:ui-monospace,Menlo,Monaco,Consolas,monospace;font-size:0.78rem;"></textarea>' +
      '</div>' +
      '<div id="fcv2AmErr" style="font-size:0.78rem;color:var(--danger);margin-bottom:10px;min-height:14px;"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;">' +
      '<button class="btn btn-secondary" onclick="FinCloseV2.amendCancel()">Cancel</button>' +
      '<button class="btn btn-primary" ' + (V2.busy ? 'disabled ' : '') + 'onclick="FinCloseV2.amendSubmit()">Submit</button>' +
      '</div>');
    h += '</div>';
    el.innerHTML = h;
  }

  function renderAmendmentsLens() {
    var el = body(); if (!el) return;
    if (V2.amendForm) { renderAmendForm(); return; }
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
    setLens: function (l) { V2.lens = l; V2.dayForm = null; V2.amendForm = false; render(); },
    setMonth: function (mo) { V2.month = mo; V2.dayForm = null; render(); },
    refresh: refresh,
    openMonth: function (mo) { V2.month = mo; V2.lens = 'days'; V2.dayForm = null; render(); },
    openDay: openDayForm,
    newDayClose: function () { openDayForm(new Date().toISOString().slice(0, 10)); },
    closeDayForm: function () { V2.dayForm = null; refresh(); },
    dayFormSetDate: function (date) { if (date) openDayForm(date); },
    dayVariance: dayVariance,
    removeCheck: function (btn) {
      var row = btn && btn.closest('.fcv2-check-row');
      if (row) row.parentNode.removeChild(row);
      dayVariance();
    },
    viewVersion: function (vid) {
      if (!V2.dayForm) return;
      V2.dayForm.viewVersionId = vid || null;
      renderDayForm();
    },
    saveDayForm: function () {
      if (!canClose()) { showToast('Finance write access required.', true); return; }
      var f = V2.dayForm; if (!f) return;
      var payload = gatherDayForm();
      if (!payload.date) { showToast('Pick a date first.', true); return; }
      if (payload.openingCashCents == null || payload.closingCashCents == null) {
        showToast('Opening and closing cash are both required.', true); return;
      }
      var isReclose = !!f.latest;
      var go = isReclose
        ? bridge().dayCloseDiffConfirm(payload.date, (f.latest.version || 1) + 1, bridge().dayCloseDiffHtml(f.latest, payload))
        : Promise.resolve(true);
      go.then(function (ok) {
        if (!ok) return;
        V2.busy = true; renderDayForm();
        return bridge().saveDayClose(payload, isReclose).then(function (json) {
          V2.busy = false;
          showToast('Day close v' + ((json && json.version) || '?') + ' saved for ' + payload.date);
          V2.dayForm = null;
          refresh();
        });
      }).catch(function (err) {
        V2.busy = false; renderDayForm();
        var msg = (err && err.message) || (err && err.code) || String(err) || 'unknown error';
        if (err && err.details && err.details.code) msg += ' (' + err.details.code + ')';
        showToast('Save failed: ' + msg, true);
      });
    },
    submitAmendment: function () {
      if (!canSubmitAmend()) { showToast('Finance write access required.', true); return; }
      V2.lens = 'amendments'; V2.amendForm = true; V2.dayForm = null;
      render();
    },
    amendCancel: function () { V2.amendForm = false; render(); },
    amendSubmit: function () {
      var errEl = document.getElementById('fcv2AmErr');
      if (errEl) errEl.textContent = '';
      function fail(msg) { if (errEl) errEl.textContent = msg; }
      var col = (document.getElementById('fcv2AmCol') || {}).value;
      var id = ((document.getElementById('fcv2AmId') || {}).value || '').trim();
      var reason = ((document.getElementById('fcv2AmReason') || {}).value || '').trim();
      var afterStr = ((document.getElementById('fcv2AmAfter') || {}).value || '').trim();
      if (!id) { fail('Target doc ID required.'); return; }
      if (reason.length < 10) { fail('Reason must be at least 10 characters.'); return; }
      var afterObj;
      try { afterObj = JSON.parse(afterStr); }
      catch (perr) { fail('Proposed shape is not valid JSON: ' + perr.message); return; }
      if (!afterObj || typeof afterObj !== 'object' || Array.isArray(afterObj)) { fail('Proposed shape must be a JSON object.'); return; }
      V2.busy = true; renderAmendForm();
      bridge().submitAmendment({ targetCollection: col, targetId: id, after: afterObj, reason: reason }).then(function (json) {
        V2.busy = false; V2.amendForm = false;
        showToast('Amendment submitted for period ' + json.periodId);
        refresh();
      }).catch(function (err) {
        V2.busy = false;
        var msg = (err && err.message) || (err && err.code) || String(err) || 'unknown error';
        if (err && err.details && err.details.code) msg += ' (' + err.details.code + ')';
        renderAmendForm();
        var e2 = document.getElementById('fcv2AmErr');
        if (e2) e2.textContent = 'Submit failed: ' + msg;
        showToast('Amendment submit failed: ' + msg, true);
      });
    },

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
        bridge().amendApprove(id, periodId).then(function (json) {
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
        bridge().amendReject(id, reason, periodId).then(function () {
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
