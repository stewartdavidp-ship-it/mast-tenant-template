/**
 * finance-reports-v2.js — Reports launcher, V2 (Finance Wave 4,
 * docs/ux-audit/finance-v2-build-plan.md). The V1 Reports tab is six export
 * generators (loan/investor report, year-end tax package, AR/AP aging
 * snapshots, customer statement, 1099 prep) whose builders are wired deep
 * into the legacy view's DOM + period pickers. This V2 page is the launcher:
 * it describes each report and opens the classic generator (single-sourced —
 * blog-v2 precedent); the aging CSVs export natively via the open-items hub.
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

  var U = window.MastUI;

  var REPORTS = [
    { t: 'Loan / Investor report', d: '12-month P&L summary for a lender or investor conversation.', kind: 'classic' },
    { t: 'Year-end tax package', d: 'CSV bundle for your CPA — Schedule C prep for a chosen year.', kind: 'classic' },
    { t: 'AR aging snapshot', d: 'Open invoices by aging bucket. Also exports live from Open Items → Receivables.', kind: 'ar' },
    { t: 'AP aging snapshot', d: 'Open bills by vendor and aging bucket. Also exports live from Open Items → Payables.', kind: 'ap' },
    { t: 'Customer statement', d: 'Per-customer activity statement with a share link.', kind: 'classic' },
    { t: '1099 vendor prep', d: 'Vendors paid over the reporting threshold in the window.', kind: 'classic' }
  ];

  function ensureTab() {
    var el = document.getElementById('financeReportsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'financeReportsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var cards = REPORTS.map(function (r, i) {
      var action = r.kind === 'classic'
        ? '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.classic()">Generate (classic) ↗</button>'
        : '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.openItems(\'' + r.kind + '\')">Open Items →</button>' +
          ' <button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.classic()">Snapshot (classic) ↗</button>';
      return U.card(r.t, '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' + r.d + '</div>' + action, { fill: true });
    }).join('');
    tab.innerHTML =
      U.pageHeader({
        title: 'Reports',
        count: 'Exports & packages — generators run on the classic page for now',
        actionsHtml: '<button class="btn btn-secondary" onclick="FinReportsV2.classic()">Open classic Reports ↗</button>'
      }) +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;margin-top:14px;">' + cards + '</div>';
  }

  window.FinReportsV2 = {
    classic: function () { if (window.navigateToClassic) navigateToClassic('finance-reports'); },
    openItems: function (lens) { if (window.navigateTo) navigateTo(lens === 'ar' ? 'finance-ar' : 'finance-ap'); }
  };

  MastAdmin.registerModule('finance-reports-v2', {
    routes: {
      'finance-reports-v2': { tab: 'financeReportsV2Tab', setup: function () { render(); } }
    }
  });
})();
