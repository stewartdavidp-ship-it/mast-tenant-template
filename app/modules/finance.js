// ============================================================
// FINANCE MODULE (lazy-loaded)
// Registers routes for all 8 Finance tabs. Tab content is
// static HTML rendered in index.html — no setup needed yet.
// Revenue and Expenses will wire to financials.js/expenses.js
// content in a future session.
// ============================================================
(function() {
'use strict';

MastAdmin.registerModule('finance', {
  routes: {
    'finance-revenue':    { tab: 'financeRevenueTab',    setup: function() {} },
    'finance-expenses':   { tab: 'financeExpensesTab',   setup: function() {} },
    'finance-pl':         { tab: 'financePlTab',         setup: function() {} },
    'finance-cash-flow':  { tab: 'financeCashFlowTab',   setup: function() {} },
    'finance-ar':         { tab: 'financeArTab',         setup: function() {} },
    'finance-ap':         { tab: 'financeApTab',         setup: function() {} },
    'finance-tax':        { tab: 'financeTaxTab',        setup: function() {} },
    'finance-reports':    { tab: 'financeReportsTab',    setup: function() {} }
  }
});

})();
