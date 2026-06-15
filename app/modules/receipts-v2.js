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
 * payments come from MastDB.squarePayments (admin/square-payments); match
 * candidates from MastDB.sales (admin/sales).
 *
 * Native payment↔sale matching (no more classic hatch): clicking an unmatched
 * Square payment opens an in-pane candidate finder; committing routes through
 * the admin-gated `matchSquarePayment` Cloud Function — which holds the
 * money-critical guards (idempotency, double-count incl. order-owned, audited
 * accept-variance, accumulator-routed revenue). The CF NEVER default-overwrites
 * recognized revenue; the UI surfaces an amount mismatch and requires an
 * explicit, reasoned accept before passing acceptVariance. See
 * reference_money_flow_architecture.md.
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
  function esc(s) { return U._esc ? U._esc(s) : String(s == null ? '' : s); }
  function toast(m, isErr) { if (window.showToast) window.showToast(m, isErr); }
  function canMatch() { return typeof window.can !== 'function' || window.can('receipts', 'edit'); }

  var V2 = { orders: [], byId: {}, payments: [], paymentsById: {}, sales: [], salesById: {},
             view: 'transactions', payFilter: 'all', date: null, loaded: false, off: null, offPay: null };

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
  // A Square payment carrying squareOrderId belongs to an online Square order:
  // squareWebhook already accrued its revenue under sourceId `square:<orderId>`.
  // It is NOT a day-close "unmatched" item to chase — hand-matching it to a
  // standalone sale would double-count (matchSquarePayment now blocks that).
  function isOrderOwnedPayment(p) { return !!(p && p.squareOrderId); }

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
        V2.payments = out;
        V2.paymentsById = {}; out.forEach(function (p) { V2.paymentsById[p._key] = p; });
        render();
      }).catch(function (e) { console.error('[receipts-v2] square payments', e); });
    }
    // admin/sales rows — the legacy POS sale records that Square payments match
    // against (the candidate finder reads these). Reconciliation-only; reads.
    var sl = window.MastDB && MastDB.sales;
    if (sl && typeof sl.list === 'function') {
      Promise.resolve(sl.list(200)).then(function (tree) {
        var out = [];
        Object.keys(tree || {}).forEach(function (k) {
          var s = tree[k]; if (!s || typeof s !== 'object') return;
          out.push(Object.assign({ _key: k }, s));
        });
        V2.sales = out;
        V2.salesById = {}; out.forEach(function (s) { V2.salesById[s._key] = s; });
      }).catch(function (e) { console.error('[receipts-v2] sales', e); });
    }
  }

  // Reload just the reconciliation collections after a successful match, so the
  // matched/unmatched badges + candidate list reflect the new state.
  function reloadMatchData() {
    var sp = window.MastDB && MastDB.squarePayments;
    if (sp && typeof sp.list === 'function') {
      Promise.resolve(sp.list(200)).then(function (tree) {
        var out = [];
        Object.keys(tree || {}).forEach(function (k) {
          var p = tree[k]; if (!p || typeof p !== 'object') return;
          out.push(Object.assign({ _key: k }, p));
        });
        V2.payments = out;
        V2.paymentsById = {}; out.forEach(function (p) { V2.paymentsById[p._key] = p; });
        render();
      }).catch(function (e) { console.error('[receipts-v2] reload payments', e); });
    }
    var sl = window.MastDB && MastDB.sales;
    if (sl && typeof sl.list === 'function') {
      Promise.resolve(sl.list(200)).then(function (tree) {
        var out = [];
        Object.keys(tree || {}).forEach(function (k) {
          var s = tree[k]; if (!s || typeof s !== 'object') return;
          out.push(Object.assign({ _key: k }, s));
        });
        V2.sales = out;
        V2.salesById = {}; out.forEach(function (s) { V2.salesById[s._key] = s; });
      }).catch(function (e) { console.error('[receipts-v2] reload sales', e); });
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
          if (p.matchedSaleId) return U.badge('Matched', 'success');
          // Online-order payments are already recorded under the order — not a
          // chase item. Label distinctly so they aren't read as "needs action".
          if (isOrderOwnedPayment(p)) return U.badge('Online order', 'info');
          return U.badge('Unmatched', 'warning');
        } },
      { key: 'amount', label: 'Amount', align: 'right', sortable: false,
        render: function (p) { return N.money((p.amount || 0) / 100); } },
      // Square receipt link (parity with legacy day-close). stopPropagation so
      // opening the receipt doesn't also trigger the row's match action.
      { key: 'receipt', label: '', sortable: false, render: function (p) {
          return p.receiptUrl
            ? '<a href="' + esc(p.receiptUrl) + '" target="_blank" rel="noopener" onclick="event.stopPropagation();" style="font-size:0.78rem;color:var(--teal);">Receipt</a>'
            : '';
        } }
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
    var unmatched = pays.filter(function (p) { return !p.matchedSaleId && !isOrderOwnedPayment(p); });
    var unmatchedAmt = 0; unmatched.forEach(function (p) { unmatchedAmt += (p.amount || 0) / 100; });

    var pills = [['transactions', 'Transactions', tx.length], ['payments', 'Square payments', pays.length]].map(function (p) {
      var on = V2.view === p[0];
      return '<button onclick="ReceiptsV2.setView(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + ' <span style="color:var(--warm-gray);">' + p[2] + '</span></button>';
    }).join('');

    // Payments sub-filter (parity with legacy day-close all/matched/unmatched).
    // "Unmatched" = the actionable chase set (excludes order-owned, already-recorded).
    var payShown = (V2.view === 'payments') ? pays.filter(payFilterMatch) : pays;
    var filterPills = '';
    if (V2.view === 'payments') {
      var matchedCount = pays.filter(function (p) { return !!p.matchedSaleId; }).length;
      var fopts = [['all', 'All', pays.length], ['unmatched', 'Unmatched', unmatched.length], ['matched', 'Matched', matchedCount]];
      filterPills = '<div style="margin:0 0 10px;">' + fopts.map(function (f) {
        var on = V2.payFilter === f[0];
        return '<button onclick="ReceiptsV2.setPayFilter(\'' + f[0] + '\')" style="border:1px solid var(--border);' +
          'background:' + (on ? 'color-mix(in srgb,var(--teal) 16%,transparent)' : 'transparent') + ';' +
          'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
          'padding:4px 11px;font-size:0.78rem;cursor:pointer;margin-right:8px;">' +
          f[1] + ' <span style="color:var(--warm-gray);">' + f[2] + '</span></button>';
      }).join('') + '</div>';
    }

    var list = (V2.view === 'payments')
      ? window.MastEntity.renderList('orders-v2', {
          columns: payColumns(), rows: payShown, sortKey: 'time', sortDir: 'asc',
          rowId: function (p) { return p._key; },
          // Click an unmatched payment to match it to a sale (native, in-pane).
          onRowClickFnName: 'ReceiptsV2.matchPayment',
          empty: { title: 'No ' + (V2.payFilter === 'all' ? '' : V2.payFilter + ' ') + 'Square payments on ' + d, message: 'Card payments taken on Square appear here.' }
        })
      : window.MastEntity.renderList('orders-v2', {
          columns: txColumns(), rows: tx, sortKey: 'time', sortDir: 'asc',
          onRowClickFnName: 'ReceiptsV2.open',
          empty: { title: 'No payment activity on ' + d, message: 'Pick another day to reconcile.' }
        });

    var hint = (V2.view === 'payments' && unmatched.length)
      ? '<div style="margin:6px 0 0;font-size:0.78rem;color:var(--warm-gray);">Click an unmatched payment to match it to a sale.</div>'
      : '';

    tab.innerHTML =
      U.pageHeader({ title: 'Day Close',
        subtitle: 'match payouts and reconcile receipts',
        actionsHtml: '<input type="date" class="form-input" value="' + d + '" onchange="ReceiptsV2.setDate(this.value)" ' +
            'style="padding:6px 10px;font-size:0.85rem;width:auto;">' }) +
      U.tiles([
        { k: 'Gross (' + d + ')', v: U.Num.money(gross), hero: true },
        { k: 'Stripe', v: U.Num.money(byProc.Stripe) },
        { k: 'Square', v: U.Num.money(byProc.Square) },
        { k: 'Other / manual', v: U.Num.money(byProc.Other) },
        { k: 'Unmatched Square', v: unmatched.length ? (U.Num.money(unmatchedAmt) + ' · ' + unmatched.length) : 'None' }
      ]) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      filterPills +
      list + hint;
  }

  // Payments sub-filter predicate. all → everything; matched → linked to a sale;
  // unmatched → actionable chase set (not matched AND not order-owned).
  function payFilterMatch(p) {
    if (V2.payFilter === 'matched') return !!p.matchedSaleId;
    if (V2.payFilter === 'unmatched') return !p.matchedSaleId && !isOrderOwnedPayment(p);
    return true;
  }

  // ── Native payment ↔ sale matching ──────────────────────────────────────
  // Candidate finder: unmatched, non-voided sales (square/unset payment type),
  // ranked by time proximity to the payment. Mirrors the legacy finder, minus
  // the classic-screen hop. Top 20.
  function candidatesFor(payment) {
    var payTime = new Date(payment.createdAt).getTime();
    var out = [];
    V2.sales.forEach(function (s) {
      if (s.squarePaymentId) return;                                  // already matched
      if (String(s.status || '').toLowerCase() === 'voided') return;
      if (s.paymentType && s.paymentType !== 'square') return;        // non-card sale
      var saleTime = new Date(s.timestamp || s.createdAt || 0).getTime();
      var deltaMin = isNaN(saleTime) || isNaN(payTime) ? Infinity : Math.abs(saleTime - payTime) / 60000;
      out.push({ saleId: s._key, sale: s, deltaMin: deltaMin, amount: Number(s.amount || 0) });
    });
    out.sort(function (a, b) { return a.deltaMin - b.deltaMin; });
    return out.slice(0, 20);
  }

  function paintMatchPanel(payment) {
    var root = document.getElementById('rmMatchRoot'); if (!root) return;
    var payCents = Number(payment.amount || 0);
    var cands = candidatesFor(payment);
    var rows;
    if (!cands.length) {
      rows = '<div style="padding:16px;color:var(--warm-gray);font-size:0.9rem;">No unmatched sales found. Create the sale first, or pick another payment.</div>';
    } else {
      rows = cands.map(function (c) {
        var s = c.sale;
        var match = c.amount === payCents;
        var when = (s.timestamp || s.createdAt) ? new Date(s.timestamp || s.createdAt).toLocaleString() : '—';
        var delta = c.deltaMin === Infinity ? '' : (c.deltaMin < 1 ? '<1 min' : Math.round(c.deltaMin) + ' min') + ' apart';
        var items = (s.items || []).map(function (i) { return i.productName; }).filter(Boolean).join(', ');
        return '<div onclick="ReceiptsV2.commitMatch(\'' + esc(payment._key) + '\',\'' + esc(c.saleId) + '\')" ' +
          'style="padding:11px 12px;border:1px solid ' + (match ? 'var(--teal)' : 'var(--border)') + ';' +
          'border-radius:8px;cursor:pointer;margin-bottom:8px;' + (match ? 'background:color-mix(in srgb,var(--teal) 8%,transparent);' : '') + '">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-weight:600;">' + U.Num.money(c.amount / 100) + '</span>' +
            '<span style="font-size:0.78rem;color:var(--warm-gray);">' + delta + '</span>' +
          '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;">' + esc(when) + '</div>' +
          (items ? '<div style="font-size:0.78rem;margin-top:2px;">' + esc(items) + '</div>' : '') +
          (match
            ? '<div style="font-size:0.78rem;color:var(--teal);margin-top:4px;">✓ Amount matches</div>'
            : '<div style="font-size:0.78rem;color:var(--amber);margin-top:4px;">⚠ Mismatch — sale ' + U.Num.money(c.amount / 100) + ' vs payment ' + U.Num.money(payCents / 100) + '</div>') +
          '</div>';
      }).join('');
    }
    root.innerHTML =
      '<div style="padding:14px;border:1px solid var(--border);border-radius:10px;margin-bottom:16px;background:var(--surface,transparent);">' +
        '<div style="font-size:0.72rem;letter-spacing:0.04em;text-transform:uppercase;color:var(--warm-gray);">Square payment</div>' +
        '<div style="font-weight:700;font-size:1.15rem;">' + U.Num.money(payCents / 100) + '</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + (payment.createdAt ? new Date(payment.createdAt).toLocaleString() : '—') + '</div>' +
      '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:8px;">Select a sale to match:</div>' +
      rows +
      '<div style="margin-top:14px;text-align:right;">' +
        '<button class="btn btn-secondary" onclick="window.MastUI.slideOut.requestClose()">Cancel</button>' +
      '</div>';
  }

  window.ReceiptsV2 = {
    setDate: function (d) { V2.date = d || todayStr(); render(); },
    setView: function (v) { V2.view = v; render(); },
    setPayFilter: function (f) { V2.payFilter = f || 'all'; render(); },
    open: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      MastAdmin.loadModule('orders-v2').then(function () {
        window.MastEntity.openRecord('orders-v2', rec, 'read');
      }).catch(function (e) { console.error('[receipts-v2] open', e); });
    },
    matchPayment: function (paymentKey) {
      var payment = V2.paymentsById[paymentKey]; if (!payment) return;
      if (payment.matchedSaleId) { toast('Payment already matched.'); return; }
      // An online-order payment's revenue is already recorded under its order;
      // hand-matching it to a standalone sale would double-count. The CF blocks
      // this server-side — don't even offer the matcher here.
      if (isOrderOwnedPayment(payment)) { toast('This payment belongs to an online order — revenue is already recorded.'); return; }
      if (!canMatch()) { toast('You don\'t have permission to match payments.', true); return; }
      V2._activePayment = payment;
      window.MastUI.slideOut.open({
        title: 'Match Square payment',
        subtitle: U.Num.money(Number(payment.amount || 0) / 100),
        size: 'md', mode: 'read', deepLink: false,
        bodyHtml: '<div id="rmMatchRoot"></div>',
        onClose: function () { V2._activePayment = null; }
      });
      paintMatchPanel(payment);
    },
    commitMatch: function (paymentKey, saleId) {
      var payment = V2.paymentsById[paymentKey];
      var sale = V2.salesById[saleId];
      if (!payment || !sale) { toast('Match target not found — refresh and retry.', true); return; }
      if (!canMatch()) { toast('You don\'t have permission to match payments.', true); return; }
      var payCents = Number(payment.amount || 0);
      var saleCents = Number(sale.amount || 0);
      var differ = payCents !== saleCents;

      Promise.resolve().then(function () {
        if (!differ) return { accept: false, reason: '' };
        // Money-critical: never silently overwrite recognized revenue. Require an
        // explicit, reasoned accept; the CF demands acceptVariance + reason.
        var delta = payCents - saleCents;
        var dir = delta > 0 ? 'increase' : 'decrease';
        var msg = 'Square amount ' + U.Num.money(payCents / 100) + " differs from the sale's "
          + U.Num.money(saleCents / 100) + ' (' + dir + ' of ' + U.Num.money(Math.abs(delta) / 100) + ').\n\n'
          + 'Matching will overwrite the sale\'s recognized revenue to ' + U.Num.money(payCents / 100)
          + ' and record an audited variance. Continue?';
        if (typeof window.mastConfirm !== 'function') {
          toast('Cannot confirm amount mismatch — match aborted.', true); return null;
        }
        return window.mastConfirm(msg, {
          title: 'Amount mismatch', danger: true,
          confirmLabel: 'Overwrite to ' + U.Num.money(payCents / 100), cancelLabel: 'Cancel'
        }).then(function (ok) {
          if (!ok) return null; // declined — abort
          if (typeof window.mastPrompt !== 'function') return { accept: true, reason: 'Operator-accepted Square variance' };
          return window.mastPrompt('Reason for the amount variance (required, audited):', {
            title: 'Variance reason', confirmLabel: 'Confirm',
            placeholder: 'e.g. tip added at terminal'
          }).then(function (reason) {
            if (reason == null || !String(reason).trim()) { toast('A reason is required — match aborted.', true); return null; }
            return { accept: true, reason: String(reason).trim() };
          });
        });
      }).then(function (decision) {
        if (!decision) return; // aborted/declined
        if (!window.firebase || !firebase.functions) { toast('Cloud functions unavailable.', true); return; }
        toast('Matching…');
        return firebase.functions().httpsCallable('matchSquarePayment')({
          tenantId: (window.MastDB && MastDB.tenantId && MastDB.tenantId()) || undefined,
          paymentId: payment.paymentId || paymentKey,
          saleId: saleId,
          acceptVariance: !!decision.accept,
          varianceReason: decision.reason || ''
        }).then(function (res) {
          var r = (res && res.data) || {};
          var note = r.orderOwned ? 'Payment linked (order owns the revenue).' : 'Payment matched to sale.';
          if (r.amountChanged) note = 'Payment matched — sale revenue updated to ' + U.Num.money((r.newAmountCents || payCents) / 100) + '.';
          toast(note);
          try { window.MastUI.slideOut.requestClose(); } catch (e) {}
          reloadMatchData();
        });
      }).catch(function (err) {
        var m = (err && err.message) ? err.message : 'Match failed';
        console.error('[receipts-v2] commitMatch', err);
        toast(m, true);
      });
    },
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
