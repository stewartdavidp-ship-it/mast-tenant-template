/**
 * customer-portfolio-v2.js — Customer Portfolio, V2 (Finance Wave 4,
 * docs/ux-audit/finance-v2-build-plan.md). Read-only analytics: the finance
 * lens on customers (trailing-12m revenue/margin, cost-to-serve, quadrants,
 * concentration risk). All math lives in finance.js (_portfolioCompute),
 * exposed via FinanceBridge — this module renders and drills.
 *
 * Writes live on customers-v2 (rows drill to the standard customer SO),
 * except bulk tagging (classic burn-down 2026-06-10): row checkboxes via the
 * engine's selectable-list primitive + a bulk bar whose tag/untag actions go
 * through the state-free FinanceBridge.portfolioBulkTag core.
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
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  function m(cents) { return N.money(cents || 0, { cents: true }); }

  var QUADS = [['all', 'All'], ['grow', 'Grow'], ['maintain', 'Maintain'], ['reprice', 'Reprice'], ['deprioritize', 'Deprioritize'], ['unclassified', 'Unclassified']];
  var QTONE = { grow: 'teal', maintain: 'info', reprice: 'amber', deprioritize: 'neutral', unclassified: 'neutral' };
  var V2 = { data: null, quad: 'all', sortKey: 'revenueCents', sortDir: 'desc', selected: {} };

  function ensureTab() {
    var el = document.getElementById('customerPortfolioV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'customerPortfolioV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function visibleRows() {
    var rows = (V2.data && V2.data.rows) || [];
    if (V2.quad !== 'all') rows = rows.filter(function (r) { return r.quadrant === V2.quad; });
    return window.mastSortRows ? window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) { return r[k]; })
      : rows.slice().sort(function (a, b) { return (b[V2.sortKey] || 0) - (a[V2.sortKey] || 0); });
  }

  function render() {
    var tab = ensureTab();
    var d = V2.data;
    if (!d) {
      tab.innerHTML = U.pageHeader({ title: 'Customer Portfolio', count: 'Loading…' });
      return;
    }
    var conc = { top5: d.top5, top10: d.top10, hhi: d.hhi, hhiBand: d.hhiBand };
    var canTag = (typeof window.can === 'function') ? window.can('customer-portfolio', 'edit') : true;
    var selIds = Object.keys(V2.selected);
    var bulkBar = '';
    if (canTag && selIds.length) {
      var tagBtn = function (tag) {
        return '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="PortfolioV2.bulkTag(\'' + tag + '\')">' + tag + '</button>';
      };
      bulkBar = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 12px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;">' +
        '<span style="font-size:0.85rem;font-weight:600;">' + selIds.length + ' selected</span>' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);">Tag:</span>' +
        tagBtn('white-glove') + tagBtn('renegotiate') + tagBtn('deprioritize') +
        '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:6px;">Remove:</span>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="PortfolioV2.bulkUntag()">Remove a tag…</button>' +
        '<button class="btn btn-secondary" style="font-size:0.78rem;margin-left:auto;" onclick="PortfolioV2.clearSelection()">Clear</button>' +
        '</div>';
    }
    var pills = QUADS.map(function (q) {
      var on = V2.quad === q[0];
      var n = q[0] === 'all' ? d.rows.length : (d.qCounts[q[0]] || 0);
      return '<button onclick="PortfolioV2.setQuad(\'' + q[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--teal) 16%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' + q[1] + ' <span style="color:var(--warm-gray);">' + n + '</span></button>';
    }).join('');

    tab.innerHTML =
      U.pageHeader({
        title: 'Customer Portfolio',
        count: N.count(d.rows.length) + ' customers · trailing 12m · cost-to-serve $' + (d.c2s.perTicketCents / 100).toFixed(0) + '/ticket, $' + (d.c2s.perReturnCents / 100).toFixed(0) + '/return',
        actionsHtml: '<button class="btn btn-secondary" onclick="PortfolioV2.exportCsv()">↓ Export</button>'
      }) +
      U.tiles([
        { k: 'Top-5 share', v: (conc.top5.sharePct * 100).toFixed(1) + '%', hero: true },
        { k: 'Top-10 share', v: (conc.top10.sharePct * 100).toFixed(1) + '%' },
        { k: 'HHI', v: N.count(conc.hhi) + ' ' + U.badge(conc.hhiBand, conc.hhiBand === 'high' ? 'amber' : 'neutral') },
        { k: '12m revenue (ranked)', v: m(d.totalRev) }
      ]) +
      '<div style="margin:14px 0;">' + pills + '</div>' + bulkBar +
      MastEntity.renderList('customers-v2', {
        selectable: canTag, selectedIds: V2.selected,
        onSelectFnName: 'PortfolioV2.select', onSelectAllFnName: 'PortfolioV2.selectAll',
        columns: [
          { key: 'displayName', label: 'Customer', render: function (r) { return esc(r.displayName) + (r.primaryEmail ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">' + esc(r.primaryEmail) + '</span>' : ''); } },
          { key: 'quadrant', label: 'Quadrant', render: function (r) { return U.badge(r.quadrant, QTONE[r.quadrant] || 'neutral'); } },
          { key: 'revenueCents', label: 'Revenue 12m', align: 'right', render: function (r) { return m(r.revenueCents); } },
          { key: 'grossMarginCents', label: 'Gross margin', align: 'right', render: function (r) { return m(r.grossMarginCents); } },
          { key: 'netMarginPct', label: 'Margin %', align: 'right', render: function (r) { return r.netMarginPct == null ? '—' : (r.netMarginPct * 100).toFixed(0) + '%'; } },
          { key: 'costToServeCents', label: 'Cost to serve', align: 'right', render: function (r) { return r.costToServeCents ? m(r.costToServeCents) + ' <span style="color:var(--warm-gray);font-size:0.72rem;">' + r.ticketCount + 't/' + r.returnCount + 'r</span>' : '—'; } },
          { key: 'netContributionCents', label: 'Net contribution', align: 'right', render: function (r) { return m(r.netContributionCents); } },
          { key: 'lapseStatus', label: 'Lifecycle', render: function (r) { return r.lapseStatus ? U.badge(r.lapseStatus, r.lapseStatus === 'active' ? 'teal' : (r.lapseStatus === 'at-risk' ? 'amber' : 'neutral')) : '—'; } }
        ],
        rows: visibleRows(),
        rowId: function (r) { return r.customerId; },
        sortKey: V2.sortKey, sortDir: V2.sortDir, onSortFnName: 'PortfolioV2.sort',
        onRowClickFnName: 'PortfolioV2.open',
        empty: { title: 'No portfolio data', message: 'Customer trailing-12m stats have not been computed yet.' }
      });
  }

  function load() {
    MastAdmin.loadModule('finance').then(function () {
      return window.FinanceBridge.portfolioCompute();
    }).then(function (d) { V2.data = d; render(); })
      .catch(function (e) {
        console.error('[customer-portfolio-v2] load', e);
        var tab = ensureTab();
        tab.innerHTML = U.pageHeader({ title: 'Customer Portfolio', count: '' }) +
          '<div style="color:var(--danger);padding:12px;">' + esc(e.message || String(e)) + '</div>';
      });
  }

  window.PortfolioV2 = {
    setQuad: function (q) { V2.quad = q; render(); },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'desc'; }
      render();
    },
    open: function (id) {
      // Drill to the standard customer record SO (cold-drill safe — fetch
      // inside customers-v2 handles the cache miss).
      MastAdmin.loadModule('customers-v2').then(function () {
        MastEntity.drill('customers-v2', id);
      }).catch(function (e) { console.error('[customer-portfolio-v2] open', e); });
    },
    exportCsv: function () {
      var rows = [['Customer', 'Email', 'Quadrant', 'Revenue12mCents', 'GrossMarginCents', 'MarginPct', 'CostToServeCents', 'NetContributionCents', 'Lifecycle']]
        .concat(visibleRows().map(function (r) { return [r.displayName, r.primaryEmail || '', r.quadrant, r.revenueCents, r.grossMarginCents, r.netMarginPct == null ? '' : r.netMarginPct, r.costToServeCents, r.netContributionCents, r.lapseStatus || '']; }));
      window.FinanceBridge.downloadCsv('customer-portfolio', rows, 'Trailing 12 months');
    },
    select: function (id, checked) {
      if (checked) V2.selected[id] = true; else delete V2.selected[id];
      render();
    },
    selectAll: function (checked) {
      V2.selected = {};
      if (checked) visibleRows().forEach(function (r) { V2.selected[r.customerId] = true; });
      render();
    },
    clearSelection: function () { V2.selected = {}; render(); },
    bulkTag: function (tag) { applyBulk(tag, false); },
    bulkUntag: function () {
      if (!window.mastPrompt) return;
      mastPrompt('Tag to remove from the selected customers:', { title: 'Remove tag', confirmLabel: 'Remove' }).then(function (tag) {
        if (!tag) return;
        applyBulk(String(tag).trim(), true);
      });
    }
  };

  function applyBulk(tag, remove) {
    if (!(typeof window.can !== 'function' || window.can('customer-portfolio', 'edit'))) { showToast('Finance write access required.', true); return; }
    var ids = Object.keys(V2.selected);
    if (!ids.length || !tag) return;
    var verb = remove ? 'Remove tag "' + tag + '" from ' : 'Apply tag "' + tag + '" to ';
    mastConfirm(verb + ids.length + ' customer' + (ids.length === 1 ? '' : 's') + '?', { title: remove ? 'Remove tag' : 'Bulk tag' }).then(function (ok) {
      if (!ok) return;
      MastAdmin.loadModule('finance').then(function () {
        return window.FinanceBridge.portfolioBulkTag(ids, tag, { remove: remove });
      }).then(function (res) {
        showToast((remove ? 'Untagged ' : 'Tagged ') + res.changed + (res.errors ? ' (' + res.errors + ' errored)' : '') + ' customer(s)' + (remove ? '' : ' as "' + tag + '"') + '.');
        V2.selected = {};
        load();
      }).catch(function (e) { showToast('Bulk tag failed: ' + (e.message || e), true); });
    });
  }

  MastAdmin.registerModule('customer-portfolio-v2', {
    routes: {
      'customer-portfolio-v2': { tab: 'customerPortfolioV2Tab', setup: function () { ensureTab(); render(); load(); } }
    }
  });
})();
