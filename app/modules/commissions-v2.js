/**
 * commissions-v2.js — the Commissions Process surface (doc 17 §1a/§2/§3).
 *
 * Commissions are a genuine governed lifecycle (the MastFlow `commissions` spec is
 * the proof): inquiry → quoted → accepted → in-progress → invoiced → shipped →
 * delivered, each with hard/soft exit-checklists. Mirrors orders-v2's Process
 * wiring exactly: detail.flow composes the MastFlow lifecycle, so the Process pane
 * hosts the stepper + checklist + ONE guarded Advance (NOT a status dropdown);
 * status is read-only (workflow-governed).
 *
 * Scope (operator-approved): view + advance in v2; the capture actions (send
 * proposal, record deposit, post milestone, send/pay balance invoice, tracking)
 * are side-effect-bearing and live in legacy orders.js, so each checklist "Go →"
 * requirement DEEP-LINKS to the legacy commission detail (viewCommissionDetail +
 * setCommissionDetailTab) via the additive engine hook detail.onFlowTarget. No
 * inline edit (no onSave) — advancing is the only write, through MastFlow.
 *
 * Flag-gated (?ui=1) at #commissions-v2, side-by-side with legacy #commissions;
 * orders.js untouched.
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

  var N = window.MastUI.Num, esc = window.MastUI._esc;

  // Commission status → badge tone (status is workflow-governed, shown read-only).
  var STATUS_TONE = {
    'new': 'neutral', 'in-discussion': 'neutral', 'quoted': 'info',
    'accepted': 'info', 'deposit-paid': 'info',
    'design-locked': 'amber', 'in-fabrication': 'amber', 'cold-shop': 'amber', 'built': 'amber',
    'balance-invoiced': 'amber', 'shipped': 'teal',
    'followed-up': 'success', 'completed': 'success', 'delivered': 'success',
    'cancelled': 'danger', 'closed-no-completion': 'danger'
  };
  function quote(c) { return N.moneyVal(c, 'proposalPriceCents', 'proposalPrice'); }
  function stamp(c) {
    // Materialise a real title string (fields[0] / slide-out title is read directly).
    c._title = c.sourcePieceName || (c.customerName ? ('Commission — ' + c.customerName) : ('Commission ' + (c._key || c.id || '')));
    return c;
  }

  MastEntity.define('commissions-v2', {
    label: 'Commission', labelPlural: 'Commissions', size: 'xl', route: 'commissions-v2',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      { name: '_title', label: 'Commission', type: 'text', list: true, group: 'Commission', readOnly: true },
      { name: 'customerName', label: 'Customer', type: 'text', list: true, group: 'Commission', readOnly: true },
      // Status is GOVERNED BY THE WORKFLOW (detail.flow), not edited as a field (doc 17 §2).
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Lifecycle', readOnly: true,
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      { name: 'quote', label: 'Quote', type: 'money', list: true, group: 'Money', readOnly: true, align: 'right', get: function (c) { return quote(c); } },
      { name: 'createdAt', label: 'Created', type: 'date', list: true, group: 'Commission', readOnly: true }
    ],
    fetch: function (id) { return Promise.resolve(MastDB.commissions.get(id)).then(function (c) { return c ? stamp(Object.assign({ _key: id }, c)) : null; }); },

    // Process variant: detail.flow composes the MastFlow `commissions` lifecycle.
    detail: {
      template: 'transaction',
      flow: 'commissions',
      flowModule: 'commissionsWorkflow',
      customerEntity: 'customers-v2',
      // Side-effect-bearing capture stays on legacy: route every checklist target
      // to the legacy commission detail at the relevant tab.
      onFlowTarget: function (targetId, rec) {
        var id = rec._key || rec.id;
        var t = String(targetId || '');
        var tab = /money/.test(t) ? 'money' : (/thread/.test(t) ? 'thread'
          : (/milestone/.test(t) ? 'milestones' : (/spec|production/.test(t) ? 'spec' : null)));
        // The legacy commission detail (viewCommissionDetail) lives in orders.js,
        // which may not be loaded in a fresh commissions-v2 session. Load it first
        // so navigateTo('commissions') resolves and the detail opener exists
        // (avoids the cold-load race), then open the record at the relevant tab.
        function open() {
          if (typeof navigateTo === 'function') navigateTo('commissions');
          setTimeout(function () {
            if (window.viewCommissionDetail) window.viewCommissionDetail(id);
            if (tab && window.setCommissionDetailTab) setTimeout(function () { window.setCommissionDetailTab(id, tab); }, 90);
          }, 120);
        }
        if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
          MastAdmin.loadModule('orders').then(open).catch(open);
        } else { open(); }
        return true;   // handled
      },
      tiles: function (c) {
        return [
          { k: 'Quote', v: N.money(quote(c)) || '—', hero: true },
          { k: 'Deposit', v: c.depositPaidAt ? 'Paid' : (N.money(N.moneyVal(c, 'depositAmountCents', 'depositAmount')) || '—') },
          { k: 'Balance', v: c.balancePaidAt ? 'Paid' : (c.balanceInvoicedAt ? 'Invoiced' : '—') },
          { k: 'Created', v: N.date(c.createdAt) || '—' }
        ];
      },
      // The "Items" facet shows the commissioned piece + the spec snippet as subtext.
      lineItems: function (c) {
        var spec = c.proposalSpec ? String(c.proposalSpec).replace(/\s+/g, ' ').slice(0, 120) : '';
        return [{ name: c.sourcePieceName || c._title || 'Custom commission', variant: spec, qty: 1, price: quote(c), total: quote(c) }];
      },
      totals: function (c) { return { total: quote(c) }; },
      customer: function (c) {
        var hasEmail = c.customerContact && String(c.customerContact).indexOf('@') !== -1;
        return { name: c.customerName || '—', email: hasEmail ? c.customerContact : (c.customerContact || ''), address: '' };
      },
      timeline: function (c) {
        var ev = [{ label: 'Created', at: N.date(c.createdAt), done: true }];
        if (c.proposalSentAt) ev.push({ label: 'Proposal sent', at: N.date(c.proposalSentAt), done: true });
        if (c.depositPaidAt) ev.push({ label: 'Deposit paid', at: N.date(c.depositPaidAt), done: true });
        if (c.balanceInvoicedAt) ev.push({ label: 'Balance invoiced', at: N.date(c.balanceInvoicedAt), done: true });
        if (c.balancePaidAt) ev.push({ label: 'Balance paid', at: N.date(c.balancePaidAt), done: true });
        return ev;
      }
    }
    // No onSave: status is workflow-governed (Process pane advances it); all other
    // edits/captures live on legacy (deep-linked). No Edit affordance by design.
  });

  // ── State + data (same source as legacy: admin/commissions) ─────────
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc' };

  function toRows(tree) {
    var out = [];
    tree = tree || {};
    Object.keys(tree).forEach(function (k) {
      var c = tree[k]; if (!c || typeof c !== 'object') return;
      out.push(stamp(Object.assign({ _key: k }, c)));
    });
    return out;
  }
  function load() {
    if (!window.MastDB || !MastDB.commissions) return;
    MastDB.commissions.query().limitToLast(200).once().then(function (snap) {
      var tree = (snap && snap.val && snap.val()) || (snap || {});
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    }).catch(function (e) { console.error('[commissions-v2] load', e); render(); });
  }

  function visibleRows() {
    return window.mastSortRows(V2.rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('commissions-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('commissionsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'commissionsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    tab.innerHTML =
      window.MastUI.pageHeader({ title: 'Commissions', count: N.count(V2.rows.length) + ' commissions',
        actionsHtml: '<button class="btn btn-secondary" onclick="CommissionsV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin-top:14px;">' +
      window.MastEntity.renderList('commissions-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CommissionsV2.sort', onRowClickFnName: 'CommissionsV2.open',
        empty: { title: 'No commissions yet', message: 'Custom orders will appear here.' }
      }) + '</div>';
  }

  window.CommissionsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'createdAt' || key === 'quote') ? 'desc' : 'asc'; }
      render();
    },
    open: function (id) { var rec = V2.byId[id]; if (rec) window.MastEntity.openRecord('commissions-v2', rec, 'read'); },
    exportCsv: function () { return window.MastEntity.exportRows('commissions-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('commissions-v2', {
    routes: { 'commissions-v2': { tab: 'commissionsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
