/**
 * finance-reports-v2.js — Reports hub, V2 (Finance Wave 4 launcher, rebuilt
 * native in the classic burn-down 2026-06-10 — docs/ux-audit/
 * classic-dependency-burndown.md, finance 6/6).
 *
 * All six generators now run HERE, against state-free FinanceBridge cores
 * extracted from the legacy setupReportsTab handlers — no classic links:
 *   · Loan / Investor report  — bridge.loanReportData + loanReportHtml (printable)
 *   · Year-end tax package    — bridge.yearEndData + yearEndHtml + yearEndCsv ×3
 *   · AR aging snapshot CSV   — bridge.arAgingSnapshot(asOf)
 *   · AP aging snapshot CSV   — bridge.apAgingSnapshot(asOf)
 *   · Customer statement      — bridge.statementCustomers/statementRows (+
 *                               share link via bridge.mintStatementLink CF)
 *   · 1099 vendor prep        — bridge.contractorVendors/vendor1099Rows
 *
 * Date windows are explicit per generator (date inputs, sensible defaults)
 * instead of the legacy page-global _finPeriod selector.
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

  var U = window.MastUI, esc = U._esc || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  function bridge() { return window.FinanceBridge; }
  function withFinance(fn) {
    return MastAdmin.loadModule('finance').then(fn);
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function yearStart() { return new Date().getFullYear() + '-01-01'; }

  var INPUT = 'background:transparent;border:1px solid var(--border);border-radius:6px;color:var(--text-primary);padding:5px 8px;font-size:0.85rem;';

  // Lazily-loaded picker data + generated-document cache.
  var V2 = { customers: null, contractors: null, yearEnd: null, year: new Date().getFullYear(), statementLink: null };

  function ensureTab() {
    var el = document.getElementById('financeReportsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'financeReportsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function dateField(id, label, value) {
    return '<label style="font-size:0.72rem;color:var(--warm-gray);display:inline-flex;align-items:center;gap:6px;">' + label +
      ' <input type="date" id="' + id + '" value="' + value + '" style="' + INPUT + '"></label>';
  }

  function render() {
    var tab = ensureTab();
    var nowYear = new Date().getFullYear();
    var yearOpts = '';
    for (var y = nowYear; y >= nowYear - 3; y--) yearOpts += '<option value="' + y + '"' + (y === V2.year ? ' selected' : '') + '>' + y + '</option>';

    var loanCard = U.card('Loan / Investor report',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Trailing-12-month financial summary formatted for a bank or investor. Print or save as PDF.</div>' +
      '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinReportsV2.loan()">Generate</button>', { fill: true });

    var yearEndCard = U.card('Year-end tax package',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Everything your CPA needs for Schedule C and state filings — P&L, sales tax, 1099s, mileage, checklist. Export CSVs or print the package.</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      '<select id="frV2Year" onchange="FinReportsV2.setYear(this.value)" style="' + INPUT + '">' + yearOpts + '</select>' +
      '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinReportsV2.yearEnd()">Generate</button>' +
      '</div>', { fill: true });

    var arCard = U.card('AR aging snapshot',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Open invoices by aging bucket as of a date. The live queue is Open Items → Invoices.</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      dateField('frV2ArAsOf', 'As of', today()) +
      '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinReportsV2.arAging()">Export CSV</button>' +
      '</div>', { fill: true });

    var apCard = U.card('AP aging snapshot',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Open bills by vendor and aging bucket as of a date. The live queue is Open Items → Bills.</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      dateField('frV2ApAsOf', 'As of', today()) +
      '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinReportsV2.apAging()">Export CSV</button>' +
      '</div>', { fill: true });

    var custOpts = '<option value="">— Choose customer —</option>';
    (V2.customers || []).forEach(function (c) {
      custOpts += '<option value="' + esc(c._id) + '">' + esc((c.displayName || '(no name)') + (c.primaryEmail ? ' · ' + c.primaryEmail : '')) + '</option>';
    });
    var stmtCard = U.card('Customer statement',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Per-customer activity statement (running balance) for a window, plus a 30-day share link.</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      (V2.customers
        ? '<select id="frV2StmtCustomer" style="' + INPUT + 'max-width:240px;">' + custOpts + '</select>'
        : '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.loadCustomers()">Choose customer…</button>') +
      dateField('frV2StmtStart', 'From', yearStart()) +
      dateField('frV2StmtEnd', 'To', today()) +
      '</div>' +
      (V2.customers
        ? '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px;">' +
          '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinReportsV2.statementCsv()">Export CSV</button>' +
          '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.statementLink()">Mint share link</button>' +
          '</div>'
        : '') +
      (V2.statementLink
        ? '<div style="margin-top:10px;font-size:0.78rem;word-break:break-all;">Share link (valid 30 days, copied to clipboard): <a href="' + esc(V2.statementLink) + '" target="_blank" rel="noopener" style="color:var(--teal);">' + esc(V2.statementLink) + '</a></div>'
        : ''), { fill: true });

    var venOpts = '<option value="__all__">— All contractors —</option>';
    (V2.contractors || []).forEach(function (v) {
      venOpts += '<option value="' + esc(v._id) + '">' + esc((v.name || '(no name)') + (v.taxId ? ' (TIN on file)' : ' (TIN MISSING)')) + '</option>';
    });
    var t1099Card = U.card('1099 vendor prep',
      '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">Contractor payments over the reporting window (legal threshold is the calendar year). Calendar-year prep also lives on Statements → Tax.</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
      (V2.contractors
        ? '<select id="frV2VendorPick" style="' + INPUT + 'max-width:220px;">' + venOpts + '</select>'
        : '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.loadContractors()">Choose contractor…</button>') +
      dateField('frV2V99Start', 'From', yearStart()) +
      dateField('frV2V99End', 'To', today()) +
      (V2.contractors ? '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinReportsV2.vendor1099()">Export CSV</button>' : '') +
      '</div>', { fill: true });

    tab.innerHTML =
      U.pageHeader({
        title: 'Reports',
        count: 'Exports & packages — six generators, all native'
      }) +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px;">' +
      loanCard + yearEndCard + arCard + apCard + stmtCard + t1099Card +
      '</div>' +
      '<div id="frV2Doc" style="margin-top:18px;max-width:980px;"></div>';
  }

  function doc() { return document.getElementById('frV2Doc'); }
  function val(id, fallback) { var n = document.getElementById(id); return (n && n.value) || fallback; }
  function fail(e) {
    console.error('[finance-reports-v2]', e);
    showToast('Report failed: ' + ((e && e.message) || e), true);
  }

  window.FinReportsV2 = {
    setYear: function (y) { V2.year = parseInt(y, 10); },

    loan: function () {
      var el = doc();
      if (el) el.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:12px 0;">Building loan / investor report…</div>';
      withFinance(function () { return bridge().loanReportData(); }).then(function (d) {
        var el2 = doc(); if (!el2) return;
        // Reuses the legacy printable renderer (state-free: takes the data).
        // Its Print/Copy buttons call window fns that finance.js still owns.
        el2.innerHTML = U.card('Loan / Investor report', bridge().loanReportHtml(d), { fill: true });
        el2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(fail);
    },

    yearEnd: function () {
      var el = doc();
      if (el) el.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:12px 0;">Building ' + V2.year + ' tax package…</div>';
      withFinance(function () { return bridge().yearEndData(V2.year); }).then(function (d) {
        V2.yearEnd = d;
        var el2 = doc(); if (!el2) return;
        var actions = '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' +
          '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.yearEndCsv(\'pnl\')">P&L.csv</button>' +
          '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.yearEndCsv(\'tax\')">SalesTax.csv</button>' +
          (d.contractors.length ? '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="FinReportsV2.yearEndCsv(\'1099\')">1099s.csv</button>' : '') +
          '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="FinReportsV2.printYearEnd()">🖨 Print package</button>' +
          '</div>';
        // yearEndHtml includes its own (duplicate) export strip wired to the
        // classic window fns — those still work because we mirror the data
        // into window._yearEndData below; the strip above is the V2-native path.
        window._yearEndData = d;
        el2.innerHTML = U.card('Year-end tax package · ' + d.year, actions + bridge().yearEndHtml(d), { fill: true });
        el2.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(fail);
    },
    yearEndCsv: function (kind) {
      if (!V2.yearEnd) { showToast('Generate the package first', true); return; }
      withFinance(function () { bridge().yearEndCsv(kind, V2.yearEnd); }).catch(fail);
    },
    printYearEnd: function () {
      withFinance(function () { bridge().printElement('fYearEndPrintable'); }).catch(fail);
    },

    arAging: function () {
      var asOf = val('frV2ArAsOf', today());
      withFinance(function () { return bridge().arAgingSnapshot(asOf); }).then(function (rows) {
        if (rows.length === 1) { showToast('No open invoices as of ' + asOf, true); return; }
        bridge().downloadCsv('ar-aging-snapshot', rows, 'AR Aging as of ' + asOf + ' · Basis: orders.invoiceDueDate (invoiceStatus IN sent,overdue)');
        showToast('AR aging snapshot exported');
      }).catch(fail);
    },
    apAging: function () {
      var asOf = val('frV2ApAsOf', today());
      withFinance(function () { return bridge().apAgingSnapshot(asOf); }).then(function (rows) {
        if (rows.length === 1) { showToast('No open bills as of ' + asOf, true); return; }
        bridge().downloadCsv('ap-aging-snapshot', rows, 'AP Aging as of ' + asOf + ' · Basis: admin/purchaseReceipts.dueDate (paymentStatus IN unpaid,partial)');
        showToast('AP aging snapshot exported');
      }).catch(fail);
    },

    loadCustomers: function () {
      withFinance(function () { return bridge().statementCustomers(); }).then(function (list) {
        V2.customers = list;
        if (!list.length) showToast('No customers found', true);
        render();
      }).catch(fail);
    },
    statementCsv: function () {
      var id = val('frV2StmtCustomer', '');
      if (!id) { showToast('Pick a customer first', true); return; }
      var start = val('frV2StmtStart', yearStart()), end = val('frV2StmtEnd', today());
      withFinance(function () { return bridge().statementRows(id, start, end); }).then(function (st) {
        var fname = 'statement-' + (st.customer.displayName || id).replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
        bridge().downloadCsv(fname, st.rows, 'Statement for ' + (st.customer.displayName || id) + ' · ' + start + ' to ' + end);
        showToast('Statement exported (' + st.orderCount + ' order' + (st.orderCount === 1 ? '' : 's') + ')');
      }).catch(fail);
    },
    statementLink: function () {
      var id = val('frV2StmtCustomer', '');
      if (!id) { showToast('Pick a customer first', true); return; }
      withFinance(function () { return bridge().mintStatementLink(id, 30); }).then(function (url) {
        V2.statementLink = url;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).catch(function () {});
        render();
        var sel = document.getElementById('frV2StmtCustomer');
        if (sel) sel.value = id;
        showToast('Share link minted (copied to clipboard)');
      }).catch(fail);
    },

    loadContractors: function () {
      withFinance(function () { return bridge().contractorVendors(); }).then(function (list) {
        V2.contractors = list;
        if (!list.length) showToast('No contractor vendors found — mark a vendor as type contractor first', true);
        render();
      }).catch(fail);
    },
    vendor1099: function () {
      var pick = val('frV2VendorPick', '__all__');
      var start = val('frV2V99Start', yearStart()), end = val('frV2V99End', today());
      withFinance(function () { return bridge().vendor1099Rows(pick, start, end); }).then(function (rows) {
        if (rows.length === 1) { showToast('No paid receipts in window for this contractor', true); return; }
        bridge().downloadCsv('vendor-1099-prep', rows, '1099 Prep · ' + start + ' to ' + end + ' (window-scoped; legal threshold is calendar year)');
        showToast('1099-prep export downloaded');
      }).catch(fail);
    }
  };

  MastAdmin.registerModule('finance-reports-v2', {
    routes: {
      'finance-reports-v2': { tab: 'financeReportsV2Tab', setup: function () { render(); } }
    }
  });
})();
