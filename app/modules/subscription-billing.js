/**
 * subscription-billing.js — the Subscription tab's billing render surface: the
 * revenue meter, the current monthly bill, the bill history, and the billing-info
 * panel (renderRevenueMeter / renderMonthlyBill / renderBillHistory /
 * renderSubscriptionBillingInfo), called by renderSubscriptionSettings.
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted byte-for-byte from the index.html inline <script> for the T1
 * decomposition, except hardcoded hex colors become rgba() (identical color,
 * hex-lint clean). The inline block is top-level scope, so every symbol stays a
 * window global; the renders' bare deps (PRICING_MODEL, _revenueMeterMonthKey /
 * _revenueMeterFetchMonth / _revenueMeterFormatCents / _revenueMeterFeeCents,
 * fetchSubscriptionDetails, esc, MastDB, firebase) are window globals read only
 * POST-LOAD (the renders fire from renderSubscriptionSettings on the subscription
 * route), so the deferred load is safe. Its money/date formatting is relocated
 * (not new) local-fmt debt — index.html isn't scanned by lint-no-local-fmt.
 */

async function renderRevenueMeter() {
  var el = document.getElementById('subscriptionRevenueMeter');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading revenue meter...</div>';

  var monthKey = _revenueMeterMonthKey();
  var data = await _revenueMeterFetchMonth(monthKey);

  var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:20px;">';

  if (!data) {
    h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);margin-bottom:4px;">Revenue meter</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">Software subscription priced by revenue &mdash; 1% of net, capped at ' + esc(_revenueMeterFormatCents(PRICING_MODEL.maxFeeCents)) + '/mo.</div>';
    h += '<div style="font-size:0.85rem;color:var(--warm-gray);">No revenue recorded yet for <strong>' + esc(monthKey) + '</strong>. Your meter will populate as sales are received.</div>';
    h += '</div>';
    el.innerHTML = h;
    return;
  }

  var gross = data.grossCents || 0;
  var salesTax = data.salesTaxCents || 0;
  var refunds = data.refundsCents || 0;
  var processor = data.processorFeesCents || 0;
  var marketplace = data.marketplaceFeesCents || 0;
  var shipping = data.shippingCents || 0;
  var net = data.netCents || 0;
  var channels = data.channels || {};

  var channelOrder = ['stripe', 'tenantStripe', 'square', 'etsy', 'manual', 'consignment'];
  var channelLabels = {
    stripe: 'Stripe (Mast)',
    tenantStripe: 'Stripe (your account)',
    square: 'Square',
    etsy: 'Etsy',
    manual: 'Manual sales',
    consignment: 'Consignment payouts'
  };

  // Header with net-to-date summary
  h += '<div style="display:flex;align-items:baseline;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:10px;">';
  h += '<div>';
  h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);">Revenue meter</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray);">Software subscription priced by revenue &mdash; <strong>' + esc(monthKey) + '</strong></div>';
  h += '</div>';
  h += '<div style="text-align:right;">';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;">Net to date</div>';
  h += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:700;color:var(--amber);">' + esc(_revenueMeterFormatCents(net)) + '</div>';
  h += '</div>';
  h += '</div>';

  // Per-channel breakdown
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;margin-top:14px;margin-bottom:8px;">By channel</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px 16px;font-size:0.85rem;">';
  var anyChannel = false;
  channelOrder.forEach(function(ch) {
    var bucket = channels[ch];
    if (!bucket || !bucket.grossCents) return;
    anyChannel = true;
    h += '<div style="background:var(--cream-dark);border-radius:6px;padding:10px 12px;">';
    h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;">' + esc(channelLabels[ch] || ch) + '</div>';
    h += '<div style="font-weight:600;color:var(--text-primary);">' + esc(_revenueMeterFormatCents(bucket.grossCents)) + '</div>';
    var count = bucket.count || 0;
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + String(count) + ' entr' + (count === 1 ? 'y' : 'ies') + '</div>';
    h += '</div>';
  });
  if (!anyChannel) {
    h += '<div style="color:var(--warm-gray);font-size:0.85rem;grid-column:1/-1;">No channel activity yet this month.</div>';
  }
  h += '</div>';

  // Deductions applied
  h += '<div style="border-top:1px solid var(--cream-dark);padding-top:12px;margin-top:14px;">';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;">Deductions applied</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:6px 20px;font-size:0.85rem;">';
  h += '<div><span style="color:var(--warm-gray);">Gross:</span> <span style="color:var(--text-primary);font-weight:500;">' + esc(_revenueMeterFormatCents(gross)) + '</span></div>';
  h += '<div><span style="color:var(--warm-gray);">Sales tax:</span> <span style="color:var(--text-primary);font-weight:500;">&minus;' + esc(_revenueMeterFormatCents(salesTax)) + '</span></div>';
  h += '<div><span style="color:var(--warm-gray);">Refunds:</span> <span style="color:var(--text-primary);font-weight:500;">&minus;' + esc(_revenueMeterFormatCents(refunds)) + '</span></div>';
  h += '<div><span style="color:var(--warm-gray);">Processor fees:</span> <span style="color:var(--text-primary);font-weight:500;">&minus;' + esc(_revenueMeterFormatCents(processor)) + '</span></div>';
  h += '<div><span style="color:var(--warm-gray);">Marketplace fees:</span> <span style="color:var(--text-primary);font-weight:500;">&minus;' + esc(_revenueMeterFormatCents(marketplace)) + '</span></div>';
  h += '<div><span style="color:var(--warm-gray);">Shipping (excluded):</span> <span style="color:var(--text-primary);font-weight:500;">&minus;' + esc(_revenueMeterFormatCents(shipping)) + '</span></div>';
  h += '</div>';
  h += '</div>';

  h += '</div>';
  el.innerHTML = h;
}

async function renderMonthlyBill() {
  var el = document.getElementById('subscriptionMonthlyBill');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading monthly bill...</div>';

  var monthKey = _revenueMeterMonthKey();
  var data = await _revenueMeterFetchMonth(monthKey);
  var net = (data && data.netCents) || 0;
  var fee = _revenueMeterFeeCents(net);
  var atCap = fee >= PRICING_MODEL.maxFeeCents;
  var suppressed = net < PRICING_MODEL.thresholdCents;

  var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:20px;">';
  h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);margin-bottom:4px;">Your monthly software fee</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">Software subscription priced by revenue &mdash; 1% of net, rounded to the nearest ' + esc(_revenueMeterFormatCents(PRICING_MODEL.roundToCents)) + ' of net and capped at ' + esc(_revenueMeterFormatCents(PRICING_MODEL.maxFeeCents)) + '/mo.</div>';

  h += '<div style="display:flex;align-items:baseline;gap:20px;flex-wrap:wrap;margin-bottom:12px;">';
  h += '<div>';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;">Projected fee for ' + esc(monthKey) + '</div>';
  h += '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:700;color:var(--amber);">' + esc(_revenueMeterFormatCents(fee)) + '</div>';
  h += '</div>';
  if (atCap) {
    h += '<span class="status-badge" style="background:var(--teal);color:white;">Cap reached</span>';
  } else if (suppressed) {
    h += '<span class="status-badge" style="background:rgba(22,163,74,1);color:white;">Invoice suppressed</span>';
  }
  h += '</div>';

  h += '<div style="font-size:0.85rem;color:var(--warm-gray);">';
  h += 'Net this month: <span style="color:var(--text-primary);font-weight:500;">' + esc(_revenueMeterFormatCents(net)) + '</span>. ';
  if (suppressed) {
    h += 'No invoice &mdash; your software subscription is suppressed below ' + esc(_revenueMeterFormatCents(PRICING_MODEL.thresholdCents)) + ' of net.';
  } else if (atCap) {
    h += 'You&rsquo;ve hit the monthly cap; additional net revenue this month won&rsquo;t raise your software fee.';
  } else {
    h += 'Your final monthly software fee is set when the month closes.';
  }
  h += '</div>';

  h += '</div>';
  el.innerHTML = h;
}

async function renderBillHistory() {
  var el = document.getElementById('subscriptionBillHistory');
  if (!el) return;
  el.innerHTML = '<div class="loading">Loading bill history...</div>';

  // Skip the current month; show the 6 most recent months prior.
  var allKeys = _revenueMeterPastMonthKeys(7);
  var keys = allKeys.slice(1); // drop current month (covered by the two cards above)
  var docs = await Promise.all(keys.map(function(k) { return _revenueMeterFetchMonth(k); }));

  var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:20px;">';
  h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);margin-bottom:4px;">Bill history</div>';
  h += '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:14px;">Last 6 months of your monthly software fee.</div>';

  h += '<div style="max-height:260px;overflow-y:auto;border-top:1px solid var(--cream-dark);">';
  h += '<div style="display:grid;grid-template-columns:1fr auto auto auto;gap:8px 16px;font-size:0.85rem;align-items:center;padding-top:10px;">';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;">Month</div>';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;text-align:right;">Net</div>';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;text-align:right;">Fee</div>';
  h += '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;">Status</div>';

  var anyRows = false;
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var doc = docs[i];
    if (!doc) {
      h += '<div style="color:var(--text-primary);">' + esc(k) + '</div>';
      h += '<div style="color:var(--warm-gray);text-align:right;">&mdash;</div>';
      h += '<div style="color:var(--warm-gray);text-align:right;">&mdash;</div>';
      h += '<div style="color:var(--warm-gray);font-size:0.78rem;">No data</div>';
      continue;
    }
    anyRows = true;
    var finalFee = (doc.feeFinalCents != null) ? doc.feeFinalCents : (doc.feeProjectedCents || 0);
    var isFinal = (doc.feeFinalCents != null);
    var invoiced = !!doc.invoiceIssued;
    var statusText = invoiced ? 'Invoiced' : (isFinal ? 'Closed' : 'Open');
    var statusColor = invoiced ? 'rgba(22,163,74,1)' : (isFinal ? 'var(--teal)' : 'rgba(245,158,11,1)');
    h += '<div style="color:var(--text-primary);font-weight:500;">' + esc(k) + '</div>';
    h += '<div style="color:var(--text-primary);text-align:right;">' + esc(_revenueMeterFormatCents(doc.netCents || 0)) + '</div>';
    h += '<div style="color:var(--amber);font-weight:600;text-align:right;">' + esc(_revenueMeterFormatCents(finalFee)) + '</div>';
    h += '<div><span class="status-badge" style="background:' + statusColor + ';color:white;font-size:0.72rem;">' + esc(statusText) + '</span></div>';
  }
  h += '</div>';
  if (!anyRows) {
    h += '<div style="color:var(--warm-gray);font-size:0.85rem;margin-top:12px;padding-bottom:2px;">No closed bills yet &mdash; each month will appear here after it&rsquo;s closed.</div>';
  }
  h += '</div>';

  h += '</div>';
  el.innerHTML = h;
}

// [REMOVED Checkpoint 4b] selectSubscriptionTier / initiateUpgrade — tier
// switching is gone. Revenue-based pricing doesn't need a tier picker.

// --- Billing Info Section ---

function renderSubscriptionBillingInfo(sub) {
  var el = document.getElementById('subscriptionBillingInfo');
  if (!el) return;

  var isRevenueModel = sub && sub.model === 'revenue-1pct';
  var details = _subscriptionDetails;

  // Loading state
  if (_subscriptionDetailsLoading && !details) {
    el.innerHTML = '<div class="loading">Loading subscription details...</div>';
    return;
  }

  // Fetch details if we haven't yet
  if (!details && !_subscriptionDetailsLoading) {
    _subscriptionDetailsLoading = true;
    fetchSubscriptionDetails().then(function(d) {
      _subscriptionDetails = d;
      _subscriptionDetailsLoading = false;
      renderSubscriptionBillingInfo(sub);
    }).catch(function() {
      _subscriptionDetailsLoading = false;
      renderSubscriptionBillingInfo(sub);
    });
    el.innerHTML = '<div class="loading">Loading subscription details...</div>';
    return;
  }

  // Build billing card — revenue-1pct tenants get a priced-by-revenue header;
  // legacy tenants without a model field fall back to a neutral header (the
  // tier picker is gone, so no TIER_CONFIG lookup).
  var planName = isRevenueModel ? 'Software subscription' : 'Subscription';
  var priceStr = isRevenueModel ? 'Priced by revenue' : (details && details.planAmount ? '$' + (details.planAmount / 100) : 'Free');
  var intervalStr = (isRevenueModel || priceStr === 'Free' || priceStr === '$0')
    ? ''
    : (details && details.planInterval === 'year' ? '/yr' : '/mo');

  var statusColor = 'rgba(22,163,74,1)';
  var statusText = 'Active';
  if (details) {
    if (details.cancelAtPeriodEnd) { statusColor = 'rgba(245,158,11,1)'; statusText = 'Canceling'; }
    else if (details.status === 'past_due') { statusColor = 'var(--danger)'; statusText = 'Past Due'; }
    else if (details.status === 'canceled') { statusColor = 'rgba(156,163,175,1)'; statusText = 'Canceled'; }
    else if (details.status === 'active') { statusColor = 'rgba(22,163,74,1)'; statusText = 'Active'; }
  }

  var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;">';

  // Row 1: Plan name + status + price
  h += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px;">';
  h += '<div style="font-weight:600;font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text-primary);">' + esc(planName) + '</div>';
  h += '<span class="status-badge" style="background:' + statusColor + ';color:white;">' + statusText + '</span>';
  h += '<span style="font-size:0.9rem;color:var(--amber);font-weight:600;">' + esc(priceStr) + intervalStr + '</span>';
  h += '</div>';

  // Details grid
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px 24px;font-size:0.85rem;margin-bottom:16px;">';

  if (details && details.currentPeriodEnd) {
    var renewDate = new Date(details.currentPeriodEnd);
    var renewStr = renewDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (details.cancelAtPeriodEnd) {
      h += '<div><span style="color:var(--warm-gray);">Access until:</span> <span style="color:var(--text-primary);font-weight:500;">' + renewStr + '</span></div>';
    } else {
      h += '<div><span style="color:var(--warm-gray);">Next renewal:</span> <span style="color:var(--text-primary);font-weight:500;">' + renewStr + '</span></div>';
    }
  }

  if (details && details.paymentMethod) {
    var pm = details.paymentMethod;
    var brandName = pm.brand ? pm.brand.charAt(0).toUpperCase() + pm.brand.slice(1) : 'Card';
    h += '<div><span style="color:var(--warm-gray);">Payment:</span> <span style="color:var(--text-primary);font-weight:500;">' + esc(brandName) + ' ending ' + esc(pm.last4) + '</span></div>';
  }

  if (sub.effectiveDate) {
    var memberDate = new Date(sub.effectiveDate);
    h += '<div><span style="color:var(--warm-gray);">Member since:</span> <span style="color:var(--text-primary);font-weight:500;">' + memberDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) + '</span></div>';
  }

  h += '</div>';

  // Cancel warning — Layer-2 mode-aware. Three shapes:
  //   1. cancel_immediately + waiver confirmed → red, "data deletion confirmed for <date>, no recovery"
  //   2. cancel_immediately → amber, "new sales disabled; fulfill pending orders until <date>; data deleted 30d after"
  //   3. stop_renewal (or unknown mode for backward-compat) → amber, "subscription ends <date>; data kept 30d after"
  if (details && details.cancelAtPeriodEnd && details.currentPeriodEnd) {
    var endDate = new Date(details.currentPeriodEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    var mode = details.pendingDeletion && details.pendingDeletion.mode;
    var imm = details.pendingImmediateDeletion;
    var purgeAt = (imm && imm.confirmedAt && imm.scheduledPurgeAt)
      ? new Date(imm.scheduledPurgeAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : (details.pendingDeletion && details.pendingDeletion.scheduledPurgeAt)
        ? new Date(details.pendingDeletion.scheduledPurgeAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
        : null;

    if (imm && imm.confirmedAt) {
      // Waiver confirmed — most severe banner. Red.
      h += '<div style="background:rgba(254,242,242,1);border:1px solid rgba(254,202,202,1);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:0.85rem;color:rgba(127,29,29,1);">';
      h += '<strong>Data deletion confirmed.</strong> Your subscription ends on <strong>' + endDate + '</strong>';
      if (purgeAt) h += ' and all your data will be permanently deleted on <strong>' + purgeAt + '</strong> with no recovery';
      h += '. To stop this, contact Mast support immediately.';
      h += '</div>';
    } else if (mode === 'cancel_immediately') {
      // Hard cancel — storefront stops accepting new sales, admin can still
      // fulfill in-flight. Amber-strong.
      h += '<div style="background:rgba(254,243,199,1);border:1px solid rgba(245,158,11,1);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:0.85rem;color:rgba(146,64,14,1);">';
      h += '<strong>Subscription cancelled.</strong> New sales are disabled. You can fulfill pending orders until <strong>' + endDate + '</strong>';
      if (purgeAt) h += '. Data will be permanently deleted on <strong>' + purgeAt + '</strong>';
      h += ' unless you resubscribe.';
      h += '</div>';
    } else {
      // stop_renewal OR legacy cancel — softer copy, full ops continue.
      h += '<div style="background:rgba(254,243,199,1);border:1px solid rgba(245,158,11,1);border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:0.85rem;color:rgba(146,64,14,1);">';
      h += 'Your subscription will end on <strong>' + endDate + '</strong>';
      if (purgeAt) h += ' and your data will be permanently deleted on <strong>' + purgeAt + '</strong>';
      h += ' unless you resubscribe.';
      h += '</div>';
    }
  }

  // Action buttons
  h += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
  h += '<button class="btn btn-secondary btn-small" onclick="openBillingPortal()">Manage Billing</button>';

  if (details && details.cancelAtPeriodEnd) {
    h += '<button class="btn btn-primary btn-small" onclick="resumeSubscription()">Resume Auto-Renewal</button>';
  } else if (details && details.status === 'active') {
    h += '<button class="btn btn-secondary btn-small" onclick="stopAutoRenewalUI()">Stop Auto-Renewal</button>';
    h += '<button class="btn btn-small" style="color:var(--danger);border:1px solid var(--danger);background:transparent;" onclick="cancelSubscriptionUI()">Cancel Subscription</button>';
  }
  h += '</div>';

  h += '</div>';
  el.innerHTML = h;
}

