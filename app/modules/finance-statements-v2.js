/**
 * finance-statements-v2.js — ONE read-only statements hub (Finance Wave 1,
 * docs/ux-audit/finance-v2-build-plan.md — consolidation hub 1 of 3).
 *
 * Overview / Revenue / P&L / Cash / Tax were five sidebar routes over the
 * same period-anchored aggregates in finance.js. This module serves ALL FIVE
 * routes (#financials-v2, #finance-revenue-v2, #finance-pl-v2,
 * #finance-cash-flow-v2, #finance-tax-v2) with one page; the route you arrive
 * by only picks the entry lens (fulfillment-v2 precedent). All money math
 * stays in finance.js, exposed via the state-free window.FinanceBridge —
 * this module renders, it never re-implements finance arithmetic.
 *
 * Read-only by design (statements are reports). Writes live elsewhere:
 * expenses → finance-expenses-v2, AR/AP actions → open-items hub (Wave 2),
 * day/period close → close hub (Wave 3). Nexus registration editing and the
 * 1099 sections stay on the classic Tax page (debt register).
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
  function m(cents) { return N.money(cents, { cents: true }); }
  function canView(route) { return (typeof window.can === 'function') ? window.can(route, 'view') : true; }

  var LENSES = [
    { key: 'overview', label: 'Overview', route: 'financials' },
    { key: 'revenue',  label: 'Revenue',  route: 'finance-revenue' },
    { key: 'pl',       label: 'Profit & Loss', route: 'finance-pl' },
    { key: 'cash',     label: 'Cash',     route: 'finance-cash-flow' },
    { key: 'tax',      label: 'Tax',      route: 'finance-tax' }
  ];
  var MODES = [['mtd', 'MTD'], ['qtd', 'QTD'], ['fy', 'FYTD']];

  var V2 = { lens: 'overview', horizon: 30, busy: false, csv: null };

  function bridge() { return window.FinanceBridge; }
  function period() { return bridge().resolvePeriod(); }

  function visibleLenses() {
    return LENSES.filter(function (l) { return canView(l.route); });
  }

  function ensureTab() {
    var el = document.getElementById('financeStatementsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'financeStatementsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function shell() {
    var tab = ensureTab();
    var p = period();
    var lensPills = visibleLenses().map(function (l) {
      var on = V2.lens === l.key;
      return '<button onclick="FinStatementsV2.setLens(\'' + l.key + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--teal) 16%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + l.label + '</button>';
    }).join('');
    var modePills = MODES.map(function (md) {
      var on = p.mode === md[0];
      return '<button onclick="FinStatementsV2.setMode(\'' + md[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 16%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:4px 11px;font-size:0.78rem;cursor:pointer;margin-right:6px;">' + md[1] + '</button>';
    }).join('');
    var custom = '<input type="date" id="finStV2Start" value="' + esc(p.start) + '" style="font-size:0.78rem;padding:3px 6px;background:transparent;color:var(--text-primary);border:1px solid var(--border);border-radius:6px;">' +
      ' <span style="color:var(--warm-gray);font-size:0.78rem;">→</span> ' +
      '<input type="date" id="finStV2End" value="' + esc(p.end) + '" style="font-size:0.78rem;padding:3px 6px;background:transparent;color:var(--text-primary);border:1px solid var(--border);border-radius:6px;">' +
      ' <button class="btn btn-secondary" style="font-size:0.78rem;padding:3px 10px;" onclick="FinStatementsV2.applyCustom()">Apply</button>';

    tab.innerHTML =
      U.pageHeader({
        title: 'Statements',
        count: bridge().periodLabel(p),
        actionsHtml: '<button class="btn btn-secondary" onclick="FinStatementsV2.exportCsv()">↓ Export lens</button>'
      }) +
      '<div style="margin:14px 0 6px;">' + lensPills + '</div>' +
      '<div style="margin:0 0 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
      '<span>' + modePills + '</span><span>' + custom + '</span></div>' +
      '<div id="finStV2Body"><div style="color:var(--warm-gray);font-size:0.85rem;padding:20px 0;">Loading…</div></div>';
  }

  function body() { return document.getElementById('finStV2Body'); }
  function fail(err) {
    console.error('[finance-statements-v2]', err);
    var el = body();
    if (el) el.innerHTML = '<div style="color:var(--danger);padding:12px;">' + esc((err && err.message) || String(err)) + '</div>';
  }

  function table(cols, rows) { return U.relatedTable ? U.relatedTable(cols, rows) : ''; }
  function channelTable(byChannel, totalCents) {
    var keys = Object.keys(byChannel || {}).sort(function (a, b) { return byChannel[b] - byChannel[a]; });
    return table([
      { label: 'Channel', render: function (r) { return esc(r); } },
      { label: 'Revenue', align: 'right', render: function (r) { return m(byChannel[r]); } },
      { label: 'Share', align: 'right', render: function (r) { return totalCents > 0 ? (byChannel[r] / totalCents * 100).toFixed(1) + '%' : '—'; } }
    ], keys);
  }
  function deltaChip(curr, prev) {
    if (!prev) return '';
    var pct = prev !== 0 ? ((curr - prev) / Math.abs(prev) * 100) : null;
    if (pct == null || isNaN(pct)) return '';
    var up = pct >= 0;
    return '<span style="font-size:0.72rem;color:' + (up ? 'var(--teal)' : 'var(--danger)') + ';">' +
      (up ? '▲' : '▼') + ' ' + Math.abs(pct).toFixed(1) + '% vs prior</span>';
  }
  // R-FIN-2: never render a structurally-meaningless margin.
  function marginText(pnl) {
    if (!pnl || (pnl.revenue || 0) <= 0) return { v: '—', note: 'No revenue in period' };
    if ((pnl.cogsLineMissingCount || 0) > 0 || pnl.cogsMissing) return { v: '—', note: 'COGS incomplete on ' + pnl.cogsLineMissingCount + ' line(s)' };
    return { v: (pnl.grossProfit / pnl.revenue * 100).toFixed(1) + '%', note: null };
  }
  function applyBurden(p) {
    if (!p || !p._burden || !p._burden.acknowledged) return p;
    var lab = p._burden.effectiveLaborCogsCents || 0, oh = p._burden.fixedOverheadCents || 0;
    if (lab > 0) { p.cogs += lab; p.grossProfit = p.revenue - p.cogs; }
    if (oh > 0) {
      p.opex += oh;
      p.opexByCategory = p.opexByCategory || {};
      p.opexByCategory['Fixed Overhead (burdened labor)'] = (p.opexByCategory['Fixed Overhead (burdened labor)'] || 0) + oh;
    }
    if (lab > 0 || oh > 0) p.netProfit = p.grossProfit - p.opex;
    return p;
  }

  // ── Lens loaders ──────────────────────────────────────────────────────────
  function loadOverview() {
    var p = period(), prior = bridge().priorWindow(p.start, p.end);
    return Promise.all([
      bridge().loadRevenueAggregate(p.start, p.end).catch(function () { return null; }),
      prior ? bridge().loadRevenueAggregate(prior.start, prior.end).catch(function () { return null; }) : null,
      bridge().computePnl(p.start, p.end).catch(function () { return null; }),
      bridge().cashSnapshot(V2.horizon).catch(function () { return null; }),
      bridge().openItemsTotals().catch(function () { return null; })
    ]).then(function (r) {
      var agg = r[0], priorAgg = r[1], pnl = applyBurden(r[2]), cash = r[3], open = r[4];
      var mg = marginText(pnl);
      var el = body(); if (!el) return;
      el.innerHTML =
        U.tiles([
          { k: 'Revenue', v: m(agg ? agg.totalCents : 0) + ' ' + deltaChip(agg && agg.totalCents, priorAgg && priorAgg.totalCents), hero: true },
          { k: 'Gross margin', v: mg.v + (mg.note ? ' <span style="font-size:0.72rem;color:var(--warm-gray);">' + esc(mg.note) + '</span>' : '') },
          { k: 'Cash on hand', v: cash ? N.money(cash.bankTotal) : '—' },
          { k: 'AR outstanding', v: open ? m(open.arCents) : '—' },
          { k: 'AP owed', v: open ? m(open.apCents) : '—' }
        ]) +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px;">' +
        U.card('Revenue by channel', agg && Object.keys(agg.byChannel || {}).length ? channelTable(agg.byChannel, agg.totalCents) : '<div style="color:var(--warm-gray);font-size:0.85rem;">No revenue in the selected period.</div>', { fill: true }) +
        U.card('Where to act', '<ul style="margin:0;padding-left:18px;font-size:0.85rem;line-height:2;">' +
          '<li><a href="javascript:void(0)" onclick="navigateTo(\'finance-ar\')" style="color:var(--teal);">Receivables — ' + (open ? open.arCount + ' open invoice(s), ' + m(open.arCents) : '—') + '</a></li>' +
          '<li><a href="javascript:void(0)" onclick="navigateTo(\'finance-ap\')" style="color:var(--teal);">Payables — ' + (open ? open.apCount + ' open bill(s), ' + m(open.apCents) : '—') + '</a></li>' +
          '<li><a href="javascript:void(0)" onclick="navigateTo(\'finance-expenses\')" style="color:var(--teal);">Review expenses</a></li>' +
          '<li><a href="javascript:void(0)" onclick="navigateTo(\'finance-period-close\')" style="color:var(--teal);">Close the books</a></li>' +
          '</ul>', { fill: true }) +
        '</div>';
      V2.csv = [['Metric', 'Value'], ['Revenue (cents)', agg ? agg.totalCents : 0], ['AR (cents)', open ? open.arCents : ''], ['AP (cents)', open ? open.apCents : ''], ['Bank ($)', cash ? cash.bankTotal : '']];
    });
  }

  function loadRevenue() {
    var p = period(), prior = bridge().priorWindow(p.start, p.end);
    return Promise.all([
      bridge().revenueRows(p.start, p.end),
      prior ? bridge().loadRevenueAggregate(prior.start, prior.end).catch(function () { return null; }) : null
    ]).then(function (r) {
      var d = r[0], priorAgg = r[1];
      var el = body(); if (!el) return;
      var excl = d.testExcluded && d.testExcluded.count > 0
        ? '<div style="margin:8px 0;font-size:0.78rem;color:var(--warm-gray);">Excluding ' + d.testExcluded.count + ' test transaction(s), ' + m(d.testExcluded.cents) + '</div>' : '';
      var shown = d.rows.slice(0, 200);
      el.innerHTML =
        U.tiles([
          { k: 'Revenue', v: m(d.totalCents) + ' ' + deltaChip(d.totalCents, priorAgg && priorAgg.totalCents), hero: true },
          { k: 'Transactions', v: N.count(d.txnCount) },
          { k: 'Avg transaction', v: d.txnCount > 0 ? m(Math.round(d.totalCents / d.txnCount)) : '—' }
        ]) + excl +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px;">' +
        U.card('By channel', channelTable(d.byChannel, d.totalCents), { fill: true }) +
        U.card('Transactions' + (d.rows.length > 200 ? ' (first 200)' : ''), table([
          { label: 'Date', render: function (r) { return esc(String(r.date).slice(0, 10)); } },
          { label: 'Ref', render: function (r) { return esc(r.label) + (r.party ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">' + esc(r.party) + '</span>' : ''); } },
          { label: 'Channel', render: function (r) { return esc(r.channel); } },
          { label: 'Amount', align: 'right', render: function (r) { return m(r.cents); } }
        ], shown), { fill: true }) +
        '</div>';
      V2.csv = [['Date', 'Ref', 'Kind', 'Channel', 'AmountCents']].concat(d.rows.map(function (r) { return [String(r.date).slice(0, 10), r.label, r.kind, r.channel, r.cents]; }));
    });
  }

  function loadPl() {
    var p = period(), prior = bridge().priorWindow(p.start, p.end);
    return Promise.all([
      bridge().computePnl(p.start, p.end),
      prior ? bridge().computePnl(prior.start, prior.end).catch(function () { return null; }) : null
    ]).then(function (r) {
      var pnl = applyBurden(r[0]), prev = applyBurden(r[1]);
      var el = body(); if (!el) return;
      var mg = marginText(pnl);
      var sentinel = mg.note ? '<div style="margin:8px 0;font-size:0.78rem;color:var(--amber);">Margin withheld — ' + esc(mg.note) + '. Fix COGS on the flagged products to unlock P&L quality.</div>' : '';
      var dash = mg.note ? '—' : null;
      var opexKeys = Object.keys(pnl.opexByCategory || {}).sort(function (a, b) { return pnl.opexByCategory[b] - pnl.opexByCategory[a]; });
      el.innerHTML =
        U.tiles([
          { k: 'Revenue', v: m(pnl.revenue) + ' ' + deltaChip(pnl.revenue, prev && prev.revenue), hero: true },
          { k: 'COGS', v: dash || m(pnl.cogs) },
          { k: 'Gross profit', v: dash || (m(pnl.grossProfit) + ' ' + deltaChip(pnl.grossProfit, prev && prev.grossProfit)) },
          { k: 'OpEx', v: m(pnl.opex) },
          { k: 'Net profit', v: dash || m(pnl.netProfit) }
        ]) + sentinel +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px;">' +
        U.card('Operating expenses', opexKeys.length ? table([
          { label: 'Category', render: function (k) { return esc(k); } },
          { label: 'Amount', align: 'right', render: function (k) { return m(pnl.opexByCategory[k]); } }
        ], opexKeys) : '<div style="color:var(--warm-gray);font-size:0.85rem;">No expenses in the selected period.</div>', { fill: true }) +
        U.card('Revenue by channel', channelTable(pnl.revByChannel || {}, pnl.revenue), { fill: true }) +
        '</div>';
      V2.csv = [['Line', 'Cents'], ['Revenue', pnl.revenue], ['COGS', mg.note ? '' : pnl.cogs], ['GrossProfit', mg.note ? '' : pnl.grossProfit], ['OpEx', pnl.opex], ['NetProfit', mg.note ? '' : pnl.netProfit]]
        .concat(opexKeys.map(function (k) { return ['OpEx: ' + k, pnl.opexByCategory[k]]; }));
    });
  }

  function loadCash() {
    return bridge().cashSnapshot(V2.horizon).then(function (s) {
      var el = body(); if (!el) return;
      var hp = [30, 60, 90].map(function (h) {
        var on = V2.horizon === h;
        return '<button onclick="FinStatementsV2.setHorizon(' + h + ')" style="border:1px solid var(--border);' +
          'background:' + (on ? 'color-mix(in srgb,var(--teal) 16%,transparent)' : 'transparent') + ';color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';' +
          'border-radius:999px;padding:4px 11px;font-size:0.78rem;cursor:pointer;margin-right:6px;">' + h + 'd</button>';
      }).join('');
      var stale = (s.staleItems || []).length
        ? '<div style="margin:8px 0;font-size:0.78rem;color:var(--amber);">Bank sync needs attention: ' + esc(s.staleItems.join(', ')) + ' — reconnect on the classic Expenses page.</div>' : '';
      el.innerHTML =
        '<div style="margin-bottom:10px;">' + hp + '</div>' +
        U.tiles([
          { k: 'Bank balance', v: N.money(s.bankTotal), hero: true },
          { k: 'AR due ≤' + s.horizonDays + 'd', v: m(s.arDueHorizon) },
          { k: 'AP due ≤' + s.horizonDays + 'd', v: m(s.apDueHorizon) },
          { k: 'Projected (' + s.horizonDays + 'd)', v: N.money(s.netProjected) }
        ]) + stale +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px;">' +
        U.card('Accounts', (s.bankAccounts || []).length ? table([
          { label: 'Account', render: function (a) { return esc(a.institution || '') + ' · ' + esc(a.name || '') + (a.mask ? ' ••' + esc(a.mask) : ''); } },
          { label: 'Balance', align: 'right', render: function (a) { return N.money(a.balance); } }
        ], s.bankAccounts) : '<div style="color:var(--warm-gray);font-size:0.85rem;">No bank connection.</div>', { fill: true }) +
        U.card('Expected movement', table([
          { label: '', render: function (r) { return esc(r[0]); } },
          { label: 'Amount', align: 'right', render: function (r) { return r[1]; } }
        ], [
          ['AR outstanding (' + s.arCount + ')', m(s.arTotal)],
          ['— wholesale, ≤' + s.horizonDays + 'd', m(s.arWholesaleHorizon || 0)],
          ['— direct, ≤' + s.horizonDays + 'd', m(s.arDirectHorizon || 0)],
          ['AP owed (' + s.apCount + ')', m(s.apTotal)]
        ]) + '<div style="margin-top:10px;font-size:0.78rem;"><a href="javascript:void(0)" onclick="FinStatementsV2.dayClose()" style="color:var(--teal);">Day Close →</a></div>', { fill: true }) +
        '</div>';
      V2.csv = [['Metric', 'Value'], ['Bank ($)', s.bankTotal], ['ARdueHorizonCents', s.arDueHorizon], ['APdueHorizonCents', s.apDueHorizon], ['NetProjected ($)', s.netProjected]];
    });
  }

  function loadTax() {
    var p = period();
    return bridge().taxByState(p.start, p.end).then(function (t) {
      var el = body(); if (!el) return;
      var states = Object.keys(t.byState).sort(function (a, b) { return t.byState[b].taxCollected - t.byState[a].taxCollected; });
      var total = states.reduce(function (s, k) { return s + t.byState[k].taxCollected; }, 0);
      el.innerHTML =
        U.tiles([
          { k: 'Tax collected', v: m(total), hero: true },
          { k: 'States', v: N.count(states.length) }
        ]) +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-top:14px;">' +
        U.card('By state', states.length ? table([
          { label: 'State', render: function (k) { return esc(k); } },
          { label: 'Registered', render: function (k) { var r = t.nexus && t.nexus[k]; return (r && r.registered) ? U.badge('registered', 'teal') : U.badge('not registered', 'amber'); } },
          { label: 'Orders', align: 'right', render: function (k) { return N.count(t.byState[k].orderCount); } },
          { label: 'Collected', align: 'right', render: function (k) { return m(t.byState[k].taxCollected); } }
        ], states) : '<div style="color:var(--warm-gray);font-size:0.85rem;">No taxed orders in the selected period.</div>', { fill: true }) +
        U.card('Compliance', '<div style="font-size:0.85rem;line-height:1.9;">Nexus registration management and 1099 vendor prep stay on the classic Tax page for now.<br>' +
          '<a href="javascript:void(0)" onclick="FinStatementsV2.classicTax()" style="color:var(--teal);">Open classic Tax ↗</a></div>', { fill: true }) +
        '</div>';
      V2.csv = [['State', 'Registered', 'Orders', 'TaxCents']].concat(states.map(function (k) { return [k, !!(t.nexus && t.nexus[k] && t.nexus[k].registered), t.byState[k].orderCount, t.byState[k].taxCollected]; }));
    });
  }

  var LOADERS = { overview: loadOverview, revenue: loadRevenue, pl: loadPl, cash: loadCash, tax: loadTax };

  function refresh() {
    var el = body();
    if (el) el.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:20px 0;">Loading…</div>';
    V2.csv = null;
    LOADERS[V2.lens]().catch(fail);
  }
  function rerender() { shell(); refresh(); }

  window.FinStatementsV2 = {
    setLens: function (k) { V2.lens = k; rerender(); },
    setMode: function (mode) {
      var p = period();
      bridge().setPeriod({ mode: mode, start: p.start, end: p.end });
      rerender();
    },
    applyCustom: function () {
      var s = (document.getElementById('finStV2Start') || {}).value;
      var en = (document.getElementById('finStV2End') || {}).value;
      if (!s || !en || en < s) { if (window.showToast) showToast('Pick a valid date range', true); return; }
      bridge().setPeriod({ mode: 'custom', start: s, end: en });
      rerender();
    },
    setHorizon: function (h) { V2.horizon = h; refresh(); },
    exportCsv: function () {
      if (!V2.csv) { if (window.showToast) showToast('Nothing to export yet', true); return; }
      var p = period();
      bridge().downloadCsv('statements-' + V2.lens, V2.csv, 'Period ' + p.start + ' → ' + p.end);
    },
    dayClose: function () { if (window.navigateToClassic) navigateToClassic('finance-cash-flow', { subView: 'dayclose' }); },
    classicTax: function () { if (window.navigateToClassic) navigateToClassic('finance-tax'); }
  };

  // All five routes land on the SAME page; the route only picks the entry lens.
  function setupFor(lensKey) {
    return function () {
      ensureTab();
      // RBAC: fall back to the first visible lens if the requested one is hidden.
      var vis = visibleLenses().map(function (l) { return l.key; });
      V2.lens = vis.indexOf(lensKey) >= 0 ? lensKey : (vis[0] || 'overview');
      MastAdmin.loadModule('finance').then(function () { rerender(); })
        .catch(function (e) { console.error('[finance-statements-v2] setup', e); });
    };
  }
  MastAdmin.registerModule('finance-statements-v2', {
    routes: {
      'financials-v2':        { tab: 'financeStatementsV2Tab', setup: setupFor('overview') },
      'finance-revenue-v2':   { tab: 'financeStatementsV2Tab', setup: setupFor('revenue') },
      'finance-pl-v2':        { tab: 'financeStatementsV2Tab', setup: setupFor('pl') },
      'finance-cash-flow-v2': { tab: 'financeStatementsV2Tab', setup: setupFor('cash') },
      'finance-tax-v2':       { tab: 'financeStatementsV2Tab', setup: setupFor('tax') }
    }
  });
})();
