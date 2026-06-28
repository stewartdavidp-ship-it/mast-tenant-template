/**
 * Pick/Ship (orders fulfillment) workflow spec.
 *
 * Second MastFlow surface — chosen as the validation case for the
 * engine because it stresses three things commissions doesn't:
 *   1. Branches that re-converge (pack-ship vs. pickup vs. dropship,
 *      all ending at delivered).
 *   2. Aggregation over line items (predicate over o.items[]).
 *   3. External advancement via Shippo webhook (transition called by
 *      a non-UI actor — same code path, optimistic-lock still applies).
 *
 * Legacy enum mapping (per orders.js ORDER_STATUS_BADGE_COLORS):
 *   pending_payment, payment_failed, placed → received
 *   confirmed, building, ready              → confirmed
 *   pack                                    → picked (branch point)
 *   packing                                 → packing (branch: pack-ship)
 *   packed                                  → labeled (branch: pack-ship)
 *   handed_to_carrier, shipped              → shipped (branch: pack-ship)
 *   delivered                               → delivered (terminal success)
 *   cancelled, refunded                     → closed (terminal failure)
 *   return_*, partially_returned            → delivered IF the order actually
 *                                              shipped/was delivered first
 *                                              (genuine post-delivery return);
 *                                              otherwise → returned (off-backbone
 *                                              terminal pill — a refund on a
 *                                              never-shipped order is not a
 *                                              delivery). See wasEverFulfilled().
 */
(function() {
  'use strict';
  if (!window.MastFlow) {
    console.error('[pickship.workflow] MastFlow not loaded — load workflow-engine.js first');
    return;
  }

  // ---- Helpers ----
  function hasText(v, min) { return !!(v && typeof v === 'string' && v.trim().length >= (min || 1)); }
  function hasItems(o) { return !!(o.items && o.items.length); }
  function hasShipping(o) { return !!(o.shipping && (o.shipping.address || o.shipping.name)); }
  function hasShippingMethod(o) {
    // Either the shipping block declares a method (Shippo rate selected /
    // pickup / dropship), or the order has a top-level fulfillment plan.
    return !!(o.shipping && (o.shipping.method || o.shipping.serviceLevel)) || !!o.fulfillment;
  }
  function hasLabel(o) { return !!(o.shipping && (o.shipping.labelUrl || o.shipping.label_url)); }
  function hasTracking(o) { return !!(o.shipping && (o.shipping.trackingNumber || o.shipping.tracking_number || o.trackingNumber)); }
  function hasPackageDims(o) {
    return !!(o.shipping && (o.shipping.packageDims || (o.shipping.length && o.shipping.width && o.shipping.height)));
  }
  function customerNotified(o) { return !!(o.shippedNotifiedAt || (o.shipping && o.shipping.notifiedAt)); }
  // Did this order actually leave the building before the return/refund? Used
  // to decide whether a return/refund sits ON the delivered backbone (genuine
  // post-delivery return) or OFF it (a refund on an order that never shipped —
  // which must NOT highlight "Delivered"). Evidence: a shipping label/tracking,
  // a shipped/delivered timestamp, or a fulfillment status in the audit trail.
  function wasEverFulfilled(o) {
    if (!o) return false;
    if (hasLabel(o) || hasTracking(o)) return true;
    if (o.shippedAt || o.deliveredAt || o.handedToCarrierAt) return true;
    var hist = (o.statusHistory && o.statusHistory.length) ? o.statusHistory : null;
    if (hist) {
      for (var i = 0; i < hist.length; i++) {
        var hs = hist[i] && hist[i].status;
        if (hs === 'handed_to_carrier' || hs === 'shipped' || hs === 'delivered') return true;
      }
    }
    return false;
  }
  function pickupNotified(o) { return !!o.pickupNotifiedAt; }
  function pickupConfirmed(o) { return !!o.pickedUpAt; }
  function dropshipPoSent(o) { return !!o.dropshipPoSentAt; }
  function dropshipConfirmed(o) { return !!o.dropshipConfirmedAt; }

  // ---- Tier 2 backorder fulfillment gate ----
  // `applies` predicate: an order is gated only if it was placed with at least
  // one backorder line.
  function hasBackorder(o) {
    return !!(o && o.hasBackorder) || !!(o && o.items && o.items.some(function(it) { return it && it.backorder; }));
  }
  function backorderLines(o) {
    return (o && o.items ? o.items : []).filter(function(it) { return it && it.backorder; });
  }
  // Async exit test: resolves true only when EVERY backorder line's product
  // has physical stock covering all commitments (onHand ≥ committed). The
  // covering PO being received restocks onHand via the receiving CF; until
  // then onHand (0) < committed (the reserved qty) and this stays false.
  // Read live inventory rather than a stamped flag so the gate reflects the
  // real warehouse state at evaluation time (admin context → MastDB available).
  function backorderStockArrived(o) {
    var lines = backorderLines(o);
    if (!lines.length) return true;
    if (typeof MastDB === 'undefined' || !MastDB.get) return false; // can't verify → stay blocked
    return Promise.all(lines.map(function(it) {
      return MastDB.get('admin/inventory/' + it.pid).then(function(inv) {
        if (!inv || !inv.stock) return false;
        var ck = it.backorderVariantKey || it.variantId || '_default';
        var se = inv.stock[ck] || inv.stock._default || {};
        return (se.onHand || 0) >= (se.committed || 0);
      }).catch(function() { return false; });
    })).then(function(results) { return results.every(Boolean); });
  }

  // ---- Phases ----
  var phases = [
    {
      key: 'received',
      label: 'Received',
      statuses: ['pending_payment', 'payment_failed', 'placed', 'pending_check_verification'],
      entryStatus: 'placed',
      exitRequirements: [
        {
          key: 'customer',
          label: 'Customer / contact captured',
          hard: true,
          test: function(o) { return hasText(o.customerEmail) || hasText(o.email) || hasText(o.customerName); },
          target: 'detail-customer'
        },
        {
          key: 'items',
          label: 'At least one line item',
          hard: true,
          test: hasItems,
          target: 'detail-items'
        },
        {
          key: 'payment',
          label: 'Payment cleared',
          hard: false,
          test: function(o) { return o.status !== 'pending_payment' && o.status !== 'payment_failed' && o.status !== 'pending_check_verification'; },
          target: 'detail-payment'
        }
      ]
    },
    {
      key: 'confirmed',
      label: 'Confirmed',
      statuses: ['confirmed', 'building', 'ready'],
      entryStatus: 'confirmed',
      exitRequirements: [
        {
          key: 'fulfillment-plan',
          label: 'Per-item fulfillment plan locked',
          hard: false,  // soft: legacy orders don't carry o.fulfillment
          test: function(o) {
            // Aggregation example: every item has a fulfillment entry.
            // See design doc §4 Option A — engine treats this as a plain
            // predicate; no special "aggregate" engine support needed.
            if (!o.fulfillment || !o.items) return false;
            return o.items.every(function(it) {
              var key = (it.fulfillmentKey || (it.pid + (it.options ? JSON.stringify(it.options) : '')));
              return !!o.fulfillment[key];
            });
          },
          target: 'detail-items'
        },
        {
          key: 'shipping-info',
          label: 'Shipping info captured',
          hard: true,
          test: hasShipping,
          target: 'detail-shipping'
        },
        {
          // Tier 2 backorder gate. Only present on orders that carry a
          // backorder line (submitOrder stamps o.hasBackorder + per-line
          // backorder/backorderVariantKey when it accepts an out-of-stock
          // sale covered by an open PO). Blocks Confirmed → Ready-to-fulfill
          // until the covering PO is received and the receiving CF has
          // restocked onHand so physical stock ≥ committed for every
          // backorder line. Self-clears on reopen once stock arrives.
          key: 'backorder-stock',
          label: 'Back-ordered stock received',
          hard: true,
          applies: hasBackorder,
          test: backorderStockArrived,
          target: 'detail-items'
        }
      ]
    },
    {
      key: 'picked',
      label: 'Ready to fulfill',
      statuses: ['pack'],
      entryStatus: 'pack',
      exitRequirements: [
        {
          key: 'shipping-method',
          label: 'Shipping method chosen',
          hard: true,
          test: hasShippingMethod,
          target: 'detail-shipping'
        }
      ]
    },
    // ---- Branch: pack-ship ----
    {
      key: 'packing',
      label: 'Packing',
      statuses: ['packing'],
      entryStatus: 'packing',
      exitRequirements: [
        {
          key: 'package-dims',
          label: 'Package dimensions captured',
          hard: false,
          test: hasPackageDims,
          target: 'detail-shipping'
        }
      ]
    },
    {
      key: 'labeled',
      label: 'Labeled',
      statuses: ['packed'],
      entryStatus: 'packed',
      exitRequirements: [
        {
          key: 'label-purchased',
          label: 'Shipping label purchased',
          hard: true,
          test: hasLabel,
          target: 'buy-labels'
        }
      ]
    },
    {
      key: 'shipped',
      label: 'Shipped',
      statuses: ['handed_to_carrier', 'shipped'],
      entryStatus: 'shipped',
      exitRequirements: [
        {
          key: 'tracking',
          label: 'Tracking number recorded',
          hard: true,
          test: hasTracking,
          target: 'detail-shipping'
        },
        {
          key: 'notified',
          label: 'Customer notified',
          hard: false,
          test: customerNotified,
          target: 'detail-shipping'
        }
      ]
    },
    // ---- Branch: pickup ----
    {
      key: 'pickup-ready',
      label: 'Pickup ready',
      // No legacy status for pickup yet — branch is forward-compatible.
      statuses: [],
      entryStatus: 'pickup_ready',
      exitRequirements: [
        {
          key: 'pickup-notified',
          label: 'Customer notified for pickup',
          hard: true,
          test: pickupNotified,
          target: 'detail-shipping'
        }
      ]
    },
    {
      key: 'picked-up',
      label: 'Picked up',
      statuses: [],
      entryStatus: 'picked_up',
      exitRequirements: [
        {
          key: 'pickup-confirmed',
          label: 'Pickup confirmed (signature or staff)',
          hard: true,
          test: pickupConfirmed,
          target: 'detail-shipping'
        }
      ]
    },
    // ---- Branch: dropship ----
    {
      key: 'dropship-pending',
      label: 'Dropship pending',
      statuses: [],
      entryStatus: 'dropship_pending',
      exitRequirements: [
        {
          key: 'po-sent',
          label: 'Vendor PO sent',
          hard: true,
          test: dropshipPoSent,
          target: 'detail-shipping'
        }
      ]
    },
    {
      key: 'dropship-confirmed',
      label: 'Dropship confirmed',
      statuses: [],
      entryStatus: 'dropship_confirmed',
      exitRequirements: [
        {
          key: 'vendor-tracking',
          label: 'Vendor tracking received',
          hard: true,
          test: function(o) { return hasText(o.dropshipTracking); },
          target: 'detail-shipping'
        }
      ]
    },
    // ---- Convergence (terminal success) ----
    {
      key: 'delivered',
      label: 'Delivered',
      // Return statuses only stay on the delivered backbone when the order
      // was genuinely delivered first — derivePhaseFromLegacy() decides that
      // per-order via wasEverFulfilled(). A return/refund on a never-shipped
      // order routes to the off-backbone 'returned' phase instead, so the
      // stepper never highlights "Delivered" for an unfulfilled order.
      statuses: ['delivered'],
      entryStatus: 'delivered',
      terminal: 'success',
      exitRequirements: []
    },
    // ---- Terminal: returned / refunded (off-backbone) ----
    // Renders as a standalone pill, NOT a progression step — a returned or
    // refunded-without-shipping order has no meaningful fulfillment progress
    // to show. Reuses the engine's terminal-'failure' pill rendering.
    {
      key: 'returned',
      label: 'Returned / refunded',
      statuses: ['return_requested', 'return_approved', 'return_shipped', 'return_received', 'partially_returned'],
      entryStatus: 'partially_returned',
      terminal: 'failure',
      exitRequirements: []
    },
    // ---- Terminal failure ----
    {
      key: 'closed',
      label: 'Closed (cancelled / refunded)',
      statuses: ['cancelled', 'refunded'],
      entryStatus: 'cancelled',
      terminal: 'failure',
      exitRequirements: []
    }
  ];

  // ---- Branch point: picked → 3 choices, all converge at delivered ----
  var branches = {
    'picked': {
      label: 'How is this order fulfilling?',
      choices: [
        // Each choice declares its full phase chain explicitly. The engine
        // uses these arrays to build the stepper, find sibling-branch
        // boundaries, and compute successors — instead of relying on
        // phases[] declaration order (which couples spec layout to behavior
        // and breaks when multiple branches' phases interleave).
        { key: 'pack-ship', label: 'Pack & ship',     entryPhase: 'packing',          phases: ['packing', 'labeled', 'shipped'] },
        { key: 'pickup',    label: 'Customer pickup', entryPhase: 'pickup-ready',     phases: ['pickup-ready', 'picked-up'] },
        { key: 'dropship',  label: 'Vendor dropship', entryPhase: 'dropship-pending', phases: ['dropship-pending', 'dropship-confirmed'] }
      ],
      convergesAt: 'delivered'
    }
  };

  // ---- Legacy phase derivation ----
  function derivePhaseFromLegacy(o) {
    var s = o && o.status;
    if (!s) return { phase: 'received', satisfiedRequirementOverrides: [] };
    if (s === 'cancelled' || s === 'refunded') {
      return { phase: 'closed', satisfiedRequirementOverrides: [] };
    }
    if (s === 'delivered') {
      return { phase: 'delivered', satisfiedRequirementOverrides: [] };
    }
    if (s === 'return_requested' || s === 'return_approved' || s === 'return_shipped' ||
        s === 'return_received' || s === 'partially_returned') {
      // A return/refund AFTER the order actually shipped or was delivered stays
      // on the delivered backbone (the order genuinely reached delivery; the
      // return is modeled separately). A return/refund on an order that NEVER
      // shipped is not a delivery — route it to the off-backbone 'returned'
      // pill so the stepper doesn't contradict reality by highlighting
      // "Delivered" (and showing the skipped Confirmed/Ready-to-fulfill steps
      // as incomplete). Caught live on sgtest15 (SGTE-0250: placed → refund).
      return wasEverFulfilled(o)
        ? { phase: 'delivered', satisfiedRequirementOverrides: [] }
        : { phase: 'returned', satisfiedRequirementOverrides: [] };
    }
    // Map pack-ship branch statuses → recorded branch so the stepper draws
    // the right chain even though __workflow.branch isn't set yet on legacy
    // orders. Surfaces using derivePhaseFromLegacy should also seed
    // record.__workflow.branch from the same logic on first read.
    for (var i = 0; i < phases.length; i++) {
      if ((phases[i].statuses || []).indexOf(s) !== -1) {
        return { phase: phases[i].key, satisfiedRequirementOverrides: [] };
      }
    }
    return { phase: 'received', satisfiedRequirementOverrides: [] };
  }

  // ---- Force-advance permission ----
  function canForce(actor, role) {
    return role === 'admin' || role === 'manager';
  }

  // ---- Record path ----
  // Orders live at the ROOT `orders/{id}` (NOT `admin/orders/`). Confirmed
  // via MastDB.orders.PATH = 'orders' in app/index.html:12163. Verification
  // on sgtest15 caught this — earlier draft used 'admin/orders/' which
  // caused MastFlow.transition writes to silently land at a sibling path
  // (or fail security rules), aborting the audit-row write.
  function recordPath(orderId) {
    return 'orders/' + orderId;
  }

  // ---- Extra patch on transition ----
  // Mirror entry status into the legacy statusHistory[] that the rest of
  // the orders surface reads, so the existing badges + filters stay accurate.
  // `actor` is the engine's resolved actor for this transition (4th arg):
  // { uid, displayName } for a signed-in user, or { system: '...' } for a
  // webhook / automated transition. Record the human-readable name so the
  // order History reads "Confirmed · Sarah Chen", and "Automatic" for genuine
  // system transitions — instead of the old opaque 'mastflow' sentinel.
  function recordExtraPatch(record, targetPhase, opts, actor) {
    if (!targetPhase.entryStatus) return {};
    var now = new Date().toISOString();
    var by = (actor && actor.displayName) ? actor.displayName : 'Automatic';
    var hist = (record.statusHistory && record.statusHistory.slice) ? record.statusHistory.slice() : [];
    hist.push({ status: targetPhase.entryStatus, at: now, by: by, note: 'workflow transition' });
    return { statusHistory: hist, updatedAt: now };
  }

  // ---- Register ----
  window.MastFlow.define('pickship', {
    recordKind: 'order',
    specVersion: 'pickship@1',
    phases: phases,
    branches: branches,
    derivePhaseFromLegacy: derivePhaseFromLegacy,
    canForce: canForce,
    recordPath: recordPath,
    recordExtraPatch: recordExtraPatch
  });
})();
