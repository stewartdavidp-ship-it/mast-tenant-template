/**
 * receipts-v2.js — Day Close, V2 (record archetype + reconciliation view,
 * standard-record-ui §10).
 *
 * "Did yesterday's money land?" — one day's payment activity in one place:
 *   • Transactions: that day's orders with the payment processor derived from
 *     their payment-id fields (Stripe / Square / Other), with day totals.
 *   • Square payments: processor-side records with matched/unmatched state —
 *     the unmatched total is the number you chase at day close.
 *
 * Data note: reads MastDB.orders (root orders/{id}) — the same source of
 * truth as orders-v2/pickship — NOT legacy admin/orders (which holds only
 * QBO-webhook test docs; see pickship.workflow.js recordPath note). Square
 * payments come from MastDB.squarePayments (admin/square-payments).
 *
 * TEMP-LINK DEBT (tracked in sales-v2-build-plan.md): manual payment↔sale
 * matching (writes into the legacy admin/sales model) stays on the classic
 * screen — header link below. Native V2 matching lands with the Day Close P2.
 *
 * Flag-gated (`uiRedesign`), side-by-side route `#receipts-v2`.
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

  var U = window.MastUI;

  var V2 = { orders: [], byId: {}, payments: [], view: 'transactions', date: null, loaded: false, off: null, offPay: null };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dayOf(ts) {
    if (!ts) return null;
    var d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function processorOf(o) {
    if (o.stripePaymentIntentId || o.stripeCheckoutSessionId) return 'Stripe';
    if (o.squarePaymentId || o.squareOrderId || o.squareCheckoutId) return 'Square';
    return 'Other';
  }
  function rowTotal(o) { return U.Num.moneyVal(o, 'totalCents', 'total') || 0; }

  function load() {
    var o = window.MastDB && MastDB.orders;
    if (o) {
      var apply = function (tree) {
        var out = [];
        Object.keys(tree || {}).forEach(function (k) {
          var r = tree[k]; if (!r || typeof r !== 'object') return;
          out.push(Object.assign({ _key: k }, r));
        });
        V2.orders = out;
        V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
        V2.loaded = true; render();
      };
      if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[receipts-v2] orders', e); });
      if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
    }
    var sp = window.MastDB && MastDB.squarePayments;
    if (sp && typeof sp.list === 'function') {
      Promise.resolve(sp.list(200)).then(function (tree) {
        var out = [];
        Object.keys(tree || {}).forEach(function (k) {
          var p = tree[k]; if (!p || typeof p !== 'object') return;
          out.push(Object.assign({ _key: k }, p));
        });
        V2.payments = out; render();
      }).catch(function (e) { console.error('[receipts-v2] square payments', e); });
    }
  }

  function dayOrders() {
    var d = V2.date || todayStr();
    return V2.orders.filter(function (o) {
      var ts = o.paidAt || o.placedAt || o.createdAt;
      if (dayOf(ts) !== d) return false;
      // Payment activity only: paid orders, or anything with a processor ref.
      return processorOf(o) !== 'Other' || !!o.paidAt || !!o.placedAt;
    });
  }
  function dayPayments() {
    var d = V2.date || todayStr();
    return V2.payments.filter(function (p) { return dayOf(p.createdAt) === d; });
  }

  function txColumns() {
    var N = U.Num;
    return [
      { key: 'time', label: 'Time', render: function (r) {
          var ts = r.paidAt || r.placedAt || r.createdAt;
          return ts ? new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
        } },
      { key: 'orderNumber', label: 'Order', render: function (r) { return r.orderNumber || r._key; } },
      { key: 'customer', label: 'Customer', sortable: false, render: function (r) { return r.customerName || r.email || 'Walk-in'; } },
      { key: 'processor', label: 'Processor', sortable: false,
        render: function (r) { var p = processorOf(r); return U.badge(p, p === 'Stripe' ? 'info' : (p === 'Square' ? 'teal' : 'neutral')); } },
      { key: 'paymentMethod', label: 'Method', sortable: false, render: function (r) { return r.paymentMethod || '—'; } },
      { key: 'status', label: 'Status', sortable: false,
        render: function (r) { var s = String(r.status || '').toLowerCase(); return U.badge(s.replace(/_/g, ' '), (s === 'cancelled' || s === 'refunded') ? 'danger' : 'success'); } },
      { key: 'total', label: 'Amount', align: 'right', sortable: false, render: function (r) { return N.money(rowTotal(r)) || '—'; } }
    ];
  }

  function payColumns() {
    var N = U.Num;
    return [
      { key: 'time', label: 'Time', sortable: false, render: function (p) {
          return p.createdAt ? new Date(p.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—';
        } },
      { key: 'paymentId', label: 'Payment', sortable: false, render: function (p) { return (p.paymentId || p._key).slice(0, 16); } },
      { key: 'sourceType', label: 'Source', sortable: false, render: function (p) { return (p.sourceType || '—').replace(/_/g, ' '); } },
      { key: 'matched', label: 'Matched', sortable: false, render: function (p) {
          return p.matchedSaleId ? U.badge('Matched', 'success') : U.badge('Unmatched', 'warning');
        } },
      { key: 'amount', label: 'Amount', align: 'right', sortable: false,
        render: function (p) { return N.money((p.amount || 0) / 100); } }
    ];
  }

  function ensureTab() {
    var el = document.getElementById('receiptsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'receiptsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Day Close', subtitle: 'Match payouts and reconcile receipts' }) +
        '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var d = V2.date || todayStr();
    var tx = dayOrders();
    var pays = dayPayments();
    var gross = 0, byProc = { Stripe: 0, Square: 0, Other: 0 };
    tx.forEach(function (o) {
      var s = String(o.status || '').toLowerCase();
      if (s === 'cancelled' || s === 'refunded') return;
      var amt = rowTotal(o); gross += amt; byProc[processorOf(o)] += amt;
    });
    var unmatched = pays.filter(function (p) { return !p.matchedSaleId; });
    var unmatchedAmt = 0; unmatched.forEach(function (p) { unmatchedAmt += (p.amount || 0) / 100; });

    var pills = [['transactions', 'Transactions', tx.length], ['payments', 'Square payments', pays.length]].map(function (p) {
      var on = V2.view === p[0];
      return '<button onclick="ReceiptsV2.setView(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + p[2] + '</span></button>';
    }).join('');

    var list = (V2.view === 'payments')
      ? window.MastEntity.renderList('orders-v2', {
          columns: payColumns(), rows: pays, sortKey: 'time', sortDir: 'asc',
          rowId: function (p) { return p._key; },
          empty: { title: 'No Square payments on ' + d, message: 'Card payments taken on Square appear here.' }
        })
      : window.MastEntity.renderList('orders-v2', {
          columns: txColumns(), rows: tx, sortKey: 'time', sortDir: 'asc',
          onRowClickFnName: 'ReceiptsV2.open',
          empty: { title: 'No payment activity on ' + d, message: 'Pick another day to reconcile.' }
        });

    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;flex-wrap:wrap;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Day Close</h1>' +
        '<input type="date" class="form-input" value="' + d + '" onchange="ReceiptsV2.setDate(this.value)" ' +
          'style="padding:6px 10px;font-size:0.85rem;width:auto;">' +
        // Tracked temp-link (debt): manual payment↔sale matching is classic-only until Day Close P2.
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="ReceiptsV2.classicMatch()">Match payments (classic) ↗</button>' +
      '</div>' +
      U.tiles([
        { k: 'Gross (' + d + ')', v: U.Num.money(gross), hero: true },
        { k: 'Stripe', v: U.Num.money(byProc.Stripe) },
        { k: 'Square', v: U.Num.money(byProc.Square) },
        { k: 'Other / manual', v: U.Num.money(byProc.Other) },
        { k: 'Unmatched Square', v: unmatched.length ? (U.Num.money(unmatchedAmt) + ' · ' + unmatched.length) : 'None' }
      ]) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      list;
  }

  window.ReceiptsV2 = {
    setDate: function (d) { V2.date = d || todayStr(); render(); },
    setView: function (v) { V2.view = v; render(); },
    open: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      MastAdmin.loadModule('orders-v2').then(function () {
        window.MastEntity.openRecord('orders-v2', rec, 'read');
      }).catch(function (e) { console.error('[receipts-v2] open', e); });
    },
    classicMatch: function () { if (window.navigateToClassic) navigateToClassic('receipts'); },
    refresh: render
  };

  MastAdmin.registerModule('receipts-v2', {
    routes: { 'receipts-v2': { tab: 'receiptsV2Tab', setup: function () {
      ensureTab();
      MastAdmin.loadModule('orders-v2').then(function () { render(); load(); })
        .catch(function (e) { console.error('[receipts-v2] setup', e); });
    } } }
  });
})();
