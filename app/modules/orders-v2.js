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
    payment_failed: 'danger',
    return_requested: 'amber', return_approved: 'amber', return_shipped: 'info',
    return_received: 'info', partially_returned: 'danger'
  };
  // Return/refund-in-progress vocabulary, grouped under the "Returns" filter
  // pill. 'refunded' (fully refunded) keeps its own pill; this set is the
  // return lifecycle plus partial refunds. Single source of truth so the pill,
  // its count, and the filter predicate never drift.
  var RETURN_STATUSES = ['return_requested', 'return_approved', 'return_shipped',
    'return_received', 'partially_returned'];
  function isReturnStatus(s) { return RETURN_STATUSES.indexOf(String(s || '').toLowerCase()) !== -1; }
  // Friendly channel label for an order. External orders (Shopify/Etsy/Square,
  // ingested by the orders/paid webhook) carry externalSource.platform; native
  // orders use `source` ('direct' = the Mast storefront, wholesale = bulk buyers).
  var CHANNEL_LABEL = { shopify: 'Shopify', etsy: 'Etsy', square: 'Square' };
  function channelLabel(o) {
    var ext = o && o.externalSource;
    if (ext && ext.platform) {
      return CHANNEL_LABEL[ext.platform] || (ext.platform.charAt(0).toUpperCase() + ext.platform.slice(1));
    }
    var s = o && o.source;
    if ((o && o.isWholesale) || s === 'wholesale_catalog') return 'Wholesale';
    if (!s || s === 'direct') return 'Online';
    return CHANNEL_LABEL[s] || String(s);
  }
  MastEntity.define('orders-v2', {
    label: 'Order', labelPlural: 'Orders', size: 'xl',
    recordId: function (o) { return o._key || o.id; },
    fields: [
      { name: 'orderNumber', label: 'Order', type: 'text', list: true, required: true, group: 'Order', readOnly: true },
      { name: 'email', label: 'Customer', type: 'text', list: true, group: 'Order', readOnly: true },
      // Channel badge so externally-sourced orders (Shopify/Etsy/Square) are
      // distinguishable at a glance from native storefront ('Online') orders.
      { name: 'channel', label: 'Channel', type: 'tags', list: true, sortable: false, group: 'Order', readOnly: true,
        get: function (o) { return [channelLabel(o)]; } },
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
    //
    // PR2 (PR1 follow-up): the detail is now a CUSTOM render (the procurement-v2
    // pattern) instead of template:'transaction', so it can mount NATIVE action
    // panes (triage/route, cancel, note, customer email) alongside the stock
    // items/customer/history panes. Every write delegates to window.OrdersBridge
    // (shipped in PR1) — the twin NEVER raw-writes order/inventory/buildJobs. Each
    // action is gated can('orders','edit'); the bridge has no internal RBAC.
    detail: {
      flow: 'pickship',
      flowModule: 'pickshipWorkflow',
      guidedHeader: true,   // clickable step rail (no Advance/Back buttons); click a done step = review
      guidedExpandCurrent: true,  // open with the current phase's checklist expanded (not a bare rail)
      customerEntity: 'customers-v2',
      // Intercept the forward advance to 'confirmed' when the order hasn't been
      // routed yet (!fulfillment): open the native triage form (per-item Stock vs
      // Build source picker) instead of a plain status write. The triage core
      // (OrdersBridge.triageConfirm) sets status→pack|building itself, so we
      // return true to suppress the engine's generic transition. Mirrors the
      // legacy renderOrderDetail trigger (targetPhaseKey==='confirmed' &&
      // !o.fulfillment). All other advances fall through to MastFlow.
      onFlowAdvance: function (target, r) {
        if (needsTriage(r)) { OrdersV2Actions.openTriage(r._key || r.id); return true; }
        return false;
      },
      // Route checklist "Go →" targets to the right detail pane. 'detail-triage'
      // (pickship Confirmed gate) → the Actions pane where the triage button lives.
      onFlowTarget: function (targetId) {
        var pane = (targetId === 'detail-triage' || targetId === 'detail-confirm') ? 'act' : null;
        if (!pane) return false;
        var body = document.getElementById('mastSlideOutBody'); if (!body) return true;
        var btn = body.querySelector('.mu-ptabs button[onclick*="\'' + pane + '\'"]');
        if (btn) btn.click();
        return true;
      },
      tiles: function (r) {
        var N = window.MastUI.Num;
        var n = Array.isArray(r.items) ? r.items.reduce(function (s, li) { return s + (li.qty || 1); }, 0) : 0;
        var t = [
          { k: 'Total', v: N.money(N.moneyVal(r, 'totalCents', 'total')) || '—', hero: true },
          { k: 'Items', v: n },
          { k: 'Payment', v: r.paymentMethod || '—' },
          { k: 'Channel', v: channelLabel(r) }
        ];
        // Loyalty earned on this order (set by the storefront / orders-paid webhook).
        // 'pending' = points are earned but the buyer has no linked Mast account yet.
        var le = r.loyaltyEarned;
        if (le && le.points) {
          t.push({ k: 'Earned', v: N.count(le.points) + ' ' + (le.pointName || 'pts') + (le.claimed === false ? ' (pending)' : '') });
        }
        return t;
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
      },
      // Custom read interior (procurement-v2 pattern): reproduces the stock
      // transaction-flow panes (Items / Customer / History) and adds an ACTIONS
      // pane hosting the native write affordances (triage/route, cancel, note,
      // customer email). The custom render must itself emit #muFlowHost — the
      // engine fills it after render because the schema declares detail.flow.
      render: function (UI, r) {
        var d = this;
        var orderId = r._key || r.id;
        // ── Items ──────────────────────────────────────────────────────
        var m = function (x) { return UI.Num.money(x) || '—'; };
        var items = (d.lineItems ? d.lineItems(r) : []) || [];
        // Receipt mode (mirrors the storefront /orders receipt). Stored line price is NET
        // (membership discount baked in). When per-line membershipDiscountCents reconciles
        // exactly to the order-level discount, promote the lines + subtotal to GROSS and show a
        // Member Discount row so "Subtotal − discount = Total" foots. Otherwise leave NET (which
        // already foots: net lines sum to the net subtotal). Line items always sum to subtotal.
        // Detection works in integer cents (no formatting); dollar conversions go through
        // UI.Num.moneyVal so the receipt stays on the centralized money core.
        var rawItems = r.items || [];
        var memberDiscCents = (r.membershipDiscount && r.membershipDiscount.discountCents) || 0;
        var attributedCents = 0;
        rawItems.forEach(function (it) { attributedCents += (it.membershipDiscountCents || 0); });
        var grossMode = memberDiscCents > 0 && attributedCents === memberDiscCents;
        var memberDiscUSD = grossMode ? UI.Num.moneyVal(r.membershipDiscount, 'discountCents') : 0;
        if (grossMode) {
          for (var gi = 0; gi < items.length; gi++) {
            var dUSD = (rawItems[gi] && rawItems[gi].membershipDiscountCents) ? UI.Num.moneyVal(rawItems[gi], 'membershipDiscountCents') : 0;
            var q = items[gi].qty || 1;
            items[gi].price = (items[gi].price || 0) + dUSD / q;
            items[gi].total = (items[gi].total || 0) + dUSD;
          }
        }
        // Built with the relatedTable primitive (not a hand-rolled mu-rel table)
        // so the chrome comes from MastUI, matching the stock transaction template.
        var itemsTable = UI.relatedTable([
          { label: 'Product', render: function (it) { return '<div class="mu-li">' + UI.imageThumb(it.name || '') + '<div>' + esc(it.name || '') + (it.variant ? '<div class="mu-sub">' + esc(it.variant) + '</div>' : '') + '</div></div>'; } },
          { label: 'Qty', align: 'right', render: function (it) { return esc(it.qty); } },
          { label: 'Price', align: 'right', render: function (it) { return m(it.price); } },
          { label: 'Total', align: 'right', render: function (it) { return m(it.total); } }
        ], items);
        var t = (d.totals ? d.totals(r) : {}) || {};
        var subtotalDisplay = grossMode ? (t.subtotal || 0) + memberDiscUSD : t.subtotal;
        var totalsHtml = '<div class="mu-totrow"><span>Subtotal</span><span>' + m(subtotalDisplay) + '</span></div>' +
          (grossMode ? '<div class="mu-totrow"><span>' + esc((r.membershipDiscount && r.membershipDiscount.programName) || 'Member Discount') + '</span><span>-' + m(memberDiscUSD) + '</span></div>' : '') +
          '<div class="mu-totrow"><span>Shipping</span><span>' + m(t.shipping) + '</span></div>' +
          '<div class="mu-totrow"><span>Tax</span><span>' + m(t.tax) + '</span></div>' +
          '<div class="mu-totrow grand"><span>Total</span><span>' + m(t.total) + '</span></div>';
        // ── Customer ───────────────────────────────────────────────────
        var cust = d.customer ? d.customer(r) : null;
        var custBlock = cust ? (
          '<div style="font-weight:600;">' + (cust.id ? MastEntity.drillLink(d.customerEntity || 'customers-v2', cust.id, cust.name || cust.email) : esc(cust.name || cust.email)) + '</div>' +
          '<div class="mu-sub" style="margin:2px 0 10px;">' + esc(cust.email || '') + '</div>' +
          (cust.address ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' + cust.address + '</div>' : '')
        ) : '<span class="mu-sub">—</span>';
        // ── Production requests created by triage (build items) ─────────
        var prHtml = renderProductionRequests(r);
        // ── Actions pane ───────────────────────────────────────────────
        var actionsBody = renderActionsPane(UI, r, orderId);

        // MastFlow stepper host — _initEntityFlow (engine) fills #muFlowHost
        // after render because the schema sets detail.flow.
        var flowHost = '<div id="muFlowHost" style="font-size:0.85rem;color:var(--warm-gray);margin:6px 0 14px;">Loading workflow…</div>';

        // The email history is read async via OrdersBridge.listEmails after the
        // DOM lands (the pane renders a "Loading…" placeholder until then).
        setTimeout(function () { loadEmailHistory(orderId); }, 0);

        return UI.stickyHead(UI.tiles(d.tiles ? d.tiles(r) : []), '') + flowHost +
          UI.paneTabsBar([
            { key: 'items', label: 'Items' },
            { key: 'customer', label: 'Customer' },
            { key: 'act', label: 'Actions' },
            { key: 'email', label: 'Email' },
            { key: 'history', label: 'History' }
          ], 'items') +
          '<div class="mu-pane" data-pane="items">' + UI.cardTable('Items', itemsTable) + UI.card('Summary', totalsHtml) + (prHtml ? UI.card('Production requests', prHtml) : '') + '</div>' +
          '<div class="mu-pane" data-pane="customer" hidden>' + UI.card('Customer & shipping', custBlock) + '</div>' +
          '<div class="mu-pane" data-pane="act" hidden>' + actionsBody + '</div>' +
          '<div class="mu-pane" data-pane="email" hidden>' + UI.card('Customer email', '<div id="ordersV2EmailPane_' + esc(orderId) + '">' + renderEmailPane(r, orderId) + '</div>') + '</div>' +
          '<div class="mu-pane" data-pane="history" hidden>' + UI.card('Timeline', UI.timeline(d.timeline ? d.timeline(r) : [])) + '</div>';
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

  // ── Native detail actions (PR2) — every WRITE delegates to OrdersBridge ──────
  // The OrdersBridge (shipped in orders.js, PR1) is the SINGLE write path:
  // triageConfirm / cancelOrder / addNote / sendEmail / listEmails all run the
  // same cores the legacy detail screen uses, so V1 and V2 share one Firestore
  // write path. The twin NEVER raw-writes order/inventory/buildJobs and gates
  // every action on can('orders','edit') (the bridge has no internal RBAC).
  var esc = (window.MastUI && window.MastUI._esc) ? window.MastUI._esc : function (s) { return s == null ? '' : String(s); };
  function canEdit() { return typeof window.can === 'function' ? window.can('orders', 'edit') : true; }
  // Issuing a refund is a sensitive action gated by the SAME server key the CF
  // enforces (rma.approve), distinct from the orders.edit module axis. Mirrors
  // the legacy RMA approve/complete gate (hasPermission('rma','approve')).
  function canRefund() { return typeof window.hasPermission === 'function' ? window.hasPermission('rma', 'approve') : false; }
  function toast(msg, isErr) { if (window.showToast) showToast(msg, !!isErr); else if (window.MastAdmin && MastAdmin.showToast) MastAdmin.showToast(msg, !!isErr); }
  function getDisplayNum(o) { return (o && (o.orderNumber || o._key || o.id)) || ''; }
  function fmtDateTime(d) {
    if (!d) return '';
    var dt = new Date(d);
    if (isNaN(dt.getTime())) return esc(String(d));
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
      dt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // An order "needs triage" when it has not been routed yet — no fulfillment map
  // and it's still in an early, non-terminal status. Mirrors the legacy trigger
  // (renderOrderDetail: targetPhaseKey==='confirmed' && !o.fulfillment).
  function needsTriage(o) {
    if (!o || o.fulfillment) return false;
    var s = String(o.status || 'placed').toLowerCase();
    return s === 'placed' || s === 'confirmed' || s === 'pending_payment';
  }
  // Cancellable = the live transition table allows → 'cancelled' (everything but
  // shipped/delivered/cancelled). Reads the app-global ORDER_VALID_TRANSITIONS;
  // falls back to a conservative not-terminal check if it isn't loaded.
  function canCancel(o) {
    var s = String((o && o.status) || 'placed').toLowerCase();
    var tbl = window.ORDER_VALID_TRANSITIONS;
    if (tbl && tbl[s]) return tbl[s].indexOf('cancelled') !== -1;
    return ['shipped', 'delivered', 'cancelled', 'refunded'].indexOf(s) === -1;
  }
  // Per-item default source choice (cosmetic — the reservation core is keyed off
  // the item). Reuses the app-global getItemInventoryStatus when available (it
  // reads the app-wide `inventory` cache populated by attachListeners), else
  // defaults to Build (the legacy autoAction for any non-stock status).
  function itemInvStatus(item) {
    if (typeof window.getItemInventoryStatus === 'function') {
      try { return window.getItemInventoryStatus(item); } catch (e) {}
    }
    return { status: 'unknown', label: 'Inventory unknown', available: 0 };
  }
  function isGiftCardItem(it) { return it && (it.bookingType === 'gift-card' || it.isGiftCard); }

  // The order's authorized refund ceiling, in cents — the amount paid. This is a
  // SUGGESTED DEFAULT only; the CF independently caps the refund at this amount
  // server-side (resolveRefundCeilingCents), so a client mis-read can never
  // over-refund. We never persist this value — it just seeds the form field.
  function orderTotalCents(o) {
    if (!o) return 0;
    if (Number.isFinite(o.totalCents) && o.totalCents > 0) return Math.round(o.totalCents);
    var dollars = window.MastUI.Num.moneyVal(o, 'totalCents', 'total') || 0;
    return Math.round(dollars * 100);
  }
  // Refundable = not already in a refund/cancel terminal state, and there is a
  // positive total to refund. (A 'refunded' order shows the refunded pill, no
  // action.) 'partially_returned' stays refundable so a second partial refund can
  // be issued — the CF caps it.
  function canRefundOrder(o) {
    if (!o) return false;
    var s = String(o.status || '').toLowerCase();
    if (s === 'refunded' || s === 'cancelled') return false;
    return orderTotalCents(o) > 0;
  }

  // Reload the V2 cache, then re-open the order detail from fresh data so the
  // header badge + all panes reflect the new status (mirrors procurement-v2's
  // reloadThenOpen + the engine's own post-transition reopen).
  function reloadThenOpen(orderId) {
    var acc = window.MastDB && MastDB.orders;
    if (!acc || typeof acc.get !== 'function') { if (window.OrdersV2) OrdersV2.open(orderId); return Promise.resolve(); }
    return Promise.resolve(acc.get(orderId)).then(function (o) {
      var rec = o ? Object.assign({ _key: orderId }, o) : (V2.byId[orderId] || null);
      if (rec) {
        V2.byId[orderId] = rec;
        // Keep the LIST row + pill counts in lockstep with the detail. The live
        // listener also catches this, but a server-side status flip (a refund →
        // partially_returned) can lag; patching the row here makes the list and
        // the slide-out agree immediately instead of disagreeing until the
        // listener fires.
        var i = -1;
        for (var j = 0; j < V2.rows.length; j++) { if (V2.rows[j]._key === orderId) { i = j; break; } }
        if (i >= 0) V2.rows[i] = rec; else V2.rows.push(rec);
        render();
        window.MastEntity.openRecord('orders-v2', rec, 'read');
      }
    });
  }

  // Production requests created for build items — read-only reflection so the
  // operator sees that triage created build jobs (admin/buildJobs). Reads the
  // app-global productionRequests cache; absent when the production route hasn't
  // loaded, in which case we just show a hint that builds were queued.
  function renderProductionRequests(r) {
    var orderId = r._key || r.id;
    var prCache = window.productionRequests;
    var rows = [];
    if (prCache && typeof prCache === 'object') {
      Object.keys(prCache).forEach(function (k) {
        var pr = prCache[k];
        if (!pr || pr.orderId !== orderId) return;
        if (pr.productId && String(pr.productId).indexOf('gift-card') === 0) return;
        rows.push(pr);
      });
    }
    if (!rows.length) {
      // No cache (or none yet). If the order routed build items, say so.
      var hasBuild = r.fulfillment && Object.keys(r.fulfillment).some(function (k) { return r.fulfillment[k] && r.fulfillment[k].source === 'build'; });
      if (!hasBuild) return '';
      return '<span class="mu-sub">Build items were queued to production (admin/buildJobs).</span>';
    }
    return rows.map(function (pr) {
      var st = pr.status || 'pending';
      return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));font-size:0.85rem;">' +
        '<span>' + esc(pr.productName || pr.productId || 'Item') + ' <span class="mu-sub">x' + (pr.qty || 1) + '</span></span>' +
        '<span>' + window.MastUI.badge(st.replace(/[-_]/g, ' '), st === 'fulfilled' ? 'success' : st === 'cancelled' ? 'neutral' : 'amber') + '</span>' +
      '</div>';
    }).join('');
  }

  // ── Actions pane: triage / cancel / note ─────────────────────────────────
  function renderActionsPane(UI, r, orderId) {
    var blocks = '';
    var ungated = '<div class="mu-sub" style="padding:6px 0;">You don\'t have permission to edit orders.</div>';

    // 1) Triage / route & confirm — only when the order still needs routing.
    if (needsTriage(r)) {
      var triageInner = canEdit()
        ? '<div class="mu-sub" style="margin-bottom:10px;">This order hasn\'t been routed yet. Confirm it to reserve stock and send build items to production.</div>' +
          '<button class="btn btn-primary btn-small" onclick="OrdersV2Actions.openTriage(\'' + esc(orderId) + '\')">Confirm order…</button>'
        : ungated;
      blocks += UI.card('Confirm & route', triageInner);
    }

    // 2) Order note — internal note list + add field.
    blocks += UI.card('Internal note', renderNotes(r, orderId));

    // 3) Cancel order.
    if (canCancel(r)) {
      var cancelInner = canEdit()
        ? '<div class="mu-sub" style="margin-bottom:10px;">Cancelling releases committed inventory, cancels open production requests, and opens a CS ticket.</div>' +
          '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="OrdersV2Actions.openCancel(\'' + esc(orderId) + '\')">Cancel order…</button>'
        : ungated;
      blocks += UI.card('Cancel order', cancelInner);
    }

    // 4) Issue refund — gated on hasPermission('rma','approve') (the same server
    // key the CF enforces). Money moves ONLY inside the transitionRma CF, which
    // caps the amount server-side. Already-refunded orders show their pill, no
    // action. The card is HIDDEN (not shown-disabled) for non-approvers.
    if (canRefundOrder(r) && canRefund()) {
      var status = String(r.status || '').toLowerCase();
      var partialNote = status === 'partially_returned'
        ? '<div class="mu-sub" style="margin-bottom:10px;color:var(--amber);">This order is partially returned — an additional refund will be capped at the remaining authorized amount.</div>'
        : '';
      var refundInner = partialNote +
        '<div class="mu-sub" style="margin-bottom:10px;">Issues a refund (store credit or original payment) to the customer. The amount is capped at the order total. This moves money — confirm before issuing.</div>' +
        '<button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="OrdersV2Actions.openRefund(\'' + esc(orderId) + '\')">Issue refund…</button>';
      blocks += UI.card('Issue refund', refundInner);
    }
    return blocks;
  }

  // Notes (shape-aware): array form OR tenant-MCP map shape ({noteId:{text,at,by}}).
  function renderNotes(r, orderId) {
    var raw = r.notes;
    var arr = Array.isArray(raw)
      ? raw.slice()
      : (raw && typeof raw === 'object'
        ? Object.keys(raw).map(function (k) { var n = raw[k] || {}; return { text: n.text, at: n.at, by: n.by }; })
        : []);
    arr.sort(function (a, b) { return String(a.at || '').localeCompare(String(b.at || '')); });
    var list = arr.map(function (n) {
      return '<div style="padding:6px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));">' +
        '<div class="mu-sub">' + esc(fmtDateTime(n.at)) + (n.by ? ' · ' + esc(window.MastUI.Num.actorName(n.by)) : '') + '</div>' +
        '<div style="font-size:0.85rem;color:var(--warm-gray);">' + esc(n.text || '') + '</div>' +
      '</div>';
    }).join('');
    var input = canEdit()
      ? '<div style="display:flex;gap:8px;margin-top:10px;">' +
          '<input type="text" id="ordersV2Note_' + esc(orderId) + '" class="form-input" placeholder="Add an internal note…" style="flex:1;font-size:0.85rem;">' +
          '<button class="btn btn-secondary btn-small" onclick="OrdersV2Actions.addNote(\'' + esc(orderId) + '\')">Add</button>' +
        '</div>'
      : '';
    return (list ? '<div style="margin-bottom:4px;">' + list + '</div>' : '<span class="mu-sub">No notes yet.</span>') + input;
  }

  // ── Email pane: history (newest-first) + resend + ad-hoc send ─────────────
  function renderEmailPane(r, orderId) {
    var status = String(r.status || 'placed').toLowerCase();
    var hasEmail = !!r.email;
    var sendBtns = '';
    if (canEdit() && hasEmail) {
      // Contextual transactional resends (mirror the legacy detail buttons).
      if (['confirmed', 'building', 'pack', 'packing', 'packed'].indexOf(status) !== -1) {
        sendBtns += '<button class="btn btn-secondary btn-small" onclick="OrdersV2Actions.sendType(\'' + esc(orderId) + '\',\'confirmed\')">Send confirmation</button> ';
      }
      if ((status === 'shipped' || status === 'delivered') && r.tracking && r.tracking.trackingNumber) {
        sendBtns += '<button class="btn btn-secondary btn-small" onclick="OrdersV2Actions.sendType(\'' + esc(orderId) + '\',\'shipped\')">Send shipping notification</button> ';
      }
      sendBtns += '<button class="btn btn-secondary btn-small" onclick="OrdersV2Actions.toggleAdhoc(\'' + esc(orderId) + '\')">Send custom email…</button>';
    } else if (!hasEmail) {
      sendBtns = '<span class="mu-sub">No customer email on file.</span>';
    } else {
      sendBtns = '<span class="mu-sub">You don\'t have permission to email customers.</span>';
    }
    var adhoc = (canEdit() && hasEmail)
      ? '<div id="ordersV2Adhoc_' + esc(orderId) + '" style="display:none;margin-top:12px;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));padding-top:12px;">' +
          '<input type="text" id="ordersV2AdhocSubject_' + esc(orderId) + '" class="form-input" placeholder="Subject" style="width:100%;font-size:0.85rem;margin-bottom:8px;">' +
          '<textarea id="ordersV2AdhocBody_' + esc(orderId) + '" class="form-input" rows="4" placeholder="Message body (plain text — wrapped in your branded template)" style="width:100%;font-size:0.85rem;"></textarea>' +
          '<div style="display:flex;gap:8px;margin-top:8px;">' +
            '<button class="btn btn-primary btn-small" onclick="OrdersV2Actions.sendAdhoc(\'' + esc(orderId) + '\')">Send</button>' +
            '<button class="btn btn-secondary btn-small" onclick="OrdersV2Actions.toggleAdhoc(\'' + esc(orderId) + '\')">Cancel</button>' +
          '</div>' +
        '</div>'
      : '';
    return '<div style="margin-bottom:12px;">' + sendBtns + '</div>' + adhoc +
      '<div id="ordersV2EmailList_' + esc(orderId) + '"><span class="mu-sub">Loading email history…</span></div>';
  }
  function loadEmailHistory(orderId) {
    if (!window.OrdersBridge || typeof OrdersBridge.listEmails !== 'function') return;
    Promise.resolve(OrdersBridge.listEmails(orderId)).then(function (emails) {
      var el = document.getElementById('ordersV2EmailList_' + orderId);
      if (!el) return;
      if (!emails || !emails.length) { el.innerHTML = '<span class="mu-sub">No emails sent for this order yet.</span>'; return; }
      el.innerHTML = '<div style="font-size:0.78rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:6px;">Email history (' + emails.length + ')</div>' +
        emails.map(function (em) {
          var sent = em.status === 'sent';
          var typeLabel = String(em.emailType || 'unknown').replace(/^order_/, '').replace(/_/g, ' ');
          typeLabel = typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1);
          var resend = canEdit()
            ? ' <button class="btn btn-secondary btn-small" style="padding:2px 8px;font-size:0.72rem;" onclick="OrdersV2Actions.resend(\'' + esc(em._key) + '\',\'' + esc(orderId) + '\')">Resend</button>'
            : '';
          return '<div style="padding:8px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));font-size:0.85rem;">' +
            '<div style="display:flex;justify-content:space-between;gap:12px;align-items:center;">' +
              '<span>' + esc(em.subject || '(no subject)') + '</span>' +
              window.MastUI.badge((sent ? '✓ ' : '✗ ') + (em.status || ''), sent ? 'success' : 'danger') +
            '</div>' +
            '<div class="mu-sub">' + esc(typeLabel) + ' · ' + esc(em.to || '') + ' · ' + esc(fmtDateTime(em.createdAt)) + resend + '</div>' +
          '</div>';
        }).join('');
    }).catch(function (e) {
      var el = document.getElementById('ordersV2EmailList_' + orderId);
      if (el) el.innerHTML = '<span style="color:var(--danger);font-size:0.85rem;">Failed to load emails: ' + esc(e && e.message || e) + '</span>';
    });
  }

  // Refresh the email pane in place (after a send) without reopening the panel.
  function refreshEmailPane(orderId) {
    var pane = document.getElementById('ordersV2EmailPane_' + orderId);
    var rec = V2.byId[orderId];
    if (pane && rec) { pane.innerHTML = renderEmailPane(rec, orderId); loadEmailHistory(orderId); }
  }

  // window.OrdersBridge is now defined in THIS module's IIFE (absorbed from
  // orders.js in T6 PR3 — orders-v2 is the live Orders surface and owns the
  // write bridge). It's assigned synchronously at module load, so it is always
  // present before any action handler fires. Kept as a Promise-returning helper
  // so the call sites (then-chains) are untouched.
  function ensureBridge() {
    return Promise.resolve(window.OrdersBridge || null);
  }

  // ── Triage form (per-item Stock vs Build source picker) ───────────────────
  function openTriageForm(orderId) {
    var r = V2.byId[orderId];
    if (!r) return;
    var U = window.MastUI;
    var items = (r.items || []);
    var rows = items.map(function (it, idx) {
      var qty = it.qty || 1;
      var optStr = '';
      if (it.options && typeof it.options === 'object') {
        optStr = Object.keys(it.options).map(function (k) { return k + ': ' + it.options[k]; }).join(', ');
      }
      var name = '<div style="font-weight:500;font-size:0.85rem;">' + esc(it.productName || it.name || 'Item') + ' <span class="mu-sub">x' + qty + '</span></div>' +
        (optStr ? '<div class="mu-sub">' + esc(optStr) + '</div>' : '');
      if (isGiftCardItem(it)) {
        // Digital — auto-fulfilled, no physical triage. No picker row.
        return '<div style="display:grid;grid-template-columns:2fr 1fr;gap:12px;padding:10px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));align-items:center;">' +
          '<div>' + name + '</div>' +
          '<div class="mu-sub" style="color:var(--teal);">Digital · emailed to recipient</div>' +
        '</div>';
      }
      var inv = itemInvStatus(it);
      var isBackorder = !!it.backorder;
      var disableStock = (inv.status === 'out' || inv.status === 'build');
      var defStock = (inv.status === 'stock');
      var tone = inv.status === 'stock' ? 'success' : inv.status === 'partial' ? 'amber' : inv.status === 'out' ? 'danger' : 'neutral';
      var invLabel = inv.label || '';
      var picker;
      if (isBackorder) {
        // Tier 2 resold backorder: covered by an incoming PO, so it's not "out",
        // it's on its way. Default to "Backorder · awaiting PO" (records a
        // fulfillment source with NO build job; the order holds in Confirmed
        // until the covering PO is received). Stock stays disabled (out); "Send
        // to build" remains a manual override but is no longer the default.
        var shipsBy = it.shipsByText || (it.shipsByDate ? ('Ships by ' + (U.Num.date(it.shipsByDate) || '')) : '');
        invLabel = 'Backorder' + (shipsBy ? ' · ' + shipsBy : '');
        tone = 'amber';
        picker = '<label style="margin-right:14px;font-size:0.85rem;cursor:pointer;">' +
            '<input type="radio" name="ordersV2Triage_' + idx + '" value="stock" disabled style="margin-right:4px;">From stock' +
          '</label>' +
          '<label style="margin-right:14px;font-size:0.85rem;cursor:pointer;">' +
            '<input type="radio" name="ordersV2Triage_' + idx + '" value="backorder" checked style="margin-right:4px;">Backorder · awaiting PO' +
          '</label>' +
          '<label style="font-size:0.85rem;cursor:pointer;">' +
            '<input type="radio" name="ordersV2Triage_' + idx + '" value="build" style="margin-right:4px;">Send to build' +
          '</label>';
      } else {
        picker = '<label style="margin-right:14px;font-size:0.85rem;cursor:pointer;">' +
            '<input type="radio" name="ordersV2Triage_' + idx + '" value="stock" ' + (defStock ? 'checked' : '') + (disableStock ? ' disabled' : '') + ' style="margin-right:4px;">From stock' +
          '</label>' +
          '<label style="font-size:0.85rem;cursor:pointer;">' +
            '<input type="radio" name="ordersV2Triage_' + idx + '" value="build" ' + (!defStock ? 'checked' : '') + ' style="margin-right:4px;">Send to build' +
          '</label>';
      }
      return '<div style="display:grid;grid-template-columns:2fr 1fr 1.4fr;gap:12px;padding:10px 0;border-top:1px solid var(--cream-dark,rgba(127,127,127,.18));align-items:center;">' +
        '<div>' + name + '</div>' +
        '<div>' + U.badge(esc(invLabel), tone) + '</div>' +
        '<div>' + picker + '</div>' +
      '</div>';
    }).join('');
    var head = '<div style="display:grid;grid-template-columns:2fr 1fr 1.4fr;gap:12px;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;color:var(--warm-gray);padding-bottom:4px;"><span>Item</span><span>Inventory</span><span>Source</span></div>';
    var body = U.card('Route & confirm order ' + esc(getDisplayNum(r)),
      '<div class="mu-sub" style="margin-bottom:10px;">Choose how to fulfill each item. Stock items reserve inventory; build items create production requests and move the order to Building; backorder items wait for the incoming PO — the order holds in Confirmed until stock arrives.</div>' +
      head + rows);
    U.slideOut.open({
      id: 'triage-' + orderId, title: 'Confirm order', subtitle: esc(getDisplayNum(r)), size: 'lg',
      mode: 'create', deepLink: false, createLabel: 'Confirm & route',
      render: function () { return body; },
      isDirty: function () { return true; },
      onSave: function () { return submitTriage(orderId); }
    });
  }
  function submitTriage(orderId) {
    if (!canEdit()) { toast('You don\'t have permission to edit orders.', true); return false; }
    var r = V2.byId[orderId];
    if (!r) return false;
    var bodyEl = document.getElementById('mastSlideOutBody');
    if (!bodyEl) return false;
    var itemActions = [];
    (r.items || []).forEach(function (it, idx) {
      if (isGiftCardItem(it)) return; // digital — not triaged
      var action = it.backorder ? 'backorder' : 'build';
      var radios = bodyEl.querySelectorAll('input[name="ordersV2Triage_' + idx + '"]');
      for (var i = 0; i < radios.length; i++) { if (radios[i].checked) { action = radios[i].value; break; } }
      itemActions.push({ item: it, action: action });
    });
    ensureBridge().then(function (bridge) {
      if (!bridge || typeof bridge.triageConfirm !== 'function') { toast('Orders engine still loading — try again', true); return; }
      return Promise.resolve(bridge.triageConfirm(orderId, itemActions, r)).then(function () {
        var built = itemActions.filter(function (ia) { return ia.action === 'build'; }).length;
        var backordered = itemActions.filter(function (ia) { return ia.action === 'backorder'; }).length;
        var msg;
        if (built) msg = 'Order confirmed — ' + MastFormat.countNoun(built, 'item') + ' sent to production';
        else if (backordered) msg = 'Order confirmed — held for back-ordered stock (' + MastFormat.countNoun(backordered, 'item') + ')';
        else msg = 'Order confirmed and routed to packing';
        toast(msg);
        window.MastUI.slideOut.requestCloseForce();
        return reloadThenOpen(orderId);
      });
    }).catch(function (e) { toast('Could not confirm order: ' + (e && e.message || e), true); });
    return false;
  }

  // ── Cancel form (reason required) ─────────────────────────────────────────
  function openCancelForm(orderId) {
    var r = V2.byId[orderId];
    if (!r) return;
    var U = window.MastUI;
    var body = U.card('Cancel order ' + esc(getDisplayNum(r)),
      '<div class="mu-sub" style="margin-bottom:10px;">This releases committed inventory, cancels open production requests, closes the order, and opens a CS ticket.</div>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;">Reason' +
        '<textarea id="ordersV2CancelReason" class="form-input" rows="3" placeholder="Why is this order being cancelled?" style="width:100%;margin-top:4px;font-size:0.85rem;"></textarea>' +
      '</label>');
    U.slideOut.open({
      id: 'cancel-' + orderId, title: 'Cancel order', subtitle: esc(getDisplayNum(r)), size: 'md',
      mode: 'create', deepLink: false, createLabel: 'Cancel order',
      render: function () { return body; },
      isDirty: function () { return true; },
      onSave: function () { return submitCancel(orderId); }
    });
  }
  function submitCancel(orderId) {
    if (!canEdit()) { toast('You don\'t have permission to edit orders.', true); return false; }
    var r = V2.byId[orderId];
    if (!r) return false;
    var el = document.getElementById('ordersV2CancelReason');
    var reason = el ? el.value.trim() : '';
    if (!reason) { toast('Please enter a cancellation reason', true); return false; }
    ensureBridge().then(function (bridge) {
      if (!bridge || typeof bridge.cancelOrder !== 'function') { toast('Orders engine still loading — try again', true); return; }
      return Promise.resolve(bridge.cancelOrder(orderId, reason, r)).then(function () {
        toast('Order cancelled — inventory released and a CS ticket was opened');
        window.MastUI.slideOut.requestCloseForce();
        return reloadThenOpen(orderId);
      });
    }).catch(function (e) { toast('Could not cancel order: ' + (e && e.message || e), true); });
    return false;
  }

  // ── Refund form (amount + method) ─────────────────────────────────────────
  // A small form, NOT a returns-management UI: amount (defaults to the order
  // total — the CF caps it regardless) + method (original payment / store
  // credit). Submit → OrdersBridge.issueRefund, which creates the intent RMA and
  // drives the hardened transitionRma CF to issue the money. NO client money-write.
  function openRefundForm(orderId) {
    var r = V2.byId[orderId];
    if (!r) return;
    var U = window.MastUI;
    // Client-side refundable ceiling = the order total (the server resolves the
    // TRUE remaining ceiling via resolveRefundCeilingCents — e.g. less on a
    // partially_returned order). We seed + cap the field at the order total so an
    // obviously-over-amount entry is rejected here, BEFORE submitRefund drives the
    // RMA lifecycle — otherwise the lifecycle (approve→received→inspect) runs and
    // only the final 'complete' CF rejects, leaving an orphaned stuck RMA. The CF
    // still caps server-side as defense-in-depth.
    var maxCents = orderTotalCents(r);
    var maxDollars = (maxCents / 100).toFixed(2);
    var defaultDollars = maxDollars;
    var body = U.card('Issue refund for order ' + esc(getDisplayNum(r)),
      '<div class="mu-sub" style="margin-bottom:12px;">The refund is processed server-side and capped at the order total (' + esc(U.Num.money(maxCents / 100) || '$0.00') + '). Store credit lands in the customer wallet instantly; original payment queues a refund request for processing.</div>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:12px;">Refund amount ($)' +
        '<input type="number" id="ordersV2RefundAmount" class="form-input" min="0" max="' + esc(maxDollars) + '" step="0.01" value="' + esc(defaultDollars) + '" style="width:100%;margin-top:4px;font-size:0.85rem;">' +
      '</label>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;margin-bottom:12px;">Method' +
        '<select id="ordersV2RefundMethod" class="form-input" style="width:100%;margin-top:4px;font-size:0.85rem;">' +
          '<option value="credit-card">Original payment</option>' +
          '<option value="store-credit">Store credit</option>' +
        '</select>' +
      '</label>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;">Reason (optional)' +
        '<textarea id="ordersV2RefundReason" class="form-input" rows="2" placeholder="Why is this refund being issued?" style="width:100%;margin-top:4px;font-size:0.85rem;"></textarea>' +
      '</label>');
    U.slideOut.open({
      id: 'refund-' + orderId, title: 'Issue refund', subtitle: esc(getDisplayNum(r)), size: 'md',
      mode: 'create', deepLink: false, createLabel: 'Issue refund',
      render: function () { return body; },
      isDirty: function () { return true; },
      onSave: function () { return submitRefund(orderId); }
    });
  }
  // Track in-flight refunds so a double-click (or a second slide-out Save) can't
  // fire a second issueRefund while the first CF chain is still running. The CF
  // is also idempotent (atomic status claim), but the client guard prevents the
  // common double-submit before the network round-trips even start.
  var _refundInFlight = {};
  function submitRefund(orderId) {
    if (!canRefund()) { toast('You don\'t have permission to issue refunds.', true); return false; }
    var r = V2.byId[orderId];
    if (!r) return false;
    if (_refundInFlight[orderId]) { toast('A refund is already being processed for this order…', true); return false; }
    var amtEl = document.getElementById('ordersV2RefundAmount');
    var methodEl = document.getElementById('ordersV2RefundMethod');
    var reasonEl = document.getElementById('ordersV2RefundReason');
    var amountCents = amtEl ? Math.round(parseFloat(amtEl.value) * 100) : NaN;
    if (!Number.isFinite(amountCents) || amountCents <= 0) { toast('Enter a refund amount greater than $0.', true); return false; }
    // Reject an over-amount entry HERE, before the RMA lifecycle is driven. An
    // amount above the order total would only be caught by the final 'complete'
    // CF — by then approve→received→inspect have already run, orphaning a stuck
    // RMA (no money moves, but a junk record). The order total is the client-side
    // ceiling; the CF re-caps at the true remaining amount as defense-in-depth.
    var maxCents = orderTotalCents(r);
    if (maxCents > 0 && amountCents > maxCents) {
      var maxLabel = window.MastUI.Num.money(maxCents / 100) || ('$' + (maxCents / 100).toFixed(2));
      toast('Refund amount can\'t exceed the order total (' + maxLabel + ').', true);
      return false;
    }
    var method = methodEl && methodEl.value === 'store-credit' ? 'store-credit' : 'credit-card';
    var reason = reasonEl ? reasonEl.value.trim() : '';
    var methodLabel = method === 'store-credit' ? 'store credit' : 'original payment';
    var amountLabel = window.MastUI.Num.money(amountCents / 100) || ('$' + (amountCents / 100).toFixed(2));
    // Money-movement confirmation (outward-facing) — routed through the canonical
    // mastConfirm rich modal, never a native browser dialog (UX standards 02 §3).
    confirmThen('Issue a ' + amountLabel + ' refund to ' + (r.email || 'the customer') + ' as ' + methodLabel + '? This moves money and cannot be undone here.',
      function () {
        // Re-entry guard: the in-flight flag is the authoritative double-submit
        // stop (submitRefund early-returns while set, and the CF is itself
        // idempotent via an atomic status claim). The footer-button disable below
        // is just the visible pending state.
        if (_refundInFlight[orderId]) { toast('A refund is already being processed for this order…', true); return; }
        _refundInFlight[orderId] = true;
        // Disable the slide-out footer primary button + show pending text. The
        // footer is the canonical #mastSlideOutFooter shell; the Save action is its
        // primary button. Restored on failure (close-on-success drops it).
        var foot = document.getElementById('mastSlideOutFooter');
        var saveBtn = foot ? (foot.querySelector('.btn-primary') || foot.querySelector('button:last-child')) : null;
        var prevLabel = saveBtn ? saveBtn.textContent : '';
        if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Issuing…'; }
        toast('Issuing refund…');
        ensureBridge().then(function (bridge) {
          if (!bridge || typeof bridge.issueRefund !== 'function') { toast('Orders engine still loading — try again', true); return; }
          return Promise.resolve(bridge.issueRefund(orderId, { amountCents: amountCents, method: method, reason: reason }, r)).then(function () {
            toast('Refund issued — ' + amountLabel + ' as ' + methodLabel);
            window.MastUI.slideOut.requestCloseForce();
            return reloadThenOpen(orderId);
          });
        }).catch(function (e) {
          toast('Could not issue refund: ' + (e && e.message || e), true);
          if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = prevLabel || 'Issue refund'; }
        }).then(function () { delete _refundInFlight[orderId]; });
      },
      { title: 'Issue refund', confirmLabel: 'Issue refund' });
    return false; // keep the slide-out open; the confirm + CF own the close
  }

  // ── Public action handlers (referenced by the rendered HTML) ──────────────
  window.OrdersV2Actions = {
    openTriage: function (orderId) {
      if (!canEdit()) { toast('You don\'t have permission to edit orders.', true); return; }
      ensureBridge().then(function () { openTriageForm(orderId); });
    },
    openCancel: function (orderId) {
      if (!canEdit()) { toast('You don\'t have permission to edit orders.', true); return; }
      ensureBridge().then(function () { openCancelForm(orderId); });
    },
    openRefund: function (orderId) {
      if (!canRefund()) { toast('You don\'t have permission to issue refunds.', true); return; }
      ensureBridge().then(function () { openRefundForm(orderId); });
    },
    addNote: function (orderId) {
      if (!canEdit()) { toast('You don\'t have permission to edit orders.', true); return; }
      var input = document.getElementById('ordersV2Note_' + orderId);
      if (!input) return;
      var text = input.value.trim();
      if (!text) return;
      var r = V2.byId[orderId];
      ensureBridge().then(function (bridge) {
        if (!bridge || typeof bridge.addNote !== 'function') { toast('Orders engine still loading — try again', true); return; }
        return Promise.resolve(bridge.addNote(orderId, text, r)).then(function () {
          toast('Note added');
          input.value = '';
          return reloadThenOpen(orderId);
        });
      }).catch(function (e) { toast('Could not add note: ' + (e && e.message || e), true); });
    },
    toggleAdhoc: function (orderId) {
      var el = document.getElementById('ordersV2Adhoc_' + orderId);
      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
    },
    // Transactional resend by emailType (confirmed/shipped). Confirm first — it
    // sends a real email to the customer.
    sendType: function (orderId, emailType) {
      if (!canEdit()) { toast('You don\'t have permission to email customers.', true); return; }
      var r = V2.byId[orderId] || {};
      var label = emailType === 'shipped' ? 'shipping notification' : (emailType === 'confirmed' ? 'order confirmation' : emailType + ' email');
      confirmThen('Send the ' + label + ' email to ' + (r.email || 'the customer') + '?', function () {
        ensureBridge().then(function (bridge) {
          if (!bridge || typeof bridge.sendEmail !== 'function') { toast('Orders engine still loading — try again', true); return; }
          toast('Sending ' + label + '…');
          return Promise.resolve(bridge.sendEmail(orderId, { emailType: emailType })).then(function (res) {
            toast('Email sent to ' + ((res && res.data && res.data.sentTo) || r.email || 'customer'));
            setTimeout(function () { refreshEmailPane(orderId); }, 1500);
          });
        }).catch(function (e) { toast('Failed to send email: ' + (e && e.message || e), true); });
      });
    },
    sendAdhoc: function (orderId) {
      if (!canEdit()) { toast('You don\'t have permission to email customers.', true); return; }
      var subjEl = document.getElementById('ordersV2AdhocSubject_' + orderId);
      var bodyEl = document.getElementById('ordersV2AdhocBody_' + orderId);
      if (!subjEl || !bodyEl) return;
      var subject = subjEl.value.trim(), body = bodyEl.value.trim();
      if (!subject || !body) { toast('Subject and body are required', true); return; }
      var r = V2.byId[orderId] || {};
      confirmThen('Send this custom email to ' + (r.email || 'the customer') + '?', function () {
        ensureBridge().then(function (bridge) {
          if (!bridge || typeof bridge.sendEmail !== 'function') { toast('Orders engine still loading — try again', true); return; }
          toast('Sending custom email…');
          return Promise.resolve(bridge.sendEmail(orderId, { subject: subject, body: body })).then(function (res) {
            toast('Custom email sent to ' + ((res && res.data && res.data.sentTo) || r.email || 'customer'));
            subjEl.value = ''; bodyEl.value = '';
            OrdersV2Actions.toggleAdhoc(orderId);
            setTimeout(function () { refreshEmailPane(orderId); }, 1500);
          });
        }).catch(function (e) { toast('Failed to send: ' + (e && e.message || e), true); });
      });
    },
    // Resend a logged email. The bridge's listEmails is read-only; resending a
    // transactional log re-fires its emailType, else re-sends as a custom note.
    resend: function (emailKey, orderId) {
      if (!canEdit()) { toast('You don\'t have permission to email customers.', true); return; }
      confirmThen('Resend this email to the customer?', function () {
        ensureBridge().then(function (bridge) {
          if (!bridge) { toast('Orders engine still loading — try again', true); return; }
          toast('Resending email…');
          return Promise.resolve(bridge.listEmails(orderId)).then(function (emails) {
            var em = (emails || []).filter(function (e) { return e._key === emailKey; })[0] || {};
            var opts;
            if (em.emailType && String(em.emailType).indexOf('order_') === 0 && em.emailType !== 'order_custom') {
              opts = { emailType: String(em.emailType).replace('order_', '') };
            } else {
              opts = { subject: em.subject || 'Re-sent email', body: '(This is a re-send of a previous email)' };
            }
            return Promise.resolve(bridge.sendEmail(orderId, opts)).then(function (res) {
              toast('Email re-sent to ' + ((res && res.data && res.data.sentTo) || 'customer'));
              setTimeout(function () { refreshEmailPane(orderId); }, 1500);
            });
          });
        }).catch(function (e) { toast('Failed to resend: ' + (e && e.message || e), true); });
      });
    }
  };

  // Confirm helper — the canonical mastConfirm rich modal (never a native dialog,
  // per UX standards 02 §3). If mastConfirm somehow isn't loaded, proceed (the
  // running app always ships it; this guard only avoids a hard throw). opts
  // overrides the default {title, confirmLabel} (the email actions keep the
  // default; the bulk actions pass their own).
  function confirmThen(msg, fn, opts) {
    var o = Object.assign({ title: 'Send customer email', confirmLabel: 'Send' }, opts || {});
    if (typeof window.mastConfirm === 'function') {
      Promise.resolve(window.mastConfirm(msg, o)).then(function (ok) { if (ok) fn(); });
    } else { fn(); }
  }

  // Reason capture for bulk cancel. Native browser dialogs are banned (UX
  // standards 02 §3), so render a small reason form in the canonical slide-out
  // shell and invoke the callback with the entered reason on Save. The
  // destructive copy + a required reason is the confirm-equivalent (no separate
  // mastConfirm needed).
  function promptReason(prompt, fn) {
    var U = window.MastUI;
    if (!U || !U.slideOut) {
      // Last-ditch fallback (running app always ships the slide-out): proceed
      // with an empty reason rather than hard-throw.
      fn('');
      return;
    }
    var body = U.card('Cancel orders',
      '<div class="mu-sub" style="margin-bottom:10px;">' + esc(prompt) + '</div>' +
      '<label style="font-size:0.78rem;color:var(--warm-gray);display:block;">Reason' +
        '<textarea id="ordersV2BulkCancelReason" class="form-input" rows="3" placeholder="Why are these orders being cancelled?" style="width:100%;margin-top:4px;font-size:0.85rem;"></textarea>' +
      '</label>');
    U.slideOut.open({
      id: 'bulk-cancel', title: 'Cancel orders', size: 'md',
      mode: 'create', deepLink: false, createLabel: 'Cancel orders',
      render: function () { return body; },
      isDirty: function () { return true; },
      onSave: function () {
        var el = document.getElementById('ordersV2BulkCancelReason');
        var reason = el ? el.value.trim() : '';
        if (!reason) { toast('Please enter a cancellation reason', true); return false; }
        U.slideOut.requestCloseForce();
        fn(reason);
        return false;
      }
    });
  }

  // ── State + data (same source as legacy: admin/orders) ──────────────
  // sel: _key → true (bulk multi-select; mirrors finance-expenses-v2's V2.sel).
  var V2 = { rows: [], byId: {}, sortKey: 'placedAt', sortDir: 'desc', filter: 'all', off: null, sel: {} };

  // Etsy orders ship via Etsy, never from here — carry the legacy bulk
  // mark-shipped skip rule. Native orders set `source:'etsy'`; ingested
  // external orders carry externalSource.platform === 'etsy'.
  function isEtsyOrder(o) {
    if (!o) return false;
    if (o.source === 'etsy') return true;
    return !!(o.externalSource && o.externalSource.platform === 'etsy');
  }

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
      // Drop any selected ids that no longer exist (mirrors finance-expenses-v2).
      Object.keys(V2.sel).forEach(function (id) { if (!V2.byId[id]) delete V2.sel[id]; });
      render();
    };
    // Real source = the orders entity accessor (53 records), NOT raw admin/orders
    // (which holds only QBO-webhook test docs). list() for initial paint; listen()
    // for live updates where available.
    if (typeof o.list === 'function') Promise.resolve(o.list()).then(apply).catch(function (e) { console.error('[orders-v2] list', e); });
    // Live updates: listen(limit, cb) — the callback is the SECOND arg. The
    // prior `o.listen(apply)` passed apply as the limit and dropped the cb, so
    // the list never refreshed after a status change (a refund left the row
    // showing the old status while the detail/oracle moved on — SGTE-0250).
    // Subscribe once; re-subscribing on every load() would leak listeners.
    if (!V2.off && typeof o.listen === 'function') { try { V2.off = o.listen(200, apply); } catch (e) {} }
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.filter && V2.filter !== 'all') {
      if (V2.filter === 'returns') {
        rows = rows.filter(function (r) { return isReturnStatus(r.status); });
      } else {
        rows = rows.filter(function (r) { return String(r.status || '').toLowerCase() === V2.filter; });
      }
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

  // Selected keys that are still visible (legacy caps the batch at 100). Reads
  // from V2.sel; intersects with the currently-visible rows so a filter change
  // never bulk-acts on rows the operator can't see (mirrors finance-expenses-v2
  // selectedVisibleIds).
  function selectedVisibleKeys() {
    return visibleRows().slice(0, 100).filter(function (r) { return V2.sel[r._key]; }).map(function (r) { return r._key; });
  }

  // Bulk action bar (mirrors finance-expenses-v2 bulkBar): mark-shipped / cancel
  // / export over the selected keys, the destructive actions disabled when none
  // selected. RBAC-gated — render nothing for non-editors (the per-row detail
  // actions are gated the same way). The select-all toggle is owned by the
  // engine list header (MastUI.list selectable), so this bar is actions only.
  // Export stays enabled with nothing selected (it falls back to all visible).
  function bulkBar(rows) {
    if (!canEdit()) return '';
    var sel = rows.filter(function (r) { return V2.sel[r._key]; });
    var n = sel.length;
    var dis = n === 0 ? ' disabled' : '';
    return '<div style="display:flex;gap:8px;align-items:center;margin:0 0 10px;flex-wrap:wrap;">' +
      '<span style="font-size:0.85rem;color:var(--warm-gray);">' + (n ? (window.MastUI.Num.count(n) + ' selected') : 'Select rows for bulk actions') + '</span>' +
      '<button class="btn btn-secondary btn-small" id="ordersV2BulkShip" onclick="OrdersV2.bulkMarkShipped()"' + dis + '>Mark shipped' + (n ? ' (' + n + ')' : '') + '</button>' +
      '<button class="btn btn-secondary btn-small" id="ordersV2BulkCancel" style="color:var(--danger);" onclick="OrdersV2.bulkCancel()"' + dis + '>Cancel</button>' +
      '<button class="btn btn-secondary btn-small" onclick="OrdersV2.bulkExportCsv()">↓ Export' + (n ? ' (' + n + ')' : '') + '</button>' +
      '</div>';
  }

  function render() {
    var tab = ensureTab();
    var counts = statusCounts();
    // 'returns' is a GROUPED pill (return lifecycle + partial refunds) so
    // partially_returned orders are filterable — they previously matched no
    // pill at all (SGTE-0250). 'Refunded' keeps its own pill for fully-refunded.
    var returnsCount = RETURN_STATUSES.reduce(function (n, s) { return n + (counts[s] || 0); }, 0);
    var pillDefs = [
      { key: 'all', label: 'All', count: counts.all || 0 },
      { key: 'placed', label: 'Placed', count: counts.placed || 0 },
      { key: 'confirmed', label: 'Confirmed', count: counts.confirmed || 0 },
      { key: 'delivered', label: 'Delivered', count: counts.delivered || 0 },
      { key: 'cancelled', label: 'Cancelled', count: counts.cancelled || 0 },
      { key: 'refunded', label: 'Refunded', count: counts.refunded || 0 },
      { key: 'returns', label: 'Returns', count: returnsCount }
    ];
    var pills = pillDefs.map(function (p) {
      var on = V2.filter === p.key;
      return '<button onclick="OrdersV2.setFilter(\'' + p.key + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p.label + ' <span style="color:var(--warm-gray);">' + p.count + '</span></button>';
    }).join('');

    var rows = visibleRows();
    tab.innerHTML =
      window.MastUI.pageHeader({ title: 'Orders', count: window.MastUI.Num.count(V2.rows.length) + ' orders',
        actionsHtml: '<button class="btn btn-secondary" onclick="OrdersV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin:14px 0;">' + pills + '</div>' +
      bulkBar(rows) +
      window.MastEntity.renderList('orders-v2', {
        rows: rows, sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'OrdersV2.sort', onRowClickFnName: 'OrdersV2.open',
        // Bulk multi-select (editors only) — engine owns the row checkboxes +
        // select-all header (MastUI.list selectable). recordId keys on _key.
        selectable: canEdit(), selectedIds: V2.sel,
        onSelectFnName: 'OrdersV2.toggleRow', onSelectAllFnName: 'OrdersV2.toggleAll',
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
    exportCsv: function () { return window.MastEntity.exportRows('orders-v2', visibleRows(), V2.filter); },

    // ── Bulk multi-select ───────────────────────────────────────────────
    toggleRow: function (id, checked) {
      if (checked) V2.sel[id] = true; else delete V2.sel[id];
      render();
    },
    toggleAll: function (checked) {
      var vis = visibleRows();
      if (checked) vis.forEach(function (r) { V2.sel[r._key] = true; });
      else vis.forEach(function (r) { delete V2.sel[r._key]; });
      render();
    },
    // Bulk mark-shipped → OrdersBridge.bulkMarkShipped. Each row runs the FULL
    // ship core (statusHistory + onOrderShipped → inventory deduction + customer
    // SHIPPED EMAIL), so this is outward-facing — the confirm makes that clear.
    // Etsy orders are skipped (they ship via Etsy), carrying the legacy rule.
    bulkMarkShipped: function () {
      if (!canEdit()) { toast('You don\'t have permission to edit orders.', true); return; }
      var keys = selectedVisibleKeys();
      if (!keys.length) return;
      var eligible = keys.filter(function (k) { return !isEtsyOrder(V2.byId[k]); });
      var skipped = keys.length - eligible.length;
      if (!eligible.length) { toast('All selected orders are Etsy — they ship via Etsy and were skipped.', true); return; }
      var msg = 'Mark ' + MastFormat.countNoun(eligible.length, 'order') + ' as shipped?' +
        (skipped ? ' (' + MastFormat.countNoun(skipped, 'Etsy order') + ' will be skipped.)' : '') +
        ' This deducts inventory and emails each customer their shipping notification.';
      confirmThen(msg, function () {
        ensureBridge().then(function (bridge) {
          if (!bridge || typeof bridge.bulkMarkShipped !== 'function') { toast('Orders engine still loading — try again', true); return; }
          var btn = document.getElementById('ordersV2BulkShip');
          if (btn) { btn.disabled = true; btn.textContent = 'Marking…'; }
          return Promise.resolve(bridge.bulkMarkShipped(eligible)).then(function (res) {
            res = res || { ok: 0, fail: 0 };
            toast('Marked ' + res.ok + ' shipped' + (res.fail ? ' (' + res.fail + ' failed)' : '') + (skipped ? ' · ' + skipped + ' Etsy skipped' : ''), !!res.fail && !res.ok);
            V2.sel = {};
            load();
          });
        }).catch(function (e) { toast('Could not mark shipped: ' + (e && e.message || e), true); load(); });
      }, { title: 'Mark orders shipped', confirmLabel: 'Mark shipped' });
    },
    // Bulk cancel → OrdersBridge.bulkCancel(keys, reason). Each row runs the FULL
    // cancel core (release inventory + cancel open buildJobs + MastFlow close + CS
    // ticket). Reason is prompted once and applied to every row. Confirm first —
    // these fire real side-effects and cannot be undone via this dialog.
    bulkCancel: function () {
      if (!canEdit()) { toast('You don\'t have permission to edit orders.', true); return; }
      var keys = selectedVisibleKeys();
      if (!keys.length) return;
      promptReason('Cancel ' + MastFormat.countNoun(keys.length, 'order') + '? This releases committed inventory, cancels open production requests, and opens a CS ticket for each. Enter a cancellation reason:', function (reason) {
        ensureBridge().then(function (bridge) {
          if (!bridge || typeof bridge.bulkCancel !== 'function') { toast('Orders engine still loading — try again', true); return; }
          var btn = document.getElementById('ordersV2BulkCancel');
          if (btn) { btn.disabled = true; btn.textContent = 'Cancelling…'; }
          return Promise.resolve(bridge.bulkCancel(keys, reason)).then(function (res) {
            res = res || { ok: 0, fail: 0 };
            toast('Cancelled ' + res.ok + (res.fail ? ' (' + res.fail + ' failed)' : ''), !!res.fail && !res.ok);
            V2.sel = {};
            load();
          });
        }).catch(function (e) { toast('Could not cancel: ' + (e && e.message || e), true); load(); });
      });
    },
    // Bulk CSV export (client) → twin's MastEntity.exportRows. Exports the
    // selected rows when any are selected, else all currently-visible rows
    // (mirrors the legacy bulkOrdersExportCsv fallback). No writes, no confirm.
    bulkExportCsv: function () {
      var keys = selectedVisibleKeys();
      var rows = keys.length ? keys.map(function (k) { return V2.byId[k]; }).filter(Boolean) : visibleRows();
      if (!rows.length) { toast('No orders to export.', true); return; }
      return window.MastEntity.exportRows('orders-v2', rows, V2.filter);
    }
  };

  // ============================================================
  // OrdersBridge — data-object entry to the SAME order write cores
  // ============================================================
  //
  // Orders is the DEFAULT admin screen and the orders-v2 redesign twin (later
  // PRs) is a Process surface that must NOT reimplement the inventory /
  // production-request / refund / cancellation / note logic — a second copy
  // would drift from the legacy detail screen on the most-trafficked surface.
  // This bridge exposes those write actions parameterized by data (the legacy
  // detail handlers read the form DOM, so they can't be called with an object).
  // It mirrors window.CommissionsBridge / window.ProductionBridge: thin,
  // additive, delegates to the shared cores extracted above. It changes NO
  // behavior on the legacy surface — the legacy detail handlers now call the
  // same cores, so V1 and V2 share ONE byte-identical Firestore write path.
  //
  // The cores read the live record from the global `orders` cache (keyed by
  // _key — the order id). When the twin drives the flow, the legacy orders
  // listener may not have populated that cache, so each bridge method seeds it
  // from the supplied record (or a fresh single-record fetch) before calling
  // the core. Refund (PR5) is the one bridge method that does NOT touch an
  // orders.js core — money movement is the CF's job, so issueRefund delegates
  // straight to the hardened transitionRma CF (create intent RMA → drive the
  // lifecycle → complete with refundAllocation), and the CF keeps its separate
  // hasPermission('rma','approve') server gate. There is no extra RBAC gate
  // inside the bridge: the twin gates can('orders','edit') / can('rma','approve')
  // before invoking, matching the CommissionsBridge model.
  function _ordersBridgeSeed(orderId, record) {
    if (record && typeof record === 'object') {
      var prev = orders[orderId] || {};
      orders[orderId] = Object.assign({}, prev, record, { _key: orderId });
      return Promise.resolve(orders[orderId]);
    }
    if (orders[orderId]) return Promise.resolve(orders[orderId]);
    return Promise.resolve(MastDB.orders.get(orderId)).then(function (o) {
      orders[orderId] = Object.assign({ _key: orderId }, o || {});
      return orders[orderId];
    });
  }

  window.OrdersBridge = {
    // triageConfirm(orderId, itemActions, record?) → void. itemActions carries
    // the per-item source choices the legacy triage DOM used to supply:
    // [{ item, action:'stock'|'build' }]. Applies per-item fulfillment source,
    // reserveInventory for stock items, createProductionRequests (admin/buildJobs
    // status:'pending', links fulfillment.{ffKey}.buildJobId) for build items,
    // sets status→pack|building, writes statusHistory, audits. Delegates to the
    // pre-existing DOM-free core triageAndConfirmOrder (which the legacy
    // executeTriageConfirm also calls after its DOM read).
    triageConfirm: function (orderId, itemActions, record) {
      return _ordersBridgeSeed(orderId, record).then(function () { return triageAndConfirmOrder(orderId, itemActions); });
    },
    // cancelOrder(orderId, reason, record?) → void. reason replaces the legacy
    // #cancelReason DOM read. Releases committed inventory (variant-aware),
    // cancels open admin/buildJobs reqs (pending/assigned→cancelled), writes
    // cancelledAt/cancelReason, MastFlow transition to 'closed' (force), and
    // auto-creates the CS ticket. Delegates to _cancelOrderCore.
    cancelOrder: function (orderId, reason, record) {
      return _ordersBridgeSeed(orderId, record).then(function () { return _cancelOrderCore(orderId, reason); });
    },
    // addNote(orderId, text, record?) → void. text replaces the legacy
    // #orderNoteInput DOM read. Shape-aware notes write (map shape preserved for
    // tenant-MCP orders, else array append) + audit. Delegates to _addOrderNoteCore.
    addNote: function (orderId, text, record) {
      return _ordersBridgeSeed(orderId, record).then(function () { return _addOrderNoteCore(orderId, text); });
    },
    // sendEmail(orderId, opts) → CF result. Thin pass-through over the EXISTING
    // order-email CFs (no new logic). opts.emailType present → templated
    // testOrderEmail; else opts.subject+opts.body → sendCustomOrderEmail. Returns
    // the httpsCallable result (result.data.sentTo). Throws on transport error.
    sendEmail: function (orderId, opts) {
      opts = opts || {};
      var tenantId = MastDB.tenantId();
      if (opts.emailType) {
        return firebase.functions().httpsCallable('testOrderEmail')({
          orderId: orderId,
          emailType: opts.emailType,
          tenantId: tenantId
        });
      }
      return firebase.functions().httpsCallable('sendCustomOrderEmail')({
        orderId: orderId,
        subject: opts.subject,
        body: opts.body,
        tenantId: tenantId
      });
    },
    // listEmails(orderId) → [email] sorted newest-first (read-only). Thin
    // pass-through over MastDB.emails.queryByOrder, normalizing the RTDB
    // DataSnapshot / Firestore-map / array shapes the same way loadOrderEmails
    // does for render.
    listEmails: function (orderId) {
      return Promise.resolve(MastDB.emails.queryByOrder(orderId)).then(function (snap) {
        var emails = [];
        if (snap && typeof snap.forEach === 'function' && typeof snap.val === 'function' && !Array.isArray(snap)) {
          snap.forEach(function (child) { var e = child.val() || {}; e._key = child.key; emails.push(e); });
        } else if (Array.isArray(snap)) {
          snap.forEach(function (e, i) { if (e && typeof e === 'object') { if (!e._key) e._key = 'idx_' + i; emails.push(e); } });
        } else if (snap && typeof snap === 'object') {
          Object.keys(snap).forEach(function (key) { var e = snap[key]; if (e && typeof e === 'object') { e._key = key; emails.push(e); } });
        }
        emails.sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        return emails;
      });
    },
    // bulkMarkShipped(keys) → { ok, fail }. Wired in PR3 to BOTH the legacy bulk
    // handler (bulkOrdersMarkShipped) and the orders-v2 twin's bulk bar, so bulk
    // mark-shipped runs FULL ship side-effects — statusHistory + onOrderShipped
    // inventory deduction + customer email — instead of the bare status flip the
    // legacy bulk path used to do (the latent V1 bug). Delegates per-row to the
    // same _markOrderShippedCore the detail surface uses. Etsy-skip / confirm
    // prompts stay on the caller (UI concern), matching exportCsv staying in
    // the twin (MastEntity.exportRows).
    bulkMarkShipped: function (keys) {
      keys = keys || [];
      var ok = 0, fail = 0;
      return keys.reduce(function (chain, orderId) {
        return chain.then(function () {
          return _ordersBridgeSeed(orderId).then(function () { return _markOrderShippedCore(orderId); })
            .then(function () { ok++; })
            .catch(function () { fail++; });
        });
      }, Promise.resolve()).then(function () { return { ok: ok, fail: fail }; });
    },
    // bulkCancel(keys, reason?) → { ok, fail }. Wired in PR3 to BOTH the legacy
    // bulk handler (bulkOrdersCancel) and the orders-v2 twin's bulk bar.
    // Delegates per-row to the SAME _cancelOrderCore the detail surface uses, so
    // bulk cancellation runs FULL side effects (inventory release, buildJobs
    // cancel, MastFlow transition, CS ticket) instead of the bare status flip the
    // legacy bulk path used to do. Confirm + reason prompts stay on the caller.
    bulkCancel: function (keys, reason) {
      keys = keys || [];
      var ok = 0, fail = 0;
      return keys.reduce(function (chain, orderId) {
        return chain.then(function () {
          return _ordersBridgeSeed(orderId).then(function () { return _cancelOrderCore(orderId, reason || ''); })
            .then(function () { ok++; })
            .catch(function () { fail++; });
        });
      }, Promise.resolve()).then(function () { return { ok: ok, fail: fail }; });
    },
    // issueRefund(orderId, { amountCents, method, reason }, record?) → CF result.
    // The single native "issue a refund for this order" path for orders-v2 PR5.
    // MONEY MOVES ONLY inside transitionRma (action:'complete') — this bridge does
    // NO client money-write and NEVER persists a refund amount client-side. It is
    // a pure delegator: it (1) creates the refund-INTENT RMA record (admin/rma/{id}
    // — the same NON-money record saveNewRma writes, status:'requested', items:[]
    // so completion is a clean write-off with no inventory restock), then (2) drives
    // the RMA through its server-side lifecycle to the only state from which the CF
    // will issue money — approve → shipped-back → received → inspect → complete —
    // passing the requested refundAllocation to the FINAL complete call. The CF
    // (#302, hardened FOR THIS) validates the methods and CAPS the total at the
    // RMA's authorized amount (never above the order total), and itself flips the
    // order status to 'refunded'/'partially_returned'. Server gate is
    // hasPermission('rma','approve') on the approve transition (the caller also
    // gates can/'rma','approve' before invoking); the bridge has no internal RBAC.
    // Returns { rmaId, result } where result is the final complete CF response.
    issueRefund: function (orderId, opts, record) {
      opts = opts || {};
      var method = opts.method === 'store-credit' ? 'store-credit' : 'credit-card';
      var amountCents = Math.round(Number(opts.amountCents) || 0);
      if (!Number.isFinite(amountCents) || amountCents < 0) {
        return Promise.reject(new Error('Invalid refund amount'));
      }
      var tenantId = MastDB.tenantId();
      var fns = firebase.functions();
      var rmaId = MastUtil.genId('rma_');
      // The intent record mirrors saveNewRma exactly (no money). refundMethod uses
      // the legacy store_credit/original_payment vocabulary the RMA record speaks;
      // the CF maps it. refundAmountCents is the AUTHORIZED ceiling the CF caps to.
      var resolvedRefundMethod = method === 'store-credit' ? 'store_credit' : 'original_payment';
      function step(action, payload) {
        return fns.httpsCallable('transitionRma')(Object.assign({
          tenantId: tenantId, rmaId: rmaId, action: action
        }, payload ? { payload: payload } : {})).then(function (res) {
          var d = res && res.data;
          if (d && d.success === false) {
            throw new Error((d && d.error) || ('transitionRma ' + action + ' failed'));
          }
          return res;
        });
      }
      return _ordersBridgeSeed(orderId, record).then(function (o) {
        var nowIso = new Date().toISOString();
        var rec = {
          type: 'refund',
          originOrderId: orderId,
          orderId: orderId,
          orderNumber: getOrderDisplayNumber(o || { orderId: orderId }),
          customerEmail: (o && (o.email || o.customerEmail)) || '',
          customerUid: (o && (o.customerId || o.uid)) || null,
          uid: (o && (o.customerId || o.uid)) || null,
          reason: (opts.reason || '').trim(),
          refundMethod: resolvedRefundMethod,
          refundAmountCents: amountCents,
          restockInventory: false,
          status: 'requested',
          items: [],
          requestedAt: nowIso,
          createdAt: nowIso,
          createdBy: 'operator',
          source: 'orders-v2-refund'
        };
        // NON-money intent write (an RMA ticket), identical in kind to saveNewRma.
        return MastDB.set('admin/rma/' + rmaId, rec);
      })
        // Drive the lifecycle to 'inspected' (the only state the CF lets 'complete'
        // issue money from). Each transition is a server-validated state change with
        // NO refund movement until the final 'complete'.
        .then(function () { return step('approve'); })
        .then(function () { return step('mark-shipped-back'); })
        .then(function () { return step('mark-received'); })
        .then(function () { return step('inspect', { result: 'pass', notes: 'Refund issued from order detail (orders-v2).' }); })
        // The ONLY money movement: the CF validates method + caps amount, issues
        // store credit / queues the card refund, and sets the order to 'refunded'.
        .then(function () {
          return step('complete', {
            disposition: 'write-off',
            notes: (opts.reason || '').trim(),
            refundAllocation: [{ method: method, amountCents: amountCents }]
          });
        })
        .then(function (res) { return { rmaId: rmaId, result: res && res.data }; });
    }
  };

  // ── Register the route ──────────────────────────────────────────────
  function ordersSetup() { ensureTab(); render(); load(); }

  MastAdmin.registerModule('orders-v2', {
    routes: {
      'orders-v2': { tab: 'ordersV2Tab', setup: ordersSetup },
      // T6 PR3: orders-v2 now owns the bare #orders route. The legacy orders.js
      // list/detail/triage UI is retired from the route; its OrdersBridge write
      // surface was absorbed above. The canonical Orders screen resolves HERE for
      // all users — no MAST_V2_ROUTE_MAP remap (mirrors commissions-v2 / team-v2
      // owning their bare routes after the absorb-first cut).
      'orders': { tab: 'ordersV2Tab', setup: ordersSetup }
    }
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
