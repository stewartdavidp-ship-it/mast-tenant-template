/**
 * orders-v2.js — PROOF module (Phase 1). The Orders screen rebuilt as a
 * MastEntity schema instead of hand-written UI, to validate the engine on a
 * real, rich record before any fan-out (docs/ux-audit/CONTROL-PLANE.md).
 *
 * Flag-gated (`uiRedesign`) and self-mounting on route `#orders-v2`, so it runs
 * SIDE-BY-SIDE with the legacy orders.js for comparison — no hijack of the live
 * route during the proof. Verify on a dev pod: list + sort + filter + row→slide-out
 * read→edit→dirty-guard→save, export round-trip, and BOTH dark/light modes.
 *
 * The whole screen below is derived from one schema — there is no bespoke list,
 * modal, dirty-flag, or CSV code here. That is the point of the proof.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      // Reviewer convenience: ?ui=1 in the URL turns it on (and persists), so a
      // single link works in any browser — no devtools/localStorage needed.
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity) return;       // engines must be loaded
  if (!flagOn()) return;                                     // strangler: off by default

  // ── Schema: the entire Orders surface, declaratively ────────────────
  var STATUS_TONE = {
    placed: 'amber', confirmed: 'info', building: 'amber', packed: 'teal',
    shipped: 'teal', delivered: 'success', cancelled: 'neutral', refunded: 'danger',
    payment_failed: 'danger'
  };
  MastEntity.define('orders-v2', {
    label: 'Order', labelPlural: 'Orders', size: 'xl',
    recordId: function (o) { return o._key || o.id; },
    fields: [
      { name: 'orderNumber', label: 'Order', type: 'text', list: true, required: true, group: 'Order', readOnly: true },
      { name: 'email', label: 'Customer', type: 'text', list: true, group: 'Order', readOnly: true },
      { name: 'items', label: 'Items', type: 'number', list: true, group: 'Order',
        get: function (o) { return Array.isArray(o.items) ? o.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : (o.itemCount || 0); } },
      { name: 'total', label: 'Total', type: 'money', list: true, group: 'Order',
        get: function (o) { return window.MastUI.Num.moneyVal(o, 'totalCents', 'total'); } },
      // Status is GOVERNED BY THE WORKFLOW (detail.flow), not edited as a field —
      // readOnly so the form never offers a status dropdown (doc 17 §2). It still
      // drives the list badge + the slide-out header badge.
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Fulfillment', readOnly: true,
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      // Item-type tags so you can see what kinds of items an order contains.
      { name: 'contents', label: 'Contents', type: 'tags', list: true, sortable: false, group: 'Order',
        get: function (o) {
          var lbl = { 'product': 'Product', 'gift-card': 'Gift Card', 'class': 'Class', 'class-materials': 'Materials', 'pass': 'Pass' };
          var seen = {}, out = [];
          (o.items || []).forEach(function (it) { var t = it.itemType || 'product'; if (!seen[t]) { seen[t] = 1; out.push(lbl[t] || t); } });
          // Tier 2: flag orders holding a backorder line so the operator can spot
          // "can't ship yet" at a glance (the pickship Confirmed gate enforces it).
          if (o.hasBackorder || (o.items || []).some(function (it) { return it && it.backorder; })) out.push('Awaiting stock');
          return out;
        } },
      { name: 'tracking', label: 'Tracking', type: 'text', list: true, group: 'Fulfillment',
        get: function (o) { var t = o.tracking; if (!t) return ''; if (typeof t === 'string') return t; return [t.carrier, t.trackingNumber].filter(Boolean).join(' '); } },
      { name: 'source', label: 'Source', type: 'text', group: 'Order', readOnly: true },
      { name: 'placedAt', label: 'Placed', type: 'date', group: 'Order', readOnly: true }
    ],
    // Drill target + restorer source (fetch by id).
    route: 'orders-v2',
    fetch: function (id) { return MastDB.orders.get(id).then(function (o) { return o ? Object.assign({ _key: id }, o) : null; }); },
    // Designed Transaction detail (read mode) — all from real fields (doc 17).
    // detail.flow composes the MastFlow pickship lifecycle: the Process pane
    // hosts the stepper + checklist + guarded Advance (NOT a status dropdown).
    detail: {
      template: 'transaction',
      flow: 'pickship',
      flowModule: 'pickshipWorkflow',
      guidedHeader: true,   // clickable step rail (no Advance/Back buttons); click a done step = review
      guidedExpandCurrent: true,  // open with the current phase's checklist expanded (not a bare rail)
      customerEntity: 'customers-v2',
      tiles: function (r) {
        var N = window.MastUI.Num;
        var n = Array.isArray(r.items) ? r.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : 0;
        return [
          { k: 'Total', v: N.money(N.moneyVal(r, 'totalCents', 'total')) || '—', hero: true },
          { k: 'Items', v: n },
          { k: 'Payment', v: r.paymentMethod || '—' },
          { k: 'Source', v: r.source || '—' }
        ];
      },
      lineItems: function (r) {
        var N = window.MastUI.Num;
        return (r.items || []).map(function (it) {
          return { name: it.productName || it.name || 'Item', qty: it.qty,
            price: N.moneyVal(it, 'priceCents', 'price'), total: N.lineTotalVal(it) };
        });
      },
      totals: function (r) {
        var N = window.MastUI.Num;
        return { subtotal: N.moneyVal(r, 'subtotalCents', 'subtotal'), shipping: N.moneyVal(r, 'shippingCents', 'shipping'),
          tax: N.moneyVal(r, 'taxCents', 'tax'), total: N.moneyVal(r, 'totalCents', 'total') };
      },
      customer: function (r) {
        var sh = r.shipping || {};
        var esc = (window.MastUI && window.MastUI._esc) ? window.MastUI._esc : function (s) { return s == null ? '' : String(s); };
        // Full shipping address — recipient (when it differs from the customer),
        // both street lines, "City, ST ZIP", and country. The old builder only
        // read address1 + city/state, so line2/zip/country never showed even when
        // present. Each field is escaped (the card renders this as raw HTML).
        var cityLine = [sh.city, [sh.state, (sh.postalCode || sh.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        var recipient = (sh.name && sh.name !== (r.customerName || '')) ? sh.name : null;
        var lines = [
          recipient,
          sh.address1 || sh.line1 || sh.street1 || sh.street,
          sh.address2 || sh.line2 || sh.street2,
          cityLine,
          sh.country
        ].filter(Boolean).map(esc);
        // Explicit empty state — the card is titled "Customer & shipping", so a
        // missing address should read as missing, not silently vanish.
        var addr = lines.length
          ? lines.join('<br>')
          : '<em style="color:var(--warm-gray);">No shipping address on file.</em>';
        return { id: r.customerId, name: r.customerName || r.email, email: r.email, address: addr };
      },
      fulfillment: function (r) {
        var t = r.tracking, track = null;
        if (t && typeof t === 'object') {
          var label = [t.carrier, t.trackingNumber].filter(Boolean).join(' ');
          track = t.trackingUrl ? '<a href="' + t.trackingUrl + '" target="_blank" rel="noopener" style="color:var(--teal);">' + label + '</a>' : label;
        } else if (typeof t === 'string') { track = t; }
        return { status: r.status, tone: STATUS_TONE[String(r.status || '').toLowerCase()] || 'neutral', tracking: track || null };
      },
      timeline: function (r) {
        var cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
        // Audit trail: date + time so same-day steps stay distinguishable
        // ("Confirmed · Sarah Chen" with "Jun 7, 2:14 PM" beside it).
        var fmt = function (d) {
          if (!d) return '';
          var dt = new Date(d);
          if (isNaN(dt.getTime())) return '';
          return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
            dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        };
        // Prefer the real recorded history — one row per step, each carrying
        // the employee (or "Automatic") who performed it. statusHistory is an
        // array, but Firebase may surface it as an object map.
        var hist = r.statusHistory;
        if (hist && typeof hist === 'object' && !Array.isArray(hist)) {
          hist = Object.keys(hist).map(function (k) { return hist[k]; });
        }
        if (Array.isArray(hist) && hist.length) {
          var ev = [];
          var hasPlaced = hist.some(function (h) { return h && String(h.status).toLowerCase() === 'placed'; });
          if (!hasPlaced && r.placedAt) ev.push({ label: 'Placed', at: fmt(r.placedAt), done: true });
          hist.forEach(function (h) {
            if (!h || !h.status) return;
            var who = window.MastUI.Num.actorName(h.by);
            ev.push({ label: cap(String(h.status)) + (who ? ' · ' + who : ''), at: fmt(h.at), done: true });
          });
          return ev;
        }
        // Fallback: no recorded history — synthesize Placed + current status.
        var fb = [{ label: 'Placed', at: fmt(r.placedAt), done: true }];
        var st = String(r.status || '').toLowerCase();
        if (st && st !== 'placed') fb.push({ label: cap(st), at: fmt(r.updatedAt), done: true });
        return fb;
      }
    },
    onSave: function (rec, mode) {
      var id = rec._key || rec.id;
      if (!id || !window.MastDB || !MastDB.orders) return true;
      // Status is governed by the workflow (Process pane), so edit persists only
      // tracking. Status advances through MastFlow, never a form write.
      return MastDB.orders.update(id, { tracking: rec.tracking })
        .then(function () { return true; });
    }
  });

  // ── State + data (same source as legacy: admin/orders) ──────────────
  var V2 = { rows: [], byId: {}, sortKey: 'placedAt', sortDir: 'desc', filter: 'all', off: null };

  function toRows(tree) {
    var out = [];
    tree = tree || {};
    Object.keys(tree).forEach(function (k) {
      var o = tree[k]; if (!o || typeof o !== 'object') return;
      out.push(Object.assign({ _key: k }, o));
    });
    return out;
  }
  function load() {
    var o = window.MastDB && MastDB.orders;
    if (!o) return;
    var apply = function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    };
    // Real source = the orders entity accessor (53 records), NOT raw admin/orders
    // (which holds only QBO-webhook test docs). list() for initial paint; listen()
    // for live updates where available.
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[orders-v2] list', e); });
    if (typeof o.listen === 'function') { try { V2.off = o.listen(apply); } catch (e) {} }
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.filter && V2.filter !== 'all') {
      rows = rows.filter(function (r) { return String(r.status || '').toLowerCase() === V2.filter; });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('orders-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function statusCounts() {
    var c = { all: V2.rows.length };
    V2.rows.forEach(function (r) { var s = String(r.status || '').toLowerCase(); c[s] = (c[s] || 0) + 1; });
    return c;
  }

  function ensureTab() {
    // Container now lives in index.html (matches every other module); fall back
    // to dynamic creation only if absent.
    var el = document.getElementById('ordersV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'ordersV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var counts = statusCounts();
    var pills = ['all', 'placed', 'confirmed', 'delivered', 'cancelled', 'refunded'].map(function (s) {
      var on = V2.filter === s;
      return '<button onclick="OrdersV2.setFilter(\'' + s + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        s.charAt(0).toUpperCase() + s.slice(1) + ' <span style="color:var(--warm-gray);">' + (counts[s] || 0) + '</span></button>';
    }).join('');

    tab.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;">' +
        '<h1 style="font-size:1.6rem;margin:0;">Orders</h1>' +
        '<span style="color:var(--warm-gray);font-size:0.9rem;">' + window.MastUI.Num.count(V2.rows.length) + ' orders</span>' +
        '<button class="btn btn-secondary" style="margin-left:auto;" onclick="OrdersV2.exportCsv()">↓ Export</button>' +
      '</div>' +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      window.MastEntity.renderList('orders-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'OrdersV2.sort', onRowClickFnName: 'OrdersV2.open',
        empty: { title: 'No orders match these filters', message: 'Try clearing filters.' }
      });
  }

  // ── Public handlers (referenced by the engine-rendered HTML) ────────
  window.OrdersV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'asc'; }
      render();
    },
    setFilter: function (s) { V2.filter = s; render(); },
    open: function (id) { var rec = V2.byId[id]; if (rec) window.MastEntity.openRecord('orders-v2', rec, 'read'); },
    has: function (id) { return !!(V2.byId && V2.byId[id]); },  // readiness probe for external openers (dashboard card, history links)
    exportCsv: function () { return window.MastEntity.exportRows('orders-v2', visibleRows(), V2.filter); }
  };

  // ── Register the side-by-side route ─────────────────────────────────
  MastAdmin.registerModule('orders-v2', {
    routes: { 'orders-v2': { tab: 'ordersV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });

  // ── Ask AI: hydrate the open order record ────────────────────────────────────
  // Send the structured order (totals in dollars, line items, fulfillment) with a
  // scope block so Claude can answer about THIS order and decline cleanly on
  // anything outside it. All fields come straight off the record — no lazy load.
  if (window.MastAskAi && window.MastAskAi.registerEntity) {
    window.MastAskAi.registerEntity('orders-v2', {
      title: 'Ask AI about this order',
      placeholder: 'e.g. What is in this order? Is it shipped? What did it total? Why is it on hold?',
      notes: ['Money is in dollars. Status is governed by the fulfillment workflow, not a free field.'],
      buildContext: function (o) {
        if (!o) return {};
        var N = window.MastUI.Num;
        var id = o._key || o.id;
        var items = (o.items || []).map(function (it) {
          return { name: it.productName || it.name || 'Item', type: it.itemType || 'product',
            qty: it.qty || 1, priceUSD: N.moneyVal(it, 'priceCents', 'price'),
            lineTotalUSD: N.moneyVal(it, 'lineTotalCents', 'lineTotal'), sku: it.sku || null };
        });
        var sh = o.shipping || {};
        var t = o.tracking;
        var trackingStr = t ? (typeof t === 'string' ? t : [t.carrier, t.trackingNumber].filter(Boolean).join(' ')) : null;
        return {
          page: { title: 'Order ' + (o.orderNumber || id), route: 'orders-v2', viewing: 'order-detail' },
          order: {
            id: id, orderNumber: o.orderNumber || null,
            status: String(o.status || '').toLowerCase() || null,
            source: o.source || null, paymentMethod: o.paymentMethod || null,
            placedAt: o.placedAt || null, updatedAt: o.updatedAt || null,
            itemCount: items.reduce(function (s, li) { return s + (li.qty || 1); }, 0),
            items: items,
            totals: {
              subtotalUSD: N.moneyVal(o, 'subtotalCents', 'subtotal'),
              shippingUSD: N.moneyVal(o, 'shippingCents', 'shipping'),
              taxUSD: N.moneyVal(o, 'taxCents', 'tax'),
              grandTotalUSD: N.moneyVal(o, 'totalCents', 'total')
            }
          },
          customer: { id: o.customerId || null, name: o.customerName || o.email || null, email: o.email || null },
          fulfillment: {
            status: String(o.status || '').toLowerCase() || null,
            tracking: trackingStr,
            shipTo: [sh.city, sh.state].filter(Boolean).join(', ') || (sh.country || null)
          },
          scope: {
            describes: 'a single order record for this tenant',
            sectionsIncluded: ['order', 'customer', 'fulfillment'],
            notInThisPayload: ['external shipping-carrier live status', 'product cost / margin (see the product record)', 'this customer’s other orders', 'market / benchmark context'],
            neverInfer: ['other tenants’ orders', 'another customer’s private records']
          }
        };
      }
    });
  }
})();
